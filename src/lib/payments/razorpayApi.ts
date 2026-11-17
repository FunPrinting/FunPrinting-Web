import 'server-only';
import Razorpay from 'razorpay';

/**
 * Thin, typed wrapper over the Razorpay SDK calls the app uses. Keeping them here
 * means tests can mock one module, and SDK error shapes are normalised in one place.
 */

export class RazorpayApiError extends Error {
  constructor(
    message: string,
    public readonly code?: string,
    public readonly statusCode?: number,
    public readonly field?: string
  ) {
    super(message);
    this.name = 'RazorpayApiError';
  }
}

let client: Razorpay | null = null;

export function getRazorpay(): Razorpay {
  if (client) return client;
  const key_id = process.env.RAZORPAY_KEY_ID;
  const key_secret = process.env.RAZORPAY_KEY_SECRET;
  if (!key_id || !key_secret) throw new RazorpayApiError('Razorpay is not configured (RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET)');
  client = new Razorpay({ key_id, key_secret });
  return client;
}

/** Test helper. */
export function __setRazorpayClient(c: Razorpay | null): void {
  client = c;
}

function normalise(error: unknown, action: string): RazorpayApiError {
  if (error instanceof RazorpayApiError) return error;
  const e = error as { statusCode?: number; error?: { code?: string; description?: string; field?: string }; message?: string };
  const description = e?.error?.description || e?.message || 'Unknown Razorpay error';
  return new RazorpayApiError(`${action} failed: ${description}`, e?.error?.code, e?.statusCode, e?.error?.field);
}

async function call<T>(action: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    throw normalise(error, action);
  }
}

export interface RouteTransfer {
  account: string;
  amount: number; // paise
  currency: 'INR';
  notes?: Record<string, string>;
  linked_account_notes?: string[];
  on_hold?: boolean;
}

export interface CreateLinkInput {
  amount: number; // paise
  referenceId: string;
  description: string;
  customer: { name?: string; email?: string; contact?: string };
  callbackUrl: string;
  expireBy: number; // unix seconds, at least 15 min in the future
  notes?: Record<string, string>;
  transfers?: RouteTransfer[];
}

export interface PaymentLinkEntity {
  id: string;
  short_url: string;
  status: 'created' | 'partially_paid' | 'expired' | 'cancelled' | 'paid';
  amount: number;
  amount_paid: number;
  reference_id: string;
  expire_by?: number;
  payments?: Array<{ payment_id: string; amount: number; status: string; method?: string; created_at?: number }> | null;
  notes?: Record<string, string> | null;
}

export function createPaymentLink(input: CreateLinkInput): Promise<PaymentLinkEntity> {
  const body: Record<string, unknown> = {
    amount: input.amount,
    currency: 'INR',
    accept_partial: false,
    reference_id: input.referenceId,
    description: input.description.slice(0, 2048),
    customer: input.customer,
    // We send our own emails; avoid duplicate Razorpay SMS/email notifications
    notify: { sms: false, email: false },
    reminder_enable: false,
    callback_url: input.callbackUrl,
    callback_method: 'get',
    expire_by: input.expireBy,
    notes: input.notes,
  };
  if (input.transfers?.length) body.options = { order: { transfers: input.transfers } };
  return call('Create payment link', () => getRazorpay().paymentLink.create(body as never) as unknown as Promise<PaymentLinkEntity>);
}

export function fetchPaymentLink(id: string): Promise<PaymentLinkEntity> {
  return call('Fetch payment link', () => getRazorpay().paymentLink.fetch(id) as unknown as Promise<PaymentLinkEntity>);
}

export function cancelPaymentLink(id: string): Promise<PaymentLinkEntity> {
  return call('Cancel payment link', () => getRazorpay().paymentLink.cancel(id) as unknown as Promise<PaymentLinkEntity>);
}

export interface PaymentEntity {
  id: string;
  amount: number;
  status: string;
  method?: string;
  order_id?: string;
  amount_refunded?: number;
}

export function fetchPayment(id: string): Promise<PaymentEntity> {
  return call('Fetch payment', () => getRazorpay().payments.fetch(id) as unknown as Promise<PaymentEntity>);
}

export interface TransferEntity {
  id: string;
  recipient: string;
  amount: number;
  on_hold?: boolean;
}

export async function fetchPaymentTransfers(paymentId: string): Promise<TransferEntity[]> {
  const result = await call('Fetch transfers', () => getRazorpay().payments.fetchTransfer(paymentId) as unknown as Promise<{ items?: TransferEntity[] }>);
  return result?.items ?? [];
}

/** Releases a transfer created with on_hold: true, so it settles to the partner. */
export function releaseTransfer(transferId: string): Promise<TransferEntity> {
  return call('Release transfer', () => getRazorpay().transfers.edit(transferId, { on_hold: 0 } as never) as unknown as Promise<TransferEntity>);
}

export interface RefundEntity {
  id: string;
  amount: number;
  status: string;
}

/**
 * Refunds a payment. `reverseAll` also reverses Route transfers so the partner's
 * held share comes back before the customer is refunded.
 */
export function refundPayment(paymentId: string, amountPaise: number, { notes, reverseAll = false }: { notes?: Record<string, string>; reverseAll?: boolean } = {}): Promise<RefundEntity> {
  const params: Record<string, unknown> = { amount: amountPaise, speed: 'normal', notes };
  if (reverseAll) params.reverse_all = 1;
  return call('Refund payment', () => getRazorpay().payments.refund(paymentId, params as never) as unknown as Promise<RefundEntity>);
}

export async function fetchOrderPayments(razorpayOrderId: string): Promise<PaymentEntity[]> {
  const result = await call('Fetch order payments', () => getRazorpay().orders.fetchPayments(razorpayOrderId) as unknown as Promise<{ items?: PaymentEntity[] }>);
  return result?.items ?? [];
}

export function fetchRefund(refundId: string): Promise<RefundEntity & { payment_id: string }> {
  return call('Fetch refund', () => getRazorpay().refunds.fetch(refundId) as unknown as Promise<RefundEntity & { payment_id: string }>);
}
