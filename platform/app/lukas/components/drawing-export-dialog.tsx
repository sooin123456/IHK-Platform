import { useState } from "react";

import { Button } from "~/core/components/ui/button";
import {
  Dialog,
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
  anchor.click();
  URL.revokeObjectURL(href);
}

async function pdfBackground(
  canvas: DrawingCanvas,
  sourceUrl: string | null,
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
  const opened = await openPdfDocument(sourceUrl);
  const pixels = document.createElement("canvas");
  try {
    const rendered = await renderPdfPageToCanvas({
      canvas: pixels,
      document: opened.document,
      hostWidth: 1600,
      pageNumber: canvas.background.pdfPageNumber ?? 1,
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
  const [status, setStatus] = useState<ExportStatus>({ kind: "idle" });
  const activeCanvas = documentState.activeCanvasId
    ? documentState.structure?.canvases[documentState.activeCanvasId]
    : undefined;
  const exporting = status.kind === "working";

  async function runExport() {
    if (!activeCanvas) {
      setStatus({ kind: "error", message: "내보낼 canvas가 없습니다." });
      return;
    }
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
        const rendered = await pdfBackground(activeCanvas, sourceUrl);
        disposers.push(rendered.dispose);
        const png = await exportDrawingPng(documentState, activeCanvas.id, {
          background: rendered.background,
          scale,
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
            const rendered = await pdfBackground(canvas, sourceUrl);
            disposers.push(rendered.dispose);
            return rendered.background;
          },
          scale,
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
      setStatus({ kind: "success", message: "내보내기를 완료했습니다." });
    } catch (error) {
      setStatus({
        kind: "error",
        message:
          error instanceof Error
            ? error.message
            : "도면을 내보내지 못했습니다.",
      });
    } finally {
      await Promise.allSettled(disposers.map((dispose) => dispose()));
    }
  }

  return (
    <Dialog
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (nextOpen) setStatus({ kind: "idle" });
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
