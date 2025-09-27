import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import cors from 'cors';
import { config } from 'dotenv';
import { database } from '../shared/config/database';
import { logger } from '../shared/utils/logger';
import { RoomService } from './services/room.service';
import { WebRTCService } from './services/webrtc.service';
import { SFUService } from '../sfu-server/services/sfu.service';
import {
  ClientToServerEvents,
  ServerToClientEvents,
} from '../shared/types';

// Load environment variables
config();

const PORT = process.env.SIGNALING_PORT || 3002;
const NODE_ENV = process.env.NODE_ENV || 'development';

// Create HTTP server
const httpServer = createServer();

// Configure CORS for Socket.IO
const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',') || [
  'http://localhost:3000',
  'http://127.0.0.1:3000',
];

// Create Socket.IO server
const io = new SocketIOServer<ClientToServerEvents, ServerToClientEvents>(httpServer, {
  cors: {
    origin: allowedOrigins,
    methods: ['GET', 'POST'],
    credentials: true,
  },
  transports: ['websocket', 'polling'],
  pingTimeout: 60000,
  pingInterval: 25000,
  upgradeTimeout: 30000,
  maxHttpBufferSize: 1e6, // 1MB
  allowEIO3: true, // Allow Engine.IO v3 clients
});

// Initialize services
const roomService = new RoomService(io);
const webrtcService = new WebRTCService(io, roomService);
const sfuService = new SFUService(io);

/**
 * Socket.IO connection handler
 */
