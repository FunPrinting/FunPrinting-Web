'use client';

import { useEffect } from 'react';
import { reportThrown } from '@/lib/errorTracking/client';

/** Replaces the root layout when it crashes, so it must render its own <html>/<body>. */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    reportThrown(error, { context: { kind: 'global-error' } });
  }, [error]);

  return (
    <html lang="en">
      <body style={{ fontFamily: 'system-ui, sans-serif', display: 'flex', minHeight: '100vh', alignItems: 'center', justifyContent: 'center', margin: 0 }}>
        <div style={{ maxWidth: 420, textAlign: 'center', padding: 16 }}>
          <h1 style={{ fontSize: 24, marginBottom: 8 }}>Something went wrong</h1>
          <p style={{ color: '#4b5563' }}>
            The problem has been reported. Please try again.
            {error.digest ? ` Reference: ${error.digest}` : ''}
          </p>
          <button
            type="button"
            onClick={reset}
            style={{ marginTop: 16, padding: '8px 16px', borderRadius: 8, border: 0, background: '#4f46e5', color: '#fff', fontWeight: 600, cursor: 'pointer' }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
