import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import { config } from 'dotenv';
import { database } from '../shared/config/database';
import { logger, requestLogger } from '../shared/utils/logger';
import { 
  globalErrorHandler, 
  notFoundHandler, 
  securityHeaders, 
  timeoutHandler,
  gracefulShutdown 
} from './middleware/error.middleware';
import apiRoutes from './routes';

// Load environment variables
config();

const app = express();
const PORT = process.env.API_PORT || 4000;
const NODE_ENV = process.env.NODE_ENV || 'development';

/**
 * Security Configuration
 */
// Security headers
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"],
    },
  },
  crossOriginEmbedderPolicy: false, // Allow for dev tools
}));

// Custom security headers
app.use(securityHeaders);

// Trust proxy for accurate IP addresses
app.set('trust proxy', 1);

/**
 * CORS Configuration
 */
const corsOptions = {
  origin: function (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) {
    const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',') || [
      'http://localhost:3000',
      'http://localhost:3001',
      'http://127.0.0.1:3000',
    ];

    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    } else {
      logger.warn('CORS blocked origin:', origin);
      return callback(new Error('Not allowed by CORS'), false);
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: [
    'Origin',
    'X-Requested-With',
    'Content-Type',
    'Accept',
    'Authorization',
    'X-API-Key',
  ],
  exposedHeaders: ['X-Total-Count'],
};

app.use(cors(corsOptions));

/**
 * Rate Limiting
 */
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: NODE_ENV === 'development' ? 1000 : 100, // Limit each IP
  message: {
    success: false,
    message: 'Too many requests from this IP, please try again later.',
    code: 'RATE_LIMIT_EXCEEDED',
  },
  standardHeaders: true, // Return rate limit info in headers
  legacyHeaders: false, // Disable X-RateLimit headers
  skip: (req) => {
    // Skip rate limiting for health checks
    return req.path === '/api/health';
  },
});

app.use(limiter);

/**
 * Body Parsing & Compression
 */
app.use(compression());
app.use(express.json({ 
  limit: '10mb',
  verify: (req: any, res, buf) => {
    req.rawBody = buf;
  }
}));
app.use(express.urlencoded({ 
  extended: true, 
  limit: '10mb' 
}));

/**
 * Logging Middleware
 */
app.use(requestLogger);

/**
 * Request Timeout
 */
app.use(timeoutHandler(30000)); // 30 seconds

/**
 * Routes
 */
app.use('/api', apiRoutes);

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    message: 'Video Calling API Server',
    version: process.env.npm_package_version || '1.0.0',
    status: 'running',
    environment: NODE_ENV,
    api: '/api',
    health: '/api/health',
    timestamp: new Date().toISOString(),
  });
});

/**
 * Error Handling Middleware
 */
app.use(notFoundHandler);
app.use(globalErrorHandler);

/**
 * Server Startup
 */
async function startServer() {
  try {
    // Connect to database
    logger.info('Connecting to database...');
    await database.connect();

    // Start server
    const server = app.listen(PORT, () => {
      logger.info(`🚀 API Server started successfully!`);
      logger.info(`📍 Server running on port ${PORT}`);
      logger.info(`🌍 Environment: ${NODE_ENV}`);
      logger.info(`💾 Database: Connected`);
      logger.info(`🔗 API Endpoint: http://localhost:${PORT}/api`);
      logger.info(`🏥 Health Check: http://localhost:${PORT}/api/health`);
      
      if (NODE_ENV === 'development') {
        logger.info(`📚 Available routes:`);
        logger.info(`   POST /api/auth/register`);
        logger.info(`   POST /api/auth/login`);
        logger.info(`   GET  /api/auth/profile`);
        logger.info(`   POST /api/video-calls`);
        logger.info(`   GET  /api/video-calls`);
        logger.info(`   POST /api/video-calls/join`);
      }
    });

    // Handle server errors
    server.on('error', (error: any) => {
      if (error.code === 'EADDRINUSE') {
        logger.error(`Port ${PORT} is already in use`);
      } else {
        logger.error('Server error:', error);
      }
      process.exit(1);
    });

    // Graceful shutdown
    gracefulShutdown(server);

    return server;
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
}

/**
 * Handle uncaught errors
 */
process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection at:', { promise, reason });
});

process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', error);
  process.exit(1);
});

// Start server if this file is run directly
if (require.main === module) {
  startServer().catch((error) => {
    logger.error('Server startup failed:', error);
    process.exit(1);
  });
}

export { app, startServer };
export default app;
