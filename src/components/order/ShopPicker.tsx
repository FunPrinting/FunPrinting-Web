'use client';

import { useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { Bike, Building2, Check, ChevronDown, List, Loader2, LocateFixed, Map as MapIcon, MapPin, Phone, Store, Truck } from 'lucide-react';
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
  distance?: number;
  address?: string;
}

interface DeliveryPoint {
  _id?: string;
  name: string;
  location: { type: 'Point'; coordinates: [number, number] };
  contactNumber?: string;
  distance?: number;
  isActive: boolean;
}

interface Shop {
  _id: string;
  businessName: string;
  location: { coordinates: [number, number] };
  address: { street?: string; city?: string };
  pricing?: any;
  servicesOffered?: any;
  deliveryPoints?: DeliveryPoint[];
  delivery?: ShopDeliverySummary;
  distance?: number;
  phoneNumbers?: string[];
  calculatedPrice?: number;
}

export interface PickupLocationItem {
  key: string;
  type: 'shop' | 'point';
  partnerId: string;
  partnerName: string;
  name: string;
  address: string;
  contactNumber?: string;
  deliveryPoint?: string;
  distance?: number;
  delivery?: ShopDeliverySummary;
  pricing?: any;
  servicesOffered?: any;
  calculatedPrice?: number;
}

const FALLBACK_PRICING: PartnerPricing = { perPageBW: 2, perPageColor: 5, binding: 30 };
const PAGE_SIZE = 10;

/**
 * Pickup locations list (Option A: displays each main shop and each pickup point directly).
 */
