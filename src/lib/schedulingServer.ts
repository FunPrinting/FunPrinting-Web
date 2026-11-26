import Order from '@/models/Order';
import type { ScheduleTarget } from './scheduling';
import { addDaysIst, getIstParts } from './scheduling';

/**
 * Counts active scheduled bookings per `${date}|${slotId}` for a partner over the next `days` days.
 * Ignores cancelled/refunded orders and abandoned unpaid checkouts older than 30 minutes.
 */
export async function getBookedSlotCounts(
  partnerId: string,
  opts: { target?: ScheduleTarget; days?: number; now?: Date } = {}
): Promise<Record<string, number>> {
  const { target, days = 14, now = new Date() } = opts;
  const { date: todayIst } = getIstParts(now);
  const maxDate = addDaysIst(todayIst, days);
  const thirtyMinAgo = new Date(now.getTime() - 30 * 60_000);

  const match: Record<string, unknown> = {
    partnerId: String(partnerId),
    status: { $nin: ['cancelled', 'refunded'] },
    'deliveryOption.scheduledSlot.date': { $gte: todayIst, $lte: maxDate },
    $or: [
      { paymentStatus: 'completed' },
      { status: 'pending_payment', createdAt: { $gte: thirtyMinAgo } },
    ],
  };

  if (target) {
    match['deliveryOption.scheduledSlot.target'] = target;
  }

  const rows = await Order.aggregate<{ _id: { date: string; slotId: string }; count: number }>([
    { $match: match },
    {
      $group: {
        _id: {
          date: '$deliveryOption.scheduledSlot.date',
          slotId: '$deliveryOption.scheduledSlot.slotId',
        },
        count: { $sum: 1 },
      },
    },
  ]);

  const counts: Record<string, number> = {};
  for (const r of rows) {
    if (r._id?.date && r._id?.slotId) {
      counts[`${r._id.date}|${r._id.slotId}`] = r.count;
    }
  }
  return counts;
}
