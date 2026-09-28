import {
  Eraser, ZoomIn, SlidersHorizontal, FileMinus, FileType, Crop, Stamp,
  PenTool, Combine, Split, ImagePlus, Images, ScanText, QrCode,
  Video, Mic, FileArchive, type LucideIcon,
} from 'lucide-react';
import { ToolConfig, CategoryId } from '@/types';

/**
 * TOOL REGISTRY
 * -------------
 * Adding a new tool:
 *  1. Create a folder: src/app/tools/<your-tool-id>/page.tsx (render <ToolShell ...>)
 *  2. Add one entry below — done. The dashboard, sidebar and search pick it up automatically.
 */
export const tools: ToolConfig[] = [
  // ---------------- IMAGE ----------------
  { id: 'background-remover', name: 'Background Remover', icon: Eraser, category: 'image', route: '/tools/background-remover', badge: 'AI',
    description: 'Remove backgrounds on-device, refine with a brush, add color/gradient/custom backdrops.' },
  { id: 'image-upscaler', name: 'Image Upscaler', icon: ZoomIn, category: 'image', route: '/tools/image-upscaler', badge: 'AI',
    description: 'Upscale 2x–4x entirely in the browser with photo, illustration and face modes.' },
  { id: 'photo-enhancer', name: 'Photo Enhancer', icon: SlidersHorizontal, category: 'image', route: '/tools/photo-enhancer',
    description: '12 pro sliders, auto-enhance, cinematic presets and color grading. Save your own presets.' },
  { id: 'image-compressor', name: 'Image Compressor', icon: FileMinus, category: 'image', route: '/tools/image-compressor',
    description: 'Shrink JPG/PNG/WebP file size with a live quality slider and size comparison.' },
  { id: 'image-converter', name: 'Image Converter', icon: FileType, category: 'image', route: '/tools/image-converter',
    description: 'Convert between JPG, PNG and WebP — HEIC photos from your phone supported too.' },
  { id: 'resize-crop', name: 'Resize & Crop', icon: Crop, category: 'image', route: '/tools/resize-crop',
    description: 'Instagram, WhatsApp, YouTube thumbnail and passport photo presets with live crop.' },
  { id: 'watermark-image', name: 'Image Watermark', icon: Stamp, category: 'image', route: '/tools/watermark-image',
    description: 'Stamp text or logo watermarks onto images with tiling, opacity and placement controls.' },

  // ---------------- PDF ----------------
  { id: 'pdf-editor', name: 'PDF Editor', icon: PenTool, category: 'pdf', route: '/tools/pdf-editor', badge: 'BETA',
    description: 'Add text, images, signatures, highlights, shapes and whiteout. Reorder, rotate, delete pages.' },
  { id: 'merge-pdf', name: 'Merge PDFs', icon: Combine, category: 'pdf', route: '/tools/merge-pdf',
    description: 'Combine multiple PDF documents into one file, in the order you choose.' },
  { id: 'split-pdf', name: 'Split PDF', icon: Split, category: 'pdf', route: '/tools/split-pdf',
    description: 'Extract a page range or split a PDF into individual pages.' },
  { id: 'compress-pdf', name: 'Compress PDF', icon: FileMinus, category: 'pdf', route: '/tools/compress-pdf',
    description: 'Reduce PDF size by re-encoding page images at a quality you pick.' },
  { id: 'images-to-pdf', name: 'Images to PDF', icon: ImagePlus, category: 'pdf', route: '/tools/images-to-pdf',
    description: 'Turn JPG/PNG/WebP photos into a single, ordered PDF document.' },
  { id: 'pdf-to-images', name: 'PDF to Images', icon: Images, category: 'pdf', route: '/tools/pdf-to-images',
    description: 'Export every page of a PDF as high-resolution PNG images.' },
  { id: 'watermark-pdf', name: 'PDF Watermark', icon: Stamp, category: 'pdf', route: '/tools/watermark-pdf',
    description: 'Overlay text like CONFIDENTIAL or DRAFT across every page of a PDF.' },

  // ---------------- MORE ----------------
  { id: 'ocr', name: 'OCR — Extract Text', icon: ScanText, category: 'more', route: '/tools/ocr',
    description: 'Pull text out of images and scanned PDFs with on-device OCR (Tesseract.js).' },
  { id: 'qr-generator', name: 'QR Code Generator', icon: QrCode, category: 'more', route: '/tools/qr-generator',
    description: 'Create QR codes for links, text, Wi-Fi and contacts with custom colors.' },

  // Coming soon placeholders — shown on the dashboard, no page needed
  { id: 'video-compressor', name: 'Video Compressor', icon: Video, category: 'more', route: '/tools/new', comingSoon: true,
    description: 'Trim and compress video files in the browser with FFmpeg WASM.' },
  { id: 'audio-tools', name: 'Audio Toolkit', icon: Mic, category: 'more', route: '/tools/new', comingSoon: true,
    description: 'Convert, trim and normalize audio files fully offline.' },
  { id: 'archive-tools', name: 'ZIP & Archive', icon: FileArchive, category: 'more', route: '/tools/new', comingSoon: true,
    description: 'Create and extract ZIP archives without uploading files.' },
];

export const categories: { id: CategoryId; name: string }[] = [
  { id: 'image', name: 'Image', },
  { id: 'pdf', name: 'PDF' },
  { id: 'more', name: 'More Tools' },
];

export const getToolsByCategory = (cat: CategoryId) => tools.filter((t) => t.category === cat);
export const getToolById = (id: string) => tools.find((t) => t.id === id);
export const searchTools = (q: string) => {
  const s = q.trim().toLowerCase();
  if (!s) return tools;
  return tools.filter((t) =>
    t.name.toLowerCase().includes(s) || t.description.toLowerCase().includes(s) || t.id.includes(s)
  );
};

export type { LucideIcon };
