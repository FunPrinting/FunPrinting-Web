import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { middleware } from '@/middleware';

describe('Enterprise Subdomain Middleware', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  function makeRequest(url: string, host: string) {
    return new NextRequest(url, {
      headers: { host },
    });
  }

  describe('Admin Subdomain (admin.anydomain.com)', () => {
    const adminHost = 'admin.anydomain.com';

    it('rewrites root "/" to internal "/admin" and sets noindex robots header', () => {
      const req = makeRequest('https://admin.anydomain.com/', adminHost);
      const res = middleware(req);

      expect(res.headers.get('x-middleware-rewrite')).toBe('https://admin.anydomain.com/admin');
      expect(res.headers.get('X-Robots-Tag')).toBe('noindex, nofollow');
    });

    it('rewrites known admin subpaths like "/templates" to "/admin/templates"', () => {
      const req = makeRequest('https://admin.anydomain.com/templates', adminHost);
      const res = middleware(req);

      expect(res.headers.get('x-middleware-rewrite')).toBe('https://admin.anydomain.com/admin/templates');
      expect(res.headers.get('X-Robots-Tag')).toBe('noindex, nofollow');
    });

    it('canonicalizes redundant "/admin" to root "/"', () => {
      const req = makeRequest('https://admin.anydomain.com/admin', adminHost);
      const res = middleware(req);

      expect(res.status).toBe(307);
      expect(res.headers.get('location')).toBe('https://admin.anydomain.com/');
    });

    it('canonicalizes redundant "/admin/templates" to clean "/templates"', () => {
      const req = makeRequest('https://admin.anydomain.com/admin/templates?tab=live', adminHost);
      const res = middleware(req);

      expect(res.status).toBe(307);
      expect(res.headers.get('location')).toBe('https://admin.anydomain.com/templates?tab=live');
    });

    it('rewrites "/orders/ORD123" to "/admin/orders/ORD123" preserving search parameters', () => {
      const req = makeRequest('https://admin.anydomain.com/orders/ORD123?page=2', adminHost);
      const res = middleware(req);

      expect(res.headers.get('x-middleware-rewrite')).toBe('https://admin.anydomain.com/admin/orders/ORD123?page=2');
      expect(res.headers.get('X-Robots-Tag')).toBe('noindex, nofollow');
    });

    it('allows API routes to pass through untouched', () => {
      const req = makeRequest('https://admin.anydomain.com/api/admin/orders?page=1', adminHost);
      const res = middleware(req);

      expect(res.headers.get('x-middleware-rewrite')).toBeNull();
      expect(res.status).toBe(200);
    });

    it('allows auth routes to pass through untouched', () => {
      const req = makeRequest('https://admin.anydomain.com/auth/signin', adminHost);
      const res = middleware(req);

      expect(res.headers.get('x-middleware-rewrite')).toBeNull();
      expect(res.status).toBe(200);
    });

    it('redirects customer-specific routes like "/cart" to the root customer store', () => {
      const req = makeRequest('https://admin.myshop.com/cart', 'admin.myshop.com');
      const res = middleware(req);

      expect(res.status).toBe(307);
      expect(res.headers.get('location')).toBe('https://myshop.com/cart');
    });
  });

  describe('Apex / Root Domain (www.domain.com and domain.com)', () => {
    it('redirects "www.domain.com/admin" to "admin.domain.com/"', () => {
      const req = makeRequest('https://www.domain.com/admin', 'www.domain.com');
      const res = middleware(req);

      expect(res.status).toBe(307);
      expect(res.headers.get('location')).toBe('https://admin.domain.com/');
    });

    it('redirects "www.domain.com/admin/templates" to "admin.domain.com/templates"', () => {
      const req = makeRequest('https://www.domain.com/admin/templates?tab=new', 'www.domain.com');
      const res = middleware(req);

      expect(res.status).toBe(307);
      expect(res.headers.get('location')).toBe('https://admin.domain.com/templates?tab=new');
    });

    it('redirects apex "domain.com/admin" to "admin.domain.com/"', () => {
      const req = makeRequest('https://domain.com/admin', 'domain.com');
      const res = middleware(req);

      expect(res.status).toBe(307);
      expect(res.headers.get('location')).toBe('https://admin.domain.com/');
    });

    it('allows customer pages on root domain to pass through untouched', () => {
      const req = makeRequest('https://www.domain.com/templates', 'www.domain.com');
      const res = middleware(req);

      expect(res.headers.get('x-middleware-rewrite')).toBeNull();
      expect(res.status).toBe(200);
    });
  });
});
