import assert from "node:assert/strict";
import test from "node:test";
import { buildNativeDrawingTemplate } from "../app/lukas/lib/drawing-native-templates.ts";
import { nativeAssetCanonicalJson } from "../app/lukas/lib/drawing-native-symbols.ts";
import {
  nativeAssetSha256,
  listNativeDrawingSymbols,
} from "../app/lukas/lib/drawing-native-symbols.ts";
import {
  cadId,
  cadInput,
  blankCadInput,
  addCadObject,
  wallCadInput,
} from "./fixtures/drawing-cad-fixtures.mjs";
import { DrawingCadManifestSchema } from "../app/lukas/lib/drawing-cad-manifest.ts";

const projection = await import(
  "../app/lukas/lib/drawing-cad-projection.ts"
).catch((error) => {
  if (
    error.code === "ERR_MODULE_NOT_FOUND" &&
    error.message.includes("drawing-cad-projection.ts")
  )
    return {};
  throw error;
});
const build = (input) => projection.buildDrawingCadManifest(input);
test("blank native canvas is a complete zero-entity manifest", async () => {
  const manifest = await build(blankCadInput());
  assert.deepEqual(manifest.entities, []);
  assert.deepEqual(manifest.lineage, []);
  assert.equal(manifest.canvas.viewport.scale, 0.02);
});
for (const key of [
  "measured-plan",
  "office-layout",
  "remodel-phases",
  "finishes-takeoff",
])
  test(`${key} preserves complete canonical lineage and deterministic source identity`, async () => {
    const input = cadInput(key),
      before = nativeAssetCanonicalJson(input);
    const result = await build(input);
    assert.equal(
      result.scope.structureSha256,
      await nativeAssetSha256(input.structure),
    );
    assert.equal(
      nativeAssetCanonicalJson(result),
      nativeAssetCanonicalJson(await build(input)),
    );
    const expected = [
      ...Object.keys(input.structure.objects),
      ...Object.keys(input.structure.blockInstances),
    ].sort();
    assert.deepEqual(result.lineage.map((row) => row.id).sort(), expected);
    assert.deepEqual(
      result.lineage.flatMap((row) => row.entityIds).sort(),
      result.entities.map((entity) => entity.id).sort(),
    );
    assert.ok(result.lineage.every((row) => row.entityIds.length > 0));
    assert.deepEqual(result.metadata.structure, input.structure);
    assert.equal(result.metadata.schedulePlacement, "not-authored");
    assert.equal(nativeAssetCanonicalJson(input), before);
  });
