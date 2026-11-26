import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit, generationRateLimit, getClientIdentifier } from '@/lib/ratelimit';
import { decodeBase64File, fetchTrustedFile, FileFetchError } from '@/lib/documents/fileUrls';
import { countPages, DOCX_MIME } from '@/lib/uploads/pageCount';

export const runtime = 'nodejs';
export const maxDuration = 60;

const MAX_BYTES = 20 * 1024 * 1024;

/**
 * POST /api/parse-docx-structure { fileUrl } | { docxBuffer (base64) }
 * Page count of a Word file for the order page's price preview (guests too). Uses the
 * same counting as /api/upload-file, whose signed receipt sets the price charged.
 * Rate-limited because counting may use a paid conversion service.
 */
export async function POST(request: NextRequest) {
  const limited = await checkRateLimit(generationRateLimit, `docx-count:${getClientIdentifier(request)}`);
  if (limited) return limited;
  try {
    const { docxBuffer, fileUrl } = await request.json().catch(() => ({}));
    const buffer = fileUrl
      ? (await fetchTrustedFile(fileUrl, { maxBytes: MAX_BYTES })).buffer
      : decodeBase64File(docxBuffer, MAX_BYTES);
    if (buffer[0] !== 0x50 || buffer[1] !== 0x4b) {
      return NextResponse.json({ success: false, error: 'Only .docx Word files are supported' }, { status: 400 });
    }
    const { pages, estimated } = await countPages(buffer, DOCX_MIME);
    return NextResponse.json({ success: true, totalPages: pages, estimated });
  } catch (error) {
    if (error instanceof FileFetchError) return NextResponse.json({ success: false, error: error.message }, { status: error.status });
    return NextResponse.json({ success: false, error: 'Failed to read the Word document' }, { status: 422 });
  }
}
