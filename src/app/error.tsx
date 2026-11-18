'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { reportThrown } from '@/lib/errorTracking/client';
import { Button } from '@/components/ui/button';

/** Error boundary for every route below the root layout. */
export default function RouteError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    reportThrown(error, { context: { kind: 'error-boundary' } });
  }, [error]);

  return (
    <main className="flex min-h-[60vh] items-center justify-center px-4">
      <div className="max-w-md text-center">
        <h1 className="text-2xl font-semibold">Something went wrong</h1>
        <p className="mt-2 text-muted-foreground">
          We have been told about the problem. Please try again. If it keeps happening, contact support
          {error.digest ? <> and mention code <code className="rounded bg-muted px-1">{error.digest}</code></> : null}.
        </p>
        <div className="mt-6 flex justify-center gap-3">
          <Button onClick={reset}>Try again</Button>
          <Button asChild variant="outline"><Link href="/">Go home</Link></Button>
        </div>
      </div>
    </main>
  );
}
