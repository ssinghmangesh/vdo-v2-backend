import { Request, Response } from 'express';
import { AppError, ErrorCodes, CallStatus, CallType, ParticipantRole } from '../../shared/types';
import { VideoCallModel } from '../models/video-call.model';
import { UserModel } from '../models/user.model';
import { logger } from '../../shared/utils/logger';
import { asyncHandler } from '../middleware/error.middleware';
import mongoose from 'mongoose';

/**
 * Create a new video call
 */
export const createCall = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) {
    throw new AppError('User not authenticated', 401, ErrorCodes.UNAUTHORIZED);
  }

  const {
    title,
    description,
    scheduledAt,
    type,
    settings,
    maxParticipants,
    passcode,
    invitedUserIds,
  } = req.body;

  // Validate invited users if provided
  if (invitedUserIds && invitedUserIds.length > 0) {
    const existingUsers = await UserModel.find({
      _id: { $in: invitedUserIds }
    });

    if (existingUsers.length !== invitedUserIds.length) {
      throw new AppError('Some invited users do not exist', 400, ErrorCodes.VALIDATION_ERROR);
    }
  }

  // Create the call
  const callData = {
    title,
    description,
    hostId: req.user._id.toString(),
    scheduledAt: scheduledAt ? new Date(scheduledAt) : undefined,
    type: type || CallType.PUBLIC,
    settings: {
      videoEnabled: true,
      audioEnabled: true,
      screenShareEnabled: true,
      chatEnabled: true,
      waitingRoomEnabled: false,
      recordingEnabled: false,
      backgroundBlurEnabled: false,
      noiseReductionEnabled: true,
      allowParticipantScreenShare: true,
      allowParticipantUnmute: true,
      autoAdmitGuests: true,
      ...settings,
    },
    maxParticipants: maxParticipants || 100,
    passcode,
    status: scheduledAt ? CallStatus.SCHEDULED : CallStatus.WAITING,
  };

  const call = new VideoCallModel(callData);
  await call.save();

  // Add invited users as participants
  if (invitedUserIds && invitedUserIds.length > 0) {
    for (const userId of invitedUserIds) {
      await call.addParticipant(userId, ParticipantRole.PARTICIPANT);
    }
  }

  // Populate host and participant information
  await call.populate('hostId', 'name email avatar');
  await call.populate('participants.userId', 'name email avatar');

  logger.info('Video call created', {
    callId: call._id,
    hostId: req.user._id.toString(),
    title: call.title,
    type: call.type,
  });

  res.status(201).json({
    success: true,
    message: 'Video call created successfully',
    data: call.toJSON(),
  });
});

/**
 * Get all calls for the authenticated user
 */
export const getCalls = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) {
    throw new AppError('User not authenticated', 401, ErrorCodes.UNAUTHORIZED);
  }

  const {
    page = 1,
    limit = 10,
    status,
    type,
    search,
    sort = 'createdAt',
    order = 'desc',
    startDate,
    endDate,
  } = req.query;

  // Build query
  const query: any = {
    $or: [
      { hostId: req.user._id.toString() },
      { 'participants.userId': req.user._id.toString() }
    ]
  };

  // Add filters
  if (status) {
    query.status = status;
  }

  if (type) {
    query.type = type;
  }

  if (search) {
    query.$and = [
      query.$and || [],
      {
        $or: [
          { title: { $regex: search, $options: 'i' } },
          { description: { $regex: search, $options: 'i' } }
        ]
      }
    ].filter(Boolean);
  }

  if (startDate || endDate) {
    query.createdAt = {};
    if (startDate) {
      query.createdAt.$gte = new Date(startDate as string);
    }
    if (endDate) {
      query.createdAt.$lte = new Date(endDate as string);
    }
  }

  // Build sort object
  const sortObj: any = {};
  sortObj[sort as string] = order === 'asc' ? 1 : -1;

  // Execute query with pagination
  const skip = (Number(page) - 1) * Number(limit);

  const [calls, totalCount] = await Promise.all([
    VideoCallModel.find(query)
      .populate('hostId', 'name email avatar')
      .populate('participants.userId', 'name email avatar')
      .sort(sortObj)
      .skip(skip)
      .limit(Number(limit)),
    VideoCallModel.countDocuments(query),
  ]);

  const totalPages = Math.ceil(totalCount / Number(limit));

  res.json({
    success: true,
    message: 'Calls retrieved successfully',
    data: calls.map(call => call.toJSON()),
    pagination: {
      page: Number(page),
      limit: Number(limit),
      total: totalCount,
      pages: totalPages,
    },
  });
});

/**
 * Get a specific call by ID
 */
