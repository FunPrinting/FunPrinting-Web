import { NextRequest, NextResponse } from 'next/server';
import connectDB from '@/lib/mongodb';
import DynamicTemplate from '@/models/DynamicTemplate';
import User from '@/models/User';
import { getCurrentUser, canEditTemplate, isAdminUser } from '@/lib/templateAuth';
import { uploadFile } from '@/lib/storage';
import { extractPlaceholders, generateFormSchema } from '@/lib/docxProcessor';
import { fetchTrustedFile, FileFetchError } from '@/lib/documents/fileUrls';
import { TEMPLATE_MAX_BYTES } from '@/lib/documents/templates';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: templateId } = await params;
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
    const canEdit = await canEditTemplate(templateId, userId, isAdmin);
    if (!canEdit) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized: You do not have permission to edit this template' },
        { status: 403 }
      );
    }

    // Get the template
    const template = await DynamicTemplate.findOne({ id: templateId });
    if (!template) {
      return NextResponse.json(
        { success: false, error: 'Template not found' },
        { status: 404 }
      );
    }

    let docxBuffer: Buffer;
    let wordUrl: string;

    const reqContentType = request.headers.get('content-type') || '';
    if (reqContentType.includes('application/json')) {
      const body = await request.json().catch(() => ({}));
      if (typeof body.fileUrl !== 'string' || !body.fileUrl) {
        return NextResponse.json({ success: false, error: 'No fileUrl provided' }, { status: 400 });
      }
      docxBuffer = (await fetchTrustedFile(body.fileUrl, { maxBytes: TEMPLATE_MAX_BYTES })).buffer;
      if (docxBuffer.length < 4 || docxBuffer[0] !== 0x50 || docxBuffer[1] !== 0x4b) {
        return NextResponse.json({ success: false, error: 'That file is not a valid .docx document' }, { status: 400 });
      }
      wordUrl = body.fileUrl;
    } else {
      // Get file from form data
      const formData = await request.formData();
      const file = formData.get('file') as File;

      if (!file) {
        return NextResponse.json({ success: false, error: 'No file provided' }, { status: 400 });
      }
      if (!/\.docx$/i.test(file.name)) {
        return NextResponse.json({ success: false, error: 'Only DOCX files are allowed' }, { status: 400 });
      }
      if (file.size > TEMPLATE_MAX_BYTES) {
        return NextResponse.json({ success: false, error: 'File size must be less than 20MB' }, { status: 400 });
      }

      const bytes = await file.arrayBuffer();
      docxBuffer = Buffer.from(bytes);
      if (docxBuffer.length < 4 || docxBuffer[0] !== 0x50 || docxBuffer[1] !== 0x4b) {
        return NextResponse.json({ success: false, error: 'That file is not a valid .docx document' }, { status: 400 });
      }
      wordUrl = await uploadFile(
        docxBuffer,
        `templates/word/${templateId}`,
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      );
    }

    // Extract placeholders from new file
    const placeholders = await extractPlaceholders(docxBuffer);
    const schemaObject = generateFormSchema(placeholders);
    const formSchema = Object.entries(schemaObject).map(([key, value]) => ({
      key,
      ...value,
      defaultPlaceholder: value.defaultPlaceholder || value.placeholder || `Enter ${key}`
    }));

    // Log placeholders before update
    console.log('📋 Current placeholders in template:', template.placeholders);
    console.log('📋 New placeholders to save:', placeholders);
    console.log('📋 New formSchema to save:', formSchema.length, 'fields');

    // Update template with new file and placeholders
    template.wordUrl = wordUrl;
    template.placeholders = placeholders;
    template.formSchema = formSchema;
    template.updatedAt = new Date();

    // Explicitly mark arrays as modified for Mongoose to detect changes
    template.markModified('placeholders');
    template.markModified('formSchema');

    await template.save();

    // Verify placeholders were saved correctly
    const savedTemplate = await DynamicTemplate.findOne({ id: templateId });
    console.log('✅ Template saved. Verifying placeholders...');
    console.log('📋 Saved placeholders:', savedTemplate?.placeholders);
    console.log('📋 Saved formSchema count:', savedTemplate?.formSchema?.length || 0);
    
    if (savedTemplate && savedTemplate.placeholders.length !== placeholders.length) {
      console.error('⚠️ WARNING: Placeholders count mismatch!');
      console.error('   Expected:', placeholders.length);
      console.error('   Actual:', savedTemplate.placeholders.length);
    } else {
      console.log(`✅ Template ${templateId} file updated successfully with ${placeholders.length} placeholders`);
    }

    return NextResponse.json({
      success: true,
      message: 'Template file updated successfully',
      wordUrl,
      placeholders,
      formSchema
    });

  } catch (error) {
    if (error instanceof FileFetchError) {
      return NextResponse.json({ success: false, error: error.message }, { status: error.status });
    }
    console.error('❌ Error updating template file:', error);
    return NextResponse.json(
      { 
        success: false, 
        error: 'Failed to update template file',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}

