import 'server-only';
import { createHash, randomInt } from 'node:crypto';
import connectDB from '@/lib/mongodb';
import Partner from '@/models/Partner';
import User from '@/models/User';
import { addPickupAddress, isShiprocketConfigured } from '@/lib/shiprocket';
import { getDeliveryQuote, isValidPincode, type SpeedTier } from '@/lib/delivery/rates';

/**
 * Home delivery for one shop. A shop can offer:
 * - courier: Shiprocket collects from the shop's own registered pickup address
 * - shop: the shop's own person delivers within its radius, for its own fee
 * - neither: pickup only
 * See docs/DELIVERY.md.
 */

export interface PartnerDeliveryFields {
  _id: unknown;
  businessName?: string;
  location?: { coordinates?: number[] };
  address?: { street?: string; city?: string; state?: string; zipCode?: string };
  phoneNumbers?: string[];
  userId?: string;
  isActive?: boolean;
  delivery?: {
    courier?: { enabled?: boolean; pickupName?: string; lastError?: string };
    self?: { enabled?: boolean; radiusKm?: number; fee?: number; etaMinutes?: number };
  };
}

export interface ShopDeliveryOption {
  fee: number; // rupees
  etaMinutes: number;
  radiusKm: number;
  distanceKm: number;
}

export interface DeliveryOptions {
  courier: SpeedTier[]; // empty when the shop doesn't use couriers or none serves the pincode
  courierSource?: 'shiprocket' | 'estimated';
  shop: ShopDeliveryOption | null;
  /** Why the shop's own delivery isn't offered (for the customer). */
  shopUnavailable?: 'not_offered' | 'need_location' | 'too_far';
  /** True if this shop offers any home delivery at all. */
  offersDelivery: boolean;
}

/** Unique per shop and address (max 36 chars): a new address registers a new pickup. */
export function pickupNickname(partnerId: string, address: PartnerDeliveryFields['address'] = {}): string {
  const digest = createHash('sha256').update([address.street, address.city, address.state, address.zipCode].join('|')).digest('hex').slice(0, 6);
  return `FP-${partnerId}-${digest}`;
}

/** Great-circle distance in km. */
export function distanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

export function shopPoint(p: PartnerDeliveryFields): { lat: number; lng: number } | null {
  const c = p.location?.coordinates;
  return Array.isArray(c) && c.length === 2 && Number.isFinite(c[0]) && Number.isFinite(c[1]) ? { lng: c[0], lat: c[1] } : null;
}

/** A courier can only be booked once the shop's pickup address is registered (or in local dev without Shiprocket). */
export function courierReady(p: PartnerDeliveryFields): boolean {
  return Boolean(p.delivery?.courier?.enabled && (p.delivery.courier.pickupName || !isShiprocketConfigured()));
}

export function shopDeliveryFor(p: PartnerDeliveryFields, customer?: { lat: number; lng: number } | null): Pick<DeliveryOptions, 'shop' | 'shopUnavailable'> {
  const self = p.delivery?.self;
  const shop = shopPoint(p);
  if (!self?.enabled || !shop) return { shop: null, shopUnavailable: 'not_offered' };
  if (!customer) return { shop: null, shopUnavailable: 'need_location' };
  const km = distanceKm(shop, customer);
  const radiusKm = self.radiusKm ?? 3;
  if (km > radiusKm) return { shop: null, shopUnavailable: 'too_far' };
  return { shop: { fee: self.fee ?? 0, etaMinutes: self.etaMinutes ?? 120, radiusKm, distanceKm: Math.round(km * 10) / 10 } };
}

export async function getDeliveryOptions(
  partner: PartnerDeliveryFields,
  input: { pinCode?: string; weightKg: number; location?: { lat: number; lng: number } | null }
): Promise<DeliveryOptions> {
  const shopPart = shopDeliveryFor(partner, input.location);
  let courier: SpeedTier[] = [];
  let courierSource: DeliveryOptions['courierSource'];
  const from = partner.address?.zipCode;
  if (courierReady(partner) && isValidPincode(input.pinCode) && isValidPincode(from)) {
    const quote = await getDeliveryQuote(input.pinCode, input.weightKg, from);
    courier = quote.tiers;
    courierSource = quote.source;
  }
  return {
    courier,
    courierSource,
    ...shopPart,
    offersDelivery: courierReady(partner) || shopPart.shopUnavailable !== 'not_offered',
  };
}

/** Four-digit code the customer gives the shop's delivery person. */
export function newHandoverCode(): string {
  return String(randomInt(0, 10_000)).padStart(4, '0');
}

/**
 * Registers the shop as a Shiprocket pickup address if it uses couriers and isn't
 * registered yet. Safe to call repeatedly; the outcome is saved on the partner.
 */
export async function ensureCourierPickup(partnerId: string): Promise<{ ok: boolean; error?: string }> {
  await connectDB();
  const partner = await Partner.findById(partnerId).lean<PartnerDeliveryFields | null>();
  if (!partner?.delivery?.courier?.enabled) return { ok: false, error: 'Courier delivery is off for this shop' };
  if (partner.delivery.courier.pickupName) return { ok: true };
  if (!partner.isActive) return { ok: false, error: 'The shop is waiting for approval' };
  if (!isShiprocketConfigured()) return { ok: false, error: 'Courier service is not configured' };

  const user = partner.userId ? await User.findById(partner.userId).select('email name phone').lean<{ email?: string; name?: string; phone?: string } | null>() : null;
  const a = partner.address ?? {};
  const result = await addPickupAddress({
    nickname: pickupNickname(String(partner._id), a),
    name: partner.businessName || user?.name || 'Print shop',
    email: user?.email || '',
    phone: partner.phoneNumbers?.[0] || user?.phone || '',
    address: a.street || '',
    city: a.city || '',
    state: a.state || '',
    pinCode: a.zipCode || '',
  });
  if (result.ok) {
    await Partner.updateOne(
      { _id: partner._id },
      { $set: { 'delivery.courier.pickupName': result.nickname, 'delivery.courier.registeredAt': new Date() }, $unset: { 'delivery.courier.lastError': '' } }
    );
    return { ok: true };
  }
  await Partner.updateOne({ _id: partner._id }, { $set: { 'delivery.courier.lastError': result.error } });
  return { ok: false, error: result.error };
}
