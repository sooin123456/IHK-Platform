import { useEffect, useRef, useState } from "react";

import {
  ChevronLeft,
  ChevronRight,
  Focus,
  LoaderCircle,
  Minus,
  MousePointer2,
  Plus,
} from "lucide-react";
import { Button } from "~/core/components/ui/button";
import {
  denormalizeRegion,
  normalizeDragRegion,
  type PdfNormalizedRegion,
} from "~/lukas/lib/pdf-anchor";
import { markDrawingFirstUsable, createDrawingFrameQueue } from "~/lukas/lib/drawing-runtime";
import {
  openPdfDocument,
  renderPdfPageToCanvas,
  type OpenPdfDocument,
} from "~/lukas/lib/pdf-page-renderer.client";

type Props = {
  signedUrl: string;
  fileName: string;
  activeRegion?: (PdfNormalizedRegion & { pageNumber: number }) | null;
  onRegionSelected?: (
    region: PdfNormalizedRegion & { pageNumber: number },
  ) => void;
};

type Point = { x: number; y: number };
type Phase = "loading" | "ready" | "error";

export default function PdfDrawingViewer({
  signedUrl,
  fileName,
  activeRegion = null,
  onRegionSelected,
}: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const documentRef = useRef<OpenPdfDocument | null>(null);
  const renderCleanupRef = useRef<(() => void) | null>(null);
  const renderControllerRef = useRef<AbortController | null>(null);
  const renderGenerationRef = useRef(0);
  const [phase, setPhase] = useState<Phase>("loading");
  const [message, setMessage] = useState("PDF를 여는 중입니다.");
  const [pageNumber, setPageNumber] = useState(1);
  const [pageCount, setPageCount] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [hostWidth, setHostWidth] = useState(0);
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });
  const [regionMode, setRegionMode] = useState(false);
  const [dragStart, setDragStart] = useState<Point | null>(null);
  const [dragCurrent, setDragCurrent] = useState<Point | null>(null);
  const dragMoveQueueRef = useRef(createDrawingFrameQueue());
  const [selectedRegion, setSelectedRegion] =
    useState<PdfNormalizedRegion | null>(
      activeRegion?.pageNumber === pageNumber ? activeRegion : null,
    );

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const observer = new ResizeObserver(([entry]) => {
      setHostWidth(Math.max(0, entry.contentRect.width - 24));
    });
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  useEffect(() => () => dragMoveQueueRef.current.dispose(), []);

  useEffect(() => {
    let alive = true;
    const controller = new AbortController();
    let openedDocument: OpenPdfDocument | null = null;
    setPhase("loading");
    setMessage("PDF를 여는 중입니다.");
    void openPdfDocument(signedUrl, controller.signal)
      .then(async (nextDocument) => {
        if (!alive) {
          await nextDocument.destroy();
          return;
        }
        openedDocument = nextDocument;
        documentRef.current = nextDocument;
        setPageCount(nextDocument.document.numPages);
        setPageNumber(1);
      })
      .catch((error: unknown) => {
        if (!alive) return;
        setPhase("error");
        setMessage(
          error instanceof Error ? error.message : "PDF를 열지 못했습니다.",
        );
      });
    return () => {
      alive = false;
      controller.abort();
      renderGenerationRef.current += 1;
      renderControllerRef.current?.abort();
      renderControllerRef.current = null;
      renderCleanupRef.current?.();
      renderCleanupRef.current = null;
      void openedDocument?.destroy();
      documentRef.current = null;
    };
  }, [signedUrl]);

  useEffect(() => {
    const openedDocument = documentRef.current;
    const canvas = canvasRef.current;
    if (!openedDocument || !canvas || hostWidth <= 0 || pageCount === 0) return;
    let alive = true;
    const controller = new AbortController();
    const renderGeneration = renderGenerationRef.current + 1;
    renderGenerationRef.current = renderGeneration;
    renderControllerRef.current?.abort();
    setPhase("loading");
    setMessage(`${pageNumber}쪽을 그리는 중입니다.`);
    renderCleanupRef.current?.();
    renderControllerRef.current = controller;
    renderCleanupRef.current = () => controller.abort();
    void renderPdfPageToCanvas({
      document: openedDocument.document,
      pageNumber,
      canvas,
      hostWidth,
      zoom,
      signal: controller.signal,
    })
      .then((render) => {
        if (
          !alive ||
          controller.signal.aborted ||
          renderGenerationRef.current !== renderGeneration
        ) {
          render.cleanup();
          return;
        }
        renderCleanupRef.current = render.cleanup;
        setCanvasSize(render.canvasSize);
        markDrawingFirstUsable("pdf");
        setPhase("ready");
        setMessage(`${pageNumber}/${pageCount}쪽을 열었습니다.`);
      })
      .catch((error: unknown) => {
        if (
          !alive ||
          controller.signal.aborted ||
          renderGenerationRef.current !== renderGeneration ||
          (error instanceof Error &&
            error.name === "RenderingCancelledException")
        )
          return;
        setPhase("error");
        setMessage(
          error instanceof Error
            ? error.message
            : "PDF 페이지를 그리지 못했습니다.",
        );
      });
    return () => {
      alive = false;
      controller.abort();
      if (renderControllerRef.current === controller)
        renderControllerRef.current = null;
    };
  }, [hostWidth, pageCount, pageNumber, signedUrl, zoom]);

  useEffect(() => {
    if (activeRegion?.pageNumber === pageNumber)
      setSelectedRegion(activeRegion);
    else setSelectedRegion(null);
  }, [activeRegion, pageNumber]);

  useEffect(() => {
    if (!activeRegion || pageCount === 0) return;
    setPageNumber(Math.min(pageCount, activeRegion.pageNumber));
  }, [activeRegion, pageCount]);

  function point(event: React.PointerEvent<HTMLDivElement>): Point {
    const bounds = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
  }

  function finishDrag(event: React.PointerEvent<HTMLDivElement>) {
    if (!dragStart || !regionMode) return;
    const region = normalizeDragRegion(dragStart, point(event), canvasSize);
    setDragStart(null);
    setDragCurrent(null);
    if (!region) {
      setMessage("영역이 너무 작습니다. 4픽셀보다 크게 드래그하세요.");
      return;
    }
    setSelectedRegion(region);
    onRegionSelected?.({ ...region, pageNumber });
    setMessage(`${pageNumber}쪽 영역을 선택했습니다.`);
  }

  const dragRegion =
    dragStart && dragCurrent
      ? normalizeDragRegion(dragStart, dragCurrent, canvasSize)
      : null;
  const overlayRegion = dragRegion ?? selectedRegion;
  const overlay =
    overlayRegion && canvasSize.width > 0
      ? denormalizeRegion(overlayRegion, canvasSize)
      : null;

  return (
    <section
      aria-label={`${fileName} PDF 도면`}
      className="overflow-hidden rounded-xl border bg-slate-950"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 bg-slate-900 p-2 text-white">
        <div className="flex items-center gap-1">
          <Button
            aria-label="이전 페이지"
            className="text-white hover:bg-white/10"
            disabled={pageNumber <= 1}
            onClick={() => setPageNumber((value) => Math.max(1, value - 1))}
            size="icon"
            variant="ghost"
          >
            <ChevronLeft className="size-4" />
          </Button>
          <span className="min-w-16 text-center text-sm font-semibold">
            {pageNumber} / {pageCount || "—"}
          </span>
          <Button
            aria-label="다음 페이지"
            className="text-white hover:bg-white/10"
            disabled={pageCount === 0 || pageNumber >= pageCount}
            onClick={() =>
              setPageNumber((value) => Math.min(pageCount, value + 1))
            }
            size="icon"
            variant="ghost"
          >
            <ChevronRight className="size-4" />
          </Button>
        </div>
        <div className="flex items-center gap-1">
          <Button
            aria-label="축소"
            className="text-white hover:bg-white/10"
            onClick={() => setZoom((value) => Math.max(0.5, value - 0.25))}
            size="icon"
            variant="ghost"
          >
            <Minus className="size-4" />
          </Button>
          <span className="w-12 text-center text-xs">
            {Math.round(zoom * 100)}%
          </span>
          <Button
            aria-label="확대"
            className="text-white hover:bg-white/10"
            onClick={() => setZoom((value) => Math.min(3, value + 0.25))}
            size="icon"
            variant="ghost"
          >
            <Plus className="size-4" />
          </Button>
          <Button
            aria-label="너비 맞춤"
            className="text-white hover:bg-white/10"
            onClick={() => setZoom(1)}
            size="icon"
            variant="ghost"
          >
            <Focus className="size-4" />
          </Button>
          <Button
            aria-pressed={regionMode}
            className={
              regionMode
                ? "bg-primary text-primary-foreground"
                : "text-white hover:bg-white/10"
            }
            onClick={() => setRegionMode((value) => !value)}
            size="sm"
            type="button"
            variant={regionMode ? "default" : "ghost"}
          >
            <MousePointer2 className="size-4" /> 영역 지정
          </Button>
        </div>
      </div>

      <div
        className="relative min-h-[55vh] overflow-auto bg-slate-800 p-3"
        ref={hostRef}
      >
        <div
          className={`relative mx-auto w-fit shadow-2xl ${regionMode ? "cursor-crosshair touch-none" : ""}`}
          data-testid="pdf-canvas"
          onPointerCancel={() => {
            dragMoveQueueRef.current.flush();
            setDragStart(null);
            setDragCurrent(null);
          }}
          onPointerDown={(event) => {
            if (!regionMode || phase !== "ready") return;
            event.currentTarget.setPointerCapture(event.pointerId);
            const next = point(event);
            setDragStart(next);
            setDragCurrent(next);
          }}
          onPointerMove={(event) => {
            if (!dragStart || !regionMode) return;
            const next = point(event);
            dragMoveQueueRef.current.schedule(() => setDragCurrent(next));
          }}
          onPointerUp={(event) => {
            dragMoveQueueRef.current.flush();
            finishDrag(event);
          }}
        >
          <canvas
            aria-label={`${pageNumber}쪽 PDF`}
            className="block bg-white"
            ref={canvasRef}
          />
          {overlay ? (
            <span
              aria-label="선택한 PDF 영역"
              className="pointer-events-none absolute border-2 border-amber-400 bg-amber-300/25 shadow-[0_0_0_1px_rgba(15,23,42,.5)]"
              style={{
                left: overlay.x,
                top: overlay.y,
                width: overlay.width,
                height: overlay.height,
              }}
            />
          ) : null}
        </div>
        {phase === "loading" ? (
          <div className="absolute inset-0 grid place-items-center bg-slate-950/40 text-white">
            <LoaderCircle className="size-8 animate-spin" />
          </div>
        ) : null}
      </div>
      <p
        aria-live="polite"
        className={`border-t border-white/10 px-3 py-2 text-xs ${phase === "error" ? "bg-red-950 text-red-100" : "bg-slate-900 text-slate-300"}`}
        role={phase === "error" ? "alert" : "status"}
      >
        {message}
      </p>
    </section>
  );
}
