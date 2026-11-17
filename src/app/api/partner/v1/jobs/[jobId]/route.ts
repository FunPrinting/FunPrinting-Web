import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withRequestLogger } from '@/lib/logger';
import { acceptJob, claimJob, rejectJob, reportJob } from '@/lib/jobs/service';
import { jobErrorResponse, partnerContext, publicJob } from '@/lib/jobs/http';

export const runtime = 'nodejs';

const bodySchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('accept') }),
  z.object({ action: z.literal('reject'), reason: z.string().trim().max(200).optional() }),
  z.object({ action: z.literal('claim') }),
  z.object({
    action: z.literal('report'),
    status: z.enum(['printing', 'printed', 'failed', 'release']),
    error: z.string().trim().max(500).optional(),
  }),
]);

/**
 * POST /api/partner/v1/jobs/[jobId]
 *   { action: 'accept' }                          manual-mode shops take the order
 *   { action: 'reject', reason? }                 decline; the order moves on immediately
 *   { action: 'claim' }                           this device prints it (x-device-id)
 *   { action: 'report', status, error? }          printing (heartbeat) | printed | failed | release
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ jobId: string }> }) {
  const ctx = await partnerContext(request);
  if (ctx instanceof NextResponse) return ctx;
  const { jobId } = await params;
  const log = withRequestLogger(request, { partnerId: ctx.partnerId, deviceId: ctx.deviceId, jobId });

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ success: false, error: 'Invalid action' }, { status: 400 });
  const body = parsed.data;

  try {
    if (body.action === 'accept') return NextResponse.json({ success: true, job: publicJob(await acceptJob(jobId, ctx)) });
    if (body.action === 'reject') return NextResponse.json({ success: true, job: publicJob(await rejectJob(jobId, ctx, body.reason)) });

    if (!ctx.deviceId) return NextResponse.json({ success: false, error: 'x-device-id header is required' }, { status: 400 });
    const device = { partnerId: ctx.partnerId, deviceId: ctx.deviceId };
    if (body.action === 'claim') {
      const job = await claimJob(device, jobId);
      if (!job) return NextResponse.json({ success: false, error: 'Job is not ready to print' }, { status: 409 });
      return NextResponse.json({ success: true, job: publicJob(job) });
    }
    const job = await reportJob(jobId, device, body.status, body.error);
    log.info({ status: body.status }, 'job report');
    return NextResponse.json({ success: true, job: publicJob(job) });
  } catch (error) {
    return jobErrorResponse(error, log);
  }
}
