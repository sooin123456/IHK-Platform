import assert from "node:assert/strict";
import test from "node:test";

import {
  DrawingBlockPrimitiveSchema,
  DrawingGeometrySchema,
  defaultDrawingObjectName,
} from "../app/lukas/lib/drawing-workspace.types.ts";
import {
  geometryBounds,
  geometrySnapPoints,
} from "../app/lukas/lib/drawing-geometry.ts";
const semanticGeometry =
  await import("../app/lukas/lib/drawing-semantic-geometry.ts").catch(
    () => ({}),
  );
const {
  isSimpleDrawingBoundary,
  projectPointToDrawingWall,
  resolveDrawingOpening,
} = semanticGeometry;

const HOST_ID = "00000000-0000-4000-8000-000000000101";
const LAYER_ID = "00000000-0000-4000-8000-000000000102";

const wall = {
  type: "wall",
  semanticVersion: 1,
  start: { x: 0, y: 0 },
  end: { x: 3000, y: 4000 },
  thicknessMillimeters: 200,
  heightMillimeters: 3000,
};
const opening = {
  type: "opening",
  semanticVersion: 1,
  hostWallId: HOST_ID,
  offsetMillimeters: 2500,
  widthMillimeters: 900,
  heightMillimeters: 2100,
  sillHeightMillimeters: 0,
  openingKind: "door",
};
const space = {
  type: "space",
  semanticVersion: 1,
  boundary: [
    { x: 0, y: 0 },
    { x: 1000, y: 0 },
    { x: 1000, y: 500 },
    { x: 0, y: 500 },
  ],
  number: "101",
  finishes: { floor: "F-01", wall: null, ceiling: "C-01" },
};
const area = {
  type: "area",
  semanticVersion: 1,
  boundary: [
    { x: -10, y: -20 },
    { x: 40, y: -20 },
    { x: 0, y: 30 },
  ],
};
const grid = {
  type: "grid",
  semanticVersion: 1,
  start: { x: -100, y: 50 },
  end: { x: 900, y: 50 },
};
const arc = {
  type: "arc",
  semanticVersion: 1,
  center: { x: 100, y: 200 },
  radius: 50,
  startAngleDegrees: 0,
  sweepAngleDegrees: 90,
};

const hostObject = {
  id: HOST_ID,
  name: "W-01",
  layerId: LAYER_ID,
  geometry: wall,
  style: { stroke: "#000000", strokeWidth: 1, fill: null },
  version: 1,
};
const objects = { [HOST_ID]: hostObject };

test("the exact six P4 semantic geometry variants parse strictly", () => {
  for (const geometry of [wall, opening, space, area, grid, arc]) {
    assert.deepEqual(DrawingGeometrySchema.parse(geometry), geometry);
    assert.equal(
      DrawingGeometrySchema.safeParse({ ...geometry, unexpected: true })
        .success,
      false,
    );
  }

  assert.deepEqual(
    ["wall", "opening", "space", "area", "grid", "arc"].map(
      defaultDrawingObjectName,
    ),
    ["Wall", "Opening", "Space", "Area", "Grid", "Arc"],
  );
});

test("P4 numbers reject unsafe ranges and a seventh decimal place", () => {
  assert.equal(
    DrawingGeometrySchema.safeParse({
      ...wall,
      start: { x: 9_000_000_001, y: 0 },
    }).success,
    false,
  );
  assert.equal(
    DrawingGeometrySchema.safeParse({
      ...wall,
      thicknessMillimeters: 0.0000001,
    }).success,
    false,
  );
  assert.equal(
    DrawingGeometrySchema.safeParse({
      ...arc,
      startAngleDegrees: Number.POSITIVE_INFINITY,
    }).success,
    false,
  );
});

