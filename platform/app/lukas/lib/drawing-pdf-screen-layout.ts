export type PdfScreenLayout = {
  fitScale: number;
  displayScale: number;
  renderCssScale: number;
  displaySize: { width: number; height: number };
  backingSize: { width: number; height: number };
};

type PdfScreenLayoutInput = {
  pageWidth: number;
  pageHeight: number;
  hostWidth: number;
  hostHeight: number;
  zoom: number;
  deviceScale: number;
  maxBackingEdge?: number;
  maxBackingPixels?: number;
};

type PdfRenderDensityInput = {
  pageWidth: number;
  pageHeight: number;
  displayScale: number;
  deviceScale: number;
  maxBackingEdge?: number;
  maxBackingPixels?: number;
};

const BLANK_LAYOUT: PdfScreenLayout = {
  fitScale: 0,
  displayScale: 0,
  renderCssScale: 0,
  displaySize: { width: 0, height: 0 },
  backingSize: { width: 0, height: 0 },
};

export function calculatePdfScreenLayout({
  pageWidth,
  pageHeight,
  hostWidth,
  hostHeight,
  zoom,
  deviceScale,
  maxBackingEdge = 4096,
  maxBackingPixels = 16_000_000,
}: PdfScreenLayoutInput): PdfScreenLayout {
  if (
    ![pageWidth, pageHeight, hostWidth, hostHeight, zoom, deviceScale].every(
      (value) => Number.isFinite(value) && value > 0,
    )
  )
    return BLANK_LAYOUT;

  const fitScale = Math.min(
    Math.max(1, hostWidth - 48) / pageWidth,
    Math.max(1, hostHeight - 140) / pageHeight,
  );
  const displayScale = fitScale * zoom;
  const displayWidth = pageWidth * displayScale;
  const displayHeight = pageHeight * displayScale;
  const density = calculatePdfRenderDensity({
    pageWidth,
    pageHeight,
    displayScale,
    deviceScale,
    maxBackingEdge,
    maxBackingPixels,
  });

  return {
    fitScale,
    displayScale,
    ...density,
    displaySize: { width: displayWidth, height: displayHeight },
  };
}

export function calculatePdfRenderDensity({
  pageWidth,
  pageHeight,
  displayScale,
  deviceScale,
  maxBackingEdge = 4096,
  maxBackingPixels = 16_000_000,
}: PdfRenderDensityInput) {
  const requestedWidth = pageWidth * displayScale * deviceScale;
  const requestedHeight = pageHeight * displayScale * deviceScale;
  const cap = Math.min(
    1,
    maxBackingEdge / requestedWidth,
    maxBackingEdge / requestedHeight,
    Math.sqrt(maxBackingPixels / (requestedWidth * requestedHeight)),
  );
  const renderCssScale = displayScale * cap;

  return {
    renderCssScale,
    backingSize: {
      width: Math.max(
        1,
        Math.min(
          maxBackingEdge,
          Math.floor(pageWidth * renderCssScale * deviceScale),
        ),
      ),
      height: Math.max(
        1,
        Math.min(
          maxBackingEdge,
          Math.floor(pageHeight * renderCssScale * deviceScale),
        ),
      ),
    },
  };
}
