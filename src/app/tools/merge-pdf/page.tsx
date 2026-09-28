'use client';

/**
 * TOOL: Merge PDFs — combine multiple PDFs into one, reorder before merging.
 */
import { useCallback, useState } from 'react';
import { Combine, FileText, ArrowUp, ArrowDown, Trash2, Loader2, Download, Plus } from 'lucide-react';
import { ToolShell, Panel } from '@/components/tool/ToolShell';
import { UploadZone, ProgressView, ErrorNotice, SuccessNotice, EmptyPreview } from '@/components/tool/shared';
import { cn, downloadBlob, formatFileSize } from '@/lib/utils';
import { useToast } from '@/app/providers';
import { PDFDocument } from 'pdf-lib';

interface Item { id: string; file: File }

export default function MergePdfPage() {
  const { toast } = useToast();
  const [items, setItems] = useState<Item[]>([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ stage: string; progress: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ blob: Blob; pages: number } | null>(null);
  const uid = () => Math.random().toString(36).slice(2, 10);

  const onFiles = useCallback((files: File[]) => {
    const valid = files.filter((f) => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf'));
    const rejected = files.length - valid.length;
    if (rejected) setError(`${rejected} file(s) skipped — only PDFs can be merged.`);
    else setError(null);
    setItems((prev) => [...prev, ...valid.map((f) => ({ id: uid(), file: f }))].slice(0, 40));
    setResult(null);
  }, []);

  const move = (id: string, dir: -1 | 1) => {
    setItems((prev) => {
      const i = prev.findIndex((x) => x.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  };

  const merge = useCallback(async () => {
    if (items.length < 2) { setError('Add at least two PDFs to merge.'); return; }
    setBusy(true); setError(null); setResult(null);
    setProgress({ stage: 'Starting merge…', progress: 5 });
    try {
      const out = await PDFDocument.create();
      let pageCount = 0;
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        setProgress({ stage: `Adding ${it.file.name}…`, progress: 5 + ((i / items.length) * 80) });
        try {
          const src = await PDFDocument.load(await it.file.arrayBuffer(), { ignoreEncryption: true });
          const pages = await out.copyPages(src, src.getPageIndices());
          pages.forEach((p) => out.addPage(p));
          pageCount += pages.length;
        } catch {
          setError(`"${it.file.name}" is corrupted or password-protected and was skipped.`);
        }
      }
      if (!pageCount) throw new Error('empty');
      setProgress({ stage: 'Saving merged PDF…', progress: 92 });
      const bytes = await out.save();
      const blob = new Blob([bytes.slice().buffer as ArrayBuffer], { type: 'application/pdf' });
      setResult({ blob, pages: pageCount });
      toast(`Merged ${pageCount} pages.`, 'success');
    } catch {
      setError('Merge failed — no readable pages found in the selected PDFs.');
    }
    setBusy(false); setProgress(null);
  }, [items, toast]);

  const reset = () => { setItems([]); setResult(null); setError(null); setProgress(null); };
  const totalSize = items.reduce((s, i) => s + i.file.size, 0);

  const controls = (
    <>
      <UploadZone accept="application/pdf" multiple onFiles={onFiles} onError={setError} maxSizeMB={100}
        label={items.length ? 'Add more PDFs' : 'Drag & drop PDFs or tap to upload'} sublabel="2–40 PDFs · order shown below" />
      {error && <ErrorNotice message={error} />}
      {progress && <ProgressView stage={progress.stage} progress={progress.progress} />}
      {items.length > 0 && !busy && (
        <button onClick={merge} className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-3 font-semibold text-primary-foreground transition hover:opacity-90 active:scale-[0.98]">
          {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Combine className="h-5 w-5" />} Merge {items.length} PDFs
        </button>
      )}
      {result && (
        <div className="space-y-2">
          <SuccessNotice message={`Merged ${result.pages} pages — ${formatFileSize(result.blob.size)}`} />
          <button onClick={() => downloadBlob(result.blob, `merged-${Date.now()}.pdf`)}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-3 font-semibold text-primary-foreground hover:opacity-90 active:scale-[0.98]">
            <Download className="h-5 w-5" /> Download merged PDF
          </button>
        </div>
      )}
    </>
  );

  const preview = items.length === 0 ? (
    <EmptyPreview icon={<FileText className="h-16 w-16" />} title="No PDFs yet" subtitle="Add two or more PDFs and merge them into a single document in any order." />
  ) : (
    <Panel title={`Documents (${items.length}) · ${formatFileSize(totalSize)} total`}>
      <ul className="space-y-2" aria-label="Merge order">
        {items.map((it, i) => (
          <li key={it.id} className={cn('flex items-center gap-2 rounded-xl border p-2.5', 'border-border bg-muted/30')}>
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-card text-xs font-bold text-muted-foreground">{i + 1}</span>
            <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium" title={it.file.name}>{it.file.name}</p>
              <p className="text-xs text-muted-foreground">{formatFileSize(it.file.size)}</p>
            </div>
            <button aria-label="Move up" onClick={() => move(it.id, -1)} disabled={i === 0} className="rounded-lg p-2 hover:bg-muted disabled:opacity-30"><ArrowUp className="h-4 w-4" /></button>
            <button aria-label="Move down" onClick={() => move(it.id, 1)} disabled={i === items.length - 1} className="rounded-lg p-2 hover:bg-muted disabled:opacity-30"><ArrowDown className="h-4 w-4" /></button>
            <button aria-label="Remove" onClick={() => setItems((p) => p.filter((x) => x.id !== it.id))} className="rounded-lg p-2 text-destructive hover:bg-destructive/10"><Trash2 className="h-4 w-4" /></button>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-muted-foreground">PDFs are merged in this order — use the arrows to reorder.</p>
    </Panel>
  );

  return (
    <ToolShell title="Merge PDFs"
      description="Combine multiple PDF documents into one file, in exactly the order you choose."
      onReset={reset} controls={controls} preview={preview} />
  );
}
