export const p4FixtureIds = {
  wall: "40000000-0000-4000-8000-000000000001",
  opening: "40000000-0000-4000-8000-000000000002",
};

export const validP4Geometries = [
  {
    type: "wall",
    semanticVersion: 1,
    start: { x: -0.000001, y: 0 },
    end: { x: 1000, y: 0 },
    thicknessMillimeters: 200,
    heightMillimeters: 3000,
  },
  {
    type: "opening",
    semanticVersion: 1,
    hostWallId: p4FixtureIds.wall,
    offsetMillimeters: 500,
    widthMillimeters: 900,
    heightMillimeters: 2100,
    sillHeightMillimeters: 0,
    openingKind: "door",
  },
  {
    type: "space",
    semanticVersion: 1,
    boundary: [
      { x: 0, y: 0 },
      { x: 1000, y: 0 },
      { x: 1000, y: 500 },
      { x: 0, y: 500 },
    ],
    number: "101",
    finishes: { floor: "타일", wall: null, ceiling: "도장" },
  },
  {
    type: "area",
    semanticVersion: 1,
    boundary: [
      { x: 0, y: 0 },
      { x: 0, y: 1 },
      { x: 2, y: 1 },
      { x: 2, y: 0 },
    ],
  },
  {
    type: "grid",
    semanticVersion: 1,
    start: { x: -9000000000, y: -9000000000 },
    end: { x: 9000000000, y: 9000000000 },
  },
  {
    type: "arc",
    semanticVersion: 1,
    center: { x: 0.000001, y: -0.000001 },
    radius: 1000.000001,
    startAngleDegrees: -9000000000,
    sweepAngleDegrees: -360,
  },
];

const tooManyBoundaryPoints = [
  ...Array.from({ length: 2048 }, (_, x) => ({ x, y: 0 })),
  { x: 2047, y: 1 },
  ...Array.from({ length: 2048 }, (_, offset) => ({ x: 2047 - offset, y: 2 })),
];

const wall = validP4Geometries[0];
const opening = validP4Geometries[1];
const space = validP4Geometries[2];
const arc = validP4Geometries[5];

export const invalidP4Geometries = [
  ["unknown key", { ...wall, attrs: {} }],
  ["seventh decimal", { ...wall, thicknessMillimeters: 0.0000001 }],
  ["unsafe range", { ...wall, heightMillimeters: 9000000000.000002 }],
  ["equal wall endpoints", { ...wall, end: wall.start }],
  ["nonpositive wall height", { ...wall, heightMillimeters: 0 }],
  ["invalid host uuid", { ...opening, hostWallId: "not-a-uuid" }],
  ["nonpositive opening width", { ...opening, widthMillimeters: 0 }],
  ["negative opening sill", { ...opening, sillHeightMillimeters: -0.000001 }],
  ["door sill", { ...opening, sillHeightMillimeters: 1 }],
  [
    "duplicate closing point",
    { ...space, boundary: [...space.boundary, space.boundary[0]] },
  ],
  [
    "adjacent duplicate",
    { ...space, boundary: [space.boundary[0], space.boundary[0], space.boundary[1]] },
  ],
  [
    "zero polygon area",
    { ...space, boundary: [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 2 }] },
  ],
  [
    "nonzero-area self intersection",
    {
      ...space,
      boundary: [
        { x: 0, y: 0 },
        { x: 4, y: 0 },
        { x: 1, y: 3 },
        { x: 3, y: 3 },
        { x: 0, y: 1 },
      ],
    },
  ],
  ["4097 polygon points", { ...space, boundary: tooManyBoundaryPoints }],
  ["zero arc sweep", { ...arc, sweepAngleDegrees: 0 }],
  ["over-360 arc sweep", { ...arc, sweepAngleDegrees: 360.000001 }],
];

export const drawingStyleFixture = {
  stroke: "#112233",
  strokeWidth: 1,
  fill: null,
};

export function p4Object(id, layerId, geometry, name = geometry.type) {
  return {
    id,
    name,
    layerId,
    geometry: structuredClone(geometry),
    styleId: null,
    style: drawingStyleFixture,
    version: 1,
  };
}
