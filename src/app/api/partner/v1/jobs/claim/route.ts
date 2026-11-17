import { NextRequest, NextResponse } from 'next/server';
import { withRequestLogger } from '@/lib/logger';
import { claimJob } from '@/lib/jobs/service';
import { jobErrorResponse, partnerContext, publicJob } from '@/lib/jobs/http';

export const runtime = 'nodejs';

/**
 * POST /api/partner/v1/jobs/claim — take the oldest job waiting in the queue.
 * Requires x-device-id. Returns { job: null } when the queue is empty.
 * The claim is a 5-minute lease, renewed by each status report.
 */
export async function POST(request: NextRequest) {
  const ctx = await partnerContext(request);
  if (ctx instanceof NextResponse) return ctx;
  if (!ctx.deviceId) return NextResponse.json({ success: false, error: 'x-device-id header is required' }, { status: 400 });
  const log = withRequestLogger(request, { partnerId: ctx.partnerId, deviceId: ctx.deviceId });
  try {
    const job = await claimJob({ partnerId: ctx.partnerId, deviceId: ctx.deviceId });
    return NextResponse.json({ success: true, job: job ? publicJob(job) : null });
  } catch (error) {
    return jobErrorResponse(error, log);
  }
}
