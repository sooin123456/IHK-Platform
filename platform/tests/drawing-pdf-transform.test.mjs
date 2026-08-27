import assert from "node:assert/strict";
import test from "node:test";

import {
  createDrawingPdfPageTransform,
  pdfNormalizedPointToWorld,
  pdfNormalizedRegionToWorldBounds,
  worldBoundsToPdfNormalizedRegion,
} from "../app/lukas/lib/drawing-pdf-transform.ts";

test("PDF transforms use the rotated PDF.js viewport and exact contain-fit letterboxing", () => {
  const horizontal = createDrawingPdfPageTransform({
    pageNumber: 2,
    rotation: 0,
    pdfViewport: { width: 200, height: 100 },
    worldViewport: { x: 10, y: 20, width: 200, height: 200 },
  });
  assert.deepEqual(horizontal.worldBounds, {
    x: 10,
    y: 70,
    width: 200,
    height: 100,
  });
  assert.deepEqual(pdfNormalizedPointToWorld(horizontal, { x: 1, y: 1 }), {
    x: 210,
    y: 170,
  });

  const vertical = createDrawingPdfPageTransform({
    pageNumber: 2,
    rotation: 90,
    pdfViewport: { width: 100, height: 200 },
    worldViewport: { x: 10, y: 20, width: 200, height: 200 },
  });
  assert.deepEqual(vertical.worldBounds, {
    x: 60,
    y: 20,
    width: 100,
    height: 200,
  });
});

test("rotations 0/90/180/270 preserve the rotated top-left PDF.js convention", () => {
  for (const [rotation, width, height] of [
    [0, 200, 100],
    [90, 100, 200],
    [180, 200, 100],
    [270, 100, 200],
  ]) {
    const transform = createDrawingPdfPageTransform({
      pageNumber: 1,
      rotation,
      pdfViewport: { width, height },
      worldViewport: { x: 0, y: 0, width, height },
    });
    assert.deepEqual(
      pdfNormalizedPointToWorld(transform, { x: 0.25, y: 0.75 }),
      { x: width * 0.25, y: height * 0.75 },
    );
  }
  assert.throws(() =>
    createDrawingPdfPageTransform({
      pageNumber: 1,
      rotation: 45,
      pdfViewport: { width: 100, height: 100 },
      worldViewport: { x: 0, y: 0, width: 100, height: 100 },
    }),
  );
});

test("PDF region transforms are precise inverses at normalized boundaries", () => {
  const transform = createDrawingPdfPageTransform({
    pageNumber: 1,
    rotation: 270,
    pdfViewport: { width: 100, height: 200 },
    worldViewport: { x: -40, y: 30, width: 300, height: 200 },
  });
  const region = {
    x: 0.123456789,
    y: 0.234567891,
    width: 0.345678912,
    height: 0.456789123,
  };
  const world = pdfNormalizedRegionToWorldBounds(transform, region);
  const inverse = worldBoundsToPdfNormalizedRegion(transform, world);
  for (const key of ["x", "y", "width", "height"])
    assert.ok(Math.abs(inverse[key] - region[key]) < 1e-12);

  assert.deepEqual(
    pdfNormalizedRegionToWorldBounds(transform, {
      x: 0,
      y: 0,
      width: 1,
      height: 1,
    }),
    transform.worldBounds,
  );
});

test("world bounds are clipped to the PDF image and empty intersections are rejected", () => {
  const transform = createDrawingPdfPageTransform({
    pageNumber: 1,
    rotation: 0,
    pdfViewport: { width: 200, height: 100 },
    worldViewport: { x: 10, y: 20, width: 200, height: 200 },
  });
  assert.deepEqual(
    worldBoundsToPdfNormalizedRegion(transform, {
      x: 0,
      y: 60,
      width: 30,
      height: 30,
    }),
    { x: 0, y: 0, width: 0.1, height: 0.2 },
  );
  assert.equal(
    worldBoundsToPdfNormalizedRegion(transform, {
      x: 0,
      y: 0,
      width: 10,
      height: 10,
    }),
    null,
  );
  assert.equal(
    worldBoundsToPdfNormalizedRegion(transform, {
      x: 210,
      y: 80,
      width: 10,
      height: 10,
    }),
    null,
  );
});
