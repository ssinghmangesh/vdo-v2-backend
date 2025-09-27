import * as mediasoup from 'mediasoup';
import { Server as SocketIOServer, Socket } from 'socket.io';
import { logger } from '../../shared/utils/logger';
import { 
  RoomState, 
  ParticipantConnection,
  ServerToClientEvents, 
  ClientToServerEvents 
} from '../../shared/types';

export interface SFUParticipant extends ParticipantConnection {
  transport?: mediasoup.types.WebRtcTransport;
  producer?: mediasoup.types.Producer;
  consumers: Map<string, mediasoup.types.Consumer>;
}

export interface SFURoom {
  roomId: string;
  router: mediasoup.types.Router;
  participants: Map<string, SFUParticipant>;
  createdAt: Date;
}

export class SFUService {
  private worker: mediasoup.types.Worker | null = null;
  private rooms = new Map<string, SFURoom>();
  private socketToRoom = new Map<string, string>();

  constructor(private io: SocketIOServer<ClientToServerEvents, ServerToClientEvents>) {
    this.initializeWorker();
  }

  /**
   * Initialize mediasoup worker
   */
  private async initializeWorker(): Promise<void> {
    try {
      // Worker settings
      const workerSettings: mediasoup.types.WorkerSettings = {
        logLevel: process.env.NODE_ENV === 'development' ? 'debug' : 'warn',
        logTags: [
          'info',
          'ice',
          'dtls',
          'rtp',
          'srtp',
          'rtcp',
          'rtx',
          'bwe',
          'score',
          'simulcast',
          'svc'
        ],
        rtcMinPort: parseInt(process.env.MEDIASOUP_MIN_PORT || '40000'),
        rtcMaxPort: parseInt(process.env.MEDIASOUP_MAX_PORT || '49999'),
      };

      this.worker = await mediasoup.createWorker(workerSettings);

      this.worker.on('died', () => {
        logger.error('mediasoup Worker died, exiting in 2 seconds...');
        setTimeout(() => process.exit(1), 2000);
      });

      // Get worker resource usage every 10 seconds
      setInterval(async () => {
        const usage = await this.worker!.getResourceUsage();
        logger.debug('mediasoup Worker resource usage', usage);
      }, 10000);

      logger.info('mediasoup Worker created successfully');
    } catch (error) {
      logger.error('Failed to create mediasoup Worker:', error);
      throw error;
    }
  }

  /**
   * Get router RTP capabilities
   */
  async getRouterRtpCapabilities(roomId: string): Promise<mediasoup.types.RtpCapabilities> {
    const room = await this.getOrCreateRoom(roomId);
    return room.router.rtpCapabilities;
  }

  /**
   * Get or create a room with mediasoup router
   */
  private async getOrCreateRoom(roomId: string): Promise<SFURoom> {
    let room = this.rooms.get(roomId);
    
    if (!room) {
      if (!this.worker) {
        throw new Error('mediasoup Worker not initialized');
      }

      // Router settings
      const mediaCodecs: mediasoup.types.RtpCodecCapability[] = [
        {
          kind: 'audio',
          mimeType: 'audio/opus',
          clockRate: 48000,
          channels: 2,
        },
        {
          kind: 'video',
          mimeType: 'video/VP8',
          clockRate: 90000,
          parameters: {
            'x-google-start-bitrate': 1000,
          },
        },
        {
          kind: 'video',
          mimeType: 'video/VP9',
          clockRate: 90000,
          parameters: {
            'profile-id': 2,
            'x-google-start-bitrate': 1000,
          },
        },
        {
          kind: 'video',
          mimeType: 'video/h264',
          clockRate: 90000,
          parameters: {
            'packetization-mode': 1,
            'profile-level-id': '4d0032',
            'level-asymmetry-allowed': 1,
            'x-google-start-bitrate': 1000,
          },
        },
        {
          kind: 'video',
          mimeType: 'video/h264',
          clockRate: 90000,
          parameters: {
            'packetization-mode': 1,
            'profile-level-id': '42e01f',
            'level-asymmetry-allowed': 1,
            'x-google-start-bitrate': 1000,
          },
        },
      ];

      const router = await this.worker.createRouter({ mediaCodecs });

      room = {
        roomId,
        router,
        participants: new Map(),
        createdAt: new Date(),
      };

      this.rooms.set(roomId, room);
      logger.info('Created new SFU room', { roomId });
    }

    return room;
  }

