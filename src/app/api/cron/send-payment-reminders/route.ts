import { NextRequest, NextResponse } from 'next/server';
import { requireCronSecret } from '@/lib/cronAuth';
import connectDB from '@/lib/mongodb';
import Order from '@/models/Order';
import { sendPaymentReminderToCustomer, sendPaymentReminderToAdmin } from '@/lib/notificationService';

export async function GET(request: NextRequest) {
  const cronAuth = requireCronSecret(request);
  if (cronAuth) return cronAuth;

  try {

    await connectDB();
    
    // Find orders that are pending payment for more than 2 hours but less than 24 hours
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    
    const pendingOrders = await Order.find({
      paymentStatus: 'pending',
      status: 'pending_payment',
      createdAt: { 
        $lt: twoHoursAgo,  // Older than 2 hours
        $gt: twentyFourHoursAgo  // But newer than 24 hours
      }
    });

    console.log(`⏰ Payment reminder cron: Found ${pendingOrders.length} orders needing payment reminders`);

    let customerRemindersCount = 0;
    let adminRemindersCount = 0;

    for (const order of pendingOrders) {
      try {
        console.log(`⏰ Sending payment reminders for order: ${order.orderId}`);
        
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

        // Send customer reminder
        try {
          const customerSuccess = await sendPaymentReminderToCustomer(notificationData);
          if (customerSuccess) {
            customerRemindersCount++;
            console.log(`✅ Customer reminder sent for order: ${order.orderId}`);
          }
        } catch (customerError) {
          console.error(`❌ Failed to send customer reminder for order ${order.orderId}:`, customerError);
        }

        // Send admin reminder
        try {
          const adminSuccess = await sendPaymentReminderToAdmin(notificationData);
          if (adminSuccess) {
            adminRemindersCount++;
            console.log(`✅ Admin reminder sent for order: ${order.orderId}`);
          }
        } catch (adminError) {
          console.error(`❌ Failed to send admin reminder for order ${order.orderId}:`, adminError);
        }

        // Add a small delay to avoid overwhelming the email service
        await new Promise(resolve => setTimeout(resolve, 1000));

      } catch (orderError) {
        console.error(`❌ Error processing payment reminder for order ${order.orderId}:`, orderError);
      }
    }

    const message = `Payment reminders sent: ${customerRemindersCount} to customers, ${adminRemindersCount} to admin`;
    console.log(`✅ ${message}`);

    return NextResponse.json({
      success: true,
      message,
      ordersProcessed: pendingOrders.length,
      customerReminders: customerRemindersCount,
      adminReminders: adminRemindersCount
    });

  } catch (error) {
    console.error('❌ Error in payment reminder cron job:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  // Allow POST requests for manual triggering
  return GET(request);
}
