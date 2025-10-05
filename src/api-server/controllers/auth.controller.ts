import { Request, Response } from 'express';
import { AppError, ErrorCodes, AuthResponse, User } from '../../shared/types';
import { UserModel } from '../models/user.model';
import { jwtService } from '../../shared/utils/jwt';
import { logger } from '../../shared/utils/logger';
import { asyncHandler } from '../middleware/error.middleware';
import { config } from 'dotenv';

// Load environment variables
config();

/**
 * Register a new user
 */
export const register = asyncHandler(async (req: Request, res: Response) => {
  const { name, email, password } = req.body;

  // Check if user already exists
  const existingUser = await UserModel.findOne({ email });
  if (existingUser) {
    throw new AppError('Email already registered', 409, ErrorCodes.VALIDATION_ERROR);
  }

  // Create new user
  const user = new UserModel({
    name,
    email,
    password,
  });

  await user.save();

  // Generate tokens
  const tokenPair = jwtService.generateTokenPair({
    userId: (user._id as any).toString(),
    email: user.email,
    name: user.name,
  });

  // Prepare response (exclude password)
  const userResponse: User = {
    id: user._id.toString(),
    name: user.name,
    email: user.email,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };

  logger.info('User registered successfully', { 
    userId: user._id, 
    email: user.email 
  });

  const response: AuthResponse = {
    user: userResponse,
    token: tokenPair.accessToken,
    expiresIn: jwtService.getAccessTokenExpiryDuration(),
  };

  res.status(201).json({
    success: true,
    message: 'User registered successfully',
    data: response,
  });
});

/**
 * Login user
 */
export const login = asyncHandler(async (req: Request, res: Response) => {
  const { email, password } = req.body;

  // Find user with password field
  const user = await UserModel.findOne({ email }).select('+password');
  if (!user) {
    throw new AppError('Invalid email or password', 401, ErrorCodes.INVALID_CREDENTIALS);
  }

  // Check password
  const isPasswordValid = await user.comparePassword(password);
  if (!isPasswordValid) {
    throw new AppError('Invalid email or password', 401, ErrorCodes.INVALID_CREDENTIALS);
  }

  // Generate tokens
  const tokenPair = jwtService.generateTokenPair({
    userId: (user._id as any).toString(),
    email: user.email,
    name: user.name,
  });

  // Prepare response (exclude password)
  const userResponse: User = {
    id: user._id.toString(),
    name: user.name,
    email: user.email,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };

  logger.info('User logged in successfully', { 
    userId: user._id, 
    email: user.email 
  });

  const response: AuthResponse = {
    user: userResponse,
    token: tokenPair.accessToken,
    expiresIn: jwtService.getAccessTokenExpiryDuration(),
  };

  res.json({
    success: true,
    message: 'Login successful',
    data: response,
  });
});

/**
 * Refresh access token
 */
export const refreshToken = asyncHandler(async (req: Request, res: Response) => {
  const { refreshToken } = req.body;

  if (!refreshToken) {
    throw new AppError('Refresh token required', 400, ErrorCodes.TOKEN_INVALID);
  }

  // Verify refresh token
  const decoded = jwtService.verifyRefreshToken(refreshToken);

  // Find user
  const user = await UserModel.findById(decoded.userId);
  if (!user) {
    throw new AppError('User not found', 401, ErrorCodes.UNAUTHORIZED);
  }

  // Generate new token pair
  const newTokenPair = jwtService.generateTokenPair({
    userId: (user._id as any).toString(),
    email: user.email,
    name: user.name,
  });

  logger.info('Token refreshed successfully', { userId: user._id });

  const response: AuthResponse = {
    user: {
      id: user._id.toString(),
      name: user.name,
      email: user.email,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    },
    token: newTokenPair.accessToken,
    expiresIn: jwtService.getAccessTokenExpiryDuration(),
  };

  res.json({
    success: true,
    message: 'Token refreshed successfully',
    data: response,
  });
});

/**
 * Get current user profile
 */
export const getProfile = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) {
    throw new AppError('User not authenticated', 401, ErrorCodes.UNAUTHORIZED);
  }

  // Fetch fresh user data
  const user = await UserModel.findById(req.user.id);
  if (!user) {
    throw new AppError('User not found', 404, 'USER_NOT_FOUND');
  }

  res.json({
    success: true,
    message: 'Profile retrieved successfully',
    data: {
      id: user._id.toString(),
      name: user.name,
      email: user.email,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    },
  });
});

/**
 * Update user profile
 */
