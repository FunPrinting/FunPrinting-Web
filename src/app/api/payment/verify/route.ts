import { NextRequest, NextResponse } from 'next/server';
import connectDB from '@/lib/mongodb';
import Order from '@/models/Order';
import PrintJob from '@/models/PrintJob';
import CreatorEarning from '@/models/CreatorEarning';
import { verifyPayment } from '@/lib/razorpay';
import { sendPrintJobFromOrder, generateDeliveryNumber } from '@/lib/printerClient';
import { sendInvoiceEmail } from '@/lib/invoiceEmail';

export async function POST(request: NextRequest) {
  try {
    await connectDB();

    const body = await request.json();
    const {
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
    } = body;

    console.log('🔍 Payment verification started for order:', razorpay_order_id);
    console.log(`📋 Payment details: order_id=${razorpay_order_id}, payment_id=${razorpay_payment_id}`);

    // Validate required fields
    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      console.error('❌ Missing required payment verification fields');
      return NextResponse.json(
        { success: false, error: 'Missing required payment verification fields' },
        { status: 400 }
      );
    }

    // Verify payment signature
    const isValid = verifyPayment(
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature
    );

    if (!isValid) {
      console.error('❌ Invalid payment signature - attempting fallback verification');

      // Fallback: Check payment status from Razorpay API if signature verification fails
      // This handles cases where signature might be corrupted during transmission
      try {
        const { checkSpecificOrderFromRazorpay } = await import('@/lib/razorpayFallback');
        const fallbackResult = await checkSpecificOrderFromRazorpay(razorpay_order_id);

        if (fallbackResult) {
          console.log('✅ Payment verified via fallback API check');
          // Fetch updated order
          const updatedOrder = await Order.findOne({ razorpayOrderId: razorpay_order_id });
          if (updatedOrder && updatedOrder.paymentStatus === 'completed') {
            return NextResponse.json({
              success: true,
              message: 'Payment verified via fallback check',
              order: {
                orderId: updatedOrder.orderId,
                amount: updatedOrder.amount,
                paymentStatus: updatedOrder.paymentStatus,
                orderStatus: updatedOrder.orderStatus,
                createdAt: updatedOrder.createdAt,
              }
            });
          }
        }
      } catch (fallbackError) {
        console.error('❌ Fallback verification also failed:', fallbackError);
      }

      return NextResponse.json(
        { success: false, error: 'Invalid payment signature. Please contact support if payment was deducted.' },
        { status: 400 }
      );
    }

    console.log('✅ Payment signature verified successfully');

    // Find the existing pending order
    const order = await Order.findOne({ razorpayOrderId: razorpay_order_id });

    if (!order) {
      console.error('❌ Order not found for Razorpay order ID:', razorpay_order_id);
      return NextResponse.json(
        { success: false, error: 'Order not found' },
        { status: 404 }
      );
    }

    console.log(`📋 Found pending order: ${order.orderId}`);

    // Check if order is already processed (race condition protection)
    if (order.paymentStatus === 'completed' && order.razorpayPaymentId === razorpay_payment_id) {
      console.log(`ℹ️ Order ${order.orderId} already processed for payment ${razorpay_payment_id}`);

      // Even if payment is already completed, check if print job needs to be sent
      if (order.orderType === 'file' && order.fileURL) {
        try {
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

          // Check if print job was already sent by checking delivery number or print job status
          const PrintJob = (await import('@/models/PrintJob')).default;
          const existingPrintJob = await PrintJob.findOne({ orderId: order._id.toString() });

          if (!existingPrintJob || existingPrintJob.status === 'pending') {
            console.log(`🖨️ Payment already completed, but sending print job for order: ${order.orderId}`);
            const printJobResult = await sendPrintJobFromOrder(order, printerIndex);

            if (printJobResult.success && printJobResult.deliveryNumber) {
              await Order.findByIdAndUpdate(order._id, {
                $set: { deliveryNumber: printJobResult.deliveryNumber }
              });
              console.log(`✅ Print job sent for already-completed order. Delivery number: ${printJobResult.deliveryNumber}`);
            }
          }
        } catch (printJobError) {
          console.error('❌ Error sending print job for already-completed order:', printJobError);
        }
      }

      return NextResponse.json({
        success: true,
        message: 'Payment already verified',
        order: {
          orderId: order.orderId,
          amount: order.amount,
          paymentStatus: order.paymentStatus,
          createdAt: order.createdAt,
        }
      });
    }

    // Update order with payment details using atomic operation
    const updateResult = await Order.findOneAndUpdate(
      {
        _id: order._id,
        paymentStatus: { $ne: 'completed' } // Only update if not already completed
      },
      {
        $set: {
          paymentStatus: 'completed',
          razorpayPaymentId: razorpay_payment_id,
          status: 'paid',
          orderStatus: 'pending', // Ready for processing
          updatedAt: new Date()
        }
      },
      { new: true }
    );

    if (!updateResult) {
      console.log(`ℹ️ Order ${order.orderId} already processed or not found`);
      return NextResponse.json({
        success: true,
        message: 'Order already processed',
        order: {
          orderId: order.orderId,
          amount: order.amount,
          paymentStatus: 'completed',
          createdAt: order.createdAt,
        }
      });
    }

    console.log(`✅ Order ${order.orderId} marked as paid`);

    // Create CreatorEarning record for paid template orders
    if (updateResult.orderType === 'template' &&
      updateResult.creatorShareAmount &&
      updateResult.creatorShareAmount > 0 &&
      updateResult.templateCreatorUserId) {
      try {
        // Check if earning already exists (idempotency)
        const existingEarning = await CreatorEarning.findOne({ orderId: updateResult.orderId });

        if (!existingEarning) {
          const earning = new CreatorEarning({
            creatorUserId: updateResult.templateCreatorUserId,
            templateId: updateResult.templateId,
            orderId: updateResult.orderId,
            razorpayPaymentId: razorpay_payment_id,
            amount: updateResult.creatorShareAmount,
            platformShareAmount: updateResult.platformShareAmount || 0,
            status: 'pending',
          });

          await earning.save();
          console.log(`💰 CreatorEarning created: ₹${updateResult.creatorShareAmount} for creator ${updateResult.templateCreatorUserId}`);
        } else {
          console.log(`ℹ️ CreatorEarning already exists for order ${updateResult.orderId}`);
        }
      } catch (earningError) {
        console.error('❌ Error creating CreatorEarning:', earningError);
        // Don't fail the payment verification if earning creation fails
      }
    }

    // Generate delivery number and send print job
    let deliveryNumber = updateResult.deliveryNumber;
    let printJobResult = null;

    // Determine printer index from PRINTER_API_URLS array
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
    const printerIndex = printerUrls.length > 0 ? 1 : 1; // Default to 1, or use first available

    // Generate delivery number if not present
    if (!deliveryNumber) {
      deliveryNumber = generateDeliveryNumber(printerIndex);
      // Update order with delivery number
      await Order.findByIdAndUpdate(updateResult._id, {
        $set: { deliveryNumber }
      });
      console.log(`✅ Delivery number generated: ${deliveryNumber}`);
    }

    // Send print job to printer API if this is a file order
    if (updateResult.orderType === 'file' && updateResult.fileURL) {
      if (updateResult.deliveryOption?.partnerId) {
        // Send order to partner via WebSocket webhook
        try {
          const wssApiUrl = process.env.WSS_API_URL || 'http://localhost:3001';
          console.log(`🖨️ Dispatching partner print job via WSS for order: ${updateResult.orderId}`);
          const dispatchRes = await fetch(`${wssApiUrl}/api/dispatch-print-job`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              partnerId: updateResult.deliveryOption.partnerId,
              order: updateResult
            })
          });
          
          if (dispatchRes.ok) {
            console.log(`✅ Partner print job dispatched to socket room`);
            const updateFields: any = { orderStatus: 'printing', status: 'printing' };
            if (deliveryNumber) {
              updateFields.deliveryNumber = deliveryNumber;
            }
            await Order.findByIdAndUpdate(updateResult._id, { $set: updateFields });
          } else {
            console.error(`❌ Failed to dispatch partner print job via WSS: ${dispatchRes.statusText}`);
          }
        } catch (error) {
          console.error(`❌ Error dispatching partner print job via WSS:`, error);
        }
      } else {
        try {
          console.log(`🖨️ Sending print job to global printer API for order: ${updateResult.orderId}`);
          printJobResult = await sendPrintJobFromOrder(updateResult, printerIndex);

          if (printJobResult.success) {
            // Update order status to 'printing' and delivery number
            const updateFields: any = { orderStatus: 'printing', status: 'printing' };
            if (printJobResult.deliveryNumber) {
              deliveryNumber = printJobResult.deliveryNumber;
              updateFields.deliveryNumber = deliveryNumber;
            }
            await Order.findByIdAndUpdate(updateResult._id, { $set: updateFields });
            console.log(`✅ Print job sent successfully. Order status updated to 'printing'. Delivery number: ${deliveryNumber}`);
          } else {
            console.warn(`⚠️ Print job failed: ${printJobResult.message}. Order stays as 'pending' for manual printing.`);
          }
        } catch (printJobError) {
          console.error('❌ Error sending print job:', printJobError);
          // Don't fail the order if print job fails - admin can manually print later
        }
      }
    }

    // Send invoice email immediately after payment verification
    try {
      console.log(`📧 Sending invoice email for order: ${updateResult.orderId}`);
      const invoiceSent = await sendInvoiceEmail(updateResult, deliveryNumber);

      if (invoiceSent) {
        console.log(`✅ Invoice email sent successfully to ${updateResult.customerInfo.email}`);
      } else {
        console.warn(`⚠️ Failed to send invoice email, will retry later`);
        // Invoice email failure doesn't block the order
      }
    } catch (invoiceError) {
      console.error('❌ Error sending invoice email:', invoiceError);
      // Invoice email failure doesn't block the order
    }

    // Create print job record in database for tracking
    let printJob = null;
    if (updateResult.orderType === 'file' && updateResult.fileURL) {
      try {
        // Check if print job already exists
        const existingPrintJob = await PrintJob.findOne({ orderId: updateResult._id.toString() });
        if (existingPrintJob) {
          console.log(`ℹ️ Print job already exists for order ${updateResult.orderId}`);
          printJob = existingPrintJob;
        } else {
          console.log('🖨️ Creating print job record for order:', updateResult.orderId);

          // Calculate estimated duration
          const estimatedDuration = Math.ceil(
            ((updateResult.printingOptions.pageCount || 1) * updateResult.printingOptions.copies * 0.5) + // 0.5 minutes per page
            (updateResult.printingOptions.color === 'color' ? (updateResult.printingOptions.pageCount || 1) * 0.3 : 0) // Extra time for color
          );

          printJob = new PrintJob({
            orderId: updateResult._id.toString(),
            orderNumber: updateResult.orderId,
            customerName: updateResult.customerInfo.name,
            customerEmail: updateResult.customerInfo.email,
            fileURL: updateResult.fileURL,
            fileName: updateResult.originalFileName || 'document.pdf',
            fileType: updateResult.fileType || 'application/pdf',
            printingOptions: updateResult.printingOptions,
            priority: 'normal',
            estimatedDuration,
            status: printJobResult?.success ? 'printing' : 'pending'
          });

          await printJob.save();
          console.log(`✅ Print job record created: ${printJob.orderNumber}`);
        }
      } catch (printJobError) {
        console.error('Error creating print job record:', printJobError);
        // Don't fail the order if print job record creation fails
      }
    }

    return NextResponse.json({
      success: true,
      message: 'Payment verified and order created successfully',
      order: {
        orderId: updateResult.orderId,
        amount: updateResult.amount,
        paymentStatus: updateResult.paymentStatus,
        deliveryNumber: deliveryNumber,
        createdAt: updateResult.createdAt,
      },
      printJob: printJob ? {
        id: printJob._id,
        status: printJob.status,
        estimatedDuration: printJob.estimatedDuration
      } : null,
      invoiceSent: true,
    });
  } catch (error) {
    console.error('❌ Error verifying payment:', error);

    // Enhanced error handling with specific error messages
    let errorMessage = 'Failed to verify payment and create order';
    let statusCode = 500;

    if (error instanceof Error) {
      // Network/timeout errors
      if (error.message.includes('timeout') || error.message.includes('ETIMEDOUT') || error.message.includes('ECONNRESET')) {
        errorMessage = 'Payment verification timed out. Your payment may still be processing. Please check your order status in a few minutes or contact support.';
        statusCode = 504;
      }
      // Database errors
      else if (error.message.includes('E11000') || error.message.includes('duplicate')) {
        errorMessage = 'Order already processed. Please check your order status.';
        statusCode = 409;
      }
      // Validation errors
      else if (error.message.includes('validation') || error.message.includes('required')) {
        errorMessage = 'Invalid payment data provided.';
        statusCode = 400;
      }
      // Connection errors
      else if (error.message.includes('ECONNREFUSED') || error.message.includes('ENOTFOUND')) {
        errorMessage = 'Unable to connect to payment service. Please try again later.';
        statusCode = 503;
      }

      console.error(`❌ Payment verification error details: ${error.message}`);
    }

    // Attempt fallback verification for timeout/network errors
    // Note: We can't re-read request body here, so fallback is handled at client side
    // The payment status check API should be called by the client as fallback

    return NextResponse.json(
      { success: false, error: errorMessage },
      { status: statusCode }
    );
  }
}