test("walls, grids, openings, and arcs enforce their semantic invariants", () => {
  const invalid = [
    { ...wall, end: wall.start },
    { ...wall, thicknessMillimeters: 0 },
    { ...wall, heightMillimeters: -1 },
    { ...grid, end: grid.start },
    { ...opening, widthMillimeters: 0 },
    { ...opening, heightMillimeters: -1 },
    { ...opening, sillHeightMillimeters: -1 },
    { ...opening, sillHeightMillimeters: 10 },
    { ...arc, radius: 0 },
    { ...arc, sweepAngleDegrees: 0 },
    { ...arc, sweepAngleDegrees: 360.000001 },
    { ...arc, sweepAngleDegrees: -360.000001 },
  ];
  for (const geometry of invalid)
    assert.equal(DrawingGeometrySchema.safeParse(geometry).success, false);

  assert.equal(
    DrawingGeometrySchema.safeParse({
      ...opening,
      openingKind: "window",
      sillHeightMillimeters: 900,
    }).success,
    true,
  );
});

test("polygon boundaries reject closing duplicates, adjacent duplicates, and zero area", () => {
  assert.equal(typeof isSimpleDrawingBoundary, "function");
  const invalidBoundaries = [
    [...space.boundary, space.boundary[0]],
    [space.boundary[0], space.boundary[0], ...space.boundary.slice(1)],
    [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
    ],
  ];
  for (const boundary of invalidBoundaries) {
    assert.equal(
      DrawingGeometrySchema.safeParse({ ...area, boundary }).success,
      false,
    );
  }

  assert.equal(isSimpleDrawingBoundary(space.boundary), true);
});

test("a self-intersecting non-zero-area boundary is rejected by segment intersection", () => {
  // Doubled signed area is 12, and all points/edges are otherwise valid.
  const crossingBoundary = [
    { x: 0, y: 3 },
    { x: 2, y: 0 },
    { x: 4, y: 3 },
    { x: 0, y: 1 },
    { x: 4, y: 1 },
  ];
  assert.equal(isSimpleDrawingBoundary(crossingBoundary), false);
  assert.equal(
    DrawingGeometrySchema.safeParse({ ...area, boundary: crossingBoundary })
      .success,
    false,
  );
});

test("an otherwise valid integer simple boundary rejects its 4097th point", () => {
  const boundary = [
    ...Array.from({ length: 2049 }, (_, x) => ({ x, y: 0 })),
    ...Array.from({ length: 2048 }, (_, index) => ({
      x: 2047 - index,
      y: 1,
    })),
  ];
  assert.equal(boundary.length, 4097);
  assert.equal(
    boundary.every(
      (point) => Number.isInteger(point.x) && Number.isInteger(point.y),
    ),
    true,
  );
  assert.equal(
    DrawingGeometrySchema.safeParse({ ...area, boundary }).success,
    false,
  );
});

test("blocks remain restricted to the original six primitive geometries", () => {
  const primitive = {
    localId: "primitive-1",
    name: "Line",
    geometry: { type: "line", start: { x: 0, y: 0 }, end: { x: 1, y: 0 } },
    styleId: null,
    style: { stroke: "#000000", strokeWidth: 1, fill: null },
  };
  assert.equal(DrawingBlockPrimitiveSchema.safeParse(primitive).success, true);
  for (const geometry of [wall, opening, space, area, grid, arc]) {
    assert.equal(
      DrawingBlockPrimitiveSchema.safeParse({ ...primitive, geometry }).success,
      false,
    );
  }
});

test("wall projection clamps to the segment and opening resolution is immutable", () => {
  assert.equal(typeof projectPointToDrawingWall, "function");
  assert.equal(typeof resolveDrawingOpening, "function");
  assert.deepEqual(projectPointToDrawingWall({ x: 3000, y: 1000 }, wall), {
    point: { x: 1560, y: 2080 },
    offsetMillimeters: 2600,
    distanceMillimeters: 1800,
  });
  assert.deepEqual(projectPointToDrawingWall({ x: -100, y: -100 }, wall), {
    point: { x: 0, y: 0 },
    offsetMillimeters: 0,
    distanceMillimeters: Math.sqrt(20_000),
  });

  const before = structuredClone(objects);
  const resolved = resolveDrawingOpening(opening, objects);
  assert.equal(resolved.host, hostObject);
  assert.deepEqual(resolved.center, { x: 1500, y: 2000 });
  assert.deepEqual(resolved.start, { x: 1230, y: 1640 });
  assert.deepEqual(resolved.end, { x: 1770, y: 2360 });
  assert.ok(Math.abs(resolved.wallAngleDegrees - 53.13010235415598) < 1e-12);
  assert.deepEqual(objects, before);
});

