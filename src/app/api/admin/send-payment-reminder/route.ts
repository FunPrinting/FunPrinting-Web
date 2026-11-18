import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import connectDB from '@/lib/mongodb';
import Order from '@/models/Order';
import { sendPaymentReminderToCustomer, sendPaymentReminderToAdmin } from '@/lib/notificationService';

export async function POST(request: NextRequest) {
  const auth = await requireAdmin();
  if (auth instanceof NextResponse) return auth;

  try {
    const { orderId, sendToCustomer = true, sendToAdmin = true } = await request.json();

    if (!orderId) {
      return NextResponse.json(
        { success: false, error: 'Order ID is required' },
        { status: 400 }
      );
    }

    await connectDB();
    
    // Find the order
    const order = await Order.findOne({ orderId });
    if (!order) {
      return NextResponse.json(
        { success: false, error: 'Order not found' },
        { status: 404 }
      );
    }

    // Check if order is pending payment
    if (order.paymentStatus !== 'pending' || order.status !== 'pending_payment') {
      return NextResponse.json(
        { success: false, error: 'Order is not pending payment' },
        { status: 400 }
      );
    }

    console.log(`📧 Manual payment reminder request for order: ${orderId}`);
    
    const notificationData = {
      orderId: order.orderId,
      customerName: order.customerInfo?.name || order.studentInfo?.name || 'Customer',
      customerEmail: order.customerInfo?.email || order.studentInfo?.email || '',
      customerPhone: order.customerInfo?.phone || order.studentInfo?.phone || '',
      orderType: order.orderType,
      amount: order.amount,
      pageCount: order.printingOptions?.pageCount || 1,
      printingOptions: {
        pageSize: order.printingOptions?.pageSize || 'A4',
        color: order.printingOptions?.color || 'bw',
        copies: order.printingOptions?.copies || 1
      },
      deliveryOption: {
        type: order.deliveryOption?.type || 'pickup',
        address: order.deliveryOption?.address,
        pickupLocation: order.deliveryOption?.pickupLocation?.name
      },
      createdAt: order.createdAt,
      paymentStatus: order.paymentStatus,
      orderStatus: order.orderStatus,
      fileName: order.originalFileName,
      templateName: order.templateData?.templateType
    };

    let customerSuccess = false;
    let adminSuccess = false;
    const results = [];

    // Send customer reminder if requested
    if (sendToCustomer) {
      try {
        customerSuccess = await sendPaymentReminderToCustomer(notificationData);
        if (customerSuccess) {
          results.push('Customer reminder sent successfully');
          console.log(`✅ Manual customer reminder sent for order: ${orderId}`);
        } else {
          results.push('Failed to send customer reminder');
        }
      } catch (customerError) {
        console.error(`❌ Failed to send customer reminder for order ${orderId}:`, customerError);
        results.push(`Customer reminder error: ${customerError instanceof Error ? customerError.message : 'Unknown error'}`);
      }
    }

    // Send admin reminder if requested
    if (sendToAdmin) {
      try {
        adminSuccess = await sendPaymentReminderToAdmin(notificationData);
        if (adminSuccess) {
          results.push('Admin reminder sent successfully');
          console.log(`✅ Manual admin reminder sent for order: ${orderId}`);
        } else {
          results.push('Failed to send admin reminder');
        }
      } catch (adminError) {
        console.error(`❌ Failed to send admin reminder for order ${orderId}:`, adminError);
        results.push(`Admin reminder error: ${adminError instanceof Error ? adminError.message : 'Unknown error'}`);
      }
    }

    const overallSuccess = (sendToCustomer ? customerSuccess : true) && (sendToAdmin ? adminSuccess : true);

    return NextResponse.json({
      success: overallSuccess,
      message: results.join(', '),
      details: {
        orderId,
        customerReminderSent: sendToCustomer ? customerSuccess : null,
        adminReminderSent: sendToAdmin ? adminSuccess : null,
        customerEmail: notificationData.customerEmail,
        results
      }
    });

  } catch (error) {
    console.error('❌ Error sending manual payment reminder:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
