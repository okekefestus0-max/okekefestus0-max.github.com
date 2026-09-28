'use client';

/**
 * TOOL: PDF to Images — render every page as a downloadable PNG at chosen DPI.
 */
import { useCallback, useState } from 'react';
import { Images, FileText, Loader2, Download, FileImage } from 'lucide-react';
import { ToolShell, Panel } from '@/components/tool/ToolShell';
import { UploadZone, FilePill, ProgressView, ErrorNotice, SuccessNotice, EmptyPreview } from '@/components/tool/shared';
import { downloadBlob, formatFileSize } from '@/lib/utils';
import { useToast } from '@/app/providers';

interface PageImage { name: string; blob: Blob; url: string; w: number; h: number }

export default function PdfToImagesPage() {
  const { toast } = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [dpi, setDpi] = useState(150);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ stage: string; progress: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [images, setImages] = useState<PageImage[]>([]);

  const onFiles = useCallback(async (files: File[]) => {
    const f = files[0];
    setError(null); setImages([]);
    if (f.type !== 'application/pdf' && !f.name.toLowerCase().endsWith('.pdf')) { setError('That file is not a PDF.'); return; }
    setProgress({ stage: 'Reading PDF…', progress: 40 });
    try {
      const pdfjs = await import('pdfjs-dist');
      pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.js';
      const pdf = await pdfjs.getDocument({ data: await f.arrayBuffer() }).promise;
      setFile(f); setPageCount(pdf.numPages);
      setProgress(null);
      toast(`Loaded ${pdf.numPages} pages.`, 'success');
    } catch {
      setProgress(null);
      setError('Could not open this PDF — it may be corrupted or password-protected.');
    }
  }, [toast]);

  const render = useCallback(async () => {
    if (!file || busy) return;
    setBusy(true); setError(null);
    images.forEach((i) => URL.revokeObjectURL(i.url));
    setImages([]);
    setProgress({ stage: 'Loading renderer…', progress: 5 });
    try {
      const pdfjs = await import('pdfjs-dist');
      pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.js';
      const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
      const n = Math.min(pdf.numPages, 40);
      const scale = dpi / 72;
      const out: PageImage[] = [];
      for (let i = 1; i <= n; i++) {
        const page = await pdf.getPage(i);
        const vp = page.getViewport({ scale });
        setProgress({ stage: `Rendering page ${i}/${n}…`, progress: 5 + ((i / n) * 90) });
        const c = document.createElement('canvas');
        c.width = Math.ceil(vp.width); c.height = Math.ceil(vp.height);
        const ctx = c.getContext('2d')!;
        ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, c.width, c.height);
        await page.render({ canvasContext: ctx, viewport: vp }).promise;
        const blob = await new Promise<Blob>((res, rej) => c.toBlob((b) => b ? res(b) : rej(new Error('encode')), 'image/png'));
        out.push({ name: `page-${String(i).padStart(2, '0')}.png`, blob, url: URL.createObjectURL(blob), w: c.width, h: c.height });
        setImages([...out]);
        if (i % 3 === 0) await new Promise((r) => setTimeout(r, 8));
      }
      toast(`Rendered ${n} page${n > 1 ? 's' : ''}${pdf.numPages > 40 ? ' (first 40 shown)' : ''}.`, 'success');
    } catch {
      setError('Rendering failed. Try lowering the DPI.');
    }
    setBusy(false); setProgress(null);
  }, [file, busy, dpi, toast]); // eslint-disable-line

  const downloadAll = useCallback(async () => {
    for (const img of images) { downloadBlob(img.blob, img.name); await new Promise((r) => setTimeout(r, 250)); }
  }, [images]);

  const reset = () => {
    images.forEach((i) => URL.revokeObjectURL(i.url));
    setFile(null); setPageCount(0); setImages([]); setError(null); setProgress(null);
  };

  const controls = !file ? (
    <UploadZone accept="application/pdf" onFiles={onFiles} onError={setError} maxSizeMB={100} label="Drag & drop a PDF or tap to upload" />
  ) : (
    <>
      <FilePill pdf name={file.name} size={file.size} meta={`${pageCount} pages`} onReplace={reset} />
      {error && <ErrorNotice message={error} />}
      {progress && <ProgressView stage={progress.stage} progress={progress.progress} />}
      <Panel title="Export settings">
        <label className="text-xs font-medium">Resolution: {dpi} DPI ({Math.round(dpi / 72 * 100)}% of print size)</label>
        <input type="range" min={72} max={300} value={dpi} onChange={(e) => setDpi(Number(e.target.value))} className="mt-1 w-full" aria-label="DPI" />
        <div className="mt-2 flex gap-2">
          {[96, 150, 300].map((d) => (
            <button key={d} onClick={() => setDpi(d)}
              className={`flex-1 rounded-lg border py-1.5 text-xs font-semibold transition-colors ${dpi === d ? 'border-primary bg-primary/10 text-primary' : 'border-border hover:bg-muted'}`}>
              {d} DPI{d === 96 ? ' (web)' : d === 150 ? ' (default)' : ' (print)'}
            </button>
          ))}
        </div>
        <p className="mt-3 text-xs text-muted-foreground">Pages are exported as PNG images (up to 40 pages).</p>
        <button onClick={render} disabled={busy}
          className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-2.5 font-semibold text-primary-foreground hover:opacity-90 active:scale-95 disabled:opacity-50">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Images className="h-4 w-4" />} Export as images
        </button>
      </Panel>
    </>
  );

  const preview = !file ? (
    <EmptyPreview icon={<FileText className="h-16 w-16" />} title="No PDF loaded" subtitle="Turn PDF pages into high-resolution PNG images at 96–300 DPI." />
  ) : images.length === 0 ? (
    <EmptyPreview icon={<FileImage className="h-16 w-16" />} title="Ready to render" subtitle="Pick a resolution and export. Page previews will appear here." />
  ) : (
    <div className="space-y-3">
      <Panel title={`Rendered images (${images.length})`}>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          {images.map((img) => (
            <div key={img.name} className="space-y-1">
              <img src={img.url} alt={img.name} className="w-full rounded-lg border border-border bg-white" />
              <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                <span className="truncate">{img.name}</span>
                <span>{img.w}×{img.h}</span>
              </div>
              <button onClick={() => downloadBlob(img.blob, img.name)}
                className="flex w-full items-center justify-center gap-1 rounded-lg bg-primary/10 py-1.5 text-[11px] font-bold text-primary hover:bg-primary/20">
                <Download className="h-3 w-3" /> Save ({formatFileSize(img.blob.size)})
              </button>
            </div>
          ))}
        </div>
      </Panel>
      {images.length > 1 && (
        <button onClick={downloadAll} className="flex w-full items-center justify-center gap-2 rounded-xl border border-border py-2.5 text-sm font-semibold hover:bg-muted">
          <Download className="h-4 w-4" /> Download all {images.length} images
        </button>
      )}
    </div>
  );

  return (
    <ToolShell title="PDF to Images"
      description="Export every PDF page as a high-resolution PNG image — choose web, default or print DPI."
      onReset={reset} controls={controls} preview={preview} />
  );
}
