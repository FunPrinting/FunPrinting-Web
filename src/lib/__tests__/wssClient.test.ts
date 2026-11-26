import crypto from 'crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const partnerLookup = vi.hoisted(() => ({ userId: null as string | null }));
vi.mock('@/lib/mongodb', () => ({ default: vi.fn(async () => undefined) }));
vi.mock('@/models/Partner', () => ({
  default: {
    findById: () => ({
      select: () => ({ lean: async () => (partnerLookup.userId ? { userId: partnerLookup.userId } : null) }),
    }),
  },
}));

import { notifyPartnerChat, notifyPartnerJobs, signWssBody, verifyWssSignature } from '@/lib/wssClient';

const SECRET = 'dispatch-secret';
const PARTNER_ID = 'c'.repeat(24);
const LEGACY_USER_ID = 'd'.repeat(24);

function mockFetch(response: { status?: number; body?: unknown } = {}) {
  const fn = vi.fn(async () =>
    new Response(JSON.stringify(response.body ?? { success: true, delivered: 1 }), {
      status: response.status ?? 200,
      headers: { 'content-type': 'application/json' },
    })
  );
  vi.stubGlobal('fetch', fn);
  return fn;
}

describe('signWssBody', () => {
  it('is lowercase hex HMAC-SHA256 over "<timestamp>.<body>" (the WSS contract)', () => {
    const expected = crypto.createHmac('sha256', SECRET).update('123.{"a":1}').digest('hex');
    expect(signWssBody(SECRET, '123', '{"a":1}')).toBe(expected);
    expect(expected).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('verifyWssSignature (WSS → web error reports)', () => {
  const body = '{"source":"wss","message":"boom"}';
  const headers = (ts: string, sig: string) => new Headers({ 'x-fp-timestamp': ts, 'x-fp-signature': sig });

  it('accepts a correctly signed, fresh request', () => {
    vi.stubEnv('WSS_DISPATCH_SECRET', SECRET);
    const ts = String(Date.now());
    expect(verifyWssSignature(headers(ts, signWssBody(SECRET, ts, body)), body)).toBe(true);
  });

  it('rejects wrong secret, tampered body, stale timestamp, bad length and unset secret', () => {
    vi.stubEnv('WSS_DISPATCH_SECRET', SECRET);
    const ts = String(Date.now());
    const good = signWssBody(SECRET, ts, body);
    expect(verifyWssSignature(headers(ts, signWssBody('other', ts, body)), body)).toBe(false);
    expect(verifyWssSignature(headers(ts, good), body + ' ')).toBe(false);
    const old = String(Date.now() - 6 * 60 * 1000);
    expect(verifyWssSignature(headers(old, signWssBody(SECRET, old, body)), body)).toBe(false);
    expect(verifyWssSignature(headers(ts, 'abc'), body)).toBe(false);
    vi.stubEnv('WSS_DISPATCH_SECRET', '');
    expect(verifyWssSignature(headers(ts, good), body)).toBe(false);
  });
});

describe('notifyPartnerJobs', () => {
  beforeEach(() => {
    vi.stubEnv('WSS_API_URL', 'https://wss.example.com/');
    vi.stubEnv('WSS_DISPATCH_SECRET', SECRET);
    partnerLookup.userId = null;
  });

  it('also sends to the legacy User._id room and sums deliveries', async () => {
    partnerLookup.userId = LEGACY_USER_ID;
    const fetchMock = mockFetch({ body: { success: true, delivered: 1 } });
    const result = await notifyPartnerJobs(PARTNER_ID, 'new');
    const rooms = fetchMock.mock.calls.map((c) => JSON.parse((c as unknown as [string, RequestInit])[1].body as string).partnerId);
    expect(rooms).toEqual([PARTNER_ID, LEGACY_USER_ID]);
    expect(result).toMatchObject({ ok: true, delivered: 2 });
  });

  it('signs exactly the body it sends', async () => {
    const fetchMock = mockFetch();
    const result = await notifyPartnerJobs(PARTNER_ID, 'updated');
    expect(result).toEqual({ ok: true, delivered: 1, status: 200 });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://wss.example.com/api/notify-jobs');
    const headers = init.headers as Record<string, string>;
    const body = init.body as string;
    expect(headers['x-fp-signature']).toBe(signWssBody(SECRET, headers['x-fp-timestamp'], body));
    expect(Math.abs(Number(headers['x-fp-timestamp']) - Date.now())).toBeLessThan(5000);
    expect(JSON.parse(body)).toMatchObject({ partnerId: PARTNER_ID, reason: 'updated' });
  });

  it('reports delivered: 0 when no partner device is online', async () => {
    mockFetch({ body: { success: true, delivered: 0 } });
    expect(await notifyPartnerJobs(PARTNER_ID, 'cancelled')).toEqual({ ok: true, delivered: 0, status: 200 });
  });

  it('treats HTTP errors as not delivered', async () => {
    mockFetch({ status: 401, body: { success: false, error: 'bad signature' } });
    expect(await notifyPartnerJobs(PARTNER_ID, 'new')).toMatchObject({ ok: false, delivered: 0, status: 401, error: 'bad signature' });
  });

  it('treats network failures as not delivered', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNREFUSED'); }));
    expect(await notifyPartnerJobs(PARTNER_ID, 'new')).toMatchObject({ ok: false, delivered: 0, error: 'ECONNREFUSED' });
  });

  it('does not call the network when unconfigured', async () => {
    vi.stubEnv('WSS_DISPATCH_SECRET', '');
    const fetchMock = mockFetch();
    expect(await notifyPartnerJobs(PARTNER_ID, 'new')).toMatchObject({ ok: false, error: 'wss_not_configured' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('notifyPartnerChat', () => {
  beforeEach(() => {
    vi.stubEnv('WSS_API_URL', 'https://wss.example.com/');
    vi.stubEnv('WSS_DISPATCH_SECRET', SECRET);
    partnerLookup.userId = LEGACY_USER_ID;
  });

  it('posts signed chat notification to both partner and legacy user rooms', async () => {
    const fetchMock = mockFetch({ body: { success: true, delivered: 1 } });
    const res = await notifyPartnerChat(PARTNER_ID, {
      conversationId: 'chat_123',
      orderId: 'ORD99',
      senderName: 'Asha',
      preview: 'Hi there',
    });
    expect(res).toMatchObject({ ok: true, delivered: 2 });
    const urls = fetchMock.mock.calls.map((c) => (c as unknown as [string])[0]);
    expect(urls).toEqual([
      'https://wss.example.com/api/notify-chat',
      'https://wss.example.com/api/notify-chat',
    ]);
    const bodies = fetchMock.mock.calls.map((c) => JSON.parse((c as unknown as [string, RequestInit])[1].body as string));
    expect(bodies).toEqual([
      { partnerId: PARTNER_ID, conversationId: 'chat_123', orderId: 'ORD99', senderName: 'Asha', preview: 'Hi there' },
      { partnerId: LEGACY_USER_ID, conversationId: 'chat_123', orderId: 'ORD99', senderName: 'Asha', preview: 'Hi there' },
    ]);
  });
});
