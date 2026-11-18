import { NextRequest, NextResponse } from 'next/server';
import connectDB from '@/lib/mongodb';
import DynamicTemplate from '@/models/DynamicTemplate';
import Order from '@/models/Order';
import { generateFormSchema } from '@/lib/docxProcessor';
import { getCurrentUser } from '@/lib/templateAuth';
import User from '@/models/User';

export async function GET(_request: NextRequest) {
  try {
    await connectDB();

    // Get current user from session
    const session = await getCurrentUser();
    let userId = null;
    let userEmail = null;

    if (session?.email) {
      const user = await User.findOne({ email: session.email.toLowerCase() });
      if (user) {
        userId = user._id.toString();
        userEmail = user.email.toLowerCase();
      }
    }

    // Build query: public templates OR user's own templates
    const query: any = {
      $or: [
        { isPublic: true }
      ]
    };

    // Add user's own templates if authenticated
    if (userId || userEmail) {
      const userQuery: any[] = [];
      if (userId) {
        userQuery.push({ createdByUserId: userId });
      }
      if (userEmail) {
        userQuery.push({ createdByEmail: userEmail });
      }
      if (userQuery.length > 0) {
        query.$or.push({ $or: userQuery });
      }
    }

    // Get templates matching the query
    const templates = await DynamicTemplate.find(query)
      .select('id name description category placeholders pdfUrl wordUrl formSchema isPublic createdByType createdByEmail createdByUserId createdByName createdAt updatedAt')
      .sort({ createdAt: -1 });

    // Get purchase counts for all templates
    const purchaseCounts = await Order.aggregate([
      {
        $match: {
          orderType: 'template',
          paymentStatus: 'completed',
          templateId: { $exists: true, $ne: null }
        }
      },
      {
        $group: {
          _id: '$templateId',
          count: { $sum: 1 }
        }
      }
    ]);

    // Create a map of templateId -> purchaseCount
    const purchaseCountMap = new Map<string, number>();
    purchaseCounts.forEach((item: { _id: string; count: number }) => {
      purchaseCountMap.set(item._id, item.count);
    });

    // Sort templates by purchase count to determine ranks
    const templatesWithCounts = templates.map(template => ({
      template,
      purchaseCount: purchaseCountMap.get(template.id) || 0
    })).sort((a, b) => b.purchaseCount - a.purchaseCount);

    // Assign ranks (1, 2, 3) to top templates
    const rankMap = new Map<string, number>();
    templatesWithCounts.forEach((item, index) => {
      if (index < 3 && item.purchaseCount > 0) {
        rankMap.set(item.template.id, index + 1);
      }
    });

    // Get user's favorite template IDs if authenticated
    let favoriteTemplateIds: string[] = [];
    if (userId) {
      const user = await User.findById(userId);
      if (user && user.favoriteTemplateIds) {
        favoriteTemplateIds = user.favoriteTemplateIds;
      }
    } else if (userEmail) {
      const user = await User.findOne({ email: userEmail });
      if (user && user.favoriteTemplateIds) {
        favoriteTemplateIds = user.favoriteTemplateIds;
      }
    }

    // Generate form schemas for each template and add purchase count, rank, and favorite status
    // The Word file and creator email are only sent for the user's own templates
    const isMine = (t: { createdByUserId?: unknown; createdByEmail?: string }) =>
      Boolean((userId && t.createdByUserId && String(t.createdByUserId) === userId) || (userEmail && t.createdByEmail?.toLowerCase() === userEmail));
    const templatesWithSchemas = templates.map(template => ({
      id: template.id,
      _id: template._id.toString(),
      name: template.name,
      description: template.description,
      category: template.category,
      placeholders: template.placeholders,
      formSchema: template.formSchema || generateFormSchema(template.placeholders),
      pdfUrl: template.pdfUrl,
      ...(isMine(template) ? { wordUrl: template.wordUrl, createdByEmail: template.createdByEmail, createdByUserId: String(template.createdByUserId ?? '') } : {}),
      isMine: isMine(template),
      isPublic: template.isPublic,
      createdByType: template.createdByType,
      createdByName: template.createdByName,
      createdAt: template.createdAt,
      updatedAt: template.updatedAt,
      purchaseCount: purchaseCountMap.get(template.id) || 0,
      rank: rankMap.get(template.id) || null,
      isFavorite: favoriteTemplateIds.includes(template.id)
    }));

    return NextResponse.json({
      success: true,
      templates: templatesWithSchemas
    });

  } catch (error) {
    console.error('Error fetching templates:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch templates' },
      { status: 500 }
    );
  }
}
