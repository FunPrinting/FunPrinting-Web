'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { signIn, useSession } from 'next-auth/react';
import { CircleAlert, Loader2 } from 'lucide-react';
import { isAllowedCallback } from '@/lib/partnerAuth/callbacks';
import { AuthShell } from '@/components/auth/AuthShell';

/** Opened by the Partner apps: signs the shop in on the web, then hands a one-time code back to the app. */
function DesktopAuth() {
  const { status } = useSession();
  const params = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const startedSignInRef = useRef(false);

  useEffect(() => {
    const callback = params.get('callback');
    if (!callback) return setError('The app did not say where to return to. Open the sign-in from the Partner app again.');
    if (!isAllowedCallback(callback)) return setError('This sign-in link is not from a Fun Printing Partner app.');
    const codeChallenge = params.get('code_challenge');
    const state = params.get('state') || '';

    if (status === 'unauthenticated') {
      if (startedSignInRef.current) return;
      startedSignInRef.current = true;
      // Come back here after Google sign-in, keeping every parameter
      signIn('google', { callbackUrl: `/partner/desktop-auth?${params.toString()}` });
      return;
    }
    if (status !== 'authenticated') return;

    const notReady = (code?: string) =>
      code === 'not_a_partner'
        ? 'This account is not a Fun Printing partner yet. Apply on the partner page, then sign in again.'
        : code === 'partner_pending_approval'
          ? 'Your shop is still being reviewed. You can sign in to the app once it is approved.'
          : null;

    if (codeChallenge) {
      // Current apps: one-time code + PKCE, so no token appears in a URL
      fetch('/api/partner/device-auth/code', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ codeChallenge, callback }) })
        .then((r) => r.json())
        .then((data) => {
          const reason = notReady(data.error);
          if (reason) return setError(reason);
          if (!data.success) return setError(data.error || 'Sign-in failed. Please try again.');
          const url = new URL(callback);
          url.searchParams.set('code', data.code);
          if (state) url.searchParams.set('state', state);
          window.location.href = url.toString();
        })
        .catch(() => setError('We couldn’t reach the server. Check your connection and try again.'));
      return;
    }

    // Apps installed before device sign-in send no code challenge and get a token instead.
    // Remove this branch once every shop has updated its app.
    fetch('/api/partner/desktop-token')
      .then((r) => r.json())
      .then((data) => {
        const reason = notReady(data.error);
        if (reason) return setError(reason);
        if (!data.success) return setError(data.error || 'Sign-in failed. Please try again.');
        const url = new URL(callback);
        url.searchParams.append('partnerId', data.partnerId);
        url.searchParams.append('token', data.token);
        window.location.href = url.toString();
      })
      .catch(() => setError('We couldn’t reach the server. Check your connection and try again.'));
  }, [status, params]);

  if (error) {
    return (
      <AuthShell title="We couldn’t sign you in" description={error}>
        <div className="flex flex-col items-center gap-2 text-center text-sm text-muted-foreground">
          <CircleAlert className="size-10 text-destructive" aria-hidden />
          <p>You can close this window and try again from the app.</p>
        </div>
      </AuthShell>
    );
  }
  return (
    <AuthShell title="Signing in to the Partner app…" description="This window returns you to the app automatically.">
      <div className="flex justify-center py-2" role="status"><Loader2 className="size-8 animate-spin text-primary" aria-label="Signing in" /></div>
    </AuthShell>
  );
}

export default function DesktopAuthPage() {
  return (
    <Suspense fallback={<div className="grid min-h-[60vh] place-items-center"><Loader2 className="size-6 animate-spin text-muted-foreground" aria-label="Loading" /></div>}>
      <DesktopAuth />
    </Suspense>
  );
}
