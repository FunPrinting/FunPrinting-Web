import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { NextResponse } from 'next/server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const ws = vi.hoisted(() => ({ disconnected: [] as string[] }));
vi.mock('@/lib/wssClient', () => ({ disconnectDevice: vi.fn(async (_p: string, d: string) => { ws.disconnected.push(d); return { ok: true, delivered: 1 }; }) }));
vi.mock('next-auth', () => ({ getServerSession: vi.fn() }));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));

import { challengeFor, exchangeCode, issueAuthCode, refreshTokens, revokeAllDevices, revokeDevice } from '@/lib/partnerAuth/service';
import { isAllowedCallback } from '@/lib/partnerAuth/callbacks';
import { requirePartnerToken, resolvePartnerRequest } from '@/lib/authz';
import Partner from '@/models/Partner';
import PartnerDevice from '@/models/PartnerDevice';

const SECRET = 's'.repeat(40);
let mongo: MongoMemoryServer;
let partnerId = '';
const userId = '64b7f0c2a1e4d5f6a7b8c9d0';

const verifier = () => crypto.randomBytes(32).toString('base64url');
const req = (token: string) => new Request('http://x/api/partner/orders', { headers: { authorization: `Bearer ${token}` } });

async function signIn() {
  const v = verifier();
  const code = await issueAuthCode({ partnerId, userId, challenge: challengeFor(v), callback: 'http://localhost:4321/callback' });
  return exchangeCode({ code, verifier: v, deviceName: 'Shop PC', platform: 'desktop', appVersion: '2.0.0' });
}

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongo.getUri('auth');
  process.env.PARTNER_JWT_SECRET = SECRET;
  process.env.NEXTAUTH_SECRET = 'n'.repeat(32);
  process.env.LOG_LEVEL = 'silent';
  const { default: connectDB } = await import('@/lib/mongodb');
  await connectDB();
}, 120_000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongo?.stop();
});

beforeEach(async () => {
  await Promise.all(Object.values(mongoose.connection.collections).map((c) => c.deleteMany({})));
  ws.disconnected.length = 0;
  partnerId = String((await Partner.create({ userId, businessName: 'Shop', isActive: true, location: { type: 'Point', coordinates: [77, 28] } }))._id);
});

describe('sign-in with code + PKCE', () => {
  it('issues a 15-minute access token for the device and a refresh token', async () => {
    const pair = await signIn();
    const claims = jwt.verify(pair.accessToken, SECRET) as jwt.JwtPayload;
    expect(claims).toMatchObject({ sub: userId, partnerId, did: pair.deviceId, typ: 'partner_access', role: 'partner' });
    expect(claims.exp! - claims.iat!).toBe(900);
    const device = await PartnerDevice.findOne({ deviceId: pair.deviceId }).lean<any>();
    expect(device).toMatchObject({ name: 'Shop PC', platform: 'desktop', appVersion: '2.0.0' });
    expect(device.refreshTokenHash).not.toBe(pair.refreshToken); // only the hash is stored
  });

  it('a code works once, only with its verifier, and expires', async () => {
    const v = verifier();
    const code = await issueAuthCode({ partnerId, userId, challenge: challengeFor(v), callback: 'http://localhost:4321/callback' });
    await expect(exchangeCode({ code, verifier: verifier(), deviceName: 'x', platform: 'desktop' })).rejects.toThrow(/verification failed/);
    await expect(exchangeCode({ code, verifier: v, deviceName: 'x', platform: 'desktop' })).rejects.toThrow(/invalid or has expired/); // already used by the failed attempt
    const v2 = verifier();
    const code2 = await issueAuthCode({ partnerId, userId, challenge: challengeFor(v2), callback: 'http://localhost:4321/callback' });
    await mongoose.connection.collection('device_auth_codes').updateMany({}, { $set: { expiresAt: new Date(Date.now() - 1000) } });
    await expect(exchangeCode({ code: code2, verifier: v2, deviceName: 'x', platform: 'desktop' })).rejects.toThrow(/expired/);
  });

  it('inactive partners cannot sign in', async () => {
    await Partner.updateOne({ _id: partnerId }, { isActive: false });
    await expect(signIn()).rejects.toThrow(/not active/);
  });

  it('only the apps\' callbacks are allowed', () => {
    expect(isAllowedCallback('http://localhost:4321/callback', true)).toBe(true);
    expect(isAllowedCallback('funprintingpartner://callback', true)).toBe(true);
    expect(isAllowedCallback('https://evil.example/callback', true)).toBe(false);
    expect(isAllowedCallback('funprintingpartner://x?next=https://evil', true)).toBe(false);
    expect(isAllowedCallback('exp://192.168.1.2:8081', true)).toBe(false);
    expect(isAllowedCallback('exp://192.168.1.2:8081', false)).toBe(true);
  });
});

describe('refresh rotation', () => {
  it('rotates; reusing an old refresh token revokes the device', async () => {
    const first = await signIn();
    const second = await refreshTokens(first.refreshToken);
    expect(second.refreshToken).not.toBe(first.refreshToken);
    expect(second.deviceId).toBe(first.deviceId);
    await expect(refreshTokens(first.refreshToken)).rejects.toThrow(/sign in again/);
    expect((await PartnerDevice.findOne({ deviceId: first.deviceId }).lean<any>()).revokedReason).toMatch(/reused/);
    await expect(refreshTokens(second.refreshToken)).rejects.toThrow(/sign in again/);
    expect(ws.disconnected).toEqual([first.deviceId]);
  });

  it('refresh fails and revokes the device when the partner was deactivated', async () => {
    const pair = await signIn();
    await Partner.updateOne({ _id: partnerId }, { isActive: false });
    await expect(refreshTokens(pair.refreshToken)).rejects.toThrow(/not active/);
    expect((await PartnerDevice.findOne({ deviceId: pair.deviceId }).lean<any>()).revokedAt).toBeInstanceOf(Date);
  });
});

describe('API access', () => {
  it('access token works; revoked device is refused at the next call', async () => {
    const pair = await signIn();
    expect(requirePartnerToken(req(pair.accessToken))).toMatchObject({ partnerId, deviceId: pair.deviceId });
    const ok = await resolvePartnerRequest(req(pair.accessToken));
    expect(ok).not.toBeInstanceOf(NextResponse);
    await revokeDevice(pair.deviceId, 'test');
    const denied = await resolvePartnerRequest(req(pair.accessToken));
    expect((denied as NextResponse).status).toBe(401);
  });

  it('an access-type token signed with the legacy secret is rejected', () => {
    const forged = jwt.sign({ sub: userId, partnerId, did: 'dev_x', role: 'partner', typ: 'partner_access' }, process.env.NEXTAUTH_SECRET!, { expiresIn: 900 });
    expect((requirePartnerToken(req(forged)) as NextResponse).status).toBe(401);
  });

  it('legacy tokens from installed apps still work (no device id)', async () => {
    const legacy = jwt.sign({ sub: userId, partnerId, role: 'partner', typ: 'partner_device' }, process.env.NEXTAUTH_SECRET!, { expiresIn: '30d' });
    expect(requirePartnerToken(req(legacy))).toMatchObject({ partnerId, deviceId: undefined });
  });

  it('deactivating a partner signs out all its devices', async () => {
    const a = await signIn();
    const b = await signIn();
    expect(await revokeAllDevices(partnerId, 'deactivated')).toBe(2);
    expect(ws.disconnected.sort()).toEqual([a.deviceId, b.deviceId].sort());
  });
});
