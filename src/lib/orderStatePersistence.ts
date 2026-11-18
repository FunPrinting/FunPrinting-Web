'use client';

/**
 * Keeps the order page's files and choices across the Google sign-in redirect.
 * Saved in sessionStorage (this tab only) for up to 30 minutes.
 */
import type { PrintOptions } from '@/lib/order/files';

const STORAGE_KEY = 'fp_order_draft';
const MAX_AGE_MS = 30 * 60_000;
/** sessionStorage holds about 5 MB; base64 adds a third. */
const MAX_TOTAL_BYTES = 3 * 1024 * 1024;

export interface DraftFile extends PrintOptions {
  name: string;
  type: string;
  pages: number;
  estimatedPages?: boolean;
  data: string; // base64
}

export interface OrderDraft<D> {
  files: DraftFile[];
  delivery: D;
  savedAt: number;
}

function toBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function fromBase64(f: DraftFile): File {
  const bin = atob(f.data);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new File([bytes], f.name, { type: f.type });
}

/** Returns false if the files are too large to keep (the customer re-adds them after signing in). */
export async function saveOrderDraft<D>(files: Array<PrintOptions & { file: File; pages: number; estimatedPages?: boolean }>, delivery: D): Promise<boolean> {
  if (files.reduce((n, f) => n + f.file.size, 0) > MAX_TOTAL_BYTES) return false;
  try {
    const saved: DraftFile[] = await Promise.all(
      files.map(async ({ file, pageSize, color, sided, copies, colorInput, finishing, pages, estimatedPages }) => ({
        name: file.name,
        type: file.type,
        pageSize,
        color,
        sided,
        copies,
        colorInput,
        finishing,
        pages,
        estimatedPages,
        data: await toBase64(file),
      }))
    );
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ files: saved, delivery, savedAt: Date.now() } satisfies OrderDraft<D>));
    return true;
  } catch {
    return false;
  }
}

/** Reads and removes the saved draft. */
export function takeOrderDraft<D>(): { files: Array<Omit<DraftFile, 'data' | 'name' | 'type'> & { file: File }>; delivery: D } | null {
  const raw = sessionStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  sessionStorage.removeItem(STORAGE_KEY);
  try {
    const draft = JSON.parse(raw) as OrderDraft<D>;
    if (!draft.savedAt || Date.now() - draft.savedAt > MAX_AGE_MS) return null;
    return {
      delivery: draft.delivery,
      files: draft.files.map(({ data, name, type, ...options }) => ({ ...options, file: fromBase64({ data, name, type, ...options }) })),
    };
  } catch {
    return null;
  }
}
