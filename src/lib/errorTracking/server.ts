import 'server-only';
import { AsyncLocalStorage } from 'node:async_hooks';
import { after } from 'next/server';
import {
  LIMITS,
  computeFingerprint,
  scrubContext,
  scrubText,
  scrubUrl,
} from '@/lib/errorTracking/scrub';
import type { ErrorLevel, ErrorSource } from '@/models/ErrorGroup';

/**
 * Stores errors and warnings in MongoDB (ErrorGroup), grouped by fingerprint.
 *
 * Guarantees:
 * - Never throws and never blocks the caller for long (capture is best-effort).
 * - Never recurses: errors raised while capturing are written to the original
 *   console only, and capture is skipped while a capture is in progress.
 * - Bounded: each fingerprint is written at most once per THROTTLE_MS per instance
 *   (occurrences in between are added to the next write's count), and an instance
 *   writes at most MAX_WRITES_PER_MINUTE records.
 */

export interface CaptureInput {
  source?: ErrorSource;
  level?: ErrorLevel;
  name?: string;
  message: string;
  stack?: string;
  url?: string;
  method?: string;
  route?: string;
  requestId?: string;
  userId?: string;
  partnerId?: string;
  userAgent?: string;
  digest?: string;
  release?: string;
  context?: unknown;
}

const THROTTLE_MS = 10_000;
const MAX_WRITES_PER_MINUTE = 120;
const MAX_TRACKED_FINGERPRINTS = 1000;
const DB_TIMEOUT_MS = 3000;

// Saved before any console patching, so capture's own diagnostics can't loop
const rawConsoleError = console.error.bind(console);

type Pending = { lastWriteAt: number; skipped: number };
const pending = new Map<string, Pending>();
let windowStart = 0;
let writesInWindow = 0;
// Marks the async call chain of a running capture, so console/logger output produced
// by the capture itself (e.g. a DB error) is not captured again. Other requests
// running at the same time are unaffected.
const captureScope = new AsyncLocalStorage<true>();

export function currentRelease(): string | undefined {
  return (
    process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12) ||
    process.env.RENDER_GIT_COMMIT?.slice(0, 12) ||
    process.env.APP_RELEASE ||
    undefined
  );
}

/** True while a capture is running in this instance (used by the console hook). */
export function isCapturing(): boolean {
  return captureScope.getStore() === true;
}

function withinGlobalBudget(now: number): boolean {
  if (now - windowStart > 60_000) {
    windowStart = now;
    writesInWindow = 0;
  }
  if (writesInWindow >= MAX_WRITES_PER_MINUTE) return false;
  writesInWindow += 1;
  return true;
}

function claimWrite(fingerprint: string, now: number): number | null {
  const entry = pending.get(fingerprint);
  if (entry && now - entry.lastWriteAt < THROTTLE_MS) {
    entry.skipped += 1;
    return null;
  }
  if (!withinGlobalBudget(now)) {
    if (entry) entry.skipped += 1;
    return null;
  }
  const occurrences = 1 + (entry?.skipped ?? 0);
  if (!entry && pending.size >= MAX_TRACKED_FINGERPRINTS) {
    const oldest = pending.keys().next().value;
    if (oldest !== undefined) pending.delete(oldest);
  }
  pending.delete(fingerprint); // re-insert to keep Map order ≈ recency
  pending.set(fingerprint, { lastWriteAt: now, skipped: 0 });
  return occurrences;
}

function timeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error('error capture timed out')), ms)),
  ]);
}

