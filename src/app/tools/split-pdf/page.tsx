'use client';

/**
 * TOOL: Split PDF — extract page ranges or split into individual pages.
 */
import { useCallback, useState } from 'react';
import { Split, FileText, Loader2, Download, Scissors } from 'lucide-react';
import { ToolShell, Panel } from '@/components/tool/ToolShell';
import { UploadZone, FilePill, ProgressView, ErrorNotice, SuccessNotice, EmptyPreview } from '@/components/tool/shared';
import { cn, downloadBlob, formatFileSize } from '@/lib/utils';
import { useToast } from '@/app/providers';
import { PDFDocument } from 'pdf-lib';

type Mode = 'range' | 'pages' | 'all';

export default function SplitPdfPage() {
  const { toast } = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [mode, setMode] = useState<Mode>('range');
  const [rangeText, setRangeText] = useState('1-3');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ stage: string; progress: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<{ name: string; blob: Blob; pages: number }[]>([]);

  const onFiles = useCallback(async (files: File[]) => {
    const f = files[0];
    setError(null); setResults([]);
    if (f.type !== 'application/pdf' && !f.name.toLowerCase().endsWith('.pdf')) {
      setError('That file is not a PDF.'); return;
    }
    setProgress({ stage: 'Reading PDF…', progress: 40 });
    try {
      const doc = await PDFDocument.load(await f.arrayBuffer(), { ignoreEncryption: true });
      const n = doc.getPageCount();
      setFile(f); setPageCount(n);
      setRangeText(`1-${Math.min(3, n)}`);
      setProgress(null);
      toast(`Loaded ${n} pages.`, 'success');
    } catch {
      setProgress(null);
      setError('Could not open this PDF — it may be corrupted or password-protected.');
    }
  }, [toast]);

  const parseRanges = (text: string, max: number): number[][] => {
    const out: number[][] = [];
    for (const part of text.split(',').map((s) => s.trim()).filter(Boolean)) {
      const m = part.match(/^(\d+)\s*-\s*(\d+)$|^(\d+)$/);
      if (!m) throw new Error(`Bad range "${part}"`);
      const a = Number(m[1] ?? m[3]);
      const b = Number(m[2] ?? m[3]);
      if (a < 1 || b > max || a > b) throw new Error(`Range "${part}" is outside 1–${max}`);
      out.push(Array.from({ length: b - a + 1 }, (_, i) => a - 1 + i));
    }
    if (!out.length) throw new Error('Enter at least one page or range.');
    return out;
  };

  const split = useCallback(async () => {
    if (!file) return;
    setBusy(true); setError(null); setResults([]);
    setProgress({ stage: 'Preparing…', progress: 10 });
    try {
      const bytes = await file.arrayBuffer();
      const jobs: { name: string; indices: number[] }[] = [];
      if (mode === 'all') {
        for (let i = 0; i < pageCount; i++) jobs.push({ name: `page-${i + 1}`, indices: [i] });
      } else {
        const ranges = parseRanges(rangeText, pageCount);
        ranges.forEach((idx, i) => jobs.push({
          name: idx.length === 1 ? `page-${idx[0] + 1}` : `pages-${idx[0] + 1}-${idx[idx.length - 1] + 1}`,
          indices: idx,
        }));
      }
      const docs: { name: string; blob: Blob; pages: number }[] = [];
      for (let i = 0; i < jobs.length; i++) {
        const job = jobs[i];
        setProgress({ stage: `Extracting ${job.name}…`, progress: 10 + ((i / jobs.length) * 80) });
        const src = await PDFDocument.load(bytes.slice(0));
        const out = await PDFDocument.create();
        const pages = await out.copyPages(src, job.indices);
        pages.forEach((p) => out.addPage(p));
        const b = await out.save();
        docs.push({ name: job.name, blob: new Blob([b.slice().buffer as ArrayBuffer], { type: 'application/pdf' }), pages: job.indices.length });
      }
      setResults(docs);
      toast(`Created ${docs.length} PDF${docs.length > 1 ? 's' : ''}.`, 'success');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Split failed — check your page ranges.');
    }
    setBusy(false); setProgress(null);
  }, [file, mode, rangeText, pageCount, toast]);

  const downloadAll = useCallback(async () => {
    for (const r of results) {
      downloadBlob(r.blob, `${r.name}.pdf`);
      await new Promise((res) => setTimeout(res, 250));
    }
  }, [results]);

  const reset = () => { setFile(null); setPageCount(0); setResults([]); setError(null); setProgress(null); };

  const controls = !file ? (
    <UploadZone accept="application/pdf" onFiles={onFiles} onError={setError} maxSizeMB={100} label="Drag & drop a PDF or tap to upload" />
  ) : (
    <>
      <FilePill pdf name={file.name} size={file.size} meta={`${pageCount} pages`} onReplace={reset} />
      {error && <ErrorNotice message={error} />}
      {progress && <ProgressView stage={progress.stage} progress={progress.progress} />}
      <Panel title="Split mode">
        <div className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1">
          {([['range', 'By range'], ['all', 'Every page']] as [Mode, string][]).map(([m, label]) => (
            <button key={m} onClick={() => setMode(m)}
              className={cn('rounded-md py-2 text-xs font-bold', mode === m ? 'bg-card shadow' : 'text-muted-foreground')}>
              {label}
            </button>
          ))}
        </div>
        {mode === 'range' && (
          <div className="mt-3">
            <input value={rangeText} onChange={(e) => setRangeText(e.target.value)}
              placeholder="e.g. 1-3, 5, 7-9" aria-label="Page ranges"
              className="w-full rounded-lg border border-input bg-background px-3 py-2 font-mono text-sm" />
            <p className="mt-1 text-xs text-muted-foreground">Comma-separated ranges within 1–{pageCount}, e.g. “1-3, 5, 7-9”.</p>
          </div>
        )}
        <button onClick={split} disabled={busy}
          className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-2.5 font-semibold text-primary-foreground transition hover:opacity-90 active:scale-95 disabled:opacity-50">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Scissors className="h-4 w-4" />} Split PDF
        </button>
      </Panel>
    </>
  );

  const preview = !file ? (
    <EmptyPreview icon={<Split className="h-16 w-16" />} title="No PDF loaded" subtitle="Split a PDF by page ranges (“1-3, 5”) or explode it into one file per page." />
  ) : results.length === 0 ? (
    <EmptyPreview icon={<Scissors className="h-16 w-16" />} title="Ready to split" subtitle="Choose a mode and click Split PDF. Extracted files appear here." />
  ) : (
    <Panel title={`Extracted files (${results.length})`}>
      <ul className="mb-3 space-y-2">
        {results.map((r) => (
          <li key={r.name} className="flex items-center gap-2 rounded-xl border border-border bg-muted/30 p-2.5">
            <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{r.name}.pdf</p>
              <p className="text-xs text-muted-foreground">{r.pages} page{r.pages > 1 ? 's' : ''} · {formatFileSize(r.blob.size)}</p>
            </div>
            <button onClick={() => downloadBlob(r.blob, `${r.name}.pdf`)}
              className="flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-xs font-bold text-primary-foreground hover:opacity-90">
              <Download className="h-3.5 w-3.5" /> Save
            </button>
          </li>
        ))}
      </ul>
      <button onClick={downloadAll} className="flex w-full items-center justify-center gap-2 rounded-xl border border-border py-2.5 text-sm font-semibold hover:bg-muted">
        <Download className="h-4 w-4" /> Download all {results.length}
      </button>
    </Panel>
  );

  return (
    <ToolShell title="Split PDF"
      description="Extract page ranges from a PDF or split it into individual one-page files — right in your browser."
      onReset={reset} controls={controls} preview={preview} />
  );
}