io.on('connection', (socket) => {
  logger.info('Client connected', {
    socketId: socket.id,
    remoteAddress: socket.handshake.address,
    userAgent: socket.handshake.headers['user-agent'],
  });

  // Send ICE servers configuration immediately
  webrtcService.sendIceServers(socket);

  /**
   * Room Management Events
   */
  socket.on('room:join', async (data) => {
    logger.debug('Room join request', { socketId: socket.id, data });
    await roomService.joinRoom(socket, data);
  });

  socket.on('room:leave', async (data) => {
    logger.debug('Room leave request', { socketId: socket.id, data });
    await roomService.leaveRoom(socket, data.roomId);
  });

  socket.on('room:end-call', async (data) => {
    logger.debug('End call request', { socketId: socket.id, data });
    await roomService.endCall(socket);
  });

  /**
   * Participant Events
   */
  socket.on('participant:update-media-state', (data) => {
    logger.debug('Media state update', { socketId: socket.id, data });
    roomService.updateParticipantMediaState(socket, data);
  });

  /**
   * WebRTC Signaling Events
   */
  socket.on('webrtc:offer', (data) => {
    logger.debug('WebRTC offer', { socketId: socket.id, to: data.to });
    webrtcService.handleOffer(socket, data);
  });

  socket.on('webrtc:answer', (data) => {
    logger.debug('WebRTC answer', { socketId: socket.id, to: data.to });
    webrtcService.handleAnswer(socket, data);
  });

  socket.on('webrtc:ice-candidate', (data) => {
    logger.debug('ICE candidate', { socketId: socket.id, to: data.to });
    webrtcService.handleIceCandidate(socket, data);
  });

  /**
   * Additional WebRTC Events
   */
  socket.on('webrtc:connection-state', (data: { to: string; state: string }) => {
    webrtcService.handleConnectionStateChange(socket, data);
  });

  socket.on('webrtc:renegotiation-needed', (data: { to: string }) => {
    webrtcService.handleRenegotiationNeeded(socket, data);
  });

  socket.on('webrtc:data-channel', (data: { to?: string; message: any; type: string }) => {
    webrtcService.handleDataChannelMessage(socket, data);
  });

  socket.on('webrtc:screen-share', (data: { enabled: boolean; to?: string }) => {
    webrtcService.handleScreenShare(socket, data);
  });

  socket.on('webrtc:get-stats', (callback: (stats: any) => void) => {
    webrtcService.handleGetStats(socket, callback);
  });

  socket.on('webrtc:get-ice-servers', () => {
    webrtcService.sendIceServers(socket);
  });

  /**
   * SFU Events
   */
  socket.on('sfu:join-room', async (data) => {
    logger.debug('SFU join room request', { socketId: socket.id, data });
    await sfuService.joinRoom(socket, data);
  });

  socket.on('sfu:create-transport', async (data) => {
    logger.debug('SFU create transport request', { socketId: socket.id, data });
    await sfuService.createWebRtcTransport(socket, data);
  });

  socket.on('sfu:connect-transport', async (data) => {
    logger.debug('SFU connect transport request', { socketId: socket.id, data });
    await sfuService.connectTransport(socket, data);
  });

  socket.on('sfu:produce', async (data: { kind: 'audio' | 'video'; rtpParameters: any }) => {
    logger.debug('SFU produce request', { socketId: socket.id, data });
    await sfuService.produce(socket, data);
  });

  socket.on('sfu:consume', async (data) => {
    logger.debug('SFU consume request', { socketId: socket.id, data });
    await sfuService.consume(socket, data);
  });

  socket.on('sfu:resume-consumer', async (data) => {
    logger.debug('SFU resume consumer request', { socketId: socket.id, data });
    await sfuService.resumeConsumer(socket, data);
  });

  socket.on('sfu:pause-producer', async (data) => {
    logger.debug('SFU pause producer request', { socketId: socket.id, data });
    await sfuService.pauseProducer(socket, data);
  });

  /**
   * Chat and Messaging Events
   */
  socket.on('chat:message', (data: { message: string; to?: string }) => {
    const room = roomService.getRoomBySocket(socket.id);
    const participant = roomService.getParticipantBySocket(socket.id);

    if (room && participant) {
      const messageData = {
        id: Date.now().toString(),
        from: participant.peerId,
        fromUser: participant.user,
        message: data.message,
        timestamp: new Date().toISOString(),
        type: 'text',
      };

      if (data.to) {
        // Send to specific participant
        const toParticipant = Array.from(room.participants.values())
          .find(p => p.peerId === data.to);
        
        if (toParticipant && toParticipant.isConnected) {
          io.to(toParticipant.socketId).emit('chat:message', messageData);
        }
      } else {
        // Broadcast to all participants in room
        socket.to(room.roomId).emit('chat:message', messageData);
      }

      logger.debug('Chat message sent', {
        roomId: room.roomId,
        from: participant.peerId,
        to: data.to || 'broadcast',
      });
    }
  });

  socket.on('chat:typing', (data: { isTyping: boolean }) => {
    const room = roomService.getRoomBySocket(socket.id);
    const participant = roomService.getParticipantBySocket(socket.id);

    if (room && participant) {
      socket.to(room.roomId).emit('chat:typing', {
        from: participant.peerId,
        fromUser: participant.user,
        isTyping: data.isTyping,
      });
    }
  });

  /**
   * Admin/Debug Events
   */
  socket.on('admin:get-room-stats', (data: { roomId: string }, callback: (result: any) => void) => {
    try {
      const stats = roomService.getRoomStats(data.roomId);
      callback({ success: true, data: stats });
    } catch (error) {
      logger.error('Error getting room stats:', error);
      callback({ success: false, error: 'Failed to get room stats' });
    }
  });

  socket.on('admin:get-all-rooms', (callback: (result: any) => void) => {
    try {
      const rooms = roomService.getAllRooms().map(room => ({
        roomId: room.roomId,
        callId: room.callId,
        hostId: room.hostId,
        participantCount: room.participants.size,
        connectedCount: Array.from(room.participants.values()).filter(p => p.isConnected).length,
        createdAt: room.createdAt,
      }));
      callback({ success: true, data: rooms });
    } catch (error) {
      logger.error('Error getting all rooms:', error);
      callback({ success: false, error: 'Failed to get rooms' });
    }
  });

  /**
   * Connection Events
   */
  socket.on('disconnect', async (reason) => {
    logger.info('Client disconnected', {
      socketId: socket.id,
      reason,
      remoteAddress: socket.handshake.address,
    });

    await roomService.handleDisconnect(socket);
    await sfuService.leaveRoom(socket);
  });

  socket.on('connect_error' as any, (error: Error) => {
    logger.error('Socket connection error:', {
      socketId: socket.id,
      error: error.message,
      remoteAddress: socket.handshake.address,
    });
  });

  // Handle any other events
  socket.onAny((eventName, ...args) => {
    logger.debug('Unhandled socket event', {
      socketId: socket.id,
      eventName,
      args: args.length,
    });
  });
});

