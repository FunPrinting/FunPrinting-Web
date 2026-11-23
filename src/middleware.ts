import { NextRequest, NextResponse } from 'next/server';

/**
 * Enterprise Subdomain Middleware for Next.js App Router:
 * 
 * 1. Admin Subdomain (admin.*):
 *    - Serves internal /admin views at clean root URLs (e.g. admin.domain.com/templates -> /admin/templates).
 *    - Canonicalizes redundant /admin prefixes (e.g. admin.domain.com/admin/templates -> admin.domain.com/templates).
 *    - Preserves API endpoints, Next.js assets, and authentication handlers.
 *    - Forwards security header X-Robots-Tag: noindex, nofollow to prevent search engine indexing.
 *    - Dynamically redirects misplaced customer routes (e.g. /cart) to the root store.
 * 
 * 2. Root Apex Domain (domain.com / www.domain.com):
 *    - Automatically redirects /admin or /admin/* to https://admin.domain.com/*
 *      (can be disabled with REDIRECT_ADMIN_SUBDOMAIN='false' for emergency fallback).
 */
export function middleware(request: NextRequest) {
  const host = request.headers.get('x-forwarded-host') || request.headers.get('host') || '';
  const [hostname, port] = host.split(':');
  const lowerHost = (hostname || '').toLowerCase();

  const isLocalHost = lowerHost.includes('localhost') || lowerHost === '127.0.0.1';
  const parts = lowerHost.split('.');

  // Subdomain prefix (default: 'admin')
  const targetSubdomain = (process.env.ADMIN_SUBDOMAIN || 'admin').toLowerCase();

  // Dynamic subdomain check: works on admin.funprinting.store, admin.localhost, etc.
  const isSubdomainAdmin = parts.length > (isLocalHost ? 1 : 2) && parts[0] === targetSubdomain;

  const { pathname, search } = request.nextUrl;

  // Static assets, image optimization, favicon, and API routes always pass through
  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/api') ||
    pathname === '/favicon.ico' ||
    pathname.includes('.')
  ) {
    return NextResponse.next();
  }

  // === 1. Admin Subdomain Routing ===
  if (isSubdomainAdmin) {
    // Auth routes pass through directly
    if (pathname.startsWith('/auth')) {
      return NextResponse.next();
    }

    // Canonicalize: If URL on admin subdomain contains redundant /admin prefix,
    // 307 redirect to clean path (e.g. admin.domain.com/admin/templates -> admin.domain.com/templates)
    if (pathname === '/admin') {
      return NextResponse.redirect(new URL(`/${search}`, request.url), 307);
    }
    if (pathname.startsWith('/admin/')) {
      const cleanPath = pathname.replace(/^\/admin/, '');
      return NextResponse.redirect(new URL(`${cleanPath}${search}`, request.url), 307);
    }

    // Root path -> internally rewrite to /admin
    if (pathname === '/') {
      const url = request.nextUrl.clone();
      url.pathname = '/admin';
      const res = NextResponse.rewrite(url);
      res.headers.set('X-Robots-Tag', 'noindex, nofollow');
      return res;
    }

    // Known admin sections -> rewrite to /admin/<section>
    const adminKnownPrefixes = [
      '/templates',
      '/orders',
      '/creator-earnings',
      '/pricing',
      '/info',
      '/errors',
      '/partners',
    ];

    if (adminKnownPrefixes.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
      const url = request.nextUrl.clone();
      url.pathname = `/admin${pathname}`;
      const res = NextResponse.rewrite(url);
      res.headers.set('X-Robots-Tag', 'noindex, nofollow');
      return res;
    }

    // Misplaced customer routes on admin subdomain -> dynamically redirect to root customer store
    const rootHost = parts.slice(1).join('.');
    const protocol = request.headers.get('x-forwarded-proto') || (isLocalHost ? 'http' : 'https');
    const portSuffix = port ? `:${port}` : '';
    const rootUrl = `${protocol}://${rootHost}${portSuffix}`;

    return NextResponse.redirect(new URL(pathname + search, rootUrl), 307);
  }

  // === 2. Apex / Root Domain Routing ===
  // When a user accesses /admin on the main store, redirect to the dedicated admin subdomain:
  // e.g. www.funprinting.store/admin -> admin.funprinting.store/
  // e.g. www.funprinting.store/admin/templates -> admin.funprinting.store/templates
  // Can be bypassed by setting REDIRECT_ADMIN_SUBDOMAIN='false' if ever needed.
  const redirectEnabled = process.env.REDIRECT_ADMIN_SUBDOMAIN !== 'false';
  if (redirectEnabled && (pathname === '/admin' || pathname.startsWith('/admin/'))) {
    const adminSubPath = pathname.replace(/^\/admin/, '') || '/';
    const protocol = request.headers.get('x-forwarded-proto') || (isLocalHost ? 'http' : 'https');
    const portSuffix = port ? `:${port}` : '';
    // Strip leading 'www.' if present so we get 'admin.funprinting.store' instead of 'admin.www.funprinting.store'
    const cleanApexHost = lowerHost.replace(/^www\./, '');
    const adminBaseUrl = `${protocol}://${targetSubdomain}.${cleanApexHost}${portSuffix}`;
    return NextResponse.redirect(new URL(adminSubPath + search, adminBaseUrl), 307);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js)$).*)',
  ],
};
