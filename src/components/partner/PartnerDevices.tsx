'use client';

import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Laptop, Loader2, Smartphone } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

interface Device {
  deviceId: string;
  name: string;
  platform: 'desktop' | 'mobile' | 'other';
  appVersion?: string;
  lastSeenAt: string;
  createdAt: string;
}

const ago = (iso: string) => {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 2) return 'just now';
  if (m < 60) return `${m} min ago`;
  if (m < 1440) return `${Math.round(m / 60)} h ago`;
  return `${Math.round(m / 1440)} days ago`;
};

/** The shop's signed-in Partner apps, with sign-out. */
export default function PartnerDevices() {
  const [devices, setDevices] = useState<Device[] | null>(null);
  const [target, setTarget] = useState<Device | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const data = await (await fetch('/api/partner/devices')).json().catch(() => ({}));
    setDevices(data.success ? data.devices : []);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const signOut = async () => {
    if (!target) return;
    setBusy(true);
    const res = await fetch('/api/partner/devices', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ deviceId: target.deviceId }) });
    setBusy(false);
    if (res.ok) toast.success(`${target.name} signed out`);
    else toast.error('Could not sign the device out');
    setTarget(null);
    await load();
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Signed-in apps</CardTitle>
        <CardDescription>Computers and phones signed in to the FunPrinting Partner app. Sign out any you don’t recognise.</CardDescription>
      </CardHeader>
      <CardContent>
        {devices === null ? (
          <Skeleton className="h-14 w-full" />
        ) : devices.length === 0 ? (
          <p className="text-sm text-muted-foreground">No apps signed in yet. Apps installed before the sign-in update keep working until they are updated.</p>
        ) : (
          <ul className="divide-y">
            {devices.map((d) => (
              <li key={d.deviceId} className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
                    {d.platform === 'mobile' ? <Smartphone className="size-4" aria-hidden /> : <Laptop className="size-4" aria-hidden />}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{d.name}{d.appVersion ? <span className="font-normal text-muted-foreground"> · v{d.appVersion}</span> : null}</p>
                    <p className="text-xs text-muted-foreground">Active {ago(d.lastSeenAt)} · signed in {new Date(d.createdAt).toLocaleDateString('en-IN')}</p>
                  </div>
                </div>
                <Button variant="outline" size="sm" onClick={() => setTarget(d)}>Sign out</Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
      <Dialog open={Boolean(target)} onOpenChange={(o) => !o && setTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Sign out {target?.name}?</DialogTitle>
            <DialogDescription>It stops receiving orders until someone signs in on it again. A job it was printing goes back to your queue within 5 minutes.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild><Button variant="outline">Cancel</Button></DialogClose>
            <Button variant="destructive" onClick={signOut} disabled={busy}>{busy ? <Loader2 className="animate-spin" /> : null}Sign out</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
