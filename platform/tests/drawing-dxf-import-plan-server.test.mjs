import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DRAWING_DXF_IMPORT_PLAN_LIMITS,
  buildDrawingDxfImportPlan,
} from "../app/lukas/lib/drawing-dxf-import-plan.server.ts";
import {
  DRAWING_COLLABORATION_LIMITS,
  DRAWING_COLLABORATION_SCHEMA_VERSION,
  DrawingCollaborationOperationSchema,
} from "../app/lukas/lib/drawing-collaboration-protocol.ts";

const encoder = new TextEncoder();
const ids = {
  revision: "72000000-0000-4000-8000-000000000001",
  canvas: "72000000-0000-4000-8000-000000000002",
  sourceFile: "72000000-0000-4000-8000-000000000003",
  actor: "72000000-0000-4000-8000-000000000004",
};

function pairs(values) {
  return `${values.map(([code, value]) => `${code}\n${value}`).join("\n")}\n`;
}

function dxf({ includeUnits = true, tables = [], entities = [] } = {}) {
  return encoder.encode(
    pairs([
      [0, "SECTION"],
      [2, "HEADER"],
      ...(includeUnits
        ? [
            [9, "$INSUNITS"],
            [70, 4],
          ]
        : []),
      [0, "ENDSEC"],
      ...(tables.length
        ? [[0, "SECTION"], [2, "TABLES"], ...tables, [0, "ENDSEC"]]
        : []),
      [0, "SECTION"],
      [2, "ENTITIES"],
      ...entities,
      [0, "ENDSEC"],
      [0, "EOF"],
    ]),
  );
}

function layerTable({ name, flags = 0, color = 7 }) {
  return [
    [0, "TABLE"],
    [2, "LAYER"],
    [70, 1],
    [0, "LAYER"],
    [2, name],
    [70, flags],
    [62, color],
    [0, "ENDTAB"],
  ];
}

function line({ handle, layer = "A-WALL", x = 0 } = {}) {
  return [
    [0, "LINE"],
    ...(handle === undefined ? [] : [[5, handle]]),
    [8, layer],
    [10, x],
    [20, 0],
    [11, x],
    [21, 1],
  ];
}

function input(bytes, overrides = {}) {
  return {
    bytes,
    revisionId: ids.revision,
    canvasId: ids.canvas,
    sourceFileId: ids.sourceFile,
    createdAt: "2026-09-02T03:00:00.000Z",
    ...overrides,
  };
}

test("DXF import plan preserves exact local source lineage and only actual raw handles", async () => {
  const plan = await buildDrawingDxfImportPlan(
    input(
      dxf({
        entities: [
          ...line({ handle: "AB12" }),
          ...line({ layer: "A-ANNO", x: 2 }),
        ],
      }),
    ),
  );

  assert.equal(plan.report.imported, 2);
  assert.equal(plan.sources.length, 2);
  assert.deepEqual(
    plan.sources.map((source) => ({
      objectId: source.objectId,
      revisionId: source.revisionId,
      sourceFileId: source.sourceFileId,
      sourceSha256: source.sourceSha256,
      sourceKind: source.sourceKind,
      entityKey: source.entityKey,
      entityType: source.entityType,
      sourceLayer: source.sourceLayer,
      handle: source.handle,
      unitCode: source.unitCode,
      unitSource: source.unitSource,
      importerVersion: source.importerVersion,
      version: source.version,
    })),
    [
      {
        objectId: plan.objects[0].id,
        revisionId: ids.revision,
        sourceFileId: ids.sourceFile,
        sourceSha256: plan.sourceSha256,
        sourceKind: "dxf_entity",
        entityKey: "entities:0@raw:ENTITIES:0",
        entityType: "LINE",
        sourceLayer: "A-WALL",
        handle: "AB12",
        unitCode: 4,
        unitSource: "declared",
        importerVersion: 1,
        version: 1,
      },
      {
        objectId: plan.objects[1].id,
        revisionId: ids.revision,
        sourceFileId: ids.sourceFile,
        sourceSha256: plan.sourceSha256,
        sourceKind: "dxf_entity",
        entityKey: "entities:1@raw:ENTITIES:1",
        entityType: "LINE",
        sourceLayer: "A-ANNO",
        handle: null,
        unitCode: 4,
        unitSource: "declared",
        importerVersion: 1,
        version: 1,
      },
    ],
  );
  assert.equal("rawHandle" in plan.sources[0], false);
});

