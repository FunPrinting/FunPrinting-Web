'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { CheckCircle2, CircleAlert, Clock, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';

type State =
  | { kind: 'loading' }
  | { kind: 'ask'; shop?: string; refundBy?: string }
  | { kind: 'done'; refunded: boolean }
  | { kind: 'error'; message: string };

/** The shop hasn't accepted the order yet: refund now or keep waiting. */
export default function ShopDelayPage() {
  const { id } = useParams<{ id: string }>();
  const token = useSearchParams().get('token') || undefined;
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [busy, setBusy] = useState<'refund' | 'wait' | null>(null);

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
    setBusy(choice);
    try {
      const res = await fetch(`/api/orders/${encodeURIComponent(id)}/choose`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, choice }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Something went wrong');
      setState({ kind: 'done', refunded: data.result === 'refunded' });
    } catch (e) {
      setState({ kind: 'error', message: e instanceof Error ? e.message : 'Something went wrong' });
    } finally {
      setBusy(null);
    }
  };

  const until = state.kind === 'ask' && state.refundBy
    ? new Date(state.refundBy).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
    : null;

  return (
    <div className="px-4 py-16">
      <Card className="mx-auto max-w-lg">
        {state.kind === 'loading' ? (
          <CardContent className="flex items-center gap-2 py-10 text-muted-foreground" role="status">
            <Loader2 className="size-4 animate-spin" aria-hidden />Loading your order…
          </CardContent>
        ) : state.kind === 'error' ? (
          <CardHeader>
            <CircleAlert className="size-8 text-muted-foreground" aria-hidden />
            <CardTitle className="mt-2 text-xl">Order #{id}</CardTitle>
            <CardDescription>{state.message}</CardDescription>
          </CardHeader>
        ) : state.kind === 'done' ? (
          <CardHeader>
            <CheckCircle2 className="size-8 text-success" aria-hidden />
            <CardTitle className="mt-2 text-xl">{state.refunded ? 'Refund started' : 'We’ll keep waiting'}</CardTitle>
            <CardDescription>
              {state.refunded
                ? 'Your refund is on its way. It usually reaches your account in 5–7 working days.'
                : 'Your order stays with the shop and we’ll email you when it’s accepted. If it isn’t accepted in time, you’ll be refunded automatically.'}
            </CardDescription>
          </CardHeader>
        ) : (
          <>
            <CardHeader>
              <span className="grid size-10 place-items-center rounded-full bg-warning/10 text-warning"><Clock className="size-5" aria-hidden /></span>
              <CardTitle className="mt-2 text-xl">The shop hasn’t accepted order #{id} yet</CardTitle>
              <CardDescription>
                <span className="font-medium text-foreground">{state.shop ?? 'Your print shop'}</span> hasn’t picked up your order. You can keep waiting, or cancel and get a full refund now.
              </CardDescription>
            </CardHeader>
            {until ? (
              <CardContent className="text-sm text-muted-foreground">If it isn’t accepted by {until}, we’ll refund you automatically.</CardContent>
            ) : null}
            <CardFooter className="flex flex-wrap gap-2">
              <Button disabled={busy !== null} onClick={() => choose('wait')}>{busy === 'wait' ? <Loader2 className="animate-spin" /> : null}Keep waiting</Button>
              <Button variant="outline" disabled={busy !== null} onClick={() => choose('refund')}>{busy === 'refund' ? <Loader2 className="animate-spin" /> : null}Refund now</Button>
            </CardFooter>
          </>
        )}
        {state.kind !== 'loading' ? (
          <CardFooter className="border-t pt-4">
            <Button asChild variant="link" className="px-0"><Link href="/my-orders">Go to My orders</Link></Button>
          </CardFooter>
        ) : null}
      </Card>
    </div>
  );
}
