import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/authz';
import { fillDocxTemplate } from '@/lib/docxProcessor';
import { uploadFile } from '@/lib/storage';
import { withRequestLogger } from '@/lib/logger';
import { decodeBase64File, fetchTrustedFile, FileFetchError } from '@/lib/documents/fileUrls';
import { TEMPLATE_MAX_BYTES } from '@/lib/documents/templates';

export const runtime = 'nodejs';

/**
 * POST /api/templates/download-filled { fileUrl | docxBuffer, formData }
 * Fills a Word file the user is building a template from (preview download).
 */
export async function POST(request: NextRequest) {
  const user = await requireUser();
  if (user instanceof NextResponse) return user;
  const log = withRequestLogger(request, { userId: user.id });
  try {
    const { docxBuffer, fileUrl, formData } = await request.json().catch(() => ({}));
    if (!docxBuffer && !fileUrl) {
      return NextResponse.json({ success: false, error: 'No document buffer or file URL provided' }, { status: 400 });
    }
    if (!formData || typeof formData !== 'object' || Object.keys(formData).length === 0) {
      return NextResponse.json({ success: false, error: 'No form data provided' }, { status: 400 });
    }
    const buffer = fileUrl ? (await fetchTrustedFile(fileUrl, { maxBytes: TEMPLATE_MAX_BYTES })).buffer : decodeBase64File(docxBuffer, TEMPLATE_MAX_BYTES);
    const filled = await fillDocxTemplate(buffer, formData);
    const downloadUrl = await uploadFile(filled, 'filled-documents', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    return NextResponse.json({ success: true, downloadUrl, message: 'Document generated successfully' });
  } catch (error) {
    if (error instanceof FileFetchError) return NextResponse.json({ success: false, error: error.message }, { status: error.status });
    log.error({ err: error }, 'filled download failed');
    return NextResponse.json({ success: false, error: 'Failed to generate document' }, { status: 500 });
  }
}