  /**
   * Join SFU room
   */
  async joinRoom(socket: Socket, data: {
    roomId: string;
    rtpCapabilities: mediasoup.types.RtpCapabilities;
    participant: ParticipantConnection;
  }): Promise<void> {
    try {
      const { roomId, rtpCapabilities, participant } = data;
      const room = await this.getOrCreateRoom(roomId);

      // Create SFU participant
      const sfuParticipant: SFUParticipant = {
        ...participant,
        consumers: new Map(),
      };

      room.participants.set(participant.peerId, sfuParticipant);
      this.socketToRoom.set(socket.id, roomId);

      // Send router capabilities to client
      socket.emit('sfu:router-rtp-capabilities', {
        rtpCapabilities: room.router.rtpCapabilities,
      });

      logger.info('Participant joined SFU room', {
        roomId,
        peerId: participant.peerId,
        participantCount: room.participants.size,
      });

    } catch (error) {
      logger.error('Error joining SFU room:', error);
      socket.emit('error', { message: 'Failed to join SFU room' });
    }
  }

  /**
   * Create WebRTC transport
   */
  async createWebRtcTransport(socket: Socket, data: {
    direction: 'send' | 'recv';
  }): Promise<void> {
    try {
      const roomId = this.socketToRoom.get(socket.id);
      if (!roomId) {
        throw new Error('Socket not in any room');
      }

      const room = this.rooms.get(roomId);
      if (!room) {
        throw new Error('Room not found');
      }

      const participant = Array.from(room.participants.values())
        .find(p => p.socketId === socket.id);
      
      if (!participant) {
        throw new Error('Participant not found in SFU room');
      }

      // Transport options
      const transportOptions: mediasoup.types.WebRtcTransportOptions = {
        listenIps: [
          {
            ip: process.env.MEDIASOUP_LISTEN_IP || '127.0.0.1',
            announcedIp: process.env.MEDIASOUP_ANNOUNCED_IP || '127.0.0.1',
          },
        ],
        enableUdp: true,
        enableTcp: true,
        preferUdp: true,
      };

      const transport = await room.router.createWebRtcTransport(transportOptions);

      // Store transport reference
      participant.transport = transport;

      // Handle transport events
      transport.on('dtlsstatechange', (dtlsState) => {
        if (dtlsState === 'closed') {
          transport.close();
        }
      });

      transport.on('@close', () => {
        logger.debug('Transport closed', { 
          roomId, 
          peerId: participant.peerId,
          direction: data.direction 
        });
      });

      // Send transport parameters to client
      socket.emit('sfu:transport-created', {
        id: transport.id,
        iceParameters: transport.iceParameters,
        iceCandidates: transport.iceCandidates,
        dtlsParameters: transport.dtlsParameters,
        direction: data.direction,
      });

      logger.debug('WebRTC transport created', {
        roomId,
        peerId: participant.peerId,
        transportId: transport.id,
        direction: data.direction,
      });

    } catch (error) {
      logger.error('Error creating WebRTC transport:', error);
      socket.emit('error', { message: 'Failed to create transport' });
    }
  }

  /**
   * Connect transport
   */
  async connectTransport(socket: Socket, data: {
    dtlsParameters: mediasoup.types.DtlsParameters;
  }): Promise<void> {
    try {
      const roomId = this.socketToRoom.get(socket.id);
      if (!roomId) {
        throw new Error('Socket not in any room');
      }

      const room = this.rooms.get(roomId);
      const participant = room?.participants.get(
        Array.from(room.participants.values())
          .find(p => p.socketId === socket.id)?.peerId || ''
      );

      if (!participant?.transport) {
        throw new Error('Transport not found');
      }

      await participant.transport.connect({ dtlsParameters: data.dtlsParameters });

      socket.emit('sfu:transport-connected');

      logger.debug('Transport connected', {
        roomId,
        peerId: participant.peerId,
        transportId: participant.transport.id,
      });

    } catch (error) {
      logger.error('Error connecting transport:', error);
      socket.emit('error', { message: 'Failed to connect transport' });
    }
  }

