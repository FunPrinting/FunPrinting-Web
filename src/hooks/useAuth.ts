'use client';

import { useSession, signOut } from 'next-auth/react';
import { useRouter } from 'next/navigation';

export const useAuth = () => {
  const { data: session, status } = useSession();
  const router = useRouter();

  const isLoading = status === 'loading';
  const isAuthenticated = !!session?.user;
  const user = session?.user;

  const logout = async (callbackUrl: string = '/') => {
    try {
      // 1. Tell NextAuth to sign out client-side without relying on internal redirect
      await signOut({ redirect: false });
    } catch (err) {
      console.warn('NextAuth signOut warning:', err);
    }

    try {
      // 2. Purge all auth cookies on the server (handles both host-only and cross-subdomain cookies)
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch (err) {
      console.warn('Server logout warning:', err);
    }

    // 3. Clear client-side session cache
    if (typeof window !== 'undefined') {
      try {
        sessionStorage.clear();
      } catch {}

      // 4. Perform full page navigation to callbackUrl, ensuring complete state reset
      window.location.href = callbackUrl;
    }
  };

  const requireAuth = () => {
    if (!isAuthenticated && !isLoading) {
      router.push('/auth/signin');
      return false;
    }
    return true;
  };

  return {
    user,
    isAuthenticated,
    isLoading,
    logout,
    requireAuth,
  };
};