test("opening resolution rejects missing, non-wall, out-of-wall, and over-height hosts", () => {
  assert.equal(typeof resolveDrawingOpening, "function");
  assert.throws(() => resolveDrawingOpening(opening, {}));
  assert.throws(() =>
    resolveDrawingOpening(opening, {
      [HOST_ID]: { ...hostObject, geometry: grid },
    }),
  );
  assert.throws(() =>
    resolveDrawingOpening({ ...opening, offsetMillimeters: 400 }, objects),
  );
  assert.throws(() =>
    resolveDrawingOpening(
      {
        ...opening,
        openingKind: "window",
        heightMillimeters: 2200,
        sillHeightMillimeters: 900,
      },
      objects,
    ),
  );
});

test("opening resolution accepts exact six-decimal fit and window-height boundaries", () => {
  const decimalWall = DrawingGeometrySchema.parse({
    ...wall,
    end: { x: 0.3, y: 0 },
    heightMillimeters: 0.3,
  });
  const decimalObjects = {
    [HOST_ID]: { ...hostObject, geometry: decimalWall },
  };
  const exactWidthFit = DrawingGeometrySchema.parse({
    ...opening,
    offsetMillimeters: 0.2,
    widthMillimeters: 0.2,
    heightMillimeters: 0.1,
  });
  assert.doesNotThrow(() =>
    resolveDrawingOpening(exactWidthFit, decimalObjects),
  );

  const exactWindowHeight = DrawingGeometrySchema.parse({
    ...opening,
    offsetMillimeters: 0.15,
    widthMillimeters: 0.1,
    heightMillimeters: 0.2,
    sillHeightMillimeters: 0.1,
    openingKind: "window",
  });
  assert.doesNotThrow(() =>
    resolveDrawingOpening(exactWindowHeight, decimalObjects),
  );
});

test("large equivalent arc angles have exact cardinal snap points and bounds", () => {
  const largeArc = DrawingGeometrySchema.parse({
    type: "arc",
    semanticVersion: 1,
    center: { x: 0, y: 0 },
    radius: 9_000_000_000,
    startAngleDegrees: 9_000_000_000,
    sweepAngleDegrees: 90,
  });
  assert.deepEqual(geometrySnapPoints(largeArc), [
    { x: 0, y: 0 },
    { x: 9_000_000_000, y: 0 },
    { x: 0, y: 9_000_000_000 },
  ]);
  assert.deepEqual(geometryBounds(largeArc), {
    x: 0,
    y: 0,
    width: 9_000_000_000,
    height: 9_000_000_000,
  });

  const largeTinySweep = DrawingGeometrySchema.parse({
    ...largeArc,
    sweepAngleDegrees: 0.000001,
  });
  const normalizedTinySweep = DrawingGeometrySchema.parse({
    ...largeTinySweep,
    startAngleDegrees: 0,
  });
  assert.deepEqual(
    geometrySnapPoints(largeTinySweep),
    geometrySnapPoints(normalizedTinySweep),
  );
  assert.deepEqual(
    geometryBounds(largeTinySweep),
    geometryBounds(normalizedTinySweep),
  );
});

test("every valid P4 type has finite snap points and bounds with opening context", () => {
  const cases = [wall, opening, space, area, grid, arc];
  for (const geometry of cases) {
    const snapPoints = geometrySnapPoints(geometry, objects);
    const bounds = geometryBounds(geometry, objects);
    assert.ok(snapPoints.length >= 2, geometry.type);
    assert.ok(
      snapPoints.every(
        (point) => Number.isFinite(point.x) && Number.isFinite(point.y),
      ),
      geometry.type,
    );
    assert.ok(
      [bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite),
      geometry.type,
    );
    assert.ok(bounds.width >= 0 && bounds.height >= 0, geometry.type);
  }

  assert.deepEqual(geometrySnapPoints(opening, objects), [
    { x: 1230, y: 1640 },
    { x: 1500, y: 2000 },
    { x: 1770, y: 2360 },
  ]);
  assert.throws(() => geometryBounds(opening));
  assert.throws(() => geometrySnapPoints(opening));
});
