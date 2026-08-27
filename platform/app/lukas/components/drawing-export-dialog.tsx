import { useEffect, useRef, useState } from "react";

import { Button } from "~/core/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "~/core/components/ui/dialog";
import type { DrawingDocumentSnapshot } from "~/lukas/lib/drawing-document-store";
import {
  exportDrawingPdf,
  exportDrawingPng,
  exportDrawingSvg,
  type DrawingExportBackground,
} from "~/lukas/lib/drawing-export";
import { drawingPdfImagePlacement } from "~/lukas/lib/drawing-workspace-view";
import type { DrawingCanvas } from "~/lukas/lib/drawing-workspace.types";

type ExportFormat = "pdf" | "png" | "svg";
type ExportStatus =
  | { kind: "idle" }
  | { kind: "working"; message: string }
  | { kind: "success"; message: string }
  | { kind: "error"; message: string };

type DrawingExportDialogProps = {
  createdAt: string;
  documentState: DrawingDocumentSnapshot;
  sourceUrl: string | null;
  title: string;
};

const DRAWING_EXPORT_TIMEOUT_MILLISECONDS = 30_000;

type DrawingExportOperationOptions = {
  cancelScheduled?: (handle: unknown) => void;
  schedule?: (callback: () => void, milliseconds: number) => unknown;
};

type DrawingExportOperation = ReturnType<typeof createDrawingExportOperation>;

type DrawingExportOperationRef = {
  current: DrawingExportOperation | null;
};

type DrawingExportLifecycleOptions<Result> = {
  activeOperationRef: DrawingExportOperationRef;
  createOperation?: () => DrawingExportOperation;
  download: (result: Result) => Promise<void> | void;
  execute: (context: {
    registerDisposer: (dispose: () => Promise<void>) => void;
    signal: AbortSignal;
  }) => Promise<Result>;
  publishStatus: (status: ExportStatus) => void;
};

type DrawingExportDownload = {
  blob: Blob;
  filename: string;
};

export function createDrawingExportOperation({
  cancelScheduled = (handle) =>
    clearTimeout(handle as ReturnType<typeof setTimeout>),
  schedule = (callback, milliseconds) => setTimeout(callback, milliseconds),
}: DrawingExportOperationOptions = {}) {
  const controller = new AbortController();
  let cancelled = false;
  let finished = false;
  let timedOut = false;
  const timer = schedule(() => {
    if (finished || controller.signal.aborted) return;
    timedOut = true;
    controller.abort();
  }, DRAWING_EXPORT_TIMEOUT_MILLISECONDS);
  return {
    abortError() {
      return new Error(
        timedOut
          ? "도면 내보내기가 30초 제한 시간을 초과했습니다."
          : cancelled
            ? "도면 내보내기가 취소되었습니다."
            : "도면 내보내기가 중단되었습니다.",
      );
    },
    cancel() {
      if (finished || controller.signal.aborted) return;
      cancelled = true;
      controller.abort();
    },
    finish() {
      if (finished) return;
      finished = true;
      cancelScheduled(timer);
    },
    get timedOut() {
      return timedOut;
    },
    signal: controller.signal,
  };
}

function raceDrawingExportOperation<Result>(
  operation: DrawingExportOperation,
  promise: Promise<Result>,
) {
  if (operation.signal.aborted) {
    void promise.catch(() => {});
    return Promise.reject(operation.abortError());
  }
  return new Promise<Result>((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      operation.signal.removeEventListener("abort", onAbort);
      callback();
    };
    const onAbort = () => finish(() => reject(operation.abortError()));
    operation.signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => finish(() => resolve(value)),
      (error) => finish(() => reject(error)),
    );
  });
}

function onceAsync(dispose: () => Promise<void>) {
  let pending: Promise<void> | null = null;
  return () => (pending ??= Promise.resolve().then(dispose));
}

/** Bounds executor, native download, and cleanup behind one operation gate. */
export async function runDrawingExportLifecycle<Result>({
  activeOperationRef,
  createOperation = createDrawingExportOperation,
  download,
  execute,
  publishStatus,
}: DrawingExportLifecycleOptions<Result>) {
  if (activeOperationRef.current) return false;
  const operation = createOperation();
  activeOperationRef.current = operation;
  const disposers: Array<() => Promise<void>> = [];
  let cleanupStarted = false;
  const registerDisposer = (dispose: () => Promise<void>) => {
    const disposeOnce = onceAsync(dispose);
    if (cleanupStarted) void disposeOnce().catch(() => {});
    else disposers.push(disposeOnce);
  };
  const cleanup = onceAsync(async () => {
    cleanupStarted = true;
    await Promise.allSettled(disposers.map((dispose) => dispose()));
  });
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    operation.finish();
    if (activeOperationRef.current === operation)
      activeOperationRef.current = null;
  };
  publishStatus({ kind: "working", message: "내보내기를 준비하는 중입니다." });

  try {
    let failed = false;
    let failure: unknown = null;
    let result: Result | undefined;
    try {
      result = await raceDrawingExportOperation(
        operation,
        Promise.resolve().then(() =>
          execute({ registerDisposer, signal: operation.signal }),
        ),
      );
    } catch (error) {
      failed = true;
      failure = error;
    }
    try {
      await raceDrawingExportOperation(operation, cleanup());
    } catch (error) {
      failed = true;
      failure = error;
    }
    if (failed) throw failure;
    if (operation.signal.aborted || activeOperationRef.current !== operation)
      throw operation.abortError();
    await raceDrawingExportOperation(
      operation,
      Promise.resolve().then(() => {
        if (
          operation.signal.aborted ||
          activeOperationRef.current !== operation
        )
          throw operation.abortError();
        return download(result as Result);
      }),
    );
    if (operation.signal.aborted || activeOperationRef.current !== operation)
      throw operation.abortError();
    release();
    publishStatus({ kind: "success", message: "내보내기를 완료했습니다." });
  } catch (error) {
    release();
    publishStatus({
      kind: "error",
      message: operation.signal.aborted
        ? operation.abortError().message
        : error instanceof Error
          ? error.message
          : "도면을 내보내지 못했습니다.",
    });
  } finally {
    void cleanup().catch(() => {});
    release();
  }
  return true;
}

