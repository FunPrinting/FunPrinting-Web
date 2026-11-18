'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import { Bike, Building2, Check, Clock, Download, Laptop, Loader2, LocateFixed, Plus, RefreshCw, Smartphone, Trash2, Truck, Wallet, X } from 'lucide-react';
import PartnerDevices from '@/components/partner/PartnerDevices';
import { statusInfo } from '@/lib/orderStatus';
import { fulfilmentOf, nextPartnerStatuses, PARTNER_STATUS_LABEL } from '@/lib/partnerOrderTransitions';
import { orderPartnerShare } from '@/lib/payments/money';
import { cn } from '@/lib/utils';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';


type Partner = any;
type PartnerOrder = any;

const RELEASES = {
  windows: 'https://github.com/FunPrinting/partner-desktop/releases/latest/download/FunPrintingPartner-Setup.exe',
  mac: 'https://github.com/FunPrinting/partner-desktop/releases/latest/download/FunPrintingPartner-Setup.dmg',
  android: 'https://github.com/FunPrinting/partner-mobile/releases/latest/download/FunPrintingPartner.apk',
  desktopAll: 'https://github.com/FunPrinting/partner-desktop/releases/latest',
};

const TONE = { neutral: 'bg-muted text-muted-foreground', primary: 'bg-accent text-accent-foreground', success: 'bg-success/10 text-success', warning: 'bg-warning/10 text-warning', danger: 'bg-destructive/10 text-destructive' };

const rupees = (n: number) => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

async function saveProfile(patch: Record<string, unknown>) {
  const res = await fetch('/api/partner/profile', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.success) throw new Error(data.error || 'Could not save');
  return data.partner as Partner;
}

// ── Onboarding ────────────────────────────────────────────────────────

function Onboarding({ onDone }: { onDone: (p: Partner) => void }) {
  const [form, setForm] = useState({ businessName: '', street: '', city: '', state: '', zipCode: '', razorpayAccountId: '' });
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [locating, setLocating] = useState(false);
  const [saving, setSaving] = useState(false);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });

  const locate = () => {
    if (!navigator.geolocation) return toast.error('Your browser can’t share its location. Try another browser.');
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setLocating(false);
      },
      () => {
        setLocating(false);
        toast.error('Allow location access so customers nearby can find your shop.');
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!coords) return toast.error('Add your shop’s location first');
    setSaving(true);
    try {
      const partner = await saveProfile({
        businessName: form.businessName.trim(),
        razorpayAccountId: form.razorpayAccountId.trim() || undefined,
        location: { type: 'Point', coordinates: [coords.lng, coords.lat] },
        address: { street: form.street.trim(), city: form.city.trim(), state: form.state.trim(), zipCode: form.zipCode.trim() },
      });
      onDone(partner);
      toast.success('Application sent. We’ll email you when it is approved.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <CardTitle className="text-xl">Set up your shop</CardTitle>
        <CardDescription>Tell customers where you are. FunPrinting reviews new shops before they go live.</CardDescription>
      </CardHeader>
      <form onSubmit={submit}>
        <CardContent className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="businessName">Shop name</Label>
            <Input id="businessName" required value={form.businessName} onChange={set('businessName')} placeholder="Campus Quick Print" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="street">Street address</Label>
            <Input id="street" required value={form.street} onChange={set('street')} placeholder="Shop 4, Main Market" />
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-2"><Label htmlFor="city">City</Label><Input id="city" required value={form.city} onChange={set('city')} /></div>
            <div className="space-y-2"><Label htmlFor="state">State</Label><Input id="state" required value={form.state} onChange={set('state')} /></div>
            <div className="space-y-2"><Label htmlFor="zip">PIN code</Label><Input id="zip" required inputMode="numeric" pattern="[0-9]{6}" value={form.zipCode} onChange={set('zipCode')} /></div>
          </div>
          <div className="space-y-2">
            <Label>Location on the map</Label>
            <div className="flex flex-wrap items-center gap-3">
              <Button type="button" variant="outline" onClick={locate} disabled={locating}>
                {locating ? <Loader2 className="animate-spin" /> : <LocateFixed />}
                {coords ? 'Update location' : 'Use my current location'}
              </Button>
              <span className="text-sm text-muted-foreground">
                {coords ? `${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)}` : 'Do this from inside your shop. You can fine-tune it later in the Partner app.'}
              </span>
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="acc">Razorpay linked account ID <span className="font-normal text-muted-foreground">(optional)</span></Label>
            <Input id="acc" value={form.razorpayAccountId} onChange={set('razorpayAccountId')} placeholder="acc_XXXXXXXXXXXX" pattern="acc_[A-Za-z0-9]+" />
            <p className="text-xs text-muted-foreground">Your 90% share is paid to this account after each order prints. If you don’t have one, we help you set it up during review.</p>
          </div>
        </CardContent>
        <CardFooter className="border-t pt-6">
          <Button type="submit" disabled={saving}>{saving ? <Loader2 className="animate-spin" /> : null}Send application</Button>
        </CardFooter>
      </form>
    </Card>
  );
}

