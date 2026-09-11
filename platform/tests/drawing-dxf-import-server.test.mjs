import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import {
  DRAWING_DXF_IMPORT_LIMITS,
  buildDrawingDxfImport,
} from "../app/lukas/lib/drawing-dxf-import.server.ts";
import {
  DRAWING_COLLABORATION_SCHEMA_VERSION,
  DrawingCollaborationOperationSchema,
} from "../app/lukas/lib/drawing-collaboration-protocol.ts";
import { DrawingOperationInputSchema } from "../app/lukas/lib/drawing-workspace.types.ts";

const ids = {
  revision: "71000000-0000-4000-8000-000000000001",
  canvas: "71000000-0000-4000-8000-000000000002",
};

const encoder = new TextEncoder();

function pairs(values) {
  return `${values.map(([code, value]) => `${code}\n${value}`).join("\n")}\n`;
}

function dxf({
  units = 4,
  includeUnits = true,
  header = [],
  tables = [],
  blocks = [],
  entities = [],
}) {
  return encoder.encode(
    pairs([
      [0, "SECTION"],
      [2, "HEADER"],
      ...(includeUnits
        ? [
            [9, "$INSUNITS"],
            [70, units],
          ]
        : []),
      ...header,
      [0, "ENDSEC"],
      ...(tables.length
        ? [[0, "SECTION"], [2, "TABLES"], ...tables, [0, "ENDSEC"]]
        : []),
      ...(blocks.length
        ? [[0, "SECTION"], [2, "BLOCKS"], ...blocks, [0, "ENDSEC"]]
        : []),
      [0, "SECTION"],
      [2, "ENTITIES"],
      ...entities,
      [0, "ENDSEC"],
      [0, "EOF"],
    ]),
  );
}

function layerTable(layers) {
  return [
    [0, "TABLE"],
    [2, "LAYER"],
    [70, layers.length],
    ...layers.flatMap(({ name, flags = 0, color = 7 }) => [
      [0, "LAYER"],
      [2, name],
      [70, flags],
      [62, color],
    ]),
    [0, "ENDTAB"],
  ];
}

function input(bytes, overrides = {}) {
  return {
    bytes,
    revisionId: ids.revision,
    canvasId: ids.canvas,
    createdAt: "2026-09-02T01:00:00.000Z",
    ...overrides,
  };
}

const line = ({
  handle = "10",
  layer = "A-WALL",
  start = [0, 0],
  end = [10, 0],
} = {}) => [
  [0, "LINE"],
  [5, handle],
  [8, layer],
  [10, start[0]],
  [20, start[1]],
  [11, end[0]],
  [21, end[1]],
];

const exactUnusedExtentSentinels = [
  [9, "$EXTMIN"],
  [10, 1e20],
  [20, 1e20],
  [30, 1e20],
  [9, "$EXTMAX"],
  [10, -1e20],
  [20, -1e20],
  [30, -1e20],
];

const droppedHatch = (firstX = 1) => [
  [0, "HATCH"],
  [5, "700"],
  [8, "A-HATCH"],
  [2, "SOLID"],
  [70, 1],
  [10, firstX],
  [20, 0],
  [10, 1],
  [20, 1],
];

const droppedPatternHatch = (firstX = 1) => [
  [0, "HATCH"],
  [5, "701"],
  [8, "A-HATCH"],
  [2, "ANSI31"],
  [70, 0],
  [78, 2],
  [53, 0],
  [43, firstX],
  [44, 0],
  [45, 1],
  [46, 0],
  [53, 90],
  [43, 1],
  [44, 1],
  [45, 0],
  [46, 1],
];

const insert = ({
  handle = "50",
  layer = "BLOCKS",
  name = "UNIT",
  position = [10, 20],
  scale = [2, 2],
  rotation = 90,
} = {}) => [
  [0, "INSERT"],
  [5, handle],
  [8, layer],
  [2, name],
  [10, position[0]],
  [20, position[1]],
  [41, scale[0]],
  [42, scale[1]],
  [43, 1],
  [50, rotation],
];

function block(name, entities, base = [0, 0]) {
  return [
    [0, "BLOCK"],
    [8, "0"],
    [2, name],
    [3, name],
    [70, 0],
    [10, base[0]],
    [20, base[1]],
    [30, 0],
    ...entities,
    [0, "ENDBLK"],
  ];
}

