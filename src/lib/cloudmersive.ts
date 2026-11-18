import 'server-only';

/** Cloudmersive conversion API (https://api.cloudmersive.com). Needs CLOUDMERSIVE_API_KEY. */

const BASE_URL = 'https://api.cloudmersive.com';
const TIMEOUT_MS = 60_000;

async function request(endpoint: string, input: Buffer): Promise<Buffer> {
  const apiKey = process.env.CLOUDMERSIVE_API_KEY;
  if (!apiKey) throw new Error('CLOUDMERSIVE_API_KEY not configured');
  const res = await fetch(`${BASE_URL}${endpoint}`, {
    method: 'POST',
    headers: { Apikey: apiKey, 'Content-Type': 'application/octet-stream' },
    body: new Uint8Array(input),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) {
    const detail = (await res.text().catch(() => '')).slice(0, 300);
    if (res.status === 401) throw new Error('Invalid Cloudmersive API key');
    if (res.status === 429) throw new Error('Cloudmersive API quota exceeded');
    throw new Error(`Cloudmersive API error ${res.status}${detail ? `: ${detail}` : ''}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

export async function convertPdfToDocx(pdf: Buffer): Promise<Buffer> {
  if (pdf.length < 100 || pdf.toString('ascii', 0, 4) !== '%PDF') throw new Error('File is not a valid PDF');
  try {
    return await request('/convert/pdf/to/docx', pdf);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/Unable to process input document|error 500/i.test(message)) {
      throw new Error('This PDF could not be converted. It may be password-protected, scanned (images only) or damaged.');
    }
    throw err;
  }
}

export function convertDocxToPdf(docx: Buffer): Promise<Buffer> {
  return request('/convert/docx/to/pdf', docx);
}
