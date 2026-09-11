import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import {
  DRAWING_COLLABORATION_SCHEMA_VERSION,
  DrawingCollaborationOperationSchema,
} from "../app/lukas/lib/drawing-collaboration-protocol.ts";
import { applyDrawingStructureActions } from "../app/lukas/lib/drawing-structure.ts";
import { DrawingObjectSourceSchema } from "../app/lukas/lib/drawing-workspace.types.ts";

const plannerModule = await import(
  "../app/lukas/lib/drawing-native-dwg-import-plan.server.ts"
).catch(() => null);

const ids = {
  revision: "72000000-0000-4000-8000-000000000001",
  canvas: "72000000-0000-4000-8000-000000000002",
  sourceFile: "72000000-0000-4000-8000-000000000003",
  actor: "72000000-0000-4000-8000-000000000004",
  analysisJob: "72000000-0000-4000-8000-000000000005",
};
const evidenceUrl = new URL(
  "../../docs/superpowers/evidence/2026-09-06-native-dwg-import-projection/verified-final/native-import.json",
  import.meta.url,
);
const reportText = await readFile(evidenceUrl, "utf8");
const report = JSON.parse(reportText);
const reportSha256 = createHash("sha256").update(reportText).digest("hex");

function build(overrides = {}) {
  assert.ok(plannerModule, "native canonical import planner must exist");
  return plannerModule.buildNativeDrawingDwgImportPlan({
    report,
    expectedSource: report.source,
    revisionId: ids.revision,
    canvasId: ids.canvas,
    sourceFileId: ids.sourceFile,
    analysisJobId: ids.analysisJob,
    reportSha256,
    ...overrides,
  });
}

test("native planner maps public report handles to exact canonical DWG sources", () => {
  const plan = build();

  assert.equal(plan.requestId, "24aa8d30-7591-5881-8344-48f1a0ef0a3c");
  assert.equal(plan.sourceSha256, report.source.sha256);
  assert.deepEqual(plan.coverage, report.coverage);
  assert.equal(plan.qualification, "experimental-unqualified");
  assert.equal(plan.persistenceAuthority, "not-issued");
  assert.equal(
    plan.sources.every((source) => source.sourceKind === "dwg_entity"),
    true,
  );
  assert.deepEqual(
    plan.sources.map((source) => [
      source.id,
      source.objectId,
      source.handle,
      source.ownerHandle,
      source.layerHandle,
      source.entityType,
      source.sourceLayer,
    ]),
    [
      [
        "3d11d61e-0606-5127-9fbb-5c8af89def3f",
        "edbccbaf-08cc-55b1-ba7d-5c5028321d29",
        "4A",
        "40",
        "48",
        "LINE",
        "QA_GEOMETRY",
      ],
      [
        "04b9e70b-f924-5b5f-b121-656850468d6c",
        "ef924d35-961b-5557-bafb-a0e267b745c8",
        "4B",
        "40",
        "48",
        "CIRCLE",
        "QA_GEOMETRY",
      ],
      [
        "1a943c48-3d03-5d1b-a89d-9a6f02b498bb",
        "2b477648-3686-58bb-a136-745c600f3d90",
        "4C",
        "40",
        "48",
        "ARC",
        "QA_GEOMETRY",
      ],
      [
        "2cb33432-87ad-5787-8632-f2cfd20f1720",
        "f0a64abd-44e3-5a90-8461-46efe9c232c0",
        "4D",
        "40",
        "48",
        "LWPOLYLINE",
        "QA_GEOMETRY",
      ],
      [
        "5e6d0233-a5be-5010-b29d-98b91ee33088",
        "b9946b2d-f0cd-50bf-b02e-8775ea3e78da",
        "4E",
        "40",
        "49",
        "TEXT",
        "QA_TEXT",
      ],
    ],
  );
  for (const source of plan.sources) {
    assert.deepEqual(Object.keys(source).sort(), [
      "analysisJobId",
      "entityType",
      "handle",
      "id",
      "importerVersion",
      "layerHandle",
      "objectId",
      "ownerHandle",
      "reportSha256",
      "revisionId",
      "sourceFileId",
      "sourceKind",
      "sourceLayer",
      "sourceSha256",
      "unitCode",
      "unitSource",
      "version",
    ]);
    assert.equal(source.analysisJobId, ids.analysisJob);
    assert.equal(source.reportSha256, reportSha256);
    assert.equal(source.unitCode, 4);
    assert.equal(source.unitSource, "declared");
    assert.equal(source.importerVersion, 1);
  }
  assert.deepEqual(build(), plan, "same-job preparation must replay exactly");
});

