import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import connectDB from '@/lib/mongodb';
import DynamicTemplate from '@/models/DynamicTemplate';

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdmin();
  if (auth instanceof NextResponse) return auth;

  try {
    await connectDB();
    
    const { id } = await params;
    
    // Find and delete the template
    const deletedTemplate = await DynamicTemplate.findByIdAndDelete(id);
    
    if (!deletedTemplate) {
      return NextResponse.json(
        { success: false, message: 'Template not found' },
        { status: 404 }
      );
    }
    
    return NextResponse.json({
      success: true,
      message: 'Template deleted successfully',
      deletedTemplate
    });
  } catch (error) {
    console.error('Error deleting template:', error);
    return NextResponse.json(
      { success: false, message: 'Failed to delete template' },
      { status: 500 }
    );
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdmin();
  if (auth instanceof NextResponse) return auth;

  try {
    await connectDB();
    
    const { id } = await params;
    
    // Find the template by ID
    const template = await DynamicTemplate.findById(id);
    
    if (!template) {
      return NextResponse.json(
        { success: false, message: 'Template not found' },
        { status: 404 }
      );
    }
    
    return NextResponse.json({
      success: true,
      template
    });
  } catch (error) {
    console.error('Error fetching template:', error);
    return NextResponse.json(
      { success: false, message: 'Failed to fetch template' },
      { status: 500 }
    );
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdmin();
  if (auth instanceof NextResponse) return auth;

  try {
    await connectDB();
    
    const { id } = await params;
    const body = await request.json();
    
    // If formSchema is being updated, ensure defaultPlaceholder is preserved
    if (body.formSchema && Array.isArray(body.formSchema)) {
      // Get existing template to preserve defaultPlaceholder values
      const existingTemplate = await DynamicTemplate.findById(id);
      if (existingTemplate && existingTemplate.formSchema && Array.isArray(existingTemplate.formSchema)) {
        // Create a map of existing defaultPlaceholder values by key
        const defaultPlaceholderMap = new Map<string, string>();
        existingTemplate.formSchema.forEach((field: any) => {
          if (field.key && field.defaultPlaceholder) {
            defaultPlaceholderMap.set(field.key, field.defaultPlaceholder);
          }
        });
        
        // Ensure all formSchema fields have defaultPlaceholder
        body.formSchema = body.formSchema.map((field: any) => {
          const existingDefault = defaultPlaceholderMap.get(field.key);
          return {
            ...field,
            defaultPlaceholder: field.defaultPlaceholder || existingDefault || field.placeholder || `Enter ${field.key || field.label || ''}`
          };
        });
      } else {
        // If no existing formSchema, ensure defaultPlaceholder is set
        body.formSchema = body.formSchema.map((field: any) => ({
          ...field,
          defaultPlaceholder: field.defaultPlaceholder || field.placeholder || `Enter ${field.key || field.label || ''}`
        }));
      }
    }
    
    // Update the template
    const updatedTemplate = await DynamicTemplate.findByIdAndUpdate(
      id,
      { ...body, updatedAt: new Date() },
      { new: true, runValidators: true }
    );
    
    if (!updatedTemplate) {
      return NextResponse.json(
        { success: false, message: 'Template not found' },
        { status: 404 }
      );
    }
    
    return NextResponse.json({
      success: true,
      message: 'Template updated successfully',
      template: updatedTemplate
    });
  } catch (error) {
    console.error('Error updating template:', error);
    return NextResponse.json(
      { success: false, message: 'Failed to update template' },
      { status: 500 }
    );
  }
}
