export type OutputFormat =
  | "png"
  | "jpg"
  | "webp"
  | "avif"
  | "bmp"
  | "gif"
  | "ico"
  | "svg"
  | "pdf"
  | "base64";

export const INPUT_FORMATS = [
  "png",
  "jpg",
  "jpeg",
  "webp",
  "avif",
  "gif",
  "bmp",
  "svg",
  "ico",
  "heic",
  "heif",
  "tif",
  "tiff",
] as const;

export const OUTPUT_FORMATS: OutputFormat[] = [
  "png",
  "jpg",
  "webp",
  "avif",
  "bmp",
  "ico",
  "svg",
  "pdf",
  "base64",
];


const MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  avif: "image/avif",
  gif: "image/gif",
  bmp: "image/bmp",
  svg: "image/svg+xml",
  ico: "image/x-icon",
  heic: "image/heic",
  heif: "image/heif",
  tif: "image/tiff",
  tiff: "image/tiff",
  pdf: "application/pdf",
};

const MAX_CANVAS_PIXELS = 24_000_000;
const MAX_BASE64_BYTES = 32 * 1024 * 1024;

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

export function extOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i + 1).toLowerCase() : "";
}

export function baseName(name: string): string {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(0, i) : name;
}

async function decodeHeic(file: File): Promise<Blob> {
  const { heicTo } = await import("heic-to");
  return heicTo({ blob: file, type: "image/png", quality: 1 });
}

async function decodeTiff(file: File): Promise<Blob> {
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
  return await canvasToBlob(canvas, "image/png");
}


