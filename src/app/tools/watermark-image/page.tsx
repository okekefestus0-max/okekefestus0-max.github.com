'use client';

/**
 * TOOL: Image Watermark — text or logo watermark with position/tile/opacity/size.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Stamp, Image as ImageIcon } from 'lucide-react';
import { ToolShell, Panel } from '@/components/tool/ToolShell';
import { UploadZone, FilePill, ErrorNotice, DownloadBar, EmptyPreview, downloadBlob } from '@/components/tool/shared';
import { canvasToBlob, cn, fileToImage, loadImage } from '@/lib/utils';
import type { OutputFormat } from '@/types';

type WmType = 'text' | 'image';
type Pos = 'center' | 'tile' | 'tl' | 'tr' | 'bl' | 'br';

export default function WatermarkImagePage() {
  const [file, setFile] = useState<File | null>(null);
  const [srcUrl, setSrcUrl] = useState<string | null>(null);
  const [type, setType] = useState<WmType>('text');
  const [text, setText] = useState('© My Brand');
  const [color, setColor] = useState('#ffffff');
  const [size, setSize] = useState(4);   // % of image width
  const [opacity, setOpacity] = useState(0.5);
  const [pos, setPos] = useState<Pos>('br');
  const [angle, setAngle] = useState(0);
  const [logo, setLogo] = useState<HTMLImageElement | null>(null);
  const [format, setFormat] = useState<OutputFormat>('png');
  const [outBlob, setOutBlob] = useState<Blob | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);

  const imgRef = useRef<HTMLImageElement | null>(null);
  const debRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const compose = useCallback((): HTMLCanvasElement | null => {
    const img = imgRef.current;
    if (!img) return null;
    const c = document.createElement('canvas');
    const maxW = 2400;
    const s = Math.min(1, maxW / img.width);
    c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
    const ctx = c.getContext('2d')!;
    if (format === 'jpeg') { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); }
    ctx.drawImage(img, 0, 0, c.width, c.height);

    ctx.save();
    ctx.globalAlpha = opacity;
    if (angle) {
      ctx.translate(c.width / 2, c.height / 2);
      ctx.rotate((angle * Math.PI) / 180);
      ctx.translate(-c.width / 2, -c.height / 2);
    }

    if (type === 'text' && text.trim()) {
      const fs = Math.max(12, (c.width * size) / 100);
      ctx.font = `700 ${fs}px Helvetica, Arial, sans-serif`;
      ctx.fillStyle = color;
      ctx.textBaseline = 'middle';
      const m = ctx.measureText(text);
      const paintAt = (x: number, y: number) => ctx.fillText(text, x - m.width / 2, y);
      paintPositions(c.width, c.height, fs).forEach(([x, y]) => paintAt(x, y));
    } else if (type === 'image' && logo) {
      const lw = (c.width * size) / 100;
      const lh = (lw * logo.height) / logo.width;
      paintPositions(c.width, c.height, Math.max(lw, lh) * 1.4).forEach(([x, y]) => ctx.drawImage(logo, x - lw / 2, y - lh / 2, lw, lh));
    } else {
      ctx.restore();
      return c;
    }
    ctx.restore();
    return c;

    function paintPositions(w: number, h: number, spacing: number): [number, number][] {
      const pad = w * 0.04;
      switch (pos) {
        case 'tl': return [[w * 0.5 - w * 0.32, pad + spacing / 2]];
        case 'tr': return [[w * 0.5 + w * 0.32, pad + spacing / 2]];
        case 'bl': return [[w * 0.5 - w * 0.32, h - pad - spacing / 2]];
        case 'br': return [[w * 0.5 + w * 0.32, h - pad - spacing / 2]];
        case 'center': return [[w / 2, h / 2]];
        case 'tile': {
          const pts: [number, number][] = [];
          for (let y = spacing / 2; y < h; y += spacing * 2.2)
            for (let x = spacing; x < w; x += spacing * 2.8) pts.push([x, y]);
          return pts;
        }
      }
    }
  }, [text, color, size, opacity, pos, angle, type, logo, format]);

  const refresh = useCallback(() => {
    if (debRef.current) clearTimeout(debRef.current);
    debRef.current = setTimeout(async () => {
      const c = compose();
      if (!c) return;
      setPreviewUrl(c.toDataURL());
      setOutBlob(await canvasToBlob(c, `image/${format}`, 0.92));
    }, 120);
  }, [compose, format]);

  useEffect(refresh, [text, color, size, opacity, pos, angle, logo, type, format, refresh]);

  const onFiles = useCallback(async (files: File[]) => {
    setError(null);
    try {
      const { img, url } = await fileToImage(files[0]);
      imgRef.current = img;
      setFile(files[0]); setSrcUrl(url); setDims({ w: img.width, h: img.height });
    } catch { setError('Could not read this image. It may be corrupted or unsupported.'); }
  }, []);

  const onLogo = useCallback(async (files: File[]) => {
    try {
      const url = URL.createObjectURL(files[0]);
      const img = await loadImage(url);
      setLogo(img); setType('image');
    } catch { setError('Could not load that logo image (PNG with transparency works best).'); }
  }, []);

  const reset = useCallback(() => {
    setFile(null); setSrcUrl(null); setOutBlob(null); setPreviewUrl(null); imgRef.current = null; setError(null); setDims(null);
  }, []);

  const controls = !file ? (
    <UploadZone accept="image/*" onFiles={onFiles} onError={setError} />
  ) : (
    <>
      <FilePill name={file.name} size={file.size} meta={dims ? `${dims.w}×${dims.h}px` : undefined} onReplace={reset} />
      {error && <ErrorNotice message={error} />}
      <Panel title="Watermark">
        <div className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1">
          {(['text', 'image'] as WmType[]).map((t) => (
            <button key={t} onClick={() => setType(t)}
              className={cn('rounded-md py-1.5 text-xs font-bold uppercase', type === t ? 'bg-card shadow' : 'text-muted-foreground')}>
              {t}
            </button>
          ))}
        </div>
        {type === 'text' ? (
          <div className="mt-3 flex gap-2">
            <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Watermark text" aria-label="Watermark text"
              className="flex-1 rounded-lg border border-input bg-background px-3 py-2 text-sm" />
            <input type="color" value={color} onChange={(e) => setColor(e.target.value)} aria-label="Text color"
              className="h-10 w-12 cursor-pointer rounded-lg border border-border" />
          </div>
        ) : (
          <div className="mt-3">
            {logo ? (
              <div className="flex items-center gap-2 rounded-lg border border-border p-2">
                <img src={logo.src} alt="Logo" className="h-10 w-10 rounded object-contain bg-muted" />
                <span className="flex-1 truncate text-xs text-muted-foreground">Logo ready</span>
                <button onClick={() => setLogo(null)} className="rounded px-2 py-1 text-xs font-medium text-destructive hover:bg-destructive/10">Remove</button>
              </div>
            ) : (
              <UploadZone accept="image/png,image/webp,image/svg+xml" compact onFiles={onLogo} label="Upload logo (PNG best)" sublabel="Transparency preserved" />
            )}
          </div>
        )}

        <div className="mt-4 space-y-3">
          <div>
            <label className="text-xs font-medium">Size: {size}%</label>
            <input type="range" min={1} max={30} value={size} onChange={(e) => setSize(Number(e.target.value))} className="w-full" aria-label="Size" />
          </div>
          <div>
            <label className="text-xs font-medium">Opacity: {Math.round(opacity * 100)}%</label>
            <input type="range" min={0.1} max={1} step={0.05} value={opacity} onChange={(e) => setOpacity(Number(e.target.value))} className="w-full" aria-label="Opacity" />
          </div>
          <div>
            <label className="text-xs font-medium">Rotation: {angle}°</label>
            <input type="range" min={-45} max={45} value={angle} onChange={(e) => setAngle(Number(e.target.value))} className="w-full" aria-label="Rotation" />
          </div>
          <div>
            <label className="text-xs font-medium">Placement</label>
            <div className="mt-1 grid grid-cols-3 gap-1 rounded-lg bg-muted p-1">
              {(['tl', 'tr', 'center', 'bl', 'br', 'tile'] as Pos[]).map((p) => (
                <button key={p} onClick={() => setPos(p)}
                  className={cn('rounded-md py-1.5 text-[10px] font-bold uppercase', pos === p ? 'bg-card shadow' : 'text-muted-foreground')}>
                  {p === 'tl' ? 'Top L' : p === 'tr' ? 'Top R' : p === 'bl' ? 'Bot L' : p === 'br' ? 'Bot R' : p}
                </button>
              ))}
            </div>
          </div>
        </div>
      </Panel>
    </>
  );

  const preview = !file ? (
    <EmptyPreview icon={<Stamp className="h-16 w-16" />} title="No image yet" subtitle="Protect your work — stamp a text or logo watermark onto any image with tiling and opacity control." />
  ) : (
    <div className="overflow-hidden rounded-xl border border-border">
      {previewUrl ? <img src={previewUrl} alt="Watermarked preview" className="block w-full" /> : <img src={srcUrl!} alt="Source" className="block w-full" />}
    </div>
  );

  const footer = (
    <DownloadBar blob={outBlob} baseName="watermarked" format={format} formats={['png', 'jpeg', 'webp']} onFormatChange={setFormat}
      onDownload={() => outBlob && downloadBlob(outBlob, `watermarked-${Date.now()}.${format === 'jpeg' ? 'jpg' : format}`)} />
  );

  return (
    <ToolShell title="Image Watermark"
      description="Stamp text or logo watermarks onto images with placement, tiling, opacity and rotation controls."
      onReset={reset} controls={controls} preview={preview} footer={footer} />
  );
}
