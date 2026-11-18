'use client';

/**
 * The details a customer filled in, kept in this tab (sessionStorage) while they sign
 * in or pay, so the result page can create the document afterwards. It is removed
 * only once the document exists, so a refresh or a retry still works.
 */
const KEY = 'pendingTemplateFormData';

export interface PendingGeneration {
  templateId: string;
  formData: Record<string, string>;
  /** Set after a paid template's payment; the server checks it before creating anything. */
  paymentRef?: string;
}

export function savePending(p: PendingGeneration): void {
  sessionStorage.setItem(KEY, JSON.stringify(p));
}

export function readPending(templateId: string): PendingGeneration | null {
  try {
    const p = JSON.parse(sessionStorage.getItem(KEY) || 'null') as PendingGeneration | null;
    return p && p.templateId === templateId && p.formData && typeof p.formData === 'object' ? p : null;
  } catch {
    return null;
  }
}

export function clearPending(): void {
  sessionStorage.removeItem(KEY);
}

/** Hands the finished document to the order page (it reads this once, then removes it). */
export function handToOrderPage(doc: { templateId: string; templateName?: string; pdfUrl?: string; wordUrl?: string }): void {
  sessionStorage.setItem('pendingTemplateDocument', JSON.stringify({ ...doc, isTemplateDocument: true }));
}
