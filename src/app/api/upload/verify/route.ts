import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/authz';
import { countPdfPages } from '@/lib/uploads/pageCount';

export const runtime = 'nodejs';

const MAX_BYTES = 50 * 1024 * 1024;

/**
 * POST /api/upload/verify (multipart "file", PDF)
 * Page count for the order page's price preview. The price charged comes from
 * /api/upload-file's signed receipt, not from this.
 */
export async function POST(request: NextRequest) {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;
  if (Number(request.headers.get('content-length') || 0) > MAX_BYTES + 1024 * 1024) {
    return NextResponse.json({ success: false, error: 'File is too large (50 MB at most)' }, { status: 413 });
  }
  try {
    const file = (await request.formData()).get('file');
    if (!(file instanceof File)) return NextResponse.json({ success: false, error: 'No file provided' }, { status: 400 });
    if (file.size > MAX_BYTES) return NextResponse.json({ success: false, error: 'File is too large (50 MB at most)' }, { status: 413 });
    if (file.type !== 'application/pdf') return NextResponse.json({ success: false, error: 'Only PDF files are supported' }, { status: 400 });
    const verifiedPageCount = await countPdfPages(new Uint8Array(await file.arrayBuffer()));
    return NextResponse.json({ success: true, verifiedPageCount });
  } catch {
    return NextResponse.json({ success: false, error: 'Failed to verify PDF structure' }, { status: 422 });
  }
}
