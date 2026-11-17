import { NextRequest, NextResponse } from 'next/server';
import connectDB from '@/lib/mongodb';
import Order, { IOrder } from '@/models/Order';
import { getFileTypeFromFilename } from '@/lib/fileTypeDetection';
import { requireUser, isAdminSession, canAccessOrder } from '@/lib/authz';

export async function GET(request: NextRequest) {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;

  try {
    const { searchParams } = new URL(request.url);
    const pdfUrl = searchParams.get('url');
    const orderId = searchParams.get('orderId');
    const filename = searchParams.get('filename') || 'document';

    if (!pdfUrl) {
      return NextResponse.json({ error: 'File URL is required' }, { status: 400 });
    }

    // Admins may view any file. Customers (this route is also used by /orders/[id])
    // may only view files that belong to one of their own orders.
    if (!isAdminSession(auth)) {
      if (!orderId) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
      await connectDB();
      const ownedOrder = await Order.findOne({ orderId }).lean<IOrder>();
      if (!ownedOrder || !canAccessOrder(auth, ownedOrder)) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
      const allowedUrls = [
        ownedOrder.fileURL,
        ...(ownedOrder.fileURLs || []),
        ownedOrder.filledPdfUrl,
        ownedOrder.filledDocxUrl,
        ownedOrder.templateData?.generatedPDF,
      ].filter(Boolean);
      if (!allowedUrls.includes(pdfUrl)) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
    }

    console.log('📄 File Viewer: Fetching from URL:', pdfUrl);

    // If orderId is provided, get file type from database
    let fileType = 'application/octet-stream';
    let originalFileName = filename;
    
    if (orderId) {
      try {
        await connectDB();
        const order = await Order.findOne({ orderId });
        
        if (order) {
          // Try to get fileType from database
          if (order.fileType) {
            fileType = order.fileType;
            originalFileName = order.originalFileName || filename;
            console.log('📄 File Viewer: Found file type from database:', fileType);
          } else {
            // Fallback: detect from filename or originalFileNames
            if (order.originalFileNames && Array.isArray(order.originalFileNames) && order.originalFileNames.length > 0) {
              // Multi-file: detect from first file or find matching file
              const fileIndex = order.fileURLs?.findIndex((url: string) => url === pdfUrl) ?? 0;
              const detectedFileName = order.originalFileNames[fileIndex] || order.originalFileNames[0];
              fileType = getFileTypeFromFilename(detectedFileName, pdfUrl);
              originalFileName = detectedFileName;
              console.log('📄 File Viewer: Detected file type from originalFileNames:', fileType);
            } else if (order.originalFileName) {
              fileType = getFileTypeFromFilename(order.originalFileName, pdfUrl);
              originalFileName = order.originalFileName;
              console.log('📄 File Viewer: Detected file type from originalFileName:', fileType);
            } else {
              // Last resort: detect from filename parameter
              fileType = getFileTypeFromFilename(filename, pdfUrl);
              console.log('📄 File Viewer: Detected file type from filename parameter:', fileType);
            }
          }
          console.log('📄 File Viewer: Using filename:', originalFileName);
        } else {
          // No order found, detect from filename parameter
          fileType = getFileTypeFromFilename(filename, pdfUrl);
          console.log('📄 File Viewer: Order not found, detected file type from filename:', fileType);
        }
      } catch (dbError) {
        console.error('📄 File Viewer: Error fetching order from database:', dbError);
        // Fallback: detect from filename parameter
        fileType = getFileTypeFromFilename(filename, pdfUrl);
        console.log('📄 File Viewer: Detected file type from filename (fallback):', fileType);
      }
    } else {
      // No orderId, detect from filename parameter
      fileType = getFileTypeFromFilename(filename, pdfUrl);
      console.log('📄 File Viewer: No orderId, detected file type from filename:', fileType);
    }

    // Fetch the file from Cloudinary with better error handling
    let response: Response;
    try {
      response = await fetch(pdfUrl, {
        method: 'GET',
        headers: {
          'Accept': '*/*',
        },
      });
    } catch (fetchError: any) {
      console.error('❌ File Viewer: Error fetching file from URL:', fetchError);
      console.error('❌ File Viewer: URL was:', pdfUrl);
      return NextResponse.json({ 
        error: 'Failed to fetch file from URL',
        details: fetchError?.message || 'Unknown fetch error'
      }, { status: 500 });
    }
    
    if (!response.ok) {
      console.error('❌ File Viewer: Failed to fetch file, status:', response.status);
      console.error('❌ File Viewer: Response status text:', response.statusText);
      console.error('❌ File Viewer: URL was:', pdfUrl);
      const errorText = await response.text().catch(() => 'Could not read error response');
      console.error('❌ File Viewer: Error response body:', errorText.substring(0, 200));
      return NextResponse.json({ 
        error: 'Failed to fetch file',
        status: response.status,
        details: response.statusText
      }, { status: response.status >= 500 ? 500 : 404 });
    }

    // Convert response to arrayBuffer with error handling
    let fileBuffer: ArrayBuffer;
    try {
      fileBuffer = await response.arrayBuffer();
      console.log('✅ File Viewer: Successfully fetched file, size:', fileBuffer.byteLength, 'bytes');
    } catch (arrayBufferError: any) {
      console.error('❌ File Viewer: Error converting response to arrayBuffer:', arrayBufferError);
      console.error('❌ File Viewer: Response status was:', response.status);
      console.error('❌ File Viewer: URL was:', pdfUrl);
      return NextResponse.json({ 
        error: 'Failed to process file data',
        details: arrayBufferError?.message || 'Unknown arrayBuffer error'
      }, { status: 500 });
    }

    // Determine if this is an image file that can be displayed inline
    const isImage = fileType.startsWith('image/');
    const isPDF = fileType === 'application/pdf';
    const isText = fileType.startsWith('text/');
    
    // For images, we can serve them directly
    if (isImage) {
      return new NextResponse(fileBuffer, {
        status: 200,
        headers: {
          'Content-Type': fileType,
          'Content-Disposition': `inline; filename="${originalFileName}"`,
          'Content-Length': fileBuffer.byteLength.toString(),
          'Cache-Control': 'private, max-age=3600',
          'X-Frame-Options': 'SAMEORIGIN',
        },
      });
    }
    
    // For PDFs, serve with PDF content type
    if (isPDF) {
      return new NextResponse(fileBuffer, {
        status: 200,
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `inline; filename="${originalFileName}"`,
          'Content-Length': fileBuffer.byteLength.toString(),
          'Cache-Control': 'private, max-age=3600',
          'X-Frame-Options': 'SAMEORIGIN',
        },
      });
    }
    
    // For text files, serve as text
    if (isText) {
      const textContent = new TextDecoder().decode(fileBuffer);
      return new NextResponse(textContent, {
        status: 200,
        headers: {
          'Content-Type': fileType,
          'Content-Disposition': `inline; filename="${originalFileName}"`,
          'Cache-Control': 'private, max-age=3600',
          'X-Frame-Options': 'SAMEORIGIN',
        },
      });
    }
    
    // For other files (docx, xlsx, etc.), try to serve inline for preview
    // but some browsers may still download them
    return new NextResponse(fileBuffer, {
      status: 200,
      headers: {
        'Content-Type': fileType,
        'Content-Disposition': `inline; filename="${originalFileName}"`,
        'Content-Length': fileBuffer.byteLength.toString(),
        'Cache-Control': 'private, max-age=3600',
        'X-Frame-Options': 'SAMEORIGIN',
      },
    });

  } catch (error) {
    console.error('❌ File Viewer: Error serving file:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
