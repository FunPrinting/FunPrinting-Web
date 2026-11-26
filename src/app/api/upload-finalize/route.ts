import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/authz';
import { uploadFile } from '@/lib/storage';
import { withRequestLogger } from '@/lib/logger';
import { fetchTrustedFile, FileFetchError, MAX_FILE_BYTES } from '@/lib/documents/fileUrls';
import { PDF_MIME } from '@/lib/uploads/pageCount';
import { prepareUpload } from '@/lib/uploads/printReady';
import { signUploadReceipt } from '@/lib/uploads/receipt';

export const runtime = 'nodejs';
export const maxDuration = 120;

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

const EXT_TO_MIME: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
};

function resolveMime(fileName: string, givenType?: string, headerType?: string | null): string {
  for (const candidate of [givenType, headerType]) {
    const clean = (candidate || '').split(';')[0].trim().toLowerCase();
    if (clean && ALLOWED_TYPES.has(clean)) return clean;
  }
  const match = fileName.toLowerCase().match(/(\.[a-z0-9]+)$/);
  if (match && EXT_TO_MIME[match[1]]) return EXT_TO_MIME[match[1]];
  return '';
}

/**
 * POST /api/upload-finalize { fileUrl, fileName, fileType }
 *
 * Called after the browser uploads directly to Cloudflare R2 via /api/upload-presign.
 * Downloads the stored file from R2 (no 4.5 MB Vercel request limit on outbound fetch),
 * runs server-side page counting + print-ready PDF conversion, and returns the signed receipt.
 */
export async function POST(request: NextRequest) {
  const user = await requireUser();
  if (user instanceof NextResponse) return user;
  const log = withRequestLogger(request, { userId: user.id });

  try {
    const body = await request.json().catch(() => ({}));
    const fileUrl = typeof body.fileUrl === 'string' ? body.fileUrl : '';
    const fileName = typeof body.fileName === 'string' ? body.fileName.trim() : 'document';
    const givenType = typeof body.fileType === 'string' ? body.fileType : '';

    if (!fileUrl) {
      return NextResponse.json({ success: false, error: 'fileUrl is required' }, { status: 400 });
    }

    const { buffer, contentType } = await fetchTrustedFile(fileUrl, { maxBytes: MAX_FILE_BYTES });
    const mime = resolveMime(fileName, givenType, contentType);
    if (!ALLOWED_TYPES.has(mime)) {
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid file type. Only PDF, Word documents, and image files (JPEG, PNG, GIF, BMP, TIFF, WebP, SVG) are allowed.',
        },
        { status: 400 }
      );
    }

    let counted;
    try {
      counted = await prepareUpload(buffer, mime);
    } catch (error) {
      log.warn({ err: error, mime }, 'could not read uploaded document');
      return NextResponse.json(
        { success: false, error: 'We could not read this document. It may be damaged or password-protected.' },
        { status: 422 }
      );
    }

    const printPdfUrl = counted.pdf ? await uploadFile(counted.pdf, 'print-ready', PDF_MIME) : null;
    const printUrl = mime === PDF_MIME ? fileUrl : printPdfUrl ?? undefined;
    const receipt = signUploadReceipt({
      url: fileUrl,
      printUrl,
      name: fileName.slice(0, 255),
      mime,
      size: buffer.length,
      pages: counted.pages,
      estimated: counted.estimated,
      uid: user.email,
    });

    log.info({ mime, size: buffer.length, pages: counted.pages, estimated: counted.estimated }, 'direct R2 upload finalized');
    return NextResponse.json({
      success: true,
      fileURL: fileUrl,
      fileType: mime,
      originalFileName: fileName,
      fileSize: buffer.length,
      pageCount: counted.pages,
      pageCountEstimated: counted.estimated,
      receipt,
    });
  } catch (error) {
    if (error instanceof FileFetchError) {
      return NextResponse.json({ success: false, error: error.message }, { status: error.status });
    }
    log.error({ err: error }, 'upload finalize failed');
    return NextResponse.json({ success: false, error: 'Failed to process uploaded file. Please try again.' }, { status: 500 });
  }
}

