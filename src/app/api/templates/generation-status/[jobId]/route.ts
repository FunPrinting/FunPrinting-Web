import { NextRequest, NextResponse } from 'next/server';
import { jobStore } from '@/lib/jobStore';
import { getSessionUser } from '@/lib/authz';

/**
 * GET /api/templates/generation-status/[jobId]
 * Status of a template PDF conversion started by generate-fill-pdf. Jobs are kept
 * for an hour. A job is visible only to the user who started it.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(jobId || '')) {
    return NextResponse.json({ success: false, error: 'Invalid job ID' }, { status: 400 });
  }
  try {
    const job = await jobStore.get(jobId);
    if (!job) {
      return NextResponse.json({ success: false, status: 'failed', error: 'This job has expired. Please generate the document again.' }, { status: 404 });
    }
    if (job.userId) {
      const user = await getSessionUser().catch(() => null);
      if (!user || user.id !== job.userId) {
        return NextResponse.json({ success: false, error: 'Job not found' }, { status: 404 });
      }
    }

    let progress = 50;
    if (job.status === 'completed' && job.pdfUrl) progress = 100;
    else if (job.status === 'processing') progress = Math.round(50 + Math.min(((Date.now() - job.createdAt) / 60_000) * 40, 40));

    return NextResponse.json({ success: true, status: job.status, progress, pdfUrl: job.pdfUrl, wordUrl: job.wordUrl, error: job.error });
  } catch (error) {
    console.error('generation-status error:', error);
    return NextResponse.json({ success: false, status: 'failed', error: 'Job store is unavailable. Please check UPSTASH_REDIS environment variables.' }, { status: 503 });
  }
}
