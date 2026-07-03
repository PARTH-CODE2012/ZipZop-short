import { useEffect, useState } from 'react';
import { io } from 'socket.io-client';

let socket = null;

export function useJobProgress(jobId, token) {
  const [jobState, setJobState] = useState(null);
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    if (!jobId || !token) return;

    if (!socket) {
      socket = io(import.meta.env.VITE_API_BASE || 'http://localhost:3000', {
        auth: { token }
      });

      socket.on('connect', () => {
        console.log('✅ WebSocket connected');
        setIsConnected(true);
      });

      socket.on('disconnect', () => {
        console.log('🔌 WebSocket disconnected');
        setIsConnected(false);
      });

      socket.on('job-update', (data) => {
        console.log('📡 Job update:', data);
        setJobState(data);
      });
    }

    socket.emit('subscribe-job', jobId);

    return () => {
      socket.emit('unsubscribe-job', jobId);
    };
  }, [jobId, token]);

  return { jobState, isConnected };
}

export function closeWebSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}