/**
 * Server health check and statistics
 */
setInterval(async () => {
  const sfuStats = await sfuService.getStats();
  const stats = {
    connectedClients: io.engine.clientsCount,
    activeRooms: roomService.getAllRooms().length,
    totalParticipants: roomService.getAllRooms().reduce(
      (total, room) => total + room.participants.size, 0
    ),
    sfu: sfuStats,
    uptime: process.uptime(),
    memory: process.memoryUsage(),
  };

  logger.debug('Signaling server stats', stats);
}, 60000); // Every minute

/**
 * Clean up inactive rooms periodically
 */
setInterval(() => {
  const rooms = roomService.getAllRooms();
  let cleanedRooms = 0;

  rooms.forEach(room => {
    const connectedParticipants = Array.from(room.participants.values())
      .filter(p => p.isConnected);

    if (connectedParticipants.length === 0) {
      // Check if room has been empty for more than 5 minutes
      const lastActivity = Math.max(
        ...Array.from(room.participants.values()).map(p => 
          p.joinedAt.getTime()
        )
      );

      if (Date.now() - lastActivity > 5 * 60 * 1000) {
        roomService.getAllRooms().splice(
          roomService.getAllRooms().indexOf(room), 1
        );
        cleanedRooms++;
      }
    }
  });

  if (cleanedRooms > 0) {
    logger.info(`Cleaned up ${cleanedRooms} inactive rooms`);
  }
}, 2 * 60 * 1000); // Every 2 minutes

/**
 * Error handling
 */
io.on('connect_error', (error) => {
  logger.error('Socket.IO connection error:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection in signaling server:', { reason, promise });
});

process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception in signaling server:', error);
  process.exit(1);
});

/**
 * Graceful shutdown
 */
const gracefulShutdown = () => {
  logger.info('Signaling server shutting down gracefully...');
  
  // Close SFU service
  sfuService.close().then(() => {
    logger.info('SFU service closed');
    
    // Close all socket connections
    io.close(() => {
      logger.info('All socket connections closed');
      
      // Close HTTP server
      httpServer.close(() => {
        logger.info('HTTP server closed');
        
        // Disconnect from database
        database.disconnect().then(() => {
          logger.info('Database connection closed');
          process.exit(0);
        }).catch((error) => {
          logger.error('Error closing database connection:', error);
          process.exit(1);
        });
      });
    });
  }).catch((error) => {
    logger.error('Error closing SFU service:', error);
    process.exit(1);
  });

  // Force shutdown after 15 seconds
  setTimeout(() => {
    logger.error('Force shutting down signaling server');
    process.exit(1);
  }, 15000);
};

process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

/**
 * Start server
 */
async function startServer() {
  try {
    // Connect to database
    logger.info('Connecting to database...');
    await database.connect();

    // Start HTTP server
    httpServer.listen(PORT, () => {
      logger.info(`🚀 Signaling Server started successfully!`);
      logger.info(`📍 Server running on port ${PORT}`);
      logger.info(`🌍 Environment: ${NODE_ENV}`);
      logger.info(`💾 Database: Connected`);
      logger.info(`🔌 Socket.IO: Ready for connections`);
      logger.info(`🔗 WebSocket Endpoint: ws://localhost:${PORT}`);
      
      if (NODE_ENV === 'development') {
        logger.info(`📚 Supported events:`);
        logger.info(`   room:join, room:leave, room:end-call`);
        logger.info(`   webrtc:offer, webrtc:answer, webrtc:ice-candidate`);
        logger.info(`   participant:update-media-state`);
        logger.info(`   chat:message, chat:typing`);
      }
    });

  } catch (error) {
    logger.error('Failed to start signaling server:', error);
    process.exit(1);
  }
}

// Start server if this file is run directly
if (require.main === module) {
  startServer().catch((error) => {
    logger.error('Signaling server startup failed:', error);
    process.exit(1);
  });
}

export { httpServer, io, startServer };
export default httpServer;
