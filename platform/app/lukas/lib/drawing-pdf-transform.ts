import { containPdfSource } from "./drawing-geometry.ts";
import type { PdfNormalizedRegion, PdfViewportSize } from "./pdf-anchor.ts";
import type { Bounds, Point } from "./drawing-workspace.types.ts";

export type DrawingPdfRotation = 0 | 90 | 180 | 270;

/** Coordinates are normalized against the already-rotated PDF.js viewport. */
export type DrawingPdfPageTransform = {
  pageNumber: number;
  rotation: DrawingPdfRotation;
  pdfViewport: PdfViewportSize;
  worldBounds: Bounds;
};

function finite(value: number) {
  return Number.isFinite(value);
}

function assertUnit(value: number, label: string) {
  if (!finite(value) || value < 0 || value > 1)
    throw new Error(`${label} must be normalized to [0,1].`);
}

function assertRegion(region: PdfNormalizedRegion) {
  assertUnit(region.x, "PDF region x");
  assertUnit(region.y, "PDF region y");
  if (
    !finite(region.width) ||
    !finite(region.height) ||
    region.width <= 0 ||
    region.height <= 0 ||
    region.x + region.width > 1 ||
    region.y + region.height > 1
  )
    throw new Error("PDF region must be non-empty and clipped to [0,1].");
}

function assertTransform(transform: DrawingPdfPageTransform) {
  if (!Number.isInteger(transform.pageNumber) || transform.pageNumber <= 0)
    throw new Error("PDF page number must be positive.");
  if (![0, 90, 180, 270].includes(transform.rotation))
    throw new Error("PDF rotation must be 0, 90, 180, or 270 degrees.");
  containPdfSource(transform.pdfViewport, transform.worldBounds);
}

export function createDrawingPdfPageTransform(input: {
  pageNumber: number;
  rotation: number;
  pdfViewport: PdfViewportSize;
  worldViewport: Bounds;
}): DrawingPdfPageTransform {
  const transform = {
    pageNumber: input.pageNumber,
    rotation: input.rotation as DrawingPdfRotation,
    pdfViewport: { ...input.pdfViewport },
    worldBounds: containPdfSource(input.pdfViewport, input.worldViewport),
  };
  assertTransform(transform);
  return transform;
}

export function pdfNormalizedPointToWorld(
  transform: DrawingPdfPageTransform,
  point: Point,
): Point {
  assertTransform(transform);
  assertUnit(point.x, "PDF point x");
  assertUnit(point.y, "PDF point y");
  return {
    x: transform.worldBounds.x + point.x * transform.worldBounds.width,
    y: transform.worldBounds.y + point.y * transform.worldBounds.height,
  };
}

export function pdfNormalizedRegionToWorldBounds(
  transform: DrawingPdfPageTransform,
  region: PdfNormalizedRegion,
): Bounds {
  assertTransform(transform);
  assertRegion(region);
  return {
    x: transform.worldBounds.x + region.x * transform.worldBounds.width,
    y: transform.worldBounds.y + region.y * transform.worldBounds.height,
    width: region.width * transform.worldBounds.width,
    height: region.height * transform.worldBounds.height,
  };
}

export function worldBoundsToPdfNormalizedRegion(
  transform: DrawingPdfPageTransform,
  bounds: Bounds,
): PdfNormalizedRegion | null {
  assertTransform(transform);
  if (
    !finite(bounds.x) ||
    !finite(bounds.y) ||
    !finite(bounds.width) ||
    !finite(bounds.height) ||
    bounds.width < 0 ||
    bounds.height < 0
  )
    throw new Error("World bounds must be finite and non-negative.");
  const left = Math.max(bounds.x, transform.worldBounds.x);
  const top = Math.max(bounds.y, transform.worldBounds.y);
  const right = Math.min(
    bounds.x + bounds.width,
    transform.worldBounds.x + transform.worldBounds.width,
  );
  const bottom = Math.min(
    bounds.y + bounds.height,
    transform.worldBounds.y + transform.worldBounds.height,
  );
  if (right <= left || bottom <= top) return null;
  return {
    x: (left - transform.worldBounds.x) / transform.worldBounds.width,
    y: (top - transform.worldBounds.y) / transform.worldBounds.height,
    width: (right - left) / transform.worldBounds.width,
    height: (bottom - top) / transform.worldBounds.height,
  };
}
