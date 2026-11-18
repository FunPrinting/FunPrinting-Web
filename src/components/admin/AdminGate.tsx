'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { signIn, signOut, useSession } from 'next-auth/react';
import { Toaster } from 'react-hot-toast';
import { ExternalLink, Loader2, LogOut, ShieldAlert } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

const LINKS = [
  { href: '/admin', label: 'Orders & shops' },
  { href: '/admin/templates', label: 'Templates' },
  { href: '/admin/creator-earnings', label: 'Creator payouts' },
  { href: '/admin/pricing', label: 'Pricing' },
  { href: '/admin/info', label: 'Site info' },
  { href: '/admin/errors', label: 'Errors' },
];

/**
 * Wraps every /admin page: asks the server whether the session is an admin, shows the sign-in
 * card if not, and otherwise renders the admin header. This is a UX gate only; every
 * /api/admin/* route enforces requireAdmin() itself.
 */
export default function AdminGate({ children }: { children: React.ReactNode }) {
  const { data: session, status } = useSession();
  const pathname = usePathname();
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);

  useEffect(() => {
    if (status !== 'authenticated') {
      setIsAdmin(null);
      return;
    }
    let cancelled = false;
    fetch('/api/auth/check-admin', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => !cancelled && setIsAdmin(Boolean(d.isAdmin)))
      .catch(() => !cancelled && setIsAdmin(false));
    return () => {
      cancelled = true;
    };
  }, [status, session?.user?.email]);

  const toaster = <Toaster position="top-right" toastOptions={{ duration: 4000, className: '!rounded-xl !border !bg-popover !text-popover-foreground !shadow-lg !text-sm' }} />;

  if (status === 'loading' || (status === 'authenticated' && isAdmin === null)) {
    return <div className="grid min-h-screen place-items-center"><Loader2 className="size-6 animate-spin text-muted-foreground" aria-label="Checking access" /></div>;
  }

  if (!(status === 'authenticated' && isAdmin)) {
    return (
      <div className="grid min-h-screen place-items-center bg-muted/40 px-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <span className="grid size-10 place-items-center rounded-full bg-accent text-accent-foreground"><ShieldAlert className="size-5" aria-hidden /></span>
            <CardTitle className="mt-2">Admin sign-in</CardTitle>
            <CardDescription>
              {session?.user?.email ? <>You are signed in as <strong>{session.user.email}</strong>, which is not an admin account.</> : 'Only administrators can open this area.'}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            <Button onClick={() => signIn('google', { callbackUrl: pathname })}>Continue with Google</Button>
            <Button variant="outline" onClick={() => signIn(undefined, { callbackUrl: pathname })}>Sign in with email</Button>
            {session?.user ? <Button variant="ghost" onClick={() => signOut({ callbackUrl: pathname })}>Use a different account</Button> : null}
            <Button asChild variant="link"><Link href="/">Back to the site</Link></Button>
          </CardContent>
        </Card>
        {toaster}
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-muted/30">
      <header className="sticky top-0 z-30 border-b bg-background">
        <div className="mx-auto flex max-w-7xl items-center gap-4 px-4 py-2 sm:px-6">
          <Link href="/admin" className="shrink-0 text-sm font-semibold">Fun Printing admin</Link>
          <nav aria-label="Admin" className="-mx-1 flex flex-1 gap-1 overflow-x-auto px-1">
            {LINKS.map((l) => {
              const active = l.href === '/admin' ? pathname === '/admin' || pathname.startsWith('/admin/orders') : pathname.startsWith(l.href);
              return (
                <Link key={l.href} href={l.href} aria-current={active ? 'page' : undefined} className={cn('whitespace-nowrap rounded-md px-3 py-1.5 text-sm transition-colors', active ? 'bg-accent font-medium text-accent-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground')}>
                  {l.label}
                </Link>
              );
            })}
          </nav>
          <Button asChild variant="ghost" size="sm" className="hidden sm:inline-flex"><Link href="/" target="_blank">Site<ExternalLink /></Link></Button>
          <Button variant="outline" size="sm" onClick={() => signOut({ callbackUrl: '/' })}><LogOut />Sign out</Button>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6">{children}</main>
      {toaster}
    </div>
  );
}
