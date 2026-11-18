import { NextResponse } from 'next/server';
import connectDB from '@/lib/mongodb';
import DynamicTemplate from '@/models/DynamicTemplate';
import Payment from '@/models/Payment';
import User from '@/models/User';
import { getCurrentUser } from '@/lib/templateAuth';

/**
 * GET /api/templates: templates the visitor can use, for the browse page.
 * Public templates, plus the signed-in user's own. Sends only what a card needs: no
 * Word file URLs, form schemas or creator emails.
 */
export async function GET() {
  try {
    await connectDB();
    const session = await getCurrentUser();
    const me = session?.email ? await User.findOne({ email: session.email.toLowerCase() }).select('email favoriteTemplateIds').lean<{ _id: unknown; email: string; favoriteTemplateIds?: string[] } | null>() : null;
    const userId = me ? String(me._id) : null;

    const query = {
      $or: [{ isPublic: true }, ...(me ? [{ createdByUserId: userId }, { createdByEmail: me.email.toLowerCase() }] : [])],
    };
    const templates = await DynamicTemplate.find(query)
      .select('id name description category isPublic isPaid price allowFreeDownload createdByType createdByName createdByUserId createdByEmail createdAt')
      .sort({ createdAt: -1 })
      .lean();

    // Purchases are paid Payment records (a partly refunded purchase still counts)
    const counts = await Payment.aggregate<{ _id: string; count: number }>([
      { $match: { purpose: 'template', status: { $in: ['paid', 'partially_refunded'] }, templateId: { $exists: true, $ne: null } } },
      { $group: { _id: '$templateId', count: { $sum: 1 } } },
    ]);
    const bought = new Map(counts.map((c) => [c._id, c.count]));

    const byPurchases = templates.map((t) => ({ id: t.id, count: bought.get(t.id) ?? 0 })).filter((t) => t.count > 0).sort((a, b) => b.count - a.count).slice(0, 3);
    const rank = new Map(byPurchases.map((t, i) => [t.id, i + 1]));
    const favourites = new Set(me?.favoriteTemplateIds ?? []);

    const mine = (t: { createdByUserId?: unknown; createdByEmail?: string }) =>
      Boolean((userId && t.createdByUserId && String(t.createdByUserId) === userId) || (me && t.createdByEmail?.toLowerCase() === me.email.toLowerCase()));

    return NextResponse.json({
      success: true,
      templates: templates.map((t) => ({
        id: t.id,
        name: t.name,
        description: t.description,
        category: t.category,
        isPublic: t.isPublic,
        isPaid: Boolean(t.isPaid),
        price: t.price || 0,
        createdByType: t.createdByType,
        createdByName: t.createdByName,
        createdAt: t.createdAt,
        isMine: mine(t),
        purchaseCount: bought.get(t.id) ?? 0,
        rank: rank.get(t.id) ?? null,
        isFavorite: favourites.has(t.id),
      })),
    });
  } catch (error) {
    console.error('Error fetching templates:', error);
    return NextResponse.json({ success: false, error: 'Failed to fetch templates' }, { status: 500 });
  }
}
