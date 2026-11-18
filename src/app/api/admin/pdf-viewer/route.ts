import { NextRequest, NextResponse } from 'next/server';
import connectDB from '@/lib/mongodb';
import Order, { IOrder } from '@/models/Order';
import { getFileTypeFromFilename } from '@/lib/fileTypeDetection';
import { requireUser, isAdminSession, canAccessOrder } from '@/lib/authz';
import { fetchTrustedFile, FileFetchError, MAX_FILE_BYTES } from '@/lib/documents/fileUrls';

export const runtime = 'nodejs';

/** Shown in the browser; everything else downloads. SVG and HTML could run scripts on our site. */
const INLINE_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/bmp']);

function contentDisposition(kind: 'inline' | 'attachment', name: string) {
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_').slice(0, 150) || 'document';
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name.slice(0, 150))}`;
}

/**
 * GET /api/admin/pdf-viewer?url=&orderId=&filename=
 * Streams an order file from our storage for previewing.
 * - Customers: only files of their own order (orderId required).
 * - Admins: any file, but still only from our storage.
 */
export async function GET(request: NextRequest) {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;

  const { searchParams } = new URL(request.url);
  const fileUrl = searchParams.get('url');
  const orderId = searchParams.get('orderId');
  const filename = (searchParams.get('filename') || 'document').slice(0, 200);
  if (!fileUrl) return NextResponse.json({ error: 'File URL is required' }, { status: 400 });

  try {
    let order: IOrder | null = null;
    if (orderId) {
      await connectDB();
      order = await Order.findOne({ orderId }).lean<IOrder>();
    }
    if (!isAdminSession(auth)) {
      if (!order || !canAccessOrder(auth, order)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      const allowed = [order.fileURL, ...(order.fileURLs || []), order.filledPdfUrl, order.filledDocxUrl, order.templateData?.generatedPDF].filter(Boolean);
      if (!allowed.includes(fileUrl)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // File name and type from the order when we have it
    let name = filename;
    if (order) {
      const index = order.fileURLs?.findIndex((u: string) => u === fileUrl) ?? -1;
      name = (index >= 0 ? order.originalFileNames?.[index] : undefined) || order.originalFileName || filename;
    }
    const fileType = (order?.fileType && !order.fileURLs?.length ? order.fileType : getFileTypeFromFilename(name, fileUrl)).toLowerCase();

    const { buffer } = await fetchTrustedFile(fileUrl, { maxBytes: MAX_FILE_BYTES });
    const inline = INLINE_TYPES.has(fileType);
    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type': inline ? fileType : 'application/octet-stream',
        'Content-Disposition': contentDisposition(inline ? 'inline' : 'attachment', name),
        'Content-Length': String(buffer.length),
        'Cache-Control': 'private, max-age=3600',
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'SAMEORIGIN',
      },
    });
  } catch (error) {
    if (error instanceof FileFetchError) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
