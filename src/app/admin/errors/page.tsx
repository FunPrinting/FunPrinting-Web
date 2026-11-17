'use client';

import { useCallback, useEffect, useState } from 'react';
import AdminGoogleAuth from '@/components/admin/AdminGoogleAuth';
import AdminNavigation from '@/components/admin/AdminNavigation';

type Status = 'open' | 'resolved' | 'ignored';
type Source = 'server' | 'client' | 'wss' | 'desktop' | 'mobile';

interface ErrorSample {
  at: string;
  message: string;
  stack?: string;
  url?: string;
  method?: string;
  route?: string;
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

const STATUS_TABS: Array<Status | 'all'> = ['open', 'resolved', 'ignored', 'all'];
const SOURCES: Source[] = ['server', 'client', 'wss', 'desktop', 'mobile'];

function timeAgo(iso: string): string {
  const seconds = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return `${Math.floor(seconds)}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

function ErrorsContent() {
  const [status, setStatus] = useState<Status | 'all'>('open');
  const [source, setSource] = useState<Source | ''>('');
  const [level, setLevel] = useState<'' | 'error' | 'warning'>('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<ErrorGroupItem[]>([]);
  const [total, setTotal] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [selected, setSelected] = useState<ErrorGroupItem | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    const params = new URLSearchParams({ status, page: String(page) });
    if (source) params.set('source', source);
    if (level) params.set('level', level);
    if (query.trim()) params.set('q', query.trim());
    try {
      const res = await fetch(`/api/admin/errors?${params}`);
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || `HTTP ${res.status}`);
      setItems(data.items);
      setTotal(data.total);
      setPageSize(data.pageSize);
      setCounts(data.counts || {});
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [status, source, level, query, page]);

  useEffect(() => {
    void load();
  }, [load]);

  const openDetail = async (id: string) => {
    const res = await fetch(`/api/admin/errors/${id}`);
    const data = await res.json();
    if (data.success) setSelected(data.item);
  };

  const update = async (id: string, body: { status?: Status; note?: string }) => {
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/errors/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Update failed');
      setSelected((s) => (s && s._id === id ? { ...s, ...data.item } : s));
      await load();
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Update failed');
    } finally {
      setSaving(false);
    }
  };

  const pages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {STATUS_TABS.map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => {
              setStatus(tab);
              setPage(1);
            }}
            className={`rounded-full px-3 py-1 text-sm font-medium ${status === tab ? 'bg-gray-900 text-white' : 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-50'}`}
          >
            {tab[0].toUpperCase() + tab.slice(1)}
            {tab !== 'all' && counts[tab] !== undefined ? ` (${counts[tab]})` : ''}
          </button>
        ))}
        <select
          aria-label="Source"
          value={source}
          onChange={(e) => {
            setSource(e.target.value as Source | '');
            setPage(1);
          }}
          className="rounded-lg border border-gray-300 px-2 py-1 text-sm"
        >
          <option value="">All sources</option>
          {SOURCES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <select
          aria-label="Level"
          value={level}
          onChange={(e) => {
            setLevel(e.target.value as '' | 'error' | 'warning');
            setPage(1);
          }}
          className="rounded-lg border border-gray-300 px-2 py-1 text-sm"
        >
          <option value="">Errors and warnings</option>
          <option value="error">Errors</option>
          <option value="warning">Warnings</option>
        </select>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setPage(1);
            void load();
          }}
          className="flex gap-2"
        >
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search message or route"
            className="rounded-lg border border-gray-300 px-2 py-1 text-sm"
          />
          <button type="submit" className="rounded-lg bg-indigo-600 px-3 py-1 text-sm font-semibold text-white">
            Search
          </button>
        </form>
      </div>

      {loadError && <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{loadError}</div>}

      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
            <tr>
              <th className="px-3 py-2">Error</th>
              <th className="px-3 py-2">Source</th>
              <th className="px-3 py-2 text-right">Events</th>
              <th className="px-3 py-2">Last seen</th>
              <th className="px-3 py-2">First seen</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading ? (
              <tr>
                <td colSpan={5} className="px-3 py-8 text-center text-gray-500">Loading…</td>
              </tr>
            ) : items.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-3 py-8 text-center text-gray-500">No errors here.</td>
              </tr>
            ) : (
              items.map((item) => (
                <tr key={item._id} className="cursor-pointer hover:bg-gray-50" onClick={() => openDetail(item._id)}>
                  <td className="max-w-xl px-3 py-2">
                    <div className="flex items-center gap-2">
                      <span className={`h-2 w-2 shrink-0 rounded-full ${item.level === 'error' ? 'bg-red-500' : 'bg-amber-400'}`} aria-label={item.level} />
                      <span className="font-medium text-gray-900">{item.name}</span>
                      {item.regressedAt && item.status === 'open' && (
                        <span className="rounded bg-red-100 px-1.5 text-xs font-medium text-red-700">regressed</span>
                      )}
                    </div>
                    <div className="truncate text-gray-600" title={item.message}>{item.message}</div>
                    {item.route && <div className="truncate text-xs text-gray-400">{item.route}</div>}
                  </td>
                  <td className="px-3 py-2 text-gray-700">{item.source}</td>
                  <td className="px-3 py-2 text-right font-mono">{item.count}</td>
                  <td className="px-3 py-2 text-gray-700" title={item.lastSeenAt}>{timeAgo(item.lastSeenAt)}</td>
                  <td className="px-3 py-2 text-gray-500" title={item.firstSeenAt}>{timeAgo(item.firstSeenAt)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-sm text-gray-600">
        <span>{total} issue{total === 1 ? '' : 's'}</span>
        <div className="flex gap-2">
          <button type="button" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="rounded border px-2 py-1 disabled:opacity-40">Previous</button>
          <span>Page {page} of {pages}</span>
          <button type="button" disabled={page >= pages} onClick={() => setPage((p) => p + 1)} className="rounded border px-2 py-1 disabled:opacity-40">Next</button>
        </div>
      </div>

      {selected && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={() => setSelected(null)}>
          <aside
            role="dialog"
            aria-label="Error details"
            className="h-full w-full max-w-2xl overflow-y-auto bg-white p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-bold text-gray-900">{selected.name}</h2>
                <p className="mt-1 break-words text-gray-700">{selected.message}</p>
                <p className="mt-2 text-xs text-gray-500">
                  {selected.source} · {selected.level} · {selected.count} events · first {new Date(selected.firstSeenAt).toLocaleString()} · last {new Date(selected.lastSeenAt).toLocaleString()}
                  {selected.lastRelease ? ` · release ${selected.lastRelease}` : ''}
                </p>
              </div>
              <button type="button" onClick={() => setSelected(null)} className="text-gray-500 hover:text-gray-900" aria-label="Close">✕</button>
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              {(['resolved', 'ignored', 'open'] as Status[])
                .filter((s) => s !== selected.status)
                .map((s) => (
                  <button
                    key={s}
                    type="button"
                    disabled={saving}
                    onClick={() => update(selected._id, { status: s })}
                    className={`rounded-lg px-3 py-1.5 text-sm font-semibold disabled:opacity-50 ${s === 'resolved' ? 'bg-green-600 text-white' : 'border border-gray-300 text-gray-700'}`}
                  >
                    {s === 'resolved' ? 'Mark resolved' : s === 'ignored' ? 'Ignore' : 'Reopen'}
                  </button>
                ))}
              <span className="self-center text-xs text-gray-500">
                Status: {selected.status}
                {selected.resolvedBy ? ` by ${selected.resolvedBy}` : ''}
              </span>
            </div>

            <label className="mt-4 block text-sm font-medium text-gray-700">
              Note
              <textarea
                defaultValue={selected.note || ''}
                onBlur={(e) => {
                  if (e.target.value !== (selected.note || '')) void update(selected._id, { note: e.target.value });
                }}
                rows={2}
                placeholder="Cause, fix, ticket link…"
                className="mt-1 w-full rounded-lg border border-gray-300 p-2 text-sm"
              />
            </label>

            <h3 className="mt-6 text-sm font-semibold text-gray-900">Recent events</h3>
            {(selected.samples || []).map((sample, i) => (
              <div key={i} className="mt-3 rounded-lg border border-gray-200 p-3 text-xs">
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-gray-600">
                  <span>{new Date(sample.at).toLocaleString()}</span>
                  {sample.method && sample.url && <span>{sample.method} {sample.url}</span>}
                  {!sample.method && sample.url && <span>{sample.url}</span>}
                  {sample.requestId && <span>request {sample.requestId}</span>}
                  {sample.userId && <span>user {sample.userId}</span>}
                  {sample.partnerId && <span>partner {sample.partnerId}</span>}
                  {sample.digest && <span>digest {sample.digest}</span>}
                  {sample.release && <span>release {sample.release}</span>}
                </div>
                {sample.message !== selected.message && <p className="mt-1 break-words text-gray-800">{sample.message}</p>}
                {sample.userAgent && <p className="mt-1 truncate text-gray-400" title={sample.userAgent}>{sample.userAgent}</p>}
                {sample.context && Object.keys(sample.context).length > 0 && (
                  <pre className="mt-2 overflow-x-auto rounded bg-gray-50 p-2">{JSON.stringify(sample.context, null, 2)}</pre>
                )}
                {sample.stack && <pre className="mt-2 max-h-64 overflow-auto rounded bg-gray-900 p-2 text-gray-100">{sample.stack}</pre>}
              </div>
            ))}
          </aside>
        </div>
      )}
    </div>
  );
}

export default function AdminErrorsPage() {
  return (
    <AdminGoogleAuth title="Errors" subtitle="Sign in with an admin account to review errors">
      <div className="min-h-screen bg-gray-50">
        <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
          <AdminNavigation
            title="Errors"
            subtitle="Errors and warnings from the website, server and partner apps. Repeats are grouped; a resolved issue reopens if it happens again."
            showBackButton
          />
          <ErrorsContent />
        </div>
      </div>
    </AdminGoogleAuth>
  );
}