test("DXF adapter imports the pinned upstream extended-data fixture deterministically", async () => {
  const bytes = await readFile(
    new URL("fixtures/dxf-parser/extendeddata.dxf", import.meta.url),
  );
  const first = await buildDrawingDxfImport(input(bytes));
  const retried = await buildDrawingDxfImport(input(bytes));

  assert.deepEqual(retried, first);
  assert.equal(
    first.sourceSha256,
    "9b39289e3435fb187eb0e671fb8a07b8728cdf69a0275836f67ca005732f781d",
  );
  assert.deepEqual(first.units, {
    code: 4,
    label: "mm",
    millimetersPerUnit: 1,
    source: "declared",
  });
  assert.deepEqual(
    first.layers.map((layer) => layer.name),
    ["0"],
  );
  assert.deepEqual(
    first.objects.map((object) => object.geometry),
    [
      {
        type: "line",
        start: { x: -10, y: -10 },
        end: { x: -10, y: 10 },
      },
      {
        type: "line",
        start: { x: -10, y: 10 },
        end: { x: 10, y: 10 },
      },
      {
        type: "line",
        start: { x: 10, y: 10 },
        end: { x: -10, y: -10 },
      },
      {
        type: "line",
        start: { x: -10, y: -10 },
        end: { x: 10, y: -10 },
      },
      {
        type: "line",
        start: { x: 10, y: -10 },
        end: { x: -10, y: 10 },
      },
      {
        type: "line",
        start: { x: -10, y: 10 },
        end: { x: 0, y: 20 },
      },
      {
        type: "line",
        start: { x: 0, y: 20 },
        end: { x: 10, y: 10 },
      },
      {
        type: "line",
        start: { x: 10, y: 10 },
        end: { x: 10, y: -10 },
      },
    ],
  );
  assert.deepEqual(
    first.entityLineage.map(
      ({ entityKey, entityType, sourceLayer, rawHandle }) => [
        entityKey,
        entityType,
        sourceLayer,
        rawHandle,
      ],
    ),
    [
      ["entities:0@raw:ENTITIES:0", "LINE", "0", "38"],
      ["entities:1@raw:ENTITIES:1", "LINE", "0", "39"],
      ["entities:2@raw:ENTITIES:2", "LINE", "0", "3A"],
      ["entities:3@raw:ENTITIES:3", "LINE", "0", "3B"],
      ["entities:4@raw:ENTITIES:4", "LINE", "0", "3C"],
      ["entities:5@raw:ENTITIES:5", "LINE", "0", "3D"],
      ["entities:6@raw:ENTITIES:6", "LINE", "0", "3E"],
      ["entities:7@raw:ENTITIES:7", "LINE", "0", "3F"],
    ],
  );
  assert.deepEqual(
    first.report.converted.map(({ code, entityKey }) => [code, entityKey]),
    [
      ["STYLE_NORMALIZED", "entities:0"],
      ["STYLE_NORMALIZED", "entities:1"],
      ["STYLE_NORMALIZED", "entities:2"],
      ["STYLE_NORMALIZED", "entities:3"],
      ["STYLE_NORMALIZED", "entities:4"],
      ["STYLE_NORMALIZED", "entities:5"],
      ["STYLE_NORMALIZED", "entities:6"],
      ["STYLE_NORMALIZED", "entities:7"],
    ],
  );
  assert.deepEqual(
    first.report.skipped.map(({ code, entityType, entityKey }) => ({
      code,
      entityType,
      entityKey,
    })),
    [
      {
        code: "UNSUPPORTED_RAW_ENTITY",
        entityType: "VIEWPORT",
        entityKey: "raw:ENTITIES:2186",
      },
    ],
  );
  assert.equal(first.report.imported, 8);
  assert.deepEqual(first.report.blocking, []);
  assert.deepEqual(
    first.operations.map((operation) => operation.type),
    ["mutate_structure", "add_objects"],
  );
});

test("DXF extent sentinel exemption preserves coordinate and finite-number limits", async () => {
  const coordinateBomb = await buildDrawingDxfImport(
    input(
      dxf({
        header: exactUnusedExtentSentinels,
        entities: line({ end: [9_000_000_001, 0] }),
      }),
    ),
  );
  assert.equal(coordinateBomb.report.blocking[0]?.code, "COORDINATE_LIMIT");

  const incompleteOrAlteredSentinels = [
    exactUnusedExtentSentinels.slice(0, 4),
    exactUnusedExtentSentinels.slice(4),
    [
      ...exactUnusedExtentSentinels.slice(0, 7),
      [30, -99_999_999_990_000_000_000],
    ],
    exactUnusedExtentSentinels.map(([code, value], index) =>
      index === 0 ? [code, "$extmin"] : [code, value],
    ),
  ];
  for (const header of incompleteOrAlteredSentinels) {
    const result = await buildDrawingDxfImport(
      input(dxf({ header, entities: line() })),
    );
    assert.equal(result.report.blocking[0]?.code, "COORDINATE_LIMIT");
  }

  const nonFiniteOtherHeaderPoint = await buildDrawingDxfImport(
    input(
      dxf({
        header: [
          ...exactUnusedExtentSentinels,
          [9, "$LIMMIN"],
          [10, "Infinity"],
          [20, 0],
        ],
        entities: line(),
      }),
    ),
  );
  assert.equal(
    nonFiniteOtherHeaderPoint.report.blocking[0]?.code,
    "NON_FINITE_NUMBER",
  );
});

