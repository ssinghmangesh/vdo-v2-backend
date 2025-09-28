import mongoose, { Document, Schema, Types } from 'mongoose';
import { v4 as uuidv4 } from 'uuid';
import { CallStatus, CallType, ParticipantRole, CallSettings, Participant } from '../../shared/types';

export interface VideoCallDocument extends Document {
  title: string;
  description?: string;
  hostId: string;
  participants: Participant[];
  scheduledAt?: Date;
  startedAt?: Date;
  endedAt?: Date;
  duration: number;
  status: CallStatus;
  type: CallType;
  settings: CallSettings;
  roomId: string;
  joinLink: string;
  passcode?: string;
  maxParticipants: number;
  recordingEnabled: boolean;
  recordingUrl?: string;
  generateJoinLink(): string;
  generateRoomId(): string;
  addParticipant(userId: string, role?: ParticipantRole): Promise<VideoCallDocument>;
  removeParticipant(userId: string): Promise<VideoCallDocument>;
  updateParticipantStatus(userId: string, isConnected: boolean, connectionId?: string): Promise<VideoCallDocument>;
  canUserJoin(userId?: string): Promise<{ canJoin: boolean; reason?: string }>;
  startCall(): Promise<VideoCallDocument>;
  endCall(): Promise<VideoCallDocument>;
  getDuration(): number;
}

const mediaStateSchema = new mongoose.Schema({
  videoEnabled: { type: Boolean, default: true },
  audioEnabled: { type: Boolean, default: true },
  screenShareEnabled: { type: Boolean, default: true },
});

const participantSchema = new mongoose.Schema({
  userId: {
    type: String,
    required: true
  },
  joinedAt: {
    type: Date,
    default: Date.now
  },
  leftAt: {
    type: Date
  },
  role: {
    type: String,
    enum: ['host', 'moderator', 'participant'],
    default: 'participant'
  },
  isConnected: {
    type: Boolean,
    default: false
  },
  mediaState: {
    type: mediaStateSchema,
    default: () => ({})
  },
  connectionId: {
    type: String
  }
}, { _id: false });

const callSettingsSchema = new mongoose.Schema({
  videoEnabled: { type: Boolean, default: true },
  audioEnabled: { type: Boolean, default: true },
  screenShareEnabled: { type: Boolean, default: true },
  chatEnabled: { type: Boolean, default: true },
  waitingRoomEnabled: { type: Boolean, default: false },
  recordingEnabled: { type: Boolean, default: false },
  backgroundBlurEnabled: { type: Boolean, default: false },
  noiseReductionEnabled: { type: Boolean, default: true },
  allowParticipantScreenShare: { type: Boolean, default: true },
  allowParticipantUnmute: { type: Boolean, default: true },
  autoAdmitGuests: { type: Boolean, default: true }
}, { _id: false });

const videoCallSchemaDefinition = {
  title: {
    type: String,
    required: [true, 'Call title is required'],
    trim: true,
    maxlength: [200, 'Title cannot exceed 200 characters']
  },
  description: {
    type: String,
    trim: true,
    maxlength: [1000, 'Description cannot exceed 1000 characters']
  },
  hostId: {
    type: String,
    required: [true, 'Host is required']
  },
  participants: [participantSchema],
  scheduledAt: {
    type: Date,
    validate: {
      validator: function(value: Date) {
        return !value || value > new Date();
      },
      message: 'Scheduled time must be in the future'
    }
  },
  startedAt: {
    type: Date
  },
  endedAt: {
    type: Date
  },
  duration: {
    type: Number, // in minutes
    default: 0
  },
  status: {
    type: String,
    enum: ['scheduled', 'waiting', 'live', 'ended', 'cancelled'],
    default: 'scheduled'
  },
  type: {
    type: String,
    enum: ['public', 'private', 'invited_only'],
    required: [true, 'Call type is required'],
    default: 'public'
  },
  settings: {
    type: callSettingsSchema,
    default: () => ({})
  },
  roomId: {
    type: String,
    required: true,
    unique: true,
    default: () => uuidv4().replace(/-/g, '').substring(0, 12).toUpperCase()
  },
  joinLink: {
    type: String
  },
  passcode: {
    type: String,
    minlength: [4, 'Passcode must be at least 4 characters'],
    maxlength: [20, 'Passcode cannot exceed 20 characters']
  },
  maxParticipants: {
    type: Number,
    default: 100,
    min: [2, 'Minimum 2 participants required'],
    max: [500, 'Maximum 500 participants allowed']
  },
  recordingEnabled: {
    type: Boolean,
    default: false
  },
  recordingUrl: {
    type: String
  }
};

const videoCallSchemaOptions = {
  timestamps: true,
  toJSON: {
    transform: function(doc: any, ret: any) {
      ret._id = ret._id.toString();
      delete ret.__v;
      return ret;
    }
  }
};

const videoCallSchema = new mongoose.Schema(videoCallSchemaDefinition as any, videoCallSchemaOptions);

// Indexes
videoCallSchema.index({ hostId: 1, createdAt: -1 });
videoCallSchema.index({ status: 1, scheduledAt: 1 });
videoCallSchema.index({ type: 1, status: 1 });
videoCallSchema.index({ 'participants.userId': 1 });

