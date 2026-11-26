import 'server-only';
import { z } from 'zod';
import connectDB from '@/lib/mongodb';
import Order from '@/models/Order';
import Partner from '@/models/Partner';
import User from '@/models/User';
import Conversation from '@/models/Conversation';
import { getFileTypeFromFileNames } from '@/lib/fileTypeDetection';
import { isValidPincode } from '@/lib/delivery/rates';
import { getDeliveryOptions, newHandoverCode, type PartnerDeliveryFields } from '@/lib/delivery/options';
import { validateSlotSelection, type ScheduleSlotTemplate, type ScheduleTarget } from '@/lib/scheduling';
import { getBookedSlotCounts } from '@/lib/schedulingServer';
import { evaluateCodEligibility, type PartnerCodConfig } from '@/lib/cod';
import { appendChatMessage, ensureOrderConversation } from '@/lib/chat/service';
import { normalisePhoneInput } from '@/lib/phoneValidation';
import { verifyUploadReceipt, type UploadReceipt } from '@/lib/uploads/receipt';
import { DEFAULT_PARTNER_PRICING, normaliseColorPages, parcelWeightKg, quotePrintOrder, QuoteError, type QuoteFile } from '@/lib/payments/quote';
import { assertChargeable, paiseToRupees, rupeesToPaise, withProcessingFee } from '@/lib/payments/money';
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
    partnerId: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Choose a print shop'),
    partnerDeliveryPoint: z.string().max(200).optional(),
    /** Courier tier id, or 'shop' for the shop's own delivery. */
    speed: z.enum(['standard', 'express', 'sameday', 'shop']).optional(),
    recipientName: z.string().trim().max(100).optional(),
    recipientPhone: z.string().trim().max(20).optional(),
    address: z.string().trim().max(500).optional(),
    flatBuilding: z.string().trim().max(200).optional(),
    landmark: z.string().trim().max(200).optional(),
    city: z.string().trim().max(100).optional(),
    state: z.string().trim().max(100).optional(),
    pinCode: z.string().trim().max(10).optional(),
    location: z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180), address: z.string().max(500).optional() }).optional(),
    scheduledSlot: z
      .object({
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid pickup date'),
        slotId: z.string().trim().min(1).max(64),
        label: z.string().max(120).optional(),
        startTime: z.string().max(10).optional(),
        endTime: z.string().max(10).optional(),
        target: z.enum(['store', 'pickup_point']).optional(),
      })
      .optional(),
  }),
  expectedDate: z.string().max(40).optional(),
  paymentMethod: z.enum(['online', 'cod']).optional().default('online'),
});

export type PrintCheckoutInput = z.infer<typeof printCheckoutSchema>;

function codCheckoutResult(order: { orderId: string; pricing?: { subtotal?: number; fee?: number; total?: number }; amount: number; createdAt?: Date }): CheckoutResult {
  const path = `/orders/${encodeURIComponent(order.orderId)}`;
  return {
    referenceId: order.orderId,
    paymentUrl: path,
    redirectUrl: path,
    isCod: true,
    orderId: order.orderId,
    amounts: {
      subtotal: rupeesToPaise(order.pricing?.subtotal ?? order.amount),
      fee: rupeesToPaise(order.pricing?.fee ?? 0),
      total: rupeesToPaise(order.pricing?.total ?? order.amount),
    },
    expiresAt: new Date((order.createdAt ? new Date(order.createdAt).getTime() : Date.now()) + 24 * 3600_000).toISOString(),
  };
}

/**
 * Creates the order (`pending_payment` for Razorpay online, `pending_cod_approval` for
 * Cash on Pickup), and for online payments creates the Payment record and Razorpay Payment
 * Link. The price is computed here from server data only.
 */
