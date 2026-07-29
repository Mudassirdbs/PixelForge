import { baseName, extOf } from "./convert";

const MAX_CANVAS_PIXELS = 24_000_000;

function assertCanvasSafe(width: number, height: number, action: string) {
  if (width * height <= MAX_CANVAS_PIXELS) return;
  const megapixels = Math.round((width * height) / 1_000_000);
  throw new Error(
    `This ${megapixels}MP image is too large for browser-safe ${action}. Resize it first or choose a smaller file.`,
  );
}

function get2d(canvas: HTMLCanvasElement) {
  const ctx = (canvas.getContext("2d", { colorSpace: "srgb" }) || canvas.getContext("2d")) as CanvasRenderingContext2D | null;
  if (!ctx) throw new Error("Canvas is not available in this browser.");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  return ctx;
}

async function loadHtmlImage(file: File): Promise<HTMLImageElement> {
  const ext = extOf(file.name);
  let source: Blob = file;
  if (ext === "heic" || ext === "heif") {
    const { heicTo } = await import("heic-to");
    source = await heicTo({ blob: file, type: "image/png", quality: 1 });
  } else if (ext === "tif" || ext === "tiff") {
    const UTIF: any = await import("utif" as any);
    const buf = await file.arrayBuffer();
    const ifds = UTIF.decode(buf);
    if (!ifds || !ifds.length) throw new Error("TIFF file is empty or unreadable.");
    UTIF.decodeImage(buf, ifds[0]);
    const rgba = UTIF.toRGBA8(ifds[0]);
    assertCanvasSafe(ifds[0].width, ifds[0].height, "TIFF decoding");
    const canvas = document.createElement("canvas");
    canvas.width = ifds[0].width;
    canvas.height = ifds[0].height;
    const ctx = get2d(canvas);
    const imgData = ctx.createImageData(canvas.width, canvas.height);
    imgData.data.set(rgba);
    ctx.putImageData(imgData, 0, 0);
    source = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("TIFF decode failed"))), "image/png"),
    );
  }
  const url = URL.createObjectURL(source);
  try {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    await img.decode();
    return img;
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }
}

function toBlob(canvas: HTMLCanvasElement, mime: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => {
        if (!b) return reject(new Error(`Encoder failed for ${mime}`));
        if (mime !== "image/png" && b.type !== mime) {
          return reject(new Error(
            `Your browser can't encode ${mime.split("/")[1].toUpperCase()}. Try WEBP or PNG.`,
          ));
        }
        resolve(b);
      },
      mime,
      quality,
    );
  });
}

export type CompressFormat = "webp" | "jpg" | "avif" | "auto";

export interface CompressOptions {
  targetKB: number;      // desired max size
  format: CompressFormat;
  maxDimension?: number; // optional resize cap
}

// Binary-search quality to hit target size.
export async function compressImage(
  file: File,
  opts: CompressOptions,
): Promise<{ blob: Blob; filename: string; mime: string }> {
  const img = await loadHtmlImage(file);
  const nw = img.naturalWidth || img.width;
  const nh = img.naturalHeight || img.height;
  const cap = opts.maxDimension && opts.maxDimension > 0 ? opts.maxDimension : Infinity;
  const scale = Math.min(1, cap / Math.max(nw, nh));
  const w = Math.max(1, Math.round(nw * scale));
  const h = Math.max(1, Math.round(nh * scale));
  assertCanvasSafe(w, h, "compression");

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = get2d(canvas);
  const isJpg = opts.format === "jpg" || (opts.format === "auto" && /jpe?g/i.test(extOf(file.name)));
  if (isJpg) {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, h);
  }
  ctx.drawImage(img, 0, 0, w, h);

  const mime =
    opts.format === "jpg" ? "image/jpeg" :
    opts.format === "avif" ? "image/avif" :
    opts.format === "webp" ? "image/webp" :
    (isJpg ? "image/jpeg" : "image/webp");
  const ext = mime === "image/jpeg" ? "jpg" : mime === "image/avif" ? "avif" : "webp";

  const targetBytes = opts.targetKB * 1024;
  let lo = 0.3, hi = 0.95, best: Blob | null = null;
  for (let i = 0; i < 7; i++) {
    const q = (lo + hi) / 2;
    const b = await toBlob(canvas, mime, q);
    if (b.size <= targetBytes) {
      best = b;
      lo = q; // try higher quality
    } else {
      hi = q;
    }
  }
  if (!best) best = await toBlob(canvas, mime, 0.3);
  return { blob: best, filename: `${baseName(file.name)}-min.${ext}`, mime };
}

