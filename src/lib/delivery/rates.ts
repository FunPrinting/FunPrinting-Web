import 'server-only';
import { checkServiceability, isShiprocketConfigured } from '@/lib/shiprocket';

/**
 * Delivery speed tiers with prices. Used by GET /api/delivery/rate (shown to the
 * customer) and by checkout (charged), so both always agree.
 *
 * Shiprocket rates are used when configured; otherwise a weight-based estimate
 * (₹26 per 500 g, express 1.5×, same-day 2×).
 */
export type DeliverySpeed = 'standard' | 'express' | 'sameday';

export interface SpeedTier {
  id: DeliverySpeed;
  label: string;
  description: string;
  emoji: string;
  deliveryCharge: number; // rupees
  estimatedDays: number;
  courierName: string;
}

export interface DeliveryQuote {
  tiers: SpeedTier[];
  source: 'shiprocket' | 'estimated';
  weight: number;
}

export const DEFAULT_PICKUP_PINCODE = '263139';

export function isValidPincode(pincode: unknown): pincode is string {
  return typeof pincode === 'string' && /^[1-9]\d{5}$/.test(pincode);
}

function estimatedTiers(weight: number): SpeedTier[] {
  const slabs = Math.ceil((weight * 1000) / 500);
  const standard = Math.max(26, slabs * 26);
  return [
    { id: 'standard', label: 'Standard', description: '3-5 business days', emoji: '📦', deliveryCharge: standard, estimatedDays: 5, courierName: 'Standard Delivery' },
    { id: 'express', label: 'Express', description: '1-2 business days', emoji: '🚀', deliveryCharge: Math.ceil(standard * 1.5), estimatedDays: 2, courierName: 'Express Delivery' },
    { id: 'sameday', label: 'Same Day', description: 'Within 4-6 hours', emoji: '⚡', deliveryCharge: Math.ceil(standard * 2), estimatedDays: 0, courierName: 'Speed Delivery' },
  ];
}

export async function getDeliveryQuote(deliveryPincode: string, weight: number, pickupPincode?: string): Promise<DeliveryQuote> {
  const pickup = pickupPincode || process.env.SHIPROCKET_PICKUP_PINCODE || DEFAULT_PICKUP_PINCODE;

  if (isShiprocketConfigured()) {
    try {
      const result = await checkServiceability(pickup, deliveryPincode, weight, false);
      if (result.success && result.allRates && result.allRates.length > 0) {
        const rates = [...result.allRates].sort((a, b) => a.rate - b.rate);
        const cheapest = rates[0];
        const express = rates.filter((r) => r.estimatedDays >= 2 && r.estimatedDays <= 3).sort((a, b) => a.estimatedDays - b.estimatedDays)[0];
        const sameday = rates.filter((r) => r.estimatedDays <= 1)[0];
        const tiers: SpeedTier[] = [
          {
            id: 'standard',
            label: 'Standard',
            description: `${Math.max(cheapest.estimatedDays, 3)}-${Math.max(cheapest.estimatedDays + 2, 5)} business days`,
            emoji: '📦',
            deliveryCharge: Math.ceil(cheapest.rate),
            estimatedDays: Math.max(cheapest.estimatedDays, 3),
            courierName: cheapest.courierName,
          },
          express
            ? { id: 'express', label: 'Express', description: `${express.estimatedDays}-${express.estimatedDays + 1} business days`, emoji: '🚀', deliveryCharge: Math.ceil(express.rate), estimatedDays: express.estimatedDays, courierName: express.courierName }
            : { id: 'express', label: 'Express', description: '2-3 business days', emoji: '🚀', deliveryCharge: Math.ceil(cheapest.rate * 1.5), estimatedDays: 2, courierName: 'Priority Express' },
          sameday
            ? { id: 'sameday', label: 'Same Day', description: 'Within 4-6 hours', emoji: '⚡', deliveryCharge: Math.ceil(sameday.rate), estimatedDays: 0, courierName: sameday.courierName }
            : { id: 'sameday', label: 'Same Day', description: 'Within 4-6 hours', emoji: '⚡', deliveryCharge: Math.ceil(cheapest.rate * 2), estimatedDays: 0, courierName: 'Speed Express' },
        ];
        return { tiers, source: 'shiprocket', weight };
      }
    } catch (error) {
      console.warn('Shiprocket rate lookup failed, using estimated delivery rates:', error instanceof Error ? error.message : error);
    }
  }
  return { tiers: estimatedTiers(weight), source: 'estimated', weight };
}

export function tierCharge(quote: DeliveryQuote, speed: DeliverySpeed = 'standard'): SpeedTier {
  return quote.tiers.find((t) => t.id === speed) ?? quote.tiers[0];
}
