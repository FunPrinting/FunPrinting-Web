import sharp from 'sharp';
import { PDFDocument } from 'pdf-lib';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const conv = vi.hoisted(() => ({ fail: false, providers: [] as unknown[] }));
vi.mock('@/lib/documents/convert', () => ({
  docxToPdf: vi.fn(async (_b: Buffer, opts: { providers?: unknown[] } = {}) => {
    conv.providers.push(opts.providers);
    if (conv.fail) throw new Error('no converter');
    const d = await PDFDocument.create();
    d.addPage();
    d.addPage();
    return { pdf: Buffer.from(await d.save()), provider: 'test' };
  }),
}));

import { imageToPdf, prepareUpload, toPrintReady, PAGE_SIZES } from '@/lib/uploads/printReady';
import { verifyUploadReceipt, signUploadReceipt } from '@/lib/uploads/receipt';

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const png = (w: number, h: number, alpha = false) =>
  sharp({ create: { width: w, height: h, channels: alpha ? 4 : 3, background: alpha ? { r: 0, g: 0, b: 0, alpha: 0.5 } : '#3366ff' } }).png().toBuffer();

async function pageOf(pdf: Buffer) {
  const doc = await PDFDocument.load(pdf);
  const p = doc.getPage(0);
  return { count: doc.getPageCount(), w: Math.round(p.getWidth()), h: Math.round(p.getHeight()) };
}

beforeEach(() => {
  conv.fail = false;
  conv.providers.length = 0;
});

describe('images to PDF', () => {
  it('a portrait image becomes one portrait A4 page', async () => {
    expect(await pageOf(await imageToPdf(await png(600, 900), 'image/png'))).toEqual({ count: 1, w: 595, h: 842 });
  });

  it('a landscape image becomes a landscape page, on A3 when asked', async () => {
    const [short, long] = PAGE_SIZES.A3.map(Math.round);
    expect(await pageOf(await imageToPdf(await png(1200, 500), 'image/png', 'A3'))).toEqual({ count: 1, w: long, h: short });
  });

  it('webp, transparent PNG and JPEG are all accepted', async () => {
    const webp = await sharp({ create: { width: 40, height: 40, channels: 3, background: '#000' } }).webp().toBuffer();
    const jpg = await sharp({ create: { width: 40, height: 40, channels: 3, background: '#fff' } }).jpeg().toBuffer();
    for (const [buf, mime] of [[webp, 'image/webp'], [await png(40, 40, true), 'image/png'], [jpg, 'image/jpeg']] as const) {
      expect((await pageOf(await imageToPdf(buf, mime))).count).toBe(1);
    }
  });
});

describe('prepareUpload', () => {
  it('a PDF is print-ready as it is', async () => {
    const d = await PDFDocument.create();
    d.addPage();
    d.addPage();
    d.addPage();
    expect(await prepareUpload(Buffer.from(await d.save()), 'application/pdf')).toEqual({ pages: 3, estimated: false, pdf: null });
  });

  it('a Word file is converted once with the fast converters, and pages are counted from the PDF', async () => {
    const out = await prepareUpload(Buffer.from('docx'), DOCX);
    expect(out.pages).toBe(2);
    expect(out.estimated).toBe(false);
    expect(out.pdf?.subarray(0, 5).toString()).toBe('%PDF-');
    expect(conv.providers).toEqual([['cloudmersive', 'convertapi', 'libreoffice']]);
  });

  it('an image is placed on a page', async () => {
    const out = await prepareUpload(await png(100, 100), 'image/png');
    expect(out.pages).toBe(1);
    expect(out.pdf).toBeTruthy();
  });

  it('unsupported types are refused', async () => {
    await expect(prepareUpload(Buffer.from('x'), 'text/plain')).rejects.toThrow(/Unsupported/);
  });

  it('toPrintReady passes PDFs through without a new file', async () => {
    const d = await PDFDocument.create();
    d.addPage();
    const bytes = Buffer.from(await d.save());
    const out = await toPrintReady(bytes, 'application/pdf');
    expect(out).toMatchObject({ pages: 1, passthrough: true });
    expect(out.pdf).toBe(bytes);
  });
});

describe('upload receipts', () => {
  it('carry the printUrl, and older receipts without one still verify', () => {
    process.env.NEXTAUTH_SECRET = 'x'.repeat(32);
    const base = { url: 'https://res.cloudinary.com/demo/a.docx', name: 'a.docx', mime: DOCX, size: 10, pages: 2, estimated: false, uid: 'u@x.com' };
    const withPrint = verifyUploadReceipt(signUploadReceipt({ ...base, printUrl: 'https://res.cloudinary.com/demo/a.pdf' }), 'u@x.com');
    expect(withPrint.ok && withPrint.receipt.printUrl).toBe('https://res.cloudinary.com/demo/a.pdf');
    const older = verifyUploadReceipt(signUploadReceipt(base), 'u@x.com');
    expect(older.ok && older.receipt.printUrl).toBeUndefined();
  });
});
