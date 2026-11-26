'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Printer } from 'lucide-react';
import { isInAppBrowser } from '@/lib/authErrors';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

/** Centered card used by sign-in, sign-up and password pages. */
export function AuthShell({ title, description, children, footer }: { title: string; description?: React.ReactNode; children: React.ReactNode; footer?: React.ReactNode }) {
  return (
    <div className="relative flex min-h-[calc(100svh-4rem)] items-center justify-center px-4 py-12">
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(50%_40%_at_50%_0%,var(--accent),transparent)]" />
      <div className="relative w-full max-w-md space-y-6">
        <Card className="shadow-lg">
          <CardHeader className="items-center text-center">
            <span className="mx-auto mb-2 grid size-11 place-items-center rounded-xl bg-primary text-primary-foreground"><Printer className="size-5" aria-hidden /></span>
            <CardTitle className="text-2xl">{title}</CardTitle>
            {description ? <CardDescription>{description}</CardDescription> : null}
          </CardHeader>
          <CardContent className="space-y-5">{children}</CardContent>
        </Card>
        {footer ? <div className="text-center text-sm text-muted-foreground">{footer}</div> : null}
      </div>
    </div>
  );
}

export function GoogleButton({ onClick, disabled, children = 'Continue with Google' }: { onClick: () => void; disabled?: boolean; children?: React.ReactNode }) {
  const [inApp, setInApp] = useState(false);
  useEffect(() => {
    setInApp(isInAppBrowser());
  }, []);

  return (
    <div className="space-y-1.5">
      <Button type="button" variant="outline" className="h-11 w-full" onClick={onClick} disabled={disabled}>
        <svg viewBox="0 0 24 24" className="size-4" aria-hidden>
          <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
          <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
          <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
          <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
        </svg>
        {children}
      </Button>
      {inApp ? (
        <p className="text-center text-xs text-muted-foreground">
          Opened inside an app? If Google sign-in fails, open in Chrome/Safari or use email below.
        </p>
      ) : null}
    </div>
  );
}

export function OrDivider() {
  return (
    <div className="flex items-center gap-3 text-xs text-muted-foreground">
      <span className="h-px flex-1 bg-border" />or<span className="h-px flex-1 bg-border" />
    </div>
  );
}

export function BackHome() {
  return <Link href="/" className="hover:text-foreground">← Back to home</Link>;
}
