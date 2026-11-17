import { NextRequest, NextResponse } from 'next/server';
import { requireCronSecret } from '@/lib/cronAuth';
import { reconcilePayments } from '@/lib/payments/reconcile';

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * GET /api/cron/reconcile-payments (Vercel Cron, Authorization: Bearer $CRON_SECRET)
 *
 * Safety net behind the webhook: settles links the webhook missed, retries
 * unfinished fulfilment and cancels orders left unpaid for 24 hours.
 */
export async function GET(request: NextRequest) {
  const denied = requireCronSecret(request);
  if (denied) return denied;
  const report = await reconcilePayments();
  return NextResponse.json({ success: true, report });
}
