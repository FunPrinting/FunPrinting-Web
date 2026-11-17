'use client';

/**
 * Browser helpers for Payment Links. The browser never computes or sends an amount:
 * it asks the server for a link and redirects to Razorpay's hosted page, which
 * returns to /payment/status/<reference>.
 */

function newKey(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

async function postForLink(url: string, body: Record<string, unknown>): Promise<string> {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({ success: false, error: 'Unexpected response from the server' }));
  if (!res.ok || !data.success || !data.paymentUrl) throw new Error(data.error || 'Could not start the payment. Please try again.');
  return data.paymentUrl as string;
}

/** Buys a paid template. Resolves only if the redirect could not happen. */
export async function startTemplateCheckout(templateId: string, formData: Record<string, unknown>): Promise<void> {
  const url = await postForLink('/api/checkout/template', { idempotencyKey: newKey(), templateId, formData });
  window.location.assign(url);
}

/** Pays for an existing unpaid order (My Orders → Pay now). */
export async function startOrderPayment(orderId: string): Promise<void> {
  const url = await postForLink(`/api/orders/${encodeURIComponent(orderId)}/pay`, {});
  window.location.assign(url);
}
