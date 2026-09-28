'use client';

/**
 * TOOL: Resize & Crop — social presets (Instagram, WhatsApp DP, YouTube, passport),
 * custom dimensions, drag-to-reframe crop with cover-fit.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Crop, Lock, Unlock, Image as ImageIcon } from 'lucide-react';
import { ToolShell, Panel } from '@/components/tool/ToolShell';
import { UploadZone, FilePill, ErrorNotice, DownloadBar, EmptyPreview, downloadBlob } from '@/components/tool/shared';
import { cn, canvasToBlob, fileToImage } from '@/lib/utils';
import { useToast } from '@/app/providers';
import type { OutputFormat } from '@/types';

const PRESETS = [
  { id: 'custom', name: 'Custom', w: 0, h: 0 },
  { id: 'ig-post', name: 'Instagram Post (1:1)', w: 1080, h: 1080 },
  { id: 'ig-story', name: 'Instagram Story (9:16)', w: 1080, h: 1920 },
  { id: 'wa-dp', name: 'WhatsApp DP (1:1)', w: 500, h: 500 },
  { id: 'yt-thumb', name: 'YouTube Thumbnail (16:9)', w: 1280, h: 720 },
  { id: 'passport', name: 'Passport Photo (3:4)', w: 600, h: 800 },
  { id: 'twitter', name: 'X / Twitter Header (3:1)', w: 1500, h: 500 },
];

export default function ResizeCropPage() {
  const { toast } = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [srcUrl, setSrcUrl] = useState<string | null>(null);
  const [preset, setPreset] = useState('ig-post');
  const [width, setWidth] = useState(1080);
  const [height, setHeight] = useState(1080);
  const [lock, setLock] = useState(true);
  const [offset, setOffset] = useState({ x: 0.5, y: 0.5 }); // crop focus point 0..1
  const [format, setFormat] = useState<OutputFormat>('jpeg');
  const [outBlob, setOutBlob] = useState<Blob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [origDims, setOrigDims] = useState<{ w: number; h: number } | null>(null);

  const imgRef = useRef<HTMLImageElement | null>(null);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const debRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dragRef = useRef<{ active: boolean; sx: number; sy: number; ox: number; oy: number }>({ active: false, sx: 0, sy: 0, ox: 0, oy: 0 });
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const onFiles = useCallback(async (files: File[]) => {
    setError(null); setOutBlob(null);
    try {
      const { img, url } = await fileToImage(files[0]);
      imgRef.current = img;
      setFile(files[0]); setSrcUrl(url);
      setOrigDims({ w: img.width, h: img.height });
      setOffset({ x: 0.5, y: 0.5 });
      setWidth(Math.min(1080, img.width)); setHeight(Math.min(1080, img.height));
      if (preset !== 'custom') setPreset('custom');
    } catch { setError('Could not read this image. It may be corrupted or unsupported.'); }
  }, [preset]);

  // compose output canvas with cover-fit crop at current focus point
  const compose = useCallback((): HTMLCanvasElement | null => {
    const img = imgRef.current;
    if (!img || !width || !height) return null;
    const out = document.createElement('canvas');
    out.width = width; out.height = height;
    const ctx = out.getContext('2d')!;
    const scale = Math.max(width / img.width, height / img.height);
    const dw = img.width * scale, dh = img.height * scale;
    const maxX = Math.max(0, dw - width), maxY = Math.max(0, dh - height);
    const dx = -maxX * offset.x, dy = -maxY * offset.y;
    if (format === 'jpeg') { ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, width, height); }
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, dx, dy, dw, dh);
    return out;
  }, [width, height, offset, format]);

  const refresh = useCallback(() => {
    if (debRef.current) clearTimeout(debRef.current);
    debRef.current = setTimeout(async () => {
      const c = compose();
      if (!c) return;
      setPreviewUrl(c.toDataURL());
      setOutBlob(await canvasToBlob(c, `image/${format}`, 0.92));
    }, 100);
  }, [compose, format]);

  useEffect(() => { if (file) refresh(); }, [width, height, offset, format, file, refresh]);

  // pointer drag on the reframe preview = move focus point
  const onPointerDown = (e: React.PointerEvent) => {
    dragRef.current = { active: true, sx: e.clientX, sy: e.clientY, ox: offset.x, oy: offset.y };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d.active || !frameRef.current) return;
    const img = imgRef.current!;
    const frameW = frameRef.current.clientWidth, frameH = frameRef.current.clientHeight;
    const scale = Math.max(width / img.width, height / img.height);
    const maxX = Math.max(1, img.width * scale - width), maxY = Math.max(1, img.height * scale - height);
    const cssScaleX = (img.width * scale) / frameW;
    const nx = d.ox - ((e.clientX - d.sx) * cssScaleX) / maxX;
    const cssScaleY = (img.height * scale) / frameH;
    const ny = d.oy - ((e.clientY - d.sy) * cssScaleY) / maxY;
    setOffset({ x: Math.min(1, Math.max(0, nx)), y: Math.min(1, Math.max(0, ny)) });
  };
  const onPointerUp = () => { dragRef.current.active = false; };

  const choosePreset = (id: string) => {
    setPreset(id);
    const p = PRESETS.find((x) => x.id === id);
    if (p && p.w) { setWidth(p.w); setHeight(p.h); }
  };

  const onDim = (k: 'w' | 'h', v: number) => {
    setPreset('custom');
    const p = PRESETS.find((x) => x.id === preset);
    if (k === 'w') {
      setWidth(v);
      if (lock && origDims) setHeight(Math.max(1, Math.round(v * (height / (width || v)))));
    } else {
      setHeight(v);
      if (lock) setWidth(Math.max(1, Math.round(v * (width / (height || v)))));
    }
  };

  const reset = useCallback(() => {
    setFile(null); setSrcUrl(null); setOutBlob(null); setPreviewUrl(null); imgRef.current = null; setError(null); setOrigDims(null);
  }, []);

  const controls = !file ? (
    <UploadZone accept="image/*" onFiles={onFiles} onError={setError} />
  ) : (
    <>
      <FilePill name={file.name} size={file.size} meta={origDims ? `${origDims.w}×${origDims.h}px` : undefined} onReplace={reset} />
      {error && <ErrorNotice message={error} />}
      <Panel title="Preset sizes">
        <div className="grid grid-cols-2 gap-1.5">
          {PRESETS.filter((p) => p.id !== 'custom').map((p) => (
            <button key={p.id} onClick={() => choosePreset(p.id)}
              className={cn('rounded-lg border px-2 py-2 text-[11px] font-semibold leading-tight transition-colors text-left',
                preset === p.id ? 'border-primary bg-primary/10 text-primary' : 'border-border hover:bg-muted')}>
              {p.name}
              <span className="block text-[10px] font-normal text-muted-foreground">{p.w}×{p.h}</span>
            </button>
          ))}
        </div>
      </Panel>
      <Panel title="Output size">
        <div className="flex items-center gap-2">
          <div className="flex-1">
            <label className="text-[10px] font-medium uppercase text-muted-foreground">Width</label>
            <input type="number" min={1} max={8000} value={width}
              onChange={(e) => onDim('w', Math.max(1, Number(e.target.value)))}
              className="w-full rounded-lg border border-input bg-background px-2 py-1.5 text-sm" aria-label="Width (px)" />
          </div>
          <button onClick={() => setLock((l) => !l)} aria-label={lock ? 'Unlock aspect ratio' : 'Lock aspect ratio'}
            className={cn('mt-4 rounded-lg border p-2', lock ? 'border-primary text-primary' : 'border-border text-muted-foreground')}>
            {lock ? <Lock className="h-4 w-4" /> : <Unlock className="h-4 w-4" />}
          </button>
          <div className="flex-1">
            <label className="text-[10px] font-medium uppercase text-muted-foreground">Height</label>
            <input type="number" min={1} max={8000} value={height}
              onChange={(e) => onDim('h', Math.max(1, Number(e.target.value)))}
              className="w-full rounded-lg border border-input bg-background px-2 py-1.5 text-sm" aria-label="Height (px)" />
          </div>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">Drag on the preview to reframe the crop.</p>
        <button onClick={() => setOffset({ x: 0.5, y: 0.5 })} className="mt-1 text-xs font-medium text-primary hover:underline">
          Center crop
        </button>
      </Panel>
    </>
  );

  const preview = !file ? (
    <EmptyPreview icon={<ImageIcon className="h-16 w-16" />} title="No image yet" subtitle="Resize to exact pixels or crop with ready-made presets for social media and documents." />
  ) : (
    <div className="space-y-3">
      <div
        ref={frameRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        className="relative mx-auto touch-none overflow-hidden rounded-xl border border-border bg-muted/30"
        style={{ aspectRatio: `${width} / ${height}`, maxHeight: '70vh', width: 'auto', maxWidth: '100%' }}
      >
        {previewUrl && <CropPreviewBlob url={previewUrl} />}
      </div>
      <p className="text-center text-xs text-muted-foreground">Drag image to reframe · {width}×{height}px</p>
    </div>
  );

  const footer = (
    <DownloadBar blob={outBlob} baseName="resized" format={format} formats={['jpeg', 'png', 'webp']}
      onFormatChange={setFormat}
      onDownload={() => outBlob && downloadBlob(outBlob, `resized-${width}x${height}.${format === 'jpeg' ? 'jpg' : format}`)}
      note={`${width}×${height}px`} />
  );

  return (
    <ToolShell title="Resize & Crop"
      description="Resize images to exact pixel dimensions or crop to social-media presets — drag to reframe before exporting."
      onReset={reset} controls={controls} preview={preview} footer={footer} />
  );
}

function CropPreviewBlob({ url }: { url: string }) {
  return <img src={url} alt="Crop preview" className="pointer-events-none block h-full w-full object-cover" draggable={false} />;
}
