import 'server-only';
import { z } from 'zod';
import connectDB from '@/lib/mongodb';
import Order from '@/models/Order';
import Partner from '@/models/Partner';
import { getPricing } from '@/lib/pricing';
import { getFileTypeFromFileNames } from '@/lib/fileTypeDetection';
import { getDeliveryQuote, isValidPincode, tierCharge } from '@/lib/delivery/rates';
import { verifyUploadReceipt, type UploadReceipt } from '@/lib/uploads/receipt';
import { normaliseColorPages, parcelWeightKg, quotePrintOrder, QuoteError, type QuoteFile } from '@/lib/payments/quote';
import { assertChargeable, paiseToRupees, withProcessingFee } from '@/lib/payments/money';
import { createLinkForPayment, newPaymentAttempt, type CheckoutResult } from '@/lib/payments/links';
import type { SessionUser } from '@/lib/authz';

/** Errors shown to the customer as-is (400). */
export class CheckoutError extends Error {
  constructor(message: string, public readonly status = 400) {
    super(message);
    this.name = 'CheckoutError';
  }
}

const phone = z.string().trim().regex(/^\+?\d[\d\s-]{8,14}\d$/, 'Enter a valid phone number');

export const printCheckoutSchema = z.object({
  idempotencyKey: z.string().trim().min(8).max(64),
  customerInfo: z.object({
    name: z.string().trim().min(1, 'Name is required').max(100),
    phone,
    email: z.string().trim().email().max(200),
  }),
  files: z
    .array(
      z.object({
        receipt: z.string().min(10),
        pageSize: z.enum(['A4', 'A3']),
        color: z.enum(['color', 'bw', 'mixed']),
        sided: z.enum(['single', 'double']),
        copies: z.number().int().min(1).max(100),
        colorPages: z.array(z.number().int().positive()).max(2000).optional(),
        service: z.enum(['binding', 'file', 'service']).optional(),
      })
    )
    .min(1, 'Add at least one file')
    .max(20),
  delivery: z.object({
    type: z.enum(['pickup', 'delivery']),
    pickupLocationId: z.string().max(64).optional(),
    partnerId: z.string().regex(/^[0-9a-fA-F]{24}$/).optional(),
    partnerDeliveryPoint: z.string().max(200).optional(),
    speed: z.enum(['standard', 'express', 'sameday']).optional(),
    recipientName: z.string().trim().max(100).optional(),
    recipientPhone: z.string().trim().max(20).optional(),
    address: z.string().trim().max(500).optional(),
    flatBuilding: z.string().trim().max(200).optional(),
    landmark: z.string().trim().max(200).optional(),
    city: z.string().trim().max(100).optional(),
    state: z.string().trim().max(100).optional(),
    pinCode: z.string().trim().max(10).optional(),
    location: z.object({ lat: z.number(), lng: z.number(), address: z.string().max(500).optional() }).optional(),
  }),
  expectedDate: z.string().max(40).optional(),
});

export type PrintCheckoutInput = z.infer<typeof printCheckoutSchema>;

async function pickupLocationSnapshot(id: string | undefined) {
  if (!id) return undefined;
  const PickupLocation = (await import('@/models/PickupLocation')).default;
  const loc = await PickupLocation.findById(id).lean<Record<string, unknown> | null>().catch(() => null);
  if (!loc) return undefined;
  const pick = (k: string) => loc[k] as never;
  return {
    _id: String(loc._id),
    name: pick('name'),
    address: pick('address'),
    lat: pick('lat'),
    lng: pick('lng'),
    contactPerson: pick('contactPerson'),
    contactPhone: pick('contactPhone'),
    operatingHours: pick('operatingHours'),
    gmapLink: pick('gmapLink'),
  };
}

/**
 * Creates the order (pending_payment), the Payment record and the Razorpay Payment
 * Link. The price is computed here from server data only.
 */
