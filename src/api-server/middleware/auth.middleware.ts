import { Request, Response, NextFunction } from 'express';
import { AppError, ErrorCodes, User } from '../../shared/types';
import { jwtService } from '../../shared/utils/jwt';
import { UserModel } from '../models/user.model';
import { logger } from '../../shared/utils/logger';

// Extend Express Request type to include user
declare global {
  namespace Express {
    interface Request {
      user?: User;
    }
  }
}

/**
 * Middleware to authenticate requests using JWT tokens
 */
export const authenticate = async (req: Request, res: Response, next: NextFunction) => {
  try {
    // Extract token from Authorization header
    const authHeader = req.headers.authorization;
    const token = jwtService.extractTokenFromHeader(authHeader);

    if (!token) {
      throw new AppError('Access token required', 401, ErrorCodes.UNAUTHORIZED);
    }

    // Verify token
    const decoded = jwtService.verifyAccessToken(token);

    // Fetch user from database
    const user = await UserModel.findById(decoded.userId).select('-password');
    if (!user) {
      throw new AppError('User not found', 401, ErrorCodes.UNAUTHORIZED);
    }

    // Add user to request object
    req.user = user.toJSON();
    
    logger.debug('User authenticated', { userId: user._id, email: user.email });
    next();
  } catch (error) {
    if (error instanceof AppError) {
      return res.status(error.statusCode).json({
        success: false,
        message: error.message,
        code: error.code,
      });
    }

    logger.error('Authentication error:', error);
    return res.status(401).json({
      success: false,
      message: 'Authentication failed',
      code: ErrorCodes.UNAUTHORIZED,
    });
  }
};

/**
 * Optional authentication middleware - doesn't fail if no token provided
 */
export const optionalAuth = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const authHeader = req.headers.authorization;
    const token = jwtService.extractTokenFromHeader(authHeader);

    if (token) {
      try {
        const decoded = jwtService.verifyAccessToken(token);
        const user = await UserModel.findById(decoded.userId).select('-password');
        
        if (user) {
          req.user = user.toJSON();
          logger.debug('Optional auth - user authenticated', { userId: user._id });
        }
      } catch (error) {
        // Log but don't fail for optional auth
        logger.debug('Optional auth - token invalid or expired:', error);
      }
    }

    next();
  } catch (error) {
    logger.error('Optional authentication error:', error);
    next();
  }
};

/**
 * Middleware to check if user is the host of a call
 */
export const requireHost = async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!req.user) {
      throw new AppError('Authentication required', 401, ErrorCodes.UNAUTHORIZED);
    }

    // This middleware should be used after fetching the call
    // The call should be attached to req.call by a previous middleware
    const call = (req as any).call;
    
    if (!call) {
      throw new AppError('Call not found', 404, ErrorCodes.CALL_NOT_FOUND);
    }

    if (call.hostId.toString() !== req.user._id.toString()) {
      throw new AppError('Only the host can perform this action', 403, ErrorCodes.HOST_REQUIRED);
    }

    next();
  } catch (error) {
    if (error instanceof AppError) {
      return res.status(error.statusCode).json({
        success: false,
        message: error.message,
        code: error.code,
      });
    }

    logger.error('Host authorization error:', error);
    return res.status(500).json({
      success: false,
      message: 'Authorization failed',
      code: ErrorCodes.INTERNAL_ERROR,
    });
  }
};

/**
 * Middleware to check if user can access a call (host or participant)
 */
export const requireCallAccess = async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!req.user) {
      throw new AppError('Authentication required', 401, ErrorCodes.UNAUTHORIZED);
    }

    const call = (req as any).call;
    
    if (!call) {
      throw new AppError('Call not found', 404, ErrorCodes.CALL_NOT_FOUND);
    }

    // Check if user is host
    if (call.hostId.toString() === req.user._id.toString()) {
      return next();
    }

    // Check if user is a participant
    const isParticipant = call.participants.some((p: any) => 
      p.userId.toString() === req.user._id.toString()
    );

    if (!isParticipant) {
      throw new AppError('Access denied to this call', 403, ErrorCodes.UNAUTHORIZED);
    }

    next();
  } catch (error) {
    if (error instanceof AppError) {
      return res.status(error.statusCode).json({
        success: false,
        message: error.message,
        code: error.code,
      });
    }

    logger.error('Call access authorization error:', error);
    return res.status(500).json({
      success: false,
      message: 'Authorization failed',
      code: ErrorCodes.INTERNAL_ERROR,
    });
  }
};

/**
 * Middleware to rate limit authentication attempts
 */
export const authRateLimit = {
  attempts: new Map<string, { count: number; resetTime: number }>(),
  
  check: (req: Request, res: Response, next: NextFunction) => {
    const ip = req.ip || req.connection.remoteAddress || 'unknown';
    const now = Date.now();
    const windowMs = 15 * 60 * 1000; // 15 minutes
    const maxAttempts = 5;

    const attempts = authRateLimit.attempts.get(ip) || { count: 0, resetTime: now + windowMs };

    // Reset if window has passed
    if (now > attempts.resetTime) {
      attempts.count = 0;
      attempts.resetTime = now + windowMs;
    }

    // Check if limit exceeded
    if (attempts.count >= maxAttempts) {
      const timeLeft = Math.ceil((attempts.resetTime - now) / 1000 / 60);
      return res.status(429).json({
        success: false,
        message: `Too many authentication attempts. Try again in ${timeLeft} minutes.`,
        code: 'RATE_LIMIT_EXCEEDED',
      });
    }

    // Increment attempt count on authentication failure
    const originalJson = res.json;
    res.json = function(body: any) {
      if (!body.success && (res.statusCode === 401 || res.statusCode === 400)) {
        attempts.count++;
        authRateLimit.attempts.set(ip, attempts);
      }
      return originalJson.call(this, body);
    };

    next();
  },

  // Clean up old entries periodically
  cleanup: () => {
    const now = Date.now();
    for (const [ip, attempts] of authRateLimit.attempts.entries()) {
      if (now > attempts.resetTime) {
        authRateLimit.attempts.delete(ip);
      }
    }
  }
};

// Clean up rate limit data every hour
setInterval(authRateLimit.cleanup, 60 * 60 * 1000);

/**
 * Middleware to validate API key for server-to-server communication
 */
export const validateApiKey = (req: Request, res: Response, next: NextFunction) => {
  const apiKey = req.headers['x-api-key'] || req.query.apiKey;
  const validApiKey = process.env.API_KEY;

  if (!validApiKey) {
    logger.warn('API key not configured in environment variables');
    return res.status(500).json({
      success: false,
      message: 'Server configuration error',
      code: ErrorCodes.INTERNAL_ERROR,
    });
  }

  if (!apiKey || apiKey !== validApiKey) {
    logger.warn('Invalid API key attempt', { ip: req.ip, userAgent: req.get('User-Agent') });
    return res.status(401).json({
      success: false,
      message: 'Invalid API key',
      code: ErrorCodes.UNAUTHORIZED,
    });
  }

  next();
};

/**
 * Utility function to generate a guest user token
 */
export const generateGuestToken = (guestName: string, roomId: string) => {
  const guestPayload = {
    userId: `guest_${Date.now()}_${Math.random().toString(36).substring(7)}`,
    email: `guest_${Date.now()}@temp.com`,
    name: guestName,
    isGuest: true,
    roomId,
  };

  return jwtService.generateAccessToken(guestPayload);
};
