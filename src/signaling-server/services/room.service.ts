import { Server, Socket } from 'socket.io';
import { logger } from '../../shared/utils/logger';
import { 
  RoomState, 
  ParticipantConnection, 
  CallSettings,
  User,
  AppError,
  ErrorCodes, 
  ParticipantRole
} from '../../shared/types';
import { VideoCallModel } from '../../api-server/models/video-call.model';

export class RoomService {
  private rooms = new Map<string, RoomState>();
  private socketToRoom = new Map<string, string>();
  private socketToUser = new Map<string, string>();

  constructor(private io: Server) {}

  /**
   * Get room by room ID
   */
  getRoom(roomId: string): RoomState | undefined {
    return this.rooms.get(roomId);
  }

  /**
   * Get all rooms
   */
  getAllRooms(): RoomState[] {
    return Array.from(this.rooms.values());
  }

  /**
   * Get room by socket ID
   */
  getRoomBySocket(socketId: string): RoomState | undefined {
    const roomId = this.socketToRoom.get(socketId);
    return roomId ? this.rooms.get(roomId) : undefined;
  }

  /**
   * Get participant by socket ID
   */
  getParticipantBySocket(socketId: string): ParticipantConnection | undefined {
    const room = this.getRoomBySocket(socketId);
    if (!room) return undefined;

    for (const [participantId, participant] of room.participants) {
      if (participant.socketId === socketId) {
        return participant;
      }
    }
    return undefined;
  }

  /**
   * Create a new room
   */
  async createRoom(socket: Socket, data: any): Promise<void> {
    try {
      // Get user from authenticated socket data
      const authenticatedUser = socket.data.user;

      console.log('👤 Creating room for user:', { 
        userId: authenticatedUser._id, 
        email: authenticatedUser.email,
        name: authenticatedUser.name 
      });

      // Extract room data from frontend
      const { 
        name: title, 
        isPrivate, 
        maxParticipants = 10,
        id: frontendRoomId,
        status 
      } = data;

      let userInfo = {
        _id: authenticatedUser._id,
        name: authenticatedUser.name,
        email: authenticatedUser.email,
        createdAt: new Date(),
        updatedAt: new Date()
      };

      // Use frontend-provided room ID or generate unique one
      const roomId = frontendRoomId || `room_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

      console.log('🏠 Creating room:', { roomId, title, maxParticipants, isPrivate });

      // Create call in database
      const call = new VideoCallModel({
        roomId,
        hostId: userInfo._id,
        title: title || `${userInfo.name}'s Meeting`,
        description: '',
        settings: {
          maxParticipants: maxParticipants || 10,
          allowGuests: !isPrivate,
          requireApproval: isPrivate || false,
          recordCall: false,
        },
        status,
        participants: [{
          userId: userInfo._id,
          joinedAt: new Date(),
          isActive: true,
          role: ParticipantRole.HOST,
        }],
      });

      await call.save();

      // Generate peer ID for host
      const peerId = `peer_${socket.id}_${Date.now()}`;

      // Create room state
      const room: RoomState = {
        roomId,
        callId: call._id.toString(),
        hostId: userInfo._id,
        participants: new Map(),
        settings: call.settings,
        createdAt: new Date(),
      };

      // Create host participant
      const hostParticipant: ParticipantConnection = {
        peerId,
        userId: userInfo._id,
        socketId: socket.id,
        user: userInfo,
        mediaState: {
          videoEnabled: true,
          audioEnabled: true,
          screenShareEnabled: false,
        },
        isConnected: true,
        joinedAt: new Date(),
      };

      // Add host to room
      room.participants.set(peerId, hostParticipant);

      // Store room and mappings
      this.rooms.set(roomId, room);
      this.socketToRoom.set(socket.id, roomId);
      this.socketToUser.set(socket.id, userInfo._id);

      // Join Socket.IO room
      await socket.join(roomId);

      console.log('✅ Room created successfully:', { roomId, hostId: userInfo._id });

      // Prepare room data for frontend (matching Room interface)
      const roomResponse = {
        id: roomId,
        name: title || `${userInfo.name}'s Meeting`,
        participants: [userInfo],
        createdAt: new Date(),
        hostId: userInfo._id,
        isPrivate: isPrivate || false,
        maxParticipants: maxParticipants || 10,
      };

      // Notify host that room was created
      socket.emit('room:created', roomResponse);