test("DXF import plan keeps each object and source atomic in forward and inverse operations", async () => {
  const plan = await buildDrawingDxfImportPlan(
    input(
      dxf({
        entities: [
          ...line({ handle: "100" }),
          ...line({ handle: "101", x: 2 }),
        ],
      }),
    ),
  );

  assert.ok(plan.operations.length >= 2);
  for (const [index, operation] of plan.operations.entries()) {
    const expectedHistoryGroup = {
      id: plan.requestId,
      kind: "dxf_import",
      index,
      count: plan.operations.length,
    };
    assert.deepEqual(operation.forward.historyGroup, expectedHistoryGroup);
    assert.deepEqual(operation.inverse.historyGroup, expectedHistoryGroup);
    assert.equal(
      DrawingCollaborationOperationSchema.safeParse({
        ...operation,
        actorId: ids.actor,
        schemaVersion: DRAWING_COLLABORATION_SCHEMA_VERSION,
      }).success,
      true,
    );
    assert.equal(operation.type, "mutate_structure");
    const forward = operation.forward.actions;
    const inverse = operation.inverse.actions;
    assert.deepEqual(
      operation.baseVersions,
      Object.fromEntries(
        forward.flatMap((action) =>
          action.baseVersion === null
            ? []
            : [
                [
                  "id" in action ? action.id : action.entity.id,
                  action.baseVersion,
                ],
              ],
        ),
      ),
    );
    if (forward.every((action) => action.kind === "put_layer")) {
      if (forward.every((action) => action.baseVersion === null))
        assert.ok(inverse.every((action) => action.kind === "delete_layer"));
      else assert.ok(inverse.every((action) => action.kind === "put_layer"));
      continue;
    }
    assert.equal(forward.length % 2, 0);
    assert.equal(inverse.length, forward.length);
    const records = [];
    for (let index = 0; index < forward.length; index += 2) {
      const objectAction = forward[index];
      const sourceAction = forward[index + 1];
      assert.equal(objectAction.kind, "put_object");
      assert.equal(objectAction.entity.styleId, null);
      assert.equal(sourceAction.kind, "put_source");
      assert.equal(sourceAction.entity.objectId, objectAction.entity.id);
      records.push({ objectAction, sourceAction });
    }
    const expectedInverse = records
      .reverse()
      .flatMap(({ objectAction, sourceAction }) => [
        { kind: "delete_source", id: sourceAction.entity.id, baseVersion: 1 },
        { kind: "delete_object", id: objectAction.entity.id, baseVersion: 1 },
      ]);
    assert.deepEqual(inverse, expectedInverse);
  }
});

test("DXF import plan stages editable layers before objects and restores source state last", async () => {
  const plan = await buildDrawingDxfImportPlan(
    input(
      dxf({
        tables: layerTable({ name: "A-WALL", flags: 4, color: -7 }),
        entities: line({ handle: "102", layer: "a-wall" }),
      }),
    ),
  );

  assert.equal(plan.report.imported, 1);
  assert.deepEqual(
    plan.layers.map((layer) => [
      layer.name,
      layer.visible,
      layer.locked,
      layer.version,
    ]),
    [["A-WALL", false, true, 2]],
  );
  const firstAction = plan.operations[0].forward.actions[0];
  assert.equal(firstAction.kind, "put_layer");
  assert.deepEqual(
    [
      firstAction.entity.visible,
      firstAction.entity.locked,
      firstAction.entity.version,
      firstAction.baseVersion,
    ],
    [true, false, 1, null],
  );
  assert.ok(
    plan.operations
      .slice(1, -1)
      .some((operation) =>
        operation.forward.actions.some(
          (action) => action.kind === "put_object",
        ),
      ),
  );
  const finalOperation = plan.operations.at(-1);
  assert.deepEqual(finalOperation.baseVersions, { [plan.layers[0].id]: 1 });
  assert.deepEqual(finalOperation.forward.actions, [
    {
      kind: "put_layer",
      entity: { ...plan.layers[0], version: 1 },
      baseVersion: 1,
    },
  ]);
  assert.deepEqual(finalOperation.inverse.actions, [
    {
      kind: "put_layer",
      entity: firstAction.entity,
      baseVersion: 2,
    },
  ]);
});

