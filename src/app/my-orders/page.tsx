'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import { AlertTriangle, Building2, CreditCard, Download, ExternalLink, FileText, Loader2, Package, RefreshCw, Truck, X } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { startOrderPayment } from '@/lib/payments/client';
import { ACTIVE_STATUSES } from '@/lib/orderStatus';
import { OrderProgress, StatusBadge } from '@/components/orders/OrderStatus';
import { cn } from '@/lib/utils';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface Order {
  _id: string;
  orderId: string;
  orderType: 'file' | 'template';
  fileURLs?: string[];
  originalFileName?: string;
  originalFileNames?: string[];
  templateData?: { templateType?: string; formData?: Record<string, string | number | boolean>; generatedPDF?: string };
  printingOptions: { pageSize: 'A4' | 'A3'; color: 'color' | 'bw' | 'mixed'; sided: 'single' | 'double'; copies: number; pageCount?: number };
  deliveryOption?: {
    type: 'pickup' | 'delivery';
    pickupLocation?: { name: string; address: string };
    deliveryCharge?: number;
    method?: 'courier' | 'shop';
    handover?: { code?: string; verifiedAt?: string };
    address?: string;
    city?: string;
    pinCode?: string;
  };
  paymentStatus: 'pending' | 'completed' | 'failed';
  status?: string;
  amount: number;
  paymentRef?: string;
  shopDelayNotifiedAt?: string;
  createdAt: string;
  shiprocket?: { awbCode?: string; courierName?: string; trackingUrl?: string; status?: string };
}

const rupees = (n: number) => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const date = (d: string) => new Date(d).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });

function isAwaitingPayment(o: Order) {
  return o.paymentStatus !== 'completed' && (o.status === 'pending_payment' || !o.status);
}

