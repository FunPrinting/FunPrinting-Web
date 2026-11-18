import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/authz';
import { withRequestLogger } from '@/lib/logger';
import { checkRateLimit, getClientIdentifier, orderCreationRateLimit } from '@/lib/ratelimit';
import { createPrintCheckout, printCheckoutSchema } from '@/lib/payments/checkout';
import { paymentErrorResponse } from '@/lib/payments/http';

export const runtime = 'nodejs';
export const maxDuration = 30;

/**
 * POST /api/checkout — start paying for a print order.
 *
 * Body: printCheckoutSchema (files are upload receipts from /api/upload-file).
 * Returns { referenceId, paymentUrl, orderId, amounts } with amounts in paise; the
 * browser redirects to paymentUrl (a Razorpay Payment Link).
 */
export async function POST(request: NextRequest) {
  const user = await requireUser();
  if (user instanceof NextResponse) return user;
  const log = withRequestLogger(request, { userId: user.id });

  const limited = await checkRateLimit(orderCreationRateLimit, `checkout:${user.email}:${getClientIdentifier(request)}`);
  if (limited) return limited;

  const parsed = printCheckoutSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return NextResponse.json(
      { success: false, error: first ? `${first.path.join('.') || 'request'}: ${first.message}` : 'Invalid request' },
      { status: 400 }
    );
  }

  try {
    const result = await createPrintCheckout(user, parsed.data, request.nextUrl.origin);
    log.info({ referenceId: result.referenceId, orderId: result.orderId, total: result.amounts.total }, 'checkout created');
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    return paymentErrorResponse(error, log, 'Could not start the payment. Please try again.');
  }
}
