'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { AuthShell } from '@/components/auth/AuthShell';
import { PhoneNotice } from '@/components/PhoneNotice';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/** Shown after sign-in when the account has no mobile number yet (for example, new Google accounts). */
export default function CompleteProfilePage() {
  const router = useRouter();
  const { user, isAuthenticated, isLoading } = useAuth();
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isLoading && !isAuthenticated) router.push('/auth/signin');
  }, [isLoading, isAuthenticated, router]);

  if (!isAuthenticated) {
    return <div className="grid min-h-[60vh] place-items-center"><Loader2 className="size-6 animate-spin text-muted-foreground" aria-label="Loading" /></div>;
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/user/update-phone', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) return setError(data.error || 'We couldn’t save your number. Please try again.');
      router.push('/order');
    } catch {
      setError('We couldn’t reach the server. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell title={`Welcome${user?.name ? `, ${user.name.split(' ')[0]}` : ''}`} description="One last thing before you order: your mobile number.">
      <form className="space-y-4" onSubmit={submit}>
        {error ? <Alert variant="destructive" role="alert"><AlertDescription>{error}</AlertDescription></Alert> : null}
        <div className="space-y-2">
          <Label htmlFor="phone">Mobile number</Label>
          <Input id="phone" type="tel" inputMode="tel" autoComplete="tel" autoFocus required className="h-11" placeholder="98765 43210" value={phone} onChange={(e) => setPhone(e.target.value)} aria-describedby="phone-note" />
          <PhoneNotice id="phone-note" />
        </div>
        <Button type="submit" className="h-11 w-full" disabled={busy || !phone.trim()}>
          {busy ? <Loader2 className="animate-spin" /> : null}Continue
        </Button>
      </form>
    </AuthShell>
  );
}
