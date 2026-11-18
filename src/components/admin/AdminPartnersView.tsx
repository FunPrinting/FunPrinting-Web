'use client';

import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Loader2 } from 'lucide-react';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

interface Partner {
  _id: string;
  businessName: string;
  isOnline: boolean;
  isActive: boolean;
  acceptanceMode?: 'auto' | 'manual';
  razorpayAccountId?: string;
  address?: { city?: string; zipCode?: string };
  delivery?: { courier?: { enabled: boolean }; self?: { enabled: boolean } };
  earnings?: { totalRevenue: number; pendingPayout: number };
}

const rupees = (n = 0) => `₹${n.toLocaleString('en-IN')}`;
const ACCOUNT = /^acc_[A-Za-z0-9]{14}$/;

/** Shops list for admins: approve or deactivate, link the payout account, and filter the order list by shop. */
export default function AdminPartnersView({ onSelectPartner, selectedPartnerId }: { onSelectPartner: (partnerId: string | null) => void; selectedPartnerId: string | null }) {
  const [partners, setPartners] = useState<Partner[] | null>(null);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [deactivate, setDeactivate] = useState<Partner | null>(null);
  const [linking, setLinking] = useState<Partner | null>(null);
  const [accountId, setAccountId] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const res = await fetch('/api/admin/partners');
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(data.error || 'We couldn’t load the shops.');
      setPartners(data.partners);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'We couldn’t load the shops.');
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const patch = async (partner: Partner, body: Record<string, unknown>, done: string) => {
    setBusyId(partner._id);
    try {
      const res = await fetch(`/api/admin/partners/${partner._id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(data.error || 'The update failed.');
      setPartners((list) => (list ?? []).map((p) => (p._id === partner._id ? { ...p, ...data.partner } : p)));
      toast.success(done);
      return true;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'The update failed.');
      return false;
    } finally {
      setBusyId(null);
    }
  };

  if (error) return <Alert variant="destructive"><AlertTitle>Shops</AlertTitle><AlertDescription>{error} <button type="button" className="underline" onClick={load}>Try again</button></AlertDescription></Alert>;
  if (!partners) return <div className="grid place-items-center py-10"><Loader2 className="size-5 animate-spin text-muted-foreground" aria-label="Loading shops" /></div>;
  if (!partners.length) return <p className="py-8 text-center text-sm text-muted-foreground">No shops have signed up yet.</p>;

  return (
    <>
      <div className="overflow-x-auto rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Shop</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Orders from</TableHead>
              <TableHead>Delivery</TableHead>
              <TableHead>Payout account</TableHead>
              <TableHead className="text-right">Earned</TableHead>
              <TableHead className="text-right">Waiting</TableHead>
              <TableHead><span className="sr-only">Actions</span></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {partners.map((p) => (
              <TableRow key={p._id} data-state={selectedPartnerId === p._id ? 'selected' : undefined}>
                <TableCell>
                  <p className="font-medium">{p.businessName || 'Unnamed shop'}</p>
                  <p className="text-xs text-muted-foreground">{[p.address?.city, p.address?.zipCode].filter(Boolean).join(' ') || 'No address'}</p>
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    <Badge variant={p.isActive ? 'default' : 'outline'}>{p.isActive ? 'Approved' : 'Needs approval'}</Badge>
                    {p.isActive ? <Badge variant="secondary">{p.isOnline ? 'Online' : 'Offline'}</Badge> : null}
                    <Badge variant="outline">{p.acceptanceMode === 'manual' ? 'Accepts by hand' : 'Auto-accept'}</Badge>
                  </div>
                </TableCell>
                <TableCell>
                  <Button size="sm" variant={selectedPartnerId === p._id ? 'default' : 'outline'} onClick={() => onSelectPartner(selectedPartnerId === p._id ? null : p._id)}>
                    {selectedPartnerId === p._id ? 'Showing' : 'Show orders'}
                  </Button>
                </TableCell>
                <TableCell className="text-sm">{[p.delivery?.self?.enabled && 'Own rider', p.delivery?.courier?.enabled && 'Courier'].filter(Boolean).join(', ') || 'Pickup only'}</TableCell>
                <TableCell>
                  <button type="button" className="text-left text-sm underline-offset-4 hover:underline" onClick={() => { setLinking(p); setAccountId(p.razorpayAccountId ?? ''); }}>
                    {p.razorpayAccountId ? <span className="font-mono text-xs">{p.razorpayAccountId}</span> : <span className="text-warning">Not linked</span>}
                  </button>
                </TableCell>
                <TableCell className="text-right tabular-nums">{rupees(p.earnings?.totalRevenue)}</TableCell>
                <TableCell className="text-right tabular-nums">{rupees(p.earnings?.pendingPayout)}</TableCell>
                <TableCell className="text-right">
                  {p.isActive ? (
                    <Button size="sm" variant="outline" disabled={busyId === p._id} onClick={() => setDeactivate(p)}>Deactivate</Button>
                  ) : (
                    <Button size="sm" disabled={busyId === p._id} onClick={() => patch(p, { isActive: true }, `${p.businessName} approved`)}>{busyId === p._id ? <Loader2 className="animate-spin" /> : null}Approve</Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <ConfirmDialog
        open={Boolean(deactivate)}
        onOpenChange={(o) => !o && setDeactivate(null)}
        title={`Deactivate ${deactivate?.businessName}?`}
        description="The shop stops receiving orders and its devices are signed out. Orders it already has are not changed."
        confirmLabel="Deactivate"
        destructive
        busy={busyId === deactivate?._id}
        onConfirm={async () => {
          if (deactivate && (await patch(deactivate, { isActive: false }, `${deactivate.businessName} deactivated`))) setDeactivate(null);
        }}
      />

      <Dialog open={Boolean(linking)} onOpenChange={(o) => !o && setLinking(null)}>
        <DialogContent>
          <form
            className="flex flex-col gap-4"
            onSubmit={async (e) => {
              e.preventDefault();
              if (linking && (await patch(linking, { razorpayAccountId: accountId.trim() || null }, 'Payout account saved'))) setLinking(null);
            }}
          >
            <DialogHeader>
              <DialogTitle>Payout account for {linking?.businessName}</DialogTitle>
              <DialogDescription>The Razorpay linked account that receives this shop’s share. Leave it empty to unlink.</DialogDescription>
            </DialogHeader>
            <div className="space-y-2">
              <Label htmlFor="acc">Account ID</Label>
              <Input id="acc" placeholder="acc_XXXXXXXXXXXXXX" value={accountId} onChange={(e) => setAccountId(e.target.value)} aria-invalid={Boolean(accountId.trim()) && !ACCOUNT.test(accountId.trim())} />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setLinking(null)}>Cancel</Button>
              <Button type="submit" disabled={busyId === linking?._id || (Boolean(accountId.trim()) && !ACCOUNT.test(accountId.trim()))}>Save</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
