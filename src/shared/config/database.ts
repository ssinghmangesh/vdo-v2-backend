import mongoose from 'mongoose';
import { logger } from '../utils/logger';

interface DatabaseConnection {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  isConnected(): boolean;
}

class Database implements DatabaseConnection {
  private isConnectedFlag: boolean = false;

  async connect(): Promise<void> {
    try {
      const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/videocall-db';
      
      const options: mongoose.ConnectOptions = {
        maxPoolSize: 10, // Maintain up to 10 socket connections
        serverSelectionTimeoutMS: 5000, // Keep trying to send operations for 5 seconds
        socketTimeoutMS: 45000, // Close sockets after 45 seconds of inactivity
        bufferCommands: false, // Disable mongoose buffering
        bufferMaxEntries: 0, // Disable mongoose buffering
      };

      await mongoose.connect(mongoUri, options);
      
      this.isConnectedFlag = true;
      logger.info(`Database connected: ${mongoUri.replace(/\/\/.*@/, '//***@')}`);
      
      // Handle connection events
      mongoose.connection.on('error', (error) => {
        logger.error('Database connection error:', error);
        this.isConnectedFlag = false;
      });

      mongoose.connection.on('disconnected', () => {
        logger.warn('Database disconnected');
        this.isConnectedFlag = false;
      });

      mongoose.connection.on('reconnected', () => {
        logger.info('Database reconnected');
        this.isConnectedFlag = true;
      });

      // Handle app termination
      process.on('SIGINT', async () => {
        await this.disconnect();
        process.exit(0);
      });

      process.on('SIGTERM', async () => {
        await this.disconnect();
        process.exit(0);
      });

    } catch (error) {
      logger.error('Database connection failed:', error);
      this.isConnectedFlag = false;
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    try {
      await mongoose.connection.close();
      this.isConnectedFlag = false;
      logger.info('Database connection closed');
    } catch (error) {
      logger.error('Error closing database connection:', error);
      throw error;
    }
  }

  isConnected(): boolean {
    return this.isConnectedFlag && mongoose.connection.readyState === 1;
  }

  async healthCheck(): Promise<{ status: string; details: any }> {
    try {
      const adminDb = mongoose.connection.db?.admin();
      const serverStatus = await adminDb?.serverStatus();
      
      return {
        status: this.isConnected() ? 'healthy' : 'unhealthy',
        details: {
          readyState: mongoose.connection.readyState,
          host: mongoose.connection.host,
          name: mongoose.connection.name,
          serverVersion: serverStatus?.version,
          uptime: serverStatus?.uptime,
          connections: serverStatus?.connections
        }
      };
    } catch (error) {
      return {
        status: 'error',
        details: {
          error: error instanceof Error ? error.message : 'Unknown error',
          readyState: mongoose.connection.readyState
        }
      };
    }
  }
}

// Export singleton instance
export const database = new Database();

// Export connection readiness states for reference
export const ConnectionStates = {
  DISCONNECTED: 0,
  CONNECTED: 1,
  CONNECTING: 2,
  DISCONNECTING: 3
} as const;