# 🧰 ToolBox Studio

An **all-in-one image & PDF toolkit** that runs **100% in your browser** — no uploads, no login, no server processing. Installable as a PWA on phone or desktop and works offline.

![Tech](https://img.shields.io/badge/Next.js-14-black) ![TypeScript](https://img.shields.io/badge/TypeScript-5-blue) ![PWA](https://img.shields.io/badge/PWA-offline-green)

---

## ✨ Tools included

| Category | Tool | What it does |
|---|---|---|
| 🖼️ Image | **Background Remover** | On-device segmentation, restore/erase brush, feathering, transparent / solid / gradient / photo background, PNG·JPG·WebP export |
| 🖼️ Image | **Image Upscaler** | 2×/4× enhancement with Photo / Illustration / Face profiles and a before-after slider |
| 🖼️ Image | **Photo Enhancer** | 12 sliders (exposure → vignette), auto-enhance, 7 presets with strength, save your own presets |
| 🖼️ Image | **Image Compressor** | Live quality slider with original-vs-compressed size comparison |
| 🖼️ Image | **Image Converter** | JPG ↔ PNG ↔ WebP, plus HEIC (iPhone photo) decoding |
| 🖼️ Image | **Resize & Crop** | Instagram, WhatsApp DP, YouTube, passport presets; drag-to-reframe |
| 🖼️ Image | **Image Watermark** | Text or logo watermark with tiling, opacity, placement, rotation |
| 📄 PDF | **PDF Editor** | Text boxes, images, signatures, highlights, rectangles, whiteout + rotate/reorder/delete/add pages (pdf.js + pdf-lib) |
| 📄 PDF | **Merge / Split / Compress PDF** | Combine, carve page ranges, shrink with quality + DPI controls |
| 📄 PDF | **Images ↔ PDF** | Photos → ordered PDF; PDF pages → PNG at up to 300 DPI |
| 📄 PDF | **PDF Watermark** | CONFIDENTIAL / DRAFT style stamps, tiled or centered |
| 🔧 More | **OCR** | Extract text from images & scanned PDFs (Tesseract.js, 12 languages) |
| 🔧 More | **QR Generator** | URL / text / Wi-Fi / email / phone QR codes, custom colors, PNG + SVG |

**Privacy:** every operation happens locally via Canvas 2D, Web Workers and WebAssembly. Files never leave the device.

---

## 🚀 Getting started

### Prerequisites
- Node.js 18.17+ (or 20+)

### Install & run

```bash
npm install        # also copies pdf.worker.min.js into /public (postinstall)
npm run dev        # → http://localhost:3000
```

### Production build

```bash
npm run build
npm start
```

### Quality gates

```bash
npm run typecheck  # tsc --noEmit
npm run lint
```

---

## 📦 Deploy

**Vercel (recommended):**

```bash
npm i -g vercel
vercel
```

The repo also works on **Netlify** (`next build` + `.next` publish via the Next runtime) or any Node host:

```bash
npm ci && npm run build && npm start
```

No environment variables or server routes are required — the app is a static-feeling Next.js app with all processing client-side.

---

## 📱 PWA

- `public/manifest.webmanifest` + generated 192/512 app icons (incl. maskable)
- `public/sw.js` service worker: app-shell + runtime caching for offline use
- Install prompt banner appears automatically on supported browsers (Chrome/Edge/Android; iOS installs via “Add to Home Screen”)

---

## 🧱 Architecture

```
src/
├── app/
│   ├── page.tsx                 # Dashboard: search + category tabs + tool cards
│   ├── layout.tsx / providers/  # Root layout, theme + toast providers
│   └── tools/<tool-id>/page.tsx # One folder per tool
├── components/
│   └── tool/
│       ├── ToolShell.tsx        # App frame (sidebar/bottom tabs) + tool workspace
│       └── shared.tsx           # UploadZone, ProgressView, DownloadBar,
│                                #   BeforeAfterSlider, FilePill, notices…
├── lib/
│   ├── utils.ts                 # file→image, canvas→blob, worker factory…
│   └── image-engine.ts          # pixel filters, resampling, unsharp mask
├── registry/
│   └── tools.ts                 # ⭐ THE TOOL REGISTRY (see below)
└── types/
```

### Adding a new tool (2 steps)

1. Create `src/app/tools/<your-tool-id>/page.tsx` rendering `<ToolShell title="…" controls={…} preview={…} />`. Reuse `UploadZone`, `ProgressView`, `DownloadBar`, `BeforeAfterSlider` from `@/components/tool/shared`.
2. Add one entry to `src/registry/tools.ts`:

```ts
{ id: 'my-tool', name: 'My Tool', icon: Wand2, category: 'image',
  route: '/tools/my-tool', description: 'What it does.' }
```

The dashboard, search, category pills and side navigation pick it up automatically. Set `comingSoon: true` to publish a disabled placeholder card.

---

## ⚙️ Performance notes

- Segmentation for Background Remover runs in a **Web Worker** with transferable buffers so the UI never freezes.
- Heavy edits are chunked (`setTimeout` yields) and images are capped (e.g. 2000–3200 px working size) so phones stay responsive — the cap is shown to the user in a toast.
- `pdfjs-dist` and `tesseract.js` load on demand (dynamic import), keeping first-load JS around ~110–120 kB per page.
- OCR language data downloads once from CDN, then works offline.

## ♿ Accessibility

Keyboard navigable upload zones, `role`/`aria` states on tabs/sliders/progress, labelled controls, and 44px touch targets on mobile.

## License

MIT.
