'use client';

/**
 * TOOL: Compress PDF — rebuilds each page as a re-encoded JPEG image at the chosen
 * quality/resolution. Great for scans & photo-heavy PDFs; text becomes raster.
 */
import { useCallback, useState } from 'react';
import { FileMinus, FileText, Image as ImageIcon, Loader2, Download } from 'lucide-react';
import { ToolShell, Panel } from '@/components/tool/ToolShell';
import { UploadZone, FilePill, ProgressView, ErrorNotice, SuccessNotice, EmptyPreview } from '@/components/tool/shared';
import { canvasToBlob, cn, downloadBlob, formatFileSize } from '@/lib/utils';
import { useToast } from '@/app/providers';
import { PDFDocument } from 'pdf-lib';

export default function CompressPdfPage() {
  const { toast } = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [quality, setQuality] = useState(60);
  const [dpi, setDpi] = useState(110);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ stage: string; progress: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ blob: Blob; from: number } | null>(null);

  const onFiles = useCallback(async (files: File[]) => {
    const f = files[0];
    setError(null); setResult(null);
    if (f.type !== 'application/pdf' && !f.name.toLowerCase().endsWith('.pdf')) { setError('That file is not a PDF.'); return; }
    setProgress({ stage: 'Reading PDF…', progress: 40 });
    try {
      const doc = await PDFDocument.load(await f.arrayBuffer(), { ignoreEncryption: true });
      setFile(f); setPageCount(doc.getPageCount());
      setProgress(null);
    } catch {
      setProgress(null);
      setError('Could not open this PDF — it may be corrupted or password-protected.');
    }
  }, []);

  const compress = useCallback(async () => {
    if (!file || busy) return;
    setBusy(true); setError(null); setResult(null);
    setProgress({ stage: 'Loading renderer…', progress: 5 });
    try {
      const pdfjs = await import('pdfjs-dist');
      pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.js';
      const bytes = await file.arrayBuffer();
      const pdf = await pdfjs.getDocument({ data: bytes }).promise;
      const out = await PDFDocument.create();
      const scale = dpi / 72;
      const n = Math.min(pdf.numPages, 60);

      for (let i = 1; i <= n; i++) {
        const page = await pdf.getPage(i);
        const vp = page.getViewport({ scale });
        setProgress({ stage: `Re-encoding page ${i}/${n}…`, progress: 5 + ((i / n) * 85) });
        const c = document.createElement('canvas');
        c.width = Math.ceil(vp.width); c.height = Math.ceil(vp.height);
        const ctx = c.getContext('2d')!;
        ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, c.width, c.height);
        await page.render({ canvasContext: ctx, viewport: vp }).promise;
        const blob = await canvasToBlob(c, 'image/jpeg', quality / 100);
        const jpg = await out.embedJpg(await blob.arrayBuffer());
        const p = out.addPage([c.width / scale, c.height / scale]);
        p.drawImage(jpg, { x: 0, y: 0, width: c.width / scale, height: c.height / scale });
        // yield to keep UI responsive
        if (i % 3 === 0) await new Promise((r) => setTimeout(r, 16));
      }
      setProgress({ stage: 'Saving…', progress: 95 });
      const saved = await out.save();
      const blob = new Blob([saved.slice().buffer as ArrayBuffer], { type: 'application/pdf' });
      setResult({ blob, from: file.size });
      setBusy(false); setProgress(null);
      if (blob.size >= file.size) {
        toast('Compressed file is not smaller — try lowering DPI or quality.', 'info');
      } else {
        toast(`Saved ${formatFileSize(file.size - blob.size)} (${Math.round((1 - blob.size / file.size) * 100)}% smaller).`, 'success');
      }
    } catch (e) {
      console.error(e);
      setBusy(false); setProgress(null);
      setError('Compression failed. The PDF may use unsupported features — try the PDF Editor export instead.');
    }
  }, [file, busy, quality, dpi, toast]);

  const reset = () => { setFile(null); setPageCount(0); setResult(null); setError(null); setProgress(null); };

  const controls = !file ? (
    <UploadZone accept="application/pdf" onFiles={onFiles} onError={setError} maxSizeMB={100} label="Drag & drop a PDF or tap to upload" />
  ) : (
    <>
      <FilePill pdf name={file.name} size={file.size} meta={`${pageCount} pages`} onReplace={reset} />
      {error && <ErrorNotice message={error} />}
      {progress && <ProgressView stage={progress.stage} progress={progress.progress} />}
      <Panel title="Compression settings">
        <label className="text-xs font-medium">Image quality: {quality}%</label>
        <input type="range" min={20} max={95} value={quality} onChange={(e) => setQuality(Number(e.target.value))} className="mt-1 w-full" aria-label="Image quality" />
        <label className="mt-3 block text-xs font-medium">Resolution: {dpi} DPI</label>
        <input type="range" min={72} max={200} step={1} value={dpi} onChange={(e) => setDpi(Number(e.target.value))} className="mt-1 w-full" aria-label="Resolution DPI" />
        <div className="mt-3 flex gap-2">
          {[{ q: 45, d: 90, label: 'Max shrink' }, { q: 60, d: 110, label: 'Balanced' }, { q: 80, d: 150, label: 'High quality' }].map((p) => (
            <button key={p.label} onClick={() => { setQuality(p.q); setDpi(p.d); }}
              className={cn('flex-1 rounded-lg border py-1.5 text-[11px] font-semibold transition-colors',
                quality === p.q && dpi === p.d ? 'border-primary bg-primary/10 text-primary' : 'border-border hover:bg-muted')}>
              {p.label}
            </button>
          ))}
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          Pages are re-rendered as JPEG images. Text will no longer be selectable — best for scans and photo PDFs. Max 60 pages.
        </p>
        <button onClick={compress} disabled={busy}
          className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-2.5 font-semibold text-primary-foreground transition hover:opacity-90 active:scale-95 disabled:opacity-50">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileMinus className="h-4 w-4" />} Compress PDF
        </button>
      </Panel>
      {result && (
        <div className="space-y-2">
          <SuccessNotice
            message={`${formatFileSize(result.from)} → ${formatFileSize(result.blob.size)} (${Math.max(0, Math.round((1 - result.blob.size / result.from) * 100))}% smaller)`}
          />
          <button onClick={() => downloadBlob(result.blob, `compressed-${Date.now()}.pdf`)}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-3 font-semibold text-primary-foreground hover:opacity-90 active:scale-[0.98]">
            <Download className="h-5 w-5" /> Download compressed PDF
          </button>
        </div>
      )}
    </>
  );

  const preview = !file ? (
    <EmptyPreview icon={<FileText className="h-16 w-16" />} title="No PDF loaded" subtitle="Compress large PDFs by re-encoding page images — great for scanned documents." />
  ) : (
    <EmptyPreview icon={<FileMinus className="h-16 w-16" />} title="Ready to compress" subtitle="Choose quality/resolution and hit Compress. Your original stays untouched." />
  );

  return (
    <ToolShell title="Compress PDF"
      description="Reduce PDF file size by re-rendering pages at a quality & resolution you control. Best for scans and image-heavy documents."
      onReset={reset} controls={controls} preview={preview} />
  );
}
