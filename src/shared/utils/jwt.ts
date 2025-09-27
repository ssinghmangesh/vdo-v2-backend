import jwt from 'jsonwebtoken';
import { AppError, ErrorCodes } from '../types';
import { logger } from './logger';

export interface JwtPayload {
  userId: string;
  email: string;
  name: string;
  iat?: number;
  exp?: number;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

class JWTService {
  private readonly accessTokenSecret: string;
  private readonly refreshTokenSecret: string;
  private readonly accessTokenExpiry: string;
  private readonly refreshTokenExpiry: string;

  constructor() {
    this.accessTokenSecret = process.env.JWT_ACCESS_SECRET || 'your-access-secret-key';
    this.refreshTokenSecret = process.env.JWT_REFRESH_SECRET || 'your-refresh-secret-key';
    this.accessTokenExpiry = process.env.JWT_ACCESS_EXPIRY || '15m';
    this.refreshTokenExpiry = process.env.JWT_REFRESH_EXPIRY || '7d';

    // Warn if using default secrets in production
    if (process.env.NODE_ENV === 'production') {
      if (this.accessTokenSecret === 'your-access-secret-key' || this.refreshTokenSecret === 'your-refresh-secret-key') {
        logger.warn('Using default JWT secrets in production environment!');
      }
    }
  }

  /**
   * Generate access token
   */
  generateAccessToken(payload: Omit<JwtPayload, 'iat' | 'exp'>): string {
    try {
      return jwt.sign(payload, this.accessTokenSecret, {
        expiresIn: this.accessTokenExpiry,
        issuer: 'videocall-api',
        audience: 'videocall-client',
      });
    } catch (error) {
      logger.error('Error generating access token:', error);
      throw new AppError('Failed to generate access token', 500, ErrorCodes.INTERNAL_ERROR);
    }
  }

  /**
   * Generate refresh token
   */
  generateRefreshToken(payload: Omit<JwtPayload, 'iat' | 'exp'>): string {
    try {
      return jwt.sign(payload, this.refreshTokenSecret, {
        expiresIn: this.refreshTokenExpiry,
        issuer: 'videocall-api',
        audience: 'videocall-client',
      });
    } catch (error) {
      logger.error('Error generating refresh token:', error);
      throw new AppError('Failed to generate refresh token', 500, ErrorCodes.INTERNAL_ERROR);
    }
  }

  /**
   * Generate token pair (access + refresh)
   */
  generateTokenPair(payload: Omit<JwtPayload, 'iat' | 'exp'>): TokenPair {
    return {
      accessToken: this.generateAccessToken(payload),
      refreshToken: this.generateRefreshToken(payload),
    };
  }

  /**
   * Verify access token
   */
  verifyAccessToken(token: string): JwtPayload {
    try {
      const decoded = jwt.verify(token, this.accessTokenSecret, {
        issuer: 'videocall-api',
        audience: 'videocall-client',
      }) as JwtPayload;

      return decoded;
    } catch (error) {
      if (error instanceof jwt.TokenExpiredError) {
        throw new AppError('Access token expired', 401, ErrorCodes.TOKEN_EXPIRED);
      } else if (error instanceof jwt.JsonWebTokenError) {
        throw new AppError('Invalid access token', 401, ErrorCodes.TOKEN_INVALID);
      } else {
        logger.error('Error verifying access token:', error);
        throw new AppError('Token verification failed', 401, ErrorCodes.TOKEN_INVALID);
      }
    }
  }

  /**
   * Verify refresh token
   */
  verifyRefreshToken(token: string): JwtPayload {
    try {
      const decoded = jwt.verify(token, this.refreshTokenSecret, {
        issuer: 'videocall-api',
        audience: 'videocall-client',
      }) as JwtPayload;

      return decoded;
    } catch (error) {
      if (error instanceof jwt.TokenExpiredError) {
        throw new AppError('Refresh token expired', 401, ErrorCodes.TOKEN_EXPIRED);
      } else if (error instanceof jwt.JsonWebTokenError) {
        throw new AppError('Invalid refresh token', 401, ErrorCodes.TOKEN_INVALID);
      } else {
        logger.error('Error verifying refresh token:', error);
        throw new AppError('Token verification failed', 401, ErrorCodes.TOKEN_INVALID);
      }
    }
  }

  /**
   * Decode token without verification (for debugging)
   */
  decodeToken(token: string): JwtPayload | null {
    try {
      return jwt.decode(token) as JwtPayload;
    } catch (error) {
      logger.error('Error decoding token:', error);
      return null;
    }
  }

  /**
   * Get token expiry time
   */
  getTokenExpiry(token: string): Date | null {
    try {
      const decoded = this.decodeToken(token);
      if (decoded?.exp) {
        return new Date(decoded.exp * 1000);
      }
      return null;
    } catch (error) {
      logger.error('Error getting token expiry:', error);
      return null;
    }
  }

  /**
   * Check if token is expired
   */
  isTokenExpired(token: string): boolean {
    const expiry = this.getTokenExpiry(token);
    if (!expiry) return true;
    return expiry < new Date();
  }

  /**
   * Extract token from Authorization header
   */
  extractTokenFromHeader(authHeader?: string): string | null {
    if (!authHeader) return null;
    
    const parts = authHeader.split(' ');
    if (parts.length !== 2 || parts[0] !== 'Bearer') {
      return null;
    }
    
    return parts[1];
  }

  /**
   * Get access token expiry duration in human readable format
   */
  getAccessTokenExpiryDuration(): string {
    return this.accessTokenExpiry;
  }

  /**
   * Get refresh token expiry duration in human readable format
   */
  getRefreshTokenExpiryDuration(): string {
    return this.refreshTokenExpiry;
  }
}

// Export singleton instance
export const jwtService = new JWTService();

// Export the class for testing
export { JWTService };
