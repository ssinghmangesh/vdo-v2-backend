import express from 'express';
import cors from 'cors';
import { config } from 'dotenv';

// Load environment variables
config();

const app = express();
const PORT = process.env.API_PORT || 4000;

// Basic middleware
app.use(cors());
app.use(express.json());

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    message: 'API server is running!',
    timestamp: new Date().toISOString(),
    port: PORT
  });
});

// Test MongoDB connection
app.get('/api/test-db', async (req, res) => {
  try {
    const mongoose = require('mongoose');
    const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/videocall-db';
    
    await mongoose.connect(mongoUri);
    console.log('✅ Database connected successfully!');
    
    res.json({
      success: true,
      message: 'Database connection successful!',
      uri: mongoUri.replace(/\/\/.*@/, '//***@')
    });
  } catch (error) {
    console.error('❌ Database connection failed:', error);
    res.status(500).json({
      success: false,
      message: 'Database connection failed',
      error: error.message
    });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Test API Server started successfully!`);
  console.log(`📍 Server running on http://localhost:${PORT}`);
  console.log(`🔍 Health check: http://localhost:${PORT}/api/health`);
  console.log(`💾 Database test: http://localhost:${PORT}/api/test-db`);
});
