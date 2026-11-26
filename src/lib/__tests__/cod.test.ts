import { describe, expect, it } from 'vitest';
import { evaluateCodEligibility, normalisePartnerCod, partnerCodSchema } from '@/lib/cod';
import { checkPartnerTransition } from '@/lib/partnerOrderTransitions';

describe('COD eligibility engine', () => {
  const activeCfg = { enabled: true, allowAtPickupPoints: false, maxOrderAmount: 200, cashFee: 10 };

  it('allows store pickup within cap when partner enabled COD', () => {
    expect(
      evaluateCodEligibility({
        deliveryType: 'pickup',
        subtotalRupees: 150,
        partnerCod: activeCfg,
      })
    ).toEqual({ eligible: true, cashFee: 10, maxOrderAmount: 200 });
  });

  it('rejects when partner has COD disabled (Razorpay only)', () => {
    const res = evaluateCodEligibility({
      deliveryType: 'pickup',
      subtotalRupees: 50,
      partnerCod: { enabled: false },
    });
    expect(res.eligible).toBe(false);
  });

  it('rejects blocked or defaulted users immediately', () => {
    const res = evaluateCodEligibility({
      deliveryType: 'pickup',
      subtotalRupees: 50,
      partnerCod: activeCfg,
      failedCodCount: 1,
    });
    expect(res.eligible).toBe(false);
    if (!res.eligible) expect(res.reason).toContain('disabled');
  });

  it('rejects pickup points unless allowAtPickupPoints is enabled, and rejects home delivery', () => {
    expect(
      evaluateCodEligibility({
        deliveryType: 'pickup',
        pickupPointName: 'Gate 1',
        subtotalRupees: 50,
        partnerCod: activeCfg,
      }).eligible
    ).toBe(false);

    expect(
      evaluateCodEligibility({
        deliveryType: 'pickup',
        pickupPointName: 'Gate 1',
        subtotalRupees: 50,
        partnerCod: { ...activeCfg, allowAtPickupPoints: true },
      }).eligible
    ).toBe(true);

    expect(
      evaluateCodEligibility({
        deliveryType: 'delivery',
        subtotalRupees: 50,
        partnerCod: activeCfg,
      }).eligible
    ).toBe(false);
  });

  it('rejects amounts above shop cap and clamps config bounds', () => {
    expect(
      evaluateCodEligibility({
        deliveryType: 'pickup',
        subtotalRupees: 250,
        partnerCod: activeCfg,
      }).eligible
    ).toBe(false);

    expect(normalisePartnerCod({ enabled: true, maxOrderAmount: 5000, cashFee: -10 })).toEqual({
      enabled: true,
      allowAtPickupPoints: false,
      maxOrderAmount: 1000,
      cashFee: 0,
    });

    expect(partnerCodSchema.safeParse({ enabled: true, maxOrderAmount: 300, cashFee: 5 }).success).toBe(true);
    expect(partnerCodSchema.safeParse({ enabled: true, maxOrderAmount: 10, cashFee: 5 }).success).toBe(false);
  });
});

describe('COD fulfilment transitions', () => {
  it('blocks advancing unapproved COD orders', () => {
    expect(
      checkPartnerTransition({ status: 'pending_cod_approval', paymentMethod: 'cod', paymentStatus: 'cod_pending' }, 'printing')
    ).toMatchObject({ ok: false });
  });

  it('allows printing and ready_for_pickup on approved COD orders and requires cash confirmation at completed', () => {
    expect(
      checkPartnerTransition({ status: 'processing', paymentMethod: 'cod', paymentStatus: 'cod_pending' }, 'printing')
    ).toEqual({ ok: true, needsHandoverCode: false });

    expect(
      checkPartnerTransition({ status: 'ready_for_pickup', paymentMethod: 'cod', paymentStatus: 'cod_pending' }, 'completed')
    ).toEqual({ ok: true, needsHandoverCode: false, needsCashConfirmation: true });
  });
});
