import type { Instrumentation } from 'next';

// Node.js runtime only; loaded from src/instrumentation.ts.

/**
 * Runs once when a Next.js server instance starts.
 *
 * - Validates the server environment and logs every problem in one place, so a bad
 *   deploy is obvious in the first log line instead of surfacing as scattered 500s.
 *   It logs rather than exits: individual features already fail closed on their own.
 * - Installs error tracking for console.error / console.warn (see src/lib/errorTracking).
 */
export async function registerNode() {
  // Skip during `next build`, which runs without production secrets
  if (process.env.NEXT_PHASE === 'phase-production-build') return;

  const [{ installConsoleHook }, { getServerEnv, EnvError }, { logger }] = await Promise.all([
    import('@/lib/errorTracking/consoleHook'),
    import('@/lib/env'),
    import('@/lib/logger'),
  ]);
  installConsoleHook();

  if (process.env.NODE_ENV === 'production' && (!process.env.QSTASH_TOKEN || !process.env.APP_BASE_URL)) {
    logger.warn('QStash is not configured: print job deadlines (10-minute notice, 24-hour refund) only run when partners or customers load their order lists, and on the daily cron');
  }

  try {
    getServerEnv();
    logger.info('server environment OK');
  } catch (error) {
    if (error instanceof EnvError) {
      logger.error({ issues: error.issues }, 'invalid server environment');
    } else {
      throw error;
    }
  }
}

/**
 * Uncaught errors in route handlers, server components and server actions.
 * Errors that code catches itself are recorded through console.error / logger.error.
 */
export const onRequestErrorNode: Instrumentation.onRequestError = async (error, request, context) => {
  const { captureException } = await import('@/lib/errorTracking/server');
  const header = (name: string) => {
    const value = request.headers[name];
    return Array.isArray(value) ? value[0] : value;
  };
  await captureException(error, {
    source: 'server',
    url: request.path,
    method: request.method,
    route: context.routePath,
    requestId: header('x-request-id'),
    userAgent: header('user-agent'),
    context: { routeType: context.routeType, renderSource: context.renderSource },
  });
};
