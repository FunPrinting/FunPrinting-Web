import { NextRequest, NextResponse } from 'next/server';
import connectToDatabase from '@/lib/mongodb';
import Order from '@/models/Order';
import { otpStore } from '@/lib/otp-store';
import { getServerSession } from 'next-auth';

/**
 * POST /api/orders/verify/update-status
 * Updates order status via QR verification flow.
 * - Admin: can dispatch (printed → dispatched)
 * - User (logged in with matching email OR OTP-verified): can mark as delivered (dispatched → delivered)
 * 
 * Body: { orderId: string, action: 'dispatch' | 'deliver', verificationToken?: string }
 */
export async function POST(req: NextRequest) {
  try {
    const { orderId, action, verificationToken } = await req.json();

    if (!orderId || !action) {
      return NextResponse.json(
        { success: false, error: 'Order ID and action are required' },
        { status: 400 }
      );
    }

    if (!['dispatch', 'deliver'].includes(action)) {
      return NextResponse.json(
        { success: false, error: 'Invalid action. Must be "dispatch" or "deliver"' },
        { status: 400 }
      );
    }

    await connectToDatabase();

    const order = await Order.findOne({ orderId });
    if (!order) {
      return NextResponse.json(
        { success: false, error: 'Order not found' },
        { status: 404 }
      );
    }

    // Get session (may be null if not logged in)
    const session = await getServerSession();
    const userEmail = session?.user?.email || '';
    const adminEmail = process.env.ADMIN_EMAIL ;
    const isAdmin = userEmail.toLowerCase() === adminEmail.toLowerCase();
    const isOrderOwner = userEmail.toLowerCase() === order.customerInfo.email.toLowerCase();

    // === DISPATCH ACTION (Admin only) ===
    if (action === 'dispatch') {
      if (!isAdmin) {
        return NextResponse.json(
          { success: false, error: 'Only admin can dispatch orders' },
          { status: 403 }
        );
      }

      // Validate order is in a dispatchable state
      if (!['printed', 'processing', 'printing', 'pending'].includes(order.orderStatus)) {
        return NextResponse.json(
          { success: false, error: `Cannot dispatch order with status "${order.orderStatus}"` },
          { status: 400 }
        );
      }

      await Order.updateOne(
        { orderId },
        {
          $set: {
            orderStatus: 'dispatched',
            status: 'dispatched',
          }
        }
      );

      return NextResponse.json({
        success: true,
        message: 'Order marked as dispatched',
        newStatus: 'dispatched',
      });
    }

    // === DELIVER ACTION (Order owner or OTP-verified user) ===
    if (action === 'deliver') {
      let isVerified = false;

      // Method 1: Logged in as the order owner
      if (isOrderOwner) {
        isVerified = true;
      }

      // Method 2: OTP verification token
      if (!isVerified && verificationToken) {
        const tokenKey = `verify_token_${orderId}`;
        const storedData = otpStore.get(tokenKey);

        if (storedData) {
          const [storedToken, expiryStr] = storedData.otp.split('|');
          const expiry = parseInt(expiryStr);

          if (storedToken === verificationToken && Date.now() < expiry) {
            isVerified = true;
            otpStore.delete(tokenKey); // One-time use
          }
        }
      }

      // Method 3: Admin can also mark as delivered
      if (!isVerified && isAdmin) {
        isVerified = true;
      }

      if (!isVerified) {
        return NextResponse.json(
          { success: false, error: 'Verification required. Please log in or verify with OTP.' },
          { status: 403 }
        );
      }

      await Order.updateOne(
        { orderId },
        {
          $set: {
            orderStatus: 'delivered',
            status: 'delivered',
            deliveryVerifiedAt: new Date(),
            deliveryVerifiedBy: isOrderOwner ? userEmail : (isAdmin ? adminEmail : order.customerInfo.email),
          }
        }
      );

      return NextResponse.json({
        success: true,
        message: 'Order marked as delivered',
        newStatus: 'delivered',
      });
    }

    return NextResponse.json(
      { success: false, error: 'Unknown action' },
      { status: 400 }
    );
  } catch (error) {
    console.error('Error in update-status:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * GET /api/orders/verify/update-status?orderId=XXX
 * Returns order info for the verification page (public endpoint, limited data)
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const orderId = searchParams.get('orderId');

    if (!orderId) {
      return NextResponse.json(
        { success: false, error: 'Order ID is required' },
        { status: 400 }
      );
    }

    await connectToDatabase();

    const order = await Order.findOne({ orderId }).lean();
    if (!order) {
      return NextResponse.json(
        { success: false, error: 'Order not found' },
        { status: 404 }
      );
    }

    // Return limited order data (no sensitive fields)
    return NextResponse.json({
      success: true,
      order: {
        orderId: order.orderId,
        orderStatus: order.orderStatus,
        status: order.status,
        customerName: order.customerInfo?.name || 'Customer',
        customerEmail: order.customerInfo?.email
          ? order.customerInfo.email.replace(/(.{2})(.*)(@.*)/, '$1***$3') // Mask email
          : '',
        fullEmail: order.customerInfo?.email, // For matching logged-in user
        amount: order.amount,
        createdAt: order.createdAt,
        deliveryOption: order.deliveryOption?.type,
        deliveryVerifiedAt: order.deliveryVerifiedAt,
      },
    });
  } catch (error) {
    console.error('Error fetching order for verification:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
