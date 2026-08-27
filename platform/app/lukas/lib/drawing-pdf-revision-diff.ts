import type { PdfNormalizedRegion, PdfViewportSize } from "./pdf-anchor.ts";

export const DRAWING_PDF_DIFF_TILE_SIZE = 32;
export const DRAWING_PDF_DIFF_THRESHOLD = 32;
export const DRAWING_PDF_DIFF_MAX_EDGE = 1024;
export const DRAWING_PDF_DIFF_MAX_MARKERS = 256;

export type DrawingPdfDiffPage = {
  rotation: number;
  viewport: PdfViewportSize;
  pixels: {
    width: number;
    height: number;
    data: Uint8Array | Uint8ClampedArray;
  };
};

export type DrawingPdfDiffMarker = PdfNormalizedRegion & {
  label: "브라우저 미리보기";
};

export type DrawingPdfDiffResult =
  | { status: "ready"; markers: DrawingPdfDiffMarker[] }
  | {
      status: "refused";
      reason: "rotation_mismatch" | "aspect_mismatch";
      markers: [];
    };

type ChangedTile = { x: number; y: number };

function abortError() {
  return new DOMException("PDF diff was cancelled.", "AbortError");
}

function checkCancellation(input: {
  signal?: AbortSignal;
  generation?: { requested: number; current: () => number };
}) {
  if (
    input.signal?.aborted ||
    (input.generation &&
      input.generation.requested !== input.generation.current())
  )
    throw abortError();
}

function finalizeResult(
  input: {
    signal?: AbortSignal;
    generation?: { requested: number; current: () => number };
  },
  result: DrawingPdfDiffResult,
) {
  checkCancellation(input);
  return result;
}

function validatePage(page: DrawingPdfDiffPage) {
  const { width, height, data } = page.pixels;
  if (
    ![0, 90, 180, 270].includes(page.rotation) ||
    !Number.isFinite(page.viewport.width) ||
    !Number.isFinite(page.viewport.height) ||
    page.viewport.width <= 0 ||
    page.viewport.height <= 0 ||
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width <= 0 ||
    height <= 0 ||
    Math.max(width, height) > DRAWING_PDF_DIFF_MAX_EDGE ||
    (!(data instanceof Uint8Array) && !(data instanceof Uint8ClampedArray)) ||
    data.length !== width * height * 4
  )
    throw new Error("PDF diff raster is invalid or exceeds 1024 pixels.");
}

function premultipliedChannel(
  data: ArrayLike<number>,
  index: number,
  alpha: number,
) {
  return (data[index] * alpha) / 255;
}

function changedPixel(
  previous: ArrayLike<number>,
  current: ArrayLike<number>,
  index: number,
) {
  const previousAlpha = previous[index + 3];
  const currentAlpha = current[index + 3];
  if (Math.abs(previousAlpha - currentAlpha) > DRAWING_PDF_DIFF_THRESHOLD)
    return true;
  for (let channel = 0; channel < 3; channel += 1)
    if (
      Math.abs(
        premultipliedChannel(previous, index + channel, previousAlpha) -
          premultipliedChannel(current, index + channel, currentAlpha),
      ) > DRAWING_PDF_DIFF_THRESHOLD
    )
      return true;
  return false;
}

function changedTiles(
  previous: DrawingPdfDiffPage,
  current: DrawingPdfDiffPage,
  cancellation: {
    signal?: AbortSignal;
    generation?: { requested: number; current: () => number };
  },
) {
  const result: ChangedTile[] = [];
  const width = current.pixels.width;
  const height = current.pixels.height;
  for (let tileY = 0; tileY < height; tileY += DRAWING_PDF_DIFF_TILE_SIZE) {
    checkCancellation(cancellation);
    for (let tileX = 0; tileX < width; tileX += DRAWING_PDF_DIFF_TILE_SIZE) {
      let count = 0;
      const right = Math.min(width, tileX + DRAWING_PDF_DIFF_TILE_SIZE);
      const bottom = Math.min(height, tileY + DRAWING_PDF_DIFF_TILE_SIZE);
      changed: for (let y = tileY; y < bottom; y += 1)
        for (let x = tileX; x < right; x += 1) {
          const index = (y * width + x) * 4;
          if (
            changedPixel(previous.pixels.data, current.pixels.data, index) &&
            ++count >= 4
          )
            break changed;
        }
      if (count >= 4)
        result.push({
          x: tileX / DRAWING_PDF_DIFF_TILE_SIZE,
          y: tileY / DRAWING_PDF_DIFF_TILE_SIZE,
        });
    }
  }
  return result;
}