export async function createPrintCheckout(user: SessionUser, input: PrintCheckoutInput, requestOrigin: string): Promise<CheckoutResult> {
  await connectDB();

  // Double click / retried request: return the same attempt
  if (input.paymentMethod === 'cod') {
    const existingCod = await Order.findOne({
      'customerInfo.email': user.email.toLowerCase(),
      checkoutKey: input.idempotencyKey,
      paymentMethod: 'cod',
    }).lean<{ orderId: string; pricing?: { subtotal?: number; fee?: number; total?: number }; amount: number; createdAt?: Date } | null>();
    if (existingCod) return codCheckoutResult(existingCod);
  }
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

  // 2. Shop: every order goes to an approved partner (the platform's own shop is one too)
  const partner = await Partner.findOne({ _id: input.delivery.partnerId, isActive: true }).lean<
    (PartnerDeliveryFields & { pricing?: any; razorpayAccountId?: string; scheduleSlots?: ScheduleSlotTemplate[]; cod?: Partial<PartnerCodConfig> }) | null
  >();
  if (!partner) throw new CheckoutError('The selected print shop is not available. Please choose another shop.');
  const rawP = (partner.pricing ?? {}) as any;
  const partnerPricing = {
    perPageBW: typeof rawP.perPageBW === 'number'
      ? rawP.perPageBW
      : (rawP.printing?.a4?.blackAndWhite?.singleSided ?? DEFAULT_PARTNER_PRICING.perPageBW),
    perPageColor: typeof rawP.perPageColor === 'number'
      ? rawP.perPageColor
      : (rawP.printing?.a4?.color?.singleSided ?? DEFAULT_PARTNER_PRICING.perPageColor),
    binding: typeof rawP.binding === 'number'
      ? rawP.binding
      : (rawP.binding?.spiral ?? rawP.binding?.staple ?? rawP.binding?.perfect ?? DEFAULT_PARTNER_PRICING.binding),
  };

  // 3. Delivery: only an option this shop really offers for this address, priced here
  let deliveryChargePaise = 0;
  let deliveryCharge: number | undefined;
  let method: 'courier' | 'shop' | undefined;
  let distance: number | undefined;
  let recipientPhone: string | undefined;
  if (input.delivery.type === 'delivery') {
    const d = input.delivery;
    if (!d.recipientName || !d.recipientPhone || !d.address || !d.city || !d.state) {
      throw new CheckoutError('Please complete the delivery address');
    }
    if (!isValidPincode(d.pinCode)) throw new CheckoutError('Please enter a valid 6-digit pincode');
    const phoneCheck = normalisePhoneInput(d.recipientPhone);
    if (!phoneCheck.ok) throw new CheckoutError(`Recipient phone: ${phoneCheck.error}`);
    recipientPhone = phoneCheck.phone;
    const options = await getDeliveryOptions(partner, { pinCode: d.pinCode, weightKg: parcelWeightKg(quoteFiles), location: d.location });
    if (d.speed === 'shop') {
      if (!options.shop) {
        throw new CheckoutError(
          options.shopUnavailable === 'need_location'
            ? 'Share your location so we can check the shop delivers to you'
            : options.shopUnavailable === 'too_far'
              ? 'This address is outside the shop’s delivery area. Choose courier delivery or pickup.'
              : 'This shop doesn’t deliver itself. Choose courier delivery or pickup.'
        );
      }
      method = 'shop';
      deliveryCharge = options.shop.fee;
      distance = options.shop.distanceKm;
    } else {
      const tier = options.courier.find((t) => t.id === (d.speed ?? 'standard'));
      if (!tier) {
        throw new CheckoutError(options.courier.length ? 'That delivery speed is no longer available. Please choose again.' : 'No courier delivers from this shop to your pincode. Choose pickup instead.');
      }
      method = 'courier';
      deliveryCharge = tier.deliveryCharge;
    }
    deliveryChargePaise = Math.round(deliveryCharge * 100);
  }

  // 3b. Scheduled pickup slot (store allows same-day+, pickup points enforce next-day+)
  let verifiedSlot:
    | { date: string; slotId: string; label: string; startTime: string; endTime: string; target: ScheduleTarget }
    | undefined;
  if (input.delivery.type === 'pickup' && input.delivery.scheduledSlot) {
    const slotTarget: ScheduleTarget = input.delivery.partnerDeliveryPoint ? 'pickup_point' : 'store';
    const slotInput = input.delivery.scheduledSlot;
    const bookedCounts = await getBookedSlotCounts(String(partner._id), { target: slotTarget });
    const check = validateSlotSelection({
      partnerSlots: partner.scheduleSlots,
      target: slotTarget,
      pickupPointName: input.delivery.partnerDeliveryPoint,
      date: slotInput.date,
      slotId: slotInput.slotId,
      bookedCounts,
    });
    if (!check.ok) throw new CheckoutError(check.error);
    verifiedSlot = {
      date: slotInput.date,
      slotId: check.slot.id,
      label: check.slot.label,
      startTime: check.slot.startTime,
      endTime: check.slot.endTime,
      target: slotTarget,
    };
  }

  // 4. Price & Payment Method (online = Razorpay only; cod = cash on pickup with risk checks)
  let quote;
  try {
    quote = quotePrintOrder({ files: quoteFiles, partnerPricing: partner.pricing ?? partnerPricing, deliveryChargePaise });
  } catch (error) {
    if (error instanceof QuoteError) throw new CheckoutError(error.message);
    throw error;
  }

  const isCod = input.paymentMethod === 'cod';
  let cashFeeRupees = 0;
  let totals = withProcessingFee(quote.subtotal);
  if (isCod) {
    const userDoc = await User.findOne({ email: user.email.toLowerCase() })
      .select('failedCodCount codBlocked')
      .lean<{ failedCodCount?: number; codBlocked?: boolean } | null>();
    const codCheck = evaluateCodEligibility({
      deliveryType: input.delivery.type,
      pickupPointName: input.delivery.partnerDeliveryPoint,
      subtotalRupees: paiseToRupees(quote.subtotal),
      partnerCod: partner.cod,
      userCodBlocked: Boolean(userDoc?.codBlocked),
      failedCodCount: userDoc?.failedCodCount ?? 0,
    });
    if (!codCheck.eligible) throw new CheckoutError(codCheck.reason, 400);
    cashFeeRupees = codCheck.cashFee;
    const feePaise = rupeesToPaise(cashFeeRupees);
    totals = { subtotal: quote.subtotal, fee: feePaise, total: quote.subtotal + feePaise };
  }

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

  const expectedDate = verifiedSlot
    ? new Date(`${verifiedSlot.date}T00:00:00.000Z`)
    : input.expectedDate
      ? new Date(input.expectedDate)
      : undefined;
  const orderDoc = new Order({
    checkoutKey: input.idempotencyKey,
    customerInfo: { ...input.customerInfo, email: input.customerInfo.email.toLowerCase() },
    orderType: 'file',
    fileURLs: urls,
    fileTypes: receipts.map((r) => r.mime),
    printURLs: receipts.map((r) => r.printUrl ?? null),
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
      ...(recipientPhone ? { recipientPhone } : {}),
      ...(verifiedSlot ? { scheduledSlot: verifiedSlot } : {}),
      deliveryCharge,
      method,
      distance,
      ...(method === 'shop' ? { handover: { code: newHandoverCode(), attempts: 0 } } : {}),
    },
    partnerId: String(partner._id),
    expectedDate: expectedDate && !Number.isNaN(expectedDate.getTime()) ? expectedDate : undefined,
    amount: paiseToRupees(isCod ? totals.total : totals.subtotal),
    pricing: {
      subtotal: paiseToRupees(totals.subtotal),
      fee: paiseToRupees(totals.fee),
      total: paiseToRupees(totals.total),
      delivery: paiseToRupees(quote.delivery),
      files: quote.files.map((f) => ({ name: f.name, pages: f.pages, colorPages: f.colorPageCount, bwPages: f.bwPageCount, amount: paiseToRupees(f.amount) })),
      partnerPricing: true,
    },
    paymentMethod: isCod ? 'cod' : 'online',
    paymentStatus: isCod ? 'cod_pending' : 'pending',
    orderStatus: 'pending',
    status: isCod ? 'pending_cod_approval' : 'pending_payment',
    ...(isCod ? { cod: { cashFee: cashFeeRupees } } : {}),
  });
  // Saving claims the idempotency key: a concurrent duplicate request fails here
  let order;
  try {
    order = await orderDoc.save();
  } catch (error) {
    if ((error as { code?: number }).code === 11000 && String((error as Error).message).includes('checkoutKey')) {
      if (isCod) {
        const againCod = await Order.findOne({
          'customerInfo.email': user.email.toLowerCase(),
          checkoutKey: input.idempotencyKey,
          paymentMethod: 'cod',
        }).lean<{ orderId: string; pricing?: { subtotal?: number; fee?: number; total?: number }; amount: number; createdAt?: Date } | null>();
        if (againCod) return codCheckoutResult(againCod);
      }
      const again = await newPaymentAttempt.findReusable(user.email, input.idempotencyKey);
      if (again) return again;
      throw new CheckoutError('Your payment is being prepared. Please try again in a moment.', 409);
    }
    throw error;
  }

  // 6. Cash on Pickup (COD): open pre-print approval chat instead of Razorpay link
  if (isCod) {
    try {
      const conv = await ensureOrderConversation({ orderId: order.orderId });
      await Conversation.updateOne(
        { conversationId: conv.conversationId },
        { $set: { codApprovalStatus: 'pending' } }
      );
      await appendChatMessage({
        conversationId: conv.conversationId,
        senderType: 'system',
        senderId: 'system',
        senderName: 'FunPrinting',
        body: `🆕 Cash on Pickup order #${order.orderId} placed (₹${paiseToRupees(totals.total)} due in cash). Confirm here so the shop can approve and print it.`,
        metadata: { kind: 'cod_requested', orderId: order.orderId, total: paiseToRupees(totals.total) },
      });
    } catch {
      // Do not fail COD checkout if initial chat prompt fails; customer/partner can still open order chat
    }
    return codCheckoutResult(order);
  }

  // 6b. Online payment: create Razorpay Payment Link
  const payment = await newPaymentAttempt.create({
    purpose: 'print_order',
    user,
    idempotencyKey: input.idempotencyKey,
    orderId: order.orderId,
    totals,
    partner: { id: String(partner._id), accountId: partner.razorpayAccountId },
    delivery: { amount: quote.delivery, byShop: method === 'shop' },
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
