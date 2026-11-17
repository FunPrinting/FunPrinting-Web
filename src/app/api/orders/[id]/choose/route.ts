import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withRequestLogger } from '@/lib/logger';
import { canAccessOrder, getSessionUser } from '@/lib/authz';
import { checkRateLimit, getClientIdentifier, otpVerifyRateLimit } from '@/lib/ratelimit';
import connectDB from '@/lib/mongodb';
import Order from '@/models/Order';
import PrintJob, { WAITING_JOB_STATUSES } from '@/models/PrintJob';
import { answerCustomerChoice } from '@/lib/jobs/deadlines';
import { hashToken, JobError } from '@/lib/jobs/service';

export const runtime = 'nodejs';

const tokenSchema = z.string().min(20).max(100);

/**
 * The shop hasn't accepted the order yet: the customer may refund now or keep
 * waiting (24-hour automatic refund still applies). Authorised by the token in the
 * email link, or by being the signed-in owner (My Orders).
 *
 * GET  ?token=...                        → { orderId, shop, refundBy }
 * POST { token?, choice: refund | wait }
 */
async function isOwner(orderId: string): Promise<boolean> {
  const user = await getSessionUser().catch(() => null);
  if (!user) return false;
  const order = await Order.findOne({ orderId }).select('customerInfo').lean<{ customerInfo?: { email?: string } } | null>();
  return canAccessOrder(user, order);
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const limited = await checkRateLimit(otpVerifyRateLimit, `choose:${getClientIdentifier(request)}`);
  if (limited) return limited;
  const { id } = await params;
  await connectDB();
  const token = tokenSchema.safeParse(request.nextUrl.searchParams.get('token'));
  const filter: Record<string, unknown> = { orderId: id, status: { $in: WAITING_JOB_STATUSES }, 'customerChoice.sentAt': { $exists: true } };
  if (token.success) filter['customerChoice.tokenHash'] = hashToken(token.data);
  else if (!(await isOwner(id))) return NextResponse.json({ success: false, error: 'Invalid link' }, { status: 400 });

  const job = await PrintJob.findOne(filter).select('orderId partnerId refundBy acceptedAt firstClaimedAt').lean<{ orderId: string; partnerId?: string; refundBy?: Date; acceptedAt?: Date; firstClaimedAt?: Date } | null>();
  if (!job || job.acceptedAt || job.firstClaimedAt) {
    return NextResponse.json({ success: false, error: 'The shop has already accepted this order, or the link is no longer valid' }, { status: 410 });
  }
  const { getActivePartner } = await import('@/lib/jobs/assign');
  const shop = job.partnerId ? await getActivePartner(job.partnerId) : null;
  return NextResponse.json({ success: true, orderId: job.orderId, shop: shop?.businessName, refundBy: job.refundBy });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const limited = await checkRateLimit(otpVerifyRateLimit, `choose:${getClientIdentifier(request)}`);
  if (limited) return limited;
  const { id } = await params;
  const log = withRequestLogger(request, { orderId: id });
  const parsed = z.object({ token: tokenSchema.optional(), choice: z.enum(['refund', 'wait']) }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ success: false, error: 'Invalid request' }, { status: 400 });
  try {
    await connectDB();
    const ownerVerified = parsed.data.token ? false : await isOwner(id);
    if (!parsed.data.token && !ownerVerified) return NextResponse.json({ success: false, error: 'Please sign in' }, { status: 401 });
    const result = await answerCustomerChoice(id, { token: parsed.data.token, ownerVerified }, parsed.data.choice);
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    if (error instanceof JobError) return NextResponse.json({ success: false, error: error.message }, { status: error.status });
    log.error({ err: error }, 'customer choice failed');
    return NextResponse.json({ success: false, error: 'Something went wrong. Please try again.' }, { status: 500 });
  }
}
