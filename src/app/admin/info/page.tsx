'use client';

import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Loader2 } from 'lucide-react';
import { PageHeader } from '@/components/admin/PageHeader';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] as const;
const SOCIAL = ['facebook', 'twitter', 'instagram', 'linkedin', 'youtube'] as const;

interface Info {
  name: string; email: string; phone: string; website: string;
  address: string; city: string; state: string; pincode: string; country: string;
  description: string; logo: string; favicon: string;
  seoTitle: string; seoDescription: string; seoKeywords: string; ogImage: string;
  socialMedia: Record<(typeof SOCIAL)[number], string>;
  businessHours: Record<(typeof DAYS)[number], string>;
  services: {
    colorPrinting: boolean;
    blackAndWhitePrinting: boolean;
    binding: boolean;
    lamination: boolean;
    scanning: boolean;
    photocopying: boolean;
    delivery: boolean;
    plasticFiles: boolean;
    customServices: string[];
  };
}

const EMPTY: Info = {
  name: '', email: '', phone: '', website: '', address: '', city: '', state: '', pincode: '', country: 'India',
  description: '', logo: '', favicon: '', seoTitle: '', seoDescription: '', seoKeywords: '', ogImage: '',
  socialMedia: { facebook: '', twitter: '', instagram: '', linkedin: '', youtube: '' },
  businessHours: { monday: '9:00 AM - 6:00 PM', tuesday: '9:00 AM - 6:00 PM', wednesday: '9:00 AM - 6:00 PM', thursday: '9:00 AM - 6:00 PM', friday: '9:00 AM - 6:00 PM', saturday: '10:00 AM - 4:00 PM', sunday: 'Closed' },
  services: {
    colorPrinting: true,
    blackAndWhitePrinting: true,
    binding: false,
    lamination: false,
    scanning: false,
    photocopying: false,
    delivery: false,
    plasticFiles: false,
    customServices: [],
  },
};

type TextKey = Exclude<keyof Info, 'socialMedia' | 'businessHours' | 'services'>;

