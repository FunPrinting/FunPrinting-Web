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

const SECTIONS = [
  { slug: '', label: 'Orders & shops' },
  { slug: 'templates', label: 'Templates' },
  { slug: 'creator-earnings', label: 'Creator payouts' },
  { slug: 'pricing', label: 'Pricing' },
  { slug: 'info', label: 'Site info' },
  { slug: 'errors', label: 'Errors' },
];

/**
 * Wraps every admin page: verifies admin access, shows sign-in card if unauthorized,
 * and renders clean, dynamic navigation that adapts seamlessly between admin subdomain
 * and fallback subpaths.
 */
export default function AdminGate({ children }: { children: React.ReactNode }) {
  const { data: session, status } = useSession();
  const pathname = usePathname();
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [isOnAdminSubdomain, setIsOnAdminSubdomain] = useState(false);
  const [siteUrl, setSiteUrl] = useState('/');

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const { hostname, protocol, port } = window.location;
      const lower = hostname.toLowerCase();
      const parts = lower.split('.');
      const isLocal = lower.includes('localhost') || lower === '127.0.0.1';
      const isSub = parts.length > (isLocal ? 1 : 2) && parts[0] === 'admin';
      setIsOnAdminSubdomain(isSub);

      if (isSub) {
        const rootHost = parts.slice(1).join('.');
        setSiteUrl(`${protocol}//${rootHost}${port ? `:${port}` : ''}`);
      } else {
        setSiteUrl('/');
      }
    }
  }, []);

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

  const toaster = (
    <Toaster
      position="top-right"
      toastOptions={{
        duration: 4000,
        className: '!rounded-xl !border !bg-popover !text-popover-foreground !shadow-lg !text-sm',
      }}
    />
  );

  if (status === 'loading' || (status === 'authenticated' && isAdmin === null)) {
    return (
      <div className="grid min-h-screen place-items-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" aria-label="Checking access" />
      </div>
    );
  }

  if (!(status === 'authenticated' && isAdmin)) {
    return (
      <div className="grid min-h-screen place-items-center bg-muted/40 px-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <span className="grid size-10 place-items-center rounded-full bg-accent text-accent-foreground">
              <ShieldAlert className="size-5" aria-hidden />
            </span>
            <CardTitle className="mt-2">Admin sign-in</CardTitle>
            <CardDescription>
              {session?.user?.email ? (
                <>You are signed in as <strong>{session.user.email}</strong>, which is not an admin account.</>
              ) : (
                'Only administrators can open this area.'
              )}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            <Button onClick={() => signIn('google', { callbackUrl: pathname })}>Continue with Google</Button>
            <Button variant="outline" onClick={() => signIn(undefined, { callbackUrl: pathname })}>Sign in with email</Button>
            {session?.user ? (
              <Button variant="ghost" onClick={() => signOut({ callbackUrl: pathname })}>Use a different account</Button>
            ) : null}
            <Button asChild variant="link"><a href={siteUrl}>Back to the site</a></Button>
          </CardContent>
        </Card>
        {toaster}
      </div>
    );
  }

  const adminRoot = isOnAdminSubdomain ? '' : '/admin';

  return (
    <div className="min-h-screen bg-muted/30">
      <header className="sticky top-0 z-30 border-b bg-background">
        <div className="mx-auto flex max-w-7xl items-center gap-4 px-4 py-2 sm:px-6">
          <Link href={adminRoot || '/'} className="shrink-0 text-sm font-semibold">
            Fun Printing admin
          </Link>
          <nav aria-label="Admin" className="-mx-1 flex flex-1 gap-1 overflow-x-auto px-1">
            {SECTIONS.map((s) => {
              const href = s.slug ? `${adminRoot}/${s.slug}` : (adminRoot || '/');
              const active = s.slug === ''
                ? pathname === '/' || pathname === '/admin' || pathname.startsWith('/orders') || pathname.startsWith('/admin/orders')
                : pathname === href || pathname.startsWith(`${href}/`);
              return (
                <Link
                  key={s.slug}
                  href={href}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'whitespace-nowrap rounded-md px-3 py-1.5 text-sm transition-colors',
                    active ? 'bg-accent font-medium text-accent-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                  )}
                >
                  {s.label}
                </Link>
              );
            })}
          </nav>
          <Button asChild variant="ghost" size="sm" className="hidden sm:inline-flex">
            <a href={siteUrl} target="_blank" rel="noopener noreferrer">
              Site<ExternalLink />
            </a>
          </Button>
          <Button variant="outline" size="sm" onClick={() => signOut({ callbackUrl: siteUrl })}>
            <LogOut />Sign out
          </Button>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6">{children}</main>
      {toaster}
    </div>
  );
}
