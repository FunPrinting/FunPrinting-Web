import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin } from '@/lib/authz';
import { withRequestLogger } from '@/lib/logger';
import { startRefund } from '@/lib/payments/refunds';
import { paymentErrorResponse } from '@/lib/payments/http';

export const runtime = 'nodejs';

const bodySchema = z.object({
  amountPaise: z.number().int().positive().optional(), // omit for a full refund
  reason: z.string().trim().min(3).max(200),
});

/**
 * POST /api/admin/payments/[ref]/refund — { reason, amountPaise? }
 * Starts a Razorpay refund. The order is marked refunded when Razorpay confirms it
 * (refund.processed webhook).
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ ref: string }> }) {
  const admin = await requireAdmin();
  if (admin instanceof NextResponse) return admin;
  const { ref } = await params;
  const log = withRequestLogger(request, { referenceId: ref, adminId: admin.id });

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ success: false, error: 'A reason is required' }, { status: 400 });

  try {
    const result = await startRefund(ref, { ...parsed.data, actor: admin.email });
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    return paymentErrorResponse(error, log, 'Refund could not be started');
  }
}
