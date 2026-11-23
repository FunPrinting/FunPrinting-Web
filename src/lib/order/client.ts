'use client';

/**
 * Browser I/O for the order page: counting pages and uploading files.
 * The server recounts every upload; these counts are only for the price preview.
 */
import { fileKind } from '@/lib/order/files';

export class PageCountError extends Error {}

function base64Of(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
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
    const res = await fetch('/api/parse-docx-structure', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ docxBuffer: base64Of(await file.arrayBuffer()) }),
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

/** Uploads one file with real progress (fetch can't report upload progress). */
export function uploadFile(
  file: File,
  onProgress: (fraction: number) => void,
  signal?: AbortSignal
): Promise<UploadResult> {
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
