import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { reconcilePayments } from '@/lib/payments/reconcile';

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * POST /api/admin/check-pending-payments — "Refresh Orders & Check Payments" on the
 * admin dashboard. Runs the same reconcile as the cron job.
 */
export async function POST() {
  const admin = await requireAdmin();
  if (admin instanceof NextResponse) return admin;
  const r = await reconcilePayments();
  return NextResponse.json({
    success: true,
    message: `Checked ${r.checked} open links: ${r.settled} paid, ${r.closed} expired; retried ${r.fulfilmentRetried} fulfilments; cancelled ${r.ordersCancelled} unpaid orders${r.errors ? `; ${r.errors} errors` : ''}`,
    report: r,
  });
}
