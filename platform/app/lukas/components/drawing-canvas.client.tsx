import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type { KonvaEventObject } from "konva/lib/Node";
import { Image as KonvaImage, Layer, Line, Rect, Stage } from "react-konva";

import {
  containPdfSource,
  drawingCanvasCursor,
  screenToWorld,
  zoomViewportAroundPointer,
} from "~/lukas/lib/drawing-geometry";
import {
  openPdfDocument,
  renderPdfPageToCanvas,
  type OpenPdfDocument,
} from "~/lukas/lib/pdf-page-renderer.client";
import type { Point, Viewport } from "~/lukas/lib/drawing-workspace.types";

const MIN_ZOOM = 0.05;
const MAX_ZOOM = 32;
const BASE_GRID_SIZE = 10;

export type DrawingCanvasBackground =
  | { kind: "blank"; width: number; height: number }
  | {
      kind: "pdf";
      width: number;
      height: number;
      pageNumber: number;
      signedUrl: string;
    };

export type DrawingCanvasHandle = {
  getViewport: () => Viewport;
  resetViewport: () => void;
  setViewport: (viewport: Viewport) => void;
};

type DrawingCanvasProps = {
  activeTool: "select" | "pan";
  background: DrawingCanvasBackground;
  onViewportChange?: (viewport: Viewport) => void;
};

type CanvasSize = { width: number; height: number };

