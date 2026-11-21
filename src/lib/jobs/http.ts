import 'server-only';
import { isPrintReady } from '@/lib/jobs/printReady';
import { NextResponse } from 'next/server';
import { resolvePartnerRequest } from '@/lib/authz';
import { JobError } from '@/lib/jobs/service';
import type { IPrintJob } from '@/models/PrintJob';
import type { Logger } from 'pino';

/**
 * Partner job API helpers. The device is the `did` in its access token (device
 * sign-in); apps still on a legacy token send `x-device-id` instead.
 */
export async function partnerContext(request: Request): Promise<{ partnerId: string; deviceId?: string } | NextResponse> {
  const resolved = await resolvePartnerRequest(request);
  if (resolved instanceof NextResponse) return resolved;
  // Device sign-in tokens carry the device id; legacy tokens send x-device-id
  if (resolved.deviceId) return { partnerId: String(resolved.partner._id), deviceId: resolved.deviceId };
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
    // False while the server is still making PDFs for an older order; such a job can't be claimed yet
    printReady: isPrintReady(job),
    service: job.service,
    acceptBy: job.acceptBy,
    claimedBy: job.claim?.deviceId,
    leaseUntil: job.claim?.leaseUntil,
    lastError: job.lastError,
    createdAt: job.createdAt,
    printedAt: job.printedAt,
    printer: job.claim?.printer,
    printedBy: job.printedBy,
  };
}

export function jobErrorResponse(error: unknown, log: Logger) {
  if (error instanceof JobError) return NextResponse.json({ success: false, error: error.message }, { status: error.status });
  log.error({ err: error }, 'partner job request failed');
  return NextResponse.json({ success: false, error: 'Request failed' }, { status: 500 });
}