export type ResizeMode = "fit" | "cover" | "exact" | "scale";
export interface ResizeOptions {
  mode: ResizeMode;
  width?: number;
  height?: number;
  percent?: number;
  format: "png" | "jpg" | "webp";
}

export async function resizeImage(
  file: File,
  opts: ResizeOptions,
): Promise<{ blob: Blob; filename: string; mime: string }> {
  const img = await loadHtmlImage(file);
  const nw = img.naturalWidth || img.width;
  const nh = img.naturalHeight || img.height;

  let tw = nw, th = nh;
  if (opts.mode === "scale") {
    const p = Math.max(1, opts.percent ?? 100) / 100;
    tw = Math.round(nw * p); th = Math.round(nh * p);
  } else if (opts.mode === "exact") {
    tw = Math.max(1, opts.width || nw);
    th = Math.max(1, opts.height || nh);
  } else if (opts.mode === "fit") {
    const w = Math.max(1, opts.width || nw), h = Math.max(1, opts.height || nh);
    const s = Math.min(w / nw, h / nh);
    tw = Math.max(1, Math.round(nw * s));
    th = Math.max(1, Math.round(nh * s));
  } else {
    // cover
    tw = Math.max(1, opts.width || nw);
    th = Math.max(1, opts.height || nh);
  }

  const canvas = document.createElement("canvas");
  assertCanvasSafe(tw, th, "resizing");
  canvas.width = tw; canvas.height = th;
  const ctx = get2d(canvas);
  const mime = opts.format === "png" ? "image/png" : opts.format === "jpg" ? "image/jpeg" : "image/webp";
  if (opts.format === "jpg") { ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, tw, th); }

  if (opts.mode === "cover") {
    const s = Math.max(tw / nw, th / nh);
    const dw = nw * s, dh = nh * s;
    ctx.drawImage(img, (tw - dw) / 2, (th - dh) / 2, dw, dh);
  } else {
    ctx.drawImage(img, 0, 0, tw, th);
  }

  const blob = await toBlob(canvas, mime, opts.format === "png" ? undefined : 0.98);
  return { blob, filename: `${baseName(file.name)}-${tw}x${th}.${opts.format}`, mime };
}

let bgModulePromise: Promise<any> | null = null;
export async function removeBackground(
  file: File,
): Promise<{ blob: Blob; filename: string; mime: string }> {
  if (!bgModulePromise) bgModulePromise = import("@imgly/background-removal");
  const mod: any = await bgModulePromise;
  const fn = mod.removeBackground ?? mod.default;
  const ext = extOf(file.name);
  let input: Blob | File = file;
  if (file.size > 12 * 1024 * 1024) {
    throw new Error("Background removal is limited to 12MB images to keep the browser responsive. Resize or compress first.");
  }
  const sourceImage = await loadHtmlImage(file);
  assertCanvasSafe(sourceImage.naturalWidth, sourceImage.naturalHeight, "background removal");
  if (ext === "heic" || ext === "heif" || ext === "tif" || ext === "tiff") {
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, sourceImage.naturalWidth); canvas.height = Math.max(1, sourceImage.naturalHeight);
    get2d(canvas).drawImage(sourceImage, 0, 0);
    input = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Decode failed"))), "image/png"),
    );
  }
  const rawPng: Blob = await fn(input);

  // Re-encode as WebP (lossy w/ alpha) to keep file size close to the original JPEG
  // instead of shipping a bloated lossless RGBA PNG. Falls back to PNG if WebP fails.
  try {
    const bmp = await createImageBitmap(rawPng);
    const canvas = document.createElement("canvas");
    assertCanvasSafe(bmp.width, bmp.height, "background removal export");
    canvas.width = bmp.width; canvas.height = bmp.height;
    get2d(canvas).drawImage(bmp, 0, 0);
    const webp = await new Promise<Blob | null>((r) =>
      canvas.toBlob((b) => r(b), "image/webp", 0.9),
    );
    if (webp && webp.size > 0 && webp.size < rawPng.size) {
      return { blob: webp, filename: `${baseName(file.name)}-nobg.webp`, mime: "image/webp" };
    }
  } catch {}
  return { blob: rawPng, filename: `${baseName(file.name)}-nobg.png`, mime: "image/png" };
}

