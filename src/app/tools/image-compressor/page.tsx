'use client';

/**
 * TOOL: Image Compressor — quality slider with live size preview (WebP/JPEG/PNG).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { FileMinus, Image as ImageIcon } from 'lucide-react';
import { ToolShell, Panel } from '@/components/tool/ToolShell';
import { UploadZone, FilePill, ErrorNotice, DownloadBar, EmptyPreview, downloadBlob } from '@/components/tool/shared';
import { canvasToBlob, cn, fileToImage, formatFileSize } from '@/lib/utils';
import { useToast } from '@/app/providers';
import type { OutputFormat } from '@/types';

const MAX_DIM = 3000;

export default function ImageCompressorPage() {
  const { toast } = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [srcUrl, setSrcUrl] = useState<string | null>(null);
  const [quality, setQuality] = useState(70);
  const [format, setFormat] = useState<OutputFormat>('jpeg');
  const [outBlob, setOutBlob] = useState<Blob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [compressing, setCompressing] = useState(false);

  const compress = useCallback(async (q: number, f: OutputFormat) => {
    const c = canvasRef.current;
    if (!c) return;
    setCompressing(true);
    // JPEG can't do alpha — flatten
    let source = c;
    if (f === 'jpeg') {
      const flat = document.createElement('canvas');
      flat.width = c.width; flat.height = c.height;
      const x = flat.getContext('2d')!;
      x.fillStyle = '#ffffff'; x.fillRect(0, 0, flat.width, flat.height);
      x.drawImage(c, 0, 0);
      source = flat;
    }
    const blob = await canvasToBlob(source, `image/${f}`, q / 100);
    setOutBlob(blob);
    setCompressing(false);
  }, []);

  const schedule = useCallback((q: number, f: OutputFormat) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => compress(q, f), 150);
  }, [compress]);

  const onFiles = useCallback(async (files: File[]) => {
    setError(null); setOutBlob(null);
    try {
      const { img, url } = await fileToImage(files[0]);
      const scale = Math.min(1, MAX_DIM / Math.max(img.width, img.height));
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      c.getContext('2d')!.drawImage(img, 0, 0, w, h);
      canvasRef.current = c;
      setFile(files[0]); setSrcUrl(url); setDims({ w, h });
      compress(quality, format);
      if (files[0].type === 'image/png') setFormat('png');
      else if (files[0].type === 'image/webp') setFormat('webp');
    } catch { setError('Could not read this image. It may be corrupted or unsupported.'); }
  }, [compress, quality, format]);

  useEffect(() => { if (canvasRef.current) schedule(quality, format); }, [format]); // eslint-disable-line

  const reset = useCallback(() => {
    setFile(null); setSrcUrl(null); setOutBlob(null); canvasRef.current = null; setError(null); setDims(null);
  }, []);

  const saved = file && outBlob ? file.size - outBlob.size : 0;
  const pct = file && outBlob ? Math.round((saved / file.size) * 100) : 0;

  const controls = !file ? (
    <UploadZone accept="image/*" onFiles={onFiles} onError={setError} />
  ) : (
    <>
      <FilePill name={file.name} size={file.size} meta={dims ? `${dims.w}×${dims.h}px` : undefined} onReplace={reset} />
      {error && <ErrorNotice message={error} />}
      <Panel title="Compression">
        <label htmlFor="q" className="text-xs font-medium">Quality: {quality}%</label>
        <input id="q" type="range" min={5} max={100} value={quality}
          onChange={(e) => { setQuality(Number(e.target.value)); schedule(Number(e.target.value), format); }}
          className="mt-1 w-full" />
        <div className="mt-1 flex justify-between text-[10px] text-muted-foreground"><span>Smallest file</span><span>Best quality</span></div>
        <div className="mt-3 grid grid-cols-[1fr_auto] gap-y-1 text-sm">
          <span className="text-muted-foreground">Original</span><span className="font-mono">{formatFileSize(file.size)}</span>
          <span className="text-muted-foreground">Compressed</span>
          <span className={cn('font-mono', compressing && 'opacity-50')}>{outBlob ? formatFileSize(outBlob.size) : '…'}</span>
          <span className="font-medium text-muted-foreground">You save</span>
          <span className={cn('font-mono font-semibold', saved > 0 ? 'text-emerald-500' : 'text-amber-500')}>
            {outBlob ? (saved > 0 ? `−${formatFileSize(saved)} (${pct}%)` : 'not smaller — try WebP') : '…'}
          </span>
        </div>
      </Panel>
    </>
  );

  const preview = !file ? (
    <EmptyPreview icon={<ImageIcon className="h-16 w-16" />} title="No image yet" subtitle="Upload an image and watch the file size drop as you move the quality slider." />
  ) : (
    <div className="overflow-hidden rounded-xl border border-border"><img src={srcUrl!} alt="Source" className="block w-full" /></div>
  );

  const footer = (
    <DownloadBar
      blob={outBlob} baseName="compressed"
      format={format} formats={['jpeg', 'webp', 'png']}
      onFormatChange={(f) => { setFormat(f); schedule(quality, f); }}
      onDownload={() => outBlob && downloadBlob(outBlob, `compressed-${Date.now()}.${format === 'jpeg' ? 'jpg' : format}`)}
      note={saved > 0 ? `${pct}% smaller` : undefined}
    />
  );

  return (
    <ToolShell title="Image Compressor"
      description="Shrink image file size with a live quality slider. Compare original vs compressed size instantly — WebP often wins."
      onReset={reset} controls={controls} preview={preview} footer={footer} />
  );
}
