import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/authz';
import { createPresignedUpload } from '@/lib/storage';
import { checkRateLimit, generationRateLimit, getClientIdentifier } from '@/lib/ratelimit';
import { withRequestLogger } from '@/lib/logger';

export const runtime = 'nodejs';

const MAX_ORDER_BYTES = 50 * 1024 * 1024;
const MAX_TEMPLATE_BYTES = 20 * 1024 * 1024;

const ORDER_ALLOWED_TYPES = new Set([
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

function inferMime(fileName: string, givenType?: string): string {
  const clean = (givenType || '').split(';')[0].trim().toLowerCase();
  if (clean && ORDER_ALLOWED_TYPES.has(clean)) return clean;
  const match = fileName.toLowerCase().match(/(\.[a-z0-9]+)$/);
  if (match && EXT_TO_MIME[match[1]]) return EXT_TO_MIME[match[1]];
  return clean;
}

/**
 * POST /api/upload-presign { fileName, contentType, fileSize, purpose?: 'order' | 'template' | 'preview' }
 *
 * Issues a short-lived Cloudflare R2 presigned PUT URL so the browser uploads directly to R2,
 * completely bypassing Vercel's 4.5 MB serverless request-body limit.
 * Returns { supported: false } when R2 presigned uploads aren't active so callers can fall back.
 */
export async function POST(request: NextRequest) {
  const log = withRequestLogger(request);
  try {
    const body = await request.json().catch(() => ({}));
    const purpose: 'order' | 'template' | 'preview' =
      body.purpose === 'template' ? 'template' : body.purpose === 'preview' ? 'preview' : 'order';

    if (purpose === 'preview') {
      const limited = await checkRateLimit(generationRateLimit, `presign-preview:${getClientIdentifier(request)}`);
      if (limited) return limited;
    } else {
      const user = await requireUser();
      if (user instanceof NextResponse) return user;
    }

    const fileName = typeof body.fileName === 'string' ? body.fileName.trim() : '';
    const fileSize = Number(body.fileSize);
    const mime = inferMime(fileName, typeof body.contentType === 'string' ? body.contentType : '');

    if (!fileName) {
      return NextResponse.json({ success: false, error: 'fileName is required' }, { status: 400 });
    }

    const maxBytes = purpose === 'order' ? MAX_ORDER_BYTES : MAX_TEMPLATE_BYTES;
    if (!Number.isFinite(fileSize) || fileSize <= 0) {
      return NextResponse.json({ success: false, error: 'Valid fileSize is required' }, { status: 400 });
    }
    if (fileSize > maxBytes) {
      const limitMb = Math.round(maxBytes / (1024 * 1024));
      return NextResponse.json(
        { success: false, error: `File size too large. Maximum allowed size is ${limitMb}MB.` },
        { status: 413 }
      );
    }

    if (purpose === 'preview') {
      if (mime !== 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' && !/\.docx$/i.test(fileName)) {
        return NextResponse.json({ success: false, error: 'Only .docx files are supported for preview' }, { status: 400 });
      }
    } else if (purpose === 'template') {
      if (
        mime !== 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' &&
        mime !== 'application/pdf' &&
        !/\.(docx|pdf)$/i.test(fileName)
      ) {
        return NextResponse.json({ success: false, error: 'Only Word (.docx) and PDF files can be uploaded' }, { status: 400 });
      }
    } else if (!ORDER_ALLOWED_TYPES.has(mime)) {
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid file type. Only PDF, Word documents, and image files (JPEG, PNG, GIF, BMP, TIFF, WebP, SVG) are allowed.',
        },
        { status: 400 }
      );
    }

    const folder =
      purpose === 'template' ? 'raw-templates' : purpose === 'preview' ? 'preview-temp' : 'print-service';

    const presigned = await createPresignedUpload({
      folder,
      fileName,
      contentType: mime || 'application/octet-stream',
      expiresInSeconds: 300,
    });

    if (!presigned) {
      return NextResponse.json({ success: true, supported: false });
    }

    return NextResponse.json({
      success: true,
      supported: true,
      uploadUrl: presigned.uploadUrl,
      fileUrl: presigned.fileUrl,
      key: presigned.key,
      contentType: mime || 'application/octet-stream',
    });
  } catch (error) {
    log.error({ err: error }, 'failed to create presigned upload URL');
    return NextResponse.json({ success: false, error: 'Failed to prepare upload' }, { status: 500 });
  }
}

