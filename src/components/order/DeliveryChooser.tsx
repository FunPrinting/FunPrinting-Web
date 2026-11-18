'use client';

import { useEffect, useRef, useState } from 'react';
import { Bike, Building2, Loader2, LocateFixed, Truck } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { PhoneNotice } from '@/components/PhoneNotice';
import type { ShopDeliverySummary } from '@/components/order/ShopPicker';

export type DeliverySpeedChoice = 'standard' | 'express' | 'sameday' | 'shop';

export interface DeliveryAddress {
  type: 'pickup' | 'delivery';
  recipientName?: string;
  recipientPhone?: string;
  flatBuilding?: string;
  address?: string;
  landmark?: string;
  city?: string;
  state?: string;
  pinCode?: string;
  location?: { lat: number; lng: number; address: string };
}

interface CourierTier { id: 'standard' | 'express' | 'sameday'; label: string; description: string; deliveryCharge: number; courierName: string }
interface Options {
  courier: CourierTier[];
  shop: { fee: number; etaMinutes: number; radiusKm: number; distanceKm: number } | null;
  shopUnavailable?: 'not_offered' | 'need_location' | 'too_far';
}

const eta = (minutes: number) => (minutes < 60 ? `${minutes} min` : minutes % 60 ? `${Math.floor(minutes / 60)} h ${minutes % 60} min` : `${minutes / 60} h`);

/**
 * Pickup or home delivery for the chosen shop. Delivery options come from
 * /api/delivery/options, which runs the same checks as checkout.
 */
