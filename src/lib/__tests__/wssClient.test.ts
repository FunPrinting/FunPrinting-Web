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

import { cancelPrintJob, dispatchPrintJob, signWssBody } from '@/lib/wssClient';

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

describe('dispatchPrintJob / cancelPrintJob', () => {
  beforeEach(() => {
    vi.stubEnv('WSS_API_URL', 'https://wss.example.com/');
    vi.stubEnv('WSS_DISPATCH_SECRET', SECRET);
    partnerLookup.userId = null;
  });

  it('also sends to the legacy User._id room and sums deliveries', async () => {
    partnerLookup.userId = LEGACY_USER_ID;
    const fetchMock = mockFetch({ body: { success: true, delivered: 1 } });

    const result = await dispatchPrintJob(PARTNER_ID, { orderId: 'ORD1', fileURL: 'https://f/1.pdf' });

    const rooms = fetchMock.mock.calls.map((c) => JSON.parse((c as unknown as [string, RequestInit])[1].body as string).partnerId);
    expect(rooms).toEqual([PARTNER_ID, LEGACY_USER_ID]);
    expect(result).toMatchObject({ ok: true, delivered: 2 });
  });

  it('signs exactly the body it sends and strips customer data', async () => {
    const fetchMock = mockFetch();
    const order = {
      orderId: 'ORD1',
      fileURLs: ['https://f/1.pdf', 'https://f/2.pdf'],
      printingOptions: { copies: 2 },
      customerInfo: { email: 'secret@example.com', phone: '999' },
    };

    const result = await dispatchPrintJob(PARTNER_ID, order);

    expect(result).toEqual({ ok: true, delivered: 1, status: 200 });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://wss.example.com/api/dispatch-print-job');
    const headers = init.headers as Record<string, string>;
    const body = init.body as string;
    expect(headers['x-fp-signature']).toBe(signWssBody(SECRET, headers['x-fp-timestamp'], body));
    expect(Math.abs(Number(headers['x-fp-timestamp']) - Date.now())).toBeLessThan(5000);
    expect(body).not.toContain('secret@example.com');
    expect(JSON.parse(body)).toMatchObject({ partnerId: PARTNER_ID, order: { orderId: 'ORD1', fileURLs: order.fileURLs } });
  });

  it('reports delivered: 0 when no partner device is online', async () => {
    mockFetch({ body: { success: true, delivered: 0 } });
    expect(await cancelPrintJob(PARTNER_ID, 'ORD1')).toEqual({ ok: true, delivered: 0, status: 200 });
  });

  it('treats HTTP errors as not delivered', async () => {
    mockFetch({ status: 401, body: { success: false, error: 'bad signature' } });
    const result = await dispatchPrintJob(PARTNER_ID, { orderId: 'ORD1' });
    expect(result).toMatchObject({ ok: false, delivered: 0, status: 401, error: 'bad signature' });
  });

  it('treats network failures as not delivered', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNREFUSED'); }));
    expect(await dispatchPrintJob(PARTNER_ID, { orderId: 'ORD1' })).toMatchObject({ ok: false, delivered: 0, error: 'ECONNREFUSED' });
  });

  it('does not call the network when unconfigured', async () => {
    vi.stubEnv('WSS_DISPATCH_SECRET', '');
    const fetchMock = mockFetch();
    expect(await dispatchPrintJob(PARTNER_ID, { orderId: 'ORD1' })).toMatchObject({ ok: false, error: 'wss_not_configured' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
