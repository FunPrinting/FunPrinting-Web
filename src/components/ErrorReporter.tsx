'use client';

import { useEffect } from 'react';
import { reportThrown, shouldIgnore } from '@/lib/errorTracking/client';

/** Reports uncaught browser errors and unhandled promise rejections. Renders nothing. */
export default function ErrorReporter() {
  useEffect(() => {
    const onError = (event: ErrorEvent) => {
      const message = event.message || event.error?.message || '';
      if (shouldIgnore(message, event.filename)) return;
      reportThrown(event.error ?? message, { context: { kind: 'window.onerror' } });
    };
    const onRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason;
      const message = reason instanceof Error ? reason.message : String(reason ?? '');
      if (shouldIgnore(message)) return;
      reportThrown(reason, { context: { kind: 'unhandledrejection' } });
    };
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
    };
  }, []);
  return null;
}
