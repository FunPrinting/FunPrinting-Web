import { NextRequest, NextResponse } from 'next/server';
import { resolvePartnerRequest } from '@/lib/authz';
import Order from '@/models/Order';

export async function GET(request: NextRequest) {
  try {
    const resolved = await resolvePartnerRequest(request);
    if (resolved instanceof NextResponse) return resolved;
    const { partner } = resolved;

    // Get today's start and end date
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const endOfToday = new Date();
    endOfToday.setHours(23, 59, 59, 999);

    // Calculate Today's GMV for completed orders
    const todaysOrders = await Order.find({
      partnerId: partner._id.toString(),
      paymentStatus: 'completed',
      createdAt: { $gte: startOfToday, $lte: endOfToday }
    }).select('amount');

    const todayGMV = todaysOrders.reduce((sum, order) => sum + (order.amount || 0), 0);
    const todayPartnerCut = Math.round(todayGMV * 0.90); // 90% payout to partner

    // Calculate Total All-Time GMV
    const allOrders = await Order.find({
      partnerId: partner._id.toString(),
      paymentStatus: 'completed'
    }).select('amount');

    const totalGMV = allOrders.reduce((sum, order) => sum + (order.amount || 0), 0);
    const totalPartnerCut = Math.round(totalGMV * 0.90);

    return NextResponse.json({ 
      success: true, 
      financials: {
        todayEarnings: todayPartnerCut,
        todayGMV,
        totalEarnings: totalPartnerCut,
        totalGMV,
        completedOrdersCount: allOrders.length,
        todaysOrdersCount: todaysOrders.length
      }
    });

  } catch (error) {
    console.error('Error fetching partner financials:', error);
    return NextResponse.json({ success: false, error: 'Failed to fetch financials' }, { status: 500 });
  }
}
