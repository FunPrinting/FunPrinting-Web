'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';

type State =
  | { kind: 'loading' }
  | { kind: 'ask'; shop?: string; refundBy?: string }
  | { kind: 'done'; message: string }
  | { kind: 'error'; message: string };

/** The shop hasn't accepted the order yet: refund now or keep waiting. */
export default function ShopDelayPage() {
  const { id } = useParams<{ id: string }>();
  const token = useSearchParams().get('token') || undefined;
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const qs = token ? `?token=${encodeURIComponent(token)}` : '';
    fetch(`/api/orders/${encodeURIComponent(id)}/choose${qs}`)
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok || !data.success) setState({ kind: 'error', message: data.error || 'This link is no longer valid.' });
        else setState({ kind: 'ask', shop: data.shop, refundBy: data.refundBy });
      })
      .catch(() => setState({ kind: 'error', message: 'Could not load your order. Please try again.' }));
  }, [id, token]);

  const choose = async (choice: 'refund' | 'wait') => {
    setBusy(true);
    try {
      const res = await fetch(`/api/orders/${encodeURIComponent(id)}/choose`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, choice }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Something went wrong');
      setState({
        kind: 'done',
        message:
          data.result === 'refunded'
            ? 'Your refund has been started. It usually reaches your account in 5–7 working days.'
            : "OK, we'll keep your order with the shop and email you when it's accepted. If it isn't accepted in time, you'll be refunded automatically.",
      });
    } catch (e) {
      setState({ kind: 'error', message: e instanceof Error ? e.message : 'Something went wrong' });
    } finally {
      setBusy(false);
    }
  };

  const until = state.kind === 'ask' && state.refundBy
    ? new Date(state.refundBy).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
    : null;

  return (
    <main className="min-h-[70vh] bg-gray-50 px-4 py-16">
      <div className="mx-auto max-w-lg rounded-2xl border border-gray-200 bg-white p-8 shadow-sm">
        <h1 className="text-2xl font-bold text-gray-900">Order #{id}</h1>
        {state.kind === 'loading' && <p className="mt-3 text-gray-600" role="status">Loading…</p>}
        {(state.kind === 'error' || state.kind === 'done') && <p className="mt-3 text-gray-700">{state.message}</p>}
        {state.kind === 'ask' && (
          <>
            <p className="mt-3 text-gray-700">
              <b>{state.shop ?? 'Your print shop'}</b> hasn&apos;t accepted this order yet. You can keep waiting, or cancel and get a full refund now.
            </p>
            {until && <p className="mt-2 text-sm text-gray-500">If it isn&apos;t accepted by {until}, we&apos;ll refund you automatically.</p>}
            <div className="mt-6 flex flex-wrap gap-3">
              <button type="button" disabled={busy} onClick={() => choose('wait')} className="rounded-lg bg-indigo-600 px-5 py-2.5 font-semibold text-white hover:bg-indigo-700 disabled:opacity-50">
                Keep waiting
              </button>
              <button type="button" disabled={busy} onClick={() => choose('refund')} className="rounded-lg border border-gray-300 px-5 py-2.5 font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50">
                Refund now
              </button>
            </div>
          </>
        )}
        <Link href="/my-orders" className="mt-8 inline-block text-sm font-semibold text-indigo-600 hover:underline">My orders</Link>
      </div>
    </main>
  );
}
