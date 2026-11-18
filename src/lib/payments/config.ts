import 'server-only';

/** Payment Link lifetime. Razorpay requires expire_by at least 15 minutes ahead. */
export const LINK_TTL_MINUTES = 30;
/** Unpaid orders are cancelled after this long (the customer can retry until then). */
export const UNPAID_ORDER_TTL_HOURS = 24;
/** A paid payment whose side effects keep failing is flagged for review after this many tries. */
export const MAX_FULFILMENT_ATTEMPTS = 5;

/**
 * Razorpay Route (90% partner split) is only used when explicitly enabled, because
 * creating a link with transfers fails on accounts where Route is not activated.
 */
export function isRouteEnabled(): boolean {
  return process.env.RAZORPAY_ROUTE_ENABLED === '1';
}

/**
 * Base URL for Razorpay callbacks. APP_BASE_URL wins (set it in production);
 * otherwise the request's own origin, so preview deployments call back to themselves.
 */
export function appBaseUrl(requestOrigin: string): string {
  return (process.env.APP_BASE_URL || requestOrigin).replace(/\/+$/, '');
}

export function callbackUrl(requestOrigin: string): string {
  return `${appBaseUrl(requestOrigin)}/api/payments/callback`;
}

export function statusPagePath(referenceId: string): string {
  return `/payment/status/${encodeURIComponent(referenceId)}`;
}
