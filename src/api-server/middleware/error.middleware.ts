import { Request, Response, NextFunction } from 'express';
import { AppError, ErrorCodes } from '../../shared/types';
import { logger, errorLogger } from '../../shared/utils/logger';
import { ZodError } from 'zod';
import mongoose from 'mongoose';

/**
 * Global error handling middleware
 */
export const globalErrorHandler = (
  error: Error,
  req: Request,
  res: Response,
  next: NextFunction
) => {
  // Log the error
  errorLogger(error, req);

  // Default error response
  let statusCode = 500;
  let message = 'Internal server error';
  let code = ErrorCodes.INTERNAL_ERROR;
  let details: any = undefined;

  // Handle different types of errors
  if (error instanceof AppError) {
    statusCode = error.statusCode;
    message = error.message;
    code = error.code as ErrorCodes;
  } else if (error instanceof ZodError) {
    // Validation errors
    statusCode = 400;
    message = 'Validation failed';
    code = ErrorCodes.VALIDATION_ERROR;
    details = error.errors.map((err) => ({
      field: err.path.join('.'),
      message: err.message,
    }));
  } else if (error instanceof mongoose.Error.ValidationError) {
    // Mongoose validation errors
    statusCode = 400;
    message = 'Validation failed';
    code = ErrorCodes.VALIDATION_ERROR;
    details = Object.values(error.errors).map((err: any) => ({
      field: err.path,
      message: err.message,
    }));
  } else if (error instanceof mongoose.Error.CastError) {
    // MongoDB ObjectId cast errors
    statusCode = 400;
    message = 'Invalid ID format';
    code = ErrorCodes.INVALID_INPUT;
  } else if (error.name === 'MongoServerError') {
    // MongoDB specific errors
    const mongoError = error as any;
    
    if (mongoError.code === 11000) {
      // Duplicate key error
      statusCode = 409;
      message = 'Resource already exists';
      code = ErrorCodes.VALIDATION_ERROR;
      
      // Extract field name from error
      const field = Object.keys(mongoError.keyPattern || {})[0];
      if (field) {
        message = `${field} already exists`;
      }
    } else if (mongoError.code === 11001) {
      // Duplicate key error on update
      statusCode = 409;
      message = 'Duplicate key error';
      code = ErrorCodes.VALIDATION_ERROR;
    } else {
      statusCode = 500;
      message = 'Database error';
      code = ErrorCodes.DATABASE_ERROR;
    }
  } else if (error.name === 'JsonWebTokenError') {
    // JWT errors
    statusCode = 401;
    message = 'Invalid token';
    code = ErrorCodes.TOKEN_INVALID;
  } else if (error.name === 'TokenExpiredError') {
    // JWT expired errors
    statusCode = 401;
    message = 'Token expired';
    code = ErrorCodes.TOKEN_EXPIRED;
  } else if (error.name === 'MulterError') {
    // File upload errors
    const multerError = error as any;
    statusCode = 400;
    code = ErrorCodes.INVALID_INPUT;
    
    switch (multerError.code) {
      case 'LIMIT_FILE_SIZE':
        message = 'File too large';
        break;
      case 'LIMIT_FILE_COUNT':
        message = 'Too many files';
        break;
      case 'LIMIT_FIELD_KEY':
        message = 'Field name too long';
        break;
      case 'LIMIT_FIELD_VALUE':
        message = 'Field value too long';
        break;
      case 'LIMIT_FIELD_COUNT':
        message = 'Too many fields';
        break;
      case 'LIMIT_UNEXPECTED_FILE':
        message = 'Unexpected file';
        break;
      default:
        message = 'File upload error';
    }
  } else if (error.name === 'SyntaxError' && 'body' in error) {
    // JSON syntax errors
    statusCode = 400;
    message = 'Invalid JSON format';
    code = ErrorCodes.INVALID_INPUT;
  } else if (error.message?.includes('ECONNREFUSED')) {
    // Connection errors
    statusCode = 503;
    message = 'Service temporarily unavailable';
    code = ErrorCodes.SERVICE_UNAVAILABLE;
  } else if (error.message?.includes('ENOTFOUND')) {
    // DNS/Network errors
    statusCode = 503;
    message = 'Service temporarily unavailable';
    code = ErrorCodes.SERVICE_UNAVAILABLE;
  } else if (error.name === 'TimeoutError') {
    // Timeout errors
    statusCode = 504;
    message = 'Request timeout';
    code = ErrorCodes.SERVICE_UNAVAILABLE;
  }

  // Don't expose internal errors in production
  if (process.env.NODE_ENV === 'production' && statusCode === 500) {
    message = 'Something went wrong';
    details = undefined;
  }

  // Prepare error response
  const errorResponse: any = {
    success: false,
    message,
    code,
  };

  if (details) {
    errorResponse.errors = details;
  }

  // Add error ID for tracking in production
  if (process.env.NODE_ENV === 'production') {
    const errorId = Date.now().toString(36) + Math.random().toString(36).substring(2);
    errorResponse.errorId = errorId;
    logger.error('Error ID for tracking', { errorId, message: error.message });
  }

  // Add stack trace in development
  if (process.env.NODE_ENV === 'development') {
    errorResponse.stack = error.stack;
  }

  res.status(statusCode).json(errorResponse);
};

