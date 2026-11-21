import 'server-only';
import { PDFDocument } from 'pdf-lib';

/**
 * Server-side page counting for uploaded files. Prices depend on the result, so the
 * server never accepts a page count from the browser.
 *
 * - PDF: exact, via pdf-lib.
 * - Images: 1 page.
 * - Word (.docx/.doc): converted to PDF and counted (Cloudmersive on serverless,
 *   LibreOffice locally). If conversion is unavailable, an estimate from the text
 *   (about 225 words per page) is used and `estimated: true` is returned.
 */
export interface PageCountResult {
  pages: number;
  estimated: boolean;
}

export const PDF_MIME = 'application/pdf';
export const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
export const DOC_MIME = 'application/msword';
export const MAX_PAGES = 2000;

export async function countPdfPages(buffer: Buffer | Uint8Array): Promise<number> {
  const pdf = await PDFDocument.load(buffer, { ignoreEncryption: true, updateMetadata: false });
  return pdf.getPageCount();
}

async function docxToPdf(buffer: Buffer): Promise<Buffer | null> {
  try {
    // Fast services only: a page count isn't worth the slow Render fallback
    const { docxToPdf: convert } = await import('@/lib/documents/convert');
    return (await convert(buffer, { providers: ['cloudmersive', 'libreoffice'] })).pdf;
  } catch {
    return null; // estimate from the text instead
  }
}

export async function estimateDocxPages(buffer: Buffer): Promise<number> {
  const mammoth = await import('mammoth');
  const { value } = await mammoth.extractRawText({ buffer });
  const words = value.split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.ceil(words / 225));
}

export async function countPages(buffer: Buffer, mime: string): Promise<PageCountResult> {
  let result: PageCountResult;
  if (mime === PDF_MIME) {
    result = { pages: await countPdfPages(buffer), estimated: false };
  } else if (mime.startsWith('image/')) {
    result = { pages: 1, estimated: false };
  } else if (mime === DOCX_MIME || mime === DOC_MIME) {
    const pdf = await docxToPdf(buffer);
    result = pdf ? { pages: await countPdfPages(pdf), estimated: false } : { pages: await estimateDocxPages(buffer), estimated: true };
  } else {
    throw new Error(`Unsupported file type for page counting: ${mime}`);
  }
  if (!Number.isInteger(result.pages) || result.pages < 1) throw new Error('Document has no pages');
  if (result.pages > MAX_PAGES) throw new Error(`Document has ${result.pages} pages; the limit is ${MAX_PAGES}`);
  return result;
}
