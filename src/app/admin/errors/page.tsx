'use client';

import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Loader2 } from 'lucide-react';
import { PageHeader } from '@/components/admin/PageHeader';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';

type Status = 'open' | 'resolved' | 'ignored';
type Source = 'server' | 'client' | 'wss' | 'desktop' | 'mobile';

interface ErrorSample {
  at: string;
  message: string;
  stack?: string;
  url?: string;
  method?: string;
  requestId?: string;
  userId?: string;
  partnerId?: string;
  release?: string;
  userAgent?: string;
  digest?: string;
  context?: Record<string, unknown>;
}
interface ErrorGroupItem {
  _id: string;
  source: Source;
  level: 'error' | 'warning';
  name: string;
  message: string;
  route?: string;
  status: Status;
  count: number;
  firstSeenAt: string;
  lastSeenAt: string;
  lastRelease?: string;
  regressedAt?: string;
  resolvedBy?: string;
  note?: string;
  samples?: ErrorSample[];
}

const SOURCES: Source[] = ['server', 'client', 'wss', 'desktop', 'mobile'];

function timeAgo(iso: string): string {
  const seconds = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return `${Math.floor(seconds)}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

export default function AdminErrorsPage() {
  const [status, setStatus] = useState<Status | 'all'>('open');
  const [source, setSource] = useState('all');
  const [level, setLevel] = useState('all');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<ErrorGroupItem[] | null>(null);
  const [total, setTotal] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loadError, setLoadError] = useState('');
  const [selected, setSelected] = useState<ErrorGroupItem | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoadError('');
    const params = new URLSearchParams({ status, page: String(page) });
    if (source !== 'all') params.set('source', source);
    if (level !== 'all') params.set('level', level);
    if (query.trim()) params.set('q', query.trim());
    try {
      const res = await fetch(`/api/admin/errors?${params}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(data.error || `HTTP ${res.status}`);
      setItems(data.items);
      setTotal(data.total);
      setPageSize(data.pageSize);
      setCounts(data.counts || {});
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'We couldn’t load the errors.');
    }
  }, [status, source, level, query, page]);
  useEffect(() => {
    void load();
  }, [load]);

  const openDetail = async (id: string) => {
    const res = await fetch(`/api/admin/errors/${id}`);
    const data = await res.json().catch(() => ({}));
    if (data.success) setSelected(data.item);
    else toast.error('We couldn’t open that error.');
  };

  const update = async (id: string, body: { status?: Status; note?: string }) => {
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/errors/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(data.error || 'The update failed.');
      setSelected((s) => (s && s._id === id ? { ...s, ...data.item } : s));
      toast.success(body.note !== undefined ? 'Note saved' : 'Updated');
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'The update failed.');
    } finally {
      setSaving(false);
    }
  };

  const pages = Math.max(1, Math.ceil(total / pageSize));
  const reset = <T,>(set: (v: T) => void) => (v: T) => {
    set(v);
    setPage(1);
  };

  return (
    <>
      <PageHeader title="Errors" description="Errors and warnings from the website, server and apps. Repeats are grouped, and a resolved error reopens if it happens again." />

      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <Tabs value={status} onValueChange={(v) => reset(setStatus)(v as Status | 'all')}>
            <TabsList>
              {(['open', 'resolved', 'ignored', 'all'] as const).map((t) => (
                <TabsTrigger key={t} value={t}>{t[0].toUpperCase() + t.slice(1)}{t !== 'all' && counts[t] !== undefined ? ` (${counts[t]})` : ''}</TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          <Select value={source} onValueChange={reset(setSource)}>
            <SelectTrigger className="w-36" aria-label="Source"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="all">All sources</SelectItem>{SOURCES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={level} onValueChange={reset(setLevel)}>
            <SelectTrigger className="w-44" aria-label="Level"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="all">Errors and warnings</SelectItem><SelectItem value="error">Errors</SelectItem><SelectItem value="warning">Warnings</SelectItem></SelectContent>
          </Select>
          <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); setPage(1); void load(); }}>
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search message or route" aria-label="Search" className="w-56" />
            <Button type="submit">Search</Button>
          </form>
        </div>

        {loadError ? <Alert variant="destructive"><AlertDescription>{loadError}</AlertDescription></Alert> : null}

        <div className="overflow-x-auto rounded-lg border bg-card">
          <Table>
            <TableHeader>
              <TableRow><TableHead>Error</TableHead><TableHead>Source</TableHead><TableHead className="text-right">Events</TableHead><TableHead>Last seen</TableHead><TableHead>First seen</TableHead></TableRow>
            </TableHeader>
            <TableBody>
              {items === null ? (
                <TableRow><TableCell colSpan={5} className="py-10 text-center"><Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" aria-label="Loading" /></TableCell></TableRow>
              ) : items.length === 0 ? (
                <TableRow><TableCell colSpan={5} className="py-10 text-center text-muted-foreground">Nothing here.</TableCell></TableRow>
              ) : (
                items.map((item) => (
                  <TableRow key={item._id} className="cursor-pointer" onClick={() => openDetail(item._id)}>
                    <TableCell className="max-w-xl whitespace-normal">
                      <div className="flex items-center gap-2">
                        <span className={`size-2 shrink-0 rounded-full ${item.level === 'error' ? 'bg-destructive' : 'bg-warning'}`} aria-label={item.level} />
                        <span className="font-medium">{item.name}</span>
                        {item.regressedAt && item.status === 'open' ? <Badge variant="destructive">Came back</Badge> : null}
                      </div>
                      <p className="truncate text-sm text-muted-foreground" title={item.message}>{item.message}</p>
                      {item.route ? <p className="truncate text-xs text-muted-foreground">{item.route}</p> : null}
                    </TableCell>
                    <TableCell>{item.source}</TableCell>
                    <TableCell className="text-right font-mono">{item.count}</TableCell>
                    <TableCell title={item.lastSeenAt}>{timeAgo(item.lastSeenAt)}</TableCell>
                    <TableCell className="text-muted-foreground" title={item.firstSeenAt}>{timeAgo(item.firstSeenAt)}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>{total} {total === 1 ? 'error' : 'errors'}</span>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
            <span>Page {page} of {pages}</span>
            <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>Next</Button>
          </div>
        </div>
      </div>

      <Sheet open={Boolean(selected)} onOpenChange={(o) => !o && setSelected(null)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-2xl">
          {selected ? (
            <>
              <SheetHeader>
                <SheetTitle>{selected.name}</SheetTitle>
                <SheetDescription className="break-words">{selected.message}</SheetDescription>
                <p className="text-xs text-muted-foreground">
                  {selected.source} · {selected.level} · {selected.count} events · first {new Date(selected.firstSeenAt).toLocaleString()} · last {new Date(selected.lastSeenAt).toLocaleString()}
                  {selected.lastRelease ? ` · release ${selected.lastRelease}` : ''}
                </p>
              </SheetHeader>
              <div className="space-y-4 px-4 pb-6">
                <div className="flex flex-wrap items-center gap-2">
                  {(['resolved', 'ignored', 'open'] as Status[]).filter((s) => s !== selected.status).map((s) => (
                    <Button key={s} size="sm" variant={s === 'resolved' ? 'default' : 'outline'} disabled={saving} onClick={() => update(selected._id, { status: s })}>
                      {s === 'resolved' ? 'Mark resolved' : s === 'ignored' ? 'Ignore' : 'Reopen'}
                    </Button>
                  ))}
                  <span className="text-xs text-muted-foreground">Now {selected.status}{selected.resolvedBy ? ` (by ${selected.resolvedBy})` : ''}</span>
                </div>
                <div className="space-y-1.5">
                  <label htmlFor="err-note" className="text-sm font-medium">Note</label>
                  <Textarea id="err-note" key={selected._id} rows={2} defaultValue={selected.note || ''} placeholder="Cause, fix, ticket link" onBlur={(e) => e.target.value !== (selected.note || '') && void update(selected._id, { note: e.target.value })} />
                </div>
                <h3 className="text-sm font-semibold">Recent events</h3>
                {(selected.samples || []).map((sample, i) => (
                  <div key={i} className="space-y-2 rounded-lg border p-3 text-xs">
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground">
                      <span>{new Date(sample.at).toLocaleString()}</span>
                      {sample.url ? <span>{sample.method ? `${sample.method} ` : ''}{sample.url}</span> : null}
                      {sample.requestId ? <span>request {sample.requestId}</span> : null}
                      {sample.userId ? <span>user {sample.userId}</span> : null}
                      {sample.partnerId ? <span>shop {sample.partnerId}</span> : null}
                      {sample.digest ? <span>digest {sample.digest}</span> : null}
                      {sample.release ? <span>release {sample.release}</span> : null}
                    </div>
                    {sample.message !== selected.message ? <p className="break-words">{sample.message}</p> : null}
                    {sample.userAgent ? <p className="truncate text-muted-foreground" title={sample.userAgent}>{sample.userAgent}</p> : null}
                    {sample.context && Object.keys(sample.context).length ? <pre className="overflow-x-auto rounded bg-muted p-2">{JSON.stringify(sample.context, null, 2)}</pre> : null}
                    {sample.stack ? <pre className="max-h-64 overflow-auto rounded bg-foreground p-2 text-background">{sample.stack}</pre> : null}
                  </div>
                ))}
              </div>
            </>
          ) : null}
        </SheetContent>
      </Sheet>
    </>
  );
}
