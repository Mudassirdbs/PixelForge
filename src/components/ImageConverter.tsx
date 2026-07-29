import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import JSZip from "jszip";
import {
  convertFile,
  downloadBlob,
  extOf,
  formatBytes,
  INPUT_FORMATS,
  OUTPUT_FORMATS,
  type OutputFormat,
} from "@/lib/convert";
import {
  compressImage,
  resizeImage,
  removeBackground,
  type CompressFormat,
  type ResizeMode,
} from "@/lib/imageOps";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";

type Status = "pending" | "converting" | "done" | "error";
type Mode = "convert" | "compress" | "resize" | "bgremove";

type OptionsSnapshot = {
  mode: Mode;
  from: string;
  to: OutputFormat;
  targetKB: number;
  compressFormat: CompressFormat;
  resizeMode: ResizeMode;
  resizeW: number;
  resizeH: number;
  resizePct: number;
  resizeFormat: "png" | "jpg" | "webp";
};

type QueueJob = {
  item: QueueItem;
  options: OptionsSnapshot;
};

interface QueueItem {
  id: string;
  file: File;
  status: Status;
  progress: number;
  stage?: string;
  error?: string;
  sourceUrl: string;
  resultUrl?: string;
  resultPreview?: string;
  result?: { blob: Blob; filename: string };
}

function yieldToBrowser(delay = 0) {
  return new Promise<void>((resolve) => {
    const finish = () => window.setTimeout(resolve, delay);
    window.requestAnimationFrame(finish);
  });
}


const FORMAT_META: Record<string, { label: string; hint: string }> = {
  png: { label: "PNG", hint: "lossless" },
  jpg: { label: "JPG", hint: "photos" },
  jpeg: { label: "JPEG", hint: "photos" },
  webp: { label: "WEBP", hint: "small" },
  avif: { label: "AVIF", hint: "smallest" },
  gif: { label: "GIF", hint: "legacy" },
  bmp: { label: "BMP", hint: "uncompressed" },
  ico: { label: "ICO", hint: "favicon" },
  svg: { label: "SVG", hint: "vector wrap" },
  pdf: { label: "PDF", hint: "document" },
  heic: { label: "HEIC", hint: "Apple" },
  heif: { label: "HEIF", hint: "Apple" },
  tif: { label: "TIFF", hint: "print" },
  tiff: { label: "TIFF", hint: "print" },
  base64: { label: "BASE64", hint: "data URL" },
  auto: { label: "AUTO", hint: "match source" },
};

const MODE_META: Record<Mode, { label: string; hint: string; icon: React.ReactNode }> = {
  convert: { label: "Convert", hint: "change format", icon: <IconConvert /> },
  compress: { label: "Compress", hint: "shrink to target size", icon: <IconCompress /> },
  resize: { label: "Resize", hint: "change dimensions", icon: <IconResize /> },
  bgremove: { label: "Remove BG", hint: "isolate subject", icon: <IconWand /> },
};

