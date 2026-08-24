import assert from "node:assert/strict";
import test from "node:test";
import * as drawingGeometry from "../app/lukas/lib/drawing-geometry.ts";
const {
  calibratePdf,
  geometryBounds,
  screenToWorld,
  snapWorldPoint,
  worldToScreen,
} = drawingGeometry;
import { DrawingGeometrySchema } from "../app/lukas/lib/drawing-workspace.types.ts";

test("world coordinates round-trip independently from viewport pixels", () => {
  const viewport = { x: 120, y: -40, zoom: 2 };
  const world = { x: 1500, y: 900 };
  assert.deepEqual(
    screenToWorld(worldToScreen(world, viewport), viewport),
    world,
  );
});

test("pointer-centered zoom preserves the world point and clamps finite zoom", () => {
  assert.equal(typeof drawingGeometry.zoomViewportAroundPointer, "function");
  const { zoomViewportAroundPointer } = drawingGeometry;
  const pointer = { x: 400, y: 250 };
  const viewport = { x: 100, y: 50, zoom: 2 };
  const world = screenToWorld(pointer, viewport);

  assert.deepEqual(zoomViewportAroundPointer(pointer, viewport, 4), {
    x: -200,
    y: -150,
    zoom: 4,
  });
  assert.deepEqual(
    worldToScreen(world, zoomViewportAroundPointer(pointer, viewport, 4)),
    pointer,
  );
  assert.equal(zoomViewportAroundPointer(pointer, viewport, 0.001).zoom, 0.05);
  assert.equal(zoomViewportAroundPointer(pointer, viewport, 100).zoom, 32);
  assert.throws(() =>
    zoomViewportAroundPointer(pointer, viewport, Number.POSITIVE_INFINITY),
  );
});

test("PDF source contain placement preserves portrait and landscape aspect ratios", () => {
  assert.equal(typeof drawingGeometry.containPdfSource, "function");
  const { containPdfSource } = drawingGeometry;
  assert.deepEqual(
    containPdfSource(
      { width: 200, height: 100 },
      { x: 0, y: 0, width: 100, height: 200 },
    ),
    { x: 0, y: 75, width: 100, height: 50 },
  );
  assert.deepEqual(
    containPdfSource(
      { width: 100, height: 200 },
      { x: 10, y: 20, width: 200, height: 100 },
    ),
    { x: 85, y: 20, width: 50, height: 100 },
  );
  assert.deepEqual(
    containPdfSource(
      { width: 300, height: 200 },
      { x: 5, y: 10, width: 150, height: 100 },
    ),
    { x: 5, y: 10, width: 150, height: 100 },
  );
  for (const source of [
    { width: 0, height: 10 },
    { width: Infinity, height: 10 },
    { width: 10, height: NaN },
  ]) {
    assert.throws(() =>
      containPdfSource(source, { x: 0, y: 0, width: 100, height: 100 }),
    );
  }
});

test("canvas cursor follows Space and pan transitions without stale ref state", () => {
  assert.equal(typeof drawingGeometry.drawingCanvasCursor, "function");
  const { drawingCanvasCursor } = drawingGeometry;
  assert.equal(drawingCanvasCursor("select", false, false), "default");
  assert.equal(drawingCanvasCursor("select", true, false), "grab");
  assert.equal(drawingCanvasCursor("pan", false, false), "grab");
  assert.equal(drawingCanvasCursor("select", false, true), "grabbing");
  assert.equal(drawingCanvasCursor("pan", true, true), "grabbing");
});

test("pan gesture activates only for pan tool, Space, or middle button", () => {
  assert.equal(typeof drawingGeometry.drawingPanGestureTransition, "function");
  const { drawingPanGestureTransition } = drawingGeometry;
  const viewport = { x: 100, y: 50, zoom: 2 };
  const primarySelection = drawingPanGestureTransition(null, {
    type: "begin",
    activeTool: "select",
    spacePressed: false,
    button: 0,
    pointerId: 1,
    pointer: { x: 10, y: 20 },
    viewport,
  });
  assert.deepEqual(primarySelection, { gesture: null, viewport: null });

  for (const activation of [
    { activeTool: "pan", spacePressed: false, button: 0 },
    { activeTool: "select", spacePressed: true, button: 0 },
    { activeTool: "select", spacePressed: false, button: 1 },
  ]) {
    assert.deepEqual(
      drawingPanGestureTransition(null, {
        type: "begin",
        ...activation,
        pointerId: 1,
        pointer: { x: 10, y: 20 },
        viewport,
      }).gesture,
      {
        pointerId: 1,
        pointer: { x: 10, y: 20 },
        viewport,
      },
    );
  }
});

test("pan gesture moves from its start viewport and ends on release, cancel, or blur", () => {
  const { drawingPanGestureTransition } = drawingGeometry;
  const begun = drawingPanGestureTransition(null, {
    type: "begin",
    activeTool: "pan",
    spacePressed: false,
    button: 0,
    pointerId: 4,
    pointer: { x: 10, y: 20 },
    viewport: { x: 100, y: 50, zoom: 2 },
  });
  const moved = drawingPanGestureTransition(begun.gesture, {
    type: "move",
    pointerId: 4,
    pointer: { x: 25, y: 5 },
  });
  assert.deepEqual(moved.viewport, { x: 115, y: 35, zoom: 2 });
  assert.deepEqual(
    drawingPanGestureTransition(moved.gesture, {
      type: "end",
      pointerId: 4,
    }),
    { gesture: null, viewport: null },
  );
  assert.equal(
    drawingPanGestureTransition(begun.gesture, {
      type: "cancel",
      pointerId: 4,
    }).gesture,
    null,
  );
  assert.equal(
    drawingPanGestureTransition(begun.gesture, { type: "blur" }).gesture,
    null,
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
