import { z } from 'zod';

export const DEFAULT_COD_MAX_AMOUNT = 200;
export const MIN_COD_MAX_AMOUNT = 50;
export const MAX_COD_CAP = 1000;
export const MAX_COD_FEE = 50;

export interface PartnerCodConfig {
  enabled: boolean;
  allowAtPickupPoints: boolean;
  maxOrderAmount: number;
  cashFee: number;
}

export const partnerCodSchema = z.object({
  enabled: z.boolean(),
  allowAtPickupPoints: z.boolean().default(false),
  maxOrderAmount: z.number().int().min(MIN_COD_MAX_AMOUNT).max(MAX_COD_CAP).default(DEFAULT_COD_MAX_AMOUNT),
  cashFee: z.number().int().min(0).max(MAX_COD_FEE).default(0),
});

export function normalisePartnerCod(raw?: Partial<PartnerCodConfig> | null): PartnerCodConfig {
  return {
    enabled: Boolean(raw?.enabled),
    allowAtPickupPoints: Boolean(raw?.allowAtPickupPoints),
    maxOrderAmount:
      typeof raw?.maxOrderAmount === 'number' && Number.isFinite(raw.maxOrderAmount)
        ? Math.min(MAX_COD_CAP, Math.max(MIN_COD_MAX_AMOUNT, Math.round(raw.maxOrderAmount)))
        : DEFAULT_COD_MAX_AMOUNT,
    cashFee:
      typeof raw?.cashFee === 'number' && Number.isFinite(raw.cashFee)
        ? Math.min(MAX_COD_FEE, Math.max(0, Math.round(raw.cashFee)))
        : 0,
  };
}

export type CodEligibilityResult =
  | { eligible: true; cashFee: number; maxOrderAmount: number }
  | { eligible: false; reason: string; maxOrderAmount: number; cashFee: number };

export function evaluateCodEligibility(input: {
  deliveryType: 'pickup' | 'delivery';
  pickupPointName?: string | null;
  subtotalRupees: number;
  partnerCod?: Partial<PartnerCodConfig> | null;
  userCodBlocked?: boolean;
  failedCodCount?: number;
}): CodEligibilityResult {
  const cfg = normalisePartnerCod(input.partnerCod);

  if (!cfg.enabled) {
    return {
      eligible: false,
      reason: 'This print shop accepts online payments via Razorpay only.',
      maxOrderAmount: cfg.maxOrderAmount,
      cashFee: cfg.cashFee,
    };
  }

  if (input.userCodBlocked || (input.failedCodCount ?? 0) > 0) {
    return {
      eligible: false,
      reason: 'Cash on pickup is disabled for your account due to a prior uncollected COD order. Please pay online via Razorpay.',
      maxOrderAmount: cfg.maxOrderAmount,
      cashFee: cfg.cashFee,
    };
  }

  if (input.deliveryType !== 'pickup') {
    return {
      eligible: false,
      reason: 'Cash on pickup is only available for pickup orders. Home delivery uses Razorpay.',
      maxOrderAmount: cfg.maxOrderAmount,
      cashFee: cfg.cashFee,
    };
  }

  if (input.pickupPointName && !cfg.allowAtPickupPoints) {
    return {
      eligible: false,
      reason: 'Cash on pickup is enabled at the main store counter only. Use Razorpay for pickup-point orders.',
      maxOrderAmount: cfg.maxOrderAmount,
      cashFee: cfg.cashFee,
    };
  }

  if (input.subtotalRupees > cfg.maxOrderAmount) {
    return {
      eligible: false,
      reason: `Cash on pickup is capped at ₹${cfg.maxOrderAmount} for this shop. Pay online via Razorpay.`,
      maxOrderAmount: cfg.maxOrderAmount,
      cashFee: cfg.cashFee,
    };
  }

  return {
    eligible: true,
    cashFee: cfg.cashFee,
    maxOrderAmount: cfg.maxOrderAmount,
  };
}

export function isCodOrder(order: { paymentMethod?: string | null }): boolean {
  return order.paymentMethod === 'cod';
}

export function isCodCashPending(order: { paymentMethod?: string | null; paymentStatus?: string | null }): boolean {
  return order.paymentMethod === 'cod' && order.paymentStatus !== 'completed';
}

