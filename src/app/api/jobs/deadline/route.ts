import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withRequestLogger } from '@/lib/logger';
import { verifySchedulerRequest } from '@/lib/jobs/scheduler';
import { handleAcceptDeadline, handleRefundDeadline } from '@/lib/jobs/deadlines';

export const runtime = 'nodejs';

const bodySchema = z.object({ jobId: z.string().min(2).max(60), kind: z.enum(['accept', 'refund']), version: z.number().int().nonnegative() });

/**
 * POST /api/jobs/deadline — delayed message from Upstash QStash when a job deadline
 * falls due. Signed with the QStash signing keys. The handlers re-check the job, so
 * an outdated or repeated message does nothing.
 */
export async function POST(request: NextRequest) {
  const log = withRequestLogger(request);
  const raw = await request.text();
  const url = `${(process.env.APP_BASE_URL || request.nextUrl.origin).replace(/\/+$/, '')}/api/jobs/deadline`;
  if (!(await verifySchedulerRequest(request.headers.get('upstash-signature'), raw, url))) {
    log.warn('job deadline call with invalid signature');
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }
  const parsed = bodySchema.safeParse((() => { try { return JSON.parse(raw); } catch { return null; } })());
  if (!parsed.success) return NextResponse.json({ error: 'Invalid body' }, { status: 400 });

  const { jobId, kind } = parsed.data;
  try {
    const result = kind === 'accept' ? await handleAcceptDeadline(jobId) : await handleRefundDeadline(jobId);
    log.info({ jobId, kind, result }, 'job deadline handled');
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    log.error({ err: error, jobId, kind }, 'job deadline failed');
    // 5xx: QStash retries
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
