import { describe, expect, it } from 'vitest';
import { EnvError, parseServerEnv } from '@/lib/env';

const valid = {
  MONGODB_URI: 'mongodb+srv://u:p@cluster/db',
  NEXTAUTH_SECRET: 'x'.repeat(32),
  RAZORPAY_KEY_ID: 'rzp_test_123',
  RAZORPAY_KEY_SECRET: 'secret',
};

describe('parseServerEnv', () => {
  it('accepts the minimum required set and normalises optional values', () => {
    const env = parseServerEnv({ ...valid, WSS_API_URL: 'https://wss.example.com/', CRON_SECRET: '' });
    expect(env.WSS_API_URL).toBe('https://wss.example.com');
    expect(env.CRON_SECRET).toBeUndefined();
    expect(env.NODE_ENV).toBe('development');
  });

  it('lists every missing required variable in one error', () => {
    try {
      parseServerEnv({});
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(EnvError);
      const message = (error as EnvError).message;
      for (const key of ['MONGODB_URI', 'NEXTAUTH_SECRET', 'RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET']) {
        expect(message).toContain(`${key} is required`);
      }
    }
  });

  it('rejects a short NEXTAUTH_SECRET and an invalid URL', () => {
    expect(() => parseServerEnv({ ...valid, NEXTAUTH_SECRET: 'short' })).toThrow(/NEXTAUTH_SECRET must be at least 16/);
    expect(() => parseServerEnv({ ...valid, WSS_API_URL: 'not a url' })).toThrow(/WSS_API_URL/);
  });
});