export function DeliveryChooser({
  partnerId,
  shop,
  shopName,
  weightKg,
  value,
  speed,
  onChange,
}: {
  partnerId?: string;
  shop?: ShopDeliverySummary;
  shopName?: string;
  weightKg: number;
  value: DeliveryAddress;
  speed: DeliverySpeedChoice;
  /** charge is the delivery fee in rupees for the chosen option, or null while none is chosen */
  onChange: (next: DeliveryAddress, speed: DeliverySpeedChoice, charge: number | null) => void;
}) {
  const [options, setOptions] = useState<Options | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [locating, setLocating] = useState(false);
  const latest = useRef(0);
  const offersDelivery = Boolean(shop?.courier || shop?.self);
  const delivery = value.type === 'delivery';

  const set = (patch: Partial<DeliveryAddress>, nextSpeed = speed) => onChange({ ...value, ...patch }, nextSpeed, chargeFor(nextSpeed, options));

  function chargeFor(s: DeliverySpeedChoice, o: Options | null): number | null {
    if (!o) return null;
    if (s === 'shop') return o.shop ? o.shop.fee : null;
    return o.courier.find((t) => t.id === s)?.deliveryCharge ?? null;
  }

  // Fetch options for this shop and address (debounced)
  const pin = value.pinCode && /^[1-9]\d{5}$/.test(value.pinCode) ? value.pinCode : undefined;
  const lat = value.location?.lat;
  const lng = value.location?.lng;
  useEffect(() => {
    if (!delivery || !partnerId || (!pin && lat === undefined)) {
      setOptions(null);
      return;
    }
    const id = ++latest.current;
    setLoading(true);
    setError('');
    const t = setTimeout(async () => {
      const qs = new URLSearchParams({ partnerId, weight: String(weightKg) });
      if (pin) qs.set('pinCode', pin);
      if (lat !== undefined && lng !== undefined) { qs.set('lat', String(lat)); qs.set('lng', String(lng)); }
      try {
        const res = await fetch(`/api/delivery/options?${qs}`);
        const data = await res.json();
        if (id !== latest.current) return;
        if (!res.ok || !data.success) throw new Error(data.error || 'Could not check delivery');
        setOptions(data);
      } catch (e) {
        if (id === latest.current) { setOptions(null); setError(e instanceof Error ? e.message : 'Could not check delivery'); }
      } finally {
        if (id === latest.current) setLoading(false);
      }
    }, 400);
    return () => clearTimeout(t);
  }, [delivery, partnerId, pin, lat, lng, weightKg]);

  // Keep the chosen option valid; pick the first available one
  useEffect(() => {
    if (!delivery || !options) return;
    const available: DeliverySpeedChoice[] = [...(options.shop ? (['shop'] as const) : []), ...options.courier.map((t) => t.id)];
    const next = available.includes(speed) ? speed : available[0];
    const charge = next ? chargeFor(next, options) : null;
    onChange(value, next ?? speed, charge);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when the options change
  }, [options]);

  const locate = () => {
    if (!navigator.geolocation) return setError('Your browser cannot share its location.');
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        set({ location: { lat: pos.coords.latitude, lng: pos.coords.longitude, address: value.address || '' } });
      },
      () => {
        setLocating(false);
        setError('Location permission was denied. Allow it in your browser to check shop delivery.');
      },
      { enableHighAccuracy: true, timeout: 10_000 }
    );
  };

  if (!partnerId) {
    return <p className="text-sm text-muted-foreground">Choose a print shop above to see pickup and delivery options.</p>;
  }

  const choice = (active: boolean) => cn('flex w-full items-start gap-3 rounded-lg border p-4 text-left transition-colors', active ? 'border-primary bg-accent/40 ring-1 ring-primary' : 'hover:bg-muted/50');

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label="Pickup or delivery">
        <button type="button" role="radio" aria-checked={!delivery} className={choice(!delivery)} onClick={() => onChange({ ...value, type: 'pickup' }, speed, 0)}>
          <Building2 className="mt-0.5 size-5 text-muted-foreground" aria-hidden />
          <span>
            <span className="block font-medium">Pick up from the shop</span>
            <span className="text-sm text-muted-foreground">Free{shopName ? ` · ${shopName}` : ''}</span>
          </span>
        </button>
        <button type="button" role="radio" aria-checked={delivery} disabled={!offersDelivery} className={cn(choice(delivery), !offersDelivery && 'cursor-not-allowed opacity-60')} onClick={() => onChange({ ...value, type: 'delivery' }, speed, null)}>
          <Truck className="mt-0.5 size-5 text-muted-foreground" aria-hidden />
          <span>
            <span className="block font-medium">Deliver to me</span>
            <span className="text-sm text-muted-foreground">
              {!offersDelivery ? 'This shop doesn’t deliver' : [shop?.self ? `Shop delivers within ${shop.self.radiusKm} km` : null, shop?.courier ? 'Courier anywhere' : null].filter(Boolean).join(' · ')}
            </span>
          </span>
        </button>
      </div>
      {!offersDelivery ? <p className="text-sm text-muted-foreground">For home delivery, choose a shop marked “Courier delivery” or “Delivers within … km”.</p> : null}

      {delivery ? (
        <>
          <fieldset className="grid gap-4 sm:grid-cols-2">
            <legend className="mb-3 text-sm font-medium">Delivery address</legend>
            <div className="space-y-2">
              <Label htmlFor="d-name">Recipient name</Label>
              <Input id="d-name" autoComplete="name" value={value.recipientName || ''} onChange={(e) => set({ recipientName: e.target.value })} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="d-phone">Recipient mobile</Label>
              <Input id="d-phone" type="tel" inputMode="tel" autoComplete="tel" placeholder="98765 43210" value={value.recipientPhone || ''} onChange={(e) => set({ recipientPhone: e.target.value })} aria-describedby="d-phone-hint" required />
              <PhoneNotice id="d-phone-hint" />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="d-flat">Flat, house or building</Label>
              <Input id="d-flat" autoComplete="address-line1" value={value.flatBuilding || ''} onChange={(e) => set({ flatBuilding: e.target.value })} required />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="d-street">Street and area</Label>
              <Input id="d-street" autoComplete="address-line2" value={value.address || ''} onChange={(e) => set({ address: e.target.value })} required />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="d-landmark">Landmark (optional)</Label>
              <Input id="d-landmark" value={value.landmark || ''} onChange={(e) => set({ landmark: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="d-pin">Pincode</Label>
              <Input id="d-pin" inputMode="numeric" autoComplete="postal-code" maxLength={6} value={value.pinCode || ''} onChange={(e) => set({ pinCode: e.target.value.replace(/\D/g, '').slice(0, 6) })} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="d-city">City</Label>
              <Input id="d-city" autoComplete="address-level2" value={value.city || ''} onChange={(e) => set({ city: e.target.value })} required />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="d-state">State</Label>
              <Input id="d-state" autoComplete="address-level1" value={value.state || ''} onChange={(e) => set({ state: e.target.value })} required />
            </div>
          </fieldset>

          <div className="space-y-3">
            <p className="text-sm font-medium">How it reaches you</p>
            {shop?.self ? (
              options?.shop ? (
                <button type="button" role="radio" aria-checked={speed === 'shop'} className={choice(speed === 'shop')} onClick={() => set({}, 'shop')}>
                  <Bike className="mt-0.5 size-5 text-muted-foreground" aria-hidden />
                  <span className="flex-1">
                    <span className="block font-medium">Delivered by the shop</span>
                    <span className="text-sm text-muted-foreground">Usually within {eta(options.shop.etaMinutes)} of printing · {options.shop.distanceKm} km away. Give the delivery person the 4-digit code from your order.</span>
                  </span>
                  <span className="font-semibold tabular-nums">₹{options.shop.fee}</span>
                </button>
              ) : (
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-dashed p-4 text-sm">
                  <span className="flex items-start gap-3">
                    <Bike className="mt-0.5 size-5 text-muted-foreground" aria-hidden />
                    <span>
                      <span className="block font-medium">Delivered by the shop</span>
                      <span className="text-muted-foreground">
                        {options?.shopUnavailable === 'too_far'
                          ? `Your location is outside the shop’s ${shop.self.radiusKm} km delivery area.`
                          : `Share your location to check you are within ${shop.self.radiusKm} km.`}
                      </span>
                    </span>
                  </span>
                  <Button type="button" variant="outline" size="sm" onClick={locate} disabled={locating}>
                    {locating ? <Loader2 className="animate-spin" /> : <LocateFixed />}{value.location ? 'Update location' : 'Use my location'}
                  </Button>
                </div>
              )
            ) : null}

            {options?.courier.map((t) => (
              <button key={t.id} type="button" role="radio" aria-checked={speed === t.id} className={choice(speed === t.id)} onClick={() => set({}, t.id)}>
                <Truck className="mt-0.5 size-5 text-muted-foreground" aria-hidden />
                <span className="flex-1">
                  <span className="block font-medium">{t.label}</span>
                  <span className="text-sm text-muted-foreground">{t.description} after printing · {t.courierName}</span>
                </span>
                <span className="font-semibold tabular-nums">₹{t.deliveryCharge}</span>
              </button>
            ))}

            {shop?.courier && !pin ? <p className="text-sm text-muted-foreground">Enter your pincode to see courier prices.</p> : null}
            {shop?.courier && pin && options && !options.courier.length ? <p className="text-sm text-muted-foreground">No courier delivers from this shop to {pin}.</p> : null}
            {loading ? <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status"><Loader2 className="size-4 animate-spin" aria-hidden />Checking delivery options…</p> : null}
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
          </div>
        </>
      ) : null}
    </div>
  );
}
