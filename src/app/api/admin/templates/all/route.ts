import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import connectDB from '@/lib/mongodb';
import DynamicTemplate from '@/models/DynamicTemplate';

/** GET /api/admin/templates/all: every template with its owner, newest first. */
export async function GET() {
  const auth = await requireAdmin();
  if (auth instanceof NextResponse) return auth;
  try {
    await connectDB();
    const templates = await DynamicTemplate.find({})
      .select('id name category placeholders isPublic isPaid price createdByType createdByEmail createdByName createdAt')
      .sort({ createdAt: -1 })
      .lean();
    return NextResponse.json({
      success: true,
      templates: templates.map((t) => ({
        id: t.id,
        name: t.name,
        category: t.category,
        fields: t.placeholders?.length ?? 0,
        isPublic: !!t.isPublic,
        isPaid: !!t.isPaid,
        price: t.price || 0,
        ownerName: t.createdByName || '',
        ownerEmail: t.createdByEmail || '',
        createdByType: t.createdByType,
        createdAt: t.createdAt,
      })),
    });
  } catch (error) {
    console.error('Error fetching all templates:', error);
    return NextResponse.json({ success: false, error: 'Failed to fetch templates' }, { status: 500 });
  }
}
