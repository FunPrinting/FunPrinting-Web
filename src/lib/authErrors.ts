/** Maps NextAuth error query codes (`?error=...`) to plain, actionable user messages. */
const AUTH_ERROR_MESSAGES: Record<string, string> = {
  OAuthCallback:
    'Google sign-in could not finish because your browser did not keep the sign-in cookie. If you opened this link inside WhatsApp, Instagram, or Gmail, open funprinting.store in Chrome or Safari, or sign in with email & password below.',
  OAuthSignin:
    'Could not start Google sign-in. Please allow cookies in your browser or use email & password below.',
  Callback:
    'Google sign-in was interrupted before completion. Please try again or sign in with email & password below.',
  AccessDenied:
    'Google sign-in was cancelled or blocked by your Google account (some college or work emails restrict external logins). Try a personal Gmail account or sign in with email & password below.',
  OAuthAccountNotLinked:
    'An account with this email already exists using another sign-in method. Please sign in with email & password.',
};

export function authErrorMessage(code: string | null | undefined): string | null {
  if (!code) return null;
  return AUTH_ERROR_MESSAGES[code] ?? 'Could not sign you in. Please try again or use your email & password below.';
}

/** Detects mobile in-app browsers (WhatsApp, Instagram, Facebook, Snapchat, Line) that often isolate OAuth cookies. */
export function isInAppBrowser(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /FBAN|FBAV|Instagram|WhatsApp|Snapchat|Line\/|wv\)/i.test(navigator.userAgent || '');
}