/**
 * Middleware to handle 404 - Route not found
 */
export const notFoundHandler = (req: Request, res: Response, next: NextFunction) => {
  const error = new AppError(
    `Route not found: ${req.method} ${req.originalUrl}`,
    404,
    'ROUTE_NOT_FOUND'
  );
  
  next(error);
};

/**
 * Async error wrapper utility
 */
export const asyncHandler = (fn: Function) => {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};

/**
 * Validation error formatter
 */
export const formatValidationError = (error: ZodError) => {
  return {
    message: 'Validation failed',
    errors: error.errors.map((err) => ({
      field: err.path.join('.'),
      message: err.message,
      value: (err as any).input || 'N/A',
    })),
  };
};

/**
 * Database error formatter
 */
export const formatDatabaseError = (error: mongoose.Error) => {
  if (error instanceof mongoose.Error.ValidationError) {
    return {
      message: 'Database validation failed',
      errors: Object.values(error.errors).map((err: any) => ({
        field: err.path,
        message: err.message,
        value: err.value,
      })),
    };
  }

  if (error instanceof mongoose.Error.CastError) {
    return {
      message: 'Invalid data format',
      errors: [{
        field: error.path,
        message: `Invalid ${error.kind}: ${error.value}`,
        value: error.value,
      }],
    };
  }

  return {
    message: 'Database error',
    error: error.message,
  };
};

/**
 * Security headers middleware
 */
export const securityHeaders = (req: Request, res: Response, next: NextFunction) => {
  // Remove server header
  res.removeHeader('X-Powered-By');
  
  // Security headers
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  
  // CORS headers (if not using cors middleware)
  if (!res.getHeader('Access-Control-Allow-Origin')) {
    const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000'];
    const origin = req.headers.origin;
    
    if (origin && allowedOrigins.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
    }
  }

  next();
};

/**
 * Request timeout middleware
 */
export const timeoutHandler = (timeoutMs: number = 30000) => {
  return (req: Request, res: Response, next: NextFunction) => {
    // Set timeout for the request
    const timeout = setTimeout(() => {
      if (!res.headersSent) {
        logger.warn('Request timeout', {
          method: req.method,
          url: req.originalUrl,
          ip: req.ip,
          timeout: timeoutMs,
        });
        
        res.status(504).json({
          success: false,
          message: 'Request timeout',
          code: 'REQUEST_TIMEOUT',
        });
      }
    }, timeoutMs);

    // Clear timeout when response is sent
    res.on('finish', () => {
      clearTimeout(timeout);
    });

    // Clear timeout on error
    res.on('close', () => {
      clearTimeout(timeout);
    });

    next();
  };
};

/**
 * Graceful shutdown handler
 */
export const gracefulShutdown = (server: any) => {
  const signals = ['SIGTERM', 'SIGINT'];
  
  signals.forEach((signal) => {
    process.on(signal, () => {
      logger.info(`Received ${signal}, shutting down gracefully`);
      
      server.close(() => {
        logger.info('Server closed');
        process.exit(0);
      });

      // Force shutdown after 10 seconds
      setTimeout(() => {
        logger.error('Force shutting down');
        process.exit(1);
      }, 10000);
    });
  });

  process.on('unhandledRejection', (reason: any, promise: Promise<any>) => {
    logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
    // Don't crash the process, just log the error
  });

  process.on('uncaughtException', (error: Error) => {
    logger.error('Uncaught Exception:', error);
    process.exit(1);
  });
};
