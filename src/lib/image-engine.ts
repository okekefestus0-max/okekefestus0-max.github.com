/**
 * Self-contained image processing engine that runs inside a Web Worker context.
 * It must not reference DOM APIs other than ImageData — messages carry ImageData in/out.
 * This source is imported as raw text by both the enhancer and upscaler workers.
 *
 * Everything is plain JS (the worker is built via webpack's worker syntax so no DOM types leak in).
 */

export interface EnhanceParams {
  brightness: number;    // -1..1
  contrast: number;      // -1..1
  saturation: number;    // -1..1
  vibrance: number;      // -1..1
  exposure: number;      // -2..2 (stops)
  highlights: number;    // -1..1
  shadows: number;       // -1..1
  temperature: number;   // -100..100
  tint: number;          // -100..100
  sharpness: number;     // 0..1
  noiseReduction: number;// 0..1
  vignette: number;      // 0..1
  grain: number;         // 0..1
  grayscale: number;     // 0..1
  sepia: number;         // 0..1
  invert: number;        // 0..1
}

export const NEUTRAL_PARAMS: EnhanceParams = {
  brightness: 0, contrast: 0, saturation: 0, vibrance: 0, exposure: 0,
  highlights: 0, shadows: 0, temperature: 0, tint: 0, sharpness: 0,
  noiseReduction: 0, vignette: 0, grain: 0, grayscale: 0, sepia: 0, invert: 0,
};

/** Apply the whole adjustment set to ImageData in place (main-thread, used via requestAnimationFrame batching). */
export function applyEnhancements(imageData: ImageData, p: EnhanceParams): void {
  const data = imageData.data;
  const width = imageData.width;
  const height = imageData.height;

  const expF = Math.pow(2, p.exposure);
  const briF = p.brightness * 255;
  const conF = p.contrast >= 0
    ? 1 / (1 - Math.min(0.98, p.contrast))
    : 1 + p.contrast;

  // 1D LUT for exposure/brightness/contrast (fast path)
  const lut = new Uint8ClampedArray(256);
  for (let v = 0; v < 256; v++) {
    let nv = v * expF + briF;
    nv = (nv - 128) * conF + 128;
    lut[v] = nv;
  }

  const sat = p.saturation;
  const vib = p.vibrance;
  const temp = p.temperature;
  const tint = p.tint;
  const hi = p.highlights;
  const sh = p.shadows;
  const gray = p.grayscale;
  const sep = p.sepia;

  const w = width, h = height;
  const hw = w / 2, hh = h / 2;
  const maxDist = Math.sqrt(hw * hw + hh * hh);
  const vigAmount = p.vignette * 0.9;
  const noise = p.noiseReduction;
  const grain = p.grain * 30;

  const doSpatial = noise > 0.005 || p.sharpness > 0.005;

  // Pre-pass blur for noise reduction (simple 3x3 box into Float32 buffer)
  let blurred: Float32Array | null = null;
  if (noise > 0.005) {
    blurred = new Float32Array(data.length);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let r = 0, g = 0, b = 0, n = 0;
        for (let dy = -1; dy <= 1; dy++) {
          const yy = y + dy;
          if (yy < 0 || yy >= h) continue;
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx;
            if (xx < 0 || xx >= w) continue;
            const i = (yy * w + xx) * 4;
            r += data[i]; g += data[i + 1]; b += data[i + 2];
            n++;
          }
        }
        const o = (y * w + x) * 4;
        blurred[o] = r / n; blurred[o + 1] = g / n; blurred[o + 2] = b / n;
      }
    }
  }

  // Sharpness via unsharp mask on luminance (single pass, 3x3)
  const sharp = p.sharpness * 1.5;

  for (let y = 0; y < h; y++) {
    const rowOff = y * w;
    const dyRow = (y - hh) / hh;
    for (let x = 0; x < w; x++) {
      const i = (rowOff + x) * 4;
      let r = lut[data[i]];
      let g = lut[data[i + 1]];
      let b = lut[data[i + 2]];

      if (noise > 0.005 && blurred) {
        r += (blurred[i] - r) * noise;
        g += (blurred[i + 1] - g) * noise;
        b += (blurred[i + 2] - b) * noise;
      }

      let luma = 0.299 * r + 0.587 * g + 0.114 * b;

      if (doSpatial && sharp > 0 && x > 0 && y > 0 && x < w - 1 && y < h - 1) {
        const nL = ((0.299 * data[i - w * 4] + 0.587 * data[i - w * 4 + 1] + 0.114 * data[i - w * 4 + 2])
          + (0.299 * data[i + w * 4] + 0.587 * data[i + w * 4 + 1] + 0.114 * data[i + w * 4 + 2])
          + (0.299 * data[i - 4] + 0.587 * data[i - 3] + 0.114 * data[i - 2])
          + (0.299 * data[i + 4] + 0.587 * data[i + 5] + 0.114 * data[i + 6])) / 4;
        const detail = luma - nL;
        const boost = detail * sharp;
        r += boost; g += boost; b += boost;
        luma += boost;
      }

      if (temp !== 0) { r += temp * 0.6; b -= temp * 0.6; }
      if (tint !== 0) g += tint * 0.5;

      if (hi !== 0 && luma > 170) {
        const f = ((luma - 170) / 85) * hi * 60;
        r += f; g += f; b += f;
      }
      if (sh !== 0 && luma < 85) {
        const f = ((85 - luma) / 85) * sh * 60;
        r += f; g += f; b += f;
      }

      if (sat !== 0 || vib !== 0) {
        luma = 0.299 * r + 0.587 * g + 0.114 * b;
        const s = sat + vib * (1 - Math.abs(luma / 255 - 0.5) * 2);
        if (s !== 0) {
          r = luma + (r - luma) * (1 + s);
          g = luma + (g - luma) * (1 + s);
          b = luma + (b - luma) * (1 + s);
        }
      }

      if (sep > 0) {
        const sr = 0.393 * r + 0.769 * g + 0.189 * b;
        const sg = 0.349 * r + 0.686 * g + 0.168 * b;
        const sb = 0.272 * r + 0.534 * g + 0.131 * b;
        r += (sr - r) * sep; g += (sg - g) * sep; b += (sb - b) * sep;
      }
      if (gray > 0) {
        const l = 0.299 * r + 0.587 * g + 0.114 * b;
        r += (l - r) * gray; g += (l - g) * gray; b += (l - b) * gray;
      }

      if (vigAmount > 0) {
        const dx = (x - hw) / hw;
        const d = Math.sqrt(dx * dx + dyRow * dyRow) / maxDist * Math.SQRT2;
        const f = Math.max(0, d - 0.45) * vigAmount * 2;
        r *= 1 - f; g *= 1 - f; b *= 1 - f;
      }

      if (grain > 0) {
        const gnoise = (Math.random() - 0.5) * grain;
        r += gnoise; g += gnoise; b += gnoise;
      }

      data[i] = r; data[i + 1] = g; data[i + 2] = b;
    }
  }
}

