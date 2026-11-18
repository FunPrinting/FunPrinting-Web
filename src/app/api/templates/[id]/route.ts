import { NextRequest, NextResponse } from 'next/server';
import connectDB from '@/lib/mongodb';
import DynamicTemplate from '@/models/DynamicTemplate';
import User from '@/models/User';
import { getCurrentUser, canViewTemplate, canEditTemplate, canDeleteTemplate, isAdminUser } from '@/lib/templateAuth';
import { generateFormSchema } from '@/lib/docxProcessor';

// GET: Get template details (if public or owned by user)
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const session = await getCurrentUser();
    
    // Get user ID from database
    let userId: string | null = null;
    if (session?.email) {
      await connectDB();
      const user = await User.findOne({ email: session.email.toLowerCase() });
      userId = user?._id?.toString() || null;
    }

    await connectDB();
    
    const template = await DynamicTemplate.findOne({ id });
    
    if (!template) {
      return NextResponse.json(
        { success: false, error: 'Template not found' },
        { status: 404 }
      );
    }

    // Check if user can view this template
    const canView = await canViewTemplate(id, userId);
    if (!canView) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized: You do not have permission to view this template' },
        { status: 403 }
      );
    }

    // The Word file is the paid product: only its owner (or an admin) gets the URL
    const canEdit = userId ? await canEditTemplate(id, userId, await isAdminUser()) : false;
    // Generate form schema from placeholders
    const formSchema = template.formSchema || generateFormSchema(template.placeholders);

    return NextResponse.json({
      success: true,
      template: {
        id: template.id,
        _id: template._id.toString(),
        name: template.name,
        description: template.description,
        category: template.category,
        pdfUrl: template.pdfUrl,
        ...(canEdit ? { wordUrl: template.wordUrl, createdByEmail: template.createdByEmail } : {}),
        placeholders: template.placeholders,
        formSchema,
        isPublic: template.isPublic,
        createdByType: template.createdByType,
        createdByName: template.createdByName,
        isPaid: template.isPaid || false,
        price: template.price || 0,
        allowFreeDownload: template.allowFreeDownload !== false,
        createdAt: template.createdAt,
        updatedAt: template.updatedAt
      }
    });

  } catch (error) {
    console.error('Error fetching template:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch template' },
      { status: 500 }
    );
  }
}

// PUT: Update template (only if owned by user)
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const session = await getCurrentUser();
    
    if (!session || !session.email) {
      return NextResponse.json(
        { success: false, error: 'Authentication required' },
        { status: 401 }
      );
    }

    await connectDB();
    const user = await User.findOne({ email: session.email.toLowerCase() });
    if (!user) {
      return NextResponse.json(
        { success: false, error: 'User not found' },
        { status: 404 }
      );
    }

    const userId = user._id.toString();
    const isAdmin = await isAdminUser();

    // Check if user can edit this template
    const canEdit = await canEditTemplate(id, userId, isAdmin);
    if (!canEdit) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized: You do not have permission to edit this template' },
        { status: 403 }
      );
    }

    const body = await request.json();
    const { name, description, category, placeholders, formSchema, isPublic, isPaid, price, allowFreeDownload } = body;


    await connectDB();
    
    const template = await DynamicTemplate.findOne({ id });
    
    if (!template) {
      return NextResponse.json(
        { success: false, error: 'Template not found' },
        { status: 404 }
      );
    }

    // Update template fields
    if (name !== undefined) template.name = name;
    if (description !== undefined) template.description = description;
    if (category !== undefined) template.category = category;
    if (placeholders !== undefined) template.placeholders = placeholders;
    if (formSchema !== undefined) template.formSchema = formSchema;
    
    // Update monetization fields
    if (isPublic !== undefined) template.isPublic = !!isPublic;
    if (isPaid !== undefined) {
      // Validate paid templates have valid price and payout info
      if (isPaid && (price === undefined || price <= 0)) {
        return NextResponse.json(
          { success: false, error: 'Paid templates require a valid price greater than 0' },
          { status: 400 }
        );
      }
      template.isPaid = !!isPaid;
    }
    if (price !== undefined) template.price = Math.max(0, Number(price) || 0);
    if (allowFreeDownload !== undefined) template.allowFreeDownload = allowFreeDownload !== false;


    await template.save();


    return NextResponse.json({
      success: true,
      message: 'Template updated successfully',
      template: {
        id: template.id,
        name: template.name,
        description: template.description,
        category: template.category,
        placeholders: template.placeholders,
        formSchema: template.formSchema,
        updatedAt: template.updatedAt
      }
    });

  } catch (error) {
    console.error('Error updating template:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to update template' },
      { status: 500 }
    );
  }
}

// DELETE: Delete template (only if owned by user)
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const session = await getCurrentUser();
    
    if (!session || !session.email) {
      return NextResponse.json(
        { success: false, error: 'Authentication required' },
        { status: 401 }
      );
    }

    await connectDB();
    const user = await User.findOne({ email: session.email.toLowerCase() });
    if (!user) {
      return NextResponse.json(
        { success: false, error: 'User not found' },
        { status: 404 }
      );
    }

    const userId = user._id.toString();
    const isAdmin = await isAdminUser();

    // Check if user can delete this template
    const canDelete = await canDeleteTemplate(id, userId, isAdmin);
    if (!canDelete) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized: You do not have permission to delete this template' },
        { status: 403 }
      );
    }

    await connectDB();
    
    const template = await DynamicTemplate.findOne({ id });
    
    if (!template) {
      return NextResponse.json(
        { success: false, error: 'Template not found' },
        { status: 404 }
      );
    }

    await DynamicTemplate.deleteOne({ id });

    return NextResponse.json({
      success: true,
      message: 'Template deleted successfully'
    });

  } catch (error) {
    console.error('Error deleting template:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to delete template' },
      { status: 500 }
    );
  }
}