test("native planner emits the same three atomic phases with exact inverses", () => {
  const lockedReport = structuredClone(report);
  lockedReport.layers[1].locked = true;
  const plan = build({ report: lockedReport });

  assert.ok(plan.operations.length >= 3);
  for (const [index, operation] of plan.operations.entries()) {
    const group = {
      id: plan.requestId,
      kind: "dwg_import",
      index,
      count: plan.operations.length,
    };
    assert.deepEqual(operation.forward.historyGroup, group);
    assert.deepEqual(operation.inverse.historyGroup, group);
    assert.equal(
      DrawingCollaborationOperationSchema.safeParse({
        ...operation,
        actorId: ids.actor,
        schemaVersion: DRAWING_COLLABORATION_SCHEMA_VERSION,
      }).success,
      true,
    );
  }
  const create = plan.operations[0];
  assert.equal(
    create.forward.actions.every(
      (action) => action.kind === "put_layer" && action.baseVersion === null,
    ),
    true,
  );
  assert.deepEqual(
    create.inverse.actions,
    [...create.forward.actions].reverse().map((action) => ({
      kind: "delete_layer",
      id: action.entity.id,
      baseVersion: 1,
    })),
  );
  const pairs = plan.operations.flatMap((operation) =>
    operation.forward.actions.some((action) => action.kind === "put_object")
      ? [operation]
      : [],
  );
  assert.ok(pairs.length > 0);
  for (const operation of pairs) {
    const records = [];
    for (let index = 0; index < operation.forward.actions.length; index += 2) {
      const objectAction = operation.forward.actions[index];
      const sourceAction = operation.forward.actions[index + 1];
      assert.equal(objectAction.kind, "put_object");
      assert.equal(sourceAction.kind, "put_source");
      assert.equal(sourceAction.entity.objectId, objectAction.entity.id);
      records.push({ objectAction, sourceAction });
    }
    assert.deepEqual(
      operation.inverse.actions,
      records.reverse().flatMap(({ objectAction, sourceAction }) => [
        { kind: "delete_source", id: sourceAction.entity.id, baseVersion: 1 },
        { kind: "delete_object", id: objectAction.entity.id, baseVersion: 1 },
      ]),
    );
  }
  const finalize = plan.operations.at(-1);
  assert.equal(
    finalize.forward.actions.every(
      (action) => action.kind === "put_layer" && action.baseVersion === 1,
    ),
    true,
  );
  assert.equal(
    finalize.inverse.actions.every(
      (action) => action.kind === "put_layer" && action.baseVersion === 2,
    ),
    true,
  );
});

test("native object and source compounds apply atomically without becoming DXF", () => {
  const plan = build();
  let state = {
    revisionId: ids.revision,
    pages: {
      "72000000-0000-4000-8000-000000000010": {
        id: "72000000-0000-4000-8000-000000000010",
        revisionId: ids.revision,
        name: "Page",
        sortOrder: 0,
        version: 1,
      },
    },
    canvases: {
      "72000000-0000-4000-8000-000000000011": {
        id: "72000000-0000-4000-8000-000000000011",
        pageId: "72000000-0000-4000-8000-000000000010",
        name: "Paper",
        spaceKind: "paper",
        widthMillimeters: 210,
        heightMillimeters: 297,
        background: null,
        sortOrder: 0,
        version: 1,
      },
      [ids.canvas]: {
        id: ids.canvas,
        pageId: "72000000-0000-4000-8000-000000000010",
        name: "Model",
        spaceKind: "model",
        widthMillimeters: 1000,
        heightMillimeters: 1000,
        background: null,
        sortOrder: 1,
        version: 1,
      },
    },
    layers: {
      "72000000-0000-4000-8000-000000000012": {
        id: "72000000-0000-4000-8000-000000000012",
        name: "Work",
        visible: true,
        locked: false,
        systemKind: "work",
        canvasId: "72000000-0000-4000-8000-000000000011",
        sortOrder: 0,
        version: 1,
      },
    },
    objects: {},
    sources: {},
    styles: {},
    blocks: {},
    blockInstances: {},
    propertySchemas: {},
    propertyValues: {},
    tables: {},
  };
  for (const operation of plan.operations)
    state = applyDrawingStructureActions(
      state,
      operation.forward.actions,
    ).state;

  assert.equal(Object.keys(state.objects).length, report.entities.length);
  assert.equal(Object.keys(state.sources).length, report.entities.length);
  assert.equal(
    Object.values(state.sources).every(
      (source) => source.sourceKind === "dwg_entity",
    ),
    true,
  );
});

test("native source schema rejects unknown keys and report, handle, source, or unit mismatches", () => {
  const source = build().sources[0];
  for (const invalid of [
    { ...source, sourceKind: "dxf_entity" },
    { ...source, reportSha256: "A".repeat(64) },
    { ...source, handle: "04A" },
    { ...source, ownerHandle: "0" },
    { ...source, layerHandle: "xyz" },
    { ...source, unitCode: 3 },
    { ...source, unitSource: "guessed" },
    { ...source, nativeGeometry: report.entities[0].geometry },
  ])
    assert.equal(DrawingObjectSourceSchema.safeParse(invalid).success, false);

  assert.throws(
    () =>
      build({ expectedSource: { ...report.source, sha256: "a".repeat(64) } }),
    { name: "DrawingNativeDwgImportPlanError", code: "invalid" },
  );
  const mismatchedReport = structuredClone(report);
  mismatchedReport.entities[0].layerHandle = "49";
  assert.equal(
    build({ report: mismatchedReport }).sources[0].sourceLayer,
    "QA_TEXT",
  );
});

test("native planner fails closed for empty and oversized projections", () => {
  const empty = structuredClone(report);
  empty.entities = [];
  empty.coverage = {
    modelSpaceEntities: 0,
    importedEntities: 0,
    unsupportedEntities: 0,
    nonModelSpaceEntities: 0,
  };
  empty.unsupported = [];
  assert.throws(() => build({ report: empty }), {
    name: "DrawingNativeDwgImportPlanError",
    code: "empty",
  });

  const oversized = structuredClone(report);
  oversized.entities = Array.from({ length: 1_000 }, (_, index) => ({
    handle: (0x1000 + index).toString(16).toUpperCase(),
    ownerHandle: "40",
    layerHandle: "49",
    type: "TEXT",
    geometry: {
      insert: [index, 40, 0],
      height: 2.5,
      text: "X".repeat(10_000),
    },
  }));
  oversized.coverage = {
    modelSpaceEntities: 1_000,
    importedEntities: 1_000,
    unsupportedEntities: 0,
    nonModelSpaceEntities: 0,
  };
  oversized.unsupported = [];
  assert.throws(() => build({ report: oversized }), {
    name: "DrawingNativeDwgImportPlanError",
    code: "oversized",
  });
});
