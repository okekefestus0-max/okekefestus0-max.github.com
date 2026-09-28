'use client';

/**
 * TOOL: QR Code Generator — URL / text / Wi-Fi / Email / Phone QR codes with
 * custom colors, error correction and PNG/SVG export.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { QrCode, Link2, Type, Wifi, Mail, Phone, Download, Copy, Loader2 } from 'lucide-react';
import { ToolShell, Panel } from '@/components/tool/ToolShell';
import { ErrorNotice, DownloadBar, EmptyPreview } from '@/components/tool/shared';
import { cn, downloadBlob } from '@/lib/utils';
import { useToast } from '@/app/providers';
import type { OutputFormat } from '@/types';

type Kind = 'url' | 'text' | 'wifi' | 'email' | 'phone';
type Ecc = 'L' | 'M' | 'Q' | 'H';

export default function QrGeneratorPage() {
  const { toast } = useToast();
  const [kind, setKind] = useState<Kind>('url');
  const [input, setInput] = useState('https://example.com');
  const [wifi, setWifi] = useState({ ssid: '', pass: '', security: 'WPA' });
  const [email, setEmail] = useState({ to: '', subject: '' });
  const [dots, setDots] = useState('#111827');
  const [bg, setBg] = useState('#ffffff');
  const [ecc, setEcc] = useState<Ecc>('M');
  const [margin, setMargin] = useState(4);
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [svgText, setSvgText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [format, setFormat] = useState<OutputFormat>('png');
  const debRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const payload = useCallback((): string => {
    switch (kind) {
      case 'url': return input.trim();
      case 'text': return input;
      case 'wifi': return `WIFI:T:${wifi.security};S:${esc(wifi.ssid)};P:${esc(wifi.pass)};;`;
      case 'email': return `mailto:${email.to}${email.subject ? `?subject=${encodeURIComponent(email.subject)}` : ''}`;
      case 'phone': return `tel:${input.replace(/[^\d+]/g, '')}`;
    }
    function esc(s: string) { return s.replace(/([\\;,:"'])/g, '\\$1'); }
  }, [kind, input, wifi, email]);

  const generate = useCallback(async () => {
    const data = payload();
    if (!data.trim()) { setDataUrl(null); setSvgText(null); return; }
    if (data.length > 2000) { setError('Content is too long for a QR code (max 2,000 characters).'); return; }
    setError(null);
    try {
      const QRCode = (await import('qrcode')).default;
      const [png, svg] = await Promise.all([
        QRCode.toDataURL(data, { errorCorrectionLevel: ecc, margin, width: 1000, color: { dark: dots, light: bg } }),
        QRCode.toString(data, { type: 'svg', errorCorrectionLevel: ecc, margin, width: 1000, color: { dark: dots, light: bg } }),
      ]);
      setDataUrl(png);
      setSvgText(svg);
    } catch {
      setError('Could not generate a QR code for this content — it may be too long.');
      setDataUrl(null); setSvgText(null);
    }
  }, [payload, ecc, margin, dots, bg]);

  useEffect(() => {
    if (debRef.current) clearTimeout(debRef.current);
    debRef.current = setTimeout(generate, 250);
  }, [generate]);

  const reset = () => { setInput(''); setDataUrl(null); setSvgText(null); setError(null); };

  const handleDownload = useCallback(async () => {
    if (format === 'png' && dataUrl) {
      const blob = await (await fetch(dataUrl)).blob();
      downloadBlob(blob, `qr-${Date.now()}.png`);
    } else if (svgText) {
      downloadBlob(new Blob([svgText], { type: 'image/svg+xml' }), `qr-${Date.now()}.svg`);
    }
  }, [format, dataUrl, svgText]);

  const controls = (
    <>
      <Panel title="Content">
        <div className="grid grid-cols-5 gap-1 rounded-lg bg-muted p-1">
          {([['url', Link2], ['text', Type], ['wifi', Wifi], ['email', Mail], ['phone', Phone]] as [Kind, typeof Link2][]).map(([k, Icon]) => (
            <button key={k} onClick={() => setKind(k)} aria-label={k} title={k}
              className={cn('flex items-center justify-center rounded-md py-2', kind === k ? 'bg-card shadow text-primary' : 'text-muted-foreground hover:text-foreground')}>
              <Icon className="h-4 w-4" />
            </button>
          ))}
        </div>

        {kind === 'wifi' ? (
          <div className="mt-3 space-y-2">
            <input value={wifi.ssid} onChange={(e) => setWifi({ ...wifi, ssid: e.target.value })} placeholder="Network name (SSID)" aria-label="Wi-Fi network name"
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm" />
            <input value={wifi.pass} onChange={(e) => setWifi({ ...wifi, pass: e.target.value })} placeholder="Password" aria-label="Wi-Fi password" type="password"
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm" />
            <select value={wifi.security} onChange={(e) => setWifi({ ...wifi, security: e.target.value })} aria-label="Wi-Fi security"
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm">
              <option value="WPA">WPA/WPA2</option><option value="WEP">WEP</option><option value="nopass">Open</option>
            </select>
          </div>
        ) : kind === 'email' ? (
          <div className="mt-3 space-y-2">
            <input value={email.to} onChange={(e) => setEmail({ ...email, to: e.target.value })} placeholder="name@example.com" aria-label="Email address" type="email"
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm" />
            <input value={email.subject} onChange={(e) => setEmail({ ...email, subject: e.target.value })} placeholder="Subject (optional)" aria-label="Email subject"
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm" />
          </div>
        ) : (
          <textarea value={input} onChange={(e) => setInput(e.target.value)} rows={3} aria-label="QR content"
            placeholder={kind === 'url' ? 'https://your-link.com' : kind === 'phone' ? '+1 555 123 4567' : 'Any text…'}
            className="mt-3 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm" />
        )}
        {error && <div className="mt-3"><ErrorNotice message={error} /></div>}
      </Panel>

      <Panel title="Style">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-medium">Dots</label>
            <input type="color" value={dots} onChange={(e) => setDots(e.target.value)} aria-label="Dot color" className="mt-1 h-10 w-full cursor-pointer rounded-lg border border-border" />
          </div>
          <div>
            <label className="text-xs font-medium">Background</label>
            <input type="color" value={bg} onChange={(e) => setBg(e.target.value)} aria-label="Background color" className="mt-1 h-10 w-full cursor-pointer rounded-lg border border-border" />
          </div>
        </div>
        <div className="mt-3">
          <label className="text-xs font-medium">Error correction</label>
          <div className="mt-1 grid grid-cols-4 gap-1 rounded-lg bg-muted p-1">
            {(['L', 'M', 'Q', 'H'] as Ecc[]).map((e) => (
              <button key={e} onClick={() => setEcc(e)} title={{ L: 'Low (7%)', M: 'Medium (15%)', Q: 'Quartile (25%)', H: 'High (30%)' }[e]}
                className={cn('rounded-md py-1.5 text-xs font-bold', ecc === e ? 'bg-card shadow' : 'text-muted-foreground')}>
                {e}
              </button>
            ))}
          </div>
          <p className="mt-1 text-[10px] text-muted-foreground">Higher survives damage/print &amp; looks busier.</p>
        </div>
        <div className="mt-3">
          <label className="text-xs font-medium">Quiet zone (margin): {margin}</label>
          <input type="range" min={0} max={10} value={margin} onChange={(e) => setMargin(Number(e.target.value))} className="w-full" aria-label="Margin" />
        </div>
      </Panel>

      {dataUrl && (
        <button onClick={async () => {
          try { await navigator.clipboard.writeText(payload()); toast('QR content copied.', 'success'); } catch { toast('Copy failed.', 'error'); }
        }} className="flex w-full items-center justify-center gap-2 rounded-xl border border-border py-2.5 text-sm font-semibold hover:bg-muted">
          <Copy className="h-4 w-4" /> Copy content
        </button>
      )}
    </>
  );

  const preview = dataUrl ? (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-border p-6" style={{ backgroundColor: bg }}>
      <img src={dataUrl} alt="Generated QR code" className="w-full max-w-sm rounded-lg" />
      <p className="text-center text-xs text-neutral-500 break-all max-w-sm">{payload()}</p>
    </div>
  ) : (
    <EmptyPreview icon={<QrCode className="h-16 w-16" />} title="QR code will appear here" subtitle="Enter a link, text, Wi-Fi credentials, email or phone number — the code updates live." />
  );

  const footer = dataUrl ? (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card p-4">
      <div className="flex items-center gap-1 rounded-lg bg-muted p-1">
        {(['png', 'svg'] as const).map((f) => (
          <button key={f} onClick={() => setFormat(f as OutputFormat)}
            className={cn('rounded-md px-3 py-1.5 text-xs font-bold uppercase', format === f ? 'bg-card shadow' : 'text-muted-foreground')}>
            {f}
          </button>
        ))}
      </div>
      <span className="text-xs text-muted-foreground">1000×1000 · {format.toUpperCase() === 'PNG' ? 'raster' : 'vector, scales perfectly'}</span>
      <button onClick={handleDownload}
        className="ml-auto flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90 active:scale-95">
        <Download className="h-4 w-4" /> Download {format.toUpperCase()}
      </button>
    </div>
  ) : null;

  return (
    <ToolShell title="QR Code Generator"
      description="Create QR codes for links, text, Wi-Fi credentials, emails and phone numbers — custom colors included."
      onReset={reset} controls={controls} preview={preview} footer={footer} />
  );
}

