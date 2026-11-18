'use client';

import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Loader2 } from 'lucide-react';
import { PageHeader } from '@/components/admin/PageHeader';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/** Form values are kept as text so a half-typed number is not rewritten under the cursor. */
interface Form { a4: string; a3: string; color: string; double: string; binding: string; commission: string }

const DEFAULTS: Form = { a4: '5', a3: '10', color: '2', double: '1.5', binding: '20', commission: '20' };
const num = (v: string) => (v.trim() === '' ? NaN : Number(v));

function Field({ id, label, hint, value, onChange, step = '0.01', min = 0, max }: { id: string; label: string; hint?: string; value: string; onChange: (v: string) => void; step?: string; min?: number; max?: number }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} type="number" inputMode="decimal" step={step} min={min} max={max} value={value} onChange={(e) => onChange(e.target.value)} className="max-w-48" />
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

export default function AdminPricingPage() {
  const [form, setForm] = useState<Form | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch('/api/admin/pricing')
      .then((r) => r.json())
      .then((d) => {
        const p = d.pricing;
        if (!p) return setForm(DEFAULTS);
        setForm({ a4: String(p.basePrices?.A4 ?? 5), a3: String(p.basePrices?.A3 ?? 10), color: String(p.multipliers?.color ?? 2), double: String(p.multipliers?.doubleSided ?? 1.5), binding: String(p.additionalServices?.binding ?? 20), commission: String(p.templateCommissionPercent ?? 20) });
      })
      .catch(() => setError('We couldn’t load the current prices.'));
  }, []);

  if (!form) return <div className="grid place-items-center py-20"><Loader2 className="size-6 animate-spin text-muted-foreground" aria-label="Loading" /></div>;
  const set = (k: keyof Form) => (v: string) => setForm((f) => (f ? { ...f, [k]: v } : f));

  const v = { a4: num(form.a4), a3: num(form.a3), color: num(form.color), double: num(form.double), binding: num(form.binding), commission: num(form.commission) };
  const valid = [v.a4, v.a3, v.binding].every((n) => n >= 0) && [v.color, v.double].every((n) => n >= 1) && v.commission >= 0 && v.commission <= 50;
  const example = valid ? Math.round(v.a4 * 10 * v.color * v.double * 100) / 100 : null;

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    setSaving(true);
    setError('');
    try {
      const res = await fetch('/api/admin/pricing', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pricing: { basePrices: { A4: v.a4, A3: v.a3 }, multipliers: { color: v.color, doubleSided: v.double }, additionalServices: { binding: v.binding }, templateCommissionPercent: v.commission } }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(data.error || 'We couldn’t save the prices.');
      toast.success('Prices saved');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'We couldn’t save the prices.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <PageHeader title="Pricing" description="Default prices for the order page. A shop that sets its own prices overrides these for its customers." />
      <form onSubmit={save} className="flex max-w-3xl flex-col gap-6">
        {error ? <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert> : null}

        <Card>
          <CardHeader><CardTitle>Price per page</CardTitle><CardDescription>Black and white, single-sided.</CardDescription></CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <Field id="a4" label="A4 (₹)" value={form.a4} onChange={set('a4')} />
            <Field id="a3" label="A3 (₹)" value={form.a3} onChange={set('a3')} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Multipliers</CardTitle><CardDescription>The page price is multiplied by these.</CardDescription></CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <Field id="color" label="Colour" value={form.color} onChange={set('color')} step="0.1" min={1} hint="2 means colour costs twice as much." />
            <Field id="double" label="Double-sided" value={form.double} onChange={set('double')} step="0.1" min={1} />
            {example !== null ? <p className="text-sm text-muted-foreground sm:col-span-2">Example: 10 pages of A4, colour, double-sided, 1 copy costs ₹{example.toLocaleString('en-IN')}.</p> : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Finishing</CardTitle></CardHeader>
          <CardContent><Field id="binding" label="Binding (₹)" value={form.binding} onChange={set('binding')} /></CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Template sales</CardTitle><CardDescription>What Fun Printing keeps when someone buys a paid template.</CardDescription></CardHeader>
          <CardContent className="space-y-3">
            <Field id="commission" label="Commission (%)" value={form.commission} onChange={set('commission')} step="1" max={50} hint="From 0 to 50." />
            {valid ? <p className="text-sm text-muted-foreground">On a ₹100 template the creator gets ₹{Math.round(100 - v.commission)} and we keep ₹{Math.round(v.commission)}.</p> : null}
          </CardContent>
        </Card>

        <div className="flex items-center gap-3">
          <Button type="submit" size="lg" disabled={saving || !valid}>{saving ? <Loader2 className="animate-spin" /> : null}Save prices</Button>
          {!valid ? <p className="text-sm text-muted-foreground">Check the numbers: prices can’t be negative and multipliers start at 1.</p> : null}
        </div>
      </form>
    </>
  );
}
