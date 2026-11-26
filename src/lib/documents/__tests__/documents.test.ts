import { beforeEach, describe, expect, it, vi } from 'vitest';
import { decodeBase64File, fetchTrustedFile, FileFetchError, isTrustedFileUrl } from '@/lib/documents/fileUrls';

beforeEach(() => {
  vi.stubEnv('CLOUDINARY_CLOUD_NAME', 'da8lufst0');
  vi.stubEnv('OCI_REGION', 'ap-mumbai-1');
  vi.stubEnv('OCI_NAMESPACE', 'ns1');
  vi.stubEnv('OCI_BUCKET_NAME', 'print-files');
  vi.stubEnv('FILE_URL_HOSTS', '');
});

describe('isTrustedFileUrl', () => {
  it.each([
    'https://res.cloudinary.com/da8lufst0/raw/upload/v1/print-service/a.pdf',
    'https://objectstorage.ap-mumbai-1.oraclecloud.com/n/ns1/b/print-files/o/a.pdf',
    'https://objectstorage.ap-mumbai-1.oraclecloud.com/p/TOKEN123/n/ns1/b/print-files/o/folder%20x/a.pdf',
  ])('allows our storage: %s', (url) => {
    expect(isTrustedFileUrl(url)).toBe(true);
  });

  it.each([
    ['http (not https)', 'http://res.cloudinary.com/da8lufst0/raw/upload/a.pdf'],
    ['another Cloudinary account', 'https://res.cloudinary.com/someoneelse/raw/upload/a.pdf'],
    ['cloud metadata address', 'https://169.254.169.254/latest/meta-data/'],
    ['localhost', 'https://localhost/api/admin'],
    ['non-default port', 'https://res.cloudinary.com:8443/da8lufst0/a.pdf'],
    ['credentials in URL', 'https://user:pw@res.cloudinary.com/da8lufst0/a.pdf'],
    ['look-alike host', 'https://res.cloudinary.com.evil.example/da8lufst0/a.pdf'],
    ['another Oracle bucket', 'https://objectstorage.ap-mumbai-1.oraclecloud.com/n/ns1/b/other/o/a.pdf'],
    ['encoded traversal', 'https://res.cloudinary.com/da8lufst0/%2e%2e/someoneelse/a.pdf'],
    ['file scheme', 'file:///etc/passwd'],
    ['not a string', 42],
  ])('refuses %s', (_label, url) => {
    expect(isTrustedFileUrl(url)).toBe(false);
  });

  it('accepts extra hosts from FILE_URL_HOSTS, with an optional path prefix', () => {
    vi.stubEnv('FILE_URL_HOSTS', 'files.example.com/uploads, cdn.example.org');
    expect(isTrustedFileUrl('https://files.example.com/uploads/a.pdf')).toBe(true);
    expect(isTrustedFileUrl('https://files.example.com/private/a.pdf')).toBe(false);
    expect(isTrustedFileUrl('https://cdn.example.org/anything.pdf')).toBe(true);
  });

  it('allows Cloudflare R2 public URLs and R2 S3 bucket paths when configured', () => {
    vi.stubEnv('R2_PUBLIC_URL', 'https://pub-demo123.r2.dev');
    vi.stubEnv('R2_ACCOUNT_ID', 'acc123');
    vi.stubEnv('R2_BUCKET_NAME', 'funprinting-files');
    expect(isTrustedFileUrl('https://pub-demo123.r2.dev/print-service/a.pdf')).toBe(true);
    expect(isTrustedFileUrl('https://acc123.r2.cloudflarestorage.com/funprinting-files/raw-templates/a.docx')).toBe(true);
    expect(isTrustedFileUrl('https://acc123.r2.cloudflarestorage.com/other-bucket/a.docx')).toBe(false);
    expect(isTrustedFileUrl('https://pub-evil.r2.dev/print-service/a.pdf')).toBe(false);
  });

  it('trusts nothing when no storage is configured', () => {
    vi.stubEnv('CLOUDINARY_CLOUD_NAME', '');
    vi.stubEnv('OCI_REGION', '');
    expect(isTrustedFileUrl('https://res.cloudinary.com/da8lufst0/a.pdf')).toBe(false);
  });
});

