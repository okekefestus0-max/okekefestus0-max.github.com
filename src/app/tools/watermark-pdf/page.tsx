'use client';

/**
 * TOOL: PDF Watermark — diagonal text watermark on every page (or selected range).
 */
import { useCallback, useState } from 'react';
import { Stamp, FileText, Loader2, Download } from 'lucide-react';
import { ToolShell, Panel } from '@/components/tool/ToolShell';
import { UploadZone, FilePill, ProgressView, ErrorNotice, SuccessNotice, EmptyPreview } from '@/components/tool/shared';
import { cn, downloadBlob, formatFileSize } from '@/lib/utils';
import { useToast } from '@/app/providers';
import { PDFDocument, StandardFonts, degrees, rgb } from 'pdf-lib';

export default function WatermarkPdfPage() {
  const { toast } = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [text, setText] = useState('CONFIDENTIAL');
  const [opacity, setOpacity] = useState(0.18);
  const [fontSize, setFontSize] = useState(64);
  const [color, setColor] = useState('#9ca3af');
  const [angle, setAngle] = useState(45);
  const [cover, setCover] = useState<'all' | 'first' | 'center'>('all');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ stage: string; progress: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Blob | null>(null);

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

  const apply = useCallback(async () => {
    if (!file || busy) return;
    if (!text.trim()) { setError('Enter watermark text first.'); return; }
    setBusy(true); setError(null); setResult(null);
    setProgress({ stage: 'Applying watermark…', progress: 20 });
    try {
      const doc = await PDFDocument.load(await file.arrayBuffer(), { ignoreEncryption: true });
      const font = await doc.embedFont(StandardFonts.HelveticaBold);
      const v = color.replace('#', '').padEnd(6, '0');
      const n = parseInt(v, 16);
      const tint = rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
      const pages = doc.getPages();
      for (let i = 0; i < pages.length; i++) {
        if (cover === 'first' && i !== 0) continue;
        const page = pages[i];
        const { width, height } = page.getSize();
        setProgress({ stage: `Watermarking page ${i + 1}/${pages.length}…`, progress: 20 + ((i / pages.length) * 60) });
        const textW = font.widthOfTextAtSize(text, fontSize);
        const stamps: { x: number; y: number }[] =
          cover === 'center' || cover === 'first'
            ? [{ x: width / 2 - textW / 2, y: height / 2 }]
            : [
                { x: width * 0.25 - textW / 2, y: height * 0.25 },
                { x: width * 0.5 - textW / 2, y: height * 0.5 },
                { x: width * 0.75 - textW / 2, y: height * 0.75 },
              ];
        for (const s of stamps) {
          page.drawText(text, { x: Math.max(8, s.x), y: Math.max(8, s.y), size: fontSize, font, color: tint, opacity, rotate: degrees(angle) });
        }
      }
      setProgress({ stage: 'Saving…', progress: 90 });
      const saved = await doc.save();
      setResult(new Blob([saved.slice().buffer as ArrayBuffer], { type: 'application/pdf' }));
      toast('Watermark applied to all pages.', 'success');
    } catch {
      setError('Failed to apply watermark — the PDF may be malformed.');
    }
    setBusy(false); setProgress(null);
  }, [file, busy, text, opacity, fontSize, color, angle, cover, toast]);

  const reset = () => { setFile(null); setPageCount(0); setResult(null); setError(null); setProgress(null); };

  const previewCss = {
    transform: `rotate(${-angle}deg)`,
    color,
    opacity,
    fontSize: `${fontSize / 6}rem`,
  } as const;

  const controls = !file ? (
    <UploadZone accept="application/pdf" onFiles={onFiles} onError={setError} maxSizeMB={100} label="Drag & drop a PDF or tap to upload" />
  ) : (
    <>
      <FilePill pdf name={file.name} size={file.size} meta={`${pageCount} pages`} onReplace={reset} />
      {error && <ErrorNotice message={error} />}
      {progress && <ProgressView stage={progress.stage} progress={progress.progress} />}
      <Panel title="Watermark">
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Watermark text (e.g. DRAFT)" aria-label="Watermark text"
          className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm font-semibold uppercase" maxLength={40} />
        <div className="mt-3 grid grid-cols-2 items-center gap-3">
          <div>
            <label className="text-xs font-medium">Size: {fontSize}pt</label>
            <input type="range" min={20} max={120} value={fontSize} onChange={(e) => setFontSize(Number(e.target.value))} className="w-full" aria-label="Font size" />
          </div>
          <div>
            <label className="text-xs font-medium">Opacity: {Math.round(opacity * 100)}%</label>
            <input type="range" min={0.05} max={0.6} step={0.01} value={opacity} onChange={(e) => setOpacity(Number(e.target.value))} className="w-full" aria-label="Opacity" />
          </div>
          <div>
            <label className="text-xs font-medium">Angle: {angle}°</label>
            <input type="range" min={0} max={90} value={angle} onChange={(e) => setAngle(Number(e.target.value))} className="w-full" aria-label="Angle" />
          </div>
          <div>
            <label className="text-xs font-medium">Color</label>
            <input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="h-9 w-full cursor-pointer rounded-lg border border-border" aria-label="Watermark color" />
          </div>
        </div>
        <label className="mt-3 block text-xs font-medium">Coverage</label>
        <div className="mt-1 grid grid-cols-3 gap-1 rounded-lg bg-muted p-1">
          {([['all', 'Tiled all'], ['center', 'Centered'], ['first', 'First page only']] as const).map(([v, label]) => (
            <button key={v} onClick={() => setCover(v)} className={cn('rounded-md py-1.5 text-[10px] font-bold', cover === v ? 'bg-card shadow' : 'text-muted-foreground')}>
              {label}
            </button>
          ))}
        </div>
        <button onClick={apply} disabled={busy}
          className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-2.5 font-semibold text-primary-foreground hover:opacity-90 active:scale-95 disabled:opacity-50">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Stamp className="h-4 w-4" />} Apply watermark
        </button>
      </Panel>
      {result && (
        <div className="space-y-2">
          <SuccessNotice message={`Watermarked PDF ready — ${formatFileSize(result.size)}`} />
          <button onClick={() => downloadBlob(result, `watermarked-${Date.now()}.pdf`)}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-3 font-semibold text-primary-foreground hover:opacity-90">
            <Download className="h-5 w-5" /> Download PDF
          </button>
        </div>
      )}
    </>
  );

  const preview = !file ? (
    <EmptyPreview icon={<Stamp className="h-16 w-16" />} title="No PDF loaded" subtitle="Overlay CONFIDENTIAL, DRAFT or your own text across every page of a PDF." />
  ) : (
    <div className="relative mx-auto aspect-[8.5/11] max-w-md overflow-hidden rounded-xl border border-border bg-white shadow-xl">
      <div className="space-y-4 p-8">
        <div className="h-3 w-3/4 rounded bg-neutral-200" />
        <div className="h-2 w-full rounded bg-neutral-100" />
        <div className="h-2 w-11/12 rounded bg-neutral-100" />
        <div className="h-2 w-4/5 rounded bg-neutral-100" />
        <div className="h-2 w-full rounded bg-neutral-100" />
        <div className="h-2 w-2/3 rounded bg-neutral-100" />
        <div className="h-40 w-full rounded bg-neutral-100" />
        <div className="h-2 w-11/12 rounded bg-neutral-100" />
        <div className="h-2 w-3/4 rounded bg-neutral-100" />
      </div>
      <div className="pointer-events-none absolute inset-0 flex flex-wrap items-center justify-center gap-16 overflow-hidden">
        {Array.from({ length: cover === 'all' ? 3 : 1 }).map((_, i) => (
          <span key={i} className="whitespace-nowrap font-extrabold uppercase tracking-widest select-none" style={previewCss}>
            {text || 'CONFIDENTIAL'}
          </span>
        ))}
      </div>
    </div>
  );

  return (
    <ToolShell title="PDF Watermark"
      description="Add a text watermark (CONFIDENTIAL, DRAFT, your brand…) diagonally or centered on every page of a PDF."
      onReset={reset} controls={controls} preview={preview} />
  );
}
