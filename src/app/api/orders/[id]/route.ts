import { NextRequest, NextResponse } from 'next/server';
import connectDB from '@/lib/mongodb';
import Order from '@/models/Order';
import Partner from '@/models/Partner';

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await connectDB();
    
    const { id: orderId } = await params;
    console.log(`🗑️ Attempting to delete order with ID: ${orderId}`);
    
    // Find the order
    const isObjectId = /^[0-9a-fA-F]{24}$/.test(orderId);
    const query = isObjectId ? { _id: orderId } : { orderId: orderId };
    const order = await Order.findOne(query);
    
    if (!order) {
      console.log(`❌ Order not found with ID: ${orderId}`);
      return NextResponse.json(
        { success: false, error: 'Order not found' },
        { status: 404 }
      );
    }

    console.log(`📋 Found order: ${order.orderId}, paymentStatus: ${order.paymentStatus}, status: ${order.status}`);

    // Only allow deletion of pending payment orders
    if (order.paymentStatus !== 'pending' || order.status !== 'pending_payment') {
      console.log(`❌ Order ${order.orderId} cannot be deleted - not in pending payment state`);
      return NextResponse.json(
        { success: false, error: 'Only pending payment orders can be deleted' },
        { status: 400 }
      );
    }

    // Delete the order
    await Order.findOneAndDelete(query);
    
    console.log(`✅ Order ${order.orderId} deleted by user`);
    
    return NextResponse.json({
      success: true,
      message: 'Order deleted successfully'
    });

  } catch (error) {
    console.error('Error deleting order:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to delete order' },
      { status: 500 }
    );
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await connectDB();
    
    const { id: orderIdParam } = await params;
    
    // Find the order
    const isObjectId = /^[0-9a-fA-F]{24}$/.test(orderIdParam);
    const query = isObjectId ? { _id: orderIdParam } : { orderId: orderIdParam };
    const order = await Order.findOne(query);
    
    if (!order) {
      return NextResponse.json(
        { success: false, error: 'Order not found' },
        { status: 404 }
      );
    }
    
    // Find the partner if partnerId exists
    let partnerInfo = null;
    const partnerId = order.partnerId || order.deliveryOption?.partnerId;
    if (partnerId) {
      const partner = await Partner.findById(partnerId);
      if (partner) {
        partnerInfo = {
          businessName: partner.businessName,
          email: partner.email,
          phone: partner.phone,
          address: partner.address
        };
      }
    }

    return NextResponse.json({
      success: true,
      order: {
        ...order.toObject(),
        partnerInfo
      }
    });

  } catch (error) {
    console.error('Error fetching order:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch order' },
      { status: 500 }
    );
  }
}