export default function AdminInfoPage() {
  const [info, setInfo] = useState<Info | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch('/api/admin/info')
      .then((r) => r.json())
      .then((d) => {
        const a = d.admin ?? {};
        setInfo({
          ...EMPTY,
          ...a,
          socialMedia: { ...EMPTY.socialMedia, ...(a.socialMedia ?? {}) },
          businessHours: { ...EMPTY.businessHours, ...(a.businessHours ?? {}) },
          services: { ...EMPTY.services, ...(a.services ?? {}) },
        });
      })
      .catch(() => {
        setError('We couldn’t load the saved details.');
        setInfo(EMPTY);
      });
  }, []);

  if (!info) return <div className="grid place-items-center py-20"><Loader2 className="size-6 animate-spin text-muted-foreground" aria-label="Loading" /></div>;

  const text = (key: TextKey, label: string, opts: { type?: string; required?: boolean; placeholder?: string; hint?: string; multiline?: boolean; wide?: boolean } = {}) => (
    <div className={`space-y-1.5 ${opts.wide ? 'sm:col-span-2' : ''}`}>
      <Label htmlFor={key}>{label}{opts.required ? ' *' : ''}</Label>
      {opts.multiline ? (
        <Textarea id={key} rows={3} value={info[key]} placeholder={opts.placeholder} onChange={(e) => setInfo({ ...info, [key]: e.target.value })} />
      ) : (
        <Input id={key} type={opts.type ?? 'text'} required={opts.required} value={info[key]} placeholder={opts.placeholder} onChange={(e) => setInfo({ ...info, [key]: e.target.value })} />
      )}
      {opts.hint ? <p className="text-xs text-muted-foreground">{opts.hint}</p> : null}
    </div>
  );

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const res = await fetch('/api/admin/info', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(info) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(data.message || 'We couldn’t save the details.');
      toast.success('Site info saved');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'We couldn’t save the details.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <PageHeader title="Site info" description="Contact details, opening hours and search settings shown across the site." />
      <form onSubmit={save} className="flex max-w-3xl flex-col gap-6">
        {error ? <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert> : null}

        <Card>
          <CardHeader><CardTitle>Business</CardTitle></CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            {text('name', 'Business name', { required: true })}
            {text('email', 'Email', { type: 'email', required: true })}
            {text('phone', 'Phone', { type: 'tel', required: true })}
            {text('website', 'Website', { type: 'url' })}
            {text('description', 'About', { multiline: true, wide: true, placeholder: 'A short description of the business' })}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Address</CardTitle></CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            {text('address', 'Street address', { required: true, multiline: true, wide: true })}
            {text('city', 'City', { required: true })}
            {text('state', 'State', { required: true })}
            {text('pincode', 'Pincode', { required: true })}
            {text('country', 'Country', { required: true })}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Opening hours</CardTitle></CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            {DAYS.map((d) => (
              <div key={d} className="space-y-1.5">
                <Label htmlFor={`h-${d}`} className="capitalize">{d}</Label>
                <Input id={`h-${d}`} value={info.businessHours[d]} onChange={(e) => setInfo({ ...info, businessHours: { ...info.businessHours, [d]: e.target.value } })} />
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Services offered</CardTitle><CardDescription>What printing and related services your shop provides to customers.</CardDescription></CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-3">
              <Label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={info.services.colorPrinting} onChange={(e) => setInfo({ ...info, services: { ...info.services, colorPrinting: e.target.checked } })} className="size-4" />
                <span>Color printing</span>
              </Label>
              <Label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={info.services.blackAndWhitePrinting} onChange={(e) => setInfo({ ...info, services: { ...info.services, blackAndWhitePrinting: e.target.checked } })} className="size-4" />
                <span>Black & white printing</span>
              </Label>
              <Label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={info.services.binding} onChange={(e) => setInfo({ ...info, services: { ...info.services, binding: e.target.checked } })} className="size-4" />
                <span>Binding</span>
              </Label>
              <Label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={info.services.lamination} onChange={(e) => setInfo({ ...info, services: { ...info.services, lamination: e.target.checked } })} className="size-4" />
                <span>Lamination</span>
              </Label>
            </div>
            <div className="space-y-3">
              <Label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={info.services.scanning} onChange={(e) => setInfo({ ...info, services: { ...info.services, scanning: e.target.checked } })} className="size-4" />
                <span>Scanning</span>
              </Label>
              <Label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={info.services.photocopying} onChange={(e) => setInfo({ ...info, services: { ...info.services, photocopying: e.target.checked } })} className="size-4" />
                <span>Photocopying</span>
              </Label>
              <Label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={info.services.delivery} onChange={(e) => setInfo({ ...info, services: { ...info.services, delivery: e.target.checked } })} className="size-4" />
                <span>Delivery</span>
              </Label>
              <Label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={info.services.plasticFiles} onChange={(e) => setInfo({ ...info, services: { ...info.services, plasticFiles: e.target.checked } })} className="size-4" />
                <span>Plastic files / folders</span>
              </Label>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Social links</CardTitle></CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            {SOCIAL.map((s) => (
              <div key={s} className="space-y-1.5">
                <Label htmlFor={`s-${s}`} className="capitalize">{s}</Label>
                <Input id={`s-${s}`} type="url" placeholder="https://" value={info.socialMedia[s]} onChange={(e) => setInfo({ ...info, socialMedia: { ...info.socialMedia, [s]: e.target.value } })} />
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Search and sharing</CardTitle><CardDescription>How the site appears in Google results and when a link is shared.</CardDescription></CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            {text('seoTitle', 'Page title', { wide: true, hint: 'About 50 to 60 characters.' })}
            {text('seoDescription', 'Description', { multiline: true, wide: true, hint: 'About 150 to 160 characters.' })}
            {text('seoKeywords', 'Keywords', { wide: true, hint: 'Separate with commas.' })}
            {text('logo', 'Logo URL', { type: 'url' })}
            {text('favicon', 'Favicon URL', { type: 'url' })}
            {text('ogImage', 'Share image URL', { type: 'url', wide: true, hint: 'Shown when a link is shared. 1200 × 630 pixels works best.' })}
          </CardContent>
        </Card>

        <div><Button type="submit" size="lg" disabled={saving}>{saving ? <Loader2 className="animate-spin" /> : null}Save</Button></div>
      </form>
    </>
  );
}
