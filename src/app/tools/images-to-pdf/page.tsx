'use client';

/**
 * TOOL: Images to PDF — combine JPG/PNG/WebP photos into one ordered PDF (A4/letter/fit).
 */
import { useCallback, useState } from 'react';
import { ImagePlus, Images as ImagesIcon, ArrowUp, ArrowDown, Trash2, Loader2, Download } from 'lucide-react';
import { ToolShell, Panel } from '@/components/tool/ToolShell';
import { UploadZone, ProgressView, ErrorNotice, SuccessNotice, EmptyPreview } from '@/components/tool/shared';
import { cn, downloadBlob, fileToImage, formatFileSize } from '@/lib/utils';
import { useToast } from '@/app/providers';
import { PDFDocument } from 'pdf-lib';

interface Item { id: string; file: File; url: string; w: number; h: number }
type PageSize = 'a4' | 'letter' | 'fit';

const uid = () => Math.random().toString(36).slice(2, 10);

export default function ImagesToPdfPage() {
  const { toast } = useToast();
  const [items, setItems] = useState<Item[]>([]);
  const [size, setSize] = useState<PageSize>('a4');
  const [margin, setMargin] = useState(true);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ stage: string; progress: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ blob: Blob; pages: number } | null>(null);

  const onFiles = useCallback(async (files: File[]) => {
    setError(null); setResult(null);
    const valid = files.filter((f) => f.type.startsWith('image/'));
    if (valid.length !== files.length) setError('Non-image files were skipped.');
    const newItems: Item[] = [];
    for (const f of valid.slice(0, 50)) {
      try {
        const { img, url } = await fileToImage(f);
        newItems.push({ id: uid(), file: f, url, w: img.width, h: img.height });
      } catch { setError(`Skipped "${f.name}" — could not decode it.`); }
    }
    setItems((prev) => [...prev, ...newItems]);
  }, []);

  const move = (id: string, dir: -1 | 1) => {
    setItems((prev) => {
      const i = prev.findIndex((x) => x.id === id); const j = i + dir;
      if (i < 0 || j < 0 || j >= prev.length) return prev;
      const next = [...prev]; [next[i], next[j]] = [next[j], next[i]]; return next;
    });
  };

  const build = useCallback(async () => {
    if (!items.length) { setError('Add at least one image.'); return; }
    setBusy(true); setError(null); setResult(null);
    setProgress({ stage: 'Embedding images…', progress: 10 });
    try {
      const out = await PDFDocument.create();
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        setProgress({ stage: `Page ${i + 1}/${items.length}: ${it.file.name}`, progress: 10 + ((i / items.length) * 80) });
        const bytes = await it.file.arrayBuffer();
        let img;
        if (it.file.type === 'image/png') img = await out.embedPng(bytes);
        else if (it.file.type === 'image/jpeg') img = await out.embedJpg(bytes);
        else {
          // convert webp/etc to png via canvas
          const { img: htmlImg } = await fileToImage(it.file);
          const c = document.createElement('canvas');
          c.width = it.w; c.height = it.h;
          c.getContext('2d')!.drawImage(htmlImg, 0, 0);
          img = await out.embedPng(await new Promise<ArrayBuffer>((res) => c.toBlob((b) => res(new Response(b!).arrayBuffer().then((a) => a as any)), 'image/png')));
        }
        const base = size === 'a4' ? { w: 595.28, h: 841.89 } : size === 'letter' ? { w: 612, h: 792 } : null;
        let pw = base?.w ?? it.w / 2, ph = base?.h ?? it.h / 2;
        // landscape if image is landscape on fixed sizes
        if (base && it.w > it.h) { pw = base.h; ph = base.w; }
        const page = out.addPage([pw, ph]);
        const m = margin ? Math.min(pw, ph) * 0.06 : 0;
        const availW = pw - m * 2, availH = ph - m * 2;
        const imgScale = Math.min(availW / img.width, availH / img.height);
        const dw = img.width * imgScale, dh = img.height * imgScale;
        page.drawImage(img, { x: (pw - dw) / 2, y: (ph - dh) / 2, width: dw, height: dh });
        if (i % 4 === 3) await new Promise((r) => setTimeout(r, 16));
      }
      setProgress({ stage: 'Saving PDF…', progress: 95 });
      const saved = await out.save();
      const blob = new Blob([saved.slice().buffer as ArrayBuffer], { type: 'application/pdf' });
      setResult({ blob, pages: items.length });
      toast(`Created a ${items.length}-page PDF.`, 'success');
    } catch (e) {
      console.error(e);
      setError('Failed to build the PDF. Try removing unusually large images and retry.');
    }
    setBusy(false); setProgress(null);
  }, [items, size, margin, toast]);

  const reset = () => { setItems([]); setResult(null); setError(null); setProgress(null); };

  const controls = (
    <>
      <UploadZone accept="image/*" multiple onFiles={onFiles} onError={setError} maxSizeMB={50}
        label={items.length ? 'Add more images' : 'Drag & drop images or tap to upload'} sublabel="JPG · PNG · WebP — up to 50 images" />
      {error && <ErrorNotice message={error} />}
      {progress && <ProgressView stage={progress.stage} progress={progress.progress} />}
      {items.length > 0 && (
        <>
          <Panel title="Page setup">
            <div className="grid grid-cols-3 gap-1 rounded-lg bg-muted p-1">
              {(['a4', 'letter', 'fit'] as PageSize[]).map((s) => (
                <button key={s} onClick={() => setSize(s)} className={cn('rounded-md py-1.5 text-xs font-bold uppercase', size === s ? 'bg-card shadow' : 'text-muted-foreground')}>
                  {s === 'fit' ? 'Fit image' : s}
                </button>
              ))}
            </div>
            <label className="mt-3 flex items-center gap-2 text-sm">
              <input type="checkbox" checked={margin} onChange={(e) => setMargin(e.target.checked)} disabled={size === 'fit'} className="h-4 w-4 accent-primary" />
              Add margin around images
            </label>
          </Panel>
          {!busy && (
            <button onClick={build} className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-3 font-semibold text-primary-foreground hover:opacity-90 active:scale-[0.98]">
              <ImagePlus className="h-5 w-5" /> Create PDF ({items.length} image{items.length > 1 ? 's' : ''})
            </button>
          )}
          {result && (
            <div className="space-y-2">
              <SuccessNotice message={`${result.pages}-page PDF ready — ${formatFileSize(result.blob.size)}`} />
              <button onClick={() => downloadBlob(result.blob, `images-${Date.now()}.pdf`)}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-3 font-semibold text-primary-foreground hover:opacity-90">
                <Download className="h-5 w-5" /> Download PDF
              </button>
            </div>
          )}
        </>
      )}
    </>
  );

  const preview = items.length === 0 ? (
    <EmptyPreview icon={<ImagesIcon className="h-16 w-16" />} title="No images yet" subtitle="Pick images and turn them into a clean, ordered PDF — perfect for receipts, notes or portfolios." />
  ) : (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3" aria-label="Images in PDF order">
      {items.map((it, i) => (
        <div key={it.id} className="group relative overflow-hidden rounded-xl border border-border bg-muted">
          <img src={it.url} alt={it.file.name} className="aspect-[3/4] w-full object-cover" />
          <span className="absolute left-1.5 top-1.5 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-bold text-white">#{i + 1}</span>
          <div className="absolute inset-x-0 bottom-0 flex justify-center gap-1 bg-gradient-to-t from-black/70 to-transparent p-1.5 opacity-0 transition-opacity group-hover:opacity-100">
            <button aria-label="Move up" onClick={() => move(it.id, -1)} className="rounded bg-white/90 p-1.5 text-black"><ArrowUp className="h-3.5 w-3.5" /></button>
            <button aria-label="Move down" onClick={() => move(it.id, 1)} className="rounded bg-white/90 p-1.5 text-black"><ArrowDown className="h-3.5 w-3.5" /></button>
            <button aria-label="Remove" onClick={() => setItems((p) => p.filter((x) => x.id !== it.id))} className="rounded bg-white/90 p-1.5 text-red-600"><Trash2 className="h-3.5 w-3.5" /></button>
          </div>
        </div>
      ))}
    </div>
  );

  return (
    <ToolShell title="Images to PDF"
      description="Turn photos into a single, ordered PDF with A4/Letter page sizes and optional margins."
      onReset={reset} controls={controls} preview={preview} />
  );
}