      logger.info('Room created successfully', {
        roomId,
        callId: call._id.toString(),
        hostId: userInfo._id,
        hostName: userInfo.name,
        title: title || `${userInfo.name}'s Meeting`,
        isPrivate: isPrivate || false,
        maxParticipants: maxParticipants || 10,
      });

    } catch (error) {
      console.error('❌ Error creating room:', error);
      logger.error('Error creating room:', error);
      
      if (error instanceof AppError) {
        socket.emit('error', {
          message: error.message,
          code: error.code,
        });
      } else {
        socket.emit('error', {
          message: 'Failed to create room',
          code: ErrorCodes.INTERNAL_ERROR,
        });
      }
    }
  }

  /**
   * Join a room
   */
  async joinRoom(socket: Socket, data: {
    roomId: string;
    passcode?: string;
  }): Promise<void> {
    try {
      // Get user from authenticated socket data
      const authenticatedUser = socket.data.user;

      console.log('👤 User joining room:', { 
        userId: authenticatedUser._id, 
        email: authenticatedUser.email,
        name: authenticatedUser.name,
        roomId: data.roomId
      });

      const { roomId, passcode } = data;

      // Find the call in database
      const call = await VideoCallModel.findOne({ roomId })
        .populate('hostId', 'name email avatar')
        .populate('participants.userId', 'name email avatar');

      if (!call) {
        throw new AppError('Room not found', 404, ErrorCodes.ROOM_NOT_FOUND);
      }

      // Verify passcode if required
      if (call.passcode && call.passcode !== passcode) {
        throw new AppError('Invalid passcode', 401, ErrorCodes.INVALID_PASSCODE);
      }

      // Use authenticated user info
      const userInfo = {
        _id: authenticatedUser._id,
        name: authenticatedUser.name,
        email: authenticatedUser.email,
        createdAt: new Date(),
        updatedAt: new Date()
      };

      // Check if user can join
      const canJoinResult = await call.canUserJoin(userInfo._id);
      if (!canJoinResult.canJoin) {
        throw new AppError(canJoinResult.reason || 'Cannot join room', 403, ErrorCodes.ROOM_FULL);
      }

      // Check if user is already in another room
      const existingRoomId = this.socketToRoom.get(socket.id);
      if (existingRoomId) {
        await this.leaveRoom(socket, existingRoomId);
      }

      // Get or create room state
      let room = this.rooms.get(roomId);
      if (!room) {
        room = {
          roomId,
          callId: call._id.toString(),
          participants: new Map(),
          hostId: call.hostId.toString(),
          createdAt: new Date(),
          settings: call.settings,
        };
        this.rooms.set(roomId, room);
      }

      // Check if participant already exists in room
      let participant = Array.from(room.participants.values()).find(p => p.userId === userInfo._id);
      
      if (participant) {
        // Update existing participant's socket
        participant.socketId = socket.id;
        participant.isConnected = true;
      } else {
        // Create new participant
        const peerId = `peer_${userInfo._id}_${Date.now()}`;
        participant = {
          userId: userInfo._id,
          socketId: socket.id,
          peerId,
          user: userInfo,
          joinedAt: new Date(),
          isConnected: true,
          mediaState: {
            videoEnabled: room.settings.videoEnabled,
            audioEnabled: room.settings.audioEnabled,
            screenShareEnabled: false,
          },
        };
        room.participants.set(participant.peerId, participant);
      }

      // Update socket mappings
      this.socketToRoom.set(socket.id, roomId);
      this.socketToUser.set(socket.id, userInfo._id);

      // Join Socket.IO room
      await socket.join(roomId);

      // Update call in database
      try {
        const existingParticipant = call.participants.find(p => 
          p.userId.toString() === userInfo._id
        );

        if (!existingParticipant) {
          await call.addParticipant(userInfo._id, ParticipantRole.PARTICIPANT);
        } else {
          await call.updateParticipantStatus(userInfo._id, true, socket.id);
        }

        // Start call if in waiting status
        if (call.status === 'waiting') {
          await call.startCall();
        }
      } catch (error) {
        logger.error('Error updating call in database:', error);
      }

      // Notify joining user
      socket.emit('room:joined', {
        roomId,
        user: participant.user,
        participants: Array.from(room.participants.values()),
        settings: room.settings,
        isHost: userInfo._id === room.hostId,
      });

      // Notify other participants
      socket.to(roomId).emit('room:user-joined', {
        user: participant.user,
        participant: {
          peerId: participant.peerId,
          userId: participant.userId,
          user: participant.user,
          mediaState: participant.mediaState,
          isConnected: participant.isConnected,
          joinedAt: participant.joinedAt,
        },
      });

      logger.info('User joined room', {
        roomId,
        userId: userInfo._id,
        userName: userInfo.name,
        participantCount: room.participants.size,
      });

    } catch (error) {
      logger.error('Error joining room:', error);
      
      if (error instanceof AppError) {
        socket.emit('error', {
          message: error.message,
          code: error.code,
        });
      } else {
        socket.emit('error', {
          message: 'Failed to join room',
          code: ErrorCodes.INTERNAL_ERROR,
        });
      }
    }
  }

  /**
   * Leave a room
   */
  async leaveRoom(socket: Socket, roomId?: string): Promise<void> {
    try {
      const targetRoomId = roomId || this.socketToRoom.get(socket.id);
      if (!targetRoomId) return;

      const room = this.rooms.get(targetRoomId);
      if (!room) return;

      const participant = this.getParticipantBySocket(socket.id);
      if (!participant) return;

      // Mark participant as disconnected
      participant.isConnected = false;

      // Remove from socket mappings
      this.socketToRoom.delete(socket.id);
      this.socketToUser.delete(socket.id);

      // Leave Socket.IO room
      await socket.leave(targetRoomId);

      // Update database
      try {
        const call = await VideoCallModel.findOne({ roomId: targetRoomId });
        if (call && !participant.userId.startsWith('guest_')) {
          await call.updateParticipantStatus(participant.userId, false);
        }
      } catch (error) {
        logger.error('Error updating participant status in database:', error);
      }

      // Notify other participants
      socket.to(targetRoomId).emit('room:user-left', {
        userId: participant.userId,
        participant: {
          peerId: participant.peerId,
          userId: participant.userId,
          user: participant.user,
        },
      });

      // Remove participant from room if they've been disconnected for too long
      setTimeout(() => {
        const updatedRoom = this.rooms.get(targetRoomId);
        if (updatedRoom && updatedRoom.participants.has(participant.peerId)) {
          const p = updatedRoom.participants.get(participant.peerId);
          if (p && !p.isConnected) {
            updatedRoom.participants.delete(participant.peerId);
            
            // Clean up empty rooms
            if (updatedRoom.participants.size === 0) {
              this.rooms.delete(targetRoomId);
              logger.info('Room cleaned up', { roomId: targetRoomId });
            }
          }
        }
      }, 30000); // 30 seconds cleanup delay

      logger.info('User left room', {
        roomId: targetRoomId,
        userId: participant.userId,
        userName: participant.user.name,
        remainingParticipants: Array.from(room.participants.values()).filter(p => p.isConnected).length,
      });

    } catch (error) {
      logger.error('Error leaving room:', error);
    }
  }

  /**
   * Update participant media state
   */
  updateParticipantMediaState(
    socket: Socket, 
    mediaState: { videoEnabled: boolean; audioEnabled: boolean; screenShareEnabled: boolean }
  ): void {
    const participant = this.getParticipantBySocket(socket.id);
    const room = this.getRoomBySocket(socket.id);
    
    if (!participant || !room) return;

    // Update participant's media state
    participant.mediaState = { ...participant.mediaState, ...mediaState };

    // Broadcast to other participants
    socket.to(room.roomId).emit('participant:media-state-changed', {
      userId: participant.userId,
      peerId: participant.peerId,
      mediaState: participant.mediaState,
    });

    logger.debug('Participant media state updated', {
      roomId: room.roomId,
      userId: participant.userId,
      mediaState: participant.mediaState,
    });
  }

  /**
   * End a call (host only)
   */
  async endCall(socket: Socket): Promise<void> {
    try {
      const room = this.getRoomBySocket(socket.id);
      const participant = this.getParticipantBySocket(socket.id);

      if (!room || !participant) {
        socket.emit('error', { message: 'Room not found' });
        return;
      }

      // Check if user is host
      if (participant.userId !== room.hostId) {
        socket.emit('error', { message: 'Only host can end the call' });
        return;
      }

      // Update call in database
      try {
        const call = await VideoCallModel.findOne({ roomId: room.roomId });
        if (call) {
          await call.endCall();
        }
      } catch (error) {
        logger.error('Error ending call in database:', error);
      }

      // Notify all participants
      this.io.to(room.roomId).emit('room:call-ended', {
        roomId: room.roomId,
        reason: 'Host ended the call',
      });

      // Clean up room
      for (const [peerId, p] of room.participants) {
        if (p.socketId) {
          this.socketToRoom.delete(p.socketId);
          this.socketToUser.delete(p.socketId);
        }
      }
      this.rooms.delete(room.roomId);

      logger.info('Call ended by host', {
        roomId: room.roomId,
        hostId: participant.userId,
        participantCount: room.participants.size,
      });

    } catch (error) {
      logger.error('Error ending call:', error);
      socket.emit('error', { message: 'Failed to end call' });
    }
  }

  /**
   * Handle socket disconnection
   */
  async handleDisconnect(socket: Socket): Promise<void> {
    try {
      const roomId = this.socketToRoom.get(socket.id);
      if (roomId) {
        await this.leaveRoom(socket, roomId);
      }
    } catch (error) {
      logger.error('Error handling disconnect:', error);
    }
  }

  /**
   * Get room statistics
   */
  getRoomStats(roomId: string): any {
    const room = this.rooms.get(roomId);
    if (!room) return null;

    const connectedParticipants = Array.from(room.participants.values())
      .filter(p => p.isConnected);

    return {
      roomId: room.roomId,
      callId: room.callId,
      hostId: room.hostId,
      totalParticipants: room.participants.size,
      connectedParticipants: connectedParticipants.length,
      createdAt: room.createdAt,
      participants: connectedParticipants.map(p => ({
        peerId: p.peerId,
        userId: p.userId,
        name: p.user.name,
        joinedAt: p.joinedAt,
        mediaState: p.mediaState,
      })),
    };
  }
}
