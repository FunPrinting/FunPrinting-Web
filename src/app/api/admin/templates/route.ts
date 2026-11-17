import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import connectDB from '@/lib/mongodb';
import { uploadFile } from '@/lib/storage';
import { ObjectId } from 'mongodb';

interface TemplateField {
  id: string;
  name: string;
  type: 'text' | 'checkbox' | 'radio';
  x: number;
  y: number;
  width: number;
  height: number;
  page: number;
  defaultValue?: string;
  options?: string[];
  required?: boolean;
}

interface Template {
  id: string;
  name: string;
  description: string;
  category: string;
  fields: TemplateField[];
  pdfUrl: string;
  createdAt: string;
}

// GET - Fetch all templates
export async function GET() {
  const auth = await requireAdmin();
  if (auth instanceof NextResponse) return auth;

  try {
    const db = await connectDB();
    const templates = await db.collection('templates').find({}).toArray();
    
    return NextResponse.json({
      success: true,
      templates: templates
    });
  } catch (error) {
    console.error('Error fetching templates:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch templates' },
      { status: 500 }
    );
  }
}

// POST - Create new template
export async function POST(request: NextRequest) {
  const auth = await requireAdmin();
  if (auth instanceof NextResponse) return auth;

  try {
    const formData = await request.formData();
    const name = formData.get('name') as string;
    const description = formData.get('description') as string;
    const category = formData.get('category') as string;
    const fields = JSON.parse(formData.get('fields') as string);
    const file = formData.get('file') as File;

    if (!name || !description || !category || !fields || !file) {
      return NextResponse.json(
        { success: false, error: 'Missing required fields' },
        { status: 400 }
      );
    }

    // Upload PDF to storage
    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);
    const pdfUrl = await uploadFile(buffer, 'templates', file.type);

    // Save template to database
    const db = await connectDB();
    const template = {
      name,
      description,
      category,
      fields,
      pdfUrl,
      createdAt: new Date().toISOString()
    };

    const result = await db.collection('templates').insertOne(template);

    return NextResponse.json({
      success: true,
      template: { ...template, id: result.insertedId.toString() }
    });
  } catch (error) {
    console.error('Error creating template:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to create template' },
      { status: 500 }
    );
  }
}

// PUT - Update template
export async function PUT(request: NextRequest) {
  const auth = await requireAdmin();
  if (auth instanceof NextResponse) return auth;

  try {
    const { id, ...updates } = await request.json();
    
    if (!id) {
      return NextResponse.json(
        { success: false, error: 'Template ID is required' },
        { status: 400 }
      );
    }

    const db = await connectDB();
    const result = await db.collection('templates').updateOne(
      { _id: id },
      { $set: { ...updates, updatedAt: new Date().toISOString() } }
    );

    if (result.matchedCount === 0) {
      return NextResponse.json(
        { success: false, error: 'Template not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      message: 'Template updated successfully'
    });
  } catch (error) {
    console.error('Error updating template:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to update template' },
      { status: 500 }
    );
  }
}

// DELETE - Delete template
export async function DELETE(request: NextRequest) {
  const auth = await requireAdmin();
  if (auth instanceof NextResponse) return auth;

  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    
    if (!id) {
      return NextResponse.json(
        { success: false, error: 'Template ID is required' },
        { status: 400 }
      );
    }

    const db = await connectDB();
    const queryId = (() => { try { return new ObjectId(id); } catch { return id; } })();
    const result = await db.collection('templates').deleteOne({ _id: queryId as any });

    if (result.deletedCount === 0) {
      return NextResponse.json(
        { success: false, error: 'Template not found' },
        { status: 404 }
      );
    }

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
