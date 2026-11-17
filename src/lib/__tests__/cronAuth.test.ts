import { describe, expect, it, vi } from 'vitest';
import { requireCronSecret } from '@/lib/cronAuth';

const req = (headers: Record<string, string> = {}) => new Request('http://localhost/api/cron/x', { headers });

describe('requireCronSecret', () => {
  it('accepts the Vercel Bearer format and the legacy header', () => {
    vi.stubEnv('CRON_SECRET', 's3cret');
    expect(requireCronSecret(req({ authorization: 'Bearer s3cret' }))).toBeNull();
    expect(requireCronSecret(req({ 'x-cron-secret': 's3cret' }))).toBeNull();
  });

  it('rejects wrong, missing and different-length secrets', () => {
    vi.stubEnv('CRON_SECRET', 's3cret');
    expect(requireCronSecret(req({ authorization: 'Bearer nope' }))?.status).toBe(401);
    expect(requireCronSecret(req({ authorization: 'Bearer s3cret-longer' }))?.status).toBe(401);
    expect(requireCronSecret(req())?.status).toBe(401);
  });

  it('fails closed when CRON_SECRET is not configured', () => {
    vi.stubEnv('CRON_SECRET', '');
    expect(requireCronSecret(req({ authorization: 'Bearer ' }))?.status).toBe(401);
    expect(requireCronSecret(req({ 'x-cron-secret': '' }))?.status).toBe(401);
  });
});
