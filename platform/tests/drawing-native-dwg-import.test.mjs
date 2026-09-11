import assert from "node:assert/strict";
import { test } from "node:test";

import {
  NativeDrawingDwgImportReportSchema,
  projectNativeDrawingDwgImport,
} from "../app/lukas/lib/drawing-native-dwg-import.server.ts";
import {
  DrawingObjectSchema,
  DrawingStructureLayerSchema,
} from "../app/lukas/lib/drawing-workspace.types.ts";

const ids = {
  revision: "91000000-0000-4000-8000-000000000001",
  canvas: "91000000-0000-4000-8000-000000000002",
  otherCanvas: "91000000-0000-4000-8000-000000000003",
  sourceFile: "91000000-0000-4000-8000-000000000004",
};
const expectedSource = {
  sha256: "a".repeat(64),
  byteSize: 4096,
  headerVersion: "AC1024",
};
const report = {
  schemaVersion: "1hk-dwg-import/1",
  qualification: "experimental-unqualified",
  source: { ...expectedSource },
  engine: { name: "ACadSharp", version: "3.7.1" },
  coordinateSystem: "WCS_NATIVE_UNITS",
  unitCode: 5,
  modelSpaceHandle: "1F",
  layers: [
    { handle: "10", name: "0", visible: true, locked: false },
    { handle: "11", name: "NOTES", visible: false, locked: true },
  ],
  entities: [
    {
      handle: "20",
      ownerHandle: "1F",
      layerHandle: "10",
      type: "LINE",
      geometry: { start: [10, -5, 0], end: [125, 25, 0] },
    },
    {
      handle: "21",
      ownerHandle: "1F",
      layerHandle: "10",
      type: "LWPOLYLINE",
      geometry: {
        points: [
          [0, 0, 0],
          [2.123456789, 3, 0],
          [4, 0, 0],
        ],
        closed: true,
      },
    },
    {
      handle: "22",
      ownerHandle: "1F",
      layerHandle: "10",
      type: "CIRCLE",
      geometry: { center: [4, 5, 0], radius: 2 },
    },
    {
      handle: "23",
      ownerHandle: "1F",
      layerHandle: "10",
      type: "ARC",
      geometry: {
        center: [8, 9, 0],
        radius: 3,
        startAngleRadians: Math.PI / 2,
        endAngleRadians: 0,
      },
    },
    {
      handle: "24",
      ownerHandle: "1F",
      layerHandle: "11",
      type: "TEXT",
      geometry: { insert: [1, 2, 0], height: 2, text: "A😀" },
    },
  ],
  coverage: {
    modelSpaceEntities: 5,
    importedEntities: 5,
    unsupportedEntities: 0,
    nonModelSpaceEntities: 0,
  },
  unsupported: [],
  readerNotificationCount: 4,
};

function project(overrides = {}) {
  return projectNativeDrawingDwgImport({
    report: structuredClone(report),
    expectedSource,
    revisionId: ids.revision,
    canvasId: ids.canvas,
    sourceFileId: ids.sourceFile,
    ...overrides,
  });
}

test("projects native WCS primitives into millimeters while preserving exact native bindings", () => {
  const result = project();

  assert.deepEqual(result.source, expectedSource);
  assert.deepEqual(result.units, {
    code: 5,
    label: "cm",
    millimetersPerUnit: 10,
    source: "declared",
  });
  assert.deepEqual(result.objects[0].geometry, {
    type: "line",
    start: { x: 100, y: -50 },
    end: { x: 1250, y: 250 },
  });
  assert.deepEqual(result.objects[1].geometry, {
    type: "polyline",
    points: [
      { x: 0, y: 0 },
      { x: 21.234568, y: 30 },
      { x: 40, y: 0 },
    ],
    closed: true,
  });
  assert.deepEqual(result.objects[2].geometry, {
    type: "circle",
    center: { x: 40, y: 50 },
    radius: 20,
  });
  assert.deepEqual(result.objects[3].geometry, {
    type: "arc",
    semanticVersion: 1,
    center: { x: 80, y: 90 },
    radius: 30,
    startAngleDegrees: 90,
    sweepAngleDegrees: 270,
  });
  assert.deepEqual(result.objects[4].geometry, {
    type: "text",
    origin: { x: 10, y: 20 },
    width: 24,
    text: "A😀",
  });
  assert.equal(result.objects[4].style.fontSize, 20);
  assert.deepEqual(result.bindings[0].nativeGeometry.start, [10, -5, 0]);
  assert.deepEqual(result.bindings[4].nativeGeometry, {
    insert: [1, 2, 0],
    height: 2,
    text: "A😀",
  });
  assert.deepEqual(result.coverage, report.coverage);
  assert.deepEqual(
    result.warnings.map(({ code }) => code),
    ["DWG_APPEARANCE_APPROXIMATED", "TEXT_WIDTH_ESTIMATED"],
  );
  assert.ok(
    result.layers.every(
      (layer) => DrawingStructureLayerSchema.safeParse(layer).success,
    ),
  );
  assert.ok(
    result.objects.every(
      (object) => DrawingObjectSchema.safeParse(object).success,
    ),
  );
  assert.equal(result.qualification, "experimental-unqualified");
  assert.equal(result.persistenceAuthority, "not-issued");
  assert.equal("operations" in result, false);
  assert.equal("sources" in result, false);
  assert.equal("sourceKind" in result.bindings[0], false);
});

