import 'server-only';
import mongoose from 'mongoose';
import { getServerEnv } from '@/lib/env';
import { logger } from '@/lib/logger';

/**
 * Shared mongoose connection.
 *
 * On serverless platforms each warm instance reuses one connection. Concurrent callers
 * during a cold start share the same pending promise instead of opening several.
 */
type Cache = { promise: Promise<typeof mongoose> | null };
const globalForMongoose = globalThis as unknown as { __fpMongoose?: Cache };
const cache: Cache = globalForMongoose.__fpMongoose ?? { promise: null };
globalForMongoose.__fpMongoose = cache;

async function connectDB() {
  if (mongoose.connection.readyState === 1) return mongoose.connection;

  if (!cache.promise) {
    // Throws a readable EnvError listing every missing/invalid variable
    const { MONGODB_URI } = getServerEnv();
    cache.promise = mongoose.connect(MONGODB_URI, {
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
    });
  }

  try {
    await cache.promise;
    return mongoose.connection;
  } catch (error) {
    cache.promise = null; // allow the next request to retry
    logger.error({ err: error }, 'MongoDB connection failed');
    throw error;
  }
}

export default connectDB;