test("DXF adapter normalizes supported 2D entities and emits canonical deterministic operations", async () => {
  const bytes = dxf({
    entities: [
      ...line(),
      [0, "LWPOLYLINE"],
      [5, "11"],
      [8, "A-WALL"],
      [90, 3],
      [70, 1],
      [10, 0],
      [20, 0],
      [10, 5],
      [20, 0],
      [10, 5],
      [20, 5],
      [0, "POLYLINE"],
      [5, "12"],
      [8, "A-ANNO"],
      [66, 1],
      [70, 1],
      [0, "VERTEX"],
      [8, "A-ANNO"],
      [10, 1],
      [20, 1],
      [0, "VERTEX"],
      [8, "A-ANNO"],
      [10, 4],
      [20, 1],
      [0, "VERTEX"],
      [8, "A-ANNO"],
      [10, 4],
      [20, 4],
      [0, "SEQEND"],
      [0, "CIRCLE"],
      [5, "13"],
      [8, "A-WALL"],
      [10, 20],
      [20, 20],
      [40, 5],
      [0, "ARC"],
      [5, "14"],
      [8, "A-ANNO"],
      [10, 30],
      [20, 30],
      [40, 4],
      [50, 350],
      [51, 10],
      [0, "TEXT"],
      [5, "15"],
      [8, "A-ANNO"],
      [10, 40],
      [20, 40],
      [40, 2.5],
      [1, "Room 101"],
      [50, 0],
    ],
  });

  const pending = buildDrawingDxfImport(input(bytes));
  assert.equal(pending instanceof Promise, true);
  const first = await pending;
  const retried = await buildDrawingDxfImport(input(bytes));

  assert.deepEqual(retried, first);
  assert.equal(first.units?.code, 4);
  assert.equal(first.units?.millimetersPerUnit, 1);
  assert.equal(first.report.imported, 6);
  assert.deepEqual(first.report.skipped, []);
  assert.deepEqual(first.report.blocking, []);
  assert.ok(
    first.report.converted.some((item) => item.code === "TEXT_WIDTH_DERIVED"),
  );
  assert.deepEqual(
    first.layers.map((layer) => layer.name),
    ["A-ANNO", "A-WALL"],
  );
  assert.deepEqual(
    first.objects.map((object) => object.geometry.type),
    ["line", "polyline", "polyline", "circle", "arc", "text"],
  );
  assert.deepEqual(
    first.objects.map((object) => object.styleId),
    [null, null, null, null, null, null],
    "DXF objects use the same nullable style reference as canonical checkpoints",
  );
  assert.deepEqual(first.objects[0].geometry, {
    type: "line",
    start: { x: 0, y: 0 },
    end: { x: 10, y: 0 },
  });
  assert.deepEqual(first.objects[4].geometry, {
    type: "arc",
    semanticVersion: 1,
    center: { x: 30, y: 30 },
    radius: 4,
    startAngleDegrees: 350,
    sweepAngleDegrees: 20,
  });
  assert.deepEqual(
    first.operations.map((operation) => operation.type),
    ["mutate_structure", "add_objects"],
  );
  for (const operation of first.operations)
    assert.equal(
      DrawingOperationInputSchema.safeParse(operation).success,
      true,
    );
});

test("DXF adapter uses declared units and never guesses a missing or unitless drawing unit", async () => {
  const inches = await buildDrawingDxfImport(
    input(dxf({ units: 1, entities: line({ start: [1, 2], end: [3, 4] }) })),
  );
  assert.deepEqual(inches.objects[0].geometry, {
    type: "line",
    start: { x: 25.4, y: 50.8 },
    end: { x: 76.2, y: 101.6 },
  });

  for (const bytes of [
    dxf({ includeUnits: false, entities: line() }),
    dxf({ units: 0, entities: line() }),
  ]) {
    const result = await buildDrawingDxfImport(input(bytes));
    assert.equal(result.report.blocking[0].code, "UNIT_REQUIRED");
    assert.deepEqual(result.layers, []);
    assert.deepEqual(result.objects, []);
    assert.deepEqual(result.operations, []);
  }
});

test("DXF adapter resumes a missing-unit import only with an explicit allowed unit selection", async () => {
  const bytes = dxf({ includeUnits: false, entities: line({ end: [1, 0] }) });
  const millimeters = await buildDrawingDxfImport(
    input(bytes, { unitOverride: { code: 4, label: "mm" } }),
  );
  const inches = await buildDrawingDxfImport(
    input(bytes, { unitOverride: { code: 1, label: "in" } }),
  );

  assert.equal(millimeters.units?.source, "user_selected");
  assert.equal(inches.units?.source, "user_selected");
  assert.equal(millimeters.objects[0].geometry.end.x, 1);
  assert.equal(inches.objects[0].geometry.end.x, 25.4);
  assert.notEqual(millimeters.objects[0].id, inches.objects[0].id);
  assert.notEqual(
    millimeters.operations[0].clientOperationId,
    inches.operations[0].clientOperationId,
  );
  assert.ok(
    millimeters.report.converted.some(
      (item) => item.code === "USER_SELECTED_UNIT",
    ),
  );
});

test("DXF adapter blocks a user-selected unit that conflicts with the declared unit", async () => {
  const bytes = dxf({ units: 4, entities: line() });
  const conflict = await buildDrawingDxfImport(
    input(bytes, { unitOverride: { code: 1, label: "in" } }),
  );
  assert.equal(conflict.report.blocking[0]?.code, "UNIT_CONFLICT");
  assert.deepEqual(conflict.operations, []);

  const matching = await buildDrawingDxfImport(
    input(bytes, { unitOverride: { code: 4, label: "mm" } }),
  );
  assert.equal(matching.units?.source, "declared");
  assert.equal(matching.report.imported, 1);

  await assert.rejects(
    buildDrawingDxfImport(
      input(bytes, { unitOverride: { code: 4, label: "cm" } }),
    ),
  );
});

test("DXF adapter reports unsupported, incomplete, curved, and unsafe INSERT entities instead of approximating them", async () => {
  const bytes = dxf({
    blocks: block("UNIT", line({ layer: "0", start: [0, 0], end: [1, 0] })),
    entities: [
      [0, "POINT"],
      [5, "20"],
      [8, "MISC"],
      [10, 1],
      [20, 2],
      [0, "LINE"],
      [5, "21"],
      [8, "MISC"],
      [10, 1],
      [20, 2],
      [0, "LWPOLYLINE"],
      [5, "22"],
      [8, "MISC"],
      [90, 2],
      [10, 0],
      [20, 0],
      [42, 0.5],
      [10, 4],
      [20, 0],
      ...insert({ handle: "23", scale: [2, 3] }),
    ],
  });

  const result = await buildDrawingDxfImport(input(bytes));
  assert.equal(result.report.imported, 0);
  assert.deepEqual(result.report.blocking, []);
  assert.deepEqual(
    result.report.skipped.map((item) => item.code),
    [
      "UNSUPPORTED_ENTITY",
      "INCOMPLETE_ENTITY",
      "UNSUPPORTED_BULGE",
      "UNSAFE_BLOCK_TRANSFORM",
    ],
  );
  assert.deepEqual(result.operations, []);
});

