import { getMailTransporter } from '@/lib/mailer';
import { generateInvoicePDF, InvoiceData } from './invoiceGenerator';
import { IOrder } from '@/models/Order';


/**
 * Generate HTML email body for invoice
 */
/** Customer-entered text (names, file names, addresses) must not become HTML. */
const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);

function generateInvoiceHTML(order: IOrder, deliveryNumber: string): string {
  const d = order.deliveryOption;
  const deliveryMethod = d.type === 'pickup' ? 'Pickup from the shop' : d.method === 'shop' ? 'Delivered by the shop' : 'Courier delivery';
  const address = [d.flatBuilding, d.address, d.landmark, d.city, d.state, d.pinCode].filter(Boolean).join(', ');
  const paid = typeof order.amountPaid === 'number' ? order.amountPaid : order.amount;
  const site = (process.env.APP_BASE_URL || process.env.NEXTAUTH_URL || '').replace(/\/+$/, '');
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
                <div class="detail-value">${esc(order.customerInfo.name)}</div>
              </div>
              <div class="detail-item">
                <div class="detail-label">Email:</div>
                <div class="detail-value">${esc(order.customerInfo.email)}</div>
              </div>
              <div class="detail-item">
                <div class="detail-label">Phone:</div>
                <div class="detail-value">${esc(order.customerInfo.phone)}</div>
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
                <div class="detail-value">${esc(order.originalFileName || 'N/A')}</div>
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
                <div class="detail-value">${deliveryMethod}</div>
              </div>
              ${order.deliveryOption.type === 'pickup' && order.deliveryOption.pickupLocation ? `
              <div class="detail-item">
                <div class="detail-label">Pickup Location:</div>
                <div class="detail-value">${esc(order.deliveryOption.pickupLocation.name)}<br>${esc(order.deliveryOption.pickupLocation.address)}</div>
              </div>
              ` : ''}
              ${d.type === 'delivery' && address ? `
              <div class="detail-item">
                <div class="detail-label">Delivery Address:</div>
                <div class="detail-value">${esc(address)}</div>
              </div>
              ` : ''}
            </div>
            
            <div class="total-section">
              <div class="detail-label" style="font-size: 18px;">Total Amount:</div>
              <div class="total-amount">₹${paid.toFixed(2)}</div>
              <div style="margin-top: 10px; color: #28a745; font-weight: bold;">
                Payment Status: ${order.paymentStatus === 'completed' ? '✅ Paid' : order.paymentStatus}
              </div>
            </div>
          </div>
          
          ${d.type === 'delivery' && d.method === 'shop' && d.handover?.code ? `
          <div style="background: #eef2ff; border: 1px solid #c7d2fe; padding: 20px; border-radius: 8px; margin-bottom: 20px; text-align: center;">
            <h3 style="color: #3730a3; margin: 0 0 8px 0;">Your delivery code</h3>
            <p style="font-family: monospace; font-size: 32px; letter-spacing: 8px; margin: 0; color: #111827;">${esc(d.handover.code)}</p>
            <p style="color: #4b5563; margin: 8px 0 0 0; font-size: 14px;">Give this code to the shop's delivery person when you receive your order. Don't share it before.</p>
          </div>
          ` : ''}
          <div style="background: #fff3cd; border: 1px solid #ffeaa7; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
            <h3 style="color: #856404; margin: 0 0 10px 0;">📎 Invoice PDF Attached</h3>
            <p style="color: #856404; margin: 0; font-size: 14px;">
              Please find the PDF invoice attached to this email. Keep this invoice for your records.
            </p>
          </div>
        </div>
        
        <div class="footer">
          <p>Thank you for choosing Fun Printing!</p>
          ${site ? `<p>Questions? <a href="${site}/contact">Contact us</a> or see <a href="${site}/my-orders">My orders</a>.</p>` : ''}
          <p>© ${new Date().getFullYear()} Fun Printing</p>
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
      from: process.env.EMAIL_USER,
      to: order.customerInfo.email,
      subject: `Invoice for order #${order.orderId} | Fun Printing`,
      html: htmlBody,
      attachments: [
        {
          filename: `Invoice_${order.orderId}.pdf`,
          content: pdfBuffer,
          contentType: 'application/pdf'
        }
      ]
    };

    console.log(`📧 Sending invoice email for order ${order.orderId}...`);
    const result = await getMailTransporter().sendMail(mailOptions);
    console.log(`✅ Invoice email sent successfully: ${result.messageId}`);
    console.log(`✅ Invoice sent for order ${order.orderId}`);

    return true;
  } catch (error) {
    console.error('❌ Error sending invoice email:', error);
    return false;
  }
}

