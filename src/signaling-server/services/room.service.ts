import { Server, Socket } from 'socket.io';
import { logger } from '../../shared/utils/logger';
import { 
  RoomState, 
  ParticipantConnection, 
  CallSettings,
  User,
  AppError,
  ErrorCodes 
} from '../../shared/types';
import { VideoCallModel } from '../../api-server/models/video-call.model';
import { UserModel } from '../../api-server/models/user.model';
import { jwtService } from '../../shared/utils/jwt';

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
   * Join a room
   */
  async joinRoom(socket: Socket, data: {
    roomId: string;
    token?: string;
    passcode?: string;
    guestName?: string;
  }): Promise<void> {
    try {
      const { roomId, token, passcode, guestName } = data;

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

      // Authenticate user if token provided
      let user: User | null = null;
      let isGuest = false;

      if (token) {
        try {
          const decoded = jwtService.verifyAccessToken(token);
          const dbUser = await UserModel.findById(decoded.userId);
          if (dbUser) {
            user = dbUser.toJSON();
          }
        } catch (error) {
          // Token invalid, treat as guest if allowed
          if (!guestName) {
            throw new AppError('Invalid token and no guest name provided', 401, ErrorCodes.UNAUTHORIZED);
          }
        }
      }

      // Handle guest users
      if (!user && guestName) {
        if (call.type === 'invited_only') {
          throw new AppError('Guests not allowed in this call', 403, ErrorCodes.UNAUTHORIZED);
        }

        isGuest = true;
        const guestId = `guest_${Date.now()}_${Math.random().toString(36).substring(7)}`;
        user = {
          _id: guestId,
          name: guestName,
          email: `${guestId}@guest.temp`,
          avatar: `https://ui-avatars.com/api/?name=${encodeURIComponent(guestName)}&background=random`,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
      }

      if (!user) {
        throw new AppError('Authentication required', 401, ErrorCodes.UNAUTHORIZED);
      }

      // Check if user can join
      const canJoinResult = await call.canUserJoin(user._id);
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
          hostId: call.hostId._id.toString(),
          createdAt: new Date(),
          settings: call.settings,
        };
        this.rooms.set(roomId, room);
      }

      // Check if participant already exists in room
      let participant = Array.from(room.participants.values()).find(p => p.userId === user!._id);
      
      if (participant) {
        // Update existing participant's socket
        participant.socketId = socket.id;
        participant.isConnected = true;
      } else {
        // Create new participant
        const peerId = `peer_${user._id}_${Date.now()}`;
        participant = {
          userId: user._id,
          socketId: socket.id,
          peerId,
          user,
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
      this.socketToUser.set(socket.id, user._id);

      // Join Socket.IO room
      await socket.join(roomId);

      // Update call in database if not guest
      if (!isGuest) {
        try {
          const existingParticipant = call.participants.find(p => 
            p.userId._id.toString() === user!._id
          );

          if (!existingParticipant) {
            await call.addParticipant(user._id, 'participant');
          } else {
            await call.updateParticipantStatus(user._id, true, socket.id);
          }

          // Start call if in waiting status
          if (call.status === 'waiting') {
            await call.startCall();
          }
        } catch (error) {
          logger.error('Error updating call in database:', error);
        }
      }

      // Get list of other participants for the joining user
      const otherParticipants = Array.from(room.participants.values())
        .filter(p => p.peerId !== participant!.peerId && p.isConnected);

      // Notify joining user
      socket.emit('room:joined', {
        roomId,
        user: participant.user,
        participants: otherParticipants,
        settings: room.settings,
        isHost: user._id === room.hostId,
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
        userId: user._id,
        userName: user.name,
        isGuest,
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
