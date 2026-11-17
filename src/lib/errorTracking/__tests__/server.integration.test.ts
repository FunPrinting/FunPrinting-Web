import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// after() needs a request scope; captureError itself doesn't use it
vi.mock('next/server', () => ({ after: () => { throw new Error('outside request'); } }));

import { __internals, __resetErrorTrackingState, captureError, captureException } from '@/lib/errorTracking/server';
import ErrorGroup from '@/models/ErrorGroup';

let mongo: MongoMemoryServer;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongo.getUri();
  process.env.ERROR_TRACKING_IN_TESTS = '1';
}, 120_000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongo?.stop();
});

beforeEach(async () => {
  __resetErrorTrackingState();
  vi.useRealTimers();
  if (mongoose.connection.readyState === 1) await ErrorGroup.deleteMany({});
});

describe('captureError (MongoDB)', () => {
  it('creates a group on first occurrence, with scrubbed data', async () => {
    const id = await captureError({
      message: 'Payment failed for a@b.com',
      url: '/payment/return?razorpay_signature=secret',
      route: '/payment/return',
      context: { orderId: 'ORD1', email: 'a@b.com' },
    });
    expect(id).toMatch(/^[0-9a-f]{24}$/);
    const doc = await ErrorGroup.findById(id).lean();
    expect(doc).toMatchObject({ source: 'server', level: 'error', status: 'open', count: 1, message: 'Payment failed for [email]' });
    expect(doc!.samples).toHaveLength(1);
    expect(doc!.samples[0]).toMatchObject({ url: '/payment/return', context: { orderId: 'ORD1', email: '[redacted]' } });
  });

  it('throttles repeats per fingerprint and adds them to the next write', async () => {
    const now = vi.spyOn(Date, 'now');
    now.mockReturnValue(1_000_000);
    const first = await captureError({ message: 'Order ORD1 failed', route: '/api/x' });
    expect(await captureError({ message: 'Order ORD2 failed', route: '/api/x' })).toBeNull();
    expect(await captureError({ message: 'Order ORD3 failed', route: '/api/x' })).toBeNull();
    now.mockReturnValue(1_000_000 + __internals.THROTTLE_MS + 1);
    const later = await captureError({ message: 'Order ORD4 failed', route: '/api/x' });
    expect(later).toBe(first);
    const doc = await ErrorGroup.findById(first).lean();
    expect(doc!.count).toBe(4);
    expect(doc!.samples.map((s) => s.message)).toEqual(['Order ORD4 failed', 'Order ORD1 failed']);
  });

  it('reopens a resolved issue when it happens again', async () => {
    const id = await captureError({ message: 'boom', route: '/r' });
    await ErrorGroup.updateOne({ _id: id }, { $set: { status: 'resolved', resolvedAt: new Date() } });
    __resetErrorTrackingState();
    await captureError({ message: 'boom', route: '/r' });
    const doc = await ErrorGroup.findById(id).lean();
    expect(doc!.status).toBe('open');
    expect(doc!.regressedAt).toBeInstanceOf(Date);
    expect(doc!.resolvedAt).toBeNull();
  });

  it('keeps ignored issues ignored, and never downgrades error to warning', async () => {
    const id = await captureError({ message: 'noisy', route: '/n', level: 'error' });
    await ErrorGroup.updateOne({ _id: id }, { $set: { status: 'ignored' } });
    __resetErrorTrackingState();
    await captureError({ message: 'noisy', route: '/n', level: 'warning' });
    const doc = await ErrorGroup.findById(id).lean();
    expect(doc).toMatchObject({ status: 'ignored', level: 'error', count: 2 });
  });

  it('stores values that start with $ literally', async () => {
    const id = await captureError({ message: '$status is not a field', route: '$route' });
    const doc = await ErrorGroup.findById(id).lean();
    expect(doc!.message).toBe('$status is not a field');
    expect(doc!.route).toBe('$route');
  });

  it('caps samples at 5, newest first', async () => {
    const now = vi.spyOn(Date, 'now');
    let id: string | null = null;
    for (let i = 0; i < 7; i++) {
      now.mockReturnValue(2_000_000 + i * (__internals.THROTTLE_MS + 1));
      id = await captureError({ message: `same issue ${i}`, route: '/s' });
    }
    const doc = await ErrorGroup.findById(id).lean();
    expect(doc!.count).toBe(7);
    expect(doc!.samples).toHaveLength(5);
    expect(doc!.samples[0].message).toBe('same issue <n>'.replace('<n>', '6'));
  });

  it('captureException records name, stack and digest', async () => {
    const err = Object.assign(new TypeError('x is undefined'), { digest: 'abc123' });
    const id = await captureException(err, { route: '/page' });
    const doc = await ErrorGroup.findById(id).lean();
    expect(doc).toMatchObject({ name: 'TypeError', message: 'x is undefined' });
    expect(doc!.samples[0].digest).toBe('abc123');
    expect(doc!.samples[0].stack).toContain('TypeError');
  });

  it('never throws when the database is unreachable', async () => {
    const saved = process.env.MONGODB_URI;
    await mongoose.disconnect();
    (globalThis as { __fpMongoose?: { promise: unknown } }).__fpMongoose!.promise = null;
    process.env.MONGODB_URI = 'mongodb://127.0.0.1:1/unreachable';
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await expect(captureError({ message: 'db down', route: '/d' })).resolves.toBeNull();
    quiet.mockRestore();
    process.env.MONGODB_URI = saved;
    (globalThis as { __fpMongoose?: { promise: unknown } }).__fpMongoose!.promise = null;
  }, 20_000);
});
