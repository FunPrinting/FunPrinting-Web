import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import connectDB from '@/lib/mongodb';
import DynamicTemplate from '@/models/DynamicTemplate';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdmin();
  if (auth instanceof NextResponse) return auth;

  try {

    const { id } = await params;
    const body = await request.json();
    const { isPublic } = body;

    if (typeof isPublic !== 'boolean') {
      return NextResponse.json(
        { success: false, error: 'isPublic must be a boolean' },
        { status: 400 }
      );
    }

    await connectDB();

    // Find template by id (not _id)
    const template = await DynamicTemplate.findOne({ id });
    
    if (!template) {
      return NextResponse.json(
        { success: false, error: 'Template not found' },
        { status: 404 }
      );
    }

    // Update isPublic status
    template.isPublic = isPublic;
    await template.save();

    return NextResponse.json({
      success: true,
      message: `Template ${isPublic ? 'made public' : 'made private'} successfully`,
      template: {
        id: template.id,
        name: template.name,
        isPublic: template.isPublic
      }
    });

  } catch (error) {
    console.error('Error toggling template public status:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to update template' },
      { status: 500 }
    );
  }
}

