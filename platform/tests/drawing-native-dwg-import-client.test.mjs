import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  applyDrawingCommand,
  createDrawingDocumentState,
  redoDrawingCommandUnit,
  undoDrawingCommandUnit,
} from "../app/lukas/lib/drawing-commands.ts";
import { drawingCollaborationOperationDigestSource } from "../app/lukas/lib/drawing-collaboration-protocol.ts";
import {
  createDrawingDxfImportSendGate,
  DrawingDxfImportClientError,
} from "../app/lukas/lib/drawing-dxf-import-client.ts";
import { buildDrawingDxfImportPlan } from "../app/lukas/lib/drawing-dxf-import-plan.server.ts";
import {
  applyNativeDrawingDwgImportOperations,
  createNativeDrawingDwgImportSendGate,
  DrawingNativeDwgImportClientError,
  prepareNativeDrawingDwgImportOverHttp,
} from "../app/lukas/lib/drawing-native-dwg-import-client.ts";
import { buildNativeDrawingDwgImportPlan } from "../app/lukas/lib/drawing-native-dwg-import-plan.server.ts";
import { DrawingOperationInputSchema } from "../app/lukas/lib/drawing-workspace.types.ts";

const ids = {
  project: "7a000000-0000-4000-8000-000000000001",
  revision: "7a000000-0000-4000-8000-000000000002",
  page: "7a000000-0000-4000-8000-000000000003",
  canvas: "7a000000-0000-4000-8000-000000000004",
  actor: "7a000000-0000-4000-8000-000000000005",
  sourceFile: "7a000000-0000-4000-8000-000000000006",
  job: "7a000000-0000-4000-8000-000000000007",
  otherJob: "7a000000-0000-4000-8000-000000000008",
  workLayer: "7a000000-0000-4000-8000-000000000009",
};
const sourceSha256 = "a".repeat(64);
const reportSha256 = "b".repeat(64);
const report = {
  schemaVersion: "1hk-dwg-import/1",
  qualification: "experimental-unqualified",
  source: {
    sha256: sourceSha256,
    byteSize: 1024,
    headerVersion: "AC1024",
  },
  engine: { name: "ACadSharp", version: "3.7.1" },
  coordinateSystem: "WCS_NATIVE_UNITS",
  unitCode: 4,
  modelSpaceHandle: "10",
  layers: [{ handle: "20", name: "WALL", visible: false, locked: true }],
  entities: [
    {
      handle: "30",
      ownerHandle: "10",
      layerHandle: "20",
      type: "LINE",
      geometry: { start: [0, 0, 0], end: [1000, 0, 0] },
    },
    {
      handle: "31",
      ownerHandle: "10",
      layerHandle: "20",
      type: "LINE",
      geometry: { start: [0, 500, 0], end: [1000, 500, 0] },
    },
  ],
  coverage: {
    modelSpaceEntities: 2,
    importedEntities: 2,
    unsupportedEntities: 0,
    nonModelSpaceEntities: 0,
  },
  unsupported: [],
  readerNotificationCount: 0,
};
const encoder = new TextEncoder();

function dxfPlan() {
  const bytes = encoder.encode(
    [
      "0",
      "SECTION",
      "2",
      "HEADER",
      "9",
      "$INSUNITS",
      "70",
      "4",
      "0",
      "ENDSEC",
      "0",
      "SECTION",
      "2",
      "ENTITIES",
      "0",
      "LINE",
      "5",
      "40",
      "8",
      "WALL",
      "10",
      "0",
      "20",
      "0",
      "11",
      "1000",
      "21",
      "0",
      "0",
      "ENDSEC",
      "0",
      "EOF",
      "",
    ].join("\n"),
  );
  return buildDrawingDxfImportPlan({
    bytes,
    revisionId: ids.revision,
    canvasId: ids.canvas,
    sourceFileId: ids.sourceFile,
    createdAt: "2026-09-06T10:00:00.000Z",
  });
}

function plan() {
  return buildNativeDrawingDwgImportPlan({
    report: structuredClone(report),
    expectedSource: report.source,
    revisionId: ids.revision,
    canvasId: ids.canvas,
    sourceFileId: ids.sourceFile,
    analysisJobId: ids.job,
    reportSha256,
  });
}

