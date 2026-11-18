'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Loader2, MailCheck } from 'lucide-react';
import { AuthShell } from '@/components/auth/AuthShell';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/auth/forgot-password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: email.trim() }) });
      const data = await res.json().catch(() => ({}));
      if (data.success) setSent(true);
      else setError(data.error || 'We couldn’t send the email. Please try again.');
    } catch {
      setError('We couldn’t reach the server. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  };

  if (sent) {
    return (
      <AuthShell title="Check your email" description={<>If an account exists for <b className="text-foreground">{email.trim()}</b>, we’ve sent a link to reset the password. It expires in 1 hour.</>} footer={<Link href="/auth/signin" className="hover:text-foreground">Back to sign in</Link>}>
        <div className="flex flex-col items-center gap-3 py-2 text-center text-sm text-muted-foreground">
          <MailCheck className="size-10 text-primary" aria-hidden />
          <p>Nothing in your inbox? Check spam, or try again with the address you signed up with.</p>
          <Button variant="outline" onClick={() => setSent(false)}>Use a different email</Button>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Forgot your password?" description="Enter your email and we’ll send you a link to choose a new one." footer={<Link href="/auth/signin" className="hover:text-foreground">Back to sign in</Link>}>
      <form className="space-y-4" onSubmit={submit}>
        {error ? <Alert variant="destructive" role="alert"><AlertDescription>{error}</AlertDescription></Alert> : null}
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input id="email" type="email" autoComplete="email" inputMode="email" className="h-11" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
        </div>
        <Button type="submit" className="h-11 w-full" disabled={busy || !email.trim()}>
          {busy ? <Loader2 className="animate-spin" /> : null}Send reset link
        </Button>
      </form>
    </AuthShell>
  );
}
