const CACHE_NAME = "drawing-pdf-raster-v1";
const CACHE_SCHEMA = "1";

export type DrawingPdfRasterCacheInput = {
  renderProfile: "first-visible-v1";
  slot: "current" | "previous";
  sourceFileId: string;
  sourceSha256: string;
  pageNumber: number;
  hostWidth: number;
  zoom: number;
  deviceScale: number;
};

export type DrawingPdfRasterPayload = {
  blob: Blob;
  canvasPixelWidth: number;
  canvasPixelHeight: number;
  canvasSize: { width: number; height: number };
  pageViewport: { width: number; height: number; rotation: number };
};

type RasterCache = {
  delete(key: string): Promise<boolean>;
  match(key: string): Promise<Response | undefined>;
  put(key: string, response: Response): Promise<void>;
};

type RasterCacheStorage = {
  open(name: string): Promise<RasterCache>;
};

function positive(value: number, label: string) {
  if (!Number.isFinite(value) || value <= 0)
    throw new Error(`${label} must be positive`);
  return value;
}

function exactSha256(value: string) {
  if (!/^[0-9a-f]{64}$/.test(value))
    throw new Error("PDF raster identity requires a lowercase SHA-256");
  return value;
}

function numberHeader(headers: Headers, name: string, positiveOnly = true) {
  const raw = headers.get(name);
  if (raw === null) return null;
  const value = Number(raw);
  if (!Number.isFinite(value) || (positiveOnly && value <= 0)) return null;
  return value;
}

async function sha256(value: Blob | string) {
  const bytes =
    typeof value === "string"
      ? new TextEncoder().encode(value)
      : await value.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function drawingPdfRasterCacheKey(input: DrawingPdfRasterCacheInput) {
  exactSha256(input.sourceSha256);
  if (!input.sourceFileId.trim())
    throw new Error("PDF raster identity requires a source file id");
  if (!Number.isInteger(input.pageNumber) || input.pageNumber < 1)
    throw new Error("PDF raster page must be a positive integer");
  positive(input.hostWidth, "PDF raster width");
  positive(input.zoom, "PDF raster zoom");
  positive(input.deviceScale, "PDF raster DPR");
  return `/__drawing-pdf-raster-cache/v1/${input.renderProfile}/${input.slot}/${encodeURIComponent(input.sourceFileId)}/${input.sourceSha256}/${input.pageNumber}/${input.hostWidth}/${input.zoom.toFixed(3)}/${input.deviceScale.toFixed(3)}`;
}

export async function drawingPdfRasterCacheKeySha256(
  input: DrawingPdfRasterCacheInput,
) {
  return sha256(drawingPdfRasterCacheKey(input));
}

export async function readDrawingPdfRasterCache(
  storage: RasterCacheStorage | null,
  input: DrawingPdfRasterCacheInput,
): Promise<
  (DrawingPdfRasterPayload & { cacheKey: string; keySha256: string }) | null
> {
  if (!storage) return null;
  let cache: RasterCache | null = null;
  let key = "";
  try {
    key = drawingPdfRasterCacheKey(input);
    cache = await storage.open(CACHE_NAME);
    const response = await cache.match(key);
    if (!response) return null;
    const headers = response.headers;
    const blob = await response.blob();
    const contentSha256 = await sha256(blob);
    const canvasPixelWidth = numberHeader(
      headers,
      "x-drawing-canvas-pixel-width",
    );
    const canvasPixelHeight = numberHeader(
      headers,
      "x-drawing-canvas-pixel-height",
    );
    const canvasWidth = numberHeader(headers, "x-drawing-canvas-width");
    const canvasHeight = numberHeader(headers, "x-drawing-canvas-height");
    const pageWidth = numberHeader(headers, "x-drawing-page-width");
    const pageHeight = numberHeader(headers, "x-drawing-page-height");
    const rotation = numberHeader(headers, "x-drawing-page-rotation", false);
    const valid =
      headers.get("content-type") === "image/png" &&
      headers.get("x-drawing-cache-schema") === CACHE_SCHEMA &&
      headers.get("x-drawing-render-profile") === input.renderProfile &&
      headers.get("x-drawing-cache-slot") === input.slot &&
      headers.get("x-drawing-source-file-id") === input.sourceFileId &&
      headers.get("x-drawing-source-sha256") === input.sourceSha256 &&
      Number(headers.get("x-drawing-page-number")) === input.pageNumber &&
      Number(headers.get("x-drawing-host-width")) === input.hostWidth &&
      Number(headers.get("x-drawing-zoom")) === input.zoom &&
      Number(headers.get("x-drawing-device-scale")) === input.deviceScale &&
      headers.get("x-drawing-content-sha256") === contentSha256 &&
      canvasPixelWidth !== null &&
      canvasPixelHeight !== null &&
      canvasWidth !== null &&
      canvasHeight !== null &&
      pageWidth !== null &&
      pageHeight !== null &&
      rotation !== null;
    if (!valid) {
      await cache.delete(key);
      return null;
    }
    return {
      blob,
      canvasPixelWidth,
      canvasPixelHeight,
      canvasSize: { width: canvasWidth, height: canvasHeight },
      pageViewport: { width: pageWidth, height: pageHeight, rotation },
      cacheKey: key,
      keySha256: await sha256(key),
    };
  } catch {
    if (cache && key) await cache.delete(key).catch(() => false);
    return null;
  }
}

export async function writeDrawingPdfRasterCache(
  storage: RasterCacheStorage | null,
  input: DrawingPdfRasterCacheInput,
  payload: DrawingPdfRasterPayload,
) {
  if (!storage) return false;
  try {
    const key = drawingPdfRasterCacheKey(input);
    const contentSha256 = await sha256(payload.blob);
    const headers = new Headers({
      "content-type": "image/png",
      "x-drawing-cache-schema": CACHE_SCHEMA,
      "x-drawing-render-profile": input.renderProfile,
      "x-drawing-cache-slot": input.slot,
      "x-drawing-source-file-id": input.sourceFileId,
      "x-drawing-source-sha256": input.sourceSha256,
      "x-drawing-page-number": String(input.pageNumber),
      "x-drawing-host-width": String(input.hostWidth),
      "x-drawing-zoom": String(input.zoom),
      "x-drawing-device-scale": String(input.deviceScale),
      "x-drawing-content-sha256": contentSha256,
      "x-drawing-canvas-pixel-width": String(payload.canvasPixelWidth),
      "x-drawing-canvas-pixel-height": String(payload.canvasPixelHeight),
      "x-drawing-canvas-width": String(
        positive(payload.canvasSize.width, "canvas width"),
      ),
      "x-drawing-canvas-height": String(
        positive(payload.canvasSize.height, "canvas height"),
      ),
      "x-drawing-page-width": String(
        positive(payload.pageViewport.width, "page width"),
      ),
      "x-drawing-page-height": String(
        positive(payload.pageViewport.height, "page height"),
      ),
      "x-drawing-page-rotation": String(payload.pageViewport.rotation),
    });
    const cache = await storage.open(CACHE_NAME);
    await cache.put(key, new Response(payload.blob, { headers }));
    return true;
  } catch {
    return false;
  }
}

export async function deleteDrawingPdfRasterCache(
  storage: RasterCacheStorage | null,
  input: DrawingPdfRasterCacheInput,
) {
  if (!storage) return false;
  try {
    const cache = await storage.open(CACHE_NAME);
    return cache.delete(drawingPdfRasterCacheKey(input));
  } catch {
    return false;
  }
}
