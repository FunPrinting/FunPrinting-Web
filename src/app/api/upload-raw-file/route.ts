import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/authz';
import { uploadFile } from '@/lib/storage';
import { withRequestLogger } from '@/lib/logger';
import { decodeBase64File, FileFetchError } from '@/lib/documents/fileUrls';
import { TEMPLATE_MAX_BYTES } from '@/lib/documents/templates';

export const runtime = 'nodejs';

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const TYPES: Record<string, { mime: string; magic: (b: Buffer) => boolean }> = {
  docx: { mime: DOCX, magic: (b) => b[0] === 0x50 && b[1] === 0x4b }, // ZIP
  pdf: { mime: 'application/pdf', magic: (b) => b.toString('ascii', 0, 5) === '%PDF-' },
};

/**
 * POST /api/upload-raw-file { fileName, fileBuffer (base64), contentType }
 * Stores a Word or PDF file for template creation. The type is checked from the
 * file's content, not the browser's claim. 20 MB at most.
 */
export async function POST(request: NextRequest) {
  const user = await requireUser();
  if (user instanceof NextResponse) return user;
  const log = withRequestLogger(request, { userId: user.id });
  try {
    const { fileName, fileBuffer, contentType } = await request.json().catch(() => ({}));
    if (!fileName || !fileBuffer) {
      return NextResponse.json({ success: false, error: 'File name and buffer are required' }, { status: 400 });
    }
    const buffer = decodeBase64File(fileBuffer, TEMPLATE_MAX_BYTES);
    const ext = String(fileName).toLowerCase().split('.').pop() || '';
    const type = TYPES[ext] ?? (contentType === DOCX ? TYPES.docx : contentType === 'application/pdf' ? TYPES.pdf : undefined);
    if (!type || !type.magic(buffer)) {
      return NextResponse.json({ success: false, error: 'Only Word (.docx) and PDF files can be uploaded' }, { status: 400 });
    }
    const url = await uploadFile(buffer, 'raw-templates', type.mime);
    return NextResponse.json({ success: true, url, message: 'File uploaded successfully' });
  } catch (error) {
    if (error instanceof FileFetchError) return NextResponse.json({ success: false, error: error.message }, { status: error.status });
    log.error({ err: error }, 'raw file upload failed');
    return NextResponse.json({ success: false, error: 'Failed to upload file' }, { status: 500 });
  }
}