test("DXF adapter explicitly skips paper-space and hidden entities", async () => {
  const result = await buildDrawingDxfImport(
    input(
      dxf({
        entities: [
          ...line({ handle: "601" }),
          [67, 1],
          ...line({ handle: "602" }),
          [60, 1],
        ],
      }),
    ),
  );

  assert.equal(result.report.imported, 0);
  assert.deepEqual(
    result.report.skipped.map((item) => item.code),
    ["UNSUPPORTED_PAPER_SPACE", "HIDDEN_ENTITY"],
  );
  assert.deepEqual(result.operations, []);
});

test("DXF adapter preserves off, frozen, and locked source layer state", async () => {
  const result = await buildDrawingDxfImport(
    input(
      dxf({
        tables: layerTable([
          { name: "A-OFF", color: -7 },
          { name: "A-FROZEN", flags: 1 },
          { name: "A-LOCKED", flags: 4 },
        ]),
        entities: [
          ...line({ handle: "610", layer: "A-OFF" }),
          ...line({ handle: "611", layer: "A-FROZEN" }),
          ...line({ handle: "612", layer: "A-LOCKED" }),
        ],
      }),
    ),
  );

  assert.equal(result.report.imported, 3);
  assert.deepEqual(
    result.layers.map((layer) => [layer.name, layer.visible, layer.locked]),
    [
      ["A-FROZEN", false, false],
      ["A-LOCKED", true, true],
      ["A-OFF", false, false],
    ],
  );
});

test("DXF adapter resolves layer identity case-insensitively with stable table spelling", async () => {
  const result = await buildDrawingDxfImport(
    input(
      dxf({
        tables: layerTable([{ name: "A-WALL", flags: 4, color: -7 }]),
        entities: line({ handle: "61A", layer: "a-wall" }),
      }),
    ),
  );

  assert.equal(result.report.imported, 1);
  assert.deepEqual(
    result.layers.map((layer) => [layer.name, layer.visible, layer.locked]),
    [["A-WALL", false, true]],
  );
  assert.equal(result.entityLineage[0]?.sourceLayer, "a-wall");
});

test("DXF adapter reports case-folded duplicate layer table names", async () => {
  const result = await buildDrawingDxfImport(
    input(
      dxf({
        tables: layerTable([{ name: "A-WALL" }, { name: "a-wall" }]),
        entities: line({ handle: "61B", layer: "a-wall" }),
      }),
    ),
  );

  assert.equal(result.report.blocking[0]?.code, "DUPLICATE_LAYER_NAME");
  assert.equal(result.report.imported, 0);
  assert.deepEqual(result.operations, []);
});

test("DXF adapter reports normalized entity style semantics", async () => {
  const result = await buildDrawingDxfImport(
    input(
      dxf({
        entities: [
          ...line({ handle: "620" }),
          [6, "DASHED"],
          [48, 0.5],
          [62, 1],
          [370, 25],
          [0, "LWPOLYLINE"],
          [5, "621"],
          [8, "A-WALL"],
          [90, 2],
          [70, 128],
          [10, 0],
          [20, 0],
          [10, 5],
          [20, 0],
        ],
      }),
    ),
  );

  assert.equal(result.report.imported, 2);
  assert.deepEqual(
    result.report.converted
      .filter((item) => item.code === "STYLE_NORMALIZED")
      .map((item) => item.entityKey),
    ["entities:0", "entities:1"],
  );
});

test("DXF adapter reports truecolor and INSERT style inheritance normalization", async () => {
  const result = await buildDrawingDxfImport(
    input(
      dxf({
        tables: [
          [0, "TABLE"],
          [2, "LAYER"],
          [70, 1],
          [0, "LAYER"],
          [2, "TRUECOLOR-LAYER"],
          [70, 0],
          [420, 255],
          [0, "ENDTAB"],
        ],
        blocks: block("UNIT", line({ layer: "0" })),
        entities: [
          ...line({ handle: "622" }),
          [420, 16711680],
          ...line({ handle: "623", layer: "TRUECOLOR-LAYER" }),
          ...insert({ handle: "624" }),
          [420, 65280],
        ],
      }),
    ),
  );

  assert.equal(result.report.imported, 3);
  assert.deepEqual(
    result.report.converted
      .filter((item) => item.code === "STYLE_NORMALIZED")
      .map((item) => item.entityKey),
    ["entities:0", "entities:1", "entities:2"],
  );
});

test("DXF adapter inventories entity types that dxf-parser drops", async () => {
  const result = await buildDrawingDxfImport(
    input(
      dxf({
        entities: [
          [0, "HATCH"],
          [5, "700"],
          [8, "A-HATCH"],
          [2, "SOLID"],
          [70, 1],
          [0, "ATTRIB"],
          [5, "701"],
          [8, "A-ANNO"],
          [1, "attribute"],
          ...line({ handle: "702" }),
        ],
      }),
    ),
  );

  assert.equal(result.report.imported, 1);
  assert.deepEqual(
    result.report.skipped.map((item) => [item.code, item.entityType]),
    [
      ["UNSUPPORTED_RAW_ENTITY", "HATCH"],
      ["UNSUPPORTED_RAW_ENTITY", "ATTRIB"],
    ],
  );
});