async function loadImage(file: File): Promise<HTMLImageElement> {
  const ext = extOf(file.name);
  let source: Blob = file;

  if (ext === "heic" || ext === "heif") {
    source = await decodeHeic(file);
  } else if (ext === "tif" || ext === "tiff") {
    source = await decodeTiff(file);
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

function drawToCanvas(img: HTMLImageElement, bgFill?: string, size?: { w: number; h: number }): HTMLCanvasElement {
  // SVGs without intrinsic width/height report 0 — fall back to a sensible default
  // so we don't produce a 0×0 canvas (which makes toBlob return null).
  const w = size?.w ?? (img.naturalWidth || img.width || 1024);
  const h = size?.h ?? (img.naturalHeight || img.height || 1024);
  assertCanvasSafe(w, h, "conversion");
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, w);
  canvas.height = Math.max(1, h);
  const ctx = get2d(canvas);
  if (bgFill) {
    ctx.fillStyle = bgFill;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function canvasToBlob(canvas: HTMLCanvasElement, mime: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => {
        if (!b) return reject(new Error(`Encoder failed for ${mime}. Your browser may not support this format.`));
        // Browsers silently fall back to PNG when the requested encoder is missing (e.g. AVIF in
        // Firefox/Safari, GIF everywhere). Detect the mismatch and surface a real error instead
        // of shipping a PNG with a misleading extension.
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

// Minimal BMP encoder (24-bit) — canvas.toBlob doesn't support image/bmp in most browsers.
function canvasToBmp(canvas: HTMLCanvasElement): Blob {
  assertCanvasSafe(canvas.width, canvas.height, "BMP encoding");
  const ctx = get2d(canvas);
  const { width: w, height: h } = canvas;
  const { data } = ctx.getImageData(0, 0, w, h);
  const rowSize = (w * 3 + 3) & ~3;
  const pixelSize = rowSize * h;
  const fileSize = 54 + pixelSize;
  const buf = new ArrayBuffer(fileSize);
  const view = new DataView(buf);
  const bytes = new Uint8Array(buf);

  // BITMAPFILEHEADER
  view.setUint8(0, 0x42); view.setUint8(1, 0x4d);
  view.setUint32(2, fileSize, true);
  view.setUint32(10, 54, true);
  // BITMAPINFOHEADER
  view.setUint32(14, 40, true);
  view.setInt32(18, w, true);
  view.setInt32(22, h, true);
  view.setUint16(26, 1, true);
  view.setUint16(28, 24, true);
  view.setUint32(34, pixelSize, true);

  let p = 54;
  for (let y = h - 1; y >= 0; y--) {
    let rowStart = p;
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      bytes[p++] = data[i + 2]; // B
      bytes[p++] = data[i + 1]; // G
      bytes[p++] = data[i];     // R
    }
    // pad row
    while (p - rowStart < rowSize) bytes[p++] = 0;
  }
  return new Blob([buf], { type: "image/bmp" });
}

// Minimal ICO wrapping a PNG payload (widely supported).
async function canvasToIco(canvas: HTMLCanvasElement): Promise<Blob> {
  // Downscale to <=256px per ICO spec.
  const max = 256;
  const scale = Math.min(1, max / Math.max(canvas.width, canvas.height));
  const w = Math.max(1, Math.round(canvas.width * scale));
  const h = Math.max(1, Math.round(canvas.height * scale));
  const scaled = document.createElement("canvas");
  scaled.width = w; scaled.height = h;
  get2d(scaled).drawImage(canvas, 0, 0, w, h);
  const png = await canvasToBlob(scaled, "image/png");
  const pngBuf = new Uint8Array(await png.arrayBuffer());

  const header = new ArrayBuffer(6 + 16);
  const v = new DataView(header);
  v.setUint16(0, 0, true);           // reserved
  v.setUint16(2, 1, true);           // type: icon
  v.setUint16(4, 1, true);           // count
  v.setUint8(6, w === 256 ? 0 : w);  // width
  v.setUint8(7, h === 256 ? 0 : h);  // height
  v.setUint8(8, 0);                  // palette
  v.setUint8(9, 0);                  // reserved
  v.setUint16(10, 1, true);          // planes
  v.setUint16(12, 32, true);         // bpp
  v.setUint32(14, pngBuf.length, true);
  v.setUint32(18, 22, true);         // offset

  const out = new Uint8Array(22 + pngBuf.length);
  out.set(new Uint8Array(header), 0);
  out.set(pngBuf, 22);
  return new Blob([out], { type: "image/x-icon" });
}

async function canvasToPdf(canvas: HTMLCanvasElement, name: string): Promise<Blob> {
  assertCanvasSafe(canvas.width, canvas.height, "PDF export");
  const { jsPDF } = await import("jspdf");
  const orientation = canvas.width >= canvas.height ? "landscape" : "portrait";
  const pdf = new jsPDF({ orientation, unit: "px", format: [canvas.width, canvas.height] });
  const dataUrl = canvas.toDataURL("image/jpeg", 0.92);
  pdf.addImage(dataUrl, "JPEG", 0, 0, canvas.width, canvas.height);
  const ab = pdf.output("arraybuffer");
  return new Blob([ab], { type: "application/pdf" });
}

export interface ConvertResult {
  blob: Blob;
  filename: string;
  mime: string;
}

export async function convertFile(file: File, target: OutputFormat): Promise<ConvertResult> {
  const name = baseName(file.name);
  const ext = extOf(file.name);

  // If input format matches target format, pass through original blob to preserve 100% byte-for-byte quality & colors
  if (
    (ext === target) ||
    (ext === "jpeg" && target === "jpg") ||
    (ext === "jpg" && target === "jpg")
  ) {
    return { blob: file, filename: `${name}.${target}`, mime: file.type || MIME[target] || "image/png" };
  }

  if (target === "base64") {
    const ext = extOf(file.name);
    // HEIC/HEIF/TIFF data URLs cannot be rendered by browsers — decode to PNG first
    // so the base64 output is actually usable.
    const needsDecode = ext === "heic" || ext === "heif" || ext === "tif" || ext === "tiff";
    let sourceBlob: Blob = file;
    let sourceMime = MIME[ext] || file.type || "application/octet-stream";
    if (needsDecode) {
      const img = await loadImage(file);
      const canvas = drawToCanvas(img);
      sourceBlob = await canvasToBlob(canvas, "image/png");
      sourceMime = "image/png";
    }
    if (sourceBlob.size > MAX_BASE64_BYTES) {
      throw new Error("Base64 export is limited to 32MB files to keep the browser responsive.");
    }
    const text = await blobToDataUrl(sourceBlob, sourceMime);
    return { blob: new Blob([text], { type: "text/plain" }), filename: `${name}.txt`, mime: "text/plain" };
  }


  const img = await loadImage(file);

  if (target === "svg") {
    const canvas = drawToCanvas(img);
    const dataUrl = canvas.toDataURL("image/png");
    const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${canvas.width}" height="${canvas.height}" viewBox="0 0 ${canvas.width} ${canvas.height}">
  <image href="${dataUrl}" width="${canvas.width}" height="${canvas.height}"/>
</svg>`;
    return { blob: new Blob([svg], { type: "image/svg+xml" }), filename: `${name}.svg`, mime: "image/svg+xml" };
  }

  if (target === "bmp") {
    const canvas = drawToCanvas(img, "#ffffff");
    return { blob: canvasToBmp(canvas), filename: `${name}.bmp`, mime: "image/bmp" };
  }

  if (target === "ico") {
    const canvas = drawToCanvas(img);
    return { blob: await canvasToIco(canvas), filename: `${name}.ico`, mime: "image/x-icon" };
  }

  if (target === "pdf") {
    const canvas = drawToCanvas(img, "#ffffff");
    return { blob: await canvasToPdf(canvas, name), filename: `${name}.pdf`, mime: "application/pdf" };
  }

  const mime = MIME[target];
  const bg = target === "jpg" ? "#ffffff" : undefined;
  const canvas = drawToCanvas(img, bg);
  // Use near-lossless 0.98 quality for lossy formats to preserve maximum visual fidelity and true colors
  const quality = target === "jpg" || target === "webp" || target === "avif" ? 0.98 : undefined;
  const blob = await canvasToBlob(canvas, mime, quality);
  return { blob, filename: `${name}.${target}`, mime };
}

function blobToDataUrl(blob: Blob, fallbackMime: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Base64 export failed."));
    reader.onload = () => {
      const value = typeof reader.result === "string" ? reader.result : "";
      if (!value) reject(new Error("Base64 export failed."));
      else resolve(value.replace(/^data:.*?;/, `data:${fallbackMime};`));
    };
    reader.readAsDataURL(blob);
  });
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}
