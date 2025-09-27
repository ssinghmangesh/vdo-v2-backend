import express from 'express';
import cors from 'cors';
import { config } from 'dotenv';
import { database } from '../shared/config/database';
import { logger } from '../shared/utils/logger';
import { globalErrorHandler, notFoundHandler } from './middleware/error.middleware';
import indexRoutes from './routes';

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

// Routes
app.use('/api', indexRoutes);

// Error handling middleware
app.use(notFoundHandler);
app.use(globalErrorHandler);

// Connect to database and start server
async function startServer() {
  try {
    // Connect to database
    logger.info('🔗 Connecting to database...');
    await database.connect();
    logger.info('✅ Database connected successfully!');

    // Start server
    const server = app.listen(PORT, () => {
      logger.info('🚀 Video Call API Server started successfully!');
      logger.info(`📍 Server running on http://localhost:${PORT}`);
      logger.info(`🔍 Health check: http://localhost:${PORT}/api/health`);
      logger.info('📋 Available endpoints:');
      logger.info('  POST /api/auth/register - Register new user');
      logger.info('  POST /api/auth/login - Login user');
      logger.info('  GET /api/auth/profile - Get user profile');
      logger.info('  POST /api/video-calls - Create video call');
      logger.info('  GET /api/video-calls - Get user\'s video calls');
      logger.info('  GET /api/video-calls/:roomId - Get video call by room ID');
    });

    // Graceful shutdown
    const gracefulShutdown = () => {
      logger.info('Shutting down gracefully...');
      server.close(async () => {
        await database.disconnect();
        process.exit(0);
      });
    };

    process.on('SIGTERM', gracefulShutdown);
    process.on('SIGINT', gracefulShutdown);

    return server;

  } catch (error) {
    logger.error('❌ Server startup failed:', error);
    process.exit(1);
  }
}

logger.info('🚀 Starting Video Call API Server...');

startServer().catch((error) => {
  logger.error('❌ Server startup failed:', error);
  process.exit(1);
});