import 'server-only';

/**
 * Free-tier DOCX → PDF services, used by src/lib/documents/convert.ts.
 *   ConvertAPI  CONVERTAPI_SECRET                         (250 / month free)
 *   iLovePDF    ILOVEPDF_PUBLIC_KEY + ILOVEPDF_SECRET_KEY  (250 / month free)
 *
 * Download addresses returned by these services are checked against the service's
 * own domain before the server fetches them.
 */

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const TIMEOUT_MS = 60_000;

function docxBlob(buf: Buffer) {
  return new Blob([new Uint8Array(buf)], { type: DOCX_MIME });
}

function hostIs(url: string, suffix: string) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && (u.hostname === suffix || u.hostname.endsWith(`.${suffix}`));
  } catch {
    return false;
  }
}

async function fail(res: Response, what: string): Promise<never> {
  const detail = (await res.text().catch(() => '')).slice(0, 300);
  throw new Error(`${what} failed: ${res.status}${detail ? ` – ${detail}` : ''}`);
}

export async function convertDocxToPdfViaConvertAPI(docx: Buffer): Promise<Buffer> {
  const secret = process.env.CONVERTAPI_SECRET;
  if (!secret) throw new Error('CONVERTAPI_SECRET is not configured');
  const form = new FormData();
  form.append('File', docxBlob(docx), 'document.docx');
  // Secret in a header, not the URL, so it doesn't end up in logs
  const res = await fetch('https://v2.convertapi.com/convert/docx/to/pdf', {
    method: 'POST',
    headers: { Authorization: `Bearer ${secret}` },
    body: form,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) await fail(res, 'ConvertAPI conversion');
  const result = await res.json();
  const file: { FileData?: string; Url?: string } | undefined = result?.Files?.[0];
  if (file?.FileData) return Buffer.from(file.FileData, 'base64');
  if (file?.Url && hostIs(file.Url, 'convertapi.com')) {
    const dl = await fetch(file.Url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!dl.ok) await fail(dl, 'ConvertAPI download');
    return Buffer.from(await dl.arrayBuffer());
  }
  throw new Error('ConvertAPI returned no usable file');
}

export async function convertDocxToPdfViaILovePDF(docx: Buffer): Promise<Buffer> {
  const publicKey = process.env.ILOVEPDF_PUBLIC_KEY;
  if (!publicKey || !process.env.ILOVEPDF_SECRET_KEY) throw new Error('ILOVEPDF_PUBLIC_KEY / ILOVEPDF_SECRET_KEY not configured');
  const API = 'https://api.ilovepdf.com/v1';
  const signal = AbortSignal.timeout(TIMEOUT_MS * 2);

  const auth = await fetch(`${API}/auth`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ public_key: publicKey }), signal });
  if (!auth.ok) await fail(auth, 'iLovePDF auth');
  const { token } = (await auth.json()) as { token: string };
  const headers = { Authorization: `Bearer ${token}` };

  const start = await fetch(`${API}/start/officepdf`, { headers, signal });
  if (!start.ok) await fail(start, 'iLovePDF start');
  const { server, task } = (await start.json()) as { server: string; task: string };
  // The task server must be one of iLovePDF's own hosts
  if (typeof server !== 'string' || !/^[a-z0-9-]+(\.[a-z0-9-]+)*\.ilovepdf\.com$/i.test(server)) throw new Error('iLovePDF returned an unexpected server');
  const base = `https://${server}/v1`;

  const form = new FormData();
  form.append('task', task);
  form.append('file', docxBlob(docx), 'document.docx');
  const upload = await fetch(`${base}/upload`, { method: 'POST', headers, body: form, signal });
  if (!upload.ok) await fail(upload, 'iLovePDF upload');
  const { server_filename } = (await upload.json()) as { server_filename: string };

  const processRes = await fetch(`${base}/process`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ task, tool: 'officepdf', files: [{ server_filename, filename: 'document.docx' }] }),
    signal,
  });
  if (!processRes.ok) await fail(processRes, 'iLovePDF process');

  const dl = await fetch(`${base}/download/${encodeURIComponent(task)}`, { headers, signal });
  if (!dl.ok) await fail(dl, 'iLovePDF download');
  return Buffer.from(await dl.arrayBuffer());
}