test("DXF raw preflight counts points in entities that dxf-parser drops", async () => {
  const result = await buildDrawingDxfImport(
    input(dxf({ entities: [...droppedHatch(), ...line()] }), {
      limits: { maxPoints: 3 },
    }),
  );

  assert.equal(result.report.blocking[0]?.code, "POINT_LIMIT");
  assert.equal(result.report.imported, 0);
  assert.deepEqual(result.operations, []);
});

test("DXF raw preflight rejects unsafe coordinates in entities that dxf-parser drops", async () => {
  const result = await buildDrawingDxfImport(
    input(dxf({ entities: [...droppedHatch(101), ...line()] }), {
      limits: { maxCoordinateMillimeters: 100 },
    }),
  );

  assert.equal(result.report.blocking[0]?.code, "COORDINATE_LIMIT");
  assert.equal(result.report.imported, 0);
  assert.deepEqual(result.operations, []);
});

test("DXF raw preflight rejects non-finite coordinates in entities that dxf-parser drops", async () => {
  const result = await buildDrawingDxfImport(
    input(dxf({ entities: [...droppedHatch("Infinity"), ...line()] })),
  );

  assert.equal(result.report.blocking[0]?.code, "NON_FINITE_NUMBER");
  assert.equal(result.report.imported, 0);
  assert.deepEqual(result.operations, []);
});

test("DXF raw preflight counts dropped HATCH pattern base points", async () => {
  const result = await buildDrawingDxfImport(
    input(dxf({ entities: [...droppedPatternHatch(), ...line()] }), {
      limits: { maxPoints: 3 },
    }),
  );

  assert.equal(result.report.blocking[0]?.code, "POINT_LIMIT");
  assert.equal(result.report.imported, 0);
  assert.deepEqual(result.operations, []);
});

test("DXF raw preflight rejects unsafe dropped HATCH pattern coordinates", async () => {
  const result = await buildDrawingDxfImport(
    input(dxf({ entities: [...droppedPatternHatch(101), ...line()] }), {
      limits: { maxCoordinateMillimeters: 100 },
    }),
  );

  assert.equal(result.report.blocking[0]?.code, "COORDINATE_LIMIT");
  assert.equal(result.report.imported, 0);
  assert.deepEqual(result.operations, []);
});

test("DXF raw preflight rejects non-finite dropped HATCH pattern coordinates", async () => {
  const result = await buildDrawingDxfImport(
    input(dxf({ entities: [...droppedPatternHatch("Infinity"), ...line()] })),
  );

  assert.equal(result.report.blocking[0]?.code, "NON_FINITE_NUMBER");
  assert.equal(result.report.imported, 0);
  assert.deepEqual(result.operations, []);
});

test("DXF adapter preserves only actual raw handles with section-relative entity identity", async () => {
  const result = await buildDrawingDxfImport(
    input(
      dxf({
        entities: [
          [0, "HATCH"],
          [5, "DROPPED"],
          [8, "A-HATCH"],
          ...line({ handle: "AB12" }),
          [0, "LINE"],
          [8, "A-ANNO"],
          [10, 1],
          [20, 1],
          [11, 2],
          [21, 1],
        ],
      }),
    ),
  );

  assert.equal(result.report.imported, 2);
  assert.ok(Array.isArray(result.entityLineage));
  assert.deepEqual(
    result.entityLineage.map((entity) => ({
      objectId: entity.objectId,
      entityKey: entity.entityKey,
      entityType: entity.entityType,
      sourceLayer: entity.sourceLayer,
      rawHandle: entity.rawHandle,
    })),
    [
      {
        objectId: result.objects[0].id,
        entityKey: "entities:0@raw:ENTITIES:1",
        entityType: "LINE",
        sourceLayer: "A-WALL",
        rawHandle: "AB12",
      },
      {
        objectId: result.objects[1].id,
        entityKey: "entities:1@raw:ENTITIES:2",
        entityType: "LINE",
        sourceLayer: "A-ANNO",
        rawHandle: null,
      },
    ],
  );
});

test("DXF adapter preserves actual BLOCK child handles without borrowing INSERT handles", async () => {
  const result = await buildDrawingDxfImport(
    input(
      dxf({
        blocks: block("UNIT", [
          [0, "HATCH"],
          [5, "DROPPED-BLOCK"],
          [8, "A-HATCH"],
          ...line({ handle: "B10C", layer: "0" }),
        ]),
        entities: insert({ handle: "7A0" }),
      }),
    ),
  );

  assert.equal(result.report.imported, 1);
  assert.deepEqual(result.entityLineage, [
    {
      objectId: result.objects[0].id,
      entityKey: "entities:0/block:0@raw:BLOCKS:0:1",
      entityType: "LINE",
      sourceLayer: "0",
      rawHandle: "B10C",
    },
  ]);
  assert.notEqual(result.entityLineage[0].rawHandle, "7A0");
});

test("DXF adapter fails closed when duplicate BLOCK names could corrupt raw lineage", async () => {
  const result = await buildDrawingDxfImport(
    input(
      dxf({
        blocks: [
          ...block("DUP", line({ handle: "A1", layer: "FIRST", end: [1, 0] })),
          ...block("DUP", line({ handle: "B2", layer: "SECOND", end: [2, 0] })),
        ],
        entities: insert({ name: "DUP", scale: [1, 1], rotation: 0 }),
      }),
    ),
  );

  assert.equal(result.report.blocking[0]?.code, "DUPLICATE_BLOCK_NAME");
  assert.equal(result.report.imported, 0);
  assert.deepEqual(result.objects, []);
  assert.deepEqual(result.entityLineage, []);
  assert.deepEqual(result.operations, []);
});

