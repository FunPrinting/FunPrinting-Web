import { NextRequest, NextResponse } from 'next/server';

const AUTH_COOKIE_NAMES = [
  '__Secure-next-auth.session-token',
  'next-auth.session-token',
  '__Host-next-auth.csrf-token',
  'next-auth.csrf-token',
  '__Secure-next-auth.callback-url',
  'next-auth.callback-url',
  '__Secure-next-auth.pkce.code_verifier',
  'next-auth.pkce.code_verifier',
  '__Secure-next-auth.state',
  'next-auth.state',
];

function getApexDomain(hostname: string): string | null {
  if (!hostname || hostname.includes('localhost') || hostname.includes('127.0.0.1')) {
    return null;
  }
  const clean = hostname.split(':')[0].toLowerCase();
  if (clean.endsWith('.vercel.app')) return null;
  const parts = clean.split('.');
  if (parts.length >= 2) {
    return `.${parts.slice(-2).join('.')}`;
  }
  return null;
}

function serializeExpiredCookie(name: string, opts: { secure: boolean; domain?: string }): string {
  const parts = [
    `${name}=`,
    'Path=/',
    'Expires=Thu, 01 Jan 1970 00:00:00 GMT',
    'Max-Age=0',
    'HttpOnly',
    'SameSite=Lax',
  ];
  if (opts.secure || name.startsWith('__Secure-') || name.startsWith('__Host-')) {
    parts.push('Secure');
  }
  // __Host- cookies must never include a Domain attribute or browsers reject the header
  if (opts.domain && !name.startsWith('__Host-')) {
    parts.push(`Domain=${opts.domain}`);
  }
  return parts.join('; ');
}

function isSafeRedirect(target: string, reqUrl: string): string | null {
  if (target.startsWith('/') && !target.startsWith('//')) {
    return new URL(target, reqUrl).toString();
  }
  try {
    const parsedTarget = new URL(target);
    const parsedReq = new URL(reqUrl);
    const apex = (h: string) => h.split('.').slice(-2).join('.');
    if (apex(parsedTarget.hostname) === apex(parsedReq.hostname)) {
      return parsedTarget.toString();
    }
  } catch {
    return null;
  }
  return null;
}

function appendLogoutHeaders(req: NextRequest, headers: Headers) {
  const host = req.headers.get('x-forwarded-host') || req.headers.get('host') || '';
  const proto = req.headers.get('x-forwarded-proto') || (host.includes('localhost') ? 'http' : 'https');
  const secure = process.env.NODE_ENV === 'production' || proto === 'https';
  const rawEnvDomain = process.env.VERCEL_ENV !== 'preview' ? process.env.COOKIE_DOMAIN : undefined;
  const apex = rawEnvDomain || getApexDomain(host);

  // Collect both known cookie names and any dynamic/chunked NextAuth cookies present on the request
  const names = new Set<string>(AUTH_COOKIE_NAMES);
  for (const c of req.cookies.getAll()) {
    if (/^(__Secure-|__Host-)?next-auth\./.test(c.name)) {
      names.add(c.name);
    }
  }

  for (const name of names) {
    // 1. Always emit host-only deletion header directly (NextResponse.cookies Map would overwrite it)
    headers.append('Set-Cookie', serializeExpiredCookie(name, { secure }));

    // 2. Also emit domain-scoped deletion header when applicable (skipping __Host-* cookies)
    if (apex && !name.startsWith('__Host-')) {
      headers.append('Set-Cookie', serializeExpiredCookie(name, { secure, domain: apex }));
    }
  }

  headers.set('Cache-Control', 'private, no-store, no-cache, must-revalidate');
  headers.set('Pragma', 'no-cache');
}

export async function GET(req: NextRequest) {
  const rawTarget = req.nextUrl.searchParams.get('callbackUrl') || req.nextUrl.searchParams.get('redirect');
  const safeTarget = rawTarget ? isSafeRedirect(rawTarget, req.url) : null;

  const response = safeTarget
    ? NextResponse.redirect(safeTarget)
    : NextResponse.json({ success: true, message: 'Signed out successfully' });

  appendLogoutHeaders(req, response.headers);
  return response;
}

export async function POST(req: NextRequest) {
  const response = NextResponse.json({ success: true, message: 'Signed out successfully' });
  appendLogoutHeaders(req, response.headers);
  return response;
}
