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
 * Sends a print job to the partner's socket room (partner_<Partner._id>).
 * `delivered` is the number of connected partner sockets that received it.
 */
export function dispatchPrintJob(partnerId: string, order: any): Promise<WssResult> {
  return postSigned('/api/dispatch-print-job', {
    partnerId: String(partnerId),
    order: toDispatchOrder(order),
  });
}

export function cancelPrintJob(partnerId: string, orderId: string): Promise<WssResult> {
  return postSigned('/api/cancel-print-job', {
    partnerId: String(partnerId),
    orderId: String(orderId),
  });
}
