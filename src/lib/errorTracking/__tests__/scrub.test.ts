import { describe, expect, it } from 'vitest';
import {
  computeFingerprint,
  normalizeForFingerprint,
  scrubContext,
  scrubText,
  scrubUrl,
  topAppFrame,
} from '@/lib/errorTracking/scrub';

describe('scrubText', () => {
  it('removes emails, phone numbers, tokens and keys', () => {
    const input =
      'user a.b+c@example.co.in phone +91 98765 43210 Bearer abcdefghijklmnop key rzp_live_AbC123xyz ' +
      'mongodb+srv://u:p@cluster0.x.mongodb.net/db password=hunter2 eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.c2lnbmF0dXJlLXZhbHVl';
    const out = scrubText(input, 2000);
    expect(out).not.toMatch(/example\.co\.in|98765|abcdefghijklmnop|AbC123xyz|cluster0|hunter2|eyJhbGci/);
    expect(out).toContain('[email]');
    expect(out).toContain('[phone]');
    expect(out).toContain('Bearer [token]');
    expect(out).toContain('rzp_live_[key]');
    expect(out).toContain('mongodb+srv://[redacted]');
    expect(out).toContain('password=[redacted]');
    expect(out).toContain('[jwt]');
  });

  it('keeps ordinary numbers, ids and paths readable', () => {
    expect(scrubText('Order ORD123456 failed after 3 retries at /api/orders/42')).toBe(
      'Order ORD123456 failed after 3 retries at /api/orders/42'
    );
  });

  it('truncates long text', () => {
    const out = scrubText('x'.repeat(5000), 100);
    expect(out.length).toBe(100);
    expect(out.endsWith('…')).toBe(true);
  });
});

describe('scrubUrl and scrubContext', () => {
  it('drops query strings and hashes', () => {
    expect(scrubUrl('https://www.funprinting.store/payment/return?razorpay_signature=abc#x')).toBe(
      'https://www.funprinting.store/payment/return'
    );
    expect(scrubUrl(undefined)).toBeUndefined();
  });

  it('redacts sensitive keys and bounds values', () => {
    const out = scrubContext({
      orderId: 'ORD1',
      customerInfo: { email: 'a@b.com' },
      authorization: 'Bearer x',
      count: 3,
      nested: { deep: 'note from a@b.com' },
    });
    expect(out).toEqual({
      orderId: 'ORD1',
      customerInfo: '[redacted]',
      authorization: '[redacted]',
      count: 3,
      nested: '{"deep":"note from [email]"}',
    });
    expect(scrubContext('not an object')).toBeUndefined();
  });
});

describe('fingerprinting', () => {
  const stack = (file: string, line: number) =>
    `Error: boom\n    at handler (/app/node_modules/next/dist/server.js:1:1)\n    at createOrder (${file}:${line}:17)\n    at next (node:internal/process:1:1)`;

  it('groups messages that differ only in ids and numbers', () => {
    expect(normalizeForFingerprint('Order ORD123456 not found (attempt 3)')).toBe(
      normalizeForFingerprint('Order ORD999999 not found (attempt 7)')
    );
    expect(normalizeForFingerprint('Partner 64b7f0c2a1e4d5f6a7b8c9d0 offline')).toBe('Partner <objectid> offline');
  });

  it('uses the first app frame without line numbers', () => {
    expect(topAppFrame(stack('/app/src/lib/orders.ts', 10))).toBe('at createOrder (/app/src/lib/orders.ts');
  });

  it('is stable across line changes and different ids', () => {
    const a = computeFingerprint({ source: 'server', name: 'Error', message: 'Order ORD1 failed', stack: stack('/app/src/lib/orders.ts', 10) });
    const b = computeFingerprint({ source: 'server', name: 'Error', message: 'Order ORD2 failed', stack: stack('/app/src/lib/orders.ts', 99) });
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{16}$/);
  });

  it('separates different sources, names, code locations and routes', () => {
    const base = { source: 'server', name: 'Error', message: 'boom' };
    const fp = computeFingerprint(base);
    expect(computeFingerprint({ ...base, source: 'client' })).not.toBe(fp);
    expect(computeFingerprint({ ...base, name: 'TypeError' })).not.toBe(fp);
    expect(computeFingerprint({ ...base, stack: stack('/app/src/a.ts', 1) })).not.toBe(
      computeFingerprint({ ...base, stack: stack('/app/src/b.ts', 1) })
    );
    expect(computeFingerprint({ ...base, route: '/api/a' })).not.toBe(computeFingerprint({ ...base, route: '/api/b' }));
  });
});
