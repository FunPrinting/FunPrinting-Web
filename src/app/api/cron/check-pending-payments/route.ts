import { NextRequest, NextResponse } from 'next/server';
import { requireCronSecret } from '@/lib/cronAuth';
import { checkPendingOrdersFromRazorpay } from '@/lib/razorpayFallback';

export async function GET(request: NextRequest) {
  const cronAuth = requireCronSecret(request);
  if (cronAuth) return cronAuth;

  try {

    console.log('🕐 Cron job triggered: Checking pending payments from Razorpay');
    
    // Run the Razorpay fallback check
    await checkPendingOrdersFromRazorpay();
    
    return NextResponse.json({
      success: true,
      message: 'Pending payments check completed',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('❌ Error in cron job:', error);
    return NextResponse.json(
      { success: false, error: 'Cron job failed' },
      { status: 500 }
    );
  }
}

// Allow manual trigger for testing
export async function POST(request: NextRequest) {
  const cronAuth = requireCronSecret(request);
  if (cronAuth) return cronAuth;

  try {
    console.log('🧪 Manual trigger: Checking pending payments from Razorpay');
    
    // Run the Razorpay fallback check
    await checkPendingOrdersFromRazorpay();
    
    return NextResponse.json({
      success: true,
      message: 'Manual pending payments check completed',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('❌ Error in manual check:', error);
    return NextResponse.json(
      { success: false, error: 'Manual check failed' },
      { status: 500 }
    );
  }
}