test("same source and target retries preserve request, layer, object and binding identities", () => {
  const first = project();
  const retry = project();
  const anotherTarget = project({ canvasId: ids.otherCanvas });

  assert.deepEqual(retry, first);
  assert.notEqual(anotherTarget.requestId, first.requestId);
  assert.notDeepEqual(
    anotherTarget.objects.map(({ id }) => id),
    first.objects.map(({ id }) => id),
  );
  assert.notDeepEqual(
    anotherTarget.bindings.map(({ id }) => id),
    first.bindings.map(({ id }) => id),
  );
});

test("unknown units require an explicit supported override and declared units cannot be changed", () => {
  const unknown = structuredClone(report);
  unknown.unitCode = 0;

  assert.throws(() => project({ report: unknown }), /unit/i);
  assert.deepEqual(
    project({
      report: unknown,
      unitOverride: { code: 4, label: "mm" },
    }).units,
    {
      code: 4,
      label: "mm",
      millimetersPerUnit: 1,
      source: "user_selected",
    },
  );
  assert.throws(
    () => project({ unitOverride: { code: 4, label: "mm" } }),
    /unit/i,
  );
});

test("source drift, duplicate native handles and inconsistent coverage fail closed", () => {
  assert.throws(
    () =>
      project({
        expectedSource: { ...expectedSource, sha256: "b".repeat(64) },
      }),
    /source/i,
  );

  const duplicate = structuredClone(report);
  duplicate.entities[1].handle = duplicate.entities[0].handle;
  assert.throws(() => project({ report: duplicate }), /handle|identity/i);

  const inconsistent = structuredClone(report);
  inconsistent.coverage.importedEntities = 4;
  assert.throws(() => project({ report: inconsistent }), /coverage|count/i);
});

test("strict report validation rejects unknown fields and projected extents outside the 9e9mm domain", () => {
  assert.equal(
    NativeDrawingDwgImportReportSchema.safeParse(report).success,
    true,
  );

  const extra = structuredClone(report);
  extra.localPath = "/private/source.dwg";
  assert.equal(
    NativeDrawingDwgImportReportSchema.safeParse(extra).success,
    false,
  );

  const partialIdentity = structuredClone(report);
  delete partialIdentity.entities[0].ownerHandle;
  assert.equal(
    NativeDrawingDwgImportReportSchema.safeParse(partialIdentity).success,
    false,
  );

  const excessive = structuredClone(report);
  excessive.unitCode = 6;
  excessive.entities[2].geometry.center = [9_000_000, 0, 0];
  excessive.entities[2].geometry.radius = 1;
  assert.throws(() => project({ report: excessive }), /coordinate|extent/i);
});

test("strict report validation rejects a trailing high surrogate in native TEXT", () => {
  const malformed = structuredClone(report);
  malformed.entities[4].geometry.text = "A\ud800";

  assert.equal(
    NativeDrawingDwgImportReportSchema.safeParse(malformed).success,
    false,
  );
});

test("strict report validation and projection reject native TEXT outside the plain-text contract", async (t) => {
  const invalidTextCases = [
    ["U+0085 control", "badtext"],
    ["U+2028 line separator", "bad text"],
    ["U+2029 paragraph separator", "bad text"],
    ["percent-percent expression", "bad%%utext"],
    ["field expression", "bad%<field>text"],
    ["oversized UTF-16 length", "😀".repeat(5_001)],
  ];

  for (const [label, text] of invalidTextCases) {
    await t.test(label, () => {
      const malformed = structuredClone(report);
      malformed.entities[4].geometry.text = text;

      assert.equal(
        NativeDrawingDwgImportReportSchema.safeParse(malformed).success,
        false,
      );
      assert.throws(() => project({ report: malformed }));
    });
  }
});

test("a nonzero full-turn native ARC projects as a 360 degree sweep", () => {
  const fullTurn = structuredClone(report);
  fullTurn.entities[3].geometry.startAngleRadians = 0;
  fullTurn.entities[3].geometry.endAngleRadians = Math.PI * 2;

  assert.equal(
    NativeDrawingDwgImportReportSchema.safeParse(fullTurn).success,
    true,
  );
  assert.equal(
    project({ report: fullTurn }).objects[3].geometry.sweepAngleDegrees,
    360,
  );

  fullTurn.entities[3].geometry.endAngleRadians = -Math.PI * 2;
  assert.equal(
    NativeDrawingDwgImportReportSchema.safeParse(fullTurn).success,
    true,
  );
  assert.equal(
    project({ report: fullTurn }).objects[3].geometry.sweepAngleDegrees,
    360,
  );
});

test("native ARC rejects explicit sweeps larger than one full turn", () => {
  for (const endAngleRadians of [Math.PI * 4, -Math.PI * 4]) {
    const excessiveSweep = structuredClone(report);
    excessiveSweep.entities[3].geometry.startAngleRadians = 0;
    excessiveSweep.entities[3].geometry.endAngleRadians = endAngleRadians;

    assert.equal(
      NativeDrawingDwgImportReportSchema.safeParse(excessiveSweep).success,
      false,
    );
    assert.throws(() => project({ report: excessiveSweep }), /sweep/i);
  }
});

test("unsupported native handle samples cannot outnumber their exact group count", () => {
  const impossible = structuredClone(report);
  impossible.coverage.modelSpaceEntities = 6;
  impossible.coverage.unsupportedEntities = 1;
  impossible.unsupported = [
    {
      type: "INSERT",
      reason: "unsupported_type",
      count: 1,
      sampleHandles: ["30", "31"],
    },
  ];

  assert.equal(
    NativeDrawingDwgImportReportSchema.safeParse(impossible).success,
    false,
  );
});