  /**
   * Create producer (send media)
   */
  async produce(socket: Socket, data: {
    kind: mediasoup.types.MediaKind;
    rtpParameters: mediasoup.types.RtpParameters;
  }): Promise<void> {
    try {
      const roomId = this.socketToRoom.get(socket.id);
      if (!roomId) {
        throw new Error('Socket not in any room');
      }

      const room = this.rooms.get(roomId);
      const participant = room?.participants.get(
        Array.from(room.participants.values())
          .find(p => p.socketId === socket.id)?.peerId || ''
      );

      if (!participant?.transport) {
        throw new Error('Transport not found');
      }

      const producer = await participant.transport.produce({
        kind: data.kind,
        rtpParameters: data.rtpParameters,
      });

      participant.producer = producer;

      producer.on('transportclose', () => {
        logger.debug('Producer transport closed', {
          roomId,
          peerId: participant.peerId,
          producerId: producer.id,
        });
      });

      // Notify other participants about new producer
      const otherParticipants = Array.from(room.participants.values())
        .filter(p => p.peerId !== participant.peerId && p.socketId);

      otherParticipants.forEach(otherParticipant => {
        if (otherParticipant.socketId) {
          this.io.to(otherParticipant.socketId).emit('sfu:new-producer', {
            peerId: participant.peerId,
            producerId: producer.id,
            kind: data.kind,
          });
        }
      });

      socket.emit('sfu:producer-created', {
        id: producer.id,
      });

      logger.debug('Producer created', {
        roomId,
        peerId: participant.peerId,
        producerId: producer.id,
        kind: data.kind,
      });

    } catch (error) {
      logger.error('Error creating producer:', error);
      socket.emit('error', { message: 'Failed to create producer' });
    }
  }

  /**
   * Create consumer (receive media)
   */
  async consume(socket: Socket, data: {
    producerId: string;
    rtpCapabilities: mediasoup.types.RtpCapabilities;
  }): Promise<void> {
    try {
      const roomId = this.socketToRoom.get(socket.id);
      if (!roomId) {
        throw new Error('Socket not in any room');
      }

      const room = this.rooms.get(roomId);
      const participant = room?.participants.get(
        Array.from(room.participants.values())
          .find(p => p.socketId === socket.id)?.peerId || ''
      );

      if (!participant?.transport) {
        throw new Error('Transport not found');
      }

      // Find the producer
      const producerParticipant = Array.from(room.participants.values())
        .find(p => p.producer?.id === data.producerId);

      if (!producerParticipant?.producer) {
        throw new Error('Producer not found');
      }

      // Check if router can consume
      if (!room.router.canConsume({
        producerId: data.producerId,
        rtpCapabilities: data.rtpCapabilities,
      })) {
        throw new Error('Cannot consume this producer');
      }

      // Create consumer
      const consumer = await participant.transport.consume({
        producerId: data.producerId,
        rtpCapabilities: data.rtpCapabilities,
        paused: true, // Start paused
      });

      participant.consumers.set(consumer.id, consumer);

      consumer.on('transportclose', () => {
        logger.debug('Consumer transport closed', {
          roomId,
          peerId: participant.peerId,
          consumerId: consumer.id,
        });
      });

      consumer.on('producerclose', () => {
        logger.debug('Consumer producer closed', {
          roomId,
          peerId: participant.peerId,
          consumerId: consumer.id,
        });
        participant.consumers.delete(consumer.id);
        socket.emit('sfu:consumer-closed', {
          consumerId: consumer.id,
        });
      });

      socket.emit('sfu:consumer-created', {
        id: consumer.id,
        producerId: data.producerId,
        kind: consumer.kind,
        rtpParameters: consumer.rtpParameters,
        producerPeerId: producerParticipant.peerId,
      });

      logger.debug('Consumer created', {
        roomId,
        peerId: participant.peerId,
        consumerId: consumer.id,
        producerId: data.producerId,
        kind: consumer.kind,
      });

    } catch (error) {
      logger.error('Error creating consumer:', error);
      socket.emit('error', { message: 'Failed to create consumer' });
    }
  }

