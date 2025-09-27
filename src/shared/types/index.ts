// Shared types used across both API server and Signaling server

export interface User {
  _id: string;
  name: string;
  email: string;
  avatar?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface VideoCall {
  _id: string;
  title: string;
  description?: string;
  hostId: string;
  host: User;
  participants: Participant[];
  scheduledAt?: Date;
  startedAt?: Date;
  endedAt?: Date;
  duration?: number; // in minutes
  status: CallStatus;
  type: CallType;
  settings: CallSettings;
  roomId: string;
  joinLink: string;
  passcode?: string;
  maxParticipants: number;
  recordingEnabled: boolean;
  recordingUrl?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface Participant {
  userId: string;
  user: User;
  joinedAt: Date;
  leftAt?: Date;
  role: ParticipantRole;
  isConnected: boolean;
  connectionId?: string;
}

export enum CallStatus {
  SCHEDULED = 'scheduled',
  WAITING = 'waiting',
  LIVE = 'live',
  ENDED = 'ended',
  CANCELLED = 'cancelled'
}

export enum CallType {
  PUBLIC = 'public',
  PRIVATE = 'private',
  INVITED_ONLY = 'invited_only'
}

export enum ParticipantRole {
  HOST = 'host',
  MODERATOR = 'moderator',
  PARTICIPANT = 'participant',
  GUEST = 'guest'
}

export interface CallSettings {
  videoEnabled: boolean;
  audioEnabled: boolean;
  screenShareEnabled: boolean;
  chatEnabled: boolean;
  waitingRoomEnabled: boolean;
  recordingEnabled: boolean;
  backgroundBlurEnabled?: boolean;
  noiseReductionEnabled?: boolean;
  allowParticipantScreenShare: boolean;
  allowParticipantUnmute: boolean;
  autoAdmitGuests: boolean;
}

// WebRTC Signaling Types
export interface SignalingMessage {
  type: 'offer' | 'answer' | 'ice-candidate' | 'join' | 'leave' | 'mute' | 'unmute' | 'screen-share';
  data: any;
  from: string;
  to?: string;
  roomId: string;
  timestamp: Date;
}

export interface RoomState {
  roomId: string;
  callId: string;
  participants: Map<string, ParticipantConnection>;
  hostId: string;
  createdAt: Date;
  settings: CallSettings;
}

export interface ParticipantConnection {
  userId: string;
  socketId: string;
  peerId: string;
  user: User;
  joinedAt: Date;
  isConnected: boolean;
  mediaState: {
    videoEnabled: boolean;
    audioEnabled: boolean;
    screenShareEnabled: boolean;
  };
}

// API Request/Response Types
export interface CreateCallRequest {
  title: string;
  description?: string;
  scheduledAt?: string;
  type: CallType;
  settings: Partial<CallSettings>;
  maxParticipants?: number;
  passcode?: string;
  invitedUserIds?: string[];
}

export interface UpdateCallRequest {
  title?: string;
  description?: string;
  scheduledAt?: string;
  type?: CallType;
  settings?: Partial<CallSettings>;
  maxParticipants?: number;
  passcode?: string;
  status?: CallStatus;
}

export interface JoinCallRequest {
  roomId: string;
  passcode?: string;
  guestName?: string;
}

export interface AuthRequest {
  email: string;
  password: string;
  name?: string; // for registration
}

export interface AuthResponse {
  user: User;
  token: string;
  expiresIn: string;
}

export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  message?: string;
  error?: string;
  code?: string;
}

export interface PaginatedResponse<T> extends ApiResponse<T[]> {
  pagination: {
    page: number;
    limit: number;
    total: number;
    pages: number;
  };
}

// Socket Events
export interface ServerToClientEvents {
  'room:joined': (data: { roomId: string; user: User; participants: ParticipantConnection[] }) => void;
  'room:user-joined': (data: { user: User; participant: ParticipantConnection }) => void;
  'room:user-left': (data: { userId: string; participant: ParticipantConnection }) => void;
  'room:call-ended': (data: { roomId: string; reason: string }) => void;
  'webrtc:offer': (data: { from: string; to: string; offer: RTCSessionDescriptionInit; user: User }) => void;
  'webrtc:answer': (data: { from: string; to: string; answer: RTCSessionDescriptionInit }) => void;
  'webrtc:ice-candidate': (data: { from: string; to: string; candidate: RTCIceCandidateInit }) => void;
  'webrtc:ice-servers': (data: { iceServers: RTCIceServer[] }) => void;
  'participant:media-state-changed': (data: { userId: string; mediaState: ParticipantConnection['mediaState'] }) => void;
  'chat:message': (data: { id: string; from: string; fromUser: User; message: string; timestamp: string; type: string }) => void;
  'chat:typing': (data: { from: string; fromUser: User; isTyping: boolean }) => void;
  // SFU Events
  'sfu:router-rtp-capabilities': (data: { rtpCapabilities: any }) => void;
  'sfu:transport-created': (data: { id: string; iceParameters: any; iceCandidates: any; dtlsParameters: any; direction: 'send' | 'recv' }) => void;
  'sfu:transport-connected': () => void;
  'sfu:producer-created': (data: { id: string }) => void;
  'sfu:consumer-created': (data: { id: string; producerId: string; kind: string; rtpParameters: any; producerPeerId: string }) => void;
  'sfu:consumer-closed': (data: { consumerId: string }) => void;
  'sfu:consumer-resumed': (data: { consumerId: string }) => void;
  'sfu:producer-paused': (data: { producerId: string; paused: boolean }) => void;
  'sfu:new-producer': (data: { peerId: string; producerId: string; kind: string }) => void;
  'error': (data: { message: string; code?: string }) => void;
}

export interface ClientToServerEvents {
  'room:join': (data: JoinCallRequest & { token?: string }) => void;
  'room:leave': (data: { roomId: string }) => void;
  'webrtc:offer': (data: { to: string; offer: RTCSessionDescriptionInit }) => void;
  'webrtc:answer': (data: { to: string; answer: RTCSessionDescriptionInit }) => void;
  'webrtc:ice-candidate': (data: { to: string; candidate: RTCIceCandidateInit }) => void;
  'webrtc:get-ice-servers': () => void;
  'participant:update-media-state': (data: { videoEnabled: boolean; audioEnabled: boolean; screenShareEnabled: boolean }) => void;
  'room:end-call': (data: { roomId: string }) => void;
  'chat:message': (data: { message: string; to?: string }) => void;
  'chat:typing': (data: { isTyping: boolean }) => void;
  // SFU Events
  'sfu:join-room': (data: { roomId: string; rtpCapabilities: any; participant: ParticipantConnection }) => void;
  'sfu:create-transport': (data: { direction: 'send' | 'recv' }) => void;
  'sfu:connect-transport': (data: { dtlsParameters: any }) => void;
  'sfu:produce': (data: { kind: string; rtpParameters: any }) => void;
  'sfu:consume': (data: { producerId: string; rtpCapabilities: any }) => void;
  'sfu:resume-consumer': (data: { consumerId: string }) => void;
  'sfu:pause-producer': (data: { pause: boolean }) => void;
}

// Error Types
export class AppError extends Error {
  public statusCode: number;
  public code: string;
  public isOperational: boolean;

