import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import connectDB from '@/lib/mongodb';
import Order from '@/models/Order';
import { orderPartnerShare } from '@/lib/payments/money';
import { ORDER_STATUS } from '@/lib/orderStatus';

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const PAYMENT_VALUES = new Set(['pending', 'completed', 'failed', 'refunded']);
/** Orders that count towards revenue: paid, and not cancelled or refunded afterwards. */
const REVENUE_FILTER = { paymentStatus: 'completed', status: { $nin: ['cancelled', 'refunded'] } };
const LIST_FIELDS =
  'orderId orderType customerInfo studentInfo deliveryOption.type deliveryOption.method deliveryOption.deliveryCharge deliveryOption.pickupLocation.name deliveryOption.partnerId status paymentStatus amount createdAt partnerId shiprocket.awbCode shiprocket.courierName';

/**
 * GET /api/admin/orders: one page of orders plus dashboard numbers.
 * Query: page, limit, name, dateFrom, dateTo, partnerId, status, payment.
 * Financials follow the real split (see partnerShareOf): the platform keeps whatever the shop does not get.
 */
export async function GET(request: Request) {
  const auth = await requireAdmin();
  if (auth instanceof NextResponse) return auth;

  try {
    await connectDB();
    const url = new URL(request.url);
    const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10) || 1);
    const limit = Math.max(1, Math.min(100, parseInt(url.searchParams.get('limit') || '10', 10) || 10));
    const name = (url.searchParams.get('name') || '').trim().slice(0, 100);
    const dateFrom = url.searchParams.get('dateFrom') || '';
    const dateTo = url.searchParams.get('dateTo') || '';
    const partnerId = url.searchParams.get('partnerId') || '';
    const status = url.searchParams.get('status') || '';
    const payment = url.searchParams.get('payment') || '';

    const filter: Record<string, unknown> = {};
    const and: Record<string, unknown>[] = [];
    if (partnerId) and.push({ $or: [{ partnerId }, { 'deliveryOption.partnerId': partnerId }] });
    if (name) {
      const rx = { $regex: escapeRegex(name), $options: 'i' };
      and.push({ $or: [{ 'studentInfo.name': rx }, { 'customerInfo.name': rx }, { orderId: rx }] });
    }
    if (and.length) filter.$and = and;
    if (status && status in ORDER_STATUS) filter.status = status;
    if (PAYMENT_VALUES.has(payment)) filter.paymentStatus = payment;
    const created: Record<string, Date> = {};
    const from = dateFrom ? new Date(dateFrom) : null;
    const to = dateTo ? new Date(dateTo) : null;
    if (from && !Number.isNaN(from.getTime())) created.$gte = from;
    if (to && !Number.isNaN(to.getTime())) {
      to.setHours(23, 59, 59, 999);
      created.$lte = to;
    }
    if (Object.keys(created).length) filter.createdAt = created;

    const [totalCount, orders, counts, revenueRows] = await Promise.all([
      Order.countDocuments(filter),
      Order.find(filter).select(LIST_FIELDS).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      Order.aggregate<{ _id: string; n: number }>([{ $group: { _id: '$status', n: { $sum: 1 } } }]),
      Order.find({ ...filter, ...REVENUE_FILTER }).select('amount deliveryOption.type deliveryOption.method deliveryOption.deliveryCharge').lean(),
    ]);

    const byStatus = Object.fromEntries(counts.map((c) => [c._id, c.n])) as Record<string, number>;
    const n = (...keys: string[]) => keys.reduce((sum, k) => sum + (byStatus[k] || 0), 0);
    let totalSales = 0;
    let partnerPayouts = 0;
    for (const o of revenueRows) {
      totalSales += Number(o.amount) || 0;
      partnerPayouts += orderPartnerShare(o);
    }
    totalSales = Math.round(totalSales * 100) / 100;
    partnerPayouts = Math.round(partnerPayouts * 100) / 100;

    return NextResponse.json({
      success: true,
      orders,
      totalCount,
      page,
      limit,
      totalPages: Math.ceil(totalCount / limit),
      statusCounts: {
        awaitingPayment: n('pending_payment'),
        waitingForShop: n('paid'),
        inProgress: n('processing', 'printing', 'printed', 'ready_for_pickup'),
        onTheWay: n('dispatched'),
      },
      financials: {
        totalSales,
        partnerPayouts,
        platformRevenue: Math.round((totalSales - partnerPayouts) * 100) / 100,
      },
    });
  } catch (error) {
    console.error('Error fetching orders:', error);
    return NextResponse.json({ success: false, error: 'Failed to fetch orders' }, { status: 500 });
  }
}
