import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import connectDB from '@/lib/mongodb';
import Order from '@/models/Order';

export async function GET(request: Request) {
  const auth = await requireAdmin();
  if (auth instanceof NextResponse) return auth;

  try {
    await connectDB();

    const url = new URL(request.url);
    const page = Math.max(1, parseInt(url.searchParams.get('page') || '1'));
    const limit = Math.max(1, Math.min(100, parseInt(url.searchParams.get('limit') || '10')));
    const skip = (page - 1) * limit;
    const nameSearch = url.searchParams.get('name') || '';
    const dateFrom = url.searchParams.get('dateFrom') || '';
    const dateTo = url.searchParams.get('dateTo') || '';
    const partnerId = url.searchParams.get('partnerId') || '';

    console.log(`🔍 ADMIN API - Fetching orders page ${page} (limit ${limit}) at ${new Date().toISOString()}`);

    // Build search filter
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const searchFilter: Record<string, any> = {};

    if (partnerId) {
      if (!searchFilter.$and) searchFilter.$and = [];
      searchFilter.$and.push({
        $or: [
          { partnerId: partnerId },
          { 'deliveryOption.partnerId': partnerId }
        ]
      });
    }

    if (nameSearch.trim()) {
      const nameRegex = { $regex: nameSearch.trim(), $options: 'i' };
      if (!searchFilter.$and) searchFilter.$and = [];
      searchFilter.$and.push({
        $or: [
          { 'studentInfo.name': nameRegex },
          { 'customerInfo.name': nameRegex },
        ]
      });
    }

    if (dateFrom || dateTo) {
      searchFilter.createdAt = {};
      if (dateFrom) {
        searchFilter.createdAt.$gte = new Date(dateFrom);
      }
      if (dateTo) {
        // Include the entire end day
        const endDate = new Date(dateTo);
        endDate.setHours(23, 59, 59, 999);
        searchFilter.createdAt.$lte = endDate;
      }
    }

    // Get total count and paginated orders in parallel
    const [totalCount, orders, pendingCount, printingCount, dispatchedCount, paymentPendingCount] = await Promise.all([
      Order.countDocuments(searchFilter),
      Order.find(searchFilter).sort({ createdAt: -1 }).skip(skip).limit(limit),
      Order.countDocuments({ orderStatus: 'pending' }),
      Order.countDocuments({ orderStatus: 'printing' }),
      Order.countDocuments({ orderStatus: 'dispatched' }),
      Order.countDocuments({ paymentStatus: 'pending' }),
    ]);

    // Phase 12: Calculate Financial Metrics (Total GMV, Platform 10%, Partner 90%)
    // To ensure accurate financials, we must calculate this across ALL matching completed orders, not just the paginated slice
    const allFinancials = await Order.find({ ...searchFilter, paymentStatus: 'completed' }).select('amount');
    const totalGMV = allFinancials.reduce((sum, order) => sum + (order.amount || 0), 0);
    const platformRevenue = Math.round(totalGMV * 0.10);
    const partnerPayouts = Math.round(totalGMV * 0.90);

    const totalPages = Math.ceil(totalCount / limit);

    console.log(`🔍 ADMIN API - Fetched ${orders.length} of ${totalCount} orders (page ${page}/${totalPages}) at ${new Date().toISOString()}`);

    return NextResponse.json({
      success: true,
      orders,
      timestamp: new Date().toISOString(),
      count: orders.length,
      totalCount,
      page,
      financials: {
        totalGMV,
        platformRevenue,
        partnerPayouts
      },
      limit,
      totalPages,
      statusCounts: {
        pending: pendingCount,
        printing: printingCount,
        dispatched: dispatchedCount,
        paymentPending: paymentPendingCount,
      },
    });
  } catch (error) {
    console.error('Error fetching orders:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch orders' },
      { status: 500 }
    );
  }
}
