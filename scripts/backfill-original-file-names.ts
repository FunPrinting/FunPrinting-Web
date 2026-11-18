/* 
  Backfill script: Ensure `originalFileNames` matches `fileURLs` length on existing orders.
  Usage:
    ts-node scripts/backfill-original-file-names.ts
*/
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import Order from '../src/models/Order';
import connectDB from './lib/db';

async function run() {
  try {
    // Load environment
    dotenv.config({ path: path.resolve(process.cwd(), '.env') });
    await connectDB();

    const cursor = (Order as any).find({}).cursor();
    let updated = 0;
    for await (const doc of cursor) {
      const order = doc.toObject ? doc.toObject() : doc;
      const fileURLs: string[] = Array.isArray(order.fileURLs) ? order.fileURLs : [];
      const singleURL: string | undefined = order.fileURL;
      let names: string[] = Array.isArray(order.originalFileNames) ? order.originalFileNames : [];

      // Derive fileURLs array from legacy if needed
      const effectiveURLs = fileURLs.length > 0 ? fileURLs : (singleURL ? [singleURL] : []);
      if (effectiveURLs.length === 0) continue;

      // Pad or trim originalFileNames
      if (names.length !== effectiveURLs.length) {
        const out = [...names];
        while (out.length < effectiveURLs.length) {
          out.push(`File ${out.length + 1}`);
        }
        names = out.slice(0, effectiveURLs.length);
        await Order.updateOne({ _id: order._id }, { $set: { originalFileNames: names } });
        updated++;
        console.log(`✅ Updated order ${order.orderId}: names -> ${JSON.stringify(names)}`);
      }
    }

    console.log(`Done. Updated ${updated} orders.`);
    await mongoose.connection.close();
  } catch (err) {
    console.error('Backfill failed:', err);
    process.exitCode = 1;
  }
}

run();


