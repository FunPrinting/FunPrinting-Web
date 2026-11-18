import { NextRequest, NextResponse } from 'next/server';
import connectDB from '@/lib/mongodb';
import DynamicTemplate from '@/models/DynamicTemplate';
import { generateFormSchema } from '@/lib/docxProcessor';

export async function GET(_request: NextRequest) {
  try {
    await connectDB();

    // Fetch all public templates
    const templates = await DynamicTemplate.find({ isPublic: true })
      // No Word file (the paid product) or creator email in the public list
      .select('id name description category placeholders pdfUrl formSchema createdByType createdByName isPaid price allowFreeDownload createdAt updatedAt')
      .sort({ createdAt: -1 });

    // Generate form schemas for each template
    const templatesWithSchemas = templates.map(template => ({
      id: template.id,
      _id: template._id.toString(),
      name: template.name,
      description: template.description,
      category: template.category,
      placeholders: template.placeholders,
      formSchema: template.formSchema || generateFormSchema(template.placeholders),
      pdfUrl: template.pdfUrl,
      createdByType: template.createdByType,
      createdByName: template.createdByName,
      isPaid: template.isPaid || false,
      price: template.price || 0,
      allowFreeDownload: template.allowFreeDownload !== false,
      createdAt: template.createdAt,
      updatedAt: template.updatedAt
    }));

    return NextResponse.json({
      success: true,
      templates: templatesWithSchemas
    });

  } catch (error) {
    console.error('Error fetching public templates:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch templates' },
      { status: 500 }
    );
  }
}

