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

    const partnerId = partner._id.toString();
    const shareOf = (o: { amount?: number; paymentMethod?: string }) =>
      o.paymentMethod === 'cod' ? Math.round(o.amount || 0) : Math.round((o.amount || 0) * 0.90);

    // Calculate Today's Earnings (90% of online Razorpay orders, 100% of collected COD orders)
    const todaysOrders = await Order.find({
      $or: [{ partnerId }, { 'deliveryOption.partnerId': partnerId }],
      paymentStatus: 'completed',
      createdAt: { $gte: startOfToday, $lte: endOfToday }
    }).select('amount paymentMethod');

    const todayGMV = todaysOrders.reduce((sum, order) => sum + (order.amount || 0), 0);
    const todayPartnerCut = todaysOrders.reduce((sum, order) => sum + shareOf(order), 0);

    // Calculate Total All-Time Earnings
    const allOrders = await Order.find({
      $or: [{ partnerId }, { 'deliveryOption.partnerId': partnerId }],
      paymentStatus: 'completed'
    }).select('amount paymentMethod');

    const totalGMV = allOrders.reduce((sum, order) => sum + (order.amount || 0), 0);
    const totalPartnerCut = allOrders.reduce((sum, order) => sum + shareOf(order), 0);

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
