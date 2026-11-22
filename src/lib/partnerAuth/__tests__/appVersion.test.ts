import { describe, expect, it } from 'vitest';
import { compareVersions, isAppTooOld } from '../appVersion';

const h = (o: Record<string, string>) => ({ get: (k: string) => o[k.toLowerCase()] ?? null });

describe('app version gate', () => {
  it('compares versions numerically', () => {
    expect(compareVersions('2.0.0', '1.9.9')).toBeGreaterThan(0);
    expect(compareVersions('1.10.0', '1.9.0')).toBeGreaterThan(0);
    expect(compareVersions('2.0', '2.0.0')).toBe(0);
    expect(compareVersions('2.0.0-beta.1', '2.0.0')).toBe(0);
  });
  it('does nothing without a minimum', () => {
    expect(isAppTooOld(h({}), {})).toBe(false);
  });
  it('blocks old apps that send no headers once a minimum is set', () => {
    expect(isAppTooOld(h({}), { MIN_DESKTOP_APP_VERSION: '2.0.0' })).toBe(true);
  });
  it('checks each platform against its own minimum', () => {
    const env = { MIN_DESKTOP_APP_VERSION: '2.0.0', MIN_MOBILE_APP_VERSION: '1.5.0' };
    expect(isAppTooOld(h({ 'x-app-platform': 'desktop', 'x-app-version': '1.9.0' }), env)).toBe(true);
    expect(isAppTooOld(h({ 'x-app-platform': 'desktop', 'x-app-version': '2.0.0' }), env)).toBe(false);
    expect(isAppTooOld(h({ 'x-app-platform': 'mobile', 'x-app-version': '1.5.0' }), env)).toBe(false);
  });
  it('treats a garbled version as too old', () => {
    expect(isAppTooOld(h({ 'x-app-platform': 'desktop', 'x-app-version': 'abc' }), { MIN_DESKTOP_APP_VERSION: '1.0.0' })).toBe(true);
  });
});
