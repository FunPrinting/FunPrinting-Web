/**
 * Print order pricing. Pure function: the only place an order's price is computed.
 *
 * It reproduces the formulas the site charged before (so prices don't change), with
 * the inputs fixed:
 * - page counts come from upload receipts, never from the browser;
 * - on a mixed-colour file, every page not marked colour is charged as B&W (before,
 *   an empty B&W list made those pages free);
 * - copies, sizes and options are validated;
 * - the delivery charge is computed by the server.
 *
 * Every order is printed by a partner shop and priced with that shop's rates, per file:
 *   (colourPages × perPageColor + bwPages × perPageBW) × (A3 ? 2 : 1) × (double ? 1.5 : 1) × copies
 *   + binding × copies when binding is chosen; rounded up to the rupee.
 * The order page shows the same numbers (src/lib/order/files.ts estimateAtShop). Then delivery is
 * added, and the processing fee is added on top (see money.ts).
 */
import { rupeesToPaise } from '@/lib/payments/money';

export type PageSize = 'A4' | 'A3';
export type ColorMode = 'color' | 'bw' | 'mixed';
export type Sided = 'single' | 'double';
export type ServiceOption = 'binding' | 'file' | 'service';

export interface QuoteFile {
  name: string;
  pages: number;
  pageSize: PageSize;
  color: ColorMode;
  sided: Sided;
  copies: number;
  colorPages?: number[]; // 1-based page numbers printed in colour (mixed mode)
  service?: ServiceOption;
}

export interface PrintModePricing {
  singleSided: number;
  doubleSided: number;
}

export interface PaperSizePricing {
  blackAndWhite: PrintModePricing;
  color: PrintModePricing;
}

export interface PartnerPricing {
  printing?: {
    a4?: PaperSizePricing;
    a3?: PaperSizePricing;
    letter?: PaperSizePricing;
    legal?: PaperSizePricing;
  };
  binding?: {
    spiral?: number;
    perfect?: number;
    staple?: number;
  } | number;
  lamination?: {
    a4?: number;
    a3?: number;
  };
  scanning?: number;
  photocopying?: {
    blackAndWhite?: number;
    color?: number;
  };
  plasticFiles?: number;
  customServices?: Array<{
    name: string;
    price: number;
  }>;
  // Legacy flat fields for backward compatibility
  perPageBW?: number;
  perPageColor?: number;
}

export interface QuoteLine {
  label: string;
  amount: number; // paise
}

export interface QuoteFileResult {
  name: string;
  pages: number;
  colorPageCount: number;
  bwPageCount: number;
  amount: number; // paise, including any service charge for this file
  lines: QuoteLine[];
}

export interface PrintQuote {
  files: QuoteFileResult[];
  delivery: number; // paise
  subtotal: number; // paise, files + delivery, before the processing fee
}

export class QuoteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'QuoteError';
  }
}

export const MAX_COPIES = 100;

/** Rates used when a shop has not set its own (same as the order page). */
export const DEFAULT_PARTNER_PRICING: PartnerPricing = {
  printing: {
    a4: {
      blackAndWhite: { singleSided: 2, doubleSided: 3 },
      color: { singleSided: 5, doubleSided: 8 },
    },
    a3: {
      blackAndWhite: { singleSided: 4, doubleSided: 6 },
      color: { singleSided: 10, doubleSided: 15 },
    },
    letter: {
      blackAndWhite: { singleSided: 2, doubleSided: 3 },
      color: { singleSided: 5, doubleSided: 8 },
    },
    legal: {
      blackAndWhite: { singleSided: 2, doubleSided: 3 },
      color: { singleSided: 5, doubleSided: 8 },
    },
  },
  binding: {
    spiral: 30,
    perfect: 50,
    staple: 10,
  },
  lamination: {
    a4: 20,
    a3: 40,
  },
  scanning: 5,
  photocopying: {
    blackAndWhite: 2,
    color: 10,
  },
  plasticFiles: 10,
};

/** Normalize either categorized or legacy partner pricing into standard rates. */
export function normalizePartnerPricing(raw: any): PartnerPricing {
  if (!raw) return DEFAULT_PARTNER_PRICING;
  return raw;
}

/** Colour pages that actually exist in the file, de-duplicated. */
export function normaliseColorPages(colorPages: unknown, pages: number): number[] {
  if (!Array.isArray(colorPages)) return [];
  const set = new Set<number>();
  for (const p of colorPages) {
    if (Number.isInteger(p) && p >= 1 && p <= pages) set.add(p);
  }
  return [...set].sort((a, b) => a - b);
}

