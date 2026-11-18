/**
 * Pure helpers for error tracking: remove personal data and secrets, and compute a
 * stable fingerprint so repeats of the same bug group into one record.
 *
 * Safe to import from both server and client code (no Node-only APIs).
 */

export const LIMITS = {
  message: 1000,
  stack: 8000,
  url: 500,
  userAgent: 300,
  contextValue: 500,
  contextKeys: 20,
} as const;

const REPLACEMENTS: Array<[RegExp, string]> = [
  // Credentials first, so later patterns don't partially mangle them
  [/\beyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]{8,}\b/g, '[jwt]'],
  [/\b(Bearer|Basic)\s+[\w\-.~+/=]{8,}/gi, '$1 [token]'],
  [/\b(rzp_(?:live|test)_)[A-Za-z0-9]+/g, '$1[key]'],
  [/\bmongodb(\+srv)?:\/\/[^\s'"]+/gi, 'mongodb$1://[redacted]'],
  [/\b(password|passwd|pwd|secret|token|otp|api[_-]?key)(["']?\s*[:=]\s*["']?)[^\s"',&}]+/gi, '$1$2[redacted]'],
  // Personal data
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[email]'],
  [/(?<![\w/.-])\+?\d[\d\s-]{8,}\d(?![\w/.-])/g, '[phone]'],
];

/** Removes emails, phone numbers, tokens and keys from free text. */
export function scrubText(input: unknown, maxLength: number = LIMITS.message): string {
  let text = typeof input === 'string' ? input : input == null ? '' : String(input);
  if (text.length > maxLength * 2) text = text.slice(0, maxLength * 2); // bound regex work
  for (const [pattern, replacement] of REPLACEMENTS) text = text.replace(pattern, replacement);
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

/** Keeps origin and path; drops the query string and hash, which often hold tokens. */
export function scrubUrl(input: unknown): string | undefined {
  if (typeof input !== 'string' || !input) return undefined;
  const withoutQuery = input.split(/[?#]/)[0];
  return scrubText(withoutQuery, LIMITS.url);
}

/** Shallow copy of a context object with scrubbed, size-limited values. */
export function scrubContext(context: unknown): Record<string, string | number | boolean | null> | undefined {
  if (!context || typeof context !== 'object' || Array.isArray(context)) return undefined;
  const out: Record<string, string | number | boolean | null> = {};
  const sensitiveKey = /pass|secret|token|otp|cookie|authorization|email|phone|address|customerinfo/i;
  for (const [key, value] of Object.entries(context as Record<string, unknown>).slice(0, LIMITS.contextKeys)) {
    if (sensitiveKey.test(key)) {
      out[key] = '[redacted]';
    } else if (value === null || typeof value === 'number' || typeof value === 'boolean') {
      out[key] = value;
    } else if (typeof value === 'string') {
      out[key] = scrubText(value, LIMITS.contextValue);
    } else {
      let json: string;
      try {
        json = JSON.stringify(value) ?? String(value);
      } catch {
        json = '[unserializable]';
      }
      out[key] = scrubText(json, LIMITS.contextValue);
    }
  }
  return out;
}

/**
 * Replaces the variable parts of a message (ids, numbers, quoted values, urls) so
 * "Order ORD123 not found" and "Order ORD456 not found" share one fingerprint.
 */
export function normalizeForFingerprint(message: string): string {
  return message
    .replace(/https?:\/\/[^\s'"]+/g, '<url>')
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '<uuid>')
    .replace(/\b[0-9a-f]{24}\b/gi, '<objectid>')
    .replace(/\b(ORD|pay|order|plink|acc|evt|rfnd)_?[A-Za-z0-9]{4,}\b/g, '$1<id>')
    .replace(/(["'`])(?:(?!\1).){1,200}\1/g, '$1<v>$1')
    .replace(/\d+(\.\d+)?/g, '<n>') // also digits inside words, e.g. ORD123 → ORD<n>
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300);
}

/**
 * First stack frame that belongs to the app (not node_modules or Node internals),
 * without line/column numbers so a rebuild doesn't split the group.
 */
export function topAppFrame(stack: string | undefined): string {
  if (!stack) return '';
  for (const raw of stack.split('\n').slice(1, 30)) {
    const line = raw.trim();
    if (!line.startsWith('at ') && !line.includes('@')) continue;
    if (/node_modules|node:internal|\(native\)|<anonymous>/.test(line)) continue;
    return line
      .replace(/:\d+:\d+\)?$/, '')
      .replace(/\?[^\s)]*/g, '')
      .replace(/https?:\/\/[^/]+/, '')
      .replace(/\b[0-9a-f]{8,}\b/gi, '<hash>') // chunk hashes in client bundles
      .slice(0, 200);
  }
  return '';
}

/** djb2-style 32-bit hash pair → 16 hex chars. Fast, deterministic, no crypto needed. */
function hash(input: string): string {
  let h1 = 5381;
  let h2 = 52711;
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    h1 = (h1 * 33) ^ c;
    h2 = (h2 * 33) ^ c;
  }
  return ((h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0'));
}

export function computeFingerprint(parts: {
  source: string;
  name?: string;
  message: string;
  stack?: string;
  route?: string;
}): string {
  const frame = topAppFrame(parts.stack);
  return hash(
    [
      parts.source,
      parts.name || 'Error',
      normalizeForFingerprint(parts.message),
      // Without a usable stack frame the route keeps unrelated errors apart
      frame || parts.route || '',
    ].join('|')
  );
}
