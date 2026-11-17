/**
 * Migration script to fix missing fileType in existing orders
 * Detects fileType from originalFileName, originalFileNames, or fileURL
 */

import mongoose from 'mongoose';
import connectDB from './lib/db';
import Order from '../src/models/Order';
import { getFileTypeFromFilename, getFileTypeFromFileNames } from '../src/lib/fileTypeDetection';

async function fixFileTypes() {
  try {
    console.log('🔌 Connecting to database...');
    await connectDB();
    console.log('✅ Connected to database');

    // Find all orders with missing or null fileType
    const orders = await Order.find({
      $or: [
        { fileType: null },
        { fileType: { $exists: false } },
        { fileType: '' }
      ],
      orderType: 'file'
    });

    console.log(`📋 Found ${orders.length} orders with missing fileType`);

    let updated = 0;
    let skipped = 0;

    for (const order of orders) {
      let detectedFileType: string | null = null;

      // Try to detect from originalFileNames array (multi-file)
      if (order.originalFileNames && Array.isArray(order.originalFileNames) && order.originalFileNames.length > 0) {
        detectedFileType = getFileTypeFromFileNames(order.originalFileNames, order.fileURLs);
        console.log(`  📄 Order ${order.orderId}: Detected from originalFileNames array: ${detectedFileType}`);
      }
      // Try to detect from originalFileName (single file)
      else if (order.originalFileName) {
        detectedFileType = getFileTypeFromFilename(order.originalFileName, order.fileURL);
        console.log(`  📄 Order ${order.orderId}: Detected from originalFileName: ${detectedFileType}`);
      }
      // Try to detect from fileURL
      else if (order.fileURL) {
        const urlMatch = order.fileURL.match(/\/([^\/]+\.(?:pdf|jpg|jpeg|png|doc|docx))(?:\?|$)/i);
        if (urlMatch && urlMatch[1]) {
          detectedFileType = getFileTypeFromFilename(urlMatch[1], order.fileURL);
          console.log(`  📄 Order ${order.orderId}: Detected from fileURL: ${detectedFileType}`);
        }
      }
      // Try to detect from fileURLs array
      else if (order.fileURLs && Array.isArray(order.fileURLs) && order.fileURLs.length > 0) {
        const firstUrl = order.fileURLs[0];
        const urlMatch = firstUrl.match(/\/([^\/]+\.(?:pdf|jpg|jpeg|png|doc|docx))(?:\?|$)/i);
        if (urlMatch && urlMatch[1]) {
          detectedFileType = getFileTypeFromFilename(urlMatch[1], firstUrl);
          console.log(`  📄 Order ${order.orderId}: Detected from fileURLs[0]: ${detectedFileType}`);
        }
      }

      if (detectedFileType && detectedFileType !== 'application/octet-stream') {
        order.fileType = detectedFileType;
        await order.save();
        updated++;
        console.log(`  ✅ Updated order ${order.orderId} with fileType: ${detectedFileType}`);
      } else {
        skipped++;
        console.log(`  ⚠️  Skipped order ${order.orderId}: Could not detect fileType`);
      }
    }

    console.log(`\n📊 Summary:`);
    console.log(`  ✅ Updated: ${updated} orders`);
    console.log(`  ⚠️  Skipped: ${skipped} orders`);
    console.log(`  📋 Total processed: ${orders.length} orders`);

    await mongoose.connection.close();
    console.log('🔌 Database connection closed');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error fixing fileTypes:', error);
    await mongoose.connection.close();
    process.exit(1);
  }
}

// Run the migration
fixFileTypes();