export const getCallById = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new AppError('Invalid call ID', 400, ErrorCodes.INVALID_INPUT);
  }

  const call = await VideoCallModel.findById(id)
    .populate('hostId', 'name email avatar')
    .populate('participants.userId', 'name email avatar');

  if (!call) {
    throw new AppError('Call not found', 404, ErrorCodes.CALL_NOT_FOUND);
  }

  // Check if user has access to this call
  if (req.user) {
    const hasAccess = (call.hostId as any).toString() === req.user._id.toString() ||
      call.participants.some(p => (p.userId as any).toString() === req.user._id.toString());

    if (!hasAccess && call.type !== CallType.PUBLIC) {
      throw new AppError('Access denied', 403, ErrorCodes.UNAUTHORIZED);
    }
  }

  res.json({
    success: true,
    message: 'Call retrieved successfully',
    data: call.toJSON(),
  });
});

/**
 * Get a call by room ID (for joining)
 */
export const getCallByRoomId = asyncHandler(async (req: Request, res: Response) => {
  const { roomId } = req.params;

  const call = await VideoCallModel.findOne({ roomId })
    .populate('hostId', 'name email avatar')
    .populate('participants.userId', 'name email avatar');

  if (!call) {
    throw new AppError('Room not found', 404, ErrorCodes.ROOM_NOT_FOUND);
  }

  // For public calls, return basic info without authentication
  // For private calls, check access
  if (call.type !== CallType.PUBLIC) {
    if (!req.user) {
      // Return limited info for unauthenticated users
      return res.json({
        success: true,
        message: 'Room found',
        data: {
          _id: call._id,
          title: call.title,
          type: call.type,
          requiresAuth: true,
          requiresPasscode: !!call.passcode,
          maxParticipants: call.maxParticipants,
          currentParticipants: call.participants.filter(p => !p.leftAt).length,
        },
      });
    }

    const hasAccess = (call.hostId as any).toString() === req.user._id.toString() ||
      call.participants.some(p => (p.userId as any).toString() === req.user._id.toString());

    if (!hasAccess && call.type === CallType.INVITED_ONLY) {
      throw new AppError('You are not invited to this call', 403, ErrorCodes.UNAUTHORIZED);
    }
  }

  res.json({
    success: true,
    message: 'Room found',
    data: call.toJSON(),
  });
});

/**
 * Update a call
 */
export const updateCall = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) {
    throw new AppError('User not authenticated', 401, ErrorCodes.UNAUTHORIZED);
  }

  const { id } = req.params;
  const updateData = req.body;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new AppError('Invalid call ID', 400, ErrorCodes.INVALID_INPUT);
  }

  const call = await VideoCallModel.findById(id);
  if (!call) {
    throw new AppError('Call not found', 404, ErrorCodes.CALL_NOT_FOUND);
  }

  // Check if user is the host
  if (call.hostId.toString() !== req.user._id.toString().toString()) {
    throw new AppError('Only the host can update the call', 403, ErrorCodes.HOST_REQUIRED);
  }

  // Prevent updating ended calls
  if (call.status === CallStatus.ENDED) {
    throw new AppError('Cannot update ended call', 400, ErrorCodes.CALL_ENDED);
  }

  // Update the call
  const updatedCall = await VideoCallModel.findByIdAndUpdate(
    id,
    {
      ...updateData,
      ...(updateData.scheduledAt && { scheduledAt: new Date(updateData.scheduledAt) })
    },
    { new: true, runValidators: true }
  ).populate('hostId', 'name email avatar')
   .populate('participants.userId', 'name email avatar');

  logger.info('Video call updated', {
    callId: updatedCall!._id,
    hostId: req.user._id.toString(),
    changes: Object.keys(updateData),
  });

  res.json({
    success: true,
    message: 'Call updated successfully',
    data: updatedCall!.toJSON(),
  });
});

/**
 * Delete a call
 */
export const deleteCall = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) {
    throw new AppError('User not authenticated', 401, ErrorCodes.UNAUTHORIZED);
  }

  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new AppError('Invalid call ID', 400, ErrorCodes.INVALID_INPUT);
  }

  const call = await VideoCallModel.findById(id);
  if (!call) {
    throw new AppError('Call not found', 404, ErrorCodes.CALL_NOT_FOUND);
  }

  // Check if user is the host
  if (call.hostId.toString() !== req.user._id.toString().toString()) {
    throw new AppError('Only the host can delete the call', 403, ErrorCodes.HOST_REQUIRED);
  }

  // If call is live, end it first
  if (call.status === CallStatus.LIVE) {
    await call.endCall();
  }

  await VideoCallModel.findByIdAndDelete(id);

  logger.info('Video call deleted', {
    callId: id,
    hostId: req.user._id.toString(),
    title: call.title,
  });

  res.json({
    success: true,
    message: 'Call deleted successfully',
  });
});

/**
 * Join a call
 */