test("DXF adapter canonicalizes lowercase raw handles and rejects invalid handles", async () => {
  const normalized = await buildDrawingDxfImport(
    input(dxf({ entities: line({ handle: "ab12" }) })),
  );
  assert.equal(normalized.entityLineage[0]?.rawHandle, "AB12");
  assert.ok(
    normalized.report.converted.some(
      (item) => item.code === "HANDLE_NORMALIZED",
    ),
  );

  for (const handle of ["NOT-HEX", "A".repeat(33)]) {
    const rejected = await buildDrawingDxfImport(
      input(dxf({ entities: line({ handle }) })),
    );
    assert.equal(rejected.report.blocking[0]?.code, "INVALID_HANDLE");
    assert.equal(rejected.report.imported, 0);
    assert.deepEqual(rejected.entityLineage, []);
    assert.deepEqual(rejected.operations, []);
  }
});

test("DXF adapter bounds BLOCK symbols before parser expansion", async () => {
  for (const name of ["B".repeat(256), " BAD", "BAD\u0007NAME"]) {
    const result = await buildDrawingDxfImport(
      input(
        dxf({
          blocks: block(name, line({ handle: "B10C", layer: "0" })),
          entities: insert({ name, scale: [1, 1], rotation: 0 }),
        }),
      ),
    );

    assert.equal(result.report.blocking[0]?.code, "INVALID_BLOCK_NAME");
    assert.equal(result.report.imported, 0);
    assert.deepEqual(result.entityLineage, []);
    assert.deepEqual(result.operations, []);
  }
});

test("DXF adapter does not drop legacy POLYLINE header widths", async () => {
  for (const widthCode of [40, 41]) {
    const result = await buildDrawingDxfImport(
      input(
        dxf({
          entities: [
            [0, "POLYLINE"],
            [5, `80${widthCode}`],
            [8, "A-WALL"],
            [66, 1],
            [70, 0],
            [widthCode, 2],
            [0, "VERTEX"],
            [8, "A-WALL"],
            [10, 0],
            [20, 0],
            [0, "VERTEX"],
            [8, "A-WALL"],
            [10, 10],
            [20, 0],
            [0, "SEQEND"],
          ],
        }),
      ),
    );

    assert.equal(result.report.blocking[0]?.code, "UNSUPPORTED_POLYLINE_WIDTH");
    assert.equal(result.report.imported, 0);
    assert.deepEqual(result.operations, []);
  }
});

test("DXF adapter does not approximate horizontally scaled TEXT", async () => {
  const result = await buildDrawingDxfImport(
    input(
      dxf({
        entities: [
          [0, "TEXT"],
          [5, "810"],
          [8, "A-ANNO"],
          [10, 0],
          [20, 0],
          [40, 2.5],
          [41, 0.8],
          [1, "scaled"],
        ],
      }),
    ),
  );

  assert.equal(result.report.blocking[0]?.code, "UNSUPPORTED_TEXT_SCALE");
  assert.equal(result.report.imported, 0);
  assert.deepEqual(result.operations, []);
});

test("DXF adapter does not treat the default-alignment TEXT second point as a width", async () => {
  const result = await buildDrawingDxfImport(
    input(
      dxf({
        entities: [
          [0, "TEXT"],
          [5, "811"],
          [8, "A-ANNO"],
          [10, 0],
          [20, 0],
          [11, 0.1],
          [21, 0],
          [40, 2.5],
          [1, "HELLO"],
        ],
      }),
    ),
  );

  assert.equal(result.report.imported, 1);
  assert.equal(result.objects[0].geometry.width, 7.5);
  assert.equal(result.report.converted[0]?.code, "TEXT_WIDTH_DERIVED");
});

test("DXF adapter bounds TEXT before parser and width expansion", async () => {
  const result = await buildDrawingDxfImport(
    input(
      dxf({
        entities: [
          [0, "TEXT"],
          [5, "812"],
          [8, "A-ANNO"],
          [10, 0],
          [20, 0],
          [40, 2.5],
          [1, "A".repeat(10_001)],
        ],
      }),
    ),
  );

  assert.equal(result.report.blocking[0]?.code, "TEXT_LENGTH_LIMIT");
  assert.equal(result.report.imported, 0);
  assert.deepEqual(result.operations, []);
});

test("DXF adapter does not flatten semantic legacy POLYLINE VERTEX flags", async () => {
  for (const flag of [1, 2, 8, 16, 32, 64, 128]) {
    const result = await buildDrawingDxfImport(
      input(
        dxf({
          entities: [
            [0, "POLYLINE"],
            [5, `82${flag}`],
            [8, "A-WALL"],
            [66, 1],
            [70, 0],
            [0, "VERTEX"],
            [8, "A-WALL"],
            [10, 0],
            [20, 0],
            [70, flag],
            [0, "VERTEX"],
            [8, "A-WALL"],
            [10, 10],
            [20, 0],
            [0, "SEQEND"],
          ],
        }),
      ),
    );

    assert.equal(
      result.report.blocking[0]?.code,
      "UNSUPPORTED_POLYLINE_VERTEX_FLAGS",
    );
    assert.equal(result.report.imported, 0);
    assert.deepEqual(result.operations, []);
  }
});

