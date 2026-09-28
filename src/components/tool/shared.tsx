'use client';

/**
 * Shared building blocks every tool re-uses:
 *  - UploadZone    (drag/drop + tap to upload with validation)
 *  - ProgressView  (stage label + bar, keeps UI responsive)
 *  - DownloadBar   (format-aware download + file info)
 *  - BeforeAfterSlider (comparison)
 *  - FilePill      (loaded-file summary chip)
 *  - ErrorNotice
 */
import { useRef, useState, type ReactNode } from 'react';
import { UploadCloud, Download, Loader2, AlertTriangle, CheckCircle2, FileImage, FileText, RefreshCw } from 'lucide-react';
import { cn, formatFileSize, downloadBlob } from '@/lib/utils';
import type { OutputFormat } from '@/types';

// ---------------------------------------------------------------- UploadZone
interface UploadZoneProps {
  accept: string;                      // e.g. 'image/*' or 'application/pdf'
  onFiles: (files: File[]) => void;
  multiple?: boolean;
  maxSizeMB?: number;
  onError?: (message: string) => void;
  label?: string;
  sublabel?: string;
  compact?: boolean;
}

export function UploadZone({
  accept, onFiles, multiple = false, maxSizeMB = 60, onError, label, sublabel, compact,
}: UploadZoneProps) {
  const [over, setOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const validate = (files: FileList | File[]) => {
    const arr = Array.from(files);
    const ok: File[] = [];
    for (const f of arr) {
      if (f.size > maxSizeMB * 1024 * 1024) {
        onError?.(`"${f.name}" is ${formatFileSize(f.size)} — the limit is ${maxSizeMB} MB.`);
        continue;
      }
      ok.push(f);
    }
    if (ok.length) onFiles(multiple ? ok : ok.slice(0, 1));
  };

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={label ?? 'Upload a file'}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && inputRef.current?.click()}
      onClick={() => inputRef.current?.click()}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={(e) => { e.preventDefault(); setOver(false); }}
      onDrop={(e) => { e.preventDefault(); setOver(false); validate(e.dataTransfer.files); }}
      className={cn(
        'flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed text-center transition-all',
        compact ? 'gap-1 px-4 py-5' : 'gap-3 px-6 py-12',
        over ? 'border-primary bg-primary/5 scale-[1.01]' : 'border-border hover:border-primary/50 hover:bg-muted/40'
      )}
    >
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple={multiple}
        className="hidden"
        onChange={(e) => { if (e.target.files?.length) validate(e.target.files); e.target.value = ''; }}
      />
      <span className={cn(
        'flex items-center justify-center rounded-full bg-primary/10 text-primary',
        compact ? 'h-9 w-9' : 'h-14 w-14'
      )}>
        <UploadCloud className={compact ? 'h-4 w-4' : 'h-7 w-7'} />
      </span>
      <div>
        <p className={cn('font-semibold', compact ? 'text-sm' : 'text-base')}>
          {label ?? 'Drag & drop or tap to upload'}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          {sublabel ?? `${accept.replace('*', '…')} · up to ${maxSizeMB} MB · processed on your device`}
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- FilePill
export function FilePill({ name, size, meta, onReplace, pdf }: {
  name: string; size: number; meta?: string; onReplace?: () => void; pdf?: boolean;
}) {
  const Icon = pdf ? FileText : FileImage;
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border bg-card p-3">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted">
        <Icon className="h-5 w-5 text-muted-foreground" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium" title={name}>{name}</p>
        <p className="text-xs text-muted-foreground">{formatFileSize(size)}{meta ? ` · ${meta}` : ''}</p>
      </div>
      {onReplace && (
        <button onClick={onReplace} className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-primary hover:bg-primary/10">
          <RefreshCw className="h-3.5 w-3.5" /> Replace
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- Progress
export function ProgressView({ stage, progress }: { stage: string; progress: number }) {
  return (
    <div role="status" aria-live="polite" className="rounded-xl border border-border bg-card p-4 space-y-2">
      <div className="flex items-center justify-between text-sm">
        <span className="flex items-center gap-2 font-medium">
          <Loader2 className="h-4 w-4 animate-spin text-primary" /> {stage}
        </span>
        <span className="font-mono text-muted-foreground">{Math.round(progress)}%</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-primary transition-all duration-300" style={{ width: `${progress}%` }} />
      </div>
      <p className="text-xs text-muted-foreground">Working locally in your browser — files never leave this device.</p>
    </div>
  );
}

// ---------------------------------------------------------------- Notices
export function ErrorNotice({ message }: { message: string }) {
  return (
    <div role="alert" className="flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-600 dark:text-red-400">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      <span>{message}</span>
    </div>
  );
}

export function SuccessNotice({ message }: { message: string }) {
  return (
    <div role="status" className="flex items-start gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-600 dark:text-emerald-400">
      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
      <span>{message}</span>
    </div>
  );
}

// ---------------------------------------------------------------- Download
interface DownloadBarProps {
  blob: Blob | null;
  baseName: string;
  format?: OutputFormat;
  formats?: OutputFormat[];
  onFormatChange?: (f: OutputFormat) => void;
  onDownload: () => void;
  note?: string;
}

export function DownloadBar({ blob, baseName, format, formats, onFormatChange, onDownload, note }: DownloadBarProps) {
  if (!blob) return null;
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card p-4">
      {formats && format && onFormatChange && (
        <div className="flex items-center gap-1 rounded-lg bg-muted p-1">
          {formats.map((f) => (
            <button
              key={f}
              onClick={() => onFormatChange(f)}
              className={cn(
                'rounded-md px-3 py-1.5 text-xs font-semibold uppercase transition-colors',
                format === f ? 'bg-card shadow text-foreground' : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {f === 'jpeg' ? 'JPG' : f}
            </button>
          ))}
        </div>
      )}
      <span className="text-xs text-muted-foreground">{formatFileSize(blob.size)}{note ? ` · ${note}` : ''}</span>
      <button
        onClick={onDownload}
        className="ml-auto flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition-colors hover:opacity-90 active:scale-95"
      >
        <Download className="h-4 w-4" /> Download{format ? ` ${format.toUpperCase()}` : ''}
      </button>
    </div>
  );
}

export { downloadBlob };

// ---------------------------------------------------------------- Before/After
export function BeforeAfterSlider({ before, after, beforeLabel = 'Before', afterLabel = 'After', transparent }: {
  before: string; after: string; beforeLabel?: string; afterLabel?: string; transparent?: boolean;
}) {
  const [pos, setPos] = useState(50);
  const wrap = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState(false);

  const update = (clientX: number) => {
    const el = wrap.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos(Math.min(100, Math.max(0, ((clientX - r.left) / r.width) * 100)));
  };

  return (
    <div
      ref={wrap}
      className={cn('relative w-full select-none overflow-hidden rounded-xl border border-border', transparent && 'checkerboard')}
      onMouseDown={(e) => { setDrag(true); update(e.clientX); }}
      onMouseMove={(e) => drag && update(e.clientX)}
      onMouseUp={() => setDrag(false)}
      onMouseLeave={() => setDrag(false)}
      onTouchStart={(e) => { setDrag(true); update(e.touches[0].clientX); }}
      onTouchMove={(e) => drag && update(e.touches[0].clientX)}
      onTouchEnd={() => setDrag(false)}
    >
      <img src={after} alt={afterLabel} className="block w-full" draggable={false} />
      <div className="absolute inset-0" style={{ clipPath: `inset(0 ${100 - pos}% 0 0)` }}>
        <img src={before} alt={beforeLabel} className="block h-full w-full object-cover" draggable={false} />
      </div>
      <div className="absolute inset-y-0 w-0.5 bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.4)]" style={{ left: `${pos}%` }}>
        <span className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border bg-white p-1.5 shadow">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="m9 6-5 6 5 6M15 6l5 6-5 6" />
          </svg>
        </span>
      </div>
      <span className="absolute left-2 top-2 rounded bg-black/60 px-2 py-0.5 text-[10px] font-semibold uppercase text-white">{beforeLabel}</span>
      <span className="absolute right-2 top-2 rounded bg-black/60 px-2 py-0.5 text-[10px] font-semibold uppercase text-white">{afterLabel}</span>
      <input
        type="range" min={0} max={100} value={pos} aria-label="Comparison position"
        onChange={(e) => setPos(Number(e.target.value))}
        className="absolute bottom-2 left-1/2 w-40 -translate-x-1/2 opacity-90"
      />
    </div>
  );
}

// ---------------------------------------------------------------- Empty state
export function EmptyPreview({ icon, title, subtitle }: { icon: ReactNode; title: string; subtitle: string }) {
  return (
    <div className="flex h-full min-h-[320px] flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border text-center p-8">
      <span className="text-muted-foreground/50">{icon}</span>
      <p className="font-semibold text-muted-foreground">{title}</p>
      <p className="max-w-xs text-sm text-muted-foreground/70">{subtitle}</p>
    </div>
  );
}
