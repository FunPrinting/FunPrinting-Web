'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import { FileText, Plus, RefreshCw, Search } from 'lucide-react';
import { borderCss, DEFAULT_BORDER, type BorderPreference } from '@/lib/templateBorders';
import { TEMPLATE_CATEGORIES } from '@/lib/templates';
import { TemplateCard, type TemplateSummary } from '@/components/templates/TemplateCard';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

type View = 'all' | 'favourites' | 'mine';

export default function TemplatesPage() {
  const router = useRouter();
  const { status } = useSession();
  const signedIn = status === 'authenticated';
  const [templates, setTemplates] = useState<TemplateSummary[] | null>(null);
  const [error, setError] = useState('');
  const [view, setView] = useState<View>('all');
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('all');
  const [border, setBorder] = useState<BorderPreference>(DEFAULT_BORDER);

  const load = useCallback(async () => {
    setError('');
    try {
      const data = await (await fetch('/api/templates')).json();
      if (!data.success) throw new Error(data.error);
      setTemplates(data.templates);
    } catch {
      setError('We couldn’t load the templates. Check your connection and try again.');
    }
  }, []);

  useEffect(() => {
    if (status === 'loading') return;
    load();
    if (signedIn) {
      fetch('/api/user/profile')
        .then((r) => r.json())
        .then((d) => d.success && d.profile?.templateBorderPreference && setBorder(d.profile.templateBorderPreference))
        .catch(() => undefined);
    }
  }, [status, signedIn, load]);

  const toggleFavourite = async (t: TemplateSummary) => {
    if (!signedIn) return router.push('/auth/signin?callbackUrl=/templates');
    const was = t.isFavorite;
    setTemplates((all) => all?.map((x) => (x.id === t.id ? { ...x, isFavorite: !was } : x)) ?? null);
    try {
      const res = await fetch('/api/user/favorites', { method: was ? 'DELETE' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ templateId: t.id }) });
      if (!(await res.json()).success) throw new Error();
    } catch {
      setTemplates((all) => all?.map((x) => (x.id === t.id ? { ...x, isFavorite: was } : x)) ?? null);
      toast.error('We couldn’t update your favourites. Please try again.');
    }
  };

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (templates ?? []).filter((t) => {
      if (view === 'favourites' && !t.isFavorite) return false;
      if (view === 'mine' && !t.isMine) return false;
      if (category !== 'all' && t.category !== category) return false;
      return !q || t.name.toLowerCase().includes(q) || (t.description ?? '').toLowerCase().includes(q);
    });
  }, [templates, view, search, category]);

  const top = view === 'all' && !search && category === 'all' ? shown.filter((t) => t.rank).sort((a, b) => (a.rank ?? 9) - (b.rank ?? 9)) : [];
  const rest = shown.filter((t) => !top.includes(t));
  const favStyle = borderCss(border);

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold">Templates</h1>
          <p className="mt-1 text-muted-foreground">Pick a template, fill in your details, and print the finished document.</p>
        </div>
        {signedIn ? <Button asChild><Link href="/templates/create"><Plus />Create a template</Link></Button> : null}
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <div className="relative min-w-56 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search templates" aria-label="Search templates" className="pl-9" />
        </div>
        <Select value={category} onValueChange={setCategory}>
          <SelectTrigger className="w-48" aria-label="Category"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All categories</SelectItem>
            {TEMPLATE_CATEGORIES.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
          </SelectContent>
        </Select>
        {signedIn ? (
          <Tabs value={view} onValueChange={(v) => setView(v as View)}>
            <TabsList>
              <TabsTrigger value="all">All</TabsTrigger>
              <TabsTrigger value="favourites">Favourites</TabsTrigger>
              <TabsTrigger value="mine">Mine</TabsTrigger>
            </TabsList>
          </Tabs>
        ) : null}
      </div>

      <div className="mt-8 space-y-10">
        {error ? (
          <Card><CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <p>{error}</p>
            <Button variant="outline" onClick={load}><RefreshCw />Try again</Button>
          </CardContent></Card>
        ) : templates === null ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{[0, 1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-48 rounded-xl" />)}</div>
        ) : !shown.length ? (
          <Card><CardContent className="flex flex-col items-center gap-3 py-14 text-center">
            <span className="grid size-12 place-items-center rounded-full bg-accent text-accent-foreground"><FileText className="size-6" aria-hidden /></span>
            <h2 className="font-semibold">{view === 'favourites' ? 'No favourites yet' : view === 'mine' ? 'You haven’t made a template yet' : 'No templates found'}</h2>
            <p className="max-w-sm text-sm text-muted-foreground">
              {view === 'favourites' ? 'Tap the heart on a template to keep it here.' : view === 'mine' ? 'Upload a Word file with {{placeholders}} and others can fill it in.' : 'Try a different search or category.'}
            </p>
            {view === 'mine' ? <Button asChild><Link href="/templates/create">Create a template</Link></Button> : null}
          </CardContent></Card>
        ) : (
          <>
            {top.length ? (
              <section aria-labelledby="top">
                <h2 id="top" className="mb-3 text-lg font-semibold">Most used</h2>
                <div className="grid gap-4 md:grid-cols-3">{top.map((t) => <TemplateCard key={t.id} t={t} favouriteStyle={favStyle} onToggleFavourite={toggleFavourite} />)}</div>
              </section>
            ) : null}
            {rest.length ? (
              <section aria-label="Templates">
                {top.length ? <h2 className="mb-3 text-lg font-semibold">All templates</h2> : null}
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{rest.map((t) => <TemplateCard key={t.id} t={t} favouriteStyle={favStyle} onToggleFavourite={toggleFavourite} />)}</div>
              </section>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
