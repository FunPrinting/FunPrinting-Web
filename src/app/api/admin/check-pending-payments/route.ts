import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { checkPendingOrdersFromRazorpay } from '@/lib/razorpayFallback';

/**
 * POST /api/admin/check-pending-payments
 * Admin-only replacement for the removed public /api/manual-check-payments.
 * Asks Razorpay about pending orders (same check the cron runs).
 */
export async function POST() {
  const auth = await requireAdmin();
  if (auth instanceof NextResponse) return auth;

  try {
    await checkPendingOrdersFromRazorpay();
    return NextResponse.json({
      success: true,
      message: 'Payment check completed successfully',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('❌ Error in admin payment check:', error);
    return NextResponse.json(
      { success: false, error: 'Payment check failed' },
      { status: 500 }
    );
  }
}
