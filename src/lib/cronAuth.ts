import 'server-only';
import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { logger } from '@/lib/logger';

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

/**
 * Verifies a cron request. Accepts `Authorization: Bearer ${CRON_SECRET}` (Vercel Cron format)
 * or the legacy `x-cron-secret: ${CRON_SECRET}` header.
 * Fails closed: returns 401 when CRON_SECRET is not configured.
 * Returns null when authorized, or a 401 response otherwise.
 */
export function requireCronSecret(request: Request): NextResponse | null {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    logger.error('CRON_SECRET is not configured; rejecting cron request');
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }
  const authHeader = request.headers.get('authorization') || '';
  const bearer = authHeader.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() || '';
  const legacy = request.headers.get('x-cron-secret') || '';
  if ((bearer && safeEqual(bearer, secret)) || (legacy && safeEqual(legacy, secret))) {
    return null;
  }
  return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
}