// ── Orders ────────────────────────────────────────────────────────────

function OrdersTab({ orders, setOrders, reload, loading }: { orders: PartnerOrder[]; setOrders: (o: PartnerOrder[]) => void; reload: () => void; loading: boolean }) {
  const [decline, setDecline] = useState<PartnerOrder | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [filter, setFilter] = useState<'open' | 'all'>('open');
  const [handover, setHandover] = useState<PartnerOrder | null>(null);
  const [code, setCode] = useState('');
  const [codeError, setCodeError] = useState('');
  const toAccept = orders.filter((o) => o.job?.status === 'pending_acceptance');
  const shown = filter === 'all' ? orders : orders.filter((o) => !['completed', 'delivered', 'cancelled', 'refunded', 'pending_payment'].includes(o.status));

  const jobAction = async (order: PartnerOrder, action: 'accept' | 'reject', why?: string) => {
    setBusy(order.orderId);
    const res = await fetch(`/api/partner/v1/jobs/${encodeURIComponent(order.job.jobId)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(action === 'reject' ? { action, reason: why || undefined } : { action }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(null);
    if (!res.ok) return toast.error(data.error || `Could not ${action} the order`);
    toast.success(action === 'accept' ? 'Order accepted. It goes to your print queue.' : 'Order declined. The customer is refunded.');
    setOrders(orders.map((o) => (o.orderId === order.orderId ? { ...o, status: action === 'reject' ? 'cancelled' : o.status, job: { ...o.job, status: action === 'accept' ? 'queued' : 'cancelled' } } : o)));
  };

  const move = async (order: PartnerOrder, status: string, handoverCode?: string) => {
    // Shop delivery: ask for the customer's code first
    if (status === 'delivered' && fulfilmentOf(order) === 'shop' && handoverCode === undefined) {
      setCode('');
      setCodeError('');
      setHandover(order);
      return;
    }
    setBusy(order.orderId);
    const res = await fetch(`/api/partner/orders/${encodeURIComponent(order.orderId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(handoverCode === undefined ? { status } : { status, code: handoverCode }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(null);
    if (!res.ok) {
      if (handoverCode !== undefined) return setCodeError(data.error || 'Could not check the code');
      return toast.error(data.error || 'Could not update the order');
    }
    setHandover(null);
    if (status === 'delivered') toast.success(`Order #${order.orderId} delivered`);
    setOrders(orders.map((o) => (o.orderId === order.orderId ? (data.order ? { ...data.order, job: o.job } : { ...o, status }) : o)));
  };

  const bookCourier = async (order: PartnerOrder) => {
    setBusy(order.orderId);
    const res = await fetch(`/api/partner/orders/${encodeURIComponent(order.orderId)}/ship`, { method: 'POST' });
    const data = await res.json().catch(() => ({}));
    setBusy(null);
    if (!res.ok) return toast.error(data.error || 'Could not book the courier');
    toast.success(`Courier booked: ${data.courierName}. Keep the parcel ready for pickup (AWB ${data.awbCode}).`);
    setOrders(orders.map((o) => (o.orderId === order.orderId ? (data.order ? { ...data.order, job: o.job } : o) : o)));
  };

  return (
    <div className="space-y-6">
      {toAccept.length ? (
        <Card className="border-warning/40">
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Clock className="size-5 text-warning" aria-hidden />Waiting for your OK</CardTitle>
            <CardDescription>Accept within 10 minutes, or the customer is offered a refund. Orders not accepted in 24 hours are refunded.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {toAccept.map((o) => (
              <div key={o.orderId} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3">
                <div className="min-w-0">
                  <p className="font-mono text-sm font-semibold">#{o.orderId}</p>
                  <p className="truncate text-sm text-muted-foreground">{o.originalFileName || o.originalFileNames?.[0] || 'Document'} · {rupees(orderPartnerShare(o))} to you</p>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => { setReason(''); setDecline(o); }} disabled={busy === o.orderId}><X />Decline</Button>
                  <Button size="sm" onClick={() => jobAction(o, 'accept')} disabled={busy === o.orderId}>{busy === o.orderId ? <Loader2 className="animate-spin" /> : <Check />}Accept</Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 space-y-0">
          <CardTitle>Orders</CardTitle>
          <div className="flex items-center gap-2">
            <Tabs value={filter} onValueChange={(v) => setFilter(v as 'open' | 'all')}>
              <TabsList><TabsTrigger value="open">Open</TabsTrigger><TabsTrigger value="all">All</TabsTrigger></TabsList>
            </Tabs>
            <Button variant="outline" size="icon" onClick={reload} aria-label="Refresh orders"><RefreshCw className={cn(loading && 'animate-spin')} /></Button>
          </div>
        </CardHeader>
        <CardContent className="px-0">
          {shown.length ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-6">Order</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Document</TableHead>
                  <TableHead>Delivery</TableHead>
                  <TableHead className="text-right">Your share</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="pr-6">Move to</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {shown.map((o) => {
                  const info = statusInfo(o.job?.status === 'pending_acceptance' ? 'paid' : o.status);
                  const next = o.job?.status === 'pending_acceptance' ? [] : nextPartnerStatuses(o);
                  const how = fulfilmentOf(o);
                  const canBook = how === 'courier' && o.status === 'printed' && !o.shiprocket?.awbCode;
                  return (
                    <TableRow key={o.orderId}>
                      <TableCell className="pl-6 font-mono text-xs">{o.orderId}</TableCell>
                      <TableCell className="text-muted-foreground">{new Date(o.createdAt).toLocaleDateString('en-IN')}</TableCell>
                      <TableCell className="max-w-48 truncate">{o.originalFileName || o.originalFileNames?.[0] || 'Document'}</TableCell>
                      <TableCell className="text-sm">
                        <span className="flex items-center gap-1.5 text-muted-foreground">
                          {how === 'shop' ? <Bike className="size-4" aria-hidden /> : how === 'courier' ? <Truck className="size-4" aria-hidden /> : <Building2 className="size-4" aria-hidden />}
                          {how === 'shop' ? `You deliver${o.deliveryOption?.distance ? ` · ${o.deliveryOption.distance} km` : ''}` : how === 'courier' ? (o.shiprocket?.awbCode ? `Courier · ${o.shiprocket.courierName || 'booked'}` : 'Courier') : 'Pickup'}
                        </span>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{rupees(orderPartnerShare(o))}</TableCell>
                      <TableCell>
                        <span className={cn('rounded-full px-2.5 py-0.5 text-xs font-medium', TONE[info.tone])}>
                          {o.job?.status === 'pending_acceptance' ? 'Needs your OK' : info.label}
                        </span>
                      </TableCell>
                      <TableCell className="pr-6">
                        {canBook ? (
                          <Button size="sm" variant="outline" onClick={() => bookCourier(o)} disabled={busy === o.orderId}>
                            {busy === o.orderId ? <Loader2 className="animate-spin" /> : <Truck />}Book courier
                          </Button>
                        ) : next.length === 1 ? (
                          <Button size="sm" variant="outline" onClick={() => move(o, next[0])} disabled={busy === o.orderId}>
                            {busy === o.orderId ? <Loader2 className="animate-spin" /> : null}{PARTNER_STATUS_LABEL[next[0]] || next[0]}
                          </Button>
                        ) : next.length ? (
                          <Select onValueChange={(v) => move(o, v)} disabled={busy === o.orderId}>
                            <SelectTrigger size="sm" className="w-40" aria-label={`Move order ${o.orderId}`}><SelectValue placeholder="Move to…" /></SelectTrigger>
                            <SelectContent>{next.map((s) => <SelectItem key={s} value={s}>{PARTNER_STATUS_LABEL[s] || s}</SelectItem>)}</SelectContent>
                          </Select>
                        ) : <span className="text-xs text-muted-foreground">—</span>}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          ) : (
            <p className="px-6 py-10 text-center text-sm text-muted-foreground">No {filter === 'open' ? 'open ' : ''}orders. Stay online to receive orders.</p>
          )}
        </CardContent>
      </Card>

      <Dialog open={Boolean(decline)} onOpenChange={(o) => !o && setDecline(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Decline order #{decline?.orderId}?</DialogTitle>
            <DialogDescription>The customer is refunded straight away.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="reason">Reason (optional, for your records)</Label>
            <Input id="reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} placeholder="e.g. Out of colour ink today" />
          </div>
          <DialogFooter>
            <DialogClose asChild><Button variant="outline">Keep order</Button></DialogClose>
            <Button variant="destructive" onClick={async () => { const o = decline; setDecline(null); if (o) await jobAction(o, 'reject', reason.trim()); }}>Decline order</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(handover)} onOpenChange={(o) => !o && setHandover(null)}>
        <DialogContent>
          <form onSubmit={(e) => { e.preventDefault(); if (handover) move(handover, 'delivered', code); }}>
            <DialogHeader>
              <DialogTitle>Delivered order #{handover?.orderId}?</DialogTitle>
              <DialogDescription>Ask the customer for the 4-digit delivery code shown in their order.</DialogDescription>
            </DialogHeader>
            <div className="my-4 space-y-2">
              <Label htmlFor="handover-code">Delivery code</Label>
              <Input id="handover-code" value={code} onChange={(e) => { setCode(e.target.value.replace(/\D/g, '').slice(0, 4)); setCodeError(''); }} inputMode="numeric" autoComplete="one-time-code" maxLength={4} placeholder="0000" className="h-12 w-36 text-center font-mono text-2xl tracking-[0.4em]" aria-invalid={Boolean(codeError)} aria-describedby={codeError ? 'handover-error' : undefined} autoFocus />
              {codeError ? <p id="handover-error" className="text-sm text-destructive">{codeError}</p> : null}
            </div>
            <DialogFooter>
              <DialogClose asChild><Button type="button" variant="outline">Cancel</Button></DialogClose>
              <Button type="submit" disabled={code.length !== 4 || busy === handover?.orderId}>{busy === handover?.orderId ? <Loader2 className="animate-spin" /> : <Check />}Confirm delivery</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Shop settings ─────────────────────────────────────────────────────

function DeliveryCard({ partner, setPartner }: { partner: Partner; setPartner: (p: Partner) => void }) {
  const d = partner.delivery || {};
  const [courier, setCourier] = useState<boolean>(Boolean(d.courier?.enabled));
  const [self, setSelf] = useState<boolean>(Boolean(d.self?.enabled));
  const [radiusKm, setRadiusKm] = useState(String(d.self?.radiusKm ?? 3));
  const [fee, setFee] = useState(String(d.self?.fee ?? 30));
  const [eta, setEta] = useState(String(d.self?.etaMinutes ?? 120));
  const [saving, setSaving] = useState(false);
  const noAddress = !partner.address?.zipCode || !/^[1-9]\d{5}$/.test(partner.address.zipCode);

  const save = async () => {
    setSaving(true);
    try {
      const p = await saveProfile({
        delivery: {
          courier: { enabled: courier },
          self: { enabled: self, radiusKm: Number(radiusKm), fee: Math.round(Number(fee)), etaMinutes: Math.round(Number(eta)) },
        },
      });
      setPartner(p);
      toast.success('Delivery settings saved');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save');
    } finally {
      setSaving(false);
    }
  };

  const courierState = !d.courier?.enabled
    ? null
    : d.courier.pickupName
      ? { tone: 'text-success', text: 'Ready: couriers collect from your shop address.' }
      : d.courier.lastError
        ? { tone: 'text-destructive', text: `Not ready: ${d.courier.lastError}` }
        : partner.isActive
          ? { tone: 'text-muted-foreground', text: 'Setting up your pickup address…' }
          : { tone: 'text-muted-foreground', text: 'Starts once your shop is approved.' };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Home delivery</CardTitle>
        <CardDescription>Choose how customers can get orders delivered. With both off, customers collect from your shop.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <Label htmlFor="courier-switch" className="flex items-center gap-2"><Truck className="size-4" aria-hidden />Courier pickup from my shop</Label>
            <p className="text-sm text-muted-foreground">A courier collects the parcel from your shop and delivers anywhere in India. The customer pays the courier charge; you get your usual share of the printing.</p>
            {courierState ? <p className={cn('text-sm', courierState.tone)}>{courierState.text}</p> : null}
            {courier && noAddress ? <p className="text-sm text-warning">Add your full shop address with a 6-digit pincode in the Partner app first.</p> : null}
          </div>
          <Switch id="courier-switch" checked={courier} onCheckedChange={setCourier} />
        </div>

        <div className="space-y-4">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <Label htmlFor="self-switch" className="flex items-center gap-2"><Bike className="size-4" aria-hidden />I deliver orders myself</Label>
              <p className="text-sm text-muted-foreground">Offered only to customers within your radius. You keep the whole delivery fee. The customer gives you a 4-digit code when you hand over the order.</p>
            </div>
            <Switch id="self-switch" checked={self} onCheckedChange={setSelf} />
          </div>
          {self ? (
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-2">
                <Label htmlFor="radius">Radius (km)</Label>
                <Input id="radius" type="number" inputMode="decimal" min={0.5} max={25} step={0.5} value={radiusKm} onChange={(e) => setRadiusKm(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="fee">Delivery fee (₹)</Label>
                <Input id="fee" type="number" inputMode="numeric" min={0} max={1000} step={1} value={fee} onChange={(e) => setFee(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="eta">Usual time (minutes)</Label>
                <Input id="eta" type="number" inputMode="numeric" min={15} max={1440} step={15} value={eta} onChange={(e) => setEta(e.target.value)} />
              </div>
            </div>
          ) : null}
        </div>
      </CardContent>
      <CardFooter className="border-t pt-6">
        <Button onClick={save} disabled={saving}>{saving ? <Loader2 className="animate-spin" /> : null}Save delivery settings</Button>
      </CardFooter>
    </Card>
  );
}

function ShopTab({ partner, setPartner }: { partner: Partner; setPartner: (p: Partner) => void }) {
  const [phones, setPhones] = useState<string[]>(partner.phoneNumbers || []);
  const [points, setPoints] = useState<any[]>(partner.deliveryPoints || []);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      const p = await saveProfile({ phoneNumbers: phones.map((s) => s.trim()).filter(Boolean), deliveryPoints: points });
      setPartner(p);
      setPhones(p.phoneNumbers || []);
      setPoints(p.deliveryPoints || []);
      toast.success('Shop details saved');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
    <DeliveryCard partner={partner} setPartner={setPartner} />
    <Card>
      <CardHeader>
        <CardTitle>Contact numbers</CardTitle>
        <CardDescription>Prices, location and delivery points are edited in the Partner app (Shop page).</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Label>Shop phone numbers</Label>
            <Button type="button" variant="ghost" size="sm" onClick={() => setPhones([...phones, ''])}><Plus />Add</Button>
          </div>
          {phones.length ? phones.map((p, i) => (
            <div key={i} className="flex gap-2">
              <Input type="tel" value={p} onChange={(e) => setPhones(phones.map((x, j) => (j === i ? e.target.value : x)))} placeholder="+91 98765 43210" aria-label={`Phone ${i + 1}`} />
              <Button type="button" variant="ghost" size="icon" onClick={() => setPhones(phones.filter((_, j) => j !== i))} aria-label={`Remove phone ${i + 1}`}><Trash2 /></Button>
            </div>
          )) : <p className="text-sm text-muted-foreground">No phone numbers yet.</p>}
          <p className="text-xs text-muted-foreground">Shown to every customer who orders from you.</p>
        </div>
        {points.length ? (
          <div className="space-y-3">
            <Label>Delivery point numbers</Label>
            {points.map((dp, i) => (
              <div key={i} className="grid items-center gap-2 sm:grid-cols-[1fr_2fr]">
                <span className="text-sm font-medium">{dp.name}</span>
                <Input type="tel" value={dp.contactNumber || ''} onChange={(e) => setPoints(points.map((x, j) => (j === i ? { ...x, contactNumber: e.target.value } : x)))} placeholder="Contact for this point" aria-label={`Contact for ${dp.name}`} />
              </div>
            ))}
            <p className="text-xs text-muted-foreground">Shown only to customers who choose that delivery point.</p>
          </div>
        ) : null}
      </CardContent>
      <CardFooter className="border-t pt-6">
        <Button onClick={save} disabled={saving}>{saving ? <Loader2 className="animate-spin" /> : null}Save</Button>
      </CardFooter>
    </Card>
    </div>
  );
}

// ── Apps ──────────────────────────────────────────────────────────────

function AppsTab({ partner }: { partner: Partner }) {
  const [os, setOs] = useState<'windows' | 'mac' | 'other'>('windows');
  useEffect(() => {
    const ua = navigator.userAgent.toLowerCase();
    setOs(/mac/.test(ua) && !/iphone|ipad/.test(ua) ? 'mac' : /win/.test(ua) ? 'windows' : 'other');
  }, []);
  const desktop = os === 'mac' ? { href: RELEASES.mac, label: 'Download for macOS' } : os === 'windows' ? { href: RELEASES.windows, label: 'Download for Windows' } : { href: RELEASES.desktopAll, label: 'All downloads' };

  return (
    <div className="space-y-6">
      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <Laptop className="size-6 text-primary" aria-hidden />
            <CardTitle className="pt-2">Desktop app</CardTitle>
            <CardDescription>Install it on the computer connected to your printer. Paid orders print automatically, one at a time.</CardDescription>
          </CardHeader>
          <CardFooter className="flex flex-wrap gap-2">
            <Button asChild><a href={desktop.href}><Download />{desktop.label}</a></Button>
            <Button variant="ghost" asChild><a href={RELEASES.desktopAll} target="_blank" rel="noopener noreferrer">Other systems</a></Button>
          </CardFooter>
        </Card>
        <Card>
          <CardHeader>
            <Smartphone className="size-6 text-primary" aria-hidden />
            <CardTitle className="pt-2">Android app</CardTitle>
            <CardDescription>Accept orders and update their status from your phone. It can also print to a Wi-Fi printer.</CardDescription>
          </CardHeader>
          <CardFooter>
            <Button variant="outline" asChild><a href={RELEASES.android}><Download />Download .apk</a></Button>
          </CardFooter>
        </Card>
      </div>
      <Alert>
        <Wallet />
        <AlertTitle>Signing in to the apps</AlertTitle>
        <AlertDescription>Open the app and choose “Sign in”. Your browser opens; sign in with the Google account of this shop ({partner.businessName}). No ID or password to type.</AlertDescription>
      </Alert>
      {partner.isActive ? <PartnerDevices /> : null}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────

export default function PartnerDashboard() {
  const { status } = useSession();
  const router = useRouter();
  const [partner, setPartner] = useState<Partner | null | undefined>(undefined);
  const [orders, setOrders] = useState<PartnerOrder[]>([]);
  const [financials, setFinancials] = useState<{ todayEarnings: number; totalEarnings: number; completedOrdersCount: number } | null>(null);
  const [loadingOrders, setLoadingOrders] = useState(false);

  useEffect(() => {
    if (status === 'unauthenticated') router.push('/auth/signin?callbackUrl=/partner/dashboard');
  }, [status, router]);

  const loadOrders = useCallback(async () => {
    setLoadingOrders(true);
    try {
      const [o, f] = await Promise.all([fetch('/api/partner/orders').then((r) => r.json()), fetch('/api/partner/financials').then((r) => r.json())]);
      if (o.success) setOrders(o.orders);
      if (f.success) setFinancials(f.financials);
    } catch {
      toast.error('Could not load orders');
    } finally {
      setLoadingOrders(false);
    }
  }, []);

  useEffect(() => {
    if (status !== 'authenticated') return;
    (async () => {
      const data = await (await fetch('/api/partner/profile')).json().catch(() => ({}));
      setPartner(data.success ? data.partner : null);
      if (data.partner?.isActive) loadOrders();
    })();
  }, [status, loadOrders]);

  const pendingCount = useMemo(() => orders.filter((o) => o.job?.status === 'pending_acceptance').length, [orders]);

  if (partner === undefined) {
    return (
      <div className="mx-auto max-w-6xl space-y-6 px-4 py-10 sm:px-6">
        <Skeleton className="h-10 w-64" />
        <div className="grid gap-4 sm:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-28" />)}</div>
        <Skeleton className="h-80" />
      </div>
    );
  }

  if (!partner?.businessName) {
    return (
      <div className="mx-auto max-w-6xl space-y-6 px-4 py-10 sm:px-6">
        <div>
          <h1 className="text-3xl font-semibold">Become a FunPrinting partner</h1>
          <p className="mt-1 text-muted-foreground">Get print orders from students near your shop.</p>
        </div>
        <Onboarding onDone={setPartner} />
      </div>
    );
  }

  const toggle = async (key: 'isOnline' | 'acceptanceMode', value: boolean | string) => {
    const before = partner;
    setPartner({ ...partner, [key]: value });
    try {
      setPartner(await saveProfile({ [key]: value }));
    } catch (err) {
      setPartner(before);
      toast.error(err instanceof Error ? err.message : 'Could not save');
    }
  };

  return (
    <div className="mx-auto max-w-6xl space-y-8 px-4 py-10 sm:px-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold">{partner.businessName}</h1>
          <p className="mt-1 text-muted-foreground">{[partner.address?.city, partner.address?.state].filter(Boolean).join(', ') || 'Partner dashboard'}</p>
        </div>
        <Card className="flex-row items-center gap-3 px-4 py-3">
          <span className={cn('size-2.5 rounded-full', partner.isOnline && partner.isActive ? 'bg-success' : 'bg-muted-foreground/40')} aria-hidden />
          <Label htmlFor="online" className="text-sm">{partner.isOnline && partner.isActive ? 'Taking orders' : 'Not taking orders'}</Label>
          <Switch id="online" checked={Boolean(partner.isOnline)} disabled={!partner.isActive} onCheckedChange={(v) => toggle('isOnline', v)} />
        </Card>
      </div>

      {!partner.isActive ? (
        <Alert className="border-warning/30 bg-warning/5">
          <Clock className="text-warning" />
          <AlertTitle>Your application is under review</AlertTitle>
          <AlertDescription>We check your shop details and payout account, then email you. Meanwhile you can install the Partner app.</AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-3">
        {[
          { label: 'Today', value: rupees(financials?.todayEarnings ?? 0) },
          { label: 'All time (your 90%)', value: rupees(financials?.totalEarnings ?? partner.earnings?.totalRevenue ?? 0) },
          { label: 'Completed orders', value: String(financials?.completedOrdersCount ?? 0) },
        ].map((s) => (
          <Card key={s.label} className="gap-1 px-6 py-5">
            <p className="text-sm text-muted-foreground">{s.label}</p>
            <p className="text-2xl font-semibold tabular-nums">{s.value}</p>
          </Card>
        ))}
      </div>

      <Card className="flex-row flex-wrap items-center justify-between gap-4 px-6 py-5">
        <div className="max-w-xl">
          <p className="font-medium">New orders</p>
          <p className="text-sm text-muted-foreground">
            {partner.acceptanceMode === 'manual' ? 'You accept each paid order before it prints.' : 'Paid orders go straight to your print queue.'}
          </p>
        </div>
        <Tabs value={partner.acceptanceMode === 'manual' ? 'manual' : 'auto'} onValueChange={(v) => toggle('acceptanceMode', v)}>
          <TabsList aria-label="New orders">
            <TabsTrigger value="auto">Print automatically</TabsTrigger>
            <TabsTrigger value="manual">I accept first</TabsTrigger>
          </TabsList>
        </Tabs>
      </Card>

      <Tabs defaultValue={partner.isActive ? 'orders' : 'apps'}>
        <TabsList>
          <TabsTrigger value="orders" disabled={!partner.isActive}>Orders{pendingCount ? <span className="ml-1.5 rounded-full bg-destructive px-1.5 text-xs text-white">{pendingCount}</span> : null}</TabsTrigger>
          <TabsTrigger value="shop">Shop</TabsTrigger>
          <TabsTrigger value="apps">Apps & devices</TabsTrigger>
        </TabsList>
        <TabsContent value="orders" className="mt-6"><OrdersTab orders={orders} setOrders={setOrders} reload={loadOrders} loading={loadingOrders} /></TabsContent>
        <TabsContent value="shop" className="mt-6"><ShopTab partner={partner} setPartner={setPartner} /></TabsContent>
        <TabsContent value="apps" className="mt-6"><AppsTab partner={partner} /></TabsContent>
      </Tabs>
    </div>
  );
}
