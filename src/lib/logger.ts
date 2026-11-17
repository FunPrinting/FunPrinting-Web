import 'server-only';
import crypto from 'crypto';
import pino, { type Logger } from 'pino';

/**
 * Structured logger.
 *
 * - JSON lines in production (Vercel and Render parse them).
 * - Human-readable output in development when pino-pretty is installed.
 * - Personal data and credentials are redacted. Log ids (orderId, partnerId,
 *   razorpay ids), not whole documents or request bodies.
 */
const isDev = process.env.NODE_ENV === 'development';

function devTransport() {
  if (!isDev) return undefined;
  try {
    require.resolve('pino-pretty');
    return { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } };
  } catch {
    return undefined;
  }
}

export const REDACT_PATHS = [
  '*.password',
  '*.token',
  '*.accessToken',
  '*.refreshToken',
  '*.otp',
  '*.email',
  '*.phone',
  '*.customerInfo',
  'customerInfo',
  'headers.authorization',
  'headers.cookie',
  'req.headers.authorization',
  'req.headers.cookie',
];

export const logger: Logger = pino({
  level: process.env.LOG_LEVEL || (isDev ? 'debug' : 'info'),
  base: { service: 'funprinting-web' },
  redact: { paths: REDACT_PATHS, censor: '[redacted]' },
  transport: devTransport(),
});

/** Returns the incoming x-request-id, or a new UUID. */
export function getRequestId(req?: Request | null): string {
  const incoming = req?.headers.get('x-request-id')?.trim();
  return incoming && incoming.length <= 128 ? incoming : crypto.randomUUID();
}

/** A child logger tagged with the request id and route, for one API request. */
export function withRequestLogger(req: Request, bindings: Record<string, unknown> = {}): Logger {
  let route: string | undefined;
  try {
    route = new URL(req.url).pathname;
  } catch {
    route = undefined;
  }
  return logger.child({ requestId: getRequestId(req), method: req.method, route, ...bindings });
}