test("DXF raw preflight counts entity types that the parser discards", async () => {
  const entities = Array.from({ length: 4 }, (_, index) => [
    [0, "HATCH"],
    [5, `90${index}`],
    [8, "A-HATCH"],
  ]).flat();
  const result = await buildDrawingDxfImport(
    input(dxf({ entities }), { limits: { maxEntities: 3 } }),
  );

  assert.equal(result.report.blocking[0]?.code, "ENTITY_LIMIT");
  assert.equal(
    result.report.skipped.reduce((total, item) => total + (item.count ?? 1), 0),
    4,
  );
  assert.deepEqual(result.operations, []);
});

test("DXF raw preflight caps detailed unsupported reports with an exact omitted count", async () => {
  const entities = Array.from({ length: 6 }, (_, index) => [
    [0, `UNSUPPORTED_${index}`],
    [5, `91${index}`],
    [8, "MISC"],
  ]).flat();
  const result = await buildDrawingDxfImport(
    input(dxf({ entities }), {
      limits: { maxEntities: 100, maxReportIssues: 3 },
    }),
  );

  assert.equal(result.report.blocking.length, 0);
  assert.equal(result.report.skipped.length, 3);
  assert.equal(result.report.skipped.at(-1)?.code, "REPORT_TRUNCATED");
  assert.equal(result.report.skipped.at(-1)?.count, 4);
});

test("DXF report cap continues from raw inventory through parsed skips", async () => {
  const result = await buildDrawingDxfImport(
    input(
      dxf({
        entities: [
          [0, "HATCH"],
          [5, "930"],
          [8, "MISC"],
          [0, "LEADER"],
          [5, "931"],
          [8, "MISC"],
          ...Array.from({ length: 4 }, (_, index) => [
            [0, "POINT"],
            [5, `94${index}`],
            [8, "MISC"],
            [10, index],
            [20, 0],
          ]).flat(),
        ],
      }),
      { limits: { maxReportIssues: 3 } },
    ),
  );

  assert.equal(result.report.skipped.length, 3);
  assert.equal(result.report.skipped.at(-1)?.code, "REPORT_TRUNCATED");
  assert.equal(result.report.skipped.at(-1)?.count, 4);
});

test("DXF report cap also bounds conversion details", async () => {
  const entities = Array.from({ length: 6 }, (_, index) => [
    [0, "TEXT"],
    [5, `95${index}`],
    [8, "A-ANNO"],
    [10, index],
    [20, 0],
    [40, 2.5],
    [1, `note ${index}`],
  ]).flat();
  const result = await buildDrawingDxfImport(
    input(dxf({ entities }), { limits: { maxReportIssues: 3 } }),
  );

  assert.equal(result.report.imported, 6);
  assert.equal(result.report.converted.length, 3);
  assert.equal(result.report.converted.at(-1)?.code, "REPORT_TRUNCATED");
  assert.equal(result.report.converted.at(-1)?.count, 4);
});

test("DXF raw preflight enforces the elapsed deadline before parser work", async () => {
  const entities = Array.from({ length: 20 }, (_, index) => [
    [0, "HATCH"],
    [5, `92${index}`],
    [8, "A-HATCH"],
  ]).flat();
  let clockReads = 0;
  const result = await buildDrawingDxfImport(
    input(dxf({ entities }), {
      limits: { maxElapsedMilliseconds: 1_000 },
      now: () => (clockReads++ < 4 ? 0 : 1_001),
    }),
  );

  assert.equal(result.report.blocking[0]?.code, "ELAPSED_LIMIT");
  assert.deepEqual(result.operations, []);
});

test("DXF adapter flattens a bounded local block with an exact 2D transform and inherited layer", async () => {
  const bytes = dxf({
    blocks: block(
      "UNIT",
      line({ layer: "0", start: [1, 1], end: [2, 1] }),
      [1, 1],
    ),
    entities: insert(),
  });
  const result = await buildDrawingDxfImport(input(bytes));

  assert.equal(result.report.imported, 1);
  assert.deepEqual(result.report.skipped, []);
  assert.ok(
    result.report.converted.some((item) => item.code === "BLOCK_FLATTENED"),
  );
  assert.deepEqual(
    result.layers.map((layer) => layer.name),
    ["BLOCKS"],
  );
  assert.deepEqual(result.objects[0].geometry, {
    type: "line",
    start: { x: 10, y: 20 },
    end: { x: 10, y: 22 },
  });
});

