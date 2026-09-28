'use client';

/**
 * TOOL: OCR — extract text from images or scanned PDFs with Tesseract.js.
 * Engine downloads once from CDN, thereafter cached by the browser.
 */
import { useCallback, useRef, useState } from 'react';
import { ScanText, Loader2, Copy, Download, FileText, Image as ImageIcon, Trash2 } from 'lucide-react';
import { ToolShell, Panel } from '@/components/tool/ToolShell';
import { UploadZone, FilePill, ProgressView, ErrorNotice, SuccessNotice, EmptyPreview, downloadBlob } from '@/components/tool/shared';
import { cn, formatFileSize } from '@/lib/utils';
import { useToast } from '@/app/providers';

const LANGS = [
  { code: 'eng', label: 'English' },
  { code: 'spa', label: 'Spanish' },
  { code: 'fra', label: 'French' },
  { code: 'deu', label: 'German' },
  { code: 'por', label: 'Portuguese' },
  { code: 'ita', label: 'Italian' },
  { code: 'nld', label: 'Dutch' },
  { code: 'tur', label: 'Turkish' },
  { code: 'ara', label: 'Arabic' },
  { code: 'hin', label: 'Hindi' },
  { code: 'chi_sim', label: 'Chinese (Simplified)' },
  { code: 'jpn', label: 'Japanese' },
];

