'use client';

/**
 * Browser I/O for the order page: counting pages and uploading files.
 * The server recounts every upload; these counts are only for the price preview.
 *
 * When Cloudflare R2 presigned uploads are active, files upload directly from the
 * browser to R2 (bypassing Vercel's 4.5 MB request-body limit, supporting up to 50 MB).
 */
import { fileKind } from '@/lib/order/files';

export class PageCountError extends Error {}

function base64Of(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

function putFileWithProgress(
  uploadUrl: string,
  file: File,
  contentType: string,
  onProgress?: (fraction: number) => void,
  signal?: AbortSignal
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      return reject(new DOMException('Upload aborted', 'AbortError'));
    }
    const xhr = new XMLHttpRequest();
    const onAbort = () => {
      xhr.abort();
      reject(new DOMException('Upload aborted', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });

    xhr.open('PUT', uploadUrl);
    xhr.setRequestHeader('Content-Type', contentType);
    if (onProgress) {
      xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    }
    xhr.onerror = () => {
      signal?.removeEventListener('abort', onAbort);
      reject(new Error('Direct upload to storage failed. Check your connection and R2 CORS settings.'));
    };
    xhr.ontimeout = () => {
      signal?.removeEventListener('abort', onAbort);
      reject(new Error('The upload took too long. Check your connection and try again.'));
    };
    xhr.onload = () => {
      signal?.removeEventListener('abort', onAbort);
      if (xhr.status >= 200 && xhr.status < 300) return resolve();
      reject(new Error(`Storage upload failed (${xhr.status})`));
    };
    xhr.send(file);
  });
}

async function requestPresignedUpload(file: File, purpose: 'order' | 'template' | 'preview') {
  const res = await fetch('/api/upload-presign', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fileName: file.name,
      contentType: file.type,
      fileSize: file.size,
      purpose,
    }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(data?.error || `Upload preparation failed (${res.status})`);
  }
  return data as { supported: boolean; uploadUrl?: string; fileUrl?: string; contentType?: string };
}

/** Page count for the preview. Images are one page. */
export async function countPages(file: File): Promise<{ pages: number; estimated: boolean }> {
  const kind = fileKind(file);
  if (kind === 'pdf') {
    // Counted locally: fast, and works for guests. The upload recounts on the server.
    try {
      const { PDFDocument } = await import('pdf-lib');
      const doc = await PDFDocument.load(await file.arrayBuffer(), { ignoreEncryption: true });
      return { pages: Math.max(1, doc.getPageCount()), estimated: false };
    } catch {
      throw new PageCountError(`We couldn’t read “${file.name}”. It may be damaged or password-protected.`);
    }
  }
  if (kind === 'word') {
    let payload: Record<string, string> | null = null;
    try {
      const presign = await requestPresignedUpload(file, 'preview');
      if (presign?.supported && presign.uploadUrl && presign.fileUrl) {
        await putFileWithProgress(presign.uploadUrl, file, presign.contentType || 'application/octet-stream');
        payload = { fileUrl: presign.fileUrl };
      }
    } catch {
      // Fall back to base64 when file fits inside request limits
    }
    if (!payload) {
      payload = { docxBuffer: base64Of(await file.arrayBuffer()) };
    }
    const res = await fetch('/api/parse-docx-structure', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).catch(() => null);
    const data = res ? await res.json().catch(() => null) : null;
    if (!res?.ok || !data?.success || !data.totalPages) {
      throw new PageCountError(`We couldn’t count the pages of “${file.name}”. Save it as a PDF and try again.`);
    }
    return { pages: data.totalPages, estimated: Boolean(data.estimated) };
  }
  if (kind === 'image') return { pages: 1, estimated: false };
  throw new PageCountError(`“${file.name}” isn’t a supported file. Use PDF, Word or an image.`);
}

export interface UploadResult {
  receipt: string;
  pageCount?: number;
}

/** Uploads one file with real progress (uses direct R2 presigned PUT when configured). */
export async function uploadFile(
  file: File,
  onProgress: (fraction: number) => void,
  signal?: AbortSignal
): Promise<UploadResult> {
  if (signal?.aborted) {
    throw new DOMException('Upload aborted', 'AbortError');
  }

  // 1. Try direct browser-to-R2 presigned upload (bypasses Vercel 4.5 MB payload limit)
  const presignRes = await fetch('/api/upload-presign', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fileName: file.name,
      contentType: file.type,
      fileSize: file.size,
      purpose: 'order',
    }),
    signal,
  });

  if (presignRes.status === 401) throw new Error('Please sign in again to upload.');
  if (presignRes.status === 413) throw new Error(`“${file.name}” is too large. The limit is 50 MB.`);
  const presignData = await presignRes.json().catch(() => null);
  if (!presignRes.ok) {
    throw new Error(presignData?.error || `Upload failed (${presignRes.status})`);
  }

  if (presignData?.supported && presignData.uploadUrl && presignData.fileUrl) {
    await putFileWithProgress(
      presignData.uploadUrl,
      file,
      presignData.contentType || file.type || 'application/octet-stream',
      (p) => onProgress(p * 0.9),
      signal
    );

    const finRes = await fetch('/api/upload-finalize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fileUrl: presignData.fileUrl,
        fileName: file.name,
        fileType: presignData.contentType || file.type,
      }),
      signal,
    });
    const finData = await finRes.json().catch(() => null);
    if (finRes.status === 401) throw new Error('Please sign in again to upload.');
    if (finRes.status === 413) throw new Error(`“${file.name}” is too large. The limit is 50 MB.`);
    if (!finRes.ok || !finData?.success || !finData?.receipt) {
      throw new Error(finData?.error || (finRes.status >= 500 ? 'Server error while processing upload. Please try again.' : `Upload failed (${finRes.status})`));
    }
    onProgress(1);
    return { receipt: finData.receipt, pageCount: finData.pageCount };
  }

  // 2. Fallback to legacy multipart upload (when R2 is not configured)
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      return reject(new DOMException('Upload aborted', 'AbortError'));
    }

    const xhr = new XMLHttpRequest();
    const onAbort = () => {
      xhr.abort();
      reject(new DOMException('Upload aborted', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });

    xhr.open('POST', '/api/upload-file');
    xhr.responseType = 'json';
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onerror = () => {
      signal?.removeEventListener('abort', onAbort);
      reject(new Error('The upload failed. Check your connection and try again.'));
    };
    xhr.ontimeout = () => {
      signal?.removeEventListener('abort', onAbort);
      reject(new Error('The upload took too long. Check your connection and try again.'));
    };
    xhr.onload = () => {
      signal?.removeEventListener('abort', onAbort);
      const data = xhr.response as { success?: boolean; error?: string; receipt?: string; pageCount?: number } | null;
      if (xhr.status >= 200 && xhr.status < 300 && data?.success && data.receipt) {
        return resolve({ receipt: data.receipt, pageCount: data.pageCount });
      }
      if (xhr.status === 413) return reject(new Error(`“${file.name}” is too large. The limit is 50 MB.`));
      if (xhr.status === 401) return reject(new Error('Please sign in again to upload.'));
      reject(new Error(data?.error || (xhr.status >= 500 ? 'Server error while uploading. Please try again.' : `Upload failed (${xhr.status})`)));
    };
    const body = new FormData();
    body.append('file', file);
    xhr.send(body);
  });
}
