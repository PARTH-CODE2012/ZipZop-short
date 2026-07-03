import express from 'express';
import { Queue } from 'bull';
import { setJobState, getJobState } from '../redis.js';
import { authenticate } from '../middleware/auth.js';
import multer from 'multer';
import path from 'path';
import fs from 'fs/promises';

const router = express.Router();
const videoQueue = new Queue('videos', process.env.REDIS_URL || 'redis://localhost:6379');

const upload = multer({
  dest: './data/uploads',
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (['.mp4', '.avi', '.mov', '.mkv'].includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid video format'));
    }
  }
});

router.post('/upload', authenticate, upload.single('video'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    res.json({
      ok: true,
      filename: req.file.filename,
      size: req.file.size
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/process-v10', authenticate, async (req, res) => {
  try {
    const { filename, colorGrade = 'vibrant' } = req.body;
    
    if (!filename) {
      return res.status(400).json({ error: 'Filename required' });
    }

    const jobId = `v10_${Date.now()}`;

    await setJobState(jobId, {
      status: 'queued',
      jobId,
      step: 'Waiting in queue...',
      progress: 0,
      engine: 'V10',
      timestamp: new Date().toISOString()
    });

    await videoQueue.add({
      jobId,
      filename,
      colorGrade,
      engine: 'V10'
    }, {
      priority: 1,
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 2000
      }
    });

    req.io.emit('job-created', {
      jobId,
      status: 'queued',
      engine: 'V10'
    });

    res.json({
      jobId,
      status: 'queued',
      message: 'V10 processing started',
      engine: 'V10 (GPU Accelerated)'
    });

  } catch (err) {
    console.error('❌ Job creation error:', err);
    res.status(500).json({ error: err.message });
  }
});

router.get('/:jobId/status', authenticate, async (req, res) => {
  try {
    const { jobId } = req.params;
    const state = await getJobState(jobId);

    if (!state) {
      return res.status(404).json({ error: 'Job not found' });
    }

    res.json(state);

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
