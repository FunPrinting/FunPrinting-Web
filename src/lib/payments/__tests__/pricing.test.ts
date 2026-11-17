import { describe, expect, it } from 'vitest';
import { normaliseColorPages, parcelWeightKg, quotePrintOrder, QuoteError, type GlobalPricing, type QuoteFile } from '@/lib/payments/quote';
import { assertChargeable, formatINR, percentOf, rupeesToPaise, withProcessingFee } from '@/lib/payments/money';

const global: GlobalPricing = {
  basePrices: { A4: 5, A3: 10 },
  multipliers: { color: 2, doubleSided: 1.5 },
  additionalServices: { binding: 20, minServiceFee: 5, minServiceFeePageLimit: 1 },
};
const partner = { perPageBW: 2, perPageColor: 10, binding: 30 };
const file = (o: Partial<QuoteFile> = {}): QuoteFile => ({ name: 'a.pdf', pages: 10, pageSize: 'A4', color: 'bw', sided: 'single', copies: 1, ...o });

describe('money', () => {
  it('converts rupees to paise without float drift', () => {
    expect(rupeesToPaise(0.1 + 0.2)).toBe(30);
    expect(rupeesToPaise(19.99)).toBe(1999);
    expect(rupeesToPaise(1.005)).toBe(101);
  });

  it('adds the 3% fee in paise, matching what the order page shows', () => {
    // UI: amount × 1.03 → ₹51.50 for ₹50
    expect(withProcessingFee(5000)).toEqual({ subtotal: 5000, fee: 150, total: 5150 });
    expect(withProcessingFee(3333)).toEqual({ subtotal: 3333, fee: 100, total: 3433 });
    expect(percentOf(10_000, 90)).toBe(9000);
  });

  it('enforces Razorpay limits', () => {
    expect(() => assertChargeable(99)).toThrow();
    expect(() => assertChargeable(100)).not.toThrow();
    expect(() => assertChargeable(10_000_001)).toThrow();
    expect(() => assertChargeable(150.5)).toThrow();
    expect(formatINR(5150)).toContain('51.50');
  });
});

describe('quotePrintOrder — partner pricing (formula of the order page map)', () => {
  it('B&W, colour, A3, double-sided, copies, binding', () => {
    expect(quotePrintOrder({ files: [file()], partnerPricing: partner, globalPricing: global }).subtotal).toBe(2000); // 10 × ₹2
    expect(quotePrintOrder({ files: [file({ color: 'color' })], partnerPricing: partner, globalPricing: global }).subtotal).toBe(10000);
    const fancy = file({ pageSize: 'A3', sided: 'double', copies: 3, service: 'binding' });
    // 10 × 2 × 2 × 1.5 × 3 = 180 + binding 30 × 3 = 90 → ₹270
    expect(quotePrintOrder({ files: [fancy], partnerPricing: partner, globalPricing: global }).subtotal).toBe(27000);
  });

  it('rounds up to the rupee per file', () => {
    // 3 pages × ₹2 × 1.5 (double) = ₹9; 1 page × 2 × 1.5 = ₹3; 1.5 pages impossible → use 0.5 multiplier case
    const q = quotePrintOrder({ files: [file({ pages: 1, sided: 'double', copies: 1 })], partnerPricing: { ...partner, perPageBW: 1.25 }, globalPricing: global });
    expect(q.subtotal).toBe(200); // 1.875 → ₹2
  });

  it('mixed colour charges every non-colour page as B&W (before: empty B&W list was free)', () => {
    const q = quotePrintOrder({ files: [file({ color: 'mixed', colorPages: [1, 2] })], partnerPricing: partner, globalPricing: global });
    expect(q.files[0]).toMatchObject({ colorPageCount: 2, bwPageCount: 8 });
    expect(q.subtotal).toBe((2 * 10 + 8 * 2) * 100);
  });

  it('ignores colour pages that do not exist or repeat', () => {
    expect(normaliseColorPages([3, 3, 0, 11, -1, 2.5, 'x', 1], 10)).toEqual([1, 3]);
  });
});

describe('quotePrintOrder — global pricing', () => {
  it('base × colour multiplier × sides × copies + service fee above the page limit', () => {
    // 10 B&W A4: 10 × ₹5 = ₹50 + service fee ₹5
    expect(quotePrintOrder({ files: [file()], globalPricing: global }).subtotal).toBe(5500);
    // binding instead of service fee
    expect(quotePrintOrder({ files: [file({ service: 'binding' })], globalPricing: global }).subtotal).toBe(7000);
    // file handling ₹10
    expect(quotePrintOrder({ files: [file({ service: 'file' })], globalPricing: global }).subtotal).toBe(6000);
    // a 1-page file pays no service charge
    expect(quotePrintOrder({ files: [file({ pages: 1 })], globalPricing: global }).subtotal).toBe(500);
    // colour, double-sided, 2 copies: 10 × 5 × 2 × 1.5 × 2 = ₹300 + ₹5
    expect(quotePrintOrder({ files: [file({ color: 'color', sided: 'double', copies: 2 })], globalPricing: global }).subtotal).toBe(30500);
  });

  it('adds delivery and sums several files', () => {
    const q = quotePrintOrder({ files: [file(), file({ pages: 1 })], globalPricing: global, deliveryChargePaise: 2600 });
    expect(q.delivery).toBe(2600);
    expect(q.subtotal).toBe(5500 + 500 + 2600);
  });
});

describe('quotePrintOrder — validation', () => {
  it.each([
    [{ pages: 0 }],
    [{ copies: 0 }],
    [{ copies: 101 }],
    [{ copies: 1.5 }],
    [{ pageSize: 'Letter' as never }],
    [{ color: 'rainbow' as never }],
    [{ sided: 'triple' as never }],
    [{ service: 'gold' as never }],
  ])('rejects %o', (bad) => {
    expect(() => quotePrintOrder({ files: [file(bad)], globalPricing: global })).toThrow(QuoteError);
  });

  it('rejects empty and oversized orders', () => {
    expect(() => quotePrintOrder({ files: [], globalPricing: global })).toThrow(QuoteError);
    expect(() => quotePrintOrder({ files: Array(21).fill(file()), globalPricing: global })).toThrow(QuoteError);
  });

  it('parcel weight matches the order page formula', () => {
    expect(parcelWeightKg([{ pages: 10, copies: 2, pageSize: 'A4' }])).toBe(0.11); // 100 g + 10 g
    expect(parcelWeightKg([{ pages: 1, copies: 1, pageSize: 'A4' }])).toBe(0.1); // minimum
  });
});
