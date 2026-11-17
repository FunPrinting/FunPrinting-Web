import { NextRequest, NextResponse, after } from 'next/server';
import { withRequestLogger } from '@/lib/logger';
import { verifyPaymentLinkCallback } from '@/lib/payments/signatures';
import { fetchPaymentLink } from '@/lib/payments/razorpayApi';
import { runFulfilment, settlePaid } from '@/lib/payments/fulfil';
import { appBaseUrl, statusPagePath } from '@/lib/payments/config';

export const runtime = 'nodejs';

/**
 * GET /api/payments/callback — Razorpay redirects the customer here after paying
 * (callback_method: get). Query: razorpay_payment_id, razorpay_payment_link_id,
 * razorpay_payment_link_reference_id, razorpay_payment_link_status, razorpay_signature.
 *
 * The signature is checked, the link is fetched from Razorpay to confirm it is paid,
 * and the payment is settled (the webhook may already have done this). The customer
 * is then redirected to the status page, which shows the stored state.
 */
export async function GET(request: NextRequest) {
  const log = withRequestLogger(request);
  const q = request.nextUrl.searchParams;
  const referenceId = q.get('razorpay_payment_link_reference_id') || '';
  const target = new URL(statusPagePath(referenceId || 'unknown'), appBaseUrl(request.nextUrl.origin));

  const params = {
    paymentId: q.get('razorpay_payment_id') || '',
    paymentLinkId: q.get('razorpay_payment_link_id') || '',
    referenceId,
    status: q.get('razorpay_payment_link_status') || '',
    signature: q.get('razorpay_signature') || '',
  };

  const secret = process.env.RAZORPAY_KEY_SECRET || '';
  if (!verifyPaymentLinkCallback(params, secret)) {
    log.warn({ referenceId }, 'payment callback with invalid signature');
    target.searchParams.set('notice', 'unverified');
    return NextResponse.redirect(target, 303);
  }

  if (params.status === 'paid') {
    try {
      // Defense in depth: confirm with Razorpay and take the amount from its record
      const link = await fetchPaymentLink(params.paymentLinkId);
      if (link.status === 'paid' && link.reference_id === referenceId) {
        const captured = link.payments?.find((p) => p.payment_id === params.paymentId) ?? link.payments?.[0];
        const result = await settlePaid({
          paymentLinkId: params.paymentLinkId,
          razorpayPaymentId: params.paymentId,
          amountPaid: link.amount_paid,
          method: captured?.method,
          source: 'return',
        });
        if (result.outcome === 'paid' || result.outcome === 'alreadyPaid') {
          after(() => runFulfilment(result.payment.referenceId).then(() => undefined));
        }
      }
    } catch (error) {
      // The webhook or reconcile job will settle it; the status page keeps checking
      log.error({ err: error, referenceId }, 'payment callback could not settle');
    }
  }
  return NextResponse.redirect(target, 303);
}
