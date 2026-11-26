'use client';

import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { performSignOut } from '@/lib/authClient';

export const useAuth = () => {
  const { data: session, status } = useSession();
  const router = useRouter();

  const isLoading = status === 'loading';
  const isAuthenticated = !!session?.user;
  const user = session?.user;

  const logout = async (callbackUrl: string = '/') => {
    await performSignOut(callbackUrl);
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
