/**
 * Where a sign-in code may be sent. Only the partner apps' own callbacks:
 * - desktop app: local loopback server on port 4321
 * - mobile app: funprintingpartner:// deep link
 * - Expo Go (development only): exp://
 * Shared by the sign-in page and the code-issuing API.
 */
export function isAllowedCallback(callback: string, production = process.env.NODE_ENV === 'production'): boolean {
  if (callback === 'http://localhost:4321/callback' || callback === 'http://127.0.0.1:4321/callback') return true;
  if (/^funprintingpartner:\/\/[A-Za-z0-9/_-]*$/.test(callback)) return true;
  if (!production && callback.startsWith('exp://')) return true;
  return false;
}
