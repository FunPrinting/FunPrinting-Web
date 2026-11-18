import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { checkTemplateAccess } from '@/lib/payments/templateAccess';
import { uploadFile } from '@/lib/storage';
import { withRequestLogger } from '@/lib/logger';
import { docxToPdf, ConversionError } from '@/lib/documents/convert';
import { FileFetchError } from '@/lib/documents/fileUrls';
import { loadTemplateDocx, replaceDocxPlaceholders, TemplateError } from '@/lib/documents/templates';
import { checkRateLimit, generationRateLimit, getClientIdentifier } from '@/lib/ratelimit';

export const runtime = 'nodejs';
export const maxDuration = 120;

/**
 * POST /api/templates/generate-custom { templateId, formData, paymentRef? }
 * Fills a custom template's {{placeholders}}, converts it to PDF and returns its URL.
 * Paid templates need a purchase (checkTemplateAccess), whose stored form data is used.
 */
export async function POST(request: NextRequest) {
  const limited = await checkRateLimit(generationRateLimit, getClientIdentifier(request));
  if (limited) return limited;
  const log = withRequestLogger(request);
  try {
    const body = await request.json().catch(() => ({}));
    const { templateId } = body;
    const access = await checkTemplateAccess(templateId, body.formData, body.paymentRef);
    if (access instanceof NextResponse) return access;
    const formData = body.formData === undefined ? undefined : access.formData;
    if (!templateId || !formData || typeof formData !== 'object') {
      return NextResponse.json({ success: false, error: 'Template ID and form data are required' }, { status: 400 });
    }

    const { template, docx } = await loadTemplateDocx(templateId);
    let filled: Buffer;
    try {
      filled = replaceDocxPlaceholders(docx, formData);
    } catch (err) {
      log.warn({ err, templateId }, 'placeholder replacement failed');
      return NextResponse.json({ success: false, error: 'This template could not be filled. Check the values and try again.' }, { status: 422 });
    }
    const { pdf, provider } = await docxToPdf(filled);
    const pdfUrl = await uploadFile(pdf, 'custom-documents', 'application/pdf');
    log.info({ templateId, provider }, 'custom document generated');

    return NextResponse.json({
      success: true,
      pdfUrl,
      orderData: {
        id: uuidv4(),
        templateId,
        templateName: template.name,
        customerData: formData,
        pdfUrl,
        status: 'ready_for_order',
        createdAt: new Date(),
        totalAmount: 0,
      },
      message: 'Custom document generated successfully',
    });
  } catch (error) {
    if (error instanceof TemplateError || error instanceof FileFetchError) {
      return NextResponse.json({ success: false, error: error.message }, { status: error.status });
    }
    if (error instanceof ConversionError) {
      log.error({ attempts: error.attempts }, 'custom document PDF conversion failed');
      return NextResponse.json({ success: false, error: 'Could not convert the document to PDF. Please try again later.' }, { status: 503 });
    }
    log.error({ err: error }, 'custom document generation failed');
    return NextResponse.json({ success: false, error: 'Failed to generate custom document' }, { status: 500 });
  }
}
