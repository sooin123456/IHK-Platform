import assert from "node:assert/strict";
import test from "node:test";

const rasterCache =
  await import("../app/lukas/lib/drawing-pdf-raster-cache.client.ts").catch(
    () => ({}),
  );
const { resolveDrawingPdfRasterSource } =
  await import("../app/lukas/lib/drawing-pdf-raster-identity.ts");

const input = {
  renderProfile: "first-visible-v1",
  slot: "current",
  sourceFileId: "10000000-0000-4000-8000-000000000001",
  sourceSha256: "a".repeat(64),
  pageNumber: 1,
  hostWidth: 1024,
  zoom: 1,
  deviceScale: 2,
};

function memoryStorage() {
  const entries = new Map();
  let deletes = 0;
  const cache = {
    async delete(key) {
      deletes += 1;
      return entries.delete(key);
    },
    async match(key) {
      return entries.get(key)?.clone();
    },
    async put(key, response) {
      entries.set(key, response.clone());
    },
  };
  return {
    storage: {
      async open() {
        return cache;
      },
    },
    entries,
    get deletes() {
      return deletes;
    },
  };
}

test("derived PDF raster cache is keyed by immutable identity and validates content", async () => {
  assert.equal(typeof rasterCache.drawingPdfRasterCacheKey, "function");
  assert.equal(typeof rasterCache.writeDrawingPdfRasterCache, "function");
  assert.equal(typeof rasterCache.readDrawingPdfRasterCache, "function");
  const key = rasterCache.drawingPdfRasterCacheKey(input);
  assert.match(key, /\/current\//);
  assert.match(key, /a{64}/);
  assert.doesNotMatch(key, /signed|token|__p5-current/);

  const memory = memoryStorage();
  const blob = new Blob(["real rendered pixels"], { type: "image/png" });
  assert.equal(
    await rasterCache.writeDrawingPdfRasterCache(memory.storage, input, {
      blob,
      canvasPixelWidth: 3200,
      canvasPixelHeight: 2400,
      canvasSize: { width: 1600, height: 1200 },
      pageViewport: { width: 800, height: 600, rotation: 0 },
    }),
    true,
  );
  const restored = await rasterCache.readDrawingPdfRasterCache(
    memory.storage,
    input,
  );
  assert.equal(await restored.blob.text(), "real rendered pixels");
  assert.deepEqual(restored.canvasSize, { width: 1600, height: 1200 });
  assert.equal(restored.cacheKey, key);
  assert.match(restored.keySha256, /^[0-9a-f]{64}$/);

  const response = memory.entries.get(key);
  const headers = new Headers(response.headers);
  headers.set("x-drawing-content-sha256", "0".repeat(64));
  memory.entries.set(key, new Response(await response.blob(), { headers }));
  assert.equal(
    await rasterCache.readDrawingPdfRasterCache(memory.storage, input),
    null,
  );
  assert.equal(memory.deletes, 1);
});

test("derived PDF raster cache fails closed when storage or identity is unavailable", async () => {
  assert.equal(await rasterCache.readDrawingPdfRasterCache(null, input), null);
  assert.equal(
    await rasterCache.writeDrawingPdfRasterCache(null, input, {
      blob: new Blob(["x"], { type: "image/png" }),
      canvasPixelWidth: 1,
      canvasPixelHeight: 1,
      canvasSize: { width: 1, height: 1 },
      pageViewport: { width: 1, height: 1, rotation: 0 },
    }),
    false,
  );
  assert.throws(
    () => rasterCache.drawingPdfRasterCacheKey({ ...input, sourceSha256: "x" }),
    /SHA-256/,
  );
});

test("PDF raster identity cannot attach an IFC file to a fallback URL", () => {
  assert.equal(
    resolveDrawingPdfRasterSource({
      bundledPdf: null,
      fallbackSignedUrl: "/an-ifc-source",
      workspaceFile: { id: "ifc", kind: "ifc", sha256: "b".repeat(64) },
    }),
    null,
  );
  assert.deepEqual(
    resolveDrawingPdfRasterSource({
      bundledPdf: null,
      fallbackSignedUrl: "/actual-pdf",
      workspaceFile: { id: "pdf", kind: "pdf", sha256: "c".repeat(64) },
    }),
    {
      id: "pdf",
      kind: "pdf",
      sha256: "c".repeat(64),
      signedUrl: "/actual-pdf",
    },
  );
});
