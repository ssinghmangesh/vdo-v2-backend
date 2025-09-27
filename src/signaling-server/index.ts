import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import { config } from 'dotenv';
import mongoose from 'mongoose';

// Load environment variables
config();

const PORT = process.env.SIGNALING_PORT || 3002;
const NODE_ENV = process.env.NODE_ENV || 'development';

// Create HTTP server
const server = createServer();

// Initialize Socket.IO with CORS
const io = new SocketIOServer(server, {
  cors: {
    origin: process.env.ALLOWED_ORIGINS?.split(',') || [
      'http://localhost:3000', 
      'http://127.0.0.1:3000',
      'http://localhost:4000'
    ],
    methods: ['GET', 'POST'],
    credentials: true,
  },
  transports: ['websocket', 'polling'],
});

// Simple User Schema (for participant info)
const UserSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  avatar: { type: String, default: '' }
}, { timestamps: true });

const User = mongoose.model('User', UserSchema);

// In-memory room management
interface Participant {
  id: string;
  socketId: string;
  userId?: string;
  name: string;
  email?: string;
  avatar?: string;
  isConnected: boolean;
  joinedAt: Date;
  role: 'host' | 'participant';
  audioEnabled: boolean;
  videoEnabled: boolean;
}

interface Room {
  roomId: string;
  callId?: string;
  hostId: string;
  participants: Map<string, Participant>;
  createdAt: Date;
  isActive: boolean;
  settings: {
    enableVideo: boolean;
    enableAudio: boolean;
    enableChat: boolean;
    enableScreenShare: boolean;
    maxParticipants: number;
  };
}

class SignalingService {
  private rooms: Map<string, Room> = new Map();
  private socketToRoom: Map<string, string> = new Map();

