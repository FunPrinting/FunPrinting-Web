'use client';

import Link from 'next/link';
import { Clock, Globe, Mail, MapPin, Phone, Printer } from 'lucide-react';
import { useAdminInfo } from '@/hooks/useAdminInfo';
import { FacebookIcon, InstagramIcon, LinkedInIcon, TwitterIcon, YouTubeIcon } from '@/components/SocialIcons';

const SERVICE = [
  { href: '/order', label: 'Order prints' },
  { href: '/templates', label: 'Templates' },
  { href: '/my-orders', label: 'Track an order' },
  { href: '/partner', label: 'Become a partner' },
];

const POLICIES = [
  { href: '/terms', label: 'Terms & conditions' },
  { href: '/privacy', label: 'Privacy policy' },
  { href: '/cancellation-refund', label: 'Cancellation & refund' },
  { href: '/return-policy', label: 'Return policy' },
  { href: '/shipping-delivery', label: 'Shipping & delivery' },
  { href: '/contact', label: 'Contact us' },
];

const SOCIAL = [
  { key: 'facebook', label: 'Facebook', Icon: FacebookIcon },
  { key: 'instagram', label: 'Instagram', Icon: InstagramIcon },
  { key: 'twitter', label: 'Twitter', Icon: TwitterIcon },
  { key: 'linkedin', label: 'LinkedIn', Icon: LinkedInIcon },
  { key: 'youtube', label: 'YouTube', Icon: YouTubeIcon },
] as const;

function LinkList({ title, links }: { title: string; links: { href: string; label: string }[] }) {
  return (
    <div>
      <h3 className="text-sm font-semibold">{title}</h3>
      <ul className="mt-3 space-y-2">
        {links.map((l) => (
          <li key={l.href}>
            <Link href={l.href} className="text-sm text-muted-foreground transition-colors hover:text-foreground">{l.label}</Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Contact details and social links come from Admin → Site info; nothing is shown that isn't set there. */
export default function Footer() {
  const { adminInfo: info } = useAdminInfo();
  const name = info?.name || 'Fun Printing';
  const social = SOCIAL.filter((s) => info?.socialMedia?.[s.key]);
  const address = info?.address ? [info.address, info.city, info.state, info.pincode].filter(Boolean).join(', ') : '';
  const hours = info?.businessHours?.monday ? `${info.businessHours.monday}${info.businessHours.saturday && info.businessHours.saturday !== info.businessHours.monday ? ` · Sat ${info.businessHours.saturday}` : ''}` : '';

  return (
    <footer className="border-t bg-card">
      <div className="mx-auto grid max-w-7xl gap-10 px-4 py-12 sm:px-6 md:grid-cols-2 lg:grid-cols-4 lg:px-8">
        <div className="space-y-4">
          <Link href="/" className="inline-flex items-center gap-2 font-semibold">
            <span className="grid size-8 place-items-center rounded-lg bg-primary text-primary-foreground"><Printer className="size-4" aria-hidden /></span>
            {name}
          </Link>
          <p className="max-w-xs text-sm text-muted-foreground">
            {info?.description || 'Upload your documents, pick a nearby print shop and collect your prints, or get them delivered.'}
          </p>
          {social.length ? (
            <div className="flex gap-3">
              {social.map(({ key, label, Icon }) => (
                <a key={key} href={info!.socialMedia![key]} target="_blank" rel="noopener noreferrer" aria-label={label} className="text-muted-foreground transition-colors hover:text-foreground">
                  <Icon size={20} className="size-5" />
                </a>
              ))}
            </div>
          ) : null}
        </div>

        <LinkList title="Service" links={SERVICE} />
        <LinkList title="Policies" links={POLICIES} />

        <div>
          <h3 className="text-sm font-semibold">Contact</h3>
          <ul className="mt-3 space-y-2.5 text-sm text-muted-foreground">
            {address ? <li className="flex gap-2"><MapPin className="mt-0.5 size-4 shrink-0" aria-hidden />{address}</li> : null}
            {info?.email ? <li className="flex gap-2"><Mail className="mt-0.5 size-4 shrink-0" aria-hidden /><a href={`mailto:${info.email}`} className="hover:text-foreground">{info.email}</a></li> : null}
            {info?.phone ? <li className="flex gap-2"><Phone className="mt-0.5 size-4 shrink-0" aria-hidden /><a href={`tel:${info.phone.replace(/\s+/g, '')}`} className="hover:text-foreground">{info.phone}</a></li> : null}
            {hours ? <li className="flex gap-2"><Clock className="mt-0.5 size-4 shrink-0" aria-hidden />{hours}</li> : null}
            {info?.website ? <li className="flex gap-2"><Globe className="mt-0.5 size-4 shrink-0" aria-hidden /><a href={info.website} target="_blank" rel="noopener noreferrer" className="hover:text-foreground">{info.website.replace(/^https?:\/\//, '')}</a></li> : null}
            {!address && !info?.email && !info?.phone ? <li><Link href="/contact" className="hover:text-foreground">Get in touch</Link></li> : null}
          </ul>
        </div>
      </div>
      <div className="border-t">
        <div className="mx-auto flex max-w-7xl flex-col gap-2 px-4 py-6 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
          <p>© {new Date().getFullYear()} {name}. All rights reserved.</p>
          <p>Payments secured by Razorpay</p>
        </div>
      </div>
    </footer>
  );
}
