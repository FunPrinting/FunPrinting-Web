import 'server-only';
import { checkServiceability, isShiprocketConfigured } from '@/lib/shiprocket';

/**
 * Courier speed tiers with prices, quoted from the shop's pincode to the customer's.
 * Used by GET /api/delivery/options (shown) and by checkout (charged), so both agree.
 *
 * Only speeds a real courier offers are listed. Without Shiprocket credentials (local
 * development) a weight-based standard estimate is returned instead.
 */
export type DeliverySpeed = 'standard' | 'express' | 'sameday';

export interface SpeedTier {
  id: DeliverySpeed;
  label: string;
  description: string;
  deliveryCharge: number; // rupees
  estimatedDays: number;
  courierName: string;
}

export interface DeliveryQuote {
  tiers: SpeedTier[];
  source: 'shiprocket' | 'estimated';
  weight: number;
}

export function isValidPincode(pincode: unknown): pincode is string {
  return typeof pincode === 'string' && /^[1-9]\d{5}$/.test(pincode);
}

const days = (n: number) => (n <= 1 ? '1 business day' : `${n}–${n + 1} business days`);

function estimatedTiers(weight: number): SpeedTier[] {
  const slabs = Math.ceil((weight * 1000) / 500);
  return [{ id: 'standard', label: 'Standard courier', description: '3–5 business days', deliveryCharge: Math.max(26, slabs * 26), estimatedDays: 5, courierName: 'Courier' }];
}

/** Returns no tiers when no courier serves the route. */
export async function getDeliveryQuote(deliveryPincode: string, weight: number, pickupPincode: string): Promise<DeliveryQuote> {
  if (!isShiprocketConfigured()) return { tiers: estimatedTiers(weight), source: 'estimated', weight };

  const result = await checkServiceability(pickupPincode, deliveryPincode, weight, false);
  const rates = result.success ? [...(result.allRates ?? [])].sort((a, b) => a.rate - b.rate) : [];
  if (!rates.length) return { tiers: [], source: 'shiprocket', weight };

  const cheapest = rates[0];
  const tiers: SpeedTier[] = [
    { id: 'standard', label: 'Standard courier', description: days(Math.max(cheapest.estimatedDays, 1)), deliveryCharge: Math.ceil(cheapest.rate), estimatedDays: cheapest.estimatedDays, courierName: cheapest.courierName },
  ];
  // A faster courier, if one exists and costs more than the cheapest
  const fastest = [...rates].sort((a, b) => a.estimatedDays - b.estimatedDays || a.rate - b.rate)[0];
  if (fastest.estimatedDays < cheapest.estimatedDays) {
    tiers.push({
      id: fastest.estimatedDays <= 1 ? 'sameday' : 'express',
      label: fastest.estimatedDays <= 1 ? 'Next-day courier' : 'Express courier',
      description: days(fastest.estimatedDays),
      deliveryCharge: Math.ceil(fastest.rate),
      estimatedDays: fastest.estimatedDays,
      courierName: fastest.courierName,
    });
  }
  return { tiers, source: 'shiprocket', weight };
}
