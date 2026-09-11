import { type ReactNode, useEffect, useRef, useState } from "react";

import type { PDFDocumentProxy } from "pdfjs-dist";
import { RotateCcw } from "lucide-react";

import { usePdfScreenRender } from "~/lukas/lib/drawing-pdf-screen-render.client";

type SurfaceProps = {
  document: PDFDocumentProxy;
  pageNumber: number;
  zoom: number;
  panEnabled: boolean;
  fitKey: number;
  restorePosition?: {key:number;left:number;top:number}|null;
  onPositionChange?: (position:{left:number;top:number})=>void;
  relativePosition?: {key:number;x:number;y:number}|null;
  onRelativePositionChange?: (position:{x:number;y:number})=>void;
  overlay?: ReactNode;
  onMetrics?: (metrics: {
    widthPoints: number;
    heightPoints: number;
    rotation: number;
  }) => void;
};

type ThumbnailProps = { document: PDFDocumentProxy; pageNumber: number };

export function PdfScreenSurface({
  document,
  pageNumber,
  zoom,
  panEnabled,
  fitKey,
  restorePosition,
  onPositionChange,
  relativePosition,
  onRelativePositionChange,
  overlay,
  onMetrics,
}: SurfaceProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const restoredPositionKey=useRef<number|null>(null);
  const relativePositionKey=useRef<number|null>(null);
  const reflectedScroll=useRef<{left:number;top:number}|null>(null);
  const dragRef = useRef<{
    x: number;
    y: number;
    left: number;
    top: number;
  } | null>(null);
  const [host, setHost] = useState({ width: 0, height: 0 });
  const [retry, setRetry] = useState(0);
  const [dragging, setDragging] = useState(false);
  const rendered = usePdfScreenRender({
    canvasRef,
    document,
    pageNumber,
    enabled: true,
    width: host.width,
    height: host.height,
    zoom,
    retry: retry + fitKey,
    onMetrics,
  });

  useEffect(() => {
    const element = hostRef.current;
    if (!element) return;
    const resize = (width: number, height: number) =>
      setHost({ width: Math.floor(width), height: Math.floor(height) });
    const observer = new ResizeObserver(([entry]) =>
      resize(entry.contentRect.width, entry.contentRect.height),
    );
    observer.observe(element);
    const bounds = element.getBoundingClientRect();
    resize(bounds.width, bounds.height);
    return () => observer.disconnect();
  }, [fitKey]);

  useEffect(() => {
    hostRef.current?.scrollTo({ left: 0, top: 0 });
  }, [document, fitKey, pageNumber]);

  useEffect(()=>{
    if(!rendered.isReady||!restorePosition||restoredPositionKey.current===restorePosition.key)return;
    hostRef.current?.scrollTo({left:restorePosition.left,top:restorePosition.top,behavior:"instant"});
    restoredPositionKey.current=restorePosition.key;
  },[rendered.isReady,restorePosition]);

  useEffect(()=>{
    const element=hostRef.current;
    if(!element||!rendered.isReady||!relativePosition||relativePositionKey.current===relativePosition.key)return;
    const left=Math.max(0,element.scrollWidth-element.clientWidth)*Math.max(0,Math.min(1,relativePosition.x));
    const top=Math.max(0,element.scrollHeight-element.clientHeight)*Math.max(0,Math.min(1,relativePosition.y));
    reflectedScroll.current={left,top};
    element.scrollTo({left,top,behavior:"instant"});
    relativePositionKey.current=relativePosition.key;
  },[rendered.isReady,relativePosition]);

  function stopDragging() {
    dragRef.current = null;
    setDragging(false);
  }

  return (
    <div
      aria-busy={!rendered.isReady}
      aria-label={`PDF ${pageNumber}쪽`}
      className={`relative h-full w-full overflow-auto ${panEnabled ? (dragging ? "cursor-grabbing" : "cursor-grab") : ""}`}
      onScroll={event=>{
        const element=event.currentTarget,left=element.scrollLeft,top=element.scrollTop;
        onPositionChange?.({left,top});
        const reflected=reflectedScroll.current;reflectedScroll.current=null;
        // A mirrored scroll must not bounce back into the originating pane.
        if(reflected&&Math.abs(reflected.left-left)<=1&&Math.abs(reflected.top-top)<=1)return;
        if(rendered.isReady)onRelativePositionChange?.({x:left/Math.max(1,element.scrollWidth-element.clientWidth),y:top/Math.max(1,element.scrollHeight-element.clientHeight)});
      }}
      onPointerDown={(event) => {
        if (!panEnabled || !rendered.isReady || event.button !== 0) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        dragRef.current = {
          x: event.clientX,
          y: event.clientY,
          left: event.currentTarget.scrollLeft,
          top: event.currentTarget.scrollTop,
        };
        setDragging(true);
      }}
      onPointerMove={(event) => {
        const drag = dragRef.current;
        if (!drag) return;
        event.preventDefault();
        event.currentTarget.scrollLeft = drag.left - (event.clientX - drag.x);
        event.currentTarget.scrollTop = drag.top - (event.clientY - drag.y);
      }}
      onPointerUp={stopDragging}
      onPointerCancel={stopDragging}
      ref={hostRef}
      style={{ touchAction: panEnabled ? "none" : "auto" }}
    >
      <div
        className="grid place-items-center"
        style={{
          boxSizing: "border-box",
          width: `max(100%, ${rendered.display.width + 48}px)`,
          height: `max(100%, ${rendered.display.height + 140}px)`,
          padding: "44px 24px 96px",
        }}
      >
        <div className="relative w-fit h-fit">
        <canvas
          className="block bg-white shadow-2xl"
          key={rendered.signature}
          ref={canvasRef}
          style={{ visibility: rendered.isReady ? "visible" : "hidden" }}
        />
        {rendered.isReady && overlay}
        </div>
      </div>
      {!rendered.isReady && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          {rendered.phase === "error" ? (
            <button
              className="pointer-events-auto inline-flex items-center gap-2 rounded-md bg-white px-3 py-2 text-sm text-slate-800 shadow"
              onClick={() => setRetry((value) => value + 1)}
              type="button"
            >
              <RotateCcw className="size-4" /> PDF 페이지 다시 시도
            </button>
          ) : (
            <span
              className="rounded bg-slate-950/80 px-3 py-2 text-sm text-white"
              role="status"
            >
              PDF {pageNumber}쪽을 불러오는 중입니다
            </span>
          )}
        </div>
      )}
    </div>
  );
}

