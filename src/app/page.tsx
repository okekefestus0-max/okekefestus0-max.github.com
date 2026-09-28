'use client';

import { useEffect, useMemo, useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Search, Sparkles, ShieldCheck, WifiOff, Download, X, Clock3 } from 'lucide-react';
import { AppFrame } from '@/components/tool/ToolShell';
import { searchTools, categories } from '@/registry/tools';
import { cn } from '@/lib/utils';
import type { BeforeInstallPromptEvent, CategoryId, ToolConfig } from '@/types';

function Dashboard() {
  const params = useSearchParams();
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState<CategoryId | 'all'>((params.get('tab') as CategoryId) || 'all');
  const [installEvt, setInstallEvt] = useState<BeforeInstallPromptEvent | null>(null);
  const [installDismissed, setInstallDismissed] = useState(false);

  useEffect(() => {
    const onPrompt = (e: Event) => { e.preventDefault(); setInstallEvt(e as BeforeInstallPromptEvent); };
    const onInstalled = () => setInstallEvt(null);
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  useEffect(() => {
    const t = params.get('tab') as CategoryId | null;
    if (t && ['image', 'pdf', 'more'].includes(t)) setTab(t);
  }, [params]);

  const results = useMemo(() => {
    const found = searchTools(query);
    return tab === 'all' ? found : found.filter((t) => t.category === tab);
  }, [query, tab]);

  const live = results.filter((t) => !t.comingSoon);
  const soon = results.filter((t) => t.comingSoon);

  return (
    <AppFrame>
      <main className="mx-auto max-w-7xl px-3 pb-24 pt-6 md:px-6 md:pb-10">
        {/* Hero */}
        <section className="mb-8 overflow-hidden rounded-2xl border border-border bg-gradient-to-br from-primary/10 via-card to-card p-6 md:p-10">
          <div className="max-w-2xl">
            <h1 className="text-3xl font-extrabold tracking-tight md:text-4xl">
              Every image & PDF tool, <span className="text-primary">in one box.</span>
            </h1>
            <p className="mt-3 text-muted-foreground">
              Remove backgrounds, upscale photos, grade colors, edit PDFs, run OCR — all processed
              <strong> on your device</strong>. No uploads. No login. Works offline.
            </p>
            <div className="mt-5 flex flex-wrap gap-x-5 gap-y-2 text-sm text-muted-foreground">
              <span className="flex items-center gap-1.5"><ShieldCheck className="h-4 w-4 text-emerald-500" /> Private by design</span>
              <span className="flex items-center gap-1.5"><WifiOff className="h-4 w-4 text-emerald-500" /> Works offline (PWA)</span>
              <span className="flex items-center gap-1.5"><Sparkles className="h-4 w-4 text-emerald-500" /> 16 tools, free forever</span>
            </div>
          </div>
          <div className="mt-6 relative max-w-xl">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search tools — e.g. “compress”, “pdf”, “qr”…"
              aria-label="Search tools"
              className="w-full rounded-xl border border-input bg-background py-3 pl-11 pr-4 text-sm shadow-sm outline-none ring-primary transition focus:ring-2"
            />
          </div>
        </section>

        {/* Category pills */}
        <div className="mb-5 flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label="Filter by category">
          {[{ id: 'all' as const, name: 'All tools' }, ...categories].map((c) => (
            <button
              key={c.id}
              role="tab"
              aria-selected={tab === c.id}
              onClick={() => setTab(c.id as CategoryId | 'all')}
              className={cn(
                'whitespace-nowrap rounded-full border px-4 py-2 text-sm font-medium transition-colors',
                tab === c.id ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card text-muted-foreground hover:text-foreground'
              )}
            >
              {c.name}
            </button>
          ))}
        </div>

        {/* Live tools */}
        {live.length > 0 ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {live.map((tool) => <ToolCard key={tool.id} tool={tool} />)}
          </div>
        ) : (
          !soon.length && (
            <div className="rounded-xl border border-dashed border-border p-12 text-center text-muted-foreground">
              <Search className="mx-auto mb-3 h-8 w-8 opacity-40" />
              No tools match “{query}”. Try a different search.
            </div>
          )
        )}

        {/* Coming soon */}
        {soon.length > 0 && (
          <>
            <h2 className="mb-3 mt-8 flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              <Clock3 className="h-4 w-4" /> Coming soon
            </h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {soon.map((tool) => <ToolCard key={tool.id} tool={tool} />)}
            </div>
          </>
        )}
      </main>

      {/* PWA install banner */}
      {installEvt && !installDismissed && (
        <div className="fixed bottom-20 left-4 right-4 z-50 md:bottom-6 md:left-auto md:right-6 md:w-96 animate-slide-up">
          <div className="rounded-xl border border-border bg-card p-4 shadow-xl">
            <div className="flex items-start gap-3">
              <span className="rounded-lg bg-primary/10 p-2 text-primary"><Download className="h-5 w-5" /></span>
              <div className="flex-1">
                <p className="font-semibold">Install ToolBox Studio</p>
                <p className="mt-0.5 text-sm text-muted-foreground">Add to your home screen for instant, offline access.</p>
              </div>
              <button aria-label="Dismiss" onClick={() => setInstallDismissed(true)} className="text-muted-foreground hover:text-foreground">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="mt-3 flex gap-2">
              <button
                onClick={async () => { await installEvt.prompt(); if ((await installEvt.userChoice).outcome === 'accepted') setInstallEvt(null); }}
                className="flex-1 rounded-lg bg-primary py-2 text-sm font-semibold text-primary-foreground hover:opacity-90"
              >
                Install
              </button>
              <button
                onClick={() => setInstallDismissed(true)}
                className="flex-1 rounded-lg border border-border py-2 text-sm font-medium hover:bg-muted"
              >
                Not now
              </button>
            </div>
          </div>
        </div>
      )}
    </AppFrame>
  );
}

function ToolCard({ tool }: { tool: ToolConfig }) {
  const Icon = tool.icon;
  const inner = (
    <div
      className={cn(
        'group flex h-full flex-col gap-3 rounded-2xl border p-4 transition-all',
        tool.comingSoon
          ? 'border-dashed border-border bg-muted/30 opacity-70'
          : 'border-border bg-card hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-lg'
      )}
    >
      <div className="flex items-start justify-between">
        <span className={cn(
          'flex h-11 w-11 items-center justify-center rounded-xl transition-colors',
          tool.comingSoon ? 'bg-muted text-muted-foreground' : 'bg-primary/10 text-primary group-hover:bg-primary group-hover:text-primary-foreground'
        )}>
          <Icon className="h-5 w-5" />
        </span>
        {tool.badge && (
          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-primary">{tool.badge}</span>
        )}
        {tool.comingSoon && (
          <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-600 dark:text-amber-400">Soon</span>
        )}
      </div>
      <div>
        <h3 className="font-semibold">{tool.name}</h3>
        <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{tool.description}</p>
      </div>
    </div>
  );

  if (tool.comingSoon) {
    return <div aria-disabled role="article" className="h-full cursor-not-allowed">{inner}</div>;
  }
  return (
    <Link href={tool.route} className="h-full focus:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-2xl">
      {inner}
    </Link>
  );
}

export default function HomePage() {
  return (
    <Suspense fallback={null}>
      <Dashboard />
    </Suspense>
  );
}
