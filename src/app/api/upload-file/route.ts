import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/authz';
import { uploadFile } from '@/lib/storage';

// Runtime configuration for Vercel
export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;

  console.log('🚀 Upload API called');
  
  try {
    // Check if we're on Vercel and log environment info
    const isVercel = process.env.VERCEL === '1';
    console.log(`Environment: ${isVercel ? 'Vercel' : 'Local'}`);
    console.log(`Node version: ${process.version}`);
    console.log(`Memory usage: ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB`);
    
    const formData = await request.formData();
    const file = formData.get('file') as File;
    
    if (!file) {
      console.log('❌ No file provided');
      return NextResponse.json({ success: false, error: 'No file provided' }, { status: 400 });
    }

    console.log(`📁 File received: ${file.name}, size: ${(file.size / (1024 * 1024)).toFixed(2)}MB, type: ${file.type}`);

    // Check file size (50MB limit)
    const maxSize = 50 * 1024 * 1024; // 50MB in bytes
    if (file.size > maxSize) {
      console.log(`❌ File too large: ${(file.size / (1024 * 1024)).toFixed(2)}MB > 50MB`);
      return NextResponse.json({ 
        success: false, 
        error: `File size too large. Maximum allowed size is 50MB. Your file is ${(file.size / (1024 * 1024)).toFixed(2)}MB` 
      }, { status: 413 });
    }

    // Check file type - allow PDF, Word documents, and common image formats
    const allowedTypes = [
      // Document formats
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      // Image formats
      'image/jpeg',
      'image/jpg', 
      'image/png',
      'image/gif',
      'image/bmp',
      'image/tiff',
      'image/webp',
      'image/svg+xml'
    ];
    
    if (!allowedTypes.includes(file.type)) {
      console.log(`❌ Invalid file type: ${file.type}`);
      return NextResponse.json({ 
        success: false, 
        error: 'Invalid file type. Only PDF, Word documents, and image files (JPEG, PNG, GIF, BMP, TIFF, WebP, SVG) are allowed.' 
      }, { status: 400 });
    }

    console.log(`✅ File validation passed, converting to buffer...`);

    // Convert file to buffer
    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);
    
    console.log(`📦 Buffer created: ${buffer.length} bytes`);

    // Check storage provider configuration
    const storageProvider = process.env.STORAGE_PROVIDER || 'cloudinary';
    if (storageProvider === 'cloudinary') {
    if (!process.env.CLOUDINARY_CLOUD_NAME || !process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET) {
      console.log('❌ Cloudinary configuration missing');
      return NextResponse.json({ 
        success: false, 
        error: 'File upload service not configured. Please contact support.' 
      }, { status: 500 });
    }
    } else if (storageProvider === 'oracle') {
      if (!process.env.OCI_TENANCY_OCID || !process.env.OCI_USER_OCID || !process.env.OCI_FINGERPRINT) {
        console.log('❌ Oracle Cloud configuration missing');
        return NextResponse.json({ 
          success: false, 
          error: 'File upload service not configured. Please contact support.' 
        }, { status: 500 });
      }
    }

    console.log(`☁️ Uploading to ${storageProvider}...`);

    // Upload to configured storage provider
    const fileURL = await uploadFile(buffer, 'print-service', file.type);
    
    console.log(`✅ File uploaded successfully: ${fileURL}`);
    
    return NextResponse.json({
      success: true,
      fileURL,
      fileType: file.type,
      originalFileName: file.name,
      fileSize: file.size
    });
  } catch (error) {
    console.error('❌ Error uploading file:', error);
    
    // Handle specific error types
    if (error instanceof Error) {
      console.error('Error details:', {
        message: error.message,
        stack: error.stack,
        name: error.name
      });
      
      if (error.message.includes('413') || error.message.includes('Payload Too Large')) {
        return NextResponse.json({ 
          success: false, 
          error: 'File size too large. Please try a smaller file.' 
        }, { status: 413 });
      }
      
      if (error.message.includes('Cloudinary') || error.message.includes('Oracle')) {
        return NextResponse.json({ 
          success: false, 
          error: 'File upload service error. Please try again.' 
        }, { status: 500 });
      }
    }
    
    return NextResponse.json({ 
      success: false, 
      error: 'Failed to upload file. Please try again.' 
    }, { status: 500 });
  }
}
