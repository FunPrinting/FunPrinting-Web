import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import connectDB from '@/lib/mongodb';
import Order from '@/models/Order';
import PrintJob from '@/models/PrintJob';
import { sendPrintJobFromOrder, generateDeliveryNumber } from '@/lib/printerClient';

/**
 * POST /api/printer/process-pending
 * Process all orders with completed payment but no print job sent
 */
export async function POST(_request: NextRequest) {
  const auth = await requireAdmin();
  if (auth instanceof NextResponse) return auth;

  try {
    await connectDB();

    // Find all orders with completed payment but no print job or pending print job
    // Support both single file (fileURL) and multiple files (fileURLs)
    const orders = await Order.find({
      paymentStatus: 'completed',
      orderType: 'file',
      $or: [
        { fileURL: { $exists: true, $ne: null } },
        { fileURLs: { $exists: true, $ne: null, $not: { $size: 0 } } }
      ]
    }).sort({ createdAt: -1 });

    console.log(`📋 Found ${orders.length} orders with completed payment`);

    // Determine printer index
    let printerUrls: string[] = [];
    const urlsEnv = process.env.PRINTER_API_URLS;
    if (urlsEnv) {
      const trimmed = urlsEnv.trim();
      if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
        try {
          printerUrls = JSON.parse(trimmed);
          if (!Array.isArray(printerUrls)) printerUrls = [];
        } catch {
          const urlMatch = trimmed.match(/\[(.*?)\]/);
          if (urlMatch && urlMatch[1]) {
            printerUrls = [urlMatch[1].trim()];
          }
        }
      } else {
        printerUrls = trimmed.split(',').map(url => url.trim()).filter(url => url.length > 0);
        if (printerUrls.length === 0 && trimmed.length > 0) {
          printerUrls = [trimmed];
        }
      }
      printerUrls = printerUrls.map(url => url.replace(/\/+$/, ''));
    }
    const printerIndex = printerUrls.length > 0 ? 1 : 1;

    const results = {
      processed: 0,
      skipped: 0,
      failed: 0,
      orders: [] as Array<{ orderId: string; status: string; message: string }>
    };

    for (const order of orders) {
      try {
        // Check if print job already exists and is not pending
        const existingPrintJob = await PrintJob.findOne({ orderId: order._id.toString() });

        if (existingPrintJob && existingPrintJob.status !== 'pending') {
          console.log(`⏭️ Skipping order ${order.orderId} - print job already exists with status: ${existingPrintJob.status}`);
          results.skipped++;
          results.orders.push({
            orderId: order.orderId,
            status: 'skipped',
            message: `Print job already exists with status: ${existingPrintJob.status}`
          });
          continue;
        }

        // Generate delivery number if not present
        let deliveryNumber = order.deliveryNumber;
        if (!deliveryNumber) {
          deliveryNumber = generateDeliveryNumber(printerIndex);
          await Order.findByIdAndUpdate(order._id, {
            $set: { deliveryNumber }
          });
        }

        // Check if print job was already sent (prevent duplicates)
        // The printer-api deduplication should handle this, but we check here too
        console.log(`🖨️ Processing print job for order: ${order.orderId}`);

        // Only send if order hasn't been processed yet
        if (existingPrintJob && existingPrintJob.status === 'completed') {
          console.log(`⏭️ Skipping order ${order.orderId} - already completed`);
          results.skipped++;
          results.orders.push({
            orderId: order.orderId,
            status: 'skipped',
            message: 'Print job already completed'
          });
          continue;
        }

        const printJobResult = await sendPrintJobFromOrder(order, printerIndex);

        if (printJobResult.success) {
          // Update order status to 'printing' and delivery number
          const updateFields: any = { orderStatus: 'printing', status: 'printing' };
          if (printJobResult.deliveryNumber) {
            updateFields.deliveryNumber = printJobResult.deliveryNumber;
          }
          await Order.findByIdAndUpdate(order._id, { $set: updateFields });

          // Create or update print job record
          if (!existingPrintJob) {
            const estimatedDuration = Math.ceil(
              ((order.printingOptions.pageCount || 1) * order.printingOptions.copies * 0.5) +
              (order.printingOptions.color === 'color' ? (order.printingOptions.pageCount || 1) * 0.3 : 0)
            );

            const newPrintJob = new PrintJob({
              orderId: order._id.toString(),
              orderNumber: order.orderId,
              customerName: order.customerInfo.name,
              customerEmail: order.customerInfo.email,
              fileURL: order.fileURL,
              fileName: order.originalFileName || 'document.pdf',
              fileType: order.fileType || 'application/pdf',
              printingOptions: order.printingOptions,
              priority: 'normal',
              estimatedDuration,
              status: printJobResult.success ? 'printing' : 'pending'
            });

            await newPrintJob.save();
          } else {
            // Update existing pending print job
            await PrintJob.findByIdAndUpdate(existingPrintJob._id, {
              $set: {
                status: printJobResult.success ? 'printing' : 'pending'
              }
            });
          }

          results.processed++;
          results.orders.push({
            orderId: order.orderId,
            status: 'success',
            message: printJobResult.message || 'Print job sent successfully'
          });
          console.log(`✅ Print job processed for order: ${order.orderId}`);
        } else {
          results.failed++;
          results.orders.push({
            orderId: order.orderId,
            status: 'failed',
            message: printJobResult.message || printJobResult.error || 'Failed to send print job'
          });
          console.warn(`⚠️ Failed to send print job for order: ${order.orderId} - ${printJobResult.message}`);
        }
      } catch (error: any) {
        results.failed++;
        results.orders.push({
          orderId: order.orderId,
          status: 'error',
          message: error.message || 'Unknown error'
        });
        console.error(`❌ Error processing order ${order.orderId}:`, error);
      }
    }

    return NextResponse.json({
      success: true,
      message: `Processed ${results.processed} orders, skipped ${results.skipped}, failed ${results.failed}`,
      results
    });
  } catch (error) {
    console.error('Error processing pending print jobs:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to process pending print jobs' },
      { status: 500 }
    );
  }
}

