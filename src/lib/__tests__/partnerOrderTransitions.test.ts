import { describe, expect, it } from 'vitest';
import { checkPartnerTarget, checkPartnerTransition } from '@/lib/partnerOrderTransitions';

const paid = (status: string) => ({ status, paymentStatus: 'completed' });

describe('checkPartnerTarget', () => {
  it.each(['printing', 'printed', 'ready_for_pickup', 'delivered', 'completed'])('allows %s', (s) => {
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
    expect(checkPartnerTransition(paid('dispatched'), 'delivered').ok).toBe(true);
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
