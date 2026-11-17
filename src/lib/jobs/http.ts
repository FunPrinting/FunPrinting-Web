import 'server-only';
import { NextResponse } from 'next/server';
import { resolvePartnerRequest } from '@/lib/authz';
import { JobError } from '@/lib/jobs/service';
import type { IPrintJob } from '@/models/PrintJob';
import type { Logger } from 'pino';

/**
 * Partner job API helpers. Devices identify themselves with `x-device-id`
 * (a stable random id the app generates once, 8–64 chars); Phase 4 ties it to a
 * per-device token.
 */
export async function partnerContext(request: Request): Promise<{ partnerId: string; deviceId?: string } | NextResponse> {
  const resolved = await resolvePartnerRequest(request);
  if (resolved instanceof NextResponse) return resolved;
  const raw = request.headers.get('x-device-id')?.trim();
  const deviceId = raw && /^[A-Za-z0-9_.:-]{8,64}$/.test(raw) ? raw : undefined;
  return { partnerId: String(resolved.partner._id), deviceId };
}

/** What a device needs to show and print a job. */
export function publicJob(job: IPrintJob) {
  return {
    jobId: job.jobId,
    orderId: job.orderId,
    status: job.status,
    deliveryType: job.deliveryType,
    deliveryNumber: job.deliveryNumber,
    files: job.files,
    service: job.service,
    acceptBy: job.acceptBy,
    claimedBy: job.claim?.deviceId,
    leaseUntil: job.claim?.leaseUntil,
    lastError: job.lastError,
    createdAt: job.createdAt,
    printedAt: job.printedAt,
  };
}

export function jobErrorResponse(error: unknown, log: Logger) {
  if (error instanceof JobError) return NextResponse.json({ success: false, error: error.message }, { status: error.status });
  log.error({ err: error }, 'partner job request failed');
  return NextResponse.json({ success: false, error: 'Request failed' }, { status: 500 });
}
