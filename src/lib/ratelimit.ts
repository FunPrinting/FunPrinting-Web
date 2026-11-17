/**
 * Rate limiting utilities using Upstash Ratelimit
 * Prevents abuse of expensive API endpoints (PDF generation, preview, etc.)
 */
import { Ratelimit } from '@upstash/ratelimit';
import { redis } from './jobStore';
import { NextRequest, NextResponse } from 'next/server';

/**
 * Rate limiter for document generation APIs
 * Allows 5 requests per 60 seconds per IP
 */
export const generationRateLimit = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(5, '60 s'),
    prefix: 'ratelimit:generation',
    analytics: true,
});

/**
 * Rate limiter for status polling APIs
 * Allows 30 requests per 60 seconds per IP
 */
export const statusRateLimit = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(30, '60 s'),
    prefix: 'ratelimit:status',
    analytics: true,
});

/**
 * Rate limiter for order creation API
 * Allows 10 requests per 60 seconds per IP
 */
export const orderCreationRateLimit = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(10, '60 s'),
    prefix: 'ratelimit:order-creation',
    analytics: true,
});

/**
 * Rate limiter for Razorpay webhook
 * Allows 100 requests per 60 seconds per IP
 */
export const webhookRateLimit = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(100, '60 s'),
    prefix: 'ratelimit:webhook',
    analytics: true,
});

/**
 * Rate limiter for sending email OTPs
 * Allows 5 requests per 10 minutes per key (applied to both email and IP)
 */
export const otpSendRateLimit = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(5, '10 m'),
    prefix: 'ratelimit:otp-send',
    analytics: true,
});
/**
 * Rate limiter for verifying email OTPs
 * Allows 10 attempts per 10 minutes per key (applied to both email and IP)
 */
export const otpVerifyRateLimit = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(10, '10 m'),
    prefix: 'ratelimit:otp-verify',
    analytics: true,
});
/**
 * Get client identifier from request (IP address or fallback)
 */
export function getClientIdentifier(request: NextRequest): string {
    const forwarded = request.headers.get('x-forwarded-for');
    const realIp = request.headers.get('x-real-ip');
    return forwarded?.split(',')[0]?.trim() || realIp || 'anonymous';
}

/**
 * Check rate limit and return 429 response if exceeded
 * Returns null if within limit, or a NextResponse if rate limited
 */
export async function checkRateLimit(
    rateLimiter: Ratelimit,
    identifier: string,
    { failClosed = false }: { failClosed?: boolean } = {}
): Promise<NextResponse | null> {
    try {
        const { success, limit, remaining, reset } = await rateLimiter.limit(identifier);

        if (!success) {
            const retryAfter = Math.ceil((reset - Date.now()) / 1000);
            return NextResponse.json(
                {
                    success: false,
                    error: 'Too many requests. Please try again later.',
                    retryAfter,
                },
                {
                    status: 429,
                    headers: {
                        'X-RateLimit-Limit': limit.toString(),
                        'X-RateLimit-Remaining': remaining.toString(),
                        'X-RateLimit-Reset': reset.toString(),
                        'Retry-After': retryAfter.toString(),
                    },
                }
            );
        }

        return null; // Within limit
    } catch (error) {
        if (failClosed) {
            // Security-sensitive limits (OTP) must not be bypassable by a Redis outage
            console.error('⚠️ Rate limit check failed, rejecting request:', error);
            return NextResponse.json(
                { success: false, error: 'Service temporarily unavailable. Please try again shortly.' },
                { status: 503, headers: { 'Retry-After': '30' } }
            );
        }
        // Other limits: allow the request through when Redis is down
        console.error('⚠️ Rate limit check failed, allowing request:', error);
        return null;
    }
}