test("DXF adapter fails closed on byte, entity, point, block-depth, coordinate, finite-number, NUL, and elapsed-work limits", async () => {
  const cases = [
    {
      expected: "BYTE_LIMIT",
      input: input(dxf({ entities: line() }), { limits: { maxBytes: 8 } }),
    },
    {
      expected: "ENTITY_LIMIT",
      input: input(dxf({ entities: [...line(), ...line({ handle: "11" })] }), {
        limits: { maxEntities: 1 },
      }),
    },
    {
      expected: "POINT_LIMIT",
      input: input(dxf({ entities: line() }), { limits: { maxPoints: 1 } }),
    },
    {
      expected: "COORDINATE_LIMIT",
      input: input(dxf({ entities: line({ end: [101, 0] }) }), {
        limits: { maxCoordinateMillimeters: 100 },
      }),
    },
    {
      expected: "NON_FINITE_NUMBER",
      input: input(dxf({ entities: line({ end: ["Infinity", 0] }) })),
    },
    {
      expected: "UNSUPPORTED_EXTRUSION",
      input: input(
        dxf({
          entities: [
            [0, "CIRCLE"],
            [8, "A-WALL"],
            [10, 0],
            [20, 0],
            [40, 5],
            [210, 1],
            [220, 0],
            [230, 1],
          ],
        }),
      ),
    },
    {
      expected: "UNSUPPORTED_THICKNESS",
      input: input(dxf({ entities: [...line(), [39, 2]] })),
    },
    {
      expected: "UNSUPPORTED_TEXT_OBLIQUE",
      input: input(
        dxf({
          entities: [
            [0, "TEXT"],
            [8, "A-ANNO"],
            [10, 0],
            [20, 0],
            [40, 2.5],
            [1, "skewed"],
            [51, 15],
          ],
        }),
      ),
    },
    {
      expected: "UNSUPPORTED_TEXT_GENERATION",
      input: input(
        dxf({
          entities: [
            [0, "TEXT"],
            [8, "A-ANNO"],
            [10, 0],
            [20, 0],
            [40, 2.5],
            [1, "mirrored"],
            [71, 2],
          ],
        }),
      ),
    },
    {
      expected: "NUL_BYTE",
      input: input(
        encoder.encode(
          `${new TextDecoder().decode(dxf({ entities: line() }))}\0`,
        ),
      ),
    },
    {
      expected: "ELAPSED_LIMIT",
      input: input(dxf({ entities: line() }), {
        limits: { maxElapsedMilliseconds: 1 },
        now: (() => {
          const values = [0, 2, 2, 2];
          return () => values.shift() ?? 2;
        })(),
      }),
    },
    {
      expected: "BLOCK_DEPTH_LIMIT",
      input: input(
        dxf({
          blocks: [
            ...block("INNER", line({ layer: "0" })),
            ...block(
              "OUTER",
              insert({ name: "INNER", layer: "0", scale: [1, 1], rotation: 0 }),
            ),
          ],
          entities: insert({ name: "OUTER", scale: [1, 1], rotation: 0 }),
        }),
        { limits: { maxBlockDepth: 1 } },
      ),
    },
  ];

  assert.ok(DRAWING_DXF_IMPORT_LIMITS.maxBytes > 0);
  for (const candidate of cases) {
    const result = await buildDrawingDxfImport(candidate.input);
    assert.equal(result.report.blocking[0]?.code, candidate.expected);
    assert.deepEqual(result.layers, []);
    assert.deepEqual(result.objects, []);
    assert.deepEqual(result.operations, []);
  }
});

test("DXF adapter chunks deterministic operations to the existing collaboration byte and item contract", async () => {
  const entities = Array.from({ length: 300 }, (_, index) =>
    line({
      handle: (1000 + index).toString(16),
      start: [index, 0],
      end: [index, 1],
    }),
  ).flat();
  const result = await buildDrawingDxfImport(input(dxf({ entities })));

  assert.equal(result.report.imported, 300);
  assert.deepEqual(result.report.blocking, []);
  assert.ok(result.operations.length > 2);
  for (const operation of result.operations) {
    assert.equal(
      DrawingCollaborationOperationSchema.safeParse({
        ...operation,
        actorId: "71000000-0000-4000-8000-000000000003",
        schemaVersion: DRAWING_COLLABORATION_SCHEMA_VERSION,
      }).success,
      true,
    );
  }
  assert.deepEqual(
    await buildDrawingDxfImport(input(dxf({ entities }))),
    result,
  );
});

test("DXF adapter blocks one entity that cannot fit the canonical collaboration operation", async () => {
  const vertices = Array.from({ length: 257 }, (_, index) => [
    [10, index],
    [20, index % 2],
  ]).flat();
  const result = await buildDrawingDxfImport(
    input(
      dxf({
        entities: [
          [0, "LWPOLYLINE"],
          [5, "900"],
          [8, "A-WALL"],
          [90, 257],
          ...vertices,
        ],
      }),
    ),
  );

  assert.equal(result.report.blocking[0]?.code, "OPERATION_LIMIT");
  assert.deepEqual(result.operations, []);
  assert.deepEqual(result.objects, []);
});

test("DXF adapter never substitutes an origin for a missing BLOCK base point", async () => {
  const result = await buildDrawingDxfImport(
    input(
      dxf({
        blocks: [
          [0, "BLOCK"],
          [8, "0"],
          [2, "UNIT"],
          [3, "UNIT"],
          [70, 0],
          ...line({ layer: "0" }),
          [0, "ENDBLK"],
        ],
        entities: insert(),
      }),
    ),
  );

  assert.equal(result.report.imported, 0);
  assert.equal(result.report.skipped[0]?.code, "UNSAFE_BLOCK_TRANSFORM");
  assert.deepEqual(result.operations, []);
});

test("DXF parser runs in a terminable worker rather than the request event loop", async () => {
  const source = await readFile(
    new URL("../app/lukas/lib/drawing-dxf-import.server.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /node:worker_threads/);
  assert.match(source, /new Worker\(/);
  assert.match(source, /worker\.terminate\(\)/);
});

test("DXF parser remains a statically traced production dependency", async () => {
  const source = await readFile(
    new URL("../app/lukas/lib/drawing-dxf-import.server.ts", import.meta.url),
    "utf8",
  );

  assert.match(
    source,
    /import\s+DxfParser,\s*\{\s*type IDxf\s*\}\s+from "dxf-parser";/,
  );
  assert.match(source, /typeof DxfParser !== "function"/);
});
