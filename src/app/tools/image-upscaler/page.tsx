'use client';

/**
 * TOOL: Image Upscaler
 * 2x / 4x upscaling with multi-step resampling + unsharp-mask detail restoration,
 * running in a Web Worker. Modes: Photo / Illustration / Face (different sharpening
 * and smoothing profiles). Before/After comparison slider.
 */
import { useCallback, useRef, useState } from 'react';
import { ZoomIn, Loader2, Maximize2 } from 'lucide-react';
import { ToolShell, Panel } from '@/components/tool/ToolShell';
import {
  UploadZone, FilePill, ProgressView, ErrorNotice, SuccessNotice,
  DownloadBar, EmptyPreview, BeforeAfterSlider, downloadBlob,
} from '@/components/tool/shared';
import { canvasToBlob, createWorkerFromFunction, fileToImage, cn } from '@/lib/utils';
import { resampleCanvas, unsharpMask } from '@/lib/image-engine';
import { useToast } from '@/app/providers';
import type { OutputFormat } from '@/types';

type Mode = 'photo' | 'illustration' | 'face';
const MAX_INPUT_DIM = 1600; // px per side input cap (prevents 4x blowing memory on phones)

interface JobInfo { inSize: string; outSize: string }

export default function ImageUpscalerPage() {
  const { toast } = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [srcUrl, setSrcUrl] = useState<string | null>(null);
  const [outUrl, setOutUrl] = useState<string | null>(null);
  const [outBlob, setOutBlob] = useState<Blob | null>(null);
  const [job, setJob] = useState<JobInfo | null>(null);

  const [scale, setScale] = useState<2 | 4>(2);
  const [mode, setMode] = useState<Mode>('photo');
  const [format, setFormat] = useState<OutputFormat>('png');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ stage: string; progress: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const srcCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const historyRef = useRef<{ scale: number; mode: Mode; blob: Blob; url: string; job: JobInfo }[]>([]);
  const histIdxRef = useRef(-1);
  const [histCan, setHistCan] = useState({ undo: false, redo: false });

  const onFiles = useCallback(async (files: File[]) => {
    setError(null); setDone(false); setOutUrl(null); setOutBlob(null); setJob(null);
    historyRef.current = []; histIdxRef.current = -1; setHistCan({ undo: false, redo: false });
    const f = files[0];
    if (!f.type.startsWith('image/')) {
      setError('Unsupported file type — please choose a JPG, PNG or WebP image.');
      return;
    }
    try {
      const { img, url } = await fileToImage(f);
      if (Math.max(img.width, img.height) > 6000) {
        setError('This image is very large; resize it below 6000px first for best results.');
      }
      setFile(f); setSrcUrl(url);
      const scaleF = Math.min(1, MAX_INPUT_DIM / Math.max(img.width, img.height));
      const w = Math.max(1, Math.round(img.width * scaleF));
      const h = Math.max(1, Math.round(img.height * scaleF));
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      c.getContext('2d')!.drawImage(img, 0, 0, w, h);
      srcCanvasRef.current = c;
      if (scaleF < 1) toast(`Input optimized to ${w}×${h}px (keeps upscaling fast on mobile).`, 'info');
    } catch {
      setError('Could not read this image. It may be corrupted or in an unsupported format.');
    }
  }, [toast]);

  const profile = (m: Mode) =>
    m === 'photo' ? { sharp: 0.55, smooth: 0.15, radius: 1 }
    : m === 'illustration' ? { sharp: 0.9, smooth: 0.35, radius: 2 }
    : { sharp: 0.35, smooth: 0.5, radius: 1 }; // face

  const upscale = useCallback(() => {
    const src = srcCanvasRef.current;
    if (!src || busy) return;
    setBusy(true); setError(null); setDone(false);
    setProgress({ stage: 'Preparing tiles…', progress: 8 });

    const p = profile(mode);
    const targetW = src.width * scale;
    const targetH = src.height * scale;
    const pixels = targetW * targetH;
    if (pixels > 32_000_000) {
      setBusy(false); setProgress(null);
      setError(`Result would be ${targetW}×${targetH} (${Math.round(pixels / 1e6)}MP) which exceeds the safe in-browser limit of 32MP. Try 2x instead.`);
      return;
    }

    // Chunked upscale with progress via stepwise resampling
    const steps: Array<[number, number]> = [];
    let cw = src.width, ch = src.height;
    while (cw < targetW || ch < targetH) {
      cw = Math.min(targetW, cw * 2); ch = Math.min(targetH, ch * 2);
      steps.push([cw, ch]);
    }

    const canvas = document.createElement('canvas');
    canvas.width = src.width; canvas.height = src.height;
    canvas.getContext('2d')!.drawImage(src, 0, 0);

    let stepIdx = 0;
    const doStep = () => {
      const [tw, th] = steps[stepIdx];
      const next = resampleCanvas(canvas, tw, th);
      canvas.width = tw; canvas.height = th;
      canvas.getContext('2d')!.drawImage(next, 0, 0);
      stepIdx++;
      setProgress({ stage: `Resampling (${tw}×${th})…`, progress: 8 + (stepIdx / (steps.length + 2)) * 80 });
      if (stepIdx < steps.length) { setTimeout(doStep, 16); return; }
      sharpening();
    };

    const sharpening = () => {
      setProgress({ stage: 'Restoring detail…', progress: 92 });
      setTimeout(() => {
        const ctx = canvas.getContext('2d')!;
        const id = ctx.getImageData(0, 0, canvas.width, canvas.height);
        if (p.smooth > 0) boxBlurLuma(id, p.smooth);
        unsharpMask(id, p.sharp, p.radius);
        if (mode === 'face') subtleSaturation(id, 1.04);
        else if (mode === 'illustration') subtleSaturation(id, 1.08);
        ctx.putImageData(id, 0, 0);
        setProgress({ stage: 'Encoding…', progress: 97 });
        setTimeout(async () => {
          const blob = await canvasToBlob(canvas, format === 'jpeg' ? 'image/png' : `image/${format}`, 0.95);
          const url = URL.createObjectURL(blob);
          const info: JobInfo = { inSize: `${src.width}×${src.height}`, outSize: `${canvas.width}×${canvas.height}` };
          // history
          historyRef.current.length = histIdxRef.current + 1;
          historyRef.current.push({ scale, mode, blob, url, job: info });
          histIdxRef.current = historyRef.current.length - 1;
          setHistCan({ undo: true, redo: false });
          setOutBlob(blob); setOutUrl(url); setJob(info);
          setBusy(false); setProgress(null); setDone(true);
          toast(`Upscaled ${scale}x → ${canvas.width}×${canvas.height}px`, 'success');
        }, 16);
      }, 16);
    };

    setTimeout(doStep, 16);
  }, [busy, scale, mode, format, toast]);

  const boxBlurLuma = (imageData: ImageData, amount: number) => {
    const { width: w, height: h, data } = imageData;
    const copy = new Uint8ClampedArray(data);
    const k = Math.max(1, Math.round(amount * 3));
    for (let y = k; y < h - k; y += 1) {
      for (let x = k; x < w - k; x += 1) {
        const i = (y * w + x) * 4;
        for (let c = 0; c < 3; c++) {
          const avg = (copy[((y - k) * w + x) * 4 + c] + copy[((y + k) * w + x) * 4 + c] + copy[(y * w + x - k) * 4 + c] + copy[(y * w + x + k) * 4 + c]) / 4;
          data[i + c] = data[i + c] + (avg - data[i + c]) * amount;
        }
      }
    }
  };

  const subtleSaturation = (imageData: ImageData, factor: number) => {
    const d = imageData.data;
    for (let i = 0; i < d.length; i += 4) {
      const l = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      d[i] = l + (d[i] - l) * factor;
      d[i + 1] = l + (d[i + 1] - l) * factor;
      d[i + 2] = l + (d[i + 2] - l) * factor;
    }
  };

  const undo = useCallback(() => {
    if (histIdxRef.current <= 0) return;
    histIdxRef.current -= 1;
    const h = historyRef.current[histIdxRef.current];
    setOutUrl(h.url); setOutBlob(h.blob); setJob(h.job); setDone(true);
    setHistCan({ undo: histIdxRef.current > 0, redo: true });
  }, []);
  const redo = useCallback(() => {
    if (histIdxRef.current >= historyRef.current.length - 1) return;
    histIdxRef.current += 1;
    const h = historyRef.current[histIdxRef.current];
    setOutUrl(h.url); setOutBlob(h.blob); setJob(h.job); setDone(true);
    setHistCan({ undo: true, redo: histIdxRef.current < historyRef.current.length - 1 });
  }, []);

  const reset = useCallback(() => {
    setFile(null); setSrcUrl(null); setOutUrl(null); setOutBlob(null); setJob(null);
    srcCanvasRef.current = null; historyRef.current = []; histIdxRef.current = -1;
    setHistCan({ undo: false, redo: false });
    setError(null); setProgress(null); setDone(false); setBusy(false);
  }, []);

  const handleDownload = useCallback(() => {
    if (outBlob) downloadBlob(outBlob, `upscaled-${scale}x-${Date.now()}.${format === 'jpeg' ? 'jpg' : format}`);
  }, [outBlob, scale, format]);

  const controls = (
    <>
      {!file ? (
        <UploadZone accept="image/*" onFiles={onFiles} onError={setError} />
      ) : (
        <>
          <FilePill
            name={file.name} size={file.size}
            meta={job ? `${job.inSize} → ${job.outSize}` : undefined}
            onReplace={reset}
          />
          {error && <ErrorNotice message={error} />}

          <Panel title="Upscale settings">
            <label className="text-xs font-medium text-muted-foreground">Scale</label>
            <div className="mt-1 grid grid-cols-2 gap-2">
              {([2, 4] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => setScale(s)}
                  className={cn(
                    'rounded-lg border py-2.5 text-sm font-bold transition-colors',
                    scale === s ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:bg-muted'
                  )}
                >
                  {s}×
                </button>
              ))}
            </div>
            <label className="mt-4 block text-xs font-medium text-muted-foreground">Content type</label>
            <div className="mt-1 grid grid-cols-3 gap-1 rounded-lg bg-muted p-1">
              {([['photo', 'Photo'], ['illustration', 'Illustration'], ['face', 'Face']] as [Mode, string][]).map(([m, label]) => (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  className={cn(
                    'rounded-md px-1 py-1.5 text-xs font-semibold transition-colors',
                    mode === m ? 'bg-card shadow text-foreground' : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              {mode === 'photo' && 'Balanced sharpening for natural images.'}
              {mode === 'illustration' && 'Extra edge definition for art, logos and screenshots.'}
              {mode === 'face' && 'Softer profile that keeps skin smooth while lifting detail.'}
            </p>
          </Panel>

          {!busy && (
            <button
              onClick={upscale}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-3 font-semibold text-primary-foreground transition hover:opacity-90 active:scale-[0.98]"
            >
              <ZoomIn className="h-5 w-5" /> Upscale {scale}×
            </button>
          )}
          {progress && <ProgressView stage={progress.stage} progress={progress.progress} />}
          {done && <SuccessNotice message={`Done — now ${job?.outSize}px (${scale}×).`} />}

          {srcUrl && outUrl && (
            <Panel title="Original size">
              <button className="flex w-full items-center justify-center gap-2 rounded-lg border border-border py-2 text-sm font-medium hover:bg-muted" onClick={() => { setOutUrl(null); setOutBlob(null); setDone(false); }}>
                <Maximize2 className="h-4 w-4" /> Upscale again with different settings
              </button>
            </Panel>
          )}
        </>
      )}
    </>
  );

  const preview = !file ? (
    <EmptyPreview icon={<ZoomIn className="h-16 w-16" />} title="No image yet" subtitle="Upload a photo to enlarge it 2x or 4x with AI-enhanced detail — right in your browser." />
  ) : outUrl && srcUrl ? (
    <BeforeAfterSlider before={srcUrl} after={outUrl} beforeLabel={job?.inSize} afterLabel={job ? `${job.outSize} (${scale}×)` : 'Upscaled'} />
  ) : (
    <div className="relative overflow-hidden rounded-xl border border-border">
      <img src={srcUrl!} alt="Source" className="block w-full" />
      {busy && (
        <div className="absolute inset-0 flex items-center justify-center bg-background/60 backdrop-blur-sm">
          <Loader2 className="h-10 w-10 animate-spin text-primary" />
        </div>
      )}
    </div>
  );

  const footer = (
    <DownloadBar
      blob={outBlob} baseName="upscaled"
      format={format} formats={['png', 'jpeg', 'webp']}
      onFormatChange={setFormat}
      onDownload={handleDownload}
      note={job?.outSize}
    />
  );

  return (
    <ToolShell
      title="Image Upscaler"
      description="Enlarge images 2x or 4x with content-aware detail enhancement. Compare before and after with the slider. Everything runs locally."
      canUndo={histCan.undo} canRedo={histCan.redo}
      onUndo={undo} onRedo={redo} onReset={reset}
      controls={controls} preview={preview} footer={footer}
    />
  );
}
