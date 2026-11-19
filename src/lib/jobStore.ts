/**
 * Redis-backed job store for PDF generation status
 * Uses Upstash Redis for persistence across serverless function instances
 */
import { Redis } from '@upstash/redis';

export interface JobStatus {
  jobId: string;
  /** The user who started the job; only they can read its status */
  userId?: string;
  wordUrl: string;
  pdfUrl?: string;
  status: 'processing' | 'completed' | 'failed';
  error?: string;
  createdAt: number;
}

if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
  // Fail at startup so the deployment log shows the problem immediately
  throw new Error('UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN must be set');
}

// Initialize Upstash Redis client
const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

const JOB_KEY_PREFIX = 'job:';
const JOB_TTL_SECONDS = 3600; // 1 hour TTL

/**
 * Redis-backed job store with the same interface as the old Map-based store
 */
export const jobStore = {
  /**
   * Get a job by ID from Redis
   */
  async get(jobId: string): Promise<JobStatus | null> {
    try {
      const data = await redis.get<JobStatus>(`${JOB_KEY_PREFIX}${jobId}`);
      return data || null;
    } catch (error) {
      console.error(`❌ Redis GET error for job ${jobId}:`, error);
      return null;
    }
  },

  /**
   * Set a job in Redis with auto-expiry
   */
  async set(jobId: string, data: JobStatus): Promise<void> {
    try {
      await redis.set(`${JOB_KEY_PREFIX}${jobId}`, data, { ex: JOB_TTL_SECONDS });
    } catch (error) {
      console.error(`❌ Redis SET error for job ${jobId}:`, error);
    }
  },

  /**
   * Delete a job from Redis
   */
  async delete(jobId: string): Promise<void> {
    try {
      await redis.del(`${JOB_KEY_PREFIX}${jobId}`);
    } catch (error) {
      console.error(`❌ Redis DELETE error for job ${jobId}:`, error);
    }
  },
};

// Export redis instance for use by rate limiter
export { redis };
