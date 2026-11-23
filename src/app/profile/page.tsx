'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import toast from 'react-hot-toast';
import { BadgeCheck, CheckCircle2, CircleAlert, Download, Loader2, Upload } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { usePwaInstall } from '@/hooks/usePwaInstall';
import { InstallAppModal } from '@/components/InstallAppModal';
import { BORDER_COLORS, BORDER_STYLES, BORDER_WIDTHS, borderCss, DEFAULT_BORDER, type BorderPreference } from '@/lib/templateBorders';
import { PhoneNotice } from '@/components/PhoneNotice';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';

interface Profile {
  name: string;
  email: string;
  phone: string;
  profilePicture?: string | null;
  emailVerified: boolean;
  provider: 'email' | 'google';
  templateBorderPreference?: BorderPreference;
}

const initials = (name: string, email: string) => (name || email || '?').trim().charAt(0).toUpperCase();

export default function ProfilePage() {
  const router = useRouter();
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const {
    isInstalled,
    isIOS,
    isAndroid,
    canInstallNative,
    promptInstall,
    triggerInstall,
    isModalOpen,
    setIsModalOpen,
  } = usePwaInstall();
  const { update: refreshSession } = useSession();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [form, setForm] = useState({ name: '', phone: '' });
  const [border, setBorder] = useState<BorderPreference>(DEFAULT_BORDER);
  const [saving, setSaving] = useState(false);
  const [savingBorder, setSavingBorder] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const picker = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!authLoading && !isAuthenticated) router.push('/auth/signin?callbackUrl=/profile');
  }, [authLoading, isAuthenticated, router]);

  useEffect(() => {
    if (!isAuthenticated) return;
    fetch('/api/user/profile')
      .then((r) => r.json())
      .then((data) => {
        if (!data.success) throw new Error(data.error);
        const p: Profile = data.profile;
        setProfile(p);
        setForm({ name: p.name, phone: p.phone || '' });
        setBorder(p.templateBorderPreference ?? DEFAULT_BORDER);
      })
      .catch(() => setError('We couldn’t load your profile. Refresh the page to try again.'));
  }, [isAuthenticated]);

  const changed = profile ? form.name.trim() !== profile.name || form.phone.trim() !== (profile.phone || '') : false;

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch('/api/user/profile', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: form.name, phone: form.phone }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) return toast.error(data.error || 'We couldn’t save your changes.');
      setProfile((p) => (p ? { ...p, name: data.profile.name, phone: data.profile.phone } : p));
      setForm({ name: data.profile.name, phone: data.profile.phone });
      toast.success('Profile saved');
      await refreshSession();
    } catch {
      toast.error('We couldn’t reach the server. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const savePicture = async (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) return toast.error('Choose an image file (JPG, PNG or WebP).');
    if (file.size > 5 * 1024 * 1024) return toast.error('The picture must be under 5 MB.');
    setUploading(true);
    try {
      const body = new FormData();
      body.append('file', file);
      const res = await fetch('/api/user/profile-picture', { method: 'POST', body });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) return toast.error(data.error || 'We couldn’t upload the picture.');
      setProfile((p) => (p ? { ...p, profilePicture: data.profilePicture } : p));
      toast.success('Picture updated');
      await refreshSession();
    } catch {
      toast.error('We couldn’t upload the picture. Please try again.');
    } finally {
      setUploading(false);
      if (picker.current) picker.current.value = '';
    }
  };

  const saveBorder = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingBorder(true);
    try {
      const res = await fetch('/api/user/profile', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ templateBorderPreference: border }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) return toast.error(data.error || 'We couldn’t save this.');
      toast.success('Saved');
    } catch {
      toast.error('We couldn’t reach the server. Please try again.');
    } finally {
      setSavingBorder(false);
    }
  };

  if (authLoading || (!profile && !error)) {
    return (
      <div className="mx-auto max-w-2xl space-y-6 px-4 py-10">
        <Skeleton className="h-9 w-48" /><Skeleton className="h-72 rounded-xl" /><Skeleton className="h-56 rounded-xl" />
      </div>
    );
  }
  if (!profile) {
    return <div className="mx-auto max-w-2xl px-4 py-10"><p className="text-destructive" role="alert">{error}</p></div>;
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6 px-4 py-10 sm:px-6">
      <h1 className="text-3xl font-semibold">Profile</h1>

      <Card>
        <form onSubmit={save} className="flex flex-col gap-6">
          <CardHeader>
            <div className="flex items-center gap-4">
              <Avatar className="size-16">
                {profile.profilePicture ? <AvatarImage src={profile.profilePicture} alt="" /> : null}
                <AvatarFallback className="bg-accent text-xl font-semibold text-accent-foreground">{initials(profile.name, profile.email)}</AvatarFallback>
              </Avatar>
              <div>
                <CardTitle>{profile.name}</CardTitle>
                <input ref={picker} type="file" accept="image/*" className="sr-only" tabIndex={-1} aria-hidden onChange={(e) => savePicture(e.target.files?.[0])} />
                <Button type="button" variant="outline" size="sm" className="mt-2" onClick={() => picker.current?.click()} disabled={uploading}>
                  {uploading ? <Loader2 className="animate-spin" /> : <Upload />}Change picture
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="name">Name</Label>
              <Input id="name" autoComplete="name" required maxLength={100} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" value={profile.email} readOnly aria-describedby="email-note" className="bg-muted/50" />
              <p id="email-note" className="text-xs text-muted-foreground">
                {profile.emailVerified ? <BadgeCheck className="mr-1 inline size-4 align-text-bottom text-success" aria-hidden /> : <CircleAlert className="mr-1 inline size-4 align-text-bottom text-warning" aria-hidden />}
                {profile.emailVerified ? 'Verified.' : 'Not verified yet.'} It is your sign-in and links to your orders, so it can’t be changed here. <Link href="/contact" className="text-primary hover:underline">Contact us</Link> if you need to.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="phone">Mobile number</Label>
              <Input id="phone" type="tel" inputMode="tel" autoComplete="tel" required placeholder="98765 43210" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} aria-describedby="phone-note" />
              <PhoneNotice id="phone-note" />
            </div>
          </CardContent>
          <CardFooter className="justify-between border-t pt-6">
            {profile.provider === 'google' ? <p className="text-sm text-muted-foreground">Signed in with Google. <Link href="/auth/setup-password" className="text-primary hover:underline">Set a password</Link></p> : <span />}
            <Button type="submit" disabled={!changed || saving}>{saving ? <Loader2 className="animate-spin" /> : null}Save changes</Button>
          </CardFooter>
        </form>
      </Card>

      <Card>
        <form onSubmit={saveBorder} className="flex flex-col gap-6">
          <CardHeader>
            <CardTitle>Favourite template borders</CardTitle>
            <CardDescription>How templates you have marked as favourite are outlined on the templates page.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-2">
                <Label htmlFor="b-style">Style</Label>
                <Select value={border.style} onValueChange={(style) => setBorder({ ...border, style })}>
                  <SelectTrigger id="b-style" className="w-full capitalize"><SelectValue /></SelectTrigger>
                  <SelectContent>{BORDER_STYLES.map((s) => <SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="b-color">Colour</Label>
                <Select value={border.color} onValueChange={(color) => setBorder({ ...border, color })}>
                  <SelectTrigger id="b-color" className="w-full capitalize"><SelectValue /></SelectTrigger>
                  <SelectContent>{Object.keys(BORDER_COLORS).map((c) => <SelectItem key={c} value={c} className="capitalize">{c}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="b-width">Thickness</Label>
                <Select value={border.width} onValueChange={(width) => setBorder({ ...border, width })}>
                  <SelectTrigger id="b-width" className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>{BORDER_WIDTHS.map((w) => <SelectItem key={w} value={w}>{w}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div className="rounded-lg border-dashed p-1" aria-label="Preview">
              <div className="rounded-lg bg-background p-4 text-sm text-muted-foreground" style={borderCss(border)}>Template card preview</div>
            </div>
          </CardContent>
          <CardFooter className="justify-end border-t pt-6">
            <Button type="submit" disabled={savingBorder}>{savingBorder ? <Loader2 className="animate-spin" /> : null}Save</Button>
          </CardFooter>
        </form>
      </Card>

      {/* Install Web App Card (matching campusFleet Settings standard) */}
      <Card>
        <CardHeader>
          <CardTitle>Install Web App</CardTitle>
          <CardDescription>
            Add Fun Printing to your home screen or desktop for 1-tap ordering, instant print tracking, and a full-screen app experience.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-xl border bg-muted/40">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-sm">Progressive Web App (PWA)</span>
                {isInstalled ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-bold text-emerald-600 dark:text-emerald-400">
                    <CheckCircle2 className="size-3" /> App Installed
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-bold text-primary">
                    1-Tap Install Ready
                  </span>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                {isInstalled
                  ? 'Fun Printing Store is active on your device. Launch it anytime from your applications or home screen.'
                  : 'Install Fun Printing for faster access without browser address bars and instant status updates.'}
              </p>
            </div>
            {!isInstalled && (
              <Button
                type="button"
                onClick={triggerInstall}
                className="shrink-0 gap-2 cursor-pointer"
              >
                <Download className="size-4" />
                <span>Install App</span>
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <InstallAppModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        isIOS={isIOS}
        isAndroid={isAndroid}
        canInstallNative={canInstallNative}
        onPromptInstall={promptInstall}
      />
    </div>
  );
}
