import winston from 'winston';
import path from 'path';

// Define log levels
const levels = {
  error: 0,
  warn: 1,
  info: 2,
  http: 3,
  debug: 4,
};

// Define colors for each level
const colors = {
  error: 'red',
  warn: 'yellow',
  info: 'green',
  http: 'magenta',
  debug: 'white',
};

// Tell winston that these colors are available
winston.addColors(colors);

// Define format for console output
const consoleFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss:ms' }),
  winston.format.colorize({ all: true }),
  winston.format.printf((info) => {
    const { timestamp, level, message, ...args } = info;
    const argsStr = Object.keys(args).length ? JSON.stringify(args, null, 2) : '';
    return `${timestamp} [${level}]: ${message} ${argsStr}`;
  })
);

// Define format for file output
const fileFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss:ms' }),
  winston.format.errors({ stack: true }),
  winston.format.json()
);

// Define the logger
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  levels,
  format: fileFormat,
  transports: [
    // Console transport
    new winston.transports.Console({
      format: consoleFormat,
      level: process.env.NODE_ENV === 'development' ? 'debug' : 'info',
    }),

    // File transport for errors
    new winston.transports.File({
      filename: path.join(process.cwd(), 'logs', 'error.log'),
      level: 'error',
      maxsize: 5242880, // 5MB
      maxFiles: 5,
      format: fileFormat,
    }),

    // File transport for all logs
    new winston.transports.File({
      filename: path.join(process.cwd(), 'logs', 'combined.log'),
      maxsize: 5242880, // 5MB
      maxFiles: 5,
      format: fileFormat,
    }),
  ],

  // Handle exceptions and rejections
  exceptionHandlers: [
    new winston.transports.File({
      filename: path.join(process.cwd(), 'logs', 'exceptions.log'),
    }),
  ],

  rejectionHandlers: [
    new winston.transports.File({
      filename: path.join(process.cwd(), 'logs', 'rejections.log'),
    }),
  ],

  exitOnError: false,
});

// Create logs directory if it doesn't exist
import fs from 'fs';
const logsDir = path.join(process.cwd(), 'logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

// Add request logging utility
export const requestLogger = (req: any, res: any, next: any) => {
  const startTime = Date.now();
  
  res.on('finish', () => {
    const duration = Date.now() - startTime;
    const logData = {
      method: req.method,
      url: req.originalUrl || req.url,
      status: res.statusCode,
      duration: `${duration}ms`,
      userAgent: req.get('User-Agent') || '',
      ip: req.ip || req.connection.remoteAddress,
      userId: req.user?.id || 'anonymous',
    };

    if (res.statusCode >= 400) {
      logger.warn('HTTP Request', logData);
    } else {
      logger.http('HTTP Request', logData);
    }
  });

  next();
};

// Error logging utility
export const errorLogger = (error: Error, req?: any) => {
  const errorData = {
    message: error.message,
    stack: error.stack,
    url: req?.originalUrl || req?.url,
    method: req?.method,
    userId: req?.user?.id,
    ip: req?.ip || req?.connection?.remoteAddress,
    userAgent: req?.get?.('User-Agent'),
    timestamp: new Date().toISOString(),
  };

  logger.error('Application Error', errorData);
};

// Performance logging utility
export const performanceLogger = {
  start: (label: string) => {
    return {
      label,
      startTime: Date.now(),
      end: function() {
        const duration = Date.now() - this.startTime;
        logger.debug(`Performance: ${this.label} took ${duration}ms`);
        return duration;
      }
    };
  }
};

// Database operation logger
export const dbLogger = {
  query: (operation: string, collection: string, query: any, duration?: number) => {
    logger.debug('Database Query', {
      operation,
      collection,
      query: JSON.stringify(query),
      duration: duration ? `${duration}ms` : undefined,
    });
  },

  error: (operation: string, collection: string, error: Error, query?: any) => {
    logger.error('Database Error', {
      operation,
      collection,
      error: error.message,
      stack: error.stack,
      query: query ? JSON.stringify(query) : undefined,
    });
  }
};

export { logger };
