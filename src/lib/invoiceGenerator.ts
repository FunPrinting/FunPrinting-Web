import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import { IOrder } from '@/models/Order';

/** Public site address for the invoice footer (no made-up email addresses). */
const SITE = (process.env.APP_BASE_URL || process.env.NEXTAUTH_URL || '').replace(/\/+$/, '');

export interface InvoiceData {
  order: IOrder;
  deliveryNumber: string;
}

/**
 * Generate PDF invoice
 */
export async function generateInvoicePDF(data: InvoiceData): Promise<Buffer> {
  const { order, deliveryNumber } = data;

  // Create a new PDF document
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([612, 792]); // A4 size
  const { width, height } = page.getSize();

  // Load fonts
  const helveticaFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const helveticaBoldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  let yPosition = height - 50;

  // Header
  page.drawText('INVOICE', {
    x: 50,
    y: yPosition,
    size: 24,
    font: helveticaBoldFont,
    color: rgb(0, 0, 0),
  });

  yPosition -= 40;

  // Company Info
  page.drawText('Fun Printing', {
    x: 50,
    y: yPosition,
    size: 14,
    font: helveticaBoldFont,
  });

  yPosition -= 20;
  page.drawText('Online printing marketplace', {
    x: 50,
    y: yPosition,
    size: 10,
    font: helveticaFont,
  });

  yPosition -= 20;
  page.drawText(SITE ? `Web: ${SITE}` : '', {
    x: 50,
    y: yPosition,
    size: 10,
    font: helveticaFont,
  });

  // Invoice Details (Right side)
  const rightX = width - 200;
  yPosition = height - 50;

  page.drawText('Invoice Details', {
    x: rightX,
    y: yPosition,
    size: 12,
    font: helveticaBoldFont,
  });

  yPosition -= 20;
  page.drawText(`Invoice #: ${order.orderId}`, {
    x: rightX,
    y: yPosition,
    size: 10,
    font: helveticaFont,
  });

  yPosition -= 15;
  page.drawText(`Delivery #: ${deliveryNumber}`, {
    x: rightX,
    y: yPosition,
    size: 10,
    font: helveticaFont,
  });

  yPosition -= 15;
  page.drawText(`Date: ${new Date(order.createdAt).toLocaleDateString('en-IN')}`, {
    x: rightX,
    y: yPosition,
    size: 10,
    font: helveticaFont,
  });

  yPosition -= 15;
  page.drawText(`Payment ID: ${order.razorpayPaymentId || 'N/A'}`, {
    x: rightX,
    y: yPosition,
    size: 10,
    font: helveticaFont,
  });

  // Customer Information
  yPosition = height - 200;
  page.drawText('Bill To:', {
    x: 50,
    y: yPosition,
    size: 12,
    font: helveticaBoldFont,
  });

  yPosition -= 20;
  page.drawText(order.customerInfo.name, {
    x: 50,
    y: yPosition,
    size: 11,
    font: helveticaFont,
  });

  yPosition -= 15;
  page.drawText(`Email: ${order.customerInfo.email}`, {
    x: 50,
    y: yPosition,
    size: 10,
    font: helveticaFont,
  });

  yPosition -= 15;
  page.drawText(`Phone: ${order.customerInfo.phone}`, {
    x: 50,
    y: yPosition,
    size: 10,
    font: helveticaFont,
  });

  // Order Details
  yPosition = height - 350;
  page.drawText('Order Details', {
    x: 50,
    y: yPosition,
    size: 12,
    font: helveticaBoldFont,
  });

  yPosition -= 25;
  const orderDetails = [
    { label: 'Order Type', value: order.orderType === 'file' ? 'File Upload' : 'Template Generated' },
    { label: 'File Name', value: order.originalFileName || 'N/A' },
    { label: 'Page Size', value: order.printingOptions.pageSize },
    { label: 'Color', value: order.printingOptions.color === 'color' ? 'Color' : order.printingOptions.color === 'bw' ? 'Black & White' : 'Mixed' },
    { label: 'Sides', value: order.printingOptions.sided === 'single' ? 'Single Sided' : 'Double Sided' },
    { label: 'Copies', value: order.printingOptions.copies.toString() },
    { label: 'Pages', value: (order.printingOptions.pageCount || 1).toString() },
    { label: 'Delivery', value: order.deliveryOption.type === 'pickup' ? 'Pickup' : 'Home Delivery' },
  ];

  for (const detail of orderDetails) {
    page.drawText(`${detail.label}:`, {
      x: 50,
      y: yPosition,
      size: 10,
      font: helveticaBoldFont,
    });
    page.drawText(detail.value, {
      x: 200,
      y: yPosition,
      size: 10,
      font: helveticaFont,
    });
    yPosition -= 18;
  }

  // Pickup/Delivery Location
  if (order.deliveryOption.type === 'pickup' && order.deliveryOption.pickupLocation) {
    yPosition -= 10;
    page.drawText('Pickup Location:', {
      x: 50,
      y: yPosition,
      size: 10,
      font: helveticaBoldFont,
    });
    yPosition -= 15;
    page.drawText(order.deliveryOption.pickupLocation.name, {
      x: 50,
      y: yPosition,
      size: 10,
      font: helveticaFont,
    });
    yPosition -= 15;
    page.drawText(order.deliveryOption.pickupLocation.address, {
      x: 50,
      y: yPosition,
      size: 10,
      font: helveticaFont,
    });
  } else if (order.deliveryOption.type === 'delivery' && order.deliveryOption.address) {
    yPosition -= 10;
    page.drawText('Delivery Address:', {
      x: 50,
      y: yPosition,
      size: 10,
      font: helveticaBoldFont,
    });
    yPosition -= 15;
    page.drawText(order.deliveryOption.address, {
      x: 50,
      y: yPosition,
      size: 10,
      font: helveticaFont,
    });
  }

  // Total Amount
  yPosition = 150;
  page.drawLine({
    start: { x: 50, y: yPosition },
    end: { x: width - 50, y: yPosition },
    thickness: 1,
    color: rgb(0, 0, 0),
  });

  yPosition -= 30;
  page.drawText('Total Amount:', {
    x: width - 200,
    y: yPosition,
    size: 14,
    font: helveticaBoldFont,
  });

  page.drawText(`₹${order.amount.toFixed(2)}`, {
    x: width - 100,
    y: yPosition,
    size: 14,
    font: helveticaBoldFont,
    color: rgb(0, 0.5, 0),
  });

  // Payment Status
  yPosition -= 30;
  page.drawText(`Payment Status: ${order.paymentStatus === 'completed' ? 'Paid' : order.paymentStatus}`, {
    x: 50,
    y: yPosition,
    size: 10,
    font: helveticaFont,
    color: order.paymentStatus === 'completed' ? rgb(0, 0.5, 0) : rgb(0.8, 0, 0),
  });

  // Footer
  yPosition = 50;
  page.drawText('Thank you for choosing Fun Printing!', {
    x: 50,
    y: yPosition,
    size: 10,
    font: helveticaFont,
    color: rgb(0.5, 0.5, 0.5),
  });

  yPosition -= 15;
  page.drawText(SITE ? `Support: ${SITE}/contact` : '', {
    x: 50,
    y: yPosition,
    size: 9,
    font: helveticaFont,
    color: rgb(0.5, 0.5, 0.5),
  });

  // Serialize PDF to bytes
  const pdfBytes = await pdfDoc.save();
  return Buffer.from(pdfBytes);
}

