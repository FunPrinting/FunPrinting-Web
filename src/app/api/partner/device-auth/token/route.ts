import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { checkRateLimit, getClientIdentifier, otpVerifyRateLimit } from '@/lib/ratelimit';
import { withRequestLogger } from '@/lib/logger';
import { DeviceAuthError, exchangeCode, refreshTokens } from '@/lib/partnerAuth/service';

export const runtime = 'nodejs';

const bodySchema = z.discriminatedUnion('grant_type', [
  z.object({
    grant_type: z.literal('authorization_code'),
    code: z.string().min(10).max(100),
    code_verifier: z.string().min(43).max(128),
    device_name: z.string().trim().max(100).default('Partner device'),
    platform: z.enum(['desktop', 'mobile', 'other']).default('other'),
    app_version: z.string().max(40).optional(),
  }),
  z.object({ grant_type: z.literal('refresh_token'), refresh_token: z.string().min(20).max(200) }),
]);

/**
 * POST /api/partner/device-auth/token
 *   { grant_type: 'authorization_code', code, code_verifier, device_name, platform, app_version? }
 *   { grant_type: 'refresh_token', refresh_token }
 * → { access_token, expires_in, refresh_token, refresh_token_expires_at, device_id, partner_id }
 *
 * The refresh token changes on every refresh; keep only the newest one.
 */
export async function POST(request: NextRequest) {
  const limited = await checkRateLimit(otpVerifyRateLimit, `device-token:${getClientIdentifier(request)}`);
  if (limited) return limited;
  const log = withRequestLogger(request);
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  const body = parsed.data;
  const ip = getClientIdentifier(request);

  try {
    const pair =
      body.grant_type === 'authorization_code'
        ? await exchangeCode({ code: body.code, verifier: body.code_verifier, deviceName: body.device_name, platform: body.platform, appVersion: body.app_version, ip })
        : await refreshTokens(body.refresh_token, ip);
    return NextResponse.json(
      {
        access_token: pair.accessToken,
        token_type: 'Bearer',
        expires_in: pair.accessTokenExpiresIn,
        refresh_token: pair.refreshToken,
        refresh_token_expires_at: pair.refreshTokenExpiresAt,
        device_id: pair.deviceId,
        partner_id: pair.partnerId,
      },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    if (error instanceof DeviceAuthError) {
      return NextResponse.json({ error: error.code, error_description: error.message }, { status: error.status });
    }
    log.error({ err: error }, 'device token request failed');
    return NextResponse.json({ error: 'server_error' }, { status: 500 });
  }
}
