import { NextResponse } from 'next/server';
import connectDB from '@/lib/mongodb';
import Order from '@/models/Order';
import PrintJob from '@/models/PrintJob';
import { sendPrintJobFromOrder, generateDeliveryNumber } from '@/lib/printerClient';

/**
 * Helper function to process orders with completed payment but pending status
 */
async function processCompletedPaymentOrders() {
  try {
    // Find orders with completed payment but pending order status
    const pendingOrders = await Order.find({
      paymentStatus: 'completed',
      orderStatus: 'pending',
      orderType: 'file',
      fileURL: { $exists: true, $ne: null, $nin: [null, ''] }
    }).sort({ createdAt: -1 });

    console.log(`🔍 Checking for orders with completed payment...`);
    console.log(`📊 Found ${pendingOrders.length} orders matching criteria`);

    if (pendingOrders.length === 0) {
      // Log why no orders were found
      const totalCompleted = await Order.countDocuments({ paymentStatus: 'completed' });
      const totalPending = await Order.countDocuments({ orderStatus: 'pending' });
      const totalFileOrders = await Order.countDocuments({ orderType: 'file' });
      console.log(`📊 Stats: ${totalCompleted} completed payments, ${totalPending} pending orders, ${totalFileOrders} file orders`);
      return { processed: 0, skipped: 0, failed: 0 };
    }

    console.log(`🔄 Found ${pendingOrders.length} orders with completed payment but pending status`);
    console.log(`📋 Order IDs: ${pendingOrders.map(o => o.orderId).join(', ')}`);

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

    let processed = 0;
    let skipped = 0;
    let failed = 0;
    const failedOrders: Array<{ orderId: string; error: string }> = [];

    for (const order of pendingOrders) {
      try {
        // Check if print job already exists
        const existingPrintJob = await PrintJob.findOne({ orderId: order._id.toString() });

        if (existingPrintJob && existingPrintJob.status !== 'pending') {
          // Print job exists and is not pending, just update order status
          await Order.findByIdAndUpdate(order._id, {
            $set: {
              orderStatus: 'processing',
              status: 'processing'
            }
          });
          skipped++;
          console.log(`⏭️ Skipped order ${order.orderId} - print job already exists`);
          continue;
        }

        // Generate delivery number if not present
        let deliveryNumber = order.deliveryNumber;
        if (!deliveryNumber) {
          deliveryNumber = generateDeliveryNumber(printerIndex);
        }

        // Send print job to printer API
        console.log(`🖨️ Sending print job for order: ${order.orderId}`);
        console.log(`📄 File URL: ${order.fileURL}`);
        console.log(`🖨️ Printer URL: ${printerUrls[printerIndex - 1] || 'Not configured'}`);

        const printJobResult = await sendPrintJobFromOrder(order, printerIndex);

        console.log(`📊 Print job result for ${order.orderId}:`, {
          success: printJobResult.success,
          message: printJobResult.message,
          error: printJobResult.error,
          jobId: printJobResult.jobId,
          deliveryNumber: printJobResult.deliveryNumber
        });

        // Update delivery number from printer API response if provided
        if (printJobResult.deliveryNumber) {
          deliveryNumber = printJobResult.deliveryNumber;
        }

        // Only update order status if print job was successfully sent
        // If it failed, keep it as pending so it can be retried
        if (printJobResult.success) {
          await Order.findByIdAndUpdate(order._id, {
            $set: {
              orderStatus: 'processing',
              status: 'processing',
              deliveryNumber
            }
          });
        } else {
          // Keep order as pending if print job failed
          const errorMessage = printJobResult.error || printJobResult.message || 'Unknown error';
          console.warn(`⚠️ Print job failed for order ${order.orderId}, keeping status as pending for retry`);
          console.warn(`⚠️ Error: ${errorMessage}`);
          failedOrders.push({
            orderId: order.orderId,
            error: errorMessage
          });
        }

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
          // Update existing print job
          await PrintJob.findByIdAndUpdate(existingPrintJob._id, {
            $set: {
              status: printJobResult.success ? 'printing' : 'pending'
            }
          });
        }

        if (printJobResult.success) {
          processed++;
          console.log(`✅ Processed order ${order.orderId} - Status: processing, Delivery: ${deliveryNumber}`);
        } else {
          failed++;
          console.error(`❌ Failed to send print job for order ${order.orderId}: ${printJobResult.error || printJobResult.message}`);
        }
      } catch (error: any) {
        failed++;
        const errorMessage = error?.message || error?.toString() || 'Unknown error occurred';
        console.error(`❌ Error processing order ${order.orderId}:`, error);
        failedOrders.push({
          orderId: order.orderId,
          error: errorMessage
        });
      }
    }

    return { processed, skipped, failed, failedOrders };
  } catch (error) {
    console.error('Error in processCompletedPaymentOrders:', error);
    return { processed: 0, skipped: 0, failed: 0, failedOrders: [] };
  }
}