// Pre-save middleware
videoCallSchema.pre('save', function(next) {
  if (this.isNew || this.isModified('roomId')) {
    const baseUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    this.joinLink = `${baseUrl}/room/${this.roomId}`;
  }
  
  // Auto-add host as participant if not already added
  if (this.isNew) {
    const hostExists = this.participants.some((p: any) => p.userId.toString() === this.hostId.toString());
    if (!hostExists) {
      this.participants.push({
        userId: this.hostId,
        role: 'host',
        joinedAt: new Date(),
        isConnected: false
      });
    }
  }
  
  next();
});

// Generate join link
videoCallSchema.methods.generateJoinLink = function(): string {
  const baseUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
  return `${baseUrl}/room/${this.roomId}`;
};

// Generate room ID
videoCallSchema.methods.generateRoomId = function(): string {
  return uuidv4().replace(/-/g, '').substring(0, 12).toUpperCase();
};

// Add participant
videoCallSchema.methods.addParticipant = async function(userId: string, role: string = 'participant') {
  const existingParticipant = this.participants.find((p: any) => p.userId.toString() === userId);
  
  if (existingParticipant) {
    // Update existing participant
    existingParticipant.role = role;
    existingParticipant.leftAt = undefined;
  } else {
    // Add new participant
    if (this.participants.length >= this.maxParticipants) {
      throw new Error('Call is full');
    }
    
    this.participants.push({
      userId: userId,
      role,
      joinedAt: new Date(),
      isConnected: false
    } as Participant);
  }
  
  return this.save();
};

// Remove participant
videoCallSchema.methods.removeParticipant = async function(userId: string) {
  const participantIndex = this.participants.findIndex((p: any) => p.userId.toString() === userId);
  
  if (participantIndex !== -1) {
    this.participants[participantIndex].leftAt = new Date();
    this.participants[participantIndex].isConnected = false;
    this.participants[participantIndex].connectionId = undefined;
  }
  
  return this.save();
};

// Update participant status
videoCallSchema.methods.updateParticipantStatus = async function(userId: string, isConnected: boolean, connectionId?: string) {
  const participant = this.participants.find((p: any) => p.userId.toString() === userId);
  
  if (participant) {
    participant.isConnected = isConnected;
    participant.connectionId = connectionId;
    
    if (isConnected) {
      participant.leftAt = undefined;
    } else {
      participant.leftAt = new Date();
    }
  }
  
  return this.save();
};

// Check if user can join
videoCallSchema.methods.canUserJoin = async function(userId?: string) {
  // Check if call is ended or cancelled
  if (this.status === 'ended' || this.status === 'cancelled') {
    return { canJoin: false, reason: 'Call has ended' };
  }
  
  // Check if call is full
  const activeParticipants = this.participants.filter((p: any) => !p.leftAt).length;
  if (activeParticipants >= this.maxParticipants) {
    return { canJoin: false, reason: 'Call is full' };
  }
  
  // Check call type permissions
  if (this.type === 'private' && userId) {
    const isParticipant = this.participants.some((p: any) => p.userId.toString() === userId);
    if (!isParticipant) {
      return { canJoin: false, reason: 'You are not invited to this call' };
    }
  }
  
  if (this.type === 'invited_only' && userId) {
    const isInvited = this.participants.some((p: any) => p.userId.toString() === userId);
    if (!isInvited) {
      return { canJoin: false, reason: 'You are not invited to this call' };
    }
  }
  
  return { canJoin: true };
};

// Start call
videoCallSchema.methods.startCall = async function() {
  if (this.status === 'scheduled' || this.status === 'waiting') {
    this.status = 'live';
    this.startedAt = new Date();
  }
  return this.save();
};

// End call
videoCallSchema.methods.endCall = async function() {
  if (this.status === 'live' || this.status === 'waiting') {
    this.status = 'ended';
    this.endedAt = new Date();
    
    // Calculate duration
    if (this.startedAt) {
      this.duration = Math.round((this.endedAt.getTime() - this.startedAt.getTime()) / (1000 * 60));
    }
    
    // Mark all participants as disconnected
    this.participants.forEach((participant: any) => {
      if (participant.isConnected) {
        participant.isConnected = false;
        participant.leftAt = this.endedAt;
        participant.connectionId = undefined;
      }
    });
  }
  return this.save();
};

// Get call duration
videoCallSchema.methods.getDuration = function(): number {
  if (this.startedAt && this.endedAt) {
    return Math.round((this.endedAt.getTime() - this.startedAt.getTime()) / (1000 * 60));
  }
  if (this.startedAt && this.status === 'live') {
    return Math.round((Date.now() - this.startedAt.getTime()) / (1000 * 60));
  }
  return 0;
};

// Static methods
videoCallSchema.statics.findByRoomId = function(roomId: string) {
  return this.findOne({ roomId }).populate('hostId', 'name email avatar').populate('participants.userId', 'name email avatar');
};

videoCallSchema.statics.findActiveCallsForUser = function(userId: string) {
  return this.find({
    $or: [
      { hostId: userId },
      { 'participants.userId': userId }
    ],
    status: { $in: ['scheduled', 'waiting', 'live'] }
  }).populate('hostId', 'name email avatar').populate('participants.userId', 'name email avatar');
};

export const VideoCallModel = mongoose.model<VideoCallDocument>('VideoCall', videoCallSchema);
