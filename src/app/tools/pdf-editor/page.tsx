'use client';

/**
 * TOOL: PDF Editor
 * Render PDFs in-browser with pdf.js, annotate via an overlay canvas
 * (text, images, signatures, highlights, rectangles, whiteout), manage pages
 * (rotate / delete / reorder / add blank), then rebuild the edited PDF with pdf-lib.
 *
 * Element coordinates are stored in PDF "points" (1pt = 1/72in) at scale 1,
 * top-left origin (converted to PDF's bottom-up coords at export time).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  FileText, Type, Image as ImageIcon, PenTool, Highlighter, Square, Eraser, MousePointer2,
  Trash2, RotateCw, RotateCcw, ArrowUp, ArrowDown, FilePlus, Loader2, Download, X, Check,
} from 'lucide-react';
import { ToolShell, Panel } from '@/components/tool/ToolShell';
import { UploadZone, FilePill, ProgressView, ErrorNotice, SuccessNotice, EmptyPreview } from '@/components/tool/shared';
import { cn, downloadBlob, loadImage } from '@/lib/utils';
import { useToast } from '@/app/providers';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
import { PDFDocument, degrees, rgb, StandardFonts } from 'pdf-lib';

// ---------------------------------------------------------------- types
type Tool = 'select' | 'text' | 'image' | 'signature' | 'highlight' | 'rect' | 'whiteout';

interface El {
  id: string;
  type: 'text' | 'image' | 'signature' | 'highlight' | 'rect' | 'whiteout';
  x: number; y: number; w: number; h: number;
  content?: string;
  fontSize?: number;
  color?: string;
  bold?: boolean; italic?: boolean;
  strokeWidth?: number;
  dataUrl?: string;            // images / signatures as dataURL
  points?: { x: number; y: number }[]; // free-hand signature
}

interface PageState {
  rotation: number; // extra rotation (multiples of 90)
  elements: El[];
  // rendered viewport (scale 1, before rotation) from pdf.js
  width: number; height: number;
  blank?: boolean; // added blank page
}

const uid = () => Math.random().toString(36).slice(2, 10);

// ---------------------------------------------------------------- component
export default function PdfEditorPage() {
  const { toast } = useToast();

  const [file, setFile] = useState<File | null>(null);
  const [pages, setPages] = useState<PageState[]>([]);
  const [pageOrder, setPageOrder] = useState<number[]>([]); // index into pages (supports reorder/delete where neccessary: contiguous)
  const [current, setCurrent] = useState(0); // position within pageOrder
  const [tool, setTool] = useState<Tool>('select');
  const [zoom, setZoom] = useState(1);
  const [selId, setSelId] = useState<string | null>(null);
  const [textStyle, setTextStyle] = useState({ size: 14, color: '#111111', bold: false, italic: false });
  const [strokeColor, setStrokeColor] = useState('#e11d48');
  const [strokeWidth, setStrokeWidth] = useState(2);
  const [fillColor, setFillColor] = useState('#fde047');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ stage: string; progress: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exported, setExported] = useState<{ blob: Blob; size: number } | null>(null);
  const [textEntry, setTextEntry] = useState<{ x: number; y: number; value: string } | null>(null);

  const pdfRef = useRef<PDFDocumentProxy | null>(null);
  const bytesRef = useRef<ArrayBuffer | null>(null);
  const baseCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const viewportRef = useRef<{ width: number; height: number }>({ width: 0, height: 0 });
  const dragRef = useRef<{
    mode: 'draw' | 'move' | null;
    startX: number; startY: number; lastX: number; lastY: number;
    elId?: string; points?: { x: number; y: number }[];
  }>({ mode: null, startX: 0, startY: 0, lastX: 0, lastY: 0 });

  const historyRef = useRef<{ pages: PageState[]; order: number[]; current: number }[]>([]);
  const histIdxRef = useRef(-1);
  const [histCan, setHistCan] = useState({ undo: false, redo: false });

  const pagesRef = useRef(pages); pagesRef.current = pages;
  const orderRef = useRef(pageOrder); orderRef.current = pageOrder;
  const currentRef = useRef(current); currentRef.current = current;

  const currentPage = pages[pageOrder[current]];

  // ---------------------------------------------------------------- history
  const snapshot = useCallback(() => {
    historyRef.current.length = histIdxRef.current + 1;
    historyRef.current.push({
      pages: JSON.parse(JSON.stringify(pagesRef.current)),
      order: [...orderRef.current],
      current: currentRef.current,
    });
    if (historyRef.current.length > 25) historyRef.current.shift();
    histIdxRef.current = historyRef.current.length - 1;
    setHistCan({ undo: histIdxRef.current > 0, redo: false });
  }, []);

  const restore = useCallback((idx: number) => {
    const snap = historyRef.current[idx];
    if (!snap) return;
    histIdxRef.current = idx;
    setPages(snap.pages); setPageOrder(snap.order); setCurrent(Math.min(snap.current, snap.order.length - 1));
    setHistCan({ undo: idx > 0, redo: idx < historyRef.current.length - 1 });
  }, []);

  const undo = useCallback(() => histIdxRef.current > 0 && restore(histIdxRef.current - 1), [restore]);
  const redo = useCallback(() => histIdxRef.current < historyRef.current.length - 1 && restore(histIdxRef.current + 1), [restore]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selId) { e.preventDefault(); deleteElement(selId); }
      if (e.key === 'Escape') { setSelId(null); setTextEntry(null); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo, selId]); // eslint-disable-line

  // ---------------------------------------------------------------- load
  const onFiles = useCallback(async (files: File[]) => {
    const f = files[0];
    setError(null); setExported(null); setSelId(null); setTextEntry(null);
    if (f.type !== 'application/pdf') { setError('That file is not a PDF. Please choose a .pdf document.'); return; }
    setBusy(true); setProgress({ stage: 'Loading PDF…', progress: 15 });
    try {
      const bytes = await f.arrayBuffer();
      bytesRef.current = bytes.slice(0);
      const pdfjs = await import('pdfjs-dist');
      pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.js';
      const pdf = await pdfjs.getDocument({ data: bytes }).promise;
      pdfRef.current = pdf;

      if (pdf.numPages > 200) {
        setError('This PDF has more than 200 pages — editing that many pages in the browser may be slow. Consider splitting it first.');
      }

      const ps: PageState[] = [];
      for (let i = 0; i < pdf.numPages; i++) {
        const page = await pdf.getPage(i + 1);
        const vp = page.getViewport({ scale: 1 });
        ps.push({ rotation: 0, elements: [], width: vp.width, height: vp.height });
        setProgress({ stage: `Reading page ${i + 1}/${pdf.numPages}…`, progress: 15 + ((i + 1) / pdf.numPages) * 70 });
      }
      setFile(f);
      setPages(ps);
      setPageOrder(ps.map((_, i) => i));
      setCurrent(0);
      historyRef.current = []; histIdxRef.current = -1; setHistCan({ undo: false, redo: false });
      snapshot();
      setBusy(false); setProgress(null);
      toast(`Loaded ${pdf.numPages} page${pdf.numPages > 1 ? 's' : ''}.`, 'success');
    } catch (err) {
      setBusy(false); setProgress(null);
      pdfRef.current = null;
      setError('Could not open this PDF. It may be corrupted or password-protected.');
    }
  }, [toast, snapshot]);

  // ---------------------------------------------------------------- render
  const render = useCallback(async () => {
    const pdf = pdfRef.current;
    const base = baseCanvasRef.current, overlay = overlayCanvasRef.current, wrap = wrapRef.current;
    const order = orderRef.current, cur = currentRef.current;
    const p = pagesRef.current[order[cur]];
    if (!pdf || !base || !overlay || !wrap || !p) return;

    const isRotated = p.rotation % 180 !== 0;
    const logicalW = isRotated ? p.height : p.width;
    const logicalH = isRotated ? p.width : p.height;
    const scale = (Math.max(280, wrap.clientWidth - 16) / logicalW) * zoom;
    viewportRef.current = { width: logicalW * scale, height: logicalH * scale };

    base.width = overlay.width = Math.round(logicalW * scale);
    base.height = overlay.height = Math.round(logicalH * scale);

    if (p.blank) {
      const bctx = base.getContext('2d')!;
      bctx.fillStyle = '#ffffff'; bctx.fillRect(0, 0, base.width, base.height);
    } else {
      try {
        const page: PDFPageProxy = await pdf.getPage(order[cur] + 1);
        const bvp = page.getViewport({ scale, rotation: (page.rotate + p.rotation + 360) % 360 });
        base.width = bvp.width; base.height = bvp.height;
        overlay.width = bvp.width; overlay.height = bvp.height;
        viewportRef.current = { width: bvp.width, height: bvp.height };
        await page.render({ canvasContext: base.getContext('2d')!, viewport: bvp }).promise;
      } catch { setError('Failed to render this page.'); }
    }
    drawOverlay();
  }, [zoom]); // eslint-disable-line

  const drawOverlay = useCallback(() => {
    const overlay = overlayCanvasRef.current;
    const p = pagesRef.current[orderRef.current[currentRef.current]];
    if (!overlay || !p) return;
    const octx = overlay.getContext('2d')!;
    octx.clearRect(0, 0, overlay.width, overlay.height);
    const sx = overlay.width / (p.rotation % 180 !== 0 ? p.height : p.width);
    const sy = overlay.height / (p.rotation % 180 !== 0 ? p.width : p.height);

    for (const el of p.elements) {
      octx.save();
      if (el.type === 'text' && el.content) {
        const fs = (el.fontSize || 14) * sx;
        octx.font = `${el.italic ? 'italic ' : ''}${el.bold ? '700 ' : '400 '}${fs}px Helvetica, Arial, sans-serif`;
        octx.fillStyle = el.color || '#111';
        octx.textBaseline = 'top';
        octx.fillText(el.content, el.x * sx, el.y * sy);
      } else if (el.type === 'image' && el.dataUrl) {
        drawImageEl(octx, el, sx, sy);
      } else if (el.type === 'signature' && el.points) {
        octx.strokeStyle = el.color || '#1d4ed8';
        octx.lineWidth = Math.max(1.5, (el.strokeWidth || 2) * sx);
        octx.lineCap = 'round'; octx.lineJoin = 'round';
        octx.beginPath();
        el.points.forEach((pt, i) => i === 0 ? octx.moveTo(pt.x * sx, pt.y * sy) : octx.lineTo(pt.x * sx, pt.y * sy));
        octx.stroke();
      } else if (el.type === 'highlight') {
        octx.fillStyle = el.color || '#fde047';
        octx.globalAlpha = 0.45;
        octx.fillRect(el.x * sx, el.y * sy, el.w * sx, el.h * sy);
        octx.globalAlpha = 1;
      } else if (el.type === 'whiteout') {
        octx.fillStyle = '#ffffff';
        octx.fillRect(el.x * sx, el.y * sy, el.w * sx, el.h * sy);
      } else if (el.type === 'rect') {
        octx.strokeStyle = el.color || '#e11d48';
        octx.lineWidth = Math.max(1, (el.strokeWidth || 2) * sx);
        octx.strokeRect(el.x * sx, el.y * sy, el.w * sx, el.h * sy);
      }
      octx.restore();

      if (el.id === selId) {
        octx.save();
        octx.strokeStyle = '#2563eb';
        octx.setLineDash([5, 4]);
        octx.lineWidth = 1.5;
        const pad = 4;
        const bx = el.x * sx - pad, by = el.y * sy - pad;
        const bw = measuredW(el, octx, sx) * 1 + pad * 2, bh = measuredH(el, sy) + pad * 2;
        octx.strokeRect(bx, by, bw, bh);
        octx.restore();
      }
    }
  }, [selId]);

  const measuredW = (el: El, ctx: CanvasRenderingContext2D, sx: number) => {
    if (el.type === 'text' && el.content) {
      const fs = (el.fontSize || 14) * sx;
      ctx.font = `${el.italic ? 'italic ' : ''}${el.bold ? '700 ' : '400 '}${fs}px Helvetica, Arial, sans-serif`;
      return ctx.measureText(el.content).width;
    }
    return el.w * sx;
  };
  const measuredH = (el: El, sy: number) => {
    if (el.type === 'text') return (el.fontSize || 14) * sy * 1.25;
    return el.h * sy;
  };

  const imgCacheRef = useRef<Map<string, HTMLImageElement>>(new Map());
  const drawImageEl = (ctx: CanvasRenderingContext2D, el: El, sx: number, sy: number) => {
    const cached = imgCacheRef.current.get(el.id);
    if (cached?.complete) { ctx.drawImage(cached, el.x * sx, el.y * sy, el.w * sx, el.h * sy); return; }
    const img = new Image();
    img.onload = () => { imgCacheRef.current.set(el.id, img); drawOverlay(); };
    img.src = el.dataUrl!;
  };

  useEffect(() => { void render(); }, [render, pages, current, pageOrder]);
  useEffect(() => { drawOverlay(); }, [drawOverlay]);
  useEffect(() => {
    const onResize = () => void render();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [render]);

  // ---------------------------------------------------------------- pointer → pdf coords
  const toPdfCoords = (clientX: number, clientY: number) => {
    const overlay = overlayCanvasRef.current!;
    const p = pagesRef.current[orderRef.current[currentRef.current]];
    const rect = overlay.getBoundingClientRect();
    const isRot = p.rotation % 180 !== 0;
    const lx = isRot ? p.height : p.width;
    const ly = isRot ? p.width : p.height;
    return {
      x: ((clientX - rect.left) / rect.width) * lx,
      y: ((clientY - rect.top) / rect.height) * ly,
    };
  };

  const hitTest = (x: number, y: number): El | null => {
    const p = pagesRef.current[orderRef.current[currentRef.current]];
    const overlay = overlayCanvasRef.current!;
    const octx = overlay.getContext('2d')!;
    for (let i = p.elements.length - 1; i >= 0; i--) {
      const el = p.elements[i];
      if (el.type === 'text') {
        const fs = el.fontSize || 14;
        const w = (overlay.width / p.width) * (el.content?.length || 1) * fs * 0.62;
        // simpler: box estimate
        const estW = (el.content?.length || 1) * fs * 0.62;
        const estH = fs * 1.3;
        if (x >= el.x - 4 && x <= el.x + estW + 4 && y >= el.y - 4 && y <= el.y + estH + 4) return el;
      } else {
        if (x >= el.x && x <= el.x + el.w && y >= el.y && y <= el.y + el.h) return el;
      }
    }
    return null;
  };

  const onPointerDown = (e: React.PointerEvent) => {
    const { x, y } = toPdfCoords(e.clientX, e.clientY);
    (e.target as HTMLElement).setPointerCapture(e.pointerId);

    if (tool === 'select') {
      const hit = hitTest(x, y);
      setSelId(hit?.id ?? null);
      if (hit) dragRef.current = { mode: 'move', startX: x, startY: y, lastX: x, lastY: y, elId: hit.id };
      return;
    }
    if (tool === 'text') {
      setTextEntry({ x, y, value: '' });
      return;
    }
    if (tool === 'signature') {
      dragRef.current = { mode: 'draw', startX: x, startY: y, lastX: x, lastY: y, points: [{ x, y }] };
      return;
    }
    // rect / highlight / whiteout — drag to create
    dragRef.current = { mode: 'draw', startX: x, startY: y, lastX: x, lastY: y };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d.mode) return;
    const { x, y } = toPdfCoords(e.clientX, e.clientY);

    if (d.mode === 'move' && d.elId) {
      const dx = x - d.lastX, dy = y - d.lastY;
      d.lastX = x; d.lastY = y;
      setPages((ps) => ps.map((p, i) => i !== orderRef.current[currentRef.current] ? p : {
        ...p, elements: p.elements.map((el) => el.id === d.elId ? moveEl(el, dx, dy) : el),
      }));
    } else if (d.mode === 'draw' && tool === 'signature' && d.points) {
      d.points.push({ x, y });
      // live preview signature stroke via temp element
      setPages((ps) => {
        const ci = orderRef.current[currentRef.current];
        const p = ps[ci];
        const others = p.elements.filter((el) => el.id !== 'live-sig');
        const live: El = { id: 'live-sig', type: 'signature', x: 0, y: 0, w: 0, h: 0, points: d.points, color: strokeColor, strokeWidth };
        return ps.map((pp, i) => i !== ci ? pp : { ...pp, elements: [...others, live] });
      });
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d.mode) return;
    const { x, y } = toPdfCoords(e.clientX, e.clientY);

    if (d.mode === 'draw' && tool === 'signature') {
      setPages((ps) => ps.map((p, i) => {
        if (i !== orderRef.current[currentRef.current]) return p;
        const els = p.elements.filter((el) => el.id !== 'live-sig');
        if ((d.points?.length || 0) > 1) {
          const xs = d.points!.map((pt) => pt.x), ys = d.points!.map((pt) => pt.y);
          els.push({
            id: uid(), type: 'signature',
            x: Math.min(...xs), y: Math.min(...ys),
            w: Math.max(...xs) - Math.min(...xs) || 1, h: Math.max(...ys) - Math.min(...ys) || 1,
            points: d.points, color: strokeColor, strokeWidth,
          });
        }
        return { ...p, elements: els };
      }));
      snapshot();
    } else if (d.mode === 'draw' && ['rect', 'highlight', 'whiteout'].includes(tool)) {
      const ex = Math.min(d.startX, x), ey = Math.min(d.startY, y);
      const ew = Math.abs(x - d.startX), eh = Math.abs(y - d.startY);
      if (ew > 4 && eh > 4) {
        const el: El = {
          id: uid(), type: tool as El['type'], x: ex, y: ey, w: ew, h: eh,
          color: tool === 'highlight' ? fillColor : tool === 'rect' ? strokeColor : '#ffffff',
          strokeWidth,
        };
        setPages((ps) => ps.map((p, i) => i !== orderRef.current[currentRef.current] ? p : { ...p, elements: [...p.elements, el] }));
        setSelId(el.id);
        snapshot();
      }
    }
    dragRef.current = { mode: null, startX: 0, startY: 0, lastX: 0, lastY: 0 };
  };

  const moveEl = (el: El, dx: number, dy: number): El => {
    if (el.type === 'signature' && el.points) {
      return { ...el, x: el.x + dx, y: el.y + dy, points: el.points.map((p) => ({ x: p.x + dx, y: p.y + dy })) };
    }
    return { ...el, x: el.x + dx, y: el.y + dy };
  };

  // ---------------------------------------------------------------- element ops
  const commitTextEntry = useCallback(() => {
    if (!textEntry?.value.trim()) { setTextEntry(null); return; }
    const el: El = {
      id: uid(), type: 'text', x: textEntry.x, y: textEntry.y, w: 0, h: 0,
      content: textEntry.value.trim(),
      fontSize: textStyle.size, color: textStyle.color, bold: textStyle.bold, italic: textStyle.italic,
    };
    setPages((ps) => ps.map((p, i) => i !== orderRef.current[currentRef.current] ? p : { ...p, elements: [...p.elements, el] }));
    setSelId(el.id); setTextEntry(null); snapshot();
  }, [textEntry, textStyle, snapshot]);

  const deleteElement = useCallback((id: string) => {
    setPages((ps) => ps.map((p, i) => i !== orderRef.current[currentRef.current] ? p : { ...p, elements: p.elements.filter((el) => el.id !== id) }));
    setSelId(null); snapshot();
  }, [snapshot]);

  const updateTextElement = useCallback((id: string, patch: Partial<El>) => {
    setPages((ps) => ps.map((p, i) => i !== orderRef.current[currentRef.current] ? p : {
      ...p, elements: p.elements.map((el) => el.id === id ? { ...el, ...patch } : el),
    }));
  }, []);

  const addImageElement = useCallback(async (files: File[]) => {
    const f = files[0];
    if (!f.type.startsWith('image/')) return;
    try {
      const url = URL.createObjectURL(f);
      const img = await loadImage(url);
      const p = pages[pageOrder[current]];
      const maxW = Math.min(240, p.width * 0.4);
      const scale = Math.min(1, maxW / img.width);
      const dataUrl = await new Promise<string>((res) => {
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * scale * 2); c.height = Math.round(img.height * scale * 2);
        c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
        res(c.toDataURL('image/png'));
      });
      const el: El = {
        id: uid(), type: 'image',
        x: p.width / 2 - (img.width * scale) / 2, y: p.height / 2 - (img.height * scale) / 2,
        w: img.width * scale, h: img.height * scale, dataUrl,
      };
      setPages((ps) => ps.map((pp, i) => i !== pageOrder[current] ? pp : { ...pp, elements: [...pp.elements, el] }));
      setSelId(el.id); snapshot();
      URL.revokeObjectURL(url);
      toast('Image placed. Drag it to position.', 'success');
    } catch { setError('Could not place that image.'); }
  }, [pages, pageOrder, current, snapshot, toast]);

  // ---------------------------------------------------------------- page ops
  const rotatePage = useCallback((deg: number) => {
    setPages((ps) => ps.map((p, i) => i !== pageOrder[current] ? p : { ...p, rotation: (p.rotation + deg + 360) % 360 }));
    snapshot();
  }, [pageOrder, current, snapshot]);

  const deletePage = useCallback(() => {
    if (pageOrder.length <= 1) { toast('A PDF needs at least one page.', 'error'); return; }
    setPageOrder((o) => o.filter((_, i) => i !== current));
    setCurrent((c) => Math.max(0, c - (current >= pageOrder.length - 1 ? 1 : 0)));
    snapshot();
  }, [pageOrder.length, current, snapshot, toast]);

  const addPage = useCallback(() => {
    const ref = pages[pageOrder[current]];
    const np: PageState = { rotation: 0, elements: [], width: ref?.width || 612, height: ref?.height || 792, blank: true };
    setPages((ps) => [...ps, np]);
    const idx = pages.length;
    setPageOrder((o) => { const next = [...o]; next.splice(current + 1, 0, idx); return next; });
    setCurrent((c) => c + 1);
    snapshot();
    toast('Blank page added.', 'success');
  }, [pages, pageOrder, current, snapshot, toast]);

  const movePage = useCallback((dir: -1 | 1) => {
    const t = current + dir;
    if (t < 0 || t >= pageOrder.length) return;
    setPageOrder((o) => { const next = [...o]; [next[current], next[t]] = [next[t], next[current]]; return next; });
    setCurrent(t);
    snapshot();
  }, [current, pageOrder.length, snapshot]);

  // ---------------------------------------------------------------- export
  const exportPdf = useCallback(async () => {
    if (!bytesRef.current || !pages.length) return;
    setBusy(true); setExported(null);
    setProgress({ stage: 'Preparing document…', progress: 10 });
    try {
      const srcDoc = await PDFDocument.load(bytesRef.current);
      const out = await PDFDocument.create();
      const helv = await out.embedFont(StandardFonts.Helvetica);
      const helvBold = await out.embedFont(StandardFonts.HelveticaBold);
      const helvObl = await out.embedFont(StandardFonts.HelveticaOblique);
      const helvBoldObl = await out.embedFont(StandardFonts.HelveticaBoldOblique);

      const copied = await out.copyPages(srcDoc, srcDoc.getPageIndices());

      for (let oi = 0; oi < pageOrder.length; oi++) {
        const srcIdx = pageOrder[oi];
        const state = pages[srcIdx];
        setProgress({ stage: `Composing page ${oi + 1}/${pageOrder.length}…`, progress: 10 + (oi / pageOrder.length) * 75 });
        let page;
        if (state.blank) {
          page = out.addPage([state.width, state.height]);
        } else {
          page = out.addPage(copied[srcIdx]);
        }
        // rotation
        const existing = page.getRotation().angle;
        page.setRotation(degrees((existing + state.rotation) % 360));

        const isRot = state.rotation % 180 !== 0;
        const w = state.width, h = state.height;
        const size = page.getSize();
        // map top-left coords → pdf bottom-left, accounting for effective rotation
        const map = (x: number, y: number): { x: number; y: number } => {
          const r = (((360 - state.rotation) % 360) + 360) % 360;
          // point before extra rotation
          let px = x, py = h - y;
          if (r === 90) { const t = px; px = py; py = w - t; }
          else if (r === 180) { px = w - px; py = h - py; }
          else if (r === 270) { const t = px; px = h - py; py = t; }
          return { x: px, y: py };
        };
        const hex = (c?: string, fallback = '#000000') => {
          const v = (c || fallback).replace('#', '');
          const n = parseInt(v.length === 3 ? v.split('').map((ch) => ch + ch).join('') : v.padEnd(6, '0'), 16);
          return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
        };

        for (const el of state.elements) {
          if (el.type === 'text' && el.content) {
            const font = el.bold && el.italic ? helvBoldObl : el.bold ? helvBold : el.italic ? helvObl : helv;
            const fs = el.fontSize || 14;
            const base = map(el.x, el.y + fs * 0.85);
            page.drawText(el.content, {
              x: base.x, y: Math.max(0, Math.min(size.height - fs, base.y - (isRot ? 0 : 0))),
              size: fs, font, color: hex(el.color, '#111111'),
            });
          } else if (el.type === 'image' && el.dataUrl) {
            try {
              const dims = mapDims(el.x, el.y, el.w, el.h);
              const png = el.dataUrl.startsWith('data:image/png')
                ? await out.embedPng(el.dataUrl)
                : await out.embedJpg(el.dataUrl);
              const pt = map(el.x, el.y + el.h);
              page.drawImage(png, { x: pt.x, y: pt.y - (isRot ? 0 : 0), width: el.w, height: el.h });
            } catch { /* skip broken image */ }
          } else if (el.type === 'signature' && el.points && el.points.length > 1) {
            const pts = el.points.map((pt) => map(pt.x, pt.y));
            const col = hex(el.color, '#1d4ed8');
            for (let i = 1; i < pts.length; i++) {
              page.drawLine({
                start: { x: pts[i - 1].x, y: pts[i - 1].y },
                end: { x: pts[i].x, y: pts[i].y },
                thickness: el.strokeWidth || 2, color: col,
              });
            }
          } else if (el.type === 'highlight') {
            const pt = map(el.x, el.y + el.h);
            page.drawRectangle({ x: pt.x, y: pt.y, width: el.w, height: el.h, color: hex(el.color, '#fde047'), opacity: 0.45 });
          } else if (el.type === 'whiteout') {
            const pt = map(el.x, el.y + el.h);
            page.drawRectangle({ x: pt.x, y: pt.y, width: el.w, height: el.h, color: rgb(1, 1, 1) });
          } else if (el.type === 'rect') {
            const pt = map(el.x, el.y + el.h);
            page.drawRectangle({
              x: pt.x, y: pt.y, width: el.w, height: el.h,
              borderColor: hex(el.color, '#e11d48'), borderWidth: el.strokeWidth || 2,
            });
          }
        }
      }

      setProgress({ stage: 'Saving PDF…', progress: 90 });
      const bytes = await out.save();
      const blob = new Blob([bytes.slice().buffer as ArrayBuffer], { type: 'application/pdf' });
      setExported({ blob, size: blob.size });
      setBusy(false); setProgress(null);
      toast('PDF exported with all your edits.', 'success');
    } catch (err) {
      console.error(err);
      setBusy(false); setProgress(null);
      setError('Export failed. Try removing recently added images and export again.');
    }
    // helpers
    function mapDims(x: number, y: number, w: number, h: number) { return { x, y, w, h }; }
  }, [pages, pageOrder, toast]);

  const reset = useCallback(() => {
    setFile(null); setPages([]); setPageOrder([]); setCurrent(0);
    pdfRef.current = null; bytesRef.current = null;
    historyRef.current = []; histIdxRef.current = -1; setHistCan({ undo: false, redo: false });
    setSelId(null); setTextEntry(null); setExported(null); setError(null); setProgress(null); setBusy(false);
    imgCacheRef.current.clear();
  }, []);

  // ---------------------------------------------------------------- UI
  const selectedEl = currentPage?.elements.find((el) => el.id === selId);

  const toolBtn = (t: Tool, Icon: typeof Type, label: string) => (
    <button
      key={t}
      onClick={() => { setTool(t); setSelId(null); setTextEntry(null); }}
      aria-label={label}
      title={label}
      className={cn(
        'flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-xs font-semibold transition-colors',
        tool === t ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground'
      )}
    >
      <Icon className="h-4 w-4" /> {label}
    </button>
  );

  const controls = !file ? (
    <UploadZone accept="application/pdf" onFiles={onFiles} onError={setError} maxSizeMB={100} label="Drag & drop a PDF or tap to upload" />
  ) : (
    <>
      <FilePill pdf name={file.name} size={file.size} meta={`${pageOrder.length} pages`} onReplace={reset} />
      {error && <ErrorNotice message={error} />}
      {progress && <ProgressView stage={progress.stage} progress={progress.progress} />}

      <Panel title="Annotation tools">
        <div className="grid grid-cols-2 gap-1">
          {toolBtn('select', MousePointer2, 'Select')}
          {toolBtn('text', Type, 'Text')}
          {toolBtn('image', ImageIcon, 'Image')}
          {toolBtn('signature', PenTool, 'Sign')}
          {toolBtn('highlight', Highlighter, 'Highlight')}
          {toolBtn('whiteout', Eraser, 'Whiteout')}
          {toolBtn('rect', Square, 'Rectangle')}
        </div>

        {tool === 'text' && (
          <div className="mt-3 space-y-2 border-t border-border pt-3">
            <div className="flex items-center gap-2">
              <label className="w-10 text-xs text-muted-foreground">Size</label>
              <input type="range" min={8} max={48} value={textStyle.size}
                onChange={(e) => setTextStyle((s) => ({ ...s, size: Number(e.target.value) }))} className="flex-1" aria-label="Font size" />
              <span className="w-8 text-right font-mono text-xs">{textStyle.size}</span>
              <input type="color" value={textStyle.color} aria-label="Text color"
                onChange={(e) => setTextStyle((s) => ({ ...s, color: e.target.value }))}
                className="h-8 w-10 cursor-pointer rounded border border-border bg-transparent" />
            </div>
            <div className="flex gap-1">
              <button onClick={() => setTextStyle((s) => ({ ...s, bold: !s.bold }))}
                className={cn('flex-1 rounded-lg border py-1.5 text-sm font-bold', textStyle.bold ? 'border-primary bg-primary/10 text-primary' : 'border-border')}>B</button>
              <button onClick={() => setTextStyle((s) => ({ ...s, italic: !s.italic }))}
                className={cn('flex-1 rounded-lg border py-1.5 text-sm italic', textStyle.italic ? 'border-primary bg-primary/10 text-primary' : 'border-border')}>I</button>
            </div>
            <p className="text-xs text-muted-foreground">Click on the page to place a text box.</p>
          </div>
        )}

        {tool === 'image' && (
          <div className="mt-3 border-t border-border pt-3">
            <UploadZone accept="image/*" compact onFiles={addImageElement} label="Upload image / logo" sublabel="Placed centred — drag to move" />
          </div>
        )}

        {(tool === 'rect' || tool === 'signature' || tool === 'highlight') && (
          <div className="mt-3 space-y-2 border-t border-border pt-3">
            {tool !== 'highlight' ? (
              <>
                <label className="text-xs font-medium text-muted-foreground">{tool === 'signature' ? 'Ink color' : 'Border color'}</label>
                <input type="color" value={strokeColor} onChange={(e) => setStrokeColor(e.target.value)} className="h-9 w-full cursor-pointer rounded-lg border border-border" aria-label="Stroke color" />
                <label className="text-xs font-medium text-muted-foreground">Width: {strokeWidth}px</label>
                <input type="range" min={1} max={8} value={strokeWidth} onChange={(e) => setStrokeWidth(Number(e.target.value))} className="w-full" aria-label="Stroke width" />
              </>
            ) : (
              <>
                <label className="text-xs font-medium text-muted-foreground">Highlight color</label>
                <div className="flex gap-2">
                  {['#fde047', '#86efac', '#7dd3fc', '#f9a8d4'].map((c) => (
                    <button key={c} onClick={() => setFillColor(c)} aria-label={`Highlight ${c}`}
                      className={cn('h-8 w-8 rounded-full border-2', fillColor === c ? 'border-foreground' : 'border-transparent')}
                      style={{ backgroundColor: c }} />
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {tool === 'select' && selectedEl && (
          <div className="mt-3 space-y-2 border-t border-border pt-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Selected: {selectedEl.type}</span>
              <button onClick={() => deleteElement(selectedEl.id)} className="flex items-center gap-1 rounded-lg bg-destructive/10 px-2 py-1 text-xs font-semibold text-destructive hover:bg-destructive/20">
                <Trash2 className="h-3.5 w-3.5" /> Delete
              </button>
            </div>
            {selectedEl.type === 'text' && (
              <>
                <input
                  value={selectedEl.content || ''}
                  onChange={(e) => updateTextElement(selectedEl.id, { content: e.target.value })}
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
                  aria-label="Text content"
                />
                <div className="flex items-center gap-2">
                  <input type="range" min={8} max={60} value={selectedEl.fontSize || 14}
                    onChange={(e) => updateTextElement(selectedEl.id, { fontSize: Number(e.target.value) })}
                    className="flex-1" aria-label="Font size" />
                  <span className="font-mono text-xs">{selectedEl.fontSize || 14}</span>
                  <input type="color" value={selectedEl.color || '#111111'}
                    onChange={(e) => updateTextElement(selectedEl.id, { color: e.target.value })}
                    className="h-8 w-10 cursor-pointer rounded border border-border" aria-label="Text color" />
                </div>
                <div className="flex gap-1">
                  <button onClick={() => updateTextElement(selectedEl.id, { bold: !selectedEl.bold })}
                    className={cn('flex-1 rounded-lg border py-1.5 text-sm font-bold', selectedEl.bold ? 'border-primary bg-primary/10 text-primary' : 'border-border')}>B</button>
                  <button onClick={() => updateTextElement(selectedEl.id, { italic: !selectedEl.italic })}
                    className={cn('flex-1 rounded-lg border py-1.5 text-sm italic', selectedEl.italic ? 'border-primary bg-primary/10 text-primary' : 'border-border')}>I</button>
                </div>
              </>
            )}
          </div>
        )}
      </Panel>

      <Panel title="Page tools">
        <div className="grid grid-cols-4 gap-1.5">
          <PageBtn label="Rotate ⟲" onClick={() => rotatePage(-90)} Icon={RotateCcw} />
          <PageBtn label="Rotate ⟳" onClick={() => rotatePage(90)} Icon={RotateCw} />
          <PageBtn label="Move ↑" onClick={() => movePage(-1)} Icon={ArrowUp} disabled={current === 0} />
          <PageBtn label="Move ↓" onClick={() => movePage(1)} Icon={ArrowDown} disabled={current >= pageOrder.length - 1} />
          <PageBtn label="Add" onClick={addPage} Icon={FilePlus} />
          <PageBtn label="Delete" onClick={deletePage} Icon={Trash2} danger />
          <PageBtn label="Zoom -" onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))} Icon={X} />

          <PageBtn label="Zoom +" onClick={() => setZoom((z) => Math.min(3, z + 0.25))} Icon={Check} />
        </div>
      </Panel>

      {exported ? (
        <div className="space-y-2">
          <SuccessNotice message={`PDF ready — ${(exported.size / 1024 / 1024).toFixed(2)} MB`} />
          <button onClick={() => downloadBlob(exported.blob, `edited-${Date.now()}.pdf`)}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-3 font-semibold text-primary-foreground transition hover:opacity-90 active:scale-[0.98]">
            <Download className="h-5 w-5" /> Download edited PDF
          </button>
        </div>
      ) : (
        <button onClick={exportPdf} disabled={busy || !pages.length}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-3 font-semibold text-primary-foreground transition hover:opacity-90 active:scale-[0.98] disabled:opacity-50">
          {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Download className="h-5 w-5" />}
          Export PDF
        </button>
      )}
    </>
  );

  // thumbnails rail
  const thumbnails = pages.length > 0 && (
    <div className="flex gap-2 overflow-x-auto pb-2" role="tablist" aria-label="Pages">
      {pageOrder.map((pi, i) => (
        <button
          key={`${pi}-${i}`}
          onClick={() => { setCurrent(i); setSelId(null); setTextEntry(null); }}
          aria-label={`Page ${i + 1}`}
          aria-current={i === current ? 'page' : undefined}
          className={cn(
            'flex h-20 w-14 shrink-0 flex-col items-center justify-center rounded-lg border text-xs font-semibold transition-colors',
            i === current ? 'border-primary bg-primary/10 text-primary' : 'border-border bg-card hover:bg-muted'
          )}
        >
          <FileText className="mb-0.5 h-5 w-5 opacity-60" />
          {i + 1}
        </button>
      ))}
      <button onClick={addPage} aria-label="Add page"
        className="flex h-20 w-14 shrink-0 items-center justify-center rounded-lg border border-dashed border-border text-muted-foreground hover:border-primary hover:text-primary">
        <FilePlus className="h-5 w-5" />
      </button>
    </div>
  );

  const preview = !file ? (
    <EmptyPreview icon={<FileText className="h-16 w-16" />} title="No PDF loaded" subtitle="Upload a PDF to annotate text, add signatures, highlight, whiteout, and rearrange pages." />
  ) : (
    <div className="space-y-3">
      {thumbnails}
      <div ref={wrapRef} className="relative overflow-auto rounded-xl border border-border bg-neutral-200 p-2 dark:bg-neutral-800">
        <div className="relative mx-auto w-fit shadow-lg">
          <canvas ref={baseCanvasRef} className="block bg-white" />
          <canvas
            ref={overlayCanvasRef}
            className={cn('absolute inset-0 touch-none', tool === 'select' ? 'cursor-default' : 'cursor-crosshair')}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
          />
          {textEntry && (
            <div
              className="absolute z-20 w-56 -translate-y-2 rounded-lg border border-border bg-card p-2 shadow-xl"
              style={{
                left: `${(textEntry.x / (currentPage?.width || 1)) * 100}%`,
                top: `${(textEntry.y / (currentPage?.height || 1)) * 100}%`,
              }}
            >
              <input
                autoFocus
                value={textEntry.value}
                onChange={(e) => setTextEntry({ ...textEntry, value: e.target.value })}
                onKeyDown={(e) => { if (e.key === 'Enter') commitTextEntry(); if (e.key === 'Escape') setTextEntry(null); }}
                placeholder="Type…"
                className="mb-2 w-full rounded border border-input bg-background px-2 py-1.5 text-sm outline-none focus:ring-1 focus:ring-primary"
              />
              <div className="flex gap-1">
                <button onClick={commitTextEntry} className="flex-1 rounded bg-primary py-1 text-xs font-semibold text-primary-foreground">Add</button>
                <button onClick={() => setTextEntry(null)} className="flex-1 rounded border border-border py-1 text-xs">Cancel</button>
              </div>
            </div>
          )}
        </div>
        {busy && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/60 backdrop-blur-sm">
            <Loader2 className="h-10 w-10 animate-spin text-primary" />
          </div>
        )}
      </div>
      <p className="text-center text-xs text-muted-foreground">
        Page {current + 1} / {pageOrder.length} · Zoom {Math.round(zoom * 100)}%
      </p>
    </div>
  );

  return (
    <ToolShell
      title="PDF Editor"
      description="Annotate PDFs in your browser: edit-style text boxes, images, signatures, highlights, shapes and whiteout — plus rotate, reorder, delete and add pages."
      canUndo={histCan.undo} canRedo={histCan.redo}
      onUndo={undo} onRedo={redo} onReset={reset}
      controls={controls} preview={preview}
    />
  );
}

function PageBtn({ label, onClick, Icon, disabled, danger }: {
  label: string; onClick: () => void; Icon: typeof Trash2; disabled?: boolean; danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className={cn(
        'flex flex-col items-center gap-1 rounded-lg border py-2 text-[10px] font-semibold transition-colors disabled:opacity-40',
        danger ? 'border-destructive/30 text-destructive hover:bg-destructive/10' : 'border-border hover:bg-muted'
      )}
    >
      <Icon className="h-4 w-4" />
      {label}
    </button>
  );
}
