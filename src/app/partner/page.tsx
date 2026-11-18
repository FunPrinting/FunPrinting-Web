import Link from 'next/link';
import { Bike, CircleDollarSign, ClipboardCheck, Download, Laptop, Printer, Smartphone, Store } from 'lucide-react';
import { PARTNER_APP_RELEASES } from '@/lib/partnerApps';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

const STEPS = [
  { icon: ClipboardCheck, title: 'Apply', text: 'Sign in and add your shop: name, address and location. We review every shop before it goes live.' },
  { icon: Store, title: 'Set up your shop', text: 'Set your prices for B&W, colour and binding. Choose whether you accept each order by hand or automatically, and whether you offer delivery.' },
  { icon: Printer, title: 'Print orders', text: 'Paid orders arrive in the desktop or phone app and print on your printer. Mark them ready when they are done.' },
  { icon: CircleDollarSign, title: 'Get paid', text: 'Your share goes to your linked Razorpay account after each order is printed.' },
];

const FAQ = [
  { q: 'What do I need?', a: 'A printer connected to a Windows or Mac computer, or a Wi-Fi printer that your Android phone can reach. The app helps you choose the printer.' },
  { q: 'How much do I earn?', a: 'You keep 90% of the printing price. If you deliver an order yourself, the delivery fee is yours too. The 3% processing fee is added for the customer and is not taken from you.' },
  { q: 'Do I have to deliver?', a: 'No. Delivery is optional and off until you turn it on. You can offer your own delivery within a distance you set, courier pickup from your shop, or neither.' },
  { q: 'What if I cannot take an order?', a: 'Decline it and the customer is refunded straight away. If an order is not accepted within 10 minutes the customer can choose a refund, and after 24 hours it is refunded automatically.' },
  { q: 'Can I run it on more than one device?', a: 'Yes. Sign in on several computers or phones. Each order is printed by one device at a time, and you can sign devices out from the dashboard.' },
];

export default function PartnerPage() {
  return (
    <div className="pb-20">
      <section className="border-b bg-[radial-gradient(60%_50%_at_50%_0%,var(--accent),transparent)]">
        <div className="mx-auto max-w-4xl px-4 py-20 text-center sm:px-6">
          <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">Get print orders from customers near you</h1>
          <p className="mx-auto mt-5 max-w-2xl text-lg text-muted-foreground">
            Join Fun Printing as a print shop. Customers find you on the map, pay online, and your orders print on your own printer. You set the prices.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Button size="lg" asChild><Link href="/auth/signin?callbackUrl=/partner/dashboard">Become a partner</Link></Button>
            <Button size="lg" variant="outline" asChild><a href="#download"><Download />Get the apps</a></Button>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6" aria-labelledby="how">
        <h2 id="how" className="text-center text-2xl font-semibold">How it works</h2>
        <ol className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((s, i) => (
            <li key={s.title}>
              <Card className="h-full">
                <CardHeader>
                  <span className="grid size-10 place-items-center rounded-lg bg-accent text-accent-foreground"><s.icon className="size-5" aria-hidden /></span>
                  <CardTitle className="mt-2 text-base"><span className="text-muted-foreground">{i + 1}.</span> {s.title}</CardTitle>
                  <CardDescription>{s.text}</CardDescription>
                </CardHeader>
              </Card>
            </li>
          ))}
        </ol>
      </section>

      <section className="mx-auto max-w-6xl px-4 sm:px-6" aria-labelledby="delivery">
        <Card>
          <CardContent className="flex flex-col items-start gap-4 pt-6 sm:flex-row sm:items-center">
            <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-accent text-accent-foreground"><Bike className="size-6" aria-hidden /></span>
            <div className="flex-1">
              <h2 id="delivery" className="font-semibold">Deliver if you want to</h2>
              <p className="text-sm text-muted-foreground">Offer home delivery within your own radius and keep the whole delivery fee, or let a courier collect parcels from your shop. Customers confirm delivery with a 4-digit code. Shops that don’t deliver simply stay pickup-only.</p>
            </div>
          </CardContent>
        </Card>
      </section>

      <section id="download" className="mx-auto max-w-4xl scroll-mt-24 px-4 py-16 text-center sm:px-6" aria-labelledby="apps">
        <h2 id="apps" className="text-2xl font-semibold">Get the partner apps</h2>
        <p className="mt-2 text-muted-foreground">Install an app, then sign in with your shop account. You can use the apps once your shop is approved.</p>
        <div className="mt-8 grid gap-4 sm:grid-cols-3">
          {[
            { icon: Laptop, name: 'Windows', href: PARTNER_APP_RELEASES.windows },
            { icon: Laptop, name: 'macOS', href: PARTNER_APP_RELEASES.mac },
            { icon: Smartphone, name: 'Android', href: PARTNER_APP_RELEASES.android },
          ].map((a) => (
            <Button key={a.name} variant="outline" size="lg" className="h-auto flex-col gap-2 py-5" asChild>
              <a href={a.href}><a.icon className="size-6" aria-hidden />{a.name}<span className="text-xs font-normal text-muted-foreground">Download</span></a>
            </Button>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-3xl px-4 sm:px-6" aria-labelledby="faq">
        <h2 id="faq" className="text-2xl font-semibold">Questions</h2>
        <div className="mt-4 divide-y rounded-xl border">
          {FAQ.map((f) => (
            <details key={f.q} className="p-4">
              <summary className="cursor-pointer list-none font-medium marker:hidden [&::-webkit-details-marker]:hidden">{f.q}</summary>
              <p className="mt-2 text-sm text-muted-foreground">{f.a}</p>
            </details>
          ))}
        </div>
        <p className="mt-6 text-center text-sm text-muted-foreground">More questions? <Link href="/contact" className="text-primary hover:underline">Contact us</Link>.</p>
      </section>
    </div>
  );
}