export async function GET(request: Request) {
  try {
    await connectDB();

    const url = new URL(request.url);
    const page = Math.max(1, parseInt(url.searchParams.get('page') || '1'));
    const limit = Math.max(1, Math.min(100, parseInt(url.searchParams.get('limit') || '10')));
    const skip = (page - 1) * limit;
    const nameSearch = url.searchParams.get('name') || '';
    const dateFrom = url.searchParams.get('dateFrom') || '';
    const dateTo = url.searchParams.get('dateTo') || '';
    const partnerId = url.searchParams.get('partnerId') || '';

    console.log(`🔍 ADMIN API - Fetching orders page ${page} (limit ${limit}) at ${new Date().toISOString()}`);

    // Build search filter
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const searchFilter: Record<string, any> = {};

    if (partnerId) {
      if (!searchFilter.$and) searchFilter.$and = [];
      searchFilter.$and.push({
        $or: [
          { partnerId: partnerId },
          { 'deliveryOption.partnerId': partnerId }
        ]
      });
    }

    if (nameSearch.trim()) {
      const nameRegex = { $regex: nameSearch.trim(), $options: 'i' };
      if (!searchFilter.$and) searchFilter.$and = [];
      searchFilter.$and.push({
        $or: [
          { 'studentInfo.name': nameRegex },
          { 'customerInfo.name': nameRegex },
        ]
      });
    }

    if (dateFrom || dateTo) {
      searchFilter.createdAt = {};
      if (dateFrom) {
        searchFilter.createdAt.$gte = new Date(dateFrom);
      }
      if (dateTo) {
        // Include the entire end day
        const endDate = new Date(dateTo);
        endDate.setHours(23, 59, 59, 999);
        searchFilter.createdAt.$lte = endDate;
      }
    }

    // Get total count and paginated orders in parallel
    const [totalCount, orders, pendingCount, printingCount, dispatchedCount, paymentPendingCount] = await Promise.all([
      Order.countDocuments(searchFilter),
      Order.find(searchFilter).sort({ createdAt: -1 }).skip(skip).limit(limit),
      Order.countDocuments({ orderStatus: 'pending' }),
      Order.countDocuments({ orderStatus: 'printing' }),
      Order.countDocuments({ orderStatus: 'dispatched' }),
      Order.countDocuments({ paymentStatus: 'pending' }),
    ]);

    // Phase 12: Calculate Financial Metrics (Total GMV, Platform 10%, Partner 90%)
    // To ensure accurate financials, we must calculate this across ALL matching completed orders, not just the paginated slice
    const allFinancials = await Order.find({ ...searchFilter, paymentStatus: 'completed' }).select('amount');
    const totalGMV = allFinancials.reduce((sum, order) => sum + (order.amount || 0), 0);
    const platformRevenue = Math.round(totalGMV * 0.10);
    const partnerPayouts = Math.round(totalGMV * 0.90);

    const totalPages = Math.ceil(totalCount / limit);

    console.log(`🔍 ADMIN API - Fetched ${orders.length} of ${totalCount} orders (page ${page}/${totalPages}) at ${new Date().toISOString()}`);

    return NextResponse.json({
      success: true,
      orders,
      timestamp: new Date().toISOString(),
      count: orders.length,
      totalCount,
      page,
      financials: {
        totalGMV,
        platformRevenue,
        partnerPayouts
      },
      limit,
      totalPages,
      statusCounts: {
        pending: pendingCount,
        printing: printingCount,
        dispatched: dispatchedCount,
        paymentPending: paymentPendingCount,
      },
    });
  } catch (error) {
    console.error('Error fetching orders:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch orders' },
      { status: 500 }
    );
  }
}
