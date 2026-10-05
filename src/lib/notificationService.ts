import nodemailer from 'nodemailer';

// Configure email transporter using existing environment variables
const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST || 'smtp.gmail.com',
  port: parseInt(process.env.EMAIL_PORT || '587'),
  secure: false, // true for 465, false for other ports
  auth: {
    user: process.env.EMAIL_HOST_USER ,
    pass: process.env.EMAIL_HOST_PASSWORD || 'hagbaiwzqltgfflz',
  },
  tls: {
    rejectUnauthorized: false
  }
});

export interface OrderNotificationData {
  orderId: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  orderType: 'file' | 'template';
  amount: number;
  pageCount: number;
  printingOptions: {
    pageSize: string;
    color: string;
    copies: number;
  };
  deliveryOption: {
    type: string;
    address?: string;
    pickupLocation?: string;
  };
  createdAt: Date;
  paymentStatus: string;
  orderStatus: string;
  templateName?: string;
  fileName?: string;
}

export async function sendNewOrderNotification(orderData: OrderNotificationData): Promise<boolean> {
  try {
    const adminEmail = process.env.ADMIN_EMAIL ;
    
    // Debug logging
    console.log('📧 Sending new order notification...');
    console.log('📧 Admin email:', adminEmail);
    console.log('📧 Email host:', process.env.EMAIL_HOST);
    console.log('📧 Email user:', process.env.EMAIL_HOST_USER);
    console.log('📧 Email password configured:', !!process.env.EMAIL_HOST_PASSWORD);
    
    // Format order details for email
    const orderDetails = formatOrderDetails(orderData);
    
    const mailOptions = {
      from: process.env.EMAIL_USER || 'noreply@printservice.com',
      to: adminEmail,
      subject: `🆕 New Order Received - #${orderData.orderId}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px;">
          <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; border-radius: 10px 10px 0 0; text-align: center;">
            <h1 style="margin: 0; font-size: 28px;">🆕 New Order Received</h1>
            <p style="margin: 10px 0 0 0; font-size: 16px; opacity: 0.9;">Order #${orderData.orderId}</p>
          </div>
          
          <div style="background: #f8f9fa; padding: 30px; border-radius: 0 0 10px 10px;">
            <div style="background: white; padding: 25px; border-radius: 8px; margin-bottom: 20px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
              <h2 style="color: #333; margin: 0 0 20px 0; border-bottom: 2px solid #007bff; padding-bottom: 10px;">📋 Order Information</h2>
              ${orderDetails}
            </div>
            
            <div style="background: white; padding: 25px; border-radius: 8px; margin-bottom: 20px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
              <h2 style="color: #333; margin: 0 0 20px 0; border-bottom: 2px solid #28a745; padding-bottom: 10px;">👤 Customer Details</h2>
              <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px;">
                <div>
                  <strong style="color: #555;">Name:</strong><br>
                  <span style="color: #333;">${orderData.customerName}</span>
                </div>
                <div>
                  <strong style="color: #555;">Email:</strong><br>
                  <a href="mailto:${orderData.customerEmail}" style="color: #007bff; text-decoration: none;">${orderData.customerEmail}</a>
                </div>
                <div>
                  <strong style="color: #555;">Phone:</strong><br>
                  <a href="tel:${orderData.customerPhone}" style="color: #007bff; text-decoration: none;">${orderData.customerPhone}</a>
                </div>
                <div>
                  <strong style="color: #555;">Order Date:</strong><br>
                  <span style="color: #333;">${orderData.createdAt.toLocaleString('en-IN', { 
                    timeZone: 'Asia/Kolkata',
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit'
                  })}</span>
                </div>
              </div>
            </div>
            
            <div style="background: white; padding: 25px; border-radius: 8px; margin-bottom: 20px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
              <h2 style="color: #333; margin: 0 0 20px 0; border-bottom: 2px solid #ffc107; padding-bottom: 10px;">💰 Payment & Status</h2>
              <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px;">
                <div>
                  <strong style="color: #555;">Amount:</strong><br>
                  <span style="color: #28a745; font-size: 18px; font-weight: bold;">₹${orderData.amount}</span>
                </div>
                <div>
                  <strong style="color: #555;">Payment Status:</strong><br>
                  <span style="background: ${getStatusColor(orderData.paymentStatus)}; color: white; padding: 4px 8px; border-radius: 4px; font-size: 12px; font-weight: bold;">
                    ${orderData.paymentStatus.toUpperCase()}
                  </span>
                </div>
                <div>
                  <strong style="color: #555;">Order Status:</strong><br>
                  <span style="background: ${getStatusColor(orderData.orderStatus)}; color: white; padding: 4px 8px; border-radius: 4px; font-size: 12px; font-weight: bold;">
                    ${orderData.orderStatus.toUpperCase()}
                  </span>
                </div>
                <div>
                  <strong style="color: #555;">Pages:</strong><br>
                  <span style="color: #333; font-weight: bold;">${orderData.pageCount} pages</span>
                </div>
              </div>
            </div>
            
            <div style="text-align: center; margin-top: 30px;">
              <a href="${process.env.NEXTAUTH_URL || 'https://www.funprinting.store'}/admin/orders/${orderData.orderId}" 
                 style="display: inline-block; background: #007bff; color: white; padding: 15px 30px; 
                        text-decoration: none; border-radius: 5px; font-weight: bold; font-size: 16px; margin: 0 10px;">
                📊 View Order Details
              </a>
              <a href="${process.env.NEXTAUTH_URL || 'https://www.funprinting.store'}/admin" 
                 style="display: inline-block; background: #28a745; color: white; padding: 15px 30px; 
                        text-decoration: none; border-radius: 5px; font-weight: bold; font-size: 16px; margin: 0 10px;">
                🏠 Admin Dashboard
              </a>
            </div>
          </div>
          
          <div style="text-align: center; color: #666; font-size: 12px; margin-top: 30px; padding: 20px; border-top: 1px solid #eee;">
            <p>This is an automated notification from Print Service Admin System.</p>
            <p>© 2024 Print Service. All rights reserved.</p>
          </div>
        </div>
      `,
    };

    console.log('📧 Attempting to send email...');
    const result = await transporter.sendMail(mailOptions);
    console.log('📧 Email sent successfully:', result.messageId);
    console.log(`✅ New order notification sent to admin: ${adminEmail}`);
    return true;
  } catch (error) {
    console.error('❌ Error sending new order notification:', error);
    console.error('❌ Error details:', {
      message: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
      code: (error as any)?.code,
      response: (error as any)?.response
    });
    return false;
  }
}

