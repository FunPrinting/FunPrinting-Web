import 'server-only';
import { logger } from '@/lib/logger';

/**
 * One interface for document conversion. Routes call docxToPdf / pdfToDocx and
 * never pick a service themselves.
 *
 * DOCX → PDF tries the configured services in order and uses the first that works:
 *   cloudmersive (CLOUDMERSIVE_API_KEY) → convertapi (CONVERTAPI_SECRET)
 *   → ilovepdf (ILOVEPDF_PUBLIC_KEY + ILOVEPDF_SECRET_KEY) → libreoffice (installed)
 *   → render (RENDER_SERVICE_URL; the file is uploaded to storage first)
 * Override the order, or drop services, with DOCX_TO_PDF_PROVIDERS="libreoffice,cloudmersive".
 *
 * PDF → DOCX: cloudmersive → libreoffice.
 */

export type DocxToPdfProvider = 'cloudmersive' | 'convertapi' | 'ilovepdf' | 'libreoffice' | 'render';

const DEFAULT_ORDER: DocxToPdfProvider[] = ['cloudmersive', 'convertapi', 'ilovepdf', 'libreoffice', 'render'];

export class ConversionError extends Error {
  constructor(
    message: string,
    readonly attempts: Array<{ provider: string; error: string }>
  ) {
    super(message);
    this.name = 'ConversionError';
  }
}

type Provider = { name: DocxToPdfProvider; configured: () => Promise<boolean> | boolean; run: (docx: Buffer) => Promise<Buffer> };

const providers: Record<DocxToPdfProvider, Provider> = {
  cloudmersive: {
    name: 'cloudmersive',
    configured: () => Boolean(process.env.CLOUDMERSIVE_API_KEY),
    run: async (docx) => (await import('@/lib/cloudmersive')).convertDocxToPdf(docx),
  },
  convertapi: {
    name: 'convertapi',
    configured: () => Boolean(process.env.CONVERTAPI_SECRET),
    run: async (docx) => (await import('@/lib/freeConverters')).convertDocxToPdfViaConvertAPI(docx),
  },
  ilovepdf: {
    name: 'ilovepdf',
    configured: () => Boolean(process.env.ILOVEPDF_PUBLIC_KEY && process.env.ILOVEPDF_SECRET_KEY),
    run: async (docx) => (await import('@/lib/freeConverters')).convertDocxToPdfViaILovePDF(docx),
  },
  libreoffice: {
    name: 'libreoffice',
    configured: async () => (await import('@/lib/libreoffice')).isLibreOfficeAvailable(),
    run: async (docx) => (await import('@/lib/libreoffice')).convertDocxToPdf(docx),
  },
  render: {
    name: 'render',
    configured: () => process.env.RENDER_SERVICE_DISABLED !== '1',
    run: async (docx) => {
      // The Render service downloads the file, so it goes to storage first
      const { uploadFile } = await import('@/lib/storage');
      const { convertDocxToPdfSync } = await import('@/lib/renderPdfService');
      const url = await uploadFile(docx, 'conversion-input', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      const result = await convertDocxToPdfSync(url, 60_000, 2);
      if (!result.success || !result.pdfBuffer) throw new Error(result.error || 'Render service conversion failed');
      return Buffer.from(result.pdfBuffer, 'base64');
    },
  },
};

function order(): DocxToPdfProvider[] {
  const raw = process.env.DOCX_TO_PDF_PROVIDERS?.trim();
  if (!raw) return DEFAULT_ORDER;
  const names = raw.split(',').map((s) => s.trim().toLowerCase()).filter((s): s is DocxToPdfProvider => s in providers);
  return names.length ? names : DEFAULT_ORDER;
}

function looksLikePdf(buf: Buffer) {
  return buf.length > 100 && buf.toString('ascii', 0, 5) === '%PDF-';
}

/** DOCX → PDF with the first configured service that succeeds. Throws ConversionError. */
export async function docxToPdf(docx: Buffer, opts: { providers?: DocxToPdfProvider[] } = {}): Promise<{ pdf: Buffer; provider: DocxToPdfProvider }> {
  const attempts: Array<{ provider: string; error: string }> = [];
  for (const name of opts.providers ?? order()) {
    const p = providers[name];
    if (!(await p.configured())) continue;
    try {
      const pdf = await p.run(docx);
      if (!looksLikePdf(pdf)) throw new Error('Service did not return a PDF');
      return { pdf, provider: name };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      attempts.push({ provider: name, error });
      logger.warn({ provider: name, err: error }, 'DOCX to PDF conversion failed, trying the next service');
    }
  }
  throw new ConversionError(attempts.length ? 'All PDF conversion services failed' : 'No PDF conversion service is configured', attempts);
}

/** PDF → DOCX (Cloudmersive, then LibreOffice). Throws ConversionError. */
export async function pdfToDocx(pdf: Buffer): Promise<{ docx: Buffer; provider: 'cloudmersive' | 'libreoffice' }> {
  const attempts: Array<{ provider: string; error: string }> = [];
  if (process.env.CLOUDMERSIVE_API_KEY) {
    try {
      return { docx: await (await import('@/lib/cloudmersive')).convertPdfToDocx(pdf), provider: 'cloudmersive' };
    } catch (err) {
      attempts.push({ provider: 'cloudmersive', error: err instanceof Error ? err.message : String(err) });
    }
  }
  const lo = await import('@/lib/libreoffice');
  if (await lo.isLibreOfficeAvailable()) {
    try {
      return { docx: await lo.convertPdfToDocx(pdf), provider: 'libreoffice' };
    } catch (err) {
      attempts.push({ provider: 'libreoffice', error: err instanceof Error ? err.message : String(err) });
    }
  }
  throw new ConversionError(attempts[0]?.error || 'No PDF to Word conversion service is configured', attempts);
}