function OrderCard({ order, onPay, onCancel, paying }: { order: Order; onPay: () => void; onCancel: () => void; paying: boolean }) {
  const router = useRouter();
  const shownStatus = isAwaitingPayment(order) ? 'pending_payment' : order.status;
  const files = order.originalFileNames?.length ? order.originalFileNames : order.originalFileName ? [order.originalFileName] : [];
  const opts = order.printingOptions;
  const delivery = order.deliveryOption;
  const waitingForShop = order.shopDelayNotifiedAt && order.paymentStatus === 'completed' && order.status === 'paid';

  return (
    <Card className={cn(isAwaitingPayment(order) && 'border-warning/40')}>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 space-y-0">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-mono text-sm font-semibold">#{order.orderId}</h2>
            <StatusBadge status={shownStatus} />
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{date(order.createdAt)}</p>
        </div>
        <div className="text-right">
          <div className="text-lg font-semibold tabular-nums">{rupees(order.amount)}</div>
          {delivery?.deliveryCharge ? <div className="text-xs text-muted-foreground">incl. {rupees(delivery.deliveryCharge)} delivery</div> : null}
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {waitingForShop ? (
          <Alert className="border-warning/30 bg-warning/5">
            <AlertTriangle className="text-warning" />
            <AlertTitle>The shop hasn’t accepted this order yet</AlertTitle>
            <AlertDescription>
              Keep waiting (it is refunded automatically if not accepted within 24 hours of payment), or{' '}
              <Link href={`/orders/${encodeURIComponent(order.orderId)}/choose`} className="font-medium text-foreground underline">get a refund now</Link>.
            </AlertDescription>
          </Alert>
        ) : null}

        <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
          <span className="flex min-w-0 items-center gap-2">
            <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <span className="truncate">
              {order.orderType === 'template' ? `Template${order.templateData?.templateType ? `: ${order.templateData.templateType.replace(/-/g, ' ')}` : ''}` : files[0] || 'Document'}
              {files.length > 1 ? <span className="text-muted-foreground"> +{files.length - 1} more</span> : null}
            </span>
          </span>
          <span className="text-muted-foreground">
            {opts.pageSize} · {opts.color === 'color' ? 'Colour' : opts.color === 'mixed' ? 'Mixed colour' : 'B&W'} · {opts.sided === 'double' ? 'Double-sided' : 'Single-sided'} · {opts.copies} {opts.copies === 1 ? 'copy' : 'copies'}
          </span>
          {delivery ? (
            <span className="flex min-w-0 items-center gap-2 text-muted-foreground">
              {delivery.type === 'delivery' ? <Truck className="size-4 shrink-0" aria-hidden /> : <Building2 className="size-4 shrink-0" aria-hidden />}
              <span className="truncate">
                {delivery.type === 'pickup'
                  ? `Pickup${delivery.pickupLocation?.name ? ` · ${delivery.pickupLocation.name}` : ''}`
                  : `Delivery${delivery.address ? ` · ${[delivery.address, delivery.city, delivery.pinCode].filter(Boolean).join(', ')}` : ''}`}
              </span>
            </span>
          ) : null}
        </div>

        <OrderProgress status={order.status} delivery={order.deliveryOption?.type === 'delivery'} />

        {delivery?.method === 'shop' && delivery.handover?.code && order.paymentStatus === 'completed' && !delivery.handover.verifiedAt && !['cancelled', 'refunded'].includes(order.status || '') ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-primary/30 bg-accent/40 px-3 py-2 text-sm">
            <span>The shop delivers this order. Give the delivery person this code:</span>
            <span className="font-mono text-xl font-semibold tracking-[0.3em]" aria-label={`Delivery code ${delivery.handover.code.split('').join(' ')}`}>{delivery.handover.code}</span>
          </div>
        ) : null}

        {order.shiprocket?.awbCode && order.paymentStatus === 'completed' ? (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-muted/60 px-3 py-2 text-sm">
            <span className="flex items-center gap-2">
              <Package className="size-4 text-muted-foreground" aria-hidden />
              {order.shiprocket.status || 'Shipped'}{order.shiprocket.courierName ? ` via ${order.shiprocket.courierName}` : ''} · AWB {order.shiprocket.awbCode}
            </span>
            <a href={order.shiprocket.trackingUrl || `https://shiprocket.co/tracking/${order.shiprocket.awbCode}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-medium text-primary hover:underline">
              Track <ExternalLink className="size-3.5" aria-hidden />
            </a>
          </div>
        ) : null}
      </CardContent>

      <CardFooter className="flex flex-wrap gap-2 border-t pt-4">
        {isAwaitingPayment(order) ? (
          <>
            <Button onClick={onPay} disabled={paying}>
              {paying ? <Loader2 className="animate-spin" /> : <CreditCard />}Pay {rupees(order.amount)}
            </Button>
            {order.paymentRef ? (
              <Button variant="outline" asChild><Link href={`/payment/status/${encodeURIComponent(order.paymentRef)}`}>Check payment status</Link></Button>
            ) : null}
            <Button variant="ghost" className="text-destructive hover:text-destructive" onClick={onCancel}><X />Cancel order</Button>
          </>
        ) : (
          <>
            <Button variant="outline" onClick={() => router.push(`/orders/${order._id}`)}>View details</Button>
            {order.orderType === 'template' && order.templateData?.generatedPDF ? (
              <Button variant="outline" asChild><a href={order.templateData.generatedPDF} download><Download />Download PDF</a></Button>
            ) : null}
          </>
        )}
      </CardFooter>
    </Card>
  );
}

export default function MyOrdersPage() {
  const { user, isAuthenticated, isLoading: authLoading } = useAuth();
  const router = useRouter();
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<'active' | 'past' | 'all'>('active');
  const [paying, setPaying] = useState<string | null>(null);
  const [cancelTarget, setCancelTarget] = useState<Order | null>(null);
  const [cancelling, setCancelling] = useState(false);

  useEffect(() => {
    if (!authLoading && !isAuthenticated) router.push('/auth/signin?callbackUrl=/my-orders');
  }, [authLoading, isAuthenticated, router]);

  const load = useCallback(async () => {
    if (!user?.email) return;
    setLoading(true);
    try {
      const data = await (await fetch(`/api/orders?email=${encodeURIComponent(user.email)}`)).json();
      if (data.success) setOrders(data.orders);
      else toast.error(data.error || 'Could not load your orders');
    } catch {
      toast.error('Could not load your orders. Check your connection.');
    } finally {
      setLoading(false);
    }
  }, [user?.email]);

  useEffect(() => {
    if (isAuthenticated) load();
  }, [isAuthenticated, load]);

  const visible = useMemo(() => {
    const list = orders ?? [];
    if (tab === 'all') return list;
    return list.filter((o) => (tab === 'active' ? ACTIVE_STATUSES.has(o.status || 'pending_payment') : !ACTIVE_STATUSES.has(o.status || 'pending_payment')));
  }, [orders, tab]);

  const unpaid = (orders ?? []).filter(isAwaitingPayment).length;

  const pay = async (order: Order) => {
    setPaying(order._id);
    try {
      await startOrderPayment(order.orderId); // redirects to Razorpay
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not start the payment. Please try again.');
      setPaying(null);
    }
  };

  const cancel = async () => {
    if (!cancelTarget) return;
    setCancelling(true);
    try {
      const data = await (await fetch(`/api/orders/${cancelTarget._id}`, { method: 'DELETE' })).json();
      if (data.success) {
        toast.success(`Order #${cancelTarget.orderId} cancelled`);
        setCancelTarget(null);
        await load();
      } else {
        toast.error(data.error || 'Could not cancel the order');
      }
    } catch {
      toast.error('Could not cancel the order. Please try again.');
    } finally {
      setCancelling(false);
    }
  };

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold">My orders</h1>
          <p className="mt-1 text-muted-foreground">{user?.name ? `Hi ${user.name.split(' ')[0]}, h` : 'H'}ere is everything you have ordered.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={load} disabled={loading || !isAuthenticated}>
            <RefreshCw className={cn(loading && 'animate-spin')} />Refresh
          </Button>
          <Button asChild><Link href="/order">New order</Link></Button>
        </div>
      </div>

      {unpaid > 0 ? (
        <Alert className="mt-6 border-warning/30 bg-warning/5">
          <CreditCard className="text-warning" />
          <AlertTitle>{unpaid} {unpaid === 1 ? 'order is' : 'orders are'} waiting for payment</AlertTitle>
          <AlertDescription>Unpaid orders expire after 24 hours.</AlertDescription>
        </Alert>
      ) : null}

      <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)} className="mt-6">
        <TabsList>
          <TabsTrigger value="active">Active</TabsTrigger>
          <TabsTrigger value="past">Past</TabsTrigger>
          <TabsTrigger value="all">All</TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="mt-4 space-y-4">
        {orders === null || authLoading ? (
          [0, 1, 2].map((i) => <Skeleton key={i} className="h-44 w-full rounded-xl" />)
        ) : visible.length ? (
          visible.map((o) => <OrderCard key={o._id} order={o} paying={paying === o._id} onPay={() => pay(o)} onCancel={() => setCancelTarget(o)} />)
        ) : (
          <Card>
            <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
              <span className="grid size-12 place-items-center rounded-full bg-accent text-accent-foreground"><Package className="size-6" aria-hidden /></span>
              <h2 className="font-semibold">{tab === 'active' ? 'No active orders' : 'No orders here'}</h2>
              <p className="max-w-sm text-sm text-muted-foreground">Upload a document, choose a shop near you and pay online. Your orders show up here.</p>
              <Button asChild className="mt-2"><Link href="/order">Start an order</Link></Button>
            </CardContent>
          </Card>
        )}
      </div>

      <Dialog open={Boolean(cancelTarget)} onOpenChange={(o) => !o && setCancelTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancel order #{cancelTarget?.orderId}?</DialogTitle>
            <DialogDescription>This order hasn’t been paid, so nothing is charged. You can’t undo this.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild><Button variant="outline">Keep order</Button></DialogClose>
            <Button variant="destructive" onClick={cancel} disabled={cancelling}>{cancelling ? <Loader2 className="animate-spin" /> : null}Cancel order</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