export const updateProfile = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) {
    throw new AppError('User not authenticated', 401, ErrorCodes.UNAUTHORIZED);
  }

  const { name, email } = req.body;
  const userId = req.user.id;

  // Check if email is already taken by another user
  if (email && email !== req.user.email) {
    const existingUser = await UserModel.findOne({ 
      email, 
      _id: { $ne: userId } 
    });
    
    if (existingUser) {
      throw new AppError('Email already taken', 409, ErrorCodes.VALIDATION_ERROR);
    }
  }

  // Update user
  const updatedUser = await UserModel.findByIdAndUpdate(
    userId,
    { 
      ...(name && { name: name.trim() }),
      ...(email && { email: email.toLowerCase().trim() })
    },
    { 
      new: true, 
      runValidators: true 
    }
  );

  if (!updatedUser) {
    throw new AppError('User not found', 404, 'USER_NOT_FOUND');
  }

  logger.info('User profile updated', { 
    userId: updatedUser._id, 
    email: updatedUser.email 
  });

  res.json({
    success: true,
    message: 'Profile updated successfully',
    data: {
      id: updatedUser._id.toString(),
      name: updatedUser.name,
      email: updatedUser.email,
      createdAt: updatedUser.createdAt,
      updatedAt: updatedUser.updatedAt,
    },
  });
});

/**
 * Change user password
 */
export const changePassword = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) {
    throw new AppError('User not authenticated', 401, ErrorCodes.UNAUTHORIZED);
  }

  const { currentPassword, newPassword } = req.body;
  const userId = req.user.id;

  // Find user with password
  const user = await UserModel.findById(userId).select('+password');
  if (!user) {
    throw new AppError('User not found', 404, 'USER_NOT_FOUND');
  }

  // Verify current password
  const isCurrentPasswordValid = await user.comparePassword(currentPassword);
  if (!isCurrentPasswordValid) {
    throw new AppError('Current password is incorrect', 400, ErrorCodes.INVALID_CREDENTIALS);
  }

  // Update password
  user.password = newPassword;
  await user.save();

  logger.info('User password changed', { userId: user.id });

  res.json({
    success: true,
    message: 'Password changed successfully',
  });
});

/**
 * Logout user (invalidate token - this would require token blacklisting in production)
 */
export const logout = asyncHandler(async (req: Request, res: Response) => {
  // In a production app, you would add the token to a blacklist/cache
  // For now, we'll just return success as the client should remove the token
  
  if (req.user) {
    logger.info('User logged out', { userId: req.user.id });
  }

  res.json({
    success: true,
    message: 'Logged out successfully',
  });
});

/**
 * Validate token endpoint
 */
export const validateToken = asyncHandler(async (req: Request, res: Response) => {
  // This endpoint is protected by authenticate middleware
  // If we reach here, the token is valid
  
  if (!req.user) {
    throw new AppError('Token invalid', 401, ErrorCodes.TOKEN_INVALID);
  }

  res.json({
    success: true,
    message: 'Token is valid',
    data: {
      user: req.user,
      tokenExpiry: jwtService.getTokenExpiry(
        jwtService.extractTokenFromHeader(req.headers.authorization) || ''
      ),
    },
  });
});

/**
 * Get user stats (for dashboard)
 */
export const getUserStats = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) {
    throw new AppError('User not authenticated', 401, ErrorCodes.UNAUTHORIZED);
  }

  const userId = req.user.id;

  // Import VideoCallModel here to avoid circular dependency
  const { VideoCallModel } = await import('../models/video-call.model');

  // Get user call statistics
  const stats = await Promise.all([
    // Total calls hosted
    VideoCallModel.countDocuments({ hostId: userId }),
    
    // Total calls participated
    VideoCallModel.countDocuments({ 
      'participants.userId': userId,
      hostId: { $ne: userId }
    }),
    
    // Active calls
    VideoCallModel.countDocuments({
      $or: [
        { hostId: userId },
        { 'participants.userId': userId }
      ],
      status: { $in: ['live', 'waiting'] }
    }),
    
    // This month's calls
    VideoCallModel.countDocuments({
      $or: [
        { hostId: userId },
        { 'participants.userId': userId }
      ],
      createdAt: {
        $gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1)
      }
    })
  ]);

  const [totalHosted, totalParticipated, activeCalls, thisMonthCalls] = stats;

  res.json({
    success: true,
    data: {
      totalHosted,
      totalParticipated,
      totalCalls: totalHosted + totalParticipated,
      activeCalls,
      thisMonthCalls,
    },
  });
});