test("DXF import plan chunks atomic records within the live collaboration contract", async () => {
  const entities = Array.from({ length: 300 }, (_, index) =>
    line({ handle: (4096 + index).toString(16).toUpperCase(), x: index }),
  ).flat();
  const plan = await buildDrawingDxfImportPlan(input(dxf({ entities })));

  assert.equal(plan.report.imported, 300);
  assert.ok(plan.operations.length > 2);
  assert.ok(
    plan.operations.length <= DRAWING_DXF_IMPORT_PLAN_LIMITS.maxOperations,
  );
  for (const operation of plan.operations) {
    assert.ok(
      operation.forward.actions.length <=
        DRAWING_COLLABORATION_LIMITS.maxActionItems,
    );
    assert.ok(
      operation.inverse.actions.length <=
        DRAWING_COLLABORATION_LIMITS.maxActionItems,
    );
    assert.ok(
      encoder.encode(
        JSON.stringify({
          ...operation,
          actorId: ids.actor,
          schemaVersion: DRAWING_COLLABORATION_SCHEMA_VERSION,
        }),
      ).byteLength <= DRAWING_COLLABORATION_LIMITS.maxOperationBytes,
    );
    const objectActions = operation.forward.actions.filter(
      (action) => action.kind === "put_object",
    );
    const sourceActions = operation.forward.actions.filter(
      (action) => action.kind === "put_source",
    );
    assert.equal(objectActions.length, sourceActions.length);
  }
  assert.ok(
    encoder.encode(JSON.stringify(plan)).byteLength <=
      DRAWING_DXF_IMPORT_PLAN_LIMITS.maxSerializedBytes,
  );
});

test("DXF import plan IDs support exact retry, prefix resume, and explicit-unit retry", async () => {
  const bytes = dxf({
    includeUnits: false,
    entities: [...line({ handle: "200" }), ...line({ handle: "201", x: 2 })],
  });
  const millimeterInput = input(bytes, {
    unitOverride: { code: 4, label: "mm" },
  });
  const first = await buildDrawingDxfImportPlan(millimeterInput);
  const retried = await buildDrawingDxfImportPlan({
    ...millimeterInput,
    createdAt: "2026-09-03T07:08:09.000Z",
  });
  const inches = await buildDrawingDxfImportPlan(
    input(bytes, { unitOverride: { code: 1, label: "in" } }),
  );

  assert.deepEqual(retried, first);
  assert.deepEqual(
    retried.operations.slice(0, 1),
    first.operations.slice(0, 1),
  );
  assert.notEqual(first.requestId, inches.requestId);
  assert.notEqual(first.objects[0].id, inches.objects[0].id);
  assert.notEqual(first.sources[0].id, inches.sources[0].id);
  assert.notEqual(
    first.operations[0].clientOperationId,
    inches.operations[0].clientOperationId,
  );
});

test("DXF import plan fails closed before execution when total operation count is too large", async () => {
  const plan = await buildDrawingDxfImportPlan(
    input(dxf({ entities: line({ handle: "300" }) }), {
      planLimits: { maxOperations: 1 },
    }),
  );

  assert.equal(plan.report.blocking.at(-1)?.code, "PLAN_OPERATION_LIMIT");
  assert.equal(plan.report.imported, 0);
  assert.deepEqual(plan.layers, []);
  assert.deepEqual(plan.objects, []);
  assert.deepEqual(plan.sources, []);
  assert.deepEqual(plan.operations, []);
});

test("DXF import plan fails closed before execution when the response plan is too large", async () => {
  const plan = await buildDrawingDxfImportPlan(
    input(dxf({ entities: line({ handle: "301" }) }), {
      planLimits: { maxSerializedBytes: 256 },
    }),
  );

  assert.equal(plan.report.blocking.at(-1)?.code, "PLAN_BYTE_LIMIT");
  assert.equal(plan.report.imported, 0);
  assert.deepEqual(plan.layers, []);
  assert.deepEqual(plan.objects, []);
  assert.deepEqual(plan.sources, []);
  assert.deepEqual(plan.operations, []);
});