function mergeTiles(
  tiles: ChangedTile[],
  width: number,
  height: number,
  cancellation: {
    signal?: AbortSignal;
    generation?: { requested: number; current: () => number };
  },
) {
  const remaining = new Set(tiles.map((tile) => `${tile.x}:${tile.y}`));
  const markers: DrawingPdfDiffMarker[] = [];
  for (const first of tiles) {
    const firstKey = `${first.x}:${first.y}`;
    if (!remaining.delete(firstKey)) continue;
    checkCancellation(cancellation);
    const queue = [first];
    let minimumX = first.x;
    let minimumY = first.y;
    let maximumX = first.x;
    let maximumY = first.y;
    for (let index = 0; index < queue.length; index += 1) {
      const tile = queue[index];
      for (const neighbor of [
        { x: tile.x - 1, y: tile.y },
        { x: tile.x + 1, y: tile.y },
        { x: tile.x, y: tile.y - 1 },
        { x: tile.x, y: tile.y + 1 },
      ]) {
        const key = `${neighbor.x}:${neighbor.y}`;
        if (!remaining.delete(key)) continue;
        queue.push(neighbor);
        minimumX = Math.min(minimumX, neighbor.x);
        minimumY = Math.min(minimumY, neighbor.y);
        maximumX = Math.max(maximumX, neighbor.x);
        maximumY = Math.max(maximumY, neighbor.y);
      }
    }
    const left = minimumX * DRAWING_PDF_DIFF_TILE_SIZE;
    const top = minimumY * DRAWING_PDF_DIFF_TILE_SIZE;
    const right = Math.min(width, (maximumX + 1) * DRAWING_PDF_DIFF_TILE_SIZE);
    const bottom = Math.min(
      height,
      (maximumY + 1) * DRAWING_PDF_DIFF_TILE_SIZE,
    );
    markers.push({
      x: left / width,
      y: top / height,
      width: (right - left) / width,
      height: (bottom - top) / height,
      label: "브라우저 미리보기",
    });
    if (markers.length === DRAWING_PDF_DIFF_MAX_MARKERS) break;
  }
  return markers;
}

/** Pure, synchronous kernel over equal origin-clean RGBA rasters. */
export function computeDrawingPdfRevisionDiff(input: {
  previous: DrawingPdfDiffPage;
  current: DrawingPdfDiffPage;
  signal?: AbortSignal;
  generation?: { requested: number; current: () => number };
}): DrawingPdfDiffResult {
  checkCancellation(input);
  validatePage(input.previous);
  validatePage(input.current);
  if (input.previous.rotation !== input.current.rotation)
    return finalizeResult(input, {
      status: "refused",
      reason: "rotation_mismatch",
      markers: [],
    });
  const previousAspect =
    input.previous.viewport.width / input.previous.viewport.height;
  const currentAspect =
    input.current.viewport.width / input.current.viewport.height;
  if (
    Math.abs(previousAspect - currentAspect) /
      Math.max(previousAspect, currentAspect) >
    0.01 + Number.EPSILON * 8
  )
    return finalizeResult(input, {
      status: "refused",
      reason: "aspect_mismatch",
      markers: [],
    });
  if (
    input.previous.pixels.width !== input.current.pixels.width ||
    input.previous.pixels.height !== input.current.pixels.height
  )
    throw new Error("PDF diff rasters must have equal dimensions.");
  const tiles = changedTiles(input.previous, input.current, input);
  const result: DrawingPdfDiffResult = {
    status: "ready",
    markers: mergeTiles(
      tiles,
      input.current.pixels.width,
      input.current.pixels.height,
      input,
    ),
  };
  return finalizeResult(input, result);
}
