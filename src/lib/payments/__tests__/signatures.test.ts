import crypto from 'crypto';
import { describe, expect, it, vi } from 'vitest';
import { paymentLinkCallbackPayload, signForTests, verifyPaymentLinkCallback, verifyWebhookSignature } from '@/lib/payments/signatures';
import { signUploadReceipt, verifyUploadReceipt } from '@/lib/uploads/receipt';

const KEY_SECRET = 'EnLs21M47BllR3X8PSFtjtbd';

describe('Payment Link callback signature', () => {
  it('matches the Razorpay documented payload format', () => {
    const p = { paymentLinkId: 'plink_IH3cNucfVEgV68', referenceId: 'TSsd1989', status: 'paid', paymentId: 'pay_IH3d0ara9bSsjQ' };
    expect(paymentLinkCallbackPayload(p)).toBe('plink_IH3cNucfVEgV68|TSsd1989|paid|pay_IH3d0ara9bSsjQ');
    // Same HMAC the Razorpay SDK's validatePaymentVerification computes
    const expected = crypto.createHmac('sha256', KEY_SECRET).update('plink_IH3cNucfVEgV68|TSsd1989|paid|pay_IH3d0ara9bSsjQ').digest('hex');
    expect(verifyPaymentLinkCallback({ ...p, signature: expected }, KEY_SECRET)).toBe(true);
  });

  it('rejects tampering with any field, wrong secret, wrong length, missing secret', () => {
    const p = { paymentLinkId: 'plink_1', referenceId: 'ORD1_1', status: 'paid', paymentId: 'pay_1' };
    const sig = signForTests(KEY_SECRET, paymentLinkCallbackPayload(p));
    expect(verifyPaymentLinkCallback({ ...p, status: 'created', signature: sig }, KEY_SECRET)).toBe(false);
    expect(verifyPaymentLinkCallback({ ...p, referenceId: 'ORD2_1', signature: sig }, KEY_SECRET)).toBe(false);
    expect(verifyPaymentLinkCallback({ ...p, paymentId: 'pay_2', signature: sig }, KEY_SECRET)).toBe(false);
    expect(verifyPaymentLinkCallback({ ...p, signature: sig }, 'other')).toBe(false);
    expect(verifyPaymentLinkCallback({ ...p, signature: 'abc' }, KEY_SECRET)).toBe(false);
    expect(verifyPaymentLinkCallback({ ...p, signature: sig }, '')).toBe(false);
  });
});

describe('webhook signature', () => {
  it('verifies HMAC of the raw body', () => {
    const body = '{"event":"payment_link.paid"}';
    const sig = signForTests('whsec', body);
    expect(verifyWebhookSignature(body, sig, 'whsec')).toBe(true);
    expect(verifyWebhookSignature(body + ' ', sig, 'whsec')).toBe(false);
    expect(verifyWebhookSignature(body, null, 'whsec')).toBe(false);
    expect(verifyWebhookSignature(body, sig, '')).toBe(false);
  });
});

describe('upload receipts', () => {
  const data = { url: 'https://res.cloudinary.com/x/a.pdf', name: 'a.pdf', mime: 'application/pdf', size: 10, pages: 12, estimated: false, uid: 'u@example.com' };

  it('round-trips for the uploader', () => {
    vi.stubEnv('NEXTAUTH_SECRET', 'x'.repeat(32));
    const token = signUploadReceipt(data);
    const check = verifyUploadReceipt(token, 'u@example.com');
    expect(check).toMatchObject({ ok: true, receipt: { pages: 12, url: data.url } });
  });

  it('rejects edited page counts, other users, expiry and garbage', () => {
    vi.stubEnv('NEXTAUTH_SECRET', 'x'.repeat(32));
    const token = signUploadReceipt(data);
    const [payload, sig] = token.split('.');
    const edited = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(payload, 'base64url').toString()), pages: 1 })).toString('base64url');
    expect(verifyUploadReceipt(`${edited}.${sig}`, 'u@example.com').ok).toBe(false);
    expect(verifyUploadReceipt(token, 'other@example.com').ok).toBe(false);
    expect(verifyUploadReceipt(token, 'u@example.com', Date.now() + 25 * 3600_000).ok).toBe(false);
    expect(verifyUploadReceipt('nope', 'u@example.com').ok).toBe(false);
    expect(verifyUploadReceipt(`${token}.x`, 'u@example.com').ok).toBe(false);
    vi.stubEnv('NEXTAUTH_SECRET', 'y'.repeat(32));
    expect(verifyUploadReceipt(token, 'u@example.com').ok).toBe(false);
  });
});
