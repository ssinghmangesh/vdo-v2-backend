import { Server, Socket } from 'socket.io';
import { logger } from '../../shared/utils/logger';
import { RoomService } from './room.service';

export class WebRTCService {
  constructor(
    private io: Server,
    private roomService: RoomService
  ) {}

  /**
   * Handle WebRTC offer
   */
  handleOffer(socket: Socket, data: {
    to: string;
    offer: RTCSessionDescriptionInit;
  }): void {
    try {
      const { to, offer } = data;
      
      const room = this.roomService.getRoomBySocket(socket.id);
      const fromParticipant = this.roomService.getParticipantBySocket(socket.id);
      
      if (!room || !fromParticipant) {
        socket.emit('error', { message: 'Not in a room' });
        return;
      }

      // Find target participant
      const toParticipant = Array.from(room.participants.values())
        .find(p => p.peerId === to || p.userId === to);

      if (!toParticipant || !toParticipant.isConnected) {
        socket.emit('error', { message: 'Target participant not found or not connected' });
        return;
      }

      // Forward offer to target participant
      this.io.to(toParticipant.socketId).emit('webrtc:offer', {
        from: fromParticipant.peerId,
        to: toParticipant.peerId,
        offer,
        user: fromParticipant.user,
      });

      logger.debug('WebRTC offer forwarded', {
        roomId: room.roomId,
        from: fromParticipant.peerId,
        to: toParticipant.peerId,
      });

    } catch (error) {
      logger.error('Error handling WebRTC offer:', error);
      socket.emit('error', { message: 'Failed to send offer' });
    }
  }

  /**
   * Handle WebRTC answer
   */
  handleAnswer(socket: Socket, data: {
    to: string;
    answer: RTCSessionDescriptionInit;
  }): void {
    try {
      const { to, answer } = data;
      
      const room = this.roomService.getRoomBySocket(socket.id);
      const fromParticipant = this.roomService.getParticipantBySocket(socket.id);
      
      if (!room || !fromParticipant) {
        socket.emit('error', { message: 'Not in a room' });
        return;
      }

      // Find target participant
      const toParticipant = Array.from(room.participants.values())
        .find(p => p.peerId === to || p.userId === to);

      if (!toParticipant || !toParticipant.isConnected) {
        socket.emit('error', { message: 'Target participant not found or not connected' });
        return;
      }

      // Forward answer to target participant
      this.io.to(toParticipant.socketId).emit('webrtc:answer', {
        from: fromParticipant.peerId,
        to: toParticipant.peerId,
        answer,
      });

      logger.debug('WebRTC answer forwarded', {
        roomId: room.roomId,
        from: fromParticipant.peerId,
        to: toParticipant.peerId,
      });

    } catch (error) {
      logger.error('Error handling WebRTC answer:', error);
      socket.emit('error', { message: 'Failed to send answer' });
    }
  }

  /**
   * Handle ICE candidate
   */
  handleIceCandidate(socket: Socket, data: {
    to: string;
    candidate: RTCIceCandidateInit;
  }): void {
    try {
      const { to, candidate } = data;
      
      const room = this.roomService.getRoomBySocket(socket.id);
      const fromParticipant = this.roomService.getParticipantBySocket(socket.id);
      
      if (!room || !fromParticipant) {
        socket.emit('error', { message: 'Not in a room' });
        return;
      }

      // Find target participant
      const toParticipant = Array.from(room.participants.values())
        .find(p => p.peerId === to || p.userId === to);

      if (!toParticipant || !toParticipant.isConnected) {
        // Don't emit error for ICE candidates as they can be sent to disconnected peers
        logger.debug('ICE candidate target not found', {
          roomId: room.roomId,
          from: fromParticipant.peerId,
          to,
        });
        return;
      }

      // Forward ICE candidate to target participant
      this.io.to(toParticipant.socketId).emit('webrtc:ice-candidate', {
        from: fromParticipant.peerId,
        to: toParticipant.peerId,
        candidate,
      });

      logger.debug('ICE candidate forwarded', {
        roomId: room.roomId,
        from: fromParticipant.peerId,
        to: toParticipant.peerId,
      });

    } catch (error) {
      logger.error('Error handling ICE candidate:', error);
      // Don't emit error for ICE candidates to avoid noise
    }
  }

  /**
   * Handle connection state change
   */
  handleConnectionStateChange(socket: Socket, data: {
    to: string;
    state: RTCPeerConnectionState;
  }): void {
    try {
      const { to, state } = data;
      
      const room = this.roomService.getRoomBySocket(socket.id);
      const fromParticipant = this.roomService.getParticipantBySocket(socket.id);
      
      if (!room || !fromParticipant) {
        return;
      }

      logger.debug('Peer connection state changed', {
        roomId: room.roomId,
        from: fromParticipant.peerId,
        to,
        state,
      });

      // Handle connection failure
      if (state === 'failed' || state === 'disconnected') {
        // Notify other participant about connection issues
        const toParticipant = Array.from(room.participants.values())
          .find(p => p.peerId === to);

        if (toParticipant && toParticipant.isConnected) {
          this.io.to(toParticipant.socketId).emit('webrtc:connection-state', {
            from: fromParticipant.peerId,
            state,
          });
        }
      }

    } catch (error) {
      logger.error('Error handling connection state change:', error);
    }
  }

