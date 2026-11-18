import { NextRequest, NextResponse, after } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { fillDocxTemplate } from '@/lib/docxProcessor';
import { uploadFile } from '@/lib/storage';
import { jobStore } from '@/lib/jobStore';
import { generationRateLimit, getClientIdentifier, checkRateLimit } from '@/lib/ratelimit';
import { requireUser } from '@/lib/authz';
import { checkTemplateAccess, releaseTemplateGeneration, type TemplateAccess } from '@/lib/payments/templateAccess';
import { withRequestLogger, logger } from '@/lib/logger';
import { docxToPdf, ConversionError } from '@/lib/documents/convert';
import { FileFetchError } from '@/lib/documents/fileUrls';
import { loadTemplateDocx, TemplateError } from '@/lib/documents/templates';

export const runtime = 'nodejs';
export const maxDuration = 300;

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/** Converts the filled document to PDF after the response is sent; the client polls generation-status. */
async function convertInBackground(jobId: string, userId: string, filled: Buffer, wordUrl: string, createdAt: number) {
  try {
    const { pdf, provider } = await docxToPdf(filled);
    const pdfUrl = await uploadFile(pdf, `filled-documents/${jobId}`, 'application/pdf');
    await jobStore.set(jobId, { jobId, userId, wordUrl, pdfUrl, status: 'completed', createdAt });
    logger.info({ jobId, provider }, 'template PDF ready');
  } catch (err) {
    const error = err instanceof ConversionError ? 'PDF conversion is unavailable right now. You can still download the Word document.' : 'PDF conversion failed. You can still download the Word document.';
    logger.error({ jobId, err: err instanceof Error ? err.message : err, attempts: err instanceof ConversionError ? err.attempts : undefined }, 'template PDF conversion failed');
    await jobStore.set(jobId, { jobId, userId, wordUrl, status: 'failed', error, createdAt });
  }
}

/**
 * POST /api/templates/generate-fill-pdf { templateId, formData, paymentRef? }
 * Fills the template's Word file, returns its URL and a jobId at once, and converts
 * it to PDF in the background (poll /api/templates/generation-status/<jobId>).
 */
export async function POST(request: NextRequest) {
  const limited = await checkRateLimit(generationRateLimit, getClientIdentifier(request));
  if (limited) return limited;
  const user = await requireUser();
  if (user instanceof NextResponse) return user;
  const log = withRequestLogger(request, { userId: user.id });

  let counted: TemplateAccess | null = null;
  try {
    const body = await request.json().catch(() => ({}));
    const { templateId, paymentRef } = body;
    const access = await checkTemplateAccess(templateId, body.formData, paymentRef);
    if (access instanceof NextResponse) return access;
    counted = access;
    const formData = access.formData;
    if (!templateId || !formData) {
      return NextResponse.json({ success: false, error: 'templateId and formData are required' }, { status: 400 });
    }

    const { template, docx } = await loadTemplateDocx(templateId);
    const filled = await fillDocxTemplate(docx, formData);
    const jobId = uuidv4();
    const wordUrl = await uploadFile(filled, `filled-documents/${jobId}`, DOCX_MIME);
    const createdAt = Date.now();
    await jobStore.set(jobId, { jobId, userId: user.id, wordUrl, status: 'processing', createdAt });

    // after() keeps the function alive until the conversion finishes
    after(() => convertInBackground(jobId, user.id, filled, wordUrl, createdAt));
    log.info({ jobId, templateId }, 'template document generated');

    return NextResponse.json({
      success: true,
      jobId,
      wordUrl,
      templateName: template.name,
      status: 'processing',
      message: 'Document generated. PDF conversion in progress...',
    });
  } catch (error) {
    // A failed attempt must not use up one of the buyer's generations
    if (counted) await releaseTemplateGeneration(counted).catch((err) => log.error({ err }, 'could not release template generation'));
    if (error instanceof TemplateError || error instanceof FileFetchError) {
      return NextResponse.json({ success: false, error: error.message }, { status: error.status });
    }
    log.error({ err: error }, 'template generation failed');
    return NextResponse.json({ success: false, error: 'Failed to generate document' }, { status: 500 });
  }
}