export default function ImageConverter() {
  const [mode, setMode] = useState<Mode>("convert");

  // Convert options
  const [from, setFrom] = useState<string>("any");
  const [to, setTo] = useState<OutputFormat>("webp");

  // Compress options
  const [targetKB, setTargetKB] = useState<number>(200);
  const [compressFormat, setCompressFormat] = useState<CompressFormat>("auto");

  // Resize options
  const [resizeMode, setResizeMode] = useState<ResizeMode>("fit");
  const [resizeW, setResizeW] = useState<number>(1280);
  const [resizeH, setResizeH] = useState<number>(720);
  const [resizePct, setResizePct] = useState<number>(50);
  const [resizeFormat, setResizeFormat] = useState<"png" | "jpg" | "webp">("webp");

  const [items, setItems] = useState<QueueItem[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const dragCounter = useRef(0);
  const [isProcessingQueue, setIsProcessingQueue] = useState(false);



  const preview = items.find((i) => i.id === previewId) ?? null;

  const acceptedExts = useMemo(() => {
    if (mode !== "convert") return INPUT_FORMATS;
    return from === "any" ? INPUT_FORMATS : [from];
  }, [from, mode]);

  // Snapshot current options so async runs don't drift when user tweaks controls mid-batch.
  const optionsRef = useRef<OptionsSnapshot>({ mode, from, to, targetKB, compressFormat, resizeMode, resizeW, resizeH, resizePct, resizeFormat });
  // Sync synchronously on render so runOne() called in the same tick sees fresh values.
  optionsRef.current = { mode, from, to, targetKB, compressFormat, resizeMode, resizeW, resizeH, resizePct, resizeFormat };

  // Track live queue IDs so async completions for removed items don't leak URLs.
  const liveIdsRef = useRef<Set<string>>(new Set());
  // One global queue prevents a second upload from starting another conversion
  // loop while the first batch is still running. Parallel canvas encoders are
  // what trigger browser "page is not responding" prompts.
  const pendingJobsRef = useRef<QueueJob[]>([]);
  const processingRef = useRef(false);

  const updateItem = (id: string, patch: Partial<QueueItem>) =>
    setItems((prev) => prev.map((x) => (x.id === id ? { ...x, ...patch } : x)));

  const runOne = async (item: QueueItem, options?: OptionsSnapshot) => {
    const o = options ?? optionsRef.current;
    const stageLabel =
      o.mode === "convert" ? `Converting to ${o.to.toUpperCase()}`
      : o.mode === "compress" ? `Compressing to ~${o.targetKB}KB`
      : o.mode === "resize" ? "Resizing"
      : "Removing background";

    updateItem(item.id, { status: "converting", progress: 8, stage: "Reading file" });
    setStatusMsg(`Reading ${item.file.name}`);
    await yieldToBrowser();

    // Simulated progress timer pulse — real encoders are sync in the main thread,
    // so we advance a soft estimate so the bar never looks frozen. Kept slow to
    // avoid piling up renders while the encoder hogs the main thread.
    let tick = 8;
    const target = o.mode === "bgremove" ? 85 : 80;
    const timer = window.setInterval(() => {
      if (!liveIdsRef.current.has(item.id)) return;
      tick = Math.min(target, tick + (o.mode === "bgremove" ? 3 : 8));
      setItems((prev) =>
        prev.map((x) =>
          x.id === item.id && x.status === "converting" && x.progress < target
            ? { ...x, progress: tick, stage: stageLabel }
            : x,
        ),
      );
    }, 900);

    try {
      let res: { blob: Blob; filename: string; mime: string };
      if (o.mode === "convert") {
        res = await convertFile(item.file, o.to);
      } else if (o.mode === "compress") {
        res = await compressImage(item.file, { targetKB: o.targetKB, format: o.compressFormat });
      } else if (o.mode === "resize") {
        res = await resizeImage(item.file, {
          mode: o.resizeMode,
          width: o.resizeW, height: o.resizeH, percent: o.resizePct,
          format: o.resizeFormat,
        });
      } else {
        res = await removeBackground(item.file);
      }
      window.clearInterval(timer);
      updateItem(item.id, { progress: 92, stage: "Finalizing" });

      let resultUrl: string | undefined;
      let resultPreview: string | undefined;
      if (res.mime === "text/plain") {
        resultPreview = (await res.blob.text()).slice(0, 240);
      } else {
        resultUrl = URL.createObjectURL(res.blob);
      }
      if (!liveIdsRef.current.has(item.id)) {
        if (resultUrl) URL.revokeObjectURL(resultUrl);
        return;
      }
      setItems((prev) =>
        prev.map((x) =>
          x.id === item.id
            ? { ...x, status: "done", progress: 100, stage: "Done", resultUrl, resultPreview, result: { blob: res.blob, filename: res.filename } }
            : x,
        ),
      );
      setStatusMsg(`${item.file.name} ready — ${formatBytes(res.blob.size)}`);
    } catch (e) {
      window.clearInterval(timer);
      const msg = e instanceof Error ? e.message : "Operation failed";
      if (!liveIdsRef.current.has(item.id)) return;
      setItems((prev) =>
        prev.map((x) => (x.id === item.id ? { ...x, status: "error", progress: 100, stage: "Failed", error: msg } : x)),
      );
      setStatusMsg(`${item.file.name} failed: ${msg}`);
    }
  };

  const drainQueue = () => {
    if (processingRef.current) return;
    processingRef.current = true;
    setIsProcessingQueue(true);

    void (async () => {
      try {
        while (pendingJobsRef.current.length > 0) {
          const job = pendingJobsRef.current.shift();
          if (!job || !liveIdsRef.current.has(job.item.id)) continue;
          await yieldToBrowser();
          await runOne(job.item, job.options);
          await yieldToBrowser(90);
        }
      } finally {
        processingRef.current = false;
        if (pendingJobsRef.current.length > 0) {
          drainQueue();
        } else {
          setIsProcessingQueue(false);
        }
      }
    })();
  };



  const addFiles = useCallback(
    (files: FileList | File[]) => {
      const all = Array.from(files);
      const arr = all.filter((f) => {
        const ext = extOf(f.name);
        if (mode !== "convert" || from === "any") return (INPUT_FORMATS as readonly string[]).includes(ext);
        return ext === from || (from === "jpg" && ext === "jpeg");
      });
      const rejected = all.length - arr.length;
      if (rejected > 0) {
        setStatusMsg(
          `${rejected} file${rejected === 1 ? "" : "s"} skipped — unsupported format${
            mode === "convert" && from !== "any" ? ` (expected .${from})` : ""
          }.`,
        );
      }
      if (arr.length === 0) return;
      if (processingRef.current) {
        setStatusMsg("Please wait for the current batch to finish before adding more files.");
        return;
      }

      const next: QueueItem[] = arr.map((file) => ({
        id: `${file.name}-${file.size}-${Math.random().toString(36).slice(2, 8)}`,
        file,
        status: "pending",
        progress: 0,
        sourceUrl: URL.createObjectURL(file),
      }));
      next.forEach((n) => liveIdsRef.current.add(n.id));
      setItems((prev) => [...prev, ...next]);

      // In resize mode (non-scale), auto-detect the first image's dimensions so
      // "exact/fit/cover" defaults to the actual source size. Wait for the load
      // before kicking off runOne so it doesn't race with the stale defaults.
      const shouldAutoDetect =
        mode === "resize" && optionsRef.current.resizeMode !== "scale" && next.length > 0;

      const kickoff = (overrides?: Partial<OptionsSnapshot>) => {
        const queuedOptions: OptionsSnapshot = { ...optionsRef.current, ...overrides };
        pendingJobsRef.current.push(...next.map((item) => ({ item, options: queuedOptions })));
        setStatusMsg(
          processingRef.current
            ? `Added ${next.length} file${next.length === 1 ? "" : "s"} to the queue.`
            : `Queued ${next.length} file${next.length === 1 ? "" : "s"}.`,
        );
        drainQueue();
      };

      if (shouldAutoDetect) {
        const first = next[0];
        const img = new Image();
        img.onload = () => {
          const w = img.naturalWidth || 0;
          const h = img.naturalHeight || 0;
          if (w && h) {
            setResizeW(w);
            setResizeH(h);
            kickoff({ resizeW: w, resizeH: h });
          } else {
            kickoff();
          }
        };
        img.onerror = () => kickoff();
        img.src = first.sourceUrl!;
      } else {
        kickoff();
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [from, mode],
  );


  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current = 0;
    setDragOver(false);
    if (e.dataTransfer.files?.length) addFiles(e.dataTransfer.files);
  };


  const downloadAll = async () => {
    const done = items.filter((i) => i.status === "done" && i.result);
    if (done.length === 0) return;
    if (done.length === 1) {
      downloadBlob(done[0].result!.blob, done[0].result!.filename);
      return;
    }
    const zip = new JSZip();
    // De-duplicate filenames so JSZip doesn't silently overwrite identical names.
    const used = new Map<string, number>();
    done.forEach((d) => {
      let name = d.result!.filename;
      const n = used.get(name) ?? 0;
      if (n > 0) {
        const dot = name.lastIndexOf(".");
        name = dot > 0 ? `${name.slice(0, dot)}-${n}${name.slice(dot)}` : `${name}-${n}`;
      }
      used.set(d.result!.filename, n + 1);
      zip.file(name, d.result!.blob);
    });
    const blob = await zip.generateAsync({ type: "blob" });
    downloadBlob(blob, `${mode}-${Date.now()}.zip`);
  };

  const clearAll = () => {
    pendingJobsRef.current = [];
    setIsProcessingQueue(false);
    items.forEach((i) => {
      liveIdsRef.current.delete(i.id);
      if (i.sourceUrl) URL.revokeObjectURL(i.sourceUrl);
      if (i.resultUrl) URL.revokeObjectURL(i.resultUrl);
    });
    setItems([]);
  };
  const removeItem = (id: string) =>
    setItems((prev) => {
      const it = prev.find((i) => i.id === id);
      if (it) {
        liveIdsRef.current.delete(id);
        pendingJobsRef.current = pendingJobsRef.current.filter((job) => job.item.id !== id);
        if (it.sourceUrl) URL.revokeObjectURL(it.sourceUrl);
        if (it.resultUrl) URL.revokeObjectURL(it.resultUrl);
      }

      return prev.filter((i) => i.id !== id);
    });

  const retryItems = (ids: string[]) => {
    if (ids.length === 0) return;
    const toRetry = items.filter((i) => ids.includes(i.id) && i.status === "error");
    if (toRetry.length === 0) return;
    const queuedOptions: OptionsSnapshot = { ...optionsRef.current };
    setItems((prev) =>
      prev.map((x) => {
        if (!ids.includes(x.id)) return x;
        if (x.resultUrl) URL.revokeObjectURL(x.resultUrl);
        return { ...x, status: "pending", progress: 0, stage: "Queued", error: undefined, result: undefined, resultUrl: undefined, resultPreview: undefined };
      }),
    );
    pendingJobsRef.current.push(...toRetry.map((item) => ({ item, options: queuedOptions })));
    setStatusMsg(`Retrying ${toRetry.length} file${toRetry.length === 1 ? "" : "s"}.`);
    drainQueue();
  };
  const retryAllFailed = () => retryItems(items.filter((i) => i.status === "error").map((i) => i.id));

  // Keep a ref of items so the unmount cleanup can revoke the *current* URLs
  // (an empty-deps effect would otherwise close over the initial empty array).
  const itemsRef = useRef(items);
  itemsRef.current = items;
  useEffect(() => {
    return () => {
      itemsRef.current.forEach((i) => {
        if (i.sourceUrl) URL.revokeObjectURL(i.sourceUrl);
        if (i.resultUrl) URL.revokeObjectURL(i.resultUrl);
      });
    };
  }, []);

  const doneCount = items.filter((i) => i.status === "done").length;
  const errorCount = items.filter((i) => i.status === "error").length;
  const activeCount = items.filter((i) => i.status === "converting").length;
  const finishedCount = doneCount + errorCount;
  const overallPct = items.length === 0
    ? 0
    : Math.round(items.reduce((s, i) => s + (i.progress || 0), 0) / items.length);
  const isBusy = isProcessingQueue || activeCount > 0 || (items.length > 0 && finishedCount < items.length);
  // Only count files that actually got smaller — BG removal & format upshifts can grow the file.
  const totalSaved = items
    .filter((i) => i.result && i.file.size > i.result.blob.size)
    .reduce((sum, i) => sum + (i.file.size - i.result!.blob.size), 0);



  const acceptAttr = acceptedExts.map((e) => `.${e}${e === "jpg" ? ",.jpeg" : ""}`).join(",");

  const subhead =
    mode === "convert"
      ? "PNG · JPG · WEBP · AVIF · GIF · BMP · ICO · SVG · PDF · HEIC · TIFF · Base64. Nothing leaves your device."
      : mode === "compress"
      ? "Squeeze photos to a target file size with smart quality tuning — WhatsApp, email, web-ready."
      : mode === "resize"
      ? "Batch-resize to fit, cover, exact, or percentage — perfect for socials, thumbnails, and previews."
      : "AI cutout, right in your browser. Runs a local ONNX model — first file takes ~10s while the model loads.";

  return (
    <div className="relative min-h-screen">
      <a href="#converter-main" className="skip-link">Skip to converter</a>

      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {statusMsg}
      </div>

      {/* Brand header */}
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between gap-3 px-4 py-4 sm:px-6 sm:py-5 lg:px-8">
        <a href="/" className="flex min-w-0 items-center gap-2.5" aria-label="PixelForge home">
          <BrandMark />
          <span className="truncate text-lg font-bold tracking-tight text-[color:var(--foreground)] sm:text-xl">
            Pixel<span className="text-[color:var(--primary)]">Forge</span>
          </span>
        </a>
        <a
          href="https://github.com"
          target="_blank"
          rel="noopener noreferrer"
          aria-label="View on GitHub"
          className="inline-flex shrink-0 items-center gap-2 rounded-full border border-[color:var(--border)] bg-[color:var(--card)] px-3.5 py-2 text-xs font-semibold text-[color:var(--foreground)] transition hover:border-[color:var(--primary)] hover:text-[color:var(--primary)] sm:px-4 sm:text-sm"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M12 .5C5.65.5.5 5.65.5 12a11.5 11.5 0 0 0 7.86 10.92c.58.11.79-.25.79-.56 0-.28-.01-1.02-.02-2-3.2.7-3.88-1.54-3.88-1.54-.52-1.33-1.28-1.68-1.28-1.68-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.7 0-1.26.45-2.29 1.19-3.1-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.18 1.18a11.02 11.02 0 0 1 5.79 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.84 1.19 3.1 0 4.43-2.7 5.4-5.27 5.69.41.36.78 1.06.78 2.15 0 1.55-.01 2.8-.01 3.18 0 .31.21.68.8.56A11.5 11.5 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5Z"/>
          </svg>
          <span className="hidden sm:inline">GitHub</span>
        </a>
      </header>


      <main id="converter-main" className="relative mx-auto w-full max-w-3xl px-4 pb-16 pt-4 sm:px-6 sm:pt-8 lg:px-8">
        <header className="mb-8 text-center anim-rise">
          <h1 className="text-4xl font-bold leading-[1.05] tracking-tight text-[color:var(--foreground)] sm:text-5xl lg:text-6xl">
            Cloud Image Toolkit
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-sm text-[color:var(--muted-foreground)] sm:text-base">
            {subhead}
          </p>
        </header>


        {/* Mode tabs */}
        <div
          role="tablist"
          aria-label="Tool mode"
          className="mx-auto mb-6 flex w-full max-w-xl flex-wrap items-center justify-center gap-1.5 rounded-2xl border border-[color:var(--border)] bg-[color:var(--card)]/60 p-1.5 backdrop-blur anim-rise"
        >
          {(Object.keys(MODE_META) as Mode[]).map((m) => {
            const active = mode === m;
            return (
              <button
                key={m}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setMode(m)}
                className={`mode-tab flex flex-1 min-w-[110px] items-center justify-center gap-2 rounded-xl px-3 py-2 text-sm font-medium transition ${
                  active
                    ? "bg-[color:color-mix(in_oklab,var(--mint)_18%,transparent)] text-[color:var(--foreground)] shadow-[0_6px_20px_-8px_rgba(45,212,168,0.5)]"
                    : "text-[color:var(--muted-foreground)] hover:bg-[color:var(--muted)]/40"
                }`}
              >
                <span className={active ? "text-[color:var(--mint)]" : ""}>{MODE_META[m].icon}</span>
                <span>{MODE_META[m].label}</span>
              </button>
            );
          })}
        </div>

        {/* Per-mode toolbar */}
        <div
          className="mb-6 flex flex-wrap items-center justify-center gap-3 anim-rise"
          style={{ animationDelay: "80ms" }}
        >
          {mode === "convert" && (
            <>
              <FormatPill label="From" value={from} onChange={setFrom} options={["any", ...INPUT_FORMATS]} />
              <ArrowIcon />
              <FormatPill label="To" value={to} onChange={(v) => setTo(v as OutputFormat)} options={OUTPUT_FORMATS} />
            </>
          )}

          {mode === "compress" && (
            <>
              <div className="pill flex-col items-start gap-1 !py-2">
                <label htmlFor="target-kb" className="font-mono text-[10px] uppercase tracking-wider text-[color:var(--muted-foreground)]">
                  Target size
                </label>
                <div className="flex items-center gap-2">
                  <input
                    id="target-kb"
                    type="number"
                    min={10}
                    max={10000}
                    value={targetKB}
                    onChange={(e) => setTargetKB(Math.max(10, Number(e.target.value) || 200))}
                    className="w-20 bg-transparent font-mono text-sm font-semibold text-[color:var(--mint)] outline-none"
                  />
                  <span className="font-mono text-[11px] text-[color:var(--muted-foreground)]">KB</span>
                </div>
              </div>
              <FormatPill
                label="Format"
                value={compressFormat}
                onChange={(v) => setCompressFormat(v as CompressFormat)}
                options={["auto", "webp", "jpg", "avif"]}
              />
            </>
          )}

          {mode === "resize" && (
            <>
              <FormatPill
                label="Mode"
                value={resizeMode}
                onChange={(v) => setResizeMode(v as ResizeMode)}
                options={["fit", "cover", "exact", "scale"]}
              />
              {resizeMode === "scale" ? (
                <div className="pill flex-col items-start gap-1 !py-2">
                  <label htmlFor="rz-pct" className="font-mono text-[10px] uppercase tracking-wider text-[color:var(--muted-foreground)]">
                    Scale
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      id="rz-pct"
                      type="number"
                      min={1}
                      max={400}
                      value={resizePct}
                      onChange={(e) => setResizePct(Math.max(1, Number(e.target.value) || 50))}
                      className="w-16 bg-transparent font-mono text-sm font-semibold text-[color:var(--mint)] outline-none"
                    />
                    <span className="font-mono text-[11px] text-[color:var(--muted-foreground)]">%</span>
                  </div>
                </div>
              ) : (
                <div className="pill flex-col items-start gap-1 !py-2">
                  <label className="font-mono text-[10px] uppercase tracking-wider text-[color:var(--muted-foreground)]">
                    Size
                  </label>
                  <div className="flex items-center gap-1.5">
                    <input
                      aria-label="Width"
                      type="number"
                      min={1}
                      value={resizeW}
                      onChange={(e) => setResizeW(Math.max(1, Number(e.target.value) || 1))}
                      className="w-16 bg-transparent font-mono text-sm font-semibold text-[color:var(--mint)] outline-none"
                    />
                    <span className="text-[color:var(--muted-foreground)]">×</span>
                    <input
                      aria-label="Height"
                      type="number"
                      min={1}
                      value={resizeH}
                      onChange={(e) => setResizeH(Math.max(1, Number(e.target.value) || 1))}
                      className="w-16 bg-transparent font-mono text-sm font-semibold text-[color:var(--mint)] outline-none"
                    />
                  </div>
                </div>
              )}
              <FormatPill
                label="Save as"
                value={resizeFormat}
                onChange={(v) => setResizeFormat(v as "png" | "jpg" | "webp")}
                options={["webp", "png", "jpg"]}
              />
            </>
          )}

          {mode === "bgremove" && (
            <div className="pill">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-[color:var(--mint)]">
                <path d="M12 3v18M3 12h18" />
              </svg>
              <span className="font-mono text-[11px] uppercase tracking-wider">
                Transparent PNG · local ONNX model
              </span>
            </div>
          )}

        </div>

        {/* Dropzone */}
        {items.length === 0 && (
        <button
          type="button"
          data-drag={dragOver}
          aria-label={`Upload images. Press Enter or Space to browse, or drop files.`}
          aria-describedby="dropzone-help"
          onDragEnter={(e) => { e.preventDefault(); dragCounter.current += 1; setDragOver(true); }}
          onDragOver={(e) => { e.preventDefault(); }}
          onDragLeave={(e) => {
            e.preventDefault();
            dragCounter.current = Math.max(0, dragCounter.current - 1);
            if (dragCounter.current === 0) setDragOver(false);
          }}
          onDrop={onDrop}
          onClick={() => inputRef.current?.click()}
          className="dropzone anim-rise block w-full"
          style={{ animationDelay: "160ms" }}
        >
          <input
            ref={inputRef}
            type="file"
            multiple
            accept={acceptAttr}
            className="sr-only"
            aria-hidden="true"
            tabIndex={-1}
            onChange={(e) => {
              if (e.target.files) addFiles(e.target.files);
              e.target.value = "";
            }}
          />

          <div className="dz-particles" aria-hidden="true">
            <span /><span /><span /><span /><span /><span />
          </div>

          <div className="dz-icon mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-[color:var(--border)] bg-[color:var(--mint)]/10 text-[color:var(--mint)] shadow-[0_10px_30px_-10px_rgba(45,212,168,0.5)]" aria-hidden="true">
            <svg className="dz-arrow" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 3v13" />
              <path d="m7 8 5-5 5 5" />
              <path d="M5 21h14" />
            </svg>
          </div>
          <p className="text-lg font-semibold text-[color:var(--foreground)]">
            {dragOver ? (
              <span className="text-[color:var(--mint)]">Release to drop</span>
            ) : (
              <>Drop files here <span className="text-[color:var(--muted-foreground)]">or click to browse</span></>
            )}
          </p>
          <span className="dz-hint font-mono text-[11px] uppercase tracking-wider text-[color:var(--mint)]" aria-hidden="true">
            we've got it from here ✦
          </span>
          <div id="dropzone-help" className="mt-3 flex flex-wrap justify-center gap-1.5">
            {acceptedExts.slice(0, 10).map((e) => (
              <span
                key={e}
                className="rounded-md border border-[color:var(--border)] bg-[color:var(--muted)]/40 px-2 py-0.5 font-mono text-[10px] font-medium uppercase tracking-wider text-[color:var(--muted-foreground)]"
              >
                {e}
              </span>
            ))}
          </div>
        </button>
        )}

        {/* Hidden input to allow adding more files when dropzone is hidden */}
        {items.length > 0 && (
          <input
            ref={inputRef}
            type="file"
            multiple
            accept={acceptAttr}
            className="sr-only"
            aria-hidden="true"
            tabIndex={-1}
            onChange={(e) => {
              if (e.target.files) addFiles(e.target.files);
              e.target.value = "";
            }}
          />
        )}

        {items.length > 0 && (
          <div className="mt-8 anim-rise">
            <div className="mb-4 rounded-2xl border border-[color:var(--border)] bg-[color:var(--card)]/60 px-4 py-3 backdrop-blur">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-5 text-sm">
                  <Stat label="Files" value={String(items.length)} />
                  <Divider />
                  <Stat label="Done" value={`${doneCount}/${items.length}`} highlight />
                  {activeCount > 0 && (
                    <>
                      <Divider />
                      <Stat label="Working" value={String(activeCount)} />
                    </>
                  )}
                  {errorCount > 0 && (
                    <>
                      <Divider />
                      <Stat label="Failed" value={String(errorCount)} />
                    </>
                  )}
                  {totalSaved > 0 && (
                    <>
                      <Divider />
                      <Stat label="Saved" value={formatBytes(totalSaved)} highlight />
                    </>
                  )}
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => inputRef.current?.click()}
                    disabled={isBusy}
                    className="btn-ghost disabled:cursor-not-allowed disabled:opacity-50"
                    aria-label={isBusy ? "Wait for processing to finish before adding files" : "Add more files"}
                  >
                    {isBusy ? "Processing…" : "Add files"}
                  </button>
                  {errorCount > 0 && (
                    <button
                      type="button"
                      onClick={retryAllFailed}
                      disabled={isBusy}
                      className="btn-ghost disabled:cursor-not-allowed disabled:opacity-50"
                      aria-label={`Retry ${errorCount} failed file${errorCount === 1 ? "" : "s"}`}
                    >
                      Retry failed ({errorCount})
                    </button>
                  )}
                  <button onClick={clearAll} className="btn-ghost">Clear</button>
                  <button onClick={downloadAll} disabled={doneCount === 0} className="btn-primary">
                    <DownloadIcon />
                    {doneCount > 1 ? `Download all (${doneCount})` : "Download"}
                  </button>
                </div>
              </div>
              <div className="mt-3">
                <div className="mb-1.5 flex items-center justify-between font-mono text-[10px] uppercase tracking-wider text-[color:var(--muted-foreground)]">
                  <span>
                    {isBusy ? "Processing" : finishedCount === items.length ? "Complete" : "Idle"}
                    <span className="mx-2 opacity-40">·</span>
                    {finishedCount} of {items.length} finished
                  </span>
                  <span className="tabular-nums text-[color:var(--foreground)]">{overallPct}%</span>
                </div>
                <div
                  className="progress-track"
                  role="progressbar"
                  aria-label="Overall progress"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={overallPct}
                >
                  <div
                    className={`progress-fill ${isBusy ? "animate-pulse" : ""} ${errorCount > 0 && !isBusy ? "error" : ""}`}
                    style={{ width: `${overallPct}%` }}
                  />
                </div>
              </div>
            </div>


            <ul className="space-y-3" aria-label={`Queue, ${items.length} file${items.length === 1 ? "" : "s"}`}>
              {items.map((item) => {
                const statusLabel =
                  item.status === "done" ? "done"
                  : item.status === "converting" ? "working"
                  : item.status === "error" ? "error" : "queued";
                return (
                  <li
                    key={item.id}
                    className="file-row anim-rise"
                    aria-label={`${item.file.name}, ${formatBytes(item.file.size)}, ${statusLabel}`}
                  >
                    <Thumb url={item.sourceUrl} label={extOf(item.file.name)} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-3">
                        <p className="truncate text-sm font-medium">{item.file.name}</p>
                        <span className="shrink-0 font-mono text-[11px] text-[color:var(--muted-foreground)]">
                          {formatBytes(item.file.size)}
                          {item.result && (
                            <>
                              <span className="mx-1.5 opacity-40" aria-hidden="true">→</span>
                              <span className="text-[color:var(--mint)]">
                                <span className="sr-only">result size </span>
                                {formatBytes(item.result.blob.size)}
                              </span>
                            </>
                          )}
                        </span>
                      </div>
                      <div
                        className="mt-2 progress-track"
                        role="progressbar"
                        aria-label={`Progress for ${item.file.name}`}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={item.progress}
                      >
                        <div
                          className={`progress-fill ${item.status === "error" ? "error" : ""} ${item.status === "converting" ? "animate-pulse" : ""}`}
                          style={{ width: `${item.progress}%` }}
                        />
                      </div>
                      {(item.status === "converting" || item.status === "pending") && (
                        <div className="mt-1 flex items-center justify-between font-mono text-[10px] uppercase tracking-wider text-[color:var(--muted-foreground)]">
                          <span>{item.stage ?? (item.status === "pending" ? "Queued" : "Working")}</span>
                          <span className="tabular-nums text-[color:var(--foreground)]">{item.progress}%</span>
                        </div>
                      )}
                      {item.error && (
                        <p className="mt-1 text-[11px] text-[color:var(--destructive)]" role="alert">
                          {item.error}
                        </p>
                      )}

                      {item.status === "done" && (item.resultUrl || item.resultPreview) && (
                        <div className="mt-3 flex items-center gap-2 rounded-xl border border-[color:var(--border)] bg-[color:var(--muted)]/30 p-2">
                          <span className="font-mono text-[10px] uppercase tracking-wider text-[color:var(--muted-foreground)]">
                            Preview
                          </span>
                          <span className="text-[color:var(--mint)]" aria-hidden="true">→</span>
                          {item.resultUrl ? (
                            <button
                              type="button"
                              onClick={() => setPreviewId(item.id)}
                              aria-label={`Open preview of ${item.result?.filename ?? item.file.name}`}
                              className="group relative block h-16 w-16 shrink-0 overflow-hidden rounded-lg border border-[color:var(--border)] bg-[color:var(--background)] transition hover:border-[color:var(--mint)]/50"
                              style={mode === "bgremove" ? checkerBoard : undefined}
                            >
                              <img
                                src={item.resultUrl}
                                alt=""
                                className="h-full w-full object-cover transition group-hover:scale-105"
                              />
                            </button>
                          ) : (
                            <code className="block max-h-16 flex-1 overflow-hidden rounded-lg border border-[color:var(--border)] bg-[color:var(--background)] p-2 font-mono text-[10px] leading-tight text-[color:var(--muted-foreground)]">
                              {item.resultPreview}…
                            </code>
                          )}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5">
                      {item.status === "done" && item.result && (
                        <button
                          onClick={() => downloadBlob(item.result!.blob, item.result!.filename)}
                          aria-label={`Download ${item.result.filename}`}
                          className="rounded-lg border border-[color:var(--border)] bg-[color:var(--mint)]/10 px-3 py-1.5 text-xs font-semibold text-[color:var(--mint)] transition hover:bg-[color:var(--mint)]/20 hover:border-[color:var(--mint)]/40"
                        >
                          Download
                        </button>
                      )}
                      {item.status === "error" && (
                        <button
                          type="button"
                          onClick={() => retryItems([item.id])}
                          disabled={isBusy}
                          className="rounded-lg border border-[color:var(--border)] bg-[color:var(--muted)]/40 px-3 py-1.5 text-xs font-semibold text-[color:var(--foreground)] transition hover:bg-[color:var(--muted)] disabled:cursor-not-allowed disabled:opacity-50"
                          aria-label={`Retry ${item.file.name}`}
                        >
                          Retry
                        </button>
                      )}
                      {item.status === "converting" && (
                        <span
                          className="rounded-lg border border-[color:var(--border)] px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider text-[color:var(--muted-foreground)]"
                          aria-hidden="true"
                        >
                          working…
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={() => removeItem(item.id)}
                        className="flex h-8 w-8 items-center justify-center rounded-lg text-[color:var(--muted-foreground)] transition hover:bg-[color:var(--muted)] hover:text-[color:var(--foreground)]"
                        aria-label={`Remove ${item.file.name}`}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <path d="M18 6 6 18" /><path d="m6 6 12 12" />
                        </svg>
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        <p className="mt-10 text-center font-mono text-[11px] uppercase tracking-wider text-[color:var(--muted-foreground)]">
          No uploads · No accounts · No tracking
        </p>



      <Dialog open={!!preview} onOpenChange={(o) => !o && setPreviewId(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle className="truncate">
              {preview?.result?.filename ?? "Preview"}
            </DialogTitle>
            <DialogDescription>
              {preview
                ? `${formatBytes(preview.file.size)} → ${
                    preview.result ? formatBytes(preview.result.blob.size) : "—"
                  }`
                : ""}
            </DialogDescription>
          </DialogHeader>
          {preview?.resultUrl && (
            <div
              className="flex items-center justify-center overflow-auto rounded-xl border border-[color:var(--border)] bg-[color:var(--background)] p-2"
              style={mode === "bgremove" ? checkerBoard : undefined}
            >
              <img
                src={preview.resultUrl}
                alt={`Preview of ${preview.result?.filename ?? ""}`}
                className="max-h-[70vh] w-auto object-contain"
              />
            </div>
          )}
          {preview?.result && (
            <div className="flex justify-end">
              <button
                onClick={() => downloadBlob(preview.result!.blob, preview.result!.filename)}
                className="btn-primary"
              >
                <DownloadIcon />
                Download
              </button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      </main>

      {/* Footer */}
      <footer className="border-t border-[color:var(--border)] bg-[color:var(--muted)]/40 px-4 py-6 sm:px-6 lg:px-8">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 sm:flex-row">
          <div className="flex items-center gap-2 text-sm text-[color:var(--muted-foreground)]">
            <BrandMark small />
            <span className="font-semibold text-[color:var(--foreground)]">PixelForge</span>
            <span className="opacity-60">© {new Date().getFullYear()}</span>
          </div>
          <p className="text-sm text-[color:var(--muted-foreground)]">
            Created by <span className="font-semibold text-[color:var(--foreground)]">Mudassir Asghar</span>
          </p>
        </div>
      </footer>
    </div>
  );
}

function BrandMark({ small = false }: { small?: boolean }) {
  const size = small ? 22 : 30;
  return (
    <div
      className="flex items-center justify-center rounded-xl"
      style={{
        width: size,
        height: size,
        background: "linear-gradient(135deg, #6366F1 0%, #8B5CF6 100%)",
        boxShadow: "0 6px 16px -6px rgba(99,102,241,0.55)",
      }}
      aria-hidden="true"
    >
      <svg width={size * 0.6} height={size * 0.6} viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 15a4 4 0 0 1 1-7.9 6 6 0 0 1 11.7 1.4A4.5 4.5 0 0 1 18 17H7a3 3 0 0 1-3-2z" />
      </svg>
    </div>
  );
}


const checkerBoard: React.CSSProperties = {
  backgroundImage:
    "linear-gradient(45deg, rgba(148,163,184,0.25) 25%, transparent 25%), linear-gradient(-45deg, rgba(148,163,184,0.25) 25%, transparent 25%), linear-gradient(45deg, transparent 75%, rgba(148,163,184,0.25) 75%), linear-gradient(-45deg, transparent 75%, rgba(148,163,184,0.25) 75%)",
  backgroundSize: "16px 16px",
  backgroundPosition: "0 0, 0 8px, 8px -8px, -8px 0",
};

function FormatPill({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: readonly string[];
}) {
  const displayLabel = value === "any" ? "ANY" : (FORMAT_META[value]?.label || value.toUpperCase());
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger
        aria-label={`${label} format`}
        className="format-trigger group h-auto gap-2.5 rounded-full border-[color:var(--border)] bg-[color:color-mix(in_oklab,var(--mint)_8%,transparent)] px-4 py-2 font-mono text-xs uppercase tracking-wider text-[color:var(--foreground)] shadow-none transition hover:border-[color:color-mix(in_oklab,var(--mint)_50%,transparent)] hover:bg-[color:color-mix(in_oklab,var(--mint)_14%,transparent)] data-[state=open]:border-[color:var(--mint)] data-[state=open]:bg-[color:color-mix(in_oklab,var(--mint)_18%,transparent)]"
      >
        <span className="text-[10px] font-medium text-[color:var(--muted-foreground)]">{label}</span>
        <span className="font-semibold text-[color:var(--mint)]">{displayLabel}</span>
      </SelectTrigger>
      <SelectContent
        className="min-w-[220px] rounded-2xl border-[color:var(--border)] bg-[color:var(--card)]/95 p-1.5 backdrop-blur-xl shadow-[0_20px_60px_-20px_rgba(45,212,168,0.35)]"
      >
        <div className="px-2.5 pb-1.5 pt-1 font-mono text-[10px] uppercase tracking-wider text-[color:var(--muted-foreground)]">
          {label}
        </div>
        {options.map((o) => {
          const meta = FORMAT_META[o];
          return (
            <SelectItem
              key={o}
              value={o}
              className="cursor-pointer rounded-xl px-2.5 py-2 text-sm focus:bg-[color:color-mix(in_oklab,var(--mint)_15%,transparent)] focus:text-[color:var(--foreground)] data-[state=checked]:bg-[color:color-mix(in_oklab,var(--mint)_18%,transparent)]"
            >
              <span className="flex w-full items-center gap-2.5">
                <span className="font-mono text-[11px] font-semibold uppercase tracking-wider text-[color:var(--mint)]">
                  {o === "any" ? "ANY" : (meta?.label || o.toUpperCase())}
                </span>
                <span className="text-[11px] text-[color:var(--muted-foreground)]">
                  {o === "any" ? "detect from file" : (meta?.hint || "")}
                </span>
              </span>
            </SelectItem>
          );
        })}
      </SelectContent>
    </Select>
  );
}

function ArrowIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-[color:var(--mint)]">
      <path d="M5 12h14" />
      <path d="m12 5 7 7-7 7" />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3v13" />
      <path d="m7 12 5 5 5-5" />
      <path d="M5 21h14" />
    </svg>
  );
}

function IconConvert() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M17 3v6h-6" /><path d="M7 21v-6h6" />
      <path d="M21 7A9 9 0 0 0 7 5" /><path d="M3 17a9 9 0 0 0 14 2" />
    </svg>
  );
}
function IconCompress() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 9V4h5" /><path d="M20 9V4h-5" />
      <path d="M4 15v5h5" /><path d="M20 15v5h-5" />
    </svg>
  );
}
function IconResize() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="3" width="12" height="12" rx="1" />
      <path d="M15 15h6v6h-6z" />
    </svg>
  );
}
function IconWand() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m3 21 9-9" /><path d="M15 4v4" /><path d="M13 6h4" />
      <path d="M19 10v3" /><path d="M17.5 11.5h3" />
    </svg>
  );
}

function Stat({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span className="font-mono text-[10px] uppercase tracking-wider text-[color:var(--muted-foreground)]">{label}</span>
      <span className={`font-mono text-sm font-semibold ${highlight ? "text-[color:var(--mint)]" : "text-[color:var(--foreground)]"}`}>
        {value}
      </span>
    </div>
  );
}

function Divider() {
  return <span className="h-3 w-px bg-[color:var(--border)]" />;
}

function FileTypeBadge({ ext }: { ext: string }) {
  const label = (FORMAT_META[ext]?.label || ext || "?").slice(0, 4);
  return (
    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-[color:var(--border)] bg-gradient-to-br from-[color:var(--mint)]/15 to-transparent">
      <span className="font-mono text-[10px] font-bold uppercase tracking-tight text-[color:var(--mint)]">{label}</span>
    </div>
  );
}

function Thumb({ url, label }: { url: string; label: string }) {
  const [ok, setOk] = useState(true);
  if (!ok || !url) return <FileTypeBadge ext={label} />;
  return (
    <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-xl border border-[color:var(--border)] bg-[color:var(--muted)]/40">
      <img
        src={url}
        alt=""
        loading="lazy"
        onError={() => setOk(false)}
        className="h-full w-full object-cover"
      />
      <span className="absolute bottom-0 left-0 right-0 bg-black/55 py-[1px] text-center font-mono text-[9px] font-semibold uppercase tracking-wider text-white">
        {label}
      </span>
    </div>
  );
}
