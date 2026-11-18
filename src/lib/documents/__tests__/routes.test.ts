import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const auth = vi.hoisted(() => ({ user: null as null | { id: string; email: string; role?: string } }));
vi.mock('@/lib/authz', () => ({
  requireUser: vi.fn(async () => auth.user ?? NextResponse.json({ error: 'Authentication required' }, { status: 401 })),
  isAdminSession: (u: { role?: string }) => u?.role === 'admin',
  canAccessOrder: () => true,
  getSessionUser: vi.fn(async () => auth.user),
}));
vi.mock('@/lib/mongodb', () => ({ default: vi.fn() }));
vi.mock('@/models/Order', () => ({ default: { findOne: () => ({ lean: async () => null }) } }));

const FILE = 'https://res.cloudinary.com/da8lufst0/raw/upload/v1/x';

beforeEach(() => {
  vi.stubEnv('CLOUDINARY_CLOUD_NAME', 'da8lufst0');
  auth.user = { id: 'u1', email: 'admin@example.com', role: 'admin' };
});

describe('GET /api/admin/pdf-viewer', () => {
  const call = async (url: string, filename: string) => {
    const { GET } = await import('@/app/api/admin/pdf-viewer/route');
    return GET(new NextRequest(`http://x/api/admin/pdf-viewer?url=${encodeURIComponent(url)}&filename=${encodeURIComponent(filename)}`));
  };

  it('refuses addresses outside our storage, even for admins', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const res = await call('http://169.254.169.254/latest/meta-data/', 'a.pdf');
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('shows PDFs inline but downloads SVG/HTML, with nosniff', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<svg onload="alert(1)"/>')));
    const svg = await call(FILE, 'logo.svg');
    expect(svg.headers.get('content-type')).toBe('application/octet-stream');
    expect(svg.headers.get('content-disposition')).toMatch(/^attachment;/);
    expect(svg.headers.get('x-content-type-options')).toBe('nosniff');

    vi.stubGlobal('fetch', vi.fn(async () => new Response('%PDF-1.7')));
    const pdf = await call(FILE, 'notes "final".pdf');
    expect(pdf.headers.get('content-type')).toBe('application/pdf');
    expect(pdf.headers.get('content-disposition')).toBe(`inline; filename="notes _final_.pdf"; filename*=UTF-8''notes%20%22final%22.pdf`);
  });

  it('customers need an order they own', async () => {
    auth.user = { id: 'u2', email: 'c@example.com' };
    const res = await call(FILE, 'a.pdf');
    expect(res.status).toBe(403);
  });
});

describe('POST /api/extract-placeholders', () => {
  it('needs sign-in and only downloads our files', async () => {
    const { POST } = await import('@/app/api/extract-placeholders/route');
    const req = (body: unknown) => new NextRequest('http://x/api/extract-placeholders', { method: 'POST', body: JSON.stringify(body) });

    auth.user = null;
    expect((await POST(req({ fileUrl: FILE }))).status).toBe(401);

    auth.user = { id: 'u1', email: 'u@example.com' };
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const res = await POST(req({ fileUrl: 'http://localhost:3000/api/admin/errors' }));
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
