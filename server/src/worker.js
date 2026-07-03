import { Queue } from 'bull';
import { setJobState } from './redis.js';
import { setupRedis } from './redis.js';
import { setupDatabase } from './db.js';
import { processVideoV10 } from './services/ffmpeg-v10-engine.js';
import { analyzeVideoForClips } from './services/ai-clipping-engine.js';

// Initialize
await setupDatabase();
const redis = await setupRedis();

// V10 Video Processing Queue
const videoQueue = new Queue('videos', process.env.REDIS_URL || 'redis://localhost:6379');

videoQueue.process(async (job) => {
  const { jobId, filename, colorGrade = 'vibrant' } = job.data;

  console.log(`\n🎬 Worker: Processing V10 job ${jobId}`);

  try {
    await setJobState(jobId, {
      status: 'processing',
      step: 'Initializing V10 engine...',
      progress: 5,
      timestamp: new Date().toISOString()
    });

    const result = await processVideoV10(
      `./data/uploads/${filename}`,
      jobId,
      {
        colorGrade,
        targetFormat: 'reels',
        enableGPU: true
      }
    );

    if (!result.success) {
      throw new Error('V10 processing failed');
    }

    const finalState = {
      status: 'completed',
      jobId,
      videoUrl: `/api/videos/${jobId}/download`,
      metrics: result.metrics,
      processingTime: result.metrics.totalTimeSeconds,
      gpuUsed: result.metrics.gpu,
      progress: 100,
      timestamp: new Date().toISOString()
    };

    await setJobState(jobId, finalState);

    console.log(`✅ V10 Job ${jobId} completed`);
    return finalState;

  } catch (err) {
    console.error(`❌ V10 Job ${jobId} failed: ${err.message}`);

    const errorState = {
      status: 'failed',
      jobId,
      error: err.message,
      timestamp: new Date().toISOString()
    };

    await setJobState(jobId, errorState);
    throw err;
  }
});

// AI Clipping Queue
const clippingQueue = new Queue('clipping', process.env.REDIS_URL || 'redis://localhost:6379');

clippingQueue.process(async (job) => {
  const { jobId, filename } = job.data;

  console.log(`\n🎬 Worker: Analyzing ${filename} for clips`);

  try {
    await setJobState(jobId, {
      status: 'processing',
      step: 'Extracting audio...',
      progress: 10,
      timestamp: new Date().toISOString()
    });

    const result = await analyzeVideoForClips(
      `./data/uploads/${filename}`,
      jobId
    );

    if (result.status !== 'completed') {
      throw new Error(result.error || 'Analysis failed');
    }

    const finalState = {
      ...result,
      status: 'completed',
      progress: 100
    };

    await setJobState(jobId, finalState);

    console.log(`✅ Clipping analysis complete: ${jobId}`);
    return finalState;

  } catch (err) {
    console.error(`❌ Clipping job failed: ${err.message}`);

    const errorState = {
      jobId,
      status: 'failed',
      error: err.message,
      timestamp: new Date().toISOString()
    };

    await setJobState(jobId, errorState);
    throw err;
  }
});

videoQueue.on('completed', (job, result) => {
  console.log(`✅ V10 job completed: ${job.id}`);
});

videoQueue.on('failed', (job, err) => {
  console.error(`❌ V10 job failed: ${job.id}`);
});

clippingQueue.on('completed', (job, result) => {
  console.log(`✅ Clipping job completed: ${job.id}`);
});

clippingQueue.on('failed', (job, err) => {
  console.error(`❌ Clipping job failed: ${job.id}`);
});

console.log('🏭 Worker started - V10 Engine + AI Clipping Ready');
