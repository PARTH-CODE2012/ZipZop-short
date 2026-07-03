import express from 'express';
import { Queue } from 'bull';
import { setJobState, getJobState } from '../redis.js';
import { authenticate } from '../middleware/auth.js';

const router = express.Router();
const clippingQueue = new Queue('clipping', process.env.REDIS_URL || 'redis://localhost:6379');

router.post('/analyze', authenticate, async (req, res) => {
  try {
    const { filename } = req.body;

    if (!filename) {
      return res.status(400).json({ error: 'Filename required' });
    }

    const jobId = `clip_${Date.now()}`;

    await setJobState(jobId, {
      status: 'queued',
      jobId,
      step: 'Waiting in analysis queue...',
      progress: 0,
      service: 'AI Clipping Engine',
      timestamp: new Date().toISOString()
    });

    await clippingQueue.add({
      jobId,
      filename,
      userId: req.user.id
    }, {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 2000
      }
    });

    req.io.emit('clipping-job-created', {
      jobId,
      status: 'queued'
    });

    res.json({
      jobId,
      status: 'queued',
      message: 'Video analysis started'
    });

  } catch (err) {
    console.error('❌ Analysis request error:', err);
    res.status(500).json({ error: err.message });
  }
});

router.get('/:jobId/status', authenticate, async (req, res) => {
  try {
    const { jobId } = req.params;
    const state = await getJobState(jobId);

    if (!state) {
      return res.status(404).json({ error: 'Analysis not found' });
    }

    res.json(state);

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:jobId/clips', authenticate, async (req, res) => {
  try {
    const { jobId } = req.params;
    const state = await getJobState(jobId);

    if (!state) {
      return res.status(404).json({ error: 'Analysis not found' });
    }

    if (state.status !== 'completed') {
      return res.status(202).json({
        status: state.status,
        progress: state.progress,
        message: 'Analysis in progress'
      });
    }

    res.json({
      jobId,
      clips: state.recommendations || [],
      summary: state.summary || {},
      analysisData: state.analysisData || {}
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:jobId/export', authenticate, async (req, res) => {
  try {
    const { jobId } = req.params;
    const { format = 'json' } = req.body;

    const state = await getJobState(jobId);

    if (!state || state.status !== 'completed') {
      return res.status(404).json({ error: 'Analysis not complete' });
    }

    const clips = state.recommendations || [];

    let output;
    let contentType;
    let filename;

    if (format === 'csv') {
      output = 'Start Time,End Time,Duration,Type,Reason,Score\n';
      output += clips.map(clip =>
        `${clip.start},${clip.end},${clip.duration},${clip.type},"${clip.reason}",${clip.score.toFixed(2)}`
      ).join('\n');
      contentType = 'text/csv';
      filename = `${jobId}_clips.csv`;

    } else if (format === 'vtt') {
      output = 'WEBVTT\n\n';
      output += clips.map((clip, idx) =>
        `${formatTime(clip.start)} --> ${formatTime(clip.end)}\n${clip.reason}\n\n`
      ).join('');
      contentType = 'text/vtt';
      filename = `${jobId}_clips.vtt`;

    } else {
      output = JSON.stringify(clips, null, 2);
      contentType = 'application/json';
      filename = `${jobId}_clips.json`;
    }

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(output);

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function formatTime(seconds) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export default router;