  // Create or join a room
  async joinRoom(socket: any, data: {
    roomId: string;
    userId?: string;
    name: string;
    email?: string;
    isHost?: boolean;
  }) {
    try {
      const { roomId, userId, name, email, isHost = false } = data;

      console.log(`👤 User attempting to join room: ${roomId}`, { userId, name, isHost });

      let room = this.rooms.get(roomId);

      // Create room if it doesn't exist
      if (!room) {
        room = {
          roomId,
          hostId: userId || socket.id,
          participants: new Map(),
          createdAt: new Date(),
          isActive: true,
          settings: {
            enableVideo: true,
            enableAudio: true,
            enableChat: true,
            enableScreenShare: true,
            maxParticipants: 10
          }
        };
        this.rooms.set(roomId, room);
        console.log(`🏠 Created new room: ${roomId}`);
      }

      // Check room capacity
      if (room.participants.size >= room.settings.maxParticipants) {
        socket.emit('room:error', {
          success: false,
          message: 'Room is full',
          code: 'ROOM_FULL'
        });
        return;
      }

      // Get user info from database if userId provided
      let userInfo = { name, email, avatar: '' };
      if (userId) {
        try {
          const user = await User.findById(userId);
          if (user) {
            userInfo = {
              name: user.name,
              email: user.email,
              avatar: user.avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(user.name)}&background=random`
            };
          }
        } catch (error) {
          console.log('User not found in database, using provided info');
        }
      }

      // Create participant
      const participant: Participant = {
        id: userId || socket.id,
        socketId: socket.id,
        userId,
        name: userInfo.name,
        email: userInfo.email,
        avatar: userInfo.avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=random`,
        isConnected: true,
        joinedAt: new Date(),
        role: isHost || room.participants.size === 0 ? 'host' : 'participant',
        audioEnabled: true,
        videoEnabled: true
      };

      // Add participant to room
      room.participants.set(socket.id, participant);
      this.socketToRoom.set(socket.id, roomId);

      // Join Socket.IO room
      await socket.join(roomId);

      // Notify participant of successful join
      socket.emit('room:joined', {
        success: true,
        room: {
          roomId: room.roomId,
          hostId: room.hostId,
          participantCount: room.participants.size,
          settings: room.settings
        },
        participant,
        participants: Array.from(room.participants.values()).filter(p => p.socketId !== socket.id)
      });

      // Notify other participants
      socket.to(roomId).emit('participant:joined', {
        participant,
        participantCount: room.participants.size
      });

      console.log(`✅ User joined room successfully: ${roomId}`, { 
        participantId: participant.id, 
        totalParticipants: room.participants.size 
      });

    } catch (error) {
      console.error('Error joining room:', error);
      socket.emit('room:error', {
        success: false,
        message: 'Failed to join room',
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  // Handle participant leaving
  async leaveRoom(socket: any) {
    const roomId = this.socketToRoom.get(socket.id);
    if (!roomId) return;

    const room = this.rooms.get(roomId);
    if (!room) return;

    const participant = room.participants.get(socket.id);
    if (!participant) return;

    // Remove participant
    room.participants.delete(socket.id);
    this.socketToRoom.delete(socket.id);

    // Notify remaining participants
    socket.to(roomId).emit('participant:left', {
      participant,
      participantCount: room.participants.size
    });

    // Clean up empty room
    if (room.participants.size === 0) {
      this.rooms.delete(roomId);
      console.log(`🧹 Cleaned up empty room: ${roomId}`);
    } else {
      // If host left, assign new host
      if (participant.role === 'host') {
        const newHost = Array.from(room.participants.values())[0];
        if (newHost) {
          newHost.role = 'host';
          room.hostId = newHost.id;
          socket.to(roomId).emit('host:changed', { newHost });
          console.log(`👑 New host assigned: ${newHost.id}`);
        }
      }
    }

    console.log(`👋 Participant left room: ${roomId}`, { 
      participantId: participant.id,
      remainingParticipants: room.participants.size 
    });
  }

  // Get room stats
  getRoomStats(roomId: string) {
    const room = this.rooms.get(roomId);
    if (!room) return null;

    return {
      roomId: room.roomId,
      hostId: room.hostId,
      participantCount: room.participants.size,
      participants: Array.from(room.participants.values()),
      createdAt: room.createdAt,
      isActive: room.isActive,
      settings: room.settings
    };
  }

  // Get all rooms
  getAllRooms() {
    return Array.from(this.rooms.values()).map(room => ({
      roomId: room.roomId,
      hostId: room.hostId,
      participantCount: room.participants.size,
      createdAt: room.createdAt,
      isActive: room.isActive
    }));
  }
}

// Initialize services
const signalingService = new SignalingService();

// Socket.IO connection handling
io.on('connection', (socket) => {
  console.log(`🔌 Client connected: ${socket.id}`, {
    remoteAddress: socket.handshake.address,
    userAgent: socket.handshake.headers['user-agent']?.substring(0, 50)
  });

  /**
   * Room Management Events
   */
  socket.on('room:join', async (data) => {
    console.log('📥 Room join request:', { socketId: socket.id, data });
    await signalingService.joinRoom(socket, data);
  });

  socket.on('room:leave', async () => {
    console.log('📤 Room leave request:', { socketId: socket.id });
    await signalingService.leaveRoom(socket);
  });

  /**
   * WebRTC Signaling Events
   */
  socket.on('webrtc:offer', (data: { to: string; offer: any }) => {
    console.log('📡 WebRTC offer:', { from: socket.id, to: data.to });
    socket.to(data.to).emit('webrtc:offer', {
      from: socket.id,
      offer: data.offer
    });
  });

  socket.on('webrtc:answer', (data: { to: string; answer: any }) => {
    console.log('📡 WebRTC answer:', { from: socket.id, to: data.to });
    socket.to(data.to).emit('webrtc:answer', {
      from: socket.id,
      answer: data.answer
    });
  });

  socket.on('webrtc:ice-candidate', (data: { to: string; candidate: any }) => {
    console.log('🧊 ICE candidate:', { from: socket.id, to: data.to });
    socket.to(data.to).emit('webrtc:ice-candidate', {
      from: socket.id,
      candidate: data.candidate
    });
  });

  /**
   * Media Control Events
   */
  socket.on('media:toggle', (data: { type: 'audio' | 'video'; enabled: boolean }) => {
    const roomId = signalingService['socketToRoom'].get(socket.id);
    if (!roomId) return;

    const room = signalingService['rooms'].get(roomId);
    if (!room) return;

    const participant = room.participants.get(socket.id);
    if (!participant) return;

    // Update participant media state
    if (data.type === 'audio') {
      participant.audioEnabled = data.enabled;
    } else if (data.type === 'video') {
      participant.videoEnabled = data.enabled;
    }

    // Notify other participants
    socket.to(roomId).emit('participant:media-changed', {
      participantId: participant.id,
      type: data.type,
      enabled: data.enabled
    });

    console.log(`🎵 Media toggled:`, { 
      participantId: participant.id, 
      type: data.type, 
      enabled: data.enabled 
    });
  });

  /**
   * Chat Events
   */
  socket.on('chat:message', (data: { message: string; timestamp?: number }) => {
    const roomId = signalingService['socketToRoom'].get(socket.id);
    if (!roomId) return;

    const room = signalingService['rooms'].get(roomId);
    if (!room) return;

    const participant = room.participants.get(socket.id);
    if (!participant) return;

    const chatMessage = {
      id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      message: data.message,
      timestamp: data.timestamp || Date.now(),
      participant: {
        id: participant.id,
        name: participant.name,
        avatar: participant.avatar
      }
    };

    // Broadcast to all participants in room
    io.to(roomId).emit('chat:message', chatMessage);

    console.log(`💬 Chat message:`, { 
      roomId, 
      participantId: participant.id, 
      message: data.message.substring(0, 50) 
    });
  });

  /**
   * Admin/Debug Events
   */
  socket.on('admin:get-room-stats', (data: { roomId: string }, callback) => {
    try {
      const stats = signalingService.getRoomStats(data.roomId);
      callback({ success: true, data: stats });
    } catch (error) {
      console.error('Error getting room stats:', error);
      callback({ success: false, error: 'Failed to get room stats' });
    }
  });

  socket.on('admin:get-all-rooms', (callback) => {
    try {
      const rooms = signalingService.getAllRooms();
      callback({ success: true, data: rooms });
    } catch (error) {
      console.error('Error getting all rooms:', error);
      callback({ success: false, error: 'Failed to get rooms' });
    }
  });

  /**
   * Disconnect Event
   */
  socket.on('disconnect', async (reason) => {
    console.log('🔌 Client disconnected:', {
      socketId: socket.id,
      reason,
      remoteAddress: socket.handshake.address,
    });
    await signalingService.leaveRoom(socket);
  });

  socket.on('connect_error', (error: Error) => {
    console.error('🔌 Socket connection error:', {
      socketId: socket.id,
      error: error.message,
      remoteAddress: socket.handshake.address,
    });
  });
});

// Connect to database and start server
async function startSignalingServer() {
  try {
    // Connect to database (optional for signaling server)
    try {
      console.log('🔗 Connecting to database...');
      const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/videocall-db';
      await mongoose.connect(mongoUri);
      console.log('✅ Database connected successfully!');
    } catch (error) {
      console.log('⚠️  Database connection failed, continuing without DB:', (error as Error).message);
    }

    // Start server
    server.listen(PORT, () => {
      console.log('🚀 WebRTC Signaling Server started successfully!');
      console.log(`📍 Server running on http://localhost:${PORT}`);
      console.log(`🌍 Environment: ${NODE_ENV}`);
      console.log('📋 Available events:');
      console.log('  📨 room:join - Join a video call room');
      console.log('  📤 room:leave - Leave a video call room');
      console.log('  📡 webrtc:offer/answer/ice-candidate - WebRTC signaling');
      console.log('  🎵 media:toggle - Toggle audio/video');
      console.log('  💬 chat:message - Send chat messages');
      console.log('  📊 admin:get-room-stats - Get room statistics');
    });

    // Graceful shutdown
    process.on('SIGTERM', () => {
      console.log('SIGTERM received, shutting down gracefully');
      server.close(() => {
        mongoose.connection.close();
        process.exit(0);
      });
    });

  } catch (error) {
    console.error('❌ Signaling server startup failed:', error);
    process.exit(1);
  }
}

// Start server if this file is run directly
if (require.main === module) {
  console.log('🚀 Starting WebRTC Signaling Server...');
  startSignalingServer();
}

export { io, startSignalingServer };
