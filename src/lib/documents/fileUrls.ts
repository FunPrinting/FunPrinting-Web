import 'server-only';

/**
 * The only way the server downloads a stored file (order files, template DOCX/PDF).
 *
 * Every URL a user can influence (request bodies, query strings, database fields
 * written from request bodies) goes through here, so the server can't be made to
 * fetch internal addresses or other sites (SSRF):
 * - https only, default port, no credentials in the URL;
 * - the host must be our file storage: Cloudinary under our cloud name, or our
 *   Oracle Object Storage region; extra hosts can be added in FILE_URL_HOSTS;
 * - redirects are followed only to allowed hosts (at most 3);
 * - the body is capped (default 50 MB) and the request times out.
 */

export const MAX_FILE_BYTES = 50 * 1024 * 1024;
const MAX_REDIRECTS = 3;
const TIMEOUT_MS = 30_000;

export class FileFetchError extends Error {
  constructor(
    message: string,
    readonly status = 400
  ) {
    super(message);
    this.name = 'FileFetchError';
  }
}

type Rule = { host: string; path?: (pathname: string) => boolean };

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, (c) => `\\${c}`);

function rules(): Rule[] {
  const out: Rule[] = [];
  const cloud = process.env.CLOUDINARY_CLOUD_NAME?.trim();
  if (cloud) out.push({ host: 'res.cloudinary.com', path: (p) => p.startsWith(`/${cloud}/`) });
  // Oracle: pre-authenticated (/p/<token>/n/…) or direct (/n/…) URLs in our bucket
  const region = process.env.OCI_REGION?.trim();
  const namespace = process.env.OCI_NAMESPACE?.trim();
  const bucket = process.env.OCI_BUCKET_NAME?.trim();
  if (region && namespace && bucket) {
    const re = new RegExp(`^(/p/[^/]+)?/n/${escapeRe(namespace)}/b/${escapeRe(bucket)}/o/`);
    out.push({ host: `objectstorage.${region}.oraclecloud.com`, path: (p) => re.test(p) });
  }
  // Extra entries: "host" or "host/path-prefix"
  for (const entry of (process.env.FILE_URL_HOSTS || '').split(',').map((s) => s.trim()).filter(Boolean)) {
    const [host, ...rest] = entry.split('/');
    const prefix = rest.length ? `/${rest.join('/')}/` : null;
    out.push({ host: host.toLowerCase(), path: prefix ? (p) => p.startsWith(prefix) : undefined });
  }
  return out;
}

/** True when the server may download this URL. */
export function isTrustedFileUrl(raw: unknown): raw is string {
  if (typeof raw !== 'string' || raw.length > 2048) return false;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' || url.port || url.username || url.password) return false;
  const host = url.hostname.toLowerCase();
  // Reject encoded dots/slashes that could change the path after the check
  if (/%2e|%2f|%5c/i.test(url.pathname)) return false;
  return rules().some((r) => r.host === host && (!r.path || r.path(url.pathname)));
}

/** Throws FileFetchError(400) unless the URL is trusted. */
export function assertTrustedFileUrl(raw: unknown, what = 'File URL'): string {
  if (!isTrustedFileUrl(raw)) throw new FileFetchError(`${what} is not a FunPrinting file`);
  return raw;
}

async function readCapped(res: Response, maxBytes: number): Promise<Buffer> {
  const declared = Number(res.headers.get('content-length') || 0);
  if (declared > maxBytes) throw new FileFetchError('File is too large', 413);
  if (!res.body) return Buffer.alloc(0);
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new FileFetchError('File is too large', 413);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks, total);
}

/**
 * Downloads a stored file. Errors are FileFetchError with an HTTP status to return
 * (400 untrusted URL, 413 too large, 502 storage error).
 */
export async function fetchTrustedFile(
  raw: unknown,
  { maxBytes = MAX_FILE_BYTES, timeoutMs = TIMEOUT_MS }: { maxBytes?: number; timeoutMs?: number } = {}
): Promise<{ buffer: Buffer; contentType: string | null }> {
  let url = assertTrustedFileUrl(raw);
  const signal = AbortSignal.timeout(timeoutMs);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    let res: Response;
    try {
      res = await fetch(url, { redirect: 'manual', signal, headers: { Accept: '*/*' } });
    } catch (err) {
      throw new FileFetchError(err instanceof Error && err.name === 'TimeoutError' ? 'File download timed out' : 'Could not download the file', 502);
    }
    if (res.status >= 300 && res.status < 400) {
      const next = res.headers.get('location');
      await res.body?.cancel().catch(() => undefined);
      if (!next) throw new FileFetchError('Could not download the file', 502);
      url = assertTrustedFileUrl(new URL(next, url).toString(), 'Redirect target');
      continue;
    }
    if (!res.ok) {
      await res.body?.cancel().catch(() => undefined);
      throw new FileFetchError(res.status === 404 ? 'File not found' : 'Could not download the file', res.status === 404 ? 404 : 502);
    }
    return { buffer: await readCapped(res, maxBytes), contentType: res.headers.get('content-type') };
  }
  throw new FileFetchError('Too many redirects', 502);
}

/** Decodes a base64 upload in a JSON body, refusing anything over maxBytes. */
export function decodeBase64File(value: unknown, maxBytes = MAX_FILE_BYTES): Buffer {
  if (typeof value !== 'string' || !value) throw new FileFetchError('File is required');
  // 4 base64 characters carry 3 bytes
  if (Math.floor((value.length * 3) / 4) > maxBytes + 3) throw new FileFetchError('File is too large', 413);
  const buffer = Buffer.from(value.replace(/^data:[^;]+;base64,/, ''), 'base64');
  if (!buffer.length) throw new FileFetchError('File is empty');
  if (buffer.length > maxBytes) throw new FileFetchError('File is too large', 413);
  return buffer;
}
