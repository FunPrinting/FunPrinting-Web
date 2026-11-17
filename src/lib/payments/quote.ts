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
 * This is the formula the order page shows (PartnerMapSelector). Then delivery is
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

export interface PartnerPricing {
  perPageBW: number;
  perPageColor: number;
  binding: number;
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
export const DEFAULT_PARTNER_PRICING: PartnerPricing = { perPageBW: 2, perPageColor: 10, binding: 30 };

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
  const size = file.pageSize === 'A3' ? 2 : 1;
  const sided = file.sided === 'double' ? 1.5 : 1;
  const printing = (split.color * p.perPageColor + split.bw * p.perPageBW) * size * sided * file.copies;
  const binding = file.service === 'binding' ? p.binding * file.copies : 0;
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
  const r = input.partnerPricing;
  if (![r.perPageBW, r.perPageColor, r.binding].every((v) => Number.isFinite(v) && v >= 0)) {
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
