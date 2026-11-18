'use client';

import Link from 'next/link';
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import toast from 'react-hot-toast';
import { ChevronLeft, ChevronRight, Loader2, RefreshCw, X } from 'lucide-react';
import { ORDER_STATUS } from '@/lib/orderStatus';
import { PageHeader } from '@/components/admin/PageHeader';
import AdminPartnersView from '@/components/admin/AdminPartnersView';
import { StatusBadge } from '@/components/orders/OrderStatus';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

interface OrderRow {
  _id: string;
  orderId: string;
  orderType: 'file' | 'template';
  customerInfo?: { name?: string; phone?: string };
  studentInfo?: { name?: string; phone?: string };
  deliveryOption?: { type?: 'pickup' | 'delivery'; method?: 'courier' | 'shop'; deliveryCharge?: number; pickupLocation?: { name?: string } };
  status: string;
  paymentStatus: string;
  amount: number;
  createdAt: string;
  shiprocket?: { awbCode?: string; courierName?: string };
}
interface Counts { awaitingPayment: number; waitingForShop: number; inProgress: number; onTheWay: number }
interface Financials { totalSales: number; partnerPayouts: number; platformRevenue: number }

const PAGE_SIZE = 10;
const rupees = (n: number) => `₹${n.toLocaleString('en-IN', { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 })}`;
const when = (iso: string) => new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

function deliveryText(o: OrderRow) {
  const d = o.deliveryOption;
  if (d?.type !== 'delivery') return d?.pickupLocation?.name ? `Pickup · ${d.pickupLocation.name}` : 'Pickup';
  if (d.method === 'shop') return 'Shop’s own rider';
  return o.shiprocket?.awbCode ? `Courier · ${o.shiprocket.courierName ?? 'booked'}` : 'Courier · not booked';
}

function Stat({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <Card className="gap-1">
      <CardHeader className="pb-0"><CardDescription>{label}</CardDescription></CardHeader>
      <CardContent><p className="text-2xl font-semibold tabular-nums">{value}</p>{hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}</CardContent>
    </Card>
  );
}

