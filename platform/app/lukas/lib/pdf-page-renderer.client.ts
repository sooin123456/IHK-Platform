import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

export type OpenPdfDocument = {
  document: PDFDocumentProxy;
  destroy: () => Promise<void>;
};

export type PdfPageRender = {
  canvasSize: { width: number; height: number };
  cleanup: () => void;
};

type RenderPdfPageOptions = {
  document: PDFDocumentProxy;
  pageNumber: number;
  canvas: HTMLCanvasElement;
  hostWidth: number;
  zoom: number;
  signal?: AbortSignal;
};

function abortError() {
  return new DOMException("PDF rendering was cancelled.", "AbortError");
}

export async function openPdfDocument(
  url: string,
  signal?: AbortSignal,
): Promise<OpenPdfDocument> {
  const pdfjs = await import("pdfjs-dist");
  if (signal?.aborted) throw abortError();
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  const loadingTask = pdfjs.getDocument({
    url,
    cMapUrl: "/pdfjs/cmaps/",
    cMapPacked: true,
    standardFontDataUrl: "/pdfjs/standard_fonts/",
  });
  const cancel = () => void loadingTask.destroy();
  signal?.addEventListener("abort", cancel, { once: true });
  if (signal?.aborted) cancel();

  try {
    const document = await loadingTask.promise;
    if (signal?.aborted) {
      await loadingTask.destroy();
      throw abortError();
    }
    return { document, destroy: () => loadingTask.destroy() };
  } finally {
    signal?.removeEventListener("abort", cancel);
  }
}

export async function renderPdfPageToCanvas({
  document,
  pageNumber,
  canvas,
  hostWidth,
  zoom,
  signal,
}: RenderPdfPageOptions): Promise<PdfPageRender> {
  let page: PDFPageProxy | null = null;
  let completed = false;
  let renderTask: RenderTask | null = null;
  const cancel = () => renderTask?.cancel();
  signal?.addEventListener("abort", cancel, { once: true });

  try {
    if (signal?.aborted) throw abortError();
    page = await document.getPage(pageNumber);
    if (signal?.aborted) throw abortError();

    const base = page.getViewport({ scale: 1 });
    const scale = (hostWidth / base.width) * zoom;
    const viewport = page.getViewport({ scale });
    const deviceScale = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.floor(viewport.width * deviceScale);
    canvas.height = Math.floor(viewport.height * deviceScale);
    canvas.style.width = `${viewport.width}px`;
    canvas.style.height = `${viewport.height}px`;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("PDF Canvas를 만들지 못했습니다.");

    renderTask = page.render({
      canvas,
      canvasContext: context,
      viewport,
      transform:
        deviceScale === 1 ? undefined : [deviceScale, 0, 0, deviceScale, 0, 0],
    });
    await renderTask.promise;
    if (signal?.aborted) throw abortError();
    completed = true;
    return {
      canvasSize: { width: viewport.width, height: viewport.height },
      cleanup: () => page?.cleanup(),
    };
  } finally {
    signal?.removeEventListener("abort", cancel);
    if (!completed) page?.cleanup();
  }
}