test("24 original symbols remain editable blocks with local primitive lineage and reflected signed INSERT transform", async () => {
  const input = blankCadInput();
  listNativeDrawingSymbols().forEach((symbol, index) => {
    const block = {
      id: cadId(1000 + index),
      revisionId: input.structure.revisionId,
      name: symbol.name,
      version: 1,
      primitives: structuredClone(symbol.primitives),
    };
    input.structure.blocks[block.id] = block;
    const instance = {
      id: cadId(2000 + index),
      lineageId: cadId(3000 + index),
      blockId: block.id,
      layerId: Object.keys(input.structure.layers)[0],
      name: symbol.name,
      origin: { x: 100, y: 200 },
      rotation: 30,
      scaleX: -2,
      scaleY: 3,
      version: 1,
    };
    input.structure.blockInstances[instance.id] = instance;
  });
  const result = await build(input);
  assert.equal(result.blocks.length, 24);
  assert.equal(result.entities.length, 24);
  for (const entity of result.entities) {
    assert.deepEqual(entity.style, { kind: "block-defined" });
    assert.equal(entity.geometry.type, "insert");
    assert.deepEqual(entity.geometry.origin, { x: 100, y: -200 });
    assert.equal(entity.geometry.rotationDegrees, -30);
    assert.equal(entity.geometry.scaleX, -2);
    assert.equal(entity.geometry.scaleY, 3);
  }
  for (const block of result.blocks) {
    assert.deepEqual(
      block.primitives.map((p) => p.localId),
      input.structure.blocks[block.id].primitives.map((p) => p.localId),
    );
    assert.deepEqual(
      block.primitives.flatMap((p) => p.entityIds).sort(),
      block.entities.map((e) => e.id).sort(),
    );
    assert.ok(block.entities.every((e) => e.layerId === null));
  }
});
test("wall strips cut center-offset opening exactly and keep square outer caps with no white cutout", async () => {
  const { input, wall, opening } = wallCadInput();
  const result = await build(input);
  const ids = result.lineage.find((row) => row.id === wall.id).entityIds;
  const strips = result.entities.filter(
    (e) => ids.includes(e.id) && e.geometry.type === "hatch",
  );
  assert.deepEqual(
    strips.map((e) => e.geometry.boundary),
    [
      [
        { x: -75, y: -75 },
        { x: 2300, y: -75 },
        { x: 2300, y: 75 },
        { x: -75, y: 75 },
      ],
      [
        { x: 3200, y: -75 },
        { x: 6075, y: -75 },
        { x: 6075, y: 75 },
        { x: 3200, y: 75 },
      ],
    ],
  );
  assert.ok(strips.every((e) => e.geometry.color === "#123456"));
  const markers = result.entities.filter((e) =>
    result.lineage
      .find((row) => row.id === opening.id)
      .entityIds.includes(e.id),
  );
  assert.deepEqual(
    markers.map((e) => e.geometry),
    [
      { type: "line", start: { x: 2300, y: 0 }, end: { x: 3200, y: 0 } },
      { type: "line", start: { x: 2300, y: 0 }, end: { x: 2300, y: -87.5 } },
    ],
  );
  assert.deepEqual(
    markers.map((e) => e.style.requestedPaperLineweightMillimeters),
    [0.2, 0.12],
  );
});
test("overlapping and touching opening spans merge and fully open walls retain explicit zero lineage", async () => {
  const { input, wall, opening } = wallCadInput();
  opening.geometry.offsetMillimeters = 1500;
  opening.geometry.widthMillimeters = 3000;
  addCadObject(input, 102, {
    ...opening.geometry,
    offsetMillimeters: 4000,
    widthMillimeters: 4000,
  });
  const result = await build(input);
  const row = result.lineage.find((row) => row.id === wall.id);
  assert.deepEqual(row.entityIds, []);
  assert.equal(row.representation, "fully-opened-wall");
});
test("many hosted walls bound full object traversals while keeping opening groups and merged intervals exact", async () => {
  const input = blankCadInput();
  const firstWall = addCadObject(input, 900, {
    type: "wall",
    semanticVersion: 1,
    start: { x: 0, y: 0 },
    end: { x: 10000, y: 0 },
    thicknessMillimeters: 200,
    heightMillimeters: 2700,
  });
  const secondWall = addCadObject(input, 901, {
    type: "wall",
    semanticVersion: 1,
    start: { x: 0, y: 1000 },
    end: { x: 10000, y: 1000 },
    thicknessMillimeters: 200,
    heightMillimeters: 2700,
  });
  for (let n = 0; n < 20; n++)
    addCadObject(input, 1000 + n, {
      type: "wall",
      semanticVersion: 1,
      start: { x: 0, y: 2000 + n * 500 },
      end: { x: 10000, y: 2000 + n * 500 },
      thicknessMillimeters: 200,
      heightMillimeters: 2700,
    });
  for (const [id, hostWallId, offsetMillimeters, widthMillimeters] of [
    [100, firstWall.id, 5000, 2000],
    [200, secondWall.id, 7500, 1000],
    [300, firstWall.id, 3500, 2000],
    [400, secondWall.id, 2000, 1000],
  ])
    addCadObject(input, id, {
      type: "opening",
      semanticVersion: 1,
      hostWallId,
      offsetMillimeters,
      widthMillimeters,
      heightMillimeters: 2100,
      sillHeightMillimeters: 0,
      openingKind: "door",
    });

  const originalObjectValues = Object.values;
  const drawingObjectCount = Object.keys(input.structure.objects).length;
  let fullObjectTraversals = 0;
  Object.values = function (...args) {
    const values = originalObjectValues(...args);
    if (
      values.length === drawingObjectCount &&
      values.every(
        (value) =>
          value &&
          typeof value === "object" &&
          typeof value.id === "string" &&
          typeof value.layerId === "string" &&
          value.geometry &&
          typeof value.geometry.type === "string",
      )
    )
      fullObjectTraversals += 1;
    return values;
  };
  let result;
  try {
    result = await build(input);
  } finally {
    Object.values = originalObjectValues;
  }

  assert.ok(
    fullObjectTraversals <= 10,
    `expected at most 10 full drawing-object traversals, received ${fullObjectTraversals}`,
  );
  const wallHatches = (wallId) => {
    const entityIds = result.lineage.find((row) => row.id === wallId).entityIds;
    return result.entities
      .filter(
        (entity) =>
          entityIds.includes(entity.id) && entity.geometry.type === "hatch",
      )
      .map((entity) => entity.geometry.boundary);
  };
  assert.deepEqual(wallHatches(firstWall.id), [
    [
      { x: -100, y: -100 },
      { x: 2500, y: -100 },
      { x: 2500, y: 100 },
      { x: -100, y: 100 },
    ],
    [
      { x: 6000, y: -100 },
      { x: 10100, y: -100 },
      { x: 10100, y: 100 },
      { x: 6000, y: 100 },
    ],
  ]);
  assert.deepEqual(wallHatches(secondWall.id), [
    [
      { x: -100, y: -1100 },
      { x: 1500, y: -1100 },
      { x: 1500, y: -900 },
      { x: -100, y: -900 },
    ],
    [
      { x: 2500, y: -1100 },
      { x: 7000, y: -1100 },
      { x: 7000, y: -900 },
      { x: 2500, y: -900 },
    ],
    [
      { x: 8000, y: -1100 },
      { x: 10100, y: -1100 },
      { x: 10100, y: -900 },
      { x: 8000, y: -900 },
    ],
  ]);
});
test("true arc reflection, literal multiline Korean and 6000 mm dimension remain semantic entities", async () => {
  const input = blankCadInput();
  addCadObject(input, 100, {
    type: "arc",
    semanticVersion: 1,
    center: { x: 10, y: 20 },
    radius: 100,
    startAngleDegrees: 30,
    sweepAngleDegrees: 90,
  });
  addCadObject(input, 101, {
    type: "arc",
    semanticVersion: 1,
    center: { x: 10, y: 20 },
    radius: 100,
    startAngleDegrees: 30,
    sweepAngleDegrees: -90,
  });
  addCadObject(
    input,
    102,
    {
      type: "dimension",
      start: { x: 0, y: 0 },
      end: { x: 6000, y: 0 },
      offset: 500,
      calibrationId: null,
    },
    { style: { stroke: "#123456", strokeWidth: 5, fill: null, fontSize: 150 } },
  );
  addCadObject(
    input,
    103,
    {
      type: "text",
      origin: { x: 20, y: 30 },
      width: 1000,
      text: "한글\\{원문}\\P\n다음 줄 😀",
    },
    { style: { stroke: "#123456", strokeWidth: 5, fill: null, fontSize: 125 } },
  );
  const result = await build(input),
    arcs = result.entities
      .filter((e) => e.geometry.type === "arc")
      .map((e) => e.geometry);
  assert.deepEqual(
    arcs.map((a) => [a.startAngleDegrees, a.endAngleDegrees]),
    [
      [-120, -30],
      [-30, 60],
    ],
  );
  assert.deepEqual(arcs[0].center, { x: 10, y: -20 });
  const d = result.entities.find(
    (e) => e.geometry.type === "dimension",
  ).geometry;
  assert.equal(d.measurementMillimeters, 6000);
  assert.equal(d.precision, 1);
  assert.equal(d.suffix, " mm");
  assert.deepEqual(d.dimensionLinePoint, { x: 6000, y: -500 });
  assert.deepEqual(d.textPosition, { x: 3000, y: -500 });
  const t = result.entities.find((e) => e.geometry.type === "text").geometry;
  assert.equal(t.text, "한글\\{원문}\\P\n다음 줄 😀");
  assert.equal(t.fontSize, 125);
  assert.equal(t.lineHeight, 1.2);
});
test("hidden locked geometry, rgba fill and fractional rotated polygon points are preserved", async () => {
  const input = blankCadInput(),
    layer = Object.values(input.structure.layers)[0];
  layer.visible = false;
  layer.locked = true;
  addCadObject(
    input,
    100,
    {
      type: "rectangle",
      origin: { x: 10, y: 20 },
      width: 100,
      height: 50,
      rotation: 30,
    },
    { style: { stroke: "#123456", strokeWidth: 7, fill: "#aabbcc80" } },
  );
  const result = await build(input),
    hatch = result.entities.find((e) => e.geometry.type === "hatch");
  assert.equal(result.layers.find((l) => l.id === layer.id).visible, false);
  assert.equal(result.layers.find((l) => l.id === layer.id).locked, true);
  assert.equal(hatch.geometry.color, "#aabbcc");
  assert.equal(hatch.geometry.opacity, 128 / 255);
  assert.equal(hatch.style.requestedPaperLineweightMillimeters, 0.14);
  assert.ok(Math.abs(hatch.geometry.boundary[1].x - 96.60254037844388) < 1e-10);
  assert.ok(Math.abs(hatch.geometry.boundary[1].y + 70) < 1e-10);
});
const invalidCases = [
  [
    "unknown input keys",
    (i) => {
      i.approved = true;
    },
  ],
  [
    "unknown graph keys",
    (i) => {
      i.structure.unknown = [];
    },
  ],
  [
    "unknown object keys",
    (i) => {
      Object.values(i.structure.objects)[0].approved = true;
    },
  ],
  [
    "collection key mismatch",
    (i) => {
      i.structure.objects[cadId(500)] = Object.values(i.structure.objects)[0];
    },
  ],
  [
    "duplicate cross collection ID",
    (i) => {
      const p = Object.values(i.structure.pages)[0],
        l = Object.values(i.structure.layers)[0];
      delete i.structure.layers[l.id];
      l.id = p.id;
      i.structure.layers[l.id] = l;
    },
  ],
  [
    "cross revision",
    (i) => {
      Object.values(i.structure.styles)[0].revisionId = cadId(500);
    },
  ],
  [
    "missing layer",
    (i) => {
      Object.values(i.structure.objects)[0].layerId = cadId(500);
    },
  ],
  [
    "missing opening host",
    (i) => {
      Object.values(i.structure.objects).find(
        (o) => o.geometry.type === "opening",
      ).geometry.hostWallId = cadId(500);
    },
  ],
  [
    "out of scope host layer",
    (i) => {
      const wall = Object.values(i.structure.objects).find(
        (o) => o.geometry.type === "wall",
      );
      i.structure.layers[wall.layerId].canvasId = cadId(500);
    },
  ],
  [
    "additional canvas",
    (i) => {
      const c = Object.values(i.structure.canvases)[0];
      i.structure.canvases[cadId(500)] = { ...c, id: cadId(500) };
    },
  ],
  [
    "source link",
    (i) => {
      i.structure.sources[cadId(500)] = { id: cadId(500) };
    },
  ],
  [
    "background",
    (i) => {
      Object.values(i.structure.canvases)[0].background = {
        sourceFileId: cadId(500),
        sourceSha256: "a".repeat(64),
        pdfPageNumber: 1,
        calibration: null,
      };
    },
  ],
  [
    "unconfirmed calibration",
    (i) => {
      Object.values(i.structure.objects).find(
        (o) => o.geometry.type === "dimension",
      ).geometry.calibrationId = cadId(500);
    },
  ],
  [
    "profile mismatch",
    (i) => {
      i.outputProfile.scaleDenominator = 51;
    },
  ],
  [
    "persisted profile mismatch",
    (i) => {
      Object.values(i.structure.canvases)[0].outputProfile = {
        ...i.outputProfile,
        paper: "OTHER",
      };
    },
  ],
  [
    "unsupported grid",
    (i) => {
      Object.values(i.structure.objects)[0].geometry = {
        type: "grid",
        semanticVersion: 1,
        start: { x: 0, y: 0 },
        end: { x: 100, y: 0 },
      };
    },
  ],
  [
    "malformed Unicode",
    (i) => {
      Object.values(i.structure.objects).find(
        (o) => o.geometry.type === "text",
      ).geometry.text = "\ud800";
    },
  ],
  [
    "nonfinite number",
    (i) => {
      i.outputProfile.scaleDenominator = Infinity;
    },
  ],
  [
    "unsafe operation sequence",
    (i) => {
      i.operationSequence = Number.MAX_SAFE_INTEGER + 1;
    },
  ],
  [
    "nonempty tombstones",
    (i) => {
      i.structure.tombstones = { [cadId(500)]: {} };
    },
  ],
  [
    "oversize metadata",
    (i) => {
      Object.values(i.structure.propertyValues)[0].value = "x".repeat(
        21 * 1024 * 1024,
      );
    },
  ],
  [
    "unassigned block",
    (i) => {
      i.structure.blockInstances = {};
    },
  ],
];
for (const [name, mutate] of invalidCases)
  test(`rejects ${name} without changing source`, async () => {
    const input = cadInput();
    mutate(input);
    await assert.rejects(() => build(input));
  });
