import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin } from '@/lib/authz';
import connectDB from '@/lib/mongodb';
import ErrorGroup from '@/models/ErrorGroup';

const isObjectId = (id: string) => /^[0-9a-fA-F]{24}$/.test(id);

/** GET /api/admin/errors/[id] — one error group with its recent samples. */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  if (admin instanceof NextResponse) return admin;
  const { id } = await params;
  if (!isObjectId(id)) return NextResponse.json({ success: false, error: 'Invalid id' }, { status: 400 });

  await connectDB();
  const item = await ErrorGroup.findById(id).lean();
  if (!item) return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
  return NextResponse.json({ success: true, item });
}

/**
 * PATCH /api/admin/errors/[id] — { status?: open|resolved|ignored, note?: string }
 * Resolving records who and when; if the error happens again it reopens itself.
 */
const patchSchema = z
  .object({
    status: z.enum(['open', 'resolved', 'ignored']).optional(),
    note: z.string().max(2000).optional(),
  })
  .refine((b) => b.status !== undefined || b.note !== undefined, { message: 'Nothing to update' });

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  if (admin instanceof NextResponse) return admin;
  const { id } = await params;
  if (!isObjectId(id)) return NextResponse.json({ success: false, error: 'Invalid id' }, { status: 400 });

  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ success: false, error: 'Invalid update' }, { status: 400 });

  const set: Record<string, unknown> = {};
  const unset: Record<string, ''> = {};
  if (parsed.data.note !== undefined) set.note = parsed.data.note;
  if (parsed.data.status) {
    set.status = parsed.data.status;
    if (parsed.data.status === 'resolved') {
      set.resolvedAt = new Date();
      set.resolvedBy = admin.email;
    } else {
      unset.resolvedAt = '';
      unset.resolvedBy = '';
    }
  }

  await connectDB();
  const item = await ErrorGroup.findByIdAndUpdate(
    id,
    { $set: set, ...(Object.keys(unset).length ? { $unset: unset } : {}) },
    { new: true, projection: { samples: 0 } }
  ).lean();
  if (!item) return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
  return NextResponse.json({ success: true, item });
}
