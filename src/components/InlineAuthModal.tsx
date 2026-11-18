'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { signIn, useSession } from 'next-auth/react';
import { Loader2 } from 'lucide-react';
import { GoogleButton, OrDivider } from '@/components/auth/AuthShell';
import { PHONE_NOTICE } from '@/components/PhoneNotice';
import { normalisePhoneInput } from '@/lib/phoneValidation';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

type Mode = 'signin' | 'signup';

interface InlineAuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAuthSuccess: () => void;
  initialMode?: Mode;
  /** Runs before the Google redirect, so the page can save what the user entered. */
  onBeforeGoogleSignIn?: () => Promise<void> | void;
}

const EMPTY = { name: '', email: '', phone: '', password: '', confirm: '' };

/**
 * Sign in or sign up without leaving the page (order page, template form).
 * Email sign-in updates the session in place, so uploaded files and form data stay.
 */
export default function InlineAuthModal({ isOpen, onClose, onAuthSuccess, initialMode = 'signin', onBeforeGoogleSignIn }: InlineAuthModalProps) {
  const { status, update } = useSession();
  const [mode, setMode] = useState<Mode>(initialMode);
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState<'email' | 'google' | 'resend' | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [unverified, setUnverified] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setMode(initialMode);
    setForm(EMPTY);
    setError('');
    setNotice('');
    setUnverified(false);
  }, [isOpen, initialMode]);

  // Signed in some other way (another tab, Google return): close
  useEffect(() => {
    if (isOpen && status === 'authenticated') {
      onAuthSuccess();
      onClose();
    }
  }, [isOpen, status, onAuthSuccess, onClose]);

  const set = (k: keyof typeof EMPTY) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const switchTo = (m: Mode) => {
    setMode(m);
    setError('');
    setNotice('');
  };

  const signInWithEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy('email');
    setError('');
    setNotice('');
    try {
      const result = await signIn('credentials', { email: form.email, password: form.password, redirect: false });
      if (result?.error) {
        const notVerified = result.error === 'EMAIL_NOT_VERIFIED';
        setUnverified(notVerified);
        setError(notVerified ? 'Please verify your email first. Check your inbox for the link.' : 'The email or password is not right.');
        return;
      }
      // Refresh the session without reloading, so the page keeps its state
      await update();
      onAuthSuccess();
      onClose();
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setBusy(null);
    }
  };

  const signUp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setNotice('');
    if (form.password.length < 6) return setError('Use a password of at least 6 characters.');
    if (form.password !== form.confirm) return setError('The two passwords don’t match.');
    const phone = normalisePhoneInput(form.phone);
    if (!phone.ok) return setError(phone.error);
    setBusy('email');
    try {
      const res = await fetch('/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: form.name.trim(), email: form.email.trim(), password: form.password, phone: phone.phone }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(data.error || 'We couldn’t create your account.');
      if (!data.emailSent) throw new Error('Your account was created, but we couldn’t send the verification email. Please contact support.');
      setMode('signin');
      setForm((f) => ({ ...EMPTY, email: f.email }));
      setUnverified(true);
      setNotice('Account created. Open the link we emailed you, then sign in here.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'We couldn’t create your account.');
    } finally {
      setBusy(null);
    }
  };

  const google = async () => {
    setBusy('google');
    setError('');
    try {
      await onBeforeGoogleSignIn?.();
      await signIn('google', { callbackUrl: window.location.pathname + window.location.search });
    } catch {
      setError('We couldn’t start Google sign-in.');
      setBusy(null);
    }
  };

  const resend = async () => {
    if (!form.email.trim()) return setError('Enter your email address first.');
    setBusy('resend');
    setError('');
    try {
      const res = await fetch('/api/auth/resend-verification', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: form.email.trim() }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(data.error || 'We couldn’t send the email.');
      setNotice('We sent a new verification link. Check your inbox and spam folder.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'We couldn’t send the email.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{mode === 'signin' ? 'Sign in to continue' : 'Create your account'}</DialogTitle>
          <DialogDescription>What you have entered on this page stays where it is.</DialogDescription>
        </DialogHeader>

        <Tabs value={mode} onValueChange={(v) => switchTo(v as Mode)}>
          <TabsList className="w-full">
            <TabsTrigger value="signin" className="flex-1">Sign in</TabsTrigger>
            <TabsTrigger value="signup" className="flex-1">Sign up</TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="flex flex-col gap-4">
          {notice ? <Alert><AlertDescription>{notice}</AlertDescription></Alert> : null}
          {error ? <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert> : null}

          <GoogleButton onClick={google} disabled={busy !== null} />
          <OrDivider />

          {mode === 'signin' ? (
            <form onSubmit={signInWithEmail} className="flex flex-col gap-4">
              <div className="space-y-1.5"><Label htmlFor="ia-email">Email</Label><Input id="ia-email" type="email" autoComplete="email" required value={form.email} onChange={set('email')} /></div>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label htmlFor="ia-password">Password</Label>
                  <Link href="/auth/forgot-password" className="text-xs text-primary hover:underline">Forgot password?</Link>
                </div>
                <Input id="ia-password" type="password" autoComplete="current-password" required value={form.password} onChange={set('password')} />
              </div>
              <Button type="submit" className="h-10" disabled={busy !== null}>{busy === 'email' ? <Loader2 className="animate-spin" /> : null}Sign in</Button>
              {unverified ? <Button type="button" variant="outline" onClick={resend} disabled={busy !== null}>{busy === 'resend' ? <Loader2 className="animate-spin" /> : null}Send the verification email again</Button> : null}
            </form>
          ) : (
            <form onSubmit={signUp} className="flex flex-col gap-4">
              <div className="space-y-1.5"><Label htmlFor="ia-name">Full name</Label><Input id="ia-name" autoComplete="name" required value={form.name} onChange={set('name')} /></div>
              <div className="space-y-1.5"><Label htmlFor="ia-email-up">Email</Label><Input id="ia-email-up" type="email" autoComplete="email" required value={form.email} onChange={set('email')} /></div>
              <div className="space-y-1.5">
                <Label htmlFor="ia-phone">Mobile number</Label>
                <Input id="ia-phone" type="tel" inputMode="tel" autoComplete="tel" required placeholder="98765 43210" value={form.phone} onChange={set('phone')} aria-describedby="ia-phone-hint" />
                <p id="ia-phone-hint" className="text-xs text-muted-foreground">{PHONE_NOTICE}</p>
              </div>
              <div className="space-y-1.5"><Label htmlFor="ia-pw">Password</Label><Input id="ia-pw" type="password" autoComplete="new-password" required minLength={6} value={form.password} onChange={set('password')} /><p className="text-xs text-muted-foreground">At least 6 characters.</p></div>
              <div className="space-y-1.5"><Label htmlFor="ia-pw2">Confirm password</Label><Input id="ia-pw2" type="password" autoComplete="new-password" required value={form.confirm} onChange={set('confirm')} /></div>
              <Button type="submit" className="h-10" disabled={busy !== null}>{busy === 'email' ? <Loader2 className="animate-spin" /> : null}Create account</Button>
            </form>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
