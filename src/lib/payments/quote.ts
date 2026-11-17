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
 * Partner pricing (when an order goes to a partner shop), per file:
 *   (colourPages × perPageColor + bwPages × perPageBW) × (A3 ? 2 : 1) × (double ? 1.5 : 1) × copies
 *   + binding × copies when binding is chosen; rounded up to the rupee.
 * Global pricing (no partner), per file:
 *   (colourPages × base × colourMultiplier + bwPages × base) × sidedMultiplier × copies
 *   + a service charge when the file has more than `minServiceFeePageLimit` pages:
 *     binding → binding price, file → ₹10, service → minServiceFee.
 * Then delivery is added, and the processing fee is added on top (see money.ts).
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

export interface GlobalPricing {
  basePrices: { A4: number; A3: number };
  multipliers: { color: number; doubleSided: number };
  additionalServices: { binding: number; minServiceFee: number; minServiceFeePageLimit: number };
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
const FILE_HANDLING_FEE_RUPEES = 10;

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

function quoteGlobalFile(file: QuoteFile, g: GlobalPricing): QuoteFileResult {
  const split = colourSplit(file);
  const base = g.basePrices[file.pageSize];
  const sided = file.sided === 'double' ? g.multipliers.doubleSided : 1;
  const printing = (split.color * base * g.multipliers.color + split.bw * base) * sided * file.copies;
  const lines: QuoteLine[] = [{ label: 'Printing', amount: rupeesToPaise(printing) }];

  let service = 0;
  const limit = g.additionalServices.minServiceFeePageLimit || 1;
  if (file.pages > limit) {
    const option = file.service ?? 'service';
    if (option === 'binding') {
      service = g.additionalServices.binding;
      lines.push({ label: 'Binding', amount: rupeesToPaise(service) });
    } else if (option === 'file') {
      service = FILE_HANDLING_FEE_RUPEES;
      lines.push({ label: 'File handling', amount: rupeesToPaise(service) });
    } else {
      service = g.additionalServices.minServiceFee;
      lines.push({ label: 'Service fee', amount: rupeesToPaise(service) });
    }
  }
  return {
    name: file.name,
    pages: file.pages,
    colorPageCount: split.color,
    bwPageCount: split.bw,
    amount: lines.reduce((sum, l) => sum + l.amount, 0),
    lines,
  };
}

export function quotePrintOrder(input: {
  files: QuoteFile[];
  partnerPricing?: PartnerPricing | null;
  globalPricing: GlobalPricing;
  deliveryChargePaise?: number;
}): PrintQuote {
  if (!input.files.length) throw new QuoteError('Add at least one file');
  if (input.files.length > 20) throw new QuoteError('At most 20 files per order');
  input.files.forEach(validate);

  const files = input.files.map((f) =>
    input.partnerPricing ? quotePartnerFile(f, input.partnerPricing) : quoteGlobalFile(f, input.globalPricing)
  );
  const delivery = Math.max(0, Math.round(input.deliveryChargePaise ?? 0));
  return { files, delivery, subtotal: files.reduce((s, f) => s + f.amount, 0) + delivery };
}

/** Parcel weight in kg, matching the order page: 5 g per A4 page (10 g A3) + 10 g packaging. */
export function parcelWeightKg(files: Pick<QuoteFile, 'pages' | 'copies' | 'pageSize'>[]): number {
  const grams = files.reduce((sum, f) => sum + f.pages * f.copies * (f.pageSize === 'A3' ? 10 : 5), 0) + 10;
  return Math.max(0.1, Math.round(grams / 10) / 100);
}
