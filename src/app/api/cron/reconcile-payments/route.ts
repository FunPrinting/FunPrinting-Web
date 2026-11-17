import { NextRequest, NextResponse } from 'next/server';
import { requireCronSecret } from '@/lib/cronAuth';
import { checkPendingOrdersFromRazorpay } from '@/lib/razorpayFallback';

/**
 * Reconciliation cron job endpoint
 * Should be called every 15 minutes to check for stuck payments
 * 
 * This endpoint:
 * - Checks orders with pending_payment status older than 5 minutes
 * - Queries Razorpay API for actual payment status
 * - Updates orders automatically if payment was successful but verification missed
 */
export async function GET(request: NextRequest) {
  const cronAuth = requireCronSecret(request);
  if (cronAuth) return cronAuth;

  try {

    console.log('🔄 Starting payment reconciliation cron job...');
    const startTime = Date.now();
    
    // Check pending orders older than 5 minutes
    await checkPendingOrdersFromRazorpay(5);
    
    const duration = Date.now() - startTime;
    console.log(`✅ Payment reconciliation completed in ${duration}ms`);

    return NextResponse.json({
      success: true,
      message: 'Payment reconciliation completed',
      duration_ms: duration,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Payment reconciliation cron job error:', error);
    return NextResponse.json(
      { success: false, error: 'Reconciliation job failed' },
      { status: 500 }
    );
  }
}




