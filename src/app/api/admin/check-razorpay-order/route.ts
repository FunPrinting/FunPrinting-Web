import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { checkSpecificOrderFromRazorpay } from '@/lib/razorpayFallback';

export async function POST(request: NextRequest) {
  const auth = await requireAdmin();
  if (auth instanceof NextResponse) return auth;

  try {
    const { razorpayOrderId, orderId } = await request.json();
    
    if (!razorpayOrderId) {
      return NextResponse.json(
        { success: false, error: 'Razorpay order ID is required' },
        { status: 400 }
      );
    }

    console.log(`🔍 Manual check for Razorpay order: ${razorpayOrderId}`);
    
    const success = await checkSpecificOrderFromRazorpay(razorpayOrderId);
    
    if (success) {
      return NextResponse.json({
        success: true,
        message: `Order ${orderId || 'N/A'} status updated successfully via Razorpay fallback`,
        razorpayOrderId
      });
    } else {
      return NextResponse.json({
        success: false,
        message: 'No successful payment found for this Razorpay order',
        razorpayOrderId
      });
    }
  } catch (error) {
    console.error('❌ Error checking Razorpay order:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to check Razorpay order' },
      { status: 500 }
    );
  }
}
