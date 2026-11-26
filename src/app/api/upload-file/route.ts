import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/authz';
import { uploadFile, resolveStorageProviderName, isR2Configured } from '@/lib/storage';
import { withRequestLogger } from '@/lib/logger';
import { PDF_MIME } from '@/lib/uploads/pageCount';
import { prepareUpload } from '@/lib/uploads/printReady';
import { signUploadReceipt } from '@/lib/uploads/receipt';

export const runtime = 'nodejs';
// Word files are converted to PDF during the upload
export const maxDuration = 120;

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
  const provider = resolveStorageProviderName();
  if (provider === 'r2') return isR2Configured();
  if (provider === 'oracle') {
    return Boolean(process.env.OCI_TENANCY_OCID && process.env.OCI_USER_OCID && process.env.OCI_FINGERPRINT);
  }
  return Boolean(process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET);
}

/**
 * POST /api/upload-file (multipart, field "file")
 *
 * Stores the file and a print-ready PDF of it (Word files and images are converted once,
 * here), and returns the URL, the page count of the print-ready PDF and a signed
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
      counted = await prepareUpload(buffer, file.type);
    } catch (error) {
      log.warn({ err: error, mime: file.type }, 'could not read uploaded document');
      return NextResponse.json(
        { success: false, error: 'We could not read this document. It may be damaged or password-protected.' },
        { status: 422 }
      );
    }

    const [fileURL, printPdfUrl] = await Promise.all([
      uploadFile(buffer, 'print-service', file.type),
      counted.pdf ? uploadFile(counted.pdf, 'print-ready', PDF_MIME) : Promise.resolve(null),
    ]);
    const printUrl = file.type === PDF_MIME ? fileURL : printPdfUrl ?? undefined;
    const receipt = signUploadReceipt({
      url: fileURL,
      printUrl,
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
