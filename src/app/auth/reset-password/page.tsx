'use client';

import Link from 'next/link';
import { Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { AuthShell } from '@/components/auth/AuthShell';
import { NewPasswordForm } from '@/components/auth/NewPasswordForm';
import { Button } from '@/components/ui/button';

function ResetPassword() {
  const router = useRouter();
  const token = useSearchParams().get('token');

  if (!token) {
    return (
      <AuthShell title="This link isn’t valid" description="The reset link is missing or incomplete. Request a new one.">
        <Button asChild className="h-11 w-full"><Link href="/auth/forgot-password">Request a new link</Link></Button>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Choose a new password"
      description="The link works once and expires 1 hour after it was sent."
      footer={<Link href="/auth/signin" className="hover:text-foreground">Back to sign in</Link>}
    >
      <NewPasswordForm
        submitLabel="Reset password"
        onSubmit={async (password, confirmPassword) => {
          const res = await fetch('/api/auth/reset-password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, password, confirmPassword }) });
          const data = await res.json().catch(() => ({}));
          if (!data.success) return data.error || 'We couldn’t reset the password. The link may have expired.';
          router.push('/auth/signin?reset=success');
          return null;
        }}
      />
    </AuthShell>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<div className="grid min-h-[60vh] place-items-center"><Loader2 className="size-6 animate-spin text-muted-foreground" aria-label="Loading" /></div>}>
      <ResetPassword />
    </Suspense>
  );
}
