'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { reportThrown } from '@/lib/errorTracking/client';

/** Error boundary for every route below the root layout. */
export default function RouteError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    reportThrown(error, { context: { kind: 'error-boundary' } });
  }, [error]);

  return (
    <main className="min-h-[60vh] flex items-center justify-center px-4">
      <div className="max-w-md text-center">
        <h1 className="text-2xl font-bold text-gray-900">Something went wrong</h1>
        <p className="mt-2 text-gray-600">
          The problem has been reported. Please try again; if it keeps happening, contact support
          {error.digest ? (
            <>
              {' '}and mention code <code className="rounded bg-gray-100 px-1">{error.digest}</code>
            </>
          ) : null}
          .
        </p>
        <div className="mt-6 flex justify-center gap-3">
          <button
            type="button"
            onClick={reset}
            className="rounded-lg bg-indigo-600 px-4 py-2 font-semibold text-white hover:bg-indigo-700"
          >
            Try again
          </button>
          <Link href="/" className="rounded-lg border border-gray-300 px-4 py-2 font-semibold text-gray-700 hover:bg-gray-50">
            Go home
          </Link>
        </div>
      </div>
    </main>
  );
}
