import { NextRequest, NextResponse } from 'next/server';
import { after } from 'next/server';
import connectDB from '@/lib/mongodb';
import Order from '@/models/Order';
import { requireUser, isAdminSession } from '@/lib/authz';

/**
 * GET /api/orders
 * Returns the signed-in user's orders (matched on customerInfo.email).
 * The `email` query param is only honoured for admins; for everyone else
 * the session email is used, so users cannot list other people's orders.
 *
 * (The unused POST handler that created NewOrder documents was removed.)
 */
let lastSweep = 0;

export async function GET(request: NextRequest) {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;

  try {
    await connectDB();

    const { searchParams } = new URL(request.url);
    const requestedEmail = searchParams.get('email')?.trim().toLowerCase();
    const email = isAdminSession(auth) && requestedEmail ? requestedEmail : auth.email;

    // Case-insensitive exact match: some legacy orders store mixed-case emails
    const escaped = email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const orders = await Order.find({
      'customerInfo.email': { $regex: `^${escaped}$`, $options: 'i' },
    }).sort({ createdAt: -1 });

    // Print job deadlines also run on customer traffic (throttled), not only on cron
    if (Date.now() - lastSweep > 60_000) {
      lastSweep = Date.now();
      after(async () => {
        const { sweepDeadlines } = await import('@/lib/jobs/deadlines');
        await sweepDeadlines(20).catch(() => undefined);
      });
    }

    return NextResponse.json({
      success: true,
      orders: orders
    });
  } catch (error) {
    console.error('Error fetching orders:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch orders' },
      { status: 500 }
    );
  }
}
