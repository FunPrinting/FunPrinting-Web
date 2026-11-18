'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { Loader2 } from 'lucide-react';

/** After sign-in: password setup (Google accounts), then profile completion, then My orders. */
export default function CheckProfilePage() {
  const router = useRouter();
  const { data: session, status } = useSession();

  useEffect(() => {
    if (status === 'loading') return;
    if (!session) return router.push('/auth/signin');
    fetch('/api/user/check-profile-complete')
      .then((r) => r.json())
      .then((data) => {
        if (!data.success) return router.push('/my-orders');
        if (!data.hasPassword && (data.provider === 'google' || !data.provider)) return router.push('/auth/setup-password');
        router.push(data.isComplete ? '/my-orders' : '/complete-profile');
      })
      .catch(() => router.push('/my-orders'));
  }, [session, status, router]);

  return (
    <div className="grid min-h-[60vh] place-items-center" role="status">
      <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="size-5 animate-spin" aria-hidden />Checking your profile…</div>
    </div>
  );
}
