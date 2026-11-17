import jwt from 'jsonwebtoken';
import { NextResponse } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// authz imports next-auth's getServerSession and the NextAuth config; neither is
// needed for the pure helpers tested here.
vi.mock('next-auth', () => ({ getServerSession: vi.fn() }));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));

import { canAccessOrder, isAdminSession, requirePartnerToken } from '@/lib/authz';

const SECRET = 'test-secret-at-least-16-chars';
const PARTNER_ID = 'a'.repeat(24);
const USER_ID = 'b'.repeat(24);

function req(authorization?: string) {
  return new Request('http://localhost/api/partner/orders', {
    headers: authorization ? { authorization } : {},
  });
}

function sign(payload: object, opts: jwt.SignOptions = { expiresIn: '1h' }, secret = SECRET) {
  return jwt.sign(payload, secret, opts);
}

describe('isAdminSession', () => {
  beforeEach(() => {
    vi.stubEnv('ADMIN_EMAILS', 'Boss@Example.com, ops@example.com');
    vi.stubEnv('ADMIN_EMAIL', 'legacy@example.com');
    vi.stubEnv('NEXT_PUBLIC_ADMIN_EMAIL', 'public@example.com');
  });

  it('accepts the admin role regardless of email', () => {
    expect(isAdminSession({ role: 'admin', email: 'someone@else.com' })).toBe(true);
  });

  it('accepts allowlisted emails from every env var, case-insensitively', () => {
    expect(isAdminSession({ role: 'customer', email: 'boss@example.com' })).toBe(true);
    expect(isAdminSession({ role: 'customer', email: ' OPS@example.com ' })).toBe(true);
    expect(isAdminSession({ role: 'customer', email: 'legacy@example.com' })).toBe(true);
    expect(isAdminSession({ role: 'customer', email: 'public@example.com' })).toBe(true);
  });

  it('rejects other users and missing input', () => {
    expect(isAdminSession({ role: 'partner', email: 'partner@example.com' })).toBe(false);
    expect(isAdminSession({ role: 'customer', email: null })).toBe(false);
    expect(isAdminSession(null)).toBe(false);
  });

  it('treats an empty allowlist as no admins by email', () => {
    vi.stubEnv('ADMIN_EMAILS', '');
    vi.stubEnv('ADMIN_EMAIL', '');
    vi.stubEnv('NEXT_PUBLIC_ADMIN_EMAIL', '');
    expect(isAdminSession({ role: 'customer', email: '' })).toBe(false);
  });
});

describe('requirePartnerToken', () => {
  beforeEach(() => {
    vi.stubEnv('NEXTAUTH_SECRET', SECRET);
  });

  it('returns claims for a valid partner token', () => {
    const token = sign({ sub: USER_ID, partnerId: PARTNER_ID, role: 'partner' });
    expect(requirePartnerToken(req(`Bearer ${token}`))).toEqual({
      userId: USER_ID,
      partnerId: PARTNER_ID,
      role: 'partner',
    });
  });

  it.each([
    ['missing header', undefined],
    ['non-bearer scheme', 'Basic abc'],
    ['garbage token', 'Bearer not-a-jwt'],
  ])('rejects %s with 401', (_label, header) => {
    const res = requirePartnerToken(req(header));
    expect(res).toBeInstanceOf(NextResponse);
    expect((res as NextResponse).status).toBe(401);
  });

  it('rejects an expired token', () => {
    const token = sign({ sub: USER_ID, partnerId: PARTNER_ID, role: 'partner', exp: Math.floor(Date.now() / 1000) - 60 }, {});
    expect((requirePartnerToken(req(`Bearer ${token}`)) as NextResponse).status).toBe(401);
  });

  it('rejects a token without an expiry', () => {
    const token = sign({ sub: USER_ID, partnerId: PARTNER_ID, role: 'partner' }, {});
    expect((requirePartnerToken(req(`Bearer ${token}`)) as NextResponse).status).toBe(401);
  });

  it('rejects a token signed with another secret (forged)', () => {
    const token = sign({ sub: USER_ID, partnerId: PARTNER_ID, role: 'partner' }, { expiresIn: '1h' }, 'attacker-secret-xxxxxxxx');
    expect((requirePartnerToken(req(`Bearer ${token}`)) as NextResponse).status).toBe(401);
  });

  it('rejects an unsigned token (alg none)', () => {
    const body = Buffer.from(JSON.stringify({ sub: USER_ID, partnerId: PARTNER_ID, role: 'partner', exp: 9999999999 })).toString('base64url');
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    expect((requirePartnerToken(req(`Bearer ${header}.${body}.`)) as NextResponse).status).toBe(401);
  });

  it('rejects customer role and missing partnerId', () => {
    const customer = sign({ sub: USER_ID, partnerId: PARTNER_ID, role: 'customer' });
    const noPartner = sign({ sub: USER_ID, role: 'partner' });
    expect((requirePartnerToken(req(`Bearer ${customer}`)) as NextResponse).status).toBe(401);
    expect((requirePartnerToken(req(`Bearer ${noPartner}`)) as NextResponse).status).toBe(401);
  });

  it('returns 500 when the server secret is not configured', () => {
    vi.stubEnv('NEXTAUTH_SECRET', '');
    const token = sign({ sub: USER_ID, partnerId: PARTNER_ID, role: 'partner' });
    expect((requirePartnerToken(req(`Bearer ${token}`)) as NextResponse).status).toBe(500);
  });
});

describe('canAccessOrder', () => {
  const owner = { id: USER_ID, email: 'owner@example.com', role: 'customer' };
  const order = { customerInfo: { email: 'Owner@Example.com' } };

  it('allows the owner (case-insensitive) and admins', () => {
    vi.stubEnv('ADMIN_EMAILS', 'admin@example.com');
    expect(canAccessOrder(owner, order)).toBe(true);
    expect(canAccessOrder({ id: 'x', email: 'admin@example.com', role: 'customer' }, order)).toBe(true);
  });

  it('denies other users and orders without an owner email', () => {
    vi.stubEnv('ADMIN_EMAILS', '');
    expect(canAccessOrder({ id: 'y', email: 'other@example.com', role: 'customer' }, order)).toBe(false);
    expect(canAccessOrder(owner, { customerInfo: {} })).toBe(false);
    expect(canAccessOrder(null, order)).toBe(false);
  });
});
