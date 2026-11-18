'use client';

import Link from 'next/link';
import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { CheckCircle2, CircleAlert, Loader2 } from 'lucide-react';
import { AuthShell, BackHome } from '@/components/auth/AuthShell';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

type State = { kind: 'checking' } | { kind: 'done'; already: boolean } | { kind: 'failed'; message: string };

function VerifyEmail() {
  const token = useSearchParams().get('token');
  const [state, setState] = useState<State>(token ? { kind: 'checking' } : { kind: 'failed', message: 'This link has no verification code. Open the link from the email we sent.' });
  const [email, setEmail] = useState('');
  const [resend, setResend] = useState<{ busy: boolean; note?: string; ok?: boolean }>({ busy: false });

  useEffect(() => {
    if (!token) return;
    fetch('/api/auth/verify-email', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }) })
      .then((r) => r.json())
      .then((data) => setState(data.success ? { kind: 'done', already: Boolean(data.alreadyVerified) } : { kind: 'failed', message: data.error || 'The link is invalid or has expired.' }))
      .catch(() => setState({ kind: 'failed', message: 'We couldn’t reach the server. Please try again.' }));
  }, [token]);

  const resendLink = async (e: React.FormEvent) => {
    e.preventDefault();
    setResend({ busy: true });
    try {
      const res = await fetch('/api/auth/resend-verification', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: email.trim() }) });
      const data = await res.json().catch(() => ({}));
      setResend({ busy: false, ok: Boolean(data.success), note: data.success ? 'A new link is on its way. Check your inbox.' : data.error || 'We couldn’t send the email.' });
    } catch {
      setResend({ busy: false, ok: false, note: 'We couldn’t reach the server. Please try again.' });
    }
  };

  if (state.kind === 'checking') {
    return (
      <AuthShell title="Verifying your email…">
        <div className="flex justify-center py-4" role="status"><Loader2 className="size-8 animate-spin text-primary" aria-label="Verifying" /></div>
      </AuthShell>
    );
  }

  if (state.kind === 'done') {
    return (
      <AuthShell title={state.already ? 'Already verified' : 'Email verified'} description={state.already ? 'Your email was verified before.' : 'Thanks. Your account is ready.'} footer={<BackHome />}>
        <div className="flex flex-col items-center gap-4">
          <CheckCircle2 className="size-12 text-success" aria-hidden />
          <Button asChild className="h-11 w-full"><Link href="/auth/signin">Sign in</Link></Button>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="We couldn’t verify your email" description={state.message} footer={<BackHome />}>
      <div className="flex justify-center"><CircleAlert className="size-10 text-destructive" aria-hidden /></div>
      <form className="space-y-3" onSubmit={resendLink}>
        <div className="space-y-2">
          <Label htmlFor="email">Send a new link to</Label>
          <Input id="email" type="email" autoComplete="email" className="h-11" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
        </div>
        {resend.note ? <Alert variant={resend.ok ? 'default' : 'destructive'} role="status"><AlertDescription>{resend.note}</AlertDescription></Alert> : null}
        <Button type="submit" className="h-11 w-full" disabled={resend.busy || !email.trim()}>
          {resend.busy ? <Loader2 className="animate-spin" /> : null}Send a new link
        </Button>
      </form>
    </AuthShell>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={<div className="grid min-h-[60vh] place-items-center"><Loader2 className="size-6 animate-spin text-muted-foreground" aria-label="Loading" /></div>}>
      <VerifyEmail />
    </Suspense>
  );
}
