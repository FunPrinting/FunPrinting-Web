import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { convertPdfToDocx } from '@/lib/cloudmersive';
import { uploadFile } from '@/lib/storage';

export async function POST(request: NextRequest) {
  const auth = await requireAdmin();
  if (auth instanceof NextResponse) return auth;

  try {
    const formData = await request.formData();
    const file = formData.get('file') as File;
    const name = formData.get('name') as string;
    const description = formData.get('description') as string;
    const category = formData.get('category') as string;

    if (!file) {
      return NextResponse.json(
        { success: false, error: 'No file provided' },
        { status: 400 }
      );
    }

    if (!name || !description || !category) {
      return NextResponse.json(
        { success: false, error: 'Missing required fields: name, description, category' },
        { status: 400 }
      );
    }

    // Validate file type
    if (file.type !== 'application/pdf') {
      return NextResponse.json(
        { success: false, error: 'Only PDF files are allowed' },
        { status: 400 }
      );
    }

    // Validate file size (max 50MB - application limit, storage provider supports larger files)
    if (file.size > 50 * 1024 * 1024) {
      return NextResponse.json(
        { success: false, error: 'File size must be less than 50MB' },
        { status: 400 }
      );
    }

    console.log(`Processing PDF upload: ${file.name} (${file.size} bytes)`);

    // Convert file to buffer
    const bytes = await file.arrayBuffer();
    const pdfBuffer = Buffer.from(bytes);

    // Convert PDF to DOCX using Cloudmersive
    console.log('Converting PDF to DOCX...');
    const docxBuffer = await convertPdfToDocx(pdfBuffer);

    // Upload original PDF to storage
    const storageProvider = process.env.STORAGE_PROVIDER || 'cloudinary';
    console.log(`Uploading PDF to ${storageProvider}...`);
    const pdfUrl = await uploadFile(pdfBuffer, 'templates/pdf', 'application/pdf');

    // Upload converted DOCX to storage
    console.log(`Uploading DOCX to ${storageProvider}...`);
    const docxUrl = await uploadFile(docxBuffer, 'templates/docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');

    return NextResponse.json({
      success: true,
      data: {
        name,
        description,
        category,
        originalFileName: file.name,
        fileSize: file.size,
        pdfUrl,
        docxUrl,
        message: 'PDF uploaded and converted to DOCX successfully'
      }
    });

  } catch (error: any) {
    console.error('Error in PDF upload:', error);
    
    // Handle specific Cloudmersive API errors
    if (error.message.includes('API key')) {
      return NextResponse.json(
        { success: false, error: 'Invalid Cloudmersive API key. Please check your configuration.' },
        { status: 401 }
      );
    }
    
    if (error.message.includes('quota') || error.message.includes('limit')) {
      return NextResponse.json(
        { success: false, error: 'API quota exceeded. Please try again later.' },
        { status: 429 }
      );
    }

    return NextResponse.json(
      { success: false, error: 'Failed to process PDF upload' },
      { status: 500 }
    );
  }
}