export const joinCall = asyncHandler(async (req: Request, res: Response) => {
  const { roomId, passcode, guestName } = req.body;

  const call = await VideoCallModel.findOne({ roomId })
    .populate('hostId', 'name email avatar')
    .populate('participants.userId', 'name email avatar');

  if (!call) {
    throw new AppError('Room not found', 404, ErrorCodes.ROOM_NOT_FOUND);
  }

  // Check if passcode is required and valid
  if (call.passcode && call.passcode !== passcode) {
    throw new AppError('Invalid passcode', 401, ErrorCodes.INVALID_PASSCODE);
  }

  let userId = req.user?._id;
  let userInfo = req.user;

  // Handle guest users
  if (!req.user) {
    if (call.type === CallType.INVITED_ONLY) {
      throw new AppError('Authentication required for this call', 401, ErrorCodes.UNAUTHORIZED);
    }

    if (!guestName) {
      throw new AppError('Guest name is required', 400, ErrorCodes.VALIDATION_ERROR);
    }

    // For guests, we'll use a temporary user ID
    userId = `guest_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    userInfo = {
      _id: userId,
      name: guestName,
      email: `${userId}@guest.temp`,
      avatar: `https://ui-avatars.com/api/?name=${guestName}&background=random`,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }

  // Check if user can join
  const canJoinResult = await call.canUserJoin(userId);
  if (!canJoinResult.canJoin) {
    throw new AppError(canJoinResult.reason || 'Cannot join call', 403, ErrorCodes.UNAUTHORIZED);
  }

  // Add user as participant if not already
  if (req.user) {
    const existingParticipant = call.participants.find(p => 
      p.userId._id.toString() === req.user!._id
    );

    if (!existingParticipant) {
      await call.addParticipant(req.user._id.toString(), ParticipantRole.PARTICIPANT);
      await call.populate('participants.userId', 'name email avatar');
    }
  }

  // Start call if it's in waiting status
  if (call.status === CallStatus.WAITING) {
    await call.startCall();
  }

  logger.info('User joined call', {
    callId: call._id,
    userId: userId,
    roomId: call.roomId,
    isGuest: !req.user,
  });

  res.json({
    success: true,
    message: 'Joined call successfully',
    data: {
      call: call.toJSON(),
      user: userInfo,
      isGuest: !req.user,
    },
  });
});

/**
 * End a call
 */
export const endCall = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) {
    throw new AppError('User not authenticated', 401, ErrorCodes.UNAUTHORIZED);
  }

  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new AppError('Invalid call ID', 400, ErrorCodes.INVALID_INPUT);
  }

  const call = await VideoCallModel.findById(id);
  if (!call) {
    throw new AppError('Call not found', 404, ErrorCodes.CALL_NOT_FOUND);
  }

  // Check if user is the host
  if (call.hostId.toString() !== req.user._id.toString().toString()) {
    throw new AppError('Only the host can end the call', 403, ErrorCodes.HOST_REQUIRED);
  }

  await call.endCall();

  logger.info('Video call ended', {
    callId: call._id,
    hostId: req.user._id.toString(),
    duration: call.getDuration(),
  });

  res.json({
    success: true,
    message: 'Call ended successfully',
    data: {
      duration: call.getDuration(),
      endedAt: call.endedAt,
    },
  });
});

/**
 * Get call statistics
 */
export const getCallStats = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) {
    throw new AppError('User not authenticated', 401, ErrorCodes.UNAUTHORIZED);
  }

  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new AppError('Invalid call ID', 400, ErrorCodes.INVALID_INPUT);
  }

  const call = await VideoCallModel.findById(id)
    .populate('hostId', 'name email avatar')
    .populate('participants.userId', 'name email avatar');

  if (!call) {
    throw new AppError('Call not found', 404, ErrorCodes.CALL_NOT_FOUND);
  }

  // Check if user has access
  const hasAccess = call.hostId._id.toString() === req.user._id.toString() ||
    call.participants.some(p => p.userId._id.toString() === req.user._id.toString());

  if (!hasAccess) {
    throw new AppError('Access denied', 403, ErrorCodes.UNAUTHORIZED);
  }

  // Calculate statistics
  const stats = {
    duration: call.getDuration(),
    totalParticipants: call.participants.length,
    maxConcurrentParticipants: call.participants.filter(p => !p.leftAt).length,
    participantStats: call.participants.map(p => ({
      user: p.userId,
      role: p.role,
      joinedAt: p.joinedAt,
      leftAt: p.leftAt,
      duration: p.leftAt 
        ? Math.round((p.leftAt.getTime() - p.joinedAt.getTime()) / (1000 * 60))
        : call.status === 'live' 
          ? Math.round((Date.now() - p.joinedAt.getTime()) / (1000 * 60))
          : 0,
    })),
    callTimeline: {
      created: call.createdAt,
      scheduled: call.scheduledAt,
      started: call.startedAt,
      ended: call.endedAt,
    },
  };

  res.json({
    success: true,
    message: 'Call statistics retrieved successfully',
    data: stats,
  });
});
