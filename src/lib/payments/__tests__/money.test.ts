import { describe, expect, it } from 'vitest';
import { orderPartnerShare, partnerShareOf } from '@/lib/payments/money';

describe('partner share with delivery', () => {
  it('90% of printing; the shop keeps its own delivery fee; courier charges are not shared', () => {
    expect(partnerShareOf({ subtotal: 9000, delivery: 4000, deliveryByShop: true })).toBe(4500 + 4000);
    expect(partnerShareOf({ subtotal: 7600, delivery: 2600, deliveryByShop: false })).toBe(4500);
    expect(orderPartnerShare({ amount: 50 })).toBe(45);
    expect(orderPartnerShare({ amount: 90, deliveryOption: { type: 'delivery', method: 'shop', deliveryCharge: 40 } })).toBe(85);
    expect(orderPartnerShare({ amount: 76, deliveryOption: { type: 'delivery', method: 'courier', deliveryCharge: 26 } })).toBe(45);
  });
});
