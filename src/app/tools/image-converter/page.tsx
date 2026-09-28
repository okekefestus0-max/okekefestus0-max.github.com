'use client';

/**
 * TOOL: Image Converter — JPG/PNG/WebP conversion, HEIC import support via heic2any.
 */
import { useCallback, useRef, useState } from 'react';
import { FileType, Loader2, Image as ImageIcon } from 'lucide-react';
import { ToolShell, Panel } from '@/components/tool/ToolShell';
import { UploadZone, FilePill, ProgressView, ErrorNotice, SuccessNotice, DownloadBar, EmptyPreview, downloadBlob } from '@/components/tool/shared';
import { canvasToBlob, cn, fileToImage, formatFileSize } from '@/lib/utils';
import { useToast } from '@/app/providers';
import type { OutputFormat } from '@/types';

const MAX_DIM = 4000;

export default function ImageConverterPage() {
  const { toast } = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [srcUrl, setSrcUrl] = useState<string | null>(null);
  const [format, setFormat] = useState<OutputFormat>('webp');
  const [outBlob, setOutBlob] = useState<Blob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ stage: string; progress: number } | null>(null);
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wasHeicRef = useRef(false);

  const onFiles = useCallback(async (files: File[]) => {
    const f = files[0];
    setError(null); setOutBlob(null);
    setProgress({ stage: 'Reading image…', progress: 20 });
    try {
      let blob: Blob = f;
      const isHeic = f.type === 'image/heic' || f.type === 'image/heif' || /\.hei[cf]$/i.test(f.name);
      wasHeicRef.current = isHeic;
      if (isHeic) {
        setProgress({ stage: 'Decoding HEIC (first load downloads decoder)…', progress: 35 });
        const heic2any = (await import('heic2any')).default;
        const converted = await heic2any({ blob: f, toType: 'image/png' });
        blob = Array.isArray(converted) ? converted[0] : converted;
        setProgress({ stage: 'HEIC decoded ✓', progress: 60 });
      }
      const { img, url } = await (async () => {
        const u = URL.createObjectURL(blob);
        const image = new Image();
        await new Promise<void>((res, rej) => { image.onload = () => res(); image.onerror = () => rej(new Error('decode')); image.src = u; });
        return { img: image, url: u };
      })().catch(() => fileToImage(f));
      const scale = Math.min(1, MAX_DIM / Math.max(img.width, img.height));
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      c.getContext('2d')!.drawImage(img, 0, 0, w, h);
      canvasRef.current = c;
      setFile(f); setSrcUrl(url); setDims({ w, h });
      if (isHeic) { setFormat('jpeg'); toast('HEIC photo decoded. Choose a format to export.', 'success'); }
      else setFormat(f.type === 'image/png' ? 'webp' : 'png');
      setProgress(null);
    } catch (e) {
      setProgress(null);
      setError('Could not decode this image. HEIC support requires an internet connection on first use (decoder download).');
    }
  }, [toast]);

  const convert = useCallback(async () => {
    const c = canvasRef.current;
    if (!c) return;
    setProgress({ stage: 'Converting…', progress: 60 });
    let source = c;
    if (format === 'jpeg') {
      const flat = document.createElement('canvas');
      flat.width = c.width; flat.height = c.height;
      const x = flat.getContext('2d')!;
      x.fillStyle = '#ffffff'; x.fillRect(0, 0, flat.width, flat.height);
      x.drawImage(c, 0, 0);
      source = flat;
    }
    const blob = await canvasToBlob(source, `image/${format}`, 0.92);
    setOutBlob(blob); setProgress(null);
    toast(`Converted to ${format.toUpperCase()}.`, 'success');
  }, [format, toast]);

  const reset = useCallback(() => {
    setFile(null); setSrcUrl(null); setOutBlob(null); canvasRef.current = null; setError(null); setProgress(null); setDims(null);
  }, []);

  const controls = !file ? (
    <UploadZone accept="image/*,.heic,.heif" onFiles={onFiles} onError={setError} label="Drag & drop or tap to upload" sublabel="JPG · PNG · WebP · HEIC (iPhone photos)" />
  ) : (
    <>
      <FilePill name={file.name} size={file.size} meta={dims ? `${dims.w}×${dims.h}px` : undefined} onReplace={reset} />
      {error && <ErrorNotice message={error} />}
      {progress && <ProgressView stage={progress.stage} progress={progress.progress} />}
      <Panel title="Output format">
        <div className="grid grid-cols-3 gap-1 rounded-lg bg-muted p-1">
          {(['jpeg', 'png', 'webp'] as OutputFormat[]).map((f) => (
            <button key={f} onClick={() => setFormat(f)}
              className={cn('rounded-md py-2 text-sm font-bold uppercase transition-colors',
                format === f ? 'bg-card shadow text-foreground' : 'text-muted-foreground hover:text-foreground')}>
              {f === 'jpeg' ? 'JPG' : f}
            </button>
          ))}
        </div>
        <ul className="mt-3 space-y-1 text-xs text-muted-foreground">
          <li><b>JPG</b> — smallest, photos, no transparency</li>
          <li><b>PNG</b> — lossless, transparency, larger files</li>
          <li><b>WebP</b> — modern, small + transparency</li>
        </ul>
        <button onClick={convert} disabled={!file}
          className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-2.5 font-semibold text-primary-foreground transition hover:opacity-90 active:scale-95 disabled:opacity-50">
          <FileType className="h-4 w-4" /> Convert to {format === 'jpeg' ? 'JPG' : format.toUpperCase()}
        </button>
        {outBlob && <SuccessNotice message={`Ready — ${formatFileSize(outBlob.size)}`} />}
      </Panel>
    </>
  );

  const preview = !file ? (
    <EmptyPreview icon={<ImageIcon className="h-16 w-16" />} title="No image yet" subtitle="Convert photos between JPG, PNG and WebP — even decode HEIC files from your iPhone." />
  ) : (
    <div className="overflow-hidden rounded-xl border border-border checkerboard"><img src={srcUrl!} alt="Source" className="block w-full" /></div>
  );

  const footer = (
    <DownloadBar
      blob={outBlob} baseName="converted" format={format} formats={['jpeg', 'png', 'webp']}
      onFormatChange={setFormat}
      onDownload={() => outBlob && downloadBlob(outBlob, `converted-${Date.now()}.${format === 'jpeg' ? 'jpg' : format}`)}
    />
  );

  return (
    <ToolShell title="Image Converter"
      description="Convert between JPG, PNG and WebP, or decode HEIC photos from your phone. Choose the format that fits your use case."
      onReset={reset} controls={controls} preview={preview} footer={footer} />
  );
}
