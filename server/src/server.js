import express from 'express';
import { createServer } from 'http';
import cors from 'cors';
import dotenv from 'dotenv';
import { setupWebSocket, broadcastJobUpdate } from './websocket.js';
import { setupDatabase } from './db.js';
import { setupRedis } from './redis.js';
import authRoutes from './routes/auth.js';
import videoRoutes from './routes/videos.js';
import captionRoutes from './routes/captions.js';
import clippingRoutes from './routes/clipping.js';

dotenv.config();

const app = express();
const httpServer = createServer(app);

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Setup WebSocket
export const io = setupWebSocket(httpServer);

// Setup Database
await setupDatabase();

// Setup Redis
export const redis = await setupRedis();

// Store io and redis in app
app.use((req, res, next) => {
  req.io = io;
  req.redis = redis;
  req.broadcastJobUpdate = broadcastJobUpdate;
  next();
});

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/videos', videoRoutes);
app.use('/api/captions', captionRoutes);
app.use('/api/clipping', clippingRoutes);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('❌ Error:', err);
  res.status(500).json({ error: err.message });
});

// Start server
const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});

export default app;
