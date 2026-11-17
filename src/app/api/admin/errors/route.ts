import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin } from '@/lib/authz';
import connectDB from '@/lib/mongodb';
import ErrorGroup, { ERROR_LEVELS, ERROR_SOURCES, ERROR_STATUSES } from '@/models/ErrorGroup';

/**
 * GET /api/admin/errors?status=open&source=server&level=error&q=text&page=1
 * Lists error groups, most recently seen first, plus counts per status.
 */
const querySchema = z.object({
  status: z.enum([...ERROR_STATUSES, 'all']).default('open'),
  source: z.enum(ERROR_SOURCES).optional(),
  level: z.enum(ERROR_LEVELS).optional(),
  q: z.string().trim().max(200).optional(),
  page: z.coerce.number().int().min(1).max(1000).default(1),
});
const PAGE_SIZE = 25;

export async function GET(request: NextRequest) {
  const admin = await requireAdmin();
  if (admin instanceof NextResponse) return admin;

  const parsed = querySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: 'Invalid filters' }, { status: 400 });
  }
  const { status, source, level, q, page } = parsed.data;

  const filter: Record<string, unknown> = {};
  if (status !== 'all') filter.status = status;
  if (source) filter.source = source;
  if (level) filter.level = level;
  if (q) {
    const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    filter.$or = [{ message: { $regex: escaped, $options: 'i' } }, { route: { $regex: escaped, $options: 'i' } }];
  }

  await connectDB();
  const [items, total, statusCounts] = await Promise.all([
    ErrorGroup.find(filter)
      .sort({ lastSeenAt: -1 })
      .skip((page - 1) * PAGE_SIZE)
      .limit(PAGE_SIZE)
      .select('-samples')
      .lean(),
    ErrorGroup.countDocuments(filter),
    ErrorGroup.aggregate<{ _id: string; count: number }>([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
  ]);

  return NextResponse.json({
    success: true,
    items,
    total,
    page,
    pageSize: PAGE_SIZE,
    counts: Object.fromEntries(statusCounts.map((c) => [c._id, c.count])),
  });
}
