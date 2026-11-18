'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { LogOut, Menu, Package, Printer, ShoppingCart, Store, User, LayoutDashboard, Shield, FileText } from 'lucide-react';
import { useAdminInfo } from '@/hooks/useAdminInfo';
import { useAuth } from '@/hooks/useAuth';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
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

type SessionUser = { name?: string | null; email?: string | null; image?: string | null; role?: string; profilePicture?: string };

const LINKS = [
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

function UserMenu({ user, onSignOut }: { user: SessionUser; onSignOut: () => void }) {
  const image = user.image || user.profilePicture || undefined;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="rounded-full" aria-label="Account menu">
          <Avatar className="size-8">
            {image ? <AvatarImage src={image} alt="" /> : null}
            <AvatarFallback className="bg-accent text-xs font-semibold text-accent-foreground">{initials(user)}</AvatarFallback>
          </Avatar>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel className="font-normal">
          <div className="truncate text-sm font-medium">{user.name || 'Your account'}</div>
          <div className="truncate text-xs text-muted-foreground">{user.email}</div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild><Link href="/profile"><User />Profile</Link></DropdownMenuItem>
        <DropdownMenuItem asChild><Link href="/my-orders"><Package />My orders</Link></DropdownMenuItem>
        <DropdownMenuItem asChild><Link href="/my-templates"><FileText />My templates</Link></DropdownMenuItem>
        {user.role === 'partner' || user.role === 'admin' ? (
          <DropdownMenuItem asChild><Link href="/partner/dashboard"><Store />Partner dashboard</Link></DropdownMenuItem>
        ) : null}
        {user.role === 'admin' ? (
          <DropdownMenuItem asChild><Link href="/admin"><Shield />Admin</Link></DropdownMenuItem>
        ) : null}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onSignOut}><LogOut />Sign out</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export default function Navbar() {
  const { adminInfo } = useAdminInfo();
  const { user, isAuthenticated, isLoading, logout } = useAuth();
  const isActive = useActive();
  const [open, setOpen] = useState(false);
  const name = adminInfo?.name || 'Fun Printing';
  const links = LINKS.filter((l) => !l.requireAuth || isAuthenticated);

  return (
    <header className="sticky top-0 z-50 border-b bg-background/80 backdrop-blur-md supports-[backdrop-filter]:bg-background/70">
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-4 px-4 sm:px-6 lg:px-8">
        <Link href="/" className="flex shrink-0 items-center gap-2 rounded-md font-semibold tracking-tight">
          <span className="grid size-8 place-items-center rounded-lg bg-primary text-primary-foreground">
            <Printer className="size-4" aria-hidden />
          </span>
          <span className="text-lg">{name}</span>
        </Link>

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

        <div className="ml-auto flex items-center gap-1.5">
          <Button variant="ghost" size="icon" asChild aria-label="Cart">
            <Link href="/cart"><ShoppingCart /></Link>
          </Button>
          <div className="hidden items-center gap-2 lg:flex">
            {isLoading ? (
              <Skeleton className="size-8 rounded-full" />
            ) : isAuthenticated && user ? (
              <UserMenu user={user as SessionUser} onSignOut={logout} />
            ) : (
              <>
                <Button variant="ghost" asChild><Link href="/auth/signin">Sign in</Link></Button>
                <Button asChild><Link href="/order">Order prints</Link></Button>
              </>
            )}
          </div>

          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Open menu"><Menu /></Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-80 gap-0 p-0">
              <SheetHeader className="border-b">
                <SheetTitle className="text-left">{name}</SheetTitle>
              </SheetHeader>
              <nav aria-label="Main" className="flex flex-col gap-1 p-3">
                {links.map((l) => (
                  <Link
                    key={l.href}
                    href={l.href}
                    onClick={() => setOpen(false)}
                    aria-current={isActive(l.href) ? 'page' : undefined}
                    className={cn('rounded-md px-3 py-2.5 text-sm font-medium hover:bg-muted', isActive(l.href) ? 'bg-accent text-accent-foreground' : 'text-foreground')}
                  >
                    {l.label}
                  </Link>
                ))}
              </nav>
              <Separator />
              <div className="flex flex-col gap-2 p-4">
                {isAuthenticated && user ? (
                  <>
                    <div className="flex items-center gap-3 pb-2">
                      <Avatar className="size-9">
                        {(user as SessionUser).image ? <AvatarImage src={(user as SessionUser).image || undefined} alt="" /> : null}
                        <AvatarFallback className="bg-accent text-xs font-semibold text-accent-foreground">{initials(user as SessionUser)}</AvatarFallback>
                      </Avatar>
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">{user.name || 'Your account'}</div>
                        <div className="truncate text-xs text-muted-foreground">{user.email}</div>
                      </div>
                    </div>
                    <Button variant="outline" asChild onClick={() => setOpen(false)}><Link href="/profile"><User />Profile</Link></Button>
                    {(user as SessionUser).role === 'partner' || (user as SessionUser).role === 'admin' ? (
                      <Button variant="outline" asChild onClick={() => setOpen(false)}><Link href="/partner/dashboard"><LayoutDashboard />Partner dashboard</Link></Button>
                    ) : null}
                    <Button variant="ghost" onClick={() => { setOpen(false); logout(); }}><LogOut />Sign out</Button>
                  </>
                ) : (
                  <>
                    <Button asChild onClick={() => setOpen(false)}><Link href="/auth/signin">Sign in</Link></Button>
                    <Button variant="outline" asChild onClick={() => setOpen(false)}><Link href="/auth/signup">Create account</Link></Button>
                  </>
                )}
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </header>
  );
}
