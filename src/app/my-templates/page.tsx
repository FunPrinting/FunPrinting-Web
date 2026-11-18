'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import toast from 'react-hot-toast';
import { Loader2, Pencil, Plus, Search, Trash2, Wallet } from 'lucide-react';
import { TEMPLATE_CATEGORIES, categoryLabel, priceLabel } from '@/lib/templates';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

interface Template {
  id: string;
  name: string;
  description: string;
  category: string;
  placeholders: string[];
  isPublic: boolean;
  isPaid: boolean;
  price?: number;
  createdAt: string;
}
interface Earning {
  _id: string;
  orderId: string;
  amount: number;
  platformShareAmount?: number;
  status: 'pending' | 'processing' | 'paid' | 'failed';
  createdAt: string;
}
interface Summary { totalEarnings: number; pendingEarnings: number; paidEarnings: number; totalCount: number }

const rupees = (n: number) => `₹${n.toLocaleString('en-IN', { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 })}`;
const EARNING_LABEL: Record<Earning['status'], string> = { pending: 'Waiting for payout', processing: 'Being paid', paid: 'Paid', failed: 'Failed' };

export default function MyTemplatesPage() {
  const router = useRouter();
  const { status } = useSession();
  const [templates, setTemplates] = useState<Template[] | null>(null);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('all');
  const [toDelete, setToDelete] = useState<Template | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [earningsFor, setEarningsFor] = useState<Template | null>(null);
  const [earnings, setEarnings] = useState<Earning[] | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);

  const load = useCallback(async () => {
    setError('');
    try {
      const res = await fetch('/api/templates/my-templates');
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(data.error || 'We couldn’t load your templates.');
      setTemplates(data.templates);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'We couldn’t load your templates.');
    }
  }, []);

  useEffect(() => {
    if (status === 'unauthenticated') router.push('/auth/signin?callbackUrl=/my-templates');
    if (status === 'authenticated') load();
  }, [status, router, load]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (templates ?? []).filter((t) => (category === 'all' || t.category === category) && (!q || t.name.toLowerCase().includes(q) || (t.description ?? '').toLowerCase().includes(q)));
  }, [templates, query, category]);

  const openEarnings = async (t: Template) => {
    setEarningsFor(t);
    setEarnings(null);
    setSummary(null);
    try {
      const res = await fetch(`/api/templates/${t.id}/earnings`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(data.error || 'We couldn’t load the earnings.');
      setEarnings(data.earnings ?? []);
      setSummary(data.summary);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'We couldn’t load the earnings.');
      setEarningsFor(null);
    }
  };

  const remove = async () => {
    if (!toDelete) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/templates/${toDelete.id}`, { method: 'DELETE' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'We couldn’t delete the template.');
      setTemplates((all) => (all ?? []).filter((t) => t.id !== toDelete.id));
      toast.success('Template deleted');
      setToDelete(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'We couldn’t delete the template.');
    } finally {
      setDeleting(false);
    }
  };

  if (status !== 'authenticated' || (templates === null && !error)) {
    return <div className="grid min-h-[60vh] place-items-center"><Loader2 className="size-6 animate-spin text-muted-foreground" aria-label="Loading" /></div>;
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold">My templates</h1>
          <p className="mt-2 text-muted-foreground">Templates you made. Paid ones earn you money each time someone buys them.</p>
        </div>
        <div className="flex gap-2">
          <Button asChild variant="outline"><Link href="/payout-settings"><Wallet />Payout details</Link></Button>
          <Button asChild><Link href="/templates/create"><Plus />New template</Link></Button>
        </div>
      </div>

      {error ? (
        <Alert variant="destructive" className="mt-6">
          <AlertTitle>Something went wrong</AlertTitle>
          <AlertDescription>{error} <button type="button" className="underline" onClick={load}>Try again</button></AlertDescription>
        </Alert>
      ) : null}

      {templates && templates.length > 0 ? (
        <>
          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            <div className="relative sm:max-w-sm sm:flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <Input className="pl-9" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search your templates" aria-label="Search your templates" />
            </div>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger className="w-full sm:w-48" aria-label="Category"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All categories</SelectItem>
                {TEMPLATE_CATEGORIES.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {shown.length ? (
            <ul className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {shown.map((t) => (
                <li key={t.id}>
                  <Card className="h-full gap-4">
                    <CardHeader className="gap-2">
                      <CardTitle className="line-clamp-2 text-base">{t.name}</CardTitle>
                      <div className="flex flex-wrap gap-1.5">
                        <Badge variant="secondary">{categoryLabel(t.category)}</Badge>
                        <Badge variant={t.isPublic ? 'default' : 'outline'}>{t.isPublic ? 'Public' : 'Private'}</Badge>
                        <Badge variant="outline">{priceLabel(t)}</Badge>
                      </div>
                    </CardHeader>
                    <CardContent className="flex-1">
                      <p className="line-clamp-2 text-sm text-muted-foreground">{t.description || 'No description.'}</p>
                      <p className="mt-3 text-xs text-muted-foreground">{t.placeholders.length} fields · Created {new Date(t.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</p>
                    </CardContent>
                    <CardFooter className="flex-wrap gap-2">
                      <Button asChild size="sm" variant="outline"><Link href={`/templates/fill/${t.id}`}>Open</Link></Button>
                      <Button asChild size="sm" variant="outline"><Link href={`/templates/edit/${t.id}`}><Pencil />Edit</Link></Button>
                      {t.isPaid ? <Button size="sm" variant="outline" onClick={() => openEarnings(t)}><Wallet />Earnings</Button> : null}
                      <Button size="sm" variant="ghost" className="ml-auto text-destructive hover:text-destructive" onClick={() => setToDelete(t)} aria-label={`Delete ${t.name}`}><Trash2 /></Button>
                    </CardFooter>
                  </Card>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-10 text-center text-muted-foreground">Nothing matches your search.</p>
          )}
        </>
      ) : templates ? (
        <Card className="mt-8">
          <CardContent className="py-10 text-center">
            <h2 className="text-lg font-medium">No templates yet</h2>
            <p className="mt-1 text-muted-foreground">Upload a Word document with placeholders and share it, or sell it.</p>
            <Button asChild className="mt-4"><Link href="/templates/create"><Plus />Create your first template</Link></Button>
          </CardContent>
        </Card>
      ) : null}

      <Dialog open={Boolean(toDelete)} onOpenChange={(o) => !o && !deleting && setToDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete this template?</DialogTitle>
            <DialogDescription>“{toDelete?.name}” will be removed for everyone. Earnings you have already made are kept. This cannot be undone.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setToDelete(null)} disabled={deleting}>Keep it</Button>
            <Button variant="destructive" onClick={remove} disabled={deleting}>{deleting ? <Loader2 className="animate-spin" /> : null}Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(earningsFor)} onOpenChange={(o) => !o && setEarningsFor(null)}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Earnings</DialogTitle>
            <DialogDescription>{earningsFor?.name}</DialogDescription>
          </DialogHeader>
          {!earnings || !summary ? (
            <div className="grid place-items-center py-10"><Loader2 className="size-5 animate-spin text-muted-foreground" aria-label="Loading" /></div>
          ) : (
            <div className="space-y-5">
              <dl className="grid grid-cols-3 gap-3 text-center">
                {[['Total', summary.totalEarnings], ['Waiting', summary.pendingEarnings], ['Paid', summary.paidEarnings]].map(([label, value]) => (
                  <div key={label as string} className="rounded-lg border p-3"><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-1 text-lg font-semibold">{rupees(value as number)}</dd></div>
                ))}
              </dl>
              {earnings.length ? (
                <div className="max-h-72 overflow-auto">
                  <Table>
                    <TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Order</TableHead><TableHead className="text-right">You earn</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {earnings.map((e) => (
                        <TableRow key={e._id}>
                          <TableCell>{new Date(e.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</TableCell>
                          <TableCell className="font-mono text-xs">{e.orderId}</TableCell>
                          <TableCell className="text-right">{rupees(e.amount)}</TableCell>
                          <TableCell>{EARNING_LABEL[e.status]}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ) : (
                <p className="text-center text-sm text-muted-foreground">No one has bought this template yet.</p>
              )}
              <p className="text-sm text-muted-foreground">Payouts go to the details in <Link href="/payout-settings" className="text-primary hover:underline">Payout details</Link>.</p>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
