/**
 * Signed calls from the web app to the funprinting-wss server.
 *
 * Contract (verified by the WSS server):
 * - env WSS_API_URL (base URL, no fallback) and WSS_DISPATCH_SECRET
 * - headers:
 *     Content-Type: application/json
 *     x-fp-timestamp: Date.now() as a string
 *     x-fp-signature: lowercase hex HMAC-SHA256(secret, `${timestamp}.${body}`),
 *                     where body is the exact JSON string sent
 * - POST ${WSS_API_URL}/api/dispatch-print-job  body { partnerId, order }
 * - POST ${WSS_API_URL}/api/cancel-print-job    body { partnerId, orderId }
 * - response { success, delivered: number }
 */
import 'server-only';
import crypto from 'crypto';
import { logger } from '@/lib/logger';

export interface WssResult {
  ok: boolean;
  delivered: number;
  status?: number;
  error?: string;
}

const TIMEOUT_MS = 10_000;

/** Order fields the WSS forwards to the partner app. Customer PII is not sent. */
export interface DispatchOrder {
  orderId: string;
  orderType?: string;
  fileURL?: string;
  fileURLs?: string[];
  fileTypes?: string[];
  originalFileName?: string;
  originalFileNames?: string[];
  printingOptions?: unknown;
  deliveryNumber?: string;
}

export function signWssBody(secret: string, timestamp: string, body: string): string {
  return crypto.createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
}

/**
 * Verifies a request signed by the WSS server with the same contract it verifies
 * (used for WSS → web error reports). Timestamp must be within 5 minutes.
 */
export function verifyWssSignature(headers: Headers, rawBody: string, now = Date.now()): boolean {
  const secret = process.env.WSS_DISPATCH_SECRET;
  const timestamp = headers.get('x-fp-timestamp') || '';
  const signature = headers.get('x-fp-signature') || '';
  if (!secret || !/^\d{1,16}$/.test(timestamp) || !signature) return false;
  if (Math.abs(now - Number(timestamp)) > 5 * 60 * 1000) return false;
  const expected = Buffer.from(signWssBody(secret, timestamp, rawBody));
  const given = Buffer.from(signature);
  return expected.length === given.length && crypto.timingSafeEqual(expected, given);
}

function toDispatchOrder(order: any): DispatchOrder {
  const o = order && typeof order.toObject === 'function' ? order.toObject() : order || {};
  return {
    orderId: String(o.orderId),
    orderType: o.orderType,
    fileURL: o.fileURL,
    fileURLs: Array.isArray(o.fileURLs) ? o.fileURLs : undefined,
    fileTypes: Array.isArray(o.fileTypes) ? o.fileTypes : undefined,
    originalFileName: o.originalFileName,
    originalFileNames: Array.isArray(o.originalFileNames) ? o.originalFileNames : undefined,
    printingOptions: o.printingOptions,
    deliveryNumber: o.deliveryNumber,
  };
}

async function postSigned(path: string, payload: Record<string, unknown>): Promise<WssResult> {
  const baseUrl = process.env.WSS_API_URL?.replace(/\/+$/, '');
  const secret = process.env.WSS_DISPATCH_SECRET;
  if (!baseUrl || !secret) {
    logger.error(
      { path, missing: !baseUrl ? 'WSS_API_URL' : 'WSS_DISPATCH_SECRET' },
      'WSS call skipped: not configured'
    );
    return { ok: false, delivered: 0, error: 'wss_not_configured' };
  }

  const body = JSON.stringify(payload);
  const timestamp = Date.now().toString();
  const signature = signWssBody(secret, timestamp, body);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-fp-timestamp': timestamp,
        'x-fp-signature': signature,
      },
      body,
      signal: controller.signal,
    });
    const data = (await res.json().catch(() => null)) as
      | { success?: boolean; delivered?: unknown; error?: string }
      | null;
    if (!res.ok || !data?.success) {
      logger.error({ path, status: res.status, error: data?.error || res.statusText }, 'WSS call failed');
      return { ok: false, delivered: 0, status: res.status, error: data?.error || res.statusText };
    }
    const delivered = typeof data.delivered === 'number' ? data.delivered : 0;
    return { ok: true, delivered, status: res.status };
  } catch (error: any) {
    const reason = error?.name === 'AbortError' ? 'timeout' : error?.message || 'network_error';
    logger.error({ path, reason }, 'WSS call error');
    return { ok: false, delivered: 0, error: reason };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Socket rooms that should receive a partner's jobs.
 *
 * Tokens issued before the Phase 0 fix carried partnerId = User._id, so installed apps
 * that still hold one sit in room partner_<User._id>. Until those 365-day tokens have
 * expired (all were issued before 2026-11-18, so by 2027-11-18), also send to that room.
 * A socket is only ever in one room, so no device receives a job twice.
 * TODO(2027-11-18): drop the legacy room.
 */
async function partnerRooms(partnerId: string): Promise<string[]> {
  const rooms = [partnerId];
  try {
    const [{ default: connectDB }, { default: Partner }] = await Promise.all([
      import('@/lib/mongodb'),
      import('@/models/Partner'),
    ]);
    await connectDB();
    const partner = await Partner.findById(partnerId).select('userId').lean<{ userId?: unknown }>();
    const legacy = partner?.userId ? String(partner.userId) : '';
    if (/^[0-9a-fA-F]{24}$/.test(legacy) && legacy !== partnerId) rooms.push(legacy);
  } catch (error) {
    logger.warn({ err: error, partnerId }, 'could not resolve legacy partner room');
  }
  return rooms;
}

async function postToRooms(
  path: string,
  partnerId: string,
  build: (roomId: string) => Record<string, unknown>
): Promise<WssResult> {
  const rooms = await partnerRooms(String(partnerId));
  const results = await Promise.all(rooms.map((room) => postSigned(path, build(room))));
  const primary = results[0];
  const delivered = results.reduce((sum, r) => sum + (r.ok ? r.delivered : 0), 0);
  return { ...primary, ok: results.some((r) => r.ok), delivered };
}

/**
 * Sends a print job to the partner's socket room (partner_<Partner._id>).
 * `delivered` is the number of connected partner sockets that received it.
 */
export function dispatchPrintJob(partnerId: string, order: any): Promise<WssResult> {
  const payload = toDispatchOrder(order);
  return postToRooms('/api/dispatch-print-job', partnerId, (room) => ({ partnerId: room, order: payload }));
}

export function cancelPrintJob(partnerId: string, orderId: string): Promise<WssResult> {
  return postToRooms('/api/cancel-print-job', partnerId, (room) => ({ partnerId: room, orderId: String(orderId) }));
}

/**
 * Tells a partner's devices that their job list changed ("jobs:available"). Devices
 * then fetch jobs from the API (src/app/api/partner/v1); the socket carries no job data.
 */
export function notifyPartnerJobs(partnerId: string, reason: 'new' | 'updated' | 'cancelled'): Promise<WssResult> {
  return postToRooms('/api/notify-jobs', partnerId, (room) => ({ partnerId: room, reason }));
}
