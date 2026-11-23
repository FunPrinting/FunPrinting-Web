import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import { IOrder } from '@/models/Order';

/** Public site address for the invoice footer (no made-up email addresses). */
const SITE = (process.env.APP_BASE_URL || process.env.NEXTAUTH_URL || '').replace(/\/+$/, '');

export interface InvoiceData {
  order: IOrder;
  deliveryNumber: string;
}

function drawSafeText(
  page: any,
  text: unknown,
  options: { x: number; y: number; size: number; font: any; color?: any }
) {
  const safeStr = text !== undefined && text !== null ? String(text) : 'N/A';
  if (!safeStr) return;
  page.drawText(safeStr, options);
}

/**
 * Generate PDF invoice with defensive string validation
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
  drawSafeText(page, 'INVOICE', {
    x: 50,
    y: yPosition,
    size: 24,
    font: helveticaBoldFont,
    color: rgb(0, 0, 0),
  });

  yPosition -= 40;

  // Company Info
  drawSafeText(page, 'Fun Printing', {
    x: 50,
    y: yPosition,
    size: 14,
    font: helveticaBoldFont,
  });

  yPosition -= 20;
  drawSafeText(page, 'Online printing marketplace', {
    x: 50,
    y: yPosition,
    size: 10,
    font: helveticaFont,
  });

  yPosition -= 20;
  if (SITE) {
    drawSafeText(page, `Web: ${SITE}`, {
      x: 50,
      y: yPosition,
      size: 10,
      font: helveticaFont,
    });
  }

  // Invoice Details (Right side)
  const rightX = width - 200;
  yPosition = height - 50;

  drawSafeText(page, 'Invoice Details', {
    x: rightX,
    y: yPosition,
    size: 12,
    font: helveticaBoldFont,
  });

  yPosition -= 20;
  drawSafeText(page, `Invoice #: ${order.orderId || 'N/A'}`, {
    x: rightX,
    y: yPosition,
    size: 10,
    font: helveticaFont,
  });

  yPosition -= 15;
  drawSafeText(page, `Delivery #: ${deliveryNumber || 'N/A'}`, {
    x: rightX,
    y: yPosition,
    size: 10,
    font: helveticaFont,
  });

  yPosition -= 15;
  const orderDate = order.createdAt ? new Date(order.createdAt).toLocaleDateString('en-IN') : new Date().toLocaleDateString('en-IN');
  drawSafeText(page, `Date: ${orderDate}`, {
    x: rightX,
    y: yPosition,
    size: 10,
    font: helveticaFont,
  });

  yPosition -= 15;
  const paymentId = (order as any).razorpayPaymentId || order.paymentRef || 'N/A';
  drawSafeText(page, `Payment ID: ${paymentId}`, {
    x: rightX,
    y: yPosition,
    size: 10,
    font: helveticaFont,
  });

  // Customer Information
  yPosition = height - 200;
  drawSafeText(page, 'Bill To:', {
    x: 50,
    y: yPosition,
    size: 12,
    font: helveticaBoldFont,
  });

  yPosition -= 20;
  const customerName = order.customerInfo?.name || 'Valued Customer';
  drawSafeText(page, customerName, {
    x: 50,
    y: yPosition,
    size: 11,
    font: helveticaFont,
  });

  yPosition -= 15;
  drawSafeText(page, `Email: ${order.customerInfo?.email || 'N/A'}`, {
    x: 50,
    y: yPosition,
    size: 10,
    font: helveticaFont,
  });

  yPosition -= 15;
  drawSafeText(page, `Phone: ${order.customerInfo?.phone || 'N/A'}`, {
    x: 50,
    y: yPosition,
    size: 10,
    font: helveticaFont,
  });

  // Order Details
  yPosition = height - 350;
  drawSafeText(page, 'Order Details', {
    x: 50,
    y: yPosition,
    size: 12,
    font: helveticaBoldFont,
  });

  yPosition -= 25;
  const pageSize = order.printingOptions?.pageSize || 'A4';
  const color = order.printingOptions?.color === 'color' ? 'Color' : order.printingOptions?.color === 'bw' ? 'Black & White' : 'Mixed';
  const sides = order.printingOptions?.sided === 'single' ? 'Single Sided' : 'Double Sided';
  const copies = String(order.printingOptions?.copies || 1);
  const pageCount = String(order.printingOptions?.pageCount || 1);
  const deliveryType = order.deliveryOption?.type === 'pickup' ? 'Pickup' : 'Home Delivery';
  const fileName = order.originalFileName || (order.originalFileNames && order.originalFileNames[0]) || 'Document';

  const orderDetails = [
    { label: 'Order Type', value: order.orderType === 'file' ? 'File Upload' : 'Template Generated' },
    { label: 'File Name', value: fileName },
    { label: 'Page Size', value: pageSize },
    { label: 'Color', value: color },
    { label: 'Sides', value: sides },
    { label: 'Copies', value: copies },
    { label: 'Pages', value: pageCount },
    { label: 'Delivery', value: deliveryType },
  ];

  for (const detail of orderDetails) {
    drawSafeText(page, `${detail.label}:`, {
      x: 50,
      y: yPosition,
      size: 10,
      font: helveticaBoldFont,
    });
    drawSafeText(page, detail.value, {
      x: 200,
      y: yPosition,
      size: 10,
      font: helveticaFont,
    });
    yPosition -= 18;
  }

  // Pickup/Delivery Location
  if (order.deliveryOption?.type === 'pickup') {
    yPosition -= 10;
    drawSafeText(page, 'Pickup Location:', {
      x: 50,
      y: yPosition,
      size: 10,
      font: helveticaBoldFont,
    });
    yPosition -= 15;
    const pickupName = (order.deliveryOption as any)?.pickupLocation?.name || order.deliveryOption?.partnerDeliveryPoint || 'Partner Shop';
    drawSafeText(page, pickupName, {
      x: 50,
      y: yPosition,
      size: 10,
      font: helveticaFont,
    });
    yPosition -= 15;
    const pickupAddr = (order.deliveryOption as any)?.pickupLocation?.address || order.deliveryOption?.address || 'Pickup at partner location';
    drawSafeText(page, pickupAddr, {
      x: 50,
      y: yPosition,
      size: 10,
      font: helveticaFont,
    });
  } else if (order.deliveryOption?.type === 'delivery') {
    yPosition -= 10;
    drawSafeText(page, 'Delivery Address:', {
      x: 50,
      y: yPosition,
      size: 10,
      font: helveticaBoldFont,
    });
    yPosition -= 15;
    const parts = [
      order.deliveryOption?.flatBuilding,
      order.deliveryOption?.address,
      order.deliveryOption?.landmark,
      order.deliveryOption?.city,
      order.deliveryOption?.state,
      order.deliveryOption?.pinCode,
    ].filter(Boolean);
    const fullAddr = parts.length > 0 ? parts.join(', ') : (order.deliveryOption?.address || 'Delivery Address Provided');
    drawSafeText(page, fullAddr.slice(0, 75), {
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
  drawSafeText(page, 'Total Amount:', {
    x: width - 200,
    y: yPosition,
    size: 14,
    font: helveticaBoldFont,
  });

  const amountNumber = typeof order.amount === 'number' ? order.amount : 0;
  drawSafeText(page, `₹${amountNumber.toFixed(2)}`, {
    x: width - 100,
    y: yPosition,
    size: 14,
    font: helveticaBoldFont,
    color: rgb(0, 0.5, 0),
  });

  // Payment Status
  yPosition -= 30;
  const payStatus = order.paymentStatus === 'completed' ? 'Paid' : (order.paymentStatus || 'Pending');
  drawSafeText(page, `Payment Status: ${payStatus}`, {
    x: 50,
    y: yPosition,
    size: 10,
    font: helveticaFont,
    color: order.paymentStatus === 'completed' ? rgb(0, 0.5, 0) : rgb(0.8, 0, 0),
  });

  // Footer
  yPosition = 50;
  drawSafeText(page, 'Thank you for choosing Fun Printing!', {
    x: 50,
    y: yPosition,
    size: 10,
    font: helveticaFont,
    color: rgb(0.5, 0.5, 0.5),
  });

  yPosition -= 15;
  if (SITE) {
    drawSafeText(page, `Support: ${SITE}/contact`, {
      x: 50,
      y: yPosition,
      size: 9,
      font: helveticaFont,
      color: rgb(0.5, 0.5, 0.5),
    });
  }

  // Serialize PDF to bytes
  const pdfBytes = await pdfDoc.save();
  return Buffer.from(pdfBytes);
}