function safeFilename(value: string) {
  const normalized = value
    .normalize("NFKC")
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-")
    .trim();
  return normalized || "drawing-export";
}

/** Starts a browser-native download without a route action or server mutation. */
export function downloadDrawingExport(blob: Blob, filename: string) {
  if (
    typeof document === "undefined" ||
    typeof URL === "undefined" ||
    typeof URL.createObjectURL !== "function"
  )
    throw new Error("Native browser download is unavailable.");
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.download = filename;
  anchor.href = href;
  try {
    anchor.click();
  } finally {
    URL.revokeObjectURL(href);
  }
}

export async function pdfBackground(
  canvas: DrawingCanvas,
  sourceUrl: string | null,
  signal?: AbortSignal,
): Promise<{
  background: DrawingExportBackground | undefined;
  dispose: () => Promise<void>;
}> {
  if (!canvas.background)
    return { background: undefined, dispose: async () => {} };
  if (!sourceUrl) throw new Error("PDF background pixels are missing.");
  const { openPdfDocument, renderPdfPageToCanvas } =
    await import("~/lukas/lib/pdf-page-renderer.client");
  if (signal?.aborted) throw new Error("Drawing export was cancelled.");
  const opened = await openPdfDocument(sourceUrl, signal);
  const pixels = document.createElement("canvas");
  let rendered: Awaited<ReturnType<typeof renderPdfPageToCanvas>> | undefined;
  const dispose = onceAsync(async () => {
    try {
      rendered?.cleanup();
    } finally {
      pixels.width = 0;
      pixels.height = 0;
      await opened.destroy();
    }
  });
  try {
    if (signal?.aborted) throw new Error("Drawing export was cancelled.");
    rendered = await renderPdfPageToCanvas({
      canvas: pixels,
      document: opened.document,
      hostWidth: 1600,
      pageNumber: canvas.background.pdfPageNumber ?? 1,
      signal,
      zoom: 1,
    });
    if (signal?.aborted) throw new Error("Drawing export was cancelled.");
    return {
      background: {
        bounds: drawingPdfImagePlacement(rendered.canvasSize, {
          height: canvas.heightMillimeters,
          width: canvas.widthMillimeters,
        }),
        canvas: pixels,
        pdfPageNumber: canvas.background.pdfPageNumber,
        sourceFileId: canvas.background.sourceFileId,
        sourceSha256: canvas.background.sourceSha256,
      },
      dispose,
    };
  } catch (error) {
    await dispose();
    throw error;
  }
}