function clampZoom(zoom: number) {
  if (!Number.isFinite(zoom)) return 1;
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

function safeViewport(viewport: Viewport): Viewport {
  return {
    x: Number.isFinite(viewport.x) ? viewport.x : 0,
    y: Number.isFinite(viewport.y) ? viewport.y : 0,
    zoom: clampZoom(viewport.zoom),
  };
}

function fittedViewport(size: CanvasSize, background: DrawingCanvasBackground) {
  const availableWidth = Math.max(1, size.width - 80);
  const availableHeight = Math.max(1, size.height - 80);
  const zoom = clampZoom(
    Math.min(
      availableWidth / background.width,
      availableHeight / background.height,
    ),
  );
  return {
    x: (size.width - background.width * zoom) / 2,
    y: (size.height - background.height * zoom) / 2,
    zoom,
  };
}

function visibleGrid(
  size: CanvasSize,
  viewport: Viewport,
): { vertical: number[]; horizontal: number[] } {
  if (size.width <= 0 || size.height <= 0)
    return { vertical: [], horizontal: [] };
  const start = screenToWorld({ x: 0, y: 0 }, viewport);
  const end = screenToWorld({ x: size.width, y: size.height }, viewport);
  const multiplier = Math.max(
    1,
    2 ** Math.ceil(Math.log2(16 / (BASE_GRID_SIZE * viewport.zoom))),
  );
  const step = BASE_GRID_SIZE * multiplier;
  const firstX = Math.floor(start.x / step) * step;
  const firstY = Math.floor(start.y / step) * step;
  const vertical: number[] = [];
  const horizontal: number[] = [];
  for (let x = firstX; x <= end.x + step && vertical.length < 500; x += step)
    vertical.push(x);
  for (let y = firstY; y <= end.y + step && horizontal.length < 500; y += step)
    horizontal.push(y);
  return { vertical, horizontal };
}

function isCancelled(error: unknown) {
  return (
    (error instanceof Error &&
      (error.name === "AbortError" ||
        error.name === "RenderingCancelledException")) ||
    false
  );
}

export const DrawingCanvas = forwardRef<
  DrawingCanvasHandle,
  DrawingCanvasProps
>(function DrawingCanvas({ activeTool, background, onViewportChange }, ref) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<Viewport>({ x: 40, y: 40, zoom: 1 });
  const fitPendingRef = useRef(true);
  const panStartRef = useRef<{
    pointer: Point;
    viewport: Viewport;
    pointerId: number;
  } | null>(null);
  const spacePressedRef = useRef(false);
  const [spacePressed, setSpacePressed] = useState(false);
  const [panning, setPanning] = useState(false);
  const [size, setSize] = useState<CanvasSize>({ width: 0, height: 0 });
  const [viewport, setViewportState] = useState<Viewport>(viewportRef.current);
  const [pdfSource, setPdfSource] = useState<{
    canvas: HTMLCanvasElement;
    bounds: { x: number; y: number; width: number; height: number };
  } | null>(null);
  const [pdfMessage, setPdfMessage] = useState("");

  const setViewport = useCallback(
    (next: Viewport) => {
      const safe = safeViewport(next);
      viewportRef.current = safe;
      setViewportState(safe);
      onViewportChange?.(safe);
    },
    [onViewportChange],
  );

  const resetViewport = useCallback(() => {
    if (size.width <= 0 || size.height <= 0) return;
    setViewport(fittedViewport(size, background));
  }, [background, setViewport, size]);

  useImperativeHandle(
    ref,
    () => ({
      getViewport: () => viewportRef.current,
      resetViewport,
      setViewport,
    }),
    [resetViewport, setViewport],
  );

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const updateSize = (width: number, height: number) =>
      setSize({
        width: Math.max(0, Math.floor(width)),
        height: Math.max(0, Math.floor(height)),
      });
    const bounds = host.getBoundingClientRect();
    updateSize(bounds.width, bounds.height);
    const observer = new ResizeObserver(([entry]) =>
      updateSize(entry.contentRect.width, entry.contentRect.height),
    );
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    fitPendingRef.current = true;
  }, [background.height, background.kind, background.width]);

  useEffect(() => {
    if (!fitPendingRef.current || size.width <= 0 || size.height <= 0) return;
    fitPendingRef.current = false;
    setViewport(fittedViewport(size, background));
  }, [background, setViewport, size]);

  useEffect(() => {
    if (background.kind !== "pdf") {
      setPdfSource(null);
      setPdfMessage("");
      return;
    }
    let alive = true;
    let opened: OpenPdfDocument | null = null;
    let renderCleanup: (() => void) | null = null;
    const controller = new AbortController();
    const canvas = document.createElement("canvas");
    setPdfSource(null);
    setPdfMessage("PDF 배경을 준비하는 중입니다.");
    void openPdfDocument(background.signedUrl, controller.signal)
      .then(async (nextDocument) => {
        if (!alive || controller.signal.aborted) {
          await nextDocument.destroy();
          return;
        }
        opened = nextDocument;
        const rendered = await renderPdfPageToCanvas({
          document: nextDocument.document,
          pageNumber: background.pageNumber,
          canvas,
          hostWidth: 1600,
          zoom: 1,
          signal: controller.signal,
        });
        renderCleanup = rendered.cleanup;
        const sourceBounds = containPdfSource(rendered.canvasSize, {
          x: 0,
          y: 0,
          width: background.width,
          height: background.height,
        });
        if (!alive || controller.signal.aborted) {
          rendered.cleanup();
          renderCleanup = null;
          return;
        }
        setPdfSource({ canvas, bounds: sourceBounds });
        setPdfMessage("PDF 원본 배경을 표시하고 있습니다.");
      })
      .catch((error: unknown) => {
        renderCleanup?.();
        renderCleanup = null;
        const failedDocument = opened;
        opened = null;
        void failedDocument?.destroy();
        canvas.width = 0;
        canvas.height = 0;
        if (!alive || controller.signal.aborted || isCancelled(error)) return;
        setPdfMessage(
          error instanceof Error
            ? error.message
            : "PDF 배경을 열지 못했습니다.",
        );
      });
    return () => {
      alive = false;
      controller.abort();
      renderCleanup?.();
      const documentToDestroy = opened;
      opened = null;
      void documentToDestroy?.destroy();
      canvas.width = 0;
      canvas.height = 0;
    };
  }, [
    background.kind,
    background.height,
    background.kind === "pdf" ? background.pageNumber : 0,
    background.kind === "pdf" ? background.signedUrl : "",
    background.width,
  ]);

  useEffect(
    () => () => {
      spacePressedRef.current = false;
      panStartRef.current = null;
    },
    [],
  );

  const grid = useMemo(() => visibleGrid(size, viewport), [size, viewport]);
  const cursor = drawingCanvasCursor(activeTool, spacePressed, panning);

  function beginPan(event: KonvaEventObject<PointerEvent>) {
    const nativeEvent = event.evt;
    const shouldPan =
      nativeEvent.button === 1 ||
      activeTool === "pan" ||
      spacePressedRef.current;
    if (!shouldPan) return;
    nativeEvent.preventDefault();
    (nativeEvent.currentTarget as HTMLElement | null)?.setPointerCapture?.(
      nativeEvent.pointerId,
    );
    panStartRef.current = {
      pointer: { x: nativeEvent.clientX, y: nativeEvent.clientY },
      viewport: viewportRef.current,
      pointerId: nativeEvent.pointerId,
    };
    setPanning(true);
  }

  function continuePan(event: KonvaEventObject<PointerEvent>) {
    const start = panStartRef.current;
    if (!start || start.pointerId !== event.evt.pointerId) return;
    setViewport({
      ...start.viewport,
      x: start.viewport.x + event.evt.clientX - start.pointer.x,
      y: start.viewport.y + event.evt.clientY - start.pointer.y,
    });
  }

  function endPan(event: KonvaEventObject<PointerEvent>) {
    const start = panStartRef.current;
    if (!start || start.pointerId !== event.evt.pointerId) return;
    const target = event.evt.currentTarget as HTMLElement | null;
    if (target?.hasPointerCapture?.(event.evt.pointerId))
      target.releasePointerCapture(event.evt.pointerId);
    panStartRef.current = null;
    setPanning(false);
  }

  return (
    <div
      aria-label="도면 화면. 스페이스 키와 드래그 또는 가운데 단추 드래그로 이동합니다."
      className="relative h-full min-h-[32rem] w-full overflow-hidden bg-slate-950 outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-inset"
      onBlur={() => {
        spacePressedRef.current = false;
        panStartRef.current = null;
        setSpacePressed(false);
        setPanning(false);
      }}
      onKeyDown={(event) => {
        if (event.code !== "Space") return;
        event.preventDefault();
        spacePressedRef.current = true;
        setSpacePressed(true);
      }}
      onKeyUp={(event) => {
        if (event.code !== "Space") return;
        event.preventDefault();
        spacePressedRef.current = false;
        setSpacePressed(false);
      }}
      onPointerDown={(event) => event.currentTarget.focus()}
      ref={hostRef}
      tabIndex={0}
    >
      {size.width > 0 && size.height > 0 ? (
        <Stage
          height={size.height}
          onPointerCancel={endPan}
          onPointerDown={beginPan}
          onPointerMove={continuePan}
          onPointerUp={endPan}
          onWheel={(event) => {
            event.evt.preventDefault();
            const pointer = event.target.getStage()?.getPointerPosition();
            if (!pointer) return;
            const nextZoom = clampZoom(
              viewportRef.current.zoom * Math.exp(-event.evt.deltaY * 0.002),
            );
            setViewport(
              zoomViewportAroundPointer(pointer, viewportRef.current, nextZoom),
            );
          }}
          style={{ cursor }}
          width={size.width}
        >
          <Layer
            listening={false}
            name="immutable-source"
            scaleX={viewport.zoom}
            scaleY={viewport.zoom}
            x={viewport.x}
            y={viewport.y}
          >
            <Rect
              fill="#ffffff"
              height={background.height}
              listening={false}
              shadowBlur={12 / viewport.zoom}
              shadowColor="#000000"
              shadowOpacity={0.35}
              stroke="#cbd5e1"
              strokeWidth={1 / viewport.zoom}
              width={background.width}
            />
            {background.kind === "pdf" && pdfSource ? (
              <KonvaImage
                height={pdfSource.bounds.height}
                image={pdfSource.canvas}
                listening={false}
                width={pdfSource.bounds.width}
                x={pdfSource.bounds.x}
                y={pdfSource.bounds.y}
              />
            ) : null}
          </Layer>
          <Layer
            listening={false}
            scaleX={viewport.zoom}
            scaleY={viewport.zoom}
            x={viewport.x}
            y={viewport.y}
          >
            {grid.vertical.map((x) => (
              <Line
                key={`x-${x}`}
                opacity={0.18}
                points={[
                  x,
                  screenToWorld({ x: 0, y: 0 }, viewport).y,
                  x,
                  screenToWorld({ x: 0, y: size.height }, viewport).y,
                ]}
                stroke="#64748b"
                strokeWidth={1 / viewport.zoom}
              />
            ))}
            {grid.horizontal.map((y) => (
              <Line
                key={`y-${y}`}
                opacity={0.18}
                points={[
                  screenToWorld({ x: 0, y: 0 }, viewport).x,
                  y,
                  screenToWorld({ x: size.width, y: 0 }, viewport).x,
                  y,
                ]}
                stroke="#64748b"
                strokeWidth={1 / viewport.zoom}
              />
            ))}
          </Layer>
          <Layer
            listening={false}
            name="drawing-objects"
            scaleX={viewport.zoom}
            scaleY={viewport.zoom}
            x={viewport.x}
            y={viewport.y}
          />
        </Stage>
      ) : null}
      <p className="sr-only" role="status">
        {pdfMessage || "빈 도면 배경을 표시하고 있습니다."}
      </p>
    </div>
  );
});
