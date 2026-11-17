import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import connectDB from '@/lib/mongodb';
import Order from '@/models/Order';
import { sendPrintJobFromOrder, generateDeliveryNumber } from '@/lib/printerClient';

/**
 * POST /api/printer
 * Send print job to printer API
 */
export async function POST(request: NextRequest) {
  const auth = await requireAdmin();
  if (auth instanceof NextResponse) return auth;

  try {
    await connectDB();

    const body = await request.json();
    const { orderId, printerIndex } = body;

    if (!orderId) {
      return NextResponse.json(
        { success: false, error: 'Order ID is required' },
        { status: 400 }
      );
    }

    // Find order - ensure all fields are retrieved
    const order = await Order.findOne({ orderId });
    if (!order) {
      return NextResponse.json(
        { success: false, error: 'Order not found' },
        { status: 404 }
      );
    }

    // Log order data retrieved from database
    console.log('📋 Order data retrieved from database:', {
      orderId: order.orderId,
      customerInfo: order.customerInfo,
      studentInfo: (order as any).studentInfo,
      orderType: order.orderType,
      amount: order.amount,
      expectedDate: order.expectedDate,
      hasCustomerInfo: !!order.customerInfo,
      hasStudentInfo: !!(order as any).studentInfo,
      hasOrderType: !!order.orderType,
      hasAmount: !!order.amount,
      hasExpectedDate: !!order.expectedDate
    });

    // Validate required fields
    if (!order.orderType) {
      console.error('❌ Order is missing required field: orderType');
      return NextResponse.json(
        {
          success: false,
          error: 'Order is missing required field: orderType. Cannot create order summary without order type.'
        },
        { status: 400 }
      );
    }

    const hasCustomerInfo = !!order.customerInfo;
    const hasStudentInfo = !!(order as any).studentInfo;
    if (!hasCustomerInfo && !hasStudentInfo) {
      console.error('❌ Order is missing required field: customerInfo or studentInfo');
      return NextResponse.json(
        {
          success: false,
          error: 'Order is missing required field: customerInfo or studentInfo. Cannot create order summary without customer information.'
        },
        { status: 400 }
      );
    }

    // Check if order is paid
    if (order.paymentStatus !== 'completed') {
      return NextResponse.json(
        { success: false, error: 'Order payment not completed' },
        { status: 400 }
      );
    }

    // Check if order has file(s) - support both single file and multiple files
    const hasMultipleFiles = order.fileURLs && order.fileURLs.length > 0;
    const hasSingleFile = order.fileURL && !hasMultipleFiles;

    if (!hasMultipleFiles && !hasSingleFile) {
      return NextResponse.json(
        { success: false, error: 'Order has no file to print' },
        { status: 400 }
      );
    }

    // Determine printer index
    let printerUrls: string[] = [];
    const urlsEnv = process.env.PRINTER_API_URLS;
    if (urlsEnv) {
      const trimmed = urlsEnv.trim();
      // Check if it looks like a JSON array (starts with [ and ends with ])
      if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
        try {
          printerUrls = JSON.parse(trimmed);
          // Ensure it's an array
          if (!Array.isArray(printerUrls)) {
            printerUrls = [];
          }
        } catch {
          // Invalid JSON array format like [https://...] - extract URL from brackets
          const urlMatch = trimmed.match(/\[(.*?)\]/);
          if (urlMatch && urlMatch[1]) {
            printerUrls = [urlMatch[1].trim()];
          } else {
            printerUrls = [];
          }
        }
      } else {
        // Not a JSON array - treat as comma-separated string or single URL
        printerUrls = trimmed.split(',').map(url => url.trim()).filter(url => url.length > 0);
        // If no commas, treat as single URL
        if (printerUrls.length === 0 && trimmed.length > 0) {
          printerUrls = [trimmed];
        }
      }

      // Normalize all URLs: remove trailing slashes
      printerUrls = printerUrls.map(url => url.replace(/\/+$/, ''));
    }
    const selectedPrinterIndex = printerIndex || (printerUrls.length > 0 ? 1 : 1);

    // Generate delivery number if not present
    let deliveryNumber = order.deliveryNumber;
    if (!deliveryNumber) {
      deliveryNumber = generateDeliveryNumber(selectedPrinterIndex);
      await Order.findByIdAndUpdate(order._id, {
        $set: { deliveryNumber }
      });
    }

    // Send print job
    console.log(`🖨️ Sending print job for order ${orderId} to printer ${selectedPrinterIndex}`);
    const result = await sendPrintJobFromOrder(order, selectedPrinterIndex);

    if (result.success) {
      // Update order status to 'printing' and delivery number
      const updateFields: any = { orderStatus: 'printing', status: 'printing' };
      if (result.deliveryNumber) {
        updateFields.deliveryNumber = result.deliveryNumber;
      }
      await Order.findByIdAndUpdate(order._id, { $set: updateFields });
    }

    return NextResponse.json({
      success: result.success,
      message: result.message,
      jobId: result.jobId,
      deliveryNumber: result.deliveryNumber || deliveryNumber,
      error: result.error
    });
  } catch (error) {
    console.error('Error sending print job:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to send print job' },
      { status: 500 }
    );
  }
}

/**
 * GET /api/printer/status
 * Get printer API status
 */
export async function GET(request: NextRequest) {
  const auth = await requireAdmin();
  if (auth instanceof NextResponse) return auth;

  try {
    const { searchParams } = new URL(request.url);
    const printerIndex = parseInt(searchParams.get('printerIndex') || '1', 10);

    const printerClient = (await import('@/lib/printerClient')).printerClient;
    const health = await printerClient.checkHealth(printerIndex);

    return NextResponse.json({
      success: true,
      printer: health
    });
  } catch (error) {
    console.error('Error getting printer status:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to get printer status' },
      { status: 500 }
    );
  }
}

