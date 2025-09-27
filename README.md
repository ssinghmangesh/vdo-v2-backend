# Video Calling Backend Services

A comprehensive backend system for video calling applications built with Node.js, Express.js, Socket.IO, and MongoDB.

## Architecture Overview

This backend consists of two main services:

1. **API Server** (`src/api-server`) - REST API for call management, user authentication, and metadata
2. **Signaling Server** (`src/signaling-server`) - WebRTC signaling and real-time communication via Socket.IO

## Features

### 🎯 Core Features
- **User Authentication** - JWT-based auth with refresh tokens
- **Video Call Management** - CRUD operations for scheduled and instant calls
- **Real-time Signaling** - WebRTC offer/answer/ICE candidate exchange
- **Multi-participant Support** - Handle multiple users in video calls
- **Guest Access** - Allow guests to join public calls without registration
- **Call Types** - Public, Private, and Invited-only calls
- **Media Control** - Audio/video/screen-share state management

### 🔒 Security Features
- Rate limiting and DDoS protection
- CORS configuration
- Input validation and sanitization
- JWT token security
- Password hashing with bcrypt
- Security headers (Helmet.js)

### 📊 Advanced Features
- Call statistics and analytics
- Participant management
- Chat messaging
- Screen sharing support
- Connection state monitoring
- Automatic room cleanup

## Project Structure

```
src/
├── api-server/                 # REST API Server
│   ├── controllers/           # Route controllers
│   │   ├── auth.controller.ts
│   │   └── video-call.controller.ts
│   ├── middleware/            # Express middleware
│   │   ├── auth.middleware.ts
│   │   └── error.middleware.ts
│   ├── models/               # Database models
│   │   ├── user.model.ts
│   │   └── video-call.model.ts
│   ├── routes/               # API routes
│   │   ├── auth.routes.ts
│   │   ├── video-call.routes.ts
│   │   └── index.ts
│   └── index.ts              # API server entry point
├── signaling-server/          # WebRTC Signaling Server
│   ├── services/             # Business logic services
│   │   ├── room.service.ts
│   │   └── webrtc.service.ts
│   └── index.ts              # Signaling server entry point
└── shared/                   # Shared utilities and types
    ├── config/               # Configuration files
    │   └── database.ts
    ├── types/                # TypeScript type definitions
    │   └── index.ts
    └── utils/                # Utility functions
        ├── jwt.ts
        ├── logger.ts
        └── validation.ts
```

## Installation

### Prerequisites
- Node.js 18+ 
- MongoDB 4.4+
- npm or yarn

### Setup

1. **Clone and navigate to the backend directory:**
   ```bash
   cd vdo-v2-backend
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Environment configuration:**
   ```bash
   cp env.example .env
   ```
   
   Edit `.env` with your configuration:
   ```env
   NODE_ENV=development
   
   # Server ports
   API_PORT=3001
   SIGNALING_PORT=3002
   
   # Database
   MONGODB_URI=mongodb://localhost:27017/videocall-db
   
   # JWT secrets (generate strong secrets for production)
   JWT_ACCESS_SECRET=your-super-secret-access-key
   JWT_REFRESH_SECRET=your-super-secret-refresh-key
   
   # CORS
   ALLOWED_ORIGINS=http://localhost:3000
   FRONTEND_URL=http://localhost:3000
   
   # WebRTC
   STUN_SERVER=stun:stun.l.google.com:19302
   # Optional TURN server configuration
   TURN_SERVER_URL=
   TURN_SERVER_USERNAME=
   TURN_SERVER_CREDENTIAL=
   ```

4. **Start the services:**
   ```bash
   # Development mode (both servers with hot reload)
   npm run dev
   
   # Or start individually:
   npm run dev:api        # API server only
   npm run dev:signaling  # Signaling server only
   
   # Production build and run:
   npm run build
   npm start
   ```

## API Documentation

### Authentication Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/auth/register` | Register new user |
| POST | `/api/auth/login` | User login |
| POST | `/api/auth/refresh` | Refresh access token |
| GET | `/api/auth/profile` | Get user profile |
| PATCH | `/api/auth/profile` | Update user profile |
| POST | `/api/auth/change-password` | Change password |
| POST | `/api/auth/logout` | Logout user |

### Video Call Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/video-calls` | Create new call |
| GET | `/api/video-calls` | List user's calls |
| GET | `/api/video-calls/:id` | Get call details |
| GET | `/api/video-calls/room/:roomId` | Get call by room ID |
| PATCH | `/api/video-calls/:id` | Update call |
| DELETE | `/api/video-calls/:id` | Delete call |
| POST | `/api/video-calls/join` | Join a call |
| POST | `/api/video-calls/:id/end` | End call (host only) |
| GET | `/api/video-calls/:id/stats` | Get call statistics |

