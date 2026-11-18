/**
 * Money helpers. Everything that is charged or stored for payments is an integer
 * number of paise; rupees only appear at the UI and email edges.
 */

/** Processing fee added on top of the order subtotal (covers gateway charges). */
export const PROCESSING_FEE_PERCENT = 3;
/** Partner share of the order subtotal when the partner has a Route linked account. */
export const PARTNER_SHARE_PERCENT = 90;
/** Razorpay accepts at least ₹1. */
export const MIN_CHARGE_PAISE = 100;
/** Sanity cap for one checkout (₹1,00,000). */
export const MAX_CHARGE_PAISE = 100_000 * 100;

export function rupeesToPaise(rupees: number): number {
  if (!Number.isFinite(rupees)) throw new RangeError(`Invalid amount: ${rupees}`);
  // Round via string-safe arithmetic to avoid 0.1 + 0.2 style drift
  return Math.round(Math.round(rupees * 1000) / 10);
}

export function paiseToRupees(paise: number): number {
  return Math.round(paise) / 100;
}

/** "₹1,234.50" */
export function formatINR(paise: number): string {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(paiseToRupees(paise));
}

export function percentOf(paise: number, percent: number): number {
  return Math.round((paise * percent) / 100);
}

/**
 * What the shop receives: 90% of the printing, plus all of its own delivery fee.
 * A courier charge is not shared, because the platform pays the courier.
 */
export function partnerShareOf(input: { subtotal: number; delivery: number; deliveryByShop: boolean }): number {
  const printing = Math.max(0, input.subtotal - input.delivery);
  return percentOf(printing, PARTNER_SHARE_PERCENT) + (input.deliveryByShop ? input.delivery : 0);
}

/** The shop's share of a saved order, in rupees (Order.amount is the subtotal incl. delivery). */
export function orderPartnerShare(order: { amount?: number; deliveryOption?: { type?: string; method?: string; deliveryCharge?: number } }): number {
  const delivery = order.deliveryOption?.type === 'delivery' ? Number(order.deliveryOption.deliveryCharge) || 0 : 0;
  const paise = partnerShareOf({ subtotal: rupeesToPaise(Number(order.amount) || 0), delivery: rupeesToPaise(delivery), deliveryByShop: order.deliveryOption?.method === 'shop' });
  return paiseToRupees(paise);
}

export interface Totals {
  subtotal: number;
  fee: number;
  total: number;
}

/** subtotal + processing fee. */
export function withProcessingFee(subtotalPaise: number, feePercent = PROCESSING_FEE_PERCENT): Totals {
  const subtotal = Math.round(subtotalPaise);
  const fee = percentOf(subtotal, feePercent);
  return { subtotal, fee, total: subtotal + fee };
}

export function assertChargeable(totalPaise: number): void {
  if (!Number.isInteger(totalPaise) || totalPaise < MIN_CHARGE_PAISE) {
    throw new RangeError(`Amount must be at least ₹1 (got ${totalPaise} paise)`);
  }
  if (totalPaise > MAX_CHARGE_PAISE) {
    throw new RangeError(`Amount exceeds the ₹1,00,000 limit (got ${totalPaise} paise)`);
  }
}
