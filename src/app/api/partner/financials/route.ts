import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import connectDB from '@/lib/mongodb';
import Order from '@/models/Order';
import Partner from '@/models/Partner';

export async function GET(request: NextRequest) {
  try {
    let userId;
    const session = await getServerSession(authOptions);
    
    if (session && session.user) {
      userId = (session.user as any).id;
    } else {
      // Allow fallback to Bearer token for Desktop/Mobile Apps
      const authHeader = request.headers.get('Authorization');
      if (authHeader && authHeader.startsWith('Bearer ')) {
        try {
          const token = authHeader.split(' ')[1];
          // Basic base64 decode for now (in production, use jsonwebtoken verify)
          const base64Payload = token.split('.')[1];
          const payload = Buffer.from(base64Payload, 'base64').toString('utf8');
          const parsed = JSON.parse(payload);
          userId = parsed.userId || parsed.id || parsed.sub || parsed.partnerId;
        } catch (e) {
          console.error("Token decode error:", e);
        }
      }
    }

    if (!userId) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    await connectDB();

    // Verify the caller is a partner. Auto-heal missing profiles.
    let partner = await Partner.findOne({ userId: userId });
    if (!partner) {
      console.log(`Auto-healing: Creating missing Partner profile for user ${userId} upon financials access.`);
      const User = require('@/models/User').default || require('@/models/User');
      const userDoc = await User.findById(userId);
      partner = await Partner.create({
        userId: userId,
        businessName: userDoc?.name ? `${userDoc.name}'s Print Shop` : 'New Franchise Partner',
        isActive: true,
        isOnline: false,
        servicesOffered: { printing: true, binding: false, cashOnDelivery: true },
        earnings: { totalRevenue: 0, pendingPayout: 0 }
      });
    }

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
