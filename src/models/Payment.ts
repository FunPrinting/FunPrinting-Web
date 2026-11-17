import mongoose, { Schema } from 'mongoose';

/**
 * One payment attempt through a Razorpay Payment Link.
 *
 * - `referenceId` is sent to Razorpay as `reference_id` (unique per link, max 40 chars)
 *   and comes back on the callback, so it identifies this record.
 * - Amounts are integers in paise. `total` is what the customer is charged.
 * - An order can have several attempts (retry after expiry); only one can be paid.
 * - `fulfilment` flags make each side effect run once, whichever of the return page,
 *   webhook or reconcile job gets there first.
 */
export const PAYMENT_PURPOSES = ['print_order', 'template'] as const;
export const PAYMENT_STATUSES = [
  'created', // link created, waiting for the customer
  'paid',
  'expired',
  'cancelled',
  'refunded',
  'partially_refunded',
] as const;

export type PaymentPurpose = (typeof PAYMENT_PURPOSES)[number];
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export interface PaymentAmounts {
  subtotal: number; // paise, before the processing fee
  fee: number; // paise
  total: number; // paise, charged to the customer
  partnerShare?: number; // paise, Route transfer to the partner (if any)
  creatorShare?: number; // paise, template creator earning (if any)
  platformShare?: number; // paise
}

export interface PaymentEvent {
  at: Date;
  type: string;
  source: 'checkout' | 'return' | 'webhook' | 'reconcile' | 'admin' | 'system';
  detail?: string;
}

export interface IPayment {
  _id: mongoose.Types.ObjectId;
  referenceId: string;
  purpose: PaymentPurpose;
  status: PaymentStatus;
  userId?: string;
  userEmail: string;
  idempotencyKey?: string;

  orderId?: string; // Order.orderId (print orders)
  templateId?: string; // DynamicTemplate.id (template purchases)
  template?: {
    name?: string;
    formData?: Record<string, unknown>;
    creatorUserId?: string;
    commissionPercent?: number;
    generationCount?: number; // documents generated with this purchase
  };

  amounts: PaymentAmounts;
  currency: 'INR';
  partnerId?: string;
  partnerAccountId?: string;

  razorpay: {
    paymentLinkId?: string;
    shortUrl?: string;
    paymentId?: string;
    method?: string;
    transferId?: string;
    transferReleased?: boolean;
    refundIds?: string[];
    processedRefundIds?: string[];
  };

  expiresAt: Date;
  paidAt?: Date;
  amountPaid?: number; // paise, as reported by Razorpay
  amountRefunded?: number; // paise
  needsReview?: string; // set when something is off (e.g. amount mismatch); shown to admins

  fulfilment: {
    order?: Date;
    creatorEarning?: Date;
    printJob?: Date;
    dispatch?: Date;
    invoice?: Date;
    adminNotice?: Date;
    completedAt?: Date;
    lockedUntil?: Date; // lease: only one fulfilment run at a time
    skipped?: string; // why the remaining steps were not run
    attempts: number;
    lastError?: string;
  };

  events: PaymentEvent[];
  createdAt: Date;
  updatedAt: Date;
}

const paymentSchema = new Schema<IPayment>(
  {
    referenceId: { type: String, required: true, unique: true, maxlength: 40 },
    purpose: { type: String, enum: PAYMENT_PURPOSES, required: true },
    status: { type: String, enum: PAYMENT_STATUSES, default: 'created' },
    userId: String,
    userEmail: { type: String, required: true, lowercase: true, trim: true },
    idempotencyKey: String,

    orderId: String,
    templateId: String,
    template: {
      name: String,
      formData: Schema.Types.Mixed,
      creatorUserId: String,
      commissionPercent: Number,
      generationCount: { type: Number, default: 0 },
    },

    amounts: {
      subtotal: { type: Number, required: true, min: 0 },
      fee: { type: Number, required: true, min: 0 },
      total: { type: Number, required: true, min: 100 }, // Razorpay minimum is ₹1
      partnerShare: { type: Number, min: 0 },
      creatorShare: { type: Number, min: 0 },
      platformShare: { type: Number, min: 0 },
    },
    currency: { type: String, enum: ['INR'], default: 'INR' },
    partnerId: String,
    partnerAccountId: String,

    razorpay: {
      paymentLinkId: String,
      shortUrl: String,
      paymentId: String,
      method: String,
      transferId: String,
      transferReleased: Boolean,
      refundIds: [String],
      processedRefundIds: [String],
    },

    expiresAt: { type: Date, required: true },
    paidAt: Date,
    amountPaid: Number,
    amountRefunded: Number,
    needsReview: String,

    fulfilment: {
      order: Date,
      creatorEarning: Date,
      printJob: Date,
      dispatch: Date,
      invoice: Date,
      adminNotice: Date,
      completedAt: Date,
      lockedUntil: Date,
      skipped: String,
      attempts: { type: Number, default: 0 },
      lastError: String,
    },

    events: {
      type: [
        new Schema<PaymentEvent>(
          {
            at: { type: Date, required: true },
            type: { type: String, required: true },
            source: { type: String, required: true },
            detail: String,
          },
          { _id: false }
        ),
      ],
      default: [],
    },
  },
  { timestamps: true }
);

paymentSchema.index({ 'razorpay.paymentLinkId': 1 }, { unique: true, sparse: true });
// One captured Razorpay payment can settle only one record
paymentSchema.index({ 'razorpay.paymentId': 1 }, { unique: true, sparse: true });
paymentSchema.index({ orderId: 1, createdAt: -1 });
// Double-click protection: same user + key returns the same attempt
paymentSchema.index({ userEmail: 1, idempotencyKey: 1 }, { unique: true, partialFilterExpression: { idempotencyKey: { $type: 'string' } } });
// Reconcile job: unpaid links past their grace period, and paid-but-unfulfilled
paymentSchema.index({ status: 1, createdAt: 1 });
paymentSchema.index({ status: 1, 'fulfilment.completedAt': 1 });

export default (mongoose.models.Payment as mongoose.Model<IPayment>) ||
  mongoose.model<IPayment>('Payment', paymentSchema);