function Dashboard() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [orders, setOrders] = useState<OrderRow[] | null>(null);
  const [counts, setCounts] = useState<Counts | null>(null);
  const [money, setMoney] = useState<Financials | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(false);
  const [page, setPage] = useState(Number(searchParams.get('page')) || 1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [partnerId, setPartnerId] = useState<string | null>(null);
  const [filters, setFilters] = useState({ q: '', from: '', to: '', status: 'all', payment: 'all' });
  const [tab, setTab] = useState('orders');
  const latest = useRef(0);

  const fetchOrders = useCallback(async (p: number, f = filters, shop = partnerId) => {
    const ticket = ++latest.current;
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ page: String(p), limit: String(PAGE_SIZE) });
      if (f.q.trim()) params.set('name', f.q.trim());
      if (f.from) params.set('dateFrom', f.from);
      if (f.to) params.set('dateTo', f.to);
      if (f.status !== 'all') params.set('status', f.status);
      if (f.payment !== 'all') params.set('payment', f.payment);
      if (shop) params.set('partnerId', shop);
      const res = await fetch(`/api/admin/orders?${params}`, { cache: 'no-store' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(data.error || 'We couldn’t load the orders.');
      if (ticket !== latest.current) return;
      setOrders(data.orders);
      setPage(data.page);
      setTotalPages(Math.max(1, data.totalPages));
      setTotalCount(data.totalCount);
      setCounts(data.statusCounts);
      setMoney(data.financials);
      const url = new URL(window.location.href);
      if (data.page <= 1) url.searchParams.delete('page');
      else url.searchParams.set('page', String(data.page));
      window.history.replaceState({}, '', url);
    } catch (e) {
      if (ticket === latest.current) setError(e instanceof Error ? e.message : 'We couldn’t load the orders.');
    } finally {
      if (ticket === latest.current) setLoading(false);
    }
  }, [filters, partnerId]);

  useEffect(() => {
    void fetchOrders(Number(searchParams.get('page')) || 1, filters, partnerId);
    // Only on first load. Searches and page changes call fetchOrders themselves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const search = (next = filters, shop = partnerId) => fetchOrders(1, next, shop);
  const set = (patch: Partial<typeof filters>) => setFilters((f) => ({ ...f, ...patch }));
  const pickShop = (id: string | null) => {
    setPartnerId(id);
    void search(filters, id);
    if (id) setTab('orders');
  };
  const hasFilters = filters.q || filters.from || filters.to || filters.status !== 'all' || filters.payment !== 'all' || partnerId;
  const clear = () => {
    const blank = { q: '', from: '', to: '', status: 'all', payment: 'all' };
    setFilters(blank);
    setPartnerId(null);
    void fetchOrders(1, blank, null);
  };

  const checkPayments = async () => {
    setChecking(true);
    try {
      const res = await fetch('/api/admin/check-pending-payments', { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'The payment check failed.');
      toast.success(data.message || 'Payments checked');
      await fetchOrders(1);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'The payment check failed.');
    } finally {
      setChecking(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Orders and shops"
        description="Everything customers have ordered, and the shops that print it."
        actions={
          <>
            <Button variant="outline" onClick={() => fetchOrders(page)} disabled={loading}><RefreshCw className={loading ? 'animate-spin' : ''} />Refresh</Button>
            <Button variant="outline" onClick={checkPayments} disabled={checking}>{checking ? <Loader2 className="animate-spin" /> : null}Check pending payments</Button>
          </>
        }
      />

      <section aria-label="Summary" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Sales (paid orders)" value={money ? rupees(money.totalSales) : '—'} hint="Before the 3% processing fee" />
        <Stat label="Owed to shops" value={money ? rupees(money.partnerPayouts) : '—'} hint="90% of printing, plus shop delivery fees" />
        <Stat label="Kept by Fun Printing" value={money ? rupees(money.platformRevenue) : '—'} hint="Courier costs are paid from this" />
        <Stat label="Waiting for a shop" value={counts?.waitingForShop ?? '—'} hint={counts ? `${counts.awaitingPayment} unpaid · ${counts.inProgress} in progress · ${counts.onTheWay} on the way` : undefined} />
      </section>
      {money && (partnerId || filters.q || filters.from || filters.to || filters.status !== 'all' || filters.payment !== 'all') ? (
        <p className="mt-2 text-xs text-muted-foreground">The money figures follow the filters below. The counts are for all orders.</p>
      ) : null}

      <Tabs value={tab} onValueChange={setTab} className="mt-8">
        <TabsList>
          <TabsTrigger value="orders">Orders</TabsTrigger>
          <TabsTrigger value="shops">Shops</TabsTrigger>
        </TabsList>

        <TabsContent value="orders" className="mt-4 space-y-4">
          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              void search();
            }}
          >
            <div className="space-y-1.5"><Label htmlFor="f-q">Customer or order number</Label><Input id="f-q" className="w-56" value={filters.q} onChange={(e) => set({ q: e.target.value })} /></div>
            <div className="space-y-1.5"><Label htmlFor="f-from">From</Label><Input id="f-from" type="date" value={filters.from} onChange={(e) => set({ from: e.target.value })} /></div>
            <div className="space-y-1.5"><Label htmlFor="f-to">To</Label><Input id="f-to" type="date" value={filters.to} onChange={(e) => set({ to: e.target.value })} /></div>
            <div className="space-y-1.5">
              <Label htmlFor="f-status">Status</Label>
              <Select value={filters.status} onValueChange={(v) => { const n = { ...filters, status: v }; setFilters(n); void search(n); }}>
                <SelectTrigger id="f-status" className="w-48"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Any status</SelectItem>
                  {Object.entries(ORDER_STATUS).map(([value, info]) => <SelectItem key={value} value={value}>{info.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="f-pay">Payment</Label>
              <Select value={filters.payment} onValueChange={(v) => { const n = { ...filters, payment: v }; setFilters(n); void search(n); }}>
                <SelectTrigger id="f-pay" className="w-40"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Any payment</SelectItem>
                  <SelectItem value="completed">Paid</SelectItem>
                  <SelectItem value="pending">Not paid</SelectItem>
                  <SelectItem value="failed">Failed</SelectItem>
                  <SelectItem value="refunded">Refunded</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button type="submit" disabled={loading}>Search</Button>
            {hasFilters ? <Button type="button" variant="ghost" onClick={clear}><X />Clear</Button> : null}
          </form>
          {partnerId ? <Badge variant="secondary">Showing one shop’s orders</Badge> : null}

          {error ? <Alert variant="destructive"><AlertTitle>Something went wrong</AlertTitle><AlertDescription>{error}</AlertDescription></Alert> : null}

          <div className="overflow-x-auto rounded-lg border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Order</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Delivery</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {orders === null ? (
                  <TableRow><TableCell colSpan={5} className="py-10 text-center"><Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" aria-label="Loading orders" /></TableCell></TableRow>
                ) : orders.length === 0 ? (
                  <TableRow><TableCell colSpan={5} className="py-10 text-center text-muted-foreground">No orders match.</TableCell></TableRow>
                ) : (
                  orders.map((o) => {
                    const c = o.customerInfo?.name ? o.customerInfo : o.studentInfo;
                    return (
                      <TableRow key={o._id} className="cursor-pointer" onClick={() => router.push(`/admin/orders/${o._id}?fromPage=${page}`)}>
                        <TableCell>
                          <Link href={`/admin/orders/${o._id}?fromPage=${page}`} className="font-mono text-sm font-medium hover:underline" onClick={(e) => e.stopPropagation()}>{o.orderId}</Link>
                          <p className="text-xs text-muted-foreground">{when(o.createdAt)} · {o.orderType === 'template' ? 'Template' : 'Files'}</p>
                        </TableCell>
                        <TableCell><p className="text-sm">{c?.name || '—'}</p><p className="text-xs text-muted-foreground">{c?.phone || ''}</p></TableCell>
                        <TableCell className="text-sm">{deliveryText(o)}</TableCell>
                        <TableCell className="text-right tabular-nums">{rupees(o.amount)}</TableCell>
                        <TableCell>
                          <div className="flex flex-wrap items-center gap-1.5">
                            <StatusBadge status={o.status} />
                            {o.paymentStatus === 'refunded' || o.paymentStatus === 'failed' ? <Badge variant="outline">Payment {o.paymentStatus}</Badge> : null}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>

          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span>{totalCount ? `${(page - 1) * PAGE_SIZE + 1}–${Math.min(page * PAGE_SIZE, totalCount)} of ${totalCount}` : '0 orders'}</span>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => fetchOrders(page - 1)} disabled={page <= 1 || loading}><ChevronLeft />Previous</Button>
              <span>Page {page} of {totalPages}</span>
              <Button variant="outline" size="sm" onClick={() => fetchOrders(page + 1)} disabled={page >= totalPages || loading}>Next<ChevronRight /></Button>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="shops" className="mt-4">
          <AdminPartnersView selectedPartnerId={partnerId} onSelectPartner={pickShop} />
        </TabsContent>
      </Tabs>
    </>
  );
}

export default function AdminDashboardPage() {
  return (
    <Suspense fallback={<div className="grid place-items-center py-20"><Loader2 className="size-6 animate-spin text-muted-foreground" aria-label="Loading" /></div>}>
      <Dashboard />
    </Suspense>
  );
}
