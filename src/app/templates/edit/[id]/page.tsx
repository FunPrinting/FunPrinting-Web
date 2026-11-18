'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import toast from 'react-hot-toast';
import { ArrowLeft, Download, Loader2, Upload } from 'lucide-react';
import { TEMPLATE_CATEGORIES } from '@/lib/templates';
import { downloadFile, safeFileName } from '@/lib/templates/download';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';

interface Template {
  id: string;
  name: string;
  description: string;
  category: string;
  placeholders: string[];
  wordUrl?: string;
  isPublic: boolean;
  isPaid: boolean;
  price?: number;
  allowFreeDownload?: boolean;
  updatedAt: string;
}

export default function EditTemplatePage() {
  const router = useRouter();
  const { id } = useParams<{ id: string }>();
  const { status } = useSession();
  const picker = useRef<HTMLInputElement>(null);
  const [template, setTemplate] = useState<Template | null>(null);
  const [loadError, setLoadError] = useState('');
  const [saving, setSaving] = useState(false);
  const [replacing, setReplacing] = useState(false);
  const [hasPayout, setHasPayout] = useState<boolean | null>(null);
  const [commission, setCommission] = useState(20);
  const [form, setForm] = useState({ name: '', description: '', category: 'other', isPublic: false, isPaid: false, price: '', allowFreeDownload: true });

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/templates/${id}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.template) throw new Error(data.error || 'We couldn’t load this template.');
      const t: Template = data.template;
      setTemplate(t);
      setForm({ name: t.name, description: t.description ?? '', category: t.category || 'other', isPublic: t.isPublic, isPaid: t.isPaid, price: t.price ? String(t.price) : '', allowFreeDownload: t.allowFreeDownload !== false });
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'We couldn’t load this template.');
    }
  }, [id]);

  useEffect(() => {
    if (status === 'unauthenticated') router.push(`/auth/signin?callbackUrl=/templates/edit/${id}`);
    if (status !== 'authenticated') return;
    load();
    fetch('/api/user/payout-settings').then((r) => r.json()).then((d) => setHasPayout(Boolean(d.payoutSettings?.upiId || d.payoutSettings?.bankDetails?.accountNumber))).catch(() => setHasPayout(false));
    fetch('/api/pricing').then((r) => r.json()).then((d) => typeof d.pricing?.templateCommissionPercent === 'number' && setCommission(d.pricing.templateCommissionPercent)).catch(() => undefined);
  }, [status, id, router, load]);

  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));

  if (loadError) {
    return (
      <div className="mx-auto max-w-xl px-4 py-16">
        <Alert variant="destructive"><AlertTitle>Can’t open this template</AlertTitle><AlertDescription>{loadError}</AlertDescription></Alert>
        <Button asChild className="mt-4"><Link href="/my-templates">Back to My templates</Link></Button>
      </div>
    );
  }
  if (!template) {
    return <div className="grid min-h-[60vh] place-items-center"><Loader2 className="size-6 animate-spin text-muted-foreground" aria-label="Loading" /></div>;
  }

  const price = Number(form.price) || 0;
  const earns = Math.floor((price * (100 - commission)) / 100 * 100) / 100;
  const becomingPaid = form.isPaid && !template.isPaid;
  const problem = !form.name.trim() ? 'Give the template a name.' : form.isPaid && (price <= 0 || price > 10000) ? 'Enter a price from ₹1 to ₹10,000, or turn off “Charge for it”.' : becomingPaid && !hasPayout ? 'Add your payout details before charging for a template.' : '';

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (problem) return toast.error(problem);
    setSaving(true);
    try {
      const res = await fetch(`/api/templates/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: form.name, description: form.description, category: form.category, isPublic: form.isPublic, isPaid: form.isPaid, price: form.isPaid ? price : 0, allowFreeDownload: form.allowFreeDownload }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(data.error || 'We couldn’t save your changes.');
      toast.success('Changes saved');
      router.push('/my-templates');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'We couldn’t save your changes.');
    } finally {
      setSaving(false);
    }
  };

  const replaceFile = async (file: File | undefined) => {
    if (!file) return;
    if (!/\.docx$/i.test(file.name)) return toast.error('Choose a Word document (.docx).');
    if (file.size > 20 * 1024 * 1024) return toast.error('The file is too large. The limit is 20 MB.');
    setReplacing(true);
    try {
      const body = new FormData();
      body.append('file', file);
      const res = await fetch(`/api/templates/${id}/update-file`, { method: 'POST', body });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(data.error || 'We couldn’t replace the file.');
      toast.success(`File replaced. ${data.placeholders?.length ?? 0} fields found.`);
      setTemplate((t) => (t ? { ...t, wordUrl: data.wordUrl ?? t.wordUrl, placeholders: data.placeholders ?? t.placeholders } : t));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'We couldn’t replace the file.');
    } finally {
      setReplacing(false);
      if (picker.current) picker.current.value = '';
    }
  };

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <Button asChild variant="ghost" size="sm" className="-ml-2 mb-4"><Link href="/my-templates"><ArrowLeft />My templates</Link></Button>
      <h1 className="text-3xl font-semibold">Edit template</h1>

      <form onSubmit={save} className="mt-6 flex flex-col gap-6">
        <Card>
          <CardHeader><CardTitle>About the template</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2"><Label htmlFor="e-name">Name</Label><Input id="e-name" maxLength={100} value={form.name} onChange={(e) => set('name', e.target.value)} required /></div>
            <div className="space-y-2"><Label htmlFor="e-desc">Description</Label><Textarea id="e-desc" rows={3} maxLength={500} value={form.description} onChange={(e) => set('description', e.target.value)} /></div>
            <div className="space-y-2">
              <Label htmlFor="e-cat">Category</Label>
              <Select value={form.category} onValueChange={(v) => set('category', v)}>
                <SelectTrigger id="e-cat" className="w-full sm:w-64"><SelectValue /></SelectTrigger>
                <SelectContent>{TEMPLATE_CATEGORIES.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Sharing and price</CardTitle></CardHeader>
          <CardContent className="space-y-5">
            <div className="flex items-start justify-between gap-4">
              <div><Label htmlFor="e-public">Show it to everyone</Label><p className="text-sm text-muted-foreground">{form.isPublic ? 'Anyone can find and use this template.' : 'Only you can use it.'}</p></div>
              <Switch id="e-public" checked={form.isPublic} onCheckedChange={(v) => set('isPublic', v)} />
            </div>
            <div className="flex items-start justify-between gap-4">
              <div>
                <Label htmlFor="e-paid">Charge for it</Label>
                <p className="text-sm text-muted-foreground">
                  {hasPayout === false && !template.isPaid ? <>You need payout details first. <Link href="/payout-settings" className="text-primary hover:underline">Set them up</Link>.</> : 'People pay once, then fill in the form.'}
                </p>
              </div>
              <Switch id="e-paid" checked={form.isPaid} onCheckedChange={(v) => set('isPaid', v)} disabled={hasPayout === false && !template.isPaid} />
            </div>
            {form.isPaid ? (
              <div className="space-y-2">
                <Label htmlFor="e-price">Price (₹)</Label>
                <Input id="e-price" type="number" inputMode="numeric" min={1} max={10000} step={1} className="w-40" value={form.price} onChange={(e) => set('price', e.target.value)} />
                {price > 0 ? <p className="text-sm text-muted-foreground">You receive about ₹{earns.toLocaleString('en-IN')} per purchase ({100 - commission}% after our {commission}% commission). Buyers also pay a 3% processing fee on top.</p> : null}
              </div>
            ) : null}
            <div className="flex items-start justify-between gap-4">
              <div><Label htmlFor="e-dl">Let people download the document</Label><p className="text-sm text-muted-foreground">Turn off to offer printing through Fun Printing only.</p></div>
              <Switch id="e-dl" checked={form.allowFreeDownload} onCheckedChange={(v) => set('allowFreeDownload', v)} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Word file</CardTitle>
            <CardDescription>Replacing the file takes effect straight away and re-reads the fields. The other changes on this page are saved with the button below.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <p className="mb-2 text-sm font-medium">Fields ({template.placeholders.length})</p>
              {template.placeholders.length ? (
                <ul className="flex flex-wrap gap-2" aria-label="Fields">{template.placeholders.map((p) => <li key={p}><Badge variant="secondary" className="font-normal">{p}</Badge></li>)}</ul>
              ) : (
                <p className="text-sm text-muted-foreground">No fields found.</p>
              )}
            </div>
            <input ref={picker} type="file" accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" className="sr-only" tabIndex={-1} aria-hidden onChange={(e) => replaceFile(e.target.files?.[0])} />
          </CardContent>
          <CardFooter className="flex-wrap gap-2">
            {template.wordUrl ? <Button type="button" variant="outline" onClick={() => downloadFile(template.wordUrl!, `${safeFileName(template.name)}.docx`)}><Download />Download current file</Button> : null}
            <Button type="button" variant="outline" onClick={() => picker.current?.click()} disabled={replacing}>{replacing ? <Loader2 className="animate-spin" /> : <Upload />}Replace file</Button>
          </CardFooter>
        </Card>

        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" size="lg" disabled={saving || Boolean(problem)}>{saving ? <Loader2 className="animate-spin" /> : null}Save changes</Button>
          <Button asChild type="button" variant="ghost" size="lg"><Link href="/my-templates">Cancel</Link></Button>
          {problem ? <p className="text-sm text-muted-foreground">{problem}</p> : null}
        </div>
      </form>
    </div>
  );
}
