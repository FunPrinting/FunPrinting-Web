import { NextRequest, NextResponse } from 'next/server';
import { otpStore, MAX_OTP_ATTEMPTS } from '@/lib/otp-store';
import { otpVerifyRateLimit, checkRateLimit, getClientIdentifier } from '@/lib/ratelimit';
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
    const otp = body?.otp != null ? String(body.otp).trim() : '';
    if (!email || !otp) {
      return NextResponse.json(
        { success: false, error: 'Email and OTP are required' },
        { status: 400 }
      );
    }
    // Rate limit verify attempts by IP and by email
    const ipLimited = await checkRateLimit(otpVerifyRateLimit, `ip:${getClientIdentifier(request)}`);
    if (ipLimited) return ipLimited;
    const emailLimited = await checkRateLimit(otpVerifyRateLimit, `email:${email}`);
    if (emailLimited) return emailLimited;
    // Get stored OTP data
    const storedData = otpStore.get(email);
    if (!storedData) {
      return NextResponse.json(
        { success: false, error: 'OTP expired or not found. Please request a new one.' },
        { status: 400 }
      );
    }
    // Check if OTP is expired (10 minutes)
    if (otpStore.isExpired(storedData.timestamp)) {
      otpStore.delete(email);
      return NextResponse.json(
        { success: false, error: 'OTP has expired. Please request a new one.' },
        { status: 400 }
      );
    }
    // Verify OTP
    if (storedData.otp !== otp) {
      const attempts = otpStore.recordFailedAttempt(email);
      if (attempts >= MAX_OTP_ATTEMPTS) {
        otpStore.delete(email);
        return NextResponse.json(
          { success: false, error: 'Too many incorrect attempts. Please request a new OTP.' },
          { status: 429 }
        );
      }
      return NextResponse.json(
        { success: false, error: 'Invalid OTP. Please check and try again.' },
        { status: 400 }
      );
    }
    // OTP is valid - remove it from store
    otpStore.delete(email);
    return NextResponse.json({
      success: true,
      message: 'Email verified successfully',
    });
  } catch (error) {
    console.error('Error verifying OTP:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to verify OTP' },
      { status: 500 }
    );
  }
}
