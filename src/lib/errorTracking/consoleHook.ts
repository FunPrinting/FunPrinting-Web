import 'server-only';
import { captureInBackground, describeThrown, isCapturing } from '@/lib/errorTracking/server';

/**
 * Sends server-side console.error / console.warn calls to error tracking, without
 * changing what is printed. Existing code reports problems through ~575
 * console.error calls; this captures them without editing each call site.
 *
 * Installed once from instrumentation.ts (Node.js runtime only).
 */
const INSTALLED = Symbol.for('funprinting.errorTracking.consoleHook');

// Framework noise that is not an application bug
const IGNORE = [
  /ExperimentalWarning/,
  /punycode/,
  /DeprecationWarning/,
  /^\[error-tracking\]/,
  /Fast Refresh/,
  /--localstorage-file/, // Node 25 dev-only notice
];

// process.emitWarning output, e.g. "(node:123) [MONGOOSE] Warning: Duplicate schema index"
const NODE_WARNING = /^\(node:\d+\) (\[[\w-]+\] )?(\w+)?Warning:/;

export function formatConsoleArgs(args: unknown[]): { message: string; name?: string; stack?: string; digest?: string } {
  const thrown = args.find((a) => a instanceof Error) as Error | undefined;
  const parts = args.map((a) => {
    if (typeof a === 'string') return a;
    if (a instanceof Error) return a.message;
    try {
      return JSON.stringify(a);
    } catch {
      return String(a);
    }
  });
  const message = parts.join(' ').trim();
  if (!thrown) return { message };
  const d = describeThrown(thrown);
  return { message, name: d.name, stack: d.stack, digest: d.digest };
}

export function installConsoleHook(): void {
  const g = globalThis as unknown as Record<symbol, boolean>;
  if (g[INSTALLED]) return;
  g[INSTALLED] = true;

  for (const level of ['error', 'warn'] as const) {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      original(...args);
      if (isCapturing()) return;
      try {
        const { message, name, stack, digest } = formatConsoleArgs(args);
        if (!message || IGNORE.some((re) => re.test(message))) return;
        const isNodeWarning = NODE_WARNING.test(message);
        const asError = level === 'error' && !isNodeWarning;
        captureInBackground({
          source: 'server',
          level: asError ? 'error' : 'warning',
          name: name ?? (isNodeWarning ? 'NodeWarning' : asError ? 'ConsoleError' : 'ConsoleWarning'),
          message,
          stack: stack ?? new Error().stack?.split('\n').slice(2).join('\n'),
          digest,
        });
      } catch {
        // never let tracking break logging
      }
    };
  }
}
