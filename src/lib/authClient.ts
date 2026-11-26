'use client';

import { signOut } from 'next-auth/react';

const LOGOUT_TIMEOUT_MS = 4000;

/**
 * Signs out cleanly across NextAuth, server cookies (host-only + subdomain + chunked),
 * and client storage, then replaces history to prevent cached back-navigation.
 */
export async function performSignOut(targetUrl: string = '/'): Promise<void> {
  const work = Promise.allSettled([
    signOut({ redirect: false }),
    fetch('/api/auth/logout', {
      method: 'POST',
      credentials: 'include',
      cache: 'no-store',
    }),
  ]);

  await Promise.race([
    work,
    new Promise<void>((resolve) => setTimeout(resolve, LOGOUT_TIMEOUT_MS)),
  ]);

  if (typeof window !== 'undefined') {
    try {
      sessionStorage.clear();
    } catch {}
    window.location.replace(targetUrl);
  }
}
