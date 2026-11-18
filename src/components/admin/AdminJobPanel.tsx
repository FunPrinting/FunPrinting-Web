'use client';

import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Loader2 } from 'lucide-react';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface JobEvent { at: string; type: string; actor: string; detail?: string }
interface Job {
  jobId: string;
  status: string;
  partnerId?: string;
  acceptanceMode?: string;
  acceptBy?: string;
  refundBy?: string;
  claim?: { deviceId: string; leaseUntil: string };
  needsAttention?: string;
  lastError?: string;
  history: JobEvent[];
}

const fmt = (iso?: string) => (iso ? new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');
type Pending = { kind: 'cancel'; force: boolean } | { kind: 'reprint' } | null;

/** Print job status, history and admin actions for one order. */
export default function AdminJobPanel({ orderId, onChanged }: { orderId: string; onChanged?: () => void }) {
  const [job, setJob] = useState<Job | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<Pending>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/admin/orders/${encodeURIComponent(orderId)}/job`);
    const data = await res.json().catch(() => ({}));
    setJob(data.success ? data.job : null);
  }, [orderId]);
  useEffect(() => {
    void load();
  }, [load]);

  const act = async (body: Record<string, unknown>, done?: (data: { refundPending?: boolean }) => string) => {
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/orders/${encodeURIComponent(orderId)}/job`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(data.error || 'The action failed.');
      toast.success(done ? done(data) : 'Done');
      setPending(null);
      await load();
      onChanged?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'The action failed.');
    } finally {
      setBusy(false);
    }
  };

  if (job === undefined) return null;
  const open = job && !['printed', 'cancelled'].includes(job.status);
  const printing = job && ['claimed', 'printing'].includes(job.status);

  return (
    <Card aria-label="Print job">
      <CardHeader className="flex flex-wrap items-center justify-between gap-3">
        <CardTitle className="text-base">Print job</CardTitle>
        <div className="flex flex-wrap gap-2">
          {!job || ['pending_acceptance', 'queued', 'failed'].includes(job.status) ? (
            <Button size="sm" disabled={busy} onClick={() => act({ action: 'resend' }, () => 'Sent to the shop')}>{busy ? <Loader2 className="animate-spin" /> : null}{job ? 'Send to shop again' : 'Create job and send to shop'}</Button>
          ) : null}
          {job && ['claimed', 'printing', 'printed'].includes(job.status) ? <Button size="sm" variant="outline" disabled={busy} onClick={() => setPending({ kind: 'reprint' })}>Print again</Button> : null}
          {open ? <Button size="sm" variant="destructive" disabled={busy} onClick={() => setPending({ kind: 'cancel', force: Boolean(printing) })}>Cancel and refund</Button> : null}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {!job ? (
          <p className="text-sm text-muted-foreground">No print job. The order was placed before print jobs existed, or it is not paid.</p>
        ) : (
          <>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
              <div><dt className="text-muted-foreground">Status</dt><dd><Badge variant="secondary">{job.status.replace(/_/g, ' ')}</Badge></dd></div>
              <div><dt className="text-muted-foreground">Accepting</dt><dd>{job.acceptanceMode === 'manual' ? 'By hand' : job.acceptanceMode === 'auto' ? 'Automatic' : '—'}</dd></div>
              <div><dt className="text-muted-foreground">Device</dt><dd className="break-all">{job.claim ? `${job.claim.deviceId} (until ${fmt(job.claim.leaseUntil)})` : '—'}</dd></div>
              <div><dt className="text-muted-foreground">Automatic refund</dt><dd>{fmt(job.refundBy)}</dd></div>
            </dl>
            {job.needsAttention ? <p className="rounded-lg bg-warning/10 p-3 text-sm text-warning">{job.needsAttention}</p> : null}
            {job.lastError ? <p className="text-sm text-destructive">Last error: {job.lastError}</p> : null}
            <ol className="space-y-1 text-xs text-muted-foreground">
              {[...job.history].reverse().map((e, i) => (
                <li key={i}><span>{fmt(e.at)}</span> · <b className="text-foreground">{e.type}</b> · {e.actor}{e.detail ? ` · ${e.detail}` : ''}</li>
              ))}
            </ol>
          </>
        )}
      </CardContent>

      <ConfirmDialog
        open={pending?.kind === 'cancel'}
        onOpenChange={(o) => !o && setPending(null)}
        title="Cancel and refund this order?"
        description={pending?.kind === 'cancel' && pending.force ? 'The shop may already be printing this. The customer is refunded in full and sees your reason.' : 'The customer is refunded in full and sees your reason.'}
        confirmLabel="Cancel and refund"
        destructive
        busy={busy}
        reason={{ label: 'Reason shown to the customer', defaultValue: 'The order could not be printed.', minLength: 3, maxLength: 200 }}
        onConfirm={(reason) => act({ action: 'cancel', reason, refund: true, force: pending?.kind === 'cancel' ? pending.force : false }, (d) => (d.refundPending ? 'Cancelled. The refund will be retried automatically.' : 'Cancelled and refunded'))}
      />
      <ConfirmDialog
        open={pending?.kind === 'reprint'}
        onOpenChange={(o) => !o && setPending(null)}
        title="Print this order again?"
        description="The shop receives it a second time and prints it again."
        confirmLabel="Print again"
        busy={busy}
        onConfirm={() => act({ action: 'resend', force: true }, () => 'Sent to the shop again')}
      />
    </Card>
  );
}
