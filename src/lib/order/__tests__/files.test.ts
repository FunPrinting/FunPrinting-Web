import { describe, expect, it } from 'vitest';
import { DEFAULT_OPTIONS, estimateAtShop, fileProblem, parsePageRange, totals, type OrderFile } from '@/lib/order/files';

const file = (over: Partial<OrderFile> = {}): OrderFile => ({
  ...DEFAULT_OPTIONS,
  id: 'f1',
  file: new File(['x'], 'notes.pdf', { type: 'application/pdf' }),
  previewUrl: '',
  pages: 10,
  ...over,
});
const shop = { perPageBW: 2, perPageColor: 10, binding: 30 };

describe('parsePageRange', () => {
  it('reads pages, ranges and open ranges', () => {
    expect(parsePageRange('1-3, 5, 8-', 10).pages).toEqual([1, 2, 3, 5, 8, 9, 10]);
    expect(parsePageRange(' 2 ,2, 3 - 4', 10).pages).toEqual([2, 3, 4]);
  });
  it('drops pages past the end with a warning and reports bad input', () => {
    const r = parsePageRange('9-12, 15, x, 5-2', 10);
    expect(r.pages).toEqual([9, 10]);
    expect(r.warnings).toHaveLength(2);
    expect(r.errors).toHaveLength(2);
  });
});

describe('fileProblem', () => {
  it('requires a sensible mixed-colour selection and copies', () => {
    expect(fileProblem(file())).toBeNull();
    expect(fileProblem(file({ color: 'mixed', colorInput: '' }))).toMatch(/Enter the pages/);
    expect(fileProblem(file({ color: 'mixed', colorInput: '1-10' }))).toMatch(/choose Colour/);
    expect(fileProblem(file({ color: 'mixed', colorInput: '2-x' }))).toMatch(/isn’t a page/);
    expect(fileProblem(file({ color: 'mixed', colorInput: '1,4' }))).toBeNull();
    expect(fileProblem(file({ copies: 0 }))).toMatch(/Copies/);
  });
});

describe('estimate', () => {
  it('matches the checkout formula (same quotePrintOrder)', () => {
    // 10 B&W pages × ₹2 = ₹20; mixed: 2 colour × 10 + 8 B&W × 2 = ₹36; binding ₹30 × 2 copies
    expect(estimateAtShop([file()], shop)).toBe(20);
    expect(estimateAtShop([file({ color: 'mixed', colorInput: '1,4' })], shop)).toBe(36);
    expect(estimateAtShop([file({ finishing: 'binding', copies: 2 })], shop)).toBe(40 + 60);
    expect(estimateAtShop([], shop)).toBeNull();
  });
  it('adds the 3% fee on printing plus delivery', () => {
    expect(totals(100, 30)).toEqual({ subtotal: 130, fee: 3.9, total: 133.9 });
  });
});
