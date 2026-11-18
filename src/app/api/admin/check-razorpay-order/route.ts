import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import connectDB from '@/lib/mongodb';
import Payment from '@/models/Payment';
import { syncPaymentFromRazorpay } from '@/lib/payments/reconcile';
import { runFulfilment } from '@/lib/payments/fulfil';

export const runtime = 'nodejs';

/**
 * POST /api/admin/check-razorpay-order — { referenceId } or { orderId }
 * Re-checks the payment with Razorpay and retries any unfinished fulfilment.
 */
export async function POST(request: NextRequest) {
  const admin = await requireAdmin();
  if (admin instanceof NextResponse) return admin;
  const body = await request.json().catch(() => ({}));
  const referenceId = typeof body.referenceId === 'string' ? body.referenceId : undefined;
  const orderId = typeof body.orderId === 'string' ? body.orderId : undefined;
  if (!referenceId && !orderId) {
    return NextResponse.json({ success: false, error: 'referenceId or orderId is required' }, { status: 400 });
  }

  await connectDB();
  const payment = referenceId
    ? await Payment.findOne({ referenceId }).lean<{ referenceId: string } | null>()
    : await Payment.findOne({ orderId }).sort({ createdAt: -1 }).lean<{ referenceId: string } | null>();
  if (!payment) return NextResponse.json({ success: false, error: 'No payment found' }, { status: 404 });

  const status = await syncPaymentFromRazorpay(payment.referenceId, 'admin');
  const fulfilment = status === 'paid' ? await runFulfilment(payment.referenceId) : null;
  return NextResponse.json({ success: true, referenceId: payment.referenceId, status, fulfilment });
}
