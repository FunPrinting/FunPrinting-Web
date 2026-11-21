import 'server-only';
import { PDFDocument } from 'pdf-lib';
import { countPdfPages, DOC_MIME, DOCX_MIME, PDF_MIME } from './pageCount';

/**
 * Print-ready PDFs. Partner apps print only PDFs, so every upload is turned into one here,
 * once, on the server:
 * - PDF: passed through unchanged.
 * - Word (.docx/.doc): converted with the document converter chain.
 * - Images: one page, the image fitted inside 6 mm margins on A4 or A3 (rotated to the
 *   page's orientation), at its own resolution, so nothing is resampled at the shop.
 */
export const PAGE_SIZES = { A4: [595.28, 841.89], A3: [841.89, 1190.55] } as const;
export type PaperSize = keyof typeof PAGE_SIZES;
const MARGIN = 17; // ~6 mm, inside every printer's unprintable edge

export class PrintReadyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PrintReadyError';
  }
}

export interface PrintReady {
  pdf: Buffer;
  pages: number;
  /** True when the PDF is the uploaded bytes (no new file is stored). */
  passthrough: boolean;
}

/** Image bytes as JPEG or PNG for pdf-lib; other formats are converted with sharp. */
async function embeddable(buffer: Buffer, mime: string): Promise<{ bytes: Buffer; kind: 'jpg' | 'png'; width: number; height: number }> {
  const sharp = (await import('sharp')).default;
  // Respect the camera's orientation flag, then read the real size
  let img = sharp(buffer, { limitInputPixels: 100_000_000, animated: false }).rotate();
  const meta = await img.metadata();
  const keepJpeg = mime === 'image/jpeg' || mime === 'image/jpg';
  const out = keepJpeg && (!meta.orientation || meta.orientation === 1) ? { data: buffer, kind: 'jpg' as const } : null;
  if (out) return { bytes: out.data, kind: 'jpg', width: meta.width ?? 0, height: meta.height ?? 0 };
  // Transparent images keep transparency as PNG; everything else becomes high-quality JPEG
  img = meta.hasAlpha ? img.png({ compressionLevel: 6 }) : img.flatten({ background: '#ffffff' }).jpeg({ quality: 92, chromaSubsampling: '4:4:4' });
  const { data, info } = await img.toBuffer({ resolveWithObject: true });
  return { bytes: data, kind: meta.hasAlpha ? 'png' : 'jpg', width: info.width, height: info.height };
}

export async function imageToPdf(buffer: Buffer, mime: string, paper: PaperSize = 'A4'): Promise<Buffer> {
  const { bytes, kind, width, height } = await embeddable(buffer, mime);
  if (!width || !height) throw new PrintReadyError('The image has no size');
  const doc = await PDFDocument.create();
  const image = kind === 'jpg' ? await doc.embedJpg(bytes) : await doc.embedPng(bytes);
  const [short, long] = PAGE_SIZES[paper];
  const landscape = width > height;
  const [pw, ph] = landscape ? [long, short] : [short, long];
  const scale = Math.min((pw - 2 * MARGIN) / width, (ph - 2 * MARGIN) / height);
  const w = width * scale;
  const h = height * scale;
  doc.addPage([pw, ph]).drawImage(image, { x: (pw - w) / 2, y: (ph - h) / 2, width: w, height: h });
  return Buffer.from(await doc.save({ useObjectStreams: true }));
}

/** Converters fast enough to run while the customer waits for an upload. */
const UPLOAD_PROVIDERS = ['cloudmersive', 'convertapi', 'libreoffice'] as const;

export interface PreparedUpload {
  pages: number;
  /** Pages could not be counted exactly (Word file and no converter worked). */
  estimated: boolean;
  /** The print-ready PDF to store; null for PDFs (the upload itself is print-ready) and for estimates. */
  pdf: Buffer | null;
}

/**
 * Used by /api/upload-file: counts pages from the print-ready PDF, so a Word file is
 * converted once and the count matches what the shop prints. Images are placed on A4;
 * printers scale the page to A3 when the customer chooses A3.
 */
export async function prepareUpload(buffer: Buffer, mime: string): Promise<PreparedUpload> {
  if (mime === PDF_MIME) return { pages: await countPdfPages(buffer), estimated: false, pdf: null };
  if (mime.startsWith('image/')) {
    const pdf = await imageToPdf(buffer, mime, 'A4');
    return { pages: 1, estimated: false, pdf };
  }
  if (mime === DOCX_MIME || mime === DOC_MIME) {
    try {
      const { docxToPdf } = await import('@/lib/documents/convert');
      const { pdf } = await docxToPdf(buffer, { providers: [...UPLOAD_PROVIDERS] });
      return { pages: await countPdfPages(pdf), estimated: false, pdf };
    } catch {
      // No converter worked; checkout refuses estimated files, so the customer is asked for a PDF
      const { estimateDocxPages } = await import('./pageCount');
      return { pages: await estimateDocxPages(buffer), estimated: true, pdf: null };
    }
  }
  throw new PrintReadyError(`Unsupported file type: ${mime}`);
}

export async function toPrintReady(buffer: Buffer, mime: string, paper: PaperSize = 'A4'): Promise<PrintReady> {
  if (mime === PDF_MIME) return { pdf: buffer, pages: await countPdfPages(buffer), passthrough: true };
  let pdf: Buffer;
  if (mime === DOCX_MIME || mime === DOC_MIME) {
    const { docxToPdf } = await import('@/lib/documents/convert');
    pdf = (await docxToPdf(buffer)).pdf;
  } else if (mime.startsWith('image/')) {
    pdf = await imageToPdf(buffer, mime, paper);
  } else {
    throw new PrintReadyError(`Can't prepare ${mime} for printing`);
  }
  return { pdf, pages: await countPdfPages(pdf), passthrough: false };
}