export default function OcrPage() {
  const { toast } = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [isPdf, setIsPdf] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [lang, setLang] = useState('eng');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ stage: string; progress: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState<string | null>(null);
  const [stats, setStats] = useState<{ words: number; confidence: number } | null>(null);
  const workerRef = useRef<any>(null);

  const killWorker = () => { try { workerRef.current?.terminate(); } catch {} workerRef.current = null; };

  const onFiles = useCallback(async (files: File[]) => {
    const f = files[0];
    setError(null); setText(null); setStats(null);
    killWorker();
    const pdf = f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf');
    if (!pdf && !f.type.startsWith('image/')) {
      setError('Please upload an image (JPG/PNG/WebP) or a scanned PDF.'); return;
    }
    setFile(f); setIsPdf(pdf);
    if (pdf) {
      setPreviewUrl(null);
    } else {
      const url = URL.createObjectURL(f);
      setPreviewUrl(url);
    }
  }, []);

  const runOcr = useCallback(async () => {
    if (!file || busy) return;
    setBusy(true); setError(null); setText(null); setStats(null);
    setProgress({ stage: 'Loading OCR engine…', progress: 5 });
    try {
      const Tesseract = await import('tesseract.js');
      const worker = await (Tesseract.createWorker as any)(
        lang,
        (Tesseract as any).OEM?.LSTM_ONLY ?? 1,
        {
        logger: (m: any) => {
          if (m.status === 'recognizing text') {
            setProgress({ stage: 'Recognizing text…', progress: 20 + m.progress * 75 });
          } else if (m.status?.includes('loading')) {
            setProgress({ stage: 'Downloading language data…', progress: 12 });
          }
        },
      });
      workerRef.current = worker;

      const imageSources: Blob[] = [];
      if (isPdf) {
        setProgress({ stage: 'Rendering PDF pages…', progress: 12 });
        const pdfjs = await import('pdfjs-dist');
        pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.js';
        const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
        const n = Math.min(pdf.numPages, 10);
        for (let i = 1; i <= n; i++) {
          setProgress({ stage: `Rendering page ${i}/${n}…`, progress: 5 + (i / n) * 10 });
          const page = await pdf.getPage(i);
          const vp = page.getViewport({ scale: 200 / 72 });
          const c = document.createElement('canvas');
          c.width = Math.ceil(vp.width); c.height = Math.ceil(vp.height);
          const ctx = c.getContext('2d')!;
          ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, c.width, c.height);
          await page.render({ canvasContext: ctx, viewport: vp }).promise;
          const blob = await new Promise<Blob>((res, rej) => c.toBlob((b) => b ? res(b) : rej(new Error('render')), 'image/png'));
          imageSources.push(blob);
        }
      } else {
        imageSources.push(file);
      }

      let all = '';
      let confSum = 0, confN = 0, words = 0;
      for (let i = 0; i < imageSources.length; i++) {
        setProgress({ stage: imageSources.length > 1 ? `Recognizing page ${i + 1}/${imageSources.length}…` : 'Recognizing text…', progress: 20 + (i / imageSources.length) * 75 });
        const { data } = await worker.recognize(imageSources[i]);
        const pageText = (data.text || '').trim();
        if (imageSources.length > 1) all += `\n\n— Page ${i + 1} —\n\n${pageText}`;
        else all = pageText;
        if (typeof (data as any).confidence === 'number') { confSum += (data as any).confidence; confN++; }
        words += pageText.split(/\s+/).filter(Boolean).length;
      }
      await worker.terminate(); workerRef.current = null;

      if (!all.trim()) {
        setError('No text was detected. Make sure the image is sharp, upright and well-lit.');
      } else {
        setText(all);
        setStats({ words, confidence: confN ? Math.round(confSum / confN) : 0 });
        toast(`Found ${words} words.`, 'success');
      }
    } catch (e) {
      console.error(e);
      setError('OCR failed. The engine downloads language files — check your internet connection on first run.');
      killWorker();
    }
    setBusy(false); setProgress(null);
  }, [file, busy, isPdf, lang, toast]);

  const copy = useCallback(async () => {
    if (!text) return;
    try { await navigator.clipboard.writeText(text); toast('Copied to clipboard.', 'success'); }
    catch { toast('Copy failed — select the text manually.', 'error'); }
  }, [text, toast]);

  const reset = () => {
    killWorker();
    setFile(null); setPreviewUrl(null); setText(null); setStats(null); setError(null); setProgress(null);
  };

  const controls = !file ? (
    <UploadZone accept="image/*,application/pdf" onFiles={onFiles} onError={setError} maxSizeMB={100}
      label="Drag & drop an image or scanned PDF" sublabel="JPG · PNG · WebP or PDF (first 10 pages)" />
  ) : (
    <>
      <FilePill pdf={isPdf} name={file.name} size={file.size} onReplace={reset} meta={isPdf ? 'up to 10 pages' : undefined} />
      {error && <ErrorNotice message={error} />}
      {progress && <ProgressView stage={progress.stage} progress={progress.progress} />}
      <Panel title="Recognition">
        <label className="text-xs font-medium" htmlFor="lang">Document language</label>
        <select id="lang" value={lang} onChange={(e) => setLang(e.target.value)}
          className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm">
          {LANGS.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
        </select>
        <button onClick={runOcr} disabled={busy}
          className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-2.5 font-semibold text-primary-foreground hover:opacity-90 active:scale-95 disabled:opacity-50">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ScanText className="h-4 w-4" />} Extract text
        </button>
        <p className="mt-2 text-xs text-muted-foreground">First run downloads the language pack (~10 MB), then it works offline.</p>
      </Panel>
      {stats && (
        <Panel title="Results">
          <div className="grid grid-cols-2 gap-2 text-center">
            <div className="rounded-lg bg-muted p-3">
              <p className="text-xl font-bold">{stats.words}</p>
              <p className="text-xs text-muted-foreground">words</p>
            </div>
            <div className="rounded-lg bg-muted p-3">
              <p className="text-xl font-bold">{stats.confidence}%</p>
              <p className="text-xs text-muted-foreground">confidence</p>
            </div>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button onClick={copy} className="flex items-center justify-center gap-1.5 rounded-lg border border-border py-2 text-xs font-semibold hover:bg-muted">
              <Copy className="h-3.5 w-3.5" /> Copy
            </button>
            <button onClick={() => text && downloadBlob(new Blob([text], { type: 'text/plain' }), `ocr-${Date.now()}.txt`)}
              className="flex items-center justify-center gap-1.5 rounded-lg bg-primary py-2 text-xs font-semibold text-primary-foreground hover:opacity-90">
              <Download className="h-3.5 w-3.5" /> .txt
            </button>
          </div>
        </Panel>
      )}
    </>
  );

  const preview = !file ? (
    <EmptyPreview icon={<ScanText className="h-16 w-16" />} title="Nothing to scan" subtitle="Drop a photo of a document, receipt, or sign — or a scanned PDF — and pull the text out of it." />
  ) : text ? (
    <Panel title="Extracted text">
      <textarea
        readOnly
        value={text}
        aria-label="Extracted text"
        className="h-[60vh] w-full resize-none rounded-lg border border-input bg-muted/40 p-3 font-mono text-sm leading-relaxed"
      />
    </Panel>
  ) : (
    <div className="overflow-hidden rounded-xl border border-border bg-muted/30">
      {previewUrl ? (
        <img src={previewUrl} alt="Document to scan" className="block w-full" />
      ) : (
        <div className="flex h-72 items-center justify-center text-muted-foreground">
          <FileText className="mr-2 h-6 w-6" /> PDF ready — choose language and extract.
        </div>
      )}
      {busy && (
        <div className="absolute inset-0 flex items-center justify-center bg-background/60 backdrop-blur-sm">
          <Loader2 className="h-10 w-10 animate-spin text-primary" />
        </div>
      )}
    </div>
  );

  return (
    <ToolShell title="OCR — Extract Text"
      description="Pull text out of images and scanned PDFs with on-device OCR supporting 12 languages."
      onReset={reset} controls={controls} preview={preview} />
  );
}
