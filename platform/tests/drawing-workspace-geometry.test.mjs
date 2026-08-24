import assert from "node:assert/strict";
import test from "node:test";
import {
  calibratePdf,
  geometryBounds,
  screenToWorld,
  snapWorldPoint,
  worldToScreen,
} from "../app/lukas/lib/drawing-geometry.ts";
import { DrawingGeometrySchema } from "../app/lukas/lib/drawing-workspace.types.ts";

test("world coordinates round-trip independently from viewport pixels", () => {
  const viewport = { x: 120, y: -40, zoom: 2 };
  const world = { x: 1500, y: 900 };
  assert.deepEqual(
    screenToWorld(worldToScreen(world, viewport), viewport),
    world,
  );
});

test("PDF calibration converts normalized page distance to millimeters", () => {
  const calibration = calibratePdf(
    { x: 0.1, y: 0.2 },
    { x: 0.6, y: 0.2 },
    5000,
  );
  assert.equal(calibration.millimetersPerNormalizedUnit, 10000);
});

test("snapping uses a screen-pixel tolerance converted through zoom", () => {
  assert.deepEqual(
    snapWorldPoint({ x: 98, y: 202 }, [{ x: 100, y: 200 }], {
      gridSize: 50,
      tolerancePixels: 8,
      zoom: 2,
    }),
    { point: { x: 100, y: 200 }, kind: "object" },
  );
});

test("geometry bounds enclose every P0/P1 geometry", () => {
  const cases = [
    [
      { type: "line", start: { x: 4, y: 8 }, end: { x: 1, y: 2 } },
      { x: 1, y: 2, width: 3, height: 6 },
    ],
    [
      {
        type: "polyline",
        points: [
          { x: 4, y: 8 },
          { x: 1, y: 2 },
          { x: 6, y: 3 },
        ],
        closed: false,
      },
      { x: 1, y: 2, width: 5, height: 6 },
    ],
    [
      {
        type: "rectangle",
        origin: { x: 2, y: 3 },
        width: 5,
        height: 7,
        rotation: 0,
      },
      { x: 2, y: 3, width: 5, height: 7 },
    ],
    [
      { type: "circle", center: { x: 4, y: 6 }, radius: 3 },
      { x: 1, y: 3, width: 6, height: 6 },
    ],
    [
      { type: "text", origin: { x: 2, y: 3 }, width: 5, text: "note" },
      { x: 2, y: 3, width: 5, height: 0 },
    ],
    [
      {
        type: "dimension",
        start: { x: 0, y: 0 },
        end: { x: 10, y: 0 },
        offset: 4,
        calibrationId: null,
      },
      { x: 0, y: 0, width: 10, height: 4 },
    ],
  ];

  for (const [geometry, expected] of cases) {
    assert.deepEqual(
      geometryBounds(DrawingGeometrySchema.parse(geometry)),
      expected,
    );
  }
});

test("geometry rejects non-finite coordinates, degenerate lengths, and NUL text", () => {
  assert.equal(
    DrawingGeometrySchema.safeParse({
      type: "circle",
      center: { x: Infinity, y: 0 },
      radius: 1,
    }).success,
    false,
  );
  assert.equal(
    DrawingGeometrySchema.safeParse({
      type: "line",
      start: { x: 1, y: 1 },
      end: { x: 1, y: 1 },
    }).success,
    false,
  );
  assert.equal(
    DrawingGeometrySchema.safeParse({
      type: "polyline",
      points: [
        { x: 1, y: 1 },
        { x: 1, y: 1 },
      ],
      closed: false,
    }).success,
    false,
  );
  assert.equal(
    DrawingGeometrySchema.safeParse({
      type: "rectangle",
      origin: { x: 0, y: 0 },
      width: 0,
      height: 1,
      rotation: 0,
    }).success,
    false,
  );
  assert.equal(
    DrawingGeometrySchema.safeParse({
      type: "circle",
      center: { x: 0, y: 0 },
      radius: 0,
    }).success,
    false,
  );
  assert.equal(
    DrawingGeometrySchema.safeParse({
      type: "text",
      origin: { x: 0, y: 0 },
      width: 1,
      text: "no\0pe",
    }).success,
    false,
  );
});

test("calibration rejects coincident points and non-positive physical lengths", () => {
  assert.throws(() => calibratePdf({ x: 0, y: 0 }, { x: 0, y: 0 }, 100));
  assert.throws(() => calibratePdf({ x: 0, y: 0 }, { x: 1, y: 0 }, 0));
});

test("object snapping wins ties and leaves distant points unchanged", () => {
  assert.deepEqual(
    snapWorldPoint({ x: 102, y: 100 }, [{ x: 100, y: 100 }], {
      gridSize: 50,
      tolerancePixels: 4,
      zoom: 1,
    }),
    { point: { x: 100, y: 100 }, kind: "object" },
  );
  assert.deepEqual(
    snapWorldPoint({ x: 126, y: 126 }, [], {
      gridSize: 50,
      tolerancePixels: 2,
      zoom: 1,
    }),
    { point: { x: 126, y: 126 }, kind: null },
  );
});
