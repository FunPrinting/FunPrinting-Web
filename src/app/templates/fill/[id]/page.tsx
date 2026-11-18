'use client';

import Link from 'next/link';
import { use, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { ArrowLeft, CircleAlert, FileText, Loader2, Lock, Pencil } from 'lucide-react';
import { startTemplateCheckout } from '@/lib/payments/client';
import { withProcessingFee } from '@/lib/payments/money';
import { categoryLabel, priceLabel } from '@/lib/templates';
import { readPending, savePending } from '@/lib/templates/pending';
import InlineAuthModal from '@/components/InlineAuthModal';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';

interface Field {
  key: string;
  type: string;
  label: string;
  required: boolean;
  placeholder?: string;
  defaultPlaceholder?: string;
}
interface Template {
  id: string;
  name: string;
  description: string;
  category: string;
  placeholders: string[];
  formSchema: Field[];
  isPaid: boolean;
  price: number;
  allowFreeDownload: boolean;
}

const inputType = (t: string) => (['email', 'tel', 'date', 'number'].includes(t) ? t : 'text');

export default function TemplateFillPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { status } = useSession();
  const signedIn = status === 'authenticated';
  const [template, setTemplate] = useState<Template | null>(null);
  const [problem, setProblem] = useState('');
  const [values, setValues] = useState<Record<string, string>>({});
  const [review, setReview] = useState(false);
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState('');
  const [authOpen, setAuthOpen] = useState(false);

  useEffect(() => {
    fetch(`/api/templates/${encodeURIComponent(id)}`)
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.success) throw new Error(res.status === 403 ? 'This template is private.' : res.status === 404 ? 'We couldn’t find this template.' : data.error || 'We couldn’t load this template.');
        const t = data.template as Template;
        // Older templates only list placeholders
        const fields: Field[] = Array.isArray(t.formSchema) && t.formSchema.length ? t.formSchema : (t.placeholders ?? []).map((key) => ({ key, label: key, type: 'text', required: true }));
        setTemplate({ ...t, formSchema: fields });
        // Answers saved before a Google sign-in redirect come back with the page
        const saved = readPending(id);
        setValues(Object.fromEntries(fields.map((f) => [f.key, (!saved?.paymentRef && saved?.formData?.[f.key]) || ''])));
      })
      .catch((e) => setProblem(e instanceof Error ? e.message : 'We couldn’t load this template.'));
  }, [id]);

  const missing = useMemo(() => (template?.formSchema ?? []).filter((f) => f.required && !values[f.key]?.trim()), [template, values]);
  const paid = Boolean(template?.isPaid && template.price > 0);
  const totals = paid ? withProcessingFee(Math.round(template!.price * 100)) : null;

  if (problem) {
    return (
      <div className="mx-auto max-w-lg px-4 py-16">
        <Card><CardContent className="flex flex-col items-center gap-3 py-12 text-center">
          <CircleAlert className="size-8 text-muted-foreground" aria-hidden />
          <p>{problem}</p>
          <Button asChild variant="outline"><Link href="/templates">Back to templates</Link></Button>
        </CardContent></Card>
      </div>
    );
  }
  if (!template) {
    return <div className="mx-auto max-w-3xl space-y-4 px-4 py-10"><Skeleton className="h-10 w-2/3" /><Skeleton className="h-96 rounded-xl" /></div>;
  }

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (missing.length) return setError(`Please fill in: ${missing.map((f) => f.label).join(', ')}.`);
    setError('');
    if (!signedIn) return setAuthOpen(true);
    if (paid) return setReview(true);
    savePending({ templateId: template.id, formData: values });
    router.push(`/templates/fill/${encodeURIComponent(template.id)}/loading`);
  };

  const pay = async () => {
    setPaying(true);
    setError('');
    try {
      await startTemplateCheckout(template.id, values); // leaves for Razorpay; the payment page continues from there
    } catch (e) {
      setError(e instanceof Error ? e.message : 'We couldn’t start the payment. Please try again.');
      setPaying(false);
    }
  };

  const rupees = (paise: number) => `₹${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: paise % 100 ? 2 : 0 })}`;

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <Button asChild variant="ghost" size="sm" className="-ml-2 mb-4"><Link href="/templates"><ArrowLeft />Templates</Link></Button>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold">{template.name}</h1>
          {template.description ? <p className="mt-2 max-w-2xl text-muted-foreground">{template.description}</p> : null}
        </div>
        <div className="flex gap-1.5"><Badge variant="secondary">{categoryLabel(template.category)}</Badge><Badge variant={paid ? 'default' : 'outline'}>{priceLabel(template)}</Badge></div>
      </div>

      {review ? (
        <Card className="mt-8">
          <CardHeader>
            <CardTitle>Check your details, then pay</CardTitle>
            <CardDescription>Your document is created from exactly this after the payment goes through.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            {error ? <Alert variant="destructive" role="alert"><AlertDescription>{error}</AlertDescription></Alert> : null}
            <dl className="divide-y rounded-lg border">
              {template.formSchema.map((f) => (
                <div key={f.key} className="grid gap-1 px-4 py-2.5 text-sm sm:grid-cols-3">
                  <dt className="text-muted-foreground">{f.label}</dt>
                  <dd className="whitespace-pre-wrap break-words sm:col-span-2">{values[f.key] || <span className="text-muted-foreground">—</span>}</dd>
                </div>
              ))}
            </dl>
            <Separator />
            <dl className="space-y-1.5 text-sm">
              <div className="flex justify-between"><dt className="text-muted-foreground">Template</dt><dd className="tabular-nums">{rupees(totals!.subtotal)}</dd></div>
              <div className="flex justify-between"><dt className="text-muted-foreground">Processing fee (3%)</dt><dd className="tabular-nums">{rupees(totals!.fee)}</dd></div>
              <div className="flex items-baseline justify-between pt-1"><dt className="font-medium">Total</dt><dd className="text-xl font-semibold tabular-nums">{rupees(totals!.total)}</dd></div>
            </dl>
            <p className="text-xs text-muted-foreground">One payment includes up to 5 document creations, in case you need to try again. Payments are processed by Razorpay.</p>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => setReview(false)} disabled={paying}><Pencil />Edit details</Button>
              <Button size="lg" onClick={pay} disabled={paying}>{paying ? <Loader2 className="animate-spin" /> : <Lock />}Pay {rupees(totals!.total)}</Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <form onSubmit={submit} noValidate className="mt-8">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><FileText className="size-5 text-muted-foreground" aria-hidden />Your details</CardTitle>
              <CardDescription>They are filled into the document. Fields marked * are required.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              {error ? <Alert variant="destructive" role="alert"><AlertDescription>{error}</AlertDescription></Alert> : null}
              {template.formSchema.map((f) => {
                const hint = f.placeholder || f.defaultPlaceholder || '';
                const common = { id: `f-${f.key}`, name: f.key, value: values[f.key] ?? '', placeholder: hint, onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setValues((v) => ({ ...v, [f.key]: e.target.value })), 'aria-required': f.required } as const;
                return (
                  <div key={f.key} className="space-y-2">
                    <Label htmlFor={common.id}>{f.label}{f.required ? <span aria-hidden> *</span> : <span className="font-normal text-muted-foreground"> (optional)</span>}</Label>
                    {f.type === 'textarea' ? <Textarea {...common} rows={4} /> : <Input {...common} type={inputType(f.type)} />}
                  </div>
                );
              })}
            </CardContent>
          </Card>
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <Button type="submit" size="lg">{!signedIn ? 'Sign in to continue' : paid ? 'Review and pay' : 'Create my document'}</Button>
            {!signedIn ? <p className="text-sm text-muted-foreground">You need an account to create documents. Your answers are kept while you sign in.</p> : null}
          </div>
        </form>
      )}

      <InlineAuthModal
        isOpen={authOpen}
        onClose={() => setAuthOpen(false)}
        onAuthSuccess={() => setAuthOpen(false)}
        initialMode="signin"
        onBeforeGoogleSignIn={() => savePending({ templateId: template.id, formData: values })}
      />
    </div>
  );
}
