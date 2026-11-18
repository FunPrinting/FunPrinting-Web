'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import toast from 'react-hot-toast';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface Settings {
  upiId: string;
  bankDetails: { accountHolderName: string; accountNumber: string; ifscCode: string; bankName: string };
}
const EMPTY: Settings = { upiId: '', bankDetails: { accountHolderName: '', accountNumber: '', ifscCode: '', bankName: '' } };

export default function PayoutSettingsPage() {
  const router = useRouter();
  const { status } = useSession();
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [settings, setSettings] = useState<Settings>(EMPTY);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [needsPassword, setNeedsPassword] = useState(false);
  const [commission, setCommission] = useState(20);

  useEffect(() => {
    if (status === 'unauthenticated') router.push('/auth/signin?callbackUrl=/payout-settings');
    if (status !== 'authenticated') return;
    fetch('/api/user/payout-settings')
      .then((r) => r.json())
      .then((d) => d.payoutSettings && setSettings(d.payoutSettings))
      .catch(() => toast.error('We couldn’t load your saved details.'))
      .finally(() => setLoaded(true));
    fetch('/api/pricing').then((r) => r.json()).then((d) => typeof d.pricing?.templateCommissionPercent === 'number' && setCommission(d.pricing.templateCommissionPercent)).catch(() => undefined);
  }, [status, router]);

  if (status !== 'authenticated' || !loaded) {
    return <div className="grid min-h-[60vh] place-items-center"><Loader2 className="size-6 animate-spin text-muted-foreground" aria-label="Loading" /></div>;
  }

  const setBank = (k: keyof Settings['bankDetails'], v: string) => setSettings((s) => ({ ...s, bankDetails: { ...s.bankDetails, [k]: v } }));

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      const res = await fetch('/api/user/payout-settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...settings, password }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setNeedsPassword(/No password set/i.test(data.error ?? ''));
        throw new Error(data.error || 'We couldn’t save your details.');
      }
      setNeedsPassword(false);
      setPassword('');
      toast.success('Payout details saved');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'We couldn’t save your details.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl px-4 py-10 sm:px-6">
      <Button asChild variant="ghost" size="sm" className="-ml-2 mb-4"><Link href="/my-templates"><ArrowLeft />My templates</Link></Button>
      <h1 className="text-3xl font-semibold">Payout details</h1>
      <p className="mt-2 text-muted-foreground">Where we send what you earn from paid templates. You get the price minus our {commission}% commission. Earnings are paid out in batches.</p>

      <form onSubmit={save} className="mt-6 flex flex-col gap-6">
        {error ? (
          <Alert variant="destructive">
            <AlertTitle>Not saved</AlertTitle>
            <AlertDescription>{error}{needsPassword ? <> <Link href="/auth/setup-password" className="underline">Set a password</Link>, then try again.</> : null}</AlertDescription>
          </Alert>
        ) : null}

        <Card>
          <CardHeader><CardTitle>UPI</CardTitle><CardDescription>The fastest way to be paid.</CardDescription></CardHeader>
          <CardContent className="space-y-2">
            <Label htmlFor="upi">UPI ID</Label>
            <Input id="upi" autoComplete="off" placeholder="yourname@okaxis" value={settings.upiId} onChange={(e) => setSettings((s) => ({ ...s, upiId: e.target.value }))} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Bank account (optional)</CardTitle><CardDescription>A backup if UPI does not work.</CardDescription></CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2"><Label htmlFor="holder">Account holder</Label><Input id="holder" autoComplete="off" value={settings.bankDetails.accountHolderName} onChange={(e) => setBank('accountHolderName', e.target.value)} /></div>
            <div className="space-y-2"><Label htmlFor="bank">Bank name</Label><Input id="bank" autoComplete="off" value={settings.bankDetails.bankName} onChange={(e) => setBank('bankName', e.target.value)} /></div>
            <div className="space-y-2"><Label htmlFor="acc">Account number</Label><Input id="acc" inputMode="numeric" autoComplete="off" placeholder="9 to 18 digits" value={settings.bankDetails.accountNumber} onChange={(e) => setBank('accountNumber', e.target.value.replace(/\D/g, ''))} /></div>
            <div className="space-y-2"><Label htmlFor="ifsc">IFSC code</Label><Input id="ifsc" autoComplete="off" placeholder="SBIN0001234" value={settings.bankDetails.ifscCode} onChange={(e) => setBank('ifscCode', e.target.value.toUpperCase())} /></div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Confirm it is you</CardTitle><CardDescription>Enter your password to change payout details.</CardDescription></CardHeader>
          <CardContent className="space-y-2">
            <Label htmlFor="pw">Password</Label>
            <Input id="pw" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          </CardContent>
        </Card>

        <div><Button type="submit" size="lg" disabled={saving || !password}>{saving ? <Loader2 className="animate-spin" /> : null}Save payout details</Button></div>
      </form>
    </div>
  );
}
