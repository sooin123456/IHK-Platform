export const p4FixtureIds = {
  wall: "40000000-0000-4000-8000-000000000001",
  opening: "40000000-0000-4000-8000-000000000002",
};

const p4TrimWhitespace = [
  "\u0009",
  "\u000a",
  "\u000b",
  "\u000c",
  "\u000d",
  "\u0020",
  "\u00a0",
  "\u1680",
  "\u2000",
  "\u2001",
  "\u2002",
  "\u2003",
  "\u2004",
  "\u2005",
  "\u2006",
  "\u2007",
  "\u2008",
  "\u2009",
  "\u200a",
  "\u2028",
  "\u2029",
  "\u202f",
  "\u205f",
  "\u3000",
  "\ufeff",
];

function randomizedInteriorName(seed) {
  let state = seed >>> 0;
  const random = () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state;
  };
  const atoms = [
    "A",
    "z",
    "한",
    "😀",
    "e\u0301",
    "\u0001",
    "\u0085",
    ...p4TrimWhitespace,
  ];
  let value = "N";
  while (value.length < 220) {
    const atom = atoms[random() % atoms.length];
    if (value.length + atom.length + 1 > 255) break;
    value += atom;
  }
  return `${value}Z`;
}

export const p4ObjectNameCorpus = [
  ["one BMP unit", "A", true],
  ["255 BMP units", "a".repeat(255), true],
  ["255 mixed UTF-16 units", `${"😀".repeat(127)}a`, true],
  ["interior whitespace and controls", "A\t\u00a0\u0001\u0085B", true],
  ...Array.from({ length: 32 }, (_, index) => [
    `randomized valid Unicode name ${index}`,
    randomizedInteriorName(0x4f424a00 + index),
    true,
  ]),
  ["empty name", "", false],
  ["256 BMP units", "a".repeat(256), false],
  ["256 non-BMP UTF-16 units", "😀".repeat(128), false],
  ["NUL name", "A\u0000B", false],
  ["lone high surrogate name", "A\ud800B", false],
  ["lone low surrogate name", "A\udc00B", false],
  ...p4TrimWhitespace.flatMap((whitespace, index) => [
    [`leading ECMAScript trim whitespace ${index}`, `${whitespace}A`, false],
    [`trailing ECMAScript trim whitespace ${index}`, `A${whitespace}`, false],
    [`only ECMAScript trim whitespace ${index}`, whitespace, false],
  ]),
  ["U+180E is not ECMAScript trim whitespace", "A\u180e", true],
];

const allPropertyTargets = [
  "line",
  "polyline",
  "rectangle",
  "circle",
  "text",
  "dimension",
  "wall",
  "opening",
  "space",
  "area",
  "grid",
  "arc",
  "block_instance",
];
const propertySchemaBase = {
  id: "41000000-0000-4000-8000-000000000001",
  revisionId: "41000000-0000-4000-8000-000000000002",
  name: "P4 shared property",
  valueType: "text",
  enumOptions: [],
  required: false,
  version: 1,
};

export const validP4PropertySchemas = [
  { ...propertySchemaBase, appliesTo: ["wall"] },
  {
    ...propertySchemaBase,
    id: "41000000-0000-4000-8000-000000000003",
    appliesTo: allPropertyTargets,
  },
];
export const invalidP4PropertySchemas = [
  [
    "duplicate singleton target",
    { ...propertySchemaBase, appliesTo: ["wall", "wall"] },
  ],
  [
    "duplicate target separated by valid targets",
    { ...propertySchemaBase, appliesTo: ["wall", "opening", "space", "wall"] },
  ],
];

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
  {
    type: "opening",
    semanticVersion: 1,
    hostWallId: "123e4567-e89b-12d3-a456-426614174000",
    offsetMillimeters: 500,
    widthMillimeters: 900,
    heightMillimeters: 2100,
    sillHeightMillimeters: 0,
    openingKind: "door",
  },
  {
    type: "opening",
    semanticVersion: 1,
    hostWallId: "123e4567-e89b-82d3-a456-426614174000",
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
    number: `${"😀".repeat(127)}a`,
    finishes: { floor: "é", wall: "e\u0301", ceiling: "\u0001" },
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
    number: "a".repeat(255),
    finishes: { floor: "b".repeat(255), wall: null, ceiling: null },
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
  [
    "nil host uuid",
    { ...opening, hostWallId: "00000000-0000-0000-0000-000000000000" },
  ],
  [
    "version-zero host uuid",
    { ...opening, hostWallId: "123e4567-e89b-02d3-a456-426614174000" },
  ],
  [
    "invalid-variant host uuid",
    { ...opening, hostWallId: "123e4567-e89b-42d3-c456-426614174000" },
  ],
  ["nonpositive opening width", { ...opening, widthMillimeters: 0 }],
  ["negative opening sill", { ...opening, sillHeightMillimeters: -0.000001 }],
  ["door sill", { ...opening, sillHeightMillimeters: 1 }],
  [
    "duplicate closing point",
    { ...space, boundary: [...space.boundary, space.boundary[0]] },
  ],
  [
    "adjacent duplicate",
    {
      ...space,
      boundary: [space.boundary[0], space.boundary[0], space.boundary[1]],
    },
  ],
  [
    "zero polygon area",
    {
      ...space,
      boundary: [
        { x: 0, y: 0 },
        { x: 1, y: 1 },
        { x: 2, y: 2 },
      ],
    },
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
  ["256 UTF-16 units in space number", { ...space, number: "😀".repeat(128) }],
  [
    "256 BMP units in finish",
    {
      ...space,
      finishes: { ...space.finishes, floor: "a".repeat(256) },
    },
  ],
  ["lone surrogate in space number", { ...space, number: "\ud800" }],
  [
    "NUL in finish",
    {
      ...space,
      finishes: { ...space.finishes, ceiling: "\u0000" },
    },
  ],
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
