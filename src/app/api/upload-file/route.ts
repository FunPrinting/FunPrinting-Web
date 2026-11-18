import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/authz';
import { uploadFile } from '@/lib/storage';
import { withRequestLogger } from '@/lib/logger';
import { countPages } from '@/lib/uploads/pageCount';
import { signUploadReceipt } from '@/lib/uploads/receipt';

export const runtime = 'nodejs';
export const maxDuration = 60;

const MAX_BYTES = 50 * 1024 * 1024;
const ALLOWED_TYPES = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/gif',
  'image/bmp',
  'image/tiff',
  'image/webp',
  'image/svg+xml',
]);

function storageConfigured(): boolean {
  const provider = (process.env.STORAGE_PROVIDER || 'cloudinary').toLowerCase();
  if (provider === 'oracle') {
    return Boolean(process.env.OCI_TENANCY_OCID && process.env.OCI_USER_OCID && process.env.OCI_FINGERPRINT);
  }
  return Boolean(process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET);
}

/**
 * POST /api/upload-file (multipart, field "file")
 *
 * Stores the file and returns its URL, the server-counted page count and a signed
 * `receipt`. Checkout requires the receipt; page counts from the browser are ignored.
 */
export async function POST(request: NextRequest) {
  const user = await requireUser();
  if (user instanceof NextResponse) return user;
  const log = withRequestLogger(request);

  try {
    const formData = await request.formData();
    const file = formData.get('file');
    if (!(file instanceof File)) {
      return NextResponse.json({ success: false, error: 'No file provided' }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json(
        { success: false, error: `File size too large. Maximum allowed size is 50MB. Your file is ${(file.size / (1024 * 1024)).toFixed(2)}MB` },
        { status: 413 }
      );
    }
    if (!ALLOWED_TYPES.has(file.type)) {
      return NextResponse.json(
        { success: false, error: 'Invalid file type. Only PDF, Word documents, and image files (JPEG, PNG, GIF, BMP, TIFF, WebP, SVG) are allowed.' },
        { status: 400 }
      );
    }
    if (!storageConfigured()) {
      log.error('upload storage is not configured');
      return NextResponse.json({ success: false, error: 'File upload service not configured. Please contact support.' }, { status: 500 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());

    let counted;
    try {
      counted = await countPages(buffer, file.type);
    } catch (error) {
      log.warn({ err: error, mime: file.type }, 'could not read uploaded document');
      return NextResponse.json(
        { success: false, error: 'We could not read this document. It may be damaged or password-protected.' },
        { status: 422 }
      );
    }

    const fileURL = await uploadFile(buffer, 'print-service', file.type);
    const receipt = signUploadReceipt({
      url: fileURL,
      name: file.name.slice(0, 255),
      mime: file.type,
      size: file.size,
      pages: counted.pages,
      estimated: counted.estimated,
      uid: user.email,
    });

    log.info({ mime: file.type, size: file.size, pages: counted.pages, estimated: counted.estimated }, 'file uploaded');
    return NextResponse.json({
      success: true,
      fileURL,
      fileType: file.type,
      originalFileName: file.name,
      fileSize: file.size,
      pageCount: counted.pages,
      pageCountEstimated: counted.estimated,
      receipt,
    });
  } catch (error) {
    log.error({ err: error }, 'file upload failed');
    const message = error instanceof Error ? error.message : '';
    if (message.includes('413') || message.includes('Payload Too Large')) {
      return NextResponse.json({ success: false, error: 'File size too large. Please try a smaller file.' }, { status: 413 });
    }
    return NextResponse.json({ success: false, error: 'Failed to upload file. Please try again.' }, { status: 500 });
  }
}
