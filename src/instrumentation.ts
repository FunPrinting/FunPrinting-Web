/**
 * Runs once when a Next.js server instance starts.
 *
 * Validates the server environment and logs every problem in one place, so a bad
 * deploy is obvious in the first log line instead of surfacing as scattered 500s.
 * It logs rather than exits: individual features already fail closed on their own.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  // Skip during `next build`, which runs without production secrets
  if (process.env.NEXT_PHASE === 'phase-production-build') return;

  const [{ getServerEnv, EnvError }, { logger }] = await Promise.all([
    import('@/lib/env'),
    import('@/lib/logger'),
  ]);
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