/** Converts anything thrown into name/message/stack. */
export function describeThrown(value: unknown): { name: string; message: string; stack?: string; digest?: string } {
  if (value instanceof Error) {
    const digest = (value as Error & { digest?: unknown }).digest;
    return {
      name: value.name || 'Error',
      message: value.message || String(value),
      stack: value.stack,
      digest: typeof digest === 'string' ? digest : undefined,
    };
  }
  if (value && typeof value === 'object' && 'message' in value) {
    const v = value as { name?: unknown; message?: unknown; stack?: unknown };
    return {
      name: typeof v.name === 'string' ? v.name : 'Error',
      message: String(v.message),
      stack: typeof v.stack === 'string' ? v.stack : undefined,
    };
  }
  return { name: 'NonError', message: typeof value === 'string' ? value : safeStringify(value) };
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

/**
 * Records one occurrence. Resolves to the ErrorGroup id when written, or null when
 * throttled, disabled or failed. Callers may ignore the promise.
 */
export function captureError(input: CaptureInput): Promise<string | null> {
  if (process.env.ERROR_TRACKING_DISABLED === '1') return Promise.resolve(null);
  if (process.env.NODE_ENV === 'test' && process.env.ERROR_TRACKING_IN_TESTS !== '1') return Promise.resolve(null);
  if (!process.env.MONGODB_URI) return Promise.resolve(null);
  if (isCapturing()) return Promise.resolve(null);
  return captureScope.run(true, () => doCapture(input));
}

async function doCapture(input: CaptureInput): Promise<string | null> {
  try {
    const source: ErrorSource = input.source ?? 'server';
    const level: ErrorLevel = input.level ?? 'error';
    const name = scrubText(input.name || 'Error', 100);
    const message = scrubText(input.message || '(no message)', LIMITS.message);
    const stack = input.stack ? scrubText(input.stack, LIMITS.stack) : undefined;
    const route = input.route ? scrubText(input.route, 200) : undefined;
    const fingerprint = computeFingerprint({ source, name, message, stack, route });

    const occurrences = claimWrite(fingerprint, Date.now());
    if (occurrences === null) return null;

    const now = new Date();
    const release = input.release || currentRelease();
    const sample = stripUndefined({
      at: now,
      message,
      stack,
      url: scrubUrl(input.url),
      method: input.method?.slice(0, 10),
      route,
      requestId: input.requestId?.slice(0, 128),
      userId: input.userId?.slice(0, 64),
      partnerId: input.partnerId?.slice(0, 64),
      release,
      userAgent: input.userAgent ? scrubText(input.userAgent, LIMITS.userAgent) : undefined,
      digest: input.digest?.slice(0, 64),
      context: scrubContext(input.context),
    });

    const [{ default: connectDB }, { default: ErrorGroup, MAX_SAMPLES }] = await Promise.all([
      import('@/lib/mongodb'),
      import('@/models/ErrorGroup'),
    ]);
    await timeout(connectDB(), DB_TIMEOUT_MS);

    // One atomic upsert. All expressions in a $set stage read the document as it
    // was before the update, so `regressedAt` sees the old status. Every value from
    // the error is wrapped in $literal: in a pipeline update a string starting with
    // '$' would otherwise be read as a field path.
    const wasResolved = { $eq: ['$status', 'resolved'] };
    const result = await timeout(
      ErrorGroup.collection.findOneAndUpdate(
        { fingerprint },
        [
          {
            $set: {
              source: { $literal: source },
              level: { $cond: [{ $eq: ['$level', 'error'] }, 'error', { $literal: level }] }, // never downgrade
              name: { $literal: name },
              message: { $literal: message },
              route: route !== undefined ? { $literal: route } : '$route',
              status: { $cond: [wasResolved, 'open', { $ifNull: ['$status', 'open'] }] },
              regressedAt: { $cond: [wasResolved, now, '$regressedAt'] },
              resolvedAt: { $cond: [wasResolved, null, '$resolvedAt'] },
              count: { $add: [{ $ifNull: ['$count', 0] }, occurrences] },
              firstSeenAt: { $ifNull: ['$firstSeenAt', now] },
              lastSeenAt: now,
              firstRelease: { $ifNull: ['$firstRelease', { $literal: release ?? null }] },
              lastRelease: release !== undefined ? { $literal: release } : '$lastRelease',
              samples: {
                $slice: [{ $concatArrays: [[{ $literal: sample }], { $ifNull: ['$samples', []] }] }, MAX_SAMPLES],
              },
              createdAt: { $ifNull: ['$createdAt', now] },
              updatedAt: now,
            },
          },
        ],
        { upsert: true, returnDocument: 'after', projection: { _id: 1 } }
      ),
      DB_TIMEOUT_MS
    );
    // Driver v6 returns the document itself (includeResultMetadata defaults to false)
    const doc = result as { _id?: unknown } | null;
    return doc?._id ? String(doc._id) : null;
  } catch (error) {
    rawConsoleError('[error-tracking] capture failed:', error instanceof Error ? error.message : error);
    return null;
  }
}

/**
 * Fire-and-forget capture that still completes on serverless platforms: inside a
 * request it is scheduled with Next's after(), which keeps the function alive until
 * the write finishes; outside a request (startup, timers) it just runs.
 */
export function captureInBackground(input: CaptureInput): void {
  const run = () => captureError(input).then(() => undefined);
  try {
    after(run);
  } catch {
    void run();
  }
}

/** Convenience: capture a thrown value with extra fields. */
export function captureException(error: unknown, extra: Omit<CaptureInput, 'message'> = {}): Promise<string | null> {
  const described = describeThrown(error);
  return captureError({ ...extra, ...described, digest: extra.digest ?? described.digest });
}

function stripUndefined<T extends Record<string, unknown>>(obj: T): T {
  for (const key of Object.keys(obj)) if (obj[key] === undefined) delete obj[key];
  return obj;
}

/** Test helper. */
export function __resetErrorTrackingState(): void {
  pending.clear();
  windowStart = 0;
  writesInWindow = 0;
}

export const __internals = { claimWrite, THROTTLE_MS, MAX_WRITES_PER_MINUTE };
