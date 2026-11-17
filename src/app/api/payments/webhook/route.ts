import { NextRequest, NextResponse, after } from 'next/server';
import { withRequestLogger } from '@/lib/logger';
import connectDB from '@/lib/mongodb';
import WebhookEvent from '@/models/WebhookEvent';
import { verifyWebhookSignature } from '@/lib/payments/signatures';
import { handleRazorpayEvent, runFulfilment, type RazorpayWebhook } from '@/lib/payments/webhooks';

export const runtime = 'nodejs';

/**
 * POST /api/payments/webhook — Razorpay webhooks (also served at /api/webhooks/razorpay).
 *
 * Events: payment_link.paid, payment_link.expired, payment_link.cancelled,
 * refund.processed, refund.failed, transfer.processed, payment.captured (legacy).
 *
 * - Signature: HMAC-SHA256 of the raw body with RAZORPAY_WEBHOOK_SECRET.
 * - Duplicates: skipped by x-razorpay-event-id (WebhookEvent).
 * - Failures return 500 so Razorpay retries (it retries for 24 hours).
 * - Slow side effects (print dispatch, emails) run after the response, because
 *   Razorpay expects an answer within 5 seconds.
 */
const STALE_PROCESSING_MS = 2 * 60_000;

export async function POST(request: NextRequest) {
  const log = withRequestLogger(request);
  const raw = await request.text();
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET || '';
  if (!secret) {
    log.error('RAZORPAY_WEBHOOK_SECRET is not set; rejecting webhook');
    return NextResponse.json({ error: 'Webhook not configured' }, { status: 500 });
  }
  if (!verifyWebhookSignature(raw, request.headers.get('x-razorpay-signature'), secret)) {
    log.warn('webhook with invalid signature');
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }

  let body: RazorpayWebhook;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const eventId = request.headers.get('x-razorpay-event-id') || '';
  const elog = log.child({ event: body.event, eventId });

  await connectDB();
  if (eventId) {
    // Atomic claim: the upsert returns the previous document, or null for a new event
    const seen = await WebhookEvent.findOneAndUpdate(
      { eventId },
      { $setOnInsert: { eventId, event: body.event, status: 'processing', receivedAt: new Date() } },
      { upsert: true, new: false }
    ).lean<{ status: string; receivedAt: Date } | null>();
    if (seen) {
      const stale = Date.now() - new Date(seen.receivedAt).getTime() > STALE_PROCESSING_MS;
      if (seen.status === 'processed') {
        elog.info('duplicate webhook skipped');
        return NextResponse.json({ status: 'duplicate' });
      }
      if (seen.status === 'processing' && !stale) {
        // Another delivery is being handled right now. Ask Razorpay to retry later
        // instead of acknowledging: if that attempt fails, the retry still arrives.
        elog.info('webhook already in progress');
        return NextResponse.json({ status: 'in_progress' }, { status: 409 });
      }
      // A failed or abandoned attempt: process again
      await WebhookEvent.updateOne({ eventId }, { $set: { status: 'processing', receivedAt: new Date() } });
    }
  }

  try {
    const result = await handleRazorpayEvent(body);
    if (eventId) await WebhookEvent.updateOne({ eventId }, { $set: { status: 'processed', processedAt: new Date() } });
    for (const referenceId of result.fulfil) {
      after(() => runFulfilment(referenceId).then(() => undefined));
    }
    elog.info({ note: result.note }, 'webhook processed');
    return NextResponse.json({ status: 'ok' });
  } catch (error) {
    elog.error({ err: error }, 'webhook processing failed');
    if (eventId) {
      await WebhookEvent.updateOne({ eventId }, { $set: { status: 'failed', error: error instanceof Error ? error.message.slice(0, 500) : 'unknown' } }).catch(() => undefined);
    }
    return NextResponse.json({ error: 'Processing failed' }, { status: 500 });
  }
}
