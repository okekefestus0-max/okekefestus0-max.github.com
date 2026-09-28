'use client';

/**
 * TOOL: Photo Enhancer & Color Grading
 * 12 sliders (brightness → vignette), one-tap Auto Enhance, preset filters with
 * adjustable strength, custom presets (localStorage), live canvas preview with
 * before/after compare, exports PNG/JPG/WebP.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Wand2, SlidersHorizontal, Save, Eye, EyeOff, Loader2, Camera, Palette, Sparkles,
} from 'lucide-react';
import { ToolShell, Panel } from '@/components/tool/ToolShell';
import {
  UploadZone, FilePill, ProgressView, ErrorNotice, DownloadBar, EmptyPreview,
  BeforeAfterSlider, downloadBlob,
} from '@/components/tool/shared';
import { canvasToBlob, cn, fileToImage } from '@/lib/utils';
import { applyEnhancements, NEUTRAL_PARAMS, type EnhanceParams } from '@/lib/image-engine';
import { useToast } from '@/app/providers';
import type { OutputFormat } from '@/types';

const MAX_DIM = 2000;

interface PresetDef { id: string; name: string; emoji: string; params: Partial<EnhanceParams> }
const BUILTIN_PRESETS: PresetDef[] = [
  { id: 'cinematic', name: 'Cinematic', emoji: '🎬', params: { contrast: 0.16, saturation: -0.08, temperature: -12, vignette: 0.25, shadows: -0.06 } },
  { id: 'warm', name: 'Warm', emoji: '🌇', params: { temperature: 35, saturation: 0.12, brightness: 0.04, contrast: 0.05 } },
  { id: 'cool', name: 'Cool', emoji: '🧊', params: { temperature: -35, tint: -8, saturation: 0.06, contrast: 0.06 } },
  { id: 'vintage', name: 'Vintage', emoji: '📷', params: { sepia: 0.45, contrast: -0.08, brightness: 0.06, saturation: -0.15, grain: 0.25, vignette: 0.2 } },
  { id: 'bw', name: 'Black & White', emoji: '◼️', params: { grayscale: 1, contrast: 0.12 } },
  { id: 'moody', name: 'Moody', emoji: '🌫️', params: { contrast: 0.18, brightness: -0.08, saturation: -0.05, temperature: -10, vignette: 0.35 } },
  { id: 'vivid', name: 'Vivid', emoji: '🌈', params: { contrast: 0.1, saturation: 0.28, vibrance: 0.2, brightness: 0.03 } },
];

type ParamKey = keyof EnhanceParams;
const SLIDERS: { key: ParamKey; label: string; min: number; max: number; step: number }[] = [
  { key: 'brightness', label: 'Brightness', min: -1, max: 1, step: 0.02 },
  { key: 'contrast', label: 'Contrast', min: -1, max: 1, step: 0.02 },
  { key: 'saturation', label: 'Saturation', min: -1, max: 1, step: 0.02 },
  { key: 'vibrance', label: 'Vibrance', min: -1, max: 1, step: 0.02 },
  { key: 'exposure', label: 'Exposure', min: -2, max: 2, step: 0.05 },
  { key: 'highlights', label: 'Highlights', min: -1, max: 1, step: 0.02 },
  { key: 'shadows', label: 'Shadows', min: -1, max: 1, step: 0.02 },
  { key: 'temperature', label: 'Temperature', min: -100, max: 100, step: 1 },
  { key: 'tint', label: 'Tint', min: -100, max: 100, step: 1 },
  { key: 'sharpness', label: 'Sharpness', min: 0, max: 1, step: 0.02 },
  { key: 'noiseReduction', label: 'Noise reduction', min: 0, max: 1, step: 0.02 },
  { key: 'vignette', label: 'Vignette', min: 0, max: 1, step: 0.02 },
];

export default function PhotoEnhancerPage() {
  const { toast } = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [srcUrl, setSrcUrl] = useState<string | null>(null);
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);
  const [params, setParams] = useState<EnhanceParams>({ ...NEUTRAL_PARAMS });
  const [paramsBaseline, setParamsBaseline] = useState<EnhanceParams>({ ...NEUTRAL_PARAMS });
  const [presetId, setPresetId] = useState<string | null>(null);
  const [presetStrength, setPresetStrength] = useState(1);
  const [customPresets, setCustomPresets] = useState<PresetDef[]>([]);
  const [showOriginal, setShowOriginal] = useState(false);
  const [compare, setCompare] = useState(false);
  const [outUrl, setOutUrl] = useState<string | null>(null);
  const [outBlob, setOutBlob] = useState<Blob | null>(null);
  const [format, setFormat] = useState<OutputFormat>('png');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ stage: string; progress: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const srcCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const previewRef = useRef<HTMLCanvasElement | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const historyRef = useRef<EnhanceParams[]>([]);
  const histIdxRef = useRef(-1);
  const [histCan, setHistCan] = useState({ undo: false, redo: false });

  const pushHistory = useCallback((p: EnhanceParams) => {
    historyRef.current.length = histIdxRef.current + 1;
    historyRef.current.push({ ...p });
    if (historyRef.current.length > 30) historyRef.current.shift();
    histIdxRef.current = historyRef.current.length - 1;
    setHistCan({ undo: histIdxRef.current > 0, redo: false });
  }, []);

  // ---------------- load custom presets
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('tb-enhancer-presets') || '[]');
      if (Array.isArray(saved)) setCustomPresets(saved.filter((p) => p?.id && p?.name && p?.params));
    } catch { /* ignore */ }
  }, []);

  // ---------------- file
  const onFiles = useCallback(async (files: File[]) => {
    setError(null); setOutUrl(null); setOutBlob(null); setPresetId(null);
    historyRef.current = []; histIdxRef.current = -1; setHistCan({ undo: false, redo: false });
    setParams({ ...NEUTRAL_PARAMS }); setParamsBaseline({ ...NEUTRAL_PARAMS });
    const f = files[0];
    if (!f.type.startsWith('image/')) { setError('Unsupported file — choose a JPG, PNG or WebP image.'); return; }
    try {
      const { img, url } = await fileToImage(f);
      const scale = Math.min(1, MAX_DIM / Math.max(img.width, img.height));
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      c.getContext('2d')!.drawImage(img, 0, 0, w, h);
      srcCanvasRef.current = c;
      setFile(f); setSrcUrl(url); setDims({ w, h });
      pushHistory({ ...NEUTRAL_PARAMS });
      if (scale < 1) toast(`Editing at ${w}×${h}px for performance.`, 'info');
      requestAnimationFrame(() => draw({ ...NEUTRAL_PARAMS }));
    } catch { setError('Could not read this image. It may be corrupted.'); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toast, pushHistory]);

  // ---------------- rendering
  const draw = useCallback((p: EnhanceParams) => {
    const src = srcCanvasRef.current, pv = previewRef.current;
    if (!src || !pv) return;
    pv.width = src.width; pv.height = src.height;
    const ctx = pv.getContext('2d')!;
    ctx.drawImage(src, 0, 0);
    if (hasAdjustments(p)) {
      const id = ctx.getImageData(0, 0, pv.width, pv.height);
      applyEnhancements(id, p);
      ctx.putImageData(id, 0, 0);
    }
  }, []);

  const scheduleDraw = useCallback((p: EnhanceParams) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => { draw(p); commitOutput(p); }, 120);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draw]);

  const commitOutput = useCallback(async (p: EnhanceParams) => {
    const pv = previewRef.current;
    if (!pv) return;
    const blob = await canvasToBlob(pv, format === 'jpeg' ? 'image/jpeg' : `image/${format}`, 0.92);
    if (format === 'jpeg') {
      // flatten transparency
      const flat = document.createElement('canvas');
      flat.width = pv.width; flat.height = pv.height;
      const x = flat.getContext('2d')!;
      x.fillStyle = '#ffffff'; x.fillRect(0, 0, flat.width, flat.height);
      x.drawImage(pv, 0, 0);
      setOutBlob(await canvasToBlob(flat, 'image/jpeg', 0.92));
    } else setOutBlob(blob);
    setOutUrl(pv.toDataURL());
  }, [format]);

  useEffect(() => { if (srcCanvasRef.current) { draw(params); commitOutput(params); } },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [format]);

  // ---------------- slider changes
  const setParam = useCallback((key: ParamKey, value: number) => {
    setPresetId(null);
    setParams((prev) => {
      const next = { ...prev, [key]: value };
      scheduleDraw(next);
      return next;
    });
  }, [scheduleDraw]);

  const commitSlider = useCallback(() => {
    setParams((p) => { pushHistory(p); return p; });
  }, [pushHistory]);

  // ---------------- presets
  const applyPreset = useCallback((preset: PresetDef, strength = 1) => {
    setPresetId(preset.id); setPresetStrength(strength);
    const p: EnhanceParams = { ...NEUTRAL_PARAMS };
    for (const k of Object.keys(preset.params) as ParamKey[]) {
      const v = preset.params[k];
      if (typeof v === 'number') (p as unknown as Record<string, number>)[k] = v * strength;
    }
    setParamsBaseline(p); setParams(p);
    scheduleDraw(p); pushHistory(p);
  }, [scheduleDraw, pushHistory]);

  const onStrengthChange = useCallback((s: number) => {
    if (!presetId) return;
    const preset = [...BUILTIN_PRESETS, ...customPresets].find((p) => p.id === presetId);
    if (preset) applyPreset(preset, s);
  }, [presetId, customPresets, applyPreset]);

  // ---------------- auto enhance
  const autoEnhance = useCallback(() => {
    const src = srcCanvasRef.current;
    if (!src || busy) return;
    setBusy(true);
    setProgress({ stage: 'Analyzing exposure & colors…', progress: 30 });
    setTimeout(() => {
      const SAMPLE = 0.25;
      const sw = Math.max(1, Math.round(src.width * SAMPLE));
      const sh = Math.max(1, Math.round(src.height * SAMPLE));
      const c = document.createElement('canvas');
      c.width = sw; c.height = sh;
      const x = c.getContext('2d')!;
      x.drawImage(src, 0, 0, sw, sh);
      const d = x.getImageData(0, 0, sw, sh).data;
      let sum = 0, satSum = 0, min = 255, max = 0;
      let rSum = 0, gSum = 0, bSum = 0;
      const n = d.length / 4;
      for (let i = 0; i < d.length; i += 4) {
        const l = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
        sum += l; min = Math.min(min, l); max = Math.max(max, l);
        rSum += d[i]; gSum += d[i + 1]; bSum += d[i + 2];
        satSum += Math.max(d[i], d[i + 1], d[i + 2]) - Math.min(d[i], d[i + 1], d[i + 2]);
      }
      const mean = sum / n;
      const satMean = satSum / n / 255;
      const grayR = rSum / n / 255, grayG = gSum / n / 255, grayB = bSum / n / 255;

      const p: EnhanceParams = { ...NEUTRAL_PARAMS };
      // exposure → target ~48% mean luminance
      p.brightness = Math.max(-0.25, Math.min(0.25, (0.48 - mean / 255) * 0.7));
      // contrast → stretch toward full range
      p.contrast = Math.max(0, Math.min(0.3, (1 - (max - min) / 255) * 0.5 + 0.06));
      p.highlights = max > 245 ? -0.12 : 0.03;
      p.shadows = min < 12 ? 0.16 : 0.04;
      // color
      p.vibrance = satMean < 0.18 ? 0.18 : 0.05;
      p.saturation = satMean < 0.12 ? 0.1 : 0.02;
      // white balance
      const wb = (grayR - grayB) * 100;
      p.temperature = Math.max(-25, Math.min(25, -wb * 0.4));
      p.tint = Math.max(-15, Math.min(15, -(grayG - 0.36) * 40));
      p.sharpness = 0.12;
      p.noiseReduction = 0.08;

      setProgress({ stage: 'Applying enhancement…', progress: 80 });
      setPresetId(null);
      setParams(p);
      setTimeout(() => {
        draw(p); commitOutput(p); pushHistory(p);
        setBusy(false); setProgress(null);
        toast('Auto enhance applied — fine-tune with the sliders.', 'success');
      }, 60);
    }, 60);
  }, [busy, draw, commitOutput, pushHistory, toast]);

  // ---------------- misc
  const resetAdjustments = useCallback(() => {
    const p = { ...NEUTRAL_PARAMS };
    setPresetId(null); setParams(p); setParamsBaseline(p);
    draw(p); commitOutput(p); pushHistory(p);
  }, [draw, commitOutput, pushHistory]);

  const fullReset = useCallback(() => {
    setFile(null); setSrcUrl(null); setDims(null); setOutUrl(null); setOutBlob(null);
    srcCanvasRef.current = null;
    setParams({ ...NEUTRAL_PARAMS }); setPresetId(null);
    historyRef.current = []; histIdxRef.current = -1; setHistCan({ undo: false, redo: false });
    setError(null); setProgress(null); setBusy(false); setCompare(false); setShowOriginal(false);
  }, []);

  const undo = useCallback(() => {
    if (histIdxRef.current <= 0) return;
    histIdxRef.current -= 1;
    const p = historyRef.current[histIdxRef.current];
    setParams({ ...p }); draw(p); commitOutput(p); setPresetId(null);
    setHistCan({ undo: histIdxRef.current > 0, redo: true });
  }, [draw, commitOutput]);

  const redo = useCallback(() => {
    if (histIdxRef.current >= historyRef.current.length - 1) return;
    histIdxRef.current += 1;
    const p = historyRef.current[histIdxRef.current];
    setParams({ ...p }); draw(p); commitOutput(p);
    setHistCan({ undo: true, redo: histIdxRef.current < historyRef.current.length - 1 });
  }, [draw, commitOutput]);

  const savePreset = useCallback(() => {
    const name = window.prompt('Name your preset:', 'My Preset')?.trim();
    if (!name) return;
    const def: PresetDef = { id: `custom-${Date.now()}`, name, emoji: '⭐', params: { ...params } };
    const next = [...customPresets, def].slice(-24);
    setCustomPresets(next);
    localStorage.setItem('tb-enhancer-presets', JSON.stringify(next));
    toast(`Preset "${name}" saved.`, 'success');
  }, [params, customPresets, toast]);

  const deletePreset = useCallback((id: string) => {
    const next = customPresets.filter((p) => p.id !== id);
    setCustomPresets(next);
    localStorage.setItem('tb-enhancer-presets', JSON.stringify(next));
  }, [customPresets]);

  const handleDownload = useCallback(() => {
    if (outBlob) downloadBlob(outBlob, `enhanced-${Date.now()}.${format === 'jpeg' ? 'jpg' : format}`);
  }, [outBlob, format]);

  const hasAdjustments = (p: EnhanceParams) =>
    (Object.keys(p) as ParamKey[]).some((k) => Math.abs(p[k]) > 0.0001);

  // ---------------- UI
  const controls = !file ? (
    <UploadZone accept="image/*" onFiles={onFiles} onError={setError} />
  ) : (
    <>
      <FilePill name={file.name} size={file.size} meta={dims ? `${dims.w}×${dims.h}px` : undefined} onReplace={fullReset} />
      {error && <ErrorNotice message={error} />}

      <div className="grid grid-cols-2 gap-2">
        <button onClick={autoEnhance} disabled={busy}
          className="flex items-center justify-center gap-2 rounded-xl bg-primary py-2.5 text-sm font-semibold text-primary-foreground transition hover:opacity-90 active:scale-95 disabled:opacity-50">
          <Wand2 className="h-4 w-4" /> Auto Enhance
        </button>
        <button onClick={resetAdjustments} disabled={busy}
          className="flex items-center justify-center gap-2 rounded-xl border border-border py-2.5 text-sm font-semibold transition hover:bg-muted active:scale-95 disabled:opacity-50">
          Reset all
        </button>
      </div>

      {progress && <ProgressView stage={progress.stage} progress={progress.progress} />}

      <Panel title="Preset filters">
        <div className="grid grid-cols-3 gap-2">
          {[...BUILTIN_PRESETS, ...customPresets].map((p) => (
            <button
              key={p.id}
              onClick={() => applyPreset(p)}
              onContextMenu={(e) => { if (p.id.startsWith('custom-')) { e.preventDefault(); deletePreset(p.id); } }}
              title={p.id.startsWith('custom-') ? `${p.name} (right-click to delete)` : p.name}
              className={cn(
                'flex flex-col items-center gap-1 rounded-xl border py-3 transition-colors',
                presetId === p.id ? 'border-primary bg-primary/10' : 'border-border hover:bg-muted'
              )}
            >
              <span className="text-2xl">{p.emoji}</span>
              <span className="text-[10px] font-semibold leading-tight text-center">{p.name}</span>
            </button>
          ))}
        </div>
        {presetId && (
          <>
            <label className="mt-3 block text-xs font-medium text-muted-foreground">
              Filter strength: {Math.round(presetStrength * 100)}%
            </label>
            <input type="range" min={0} max={1.5} step={0.05} value={presetStrength}
              onChange={(e) => onStrengthChange(Number(e.target.value))} className="w-full" aria-label="Filter strength" />
          </>
        )}
        <button onClick={savePreset} className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-border py-2 text-xs font-semibold text-primary hover:bg-primary/5">
          <Save className="h-3.5 w-3.5" /> Save current look as preset
        </button>
      </Panel>

      <Panel title="Adjustments">
        <div className="space-y-3">
          {SLIDERS.map((s) => (
            <div key={s.key}>
              <div className="mb-1 flex items-center justify-between text-xs">
                <label htmlFor={`s-${s.key}`} className="font-medium">{s.label}</label>
                <span className="font-mono text-muted-foreground">{params[s.key].toFixed(s.step < 0.1 ? 2 : 0)}</span>
              </div>
              <input
                id={`s-${s.key}`} type="range"
                min={s.min} max={s.max} step={s.step} value={params[s.key]}
                onChange={(e) => setParam(s.key, Number(e.target.value))}
                onPointerUp={commitSlider} onKeyUp={commitSlider}
                className="w-full"
              />
            </div>
          ))}
        </div>
      </Panel>

      <Panel title="Compare">
        <div className="flex gap-2">
          <button
            onPointerDown={() => setShowOriginal(true)}
            onPointerUp={() => setShowOriginal(false)}
            onPointerLeave={() => setShowOriginal(false)}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-border py-2 text-xs font-semibold hover:bg-muted"
          >
            {showOriginal ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            Hold: original
          </button>
          <button
            onClick={() => setCompare((c) => !c)}
            className={cn(
              'flex flex-1 items-center justify-center gap-1.5 rounded-lg border py-2 text-xs font-semibold transition-colors',
              compare ? 'border-primary bg-primary/10 text-primary' : 'border-border hover:bg-muted'
            )}
          >
            <Sparkles className="h-3.5 w-3.5" /> Before/After
          </button>
        </div>
      </Panel>
    </>
  );

  const preview = !file ? (
    <EmptyPreview icon={<Camera className="h-16 w-16" />} title="No photo yet" subtitle="Upload a photo to brighten, color-grade and sharpen it with professional controls." />
  ) : compare && srcUrl && outUrl ? (
    <BeforeAfterSlider before={srcUrl} after={outUrl} />
  ) : (
    <div className="relative overflow-hidden rounded-xl border border-border bg-muted/30">
      {showOriginal && srcUrl ? (
        <img src={srcUrl} alt="Original" className="block w-full" />
      ) : (
        <canvas ref={previewRef} className="block w-full" />
      )}
      {busy && (
        <div className="absolute inset-0 flex items-center justify-center bg-background/50 backdrop-blur-sm">
          <Loader2 className="h-10 w-10 animate-spin text-primary" />
        </div>
      )}
    </div>
  );

  const footer = (
    <DownloadBar
      blob={outBlob} baseName="enhanced"
      format={format} formats={['png', 'jpeg', 'webp']}
      onFormatChange={setFormat} onDownload={handleDownload}
      note={dims ? `${dims.w}×${dims.h}px` : undefined}
    />
  );

  return (
    <ToolShell
      title="Photo Enhancer & Color Grading"
      description="Twelve pro sliders, one-tap auto enhance, and cinematic presets with adjustable strength. Save your own looks and reuse them."
      canUndo={histCan.undo} canRedo={histCan.redo}
      onUndo={undo} onRedo={redo} onReset={fullReset}
      controls={controls} preview={preview} footer={footer}
    />
  );
}
