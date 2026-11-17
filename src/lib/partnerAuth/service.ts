import 'server-only';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import connectDB from '@/lib/mongodb';
import Partner from '@/models/Partner';
import PartnerDevice, { type IPartnerDevice } from '@/models/PartnerDevice';
import DeviceAuthCode from '@/models/DeviceAuthCode';
import { logger } from '@/lib/logger';

/**
 * Partner app sign-in (OAuth-style authorization code with PKCE, RFC 7636):
 *
 * 1. The app makes a random `code_verifier`, opens
 *    /partner/desktop-auth?callback=<allowlisted>&state=<random>&code_challenge=<S256>
 * 2. The signed-in partner's browser gets a one-time code (60 s) and is redirected to
 *    callback?code=...&state=... — no token ever appears in a URL.
 * 3. The app POSTs code + code_verifier to /api/partner/device-auth/token and gets
 *    a 15-minute access token and a 30-day refresh token for this device.
 * 4. The app refreshes with /api/partner/device-auth/refresh; each refresh rotates
 *    the refresh token. Presenting an old one revokes the device.
 *
 * Access tokens are HS256 JWTs signed with PARTNER_JWT_SECRET:
 *   { sub: User._id, partnerId: Partner._id, did: deviceId, role, typ: 'partner_access' }
 * Revoking a device (dashboard, admin, partner deactivated) stops it at the next
 * API call (the device row is checked) and on the socket within one token lifetime.
 */
export const ACCESS_TTL_SECONDS = 15 * 60;
export const REFRESH_TTL_MS = 30 * 24 * 3600_000;
const CODE_TTL_MS = 60_000;

export class DeviceAuthError extends Error {
  constructor(message: string, public readonly status = 400, public readonly code = 'invalid_request') {
    super(message);
    this.name = 'DeviceAuthError';
  }
}

const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');
const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');

export function partnerJwtSecret(): string {
  const secret = process.env.PARTNER_JWT_SECRET;
  if (!secret || secret.length < 32) throw new DeviceAuthError('PARTNER_JWT_SECRET is not configured', 500, 'server_error');
  return secret;
}

export function isValidChallenge(c: unknown): c is string {
  return typeof c === 'string' && /^[A-Za-z0-9_-]{43}$/.test(c);
}

/** PKCE S256: base64url(SHA-256(verifier)) without padding. */
export function challengeFor(verifier: string): string {
  return crypto.createHash('sha256').update(verifier).digest('base64url');
}

/** Step 2: called by the signed-in browser. Returns the raw one-time code. */
export async function issueAuthCode(opts: { partnerId: string; userId: string; challenge: string; callback: string }): Promise<string> {
  if (!isValidChallenge(opts.challenge)) throw new DeviceAuthError('Invalid code_challenge');
  await connectDB();
  const code = randomToken(24);
  await DeviceAuthCode.create({ codeHash: sha256(code), challenge: opts.challenge, partnerId: opts.partnerId, userId: opts.userId, callback: opts.callback, expiresAt: new Date(Date.now() + CODE_TTL_MS) });
  return code;
}

export interface TokenPair {
  accessToken: string;
  accessTokenExpiresIn: number; // seconds
  refreshToken: string;
  refreshTokenExpiresAt: string;
  deviceId: string;
  partnerId: string;
}

async function activePartner(partnerId: string) {
  const partner = await Partner.findOne({ _id: partnerId, isActive: true }).select('_id userId').lean<{ _id: unknown; userId: string } | null>();
  if (!partner) throw new DeviceAuthError('Partner account is not active', 403, 'partner_inactive');
  return partner;
}

function signAccess(device: Pick<IPartnerDevice, 'deviceId' | 'partnerId' | 'userId'>): string {
  return jwt.sign({ sub: device.userId, partnerId: device.partnerId, did: device.deviceId, role: 'partner', typ: 'partner_access' }, partnerJwtSecret(), {
    algorithm: 'HS256',
    expiresIn: ACCESS_TTL_SECONDS,
  });
}