  constructor(message: string, statusCode: number = 500, code: string = 'INTERNAL_ERROR') {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.isOperational = true;

    Error.captureStackTrace(this, this.constructor);
  }
}

export enum ErrorCodes {
  // Authentication
  INVALID_CREDENTIALS = 'INVALID_CREDENTIALS',
  TOKEN_EXPIRED = 'TOKEN_EXPIRED',
  TOKEN_INVALID = 'TOKEN_INVALID',
  UNAUTHORIZED = 'UNAUTHORIZED',
  
  // Call Management
  CALL_NOT_FOUND = 'CALL_NOT_FOUND',
  CALL_ENDED = 'CALL_ENDED',
  CALL_FULL = 'CALL_FULL',
  INVALID_PASSCODE = 'INVALID_PASSCODE',
  HOST_REQUIRED = 'HOST_REQUIRED',
  
  // Room Management
  ROOM_NOT_FOUND = 'ROOM_NOT_FOUND',
  ROOM_FULL = 'ROOM_FULL',
  ALREADY_IN_ROOM = 'ALREADY_IN_ROOM',
  
  // Validation
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  INVALID_INPUT = 'INVALID_INPUT',
  
  // Server
  INTERNAL_ERROR = 'INTERNAL_ERROR',
  SERVICE_UNAVAILABLE = 'SERVICE_UNAVAILABLE',
  DATABASE_ERROR = 'DATABASE_ERROR'
}
