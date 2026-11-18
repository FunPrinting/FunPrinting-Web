import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSessionUser, requirePartnerToken } from '@/lib/authz';
import { captureInBackground } from '@/lib/errorTracking/server';
import { verifyWssSignature } from '@/lib/wssClient';
import { checkRateLimit, errorReportRateLimit, getClientIdentifier } from '@/lib/ratelimit';

/**
 * POST /api/errors — error reports from browsers and partner apps.
 *
 * - Browsers: no auth needed (errors happen to signed-out users too). The session
 *   user id is attached when present.
 * - Partner apps (source desktop/mobile): must send their device token as
 *   `Authorization: Bearer`; otherwise the report is recorded as `client`.
 * - WSS server (source wss): HMAC-signed with WSS_DISPATCH_SECRET, the same
 *   x-fp-timestamp / x-fp-signature contract as web → WSS calls.
 *
 * Abuse limits: 64 KB body, 30 reports/min per IP, plus the per-fingerprint and
 * per-instance write limits in captureError. Always answers 202 so a failing
 * reporter never retries in a loop.
 */
const MAX_BODY_BYTES = 64 * 1024;

const reportSchema = z.object({
  source: z.enum(['client', 'wss', 'desktop', 'mobile']).optional(),
  level: z.enum(['error', 'warning']).optional(),
  name: z.string().max(200).optional(),
  message: z.string().min(1).max(5000),
  stack: z.string().max(20000).optional(),
  digest: z.string().max(100).optional(),
  url: z.string().max(2000).optional(),
  release: z.string().max(100).optional(),
  appVersion: z.string().max(50).optional(),
  platform: z.string().max(50).optional(),
  context: z.record(z.string(), z.unknown()).optional(),
});

const accepted = () => NextResponse.json({ success: true }, { status: 202 });

export async function POST(request: NextRequest) {
  const limited = await checkRateLimit(errorReportRateLimit, `ip:${getClientIdentifier(request)}`);
  if (limited) return limited;

  const length = Number(request.headers.get('content-length') || 0);
  if (length > MAX_BODY_BYTES) {
    return NextResponse.json({ success: false, error: 'Report too large' }, { status: 413 });
  }
  const text = await request.text().catch(() => '');
  if (!text || text.length > MAX_BODY_BYTES) {
    return NextResponse.json({ success: false, error: 'Invalid report' }, { status: 400 });
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON' }, { status: 400 });
  }
  const parsed = reportSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: 'Invalid report' }, { status: 400 });
  }
  const report = parsed.data;

  let source: 'client' | 'wss' | 'desktop' | 'mobile' = 'client';
  let partnerId: string | undefined;
  let userId: string | undefined;

  if (report.source === 'wss' && verifyWssSignature(request.headers, text)) {
    source = 'wss';
  }

  if ((report.source === 'desktop' || report.source === 'mobile') && request.headers.get('authorization')) {
    const claims = requirePartnerToken(request);
    if (!(claims instanceof NextResponse)) {
      source = report.source;
      partnerId = claims.partnerId;
      userId = claims.userId;
    }
  }
  if (!userId && source === 'client') {
    const user = await getSessionUser().catch(() => null);
    userId = user?.id || undefined;
  }

  captureInBackground({
    source,
    level: report.level ?? 'error',
    name: report.name,
    message: report.message,
    stack: report.stack,
    digest: report.digest,
    url: report.url,
    release: report.release || report.appVersion,
    userAgent: request.headers.get('user-agent') || undefined,
    userId,
    partnerId,
    context: { ...report.context, ...(report.platform ? { platform: report.platform } : {}) },
  });

  return accepted();
}
