import { NextRequest, NextResponse } from 'next/server';
import { requireCronSecret } from '@/lib/cronAuth';
import connectDB from '@/lib/mongodb';
import Order from '@/models/Order';
import { checkPendingOrdersFromRazorpay } from '@/lib/razorpayFallback';
import { sendPaymentReminderToCustomer, sendPaymentReminderToAdmin } from '@/lib/notificationService';

export async function GET(request: NextRequest) {
  const cronAuth = requireCronSecret(request);
  if (cronAuth) return cronAuth;

  try {

    await connectDB();
    
    // 🔄 FIRST: Check Razorpay for successful payments before cleanup
    // Check all pending orders older than 5 minutes
    console.log('🔄 Checking Razorpay for successful payments (checking orders > 5 minutes old)...');
    try {
      await checkPendingOrdersFromRazorpay(5);
      console.log('✅ Razorpay payment check completed');
    } catch (error) {
      console.error('❌ Error checking Razorpay payments:', error);
    }

    // 📧 SECOND: Send payment reminders for orders pending 2-24 hours
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    
    const ordersForReminders = await Order.find({
      paymentStatus: 'pending',
      status: 'pending_payment',
      createdAt: { 
        $lt: twoHoursAgo,  // Older than 2 hours
        $gt: twentyFourHoursAgo  // But newer than 24 hours
      }
    });

    console.log(`📧 Cron job: Found ${ordersForReminders.length} orders needing payment reminders`);

    let remindersSent = 0;
    for (const order of ordersForReminders) {
      try {
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

        // Send reminders to both customer and admin
        await Promise.all([
          sendPaymentReminderToCustomer(notificationData).catch(err => 
            console.error(`❌ Customer reminder failed for ${order.orderId}:`, err)
          ),
          sendPaymentReminderToAdmin(notificationData).catch(err => 
            console.error(`❌ Admin reminder failed for ${order.orderId}:`, err)
          )
        ]);

        remindersSent++;
        console.log(`📧 Payment reminders sent for order: ${order.orderId}`);
        
        // Small delay to avoid overwhelming email service
        await new Promise(resolve => setTimeout(resolve, 500));
      } catch (error) {
        console.error(`❌ Error sending reminders for order ${order.orderId}:`, error);
      }
    }

    // 🗑️ THIRD: Find orders that are pending payment for more than 24 hours for cleanup
    const ordersToCleanup = await Order.find({
      paymentStatus: 'pending',
      status: 'pending_payment',
      createdAt: { $lt: twentyFourHoursAgo }
    });

    console.log(`🗑️ Cron job: Found ${ordersToCleanup.length} pending orders to cleanup`);

    let cleanedCount = 0;
    for (const order of ordersToCleanup) {
      try {
        // Update order status to failed
        order.paymentStatus = 'failed';
        order.status = 'pending_payment';
        order.orderStatus = 'pending';
        
        await order.save();
        cleanedCount++;
        
        console.log(`❌ Cron job: Marked pending order as failed: ${order.orderId} (created: ${order.createdAt})`);
      } catch (error) {
        console.error(`❌ Cron job: Error cancelling order ${order.orderId}:`, error);
      }
    }

    return NextResponse.json({
      success: true,
      message: `Cron job completed: ${remindersSent} reminders sent, ${cleanedCount} orders cleaned up`,
      remindersSent,
      cleanedCount,
      ordersForReminders: ordersForReminders.length,
      ordersToCleanup: ordersToCleanup.length,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Cron job error:', error);
    return NextResponse.json(
      { success: false, error: 'Cron job failed' },
      { status: 500 }
    );
  }
}
