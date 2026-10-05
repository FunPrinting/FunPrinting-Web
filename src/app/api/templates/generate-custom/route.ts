import { NextRequest, NextResponse } from 'next/server';
import connectDB from '@/lib/mongodb';
import DynamicTemplate from '@/models/DynamicTemplate';
import { uploadFile } from '@/lib/storage';
import { v4 as uuidv4 } from 'uuid';

export async function POST(request: NextRequest) {
  try {
    const { templateId, formData } = await request.json();

    if (!templateId || !formData) {
      return NextResponse.json(
        { success: false, error: 'Template ID and form data are required' },
        { status: 400 }
      );
    }

    console.log('🔄 Generating custom document from template:', templateId);
    console.log('📄 Form data received:', Object.keys(formData));

    await connectDB();

    // Fetch the template from database
    const template = await DynamicTemplate.findOne({ id: templateId });
    if (!template) {
      return NextResponse.json(
        { success: false, error: 'Template not found' },
        { status: 404 }
      );
    }

    console.log('✅ Template found:', template.name);

    // Download Word template from cloud storage via HTTPS API
    let wordBuffer: Buffer;
    try {
      console.log('🔄 Downloading Word template via HTTPS API...');
      const wordResponse = await fetch(template.wordUrl);
      if (!wordResponse.ok) {
        throw new Error('Failed to download Word template via HTTPS');
      }
      wordBuffer = Buffer.from(await wordResponse.arrayBuffer());
      console.log('✅ Word template downloaded from cloud storage via HTTPS API');
    } catch (error) {
      console.error('❌ Error downloading Word template via HTTPS:', error);
      return NextResponse.json(
        { success: false, error: 'Failed to download template via HTTPS API' },
        { status: 500 }
      );
    }

    // Replace placeholders in Word document
    let personalizedWordBuffer: Buffer;
    try {
      const replaceResponse = await fetch(`${process.env.NEXTAUTH_URL || 'https://www.funprinting.store'}/api/replace-placeholders`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          wordFile: wordBuffer.toString('base64'),
          placeholders: formData
        })
      });

      if (!replaceResponse.ok) {
        throw new Error('Failed to replace placeholders');
      }

      const replaceResult = await replaceResponse.json();
      personalizedWordBuffer = Buffer.from(replaceResult.wordFile, 'base64');
      console.log('✅ Placeholders replaced in Word document');
    } catch (error) {
      console.error('❌ Error replacing placeholders:', error);
      return NextResponse.json(
        { success: false, error: 'Failed to replace placeholders' },
        { status: 500 }
      );
    }

    // Convert Word to PDF using Adobe API
    let pdfBuffer: Buffer;
    try {
      const convertResponse = await fetch(`${process.env.NEXTAUTH_URL || 'https://www.funprinting.store'}/api/convert-word-to-pdf`, {
        method: 'POST',
        body: (() => {
          const formData = new FormData();
          const wordFile = new File([new Uint8Array(personalizedWordBuffer)], 'document.docx', { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
          formData.append('file', wordFile);
          return formData;
        })()
      });

      if (!convertResponse.ok) {
        throw new Error('Failed to convert Word to PDF');
      }

      pdfBuffer = Buffer.from(await convertResponse.arrayBuffer());
      console.log('✅ Word document converted to PDF');
    } catch (error) {
      console.error('❌ Error converting Word to PDF:', error);
      return NextResponse.json(
        { success: false, error: 'Failed to convert to PDF' },
        { status: 500 }
      );
    }

    // Upload PDF to cloud storage
    let pdfUrl: string;
    try {
      pdfUrl = await uploadFile(pdfBuffer, 'custom-documents', 'application/pdf');
      console.log('✅ PDF uploaded to cloud storage:', pdfUrl);
    } catch (error) {
      console.error('❌ Error uploading PDF:', error);
      return NextResponse.json(
        { success: false, error: 'Failed to upload PDF' },
        { status: 500 }
      );
    }

    // Create order data
    const orderData = {
      id: uuidv4(),
      templateId: templateId,
      templateName: template.name,
      customerData: formData,
      pdfUrl: pdfUrl,
      status: 'ready_for_order',
      createdAt: new Date(),
      totalAmount: 0 // Will be calculated based on pricing
    };

    console.log('✅ Custom document generated successfully');

    return NextResponse.json({
      success: true,
      orderData,
      pdfUrl: pdfUrl,
      message: 'Custom document generated successfully'
    });

  } catch (error) {
    console.error('❌ Custom document generation error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to generate custom document' },
      { status: 500 }
    );
  }
}