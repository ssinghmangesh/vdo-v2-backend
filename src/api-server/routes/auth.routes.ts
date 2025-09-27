import { Router } from 'express';
import {
  register,
  login,
  refreshToken,
  getProfile,
  updateProfile,
  changePassword,
  logout,
  validateToken,
  getUserStats,
} from '../controllers/auth.controller';
import { authenticate, authRateLimit } from '../middleware/auth.middleware';
import { validate } from '../../shared/utils/validation';
import {
  registerUserSchema,
  loginUserSchema,
  updateUserSchema,
  changePasswordSchema,
  refreshTokenSchema,
} from '../../shared/utils/validation';

const router = Router();

/**
 * @route   POST /api/auth/register
 * @desc    Register a new user
 * @access  Public
 */
router.post('/register', authRateLimit.check, validate(registerUserSchema), register);

/**
 * @route   POST /api/auth/login
 * @desc    Login user
 * @access  Public
 */
router.post('/login', authRateLimit.check, validate(loginUserSchema), login);

/**
 * @route   POST /api/auth/refresh
 * @desc    Refresh access token
 * @access  Public
 */
router.post('/refresh', validate(refreshTokenSchema), refreshToken);

/**
 * @route   POST /api/auth/logout
 * @desc    Logout user
 * @access  Private
 */
router.post('/logout', authenticate, logout);

/**
 * @route   GET /api/auth/validate
 * @desc    Validate token and return user info
 * @access  Private
 */
router.get('/validate', authenticate, validateToken);

/**
 * @route   GET /api/auth/profile
 * @desc    Get current user profile
 * @access  Private
 */
router.get('/profile', authenticate, getProfile);

/**
 * @route   PATCH /api/auth/profile
 * @desc    Update user profile
 * @access  Private
 */
router.patch('/profile', authenticate, validate(updateUserSchema), updateProfile);

/**
 * @route   POST /api/auth/change-password
 * @desc    Change user password
 * @access  Private
 */
router.post('/change-password', authenticate, validate(changePasswordSchema), changePassword);

/**
 * @route   GET /api/auth/stats
 * @desc    Get user statistics
 * @access  Private
 */
router.get('/stats', authenticate, getUserStats);

export default router;
