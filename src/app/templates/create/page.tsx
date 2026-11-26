'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import toast from 'react-hot-toast';
import { ArrowLeft, CheckCircle2, Download, FileText, Loader2, Plus, Upload, X } from 'lucide-react';
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

type Step = 'upload' | 'details' | 'done';

function toBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

const FIELD_NAME = /^[\w][\w .-]{0,59}$/;

export default function CreateTemplatePage() {
  const router = useRouter();
  const { status } = useSession();
  const picker = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<Step>('upload');
  const [busy, setBusy] = useState<'upload' | 'save' | 'sample' | null>(null);
  const [fileUrl, setFileUrl] = useState('');
  const [fileName, setFileName] = useState('');
  const [fields, setFields] = useState<string[]>([]);
  const [sample, setSample] = useState<Record<string, string>>({});
  const [newField, setNewField] = useState('');
  const [form, setForm] = useState({ name: '', description: '', category: 'lab-manual', isPublic: false, isPaid: false, price: '', allowFreeDownload: true });
  const [hasPayout, setHasPayout] = useState<boolean | null>(null);
  const [commission, setCommission] = useState(20);
  const [savedId, setSavedId] = useState('');

  useEffect(() => {
    if (status === 'unauthenticated') router.push('/auth/signin?callbackUrl=/templates/create');
  }, [status, router]);

  useEffect(() => {
    if (status !== 'authenticated') return;
    fetch('/api/user/payout-settings')
      .then((r) => r.json())
      .then((d) => setHasPayout(Boolean(d.payoutSettings?.upiId || d.payoutSettings?.bankDetails?.accountNumber)))
      .catch(() => setHasPayout(false));
    fetch('/api/pricing')
      .then((r) => r.json())
      .then((d) => typeof d.pricing?.templateCommissionPercent === 'number' && setCommission(d.pricing.templateCommissionPercent))
      .catch(() => undefined);
  }, [status]);

  if (status !== 'authenticated') {
    return <div className="grid min-h-[60vh] place-items-center"><Loader2 className="size-6 animate-spin text-muted-foreground" aria-label="Loading" /></div>;
  }

  const upload = async (file: File | undefined) => {
    if (!file) return;
    if (!/\.docx$/i.test(file.name)) return toast.error('Choose a Word document (.docx).');
    if (file.size > 20 * 1024 * 1024) return toast.error('The file is too large. The limit is 20 MB.');
    setBusy('upload');
    try {
      let uploadedUrl = '';
      const presignRes = await fetch('/api/upload-presign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileName: file.name, contentType: file.type, fileSize: file.size, purpose: 'template' }),
      });
      const presign = await presignRes.json().catch(() => ({}));
      if (presignRes.ok && presign.supported && presign.uploadUrl && presign.fileUrl) {
        const putRes = await fetch(presign.uploadUrl, {
          method: 'PUT',
          headers: { 'Content-Type': presign.contentType || 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
          body: file,
        });
        if (!putRes.ok) throw new Error(`Direct upload to storage failed (${putRes.status}).`);
        uploadedUrl = presign.fileUrl;
      } else {
        const up = await fetch('/api/upload-raw-file', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fileName: file.name, fileBuffer: await toBase64(file), contentType: file.type }),
        });
        const uploaded = await up.json().catch(() => ({}));
        if (!up.ok || !uploaded.url) throw new Error(uploaded.error || 'The upload failed.');
        uploadedUrl = uploaded.url;
      }

      const ex = await fetch('/api/extract-placeholders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fileUrl: uploadedUrl }) });
      const found = await ex.json().catch(() => ({}));
      if (!ex.ok) throw new Error(found.error || 'We couldn’t read the placeholders in your document.');
      const list: string[] = found.placeholders ?? [];
      setFileUrl(uploadedUrl);
      setFileName(file.name);
      setFields(list);
      setSample(Object.fromEntries(list.map((p) => [p, ''])));
      setForm((f) => ({ ...f, name: f.name || file.name.replace(/\.docx$/i, '').replace(/[_-]+/g, ' ') }));
      setStep('details');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'We couldn’t process that file. Please try again.');
    } finally {
      setBusy(null);
      if (picker.current) picker.current.value = '';
    }
  };

  const removeField = (f: string) => {
    setFields((all) => all.filter((x) => x !== f));
    setSample((s) => Object.fromEntries(Object.entries(s).filter(([k]) => k !== f)));
  };
  const addField = () => {
    const name = newField.trim();
    if (!FIELD_NAME.test(name)) return toast.error('Use letters, numbers, spaces, dots or dashes (up to 60 characters).');
    if (fields.includes(name)) return toast.error('That field is already in the list.');
    setFields((all) => [...all, name]);
    setSample((s) => ({ ...s, [name]: '' }));
    setNewField('');
  };

  const price = Number(form.price) || 0;
  const earns = Math.floor((price * (100 - commission)) / 100 * 100) / 100;
  const problem = !form.name.trim() ? 'Give the template a name.' : !fields.length ? 'Add at least one field people can fill in.' : form.isPaid && price <= 0 ? 'Enter a price above ₹0, or turn off “Paid”.' : form.isPaid && !hasPayout ? 'Add your payout details before selling a template.' : '';

  const trySample = async () => {
    setBusy('sample');
    try {
      const res = await fetch('/api/templates/download-filled', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fileUrl, formData: sample, placeholders: fields }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success || !data.downloadUrl) throw new Error(data.error || 'We couldn’t make the sample.');
      await downloadFile(data.downloadUrl, `${safeFileName(form.name)}-sample.docx`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'We couldn’t make the sample. Please try again.');
    } finally {
      setBusy(null);
    }
  };

  const save = async () => {
    if (problem) return toast.error(problem);
    setBusy('save');
    try {
      const res = await fetch('/api/templates/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          templateName: form.name.trim(),
          description: form.description.trim(),
          category: form.category,
          pdfUrl: fileUrl,
          wordContent: { paragraphs: [], tables: [] },
          placeholders: fields,
          isPublic: form.isPublic,
          isPaid: form.isPaid,
          price,
          allowFreeDownload: form.allowFreeDownload,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(data.error || 'We couldn’t save the template.');
      setSavedId(data.templateId);
      setStep('done');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'We couldn’t save the template. Please try again.');
    } finally {
      setBusy(null);
    }
  };

  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <Button asChild variant="ghost" size="sm" className="-ml-2 mb-4"><Link href="/templates"><ArrowLeft />Templates</Link></Button>
      <h1 className="text-3xl font-semibold">Create a template</h1>
      <p className="mt-2 text-muted-foreground">Turn a Word document into a form others can fill in, and print the result.</p>

      <ol className="mt-6 flex gap-2 text-sm" aria-label="Steps">
        {(['upload', 'details', 'done'] as const).map((s, i) => (
          <li key={s} className={step === s ? 'font-medium' : 'text-muted-foreground'} aria-current={step === s ? 'step' : undefined}>{i + 1}. {s === 'upload' ? 'Upload' : s === 'details' ? 'Details' : 'Done'}{i < 2 ? <span className="ml-2 text-muted-foreground" aria-hidden>›</span> : null}</li>
        ))}
      </ol>

      {step === 'upload' ? (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle>Upload your Word document</CardTitle>
            <CardDescription>Wherever someone should type something, write a placeholder in double curly brackets, for example <code className="rounded bg-muted px-1">{'{{Full Name}}'}</code> or <code className="rounded bg-muted px-1">{'{{Roll Number}}'}</code>. Each placeholder becomes a field in the form.</CardDescription>
          </CardHeader>
          <CardContent>
            <input ref={picker} type="file" accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" className="sr-only" tabIndex={-1} aria-hidden onChange={(e) => upload(e.target.files?.[0])} />
            <div className="flex flex-col items-center gap-3 rounded-xl border-2 border-dashed px-6 py-10 text-center">
              <span className="grid size-12 place-items-center rounded-full bg-accent text-accent-foreground">{busy === 'upload' ? <Loader2 className="size-6 animate-spin" aria-hidden /> : <Upload className="size-6" aria-hidden />}</span>
              <p className="font-medium">{busy === 'upload' ? 'Reading your document…' : 'Choose a .docx file'}</p>
              <p className="text-sm text-muted-foreground">Up to 20 MB. Word 97-2003 (.doc) files are not supported.</p>
              <Button onClick={() => picker.current?.click()} disabled={busy === 'upload'}>Choose file</Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {step === 'details' ? (
        <div className="mt-6 space-y-6">
          <p className="flex items-center gap-2 text-sm text-muted-foreground"><FileText className="size-4" aria-hidden />{fileName}
            <Button variant="link" size="sm" className="h-auto p-0" onClick={() => setStep('upload')}>Use a different file</Button></p>

          <Card>
            <CardHeader><CardTitle>About the template</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2"><Label htmlFor="t-name">Name</Label><Input id="t-name" maxLength={100} value={form.name} onChange={(e) => set('name', e.target.value)} required /></div>
              <div className="space-y-2"><Label htmlFor="t-desc">Description</Label><Textarea id="t-desc" rows={3} maxLength={500} value={form.description} onChange={(e) => set('description', e.target.value)} placeholder="What is it for? Who is it for?" /></div>
              <div className="space-y-2">
                <Label htmlFor="t-cat">Category</Label>
                <Select value={form.category} onValueChange={(v) => set('category', v)}>
                  <SelectTrigger id="t-cat" className="w-full sm:w-64"><SelectValue /></SelectTrigger>
                  <SelectContent>{TEMPLATE_CATEGORIES.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Fields</CardTitle>
              <CardDescription>What people fill in. We found these in your document.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {!fields.length ? (
                <Alert><AlertTitle>No placeholders found</AlertTitle><AlertDescription>Add <code>{'{{Name}}'}</code>-style placeholders in Word and upload again, or add field names below.</AlertDescription></Alert>
              ) : (
                <ul className="flex flex-wrap gap-2" aria-label="Fields">
                  {fields.map((f) => (
                    <li key={f}><Badge variant="secondary" className="gap-1 py-1 pl-2.5 pr-1 text-sm font-normal">{f}<button type="button" onClick={() => removeField(f)} className="grid size-5 place-items-center rounded-full hover:bg-foreground/10" aria-label={`Remove ${f}`}><X className="size-3" /></button></Badge></li>
                  ))}
                </ul>
              )}
              <div className="flex gap-2">
                <Input value={newField} onChange={(e) => setNewField(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addField(); } }} placeholder="Add a field name" aria-label="New field name" className="max-w-xs" />
                <Button type="button" variant="outline" onClick={addField} disabled={!newField.trim()}><Plus />Add</Button>
              </div>
              <p className="text-xs text-muted-foreground">A field is only filled in if the same <code>{'{{name}}'}</code> is in your Word file.</p>
            </CardContent>
          </Card>

          {fields.length ? (
            <Card>
              <CardHeader>
                <CardTitle>Try it</CardTitle>
                <CardDescription>Fill in some sample values and download the result to check the layout.</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4 sm:grid-cols-2">
                {fields.map((f, i) => (
                  <div key={f} className="space-y-2"><Label htmlFor={`s-${i}`}>{f}</Label><Input id={`s-${i}`} value={sample[f] ?? ''} onChange={(e) => setSample((s) => ({ ...s, [f]: e.target.value }))} /></div>
                ))}
              </CardContent>
              <CardFooter><Button variant="outline" onClick={trySample} disabled={busy !== null}>{busy === 'sample' ? <Loader2 className="animate-spin" /> : <Download />}Download a sample</Button></CardFooter>
            </Card>
          ) : null}

          <Card>
            <CardHeader><CardTitle>Sharing and price</CardTitle></CardHeader>
            <CardContent className="space-y-5">
              <div className="flex items-start justify-between gap-4">
                <div><Label htmlFor="t-public">Show it to everyone</Label><p className="text-sm text-muted-foreground">{form.isPublic ? 'Anyone can find and use this template.' : 'Only you can use it for now.'}</p></div>
                <Switch id="t-public" checked={form.isPublic} onCheckedChange={(v) => set('isPublic', v)} />
              </div>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <Label htmlFor="t-paid">Charge for it</Label>
                  <p className="text-sm text-muted-foreground">
                    {hasPayout === false ? <>You need payout details first. <Link href="/payout-settings" className="text-primary hover:underline">Set them up</Link>.</> : 'People pay once, then fill in the form.'}
                  </p>
                </div>
                <Switch id="t-paid" checked={form.isPaid} onCheckedChange={(v) => set('isPaid', v)} disabled={hasPayout === false} />
              </div>
              {form.isPaid ? (
                <div className="space-y-2">
                  <Label htmlFor="t-price">Price (₹)</Label>
                  <Input id="t-price" type="number" inputMode="numeric" min={1} max={10000} step={1} className="w-40" value={form.price} onChange={(e) => set('price', e.target.value)} />
                  {price > 0 ? <p className="text-sm text-muted-foreground">You receive about ₹{earns.toLocaleString('en-IN')} per purchase ({100 - commission}% after our {commission}% commission). Buyers also pay a 3% processing fee on top.</p> : null}
                </div>
              ) : null}
              <div className="flex items-start justify-between gap-4">
                <div><Label htmlFor="t-dl">Let people download the document</Label><p className="text-sm text-muted-foreground">Turn off to offer printing through Fun Printing only.</p></div>
                <Switch id="t-dl" checked={form.allowFreeDownload} onCheckedChange={(v) => set('allowFreeDownload', v)} />
              </div>
            </CardContent>
          </Card>

          <div className="flex flex-wrap items-center gap-3">
            <Button size="lg" onClick={save} disabled={busy !== null || Boolean(problem)}>{busy === 'save' ? <Loader2 className="animate-spin" /> : null}Save template</Button>
            {problem ? <p className="text-sm text-muted-foreground">{problem}</p> : null}
          </div>
        </div>
      ) : null}

      {step === 'done' ? (
        <Card className="mt-6">
          <CardHeader>
            <span className="grid size-10 place-items-center rounded-full bg-success/10 text-success"><CheckCircle2 className="size-5" aria-hidden /></span>
            <CardTitle className="mt-2">Template saved</CardTitle>
            <CardDescription>{form.isPublic ? 'It is now listed for everyone.' : 'Only you can see it. You can make it public from My templates.'}</CardDescription>
          </CardHeader>
          <CardFooter className="flex-wrap gap-2">
            <Button asChild><Link href={`/templates/fill/${savedId}`}>Try it</Link></Button>
            <Button asChild variant="outline"><Link href="/my-templates">My templates</Link></Button>
          </CardFooter>
        </Card>
      ) : null}
    </div>
  );
}