  /**
   * Resume consumer
   */
  async resumeConsumer(socket: Socket, data: { consumerId: string }): Promise<void> {
    try {
      const roomId = this.socketToRoom.get(socket.id);
      if (!roomId) {
        throw new Error('Socket not in any room');
      }

      const room = this.rooms.get(roomId);
      const participant = room?.participants.get(
        Array.from(room.participants.values())
          .find(p => p.socketId === socket.id)?.peerId || ''
      );

      const consumer = participant?.consumers.get(data.consumerId);
      if (!consumer) {
        throw new Error('Consumer not found');
      }

      await consumer.resume();

      socket.emit('sfu:consumer-resumed', {
        consumerId: data.consumerId,
      });

      logger.debug('Consumer resumed', {
        roomId,
        peerId: participant.peerId,
        consumerId: data.consumerId,
      });

    } catch (error) {
      logger.error('Error resuming consumer:', error);
      socket.emit('error', { message: 'Failed to resume consumer' });
    }
  }

  /**
   * Pause/resume producer
   */
  async pauseProducer(socket: Socket, data: { pause: boolean }): Promise<void> {
    try {
      const roomId = this.socketToRoom.get(socket.id);
      if (!roomId) {
        throw new Error('Socket not in any room');
      }

      const room = this.rooms.get(roomId);
      const participant = room?.participants.get(
        Array.from(room.participants.values())
          .find(p => p.socketId === socket.id)?.peerId || ''
      );

      if (!participant?.producer) {
        throw new Error('Producer not found');
      }

      if (data.pause) {
        await participant.producer.pause();
      } else {
        await participant.producer.resume();
      }

      socket.emit('sfu:producer-paused', {
        producerId: participant.producer.id,
        paused: data.pause,
      });

      logger.debug(`Producer ${data.pause ? 'paused' : 'resumed'}`, {
        roomId,
        peerId: participant.peerId,
        producerId: participant.producer.id,
      });

    } catch (error) {
      logger.error('Error pausing/resuming producer:', error);
      socket.emit('error', { message: 'Failed to pause/resume producer' });
    }
  }

  /**
   * Leave SFU room
   */
  async leaveRoom(socket: Socket): Promise<void> {
    try {
      const roomId = this.socketToRoom.get(socket.id);
      if (!roomId) return;

      const room = this.rooms.get(roomId);
      if (!room) return;

      const participant = Array.from(room.participants.values())
        .find(p => p.socketId === socket.id);
      
      if (!participant) return;

      // Close producer
      if (participant.producer) {
        participant.producer.close();
      }

      // Close consumers
      for (const consumer of participant.consumers.values()) {
        consumer.close();
      }

      // Close transport
      if (participant.transport) {
        participant.transport.close();
      }

      // Remove participant
      room.participants.delete(participant.peerId);
      this.socketToRoom.delete(socket.id);

      // Clean up empty room
      if (room.participants.size === 0) {
        room.router.close();
        this.rooms.delete(roomId);
        logger.info('SFU room cleaned up', { roomId });
      }

      logger.info('Participant left SFU room', {
        roomId,
        peerId: participant.peerId,
        remainingParticipants: room.participants.size,
      });

    } catch (error) {
      logger.error('Error leaving SFU room:', error);
    }
  }

  /**
   * Get SFU statistics
   */
  async getStats(): Promise<any> {
    const stats = {
      rooms: this.rooms.size,
      totalParticipants: Array.from(this.rooms.values())
        .reduce((total, room) => total + room.participants.size, 0),
      workerResourceUsage: this.worker ? await this.worker.getResourceUsage() : null,
      roomStats: Array.from(this.rooms.entries()).map(([roomId, room]) => ({
        roomId,
        participantCount: room.participants.size,
        createdAt: room.createdAt,
      })),
    };

    return stats;
  }

  /**
   * Close SFU service
   */
  async close(): Promise<void> {
    // Close all rooms
    for (const room of this.rooms.values()) {
      room.router.close();
    }
    this.rooms.clear();

    // Close worker
    if (this.worker) {
      this.worker.close();
    }

    logger.info('SFU service closed');
  }
}
