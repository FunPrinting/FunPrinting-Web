import 'server-only';
import Docxtemplater from 'docxtemplater';
import PizZip from 'pizzip';
import connectDB from '@/lib/mongodb';
import DynamicTemplate from '@/models/DynamicTemplate';
import { fetchTrustedFile } from './fileUrls';

export const TEMPLATE_MAX_BYTES = 20 * 1024 * 1024;

export class TemplateError extends Error {
  constructor(
    message: string,
    readonly status = 400
  ) {
    super(message);
    this.name = 'TemplateError';
  }
}

/** The template and its Word file, read from the database and our storage. */
export async function loadTemplateDocx(templateId: unknown) {
  if (typeof templateId !== 'string' || !templateId || templateId.length > 100) throw new TemplateError('templateId is required');
  await connectDB();
  const template = await DynamicTemplate.findOne({ id: templateId }).lean<{ id: string; name: string; wordUrl?: string }>();
  if (!template) throw new TemplateError('Template not found', 404);
  if (!template.wordUrl) throw new TemplateError('This template has no Word file', 404);
  const { buffer } = await fetchTrustedFile(template.wordUrl, { maxBytes: TEMPLATE_MAX_BYTES });
  return { template, docx: buffer };
}

/**
 * Replaces {{placeholders}} with docxtemplater (custom templates). Values are
 * plain text; docxtemplater escapes them for the XML.
 */
export function replaceDocxPlaceholders(docx: Buffer, values: Record<string, unknown>): Buffer {
  const data: Record<string, string> = {};
  for (const [key, value] of Object.entries(values || {})) {
    if (typeof key === 'string' && key.length <= 200) data[key] = value == null ? '' : String(value).slice(0, 10_000);
  }
  const doc = new Docxtemplater(new PizZip(docx), { paragraphLoop: true, linebreaks: true, delimiters: { start: '{{', end: '}}' } });
  doc.render(data);
  return doc.getZip().generate({ type: 'nodebuffer', compression: 'DEFLATE' });
}