function prepared(planValue = plan(), overrides = {}) {
  return {
    ...planValue,
    canonicalReceipts: [],
    persistenceAuthority: "operation-attested",
    ...overrides,
  };
}

function initialState() {
  return createDrawingDocumentState({
    revisionId: ids.revision,
    structure: {
      pages: {
        [ids.page]: {
          id: ids.page,
          revisionId: ids.revision,
          name: "A1",
          sortOrder: 0,
          version: 1,
        },
      },
      canvases: {
        [ids.canvas]: {
          id: ids.canvas,
          pageId: ids.page,
          name: "Paper",
          spaceKind: "paper",
          widthMillimeters: 841,
          heightMillimeters: 594,
          background: null,
          sortOrder: 0,
          version: 1,
        },
      },
      layers: {
        [ids.workLayer]: {
          id: ids.workLayer,
          name: "Work",
          visible: true,
          locked: false,
          systemKind: "work",
          canvasId: ids.canvas,
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
    },
  });
}

function operationInput(operation) {
  return DrawingOperationInputSchema.parse({
    clientOperationId: operation.clientOperationId,
    revisionId: operation.revisionId,
    type: operation.type,
    baseVersions: operation.baseVersions,
    forward: operation.forward,
    inverse: operation.inverse,
    createdAt: operation.createdAt,
    ...(operation.originalOperationId && operation.historyAction
      ? {
          originalOperationId: operation.originalOperationId,
          historyAction: operation.historyAction,
        }
      : {}),
  });
}

function receipt(operation, sequence) {
  return {
    clientOperationId: operation.clientOperationId,
    revisionId: operation.revisionId,
    actorId: operation.actorId,
    sequence,
    resultVersions: operation.resultVersions,
    operationSha256: createHash("sha256")
      .update(
        drawingCollaborationOperationDigestSource(
          operationInput(operation),
          operation.actorId,
        ),
      )
      .digest("hex"),
  };
}

function withoutLocalHistory(state) {
  return {
    ...structuredClone(state),
    operations: [],
    undoStackByActor: {},
    redoStackByActor: {},
  };
}

function historyEnvironment(start = 100) {
  let index = start;
  return {
    createId: () =>
      `7a000000-0000-4000-8000-${String(index++).padStart(12, "0")}`,
    now: () => "2026-09-06T12:00:00.000Z",
  };
}

function request() {
  return {
    revisionId: ids.revision,
    canvasId: ids.canvas,
    jobId: ids.job,
    sourceSha256,
  };
}

test("applies a real native plan and preserves grouped undo and redo", async () => {
  const native = plan();
  const result = await applyNativeDrawingDwgImportOperations(
    initialState(),
    ids.actor,
    native.operations,
  );

  assert.deepEqual(
    result.applied.map(({ operation }) => operationInput(operation)),
    native.operations,
  );
  assert.equal(
    Object.values(result.state.structure.sources).every(
      (source) =>
        source.sourceKind === "dwg_entity" &&
        source.analysisJobId === ids.job &&
        source.reportSha256 === reportSha256,
    ),
    true,
  );

  const undone = undoDrawingCommandUnit(
    result.state,
    ids.actor,
    historyEnvironment(),
  );
  assert.ok(!("kind" in undone), JSON.stringify(undone));
  assert.equal(undone.applied.length, native.operations.length);
  assert.deepEqual(Object.keys(undone.state.structure.layers), [ids.workLayer]);
  assert.deepEqual(undone.state.structure.objects, {});
  assert.deepEqual(undone.state.structure.sources, {});

  const redone = redoDrawingCommandUnit(
    undone.state,
    ids.actor,
    historyEnvironment(200),
  );
  assert.ok(!("kind" in redone), JSON.stringify(redone));
  assert.equal(redone.applied.length, native.operations.length);
  assert.equal(Object.keys(redone.state.structure.objects).length, 2);
});

test("recovers an exact native materialized prefix from canonical receipts", async () => {
  const native = plan();
  const first = native.operations[0];
  const prefix = applyDrawingCommand(
    initialState(),
    {
      type: "mutate_structure",
      actorId: ids.actor,
      actions: first.forward.actions,
      historyGroup: first.forward.historyGroup,
    },
    {
      createId: () => first.clientOperationId,
      now: () => first.createdAt,
    },
  );
  assert.deepEqual(operationInput(prefix.operation), first);
  const canonicalReceipt = receipt(prefix.operation, 1);

  const recovered = await applyNativeDrawingDwgImportOperations(
    withoutLocalHistory(prefix.state),
    ids.actor,
    native.operations,
    [canonicalReceipt],
  );

  assert.deepEqual(recovered.alreadyMaterializedOperationIds, [
    native.operations[0].clientOperationId,
  ]);
  assert.deepEqual(
    recovered.applied.map(({ operation }) => operation.clientOperationId),
    native.operations
      .slice(1)
      .map(({ clientOperationId }) => clientOperationId),
  );
  assert.deepEqual(
    recovered.state.undoStackByActor[ids.actor],
    native.operations.map(({ clientOperationId }) => clientOperationId),
  );
});

test("native send gate re-attests recovered originals but bypasses derived undo and redo", async () => {
  const native = plan();
  const applied = await applyNativeDrawingDwgImportOperations(
    initialState(),
    ids.actor,
    native.operations,
  );
  const undone = undoDrawingCommandUnit(
    applied.state,
    ids.actor,
    historyEnvironment(),
  );
  assert.ok(!("kind" in undone), JSON.stringify(undone));
  const redone = redoDrawingCommandUnit(
    undone.state,
    ids.actor,
    historyEnvironment(200),
  );
  assert.ok(!("kind" in redone), JSON.stringify(redone));

  const preparedGate = createNativeDrawingDwgImportSendGate();
  preparedGate.rememberPrepared(native.requestId, native.operations);
  for (const operation of native.operations)
    await preparedGate.send({
      operation,
      knownOperations: async () => {
        throw new Error("prepared originals retain their exact group");
      },
      prepare: async () => {
        throw new Error("prepared originals do not need re-preparation");
      },
      send: async () => undefined,
    });

  const gate = createNativeDrawingDwgImportSendGate();
  let prepareCalls = 0;
  let sendCalls = 0;
  await gate.send({
    operation: native.operations[0],
    knownOperations: async () => native.operations,
    prepare: async (input) => {
      prepareCalls += 1;
      assert.deepEqual(input, request());
      return prepared(native);
    },
    send: async () => {
      sendCalls += 1;
    },
  });
  for (const operation of [...undone.applied, ...redone.applied])
    await gate.send({
      operation: operationInput(operation.operation),
      knownOperations: async () => {
        throw new Error("derived operations do not need original history");
      },
      prepare: async () => {
        throw new Error("derived operations do not need preparation");
      },
      send: async () => {
        sendCalls += 1;
      },
    });

  assert.equal(prepareCalls, 1);
  assert.equal(sendCalls, 1 + undone.applied.length + redone.applied.length);
});

test("native gate rejects mixed job or report identity before prepare or send", async () => {
  const native = plan();
  const mixed = structuredClone(native.operations);
  const sources = mixed
    .flatMap((operation) => operation.forward.actions)
    .filter((action) => action.kind === "put_source");
  assert.equal(sources.length, 2);
  sources[1].entity.analysisJobId = ids.otherJob;
  sources[1].entity.reportSha256 = "c".repeat(64);
  await assert.rejects(
    () =>
      applyNativeDrawingDwgImportOperations(initialState(), ids.actor, mixed),
    DrawingNativeDwgImportClientError,
  );
  const gate = createNativeDrawingDwgImportSendGate();
  let prepareCalls = 0;
  let sent = 0;

  await assert.rejects(
    () =>
      gate.send({
        operation: mixed[0],
        knownOperations: async () => mixed,
        prepare: async () => {
          prepareCalls += 1;
          return prepared(native);
        },
        send: async () => {
          sent += 1;
        },
      }),
    DrawingNativeDwgImportClientError,
  );
  assert.equal(prepareCalls, 0);
  assert.equal(sent, 0);
});

test("native gate rejects mixed CAD kinds even on a source-free group phase", async () => {
  const native = plan();
  const mixed = structuredClone(native.operations);
  assert.equal(
    mixed[0].forward.actions.some((action) => action.kind === "put_source"),
    false,
  );
  mixed[0].forward.historyGroup.kind = "dxf_import";
  mixed[0].inverse.historyGroup.kind = "dxf_import";
  let sent = 0;

  await assert.rejects(
    () =>
      applyNativeDrawingDwgImportOperations(initialState(), ids.actor, mixed),
    DrawingNativeDwgImportClientError,
  );

  await assert.rejects(() => {
    const nativeGate = createNativeDrawingDwgImportSendGate();
    return createDrawingDxfImportSendGate().send({
      operation: mixed[0],
      knownOperations: async () => mixed,
      prepare: async () => ({
        requestId: native.requestId,
        sourceSha256,
        operations: mixed,
      }),
      send: () =>
        nativeGate.send({
          operation: mixed[0],
          knownOperations: async () => mixed,
          prepare: async () => prepared(native),
          send: async () => {
            sent += 1;
          },
        }),
    });
  }, DrawingDxfImportClientError);

  const splitPayload = structuredClone(native.operations[0]);
  splitPayload.forward.historyGroup.kind = "dxf_import";
  await assert.rejects(
    () =>
      createDrawingDxfImportSendGate().send({
        operation: splitPayload,
        knownOperations: async () => native.operations,
        prepare: async () => {
          throw new Error("mixed payload metadata must fail before prepare");
        },
        send: async () => {
          sent += 1;
        },
      }),
    DrawingDxfImportClientError,
  );
  assert.equal(sent, 0);
});

test("nested DXF then native gates release valid originals through one transport", async () => {
  const native = plan();
  const dxf = await dxfPlan();
  assert.ok(dxf.requestId);
  const dxfGate = createDrawingDxfImportSendGate();
  const nativeGate = createNativeDrawingDwgImportSendGate();
  let dxfPrepares = 0;
  let nativePrepares = 0;
  let transports = 0;

  const send = (operation, knownOperations) =>
    dxfGate.send({
      operation,
      knownOperations: async () => knownOperations,
      prepare: async () => {
        dxfPrepares += 1;
        return {
          requestId: dxf.requestId,
          sourceSha256: dxf.sourceSha256,
          operations: dxf.operations,
        };
      },
      send: () =>
        nativeGate.send({
          operation,
          knownOperations: async () => knownOperations,
          prepare: async () => {
            nativePrepares += 1;
            return prepared(native);
          },
          send: async () => {
            transports += 1;
          },
        }),
    });

  await send(dxf.operations[0], dxf.operations);
  assert.deepEqual(
    { dxfPrepares, nativePrepares, transports },
    { dxfPrepares: 1, nativePrepares: 0, transports: 1 },
  );
  await send(native.operations[0], native.operations);
  assert.deepEqual(
    { dxfPrepares, nativePrepares, transports },
    { dxfPrepares: 1, nativePrepares: 1, transports: 2 },
  );
});

test("native gate fails closed for incomplete, reordered, or altered groups", async () => {
  const native = plan();
  const reordered = [...native.operations].reverse();
  const altered = structuredClone(native.operations[0]);
  altered.inverse.actions[0].id = ids.sourceFile;
  const invalid = { ...native.operations[0], unexpected: true };

  for (const [operation, knownOperations] of [
    [native.operations[0], native.operations.slice(0, -1)],
    [reordered[0], reordered],
    [altered, native.operations],
    [invalid, native.operations],
  ]) {
    let preparedCount = 0;
    let sent = 0;
    const gate = createNativeDrawingDwgImportSendGate();
    await assert.rejects(
      () =>
        gate.send({
          operation,
          knownOperations: async () => knownOperations,
          prepare: async () => {
            preparedCount += 1;
            return prepared(native);
          },
          send: async () => {
            sent += 1;
          },
        }),
      DrawingNativeDwgImportClientError,
    );
    assert.equal(sent, 0);
    if (operation === altered) assert.equal(preparedCount, 0);
  }
});

test("native gate requires exact operation-attested experimental preparation", async () => {
  const native = plan();
  const altered = structuredClone(native.operations[1]);
  altered.inverse.actions[0].id = ids.sourceFile;

  for (const response of [
    prepared(native, { requestId: ids.otherJob }),
    prepared(native, { sourceSha256: "c".repeat(64) }),
    prepared(native, { operations: [...native.operations].reverse() }),
    prepared(native, { persistenceAuthority: "not-issued" }),
    prepared(native, { qualification: "qualified" }),
    prepared(native, {
      operations: native.operations.map((operation, index) =>
        index === 0 ? { ...operation, unexpected: true } : operation,
      ),
    }),
  ]) {
    let sent = 0;
    await assert.rejects(
      () =>
        createNativeDrawingDwgImportSendGate().send({
          operation: native.operations[0],
          knownOperations: async () => native.operations,
          prepare: async () => response,
          send: async () => {
            sent += 1;
          },
        }),
      DrawingNativeDwgImportClientError,
    );
    assert.equal(sent, 0);
  }

  let sent = 0;
  await assert.rejects(
    () =>
      createNativeDrawingDwgImportSendGate().send({
        operation: altered,
        knownOperations: async () => native.operations,
        prepare: async () => prepared(native),
        send: async () => {
          sent += 1;
        },
      }),
    DrawingNativeDwgImportClientError,
  );
  assert.equal(sent, 0);
});

test("native HTTP preparation sends only stable job scope and rejects unsafe responses", async () => {
  const native = plan();
  const expected = prepared(native);
  const controller = new AbortController();
  const result = await prepareNativeDrawingDwgImportOverHttp({
    action: "/lukas/drawing",
    request: request(),
    signal: controller.signal,
    fetch: async (url, init) => {
      assert.equal(url, "/lukas/drawing");
      assert.equal(init.method, "POST");
      assert.equal(init.headers.Accept, "application/json");
      assert.equal(init.signal, controller.signal);
      assert.deepEqual([...init.body.keys()].sort(), [
        "canvas_id",
        "intent",
        "job_id",
        "revision_id",
      ]);
      assert.equal(init.body.get("intent"), "prepare_native_dwg_import");
      assert.equal(init.body.get("revision_id"), ids.revision);
      assert.equal(init.body.get("canvas_id"), ids.canvas);
      assert.equal(init.body.get("job_id"), ids.job);
      return Response.json({
        ok: true,
        kind: "native_dwg_import_prepared",
        error: null,
        result: expected,
      });
    },
  });
  assert.deepEqual(result, expected);

  for (const payload of [
    { ok: true, kind: "native_dwg_import_prepared", result: native },
    {
      ok: true,
      kind: "native_dwg_import_prepared",
      result: { ...expected, coverage: undefined },
    },
    {
      ok: true,
      kind: "native_dwg_import_prepared",
      result: { ...expected, warnings: [{ code: "UNSAFE" }] },
    },
    {
      ok: true,
      kind: "native_dwg_import_prepared",
      result: {
        ...expected,
        sources: expected.sources.map((source) => ({
          ...source,
          analysisJobId: ids.otherJob,
        })),
      },
    },
    {
      ok: true,
      kind: "native_dwg_import_prepared",
      result: {
        ...expected,
        operations: expected.operations.map((operation, index) =>
          index === 0 ? { ...operation, unexpected: true } : operation,
        ),
      },
    },
    {
      ok: true,
      kind: "native_dwg_import_prepared",
      result: { ...expected, qualification: "qualified" },
    },
    { ok: true, kind: "wrong", result: expected },
    { ok: false, error: { code: "UNAVAILABLE" } },
  ])
    await assert.rejects(
      () =>
        prepareNativeDrawingDwgImportOverHttp({
          action: "/lukas/drawing",
          request: request(),
          fetch: async () => Response.json(payload),
        }),
      DrawingNativeDwgImportClientError,
    );
});
