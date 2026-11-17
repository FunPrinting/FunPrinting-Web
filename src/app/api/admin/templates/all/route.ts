import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import connectDB from '@/lib/mongodb';
import DynamicTemplate from '@/models/DynamicTemplate';
import { generateFormSchema } from '@/lib/docxProcessor';

export async function GET(_request: NextRequest) {
  const auth = await requireAdmin();
  if (auth instanceof NextResponse) return auth;

  try {

    await connectDB();

    // Fetch all templates
    const templates = await DynamicTemplate.find({})
      .select('id name description category placeholders pdfUrl wordUrl formSchema isPublic createdByType createdByEmail createdByName createdByUserId createdAt updatedAt')
      .sort({ createdByEmail: 1, createdAt: -1 });

    // Group templates by user
    const templatesByUser: Record<string, {
      userInfo: {
        email: string;
        name: string;
        templateCount: number;
      };
      templates: any[];
    }> = {};

    templates.forEach(template => {
      const userKey = template.createdByEmail || template.createdBy || 'unknown';
      
      if (!templatesByUser[userKey]) {
        templatesByUser[userKey] = {
          userInfo: {
            email: template.createdByEmail || template.createdBy || 'unknown',
            name: template.createdByName || 'Unknown User',
            templateCount: 0
          },
          templates: []
        };
      }

      templatesByUser[userKey].templates.push({
        id: template.id,
        _id: template._id.toString(),
        name: template.name,
        description: template.description,
        category: template.category,
        placeholders: template.placeholders,
        formSchema: template.formSchema || generateFormSchema(template.placeholders),
        pdfUrl: template.pdfUrl,
        wordUrl: template.wordUrl,
        isPublic: template.isPublic,
        createdByType: template.createdByType,
        createdByEmail: template.createdByEmail,
        createdByName: template.createdByName,
        createdAt: template.createdAt,
        updatedAt: template.updatedAt
      });

      templatesByUser[userKey].userInfo.templateCount++;
    });

    // Convert to array and sort by template count (descending) or alphabetically
    const users = Object.values(templatesByUser).sort((a, b) => {
      // Sort by template count descending, then by name
      if (b.userInfo.templateCount !== a.userInfo.templateCount) {
        return b.userInfo.templateCount - a.userInfo.templateCount;
      }
      return a.userInfo.name.localeCompare(b.userInfo.name);
    });

    return NextResponse.json({
      success: true,
      users: users
    });

  } catch (error) {
    console.error('Error fetching all templates:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch templates' },
      { status: 500 }
    );
  }
}

