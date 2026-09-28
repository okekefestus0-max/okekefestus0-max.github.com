'use client';

/**
 * TOOL: Background Remover
 * On-device segmentation via a Web Worker (border-region growing + color distance),
 * manual restore/erase brush, feathering, transparent/color/gradient/custom backgrounds,
 * export as PNG/JPG/WebP. History (undo/redo) snapshots the alpha mask.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Eraser, Image as ImageIcon, Paintbrush, X, Loader2, Sparkles } from 'lucide-react';
import { ToolShell, Panel } from '@/components/tool/ToolShell';
import { UploadZone, FilePill, ProgressView, ErrorNotice, SuccessNotice, DownloadBar, EmptyPreview, downloadBlob } from '@/components/tool/shared';
import { canvasToBlob, clamp, createWorkerFromFunction, fileToImage, loadImage, cn } from '@/lib/utils';
import { useToast } from '@/app/providers';
import type { OutputFormat } from '@/types';

type BgMode = 'transparent' | 'color' | 'gradient' | 'image';
type BrushMode = 'restore' | 'erase';

const MAX_DIM = 2000; // px — keeps phones responsive

export default function BackgroundRemoverPage() {
  const { toast } = useToast();

  // source
  const [file, setFile] = useState<File | null>(null);
  const [srcUrl, setSrcUrl] = useState<string | null>(null);
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);

  // processing
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ stage: string; progress: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  // editing state
  const [bgMode, setBgMode] = useState<BgMode>('transparent');
  const [bgColor, setBgColor] = useState('#ffffff');
  const [gradA, setGradA] = useState('#667eea');
  const [gradB, setGradB] = useState('#764ba2');
  const [gradAngle, setGradAngle] = useState(135);
  const [bgImg, setBgImg] = useState<HTMLImageElement | null>(null);
  const [feather, setFeather] = useState(2);
  const [brushSize, setBrushSize] = useState(40);
  const [brushMode, setBrushMode] = useState<BrushMode>('restore');
  const [format, setFormat] = useState<OutputFormat>('png');
  const [outputBlob, setOutputBlob] = useState<Blob | null>(null);

  // refs: original pixels + alpha mask + canvases
  const fgCanvasRef = useRef<HTMLCanvasElement | null>(null);   // full color source
  const maskRef = useRef<Uint8Array | null>(null);              // alpha mask 0-255
  const sizeRef = useRef<{ w: number; h: number }>({ w: 0, h: 0 });
  const previewRef = useRef<HTMLCanvasElement | null>(null);
  const historyRef = useRef<Uint8Array[]>([]);
  const histIdxRef = useRef(-1);
  const [histCan, setHistCan] = useState({ undo: false, redo: false });
  const paintingRef = useRef(false);
  const lastPtRef = useRef<{ x: number; y: number } | null>(null);

  // ---------------------------------------------------------------- upload
  const onFiles = useCallback(async (files: File[]) => {
    const f = files[0];
    if (!f.type.startsWith('image/')) {
      setError('That file is not an image. Please choose a JPG, PNG or WebP.');
      return;
    }
    setError(null); setDone(false); setOutputBlob(null); maskRef.current = null;
    historyRef.current = []; histIdxRef.current = -1; setHistCan({ undo: false, redo: false });
    try {
      const { img, url } = await fileToImage(f);
      setFile(f); setSrcUrl(url);
      // draw scaled fg canvas
      const scale = Math.min(1, MAX_DIM / Math.max(img.width, img.height));
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      c.getContext('2d')!.drawImage(img, 0, 0, w, h);
      fgCanvasRef.current = c;
      sizeRef.current = { w, h };
      setDims({ w, h });
      drawPreview();
      if (scale < 1) toast(`Large image optimized to ${w}×${h}px for smooth editing.`, 'info');
    } catch {
      setError('Could not read this image. It may be corrupted — try another file.');
    }
  }, [toast]);

  const reprocessDeps = [bgMode, bgColor, gradA, gradB, gradAngle, bgImg, feather];

  // ---------------------------------------------------------------- compose preview
  const compose = useCallback((): HTMLCanvasElement | null => {
    const fg = fgCanvasRef.current;
    const mask = maskRef.current;
    const { w, h } = sizeRef.current;
    if (!fg || !mask || !w || !h) return null;

    const out = document.createElement('canvas');
    out.width = w; out.height = h;
    const ctx = out.getContext('2d')!;

    // background layer
    if (bgMode === 'color') {
      ctx.fillStyle = bgColor; ctx.fillRect(0, 0, w, h);
    } else if (bgMode === 'gradient') {
      const rad = (gradAngle * Math.PI) / 180;
      const x2 = w / 2 + Math.cos(rad) * w / 1.2, y2 = h / 2 + Math.sin(rad) * h / 1.2;
      const x1 = w / 2 - Math.cos(rad) * w / 1.2, y1 = h / 2 - Math.sin(rad) * h / 1.2;
      const g = ctx.createLinearGradient(x1, y1, x2, y2);
      g.addColorStop(0, gradA); g.addColorStop(1, gradB);
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    } else if (bgMode === 'image' && bgImg) {
      // cover-fit the custom background
      const s = Math.max(w / bgImg.width, h / bgImg.height);
      const dw = bgImg.width * s, dh = bgImg.height * s;
      ctx.drawImage(bgImg, (w - dw) / 2, (h - dh) / 2, dw, dh);
    }

    // alpha mask apply on a temp canvas
    const fgData = fg.getContext('2d')!.getImageData(0, 0, w, h);
    const d = fgData.data;
    for (let i = 0; i < mask.length; i++) d[i * 4 + 3] = mask[i];
    const tmp = document.createElement('canvas');
    tmp.width = w; tmp.height = h;
    tmp.getContext('2d')!.putImageData(fgData, 0, 0);

    // feather: blur the masked fg slightly via canvas smoothing pass
    if (feather > 0) {
      const soft = document.createElement('canvas');
      soft.width = w; soft.height = h;
      const sctx = soft.getContext('2d')!;
      sctx.filter = `blur(${Math.min(6, feather / 2)}px)`;
      sctx.drawImage(tmp, 0, 0);
      ctx.drawImage(soft, 0, 0);
    } else {
      ctx.drawImage(tmp, 0, 0);
    }
    return out;
  }, [bgMode, bgColor, gradA, gradB, gradAngle, bgImg, feather]);

  const drawPreview = useCallback(() => {
    const pv = previewRef.current;
    const fg = fgCanvasRef.current;
    if (!pv || !fg) return;
    const { w, h } = sizeRef.current;
    pv.width = w; pv.height = h;
    const ctx = pv.getContext('2d')!;
    if (maskRef.current) {
      const c = compose();
      if (c) ctx.drawImage(c, 0, 0);
    } else {
      ctx.drawImage(fg, 0, 0);
    }
  }, [compose]);

  // re-render on option changes (also refreshes the downloadable output blob)
  useEffect(() => {
    drawPreview();
    void reprocessDeps;
  }, [drawPreview, ...reprocessDeps]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (maskRef.current) refreshOutputSilent();
  }, [...reprocessDeps]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------------------------------------------------------------- AI segmentation
  const runSegmentation = useCallback(() => {
    const fg = fgCanvasRef.current;
    if (!fg || busy) return;
    setBusy(true); setError(null); setDone(false);
    setProgress({ stage: 'Analyzing image…', progress: 5 });

    const { w, h } = sizeRef.current;
    const imageData = fg.getContext('2d')!.getImageData(0, 0, w, h);

    const worker = createWorkerFromFunction(() => {
      self.onmessage = (e: MessageEvent) => {
        const { data, width, height } = e.data as { data: Uint8ClampedArray; width: number; height: number };
        const px = width * height;
        const mask = new Uint8Array(px).fill(255);

        // Sample border colors (top/bottom/left/right)
        const samples: number[] = [];
        const pushSample = (x: number, y: number) => {
          const i = (y * width + x) * 4;
          samples.push(data[i], data[i + 1], data[i + 2]);
        };
        const step = Math.max(1, Math.floor(width / 80));
        const stepY = Math.max(1, Math.floor(height / 80));
        const band = Math.max(2, Math.floor(Math.min(width, height) * 0.04));
        for (let x = 0; x < width; x += step) {
          for (let b = 0; b < band; b++) { pushSample(x, b); pushSample(x, height - 1 - b); }
        }
        for (let y = 0; y < height; y += stepY) {
          for (let b = 0; b < band; b++) { pushSample(b, y); pushSample(width - 1 - b, y); }
        }
        // median-ish background estimate
        const n = samples.length / 3;
        let br = 0, bg = 0, bb = 0;
        for (let i = 0; i < n; i++) { br += samples[i * 3]; bg += samples[i * 3 + 1]; bb += samples[i * 3 + 2]; }
        br /= n; bg /= n; bb /= n;

        const dist2 = (i: number) => {
          const dr = data[i * 4] - br, dg = data[i * 4 + 1] - bg, db = data[i * 4 + 2] - bb;
          return dr * dr + dg * dg + db * db;
        };
        const T0 = 26 * 26;     // core background
        const T1 = 95 * 95;     // soft edge

        // region-growing flood fill from all border pixels
        const visited = new Uint8Array(px);
        const stack = new Int32Array(px);
        let sp = 0;
        const tryPush = (idx: number) => { if (!visited[idx] && dist2(idx) < T0) { visited[idx] = 1; stack[sp++] = idx; } };
        for (let x = 0; x < width; x++) { tryPush(x); tryPush((height - 1) * width + x); }
        for (let y = 0; y < height; y++) { tryPush(y * width); tryPush(y * width + width - 1); }

        let processed = 0;
        while (sp > 0) {
          const idx = stack[--sp];
          mask[idx] = 0;
          const x = idx % width, y = (idx / width) | 0;
          if (x > 0) tryPush(idx - 1);
          if (x < width - 1) tryPush(idx + 1);
          if (y > 0) tryPush(idx - width);
          if (y < height - 1) tryPush(idx + width);
          if (++processed % 40000 === 0) {
            (self as any).postMessage({ type: 'progress', value: 10 + (processed / px) * 60 });
          }
        }
        (self as any).postMessage({ type: 'progress', value: 75 });

        // soft edge: alpha from distance band around boundary
        for (let y = 0; y < height; y++) {
          for (let x = 0; x < width; x++) {
            const idx = y * width + x;
            if (mask[idx] !== 0) continue;
            // touches foreground?
            const nearFg =
              (x > 0 && mask[idx - 1] === 255) || (x < width - 1 && mask[idx + 1] === 255) ||
              (y > 0 && mask[idx - width] === 255) || (y < height - 1 && mask[idx + width] === 255);
            if (nearFg) {
              const d2 = dist2(idx);
              if (d2 < T1) {
                const t = Math.sqrt(d2 / T1);
                mask[idx] = Math.round(clamp1(t) * 255 * 0.65);
              }
            }
          }
        }
        (self as any).postMessage({ type: 'progress', value: 90 });

        function clamp1(v: number) { return Math.max(0, Math.min(1, (v - 0.35) / 0.65)); }

        (self as any).postMessage({ type: 'done', mask }, [mask.buffer]);
      };
    });

    worker.onmessage = (e: MessageEvent) => {
      if (e.data.type === 'progress') {
        setProgress({ stage: 'Building alpha mask…', progress: e.data.value });
      } else if (e.data.type === 'done') {
        maskRef.current = new Uint8Array(e.data.mask);
        worker.terminate();
        setProgress({ stage: 'Compositing…', progress: 97 });
        pushHistory();
        requestAnimationFrame(() => {
          drawPreview();
          refreshOutput();
          setBusy(false); setProgress(null); setDone(true);
          toast('Background removed. Refine edges with the brush if needed.', 'success');
        });
      }
    };
    worker.onerror = () => {
      worker.terminate(); setBusy(false); setProgress(null);
      setError('Segmentation failed. Try a smaller image (under 10MP works best).');
    };
    // transfer pixel buffer for speed
    worker.postMessage({ data: imageData.data, width: w, height: h });
  }, [busy, drawPreview, toast]); // eslint-disable-line

  // ---------------------------------------------------------------- history
  const pushHistory = useCallback(() => {
    const m = maskRef.current;
    if (!m) return;
    const stack = historyRef.current;
    stack.length = histIdxRef.current + 1;
    stack.push(m.slice());
    if (stack.length > 10) stack.shift();
    histIdxRef.current = stack.length - 1;
    setHistCan({ undo: histIdxRef.current > 0, redo: false });
  }, []);

  const undo = useCallback(() => {
    if (histIdxRef.current <= 0) return;
    histIdxRef.current -= 1;
    maskRef.current = historyRef.current[histIdxRef.current].slice();
    setHistCan({ undo: histIdxRef.current > 0, redo: true });
    drawPreview(); refreshOutputSilent();
  }, [drawPreview]); // eslint-disable-line

  const redo = useCallback(() => {
    if (histIdxRef.current >= historyRef.current.length - 1) return;
    histIdxRef.current += 1;
    maskRef.current = historyRef.current[histIdxRef.current].slice();
    setHistCan({ undo: true, redo: histIdxRef.current < historyRef.current.length - 1 });
    drawPreview(); refreshOutputSilent();
  }, [drawPreview]); // eslint-disable-line

  const reset = useCallback(() => {
    setFile(null); setSrcUrl(null); setDims(null);
    maskRef.current = null; fgCanvasRef.current = null;
    historyRef.current = []; histIdxRef.current = -1;
    setHistCan({ undo: false, redo: false });
    setOutputBlob(null); setDone(false); setError(null); setProgress(null);
    setBgImg(null); setBusy(false);
    const pv = previewRef.current;
    pv?.getContext('2d')?.clearRect(0, 0, pv.width, pv.height);
  }, []);

  // ---------------------------------------------------------------- brush
  const paintAt = useCallback((cssX: number, cssY: number, commit: boolean) => {
    const mask = maskRef.current, pv = previewRef.current;
    if (!pv) return;
    // need a mask to paint on — create full-opacity one lazily
    if (!mask) {
      const { w, h } = sizeRef.current;
      if (!w) return;
      maskRef.current = new Uint8Array(w * h).fill(255);
    }
    const m = maskRef.current!;
    const { w, h } = sizeRef.current;
    const rect = pv.getBoundingClientRect();
    const x = ((cssX - rect.left) / rect.width) * w;
    const y = ((cssY - rect.top) / rect.height) * h;
    const r = Math.max(2, (brushSize / rect.width) * w / 2);
    const r2 = r * r;
    const val = brushMode === 'restore' ? 255 : 0;

    const paintCircle = (cx: number, cy: number) => {
      for (let yy = Math.max(0, Math.floor(cy - r)); yy <= Math.min(h - 1, Math.ceil(cy + r)); yy++) {
        for (let xx = Math.max(0, Math.floor(cx - r)); xx <= Math.min(w - 1, Math.ceil(cx + r)); xx++) {
          const d2 = (xx - cx) * (xx - cx) + (yy - cy) * (yy - cy);
          if (d2 > r2) continue;
          const fall = Math.min(1, (1 - Math.sqrt(d2) / r) * 2); // soft edge
          const i = yy * w + xx;
          if (val === 255) m[i] = Math.max(m[i], Math.round(255 * fall));
          else m[i] = Math.min(m[i], Math.round(255 * (1 - fall)));
        }
      }
    };
    const last = lastPtRef.current;
    if (last) {
      const dx = x - last.x, dy = y - last.y;
      const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy) / (r / 2)));
      for (let s = 1; s <= steps; s++) paintCircle(last.x + (dx * s) / steps, last.y + (dy * s) / steps);
    } else paintCircle(x, y);

    lastPtRef.current = { x, y };
    drawPreview();
    if (commit) { pushHistory(); refreshOutputSilent(); }
  }, [brushSize, brushMode, drawPreview, pushHistory]); // eslint-disable-line

  // ---------------------------------------------------------------- output
  const refreshOutput = useCallback(async () => {
    const c = compose();
    if (!c) { setOutputBlob(null); return; }
    // JPEG cannot hold alpha — flatten onto white
    if (format === 'jpeg') {
      const flat = document.createElement('canvas');
      flat.width = c.width; flat.height = c.height;
      const x = flat.getContext('2d')!;
      x.fillStyle = '#ffffff'; x.fillRect(0, 0, flat.width, flat.height);
      x.drawImage(c, 0, 0);
      setOutputBlob(await canvasToBlob(flat, 'image/jpeg', 0.92));
    } else {
      setOutputBlob(await canvasToBlob(c, `image/${format}`, format === 'webp' ? 0.95 : undefined));
    }
  }, [compose, format]);

  const refreshOutputSilent = useCallback(() => { void refreshOutput(); }, [refreshOutput]);
  useEffect(() => { refreshOutputSilent(); }, [format, refreshOutputSilent]);

  const handleDownload = useCallback(() => {
    if (outputBlob) downloadBlob(outputBlob, `no-bg-${Date.now()}.${format === 'jpeg' ? 'jpg' : format}`);
  }, [outputBlob, format]);

  // background image upload
  const onBgImage = useCallback(async (files: File[]) => {
    try {
      const { img } = await fileToImage(files[0]);
      setBgImg(img); setBgMode('image');
    } catch { setError('Could not load that background image.'); }
  }, []);

  // ---------------------------------------------------------------- render
  const controls = (
    <>
      {!file ? (
        <UploadZone accept="image/*" onFiles={onFiles} onError={setError} />
      ) : (
        <>
          <FilePill name={file.name} size={file.size} meta={dims ? `${dims.w}×${dims.h}px` : undefined} onReplace={reset} />
          {error && <ErrorNotice message={error} />}

          {!done && !busy && (
            <button
              onClick={runSegmentation}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-3 font-semibold text-primary-foreground transition hover:opacity-90 active:scale-[0.98]"
            >
              <Sparkles className="h-5 w-5" /> Remove background
            </button>
          )}
          {progress && <ProgressView stage={progress.stage} progress={progress.progress} />}
          {done && <SuccessNotice message="Background removed. Use the brush to perfect edges." />}

          {maskRef.current && (
            <>
              <Panel title="Refine edges (brush)">
                <div className="mb-3 flex gap-2">
                  {([['restore', 'Restore', Paintbrush], ['erase', 'Erase', Eraser]] as const).map(([m, label, Icon]) => (
                    <button
                      key={m}
                      onClick={() => setBrushMode(m)}
                      className={cn(
                        'flex flex-1 items-center justify-center gap-1.5 rounded-lg border py-2 text-sm font-medium transition-colors',
                        brushMode === m ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:bg-muted'
                      )}
                    >
                      <Icon className="h-4 w-4" /> {label}
                    </button>
                  ))}
                </div>
                <label className="text-xs font-medium text-muted-foreground">Brush size: {brushSize}px</label>
                <input type="range" min={5} max={150} value={brushSize} onChange={(e) => setBrushSize(Number(e.target.value))} className="w-full" aria-label="Brush size" />
                <label className="mt-2 block text-xs font-medium text-muted-foreground">Edge feathering: {feather}px</label>
                <input type="range" min={0} max={12} value={feather} onChange={(e) => setFeather(Number(e.target.value))} className="w-full" aria-label="Edge feathering" />
                <p className="mt-2 text-xs text-muted-foreground">Draw directly on the preview to restore or erase areas.</p>
              </Panel>

              <Panel title="Background">
                <div className="grid grid-cols-4 gap-1 rounded-lg bg-muted p-1">
                  {(['transparent', 'color', 'gradient', 'image'] as BgMode[]).map((m) => (
                    <button
                      key={m}
                      onClick={() => setBgMode(m)}
                      className={cn(
                        'rounded-md px-1 py-1.5 text-[11px] font-semibold capitalize transition-colors',
                        bgMode === m ? 'bg-card shadow text-foreground' : 'text-muted-foreground hover:text-foreground'
                      )}
                    >
                      {m}
                    </button>
                  ))}
                </div>
                {bgMode === 'transparent' && (
                  <p className="mt-3 text-xs text-muted-foreground">Result keeps alpha transparency (checkerboard). Choose PNG or WebP when exporting.</p>
                )}
                {bgMode === 'color' && (
                  <div className="mt-3 flex items-center gap-3">
                    <input type="color" value={bgColor} onChange={(e) => setBgColor(e.target.value)} className="h-10 w-14 cursor-pointer rounded-lg border border-border bg-transparent" aria-label="Background color" />
                    <input type="text" value={bgColor} onChange={(e) => setBgColor(e.target.value)} className="flex-1 rounded-lg border border-input bg-background px-3 py-2 font-mono text-sm" aria-label="Color hex" />
                  </div>
                )}
                {bgMode === 'gradient' && (
                  <div className="mt-3 space-y-2">
                    <div className="flex items-center gap-2">
                      <input type="color" value={gradA} onChange={(e) => setGradA(e.target.value)} className="h-10 w-full cursor-pointer rounded-lg border border-border" aria-label="Gradient start" />
                      <input type="color" value={gradB} onChange={(e) => setGradB(e.target.value)} className="h-10 w-full cursor-pointer rounded-lg border border-border" aria-label="Gradient end" />
                    </div>
                    <label className="text-xs font-medium text-muted-foreground">Angle: {gradAngle}°</label>
                    <input type="range" min={0} max={360} value={gradAngle} onChange={(e) => setGradAngle(Number(e.target.value))} className="w-full" aria-label="Gradient angle" />
                  </div>
                )}
                {bgMode === 'image' && (
                  <div className="mt-3">
                    {bgImg ? (
                      <div className="flex items-center gap-2 rounded-lg border border-border p-2">
                        <img src={bgImg.src} alt="Custom background" className="h-10 w-10 rounded object-cover" />
                        <span className="flex-1 text-xs text-muted-foreground">Custom background set</span>
                        <button onClick={() => setBgImg(null)} className="rounded p-1 text-muted-foreground hover:bg-muted" aria-label="Remove background image"><X className="h-4 w-4" /></button>
                      </div>
                    ) : (
                      <UploadZone accept="image/*" onFiles={onBgImage} compact label="Upload a background photo" sublabel="JPG / PNG — cover-fit behind subject" />
                    )}
                  </div>
                )}
              </Panel>
            </>
          )}
        </>
      )}
    </>
  );

  const preview = (
    <div className="space-y-4">
      {!file ? (
        <EmptyPreview icon={<ImageIcon className="h-16 w-16" />} title="No image yet" subtitle="Upload a photo and remove its background in one click — 100% on-device." />
      ) : (
        <div className="relative overflow-hidden rounded-xl border border-border checkerboard">
          <canvas
            ref={previewRef}
            className={cn('block w-full touch-none', maskRef.current ? 'cursor-crosshair' : '')}
            onPointerDown={(e) => { if (!maskRef.current) return; paintingRef.current = true; lastPtRef.current = null; (e.target as HTMLElement).setPointerCapture(e.pointerId); paintAt(e.clientX, e.clientY, false); }}
            onPointerMove={(e) => paintingRef.current && paintAt(e.clientX, e.clientY, false)}
            onPointerUp={(e) => { if (paintingRef.current) paintAt(e.clientX, e.clientY, true); paintingRef.current = false; lastPtRef.current = null; }}
          />
          {busy && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/60 backdrop-blur-sm">
              <Loader2 className="h-10 w-10 animate-spin text-primary" />
            </div>
          )}
        </div>
      )}
    </div>
  );

  const footer = (
    <DownloadBar
      blob={outputBlob}
      baseName="no-bg"
      format={format}
      formats={['png', 'jpeg', 'webp']}
      onFormatChange={setFormat}
      onDownload={handleDownload}
      note={dims ? `${dims.w}×${dims.h}px` : undefined}
    />
  );

  return (
    <ToolShell
      title="Background Remover"
      description="Remove image backgrounds entirely on-device, refine edges with a brush, and drop your subject onto transparent, colored, gradient or photo backgrounds."
      canUndo={histCan.undo}
      canRedo={histCan.redo}
      onUndo={undo}
      onRedo={redo}
      onReset={reset}
      controls={controls}
      preview={preview}
      footer={footer}
    />
  );
}
