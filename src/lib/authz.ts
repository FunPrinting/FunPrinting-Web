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
import { logger } from '@/lib/logger';

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
  /** Set for device sign-in access tokens; absent for legacy tokens */
  deviceId?: string;
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
 * Verifies a partner app token from `Authorization: Bearer <jwt>`.
 *
 * - Access tokens (typ "partner_access", PARTNER_JWT_SECRET, 15 min) from the
 *   device sign-in (src/lib/partnerAuth): carry the device id (`did`).
 * - Legacy device tokens (NEXTAUTH_SECRET, 30/365 days) from installed apps that
 *   predate device sign-in: still accepted so they keep working; they have no device id.
 * Signature and expiry are checked here; device revocation in resolvePartnerRequest.
 */
export function requirePartnerToken(
  request: Request
): PartnerTokenClaims | NextResponse {
  const header = request.headers.get('authorization') || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) return unauthorized('Missing bearer token');
  const token = match[1].trim();

  let typ: unknown;
  try {
    typ = (jwt.decode(token) as { typ?: unknown } | null)?.typ;
  } catch {
    return unauthorized('Invalid token');
  }
  const isAccess = typ === 'partner_access';
  const secret = isAccess ? process.env.PARTNER_JWT_SECRET : process.env.NEXTAUTH_SECRET;
  if (!secret) {
    logger.error(`${isAccess ? 'PARTNER_JWT_SECRET' : 'NEXTAUTH_SECRET'} is not set; cannot verify partner tokens`);
    return NextResponse.json({ success: false, error: 'Server misconfiguration' }, { status: 500 });
  }

  try {
    // jwt.verify enforces signature and `exp`
    const decoded = jwt.verify(token, secret, { algorithms: ['HS256'] });
    if (typeof decoded !== 'object' || decoded === null) return unauthorized('Invalid token');
    const claims = decoded as jwt.JwtPayload & { partnerId?: unknown; role?: unknown; did?: unknown; typ?: unknown };
    if (typeof claims.exp !== 'number') return unauthorized('Token has no expiry');
    const role = claims.role;
    if (role !== 'partner' && role !== 'admin') return unauthorized('Invalid token role');
    if (typeof claims.sub !== 'string' || !claims.sub) return unauthorized('Invalid token subject');
    if (typeof claims.partnerId !== 'string' || !claims.partnerId) return unauthorized('Invalid token partner');
    if (isAccess && claims.typ !== 'partner_access') return unauthorized('Invalid token type');
    if (isAccess && (typeof claims.did !== 'string' || !claims.did)) return unauthorized('Invalid token device');
    return { userId: claims.sub, partnerId: claims.partnerId, role, deviceId: isAccess ? (claims.did as string) : undefined };
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

/**
 * Resolves the Partner document for a partner API request.
 *
 * - `Authorization: Bearer <jwt>` (desktop/mobile apps): verified with requirePartnerToken.
 *   The Partner is looked up by the token's partnerId and must belong to the token's
 *   subject (User._id). Tokens issued before Phase 0 carried partnerId = User._id, so we
 *   fall back to Partner.findOne({ userId: sub }) for those.
 * - Otherwise the NextAuth session is used (web /partner/dashboard).
 *
 * Returns { partner, userId } or a 401/404 NextResponse. `partner` is null only when
 * `allowMissing` is true and the caller has no Partner document yet.
 */
export async function resolvePartnerRequest(
  request: Request,
  { allowMissing = false, allowInactive = false }: { allowMissing?: boolean; allowInactive?: boolean } = {}
): Promise<
  | { partner: any; userId: string; deviceId?: string }
  | NextResponse
> {
  // Lazy imports keep this module light for routes that only need session helpers
  const { default: connectDB } = await import('@/lib/mongodb');
  const { default: Partner } = await import('@/models/Partner');

  let userId: string;
  let tokenPartnerId: string | null = null;
  let deviceId: string | undefined;

  if (request.headers.get('authorization')) {
    const claims = requirePartnerToken(request);
    if (claims instanceof NextResponse) return claims;
    userId = claims.userId;
    tokenPartnerId = claims.partnerId;
    deviceId = claims.deviceId;
    if (deviceId) {
      const { isDeviceActive } = await import('@/lib/partnerAuth/service');
      if (!(await isDeviceActive(deviceId))) return unauthorized('This device has been signed out');
    }
  } else {
    const user = await getSessionUser();
    if (!user || !user.id) return unauthorized('Authentication required');
    userId = user.id;
  }

  await connectDB();

  let partner = null;
  if (tokenPartnerId && /^[0-9a-fA-F]{24}$/.test(tokenPartnerId)) {
    partner = await Partner.findOne({ _id: tokenPartnerId, userId });
  }
  if (!partner) {
    partner = await Partner.findOne({ userId });
  }

  if (!partner && !allowMissing) {
    return NextResponse.json(
      { success: false, error: 'Partner profile not found' },
      { status: 404 }
    );
  }
  // Unapproved or deactivated partners can manage their profile (allowInactive)
  // but cannot see or act on orders. This also cuts off device tokens of a
  // partner an admin deactivates, without waiting for the token to expire.
  if (partner && !partner.isActive && !allowInactive) {
    return forbidden('Partner account is not active');
  }
  return { partner, userId, deviceId };
}