test("manifest consumer rejects duplicate/dangling identity and unknown geometry properties", async () => {
  const original = await build(cadInput());
  for (const mutate of [
    (m) => m.entities.push(structuredClone(m.entities[0])),
    (m) => (m.entities[0].layerId = cadId(700)),
    (m) => m.lineage[0].entityIds.push("missing"),
    (m) => (m.entities[0].geometry.unknown = true),
    (m) => (m.blocks[0].primitives = []),
  ]) {
    const value = structuredClone(original);
    mutate(value);
    assert.equal(DrawingCadManifestSchema.safeParse(value).success, false);
  }
});
test("consumer rejects degenerate geometry and corrupted definition/profile metadata", async () => {
  const original = await build(cadInput());
  for (const mutate of [
    (m) => {
      m.entities.find((e) => e.geometry.type === "hatch").geometry.boundary = [
        { x: 0, y: 0 },
        { x: 1, y: 1 },
        { x: 2, y: 2 },
      ];
    },
    (m) => {
      const e = m.entities.find((e) => e.geometry.type === "line");
      e.geometry.end = { ...e.geometry.start };
    },
    (m) => {
      m.layers[0].visible = !m.layers[0].visible;
    },
    (m) => {
      m.blocks[0].primitives[0].localId = "unknown";
    },
    (m) => {
      m.entities.find(
        (e) => e.style.kind === "resolved",
      ).style.requestedPaperLineweightMillimeters = 999;
    },
    (m) => {
      m.metadata.structure.canvases[m.canvas.id].outputProfile = {
        ...m.canvas.outputProfile,
        paper: "different",
      };
    },
  ]) {
    const value = structuredClone(original);
    mutate(value);
    assert.equal(DrawingCadManifestSchema.safeParse(value).success, false);
  }
});
test("finite acyclic alias inputs canonicalize identically instead of rejecting JSON-equivalent trees", async () => {
  const input = blankCadInput();
  const a = addCadObject(input, 100, {
    type: "line",
    start: { x: 0, y: 0 },
    end: { x: 10, y: 0 },
  });
  const b = addCadObject(input, 101, {
    type: "line",
    start: { x: 0, y: 1 },
    end: { x: 10, y: 1 },
  });
  b.style = a.style;
  assert.equal(
    nativeAssetCanonicalJson(await build(input)),
    nativeAssetCanonicalJson(await build(JSON.parse(JSON.stringify(input)))),
  );
});
test("filled circles emit true circular HATCH plus CIRCLE without tessellation", async () => {
  const input = blankCadInput();
  addCadObject(
    input,
    100,
    { type: "circle", center: { x: 200, y: 300 }, radius: 50 },
    { style: { stroke: "#123456", strokeWidth: 5, fill: "#f8fafc80" } },
  );
  const result = await build(input);
  assert.deepEqual(
    result.entities.map((e) => e.geometry.type),
    ["hatch", "circle"],
  );
  assert.deepEqual(result.entities[0].geometry, {
    type: "hatch",
    boundary: { type: "circle", center: { x: 200, y: -300 }, radius: 50 },
    color: "#f8fafc",
    opacity: 128 / 255,
  });
  assert.deepEqual(result.entities[1].geometry, {
    type: "circle",
    center: { x: 200, y: -300 },
    radius: 50,
  });
});
test("object, block and aggregate point ceilings reject oversized valid-shape inputs before expansion", async () => {
  const objects = blankCadInput();
  for (let n = 0; n < 10001; n++)
    addCadObject(objects, 10000 + n, {
      type: "line",
      start: { x: 0, y: 0 },
      end: { x: 1, y: 0 },
    });
  await assert.rejects(() => build(objects), /budget/);
  const points = blankCadInput();
  addCadObject(points, 100, {
    type: "polyline",
    closed: false,
    points: Array.from({ length: 100001 }, (_, x) => ({ x, y: 0 })),
  });
  await assert.rejects(() => build(points), /budget/);
  const blocks = blankCadInput();
  for (let n = 0; n < 1001; n++) blocks.structure.blocks[cadId(10000 + n)] = {};
  await assert.rejects(() => build(blocks), /budget/);
});
test("canonical point budget counts source once rather than its retained metadata copy", async () => {
  const input = blankCadInput();
  addCadObject(input, 100, {
    type: "polyline",
    closed: false,
    points: Array.from({ length: 50001 }, (_, x) => ({ x, y: 0 })),
  });
  const result = await build(input);
  assert.equal(result.entities[0].geometry.points.length, 50001);
});
test("combined layer order retains hidden INSERTs and defers opening until its host", async () => {
  const input = blankCadInput(),
    [work, hidden] = Object.values(input.structure.layers);
  work.sortOrder = 2;
  hidden.sortOrder = 0;
  hidden.visible = false;
  hidden.locked = true;
  addCadObject(input, 100, {
    type: "line",
    start: { x: 0, y: 0 },
    end: { x: 10, y: 0 },
  });
  addCadObject(
    input,
    50,
    { type: "line", start: { x: 0, y: 1 }, end: { x: 10, y: 1 } },
    { layerId: hidden.id },
  );
  const host = addCadObject(input, 900, {
    type: "wall",
    semanticVersion: 1,
    start: { x: 0, y: 0 },
    end: { x: 6000, y: 0 },
    thicknessMillimeters: 150,
    heightMillimeters: 2700,
  });
  addCadObject(
    input,
    10,
    {
      type: "opening",
      semanticVersion: 1,
      hostWallId: host.id,
      offsetMillimeters: 1000,
      widthMillimeters: 500,
      heightMillimeters: 2000,
      sillHeightMillimeters: 0,
      openingKind: "door",
    },
    { layerId: hidden.id },
  );
  const block = {
    id: cadId(600),
    revisionId: input.structure.revisionId,
    name: "순서 블록",
    version: 1,
    primitives: [
      {
        localId: "line",
        name: "선",
        geometry: { type: "line", start: { x: 0, y: 0 }, end: { x: 10, y: 0 } },
        styleId: null,
        style: { stroke: "#123456", strokeWidth: 5, fill: null },
      },
    ],
  };
  input.structure.blocks[block.id] = block;
  const instance = {
    id: cadId(500),
    lineageId: cadId(501),
    blockId: block.id,
    layerId: hidden.id,
    name: "숨긴 INSERT",
    origin: { x: 10, y: 10 },
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
    version: 1,
  };
  input.structure.blockInstances[instance.id] = instance;
  const result = await build(input);
  assert.deepEqual(
    result.lineage.map((row) => row.id),
    [50, 500, 100, 900, 10].map(cadId),
  );
  assert.deepEqual(
    result.entities.map((e) => e.id),
    result.lineage.flatMap((row) => row.entityIds),
  );
  assert.equal(result.metadata.structure.layers[hidden.id].visible, false);
});
test("equivalent collection insertion orders produce byte-identical manifest JSON", async () => {
  const input = cadInput(),
    reordered = structuredClone(input);
  for (const [key, value] of Object.entries(reordered.structure))
    if (typeof value === "object")
      reordered.structure[key] = Object.fromEntries(
        Object.entries(value).reverse(),
      );
  assert.equal(
    JSON.stringify(await build(input)),
    JSON.stringify(await build(reordered)),
  );
});
test("microdegree sweep survives huge canonical start angle without cancellation", async () => {
  const input = blankCadInput();
  addCadObject(input, 100, {
    type: "arc",
    semanticVersion: 1,
    center: { x: 0, y: 0 },
    radius: 10,
    startAngleDegrees: 9000000000,
    sweepAngleDegrees: 0.000001,
  });
  const result = await build(input);
  assert.equal(result.entities[0].geometry.startAngleDegrees, -0.000001);
  assert.equal(result.entities[0].geometry.endAngleDegrees, 0);
});
function inputFor(key = "measured-plan") {
  const template = buildNativeDrawingTemplate(key);
  return {
    projectId: "10000000-0000-4000-8000-000000000001",
    documentId: "10000000-0000-4000-8000-000000000002",
    operationSequence: 0,
    canvasId: Object.keys(template.structure.canvases)[0],
    structure: template.structure,
    outputProfile: template.outputProfile,
  };
}
test("native measured graph projects world millimeters and reflected viewport without changing author graph", async () => {
  assert.equal(typeof projection.buildDrawingCadManifest, "function");
  const input = inputFor();
  const before = nativeAssetCanonicalJson(input.structure);
  const result = await projection.buildDrawingCadManifest(input);
  assert.equal(result.units, "mm");
  assert.equal(result.qualification, "experimental-unqualified");
  assert.equal(result.canvas.modelWidthMillimeters, 21000);
  assert.equal(result.canvas.modelHeightMillimeters, 14850);
  assert.equal(result.canvas.outputProfile.scaleDenominator, 50);
  assert.deepEqual(result.canvas.viewport.viewCenter, { x: 10500, y: -7425 });
  assert.equal(nativeAssetCanonicalJson(input.structure), before);
});
