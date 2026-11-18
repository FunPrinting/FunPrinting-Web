'use client';

import Link from 'next/link';
import { Suspense, use, useCallback, useEffect, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { CheckCircle2, CircleAlert, Download, FileText, Loader2, Printer, RotateCcw } from 'lucide-react';
import { clearPending, handToOrderPage, readPending } from '@/lib/templates/pending';
import { downloadFile, safeFileName } from '@/lib/templates/download';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';

type State =
  | { kind: 'working'; progress: number; step: string }
  | { kind: 'done'; pdfUrl?: string; wordUrl?: string; note?: string }
  | { kind: 'sign-in' }
  | { kind: 'missing' }
  | { kind: 'error'; message: string };

const POLL_MS = 1500;
const GIVE_UP_MS = 4 * 60_000;

/**
 * Creates the document and shows it. Reached after filling a free template or after
 * paying for a paid one. Refreshing is safe: once a job exists its id is in the address.
 */
function Result({ id }: { id: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const [state, setState] = useState<State>({ kind: 'working', progress: 5, step: 'Filling in your details' });
  const [meta, setMeta] = useState<{ name: string; allowDownload: boolean }>({ name: 'Document', allowDownload: true });
  const [saving, setSaving] = useState<'pdf' | 'word' | null>(null);
  const runId = useRef(0);
  // One generate request per visit: a second start (React re-running effects) waits for the same one
  const generation = useRef<Promise<{ status: number; ok: boolean; data: any }> | null>(null);

  useEffect(() => {
    fetch(`/api/templates/${encodeURIComponent(id)}`)
      .then((r) => r.json())
      .then((d) => d.success && setMeta({ name: d.template.name, allowDownload: d.template.allowFreeDownload !== false }))
      .catch(() => undefined);
  }, [id]);

  const poll = useCallback(async (jobId: string, run: number, firstWordUrl?: string) => {
    const started = Date.now();
    let wordUrl = firstWordUrl;
    while (run === runId.current) {
      const res = await fetch(`/api/templates/generation-status/${encodeURIComponent(jobId)}`, { cache: 'no-store' }).catch(() => null);
      if (run !== runId.current) return;
      const data = res ? await res.json().catch(() => null) : null;
      if (res?.status === 400) return setState({ kind: 'error', message: 'This link is not valid. Create the document again.' });
      if (res?.status === 401 || res?.status === 404) {
        return setState(data?.error?.includes('expired') ? { kind: 'error', message: 'This document has expired. Create it again.' } : { kind: 'sign-in' });
      }
      if (data?.wordUrl) wordUrl = data.wordUrl;
      if (data?.status === 'completed' && data.pdfUrl) {
        clearPending();
        return setState({ kind: 'done', pdfUrl: data.pdfUrl, wordUrl });
      }
      // The saved details are kept unless a document exists, so Retry still has them
      if (data?.status === 'failed') {
        if (!wordUrl) return setState({ kind: 'error', message: data?.error || 'We couldn’t create the document.' });
        clearPending();
        return setState({ kind: 'done', wordUrl, note: data.error || 'We couldn’t make a PDF, but your Word document is ready.' });
      }
      if (Date.now() - started > GIVE_UP_MS) {
        if (!wordUrl) return setState({ kind: 'error', message: 'This is taking longer than usual. Please try again.' });
        clearPending();
        return setState({ kind: 'done', wordUrl, note: 'The PDF is taking longer than usual. Your Word document is ready.' });
      }
      if (typeof data?.progress === 'number') setState({ kind: 'working', progress: Math.max(10, data.progress), step: data.progress >= 50 ? 'Making the PDF' : 'Filling in your details' });
      await new Promise((r) => setTimeout(r, POLL_MS));
    }
  }, []);

  const start = useCallback(async (fresh = false) => {
    const run = ++runId.current;
    setState({ kind: 'working', progress: 5, step: 'Filling in your details' });
    const jobId = fresh ? null : search.get('jobId');
    if (jobId) return poll(jobId, run);

    const pending = readPending(id);
    if (!pending) return setState({ kind: 'missing' });
    try {
      if (fresh || !generation.current) {
        generation.current = fetch('/api/templates/generate-fill-pdf', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ templateId: id, formData: pending.formData, paymentRef: pending.paymentRef }),
        }).then(async (res) => ({ status: res.status, ok: res.ok, data: await res.json().catch(() => ({})) }));
      }
      const { status, ok, data } = await generation.current;
      if (run !== runId.current) return;
      if (status === 401) return setState({ kind: 'sign-in' });
      if (status === 402) return setState({ kind: 'error', message: 'This template needs a payment first. Go back to the template and pay to continue.' });
      if (status === 429) return setState({ kind: 'error', message: 'Too many attempts. Wait a minute and try again.' });
      if (!ok || !data.success || !data.jobId) return setState({ kind: 'error', message: data.error || 'We couldn’t create the document. Please try again.' });
      // The job id in the address makes a refresh resume instead of starting over
      router.replace(`${pathname}?jobId=${encodeURIComponent(data.jobId)}`);
      await poll(data.jobId, run, data.wordUrl);
    } catch {
      generation.current = null;
      if (run === runId.current) setState({ kind: 'error', message: 'We couldn’t reach the server. Check your connection and try again.' });
    }
  }, [id, search, router, pathname, poll]);

  useEffect(() => {
    start();
    const runs = runId;
    return () => {
      runs.current++;
    };
    // Run once when the page opens
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = async (kind: 'pdf' | 'word', url: string) => {
    setSaving(kind);
    await downloadFile(url, `${safeFileName(meta.name)}.${kind === 'pdf' ? 'pdf' : 'docx'}`);
    setSaving(null);
  };

  const printIt = (s: Extract<State, { kind: 'done' }>) => {
    handToOrderPage({ templateId: id, templateName: meta.name, pdfUrl: s.pdfUrl, wordUrl: s.wordUrl });
    router.push('/order');
  };

  const retry = () => {
    router.replace(pathname); // forget the failed job
    start(true);
  };

  return (
    <div className="mx-auto max-w-lg px-4 py-16">
      {state.kind === 'working' ? (
        <Card>
          <CardHeader>
            <span className="grid size-10 place-items-center rounded-full bg-accent text-accent-foreground"><Loader2 className="size-5 animate-spin" aria-hidden /></span>
            <CardTitle className="mt-2 text-xl">Creating your document</CardTitle>
            <CardDescription>{state.step}… this usually takes under a minute. You can keep this page open.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={state.progress} aria-label="Progress">
              <div className="h-full bg-primary transition-[width] duration-500" style={{ width: `${state.progress}%` }} />
            </div>
          </CardContent>
        </Card>
      ) : state.kind === 'done' ? (
        <Card>
          <CardHeader>
            <span className="grid size-10 place-items-center rounded-full bg-success/10 text-success"><CheckCircle2 className="size-5" aria-hidden /></span>
            <CardTitle className="mt-2 text-xl">Your document is ready</CardTitle>
            <CardDescription>{meta.name}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {state.note ? <Alert role="status"><AlertDescription>{state.note}</AlertDescription></Alert> : null}
            <Button size="lg" className="w-full" onClick={() => printIt(state)}><Printer />Print it at a shop near you</Button>
            {meta.allowDownload ? (
              <div className="flex flex-wrap gap-2">
                {state.pdfUrl ? <Button variant="outline" onClick={() => save('pdf', state.pdfUrl!)} disabled={saving !== null}>{saving === 'pdf' ? <Loader2 className="animate-spin" /> : <Download />}Download PDF</Button> : null}
                {state.wordUrl ? <Button variant="outline" onClick={() => save('word', state.wordUrl!)} disabled={saving !== null}>{saving === 'word' ? <Loader2 className="animate-spin" /> : <FileText />}Download Word</Button> : null}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">This template’s creator only allows printing through Fun Printing.</p>
            )}
          </CardContent>
          <CardFooter className="border-t pt-4">
            <Button asChild variant="link" className="px-0"><Link href="/templates">Back to templates</Link></Button>
          </CardFooter>
        </Card>
      ) : state.kind === 'sign-in' ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-xl">Sign in to continue</CardTitle>
            <CardDescription>Your answers are saved. Sign in and we’ll create the document straight away.</CardDescription>
          </CardHeader>
          <CardFooter><Button asChild><Link href={`/auth/signin?callbackUrl=${encodeURIComponent(`/templates/fill/${id}/loading`)}`}>Sign in</Link></Button></CardFooter>
        </Card>
      ) : state.kind === 'missing' ? (
        <Card>
          <CardHeader>
            <CircleAlert className="size-8 text-muted-foreground" aria-hidden />
            <CardTitle className="mt-2 text-xl">Nothing to create here</CardTitle>
            <CardDescription>This page needs the details you filled in, and they’re no longer saved. Start again from the template. If you already paid, open the payment from My orders or your email.</CardDescription>
          </CardHeader>
          <CardFooter className="gap-2"><Button asChild><Link href={`/templates/fill/${id}`}>Fill in the template</Link></Button></CardFooter>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CircleAlert className="size-8 text-destructive" aria-hidden />
            <CardTitle className="mt-2 text-xl">We couldn’t create your document</CardTitle>
            <CardDescription role="alert">{state.message}</CardDescription>
          </CardHeader>
          <CardFooter className="gap-2">
            <Button onClick={retry}><RotateCcw />Try again</Button>
            <Button asChild variant="outline"><Link href={`/templates/fill/${id}`}>Edit details</Link></Button>
          </CardFooter>
        </Card>
      )}
    </div>
  );
}

export default function TemplateResultPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <Suspense fallback={<div className="grid min-h-[60vh] place-items-center"><Loader2 className="size-6 animate-spin text-muted-foreground" aria-label="Loading" /></div>}>
      <Result id={id} />
    </Suspense>
  );
}