  /**
   * Handle data channel messages
   */
  handleDataChannelMessage(socket: Socket, data: {
    to?: string;
    message: any;
    type: string;
  }): void {
    try {
      const { to, message, type } = data;
      
      const room = this.roomService.getRoomBySocket(socket.id);
      const fromParticipant = this.roomService.getParticipantBySocket(socket.id);
      
      if (!room || !fromParticipant) {
        socket.emit('error', { message: 'Not in a room' });
        return;
      }

      const payload = {
        from: fromParticipant.peerId,
        fromUser: fromParticipant.user,
        message,
        type,
        timestamp: new Date().toISOString(),
      };

      if (to) {
        // Send to specific participant
        const toParticipant = Array.from(room.participants.values())
          .find(p => p.peerId === to);

        if (toParticipant && toParticipant.isConnected) {
          this.io.to(toParticipant.socketId).emit('webrtc:data-channel', {
            ...payload,
            to: toParticipant.peerId,
          });
        }
      } else {
        // Broadcast to all participants in room except sender
        socket.to(room.roomId).emit('webrtc:data-channel', payload);
      }

      logger.debug('Data channel message forwarded', {
        roomId: room.roomId,
        from: fromParticipant.peerId,
        to: to || 'broadcast',
        type,
      });

    } catch (error) {
      logger.error('Error handling data channel message:', error);
      socket.emit('error', { message: 'Failed to send data channel message' });
    }
  }

  /**
   * Handle screen share start/stop
   */
  handleScreenShare(socket: Socket, data: {
    enabled: boolean;
    to?: string;
  }): void {
    try {
      const { enabled, to } = data;
      
      const room = this.roomService.getRoomBySocket(socket.id);
      const fromParticipant = this.roomService.getParticipantBySocket(socket.id);
      
      if (!room || !fromParticipant) {
        socket.emit('error', { message: 'Not in a room' });
        return;
      }

      // Update participant's screen share state
      fromParticipant.mediaState.screenShareEnabled = enabled;

      // Notify all other participants
      socket.to(room.roomId).emit('participant:screen-share-changed', {
        userId: fromParticipant.userId,
        peerId: fromParticipant.peerId,
        enabled,
        user: fromParticipant.user,
      });

      logger.info('Screen share toggled', {
        roomId: room.roomId,
        userId: fromParticipant.userId,
        enabled,
      });

    } catch (error) {
      logger.error('Error handling screen share:', error);
      socket.emit('error', { message: 'Failed to toggle screen share' });
    }
  }

  /**
   * Get WebRTC statistics
   */
  handleGetStats(socket: Socket, callback?: (stats: any) => void): void {
    try {
      const room = this.roomService.getRoomBySocket(socket.id);
      const participant = this.roomService.getParticipantBySocket(socket.id);
      
      if (!room || !participant) {
        callback?.({ error: 'Not in a room' });
        return;
      }

      const stats = {
        roomId: room.roomId,
        peerId: participant.peerId,
        connectionCount: Array.from(room.participants.values())
          .filter(p => p.isConnected && p.peerId !== participant.peerId).length,
        mediaState: participant.mediaState,
        joinedAt: participant.joinedAt,
        uptime: Date.now() - participant.joinedAt.getTime(),
      };

      callback?.(stats);

    } catch (error) {
      logger.error('Error getting WebRTC stats:', error);
      callback?.({ error: 'Failed to get stats' });
    }
  }

  /**
   * Handle renegotiation needed
   */
  handleRenegotiationNeeded(socket: Socket, data: { to: string }): void {
    try {
      const { to } = data;
      
      const room = this.roomService.getRoomBySocket(socket.id);
      const fromParticipant = this.roomService.getParticipantBySocket(socket.id);
      
      if (!room || !fromParticipant) {
        return;
      }

      const toParticipant = Array.from(room.participants.values())
        .find(p => p.peerId === to);

      if (toParticipant && toParticipant.isConnected) {
        this.io.to(toParticipant.socketId).emit('webrtc:renegotiation-needed', {
          from: fromParticipant.peerId,
        });

        logger.debug('Renegotiation needed signal forwarded', {
          roomId: room.roomId,
          from: fromParticipant.peerId,
          to: toParticipant.peerId,
        });
      }

    } catch (error) {
      logger.error('Error handling renegotiation needed:', error);
    }
  }

  /**
   * Get STUN/TURN server configuration
   */
  getIceServers(): RTCIceServer[] {
    const iceServers: RTCIceServer[] = [];

    // Add STUN server
    const stunServer = process.env.STUN_SERVER || 'stun:stun.l.google.com:19302';
    iceServers.push({ urls: stunServer });

    // Add TURN server if configured
    const turnUrl = process.env.TURN_SERVER_URL;
    const turnUsername = process.env.TURN_SERVER_USERNAME;
    const turnCredential = process.env.TURN_SERVER_CREDENTIAL;

    if (turnUrl && turnUsername && turnCredential) {
      iceServers.push({
        urls: turnUrl,
        username: turnUsername,
        credential: turnCredential,
      });
    }

    return iceServers;
  }

  /**
   * Send ICE servers to client
   */
  sendIceServers(socket: Socket): void {
    try {
      const iceServers = this.getIceServers();
      socket.emit('webrtc:ice-servers', { iceServers });

      logger.debug('ICE servers sent to client', {
        socketId: socket.id,
        serverCount: iceServers.length,
      });

    } catch (error) {
      logger.error('Error sending ICE servers:', error);
    }
  }
}
