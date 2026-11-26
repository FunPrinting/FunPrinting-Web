'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { signIn, signOut, useSession } from 'next-auth/react';
import { Toaster } from 'react-hot-toast';
import {
  AlertTriangle,
  Coins,
  ExternalLink,
  FileText,
  Info,
  Loader2,
  LogOut,
  Menu,
  Package,
  Shield,
  ShieldAlert,
  Tag,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';

const SECTIONS = [
  { slug: '', label: 'Orders & shops', icon: Package },
  { slug: 'templates', label: 'Templates', icon: FileText },
  { slug: 'creator-earnings', label: 'Creator payouts', icon: Coins },
  { slug: 'pricing', label: 'Pricing', icon: Tag },
  { slug: 'info', label: 'Site info', icon: Info },
  { slug: 'errors', label: 'Errors', icon: AlertTriangle },
];

const initials = (name?: string | null, email?: string | null) => {
  if (name) {
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
    return name.slice(0, 2).toUpperCase();
  }
  if (email) return email.slice(0, 2).toUpperCase();
  return 'AD';
};

/**
 * Wraps every admin page: verifies admin access, shows sign-in card if unauthorized,
 * and renders clean, dynamic navigation that adapts seamlessly between desktop and mobile,
 * and between the admin subdomain and fallback subpaths.
 */
export default function AdminGate({ children }: { children: React.ReactNode }) {
  const { data: session, status } = useSession();
  const pathname = usePathname();
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [isOnAdminSubdomain, setIsOnAdminSubdomain] = useState(false);
  const [siteUrl, setSiteUrl] = useState('/');
  const [mobileOpen, setMobileOpen] = useState(false);
  const [signingIn, setSigningIn] = useState<'google' | 'email' | null>(null);

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

  const handleSignOut = async (targetUrl?: string) => {
    try {
      await signOut({ redirect: false });
    } catch {}
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch {}
    if (typeof window !== 'undefined') {
      window.location.href = targetUrl || siteUrl || '/';
    }
  };

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
            <Button
              disabled={signingIn !== null}
              onClick={() => {
                setSigningIn('google');
                signIn('google', { callbackUrl: pathname });
              }}
            >
              {signingIn === 'google' ? 'Redirecting…' : 'Continue with Google'}
            </Button>
            <Button
              variant="outline"
              disabled={signingIn !== null}
              onClick={() => {
                setSigningIn('email');
                signIn(undefined, { callbackUrl: pathname });
              }}
            >
              Sign in with email
            </Button>
            {session?.user ? (
              <Button variant="ghost" onClick={() => handleSignOut(pathname)}>Use a different account</Button>
            ) : null}
            <Button asChild variant="link"><a href={siteUrl}>Back to the site</a></Button>
          </CardContent>
        </Card>
        {toaster}
      </div>
    );
  }

  const adminRoot = isOnAdminSubdomain ? '' : '/admin';

  const isSectionActive = (slug: string) => {
    const href = slug ? `${adminRoot}/${slug}` : (adminRoot || '/');
    return slug === ''
      ? pathname === '/' || pathname === '/admin' || pathname.startsWith('/orders') || pathname.startsWith('/admin/orders')
      : pathname === href || pathname.startsWith(`${href}/`);
  };

  return (
    <div className="min-h-screen bg-muted/30">
      <header className="sticky top-0 z-30 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-2.5 sm:px-6">
          {/* Brand */}
          <div className="flex items-center gap-3">
            <Link
              href={adminRoot || '/'}
              className="flex items-center gap-2 text-sm font-semibold tracking-tight transition-opacity hover:opacity-85"
            >
              <div className="flex size-7 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-xs">
                <Shield className="size-4" />
              </div>
              <span className="font-bold tracking-tight">Fun Printing</span>
              <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-primary">
                Admin
              </span>
            </Link>
          </div>

          {/* Desktop Navigation */}
          <nav aria-label="Admin" className="hidden md:flex items-center gap-1">
            {SECTIONS.map((s) => {
              const href = s.slug ? `${adminRoot}/${s.slug}` : (adminRoot || '/');
              const active = isSectionActive(s.slug);
              const Icon = s.icon;
              return (
                <Link
                  key={s.slug}
                  href={href}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'flex items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
                    active
                      ? 'bg-accent font-semibold text-accent-foreground shadow-xs'
                      : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                  )}
                >
                  <Icon className="size-3.5" />
                  <span>{s.label}</span>
                </Link>
              );
            })}
          </nav>

          {/* Desktop Actions */}
          <div className="hidden md:flex items-center gap-2">
            <Button asChild variant="ghost" size="sm" className="h-8 gap-1.5 text-xs text-muted-foreground hover:text-foreground">
              <a href={siteUrl} target="_blank" rel="noopener noreferrer">
                <span>Site</span>
                <ExternalLink className="size-3 opacity-60" />
              </a>
            </Button>
            <div className="h-4 w-px bg-border" />
            {session?.user?.email && (
              <span className="max-w-[140px] truncate text-xs text-muted-foreground" title={session.user.email}>
                {session.user.name || session.user.email}
              </span>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleSignOut(siteUrl)}
              className="h-8 gap-1.5 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive"
            >
              <LogOut className="size-3.5" />
              <span>Sign out</span>
            </Button>
          </div>

          {/* Mobile Hamburger Menu */}
          <div className="flex md:hidden items-center gap-2">
            <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
              <SheetTrigger asChild>
                <Button variant="ghost" size="icon" className="size-9" aria-label="Open admin navigation menu">
                  <Menu className="size-5" />
                </Button>
              </SheetTrigger>
              <SheetContent side="right" className="flex w-[85vw] max-w-sm flex-col p-0">
                <SheetHeader className="border-b p-4 text-left">
                  <div className="flex items-center gap-2">
                    <div className="flex size-7 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-xs">
                      <Shield className="size-4" />
                    </div>
                    <SheetTitle className="text-base font-bold">Admin Portal</SheetTitle>
                  </div>
                </SheetHeader>

                {/* Admin User Identity Card */}
                {session?.user && (
                  <div className="border-b bg-muted/40 p-4">
                    <div className="flex items-center gap-3">
                      <Avatar className="size-10 border border-primary/20">
                        {session.user.image ? (
                          <AvatarImage src={session.user.image} alt={session.user.name || ''} />
                        ) : null}
                        <AvatarFallback className="bg-primary/10 text-xs font-semibold text-primary">
                          {initials(session.user.name, session.user.email)}
                        </AvatarFallback>
                      </Avatar>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <p className="truncate text-sm font-semibold text-foreground">
                            {session.user.name || 'Administrator'}
                          </p>
                          <span className="rounded-full bg-primary/10 px-1.5 py-0.2 text-[9px] font-semibold text-primary">
                            Admin
                          </span>
                        </div>
                        <p className="truncate text-xs text-muted-foreground">{session.user.email}</p>
                      </div>
                    </div>
                  </div>
                )}

                {/* Navigation Links */}
                <div className="flex-1 overflow-y-auto p-3 space-y-1">
                  <div className="px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Admin Navigation
                  </div>
                  {SECTIONS.map((s) => {
                    const href = s.slug ? `${adminRoot}/${s.slug}` : (adminRoot || '/');
                    const active = isSectionActive(s.slug);
                    const Icon = s.icon;
                    return (
                      <Link
                        key={s.slug}
                        href={href}
                        onClick={() => setMobileOpen(false)}
                        aria-current={active ? 'page' : undefined}
                        className={cn(
                          'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
                          active
                            ? 'bg-primary text-primary-foreground font-semibold shadow-xs'
                            : 'text-foreground hover:bg-muted'
                        )}
                      >
                        <Icon className="size-4 shrink-0" />
                        <span className="flex-1">{s.label}</span>
                      </Link>
                    );
                  })}

                  <div className="pt-2">
                    <div className="px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Storefront
                    </div>
                    <a
                      href={siteUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={() => setMobileOpen(false)}
                      className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-foreground hover:bg-muted"
                    >
                      <ExternalLink className="size-4 shrink-0 text-muted-foreground" />
                      <span className="flex-1">Open customer site</span>
                    </a>
                  </div>
                </div>

                {/* Mobile Drawer Footer */}
                <div className="border-t p-4 bg-background">
                  <Button
                    variant="ghost"
                    className="w-full justify-start gap-2.5 text-destructive hover:bg-destructive/10 hover:text-destructive"
                    onClick={() => {
                      setMobileOpen(false);
                      handleSignOut(siteUrl);
                    }}
                  >
                    <LogOut className="size-4" />
                    <span>Sign out</span>
                  </Button>
                </div>
              </SheetContent>
            </Sheet>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6">{children}</main>
      {toaster}
    </div>
  );
}