function formatOrderDetails(orderData: OrderNotificationData): string {
  const deliveryInfo = orderData.deliveryOption.type === 'pickup' 
    ? `Pickup Location: ${orderData.deliveryOption.pickupLocation || 'Not specified'}`
    : `Delivery Address: ${orderData.deliveryOption.address || 'Not specified'}`;

  return `
    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px;">
      <div>
        <strong style="color: #555;">Order Type:</strong><br>
        <span style="color: #333; text-transform: capitalize;">${orderData.orderType}</span>
      </div>
      <div>
        <strong style="color: #555;">${orderData.orderType === 'template' ? 'Template' : 'File'}:</strong><br>
        <span style="color: #333;">${orderData.orderType === 'template' ? (orderData.templateName || 'Unknown') : (orderData.fileName || 'Uploaded File')}</span>
      </div>
      <div>
        <strong style="color: #555;">Page Size:</strong><br>
        <span style="color: #333;">${orderData.printingOptions.pageSize}</span>
      </div>
      <div>
        <strong style="color: #555;">Color:</strong><br>
        <span style="color: #333; text-transform: capitalize;">${orderData.printingOptions.color === 'bw' ? 'Black & White' : orderData.printingOptions.color}</span>
      </div>
      <div>
        <strong style="color: #555;">Copies:</strong><br>
        <span style="color: #333;">${orderData.printingOptions.copies}</span>
      </div>
      <div>
        <strong style="color: #555;">Delivery:</strong><br>
        <span style="color: #333; text-transform: capitalize;">${orderData.deliveryOption.type}</span>
      </div>
    </div>
    <div style="margin-top: 15px; padding: 15px; background: #f8f9fa; border-radius: 5px;">
      <strong style="color: #555;">Delivery Details:</strong><br>
      <span style="color: #333;">${deliveryInfo}</span>
    </div>
  `;
}

function getStatusColor(status: string): string {
  switch (status.toLowerCase()) {
    case 'completed':
    case 'paid':
      return '#28a745';
    case 'pending':
    case 'pending_payment':
      return '#ffc107';
    case 'failed':
      return '#dc3545';
    case 'processing':
    case 'printing':
      return '#17a2b8';
    default:
      return '#6c757d';
  }
}

