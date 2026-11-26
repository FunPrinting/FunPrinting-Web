import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { GET, POST } from '@/app/api/auth/logout/route';

describe('/api/auth/logout', () => {
  it('emits both host-only and domain-scoped Set-Cookie deletions, omits Domain on __Host-, and clears chunked cookies', async () => {
    const req = new NextRequest('https://www.funprinting.store/api/auth/logout', {
      method: 'POST',
      headers: {
        host: 'www.funprinting.store',
        cookie: '__Secure-next-auth.session-token.0=abc; __Secure-next-auth.session-token.1=def',
      },
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toContain('no-store');

    const setCookies = res.headers.getSetCookie();
    // Host-only AND Domain=.funprinting.store are both emitted for session-token
    expect(setCookies.some((c) => c.startsWith('__Secure-next-auth.session-token=;') && !c.includes('Domain='))).toBe(true);
    expect(setCookies.some((c) => c.startsWith('__Secure-next-auth.session-token=;') && c.includes('Domain=.funprinting.store'))).toBe(true);

    // Chunked cookies are cleared on both scopes
    expect(setCookies.some((c) => c.startsWith('__Secure-next-auth.session-token.0=;') && !c.includes('Domain='))).toBe(true);
    expect(setCookies.some((c) => c.startsWith('__Secure-next-auth.session-token.0=;') && c.includes('Domain=.funprinting.store'))).toBe(true);
    expect(setCookies.some((c) => c.startsWith('__Secure-next-auth.session-token.1=;') && c.includes('Domain=.funprinting.store'))).toBe(true);

    // __Host- cookies NEVER receive a Domain attribute
    const hostCookies = setCookies.filter((c) => c.startsWith('__Host-next-auth.csrf-token='));
    expect(hostCookies.length).toBe(1);
    expect(hostCookies[0]).not.toContain('Domain=');
  });

  it('allows same-apex or relative callbackUrl on GET and blocks external open redirects', async () => {
    const safeReq = new NextRequest('https://admin.funprinting.store/api/auth/logout?callbackUrl=https%3A%2F%2Fwww.funprinting.store%2F', {
      headers: { host: 'admin.funprinting.store' },
    });
    const safeRes = await GET(safeReq);
    expect(safeRes.status).toBe(307);
    expect(safeRes.headers.get('location')).toBe('https://www.funprinting.store/');

    const unsafeReq = new NextRequest('https://www.funprinting.store/api/auth/logout?callbackUrl=https%3A%2F%2Fevil.example%2F', {
      headers: { host: 'www.funprinting.store' },
    });
    const unsafeRes = await GET(unsafeReq);
    expect(unsafeRes.status).toBe(200);
  });
});
