import redis from 'redis';

let redisClient;

export async function setupRedis() {
  redisClient = redis.createClient({
    url: process.env.REDIS_URL || 'redis://localhost:6379'
  });

  redisClient.on('error', (err) => console.error('❌ Redis error:', err));
  redisClient.on('connect', () => console.log('✅ Redis connected'));

  await redisClient.connect();
  return redisClient;
}

export async function setJobState(jobId, state) {
  try {
    await redisClient.setEx(
      `job:${jobId}`,
      86400,
      JSON.stringify(state)
    );
  } catch (err) {
    console.error(`❌ Redis set error: ${err}`);
  }
}

export async function getJobState(jobId) {
  try {
    const data = await redisClient.get(`job:${jobId}`);
    return data ? JSON.parse(data) : null;
  } catch (err) {
    console.error(`❌ Redis get error: ${err}`);
    return null;
  }
}

export { redisClient };
