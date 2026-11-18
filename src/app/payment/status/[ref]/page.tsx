'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { savePending } from '@/lib/templates/pending';
import { CheckCircle2, CircleAlert, Clock, Loader2, RotateCcw, Undo2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';

interface PaymentStatus {
  referenceId: string;
  purpose: 'print_order' | 'template';
  status: 'created' | 'paid' | 'expired' | 'cancelled' | 'refunded' | 'partially_refunded';
  orderId?: string;
  templateId?: string;
  templateName?: string;
  formData?: Record<string, unknown>;
  amounts: { subtotal: number; fee: number; total: number };
  amountRefunded: number;
  paymentUrl?: string;
}

const rupees = (paise: number) => `₹${(paise / 100).toFixed(2)}`;
const POLL_MS = 3000;
const MAX_WAIT_MS = 3 * 60_000;

function Icon({ icon: I, tone }: { icon: React.ElementType; tone: string }) {
  return <span className={`grid size-10 place-items-center rounded-full ${tone}`}><I className="size-5" aria-hidden /></span>;
}

export default function PaymentStatusPage() {
  const { ref } = useParams<{ ref: string }>();
  const search = useSearchParams();
  const router = useRouter();
  const { status: authStatus } = useSession();
  const [payment, setPayment] = useState<PaymentStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [waitedTooLong, setWaitedTooLong] = useState(false);
  const started = useRef(Date.now());

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/payments/${encodeURIComponent(ref)}`, { cache: 'no-store' });
      if (res.status === 401) return setError('Please sign in to see this payment.');
      if (res.status === 404) return setError('We could not find this payment.');
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Could not load the payment');
      setPayment(data.payment);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the payment');
    }
  }, [ref]);

  useEffect(() => {
    if (authStatus === 'loading') return;
    if (authStatus === 'unauthenticated') {
      router.replace(`/auth/signin?callbackUrl=${encodeURIComponent(`/payment/status/${ref}`)}`);
      return;
    }
    void load();
  }, [authStatus, load, ref, router]);

  // Keep checking while the payment is still open; the webhook usually lands within seconds
  useEffect(() => {
    if (!payment || payment.status !== 'created') return;
    if (Date.now() - started.current > MAX_WAIT_MS) {
      setWaitedTooLong(true);
      return;
    }
    const t = setTimeout(load, POLL_MS);
    return () => clearTimeout(t);
  }, [payment, load]);

  const continueTemplate = () => {
    if (!payment?.templateId) return;
    savePending({ templateId: payment.templateId, formData: (payment.formData ?? {}) as Record<string, string>, paymentRef: payment.referenceId });
    router.push(`/templates/fill/${encodeURIComponent(payment.templateId)}/loading`);
  };

  const unverified = search.get('notice') === 'unverified';

  return (
    <div className="px-4 py-16">
      <Card className="mx-auto max-w-lg">
        {error ? (
          <>
            <CardHeader>
              <Icon icon={CircleAlert} tone="bg-muted text-muted-foreground" />
              <CardTitle className="mt-2 text-xl">Payment status</CardTitle>
              <CardDescription>{error}</CardDescription>
            </CardHeader>
            <CardFooter><Button asChild variant="outline"><Link href="/my-orders">Go to My orders</Link></Button></CardFooter>
          </>
        ) : !payment ? (
          <CardContent className="flex items-center gap-2 py-10 text-muted-foreground" role="status">
            <Loader2 className="size-4 animate-spin" aria-hidden />Loading payment…
          </CardContent>
        ) : payment.status === 'paid' ? (
          <>
            <CardHeader>
              <Icon icon={CheckCircle2} tone="bg-success/10 text-success" />
              <CardTitle className="mt-2 text-2xl">Payment received</CardTitle>
              <CardDescription>
                {rupees(payment.amounts.total)} paid
                {payment.orderId ? <> for order <span className="font-mono font-medium text-foreground">#{payment.orderId}</span></> : null}
                {payment.templateName ? <> for <span className="font-medium text-foreground">{payment.templateName}</span></> : null}.
              </CardDescription>
            </CardHeader>
            {payment.purpose === 'print_order' ? (
              <>
                <CardContent className="text-sm text-muted-foreground">We’ve sent your order to the print shop and emailed your invoice.</CardContent>
                <CardFooter><Button asChild><Link href="/my-orders">View my orders</Link></Button></CardFooter>
              </>
            ) : (
              <CardFooter><Button onClick={continueTemplate}>Generate my document</Button></CardFooter>
            )}
          </>
        ) : payment.status === 'created' ? (
          <>
            <CardHeader>
              <Icon icon={waitedTooLong ? Clock : Loader2} tone={waitedTooLong ? 'bg-warning/10 text-warning' : 'bg-accent text-accent-foreground [&_svg]:animate-spin'} />
              <CardTitle className="mt-2 text-2xl">{waitedTooLong ? 'Still waiting for the payment' : 'Confirming your payment…'}</CardTitle>
              <CardDescription>
                {waitedTooLong
                  ? 'Razorpay hasn’t confirmed the payment yet. If money was taken, it will show up here automatically. You won’t be charged twice.'
                  : 'This usually takes a few seconds. Please keep this page open.'}
              </CardDescription>
            </CardHeader>
            {unverified ? (
              <CardContent>
                <Alert><AlertDescription>We couldn’t verify the redirect from the payment page, so we’re checking with Razorpay directly.</AlertDescription></Alert>
              </CardContent>
            ) : null}
            <CardFooter className="flex flex-wrap gap-2">
              {payment.paymentUrl ? (
                <Button asChild><a href={payment.paymentUrl}>Complete payment ({rupees(payment.amounts.total)})</a></Button>
              ) : null}
              <Button variant="outline" onClick={() => { started.current = Date.now(); setWaitedTooLong(false); void load(); }}>
                <RotateCcw />Check again
              </Button>
            </CardFooter>
          </>
        ) : payment.status === 'expired' || payment.status === 'cancelled' ? (
          <>
            <CardHeader>
              <Icon icon={CircleAlert} tone="bg-muted text-muted-foreground" />
              <CardTitle className="mt-2 text-2xl">Payment not completed</CardTitle>
              <CardDescription>This payment link has {payment.status === 'expired' ? 'expired' : 'been closed'}. No money was taken.</CardDescription>
            </CardHeader>
            <CardFooter>
              {payment.orderId ? (
                <Button asChild><Link href="/my-orders">Pay from My orders</Link></Button>
              ) : (
                <Button asChild><Link href={payment.templateId ? `/templates/fill/${encodeURIComponent(payment.templateId)}` : '/templates'}>Try again</Link></Button>
              )}
            </CardFooter>
          </>
        ) : (
          <>
            <CardHeader>
              <Icon icon={Undo2} tone="bg-muted text-muted-foreground" />
              <CardTitle className="mt-2 text-2xl">{payment.status === 'refunded' ? 'Payment refunded' : 'Partly refunded'}</CardTitle>
              <CardDescription>{rupees(payment.amountRefunded)} of {rupees(payment.amounts.total)} has been refunded to your original payment method. Banks usually take 5–7 working days.</CardDescription>
            </CardHeader>
            <CardFooter><Button asChild variant="outline"><Link href="/my-orders">Go to My orders</Link></Button></CardFooter>
          </>
        )}
        <CardContent className="border-t pt-4 text-xs text-muted-foreground">Reference: <span className="font-mono">{ref}</span></CardContent>
      </Card>
    </div>
  );
}
