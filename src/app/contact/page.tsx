'use client';

import Link from 'next/link';
import { useState } from 'react';
import { CheckCircle2, Clock, Loader2, Mail, MapPin, Phone } from 'lucide-react';
import { useAdminInfo } from '@/hooks/useAdminInfo';
import { CONTACT_TOPICS, type ContactTopic } from '@/lib/contactTopics';
import { PhoneNotice } from '@/components/PhoneNotice';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';

const FAQ = [
  { q: 'How do I track my order?', a: <>Open <Link href="/my-orders" className="text-primary hover:underline">My orders</Link> after signing in. Each order shows its steps and, for courier deliveries, a tracking link.</> },
  { q: 'Which payment methods work?', a: 'UPI, cards, net banking and wallets, through Razorpay.' },
  { q: 'Can I cancel an order?', a: <>Unpaid orders can be cancelled in My orders. If the shop does not accept a paid order you are refunded. See the <Link href="/cancellation-refund" className="text-primary hover:underline">refund policy</Link>.</> },
  { q: 'Which files can I print?', a: 'PDF, Word documents and images (JPG, PNG, WebP and more), up to 50 MB each.' },
  { q: 'I run a print shop. Can I join?', a: <>Yes. See the <Link href="/partner" className="text-primary hover:underline">partner program</Link>.</> },
];

function Detail({ icon: Icon, title, children }: { icon: React.ElementType; title: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-accent text-accent-foreground"><Icon className="size-4" aria-hidden /></span>
      <div className="text-sm">
        <p className="font-medium">{title}</p>
        <div className="text-muted-foreground">{children}</div>
      </div>
    </div>
  );
}

export default function ContactPage() {
  const { adminInfo, loading } = useAdminInfo();
  const [form, setForm] = useState({ name: '', email: '', phone: '', topic: '' as ContactTopic | '', message: '', website: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/contact', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success) setSent(true);
      else setError(data.error || 'We couldn’t send your message. Please try again.');
    } catch {
      setError('We couldn’t reach the server. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  };

  const h = adminInfo?.businessHours;
  const address = adminInfo?.address ? [adminInfo.address, adminInfo.city, [adminInfo.state, adminInfo.pincode].filter(Boolean).join(' ')].filter(Boolean).join(', ') : '';

  return (
    <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
      <h1 className="text-3xl font-semibold">Contact us</h1>
      <p className="mt-2 text-muted-foreground">Questions about an order, a payment or a delivery? Send us a message. Have your order number ready.</p>

      <div className="mt-8 grid gap-6 lg:grid-cols-5">
        <Card className="h-fit lg:col-span-2">
          <CardHeader><CardTitle>Reach us</CardTitle></CardHeader>
          <CardContent className="space-y-5">
            {loading ? (
              [0, 1, 2].map((i) => <Skeleton key={i} className="h-10" />)
            ) : (
              <>
                {adminInfo?.phone ? <Detail icon={Phone} title="Phone"><a href={`tel:${adminInfo.phone}`} className="hover:text-foreground">{adminInfo.phone}</a></Detail> : null}
                {adminInfo?.email ? <Detail icon={Mail} title="Email"><a href={`mailto:${adminInfo.email}`} className="break-all hover:text-foreground">{adminInfo.email}</a></Detail> : null}
                {address ? <Detail icon={MapPin} title="Address">{address}</Detail> : null}
                {h ? (
                  <Detail icon={Clock} title="Hours">
                    <dl className="grid grid-cols-[auto_1fr] gap-x-3">
                      {(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] as const).map((d) => (
                        <div key={d} className="contents"><dt className="capitalize">{d}</dt><dd>{h[d] || 'Closed'}</dd></div>
                      ))}
                    </dl>
                  </Detail>
                ) : null}
                {!adminInfo?.phone && !adminInfo?.email ? <p className="text-sm text-muted-foreground">Use the form to reach us.</p> : null}
              </>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle>Send a message</CardTitle>
            <CardDescription>We’ll reply to the email address you enter.</CardDescription>
          </CardHeader>
          <CardContent>
            {sent ? (
              <div className="flex flex-col items-center gap-3 py-8 text-center" role="status">
                <CheckCircle2 className="size-10 text-success" aria-hidden />
                <p className="font-medium">Message sent</p>
                <p className="max-w-sm text-sm text-muted-foreground">Thank you. We’ll reply to {form.email} as soon as we can.</p>
                <Button variant="outline" onClick={() => { setSent(false); setForm({ name: '', email: '', phone: '', topic: '', message: '', website: '' }); }}>Send another</Button>
              </div>
            ) : (
              <form className="space-y-4" onSubmit={submit}>
                {error ? <Alert variant="destructive" role="alert"><AlertDescription>{error}</AlertDescription></Alert> : null}
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="name">Your name</Label>
                    <Input id="name" autoComplete="name" required maxLength={100} value={form.name} onChange={set('name')} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="email">Email</Label>
                    <Input id="email" type="email" autoComplete="email" required value={form.email} onChange={set('email')} />
                  </div>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="phone">Mobile number</Label>
                    <Input id="phone" type="tel" inputMode="tel" autoComplete="tel" required placeholder="98765 43210" value={form.phone} onChange={set('phone')} aria-describedby="phone-hint" />
                    <PhoneNotice id="phone-hint" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="topic">What is it about?</Label>
                    <select id="topic" required value={form.topic} onChange={set('topic')} className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50">
                      <option value="" disabled>Choose a topic</option>
                      {Object.entries(CONTACT_TOPICS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="message">Message</Label>
                  <Textarea id="message" required minLength={10} maxLength={3000} rows={6} value={form.message} onChange={set('message')} placeholder="Tell us what happened. Include your order number if you have one." />
                </div>
                {/* Spam trap: hidden from people and screen readers */}
                <div aria-hidden className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
                  <label>Website<input tabIndex={-1} autoComplete="off" value={form.website} onChange={set('website')} /></label>
                </div>
                <Button type="submit" size="lg" disabled={busy}>{busy ? <Loader2 className="animate-spin" /> : null}Send message</Button>
              </form>
            )}
          </CardContent>
        </Card>
      </div>

      <section className="mt-12" aria-labelledby="faq">
        <h2 id="faq" className="text-xl font-semibold">Common questions</h2>
        <div className="mt-4 divide-y rounded-xl border">
          {FAQ.map((f) => (
            <details key={f.q} className="group p-4">
              <summary className="cursor-pointer list-none font-medium marker:hidden [&::-webkit-details-marker]:hidden">{f.q}</summary>
              <p className="mt-2 text-sm text-muted-foreground">{f.a}</p>
            </details>
          ))}
        </div>
      </section>
    </div>
  );
}
