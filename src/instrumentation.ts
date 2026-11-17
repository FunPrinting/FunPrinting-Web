import type { Instrumentation } from 'next';

/**
 * Runs once when a Next.js server instance starts.
 *
 * - Validates the server environment and logs every problem in one place, so a bad
 *   deploy is obvious in the first log line instead of surfacing as scattered 500s.
 *   It logs rather than exits: individual features already fail closed on their own.
 * - Installs error tracking for console.error / console.warn (see src/lib/errorTracking).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  // Skip during `next build`, which runs without production secrets
  if (process.env.NEXT_PHASE === 'phase-production-build') return;

  const [{ installConsoleHook }, { getServerEnv, EnvError }, { logger }] = await Promise.all([
    import('@/lib/errorTracking/consoleHook'),
    import('@/lib/env'),
    import('@/lib/logger'),
  ]);
  installConsoleHook();

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
export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
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
