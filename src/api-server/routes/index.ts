import { Router } from 'express';
import { Request, Response } from 'express';
import authRoutes from './auth.routes';
import videoCallRoutes from './video-call.routes';
import { database } from '../../shared/config/database';
import { logger } from '../../shared/utils/logger';

const router = Router();

// Health check endpoint
router.get('/health', async (req: Request, res: Response) => {
  try {
    const dbHealth = await database.healthCheck();
    const uptime = process.uptime();
    const memoryUsage = process.memoryUsage();
    
    const health = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: {
        seconds: Math.floor(uptime),
        human: `${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m ${Math.floor(uptime % 60)}s`
      },
      memory: {
        used: `${Math.round(memoryUsage.heapUsed / 1024 / 1024)}MB`,
        total: `${Math.round(memoryUsage.heapTotal / 1024 / 1024)}MB`,
        external: `${Math.round(memoryUsage.external / 1024 / 1024)}MB`
      },
      database: dbHealth,
      environment: process.env.NODE_ENV || 'development',
      version: process.env.npm_package_version || '1.0.0'
    };

    // Determine overall health status
    if (dbHealth.status !== 'healthy') {
      health.status = 'degraded';
    }

    const statusCode = health.status === 'healthy' ? 200 : 503;
    res.status(statusCode).json(health);
  } catch (error) {
    logger.error('Health check failed:', error);
    res.status(503).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      error: 'Health check failed'
    });
  }
});

// API info endpoint
router.get('/', (req: Request, res: Response) => {
  res.json({
    name: 'Video Calling API Server',
    version: process.env.npm_package_version || '1.0.0',
    description: 'REST API for video calling application',
    endpoints: {
      health: '/api/health',
      auth: '/api/auth',
      videoCalls: '/api/video-calls'
    },
    documentation: '/api/docs', // TODO: Add OpenAPI docs
    environment: process.env.NODE_ENV || 'development',
    timestamp: new Date().toISOString()
  });
});

// API version endpoint
router.get('/version', (req: Request, res: Response) => {
  res.json({
    version: process.env.npm_package_version || '1.0.0',
    apiVersion: 'v1',
    build: process.env.BUILD_NUMBER || 'development',
    commit: process.env.GIT_COMMIT || 'unknown',
    timestamp: new Date().toISOString()
  });
});

// Mount routes
router.use('/auth', authRoutes);
router.use('/video-calls', videoCallRoutes);

// Catch all for undefined API routes
router.use('*', (req: Request, res: Response) => {
  res.status(404).json({
    success: false,
    message: `API route not found: ${req.method} ${req.originalUrl}`,
    code: 'ROUTE_NOT_FOUND',
    availableRoutes: {
      health: 'GET /api/health',
      auth: {
        register: 'POST /api/auth/register',
        login: 'POST /api/auth/login',
        profile: 'GET /api/auth/profile',
        refresh: 'POST /api/auth/refresh',
        logout: 'POST /api/auth/logout'
      },
      videoCalls: {
        create: 'POST /api/video-calls',
        list: 'GET /api/video-calls',
        get: 'GET /api/video-calls/:id',
        getByRoom: 'GET /api/video-calls/room/:roomId',
        update: 'PATCH /api/video-calls/:id',
        delete: 'DELETE /api/video-calls/:id',
        join: 'POST /api/video-calls/join',
        end: 'POST /api/video-calls/:id/end',
        stats: 'GET /api/video-calls/:id/stats'
      }
    }
  });
});

export default router;
