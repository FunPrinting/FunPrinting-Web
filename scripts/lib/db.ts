/**
 * Database connection for one-off scripts run with ts-node.
 *
 * Scripts can't import src/lib/mongodb: it is marked 'server-only' and uses the
 * `@/` path alias, neither of which works under plain Node.
 */
import path from 'path';
import dotenv from 'dotenv';
import mongoose from 'mongoose';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

export default async function connectDB() {
  const uri = process.env.MONGODB_URI?.trim();
  if (!uri) throw new Error('MONGODB_URI is not set (looked in the environment, .env.local and .env)');
  if (mongoose.connection.readyState !== 1) {
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
  }
  return mongoose.connection;
}
