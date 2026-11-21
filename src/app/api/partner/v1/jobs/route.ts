import { NextRequest, NextResponse, after } from 'next/server';
import { withRequestLogger } from '@/lib/logger';
import { listPartnerJobs } from '@/lib/jobs/service';
import { sweepDeadlines } from '@/lib/jobs/deadlines';
import { prepareWaitingJobs } from '@/lib/jobs/printReady';
import { jobErrorResponse, partnerContext, publicJob } from '@/lib/jobs/http';

export const runtime = 'nodejs';

/**
 * GET /api/partner/v1/jobs?scope=active|history
 *
 * The shop's jobs. Devices call this on start-up, on every reconnect and when the
 * socket says "jobs:available", so nothing is lost while a device is offline.
 */
export async function GET(request: NextRequest) {
  const ctx = await partnerContext(request);
  if (ctx instanceof NextResponse) return ctx;
  const log = withRequestLogger(request, { partnerId: ctx.partnerId });
  const scope = request.nextUrl.searchParams.get('scope') === 'history' ? 'history' : 'active';
  try {
    const jobs = await listPartnerJobs(ctx.partnerId, scope);
    // Deadlines are also enforced here, in case no scheduled message arrived
    after(() => sweepDeadlines(20).then(() => undefined).catch((err) => log.warn({ err }, 'deadline sweep failed')));
    // Jobs still waiting for their print-ready PDFs (older orders) are retried here
    if (scope === 'active') after(() => prepareWaitingJobs(ctx.partnerId).catch((err) => log.warn({ err }, 'print file sweep failed')));
    return NextResponse.json({ success: true, jobs: jobs.map(publicJob), serverTime: new Date().toISOString() });
  } catch (error) {
    return jobErrorResponse(error, log);
  }
}
