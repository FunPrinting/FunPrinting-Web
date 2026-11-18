'use client';

import Link from 'next/link';
import { useEffect } from 'react';
import {
  ArrowRight,
  BookOpen,
  Clock,
  FileText,
  MapPin,
  Palette,
  Printer,
  ShieldCheck,
  Store,
  Truck,
  Upload,
  Wallet,
} from 'lucide-react';
import { generateLocalBusinessStructuredData, generateOrganizationStructuredData, generateServiceStructuredData, combineStructuredData } from '@/lib/seo';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

const STEPS = [
  { icon: Upload, title: 'Upload your files', text: 'PDF, Word or images. Choose colour, sides, copies and binding for each file.' },
  { icon: MapPin, title: 'Pick a nearby shop', text: 'See the shops around you and their prices. You pay the exact amount shown.' },
  { icon: Printer, title: 'Collect or get it delivered', text: 'The shop prints straight away. Pick it up, or have it delivered to your hostel.' },
];

const SERVICES = [
  { icon: Printer, title: 'Black & white', text: 'Notes, assignments, reports and lab records.' },
  { icon: Palette, title: 'Colour', text: 'Presentations, posters and project covers. Mix colour and B&W pages in one file.' },
  { icon: BookOpen, title: 'Binding', text: 'Spiral or soft binding for theses and project reports.' },
  { icon: FileText, title: 'Templates', text: 'Fill in a ready-made cover page, resume or lab format and print it.' },
];

const TRUST = [
  { icon: ShieldCheck, text: 'Secure payment with Razorpay' },
  { icon: Clock, text: 'Refund if the shop doesn’t take your order' },
  { icon: Truck, text: 'Pickup or delivery' },
];