export function DrawingExportDialog({
  createdAt,
  documentState,
  sourceUrl,
  title,
}: DrawingExportDialogProps) {
  const [open, setOpen] = useState(false);
  const [format, setFormat] = useState<ExportFormat>("pdf");
  const [scale, setScale] = useState<1 | 2 | 4>(2);
  const [currentModelOnly, setCurrentModelOnly] = useState(false);
  const [includeBackground, setIncludeBackground] = useState(false);
  const [status, setStatus] = useState<ExportStatus>({ kind: "idle" });
  const activeOperationRef = useRef<DrawingExportOperation | null>(null);
  const mountedRef = useRef(true);
  const activeCanvas = documentState.activeCanvasId
    ? documentState.structure?.canvases[documentState.activeCanvasId]
    : undefined;
  const exporting = status.kind === "working";

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      activeOperationRef.current?.cancel();
    };
  }, []);

  async function runExport() {
    if (!activeCanvas) {
      setStatus({ kind: "error", message: "내보낼 캔버스가 없습니다." });
      return;
    }
    await runDrawingExportLifecycle<DrawingExportDownload>({
      activeOperationRef,
      download: ({ blob, filename }) => downloadDrawingExport(blob, filename),
      execute: async ({ registerDisposer, signal }) => {
        const baseName = safeFilename(title);
        if (format === "svg") {
          const xml = exportDrawingSvg(documentState, activeCanvas.id);
          return {
            blob: new Blob([xml], { type: "image/svg+xml;charset=utf-8" }),
            filename: `${baseName}.svg`,
          };
        }
        if (format === "png") {
          const rendered = includeBackground
            ? await pdfBackground(activeCanvas, sourceUrl, signal)
            : { background: undefined, dispose: async () => {} };
          registerDisposer(rendered.dispose);
          const blob = await exportDrawingPng(documentState, activeCanvas.id, {
            background: rendered.background,
            includeBackground,
            scale,
            signal,
          });
          return { blob, filename: `${baseName}@${scale}x.png` };
        }
        const bytes = await exportDrawingPdf(documentState, {
          canvasIds:
            currentModelOnly && activeCanvas.spaceKind === "model"
              ? [activeCanvas.id]
              : undefined,
          createdAt,
          getBackground: async (canvas) => {
            const rendered = await pdfBackground(canvas, sourceUrl, signal);
            registerDisposer(rendered.dispose);
            return rendered.background;
          },
          scale,
          signal,
          subject: "Canonical drawing workspace export",
          title,
        });
        return {
          blob: new Blob([Uint8Array.from(bytes).buffer], {
            type: "application/pdf",
          }),
          filename: `${baseName}.pdf`,
        };
      },
      publishStatus: (nextStatus) => {
        if (mountedRef.current) setStatus(nextStatus);
      },
    });
  }

  return (
    <Dialog
      onOpenChange={(nextOpen) => {
        if (!nextOpen) activeOperationRef.current?.cancel();
        setOpen(nextOpen);
        if (nextOpen) {
          setIncludeBackground(Boolean(activeCanvas?.background));
          setStatus({ kind: "idle" });
        }
      }}
      open={open}
    >
      <DialogTrigger asChild>
        <Button type="button" variant="secondary">
          내보내기
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>도면 내보내기</DialogTitle>
          <DialogDescription>
            현재 캔버스를 SVG/PNG로 받거나, 모든 용지 캔버스를 정렬된 PDF로
            받습니다. 원본 파일과 리비전은 변경되지 않습니다.
          </DialogDescription>
        </DialogHeader>
        <fieldset className="grid gap-2" disabled={exporting}>
          <legend className="text-sm font-semibold">파일 형식</legend>
          {(["pdf", "png", "svg"] as const).map((value) => (
            <label className="flex min-h-10 items-center gap-2" key={value}>
              <input
                checked={format === value}
                name="drawing-export-format"
                onChange={() => setFormat(value)}
                type="radio"
              />
              {value.toUpperCase()}
            </label>
          ))}
        </fieldset>
        {format !== "svg" ? (
          <label className="grid gap-2 text-sm" htmlFor="drawing-export-scale">
            PNG 렌더 배율
            <select
              className="min-h-10 rounded-md border bg-background px-3"
              disabled={exporting}
              id="drawing-export-scale"
              onChange={(event) =>
                setScale(Number(event.target.value) as 1 | 2 | 4)
              }
              value={scale}
            >
              <option value={1}>1x</option>
              <option value={2}>2x</option>
              <option value={4}>4x</option>
            </select>
          </label>
        ) : null}
        {format === "png" ? (
          <div className="grid gap-1">
            <label className="flex min-h-10 items-center gap-2 text-sm">
              <input
                aria-describedby="drawing-export-background-description"
                checked={includeBackground && Boolean(activeCanvas?.background)}
                disabled={exporting || !activeCanvas?.background}
                onChange={(event) => setIncludeBackground(event.target.checked)}
                type="checkbox"
              />
              PDF 배경 포함
            </label>
            <p
              className="text-xs text-muted-foreground"
              id="drawing-export-background-description"
            >
              {activeCanvas?.background
                ? "선택 해제하면 흰색 배경과 벡터만 내보냅니다."
                : "현재 캔버스에는 포함할 PDF 배경이 없습니다."}
            </p>
          </div>
        ) : null}
        {format === "pdf" && activeCanvas?.spaceKind === "model" ? (
          <label className="flex min-h-10 items-center gap-2 text-sm">
            <input
              checked={currentModelOnly}
              disabled={exporting}
              onChange={(event) => setCurrentModelOnly(event.target.checked)}
              type="checkbox"
            />
            현재 모델 캔버스만 명시적으로 PDF에 포함
          </label>
        ) : null}
        {status.kind !== "idle" ? (
          <p
            aria-live="polite"
            className={
              status.kind === "error" ? "text-sm text-destructive" : "text-sm"
            }
            role={status.kind === "error" ? "alert" : "status"}
          >
            {status.message}
          </p>
        ) : null}
        <DialogFooter>
          <DialogClose asChild>
            <Button
              onClick={() => activeOperationRef.current?.cancel()}
              type="button"
              variant="secondary"
            >
              {exporting ? "취소" : "닫기"}
            </Button>
          </DialogClose>
          <Button
            disabled={exporting || !activeCanvas}
            onClick={runExport}
            type="button"
          >
            {exporting ? "내보내는 중…" : "다운로드"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
