/**
 * The order page's model: one entry per document with its own print options.
 * Pure helpers only (no React, no fetch), so they are shared and tested.
 *
 * Prices shown on the page use quotePrintOrder, the same function checkout charges
 * with, so the estimate only differs when the server's page count differs.
 */
import { parcelWeightKg, quotePrintOrder, type PartnerPricing, type QuoteFile } from '@/lib/payments/quote';
import { withProcessingFee } from '@/lib/payments/money';

export type PageSize = 'A4' | 'A3';
export type ColorMode = 'bw' | 'color' | 'mixed';
export type Sided = 'single' | 'double';
/** 'service' = no finishing. Only binding costs extra (the shop's binding price). */
export type Finishing = 'service' | 'file' | 'binding';

export interface PrintOptions {
  pageSize: PageSize;
  color: ColorMode;
  sided: Sided;
  copies: number;
  /** Mixed colour: what the customer typed, e.g. "1-3, 7". */
  colorInput: string;
  finishing: Finishing;
}

export interface OrderFile extends PrintOptions {
  id: string;
  file: File;
  /** Object URL for the preview; revoke when the file is removed. */
  previewUrl: string;
  pages: number;
  /** Set if the pages could not be counted exactly (price may change after upload). */
  estimatedPages?: boolean;
}

export const DEFAULT_OPTIONS: PrintOptions = { pageSize: 'A4', color: 'bw', sided: 'single', copies: 1, colorInput: '', finishing: 'service' };

export const ACCEPTED_FILES = '.pdf,.doc,.docx,.jpg,.jpeg,.png,.gif,.bmp,.tiff,.webp';
export const MAX_FILES = 20;
export const MAX_COPIES = 100;

export interface PageRange {
  pages: number[];
  errors: string[];
  warnings: string[];
}

/**
 * "1-3, 5, 8-" → [1,2,3,5,8,…,max]. Pages past the end are dropped with a warning.
 */
export function parsePageRange(input: string, maxPages: number): PageRange {
  const out: PageRange = { pages: [], errors: [], warnings: [] };
  const set = new Set<number>();
  for (const raw of input.split(',')) {
    const part = raw.trim();
    if (!part) continue;
    const range = part.match(/^(\d+)\s*-\s*(\d*)$/);
    if (range) {
      const start = Number(range[1]);
      const end = range[2] ? Number(range[2]) : maxPages;
      if (start < 1) out.errors.push(`“${part}”: pages start at 1`);
      else if (end < start) out.errors.push(`“${part}”: the first page must come before the last`);
      else if (start > maxPages) out.warnings.push(`“${part}”: the document has only ${maxPages} pages`);
      else {
        if (end > maxPages) out.warnings.push(`“${part}”: the document has only ${maxPages} pages, using ${start}-${maxPages}`);
        for (let p = start; p <= Math.min(end, maxPages); p++) set.add(p);
      }
    } else if (/^\d+$/.test(part)) {
      const p = Number(part);
      if (p < 1) out.errors.push(`“${part}”: pages start at 1`);
      else if (p > maxPages) out.warnings.push(`Page ${p} doesn’t exist (the document has ${maxPages} pages)`);
      else set.add(p);
    } else {
      out.errors.push(`“${part}” isn’t a page number or range like 2-5`);
    }
  }
  out.pages = [...set].sort((a, b) => a - b);
  return out;
}

/** Colour pages for a file (only meaningful for mixed). */
export function colorPagesOf(f: Pick<OrderFile, 'color' | 'colorInput' | 'pages'>): number[] {
  return f.color === 'mixed' ? parsePageRange(f.colorInput, f.pages).pages : [];
}

/** What blocks paying for this file, if anything. */
export function fileProblem(f: OrderFile): string | null {
  if (!Number.isInteger(f.copies) || f.copies < 1 || f.copies > MAX_COPIES) return `Copies must be between 1 and ${MAX_COPIES}`;
  if (f.color === 'mixed') {
    const r = parsePageRange(f.colorInput, f.pages);
    if (r.errors.length) return r.errors[0];
    if (!r.pages.length) return 'Enter the pages to print in colour, or choose B&W';
    if (r.pages.length === f.pages) return 'All pages are in colour: choose Colour instead';
  }
  return null;
}

export function toQuoteFile(f: OrderFile): QuoteFile {
  return {
    name: f.file.name,
    pages: Math.max(1, f.pages),
    pageSize: f.pageSize,
    color: f.color,
    sided: f.sided,
    copies: Math.min(MAX_COPIES, Math.max(1, Math.round(f.copies) || 1)),
    colorPages: f.color === 'mixed' ? colorPagesOf(f) : undefined,
    service: f.finishing,
  };
}

/** Printing price in rupees at a shop, or null if the options can't be priced yet. */
export function estimateAtShop(files: OrderFile[], pricing: PartnerPricing): number | null {
  if (!files.length) return null;
  try {
    return quotePrintOrder({ files: files.map(toQuoteFile), partnerPricing: pricing }).subtotal / 100;
  } catch {
    return null;
  }
}

/** Subtotal (printing + delivery), the 3% fee and the total, in rupees. */
export function totals(printing: number, delivery: number) {
  const t = withProcessingFee(Math.round((printing + delivery) * 100));
  return { subtotal: t.subtotal / 100, fee: t.fee / 100, total: t.total / 100 };
}

export function parcelWeight(files: OrderFile[]): number {
  return parcelWeightKg(files.map((f) => ({ pages: Math.max(1, f.pages), copies: Math.max(1, f.copies), pageSize: f.pageSize })));
}

export function describeOptions(f: PrintOptions): string {
  const color = f.color === 'color' ? 'Colour' : f.color === 'mixed' ? 'Mixed colour' : 'B&W';
  const finishing = f.finishing === 'binding' ? ' · Binding' : f.finishing === 'file' ? ' · File folder' : '';
  return `${f.pageSize} · ${color} · ${f.sided === 'double' ? 'Double-sided' : 'Single-sided'} · ${f.copies} ${f.copies === 1 ? 'copy' : 'copies'}${finishing}`;
}

export function fileKind(file: File): 'pdf' | 'word' | 'image' | 'other' {
  const n = file.name.toLowerCase();
  if (file.type === 'application/pdf' || n.endsWith('.pdf')) return 'pdf';
  if (/\.(docx?)$/.test(n) || file.type.includes('word')) return 'word';
  if (file.type.startsWith('image/') || /\.(jpe?g|png|gif|bmp|tiff?|webp)$/.test(n)) return 'image';
  return 'other';
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
