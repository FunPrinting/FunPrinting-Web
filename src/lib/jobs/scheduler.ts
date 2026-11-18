import 'server-only';
import { Client, Receiver } from '@upstash/qstash';
import { logger } from '@/lib/logger';

/**
 * Exact-time job deadlines through Upstash QStash: a delayed POST to
 * /api/jobs/deadline when a deadline falls due.
 *
 * QStash is optional. Without QSTASH_TOKEN and APP_BASE_URL (QStash can't call
 * localhost or preview URLs behind protection), deadlines are still enforced by
 * sweeps: whenever partners or customers use the job APIs, and by the cron job.
 */
export type DeadlineKind = 'accept' | 'refund';

let client: Client | null | undefined;

function getClient(): Client | null {
  if (client !== undefined) return client;
  const token = process.env.QSTASH_TOKEN;
  client = token && process.env.APP_BASE_URL ? new Client({ token, baseUrl: process.env.QSTASH_URL || undefined }) : null;
  return client;
}

export function isSchedulerConfigured(): boolean {
  return getClient() !== null;
}

export async function scheduleDeadline(jobId: string, kind: DeadlineKind, at: Date, version: number): Promise<void> {
  const qstash = getClient();
  if (!qstash) return;
  const delay = Math.max(1, Math.ceil((at.getTime() - Date.now()) / 1000));
  try {
    await qstash.publishJSON({
      url: `${process.env.APP_BASE_URL!.replace(/\/+$/, '')}/api/jobs/deadline`,
      body: { jobId, kind, version },
      delay,
      retries: 3,
      // One message per job, deadline and version: re-scheduling the same thing is a no-op
      deduplicationId: `${jobId}-${kind}-${version}`,
    });
  } catch (error) {
    // Sweeps still catch the deadline
    logger.warn({ err: error, jobId, kind }, 'could not schedule job deadline');
  }
}

/** Verifies the Upstash-Signature header of a QStash delivery. */
export async function verifySchedulerRequest(signature: string | null, body: string, url: string): Promise<boolean> {
  const current = process.env.QSTASH_CURRENT_SIGNING_KEY;
  const next = process.env.QSTASH_NEXT_SIGNING_KEY;
  if (!signature || !current || !next) return false;
  try {
    return await new Receiver({ currentSigningKey: current, nextSigningKey: next }).verify({ signature, body, url, clockTolerance: 30 });
  } catch {
    return false;
  }
}
