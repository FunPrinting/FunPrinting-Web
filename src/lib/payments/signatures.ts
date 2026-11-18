import 'server-only';
import crypto from 'crypto';

/**
 * Razorpay signature checks, all timing-safe.
 *
 * Payment Link callback (https://razorpay.com/docs/payments/payment-links/apis/):
 * HMAC-SHA256 with the API key secret over
 *   `${payment_link_id}|${payment_link_reference_id}|${payment_link_status}|${payment_id}`
 * This is the same payload the Razorpay SDK's validatePaymentVerification uses.
 *
 * Webhooks: HMAC-SHA256 with the webhook secret over the raw request body, sent in
 * the `x-razorpay-signature` header.
 */
function hmacHex(secret: string, payload: string): string {
  return crypto.createHmac('sha256', secret).update(payload, 'utf8').digest('hex');
}

export function safeEqualHex(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

export interface PaymentLinkCallbackParams {
  paymentLinkId: string;
  referenceId: string;
  status: string;
  paymentId: string;
  signature: string;
}

export function paymentLinkCallbackPayload(p: Omit<PaymentLinkCallbackParams, 'signature'>): string {
  return `${p.paymentLinkId}|${p.referenceId}|${p.status}|${p.paymentId}`;
}

export function verifyPaymentLinkCallback(params: PaymentLinkCallbackParams, keySecret: string): boolean {
  if (!keySecret || !params.signature || !params.paymentLinkId || !params.paymentId) return false;
  return safeEqualHex(hmacHex(keySecret, paymentLinkCallbackPayload(params)), params.signature);
}

export function verifyWebhookSignature(rawBody: string, signature: string | null, webhookSecret: string): boolean {
  if (!webhookSecret || !signature || !rawBody) return false;
  return safeEqualHex(hmacHex(webhookSecret, rawBody), signature);
}

/** Test helper: produce the signature Razorpay would send. */
export function signForTests(secret: string, payload: string): string {
  return hmacHex(secret, payload);
}