export function ShopPicker({ files, value, onChange }: { files: OrderFile[]; value?: ShopChoice; onChange: (choice: ShopChoice, printingPrice: number | null) => void }) {
  const [where, setWhere] = useState<{ lat: number; lng: number } | null>(null);
  const [locating, setLocating] = useState(true);
  const [shops, setShops] = useState<Shop[] | null>(null);
  const [error, setError] = useState('');
  const [view, setView] = useState<'list' | 'map'>('list');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<string | null>(null);

  const needs = useMemo(
    () => ({
      color: files.some((f) => f.color !== 'bw'),
      binding: files.some((f) => f.finishing === 'binding'),
      a3: files.some((f) => f.pageSize === 'A3'),
    }),
    [files]
  );

  // Exact browser GPS location ONLY (no inaccurate IP guessing)
  const locate = () => {
    setLocating(true);
    setError('');
    if (typeof window === 'undefined' || !navigator.geolocation) {
      setLocating(false);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setWhere({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setLocating(false);
      },
      () => {
        // Location denied or unavailable. Keep where as null so no fake distance is shown.
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 8000 }
    );
  };

  useEffect(locate, []);
  useEffect(() => setPage(1), [needs.color, needs.binding, needs.a3]);

  // Fetch shops & delivery points from backend
  useEffect(() => {
    let stale = false;
    setShops(null);
    const qs = new URLSearchParams({ limit: '50' });
    if (where) {
      qs.set('lat', String(where.lat));
      qs.set('lng', String(where.lng));
    }
    if (needs.color) qs.set('color', 'true');
    if (needs.binding) qs.set('binding', 'true');
    if (needs.a3) qs.set('a3', 'true');

    fetch(`/api/partners/nearby?${qs}`)
      .then((r) => r.json())
      .then((data) => {
        if (stale) return;
        if (!data.success) throw new Error(data.error);
        const list: Shop[] = data.partners || [];
        setShops(list);
      })
      .catch(() => !stale && (setShops([]), setError('Could not load print shops. Please try again.')));

    return () => {
      stale = true;
    };
  }, [where, needs.color, needs.binding, needs.a3]);

  // Transform partners and their delivery points into Option A flat pickup locations
  const allLocations: PickupLocationItem[] = useMemo(() => {
    if (!shops) return [];
    const items: PickupLocationItem[] = [];

    shops.forEach((s) => {
      const price = estimateAtShop(files, s.pricing ?? FALLBACK_PRICING) ?? undefined;
      const shopAddr = [s.address?.street, s.address?.city].filter(Boolean).join(', ');

      // 1. The main print shop workshop
      items.push({
        key: `${s._id}-main`,
        type: 'shop',
        partnerId: s._id,
        partnerName: s.businessName,
        name: s.businessName,
        address: shopAddr || 'Shop address',
        contactNumber: s.phoneNumbers?.[0],
        deliveryPoint: undefined,
        distance: s.distance,
        delivery: s.delivery,
        pricing: s.pricing,
        servicesOffered: s.servicesOffered,
        calculatedPrice: price,
      });

      // 2. Each active delivery point
      (s.deliveryPoints || []).forEach((dp) => {
        if (dp.isActive === false) return;
        items.push({
          key: `${s._id}-dp-${dp.name}`,
          type: 'point',
          partnerId: s._id,
          partnerName: s.businessName,
          name: dp.name,
          address: `Pickup Point · Delivered by ${s.businessName}`,
          contactNumber: dp.contactNumber,
          deliveryPoint: dp.name,
          distance: dp.distance,
          delivery: s.delivery,
          pricing: s.pricing,
          servicesOffered: s.servicesOffered,
          calculatedPrice: price,
        });
      });
    });

    // If real GPS coordinates are available, sort closest first
    if (where) {
      items.sort((a, b) => (a.distance ?? Infinity) - (b.distance ?? Infinity));
    }

    return items;
  }, [shops, files, where]);

  // Auto pre-select first location if nothing is selected yet
  useEffect(() => {
    if (!value && allLocations.length > 0) {
      const first = allLocations[0];
      onChange(
        {
          id: first.partnerId,
          name: first.partnerName,
          deliveryPoint: first.deliveryPoint,
          delivery: first.delivery,
          distance: first.distance,
          address: first.address,
        },
        first.calculatedPrice ?? null
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once when locations load
  }, [allLocations.length]);

  // Keep parent's selected location updated when file options or prices change
  const selectedLoc = allLocations.find(
    (loc) => loc.partnerId === value?.id && (loc.deliveryPoint ? loc.deliveryPoint === value?.deliveryPoint : !value?.deliveryPoint)
  );

  useEffect(() => {
    if (selectedLoc && value) {
      onChange(
        {
          ...value,
          distance: selectedLoc.distance,
          address: selectedLoc.address,
        },
        selectedLoc.calculatedPrice ?? null
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedLoc?.calculatedPrice, files.length]);

  const chooseLocation = (loc: PickupLocationItem) => {
    onChange(
      {
        id: loc.partnerId,
        name: loc.partnerName,
        deliveryPoint: loc.deliveryPoint,
        delivery: loc.delivery,
        distance: loc.distance,
        address: loc.address,
      },
      loc.calculatedPrice ?? null
    );
  };

  // Pagination for Option A (10 locations per page)
  const totalLocations = allLocations.length;
  const totalPages = Math.ceil(totalLocations / PAGE_SIZE) || 1;
  const paginatedLocations = allLocations.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <div className="space-y-4">
      {/* View Switcher and Location Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          {locating && !where ? (
            <span className="flex items-center gap-1.5">
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
              Finding closest locations…
            </span>
          ) : !where ? (
            <span className="flex items-center gap-1.5">
              Showing all pickup points & print shops.
              <Button variant="link" size="sm" className="h-auto p-0 font-normal underline" onClick={locate}>
                <LocateFixed className="size-3.5 mr-1 inline" />
                Sort by distance
              </Button>
            </span>
          ) : (
            <span className="flex items-center gap-1.5">
              Locations sorted by distance (closest first).
            </span>
          )}
        </div>

        <div className="inline-flex rounded-lg border p-0.5" role="tablist" aria-label="Location view">
          {(['list', 'map'] as const).map((v) => (
            <button
              key={v}
              role="tab"
              aria-selected={view === v}
              onClick={() => setView(v)}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm',
                view === v ? 'bg-accent font-medium text-accent-foreground' : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {v === 'list' ? <List className="size-4" aria-hidden /> : <MapIcon className="size-4" aria-hidden />}
              {v === 'list' ? 'List' : 'Map'}
            </button>
          ))}
        </div>
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      {/* Map View */}
      {view === 'map' ? (
        <div className="overflow-hidden rounded-xl border">
          <MapComponent
            userLocation={where ? [where.lat, where.lng] : undefined}
            partners={(shops ?? []).map((s) => ({
              ...s,
              calculatedPrice: estimateAtShop(files, s.pricing ?? FALLBACK_PRICING) ?? undefined,
            }))}
            onSelectPartner={(partner, dpName) => {
              const target = allLocations.find(
                (l) => l.partnerId === partner._id && (dpName ? l.deliveryPoint === dpName : !l.deliveryPoint)
              );
              if (target) chooseLocation(target);
            }}
            selectedPartnerId={value?.id}
            selectedDeliveryPoint={value?.deliveryPoint}
          />
        </div>
      ) : shops === null ? (
        <div className="space-y-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-24 rounded-xl" />)}</div>
      ) : !paginatedLocations.length ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed p-8 text-center">
          <Store className="size-8 text-muted-foreground" aria-hidden />
          <p className="font-medium">No pickup locations available</p>
          <p className="max-w-sm text-sm text-muted-foreground">
            {needs.color || needs.binding || needs.a3
              ? 'No location offers everything this order needs (colour, binding or A3). Try changing those options.'
              : 'There are no active pickup locations available right now.'}
          </p>
        </div>
      ) : (
        /* List View (Option A: Direct listing of each shop and delivery point) */
        <ul className="space-y-3">
          {paginatedLocations.map((loc) => {
            const isSelected = value?.id === loc.partnerId && (
              loc.type === 'point' ? value?.deliveryPoint === loc.deliveryPoint : !value?.deliveryPoint
            );
            const expanded = open === loc.key;

            return (
              <li
                key={loc.key}
                className={cn(
                  'rounded-xl border transition-colors',
                  isSelected ? 'border-primary ring-1 ring-primary bg-primary/[0.02]' : 'hover:border-foreground/20'
                )}
              >
                <div className="flex flex-wrap items-center gap-4 p-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      {loc.type === 'point' ? (
                        <span className="inline-flex items-center gap-1 rounded-md bg-indigo-500/10 px-2 py-0.5 text-xs font-semibold text-indigo-600 dark:text-indigo-400">
                          <Store className="size-3" aria-hidden />
                          Pickup Point
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-md bg-emerald-500/10 px-2 py-0.5 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                          <Building2 className="size-3" aria-hidden />
                          Main Workshop
                        </span>
                      )}
                      {isSelected ? (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-primary">
                          <Check className="size-3.5" aria-label="Selected" />
                          Selected
                        </span>
                      ) : null}
                    </div>

                    <p className="mt-1 font-semibold text-base leading-tight text-foreground">
                      {loc.name}
                    </p>

                    <p className="text-sm text-muted-foreground mt-0.5">
                      {loc.type === 'point' ? (
                        <span>Pickup point delivered by <strong className="font-medium text-foreground/80">{loc.partnerName}</strong></span>
                      ) : (
                        loc.address
                      )}
                    </p>

                    {loc.contactNumber ? (
                      <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
                        <Phone className="size-3 text-muted-foreground" aria-hidden />
                        {loc.contactNumber}
                      </p>
                    ) : null}

                    <div className="mt-2.5 flex flex-wrap gap-1.5 text-xs text-muted-foreground">
                      {loc.distance !== undefined ? (
                        <span className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 font-medium text-foreground">
                          <MapPin className="size-3 text-primary" aria-hidden />
                          {loc.distance.toFixed(1)} km away
                        </span>
                      ) : null}
                      {loc.type === 'point' ? (
                        <span className="rounded-md bg-muted px-2 py-0.5">Campus / Local Pickup</span>
                      ) : (
                        <>
                          {loc.delivery?.self ? (
                            <span className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5">
                              <Bike className="size-3" aria-hidden />
                              Delivers within {loc.delivery.self.radiusKm} km
                            </span>
                          ) : null}
                          {loc.delivery?.courier ? (
                            <span className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5">
                              <Truck className="size-3" aria-hidden />
                              Courier delivery available
                            </span>
                          ) : null}
                        </>
                      )}
                    </div>
                  </div>

                  <div className="text-right">
                    <p className="text-lg font-semibold tabular-nums">
                      {loc.calculatedPrice !== undefined
                        ? `₹${loc.calculatedPrice}`
                        : files.length === 0
                        ? `From ₹${loc.pricing?.printing?.a4?.blackAndWhite?.singleSided ?? loc.pricing?.perPageBW ?? FALLBACK_PRICING.perPageBW}`
                        : '—'}
                    </p>
                    <p className="text-xs text-muted-foreground">{files.length === 0 ? 'per page' : 'printing'}</p>
                  </div>

                  <Button
                    variant={isSelected ? 'default' : 'outline'}
                    onClick={() => chooseLocation(loc)}
                    aria-pressed={isSelected}
                    className="sm:min-w-[90px]"
                  >
                    {isSelected ? 'Selected' : 'Choose'}
                  </Button>
                </div>

                <button
                  type="button"
                  onClick={() => setOpen(expanded ? null : loc.key)}
                  aria-expanded={expanded}
                  className="flex w-full items-center justify-between border-t px-4 py-2 text-xs text-muted-foreground hover:text-foreground"
                >
                  View rates & specifications
                  <ChevronDown className={cn('size-3.5 transition-transform', expanded && 'rotate-180')} aria-hidden />
                </button>

                {expanded ? (
                  <div className="space-y-3 border-t bg-muted/30 p-4 text-xs">
                    <dl className="grid grid-cols-3 gap-2">
                      {[
                        ['B&W page', loc.pricing?.printing?.a4?.blackAndWhite?.singleSided ?? loc.pricing?.perPageBW ?? FALLBACK_PRICING.perPageBW],
                        ['Colour page', loc.pricing?.printing?.a4?.color?.singleSided ?? loc.pricing?.perPageColor ?? FALLBACK_PRICING.perPageColor],
                        ['Binding', typeof loc.pricing?.binding === 'number' ? loc.pricing.binding : (loc.pricing?.binding?.spiral ?? FALLBACK_PRICING.binding)],
                      ].map(([k, v]) => (
                        <div key={k} className="rounded-lg border bg-background p-2.5">
                          <dt className="text-muted-foreground">{k}</dt>
                          <dd className="font-semibold text-sm">₹{v}</dd>
                        </div>
                      ))}
                    </dl>
                    <p className="text-muted-foreground">A3 costs twice as much; double-sided 1.5×.</p>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {/* Pagination Controls */}
      {totalPages > 1 && view === 'list' ? (
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Page {page} of {totalPages} ({totalLocations} locations)</span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>
            <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>Next</Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
