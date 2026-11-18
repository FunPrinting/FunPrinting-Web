import 'server-only';
import { NextResponse } from 'next/server';
import type { Logger } from 'pino';

/**
 * Maps payment errors to responses. Errors that carry a `status` (CheckoutError,
 * RefundError, link creation) have a message written for the customer; anything
 * else is logged and returned as a generic 500.
 */
export function paymentErrorResponse(error: unknown, log: Logger, fallback = 'Something went wrong. Please try again.') {
  const status = (error as { status?: unknown })?.status;
  if (typeof status === 'number' && status >= 400 && status < 600 && error instanceof Error) {
    if (status >= 500) log.error({ err: error }, 'payment request failed');
    return NextResponse.json({ success: false, error: error.message }, { status });
  }
  log.error({ err: error }, 'payment request failed');
  return NextResponse.json({ success: false, error: fallback }, { status: 500 });
}
