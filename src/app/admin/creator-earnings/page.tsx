'use client';

import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Loader2 } from 'lucide-react';
import { PageHeader } from '@/components/admin/PageHeader';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

interface Creator { name?: string; email?: string; upiId?: string; bankDetails?: { bankName?: string; accountNumber?: string; ifscCode?: string } }
interface Earning {
  _id: string;
  creatorUserId: Creator | string | null;
  templateId: string;
  templateName?: string;
  orderId: string;
  amount: number;
  platformShareAmount?: number;
  status: 'pending' | 'processing' | 'paid' | 'failed';
  notes?: string;
  createdAt: string;
}
interface Summary { totalEarnings: number; pendingEarnings: number; paidEarnings: number; platformEarnings: number; totalCount: number; pendingCount: number; paidCount: number }

const rupees = (n: number) => `₹${n.toLocaleString('en-IN', { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 })}`;
const STATUS_LABEL: Record<Earning['status'], string> = { pending: 'To pay', processing: 'Being paid', paid: 'Paid', failed: 'Failed' };
const creatorOf = (e: Earning): Creator => (e.creatorUserId && typeof e.creatorUserId === 'object' ? e.creatorUserId : { email: String(e.creatorUserId ?? 'Unknown') });

export default function AdminCreatorEarningsPage() {
  const [earnings, setEarnings] = useState<Earning[] | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('all');
  const [paying, setPaying] = useState<Earning | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError('');
    try {
      const res = await fetch(`/api/admin/creator-earnings${filter === 'all' ? '' : `?status=${filter}`}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(data.error || 'We couldn’t load the earnings.');
      setEarnings(data.earnings ?? []);
      setSummary(data.summary);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'We couldn’t load the earnings.');
    }
  }, [filter]);
  useEffect(() => {
    void load();
  }, [load]);

  const markPaid = async (transactionId?: string) => {
    if (!paying) return;
    setBusy(true);
    try {
      const res = await fetch('/api/admin/creator-earnings/process', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ earningId: paying._id, markAsPaid: true, transactionId: transactionId || undefined }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(data.error || 'We couldn’t mark it as paid.');
      toast.success('Marked as paid');
      setPaying(null);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'We couldn’t mark it as paid.');
    } finally {
      setBusy(false);
    }
  };

  const stats: Array<[string, string, string]> = summary
    ? [
        ['All earnings', rupees(summary.totalEarnings), `${summary.totalCount} sales`],
        ['Still to pay', rupees(summary.pendingEarnings), `${summary.pendingCount} waiting`],
        ['Paid out', rupees(summary.paidEarnings), `${summary.paidCount} done`],
        ['Kept by Fun Printing', rupees(summary.platformEarnings), 'Commission on template sales'],
      ]
    : [];

  return (
    <>
      <PageHeader title="Creator payouts" description="What template creators have earned. Pay them to the UPI ID or bank account shown, then mark the row as paid." />
      {error ? <Alert variant="destructive" className="mb-4"><AlertDescription>{error}</AlertDescription></Alert> : null}

      <section aria-label="Summary" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map(([label, value, hint]) => (
          <Card key={label} className="gap-1"><CardHeader className="pb-0"><CardDescription>{label}</CardDescription></CardHeader><CardContent><p className="text-2xl font-semibold tabular-nums">{value}</p><p className="mt-1 text-xs text-muted-foreground">{hint}</p></CardContent></Card>
        ))}
      </section>

      <div className="mt-6 flex items-center gap-3">
        <Select value={filter} onValueChange={(v) => { setEarnings(null); setFilter(v); }}>
          <SelectTrigger className="w-44" aria-label="Status"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {(Object.keys(STATUS_LABEL) as Earning['status'][]).map((s) => <SelectItem key={s} value={s}>{STATUS_LABEL[s]}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <div className="mt-4 overflow-x-auto rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow><TableHead>Creator</TableHead><TableHead>Template</TableHead><TableHead>Pay to</TableHead><TableHead className="text-right">They earn</TableHead><TableHead className="text-right">We keep</TableHead><TableHead>Status</TableHead><TableHead>Date</TableHead><TableHead><span className="sr-only">Action</span></TableHead></TableRow>
          </TableHeader>
          <TableBody>
            {earnings === null ? (
              <TableRow><TableCell colSpan={8} className="py-10 text-center"><Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" aria-label="Loading" /></TableCell></TableRow>
            ) : earnings.length === 0 ? (
              <TableRow><TableCell colSpan={8} className="py-10 text-center text-muted-foreground">No earnings yet.</TableCell></TableRow>
            ) : (
              earnings.map((e) => {
                const c = creatorOf(e);
                return (
                  <TableRow key={e._id}>
                    <TableCell><p className="text-sm font-medium">{c.name || '—'}</p><p className="text-xs text-muted-foreground">{c.email}</p></TableCell>
                    <TableCell><p className="text-sm">{e.templateName || 'Deleted template'}</p><p className="font-mono text-xs text-muted-foreground">{e.orderId}</p></TableCell>
                    <TableCell>
                      {c.upiId ? <span className="select-all font-mono text-sm">{c.upiId}</span> : c.bankDetails?.accountNumber ? (
                        <div className="text-xs"><p>{c.bankDetails.bankName || 'Bank'}</p><p className="select-all font-mono">{c.bankDetails.accountNumber}</p><p className="text-muted-foreground">IFSC {c.bankDetails.ifscCode}</p></div>
                      ) : <span className="text-sm text-destructive">No payout details</span>}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{rupees(e.amount)}</TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">{rupees(e.platformShareAmount || 0)}</TableCell>
                    <TableCell><Badge variant={e.status === 'paid' ? 'secondary' : e.status === 'failed' ? 'destructive' : 'outline'}>{STATUS_LABEL[e.status]}</Badge></TableCell>
                    <TableCell className="text-sm text-muted-foreground">{new Date(e.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</TableCell>
                    <TableCell className="text-right">{e.status === 'pending' || e.status === 'failed' ? <Button size="sm" variant="outline" onClick={() => setPaying(e)}>Mark as paid</Button> : null}</TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      <ConfirmDialog
        open={Boolean(paying)}
        onOpenChange={(o) => !o && setPaying(null)}
        title="Mark this payout as paid?"
        description={paying ? `${rupees(paying.amount)} to ${creatorOf(paying).name || creatorOf(paying).email}. Only do this after you have sent the money.` : undefined}
        confirmLabel="Mark as paid"
        busy={busy}
        reason={{ label: 'Transaction ID (optional)', minLength: 0, maxLength: 100 }}
        onConfirm={markPaid}
      />
    </>
  );
}