export async function createPrintCheckout(user: SessionUser, input: PrintCheckoutInput, requestOrigin: string): Promise<CheckoutResult> {
  await connectDB();

  // Double click / retried request: return the same attempt
  const existing = await newPaymentAttempt.findReusable(user.email, input.idempotencyKey);
  if (existing) return existing;

  // 1. Files: only server-issued receipts are accepted
  const receipts: UploadReceipt[] = input.files.map((f, i) => {
    const check = verifyUploadReceipt(f.receipt, user.email);
    if (!check.ok) throw new CheckoutError(`File ${i + 1}: ${check.error}`);
    if (check.receipt.estimated) {
      // The price must be based on a real page count
      throw new CheckoutError(`We could not count the pages of "${check.receipt.name}". Please save it as a PDF and upload it again.`);
    }
    return check.receipt;
  });
  const quoteFiles: QuoteFile[] = input.files.map((f, i) => ({
    name: receipts[i].name,
    pages: receipts[i].pages,
    pageSize: f.pageSize,
    color: f.color,
    sided: f.sided,
    copies: f.copies,
    colorPages: f.color === 'mixed' ? f.colorPages : undefined,
    service: f.service,
  }));

  // 2. Shop: must be an approved partner
  let partner: { _id: unknown; businessName?: string; pricing?: { perPageBW: number; perPageColor: number; binding: number }; razorpayAccountId?: string } | null = null;
  if (input.delivery.partnerId) {
    partner = await Partner.findOne({ _id: input.delivery.partnerId, isActive: true }).lean();
    if (!partner) throw new CheckoutError('The selected print shop is not available. Please choose another shop.');
  }

  // 3. Delivery charge, computed here
  let deliveryChargePaise = 0;
  let deliveryCharge: number | undefined;
  if (input.delivery.type === 'delivery') {
    const d = input.delivery;
    if (!d.recipientName || !d.recipientPhone || !d.address || !d.city || !d.state) {
      throw new CheckoutError('Please complete the delivery address');
    }
    if (!isValidPincode(d.pinCode)) throw new CheckoutError('Please enter a valid 6-digit pincode');
    const quote = await getDeliveryQuote(d.pinCode, parcelWeightKg(quoteFiles));
    deliveryCharge = tierCharge(quote, d.speed).deliveryCharge;
    deliveryChargePaise = Math.round(deliveryCharge * 100);
  }

  // 4. Price
  const globalPricing = await getPricing();
  let quote;
  try {
    quote = quotePrintOrder({ files: quoteFiles, partnerPricing: partner?.pricing ?? null, globalPricing, deliveryChargePaise });
  } catch (error) {
    if (error instanceof QuoteError) throw new CheckoutError(error.message);
    throw error;
  }
  const totals = withProcessingFee(quote.subtotal);
  try {
    assertChargeable(totals.total);
  } catch (error) {
    throw new CheckoutError(error instanceof Error ? error.message : 'Invalid amount');
  }

  // 5. Order
  const fileOptions = input.files.map((f, i) => {
    const colorPages = f.color === 'mixed' ? normaliseColorPages(f.colorPages, receipts[i].pages) : [];
    const colorSet = new Set(colorPages);
    const bwPages = f.color === 'mixed' ? Array.from({ length: receipts[i].pages }, (_, k) => k + 1).filter((p) => !colorSet.has(p)) : [];
    return { pageSize: f.pageSize, color: f.color, sided: f.sided, copies: f.copies, pageColors: f.color === 'mixed' ? { colorPages, bwPages } : undefined };
  });
  const names = receipts.map((r) => r.name);
  const urls = receipts.map((r) => r.url);
  const first = fileOptions[0];
  const anyMixed = fileOptions.some((o) => o.color === 'mixed' && (o.pageColors?.colorPages.length ?? 0) > 0);

  const expectedDate = input.expectedDate ? new Date(input.expectedDate) : undefined;
  const orderDoc = new Order({
    checkoutKey: input.idempotencyKey,
    customerInfo: { ...input.customerInfo, email: input.customerInfo.email.toLowerCase() },
    orderType: 'file',
    fileURL: urls[0],
    fileURLs: urls,
    fileTypes: receipts.map((r) => r.mime),
    fileType: getFileTypeFromFileNames(names, urls),
    originalFileName: names[0],
    originalFileNames: names,
    printingOptions: {
      pageSize: first.pageSize,
      color: fileOptions.length > 1 ? (anyMixed ? 'mixed' : first.color) : first.color,
      sided: first.sided,
      copies: first.copies,
      pageCount: receipts.reduce((s, r) => s + r.pages, 0),
      serviceOptions: input.files.map((f) => f.service ?? 'service'),
      serviceOption: input.files[0].service ?? 'service',
      pageColors: fileOptions.map((o) => o.pageColors ?? { colorPages: [], bwPages: [] }),
      fileOptions,
    },
    deliveryOption: {
      ...input.delivery,
      deliveryCharge,
      pickupLocation: input.delivery.type === 'pickup' && !partner ? await pickupLocationSnapshot(input.delivery.pickupLocationId) : undefined,
    },
    partnerId: partner ? String(partner._id) : undefined,
    expectedDate: expectedDate && !Number.isNaN(expectedDate.getTime()) ? expectedDate : undefined,
    amount: paiseToRupees(totals.subtotal),
    pricing: {
      subtotal: paiseToRupees(totals.subtotal),
      fee: paiseToRupees(totals.fee),
      total: paiseToRupees(totals.total),
      delivery: paiseToRupees(quote.delivery),
      files: quote.files.map((f) => ({ name: f.name, pages: f.pages, colorPages: f.colorPageCount, bwPages: f.bwPageCount, amount: paiseToRupees(f.amount) })),
      partnerPricing: Boolean(partner?.pricing),
    },
    paymentStatus: 'pending',
    orderStatus: 'pending',
    status: 'pending_payment',
  });
  // Saving claims the idempotency key: a concurrent duplicate request fails here
  let order;
  try {
    order = await orderDoc.save();
  } catch (error) {
    if ((error as { code?: number }).code === 11000 && String((error as Error).message).includes('checkoutKey')) {
      const again = await newPaymentAttempt.findReusable(user.email, input.idempotencyKey);
      if (again) return again;
      throw new CheckoutError('Your payment is being prepared. Please try again in a moment.', 409);
    }
    throw error;
  }

  // 6. Payment + link
  const payment = await newPaymentAttempt.create({
    purpose: 'print_order',
    user,
    idempotencyKey: input.idempotencyKey,
    orderId: order.orderId,
    totals,
    partner: partner ? { id: String(partner._id), accountId: partner.razorpayAccountId } : undefined,
  });
  const result = await createLinkForPayment(payment, {
    description: `FunPrinting order ${order.orderId}`,
    customer: { name: input.customerInfo.name, email: input.customerInfo.email, contact: input.customerInfo.phone },
    requestOrigin,
    onFailure: async () => {
      await Order.updateOne({ _id: order._id, status: 'pending_payment' }, { $set: { status: 'cancelled', paymentStatus: 'failed' } });
    },
  });
  await Order.updateOne({ _id: order._id }, { $set: { paymentRef: result.referenceId } });
  return result;
}
