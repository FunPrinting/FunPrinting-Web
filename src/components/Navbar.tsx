'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  ExternalLink,
  FileText,
  LogOut,
  Menu,
  Package,
  Printer,
  Shield,
  ShoppingCart,
  Store,
  User,
} from 'lucide-react';
import { useAdminInfo } from '@/hooks/useAdminInfo';
import { useAuth } from '@/hooks/useAuth';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';

type SessionUser = {
  name?: string | null;
  email?: string | null;
  image?: string | null;
  role?: string;
  profilePicture?: string;
};

const STORE_LINKS = [
  { href: '/order', label: 'Order prints' },
  { href: '/templates', label: 'Templates' },
  { href: '/my-orders', label: 'My orders' },
  { href: '/my-templates', label: 'My templates', requireAuth: true },
  { href: '/partner', label: 'Partner program' },
  { href: '/contact', label: 'Contact' },
];

function initials(user?: SessionUser) {
  const s = (user?.name || user?.email || '?').trim();
  const parts = s.split(/\s+/);
  return ((parts[0]?.[0] || '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase() || '?';
}

function useActive() {
  const pathname = usePathname();
  return (href: string) => (href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`));
}

/**
 * Dynamically resolves the admin portal URL:
 * - On production/custom domain (e.g. www.funprinting.store): https://admin.funprinting.store
 * - On local development (localhost:3000): http://admin.localhost:3000
 */
function useAdminPortalUrl() {
  const [adminUrl, setAdminUrl] = useState('/admin');

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const { hostname, protocol, port } = window.location;
      const lower = hostname.toLowerCase();
      const portSuffix = port ? `:${port}` : '';

      // If already on the admin subdomain, root '/' is the admin portal
      if (lower.startsWith('admin.')) {
        setAdminUrl('/');
        return;
      }

      // Strip leading 'www.' from host
      const apex = lower.replace(/^www\./, '');
      setAdminUrl(`${protocol}//admin.${apex}${portSuffix}`);
    }
  }, []);

  return adminUrl;
}

/**
 * Checks if the current session is an admin:
 * - Returns true if user.role === 'admin'
 * - Also checks /api/auth/check-admin for allowlisted admin emails (even if role is 'partner')
 */
