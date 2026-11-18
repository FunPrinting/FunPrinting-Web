'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import toast from 'react-hot-toast';
import { Loader2 } from 'lucide-react';
import AdminJobPanel from '@/components/admin/AdminJobPanel';
import AdminOrderActions from '@/components/admin/AdminOrderActions';
import { PageHeader } from '@/components/admin/PageHeader';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { OrderDetailView } from '@/components/OrderDetailView';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

/** Older orders keep one file in fileURL/originalFileName; the detail view wants arrays. */
function normalise(order: Record<string, any>) {
  const urls: string[] = Array.isArray(order.fileURLs) && order.fileURLs.length ? order.fileURLs : order.fileURL ? [order.fileURL] : [];
  const names: string[] = Array.isArray(order.originalFileNames) && order.originalFileNames.length ? order.originalFileNames : order.originalFileName ? [order.originalFileName] : [];
  return { ...order, fileURLs: urls, originalFileNames: urls.map((_, i) => names[i] || `File ${i + 1}`) };
}

function OrderPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const fromPage = useSearchParams().get('fromPage');
  const back = fromPage ? `/admin?page=${fromPage}` : '/admin';
  const [order, setOrder] = useState<any>(null);
  const [error, setError] = useState('');
  const [confirmShip, setConfirmShip] = useState(false);
  const [shipping, setShipping] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/admin/orders/${id}`, { cache: 'no-store' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(data.error || 'We couldn’t load this order.');
      setOrder(normalise(data.order));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'We couldn’t load this order.');
    }
  }, [id]);
  useEffect(() => {
    void load();
  }, [load]);

  const ship = async () => {
    setShipping(true);
    try {
      const res = await fetch(`/api/admin/orders/${order._id}/ship`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(data.error || 'We couldn’t book the courier.');
      toast.success(data.message || 'Courier booked');
      setConfirmShip(false);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'We couldn’t book the courier.');
    } finally {
      setShipping(false);
    }
  };

  if (error) {
    return (
      <>
        <PageHeader title="Order" back={{ href: back, label: 'Orders' }} />
        <Alert variant="destructive"><AlertTitle>Can’t open this order</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>
      </>
    );
  }
  if (!order) return <div className="grid place-items-center py-20"><Loader2 className="size-6 animate-spin text-muted-foreground" aria-label="Loading order" /></div>;

  return (
    <>
      <PageHeader title={`Order ${order.orderId}`} back={{ href: back, label: 'Orders' }} />
      <div className="space-y-6">
        <OrderDetailView order={order} mode="admin" isShipping={shipping} onShipOrder={() => setConfirmShip(true)} />
        <div className="grid gap-6 lg:grid-cols-2">
          <AdminJobPanel orderId={order.orderId} onChanged={load} />
          <AdminOrderActions order={order} onChanged={load} onDeleted={() => router.push(back)} />
        </div>
      </div>
      <ConfirmDialog
        open={confirmShip}
        onOpenChange={setConfirmShip}
        title="Book the courier?"
        description="Shiprocket collects the parcel from the shop’s pickup address and you get a tracking number. This creates a real shipment."
        confirmLabel="Book courier"
        busy={shipping}
        onConfirm={ship}
      />
    </>
  );
}

export default function AdminOrderPage() {
  return (
    <Suspense fallback={<div className="grid place-items-center py-20"><Loader2 className="size-6 animate-spin text-muted-foreground" aria-label="Loading" /></div>}>
      <OrderPage />
    </Suspense>
  );
}