function validate(file: QuoteFile, index: number): void {
  const where = `File ${index + 1}`;
  if (!Number.isInteger(file.pages) || file.pages < 1) throw new QuoteError(`${where}: invalid page count`);
  if (file.pageSize !== 'A4' && file.pageSize !== 'A3') throw new QuoteError(`${where}: page size must be A4 or A3`);
  if (!['color', 'bw', 'mixed'].includes(file.color)) throw new QuoteError(`${where}: invalid colour option`);
  if (file.sided !== 'single' && file.sided !== 'double') throw new QuoteError(`${where}: invalid sides option`);
  if (!Number.isInteger(file.copies) || file.copies < 1 || file.copies > MAX_COPIES) {
    throw new QuoteError(`${where}: copies must be between 1 and ${MAX_COPIES}`);
  }
  if (file.service !== undefined && !['binding', 'file', 'service'].includes(file.service)) {
    throw new QuoteError(`${where}: invalid service option`);
  }
}

function colourSplit(file: QuoteFile): { color: number; bw: number } {
  if (file.color === 'color') return { color: file.pages, bw: 0 };
  if (file.color === 'bw') return { color: 0, bw: file.pages };
  const color = normaliseColorPages(file.colorPages, file.pages).length;
  return { color, bw: file.pages - color };
}

function quotePartnerFile(file: QuoteFile, p: PartnerPricing): QuoteFileResult {
  const split = colourSplit(file);
  const size = (file.pageSize === 'A3' ? 'a3' : 'a4') as 'a4' | 'a3';
  const sided = (file.sided === 'double' ? 'doubleSided' : 'singleSided') as 'singleSided' | 'doubleSided';

  // Explicit rate lookup: directly from the shop's matrix, or standard rate defaults (NO multipliers)
  let bwRate: number;
  let colorRate: number;

  if (p.printing?.[size]?.blackAndWhite?.[sided] !== undefined) {
    bwRate = p.printing[size]!.blackAndWhite[sided];
  } else if (typeof p.perPageBW === 'number') {
    bwRate = p.perPageBW * (size === 'a3' ? 2 : 1) * (sided === 'doubleSided' ? 1.5 : 1);
  } else {
    bwRate = DEFAULT_PARTNER_PRICING.printing![size]!.blackAndWhite[sided];
  }

  if (p.printing?.[size]?.color?.[sided] !== undefined) {
    colorRate = p.printing[size]!.color[sided];
  } else if (typeof p.perPageColor === 'number') {
    colorRate = p.perPageColor * (size === 'a3' ? 2 : 1) * (sided === 'doubleSided' ? 1.5 : 1);
  } else {
    colorRate = DEFAULT_PARTNER_PRICING.printing![size]!.color[sided];
  }

  const printing = (split.color * colorRate + split.bw * bwRate) * file.copies;

  let binding = 0;
  if (file.service === 'binding') {
    const bindingRate = typeof p.binding === 'number'
      ? p.binding
      : (p.binding?.spiral ?? p.binding?.staple ?? p.binding?.perfect ?? 30);
    binding = bindingRate * file.copies;
  }

  const totalRupees = Math.ceil(printing + binding);
  const lines: QuoteLine[] = [{ label: 'Printing', amount: rupeesToPaise(Math.ceil(printing + binding) - binding) }];
  if (binding) lines.push({ label: `Binding × ${file.copies}`, amount: rupeesToPaise(binding) });
  return { name: file.name, pages: file.pages, colorPageCount: split.color, bwPageCount: split.bw, amount: rupeesToPaise(totalRupees), lines };
}

export function quotePrintOrder(input: {
  files: QuoteFile[];
  partnerPricing: PartnerPricing;
  deliveryChargePaise?: number;
}): PrintQuote {
  if (!input.files.length) throw new QuoteError('Add at least one file');
  if (input.files.length > 20) throw new QuoteError('At most 20 files per order');

  const p = input.partnerPricing;
  if (typeof p.perPageBW === 'number' && (!Number.isFinite(p.perPageBW) || p.perPageBW < 0)) {
    throw new QuoteError('This shop has invalid prices; please choose another shop');
  }
  if (typeof p.perPageColor === 'number' && (!Number.isFinite(p.perPageColor) || p.perPageColor < 0)) {
    throw new QuoteError('This shop has invalid prices; please choose another shop');
  }
  if (typeof p.binding === 'number' && (!Number.isFinite(p.binding) || p.binding < 0)) {
    throw new QuoteError('This shop has invalid prices; please choose another shop');
  }

  input.files.forEach(validate);

  const files = input.files.map((f) => quotePartnerFile(f, input.partnerPricing));
  const delivery = Math.max(0, Math.round(input.deliveryChargePaise ?? 0));
  return { files, delivery, subtotal: files.reduce((s, f) => s + f.amount, 0) + delivery };
}

/** Parcel weight in kg, matching the order page: 5 g per A4 page (10 g A3) + 10 g packaging. */
export function parcelWeightKg(files: Pick<QuoteFile, 'pages' | 'copies' | 'pageSize'>[]): number {
  const grams = files.reduce((sum, f) => sum + f.pages * f.copies * (f.pageSize === 'A3' ? 10 : 5), 0) + 10;
  return Math.max(0.1, Math.round(grams / 10) / 100);
}
