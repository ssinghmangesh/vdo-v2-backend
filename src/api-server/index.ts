import express from 'express';
import cors from 'cors';
import { config } from 'dotenv';
import mongoose from 'mongoose';
import * as bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

// Load environment variables
config();

const app = express();
const PORT = process.env.API_PORT || 4000;

// Basic middleware
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000'],
  credentials: true
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Simple User Schema
const UserSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  avatar: { type: String, default: '' }
}, { timestamps: true });

UserSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

const User = mongoose.model('User', UserSchema);

// Simple VideoCall Schema  
const VideoCallSchema = new mongoose.Schema({
  title: { type: String, required: true },
  description: String,
  hostId: { type: String, required: true },
  roomId: { type: String, unique: true, required: true },
  scheduledAt: Date,
  startedAt: Date,
  endedAt: Date,
  status: { 
    type: String, 
    enum: ['scheduled', 'active', 'ended', 'cancelled'],
    default: 'scheduled' 
  },
  type: {
    type: String,
    enum: ['instant', 'scheduled', 'recurring'],
    default: 'instant'
  },
  maxParticipants: { type: Number, default: 10 },
  participants: [{
    userId: String,
    joinedAt: { type: Date, default: Date.now },
    leftAt: Date,
    role: { 
      type: String, 
      enum: ['host', 'co-host', 'participant'], 
      default: 'participant' 
    },
    isConnected: { type: Boolean, default: false }
  }],
  settings: {
    enableVideo: { type: Boolean, default: true },
    enableAudio: { type: Boolean, default: true },
    enableChat: { type: Boolean, default: true },
    enableScreenShare: { type: Boolean, default: true },
    enableRecording: { type: Boolean, default: false },
    isPublic: { type: Boolean, default: false },
    requireAuth: { type: Boolean, default: true },
    allowGuests: { type: Boolean, default: true }
  }
}, { timestamps: true });

const VideoCall = mongoose.model('VideoCall', VideoCallSchema);

// JWT Helper Functions
const generateToken = (payload: any, secret: string, expiresIn: string) => {
  return jwt.sign(payload, secret, { expiresIn } as jwt.SignOptions);
};

const verifyToken = (token: string, secret: string) => {
  return jwt.verify(token, secret) as any;
};

// Auth Middleware
const authenticateToken = async (req: any, res: any, next: any) => {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ success: false, message: 'Access token required' });
  }

  try {
    const decoded = verifyToken(token, process.env.JWT_ACCESS_SECRET || 'default-secret');
    const user = await User.findById(decoded.userId).select('-password');
    if (!user) {
      return res.status(401).json({ success: false, message: 'User not found' });
    }
    req.user = user;
    return next();
  } catch (error) {
    return res.status(403).json({ success: false, message: 'Invalid token' });
  }
};

// Routes

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    message: 'Video Call API Server is running!',
    timestamp: new Date().toISOString(),
    port: PORT
  });
});

// Auth Routes
app.post('/api/auth/register', async (req, res): Promise<any> => {
  try {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Name, email, and password are required'
      });
    }

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(409).json({
        success: false,
        message: 'User with this email already exists'
      });
    }

    const avatar = `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=random`;
    const user = new User({ name, email, password, avatar });
    await user.save();

    const accessToken = generateToken(
      { userId: user._id, email: user.email, name: user.name },
      process.env.JWT_ACCESS_SECRET || 'default-secret',
      '15m'
    );

    const refreshToken = generateToken(
      { userId: user._id },
      process.env.JWT_REFRESH_SECRET || 'default-refresh-secret', 
      '7d'
    );

    res.status(201).json({
      success: true,
      message: 'User registered successfully',
      data: {
        user: {
          _id: user._id,
          name: user.name,
          email: user.email,
          avatar: user.avatar
        },
        token: accessToken,
        refreshToken
      }
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      message: 'Registration failed',
      error: error.message
    });
  }
});

