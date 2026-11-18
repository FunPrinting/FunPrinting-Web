'use client';

import Link from 'next/link';
import { Mail, Phone } from 'lucide-react';
import { useAdminInfo } from '@/hooks/useAdminInfo';
import { LEGAL_UPDATED } from '@/lib/legal';
import { Card, CardContent } from '@/components/ui/card';

/** Layout for the policy pages: title, last-updated date, numbered sections. */
export function LegalPage({ title, intro, sections, children }: { title: string; intro?: React.ReactNode; sections: Array<{ id: string; title: string }>; children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
      <h1 className="text-3xl font-semibold">{title}</h1>
      <p className="mt-2 text-sm text-muted-foreground">Last updated {LEGAL_UPDATED}</p>
      {intro ? <p className="mt-4 text-muted-foreground">{intro}</p> : null}

      <nav aria-label="On this page" className="mt-6 rounded-lg border bg-muted/30 p-4">
        <p className="mb-2 text-sm font-medium">On this page</p>
        <ol className="grid gap-1 text-sm sm:grid-cols-2">
          {sections.map((s, i) => (
            <li key={s.id}><a href={`#${s.id}`} className="text-muted-foreground hover:text-foreground hover:underline">{i + 1}. {s.title}</a></li>
          ))}
        </ol>
      </nav>

      <div className="mt-8 space-y-10">{children}</div>
    </div>
  );
}

export function LegalSection({ id, n, title, children }: { id: string; n: number; title: string; children: React.ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-h`} className="scroll-mt-24 space-y-3 leading-7 text-muted-foreground [&_a]:text-primary [&_a]:underline-offset-2 hover:[&_a]:underline [&_li]:pl-1 [&_ol]:list-decimal [&_ol]:space-y-1 [&_ol]:pl-6 [&_strong]:font-medium [&_strong]:text-foreground [&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:pl-6">
      <h2 id={`${id}-h`} className="text-xl font-semibold text-foreground">{n}. {title}</h2>
      {children}
    </section>
  );
}

/** Highlighted note inside a section. */
export function Callout({ children }: { children: React.ReactNode }) {
  return <div className="rounded-lg border-l-4 border-primary bg-accent/40 p-4 text-sm text-foreground">{children}</div>;
}

/** Contact details from Site info; shows only what has been filled in. */
export function ContactBlock({ hours }: { hours?: boolean }) {
  const { adminInfo } = useAdminInfo();
  const h = adminInfo?.businessHours;
  const open = !h ? '' : h.monday === h.saturday ? h.monday : `${h.monday} to ${h.saturday}`;
  return (
    <Card>
      <CardContent className="space-y-2 text-sm">
        {adminInfo?.email ? <p className="flex items-center gap-2"><Mail className="size-4 text-muted-foreground" aria-hidden /><a href={`mailto:${adminInfo.email}`}>{adminInfo.email}</a></p> : null}
        {adminInfo?.phone ? <p className="flex items-center gap-2"><Phone className="size-4 text-muted-foreground" aria-hidden /><a href={`tel:${adminInfo.phone}`}>{adminInfo.phone}</a></p> : null}
        {hours && open ? <p className="text-muted-foreground">Support hours: {open}</p> : null}
        <p className="text-muted-foreground">Or use the <Link href="/contact" className="text-primary hover:underline">contact page</Link> and quote your order number.</p>
      </CardContent>
    </Card>
  );
}
