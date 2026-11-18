import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser, isAdminSession, requireAdmin } from '@/lib/authz';
import { fetchTrustedFile, isTrustedFileUrl } from '@/lib/documents/fileUrls';
import connectDB from '@/lib/mongodb';
import DynamicTemplate from '@/models/DynamicTemplate';
import { extractPlaceholders, generateFormSchema } from '@/lib/docxProcessor';
import { v4 as uuidv4 } from 'uuid';
import { getCurrentUser } from '@/lib/templateAuth';
import User from '@/models/User';

export async function POST(request: NextRequest) {
  const auth = await requireAdmin();
  if (auth instanceof NextResponse) return auth;

  try {
    const body = await request.json();
    const { 
      name, 
      description, 
      category, 
      pdfUrl, 
      docxUrl,
      placeholders: manualPlaceholders,
      formSchema: manualFormSchema
    } = body;

    if (!name || !description || !category || !pdfUrl || !docxUrl) {
      return NextResponse.json(
        { success: false, error: 'Missing required fields: name, description, category, pdfUrl, docxUrl' },
        { status: 400 }
      );
    }

    // Both files must be in our storage: they are downloaded again when the template is used
    if (!isTrustedFileUrl(pdfUrl) || !isTrustedFileUrl(docxUrl)) {
      return NextResponse.json({ success: false, error: 'pdfUrl and docxUrl must be files uploaded to FunPrinting' }, { status: 400 });
    }

    // Prioritize manually extracted placeholders from frontend (more accurate)
    let placeholders: string[] = [];
    let formSchema: any[] = [];
    const normalizedDocxUrl = docxUrl;

    // Check if manual placeholders are provided from frontend (preferred source)
    if (manualPlaceholders && Array.isArray(manualPlaceholders) && manualPlaceholders.length > 0) {
      console.log('Using manual placeholders from frontend:', manualPlaceholders);
      placeholders = manualPlaceholders;
      
      // Use manual formSchema if provided, otherwise generate from placeholders
      if (manualFormSchema && Array.isArray(manualFormSchema) && manualFormSchema.length > 0) {
        console.log('Using manual formSchema from frontend');
        // Ensure defaultPlaceholder is set for manual formSchema
        formSchema = manualFormSchema.map((field: any) => ({
          ...field,
          key: field.key || field.name,
          defaultPlaceholder: field.defaultPlaceholder || field.placeholder || `Enter ${field.key || field.label || ''}`
        }));
      } else {
        console.log('Generating formSchema from manual placeholders');
        // Generate form schema from placeholders
        const schemaObject = generateFormSchema(placeholders);
        formSchema = Object.entries(schemaObject).map(([key, value]) => ({
          key,
          ...value,
          // Ensure defaultPlaceholder is set if not already present
          defaultPlaceholder: value.defaultPlaceholder || value.placeholder || `Enter ${key}`
        }));
      }
    } else {
      // Fallback: Extract placeholders from DOCX if manual placeholders not provided
      console.log('Manual placeholders not provided, extracting from DOCX...');
      try {
        // Fetch DOCX content from Cloudinary
        const { buffer: docxBuffer } = await fetchTrustedFile(docxUrl, { maxBytes: 20 * 1024 * 1024 });
        
        // Extract placeholders from the DOCX buffer
        placeholders = await extractPlaceholders(docxBuffer);
        console.log('Extracted placeholders from DOCX:', placeholders);
        
        // Generate form schema from placeholders
        if (placeholders.length > 0) {
          const schemaObject = generateFormSchema(placeholders);
          formSchema = Object.entries(schemaObject).map(([key, value]) => ({
            key,
            ...value,
            // Ensure defaultPlaceholder is set if not already present
            defaultPlaceholder: value.defaultPlaceholder || value.placeholder || `Enter ${key}`
          }));
        }
        
      } catch (error) {
        console.error('Error processing DOCX:', error);
        // If extraction fails and no manual data provided, use empty arrays
        placeholders = [];
        formSchema = [];
      }
    }

    // Connect to database
    await connectDB();

    // Create template ID
    const templateId = uuidv4();

    // Get admin user info
    const session = await getCurrentUser();
    let adminUser = null;
    if (session?.email) {
      adminUser = await User.findOne({ email: session.email.toLowerCase() });
    }

    // Create template document
    const template = new DynamicTemplate({
      id: templateId,
      name,
      description,
      category,
      pdfUrl,
      wordUrl: normalizedDocxUrl,
      placeholders,
      formSchema, // Store the form schema in MongoDB
      createdBy: adminUser ? adminUser.email : 'admin', // Backward compatible
      createdByUserId: adminUser ? adminUser._id : undefined,
      createdByEmail: adminUser ? adminUser.email : undefined,
      createdByName: adminUser ? adminUser.name : undefined,
      isPublic: false, // Default to private
      createdByType: 'admin',
    });

    // Save template to database
    const savedTemplate = await template.save();

    return NextResponse.json({
      success: true,
      data: {
        template: {
          id: savedTemplate.id,
          name: savedTemplate.name,
          description: savedTemplate.description,
          category: savedTemplate.category,
          pdfUrl: savedTemplate.pdfUrl,
          wordUrl: savedTemplate.wordUrl,
          placeholders: savedTemplate.placeholders,
          formSchema,
          createdAt: savedTemplate.createdAt,
          updatedAt: savedTemplate.updatedAt
        },
        message: 'Template saved successfully'
      }
    });

  } catch (error: any) {
    console.error('Error saving template:', error);
    
    // Handle MongoDB errors
    if (error.code === 11000) {
      return NextResponse.json(
        { success: false, error: 'Template with this name already exists' },
        { status: 409 }
      );
    }

    return NextResponse.json(
      { success: false, error: 'Failed to save template' },
      { status: 500 }
    );
  }
}

// GET endpoint to retrieve template details
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const templateId = searchParams.get('id');

    if (!templateId) {
      return NextResponse.json(
        { success: false, error: 'Template ID is required' },
        { status: 400 }
      );
    }

    await connectDB();
    
    const template = await DynamicTemplate.findOne({ id: templateId });
    
    if (!template) {
      return NextResponse.json(
        { success: false, error: 'Template not found' },
        { status: 404 }
      );
    }

    // The Word file is what customers pay for on paid templates; only admins get its URL
    const viewer = await getSessionUser().catch(() => null);
    const isAdmin = Boolean(viewer && isAdminSession(viewer));

    // Use stored formSchema from database if available (preferred)
    // Only regenerate if formSchema is missing or empty
    let formSchema: any[] = [];
    
    if (template.formSchema && Array.isArray(template.formSchema) && template.formSchema.length > 0) {
      formSchema = template.formSchema;
    } else {
      // Fallback: Generate form schema from placeholders if stored schema not available
      if (template.placeholders && Array.isArray(template.placeholders) && template.placeholders.length > 0) {
        const schemaObject = generateFormSchema(template.placeholders);
        formSchema = Object.entries(schemaObject).map(([key, value]) => ({
          key,
          ...value,
          defaultPlaceholder: value.defaultPlaceholder || value.placeholder || `Enter ${key}`
        }));
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        template: {
          id: template.id,
          name: template.name,
          description: template.description,
          category: template.category,
          pdfUrl: template.pdfUrl,
          ...(isAdmin ? { wordUrl: template.wordUrl } : {}),
          placeholders: template.placeholders,
          formSchema,
          isPaid: template.isPaid,
          price: template.price,
          allowFreeDownload: template.allowFreeDownload,
          createdAt: template.createdAt,
          updatedAt: template.updatedAt
        }
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
