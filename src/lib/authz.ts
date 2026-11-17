/**
 * Server-side authorization helpers.
 *
 * Usage pattern in route handlers:
 *
 *   const auth = await requireAdmin();
 *   if (auth instanceof NextResponse) return auth;
 *   // auth is the SessionUser
 *
 *   const partner = requirePartnerToken(request);
 *   if (partner instanceof NextResponse) return partner;
 *   // partner is { userId, partnerId, role }
 */
import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';
import jwt from 'jsonwebtoken';
import { authOptions } from '@/lib/auth';

export interface SessionUser {
  id: string;
  email: string;
  role: string;
  name?: string | null;
}

export interface PartnerTokenClaims {
  userId: string;
  partnerId: string;
  role: 'partner' | 'admin';
}

function unauthorized(message = 'Unauthorized') {
  return NextResponse.json({ success: false, error: message }, { status: 401 });
}

function forbidden(message = 'Forbidden') {
  return NextResponse.json({ success: false, error: message }, { status: 403 });
}

/**
 * Admin email allowlist from env: ADMIN_EMAILS (comma-separated), ADMIN_EMAIL,
 * and NEXT_PUBLIC_ADMIN_EMAIL (kept for backward compatibility).
 */
export function getAdminEmails(): string[] {
  const raw = [
    ...(process.env.ADMIN_EMAILS || '').split(','),
    process.env.ADMIN_EMAIL || '',
    process.env.NEXT_PUBLIC_ADMIN_EMAIL || '',
  ];
  return Array.from(
    new Set(raw.map((e) => e.trim().toLowerCase()).filter((e) => e.length > 0))
  );
}

export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return getAdminEmails().includes(email.trim().toLowerCase());
}

export function isAdminSession(
  user: { role?: string | null; email?: string | null } | null | undefined
): boolean {
  if (!user) return false;
  return user.role === 'admin' || isAdminEmail(user.email);
}

/**
 * Returns the current session user, or null if not signed in.
 */
export async function getSessionUser(): Promise<SessionUser | null> {
  const session = await getServerSession(authOptions);
  const u = session?.user as
    | { id?: string; email?: string | null; role?: string; name?: string | null }
    | undefined;
  if (!u || !u.email) return null;
  return {
    id: u.id || '',
    email: u.email.toLowerCase(),
    role: u.role || 'customer',
    name: u.name ?? null,
  };
}

/**
 * Requires a signed-in user. Returns the user or a 401 response.
 */
export async function requireUser(): Promise<SessionUser | NextResponse> {
  const user = await getSessionUser();
  if (!user) return unauthorized('Authentication required');
  return user;
}

/**
 * Requires an admin session. 401 if signed out, 403 if not an admin.
 */
export async function requireAdmin(): Promise<SessionUser | NextResponse> {
  const user = await getSessionUser();
  if (!user) return unauthorized('Authentication required');
  if (!isAdminSession(user)) return forbidden('Admin access required');
  return user;
}

/**
 * Verifies a partner device token from `Authorization: Bearer <jwt>`.
 * Token is signed by /api/partner/desktop-token with NEXTAUTH_SECRET.
 * Returns the claims or a 401 (500 if the server secret is not configured).
 */
export function requirePartnerToken(
  request: Request
): PartnerTokenClaims | NextResponse {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) {
    console.error('❌ NEXTAUTH_SECRET is not set; cannot verify partner tokens');
    return NextResponse.json(
      { success: false, error: 'Server misconfiguration' },
      { status: 500 }
    );
  }

  const header = request.headers.get('authorization') || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) return unauthorized('Missing bearer token');

  try {
    // jwt.verify enforces signature and `exp`
    const decoded = jwt.verify(match[1].trim(), secret, {
      algorithms: ['HS256'],
    });
    if (typeof decoded !== 'object' || decoded === null) {
      return unauthorized('Invalid token');
    }
    const claims = decoded as jwt.JwtPayload & {
      partnerId?: unknown;
      role?: unknown;
    };
    if (typeof claims.exp !== 'number') return unauthorized('Token has no expiry');
    const role = claims.role;
    if (role !== 'partner' && role !== 'admin') return unauthorized('Invalid token role');
    if (typeof claims.sub !== 'string' || !claims.sub) return unauthorized('Invalid token subject');
    if (typeof claims.partnerId !== 'string' || !claims.partnerId) {
      return unauthorized('Invalid token partner');
    }
    return { userId: claims.sub, partnerId: claims.partnerId, role };
  } catch {
    return unauthorized('Invalid or expired token');
  }
}

/**
 * True if the session user may view this order: admin, or the order's customer
 * (orders store the owner as customerInfo.email; there is no userId on Order).
 */
export function canAccessOrder(
  user: SessionUser | null | undefined,
  order: { customerInfo?: { email?: string | null } | null } | null | undefined
): boolean {
  if (!user || !order) return false;
  if (isAdminSession(user)) return true;
  const ownerEmail = order.customerInfo?.email?.trim().toLowerCase();
  return Boolean(ownerEmail && ownerEmail === user.email.toLowerCase());
}