function useIsAdmin(user?: SessionUser | null) {
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    if (!user) {
      setIsAdmin(false);
      return;
    }

    if (user.role === 'admin') {
      setIsAdmin(true);
      return;
    }

    let cancelled = false;
    fetch('/api/auth/check-admin', { cache: 'no-store' })
      .then((res) => res.json())
      .then((data) => {
        if (!cancelled && data.isAdmin) {
          setIsAdmin(true);
        }
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [user]);

  return isAdmin;
}

function UserMenu({
  user,
  isAdmin,
  adminUrl,
  onSignOut,
}: {
  user: SessionUser;
  isAdmin: boolean;
  adminUrl: string;
  onSignOut: () => void;
}) {
  const image = user.image || user.profilePicture || undefined;
  const isPartner = user.role === 'partner' || isAdmin;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="rounded-full" aria-label="Account menu">
          <Avatar className="size-8">
            {image ? <AvatarImage src={image} alt="" /> : null}
            <AvatarFallback className="bg-accent text-xs font-semibold text-accent-foreground">
              {initials(user)}
            </AvatarFallback>
          </Avatar>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64 p-2">
        <DropdownMenuLabel className="font-normal px-2 py-1.5">
          <div className="flex items-center justify-between gap-2">
            <span className="truncate text-sm font-semibold">{user.name || 'Your account'}</span>
            <div className="flex gap-1 shrink-0">
              {isAdmin && (
                <Badge variant="secondary" className="text-[10px] h-4 px-1.5 font-bold">
                  Admin
                </Badge>
              )}
              {user.role === 'partner' && (
                <Badge variant="outline" className="text-[10px] h-4 px-1.5">
                  Partner
                </Badge>
              )}
            </div>
          </div>
          <div className="truncate text-xs text-muted-foreground mt-0.5">{user.email}</div>
        </DropdownMenuLabel>

        {/* Management Section (Admin / Partner) */}
        {(isAdmin || isPartner) && (
          <>
            <DropdownMenuSeparator />
            <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Management
            </div>
            {isAdmin && (
              <DropdownMenuItem asChild className="cursor-pointer font-medium text-primary focus:text-primary">
                <a href={adminUrl} target="_blank" rel="noopener noreferrer">
                  <Shield className="size-4 text-primary" />
                  <span>Admin portal</span>
                  <ExternalLink className="ml-auto size-3 opacity-60" />
                </a>
              </DropdownMenuItem>
            )}
            {isPartner && (
              <DropdownMenuItem asChild className="cursor-pointer">
                <Link href="/partner/dashboard">
                  <Store className="size-4" />
                  <span>Partner dashboard</span>
                </Link>
              </DropdownMenuItem>
            )}
          </>
        )}

        {/* Account Section */}
        <DropdownMenuSeparator />
        <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Account
        </div>
        <DropdownMenuItem asChild className="cursor-pointer">
          <Link href="/profile">
            <User className="size-4" />
            <span>Profile</span>
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild className="cursor-pointer">
          <Link href="/my-orders">
            <Package className="size-4" />
            <span>My orders</span>
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild className="cursor-pointer">
          <Link href="/my-templates">
            <FileText className="size-4" />
            <span>My templates</span>
          </Link>
        </DropdownMenuItem>

        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onSignOut} className="cursor-pointer text-destructive focus:text-destructive">
          <LogOut className="size-4" />
          <span>Sign out</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export default function Navbar() {
  const { adminInfo } = useAdminInfo();
  const { user, isAuthenticated, isLoading, logout } = useAuth();
  const isAdmin = useIsAdmin(user as SessionUser);
  const adminUrl = useAdminPortalUrl();
  const isActive = useActive();
  const [open, setOpen] = useState(false);

  const name = adminInfo?.name || 'Fun Printing';
  const links = STORE_LINKS.filter((l) => !l.requireAuth || isAuthenticated);
  const isPartner = (user as SessionUser)?.role === 'partner' || isAdmin;

  return (
    <header className="sticky top-0 z-50 border-b bg-background/80 backdrop-blur-md supports-[backdrop-filter]:bg-background/70">
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-4 px-4 sm:px-6 lg:px-8">
        {/* Brand */}
        <Link href="/" className="flex shrink-0 items-center gap-2 rounded-md font-semibold tracking-tight">
          <span className="grid size-8 place-items-center rounded-lg bg-primary text-primary-foreground">
            <Printer className="size-4" aria-hidden />
          </span>
          <span className="text-lg">{name}</span>
        </Link>

        {/* Desktop Navigation Links */}
        <nav aria-label="Main" className="hidden flex-1 items-center gap-1 lg:flex">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              aria-current={isActive(l.href) ? 'page' : undefined}
              className={cn(
                'rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground',
                isActive(l.href) && 'text-foreground'
              )}
            >
              {l.label}
            </Link>
          ))}
        </nav>

        {/* Right side controls */}
        <div className="ml-auto flex items-center gap-1.5">
          <Button variant="ghost" size="icon" asChild aria-label="Cart">
            <Link href="/cart">
              <ShoppingCart />
            </Link>
          </Button>

          {/* Desktop User Menu */}
          <div className="hidden items-center gap-2 lg:flex">
            {isLoading ? (
              <Skeleton className="size-8 rounded-full" />
            ) : isAuthenticated && user ? (
              <UserMenu
                user={user as SessionUser}
                isAdmin={isAdmin}
                adminUrl={adminUrl}
                onSignOut={logout}
              />
            ) : (
              <>
                <Button variant="ghost" asChild>
                  <Link href="/auth/signin">Sign in</Link>
                </Button>
                <Button asChild>
                  <Link href="/order">Order prints</Link>
                </Button>
              </>
            )}
          </div>

          {/* Mobile Menu Drawer */}
          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Open menu">
                <Menu />
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="flex flex-col w-84 p-0">
              <SheetHeader className="border-b px-4 py-3">
                <SheetTitle className="text-left text-base font-semibold">{name}</SheetTitle>
              </SheetHeader>

              <div className="flex-1 overflow-y-auto">
                {/* 1. Signed-In User Card at Top */}
                {isAuthenticated && user ? (
                  <div className="border-b p-4 bg-muted/40">
                    <div className="flex items-center gap-3">
                      <Avatar className="size-10">
                        {(user as SessionUser).image ? (
                          <AvatarImage src={(user as SessionUser).image || undefined} alt="" />
                        ) : null}
                        <AvatarFallback className="bg-accent text-xs font-semibold text-accent-foreground">
                          {initials(user as SessionUser)}
                        </AvatarFallback>
                      </Avatar>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-sm font-semibold">{user.name || 'Your account'}</span>
                          {isAdmin && (
                            <Badge variant="secondary" className="text-[10px] h-4 px-1.5 font-bold shrink-0">
                              Admin
                            </Badge>
                          )}
                          {(user as SessionUser).role === 'partner' && (
                            <Badge variant="outline" className="text-[10px] h-4 px-1.5 shrink-0">
                              Partner
                            </Badge>
                          )}
                        </div>
                        <div className="truncate text-xs text-muted-foreground">{user.email}</div>
                      </div>
                    </div>
                  </div>
                ) : null}

                {/* 2. Management Section (Admin Portal + Partner Dashboard) */}
                {isAuthenticated && (isAdmin || isPartner) ? (
                  <div className="p-3 border-b space-y-1">
                    <div className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Management
                    </div>
                    {isAdmin && (
                      <Button
                        variant="outline"
                        asChild
                        className="w-full justify-start gap-2.5 h-10 border-primary/40 bg-primary/5 hover:bg-primary/10 text-primary font-medium"
                      >
                        <a href={adminUrl} target="_blank" rel="noopener noreferrer">
                          <Shield className="size-4 text-primary" />
                          <span>Admin portal</span>
                          <ExternalLink className="ml-auto size-3.5 opacity-60" />
                        </a>
                      </Button>
                    )}
                    {isPartner && (
                      <Button
                        variant="outline"
                        asChild
                        className="w-full justify-start gap-2.5 h-10"
                        onClick={() => setOpen(false)}
                      >
                        <Link href="/partner/dashboard">
                          <Store className="size-4" />
                          <span>Partner dashboard</span>
                        </Link>
                      </Button>
                    )}
                  </div>
                ) : null}

                {/* 3. Account Links (when authenticated) */}
                {isAuthenticated && (
                  <div className="p-3 border-b space-y-0.5">
                    <div className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Your Account
                    </div>
                    <Link
                      href="/profile"
                      onClick={() => setOpen(false)}
                      className={cn(
                        'flex items-center gap-3 rounded-md px-2.5 py-2 text-sm font-medium hover:bg-muted',
                        isActive('/profile') && 'bg-accent text-accent-foreground'
                      )}
                    >
                      <User className="size-4 text-muted-foreground" />
                      <span>Profile</span>
                    </Link>
                    <Link
                      href="/my-orders"
                      onClick={() => setOpen(false)}
                      className={cn(
                        'flex items-center gap-3 rounded-md px-2.5 py-2 text-sm font-medium hover:bg-muted',
                        isActive('/my-orders') && 'bg-accent text-accent-foreground'
                      )}
                    >
                      <Package className="size-4 text-muted-foreground" />
                      <span>My orders</span>
                    </Link>
                    <Link
                      href="/my-templates"
                      onClick={() => setOpen(false)}
                      className={cn(
                        'flex items-center gap-3 rounded-md px-2.5 py-2 text-sm font-medium hover:bg-muted',
                        isActive('/my-templates') && 'bg-accent text-accent-foreground'
                      )}
                    >
                      <FileText className="size-4 text-muted-foreground" />
                      <span>My templates</span>
                    </Link>
                  </div>
                )}

                {/* 4. Store Navigation Section */}
                <div className="p-3 space-y-0.5">
                  <div className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Store
                  </div>
                  {links
                    .filter((l) => l.href !== '/my-orders' && l.href !== '/my-templates')
                    .map((l) => (
                      <Link
                        key={l.href}
                        href={l.href}
                        onClick={() => setOpen(false)}
                        aria-current={isActive(l.href) ? 'page' : undefined}
                        className={cn(
                          'flex items-center rounded-md px-2.5 py-2 text-sm font-medium hover:bg-muted',
                          isActive(l.href) ? 'bg-accent text-accent-foreground' : 'text-foreground'
                        )}
                      >
                        {l.label}
                      </Link>
                    ))}
                </div>
              </div>

              {/* Bottom Footer Actions */}
              <div className="border-t p-4 bg-background">
                {isAuthenticated ? (
                  <Button
                    variant="ghost"
                    className="w-full justify-start gap-2.5 text-destructive hover:text-destructive hover:bg-destructive/10"
                    onClick={() => {
                      setOpen(false);
                      logout();
                    }}
                  >
                    <LogOut className="size-4" />
                    <span>Sign out</span>
                  </Button>
                ) : (
                  <div className="flex flex-col gap-2">
                    <Button asChild onClick={() => setOpen(false)}>
                      <Link href="/auth/signin">Sign in</Link>
                    </Button>
                    <Button variant="outline" asChild onClick={() => setOpen(false)}>
                      <Link href="/auth/signup">Create account</Link>
                    </Button>
                  </div>
                )}
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </header>
  );
}
