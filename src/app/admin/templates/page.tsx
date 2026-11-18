'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { Loader2, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { categoryLabel, priceLabel } from '@/lib/templates';
import { PageHeader } from '@/components/admin/PageHeader';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

interface Row {
  id: string;
  name: string;
  category: string;
  fields: number;
  isPublic: boolean;
  isPaid: boolean;
  price: number;
  ownerName: string;
  ownerEmail: string;
  createdByType?: string;
  createdAt: string;
}

export default function AdminTemplatesPage() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [toDelete, setToDelete] = useState<Row | null>(null);
  const [busy, setBusy] = useState(false);
  const [toggling, setToggling] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError('');
    try {
      const res = await fetch('/api/admin/templates/all');
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(data.error || 'We couldn’t load the templates.');
      setRows(data.templates);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'We couldn’t load the templates.');
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (rows ?? []).filter((r) => !q || [r.name, r.ownerName, r.ownerEmail].some((s) => s.toLowerCase().includes(q)));
  }, [rows, query]);

  const setPublic = async (r: Row, isPublic: boolean) => {
    setToggling(r.id);
    try {
      const res = await fetch(`/api/templates/${r.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ isPublic }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(data.error || 'The change failed.');
      setRows((all) => (all ?? []).map((x) => (x.id === r.id ? { ...x, isPublic } : x)));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'The change failed.');
    } finally {
      setToggling(null);
    }
  };

  const remove = async () => {
    if (!toDelete) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/templates/${toDelete.id}`, { method: 'DELETE' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(data.error || 'We couldn’t delete the template.');
      setRows((all) => (all ?? []).filter((x) => x.id !== toDelete.id));
      toast.success('Template deleted');
      setToDelete(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'We couldn’t delete the template.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Templates"
        description="Every template on the site, including private ones. Creators manage their own from My templates."
        actions={<Button asChild><Link href="/templates/create"><Plus />New template</Link></Button>}
      />
      {error ? <Alert variant="destructive" className="mb-4"><AlertDescription>{error}</AlertDescription></Alert> : null}

      <div className="relative mb-4 max-w-sm">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input className="pl-9" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by name or owner" aria-label="Search templates" />
      </div>

      <div className="overflow-x-auto rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow><TableHead>Template</TableHead><TableHead>Owner</TableHead><TableHead>Price</TableHead><TableHead className="text-right">Fields</TableHead><TableHead>Public</TableHead><TableHead><span className="sr-only">Actions</span></TableHead></TableRow>
          </TableHeader>
          <TableBody>
            {rows === null ? (
              <TableRow><TableCell colSpan={6} className="py-10 text-center"><Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" aria-label="Loading" /></TableCell></TableRow>
            ) : shown.length === 0 ? (
              <TableRow><TableCell colSpan={6} className="py-10 text-center text-muted-foreground">No templates.</TableCell></TableRow>
            ) : (
              shown.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>
                    <Link href={`/templates/fill/${r.id}`} className="font-medium hover:underline">{r.name}</Link>
                    <p className="text-xs text-muted-foreground">{categoryLabel(r.category)} · {new Date(r.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</p>
                  </TableCell>
                  <TableCell>
                    <p className="text-sm">{r.ownerName || '—'}</p>
                    <p className="text-xs text-muted-foreground">{r.ownerEmail}</p>
                  </TableCell>
                  <TableCell><Badge variant={r.isPaid ? 'default' : 'secondary'}>{priceLabel(r)}</Badge></TableCell>
                  <TableCell className="text-right tabular-nums">{r.fields}</TableCell>
                  <TableCell><Switch checked={r.isPublic} disabled={toggling === r.id} onCheckedChange={(v) => setPublic(r, v)} aria-label={`${r.name} is public`} /></TableCell>
                  <TableCell className="text-right">
                    <Button asChild size="icon-sm" variant="ghost" aria-label={`Edit ${r.name}`}><Link href={`/templates/edit/${r.id}`}><Pencil /></Link></Button>
                    <Button size="icon-sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => setToDelete(r)} aria-label={`Delete ${r.name}`}><Trash2 /></Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <ConfirmDialog
        open={Boolean(toDelete)}
        onOpenChange={(o) => !o && setToDelete(null)}
        title="Delete this template?"
        description={`“${toDelete?.name}” is removed for everyone, including its owner. This cannot be undone.`}
        confirmLabel="Delete"
        destructive
        busy={busy}
        onConfirm={remove}
      />
    </>
  );
}
