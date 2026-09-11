import { useEffect, useRef, useState, type RefObject } from "react";

import type { PDFDocumentProxy } from "pdfjs-dist";

import {
  calculatePdfRenderDensity,
  calculatePdfScreenLayout,
} from "~/lukas/lib/drawing-pdf-screen-layout";
import { renderPdfPageToCanvas } from "~/lukas/lib/pdf-page-renderer.client";

type Options = {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  document: PDFDocumentProxy;
  pageNumber: number;
  enabled: boolean;
  width: number;
  height?: number;
  zoom?: number;
  retry: number;
  onMetrics?: (metrics: {
    widthPoints: number;
    heightPoints: number;
    rotation: number;
  }) => void;
};

const ids = new WeakMap<PDFDocumentProxy, number>();
let nextId = 1;

function idFor(document: PDFDocumentProxy) {
  let id = ids.get(document);
  if (!id) {
    id = nextId++;
    ids.set(document, id);
  }
  return id;
}

function isCancellation(error: unknown) {
  return (
    (error instanceof Error && error.name === "RenderingCancelledException") ||
    (error instanceof DOMException && error.name === "AbortError")
  );
}

export function usePdfScreenRender({
  canvasRef,
  document,
  pageNumber,
  enabled,
  width,
  height,
  zoom = 1,
  retry,
  onMetrics,
}: Options) {
  const generationRef = useRef(0);
  const metricsRef = useRef(onMetrics);
  const [phase, setPhase] = useState<"waiting" | "loading" | "ready" | "error">(
    enabled ? "loading" : "waiting",
  );
  const [readySignature, setReadySignature] = useState<string | null>(null);
  const [display, setDisplay] = useState({ width: 0, height: 0 });
  metricsRef.current = onMetrics;
  const signature = `${idFor(document)}:${pageNumber}:${width}:${height ?? "thumb"}:${zoom}:${retry}`;
  const visiblePhase = enabled && phase === "waiting" ? "loading" : phase;
  const isReady = visiblePhase === "ready" && readySignature === signature;

  useEffect(() => {
    if (!enabled || width <= 0 || (height !== undefined && height <= 0)) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const controller = new AbortController();
    const generation = ++generationRef.current;
    let cleanup: (() => void) | undefined;
    setPhase("loading");
    setReadySignature(null);
    setDisplay({ width: 0, height: 0 });
    canvas.width = 1;
    canvas.height = 1;

    void document
      .getPage(pageNumber)
      .then(async (page) => {
        if (controller.signal.aborted) {
          page.cleanup();
          return;
        }
        const viewport = page.getViewport({ scale: 1 });
        page.cleanup();
        const deviceScale = Math.min(window.devicePixelRatio || 1, 2);
        const screen =
          height === undefined
            ? null
            : calculatePdfScreenLayout({
                pageWidth: viewport.width,
                pageHeight: viewport.height,
                hostWidth: width,
                hostHeight: height,
                zoom,
                deviceScale,
              });
        const displayScale = screen?.displayScale ?? width / viewport.width;
        const density =
          screen ??
          calculatePdfRenderDensity({
            pageWidth: viewport.width,
            pageHeight: viewport.height,
            displayScale,
            deviceScale,
          });
        metricsRef.current?.({
          widthPoints: viewport.width,
          heightPoints: viewport.height,
          rotation: viewport.rotation,
        });
        const rendered = await renderPdfPageToCanvas({
          document,
          pageNumber,
          canvas,
          hostWidth: viewport.width * density.renderCssScale,
          zoom: 1,
          signal: controller.signal,
        });
        cleanup = rendered.cleanup;
        if (controller.signal.aborted || generationRef.current !== generation) {
          cleanup();
          cleanup = undefined;
          return;
        }
        const displaySize = screen?.displaySize ?? {
          width,
          height: viewport.height * displayScale,
        };
        canvas.style.width = `${displaySize.width}px`;
        canvas.style.height = `${displaySize.height}px`;
        setDisplay(displaySize);
        setReadySignature(signature);
        setPhase("ready");
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted && !isCancellation(error)) setPhase("error");
      });

    return () => {
      controller.abort();
      cleanup?.();
    };
  }, [canvasRef, document, enabled, height, pageNumber, retry, signature, width, zoom]);

  return { display, isReady, phase: visiblePhase, signature };
}