### Health Check

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/health` | Server health status |
| GET | `/api/version` | API version info |

## Socket.IO Events

### Room Management
- `room:join` - Join a video call room
- `room:leave` - Leave a video call room
- `room:end-call` - End the call (host only)

### WebRTC Signaling
- `webrtc:offer` - Send SDP offer
- `webrtc:answer` - Send SDP answer  
- `webrtc:ice-candidate` - Send ICE candidate
- `webrtc:get-ice-servers` - Request STUN/TURN servers

### Participant Events
- `participant:update-media-state` - Update audio/video/screen-share state
- `participant:screen-share-changed` - Screen share state changed

### Chat & Messaging
- `chat:message` - Send chat message
- `chat:typing` - Typing indicator

## Database Schema

### User Collection
```javascript
{
  _id: ObjectId,
  name: String,
  email: String (unique),
  password: String (hashed),
  avatar: String,
  createdAt: Date,
  updatedAt: Date
}
```

### VideoCall Collection
```javascript
{
  _id: ObjectId,
  title: String,
  description: String,
  hostId: ObjectId (ref: User),
  participants: [{
    userId: ObjectId (ref: User),
    role: String, // 'host', 'moderator', 'participant', 'guest'
    joinedAt: Date,
    leftAt: Date,
    isConnected: Boolean,
    connectionId: String
  }],
  scheduledAt: Date,
  startedAt: Date,
  endedAt: Date,
  duration: Number, // minutes
  status: String, // 'scheduled', 'waiting', 'live', 'ended', 'cancelled'
  type: String, // 'public', 'private', 'invited_only'
  settings: {
    videoEnabled: Boolean,
    audioEnabled: Boolean,
    screenShareEnabled: Boolean,
    chatEnabled: Boolean,
    waitingRoomEnabled: Boolean,
    recordingEnabled: Boolean,
    // ... more settings
  },
  roomId: String (unique),
  joinLink: String,
  passcode: String,
  maxParticipants: Number,
  createdAt: Date,
  updatedAt: Date
}
```

## Development

### Available Scripts

```bash
npm run dev          # Start both servers in development mode
npm run dev:api      # Start API server only
npm run dev:signaling # Start signaling server only
npm run build        # Build TypeScript to JavaScript
npm run start        # Start production servers
npm run test         # Run tests
npm run lint         # Run ESLint
npm run lint:fix     # Fix ESLint issues
```

### Code Structure Guidelines

- **Controllers** - Handle HTTP requests, call services, return responses
- **Services** - Business logic, database operations
- **Middleware** - Authentication, validation, error handling
- **Models** - Database schemas and methods
- **Types** - TypeScript type definitions
- **Utils** - Helper functions and utilities

### Error Handling

The application uses centralized error handling with custom `AppError` class:

```typescript
throw new AppError('User not found', 404, ErrorCodes.USER_NOT_FOUND);
```

All errors are logged and properly formatted for API responses.

### Logging

Winston-based logging with different levels:
- **error** - Error conditions
- **warn** - Warning conditions  
- **info** - Informational messages
- **http** - HTTP request logs
- **debug** - Debug information

## Production Deployment

### Environment Variables

Ensure these are set in production:

```env
NODE_ENV=production
JWT_ACCESS_SECRET=<strong-secret>
JWT_REFRESH_SECRET=<different-strong-secret>
MONGODB_URI=<production-mongodb-url>
ALLOWED_ORIGINS=<your-frontend-domain>
```

### Docker Support (Optional)

```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
RUN npm run build
EXPOSE 3001 3002
CMD ["npm", "start"]
```

### Performance Considerations

- Use Redis for session storage in multi-instance deployments
- Configure proper MongoDB indexes
- Set up load balancing for multiple instances
- Use PM2 for process management
- Configure proper logging and monitoring

### Security Checklist

- [ ] Use strong JWT secrets
- [ ] Configure HTTPS in production
- [ ] Set up proper CORS origins
- [ ] Enable rate limiting
- [ ] Regular security updates
- [ ] Database connection encryption
- [ ] Input validation on all endpoints
- [ ] Proper error handling (no stack traces in production)

## Testing

```bash
# Run unit tests
npm test

# Run with coverage
npm run test:coverage

# Run integration tests
npm run test:integration
```

## Contributing

1. Fork the repository
2. Create a feature branch
3. Write tests for new features
4. Ensure all tests pass
5. Submit a pull request

## Troubleshooting

### Common Issues

1. **MongoDB Connection Error**
   - Check MongoDB is running
   - Verify connection string in `.env`
   - Check network connectivity

2. **JWT Token Errors**
   - Verify JWT secrets are set
   - Check token expiry times
   - Ensure proper token format

3. **CORS Issues**
   - Check `ALLOWED_ORIGINS` in `.env`
   - Verify frontend URL is included

4. **Socket.IO Connection Issues**
   - Check signaling server is running on correct port
   - Verify CORS settings for Socket.IO
   - Check firewall settings

### Logs

Check logs in the `logs/` directory:
- `combined.log` - All logs
- `error.log` - Error logs only
- `exceptions.log` - Uncaught exceptions

## License

MIT License - see LICENSE file for details.

## Support

For issues and questions:
1. Check the troubleshooting section
2. Review logs for errors
3. Open an issue on the repository