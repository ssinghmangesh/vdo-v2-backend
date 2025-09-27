import { Router } from 'express';
import {
  createCall,
  getCalls,
  getCallById,
  getCallByRoomId,
  updateCall,
  deleteCall,
  joinCall,
  endCall,
  getCallStats,
} from '../controllers/video-call.controller';
import { authenticate, optionalAuth } from '../middleware/auth.middleware';
import { validate } from '../../shared/utils/validation';
import {
  createCallSchema,
  updateCallSchema,
  getCallSchema,
  getCallByRoomIdSchema,
  deleteCallSchema,
  listCallsSchema,
  joinCallSchema,
} from '../../shared/utils/validation';

const router = Router();

/**
 * @route   POST /api/video-calls
 * @desc    Create a new video call
 * @access  Private
 */
router.post('/', authenticate, validate(createCallSchema), createCall);

/**
 * @route   GET /api/video-calls
 * @desc    Get all calls for authenticated user
 * @access  Private
 */
router.get('/', authenticate, validate(listCallsSchema), getCalls);

/**
 * @route   GET /api/video-calls/:id
 * @desc    Get a specific call by ID
 * @access  Private/Public (depends on call type)
 */
router.get('/:id', optionalAuth, validate(getCallSchema), getCallById);

/**
 * @route   GET /api/video-calls/room/:roomId
 * @desc    Get call by room ID (for joining)
 * @access  Public/Private (depends on call type)
 */
router.get('/room/:roomId', optionalAuth, validate(getCallByRoomIdSchema), getCallByRoomId);

/**
 * @route   PATCH /api/video-calls/:id
 * @desc    Update a call (host only)
 * @access  Private
 */
router.patch('/:id', authenticate, validate(updateCallSchema), updateCall);

/**
 * @route   PUT /api/video-calls/:id
 * @desc    Update a call (full update - host only)
 * @access  Private
 */
router.put('/:id', authenticate, validate(updateCallSchema), updateCall);

/**
 * @route   DELETE /api/video-calls/:id
 * @desc    Delete a call (host only)
 * @access  Private
 */
router.delete('/:id', authenticate, validate(deleteCallSchema), deleteCall);

/**
 * @route   POST /api/video-calls/join
 * @desc    Join a video call
 * @access  Public/Private (depends on call type)
 */
router.post('/join', optionalAuth, validate(joinCallSchema), joinCall);

/**
 * @route   POST /api/video-calls/:id/end
 * @desc    End a video call (host only)
 * @access  Private
 */
router.post('/:id/end', authenticate, endCall);

/**
 * @route   GET /api/video-calls/:id/stats
 * @desc    Get call statistics
 * @access  Private (host or participant)
 */
router.get('/:id/stats', authenticate, getCallStats);

export default router;