describe('fetchTrustedFile', () => {
  const good = 'https://res.cloudinary.com/da8lufst0/raw/upload/a.pdf';

  it('never contacts an untrusted URL', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(fetchTrustedFile('https://169.254.169.254/')).rejects.toMatchObject({ status: 400 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('downloads a trusted file', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('%PDF-1.7 data', { headers: { 'content-type': 'application/pdf' } })));
    const { buffer, contentType } = await fetchTrustedFile(good);
    expect(buffer.toString()).toBe('%PDF-1.7 data');
    expect(contentType).toBe('application/pdf');
  });

  it('follows redirects only within our storage', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: '/da8lufst0/raw/upload/b.pdf' } }))
      .mockResolvedValueOnce(new Response('ok'));
    vi.stubGlobal('fetch', fetchMock);
    await expect(fetchTrustedFile(good)).resolves.toMatchObject({ buffer: Buffer.from('ok') });
    expect(fetchMock.mock.calls[1][0]).toBe('https://res.cloudinary.com/da8lufst0/raw/upload/b.pdf');

    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 302, headers: { location: 'http://10.0.0.1/admin' } })));
    await expect(fetchTrustedFile(good)).rejects.toThrow(/Redirect target/);
  });

  it('stops reading at the size limit, declared or not', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('x'.repeat(20), { headers: { 'content-length': '20' } })));
    await expect(fetchTrustedFile(good, { maxBytes: 10 })).rejects.toMatchObject({ status: 413 });
    // No content-length: counted while streaming
    const stream = new ReadableStream({
      start(c) {
        c.enqueue(new TextEncoder().encode('x'.repeat(8)));
        c.enqueue(new TextEncoder().encode('x'.repeat(8)));
        c.close();
      },
    });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(stream)));
    await expect(fetchTrustedFile(good, { maxBytes: 10 })).rejects.toMatchObject({ status: 413 });
  });

  it('maps storage errors', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 404 })));
    await expect(fetchTrustedFile(good)).rejects.toMatchObject({ status: 404 });
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('fetch failed'))));
    await expect(fetchTrustedFile(good)).rejects.toMatchObject({ status: 502 });
  });
});

describe('decodeBase64File', () => {
  it('decodes, strips a data: prefix and enforces the limit', () => {
    expect(decodeBase64File(Buffer.from('hello').toString('base64')).toString()).toBe('hello');
    expect(decodeBase64File(`data:application/pdf;base64,${Buffer.from('hi').toString('base64')}`).toString()).toBe('hi');
    expect(() => decodeBase64File(Buffer.alloc(100).toString('base64'), 10)).toThrow(FileFetchError);
    expect(() => decodeBase64File('')).toThrow(/required/);
  });
});

describe('docxToPdf', () => {
  const pdf = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(200)]);

  it('uses the first configured service and falls back on failure', async () => {
    vi.resetModules();
    vi.stubEnv('CLOUDMERSIVE_API_KEY', 'k');
    vi.stubEnv('CONVERTAPI_SECRET', 's');
    vi.stubEnv('DOCX_TO_PDF_PROVIDERS', '');
    vi.doMock('@/lib/cloudmersive', () => ({ convertDocxToPdf: vi.fn(async () => Promise.reject(new Error('quota exceeded'))) }));
    vi.doMock('@/lib/freeConverters', () => ({ convertDocxToPdfViaConvertAPI: vi.fn(async () => pdf), convertDocxToPdfViaILovePDF: vi.fn() }));
    const { docxToPdf } = await import('@/lib/documents/convert');
    await expect(docxToPdf(Buffer.from('docx'))).resolves.toMatchObject({ provider: 'convertapi' });
  });

  it('rejects output that is not a PDF and reports every attempt', async () => {
    vi.resetModules();
    vi.stubEnv('CLOUDMERSIVE_API_KEY', 'k');
    vi.stubEnv('DOCX_TO_PDF_PROVIDERS', 'cloudmersive');
    vi.doMock('@/lib/cloudmersive', () => ({ convertDocxToPdf: vi.fn(async () => Buffer.from('<html>error</html>')) }));
    const { docxToPdf, ConversionError } = await import('@/lib/documents/convert');
    const err = await docxToPdf(Buffer.from('docx')).catch((e) => e);
    expect(err).toBeInstanceOf(ConversionError);
    expect(err.attempts).toEqual([{ provider: 'cloudmersive', error: 'Service did not return a PDF' }]);
  });

  it('says so when nothing is configured', async () => {
    vi.resetModules();
    vi.stubEnv('CLOUDMERSIVE_API_KEY', '');
    vi.stubEnv('DOCX_TO_PDF_PROVIDERS', 'cloudmersive');
    const { docxToPdf } = await import('@/lib/documents/convert');
    await expect(docxToPdf(Buffer.from('docx'))).rejects.toThrow('No PDF conversion service is configured');
  });
});
