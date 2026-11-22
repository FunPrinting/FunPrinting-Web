import { NextResponse } from 'next/server';

/**
 * Minimum partner app versions. Old apps still use the earlier print path, so they are
 * turned away with 426 Upgrade Required once a minimum is set (env, no deploy of the
 * apps needed):
 *
 *   MIN_DESKTOP_APP_VERSION=2.0.0   MIN_MOBILE_APP_VERSION=2.0.0
 *
 * Apps send `X-App-Platform: desktop|mobile` and `X-App-Version: x.y.z`. An app that
 * sends neither is an old one. Unset minimums turn the check off.
 */
export type AppPlatform = 'desktop' | 'mobile';

/** Compares dotted versions; pre-release tags are ignored. Returns <0, 0, >0. */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string) => v.split('-')[0].split('.').map((n) => parseInt(n, 10) || 0);
  const x = parse(a);
  const y = parse(b);
  for (let i = 0; i < Math.max(x.length, y.length, 3); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

export function minimumFor(platform: AppPlatform | null, env: Record<string, string | undefined> = process.env): string | undefined {
  const desktop = env.MIN_DESKTOP_APP_VERSION?.trim() || undefined;
  const mobile = env.MIN_MOBILE_APP_VERSION?.trim() || undefined;
  if (platform === 'desktop') return desktop;
  if (platform === 'mobile') return mobile;
  return desktop || mobile; // unknown (old) app: blocked when any minimum is set
}

/** True when this app is too old for the configured minimum. */
export function isAppTooOld(headers: Pick<Headers, 'get'>, env: Record<string, string | undefined> = process.env): boolean {
  const raw = headers.get('x-app-platform');
  const platform: AppPlatform | null = raw === 'desktop' || raw === 'mobile' ? raw : null;
  const min = minimumFor(platform, env);
  if (!min) return false;
  const version = headers.get('x-app-version')?.trim();
  if (!platform || !version || !/^\d+(\.\d+){0,3}(-[\w.]+)?$/.test(version)) return true;
  return compareVersions(version, min) < 0;
}

export function upgradeRequiredResponse(): NextResponse {
  return NextResponse.json(
    { success: false, error: 'This version of the FunPrinting app is no longer supported. Please update it.', code: 'upgrade_required' },
    { status: 426 }
  );
}
