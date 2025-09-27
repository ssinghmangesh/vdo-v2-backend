import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import { config } from 'dotenv';
import mongoose from 'mongoose';
import { RoomService } from './services/room.service';

// Load environment variables
config();

const PORT = process.env.SIGNALING_PORT || 3002;
const NODE_ENV = process.env.NODE_ENV || 'development';

// Create HTTP server
const server = createServer();

// Initialize Socket.IO with CORS
const io = new SocketIOServer(server, {
  cors: {
    origin: process.env.ALLOWED_ORIGINS?.split(',') || [ 'http://localhost:3000',  'http://127.0.0.1:3000', 'http://localhost:4000'],
    methods: ['GET', 'POST'],
    credentials: true,
  },
  transports: ['websocket', 'polling'],
});

// Initialize services
const signalingService = new RoomService(io);

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
      participant.mediaState.audioEnabled = data.enabled;
    } else if (data.type === 'video') {
      participant.mediaState.videoEnabled = data.enabled;
    }

    // Notify other participants
    socket.to(roomId).emit('participant:media-changed', {
      participantId: participant.userId,
      type: data.type,
      enabled: data.enabled
    });

    console.log(`🎵 Media toggled:`, { 
      participantId: participant.userId, 
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
        id: participant.userId,
        name: participant.user.name,
        avatar: participant.user.avatar
      }
    };

    // Broadcast to all participants in room
    io.to(roomId).emit('chat:message', chatMessage);

    console.log(`💬 Chat message:`, { 
      roomId, 
      participantId: participant.userId, 
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