app.post('/api/auth/login', async (req, res): Promise<any> => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Email and password are required'
      });
    }

    const user = await User.findOne({ email });
    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password'
      });
    }

    const accessToken = generateToken(
      { userId: user._id, email: user.email, name: user.name },
      process.env.JWT_ACCESS_SECRET || 'default-secret',
      '15m'
    );

    const refreshToken = generateToken(
      { userId: user._id },
      process.env.JWT_REFRESH_SECRET || 'default-refresh-secret',
      '7d'
    );

    res.json({
      success: true,
      message: 'Login successful',
      data: {
        user: {
          _id: user._id,
          name: user.name,
          email: user.email,
          avatar: user.avatar
        },
        token: accessToken,
        refreshToken
      }
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      message: 'Login failed',
      error: error.message
    });
  }
});

app.get('/api/auth/profile', authenticateToken, (req: any, res) => {
  return res.json({
    success: true,
    data: {
      user: {
        _id: req.user._id,
        name: req.user.name,
        email: req.user.email,
        avatar: req.user.avatar
      }
    }
  });
});

// Video Call Routes
app.post('/api/video-calls', authenticateToken, async (req: any, res): Promise<any> => {
  try {
    const { title, description, scheduledAt, type, settings } = req.body;

    if (!title) {
      return res.status(400).json({
        success: false,
        message: 'Title is required'
      });
    }

    const roomId = `room_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;

    const videoCall = new VideoCall({
      title,
      description,
      hostId: req.user._id.toString(),
      roomId,
      scheduledAt: scheduledAt ? new Date(scheduledAt) : undefined,
      type: type || 'instant',
      participants: [{
        userId: req.user._id.toString(),
        role: 'host',
        isConnected: false
      }],
      settings: {
        enableVideo: true,
        enableAudio: true,
        enableChat: true,
        enableScreenShare: true,
        enableRecording: false,
        isPublic: false,
        requireAuth: true,
        allowGuests: true,
        ...settings
      }
    });

    await videoCall.save();

    res.status(201).json({
      success: true,
      message: 'Video call created successfully',
      data: {
        call: videoCall,
        joinLink: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/room/${roomId}`
      }
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      message: 'Failed to create video call',
      error: error.message
    });
  }
});

app.get('/api/video-calls', authenticateToken, async (req: any, res): Promise<any> => {
  try {
    const calls = await VideoCall.find({
      $or: [
        { hostId: req.user._id.toString() },
        { 'participants.userId': req.user._id.toString() }
      ]
    }).sort({ createdAt: -1 });

    return res.json({
      success: true,
      data: { calls }
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch video calls',
      error: error.message
    });
  }
});

app.get('/api/video-calls/:roomId', async (req, res): Promise<any> => {
  try {
    const { roomId } = req.params;
    const call = await VideoCall.findOne({ roomId });

    if (!call) {
      return res.status(404).json({
        success: false,
        message: 'Video call not found'
      });
    }

    return res.json({
      success: true,
      data: { call }
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch video call',
      error: error.message
    });
  }
});

// Connect to database and start server
async function startServer() {
  try {
    // Connect to database
    console.log('🔗 Connecting to database...');
    const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/videocall-db';
    await mongoose.connect(mongoUri);
    console.log('✅ Database connected successfully!');

    // Start server
    const server = app.listen(PORT, () => {
      console.log('🚀 Video Call API Server started successfully!');
      console.log(`📍 Server running on http://localhost:${PORT}`);
      console.log(`🔍 Health check: http://localhost:${PORT}/api/health`);
      console.log('📋 Available endpoints:');
      console.log('  POST /api/auth/register - Register new user');
      console.log('  POST /api/auth/login - Login user');
      console.log('  GET /api/auth/profile - Get user profile');
      console.log('  POST /api/video-calls - Create video call');
      console.log('  GET /api/video-calls - Get user\'s video calls');
      console.log('  GET /api/video-calls/:roomId - Get video call by room ID');
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
    console.error('❌ Server startup failed:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  startServer();
}

export { app, startServer };
