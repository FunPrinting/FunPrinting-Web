'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { Loader2 } from 'lucide-react';
import { AuthShell } from '@/components/auth/AuthShell';
import { NewPasswordForm } from '@/components/auth/NewPasswordForm';

export default function SetupPasswordPage() {
  const router = useRouter();
  const { data: session, status } = useSession();

  useEffect(() => {
    if (status === 'unauthenticated') router.push('/auth/signin');
  }, [status, router]);

  if (!session) {
    return <div className="grid min-h-[60vh] place-items-center"><Loader2 className="size-6 animate-spin text-muted-foreground" aria-label="Loading" /></div>;
  }

  return (
    <AuthShell title="Set a password" description="Add a password so you can also sign in with your email, not only Google.">
      <NewPasswordForm
        submitLabel="Set password"
        onSubmit={async (password, confirmPassword) => {
          const res = await fetch('/api/auth/setup-password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password, confirmPassword }) });
          const data = await res.json().catch(() => ({}));
          if (!data.success) return data.error || 'We couldn’t set the password. Please try again.';
          router.push('/auth/check-profile');
          return null;
        }}
      />
    </AuthShell>
  );
}
