import { NextRequest, NextResponse } from 'next/server';
import { fillDocxTemplate } from '@/lib/docxProcessor';
import { uploadFile } from '@/lib/storage';
import { convertDocxToPdfSync } from '@/lib/renderPdfService';
import { convertDocxToPdf as cloudmersiveDocxToPdf } from '@/lib/cloudmersive';
import {
  convertDocxToPdfViaConvertAPI,
  convertDocxToPdfViaILovePDF,
} from '@/lib/freeConverters';
import { convertDocxToPdf as libreOfficeDocxToPdf, isLibreOfficeAvailable } from '@/lib/libreoffice';
import { v4 as uuidv4 } from 'uuid';
import { jobStore } from '@/lib/jobStore';
import { generationRateLimit, getClientIdentifier, checkRateLimit } from '@/lib/ratelimit';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { checkTemplateAccess } from '@/lib/payments/templateAccess';

/**
 * Background PDF conversion — runs after the API response is sent
 * Updates job status in Redis when done
 */
async function convertToPdfInBackground(
  jobId: string,
  filledBuffer: Buffer,
  wordUrl: string
) {
  let pdfUrl: string | undefined;
  let status: 'completed' | 'failed' = 'completed';
  let error: string | undefined;

  // ── 1. Cloudmersive (primary, 800 total free) ────────────────────
  if (process.env.CLOUDMERSIVE_API_KEY) {
    console.log(`📄 [BG] Job ${jobId}: Converting to PDF via Cloudmersive...`);
    try {
      const pdfBuffer = await cloudmersiveDocxToPdf(filledBuffer);
      pdfUrl = await uploadFile(pdfBuffer, `filled-documents/${jobId}`, 'application/pdf');
      console.log(`✅ [BG] Job ${jobId}: PDF uploaded (Cloudmersive):`, pdfUrl);
    } catch (err) {
      console.error(`❌ [BG] Job ${jobId}: Cloudmersive failed:`, err);
    }
  }

  // ── 2. ConvertAPI (250 / month free) ────────────────────────────
  if (!pdfUrl && process.env.CONVERTAPI_SECRET) {
    console.log(`📄 [BG] Job ${jobId}: Falling back to ConvertAPI...`);
    try {
      const pdfBuffer = await convertDocxToPdfViaConvertAPI(filledBuffer);
      pdfUrl = await uploadFile(pdfBuffer, `filled-documents/${jobId}`, 'application/pdf');
      console.log(`✅ [BG] Job ${jobId}: PDF uploaded (ConvertAPI):`, pdfUrl);
    } catch (err) {
      console.error(`❌ [BG] Job ${jobId}: ConvertAPI failed:`, err);
    }
  }

  // ── 3. iLovePDF (250 / month free) ──────────────────────────────
  if (!pdfUrl && process.env.ILOVEPDF_PUBLIC_KEY && process.env.ILOVEPDF_SECRET_KEY) {
    console.log(`📄 [BG] Job ${jobId}: Falling back to iLovePDF...`);
    try {
      const pdfBuffer = await convertDocxToPdfViaILovePDF(filledBuffer);
      pdfUrl = await uploadFile(pdfBuffer, `filled-documents/${jobId}`, 'application/pdf');
      console.log(`✅ [BG] Job ${jobId}: PDF uploaded (iLovePDF):`, pdfUrl);
    } catch (err) {
      console.error(`❌ [BG] Job ${jobId}: iLovePDF failed:`, err);
    }
  }

  // ── 4. LibreOffice CLI (self-hosted, free) ───────────────────────
  if (!pdfUrl) {
    const hasLibreOffice = await isLibreOfficeAvailable();
    if (hasLibreOffice) {
      console.log(`📄 [BG] Job ${jobId}: Falling back to LibreOffice CLI...`);
      try {
        const pdfBuffer = await libreOfficeDocxToPdf(filledBuffer);
        pdfUrl = await uploadFile(pdfBuffer, `filled-documents/${jobId}`, 'application/pdf');
        console.log(`✅ [BG] Job ${jobId}: PDF uploaded (LibreOffice CLI):`, pdfUrl);
      } catch (err) {
        console.error(`❌ [BG] Job ${jobId}: LibreOffice CLI failed:`, err);
      }
    }
  }

  // ── 5. Fly.io render service (paid, last resort) ─────────────────
  if (!pdfUrl) {
    console.log(`📄 [BG] Job ${jobId}: Falling back to Fly.io (last resort)...`);
    try {
      const conversionResult = await convertDocxToPdfSync(wordUrl, 60000, 3);
      if (conversionResult.success && conversionResult.pdfBuffer) {
        const pdfBuffer = Buffer.from(conversionResult.pdfBuffer, 'base64');
        pdfUrl = await uploadFile(pdfBuffer, `filled-documents/${jobId}`, 'application/pdf');
        console.log(`✅ [BG] Job ${jobId}: PDF uploaded (Fly.io):`, pdfUrl);
      } else {
        status = 'failed';
        error = conversionResult.error || 'All PDF conversion methods failed';
      }
    } catch (flyError) {
      status = 'failed';
      error = flyError instanceof Error ? flyError.message : 'Fly.io fallback failed';
      console.error(`❌ [BG] Job ${jobId}: Fly.io also failed:`, flyError);
    }
  }

  // Update job in Redis with final status
  const existingJob = await jobStore.get(jobId);
  await jobStore.set(jobId, {
    jobId,
    wordUrl,
    pdfUrl,
    status: pdfUrl ? 'completed' : status,
    error: pdfUrl ? undefined : error,
    createdAt: existingJob?.createdAt || Date.now(),
  });

  console.log(`✅ [BG] Job ${jobId}: Final status = ${pdfUrl ? 'completed' : status}`);
}

