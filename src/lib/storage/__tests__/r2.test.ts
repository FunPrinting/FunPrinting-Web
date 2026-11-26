import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const s3Mocks = vi.hoisted(() => ({
  send: vi.fn(async () => ({})),
  getSignedUrl: vi.fn(async () => 'https://acc123.r2.cloudflarestorage.com/funprinting-files/signed-put?X-Amz-Signature=abc'),
}));

vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: class {
    send = s3Mocks.send;
  },
  PutObjectCommand: class {
    constructor(public input: Record<string, unknown>) {}
  },
  GetObjectCommand: class {
    constructor(public input: Record<string, unknown>) {}
  },
  DeleteObjectCommand: class {
    constructor(public input: Record<string, unknown>) {}
  },
}));

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: s3Mocks.getSignedUrl,
}));

const auth = vi.hoisted(() => ({ user: null as null | { id: string; email: string } }));
vi.mock('@/lib/authz', () => ({
  requireUser: vi.fn(async () => auth.user ?? NextResponse.json({ error: 'Authentication required' }, { status: 401 })),
}));

vi.mock('@/lib/ratelimit', () => ({
  checkRateLimit: vi.fn(async () => null),
  generationRateLimit: {},
  getClientIdentifier: () => 'test-ip',
}));

beforeEach(() => {
  vi.clearAllMocks();
  auth.user = { id: 'u1', email: 'student@example.com' };
  vi.stubEnv('STORAGE_PROVIDER', 'r2');
  vi.stubEnv('R2_ACCOUNT_ID', 'acc123');
  vi.stubEnv('R2_ACCESS_KEY_ID', 'key123');
  vi.stubEnv('R2_SECRET_ACCESS_KEY', 'sec123');
  vi.stubEnv('R2_BUCKET_NAME', 'funprinting-files');
  vi.stubEnv('R2_PUBLIC_URL', 'https://pub-demo123.r2.dev');
});

describe('Cloudflare R2 storage & presigned uploads', () => {
  it('auto-selects r2 when R2 env vars are set and STORAGE_PROVIDER is unset', async () => {
    vi.stubEnv('STORAGE_PROVIDER', '');
    const { resolveStorageProviderName } = await import('@/lib/storage');
    expect(resolveStorageProviderName()).toBe('r2');
  });

  it('POST /api/upload-presign returns a presigned R2 PUT URL for a 25 MB PDF', async () => {
    const { POST } = await import('@/app/api/upload-presign/route');
    const req = new NextRequest('http://x/api/upload-presign', {
      method: 'POST',
      body: JSON.stringify({
        fileName: 'lab-manual.pdf',
        contentType: 'application/pdf',
        fileSize: 25 * 1024 * 1024,
        purpose: 'order',
      }),
    });
    const res = await POST(req);
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.supported).toBe(true);
    expect(data.uploadUrl).toContain('r2.cloudflarestorage.com');
    expect(data.fileUrl).toMatch(/^https:\/\/pub-demo123\.r2\.dev\/print-service\/document_.*\.pdf$/);
  });

  it('POST /api/upload-presign rejects files over 50 MB and unauthenticated order requests', async () => {
    const { POST } = await import('@/app/api/upload-presign/route');
    const overLimit = new NextRequest('http://x/api/upload-presign', {
      method: 'POST',
      body: JSON.stringify({
        fileName: 'huge.pdf',
        contentType: 'application/pdf',
        fileSize: 55 * 1024 * 1024,
        purpose: 'order',
      }),
    });
    expect((await POST(overLimit)).status).toBe(413);

    auth.user = null;
    const unauth = new NextRequest('http://x/api/upload-presign', {
      method: 'POST',
      body: JSON.stringify({
        fileName: 'a.pdf',
        contentType: 'application/pdf',
        fileSize: 1024,
        purpose: 'order',
      }),
    });
    expect((await POST(unauth)).status).toBe(401);
  });

  it('POST /api/upload-presign returns supported: false when R2 is not active', async () => {
    vi.stubEnv('STORAGE_PROVIDER', 'cloudinary');
    const { POST } = await import('@/app/api/upload-presign/route');
    const req = new NextRequest('http://x/api/upload-presign', {
      method: 'POST',
      body: JSON.stringify({
        fileName: 'small.pdf',
        contentType: 'application/pdf',
        fileSize: 1024,
        purpose: 'order',
      }),
    });
    const res = await POST(req);
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.supported).toBe(false);
  });

  it('POST /api/upload-finalize refuses untrusted URLs and finalizes valid R2 PDFs', async () => {
    vi.stubEnv('NEXTAUTH_SECRET', 'test-secret-key-at-least-32-chars-long');
    const { PDFDocument } = await import('pdf-lib');
    const pdf = await PDFDocument.create();
    pdf.addPage();
    pdf.addPage();
    const pdfBytes = Buffer.from(await pdf.save());

    vi.stubGlobal('fetch', vi.fn(async () => new Response(pdfBytes, { headers: { 'content-type': 'application/pdf' } })));

    const { POST } = await import('@/app/api/upload-finalize/route');
    const badReq = new NextRequest('http://x/api/upload-finalize', {
      method: 'POST',
      body: JSON.stringify({ fileUrl: 'https://evil.example.com/a.pdf', fileName: 'a.pdf', fileType: 'application/pdf' }),
    });
    expect((await POST(badReq)).status).toBe(400);

    const goodReq = new NextRequest('http://x/api/upload-finalize', {
      method: 'POST',
      body: JSON.stringify({
        fileUrl: 'https://pub-demo123.r2.dev/print-service/doc123.pdf',
        fileName: 'manual.pdf',
        fileType: 'application/pdf',
      }),
    });
    const res = await POST(goodReq);
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.pageCount).toBe(2);
    expect(data.receipt).toBeTruthy();
  });
});