export default function Home() {
  // Structured data for search engines
  useEffect(() => {
    (async () => {
      try {
        const adminData = await (await fetch('/api/admin/info')).json();
        const info = adminData.success ? adminData.admin : null;
        const data = combineStructuredData(
          generateLocalBusinessStructuredData(info),
          generateOrganizationStructuredData(info),
          generateServiceStructuredData('Black and White Printing', 'Black and white printing for documents, assignments and reports'),
          generateServiceStructuredData('Color Printing', 'Colour printing for presentations, posters and project covers'),
          generateServiceStructuredData('Document Binding', 'Binding for reports, theses and documents')
        );
        document.querySelectorAll('script[type="application/ld+json"][data-seo="true"]').forEach((s) => s.remove());
        data.forEach((d, i) => {
          const s = document.createElement('script');
          s.type = 'application/ld+json';
          s.dataset.seo = 'true';
          s.id = `structured-data-${i}`;
          s.textContent = JSON.stringify(d);
          document.head.appendChild(s);
        });
      } catch {
        // structured data is optional
      }
    })();
  }, []);

  return (
    <div>
      {/* Hero */}
      <section className="relative overflow-hidden border-b">
        <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_50%_at_50%_0%,var(--accent),transparent)]" />
        <div className="relative mx-auto max-w-7xl px-4 pt-20 pb-16 text-center sm:px-6 sm:pt-28 lg:px-8">
          <Badge variant="secondary" className="mb-6 gap-1.5 rounded-full px-3 py-1">
            <Store className="size-3.5" aria-hidden />
            Print shops near your campus
          </Badge>
          <h1 className="mx-auto max-w-3xl text-4xl font-semibold sm:text-6xl">Print your documents without the queue</h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg text-muted-foreground">
            Upload your files, choose a nearby print shop and pay online. Collect your prints when they are ready, or get them delivered.
          </p>
          <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Button size="lg" asChild className="h-12 px-6 text-base">
              <Link href="/order">Upload & print <ArrowRight /></Link>
            </Button>
            <Button size="lg" variant="outline" asChild className="h-12 px-6 text-base">
              <Link href="/templates">Browse templates</Link>
            </Button>
          </div>
          <ul className="mt-10 flex flex-wrap items-center justify-center gap-x-8 gap-y-3 text-sm text-muted-foreground">
            {TRUST.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-center gap-2"><Icon className="size-4 text-primary" aria-hidden />{text}</li>
            ))}
          </ul>
        </div>
      </section>

      {/* How it works */}
      <section className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8" aria-labelledby="how">
        <div className="max-w-2xl">
          <h2 id="how" className="text-3xl font-semibold">How it works</h2>
          <p className="mt-3 text-muted-foreground">Three steps from your laptop to printed pages.</p>
        </div>
        <ol className="mt-10 grid gap-6 md:grid-cols-3">
          {STEPS.map(({ icon: Icon, title, text }, i) => (
            <li key={title}>
              <Card className="h-full">
                <CardHeader>
                  <div className="flex items-center gap-3">
                    <span className="grid size-10 place-items-center rounded-xl bg-accent text-accent-foreground"><Icon className="size-5" aria-hidden /></span>
                    <span className="text-sm font-medium text-muted-foreground">Step {i + 1}</span>
                  </div>
                  <CardTitle className="pt-3 text-lg">{title}</CardTitle>
                  <CardDescription>{text}</CardDescription>
                </CardHeader>
              </Card>
            </li>
          ))}
        </ol>
      </section>

      {/* Services */}
      <section className="border-y bg-card" aria-labelledby="services">
        <div className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8">
          <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
            <div className="max-w-2xl">
              <h2 id="services" className="text-3xl font-semibold">What you can print</h2>
              <p className="mt-3 text-muted-foreground">Each shop sets its own prices. You see the full price, per file, before you pay.</p>
            </div>
            <Button variant="outline" asChild><Link href="/order">See prices near you <ArrowRight /></Link></Button>
          </div>
          <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {SERVICES.map(({ icon: Icon, title, text }) => (
              <Card key={title} className="bg-background">
                <CardHeader>
                  <Icon className="size-6 text-primary" aria-hidden />
                  <CardTitle className="pt-2">{title}</CardTitle>
                  <CardDescription>{text}</CardDescription>
                </CardHeader>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* Two audiences */}
      <section className="mx-auto grid max-w-7xl gap-6 px-4 py-20 sm:px-6 lg:grid-cols-2 lg:px-8">
        <Card className="justify-between">
          <CardHeader>
            <Wallet className="size-6 text-primary" aria-hidden />
            <CardTitle className="pt-2 text-xl">Earn from your templates</CardTitle>
            <CardDescription className="text-base">
              Upload a Word template with fields like {'{{name}}'} and set a price. You earn each time someone uses it, paid to your UPI or bank account.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-3">
            <Button asChild><Link href="/templates/create">Create a template</Link></Button>
            <Button variant="ghost" asChild><Link href="/my-templates">Manage my templates</Link></Button>
          </CardContent>
        </Card>
        <Card className="justify-between">
          <CardHeader>
            <Store className="size-6 text-primary" aria-hidden />
            <CardTitle className="pt-2 text-xl">Run a print shop?</CardTitle>
            <CardDescription className="text-base">
              Get orders from students nearby. Paid orders print on your computer automatically, and your share is paid to your bank account.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="outline" asChild><Link href="/partner">Become a partner <ArrowRight /></Link></Button>
          </CardContent>
        </Card>
      </section>

      {/* Final CTA */}
      <section className="px-4 pb-20 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl rounded-3xl bg-primary px-6 py-14 text-center text-primary-foreground sm:px-12">
          <h2 className="text-3xl font-semibold">Ready to print?</h2>
          <p className="mx-auto mt-3 max-w-xl text-primary-foreground/80">Upload your files now. It takes about a minute.</p>
          <Button size="lg" variant="secondary" asChild className="mt-8 h-12 px-6 text-base">
            <Link href="/order">Start an order <ArrowRight /></Link>
          </Button>
        </div>
      </section>
    </div>
  );
}
