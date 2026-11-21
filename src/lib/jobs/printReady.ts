import 'server-only';
import connectDB from '@/lib/mongodb';
import PrintJob, { type IPrintJob, type JobFile } from '@/models/PrintJob';
import { logger } from '@/lib/logger';

/**
 * Partner apps print only PDFs (`printUrl`). New uploads get one at upload time
 * (src/app/api/upload-file). Jobs for orders placed before that, with Word files or
 * images, are prepared here: once after the job is created, and again by the jobs
 * sweep if that failed. A job is claimable only when every file has a printUrl.
 */

export function isPdf(mime?: string, name?: string, url?: string): boolean {
  if (mime) return mime === 'application/pdf';
  const ext = (s?: string) => s?.split(/[?#]/)[0].split('.').pop()?.toLowerCase();
  return ext(name) === 'pdf' || ext(url) === 'pdf';
}

export function isPrintReady(job: Pick<IPrintJob, 'files'>): boolean {
  return job.files.length > 0 && job.files.every((f) => Boolean(f.printUrl));
}

/** Mongo filter: jobs whose files all have a printUrl. */
export const PRINT_READY_FILTER = { files: { $not: { $elemMatch: { printUrl: { $in: [null, ''] } } } } } as const;

async function prepareFile(file: JobFile): Promise<{ printUrl: string; pages: number }> {
  const { fetchTrustedFile } = await import('@/lib/documents/fileUrls');
  const { toPrintReady } = await import('@/lib/uploads/printReady');
  const { uploadFile } = await import('@/lib/storage');
  const { buffer, contentType } = await fetchTrustedFile(file.url);
  const mime = file.mime || contentType?.split(';')[0] || '';
  const ready = await toPrintReady(buffer, mime, file.pageSize);
  const printUrl = ready.passthrough ? file.url : await uploadFile(ready.pdf, 'print-ready', 'application/pdf');
  return { printUrl, pages: ready.pages };
}

/**
 * Fills in printUrl for every file of the job that lacks one. Safe to call repeatedly
 * and concurrently: each file is written only if it still has no printUrl.
 * Returns true when the job is print-ready afterwards.
 */
export async function preparePrintFiles(jobId: string): Promise<boolean> {
  await connectDB();
  const job = await PrintJob.findOne({ jobId }).select('jobId files').lean<Pick<IPrintJob, 'jobId' | 'files'> | null>();
  if (!job) return false;
  let ready = true;
  for (let i = 0; i < job.files.length; i++) {
    const file = job.files[i];
    if (file.printUrl) continue;
    try {
      const { printUrl, pages } = await prepareFile(file);
      await PrintJob.updateOne(
        { jobId, [`files.${i}.url`]: file.url, [`files.${i}.printUrl`]: { $in: [null, ''] } },
        { $set: { [`files.${i}.printUrl`]: printUrl, [`files.${i}.pages`]: pages } }
      );
    } catch (err) {
      ready = false;
      logger.warn({ jobId, file: i, err: err instanceof Error ? err.message : err }, 'could not prepare file for printing');
    }
  }
  return ready;
}

/** Prepares a few not-ready jobs of one shop (called from the jobs list sweep). */
export async function prepareWaitingJobs(partnerId: string, limit = 3): Promise<void> {
  await connectDB();
  const waiting = await PrintJob.find({ partnerId, status: 'queued', 'files.printUrl': { $in: [null, ''] } })
    .select('jobId')
    .limit(limit)
    .lean<Array<{ jobId: string }>>();
  for (const j of waiting) await preparePrintFiles(j.jobId);
}
