import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
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

    console.log(`Saving template: ${name}`);

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
        const response = await fetch(docxUrl);
        if (!response.ok) {
          throw new Error('Failed to fetch DOCX from Cloudinary');
        }
        
        const docxBuffer = Buffer.from(await response.arrayBuffer());
        
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

    // Use stored formSchema from database if available (preferred)
    // Only regenerate if formSchema is missing or empty
    let formSchema: any[] = [];
    console.log(`[RETRIEVE] Template found: ${template.id}`);
    console.log(`[RETRIEVE] Stored placeholders:`, template.placeholders);
    console.log(`[RETRIEVE] Stored formSchema exists:`, !!template.formSchema);
    console.log(`[RETRIEVE] Stored formSchema is array:`, Array.isArray(template.formSchema));
    console.log(`[RETRIEVE] Stored formSchema length:`, template.formSchema?.length || 0);
    
    if (template.formSchema && Array.isArray(template.formSchema) && template.formSchema.length > 0) {
      console.log('[RETRIEVE] Using stored formSchema from database');
      formSchema = template.formSchema;
      console.log(`[RETRIEVE] Retrieved formSchema from DB: ${formSchema.length} fields`);
      console.log(`[RETRIEVE] FormSchema keys:`, formSchema.map((f: any) => f.key));
      console.log(`[RETRIEVE] FormSchema fields:`, formSchema.map((f: any) => ({ key: f.key, label: f.label })));
    } else {
      // Fallback: Generate form schema from placeholders if stored schema not available
      console.log('[RETRIEVE] Generating formSchema from placeholders (stored schema not available)');
      if (template.placeholders && Array.isArray(template.placeholders) && template.placeholders.length > 0) {
        const schemaObject = generateFormSchema(template.placeholders);
        console.log(`[RETRIEVE] Generated formSchema object keys:`, Object.keys(schemaObject));
        formSchema = Object.entries(schemaObject).map(([key, value]) => ({
          key,
          ...value,
          defaultPlaceholder: value.defaultPlaceholder || value.placeholder || `Enter ${key}`
        }));
        console.log(`[RETRIEVE] Generated formSchema array (${formSchema.length} fields):`, formSchema.map(f => ({ key: f.key, label: f.label })));
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
          wordUrl: template.wordUrl,
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
