export type PdfViewportSize = { width: number; height: number };
export type PdfPixelRegion = {
  x: number;
  y: number;
  width: number;
  height: number;
};
export type PdfNormalizedRegion = PdfPixelRegion;

function assertViewport(viewport: PdfViewportSize) {
  if (
    !Number.isFinite(viewport.width) ||
    !Number.isFinite(viewport.height) ||
    viewport.width <= 0 ||
    viewport.height <= 0
  )
    throw new Error("PDF 화면 크기가 올바르지 않습니다.");
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

export function normalizeRegion(
  region: PdfPixelRegion,
  viewport: PdfViewportSize,
): PdfNormalizedRegion {
  assertViewport(viewport);
  return {
    x: region.x / viewport.width,
    y: region.y / viewport.height,
    width: region.width / viewport.width,
    height: region.height / viewport.height,
  };
}

export function denormalizeRegion(
  region: PdfNormalizedRegion,
  viewport: PdfViewportSize,
): PdfPixelRegion {
  assertViewport(viewport);
  return {
    x: region.x * viewport.width,
    y: region.y * viewport.height,
    width: region.width * viewport.width,
    height: region.height * viewport.height,
  };
}

export function normalizeDragRegion(
  start: { x: number; y: number },
  end: { x: number; y: number },
  viewport: PdfViewportSize,
): PdfNormalizedRegion | null {
  assertViewport(viewport);
  const startX = clamp(start.x, 0, viewport.width);
  const startY = clamp(start.y, 0, viewport.height);
  const endX = clamp(end.x, 0, viewport.width);
  const endY = clamp(end.y, 0, viewport.height);
  const pixelRegion = {
    x: Math.min(startX, endX),
    y: Math.min(startY, endY),
    width: Math.abs(endX - startX),
    height: Math.abs(endY - startY),
  };
  if (pixelRegion.width < 4 || pixelRegion.height < 4) return null;
  return normalizeRegion(pixelRegion, viewport);
}