/** Step 3: exchange the code for tokens and register the device. */
export async function exchangeCode(opts: { code: string; verifier: string; deviceName: string; platform: IPartnerDevice['platform']; appVersion?: string; ip?: string }): Promise<TokenPair> {
  if (typeof opts.verifier !== 'string' || !/^[A-Za-z0-9._~-]{43,128}$/.test(opts.verifier)) throw new DeviceAuthError('Invalid code_verifier');
  await connectDB();
  // Single use: the update succeeds once
  const record = await DeviceAuthCode.findOneAndUpdate(
    { codeHash: sha256(opts.code), usedAt: { $exists: false }, expiresAt: { $gt: new Date() } },
    { $set: { usedAt: new Date() } },
    { new: true }
  ).lean();
  if (!record) throw new DeviceAuthError('This sign-in code is invalid or has expired. Please sign in again.', 400, 'invalid_grant');
  const expected = Buffer.from(record.challenge);
  const actual = Buffer.from(challengeFor(opts.verifier));
  if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) {
    throw new DeviceAuthError('Sign-in verification failed. Please sign in again.', 400, 'invalid_grant');
  }
  await activePartner(record.partnerId);

  const refreshToken = randomToken();
  const now = new Date();
  const device = await PartnerDevice.create({
    deviceId: `dev_${randomToken(12)}`,
    partnerId: record.partnerId,
    userId: record.userId,
    name: (opts.deviceName || 'Partner device').slice(0, 100),
    platform: opts.platform,
    appVersion: opts.appVersion?.slice(0, 40),
    refreshTokenHash: sha256(refreshToken),
    refreshExpiresAt: new Date(now.getTime() + REFRESH_TTL_MS),
    lastSeenAt: now,
    lastIp: opts.ip,
  });
  logger.info({ partnerId: device.partnerId, deviceId: device.deviceId, platform: device.platform }, 'partner device signed in');
  return {
    accessToken: signAccess(device),
    accessTokenExpiresIn: ACCESS_TTL_SECONDS,
    refreshToken,
    refreshTokenExpiresAt: device.refreshExpiresAt.toISOString(),
    deviceId: device.deviceId,
    partnerId: device.partnerId,
  };
}

/** Step 4: rotate the refresh token. A reused (old) token revokes the device. */
export async function refreshTokens(refreshToken: string, ip?: string): Promise<TokenPair> {
  if (typeof refreshToken !== 'string' || refreshToken.length < 20 || refreshToken.length > 200) throw new DeviceAuthError('Invalid refresh token', 401, 'invalid_grant');
  await connectDB();
  const hash = sha256(refreshToken);
  const next = randomToken();
  const now = new Date();
  const device = await PartnerDevice.findOneAndUpdate(
    { refreshTokenHash: hash, revokedAt: { $exists: false }, refreshExpiresAt: { $gt: now } },
    { $set: { refreshTokenHash: sha256(next), previousRefreshTokenHash: hash, refreshExpiresAt: new Date(now.getTime() + REFRESH_TTL_MS), lastSeenAt: now, lastIp: ip } },
    { new: true }
  ).lean<IPartnerDevice | null>();

  if (!device) {
    const reused = await PartnerDevice.findOne({ previousRefreshTokenHash: hash, revokedAt: { $exists: false } }).select('deviceId partnerId').lean<{ deviceId: string; partnerId: string } | null>();
    if (reused) {
      await revokeDevice(reused.deviceId, 'refresh token reused (possible copy)');
      logger.warn({ deviceId: reused.deviceId, partnerId: reused.partnerId }, 'refresh token reuse: device revoked');
    }
    throw new DeviceAuthError('Your session has ended. Please sign in again.', 401, 'invalid_grant');
  }
  try {
    await activePartner(device.partnerId);
  } catch (error) {
    await revokeDevice(device.deviceId, 'partner inactive');
    throw error;
  }
  return {
    accessToken: signAccess(device),
    accessTokenExpiresIn: ACCESS_TTL_SECONDS,
    refreshToken: next,
    refreshTokenExpiresAt: device.refreshExpiresAt.toISOString(),
    deviceId: device.deviceId,
    partnerId: device.partnerId,
  };
}

export async function revokeDevice(deviceId: string, reason: string): Promise<boolean> {
  await connectDB();
  const res = await PartnerDevice.updateOne({ deviceId, revokedAt: { $exists: false } }, { $set: { revokedAt: new Date(), revokedReason: reason.slice(0, 200) } });
  if (res.modifiedCount) {
    const device = await PartnerDevice.findOne({ deviceId }).select('partnerId').lean<{ partnerId: string } | null>();
    if (device) {
      const { disconnectDevice } = await import('@/lib/wssClient');
      await disconnectDevice(device.partnerId, deviceId).catch(() => undefined);
    }
  }
  return res.modifiedCount > 0;
}

/** All devices of a partner, e.g. when an admin deactivates the partner. */
export async function revokeAllDevices(partnerId: string, reason: string): Promise<number> {
  await connectDB();
  const devices = await PartnerDevice.find({ partnerId, revokedAt: { $exists: false } }).select('deviceId').lean<Array<{ deviceId: string }>>();
  for (const d of devices) await revokeDevice(d.deviceId, reason);
  return devices.length;
}

/** Used by every partner API call made with a new-style access token. */
export async function isDeviceActive(deviceId: string): Promise<boolean> {
  await connectDB();
  const device = await PartnerDevice.findOneAndUpdate(
    { deviceId, revokedAt: { $exists: false } },
    [{ $set: { lastSeenAt: { $cond: [{ $lt: ['$lastSeenAt', new Date(Date.now() - 60_000)] }, '$$NOW', '$lastSeenAt'] } } }],
    { updatePipeline: true, projection: { _id: 1 } }
  ).lean();
  return Boolean(device);
}