export function PdfScreenThumbnail({ document, pageNumber }: ThumbnailProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [active, setActive] = useState(false);
  const rendered = usePdfScreenRender({
    canvasRef,
    document,
    pageNumber,
    enabled: active,
    width: 180,
    retry: 0,
  });

  useEffect(() => {
    const element = hostRef.current;
    if (!element) return;
    if (!("IntersectionObserver" in window)) {
      setActive(true);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        setActive(true);
        observer.disconnect();
      },
      { rootMargin: "120px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      aria-busy={!rendered.isReady}
      aria-label={`PDF ${pageNumber}쪽 미리보기`}
      className="relative grid h-full min-h-0 w-full place-items-center bg-white"
      ref={hostRef}
    >
      <canvas
        className="block max-h-full max-w-full object-contain bg-white"
        key={rendered.signature}
        ref={canvasRef}
        style={{ visibility: rendered.isReady ? "visible" : "hidden" }}
      />
      {!rendered.isReady && (
        <div className="absolute inset-0 grid place-items-center text-center text-xs text-slate-500">
          {rendered.phase === "error" ? (
            <span role="alert">미리보기를 표시할 수 없습니다</span>
          ) : (
            <span role="status">
              PDF {pageNumber}쪽 미리보기를 {active ? "불러오는 중입니다" : "기다리는 중입니다"}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
