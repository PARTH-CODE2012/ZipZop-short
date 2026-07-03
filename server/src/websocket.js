import { Server } from 'socket.io';

const jobSubscriptions = new Map();

export function setupWebSocket(server) {
  const io = new Server(server, {
    cors: {
      origin: process.env.CLIENT_URL || 'http://localhost:5173',
      credentials: true
    }
  });

  io.on('connection', (socket) => {
    console.log(`✅ Socket connected: ${socket.id}`);

    socket.on('subscribe-job', (jobId) => {
      if (!jobSubscriptions.has(jobId)) {
        jobSubscriptions.set(jobId, new Set());
      }
      jobSubscriptions.get(jobId).add(socket.id);
      console.log(`📡 Socket ${socket.id} subscribed to job ${jobId}`);
    });

    socket.on('unsubscribe-job', (jobId) => {
      if (jobSubscriptions.has(jobId)) {
        jobSubscriptions.get(jobId).delete(socket.id);
        if (jobSubscriptions.get(jobId).size === 0) {
          jobSubscriptions.delete(jobId);
        }
      }
    });

    socket.on('disconnect', () => {
      console.log(`🔌 Socket disconnected: ${socket.id}`);
      for (const [jobId, sockets] of jobSubscriptions.entries()) {
        sockets.delete(socket.id);
      }
    });

    socket.on('ping', () => {
      socket.emit('pong');
    });
  });

  return io;
}

export function broadcastJobUpdate(io, jobId, state) {
  if (!jobSubscriptions.has(jobId)) return;

  const socketIds = Array.from(jobSubscriptions.get(jobId));
  
  for (const socketId of socketIds) {
    io.to(socketId).emit('job-update', {
      jobId,
      ...state,
      timestamp: new Date().toISOString()
    });
  }

  console.log(`📤 Broadcasted job update to ${socketIds.length} clients`);
}

export { jobSubscriptions };
