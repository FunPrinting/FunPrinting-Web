'use client';

import { useCallback, useEffect, useState } from 'react';

interface JobEvent {
  at: string;
  type: string;
  actor: string;
  detail?: string;
}

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

/** Print job status, history and admin actions for one order. */
export default function AdminJobPanel({ orderId }: { orderId: string }) {
  const [job, setJob] = useState<Job | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/admin/orders/${encodeURIComponent(orderId)}/job`);
    const data = await res.json().catch(() => ({}));
    setJob(data.success ? data.job : null);
  }, [orderId]);

  useEffect(() => {
    void load();
  }, [load]);

  const act = async (body: Record<string, unknown>, confirmText?: string) => {
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/admin/orders/${encodeURIComponent(orderId)}/job`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Action failed');
      setMessage(data.refundPending ? 'Cancelled. The refund will be retried automatically.' : 'Done');
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Action failed');
    } finally {
      setBusy(false);
    }
  };

  const cancel = (force: boolean) => {
    const reason = window.prompt('Reason for cancelling (shown to the customer):', 'The order could not be printed.');
    if (!reason) return;
    void act({ action: 'cancel', reason, refund: true, force }, force ? 'The shop may already be printing this. Cancel and refund anyway?' : undefined);
  };

  if (job === undefined) return null;

  const open = job && !['printed', 'cancelled'].includes(job.status);
  return (
    <section className="mt-6 rounded-xl border border-gray-200 bg-white p-6 shadow-sm" aria-label="Print job">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-bold text-gray-900">Print job</h2>
        <div className="flex flex-wrap gap-2">
          {(!job || ['pending_acceptance', 'queued', 'failed'].includes(job.status)) && (
            <button type="button" disabled={busy} onClick={() => act({ action: 'resend' })} className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50">
              {job ? 'Send to shop again' : 'Create job and send to shop'}
            </button>
          )}
          {job && ['claimed', 'printing', 'printed'].includes(job.status) && (
            <button type="button" disabled={busy} onClick={() => act({ action: 'resend', force: true }, 'This prints the order again. Continue?')} className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-semibold text-gray-700 disabled:opacity-50">
              Print again
            </button>
          )}
          {open && (
            <button type="button" disabled={busy} onClick={() => cancel(['claimed', 'printing'].includes(job!.status))} className="rounded-lg border border-red-300 px-3 py-1.5 text-sm font-semibold text-red-700 disabled:opacity-50">
              Cancel and refund
            </button>
          )}
        </div>
      </div>
      {message && <p className="mt-2 text-sm text-gray-700">{message}</p>}
      {!job ? (
        <p className="mt-3 text-sm text-gray-600">No print job (order placed before print jobs, or not paid).</p>
      ) : (
        <>
          <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
            <dt className="text-gray-500">Status</dt><dd className="font-medium">{job.status}</dd>
            <dt className="text-gray-500">Mode</dt><dd>{job.acceptanceMode ?? '—'}</dd>
            <dt className="text-gray-500">Device</dt><dd>{job.claim ? `${job.claim.deviceId} (until ${fmt(job.claim.leaseUntil)})` : '—'}</dd>
            <dt className="text-gray-500">Auto refund</dt><dd>{fmt(job.refundBy)}</dd>
          </dl>
          {job.needsAttention && <p className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{job.needsAttention}</p>}
          {job.lastError && <p className="mt-2 text-sm text-red-700">Last error: {job.lastError}</p>}
          <ol className="mt-4 space-y-1 text-xs text-gray-600">
            {[...job.history].reverse().map((e, i) => (
              <li key={i}>
                <span className="text-gray-400">{fmt(e.at)}</span> · <b>{e.type}</b> · {e.actor}
                {e.detail ? ` · ${e.detail}` : ''}
              </li>
            ))}
          </ol>
        </>
      )}
    </section>
  );
}
