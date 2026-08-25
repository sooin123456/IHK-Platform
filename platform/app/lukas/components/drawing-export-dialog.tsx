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

function onceAsync(dispose: () => Promise<void>) {
  let pending: Promise<void> | null = null;
  return () => (pending ??= dispose());
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
  const { openPdfDocument, renderPdfPageToCanvas } = await import(
    "~/lukas/lib/pdf-page-renderer.client"
  );
  const opened = await openPdfDocument(sourceUrl, signal);
  const pixels = document.createElement("canvas");
  try {
    const rendered = await renderPdfPageToCanvas({
      canvas: pixels,
      document: opened.document,
      hostWidth: 1600,
      pageNumber: canvas.background.pdfPageNumber ?? 1,
      signal,
      zoom: 1,
    });
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
      dispose: async () => {
        rendered.cleanup();
        await opened.destroy();
        pixels.width = 0;
        pixels.height = 0;
      },
    };
  } catch (error) {
    await opened.destroy();
    pixels.width = 0;
    pixels.height = 0;
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
  const activeOperationRef = useRef<ReturnType<
    typeof createDrawingExportOperation
  > | null>(null);
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
    if (activeOperationRef.current) return;
    if (!activeCanvas) {
      setStatus({ kind: "error", message: "내보낼 canvas가 없습니다." });
      return;
    }
    const operation = createDrawingExportOperation();
    activeOperationRef.current = operation;
    setStatus({ kind: "working", message: "내보내기를 준비하는 중입니다." });
    const disposers: Array<() => Promise<void>> = [];
    try {
      const baseName = safeFilename(title);
      if (format === "svg") {
        const xml = exportDrawingSvg(documentState, activeCanvas.id);
        downloadDrawingExport(
          new Blob([xml], { type: "image/svg+xml;charset=utf-8" }),
          `${baseName}.svg`,
        );
      } else if (format === "png") {
        const rendered = includeBackground
          ? await pdfBackground(activeCanvas, sourceUrl, operation.signal)
          : { background: undefined, dispose: async () => {} };
        disposers.push(onceAsync(rendered.dispose));
        const png = await exportDrawingPng(documentState, activeCanvas.id, {
          background: rendered.background,
          includeBackground,
          scale,
          signal: operation.signal,
        });
        downloadDrawingExport(png, `${baseName}@${scale}x.png`);
      } else {
        const bytes = await exportDrawingPdf(documentState, {
          canvasIds:
            currentModelOnly && activeCanvas.spaceKind === "model"
              ? [activeCanvas.id]
              : undefined,
          createdAt,
          getBackground: async (canvas) => {
            const rendered = await pdfBackground(
              canvas,
              sourceUrl,
              operation.signal,
            );
            disposers.push(onceAsync(rendered.dispose));
            return rendered.background;
          },
          scale,
          signal: operation.signal,
          subject: "Canonical drawing workspace export",
          title,
        });
        downloadDrawingExport(
          new Blob([Uint8Array.from(bytes).buffer], {
            type: "application/pdf",
          }),
          `${baseName}.pdf`,
        );
      }
      if (mountedRef.current)
        setStatus({ kind: "success", message: "내보내기를 완료했습니다." });
    } catch (error) {
      if (
        mountedRef.current &&
        (!operation.signal.aborted || operation.timedOut)
      )
        setStatus({
          kind: "error",
          message: operation.signal.aborted
            ? operation.abortError().message
            : error instanceof Error
              ? error.message
              : "도면을 내보내지 못했습니다.",
        });
    } finally {
      await Promise.allSettled(disposers.map((dispose) => dispose()));
      operation.finish();
      if (activeOperationRef.current === operation)
        activeOperationRef.current = null;
    }
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
            현재 canvas를 SVG/PNG로 받거나, 모든 paper canvas를 정렬된 PDF로
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
                : "현재 canvas에는 포함할 PDF 배경이 없습니다."}
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
            현재 model canvas만 명시적으로 PDF에 포함
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