/**
 * Generate filled Word document and kick off async PDF conversion
 * Returns immediately with jobId — client polls generation-status for updates
 */
export async function POST(request: NextRequest) {
  // Rate limit check
  const clientId = getClientIdentifier(request);
  const rateLimitResponse = await checkRateLimit(generationRateLimit, clientId);
  if (rateLimitResponse) return rateLimitResponse;

  // Authentication check — only signed-in users can generate documents
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json(
      { success: false, error: 'Authentication required. Please sign in to generate documents.' },
      { status: 401 }
    );
  }

  try {
    console.log('📝 Template fill with PDF conversion request received');

    const body = await request.json();
    const { templateId, paymentRef } = body;
    const access = await checkTemplateAccess(templateId, body.formData, paymentRef);
    if (access instanceof NextResponse) return access;
    const formData = access.formData;

    console.log('[GENERATE-FILL] Received formData keys:', Object.keys(formData || {}));

    if (!templateId || !formData) {
      return NextResponse.json(
        { success: false, error: 'templateId and formData are required' },
        { status: 400 }
      );
    }

    // Generate unique job ID
    const jobId = uuidv4();

    // Step 1: Generate Word document
    console.log('📄 Step 1: Generating Word document...');

    // Fetch template details
    const origin = new URL(request.url).origin;
    const templateUrl = `${origin}/api/admin/save-template?id=${encodeURIComponent(templateId)}`;

    const templateRes = await fetch(templateUrl);
    if (!templateRes.ok) {
      return NextResponse.json(
        { success: false, error: 'Failed to fetch template details' },
        { status: templateRes.status === 404 ? 404 : 500 }
      );
    }

    const templateJson = await templateRes.json();
    if (!templateJson.success || !templateJson.data?.template?.wordUrl) {
      return NextResponse.json(
        { success: false, error: 'Template or wordUrl not found' },
        { status: 404 }
      );
    }

    const template = templateJson.data.template as { name: string; wordUrl: string; formSchema?: any[]; placeholders?: string[] };
    console.log(`✅ Template found: ${template.name}`);

    // Fetch the DOCX file
    const sourceRes = await fetch(template.wordUrl);
    if (!sourceRes.ok) {
      return NextResponse.json(
        { success: false, error: 'Failed to fetch source DOCX' },
        { status: sourceRes.status === 404 ? 404 : 500 }
      );
    }

    const sourceBuffer = Buffer.from(await sourceRes.arrayBuffer());
    console.log(`✅ DOCX file fetched: ${sourceBuffer.length} bytes`);

    // Fill the DOCX with form data
    console.log('🔄 Filling DOCX template with form data...');
    const filledBuffer = await fillDocxTemplate(sourceBuffer, formData);
    console.log(`✅ DOCX template filled: ${filledBuffer.length} bytes`);

    // Upload filled Word document to cloud storage
    console.log('☁️ Uploading filled Word document to storage...');
    const wordUrl = await uploadFile(
      filledBuffer,
      `filled-documents/${jobId}`,
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    );
    console.log('✅ Filled Word document uploaded:', wordUrl);

    // Store job in Redis as 'processing' BEFORE starting PDF conversion
    await jobStore.set(jobId, {
      jobId,
      wordUrl,
      status: 'processing',
      createdAt: Date.now(),
    });
    console.log(`✅ Job stored in Redis: ${jobId}, status: processing`);

    // Step 2: Kick off PDF conversion in the background (fire-and-forget)
    // This runs after the response is sent — client polls generation-status for updates
    convertToPdfInBackground(jobId, filledBuffer, wordUrl).catch((err) => {
      console.error(`❌ [BG] Unhandled error in background PDF conversion for job ${jobId}:`, err);
    });

    // Return immediately with jobId — client will poll for status
    // Include templateName so the client can use it for download filenames
    return NextResponse.json({
      success: true,
      jobId,
      wordUrl,
      templateName: template.name,
      status: 'processing',
      message: 'Document generated. PDF conversion in progress...',
    });

  } catch (error) {
    console.error('❌ Error generating document:', error);

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to generate document'
      },
      { status: 500 }
    );
  }
}
