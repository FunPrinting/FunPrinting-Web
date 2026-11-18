import 'server-only';
import crypto from 'crypto';

/**
 * Upload receipts: proof, signed by the server, of what was uploaded and how many
 * pages it has. /api/upload-file issues one per file; checkout accepts files only
 * with a valid receipt, so prices are based on server-counted pages and only files
 * stored by us can be printed.
 *
 * Format: base64url(JSON payload) + "." + base64url(HMAC-SHA256(payload)).
 * Key: NEXTAUTH_SECRET, domain-separated with a fixed prefix.
 */
export interface UploadReceipt {
  v: 1;
  url: string;
  name: string;
  mime: string;
  size: number;
  pages: number;
  estimated: boolean;
  uid: string; // user id that uploaded the file
  iat: number; // unix seconds
}

const MAX_AGE_SECONDS = 24 * 60 * 60;
const DOMAIN = 'funprinting:upload-receipt:v1:';

function key(): string {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) throw new Error('NEXTAUTH_SECRET is not set; cannot sign upload receipts');
  return DOMAIN + secret;
}

function mac(payload: string): string {
  return crypto.createHmac('sha256', key()).update(payload).digest('base64url');
}

export function signUploadReceipt(data: Omit<UploadReceipt, 'v' | 'iat'>, now = Date.now()): string {
  const payload = Buffer.from(JSON.stringify({ v: 1, ...data, iat: Math.floor(now / 1000) })).toString('base64url');
  return `${payload}.${mac(payload)}`;
}

export type ReceiptCheck = { ok: true; receipt: UploadReceipt } | { ok: false; error: string };

export function verifyUploadReceipt(token: unknown, userId: string, now = Date.now()): ReceiptCheck {
  if (typeof token !== 'string' || token.length > 4096) return { ok: false, error: 'Invalid upload receipt' };
  const [payload, signature, extra] = token.split('.');
  if (!payload || !signature || extra !== undefined) return { ok: false, error: 'Invalid upload receipt' };

  const expected = Buffer.from(mac(payload));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) {
    return { ok: false, error: 'Upload receipt signature is invalid' };
  }

  let receipt: UploadReceipt;
  try {
    receipt = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return { ok: false, error: 'Invalid upload receipt' };
  }
  if (receipt.v !== 1 || typeof receipt.url !== 'string' || !Number.isInteger(receipt.pages) || receipt.pages < 1) {
    return { ok: false, error: 'Invalid upload receipt' };
  }
  if (receipt.uid !== userId) return { ok: false, error: 'Upload receipt belongs to another user' };
  const age = Math.floor(now / 1000) - receipt.iat;
  if (age < -300 || age > MAX_AGE_SECONDS) return { ok: false, error: 'Upload receipt has expired; please upload the file again' };
  return { ok: true, receipt };
}
