'use client';

import { useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { Bike, Check, ChevronDown, List, Loader2, LocateFixed, Map as MapIcon, MapPin, Store, Truck } from 'lucide-react';
import { cn } from '@/lib/utils';
import { estimateAtShop, type OrderFile } from '@/lib/order/files';
import type { PartnerPricing } from '@/lib/payments/quote';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

const MapComponent = dynamic(() => import('@/components/MapComponent'), {
  ssr: false,
  loading: () => <Skeleton className="h-[500px] w-full rounded-xl" />,
});

/** What a shop offers for home delivery (from /api/partners/nearby). */
export interface ShopDeliverySummary {
  courier: boolean;
  self: { radiusKm: number; fee: number; etaMinutes: number } | null;
}

export interface ShopChoice {
  id: string;
  name: string;
  deliveryPoint?: string;
  delivery?: ShopDeliverySummary;
}

interface Shop {
  _id: string;
  businessName: string;
  location: { coordinates: [number, number] };
  address: { street?: string; city?: string };
  pricing?: any;
  servicesOffered?: any;
  deliveryPoints?: Array<{ name: string; location: { type: 'Point'; coordinates: [number, number] }; isActive: boolean }>;
  delivery?: ShopDeliverySummary;
  distance?: number;
  calculatedPrice?: number;
}

const FALLBACK_PRICING: PartnerPricing = { perPageBW: 2, perPageColor: 5, binding: 30 };
const PAGE_SIZE = 10;

/**
 * Nearby approved shops with this order's price at each. The price uses the same
 * formula as checkout (estimateAtShop → quotePrintOrder).
 */
export function ShopPicker({ files, value, onChange }: { files: OrderFile[]; value?: ShopChoice; onChange: (choice: ShopChoice, printingPrice: number | null) => void }) {
  const [where, setWhere] = useState<{ lat: number; lng: number; approximate: boolean } | null>(null);
  const [locating, setLocating] = useState(true);
  const [shops, setShops] = useState<Shop[] | null>(null);
  const [error, setError] = useState('');
  const [view, setView] = useState<'list' | 'map'>('list');
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [open, setOpen] = useState<string | null>(null);

  const needs = useMemo(
    () => ({
      color: files.some((f) => f.color !== 'bw'),
      binding: files.some((f) => f.finishing === 'binding'),
      a3: files.some((f) => f.pageSize === 'A3'),
    }),
    [files]
  );

  // Where the customer is: precise if allowed, else approximate from the IP address
  const locate = () => {
    setLocating(true);
    setError('');
    const viaIp = async () => {
      try {
        const data = await (await fetch('https://ipwho.is/')).json();
        if (data?.success && data.latitude && data.longitude) setWhere({ lat: data.latitude, lng: data.longitude, approximate: true });
        else setError('We couldn’t find your location. Allow location access and try again.');
      } catch {
        setError('We couldn’t find your location. Allow location access and try again.');
      } finally {
        setLocating(false);
      }
    };
    if (!navigator.geolocation) return void viaIp();
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setWhere({ lat: pos.coords.latitude, lng: pos.coords.longitude, approximate: false });
        setLocating(false);
      },
      () => void viaIp(),
      { enableHighAccuracy: true, timeout: 8000 }
    );
  };
  useEffect(locate, []);

  useEffect(() => setPage(1), [needs.color, needs.binding, needs.a3]);

  useEffect(() => {
    if (!where) return;
    let stale = false;
    setShops(null);
    const qs = new URLSearchParams({ lat: String(where.lat), lng: String(where.lng), radius: '20', page: String(page), limit: String(PAGE_SIZE) });
    if (needs.color) qs.set('color', 'true');
    if (needs.binding) qs.set('binding', 'true');
    if (needs.a3) qs.set('a3', 'true');
    fetch(`/api/partners/nearby?${qs}`)
      .then((r) => r.json())
      .then((data) => {
        if (stale) return;
        if (!data.success) throw new Error(data.error);
        setShops(data.partners);
        setPages(data.pagination?.totalPages || 1);
      })
      .catch(() => !stale && (setShops([]), setError('Could not load print shops. Please try again.')));
    return () => {
      stale = true;
    };
  }, [where, page, needs.color, needs.binding, needs.a3]);

  const priced = useMemo(
    () => (shops ?? []).map((s) => ({ ...s, calculatedPrice: estimateAtShop(files, s.pricing ?? FALLBACK_PRICING) ?? undefined })),
    [shops, files]
  );

  // Keep the parent's price in step when options change
  const selected = priced.find((s) => s._id === value?.id);
  useEffect(() => {
    if (selected && value) onChange(value, selected.calculatedPrice ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when the price changes
  }, [selected?.calculatedPrice]);

  const choose = (s: Shop, deliveryPoint?: string) => {
    const withPrice = priced.find((p) => p._id === s._id);
    onChange({ id: s._id, name: s.businessName, deliveryPoint, delivery: s.delivery }, withPrice?.calculatedPrice ?? null);
  };

  if (locating && !where) {
    return <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status"><Loader2 className="size-4 animate-spin" aria-hidden />Finding print shops near you…</p>;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {where ? (where.approximate ? 'Shops near your approximate location.' : 'Shops within 20 km of you.') : null}
          {where?.approximate ? (
            <Button variant="link" size="sm" className="h-auto px-1" onClick={locate}><LocateFixed />Use my exact location</Button>
          ) : null}
        </p>
        <div className="inline-flex rounded-lg border p-0.5" role="tablist" aria-label="Shop view">
          {(['list', 'map'] as const).map((v) => (
            <button key={v} role="tab" aria-selected={view === v} onClick={() => setView(v)} className={cn('inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm', view === v ? 'bg-accent font-medium text-accent-foreground' : 'text-muted-foreground hover:text-foreground')}>
              {v === 'list' ? <List className="size-4" aria-hidden /> : <MapIcon className="size-4" aria-hidden />}{v === 'list' ? 'List' : 'Map'}
            </button>
          ))}
        </div>
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      {view === 'map' && where ? (
        <div className="overflow-hidden rounded-xl border">
          <MapComponent userLocation={[where.lat, where.lng]} partners={priced} onSelectPartner={(p, dp) => choose(p as Shop, dp)} selectedPartnerId={value?.id} selectedDeliveryPoint={value?.deliveryPoint} />
        </div>
      ) : shops === null ? (
        <div className="space-y-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-24 rounded-xl" />)}</div>
      ) : !priced.length ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed p-8 text-center">
          <Store className="size-8 text-muted-foreground" aria-hidden />
          <p className="font-medium">No print shops nearby</p>
          <p className="max-w-sm text-sm text-muted-foreground">
            {needs.color || needs.binding || needs.a3 ? 'No shop near you offers everything this order needs (colour, binding or A3). Try changing those options.' : 'There are no approved shops within 20 km yet.'}
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {priced.map((s) => {
            const isSelected = value?.id === s._id;
            const expanded = open === s._id;
            const points = (s.deliveryPoints ?? []).filter((dp) => dp.isActive);
            return (
              <li key={s._id} className={cn('rounded-xl border transition-colors', isSelected ? 'border-primary ring-1 ring-primary' : 'hover:border-foreground/20')}>
                <div className="flex flex-wrap items-center gap-4 p-4">
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-2 font-medium">
                      {s.businessName}
                      {isSelected ? <Check className="size-4 text-primary" aria-label="Selected" /> : null}
                    </p>
                    <p className="truncate text-sm text-muted-foreground">{[s.address?.street, s.address?.city].filter(Boolean).join(', ')}</p>
                    <div className="mt-2 flex flex-wrap gap-1.5 text-xs text-muted-foreground">
                      {s.distance !== undefined ? <span className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5"><MapPin className="size-3" aria-hidden />{s.distance.toFixed(1)} km</span> : null}
                      {s.delivery?.self ? <span className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5"><Bike className="size-3" aria-hidden />Delivers within {s.delivery.self.radiusKm} km</span> : null}
                      {s.delivery?.courier ? <span className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5"><Truck className="size-3" aria-hidden />Courier delivery</span> : null}
                      {!s.delivery?.self && !s.delivery?.courier ? <span className="rounded-md bg-muted px-2 py-0.5">Pickup only</span> : null}
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-lg font-semibold tabular-nums">{s.calculatedPrice !== undefined ? `₹${s.calculatedPrice}` : '—'}</p>
                    <p className="text-xs text-muted-foreground">printing</p>
                  </div>
                  <Button variant={isSelected && !value?.deliveryPoint ? 'default' : 'outline'} onClick={() => choose(s)} aria-pressed={isSelected && !value?.deliveryPoint}>
                    {isSelected && !value?.deliveryPoint ? 'Selected' : 'Choose'}
                  </Button>
                </div>
                <button type="button" onClick={() => setOpen(expanded ? null : s._id)} aria-expanded={expanded} className="flex w-full items-center justify-between border-t px-4 py-2 text-sm text-muted-foreground hover:text-foreground">
                  Prices{points.length ? ' and pickup points' : ''}
                  <ChevronDown className={cn('size-4 transition-transform', expanded && 'rotate-180')} aria-hidden />
                </button>
                {expanded ? (
                  <div className="space-y-4 border-t bg-muted/30 p-4 text-sm">
                    <dl className="grid grid-cols-3 gap-3">
                      {[
                        ['B&W page', s.pricing?.printing?.a4?.blackAndWhite?.singleSided ?? s.pricing?.perPageBW ?? FALLBACK_PRICING.perPageBW],
                        ['Colour page', s.pricing?.printing?.a4?.color?.singleSided ?? s.pricing?.perPageColor ?? FALLBACK_PRICING.perPageColor],
                        ['Binding', typeof s.pricing?.binding === 'number' ? s.pricing.binding : (s.pricing?.binding?.spiral ?? FALLBACK_PRICING.binding)],
                      ].map(([k, v]) => (
                        <div key={k} className="rounded-lg border bg-background p-3">
                          <dt className="text-xs text-muted-foreground">{k}</dt>
                          <dd className="font-medium">₹{v}</dd>
                        </div>
                      ))}
                    </dl>
                    <p className="text-xs text-muted-foreground">A3 costs twice as much; double-sided 1.5×.</p>
                    {points.length ? (
                      <div className="space-y-2">
                        <p className="font-medium">Pick up from a delivery point instead</p>
                        {points.map((dp) => {
                          const on = isSelected && value?.deliveryPoint === dp.name;
                          return (
                            <div key={dp.name} className="flex items-center justify-between gap-3 rounded-lg border bg-background p-3">
                              <span className="flex items-center gap-2"><MapPin className="size-4 text-muted-foreground" aria-hidden />{dp.name}</span>
                              <span className="flex items-center gap-2">
                                <a href={`https://www.google.com/maps?q=${dp.location.coordinates[1]},${dp.location.coordinates[0]}`} target="_blank" rel="noopener noreferrer" className="text-xs text-primary hover:underline">Map</a>
                                <Button size="sm" variant={on ? 'default' : 'outline'} onClick={() => choose(s, dp.name)} aria-pressed={on}>{on ? 'Selected' : 'Choose'}</Button>
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {pages > 1 && view === 'list' ? (
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Page {page} of {pages}</span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>
            <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
