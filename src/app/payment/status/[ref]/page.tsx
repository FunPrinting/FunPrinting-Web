'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useSession } from 'next-auth/react';

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
    sessionStorage.setItem(
      'pendingTemplateFormData',
      JSON.stringify({ templateId: payment.templateId, formData: payment.formData ?? {}, paymentCompleted: true, paymentRef: payment.referenceId })
    );
    router.push(`/templates/fill/${encodeURIComponent(payment.templateId)}/loading`);
  };

  const unverified = search.get('notice') === 'unverified';

  return (
    <main className="min-h-[70vh] bg-gray-50 px-4 py-16">
      <div className="mx-auto max-w-lg rounded-2xl border border-gray-200 bg-white p-8 shadow-sm">
        {error ? (
          <>
            <h1 className="text-xl font-bold text-gray-900">Payment status</h1>
            <p className="mt-2 text-gray-600">{error}</p>
            <Link href="/my-orders" className="mt-6 inline-block font-semibold text-indigo-600 hover:underline">Go to My Orders</Link>
          </>
        ) : !payment ? (
          <div className="flex items-center gap-3 text-gray-600" role="status">
            <span className="h-5 w-5 animate-spin rounded-full border-2 border-indigo-600 border-t-transparent" />
            Loading payment…
          </div>
        ) : payment.status === 'paid' ? (
          <>
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-green-100 text-2xl" aria-hidden>✓</div>
            <h1 className="mt-4 text-2xl font-bold text-gray-900">Payment received</h1>
            <p className="mt-1 text-gray-600">
              {rupees(payment.amounts.total)} paid
              {payment.orderId ? <> for order <span className="font-mono font-semibold">#{payment.orderId}</span></> : null}
              {payment.templateName ? <> for <span className="font-semibold">{payment.templateName}</span></> : null}.
            </p>
            {payment.purpose === 'print_order' ? (
              <>
                <p className="mt-3 text-sm text-gray-600">We have sent your order to the print shop and emailed your invoice.</p>
                <Link href="/my-orders" className="mt-6 inline-block rounded-lg bg-indigo-600 px-5 py-2.5 font-semibold text-white hover:bg-indigo-700">View my orders</Link>
              </>
            ) : (
              <button type="button" onClick={continueTemplate} className="mt-6 rounded-lg bg-indigo-600 px-5 py-2.5 font-semibold text-white hover:bg-indigo-700">
                Generate my document
              </button>
            )}
          </>
        ) : payment.status === 'created' ? (
          <>
            <h1 className="text-2xl font-bold text-gray-900">{waitedTooLong ? 'Still waiting for the payment' : 'Confirming your payment…'}</h1>
            <p className="mt-2 text-gray-600">
              {waitedTooLong
                ? 'We have not received confirmation from Razorpay yet. If money was taken, it will show up here automatically; you will not be charged twice.'
                : 'This usually takes a few seconds. Please keep this page open.'}
            </p>
            {unverified && <p className="mt-2 text-sm text-amber-700">The redirect from the payment page could not be verified, so we are checking with Razorpay directly.</p>}
            {!waitedTooLong && (
              <div className="mt-4 flex items-center gap-3 text-sm text-gray-500" role="status">
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-indigo-600 border-t-transparent" />
                Checking…
              </div>
            )}
            <div className="mt-6 flex flex-wrap gap-3">
              {payment.paymentUrl && (
                <a href={payment.paymentUrl} className="rounded-lg bg-indigo-600 px-5 py-2.5 font-semibold text-white hover:bg-indigo-700">
                  Complete payment ({rupees(payment.amounts.total)})
                </a>
              )}
              <button type="button" onClick={() => { started.current = Date.now(); setWaitedTooLong(false); void load(); }} className="rounded-lg border border-gray-300 px-5 py-2.5 font-semibold text-gray-700 hover:bg-gray-50">
                Check again
              </button>
            </div>
          </>
        ) : payment.status === 'expired' || payment.status === 'cancelled' ? (
          <>
            <h1 className="text-2xl font-bold text-gray-900">Payment not completed</h1>
            <p className="mt-2 text-gray-600">This payment link has {payment.status === 'expired' ? 'expired' : 'been closed'}. No money was taken.</p>
            {payment.orderId ? (
              <Link href="/my-orders" className="mt-6 inline-block rounded-lg bg-indigo-600 px-5 py-2.5 font-semibold text-white hover:bg-indigo-700">Pay from My Orders</Link>
            ) : (
              <Link href={payment.templateId ? `/templates/fill/${encodeURIComponent(payment.templateId)}` : '/templates'} className="mt-6 inline-block rounded-lg bg-indigo-600 px-5 py-2.5 font-semibold text-white hover:bg-indigo-700">Try again</Link>
            )}
          </>
        ) : (
          <>
            <h1 className="text-2xl font-bold text-gray-900">{payment.status === 'refunded' ? 'Payment refunded' : 'Partly refunded'}</h1>
            <p className="mt-2 text-gray-600">{rupees(payment.amountRefunded)} of {rupees(payment.amounts.total)} has been refunded to your original payment method. Banks usually take 5–7 working days.</p>
            <Link href="/my-orders" className="mt-6 inline-block font-semibold text-indigo-600 hover:underline">Go to My Orders</Link>
          </>
        )}
        <p className="mt-8 text-xs text-gray-400">Reference: {ref}</p>
      </div>
    </main>
  );
}
