'use client';

/** Saves a file under a friendly name; falls back to opening it if the browser blocks the copy. */
export async function downloadFile(url: string, fileName: string): Promise<void> {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(String(res.status));
    const href = URL.createObjectURL(await res.blob());
    const a = document.createElement('a');
    a.href = href;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(href);
  } catch {
    window.open(url, '_blank', 'noopener');
  }
}

export const safeFileName = (name: string) => name.replace(/[^\w\- ]/g, '').trim().replace(/\s+/g, '-') || 'document';
