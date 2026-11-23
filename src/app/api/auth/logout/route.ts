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
  const parts = clean.split('.');
  if (parts.length >= 2) {
    return `.${parts.slice(-2).join('.')}`;
  }
  return null;
}

function handleLogout(req: NextRequest) {
  const host = req.headers.get('x-forwarded-host') || req.headers.get('host') || '';
  const apex = process.env.COOKIE_DOMAIN || getApexDomain(host);

  const response = NextResponse.json({ success: true, message: 'Signed out successfully' });

  // Clear every variant of NextAuth cookies across both host-only and apex domain
  for (const name of AUTH_COOKIE_NAMES) {
    // 1. Clear host-only
    response.cookies.set({
      name,
      value: '',
      path: '/',
      maxAge: 0,
      expires: new Date(0),
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
    });

    // 2. Clear domain-scoped if applicable
    if (apex) {
      response.cookies.set({
        name,
        value: '',
        path: '/',
        domain: apex,
        maxAge: 0,
        expires: new Date(0),
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
      });
    }
  }

  return response;
}

export async function GET(req: NextRequest) {
  const redirectUrl = req.nextUrl.searchParams.get('callbackUrl') || req.nextUrl.searchParams.get('redirect');
  const res = handleLogout(req);
  if (redirectUrl) {
    return NextResponse.redirect(new URL(redirectUrl, req.url), {
      headers: res.headers,
    });
  }
  return res;
}

export async function POST(req: NextRequest) {
  return handleLogout(req);
}

