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

// pino-pretty is a dev dependency, loaded by name in pino's worker thread. It must
// not be require()d here: the bundler would then pull it into the edge build of
// instrumentation.ts, where Node's 'stream' module doesn't exist (dev server 500).
function devTransport() {
  if (!isDev || process.env.LOG_PRETTY === '0') return undefined;
  return { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } };
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

const PINO_WARN = 40;
const PINO_ERROR = 50;

/** Pulls message, error and ids out of pino's (obj?, msg?, ...args) call form. */
function toCapture(args: unknown[], level: number, bindings: Record<string, unknown>) {
  const [first, second] = args;
  const obj = first && typeof first === 'object' && !(first instanceof Error) ? (first as Record<string, unknown>) : undefined;
  const err = first instanceof Error ? first : obj?.err instanceof Error ? (obj.err as Error) : undefined;
  const msg = typeof first === 'string' ? first : typeof second === 'string' ? second : undefined;
  const pick = (k: string) => {
    const v = obj?.[k] ?? bindings[k];
    return typeof v === 'string' ? v : undefined;
  };
  const { err: _err, ...rest } = obj ?? {};
  return {
    source: 'server' as const,
    level: level >= PINO_ERROR ? ('error' as const) : ('warning' as const),
    name: err?.name || (level >= PINO_ERROR ? 'LoggedError' : 'LoggedWarning'),
    message: [msg, err?.message].filter(Boolean).join(': ') || 'logged error',
    stack: err?.stack,
    route: pick('route'),
    method: pick('method'),
    requestId: pick('requestId'),
    partnerId: pick('partnerId'),
    context: rest,
  };
}

export const logger: Logger = pino({
  level: process.env.LOG_LEVEL || (isDev ? 'debug' : 'info'),
  base: { service: 'funprinting-web' },
  redact: { paths: REDACT_PATHS, censor: '[redacted]' },
  transport: devTransport(),
  hooks: {
    // Warnings and errors are also stored by error tracking (src/lib/errorTracking)
    logMethod(args, method, level) {
      method.apply(this, args);
      if (level < PINO_WARN) return;
      try {
        const bindings = (this as Logger).bindings?.() ?? {};
        const input = toCapture(args as unknown[], level, bindings);
        void import('@/lib/errorTracking/server')
          .then(({ captureInBackground, isCapturing }) => (isCapturing() ? undefined : captureInBackground(input)))
          .catch(() => undefined);
      } catch {
        // never let tracking break logging
      }
    },
  },
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
