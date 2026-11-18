import { describe, expect, it } from 'vitest';
import { checkPartnerTarget, checkPartnerTransition, fulfilmentOf } from '@/lib/partnerOrderTransitions';

const paid = (status: string, deliveryOption?: Record<string, unknown>) => ({ status, paymentStatus: 'completed', deliveryOption });
const shop = (status: string, verified = false) => paid(status, { type: 'delivery', method: 'shop', handover: verified ? { verifiedAt: new Date() } : {} });
const courier = (status: string) => paid(status, { type: 'delivery', method: 'courier' });

describe('checkPartnerTarget', () => {
  it.each(['printing', 'printed', 'ready_for_pickup', 'dispatched', 'delivered', 'completed'])('allows %s', (s) => {
    expect(checkPartnerTarget(s)).toEqual({ ok: true });
  });

  it.each(['cancelled', 'refunded', 'paid', 'pending_payment', 'out_for_delivery', '', 42, null])(
    'rejects %s',
    (s) => {
      expect(checkPartnerTarget(s).ok).toBe(false);
    }
  );
});

describe('checkPartnerTransition', () => {
  it('allows forward moves, including skipping steps', () => {
    expect(checkPartnerTransition(paid('paid'), 'printing').ok).toBe(true);
    expect(checkPartnerTransition(paid('printing'), 'ready_for_pickup').ok).toBe(true);
    expect(checkPartnerTransition(paid('ready_for_pickup'), 'completed').ok).toBe(true);
  });

  it('rejects backward and same-status moves', () => {
    expect(checkPartnerTransition(paid('printed'), 'printing').ok).toBe(false);
    expect(checkPartnerTransition(paid('printing'), 'printing').ok).toBe(false);
    expect(checkPartnerTransition(paid('completed'), 'delivered').ok).toBe(false);
  });

  it('rejects unpaid orders and payment/terminal states', () => {
    expect(checkPartnerTransition({ status: 'paid', paymentStatus: 'pending' }, 'printing')).toEqual({ ok: false, error: 'Order is not paid' });
    expect(checkPartnerTransition(paid('cancelled'), 'printing').ok).toBe(false);
    expect(checkPartnerTransition(paid('refunded'), 'completed').ok).toBe(false);
    expect(checkPartnerTransition(paid('pending_payment'), 'printing').ok).toBe(false);
  });
});

describe('after printing, by how the order reaches the customer', () => {
  it('treats old delivery orders without a method as courier deliveries', () => {
    expect(fulfilmentOf(paid('printed', { type: 'delivery' }))).toBe('courier');
    expect(fulfilmentOf(paid('printed'))).toBe('pickup');
  });

  it('pickup: ready for pickup, not out for delivery', () => {
    expect(checkPartnerTransition(paid('printed'), 'ready_for_pickup').ok).toBe(true);
    expect(checkPartnerTransition(paid('printed'), 'dispatched').ok).toBe(false);
  });

  it('shop delivery: out for delivery, then delivered with the handover code', () => {
    expect(checkPartnerTransition(shop('printed'), 'dispatched')).toEqual({ ok: true, needsHandoverCode: false });
    expect(checkPartnerTransition(shop('printed'), 'ready_for_pickup').ok).toBe(false);
    expect(checkPartnerTransition(shop('dispatched'), 'delivered')).toEqual({ ok: true, needsHandoverCode: true });
    expect(checkPartnerTransition(shop('dispatched', true), 'completed')).toEqual({ ok: true, needsHandoverCode: false });
  });

  it('courier: the shop stops at printed', () => {
    expect(checkPartnerTransition(courier('printing'), 'printed').ok).toBe(true);
    for (const target of ['ready_for_pickup', 'dispatched', 'delivered', 'completed']) {
      expect(checkPartnerTransition(courier('printed'), target).ok).toBe(false);
    }
  });
});