/** Multi-step high-quality resampling (down by steps of 0.5, then final stretch) used by upscaler/resize. */
export function resampleCanvas(src: HTMLCanvasElement, targetW: number, targetH: number): HTMLCanvasElement {
  let current = src;
  let cw = src.width;
  let ch = src.height;

  // Upscale path: iterative 2x with smoothing until close, then exact
  while (cw * 2 <= targetW || ch * 2 <= targetH) {
    const next = document.createElement('canvas');
    next.width = Math.min(targetW, cw * 2);
    next.height = Math.min(targetH, ch * 2);
    const ctx = next.getContext('2d')!;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(current, 0, 0, next.width, next.height);
    current = next; cw = next.width; ch = next.height;
  }
  // Downscale path: halve until close
  while (cw / 2 >= targetW && ch / 2 >= targetH) {
    const next = document.createElement('canvas');
    next.width = Math.max(targetW, Math.floor(cw / 2));
    next.height = Math.max(targetH, Math.floor(ch / 2));
    const ctx = next.getContext('2d')!;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(current, 0, 0, next.width, next.height);
    current = next; cw = next.width; ch = next.height;
  }

  const final = document.createElement('canvas');
  final.width = targetW;
  final.height = targetH;
  const ctx = final.getContext('2d')!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(current, 0, 0, targetW, targetH);
  return final;
}

/** Unsharp mask used after upscaling for perceived AI-detail boost. */
export function unsharpMask(imageData: ImageData, amount: number, radius = 1): void {
  const { width: w, height: h, data } = imageData;
  const src = new Uint8ClampedArray(data);
  const r = Math.max(1, Math.min(3, Math.floor(radius)));
  for (let y = r; y < h - r; y++) {
    for (let x = r; x < w - r; x++) {
      const i = (y * w + x) * 4;
      for (let c = 0; c < 3; c++) {
        const blur = (
          src[((y - r) * w + x) * 4 + c] + src[((y + r) * w + x) * 4 + c] +
          src[(y * w + x - r) * 4 + c] + src[(y * w + x + r) * 4 + c]
        ) / 4;
        data[i + c] = src[i + c] + (src[i + c] - blur) * amount;
      }
    }
  }
}