// Test email transporter connection
export async function testEmailConnection(): Promise<boolean> {
  try {
    console.log('🧪 Testing email transporter connection...');
    await transporter.verify();
    console.log('✅ Email transporter connection successful');
    return true;
  } catch (error) {
    console.error('❌ Email transporter connection failed:', error);
    return false;
  }
}

export async function sendCustomerOrderConfirmation(orderData: OrderNotificationData): Promise<boolean> {
  try {
    console.log('📧 Sending customer order confirmation...');
    console.log('📧 Customer email:', orderData.customerEmail);
    
    const mailOptions = {
      from: process.env.EMAIL_USER || 'noreply@printservice.com',
      to: orderData.customerEmail,
      subject: `✅ Order Confirmation - #${orderData.orderId} | PrintService`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background: linear-gradient(135deg, #28a745 0%, #20c997 100%); color: white; padding: 30px; border-radius: 10px 10px 0 0; text-align: center;">
            <h1 style="margin: 0; font-size: 28px;">✅ Order Confirmed!</h1>
            <p style="margin: 10px 0 0 0; font-size: 16px; opacity: 0.9;">Thank you for choosing PrintService</p>
          </div>
          
          <div style="background: #f8f9fa; padding: 30px; border-radius: 0 0 10px 10px;">
            <div style="background: white; padding: 25px; border-radius: 8px; margin-bottom: 20px;">
              <h2 style="color: #333; margin: 0 0 20px 0;">Order Details</h2>
              <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin-bottom: 20px;">
                <div>
                  <strong style="color: #555;">Order ID:</strong><br>
                  <span style="color: #333; font-weight: bold; font-size: 18px;">#${orderData.orderId}</span>
                </div>
                <div>
                  <strong style="color: #555;">Amount:</strong><br>
                  <span style="color: #28a745; font-weight: bold; font-size: 18px;">₹${orderData.amount}</span>
                </div>
                <div>
                  <strong style="color: #555;">Order Type:</strong><br>
                  <span style="color: #333;">${orderData.orderType === 'file' ? 'File Upload' : 'Template Generated'}</span>
                </div>
                <div>
                  <strong style="color: #555;">Pages:</strong><br>
                  <span style="color: #333; font-weight: bold;">${orderData.pageCount} pages</span>
                </div>
              </div>
              
              <div style="border-top: 1px solid #eee; padding-top: 15px;">
                <h3 style="color: #333; margin: 0 0 15px 0;">Printing Options</h3>
                <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px;">
                  <div>
                    <strong style="color: #555;">Size:</strong><br>
                    <span style="color: #333;">${orderData.printingOptions.pageSize}</span>
                  </div>
                  <div>
                    <strong style="color: #555;">Color:</strong><br>
                    <span style="color: #333;">${orderData.printingOptions.color === 'color' ? 'Color' : orderData.printingOptions.color === 'bw' ? 'Black & White' : 'Mixed'}</span>
                  </div>
                  <div>
                    <strong style="color: #555;">Copies:</strong><br>
                    <span style="color: #333;">${orderData.printingOptions.copies}</span>
                  </div>
                </div>
              </div>
              
              <div style="border-top: 1px solid #eee; padding-top: 15px; margin-top: 15px;">
                <h3 style="color: #333; margin: 0 0 15px 0;">Delivery Information</h3>
                <div>
                  <strong style="color: #555;">Method:</strong><br>
                  <span style="color: #333;">${orderData.deliveryOption.type === 'pickup' ? '🏫 Pickup' : '🚚 Home Delivery'}</span>
                </div>
                ${orderData.deliveryOption.pickupLocation ? `
                  <div style="margin-top: 10px;">
                    <strong style="color: #555;">Pickup Location:</strong><br>
                    <span style="color: #333;">${orderData.deliveryOption.pickupLocation}</span>
                  </div>
                ` : ''}
                ${orderData.deliveryOption.address ? `
                  <div style="margin-top: 10px;">
                    <strong style="color: #555;">Delivery Address:</strong><br>
                    <span style="color: #333;">${orderData.deliveryOption.address}</span>
                  </div>
                ` : ''}
              </div>
            </div>
            
            <div style="background: #fff3cd; border: 1px solid #ffeaa7; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
              <h3 style="color: #856404; margin: 0 0 10px 0;">⚠️ Important - Payment Required</h3>
              <p style="color: #856404; margin: 0; font-size: 14px;">
                Your order has been placed successfully! Please complete the payment within 24 hours to confirm your order. 
                You can complete payment from your orders page.
              </p>
            </div>
            
            <div style="text-align: center; margin-top: 30px;">
              <a href="${process.env.NEXTAUTH_URL || 'https://www.funprinting.store'}/my-orders" 
                 style="display: inline-block; background: #28a745; color: white; padding: 15px 30px; 
                        text-decoration: none; border-radius: 5px; font-weight: bold; font-size: 16px; margin: 0 10px;">
                📋 View My Orders
              </a>
              <a href="${process.env.NEXTAUTH_URL || 'https://www.funprinting.store'}/contact" 
                 style="display: inline-block; background: #007bff; color: white; padding: 15px 30px; 
                        text-decoration: none; border-radius: 5px; font-weight: bold; font-size: 16px; margin: 0 10px;">
                📞 Contact Support
              </a>
            </div>
          </div>
          
          <div style="text-align: center; color: #666; font-size: 12px; margin-top: 30px; padding: 20px; border-top: 1px solid #eee;">
            <p>Thank you for choosing PrintService! We'll process your order as soon as payment is received.</p>
            <p>© 2024 PrintService. All rights reserved.</p>
          </div>
        </div>
      `,
    };

    console.log('📧 Attempting to send customer confirmation email...');
    const result = await transporter.sendMail(mailOptions);
    console.log('📧 Customer confirmation email sent successfully:', result.messageId);
    console.log(`✅ Order confirmation sent to customer: ${orderData.customerEmail}`);
    return true;
  } catch (error) {
    console.error('❌ Failed to send customer order confirmation:', error);
    return false;
  }
}

export async function sendPaymentReminderToCustomer(orderData: OrderNotificationData): Promise<boolean> {
  try {
    console.log('📧 Sending payment reminder to customer...');
    console.log('📧 Customer email:', orderData.customerEmail);
    
    const mailOptions = {
      from: process.env.EMAIL_USER || 'noreply@printservice.com',
      to: orderData.customerEmail,
      subject: `⏰ Payment Reminder - Order #${orderData.orderId} | PrintService`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background: linear-gradient(135deg, #ff6b35 0%, #f7931e 100%); color: white; padding: 30px; border-radius: 10px 10px 0 0; text-align: center;">
            <h1 style="margin: 0; font-size: 28px;">⏰ Payment Reminder</h1>
            <p style="margin: 10px 0 0 0; font-size: 16px; opacity: 0.9;">Complete your payment to confirm your order</p>
          </div>
          
          <div style="background: #f8f9fa; padding: 30px; border-radius: 0 0 10px 10px;">
            <div style="background: #fff3cd; border: 1px solid #ffeaa7; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
              <h3 style="color: #856404; margin: 0 0 10px 0;">⚠️ Payment Required</h3>
              <p style="color: #856404; margin: 0; font-size: 14px;">
                Your order is waiting for payment! Please complete payment within 24 hours or your order will expire.
              </p>
            </div>
            
            <div style="background: white; padding: 25px; border-radius: 8px; margin-bottom: 20px;">
              <h2 style="color: #333; margin: 0 0 20px 0;">Order Summary</h2>
              <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin-bottom: 20px;">
                <div>
                  <strong style="color: #555;">Order ID:</strong><br>
                  <span style="color: #333; font-weight: bold; font-size: 18px;">#${orderData.orderId}</span>
                </div>
                <div>
                  <strong style="color: #555;">Amount Due:</strong><br>
                  <span style="color: #ff6b35; font-weight: bold; font-size: 18px;">₹${orderData.amount}</span>
                </div>
                <div>
                  <strong style="color: #555;">Order Type:</strong><br>
                  <span style="color: #333;">${orderData.orderType === 'file' ? 'File Upload' : 'Template Generated'}</span>
                </div>
                <div>
                  <strong style="color: #555;">Pages:</strong><br>
                  <span style="color: #333; font-weight: bold;">${orderData.pageCount} pages</span>
                </div>
              </div>
              
              <div style="border-top: 1px solid #eee; padding-top: 15px;">
                <h3 style="color: #333; margin: 0 0 15px 0;">Printing Details</h3>
                <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px;">
                  <div>
                    <strong style="color: #555;">Size:</strong><br>
                    <span style="color: #333;">${orderData.printingOptions.pageSize}</span>
                  </div>
                  <div>
                    <strong style="color: #555;">Color:</strong><br>
                    <span style="color: #333;">${orderData.printingOptions.color === 'color' ? 'Color' : orderData.printingOptions.color === 'bw' ? 'Black & White' : 'Mixed'}</span>
                  </div>
                  <div>
                    <strong style="color: #555;">Copies:</strong><br>
                    <span style="color: #333;">${orderData.printingOptions.copies}</span>
                  </div>
                </div>
              </div>
            </div>
            
            <div style="text-align: center; margin-top: 30px;">
              <a href="${process.env.NEXTAUTH_URL || 'https://www.funprinting.store'}/my-orders" 
                 style="display: inline-block; background: #ff6b35; color: white; padding: 15px 30px; 
                        text-decoration: none; border-radius: 5px; font-weight: bold; font-size: 16px; margin: 0 10px;">
                💳 Complete Payment Now
              </a>
              <a href="${process.env.NEXTAUTH_URL || 'https://www.funprinting.store'}/contact" 
                 style="display: inline-block; background: #007bff; color: white; padding: 15px 30px; 
                        text-decoration: none; border-radius: 5px; font-weight: bold; font-size: 16px; margin: 0 10px;">
                📞 Need Help?
              </a>
            </div>
          </div>
          
          <div style="text-align: center; color: #666; font-size: 12px; margin-top: 30px; padding: 20px; border-top: 1px solid #eee;">
            <p>Don't miss out! Complete your payment to get your documents printed and delivered.</p>
            <p>© 2024 PrintService. All rights reserved.</p>
          </div>
        </div>
      `,
    };

    console.log('📧 Attempting to send payment reminder to customer...');
    const result = await transporter.sendMail(mailOptions);
    console.log('📧 Payment reminder sent successfully:', result.messageId);
    console.log(`✅ Payment reminder sent to customer: ${orderData.customerEmail}`);
    return true;
  } catch (error) {
    console.error('❌ Failed to send payment reminder to customer:', error);
    return false;
  }
}

export async function sendPaymentReminderToAdmin(orderData: OrderNotificationData): Promise<boolean> {
  try {
    const adminEmail = process.env.ADMIN_EMAIL ;
    
    console.log('📧 Sending payment reminder to admin...');
    console.log('📧 Admin email:', adminEmail);
    
    const mailOptions = {
      from: process.env.EMAIL_USER || 'noreply@printservice.com',
      to: adminEmail,
      subject: `⏰ Payment Reminder - Order #${orderData.orderId} Still Pending`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background: linear-gradient(135deg, #ffc107 0%, #ff8f00 100%); color: white; padding: 30px; border-radius: 10px 10px 0 0; text-align: center;">
            <h1 style="margin: 0; font-size: 28px;">⏰ Payment Reminder</h1>
            <p style="margin: 10px 0 0 0; font-size: 16px; opacity: 0.9;">Order still pending payment</p>
          </div>
          
          <div style="background: #f8f9fa; padding: 30px; border-radius: 0 0 10px 10px;">
            <div style="background: #fff3cd; border: 1px solid #ffeaa7; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
              <h3 style="color: #856404; margin: 0 0 10px 0;">⚠️ Pending Payment Alert</h3>
              <p style="color: #856404; margin: 0; font-size: 14px;">
                This order has been pending payment for some time. Customer may need assistance or a reminder.
              </p>
            </div>
            
            <div style="background: white; padding: 25px; border-radius: 8px; margin-bottom: 20px;">
              <h2 style="color: #333; margin: 0 0 20px 0;">Order Details</h2>
              <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin-bottom: 20px;">
                <div>
                  <strong style="color: #555;">Order ID:</strong><br>
                  <span style="color: #333; font-weight: bold; font-size: 18px;">#${orderData.orderId}</span>
                </div>
                <div>
                  <strong style="color: #555;">Amount:</strong><br>
                  <span style="color: #ffc107; font-weight: bold; font-size: 18px;">₹${orderData.amount}</span>
                </div>
                <div>
                  <strong style="color: #555;">Customer:</strong><br>
                  <span style="color: #333;">${orderData.customerName}</span>
                </div>
                <div>
                  <strong style="color: #555;">Email:</strong><br>
                  <span style="color: #333;">${orderData.customerEmail}</span>
                </div>
                <div>
                  <strong style="color: #555;">Phone:</strong><br>
                  <span style="color: #333;">${orderData.customerPhone}</span>
                </div>
                <div>
                  <strong style="color: #555;">Pages:</strong><br>
                  <span style="color: #333; font-weight: bold;">${orderData.pageCount} pages</span>
                </div>
              </div>
              
              <div style="border-top: 1px solid #eee; padding-top: 15px;">
                <h3 style="color: #333; margin: 0 0 15px 0;">Order Summary</h3>
                <p><strong>Type:</strong> ${orderData.orderType === 'file' ? 'File Upload' : 'Template Generated'}</p>
                <p><strong>Printing:</strong> ${orderData.printingOptions.pageSize}, ${orderData.printingOptions.color === 'color' ? 'Color' : orderData.printingOptions.color === 'bw' ? 'Black & White' : 'Mixed'}, ${orderData.printingOptions.copies} copies</p>
                <p><strong>Delivery:</strong> ${orderData.deliveryOption.type === 'pickup' ? 'Pickup' : 'Home Delivery'}</p>
              </div>
            </div>
            
            <div style="text-align: center; margin-top: 30px;">
              <a href="${process.env.NEXTAUTH_URL || 'https://www.funprinting.store'}/admin/orders/${orderData.orderId}" 
                 style="display: inline-block; background: #ffc107; color: white; padding: 15px 30px; 
                        text-decoration: none; border-radius: 5px; font-weight: bold; font-size: 16px; margin: 0 10px;">
                📊 View Order Details
              </a>
              <a href="${process.env.NEXTAUTH_URL || 'https://www.funprinting.store'}/admin" 
                 style="display: inline-block; background: #007bff; color: white; padding: 15px 30px; 
                        text-decoration: none; border-radius: 5px; font-weight: bold; font-size: 16px; margin: 0 10px;">
                🏠 Admin Dashboard
              </a>
            </div>
          </div>
          
          <div style="text-align: center; color: #666; font-size: 12px; margin-top: 30px; padding: 20px; border-top: 1px solid #eee;">
            <p>Consider reaching out to the customer if payment is not completed soon.</p>
            <p>© 2024 PrintService. All rights reserved.</p>
          </div>
        </div>
      `,
    };

    console.log('📧 Attempting to send payment reminder to admin...');
    const result = await transporter.sendMail(mailOptions);
    console.log('📧 Admin payment reminder sent successfully:', result.messageId);
    console.log(`✅ Payment reminder sent to admin: ${adminEmail}`);
    return true;
  } catch (error) {
    console.error('❌ Failed to send payment reminder to admin:', error);
    return false;
  }
}

export async function sendPaymentNotification(orderData: OrderNotificationData, paymentStatus: 'completed' | 'failed'): Promise<boolean> {
  try {
    const adminEmail = process.env.ADMIN_EMAIL ;
    
    const statusEmoji = paymentStatus === 'completed' ? '✅' : '❌';
    const statusColor = paymentStatus === 'completed' ? '#28a745' : '#dc3545';
    const statusText = paymentStatus === 'completed' ? 'Payment Completed' : 'Payment Failed';
    
    const mailOptions = {
      from: process.env.EMAIL_USER || 'noreply@printservice.com',
      to: adminEmail,
      subject: `${statusEmoji} Payment ${statusText} - Order #${orderData.orderId}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background: ${statusColor}; color: white; padding: 30px; border-radius: 10px 10px 0 0; text-align: center;">
            <h1 style="margin: 0; font-size: 24px;">${statusEmoji} Payment ${statusText}</h1>
            <p style="margin: 10px 0 0 0; font-size: 16px; opacity: 0.9;">Order #${orderData.orderId}</p>
          </div>
          
          <div style="background: #f8f9fa; padding: 30px; border-radius: 0 0 10px 10px;">
            <div style="background: white; padding: 25px; border-radius: 8px; margin-bottom: 20px;">
              <h2 style="color: #333; margin: 0 0 20px 0;">Order Summary</h2>
              <p><strong>Customer:</strong> ${orderData.customerName}</p>
              <p><strong>Amount:</strong> ₹${orderData.amount}</p>
              <p><strong>Status:</strong> <span style="background: ${statusColor}; color: white; padding: 4px 8px; border-radius: 4px; font-size: 12px;">${statusText.toUpperCase()}</span></p>
            </div>
            
            <div style="text-align: center;">
              <a href="${process.env.NEXTAUTH_URL || 'https://www.funprinting.store'}/admin/orders/${orderData.orderId}" 
                 style="display: inline-block; background: #007bff; color: white; padding: 15px 30px; 
                        text-decoration: none; border-radius: 5px; font-weight: bold;">
                View Order Details
              </a>
            </div>
          </div>
        </div>
      `,
    };

    await transporter.sendMail(mailOptions);
    console.log(`✅ Payment ${paymentStatus} notification sent to admin: ${adminEmail}`);
    return true;
  } catch (error) {
    console.error(`❌ Error sending payment ${paymentStatus} notification:`, error);
    return false;
  }
}
