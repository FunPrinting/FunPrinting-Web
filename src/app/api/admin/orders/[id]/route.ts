import { NextRequest, NextResponse } from 'next/server';
import connectDB from '@/lib/mongodb';
import Order from '@/models/Order';
import { validateOrderStateTransition, logOrderEvent, OrderStatus } from '@/lib/orderUtils';

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    await connectDB();
    const { id } = await context.params;
    const isObjectId = /^[0-9a-fA-F]{24}$/.test(id);
    const query = isObjectId ? { _id: id } : { orderId: id };
    const order = await Order.findOne(query);
    if (!order) {
      return NextResponse.json(
        { success: false, error: 'Order not found' },
        { status: 404 }
      );
    }

    // Convert Mongoose document to plain object to ensure all fields are serialized
    const orderData = order.toObject ? order.toObject() : order;

    // Ensure array fields are always present to avoid client-side crashes
    orderData.fileURLs = Array.isArray(orderData.fileURLs) ? orderData.fileURLs : [];
    orderData.originalFileNames = Array.isArray(orderData.originalFileNames) ? orderData.originalFileNames : [];

    // Log file data for debugging
    console.log('📋 Admin API - Order file data:', {
      orderId: orderData.orderId,
      hasFileURL: !!orderData.fileURL,
      hasFileURLs: !!orderData.fileURLs,
      fileURLsLength: orderData.fileURLs?.length || 0,
      hasOriginalFileName: !!orderData.originalFileName,
      hasOriginalFileNames: !!orderData.originalFileNames,
      originalFileNamesLength: orderData.originalFileNames?.length || 0,
      fileURLs: orderData.fileURLs,
      originalFileNames: orderData.originalFileNames
    });

    return NextResponse.json({
      success: true,
      order: orderData,
    });
  } catch (error) {
    console.error('Error fetching order:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch order' },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    await connectDB();
    const { id } = await context.params;
    const body = await request.json();
    const { orderStatus } = body;

    console.log(`🔄 Admin updating order ${id} status to: ${orderStatus}`);

    if (!orderStatus) {
      console.log('❌ No orderStatus provided in request body');
      return NextResponse.json(
        { success: false, error: 'Order status is required' },
        { status: 400 }
      );
    }

    // Get current order to validate state transition
    const isObjectId = /^[0-9a-fA-F]{24}$/.test(id);
    const query = isObjectId ? { _id: id } : { orderId: id };
    const currentOrder = await Order.findOne(query);
    if (!currentOrder) {
      console.log(`❌ Order ${id} not found`);
      return NextResponse.json(
        { success: false, error: 'Order not found' },
        { status: 404 }
      );
    }

    console.log(`📋 Current order status: ${currentOrder.status}, orderStatus: ${currentOrder.orderStatus}`);

    // Validate orderStatus values (different from status field)
    const validOrderStatuses = ['pending', 'processing', 'printing', 'printed', 'dispatched', 'delivered'];
    if (!validOrderStatuses.includes(orderStatus)) {
      return NextResponse.json(
        {
          success: false,
          error: `Invalid orderStatus: ${orderStatus}. Valid values are: ${validOrderStatuses.join(', ')}`
        },
        { status: 400 }
      );
    }

    // Map orderStatus to corresponding status field value
    const statusMapping: Record<string, string> = {
      'pending': 'processing',
      'processing': 'processing',
      'printing': 'printing',
      'printed': 'printed',
      'dispatched': 'dispatched',
      'delivered': 'delivered'
    };

    const newStatus = statusMapping[orderStatus] || 'processing';

    console.log(`🔄 Mapping orderStatus '${orderStatus}' to status '${newStatus}'`);

    // Validate state transition for the status field with admin override
    const currentStatus = currentOrder.status as OrderStatus || 'pending_payment';
    const transition = validateOrderStateTransition(currentStatus, newStatus as OrderStatus, true); // Admin override enabled

    if (!transition.allowed) {
      logOrderEvent('invalid_state_transition', currentOrder.orderId, {
        from: currentStatus,
        to: newStatus,
        reason: transition.reason
      }, 'warn');

      return NextResponse.json(
        {
          success: false,
          error: `Invalid status transition: ${transition.reason}`
        },
        { status: 400 }
      );
    }

    console.log(`🔓 Admin override enabled for transition: ${currentStatus} -> ${newStatus}`);

    // Update order status
    const updateFields: any = {
      orderStatus,
      status: newStatus,
      updatedAt: new Date()
    };
    // Set printedAt when transitioning to 'printed'
    if (orderStatus === 'printed') {
      updateFields.printedAt = new Date();
    }
    const order = await Order.findOneAndUpdate(
      query,
      updateFields,
      { new: true }
    );

    logOrderEvent('status_updated', order.orderId, {
      from: currentStatus,
      to: newStatus,
      orderStatus: orderStatus,
      updatedBy: 'admin'
    });

    console.log(`✅ Order ${order.orderId} status updated successfully: ${currentStatus} -> ${newStatus} (orderStatus: ${orderStatus})`);

    return NextResponse.json({
      success: true,
      order,
    });
  } catch (error) {
    console.error('Error updating order:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to update order' },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    await connectDB();
    const { id } = await context.params;
    
    const isObjectId = /^[0-9a-fA-F]{24}$/.test(id);
    const query = isObjectId ? { _id: id } : { orderId: id };

    const order = await Order.findOneAndDelete(query);
    if (!order) {
      return NextResponse.json(
        { success: false, error: 'Order not found' },
        { status: 404 }
      );
    }

    // If the order has a partnerId, try to notify the partner desktop to cancel the job
    if (order.deliveryOption && order.deliveryOption.partnerId) {
      try {
        const wssApiUrl = process.env.WSS_API_URL || 'https://funprinting-wss.onrender.com';
        console.log(`🛑 Sending cancel request to partner ${order.deliveryOption.partnerId} for order ${order.orderId}`);
        await fetch(`${wssApiUrl}/api/cancel-print-job`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            partnerId: order.deliveryOption.partnerId,
            orderId: order.orderId
          })
        });
      } catch (err) {
        console.error('Failed to dispatch cancel-print-job webhook:', err);
      }
    }

    console.log(`Order ${order.orderId} deleted successfully`);
    return NextResponse.json({
      success: true,
      message: 'Order deleted successfully',
      orderId: order.orderId,
    });
  } catch (error) {
    console.error('Error deleting order:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to delete order' },
      { status: 500 }
    );
  }
}
