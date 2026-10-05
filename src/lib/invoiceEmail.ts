import nodemailer from 'nodemailer';
import { generateInvoicePDF, InvoiceData } from './invoiceGenerator';
import { IOrder } from '@/models/Order';

// Configure email transporter
const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST || 'smtp.gmail.com',
  port: parseInt(process.env.EMAIL_PORT || '587'),
  secure: false,
  auth: {
    user: process.env.EMAIL_HOST_USER ,
    pass: process.env.EMAIL_HOST_PASSWORD || 'hagbaiwzqltgfflz',
  },
  tls: {
    rejectUnauthorized: false
  }
});

/**
 * Generate HTML email body for invoice
 */
function generateInvoiceHTML(order: IOrder, deliveryNumber: string): string {
  const orderDate = new Date(order.createdAt).toLocaleDateString('en-IN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; border-radius: 10px 10px 0 0; text-align: center; }
        .content { background: #f8f9fa; padding: 30px; border-radius: 0 0 10px 10px; }
        .invoice-box { background: white; padding: 25px; border-radius: 8px; margin-bottom: 20px; }
        .invoice-header { border-bottom: 2px solid #007bff; padding-bottom: 10px; margin-bottom: 20px; }
        .invoice-details { display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin-bottom: 20px; }
        .detail-item { margin-bottom: 10px; }
        .detail-label { font-weight: bold; color: #555; }
        .detail-value { color: #333; }
        .total-section { border-top: 2px solid #000; padding-top: 20px; margin-top: 20px; text-align: right; }
        .total-amount { font-size: 24px; font-weight: bold; color: #28a745; }
        .footer { text-align: center; color: #666; font-size: 12px; margin-top: 30px; padding: 20px; border-top: 1px solid #eee; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1 style="margin: 0; font-size: 28px;">📄 Invoice</h1>
          <p style="margin: 10px 0 0 0; font-size: 16px; opacity: 0.9;">Order #${order.orderId}</p>
        </div>
        
        <div class="content">
          <div class="invoice-box">
            <div class="invoice-header">
              <h2 style="color: #333; margin: 0;">Invoice Details</h2>
            </div>
            
            <div class="invoice-details">
              <div class="detail-item">
                <div class="detail-label">Invoice Number:</div>
                <div class="detail-value">${order.orderId}</div>
              </div>
              <div class="detail-item">
                <div class="detail-label">Delivery Number:</div>
                <div class="detail-value">${deliveryNumber}</div>
              </div>
              <div class="detail-item">
                <div class="detail-label">Invoice Date:</div>
                <div class="detail-value">${orderDate}</div>
              </div>
              <div class="detail-item">
                <div class="detail-label">Payment ID:</div>
                <div class="detail-value">${order.razorpayPaymentId || 'N/A'}</div>
              </div>
            </div>
            
            <div style="margin-top: 20px;">
              <h3 style="color: #333; margin: 0 0 15px 0;">Customer Information</h3>
              <div class="detail-item">
                <div class="detail-label">Name:</div>
                <div class="detail-value">${order.customerInfo.name}</div>
              </div>
              <div class="detail-item">
                <div class="detail-label">Email:</div>
                <div class="detail-value">${order.customerInfo.email}</div>
              </div>
              <div class="detail-item">
                <div class="detail-label">Phone:</div>
                <div class="detail-value">${order.customerInfo.phone}</div>
              </div>
            </div>
            
            <div style="margin-top: 20px;">
              <h3 style="color: #333; margin: 0 0 15px 0;">Order Details</h3>
              <div class="detail-item">
                <div class="detail-label">Order Type:</div>
                <div class="detail-value">${order.orderType === 'file' ? 'File Upload' : 'Template Generated'}</div>
              </div>
              <div class="detail-item">
                <div class="detail-label">File Name:</div>
                <div class="detail-value">${order.originalFileName || 'N/A'}</div>
              </div>
              <div class="detail-item">
                <div class="detail-label">Page Size:</div>
                <div class="detail-value">${order.printingOptions.pageSize}</div>
              </div>
              <div class="detail-item">
                <div class="detail-label">Color:</div>
                <div class="detail-value">${order.printingOptions.color === 'color' ? 'Color' : order.printingOptions.color === 'bw' ? 'Black & White' : 'Mixed'}</div>
              </div>
              <div class="detail-item">
                <div class="detail-label">Sides:</div>
                <div class="detail-value">${order.printingOptions.sided === 'single' ? 'Single Sided' : 'Double Sided'}</div>
              </div>
              <div class="detail-item">
                <div class="detail-label">Copies:</div>
                <div class="detail-value">${order.printingOptions.copies}</div>
              </div>
              <div class="detail-item">
                <div class="detail-label">Pages:</div>
                <div class="detail-value">${order.printingOptions.pageCount || 1}</div>
              </div>
              <div class="detail-item">
                <div class="detail-label">Delivery Method:</div>
                <div class="detail-value">${order.deliveryOption.type === 'pickup' ? 'Pickup' : 'Home Delivery'}</div>
              </div>
              ${order.deliveryOption.type === 'pickup' && order.deliveryOption.pickupLocation ? `
              <div class="detail-item">
                <div class="detail-label">Pickup Location:</div>
                <div class="detail-value">${order.deliveryOption.pickupLocation.name}<br>${order.deliveryOption.pickupLocation.address}</div>
              </div>
              ` : ''}
              ${order.deliveryOption.type === 'delivery' && order.deliveryOption.address ? `
              <div class="detail-item">
                <div class="detail-label">Delivery Address:</div>
                <div class="detail-value">${order.deliveryOption.address}</div>
              </div>
              ` : ''}
            </div>
            
            <div class="total-section">
              <div class="detail-label" style="font-size: 18px;">Total Amount:</div>
              <div class="total-amount">₹${order.amount.toFixed(2)}</div>
              <div style="margin-top: 10px; color: #28a745; font-weight: bold;">
                Payment Status: ${order.paymentStatus === 'completed' ? '✅ Paid' : order.paymentStatus}
              </div>
            </div>
          </div>
          
          <div style="background: #fff3cd; border: 1px solid #ffeaa7; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
            <h3 style="color: #856404; margin: 0 0 10px 0;">📎 Invoice PDF Attached</h3>
            <p style="color: #856404; margin: 0; font-size: 14px;">
              Please find the PDF invoice attached to this email. Keep this invoice for your records.
            </p>
          </div>
        </div>
        
        <div class="footer">
          <p>Thank you for choosing PrintService!</p>
          <p>For support, contact: support@printservice.com</p>
          <p>© ${new Date().getFullYear()} PrintService. All rights reserved.</p>
        </div>
      </div>
    </body>
    </html>
  `;
}

/**
 * Send invoice email with PDF attachment
 */
export async function sendInvoiceEmail(order: IOrder, deliveryNumber: string): Promise<boolean> {
  try {
    console.log(`📧 Generating invoice for order ${order.orderId}...`);

    // Generate PDF invoice
    const pdfBuffer = await generateInvoicePDF({ order, deliveryNumber });
    console.log(`✅ Invoice PDF generated (${pdfBuffer.length} bytes)`);

    // Generate HTML email body
    const htmlBody = generateInvoiceHTML(order, deliveryNumber);

    // Send email
    const mailOptions = {
      from: process.env.EMAIL_USER || 'noreply@printservice.com',
      to: order.customerInfo.email,
      subject: `📄 Invoice - Order #${order.orderId} | PrintService`,
      html: htmlBody,
      attachments: [
        {
          filename: `Invoice_${order.orderId}.pdf`,
          content: pdfBuffer,
          contentType: 'application/pdf'
        }
      ]
    };

    console.log(`📧 Sending invoice email to ${order.customerInfo.email}...`);
    const result = await transporter.sendMail(mailOptions);
    console.log(`✅ Invoice email sent successfully: ${result.messageId}`);
    console.log(`✅ Invoice sent to customer: ${order.customerInfo.email}`);

    return true;
  } catch (error) {
    console.error('❌ Error sending invoice email:', error);
    return false;
  }
}

