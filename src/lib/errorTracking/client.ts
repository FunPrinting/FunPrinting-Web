'use client';

/**
 * Browser-side error reporting. Sends uncaught errors, unhandled promise rejections
 * and error-boundary errors to POST /api/errors, which stores them in ErrorGroup.
 *
 * Bounded so a crash loop can't flood the API: duplicates within a page view are
 * dropped and at most MAX_REPORTS_PER_PAGE are sent.
 */
const MAX_REPORTS_PER_PAGE = 10;
const sent = new Set<string>();
let reportCount = 0;

export interface ClientErrorReport {
  level?: 'error' | 'warning';
  name?: string;
  message: string;
  stack?: string;
  digest?: string;
  context?: Record<string, unknown>;
}

function release(): string | undefined {
  return process.env.NEXT_PUBLIC_APP_RELEASE || undefined;
}

export function reportClientError(report: ClientErrorReport): void {
  if (typeof window === 'undefined') return;
  const key = `${report.name}|${report.message}|${report.stack?.split('\n')[1] ?? ''}`;
  if (sent.has(key) || reportCount >= MAX_REPORTS_PER_PAGE) return;
  sent.add(key);
  reportCount += 1;

  const body = JSON.stringify({
    ...report,
    url: window.location.href.split(/[?#]/)[0],
    release: release(),
  });
  try {
    // keepalive lets the report finish even if the page is unloading
    void fetch('/api/errors', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: body.length < 60_000,
      credentials: 'same-origin',
    }).catch(() => undefined);
  } catch {
    // reporting must never throw
  }
}

export function reportThrown(value: unknown, extra: Partial<ClientErrorReport> = {}): void {
  if (value instanceof Error) {
    const digest = (value as Error & { digest?: unknown }).digest;
    reportClientError({
      name: value.name,
      message: value.message || String(value),
      stack: value.stack,
      digest: typeof digest === 'string' ? digest : undefined,
      ...extra,
    });
    return;
  }
  let message: string;
  try {
    message = typeof value === 'string' ? value : JSON.stringify(value) ?? String(value);
  } catch {
    message = String(value);
  }
  reportClientError({ name: 'NonError', message, ...extra });
}

// Errors from browser extensions and cross-origin scripts carry no useful detail
const IGNORED_MESSAGES = [/^Script error\.?$/, /ResizeObserver loop/, /chrome-extension:|moz-extension:|safari-extension:/];

export function shouldIgnore(message: string, filename?: string): boolean {
  return IGNORED_MESSAGES.some((re) => re.test(message) || (filename ? re.test(filename) : false));
}
