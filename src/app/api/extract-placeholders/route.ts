import { NextRequest, NextResponse } from 'next/server';
import * as mammoth from 'mammoth';
import { requireUser } from '@/lib/authz';
import { decodeBase64File, fetchTrustedFile, FileFetchError } from '@/lib/documents/fileUrls';
import { TEMPLATE_MAX_BYTES } from '@/lib/documents/templates';

export const runtime = 'nodejs';

const PLACEHOLDER = /\{\{([A-Za-z][A-Za-z0-9_\s]*)\}\}/g;

/**
 * POST /api/extract-placeholders { fileUrl } | { docxBuffer (base64) }
 * Lists the {{placeholders}} in a Word file the user uploaded (template creation).
 */
export async function POST(request: NextRequest) {
  const user = await requireUser();
  if (user instanceof NextResponse) return user;
  try {
    const { docxBuffer, fileUrl } = await request.json().catch(() => ({}));
    if (!docxBuffer && !fileUrl) {
      return NextResponse.json({ success: false, error: 'Document buffer or file URL is required' }, { status: 400 });
    }
    const buffer = fileUrl ? (await fetchTrustedFile(fileUrl, { maxBytes: TEMPLATE_MAX_BYTES })).buffer : decodeBase64File(docxBuffer, TEMPLATE_MAX_BYTES);
    const { value: text } = await mammoth.extractRawText({ buffer });
    const placeholders = [...new Set([...text.matchAll(PLACEHOLDER)].map((m) => m[1].trim()).filter(Boolean))].sort();
    return NextResponse.json({
      success: true,
      placeholders,
      text: text.substring(0, 500) + (text.length > 500 ? '...' : ''),
      count: placeholders.length,
    });
  } catch (error) {
    if (error instanceof FileFetchError) return NextResponse.json({ success: false, error: error.message }, { status: error.status });
    return NextResponse.json({ success: false, error: 'Failed to extract placeholders from document' }, { status: 422 });
  }
}
