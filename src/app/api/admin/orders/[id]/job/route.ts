import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin } from '@/lib/authz';
import { withRequestLogger } from '@/lib/logger';
import connectDB from '@/lib/mongodb';
import Order from '@/models/Order';
import PrintJob, { type IPrintJob } from '@/models/PrintJob';
import { JobError, resendJob } from '@/lib/jobs/service';
import { cancelJob } from '@/lib/jobs/deadlines';

export const runtime = 'nodejs';

async function findOrderId(id: string): Promise<string | null> {
  await connectDB();
  const query = /^[0-9a-fA-F]{24}$/.test(id) ? { _id: id } : { orderId: id };
  const order = await Order.findOne(query).select('orderId').lean<{ orderId: string } | null>();
  return order?.orderId ?? null;
}

/** GET /api/admin/orders/[id]/job — the order's print job with its full history. */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  if (admin instanceof NextResponse) return admin;
  const orderId = await findOrderId((await params).id);
  if (!orderId) return NextResponse.json({ success: false, error: 'Order not found' }, { status: 404 });
  const job = await PrintJob.findOne({ orderId }).select('-customerChoice.tokenHash').lean<IPrintJob | null>();
  return NextResponse.json({ success: true, job });
}

const actionSchema = z.discriminatedUnion('action', [
  // Put the job back in its shop's queue (creates it for orders paid before jobs existed)
  z.object({ action: z.literal('resend'), force: z.boolean().default(false) }),
  // Cancel; refund in full unless refund is false. force: even if printing started
  z.object({ action: z.literal('cancel'), reason: z.string().trim().min(3).max(200), refund: z.boolean().default(true), force: z.boolean().default(false) }),
]);

/**
 * POST /api/admin/orders/[id]/job — { action: 'resend' | 'cancel', ... }
 * Orders stay with the customer's chosen shop; there is no reassignment.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  if (admin instanceof NextResponse) return admin;
  const log = withRequestLogger(request, { adminId: admin.id });
  const orderId = await findOrderId((await params).id);
  if (!orderId) return NextResponse.json({ success: false, error: 'Order not found' }, { status: 404 });

  const parsed = actionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ success: false, error: 'Invalid action' }, { status: 400 });
  const body = parsed.data;
  const actor = `admin:${admin.email}`;

  try {
    if (body.action === 'resend') {
      const job = await resendJob(orderId, admin.email, body.force);
      return NextResponse.json({ success: true, job });
    }

    const result = await cancelJob(orderId, { reason: body.reason, actor, refund: body.refund, force: body.force });
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    if (error instanceof JobError) return NextResponse.json({ success: false, error: error.message }, { status: error.status });
    const status = (error as { status?: number }).status;
    if (typeof status === 'number' && error instanceof Error) return NextResponse.json({ success: false, error: error.message }, { status });
    log.error({ err: error, orderId, action: body.action }, 'admin job action failed');
    return NextResponse.json({ success: false, error: 'Action failed' }, { status: 500 });
  }
}
