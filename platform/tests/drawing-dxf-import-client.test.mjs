import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import * as Y from "yjs";

import {
  applyDrawingCommand,
  createDrawingDocumentState,
  redoDrawingCommand,
  redoDrawingCommandUnit,
  undoDrawingCommand,
  undoDrawingCommandUnit,
} from "../app/lukas/lib/drawing-commands.ts";
import {
  createDrawingCollaborationCommandBridge,
  initializeDrawingCollaborationDocument,
} from "../app/lukas/lib/drawing-collaboration-client.ts";
import { createDrawingDocumentStore } from "../app/lukas/lib/drawing-document-store.ts";
import {
  applyDrawingDxfImportOperation,
  applyDrawingDxfImportOperations,
  attestQueuedDrawingDxfGroupBeforeSend,
  createDrawingDxfImportSendGate,
  DrawingDxfImportClientError,
  prepareDrawingDxfImportOverHttp,
} from "../app/lukas/lib/drawing-dxf-import-client.ts";
import { drawingCollaborationOperationDigestSource } from "../app/lukas/lib/drawing-collaboration-protocol.ts";
import { createDrawingDraftAdapter } from "../app/lukas/lib/drawing-yjs-draft.ts";
import { DrawingOperationInputSchema } from "../app/lukas/lib/drawing-workspace.types.ts";

const ids = Object.fromEntries(
  [
    "revision",
    "project",
    "page",
    "canvas",
    "workLayer",
    "layer",
    "object",
    "source",
    "sourceFile",
    "actor",
    "otherActor",
    "operation1",
    "operation2",
    "operation3",
    "group",
  ].map((name, index) => [
    name,
    `79000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
  ]),
);

const page = {
  id: ids.page,
  revisionId: ids.revision,
  name: "A1",
  sortOrder: 0,
  version: 1,
};
const canvas = {
  id: ids.canvas,
  pageId: ids.page,
  name: "Paper",
  spaceKind: "paper",
  widthMillimeters: 841,
  heightMillimeters: 594,
  background: null,
  sortOrder: 0,
  version: 1,
};
const stagingLayer = {
  id: ids.layer,
  name: "A-WALL",
  visible: true,
  locked: false,
  systemKind: "custom",
  canvasId: ids.canvas,
  sortOrder: 1,
  version: 1,
};
const workLayer = {
  id: ids.workLayer,
  name: "Work",
  visible: true,
  locked: false,
  systemKind: "work",
  canvasId: ids.canvas,
  sortOrder: 0,
  version: 1,
};
const object = {
  id: ids.object,
  name: "DXF LINE 10A",
  layerId: ids.layer,
  geometry: {
    type: "line",
    start: { x: 0, y: 0 },
    end: { x: 1000, y: 0 },
  },
  style: { stroke: "#ffffff", strokeWidth: 1, fill: null },
  version: 1,
};
const source = {
  id: ids.source,
  objectId: ids.object,
  revisionId: ids.revision,
  sourceFileId: ids.sourceFile,
  sourceSha256: "a".repeat(64),
  sourceKind: "dxf_entity",
  entityKey: "handle:10A",
  entityType: "LINE",
  sourceLayer: "0",
  handle: "10A",
  unitCode: 4,
  unitSource: "declared",
  importerVersion: 1,
  version: 1,
};

function initialState() {
  return createDrawingDocumentState({
    revisionId: ids.revision,
    structure: {
      pages: { [ids.page]: page },
      canvases: { [ids.canvas]: canvas },
      layers: { [ids.workLayer]: workLayer },
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

function operationInput(recorded) {
  return DrawingOperationInputSchema.parse({
    clientOperationId: recorded.clientOperationId,
    revisionId: recorded.revisionId,
    type: recorded.type,
    baseVersions: recorded.baseVersions,
    forward: recorded.forward,
    inverse: recorded.inverse,
    createdAt: recorded.createdAt,
    ...(recorded.originalOperationId && recorded.historyAction
      ? {
          originalOperationId: recorded.originalOperationId,
          historyAction: recorded.historyAction,
        }
      : {}),
  });
}

function threePhasePlan() {
  let state = initialState();
  const states = [];
  const commands = [
    {
      type: "mutate_structure",
      actorId: ids.actor,
      historyGroup: {
        id: ids.group,
        kind: "dxf_import",
        index: 0,
        count: 3,
      },
      actions: [{ kind: "put_layer", entity: stagingLayer, baseVersion: null }],
    },
    {
      type: "mutate_structure",
      actorId: ids.actor,
      historyGroup: {
        id: ids.group,
        kind: "dxf_import",
        index: 1,
        count: 3,
      },
      actions: [
        { kind: "put_object", entity: object, baseVersion: null },
        { kind: "put_source", entity: source, baseVersion: null },
      ],
    },
    {
      type: "mutate_structure",
      actorId: ids.actor,
      historyGroup: {
        id: ids.group,
        kind: "dxf_import",
        index: 2,
        count: 3,
      },
      actions: [
        {
          kind: "put_layer",
          entity: { ...stagingLayer, visible: false, locked: true },
          baseVersion: 1,
        },
      ],
    },
  ];
  const operationIds = [ids.operation1, ids.operation2, ids.operation3];
  const operations = commands.map((command, index) => {
    const applied = applyDrawingCommand(state, command, {
      createId: () => operationIds[index],
      now: () => `2026-09-02T00:00:0${index}.000Z`,
    });
    state = applied.state;
    states.push(state);
    return operationInput(applied.operation);
  });
  return { finalState: state, operations, states };
}

function queuedDxfPrepareRequest(operations, index = 1) {
  return {
    revisionId: ids.revision,
    canvasId: ids.canvas,
    sourceFileId: ids.sourceFile,
    sourceSha256: source.sourceSha256,
    createdAt: operations[index].createdAt,
    unitCode: "",
  };
}

function queuedDxfPreparedPlan(operations, overrides = {}) {
  return {
    requestId: ids.group,
    sourceSha256: source.sourceSha256,
    operations,
    ...overrides,
  };
}

function withoutLocalOperations(state) {
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
      `79000000-0000-4000-8000-${String(index++).padStart(12, "0")}`,
    now: () => "2026-09-02T10:00:00.000Z",
  };
}

function canonicalReceipt(operation, sequence) {
  const envelope = operationInput(operation);
  return {
    clientOperationId: operation.clientOperationId,
    revisionId: operation.revisionId,
    actorId: operation.actorId,
    sequence,
    resultVersions: operation.resultVersions,
    operationSha256: createHash("sha256")
      .update(
        drawingCollaborationOperationDigestSource(envelope, operation.actorId),
      )
      .digest("hex"),
  };
}

function recentOutcome(operation, sequence) {
  return {
    revisionId: operation.revisionId,
    clientOperationId: operation.clientOperationId,
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

async function receiptRecoveredDraft(prefix = 1, authoritativeLayer = null) {
  const plan = threePhasePlan();
  const receipts = plan.finalState.operations.map((operation, index) =>
    canonicalReceipt(operation, index + 1),
  );
  const authoritative = withoutLocalOperations(plan.states[prefix - 1]);
  if (authoritativeLayer)
    authoritative.structure.layers[authoritativeLayer.id] =
      structuredClone(authoritativeLayer);
  const document = new Y.Doc();
  const localBaseMeta = initializeDrawingCollaborationDocument({
    document,
    projectId: ids.project,
    revisionId: ids.revision,
    baseSnapshotSha256: "b".repeat(64),
    baseOperationSequence: prefix,
  });
  const adapter = createDrawingDraftAdapter({
    document,
    localBaseMeta,
    authoritativeState: authoritative,
    actorId: ids.actor,
    authorization: "editor",
    frozen: false,
    baseOperationSequence: prefix,
  });
  const queued = [];
  const bridge = createDrawingCollaborationCommandBridge({
    adapter,
    outbox: {
      async enqueue(operation) {
        queued.push(operation);
      },
    },
  });
  const prepared = await applyDrawingDxfImportOperations(
    adapter.getSnapshot().state,
    ids.actor,
    plan.operations,
    receipts.slice(0, prefix),
  );
  bridge.hydrateCanonicalHistory(prepared.canonicalHistoryState);
  for (const applied of prepared.applied) await bridge.applyRecorded(applied);
  return { ...plan, adapter, bridge, document, prepared, queued };
}

async function settledReceiptRecoveredDraft(authoritativeLayer = null) {
  const fixture = await receiptRecoveredDraft(1, authoritativeLayer);
  for (const [index, applied] of fixture.prepared.applied.entries())
    fixture.adapter.recordLocalAcknowledgement({
      clientOperationId: applied.operation.clientOperationId,
      authoritativeSequence: index + 2,
      resultVersions: applied.operation.resultVersions,
    });
  fixture.adapter.replaceAuthoritative(
    withoutLocalOperations(fixture.prepared.state),
    { baseOperationSequence: 3 },
  );
  return fixture;
}

async function freshDxfDraft(adapterOptions = {}) {
  const plan = threePhasePlan();
  const document = new Y.Doc();
  const localBaseMeta = initializeDrawingCollaborationDocument({
    document,
    projectId: ids.project,
    revisionId: ids.revision,
    baseSnapshotSha256: "b".repeat(64),
    baseOperationSequence: 0,
  });
  const adapter = createDrawingDraftAdapter({
    document,
    localBaseMeta,
    authoritativeState: initialState(),
    actorId: ids.actor,
    authorization: "editor",
    frozen: false,
    baseOperationSequence: 0,
    ...adapterOptions,
  });
  const bridge = createDrawingCollaborationCommandBridge({
    adapter,
    outbox: { async enqueue() {} },
  });
  const prepared = await applyDrawingDxfImportOperations(
    adapter.getSnapshot().state,
    ids.actor,
    plan.operations,
  );
  for (const applied of prepared.applied) await bridge.applyRecorded(applied);
  return { ...plan, adapter, bridge, document, prepared };
}

function deferWebCryptoDigests() {
  const subtle = globalThis.crypto.subtle;
  const digest = subtle.digest;
  let release;
  let markStarted;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const started = new Promise((resolve) => {
    markStarted = resolve;
  });
  subtle.digest = async function (...args) {
    markStarted();
    await gate;
    return digest.apply(this, args);
  };
  return {
    started,
    release,
    restore() {
      subtle.digest = digest;
    },
  };
}

function withoutVersion(entity) {
  const { version: _version, ...value } = entity;
  return value;
}

test("applies a three-phase DXF plan with exact recorded envelopes", async () => {
  const { finalState, operations } = threePhasePlan();
  const result = await applyDrawingDxfImportOperations(
    initialState(),
    ids.actor,
    operations,
  );

  assert.deepEqual(
    result.applied.map(({ operation }) => operationInput(operation)),
    operations,
  );
  assert.deepEqual(result.alreadyAppliedOperationIds, []);
  assert.deepEqual(result.alreadyMaterializedOperationIds, []);
  assert.deepEqual(result.state.structure.layers, finalState.structure.layers);
  assert.deepEqual(
    result.state.structure.objects,
    finalState.structure.objects,
  );
  assert.deepEqual(
    result.state.structure.sources,
    finalState.structure.sources,
  );
  assert.equal(result.state.structure.layers[ids.layer].visible, false);
  assert.equal(result.state.structure.layers[ids.layer].locked, true);
});

test("preserves and validates exact DXF history-group metadata", async () => {
  const { operations } = threePhasePlan();
  const grouped = operations.map((operation, index) => ({
    ...operation,
    forward: {
      ...operation.forward,
      historyGroup: {
        id: ids.group,
        kind: "dxf_import",
        index,
        count: operations.length,
      },
    },
    inverse: {
      ...operation.inverse,
      historyGroup: {
        id: ids.group,
        kind: "dxf_import",
        index,
        count: operations.length,
      },
    },
  }));

  const applied = await applyDrawingDxfImportOperations(
    initialState(),
    ids.actor,
    grouped,
  );
  assert.deepEqual(
    applied.applied.map(({ operation }) => operation.forward.historyGroup),
    grouped.map((operation) => operation.forward.historyGroup),
  );

  const mismatched = structuredClone(grouped);
  mismatched[1].inverse.historyGroup.index = 0;
  await assert.rejects(
    () =>
      applyDrawingDxfImportOperations(initialState(), ids.actor, mismatched),
    /history.group|exact DrawingOperationInput/i,
  );
});

test("undoes and redoes a multi-phase DXF import as one user history unit", () => {
  const { finalState } = threePhasePlan();
  assert.equal(finalState.structure.layers[ids.layer].visible, false);
  assert.equal(finalState.structure.layers[ids.layer].locked, true);

  const undone = undoDrawingCommandUnit(
    finalState,
    ids.actor,
    historyEnvironment(),
  );
  assert.ok(!("kind" in undone), JSON.stringify(undone));
  assert.equal(undone.applied.length, 3);
  assert.equal(undone.state.structure.layers[ids.layer], undefined);
  assert.equal(undone.state.structure.objects[ids.object], undefined);
  assert.equal(undone.state.structure.sources[ids.source], undefined);

  const redone = redoDrawingCommandUnit(
    undone.state,
    ids.actor,
    historyEnvironment(110),
  );
  assert.equal(redone.applied.length, 3);
  assert.equal(redone.state.structure.layers[ids.layer].visible, false);
  assert.equal(redone.state.structure.layers[ids.layer].locked, true);
  assert.ok(redone.state.structure.objects[ids.object]);
  assert.ok(redone.state.structure.sources[ids.source]);

  const undoneAgain = undoDrawingCommandUnit(
    redone.state,
    ids.actor,
    historyEnvironment(120),
  );
  assert.equal(undoneAgain.applied.length, 3);
  assert.equal(undoneAgain.state.structure.layers[ids.layer], undefined);
});

test("preflights a whole DXF history group atomically before returning operations", () => {
  const { finalState } = threePhasePlan();
  const conflicted = structuredClone(finalState);
  conflicted.objects[ids.object].version = 2;
  conflicted.structure.objects[ids.object].version = 2;

  const result = undoDrawingCommandUnit(
    conflicted,
    ids.actor,
    historyEnvironment(),
  );
  assert.equal(result.kind, "conflict");
  assert.deepEqual(result.objectIds, [ids.object]);
  assert.equal(conflicted.operations.length, finalState.operations.length);
  assert.equal(conflicted.structure.layers[ids.layer].locked, true);
});

test("re-attests a complete queued DXF group before releasing it", async () => {
  const { finalState, operations } = threePhasePlan();
  const undone = undoDrawingCommandUnit(
    finalState,
    ids.actor,
    historyEnvironment(),
  );
  assert.ok(!("kind" in undone), JSON.stringify(undone));
  const derivedOperations = undone.applied.map(({ operation }) =>
    operationInput(operation),
  );
  const deferred = Promise.withResolvers();
  let prepareRequest = null;
  let settled = false;
  const attestation = attestQueuedDrawingDxfGroupBeforeSend({
    operation: operations[1],
    knownOperations: [...operations, ...derivedOperations],
    prepare: async (request) => {
      prepareRequest = request;
      return deferred.promise;
    },
  });
  attestation.then(() => {
    settled = true;
  });

  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(prepareRequest, queuedDxfPrepareRequest(operations));
  assert.equal(settled, false);

  deferred.resolve(queuedDxfPreparedPlan(operations));
  assert.equal(await attestation, ids.group);
});

test("re-attests user-selected queued DXF units without sending declared units", async () => {
  const { operations } = threePhasePlan();
  const userSelected = structuredClone(operations);
  const sourceAction = userSelected[1].forward.actions.find(
    (action) => action.kind === "put_source",
  );
  sourceAction.entity.unitCode = 6;
  sourceAction.entity.unitSource = "user_selected";

  await attestQueuedDrawingDxfGroupBeforeSend({
    operation: userSelected[1],
    knownOperations: userSelected,
    prepare: async (request) => {
      assert.deepEqual(request, {
        ...queuedDxfPrepareRequest(userSelected),
        unitCode: "6",
      });
      return queuedDxfPreparedPlan(userSelected);
    },
  });
});

test("does not re-attest non-DXF queued operations", async () => {
  let prepareCalls = 0;
  assert.equal(
    await attestQueuedDrawingDxfGroupBeforeSend({
      operation: { type: "update_objects" },
      knownOperations: [],
      prepare: async () => {
        prepareCalls += 1;
        return null;
      },
    }),
    null,
  );
  assert.equal(prepareCalls, 0);
});

test("does not re-attest derived DXF undo or redo operations", async () => {
  const { finalState, operations } = threePhasePlan();
  const undone = undoDrawingCommandUnit(
    finalState,
    ids.actor,
    historyEnvironment(),
  );
  assert.ok(!("kind" in undone), JSON.stringify(undone));
  const redone = redoDrawingCommandUnit(
    undone.state,
    ids.actor,
    historyEnvironment(110),
  );
  let prepareCalls = 0;

  for (const applied of [...undone.applied, ...redone.applied]) {
    const derived = operationInput(applied.operation);
    assert.equal(
      await attestQueuedDrawingDxfGroupBeforeSend({
        operation: derived,
        knownOperations: [...operations, derived],
        prepare: async () => {
          prepareCalls += 1;
          return queuedDxfPreparedPlan(operations);
        },
      }),
      null,
    );
  }
  assert.equal(prepareCalls, 0);
});

test("DXF send gate awaits one recovered attestation and invalidates a changed sibling", async () => {
  const { operations } = threePhasePlan();
  const gate = createDrawingDxfImportSendGate();
  const deferred = Promise.withResolvers();
  let knownOperations = operations;
  let prepareCalls = 0;
  const sent = [];
  const send = (operation) =>
    gate.send({
      operation,
      knownOperations: async () => knownOperations,
      prepare: async () => {
        prepareCalls += 1;
        return deferred.promise;
      },
      send: async () => {
        sent.push(operation.clientOperationId);
        return operation.clientOperationId;
      },
    });

  const first = send(operations[0]);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(sent, []);
  deferred.resolve(queuedDxfPreparedPlan(operations));
  assert.equal(await first, operations[0].clientOperationId);
  assert.equal(await send(operations[1]), operations[1].clientOperationId);
  assert.equal(prepareCalls, 1);

  const changed = structuredClone(operations);
  changed[2].forward.actions[0].entity.name += " changed";
  knownOperations = changed;
  await assert.rejects(() => send(operations[0]), DrawingDxfImportClientError);
  assert.equal(prepareCalls, 2);
  assert.deepEqual(sent, [
    operations[0].clientOperationId,
    operations[1].clientOperationId,
  ]);
});

test("fresh DXF send gates are exact and isolated by workspace lifecycle", async () => {
  const { operations } = threePhasePlan();
  const firstLifecycle = createDrawingDxfImportSendGate();
  firstLifecycle.rememberPrepared(ids.group, operations);
  let knownCalls = 0;
  let prepareCalls = 0;
  const sent = [];
  for (const operation of operations)
    await firstLifecycle.send({
      operation,
      knownOperations: async () => {
        knownCalls += 1;
        return operations;
      },
      prepare: async () => {
        prepareCalls += 1;
        return queuedDxfPreparedPlan(operations);
      },
      send: async () => sent.push(operation.clientOperationId),
    });
  assert.equal(knownCalls, 0);
  assert.equal(prepareCalls, 0);
  assert.deepEqual(
    sent,
    operations.map(({ clientOperationId }) => clientOperationId),
  );

  const nextLifecycle = createDrawingDxfImportSendGate();
  await nextLifecycle.send({
    operation: operations[0],
    knownOperations: async () => operations,
    prepare: async () => {
      prepareCalls += 1;
      return queuedDxfPreparedPlan(operations);
    },
    send: async () => undefined,
  });
  assert.equal(prepareCalls, 1);
});

test("a failed DXF send-gate preparation never sends or poisons its retry cache", async () => {
  const { operations } = threePhasePlan();
  const gate = createDrawingDxfImportSendGate();
  let prepareCalls = 0;
  let sendCalls = 0;
  const attempt = () =>
    gate.send({
      operation: operations[0],
      knownOperations: async () => operations,
      prepare: async () => {
        prepareCalls += 1;
        if (prepareCalls === 1) throw new Error("network down");
        return queuedDxfPreparedPlan(operations);
      },
      send: async () => {
        sendCalls += 1;
      },
    });

  await assert.rejects(attempt, DrawingDxfImportClientError);
  assert.equal(sendCalls, 0);
  await attempt();
  assert.equal(prepareCalls, 2);
  assert.equal(sendCalls, 1);
});

test("fails closed for incomplete, reordered, duplicate, or inconsistent queued DXF groups", async () => {
  const { operations } = threePhasePlan();
  const incomplete = [operations[0], operations[2]];
  const reordered = [...operations].reverse();
  const duplicate = [...operations, operations[1]];
  const inconsistentSource = structuredClone(operations);
  inconsistentSource[1].forward.actions.find(
    (action) => action.kind === "put_source",
  ).entity.revisionId = ids.otherActor;

  for (const knownOperations of [
    incomplete,
    reordered,
    duplicate,
    inconsistentSource,
  ]) {
    let prepareCalls = 0;
    await assert.rejects(
      () =>
        attestQueuedDrawingDxfGroupBeforeSend({
          operation: knownOperations[0],
          knownOperations,
          prepare: async () => {
            prepareCalls += 1;
            return queuedDxfPreparedPlan(operations);
          },
        }),
      DrawingDxfImportClientError,
    );
    assert.equal(prepareCalls, 0);
  }
});

test("fails closed when the re-prepared DXF plan changes its identity or operations", async () => {
  const { operations } = threePhasePlan();
  for (const prepared of [
    queuedDxfPreparedPlan(operations, { requestId: ids.otherActor }),
    queuedDxfPreparedPlan(operations, { sourceSha256: "b".repeat(64) }),
    queuedDxfPreparedPlan([...operations].reverse()),
  ]) {
    await assert.rejects(
      () =>
        attestQueuedDrawingDxfGroupBeforeSend({
          operation: operations[1],
          knownOperations: operations,
          prepare: async () => prepared,
        }),
      DrawingDxfImportClientError,
    );
  }
});

test("fails closed when the queued operation is not exact group evidence", async () => {
  const { operations } = threePhasePlan();
  const forgedOperation = {
    ...operations[1],
    createdAt: "2026-09-02T00:00:09.000Z",
  };
  let prepareCalls = 0;
  await assert.rejects(
    () =>
      attestQueuedDrawingDxfGroupBeforeSend({
        operation: forgedOperation,
        knownOperations: operations,
        prepare: async () => {
          prepareCalls += 1;
          return queuedDxfPreparedPlan(operations);
        },
      }),
    DrawingDxfImportClientError,
  );
  assert.equal(prepareCalls, 0);
});

test("posts queued DXF preparation through the existing form action and rejects unsafe responses", async () => {
  const { operations } = threePhasePlan();
  const request = queuedDxfPrepareRequest(operations);
  const prepared = queuedDxfPreparedPlan(operations);
  const controller = new AbortController();
  const result = await prepareDrawingDxfImportOverHttp({
    action: "/lukas/drawing",
    request,
    signal: controller.signal,
    fetch: async (url, init) => {
      assert.equal(url, "/lukas/drawing");
      assert.equal(init.method, "POST");
      assert.equal(init.headers.Accept, "application/json");
      assert.equal(init.signal, controller.signal);
      assert.equal(init.body.get("intent"), "prepare_dxf_import");
      assert.equal(init.body.get("revision_id"), request.revisionId);
      assert.equal(init.body.get("canvas_id"), request.canvasId);
      assert.equal(init.body.get("source_file_id"), request.sourceFileId);
      assert.equal(init.body.get("created_at"), request.createdAt);
      assert.equal(init.body.get("unit_code"), request.unitCode);
      return Response.json({
        ok: true,
        kind: "dxf_import_prepared",
        result: prepared,
      });
    },
  });
  assert.deepEqual(result, prepared);

  for (const fetch of [
    async () => new Response("unavailable", { status: 503 }),
    async () => new Response(JSON.stringify({ ok: false, error: {} })),
    async () => new Response(JSON.stringify({ ok: true, kind: "wrong" })),
    async () =>
      new Response(
        JSON.stringify({
          ok: true,
          kind: "dxf_import_prepared",
          result: {},
        }),
      ),
    async () => {
      throw new Error("network down");
    },
  ]) {
    await assert.rejects(
      () =>
        prepareDrawingDxfImportOverHttp({
          action: "/lukas/drawing",
          request,
          fetch,
        }),
      DrawingDxfImportClientError,
    );
  }
});

test("fails closed on malformed or incomplete DXF history-group metadata", () => {
  const { finalState } = threePhasePlan();
  const malformed = structuredClone(finalState);
  malformed.operations[1].forward.historyGroup.index = 0;
  malformed.operations[1].inverse.historyGroup.index = 0;

  assert.throws(
    () => undoDrawingCommandUnit(malformed, ids.actor, historyEnvironment()),
    /history group/i,
  );

  const duplicatedStack = structuredClone(finalState);
  duplicatedStack.undoStackByActor[ids.actor].unshift(ids.operation1);
  assert.throws(
    () =>
      undoDrawingCommandUnit(duplicatedStack, ids.actor, historyEnvironment()),
    /history group/i,
  );
});

test("resumes partial DXF group undo and redo transitions", () => {
  const { finalState } = threePhasePlan();
  const firstUndo = undoDrawingCommand(
    finalState,
    ids.actor,
    historyEnvironment(),
  );
  const resumedUndo = undoDrawingCommandUnit(
    firstUndo.state,
    ids.actor,
    historyEnvironment(110),
  );
  assert.ok(!("kind" in resumedUndo), JSON.stringify(resumedUndo));
  assert.equal(resumedUndo.applied.length, 2);
  assert.equal(resumedUndo.state.structure.layers[ids.layer], undefined);

  const firstRedo = redoDrawingCommand(
    resumedUndo.state,
    ids.actor,
    historyEnvironment(120),
  );
  const resumedRedo = redoDrawingCommandUnit(
    firstRedo.state,
    ids.actor,
    historyEnvironment(130),
  );
  assert.equal(resumedRedo.applied.length, 2);
  assert.equal(resumedRedo.state.structure.layers[ids.layer].locked, true);
  assert.ok(resumedRedo.state.structure.objects[ids.object]);
});

test("keeps an ungrouped command as one undo and redo unit", () => {
  const changed = applyDrawingCommand(
    initialState(),
    {
      type: "update_layer",
      actorId: ids.actor,
      layerId: ids.workLayer,
      patch: { name: "Renamed work" },
    },
    historyEnvironment(),
  );
  const undone = undoDrawingCommandUnit(
    changed.state,
    ids.actor,
    historyEnvironment(110),
  );
  assert.equal(undone.applied.length, 1);
  assert.equal(undone.state.layers[ids.workLayer].name, "Work");
  const redone = redoDrawingCommandUnit(
    undone.state,
    ids.actor,
    historyEnvironment(120),
  );
  assert.equal(redone.applied.length, 1);
  assert.equal(redone.state.layers[ids.workLayer].name, "Renamed work");
});

test("rejects DXF history groups with mixed actor or revision authority", () => {
  const { finalState } = threePhasePlan();
  for (const mutation of [
    (state) => {
      state.operations[1].actorId = ids.otherActor;
    },
    (state) => {
      state.operations[1].revisionId = ids.otherActor;
    },
  ]) {
    const invalid = structuredClone(finalState);
    mutation(invalid);
    assert.throws(
      () => undoDrawingCommandUnit(invalid, ids.actor, historyEnvironment()),
      /history group/i,
    );
  }
});

test("rejects a planned envelope whose inverse cannot be regenerated exactly", () => {
  const { operations } = threePhasePlan();
  const mismatched = structuredClone(operations);
  mismatched[0].inverse.actions[0].baseVersion = 2;

  assert.throws(
    () =>
      applyDrawingDxfImportOperation(initialState(), ids.actor, mismatched[0]),
    /does not match the regenerated operation/i,
  );
  assert.equal(initialState().operations.length, 0);
});

test("resumes exact materialized prefixes after a canonical reload without receipts", async () => {
  const { finalState, operations, states } = threePhasePlan();
  const canonicalReceipts = finalState.operations.map((operation, index) =>
    canonicalReceipt(operation, index + 1),
  );

  for (const prefix of [1, 2, 3]) {
    const reloaded = withoutLocalOperations(states[prefix - 1]);
    const result = await applyDrawingDxfImportOperations(
      reloaded,
      ids.actor,
      operations,
      canonicalReceipts.slice(0, prefix),
    );
    assert.deepEqual(
      result.alreadyMaterializedOperationIds,
      operations
        .slice(0, prefix)
        .map((operation) => operation.clientOperationId),
      `prefix ${prefix}`,
    );
    assert.deepEqual(
      result.applied.map(({ operation }) => operation.clientOperationId),
      operations.slice(prefix).map((operation) => operation.clientOperationId),
      `prefix ${prefix}`,
    );
    assert.equal(result.state.structure.layers[ids.layer].version, 2);
    assert.deepEqual(result.state.structure.objects[ids.object], object);
    assert.deepEqual(result.state.structure.sources[ids.source], source);
    assert.deepEqual(
      result.state.operations,
      finalState.operations,
      `prefix ${prefix} original receipts`,
    );
    assert.deepEqual(
      result.state.undoStackByActor[ids.actor],
      [ids.operation1, ids.operation2, ids.operation3],
      `prefix ${prefix} undo stack`,
    );
    assert.deepEqual(result.state.redoStackByActor[ids.actor], []);

    const undone = undoDrawingCommandUnit(
      result.state,
      ids.actor,
      historyEnvironment(100 + prefix * 10),
    );
    assert.ok(undone && !("kind" in undone), JSON.stringify(undone));
    assert.equal(undone.applied.length, 3, `prefix ${prefix} undo count`);
    assert.equal(undone.state.structure.layers[ids.layer], undefined);
    assert.equal(undone.state.structure.objects[ids.object], undefined);
    assert.equal(undone.state.structure.sources[ids.source], undefined);

    const redone = redoDrawingCommandUnit(
      undone.state,
      ids.actor,
      historyEnvironment(200 + prefix * 10),
    );
    assert.ok(redone && !("kind" in redone), JSON.stringify(redone));
    assert.equal(redone.applied.length, 3, `prefix ${prefix} redo count`);
    assert.deepEqual(
      withoutVersion(redone.state.structure.layers[ids.layer]),
      withoutVersion(finalState.structure.layers[ids.layer]),
      `prefix ${prefix} restored layer`,
    );
    assert.deepEqual(
      withoutVersion(redone.state.structure.objects[ids.object]),
      withoutVersion(finalState.structure.objects[ids.object]),
      `prefix ${prefix} restored object`,
    );
    assert.deepEqual(
      withoutVersion(redone.state.structure.sources[ids.source]),
      withoutVersion(finalState.structure.sources[ids.source]),
      `prefix ${prefix} restored source`,
    );
    for (const id of [ids.layer, ids.object, ids.source])
      assert.equal(redone.state.structure.tombstones?.[id], undefined);
  }

  const firstOnly = applyDrawingDxfImportOperation(
    withoutLocalOperations(states[0]),
    ids.actor,
    operations[0],
  );
  assert.equal(firstOnly.kind, "already_materialized");
});

test("installs receipt-recovered DXF history in the live draft without re-enqueueing committed originals", async () => {
  const { finalState, operations, states } = threePhasePlan();
  const canonicalReceipts = finalState.operations.map((operation, index) =>
    canonicalReceipt(operation, index + 1),
  );

  for (const prefix of [1, 2, 3]) {
    const authoritative = withoutLocalOperations(states[prefix - 1]);
    const documentStore = createDrawingDocumentStore(authoritative);
    const document = new Y.Doc();
    const localBaseMeta = initializeDrawingCollaborationDocument({
      document,
      projectId: ids.project,
      revisionId: ids.revision,
      baseSnapshotSha256: "b".repeat(64),
      baseOperationSequence: prefix,
    });
    const adapter = createDrawingDraftAdapter({
      document,
      localBaseMeta,
      authoritativeState: authoritative,
      actorId: ids.actor,
      authorization: "editor",
      frozen: false,
      baseOperationSequence: prefix,
      replaceProjection: (state) => documentStore.replace(state),
    });
    const queued = [];
    const bridge = createDrawingCollaborationCommandBridge({
      adapter,
      outbox: {
        async enqueue(operation) {
          queued.push(operation);
        },
      },
    });
    const prepared = await applyDrawingDxfImportOperations(
      adapter.getSnapshot().state,
      ids.actor,
      operations,
      canonicalReceipts.slice(0, prefix),
    );

    assert.ok(
      prepared.canonicalHistoryState,
      `prefix ${prefix} must expose exact history for the draft boundary`,
    );
    bridge.hydrateCanonicalHistory(prepared.canonicalHistoryState);
    for (const applied of prepared.applied) await bridge.applyRecorded(applied);

    assert.deepEqual(
      adapter
        .getSnapshot()
        .state.operations.map((operation) => operation.clientOperationId),
      [ids.operation1, ids.operation2, ids.operation3],
      `prefix ${prefix} adapter history`,
    );
    assert.deepEqual(
      documentStore
        .getSnapshot()
        .operations.map((operation) => operation.clientOperationId),
      [ids.operation1, ids.operation2, ids.operation3],
      `prefix ${prefix} document-store history`,
    );
    assert.deepEqual(
      queued.map((operation) => operation.clientOperationId),
      operations.slice(prefix).map((operation) => operation.clientOperationId),
      `prefix ${prefix} queues only the uncommitted suffix`,
    );
    assert.deepEqual(
      adapter.operations().map((operation) => operation.clientOperationId),
      operations.slice(prefix).map((operation) => operation.clientOperationId),
      `prefix ${prefix} keeps committed originals out of the Yjs send ledger`,
    );
    const undone = undoDrawingCommandUnit(
      adapter.getSnapshot().state,
      ids.actor,
      historyEnvironment(300 + prefix * 10),
    );
    assert.ok(undone && !("kind" in undone), JSON.stringify(undone));
    assert.equal(undone.applied.length, 3, `prefix ${prefix} undo count`);
    adapter.dispose();
    document.destroy();
  }
});

test("rejects graph-equal recovered DXF history with a forged inverse", async () => {
  const { finalState, operations, states } = threePhasePlan();
  const prepared = await applyDrawingDxfImportOperations(
    withoutLocalOperations(states[0]),
    ids.actor,
    operations,
    [canonicalReceipt(finalState.operations[0], 1)],
  );
  const wrongTarget = structuredClone(prepared.canonicalHistoryState);
  wrongTarget.operations[0].inverse.actions[0].id = ids.workLayer;
  const wrongKind = structuredClone(prepared.canonicalHistoryState);
  wrongKind.operations[0].inverse.actions[0] = {
    kind: "put_layer",
    entity: { ...stagingLayer, name: "Forged prior layer" },
    baseVersion: null,
  };
  const wrongPriorEntity = structuredClone(finalState);
  wrongPriorEntity.operations[2].inverse.actions[0].entity.name =
    "Forged intermediate layer";
  for (const [forged, authoritative, sequence] of [
    [wrongTarget, withoutLocalOperations(states[0]), 1],
    [wrongKind, withoutLocalOperations(states[0]), 1],
    [wrongPriorEntity, withoutLocalOperations(finalState), 3],
  ]) {
    const document = new Y.Doc();
    const localBaseMeta = initializeDrawingCollaborationDocument({
      document,
      projectId: ids.project,
      revisionId: ids.revision,
      baseSnapshotSha256: "b".repeat(64),
      baseOperationSequence: sequence,
    });
    const adapter = createDrawingDraftAdapter({
      document,
      localBaseMeta,
      authoritativeState: authoritative,
      actorId: ids.actor,
      authorization: "editor",
      frozen: false,
      baseOperationSequence: sequence,
    });
    const before = structuredClone(adapter.getSnapshot());
    assert.throws(
      () => adapter.hydrateCanonicalHistory(forged),
      /canonical DXF history/i,
    );
    assert.deepEqual(adapter.getSnapshot(), before);
    adapter.dispose();
    document.destroy();
  }
});

test("keeps a fresh DXF import undoable after its first authoritative checkpoint", async () => {
  const plan = threePhasePlan();
  const document = new Y.Doc();
  const localBaseMeta = initializeDrawingCollaborationDocument({
    document,
    projectId: ids.project,
    revisionId: ids.revision,
    baseSnapshotSha256: "b".repeat(64),
    baseOperationSequence: 0,
  });
  const adapter = createDrawingDraftAdapter({
    document,
    localBaseMeta,
    authoritativeState: initialState(),
    actorId: ids.actor,
    authorization: "editor",
    frozen: false,
    baseOperationSequence: 0,
  });
  const bridge = createDrawingCollaborationCommandBridge({
    adapter,
    outbox: { async enqueue() {} },
  });
  const prepared = await applyDrawingDxfImportOperations(
    adapter.getSnapshot().state,
    ids.actor,
    plan.operations,
  );
  assert.equal(prepared.canonicalHistoryState, null);
  for (const [index, applied] of prepared.applied.entries()) {
    await bridge.applyRecorded(applied);
    adapter.recordLocalAcknowledgement({
      clientOperationId: applied.operation.clientOperationId,
      authoritativeSequence: index + 1,
      resultVersions: applied.operation.resultVersions,
    });
  }

  await adapter.replaceAuthoritative(withoutLocalOperations(prepared.state), {
    baseOperationSequence: 3,
    recentOutcomes: prepared.applied.map(({ operation }, index) =>
      recentOutcome(operation, index + 1),
    ),
  });

  assert.deepEqual(
    adapter
      .getSnapshot()
      .state.operations.map((operation) => operation.clientOperationId),
    [ids.operation1, ids.operation2, ids.operation3],
  );
  assert.deepEqual(adapter.getSnapshot().state.undoStackByActor[ids.actor], [
    ids.operation1,
    ids.operation2,
    ids.operation3,
  ]);
  const undone = undoDrawingCommandUnit(
    adapter.getSnapshot().state,
    ids.actor,
    historyEnvironment(550),
  );
  assert.ok(undone && !("kind" in undone), JSON.stringify(undone));
  assert.equal(undone.applied.length, 3);
  adapter.dispose();
  document.destroy();
});

test("reconstructs fresh DXF history from a persisted Yjs ledger before its first checkpoint", async () => {
  const plan = threePhasePlan();
  const document = new Y.Doc();
  const localBaseMeta = initializeDrawingCollaborationDocument({
    document,
    projectId: ids.project,
    revisionId: ids.revision,
    baseSnapshotSha256: "b".repeat(64),
    baseOperationSequence: 0,
  });
  const firstAdapter = createDrawingDraftAdapter({
    document,
    localBaseMeta,
    authoritativeState: initialState(),
    actorId: ids.actor,
    authorization: "editor",
    frozen: false,
    baseOperationSequence: 0,
  });
  const firstBridge = createDrawingCollaborationCommandBridge({
    adapter: firstAdapter,
    outbox: { async enqueue() {} },
  });
  const prepared = await applyDrawingDxfImportOperations(
    firstAdapter.getSnapshot().state,
    ids.actor,
    plan.operations,
  );
  for (const applied of prepared.applied)
    await firstBridge.applyRecorded(applied);

  const reloadedDocument = new Y.Doc();
  const reloadedBaseMeta = initializeDrawingCollaborationDocument({
    document: reloadedDocument,
    projectId: ids.project,
    revisionId: ids.revision,
    baseSnapshotSha256: "b".repeat(64),
    baseOperationSequence: 0,
  });
  Y.applyUpdate(reloadedDocument, Y.encodeStateAsUpdate(document));
  firstAdapter.dispose();
  document.destroy();
  const reloaded = createDrawingDraftAdapter({
    document: reloadedDocument,
    localBaseMeta: reloadedBaseMeta,
    authoritativeState: initialState(),
    actorId: ids.actor,
    authorization: "editor",
    frozen: false,
    baseOperationSequence: 0,
  });
  for (const [index, applied] of prepared.applied.entries())
    reloaded.recordLocalAcknowledgement({
      clientOperationId: applied.operation.clientOperationId,
      authoritativeSequence: index + 1,
      resultVersions: applied.operation.resultVersions,
    });

  await reloaded.replaceAuthoritative(withoutLocalOperations(prepared.state), {
    baseOperationSequence: 3,
    recentOutcomes: prepared.applied.map(({ operation }, index) =>
      recentOutcome(operation, index + 1),
    ),
  });

  assert.deepEqual(
    reloaded
      .getSnapshot()
      .state.operations.map((operation) => operation.clientOperationId),
    [ids.operation1, ids.operation2, ids.operation3],
  );
  assert.deepEqual(reloaded.getSnapshot().state.undoStackByActor[ids.actor], [
    ids.operation1,
    ids.operation2,
    ids.operation3,
  ]);
  reloaded.dispose();
  reloadedDocument.destroy();
});

test("installs a newer checkpoint when an unseen same-user remote receipt explains its graph", async () => {
  const plan = threePhasePlan();
  const document = new Y.Doc();
  const localBaseMeta = initializeDrawingCollaborationDocument({
    document,
    projectId: ids.project,
    revisionId: ids.revision,
    baseSnapshotSha256: "b".repeat(64),
    baseOperationSequence: 0,
  });
  const adapter = createDrawingDraftAdapter({
    document,
    localBaseMeta,
    authoritativeState: initialState(),
    actorId: ids.actor,
    authorization: "editor",
    frozen: false,
    baseOperationSequence: 0,
  });
  const bridge = createDrawingCollaborationCommandBridge({
    adapter,
    outbox: { async enqueue() {} },
  });
  const prepared = await applyDrawingDxfImportOperations(
    adapter.getSnapshot().state,
    ids.actor,
    plan.operations,
  );
  for (const applied of prepared.applied) await bridge.applyRecorded(applied);
  const remoteLayer = {
    ...stagingLayer,
    id: "79000000-0000-4000-8000-000000000901",
    name: "Remote layer",
    sortOrder: 2,
  };
  const remote = applyDrawingCommand(
    prepared.state,
    {
      type: "mutate_structure",
      actorId: ids.actor,
      actions: [{ kind: "put_layer", entity: remoteLayer, baseVersion: null }],
    },
    {
      createId: () => "79000000-0000-4000-8000-000000000902",
      now: () => "2026-09-02T11:00:00.000Z",
    },
  );

  await adapter.replaceAuthoritative(withoutLocalOperations(remote.state), {
    baseOperationSequence: 4,
    recentOutcomes: [
      ...prepared.applied.map(({ operation }, index) =>
        recentOutcome(operation, index + 1),
      ),
      recentOutcome(remote.operation, 4),
    ],
  });

  assert.equal(adapter.getSnapshot().quarantine, null);
  assert.equal(
    adapter.getSnapshot().state.structure.layers[remoteLayer.id].name,
    "Remote layer",
  );
  assert.deepEqual(adapter.getSnapshot().state.operations, []);
  assert.deepEqual(adapter.getSnapshot().state.undoStackByActor, {});
  assert.deepEqual(adapter.getSnapshot().state.redoStackByActor, {});
  adapter.dispose();
  document.destroy();
});

test("retains a same-user receipt that arrives while checkpoint digests are pending", async () => {
  const fixture = await freshDxfDraft();
  const remoteLayer = {
    ...stagingLayer,
    id: "79000000-0000-4000-8000-000000000910",
    name: "Late remote layer",
    sortOrder: 2,
  };
  const remote = applyDrawingCommand(
    fixture.prepared.state,
    {
      type: "mutate_structure",
      actorId: ids.actor,
      actions: [{ kind: "put_layer", entity: remoteLayer, baseVersion: null }],
    },
    {
      createId: () => "79000000-0000-4000-8000-000000000911",
      now: () => "2026-09-02T11:10:00.000Z",
    },
  );
  const deferred = deferWebCryptoDigests();
  try {
    const replacement = fixture.adapter.replaceAuthoritative(
      withoutLocalOperations(remote.state),
      {
        baseOperationSequence: 4,
        recentOutcomes: [
          ...fixture.prepared.applied.map(({ operation }, index) =>
            recentOutcome(operation, index + 1),
          ),
          recentOutcome(remote.operation, 4),
        ],
      },
    );
    await deferred.started;
    fixture.adapter.appendDurableLocal(
      fixture.adapter.prepareRecordedLocal(remote.operation),
    );
    deferred.release();
    await replacement;

    assert.deepEqual(fixture.adapter.getSnapshot().pendingOperationIds, []);
    assert.deepEqual(
      fixture.adapter.getSnapshot().provisionalConflictOperationIds,
      [],
    );
    assert.equal(
      fixture.adapter.isOperationCheckpointAcknowledged(
        remote.operation.clientOperationId,
        4,
      ),
      true,
    );
    assert.equal(
      fixture.adapter.getSnapshot().state.structure.layers[remoteLayer.id].name,
      remoteLayer.name,
    );
  } finally {
    deferred.release();
    deferred.restore();
    fixture.adapter.dispose();
    fixture.document.destroy();
  }
});

test("rejects a mismatched checkpoint after its late same-user receipt becomes visible", async () => {
  const fixture = await freshDxfDraft();
  const remoteLayer = {
    ...stagingLayer,
    id: "79000000-0000-4000-8000-000000000912",
    name: "Late remote mismatch layer",
    sortOrder: 2,
  };
  const remote = applyDrawingCommand(
    fixture.prepared.state,
    {
      type: "mutate_structure",
      actorId: ids.actor,
      actions: [{ kind: "put_layer", entity: remoteLayer, baseVersion: null }],
    },
    {
      createId: () => "79000000-0000-4000-8000-000000000913",
      now: () => "2026-09-02T11:11:00.000Z",
    },
  );
  const mismatched = withoutLocalOperations(remote.state);
  mismatched.structure.objects[ids.object].name = "Unexplained late change";
  mismatched.structure.objects[ids.object].version += 1;
  const deferred = deferWebCryptoDigests();
  try {
    const replacement = fixture.adapter.replaceAuthoritative(mismatched, {
      baseOperationSequence: 4,
      recentOutcomes: [
        ...fixture.prepared.applied.map(({ operation }, index) =>
          recentOutcome(operation, index + 1),
        ),
        recentOutcome(remote.operation, 4),
      ],
    });
    await deferred.started;
    fixture.adapter.appendDurableLocal(
      fixture.adapter.prepareRecordedLocal(remote.operation),
    );
    deferred.release();

    await assert.rejects(() => replacement, /checkpoint|receipt|exact/i);
    assert.equal(
      fixture.adapter.getSnapshot().state.structure.objects[ids.object].name,
      object.name,
    );
    assert.equal(
      fixture.adapter.isOperationCheckpointAcknowledged(
        remote.operation.clientOperationId,
        4,
      ),
      false,
    );
  } finally {
    deferred.release();
    deferred.restore();
    fixture.adapter.dispose();
    fixture.document.destroy();
  }
});

test("rejects a checkpoint verification changed by an unrelated late operation", async () => {
  const fixture = await freshDxfDraft();
  const remoteLayer = {
    ...stagingLayer,
    id: "79000000-0000-4000-8000-000000000916",
    name: "Expected remote layer",
    sortOrder: 2,
  };
  const unrelatedLayer = {
    ...stagingLayer,
    id: "79000000-0000-4000-8000-000000000917",
    name: "Unrelated late layer",
    sortOrder: 3,
  };
  const remote = applyDrawingCommand(
    fixture.prepared.state,
    {
      type: "mutate_structure",
      actorId: ids.actor,
      actions: [{ kind: "put_layer", entity: remoteLayer, baseVersion: null }],
    },
    {
      createId: () => "79000000-0000-4000-8000-000000000918",
      now: () => "2026-09-02T11:13:00.000Z",
    },
  );
  const unrelated = applyDrawingCommand(
    fixture.prepared.state,
    {
      type: "mutate_structure",
      actorId: ids.actor,
      actions: [
        { kind: "put_layer", entity: unrelatedLayer, baseVersion: null },
      ],
    },
    {
      createId: () => "79000000-0000-4000-8000-000000000919",
      now: () => "2026-09-02T11:14:00.000Z",
    },
  );
  const deferred = deferWebCryptoDigests();
  try {
    const replacement = fixture.adapter.replaceAuthoritative(
      withoutLocalOperations(remote.state),
      {
        baseOperationSequence: 4,
        recentOutcomes: [
          ...fixture.prepared.applied.map(({ operation }, index) =>
            recentOutcome(operation, index + 1),
          ),
          recentOutcome(remote.operation, 4),
        ],
      },
    );
    await deferred.started;
    fixture.adapter.appendDurableLocal(
      fixture.adapter.prepareRecordedLocal(unrelated.operation),
    );
    deferred.release();

    await assert.rejects(() => replacement, /stale/i);
    assert.equal(
      fixture.adapter.getSnapshot().state.structure.layers[remoteLayer.id],
      undefined,
    );
    assert.equal(
      fixture.adapter.getSnapshot().state.structure.layers[unrelatedLayer.id]
        .name,
      unrelatedLayer.name,
    );
  } finally {
    deferred.release();
    deferred.restore();
    fixture.adapter.dispose();
    fixture.document.destroy();
  }
});

test("retains unseen checkpoint receipts across operation and status arrival order", async () => {
  for (const [index, order] of [
    "operation-only",
    "operation-first",
    "status-first",
  ].entries()) {
    const fixture = await freshDxfDraft();
    const remoteLayer = {
      ...stagingLayer,
      id: `79000000-0000-4000-8000-${String(920 + index * 2).padStart(12, "0")}`,
      name: `Deferred remote layer ${order}`,
      sortOrder: 2,
    };
    const remote = applyDrawingCommand(
      fixture.prepared.state,
      {
        type: "mutate_structure",
        actorId: ids.actor,
        actions: [
          { kind: "put_layer", entity: remoteLayer, baseVersion: null },
        ],
      },
      {
        createId: () =>
          `79000000-0000-4000-8000-${String(921 + index * 2).padStart(12, "0")}`,
        now: () => "2026-09-02T11:15:00.000Z",
      },
    );
    const acknowledgement = {
      operationId: remote.operation.clientOperationId,
      status: "acked",
      authoritativeSequence: 4,
      resultVersions: remote.operation.resultVersions,
    };
    await fixture.adapter.replaceAuthoritative(
      withoutLocalOperations(remote.state),
      {
        baseOperationSequence: 4,
        recentOutcomes: [
          ...fixture.prepared.applied.map(({ operation }, outcomeIndex) =>
            recentOutcome(operation, outcomeIndex + 1),
          ),
          recentOutcome(remote.operation, 4),
        ],
      },
    );

    if (order === "status-first")
      fixture.document
        .getMap("operationStatus")
        .set(remote.operation.clientOperationId, acknowledgement);
    fixture.adapter.appendDurableLocal(
      fixture.adapter.prepareRecordedLocal(remote.operation),
    );
    assert.deepEqual(
      fixture.adapter.getSnapshot().pendingOperationIds,
      [],
      order,
    );
    assert.deepEqual(
      fixture.adapter.getSnapshot().provisionalConflictOperationIds,
      [],
      order,
    );
    if (order === "operation-first")
      fixture.document
        .getMap("operationStatus")
        .set(remote.operation.clientOperationId, acknowledgement);
    for (let attempt = 0; attempt < 20; attempt++) {
      if (
        fixture.adapter.isOperationCheckpointAcknowledged(
          remote.operation.clientOperationId,
          4,
        )
      )
        break;
      await new Promise((resolve) => setTimeout(resolve, 1));
    }

    assert.equal(fixture.adapter.getSnapshot().quarantine, null, order);
    assert.equal(
      fixture.adapter.isOperationCheckpointAcknowledged(
        remote.operation.clientOperationId,
        4,
      ),
      true,
      order,
    );
    assert.equal(
      fixture.adapter.getSnapshot().state.structure.layers[remoteLayer.id].name,
      remoteLayer.name,
      order,
    );
    fixture.adapter.dispose();
    fixture.document.destroy();
  }
});

test("blocks a newer checkpoint until its unseen receipt is verified", async () => {
  const fixture = await freshDxfDraft();
  const remoteLayer = {
    ...stagingLayer,
    id: "79000000-0000-4000-8000-000000000926",
    name: "Pending deferred checkpoint",
    sortOrder: 2,
  };
  const remote = applyDrawingCommand(
    fixture.prepared.state,
    {
      type: "mutate_structure",
      actorId: ids.actor,
      actions: [{ kind: "put_layer", entity: remoteLayer, baseVersion: null }],
    },
    {
      createId: () => "79000000-0000-4000-8000-000000000927",
      now: () => "2026-09-02T11:15:30.000Z",
    },
  );
  const checkpoint = withoutLocalOperations(remote.state);
  await fixture.adapter.replaceAuthoritative(checkpoint, {
    baseOperationSequence: 4,
    recentOutcomes: [
      ...fixture.prepared.applied.map(({ operation }, index) =>
        recentOutcome(operation, index + 1),
      ),
      recentOutcome(remote.operation, 4),
    ],
  });
  const before = structuredClone(fixture.adapter.getSnapshot());

  assert.throws(
    () =>
      fixture.adapter.replaceAuthoritative(checkpoint, {
        baseOperationSequence: 5,
      }),
    /pending verification/i,
  );
  assert.deepEqual(fixture.adapter.getSnapshot(), before);

  fixture.adapter.appendDurableLocal(
    fixture.adapter.prepareRecordedLocal(remote.operation),
  );
  for (let attempt = 0; attempt < 20; attempt++) {
    if (
      fixture.adapter.isOperationCheckpointAcknowledged(
        remote.operation.clientOperationId,
        4,
      )
    )
      break;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  assert.doesNotThrow(() =>
    fixture.adapter.replaceAuthoritative(checkpoint, {
      baseOperationSequence: 5,
    }),
  );
  assert.equal(fixture.adapter.getSnapshot().quarantine, null);
  fixture.adapter.dispose();
  fixture.document.destroy();
});

test("quarantines an unseen checkpoint whose later receipt proves a graph mismatch", async () => {
  const fixture = await freshDxfDraft();
  const remoteLayer = {
    ...stagingLayer,
    id: "79000000-0000-4000-8000-000000000928",
    name: "Deferred mismatch receipt",
    sortOrder: 2,
  };
  const remote = applyDrawingCommand(
    fixture.prepared.state,
    {
      type: "mutate_structure",
      actorId: ids.actor,
      actions: [{ kind: "put_layer", entity: remoteLayer, baseVersion: null }],
    },
    {
      createId: () => "79000000-0000-4000-8000-000000000929",
      now: () => "2026-09-02T11:16:00.000Z",
    },
  );
  const mismatched = withoutLocalOperations(remote.state);
  mismatched.structure.objects[ids.object].name = "Unexplained deferred change";
  mismatched.structure.objects[ids.object].version += 1;
  await fixture.adapter.replaceAuthoritative(mismatched, {
    baseOperationSequence: 4,
    recentOutcomes: [
      ...fixture.prepared.applied.map(({ operation }, index) =>
        recentOutcome(operation, index + 1),
      ),
      recentOutcome(remote.operation, 4),
    ],
  });

  fixture.adapter.appendDurableLocal(
    fixture.adapter.prepareRecordedLocal(remote.operation),
  );
  assert.deepEqual(fixture.adapter.getSnapshot().pendingOperationIds, []);
  for (let attempt = 0; attempt < 20; attempt++) {
    if (fixture.adapter.getSnapshot().quarantine) break;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }

  assert.match(
    fixture.adapter.getSnapshot().quarantine?.message ?? "",
    /deferred receipts/i,
  );
  assert.equal(
    fixture.adapter.isOperationCheckpointAcknowledged(
      remote.operation.clientOperationId,
      4,
    ),
    false,
  );
  await assert.rejects(
    () =>
      fixture.adapter.replaceAuthoritative(
        withoutLocalOperations(fixture.prepared.state),
        {
          baseOperationSequence: 3,
          recentOutcomes: fixture.prepared.applied.map(
            ({ operation }, index) => ({
              ...recentOutcome(operation, index + 1),
              ...(index === 2 ? { operationSha256: "f".repeat(64) } : {}),
            }),
          ),
        },
      ),
    /digest/i,
  );
  await fixture.adapter.replaceAuthoritative(
    withoutLocalOperations(remote.state),
    {
      baseOperationSequence: 4,
      recentOutcomes: [
        ...fixture.prepared.applied.map(({ operation }, index) =>
          recentOutcome(operation, index + 1),
        ),
        recentOutcome(remote.operation, 4),
      ],
    },
  );
  assert.equal(fixture.adapter.getSnapshot().quarantine, null);
  assert.equal(
    fixture.adapter.isOperationCheckpointAcknowledged(
      remote.operation.clientOperationId,
      4,
    ),
    true,
  );
  fixture.adapter.dispose();
  fixture.document.destroy();
});

test("validates visible checkpoint receipts independently of an unrelated pending edit", async () => {
  const fixture = await freshDxfDraft({
    createId: () => "79000000-0000-4000-8000-000000000914",
    now: () => "2026-09-02T11:12:00.000Z",
  });
  const unrelatedLayer = {
    ...stagingLayer,
    id: "79000000-0000-4000-8000-000000000915",
    name: "Unrelated pending layer",
    sortOrder: 2,
  };
  await fixture.bridge.applyCommand({
    type: "mutate_structure",
    actorId: ids.actor,
    actions: [{ kind: "put_layer", entity: unrelatedLayer, baseVersion: null }],
  });
  const before = structuredClone(fixture.adapter.getSnapshot());
  const mismatched = withoutLocalOperations(fixture.prepared.state);
  mismatched.structure.objects[ids.object].name = "Unexplained change";
  mismatched.structure.objects[ids.object].version += 1;

  await assert.rejects(
    () =>
      fixture.adapter.replaceAuthoritative(mismatched, {
        baseOperationSequence: 3,
        recentOutcomes: fixture.prepared.applied.map(({ operation }, index) =>
          recentOutcome(operation, index + 1),
        ),
      }),
    /checkpoint|receipt|exact/i,
  );
  assert.deepEqual(fixture.adapter.getSnapshot(), before);

  await fixture.adapter.replaceAuthoritative(
    withoutLocalOperations(fixture.prepared.state),
    {
      baseOperationSequence: 3,
      recentOutcomes: fixture.prepared.applied.map(({ operation }, index) =>
        recentOutcome(operation, index + 1),
      ),
    },
  );
  assert.deepEqual(fixture.adapter.getSnapshot().pendingOperationIds, [
    "79000000-0000-4000-8000-000000000914",
  ]);
  assert.deepEqual(
    fixture.adapter.getSnapshot().provisionalConflictOperationIds,
    [],
  );
  for (const { operation } of fixture.prepared.applied)
    assert.equal(
      fixture.adapter.isOperationCheckpointAcknowledged(
        operation.clientOperationId,
        3,
      ),
      true,
    );
  fixture.adapter.dispose();
  fixture.document.destroy();
});

test("rolls back a verified checkpoint when projection replacement throws", async () => {
  let rejectProjection = false;
  const fixture = await freshDxfDraft({
    replaceProjection() {
      if (rejectProjection) throw new Error("projection failed");
    },
  });
  const checkpoint = withoutLocalOperations(fixture.prepared.state);
  const options = {
    baseOperationSequence: 3,
    recentOutcomes: fixture.prepared.applied.map(({ operation }, index) =>
      recentOutcome(operation, index + 1),
    ),
  };
  const before = structuredClone(fixture.adapter.getSnapshot());
  rejectProjection = true;

  await assert.rejects(
    () => fixture.adapter.replaceAuthoritative(checkpoint, options),
    /projection failed/i,
  );
  assert.deepEqual(fixture.adapter.getSnapshot(), before);
  for (const { operation } of fixture.prepared.applied)
    assert.equal(
      fixture.adapter.isOperationCheckpointAcknowledged(
        operation.clientOperationId,
        3,
      ),
      false,
    );

  rejectProjection = false;
  await fixture.adapter.replaceAuthoritative(checkpoint, options);
  assert.deepEqual(fixture.adapter.getSnapshot().pendingOperationIds, []);
  assert.equal(fixture.adapter.getSnapshot().quarantine, null);
  fixture.adapter.dispose();
  fixture.document.destroy();
});

test("rolls back an ordinary checkpoint when projection replacement throws", () => {
  const document = new Y.Doc();
  const localBaseMeta = initializeDrawingCollaborationDocument({
    document,
    projectId: ids.project,
    revisionId: ids.revision,
    baseSnapshotSha256: "b".repeat(64),
    baseOperationSequence: 0,
  });
  let rejectProjection = false;
  const adapter = createDrawingDraftAdapter({
    document,
    localBaseMeta,
    authoritativeState: initialState(),
    actorId: ids.actor,
    authorization: "editor",
    frozen: false,
    baseOperationSequence: 0,
    replaceProjection() {
      if (rejectProjection) throw new Error("ordinary projection failed");
    },
  });
  const changed = initialState();
  changed.layers[ids.workLayer].name = "Failed checkpoint layer";
  changed.layers[ids.workLayer].version = 2;
  changed.structure.layers[ids.workLayer] = changed.layers[ids.workLayer];
  const before = structuredClone(adapter.getSnapshot());
  rejectProjection = true;

  assert.throws(
    () => adapter.replaceAuthoritative(changed, { baseOperationSequence: 5 }),
    /ordinary projection failed/i,
  );
  assert.deepEqual(adapter.getSnapshot(), before);

  rejectProjection = false;
  assert.doesNotThrow(() =>
    adapter.replaceAuthoritative(initialState(), { baseOperationSequence: 1 }),
  );
  assert.equal(adapter.getSnapshot().quarantine, null);
  adapter.dispose();
  document.destroy();
});

test("subscriber exceptions do not roll back a committed checkpoint", () => {
  const document = new Y.Doc();
  const localBaseMeta = initializeDrawingCollaborationDocument({
    document,
    projectId: ids.project,
    revisionId: ids.revision,
    baseSnapshotSha256: "b".repeat(64),
    baseOperationSequence: 0,
  });
  const adapter = createDrawingDraftAdapter({
    document,
    localBaseMeta,
    authoritativeState: initialState(),
    actorId: ids.actor,
    authorization: "editor",
    frozen: false,
    baseOperationSequence: 0,
  });
  const changed = initialState();
  changed.layers[ids.workLayer].name = "Committed checkpoint layer";
  changed.layers[ids.workLayer].version = 2;
  changed.structure.layers[ids.workLayer] = changed.layers[ids.workLayer];
  adapter.subscribe(() => {
    throw new Error("listener failed");
  });

  assert.doesNotThrow(() =>
    adapter.replaceAuthoritative(changed, { baseOperationSequence: 1 }),
  );
  assert.equal(
    adapter.getSnapshot().state.structure.layers[ids.workLayer].name,
    "Committed checkpoint layer",
  );
  assert.equal(adapter.getSnapshot().quarantine, null);
  adapter.dispose();
  document.destroy();
});

test("rejects a mismatched checkpoint when every boundary receipt is locally visible", async () => {
  const plan = threePhasePlan();
  const document = new Y.Doc();
  const localBaseMeta = initializeDrawingCollaborationDocument({
    document,
    projectId: ids.project,
    revisionId: ids.revision,
    baseSnapshotSha256: "b".repeat(64),
    baseOperationSequence: 0,
  });
  const adapter = createDrawingDraftAdapter({
    document,
    localBaseMeta,
    authoritativeState: initialState(),
    actorId: ids.actor,
    authorization: "editor",
    frozen: false,
    baseOperationSequence: 0,
  });
  const bridge = createDrawingCollaborationCommandBridge({
    adapter,
    outbox: { async enqueue() {} },
  });
  const prepared = await applyDrawingDxfImportOperations(
    adapter.getSnapshot().state,
    ids.actor,
    plan.operations,
  );
  for (const applied of prepared.applied) await bridge.applyRecorded(applied);
  const mismatched = withoutLocalOperations(prepared.state);
  mismatched.structure.objects[ids.object].name = "Unexplained change";
  mismatched.structure.objects[ids.object].version += 1;

  await assert.rejects(
    () =>
      adapter.replaceAuthoritative(mismatched, {
        baseOperationSequence: 3,
        recentOutcomes: prepared.applied.map(({ operation }, index) =>
          recentOutcome(operation, index + 1),
        ),
      }),
    /exact receipts/i,
  );
  assert.equal(
    adapter.getSnapshot().state.structure.objects[ids.object].name,
    object.name,
  );
  assert.equal(adapter.getSnapshot().quarantine, null);
  adapter.dispose();
  document.destroy();
});

test("keeps recovered DXF history through suffix, grouped undo, and grouped redo checkpoints", async () => {
  const { finalState, operations, states } = threePhasePlan();
  const canonicalReceipts = finalState.operations.map((operation, index) =>
    canonicalReceipt(operation, index + 1),
  );
  const authoritative = withoutLocalOperations(states[0]);
  const documentStore = createDrawingDocumentStore(authoritative);
  const document = new Y.Doc();
  const localBaseMeta = initializeDrawingCollaborationDocument({
    document,
    projectId: ids.project,
    revisionId: ids.revision,
    baseSnapshotSha256: "b".repeat(64),
    baseOperationSequence: 1,
  });
  const adapter = createDrawingDraftAdapter({
    document,
    localBaseMeta,
    authoritativeState: authoritative,
    actorId: ids.actor,
    authorization: "editor",
    frozen: false,
    baseOperationSequence: 1,
    replaceProjection: (state) => documentStore.replace(state),
  });
  const queued = [];
  const bridge = createDrawingCollaborationCommandBridge({
    adapter,
    outbox: {
      async enqueue(operation) {
        queued.push(operation);
      },
    },
  });
  const prepared = await applyDrawingDxfImportOperations(
    adapter.getSnapshot().state,
    ids.actor,
    operations,
    canonicalReceipts.slice(0, 1),
  );
  bridge.hydrateCanonicalHistory(prepared.canonicalHistoryState);
  for (const [index, applied] of prepared.applied.entries()) {
    await bridge.applyRecorded(applied);
    adapter.recordLocalAcknowledgement({
      clientOperationId: applied.operation.clientOperationId,
      authoritativeSequence: index + 2,
      resultVersions: applied.operation.resultVersions,
    });
  }
  const undone = undoDrawingCommandUnit(
    adapter.getSnapshot().state,
    ids.actor,
    historyEnvironment(600),
  );
  assert.ok(undone && !("kind" in undone), JSON.stringify(undone));
  for (const applied of undone.applied) await bridge.applyRecorded(applied);
  adapter.replaceAuthoritative(withoutLocalOperations(prepared.state), {
    baseOperationSequence: 3,
  });

  assert.deepEqual(
    adapter
      .getSnapshot()
      .state.operations.map((operation) => operation.clientOperationId),
    [
      ids.operation1,
      ids.operation2,
      ids.operation3,
      ...undone.applied.map(({ operation }) => operation.clientOperationId),
    ],
    "a suffix checkpoint must preserve recovered history before replaying pending Undo",
  );
  assert.deepEqual(
    adapter.getSnapshot().pendingOperationIds,
    undone.applied.map(({ operation }) => operation.clientOperationId),
  );
  assert.equal(documentStore.getSnapshot().operations.length, 6);
  assert.equal(
    adapter.getSnapshot().quarantine,
    null,
    "pending grouped Undo must replay cleanly after the suffix checkpoint",
  );
  for (const [index, applied] of undone.applied.entries()) {
    adapter.recordLocalAcknowledgement({
      clientOperationId: applied.operation.clientOperationId,
      authoritativeSequence: index + 4,
      resultVersions: applied.operation.resultVersions,
    });
  }
  const undoCheckpoint = withoutLocalOperations(undone.state);
  delete undoCheckpoint.structure.tombstones;
  adapter.replaceAuthoritative(undoCheckpoint, {
    baseOperationSequence: 6,
  });

  assert.deepEqual(adapter.getSnapshot().state.undoStackByActor[ids.actor], []);
  assert.deepEqual(adapter.getSnapshot().state.redoStackByActor[ids.actor], [
    ids.operation3,
    ids.operation2,
    ids.operation1,
  ]);
  assert.equal(adapter.getSnapshot().state.operations.length, 6);

  const redone = redoDrawingCommandUnit(
    adapter.getSnapshot().state,
    ids.actor,
    historyEnvironment(700),
  );
  assert.ok(redone && !("kind" in redone), JSON.stringify(redone));
  for (const [index, applied] of redone.applied.entries()) {
    await bridge.applyRecorded(applied);
    adapter.recordLocalAcknowledgement({
      clientOperationId: applied.operation.clientOperationId,
      authoritativeSequence: index + 7,
      resultVersions: applied.operation.resultVersions,
    });
  }
  const redoCheckpoint = withoutLocalOperations(redone.state);
  delete redoCheckpoint.structure.tombstones;
  adapter.replaceAuthoritative(redoCheckpoint, {
    baseOperationSequence: 9,
  });

  assert.deepEqual(adapter.getSnapshot().state.undoStackByActor[ids.actor], [
    ids.operation1,
    ids.operation2,
    ids.operation3,
  ]);
  assert.deepEqual(adapter.getSnapshot().state.redoStackByActor[ids.actor], []);
  assert.equal(adapter.getSnapshot().state.operations.length, 9);
  assert.equal(documentStore.getSnapshot().operations.length, 9);
  const persistedOperationIds = [
    ids.operation2,
    ids.operation3,
    ...undone.applied.map(({ operation }) => operation.clientOperationId),
    ...redone.applied.map(({ operation }) => operation.clientOperationId),
  ];
  assert.deepEqual(
    queued.map((operation) => operation.clientOperationId),
    persistedOperationIds,
    "only the suffix and later history actions may enter the outbox",
  );
  assert.deepEqual(
    adapter.operations().map((operation) => operation.clientOperationId),
    persistedOperationIds,
    "the receipt-recovered prefix must never enter the Yjs send ledger",
  );
  assert.equal(adapter.getSnapshot().quarantine, null);
  adapter.dispose();
  document.destroy();
});

test("absorbs receipt-proven DXF suffix checkpoints that arrive before local ACK state", async () => {
  for (const committed of [1, 2, 3]) {
    const fixture = await receiptRecoveredDraft(1);
    const absorbedSuffix = committed - 1;
    if (absorbedSuffix > 0) {
      const checkpoint = withoutLocalOperations(fixture.states[committed - 1]);
      await fixture.adapter.replaceAuthoritative(checkpoint, {
        baseOperationSequence: committed,
        recentOutcomes: fixture.prepared.applied
          .slice(0, absorbedSuffix)
          .map(({ operation }, index) => recentOutcome(operation, index + 2)),
      });
    }

    assert.equal(
      fixture.adapter.getSnapshot().quarantine,
      null,
      `${committed}/3 original receipts`,
    );
    assert.deepEqual(
      fixture.adapter
        .getSnapshot()
        .state.operations.map((operation) => operation.clientOperationId),
      [ids.operation1, ids.operation2, ids.operation3],
      `${committed}/3 original history`,
    );
    assert.deepEqual(
      fixture.adapter.getSnapshot().pendingOperationIds,
      fixture.prepared.applied
        .slice(absorbedSuffix)
        .map(({ operation }) => operation.clientOperationId),
      `${committed}/3 remaining originals`,
    );
    assert.deepEqual(
      fixture.queued.map((operation) => operation.clientOperationId),
      [ids.operation2, ids.operation3],
      "the receipt-recovered prefix is never retransmitted",
    );
    fixture.adapter.dispose();
    fixture.document.destroy();
  }
});

test("absorbs every partial grouped Undo checkpoint before local ACK state", async () => {
  for (const absorbed of [1, 2, 3]) {
    const fixture = await settledReceiptRecoveredDraft();
    const undone = undoDrawingCommandUnit(
      fixture.adapter.getSnapshot().state,
      ids.actor,
      historyEnvironment(600),
    );
    assert.ok(undone && !("kind" in undone), JSON.stringify(undone));
    for (const applied of undone.applied)
      await fixture.bridge.applyRecorded(applied);
    const checkpoint = withoutLocalOperations(
      undone.applied[absorbed - 1].state,
    );
    delete checkpoint.structure.tombstones;

    await fixture.adapter.replaceAuthoritative(checkpoint, {
      baseOperationSequence: absorbed + 3,
      recentOutcomes: undone.applied
        .slice(0, absorbed)
        .map(({ operation }, index) => recentOutcome(operation, index + 4)),
    });

    const snapshot = fixture.adapter.getSnapshot();
    assert.equal(snapshot.quarantine, null, `${absorbed}/3 Undo receipts`);
    assert.deepEqual(
      snapshot.pendingOperationIds,
      undone.applied
        .slice(absorbed)
        .map(({ operation }) => operation.clientOperationId),
      `${absorbed}/3 remaining Undo`,
    );
    assert.deepEqual(snapshot.state.undoStackByActor[ids.actor], []);
    assert.deepEqual(snapshot.state.redoStackByActor[ids.actor], [
      ids.operation3,
      ids.operation2,
      ids.operation1,
    ]);
    assert.equal(snapshot.state.operations.length, 6);
    assert.deepEqual(
      fixture.adapter
        .operations()
        .slice(0, 2)
        .map((operation) => operation.clientOperationId),
      [ids.operation2, ids.operation3],
      "the recovered original stays outside the Yjs ledger",
    );
    fixture.adapter.dispose();
    fixture.document.destroy();
  }
});

test("absorbs every partial grouped Redo checkpoint before local ACK state", async () => {
  for (const absorbed of [1, 2, 3]) {
    const fixture = await settledReceiptRecoveredDraft();
    const undone = undoDrawingCommandUnit(
      fixture.adapter.getSnapshot().state,
      ids.actor,
      historyEnvironment(600),
    );
    assert.ok(undone && !("kind" in undone), JSON.stringify(undone));
    for (const [index, applied] of undone.applied.entries()) {
      await fixture.bridge.applyRecorded(applied);
      fixture.adapter.recordLocalAcknowledgement({
        clientOperationId: applied.operation.clientOperationId,
        authoritativeSequence: index + 4,
        resultVersions: applied.operation.resultVersions,
      });
    }
    const undoCheckpoint = withoutLocalOperations(undone.state);
    delete undoCheckpoint.structure.tombstones;
    fixture.adapter.replaceAuthoritative(undoCheckpoint, {
      baseOperationSequence: 6,
    });
    const redone = redoDrawingCommandUnit(
      fixture.adapter.getSnapshot().state,
      ids.actor,
      historyEnvironment(700),
    );
    assert.ok(redone && !("kind" in redone), JSON.stringify(redone));
    for (const applied of redone.applied)
      await fixture.bridge.applyRecorded(applied);
    const checkpoint = withoutLocalOperations(
      redone.applied[absorbed - 1].state,
    );
    delete checkpoint.structure.tombstones;

    await fixture.adapter.replaceAuthoritative(checkpoint, {
      baseOperationSequence: absorbed + 6,
      recentOutcomes: redone.applied
        .slice(0, absorbed)
        .map(({ operation }, index) => recentOutcome(operation, index + 7)),
    });

    const snapshot = fixture.adapter.getSnapshot();
    assert.equal(snapshot.quarantine, null, `${absorbed}/3 Redo receipts`);
    assert.deepEqual(
      snapshot.pendingOperationIds,
      redone.applied
        .slice(absorbed)
        .map(({ operation }) => operation.clientOperationId),
      `${absorbed}/3 remaining Redo`,
    );
    assert.deepEqual(snapshot.state.undoStackByActor[ids.actor], [
      ids.operation1,
      ids.operation2,
      ids.operation3,
    ]);
    assert.deepEqual(snapshot.state.redoStackByActor[ids.actor], []);
    assert.equal(snapshot.state.operations.length, 9);
    fixture.adapter.dispose();
    fixture.document.destroy();
  }
});

test("rejects inexact canonical checkpoint outcomes before changing recovered history", async () => {
  const mutations = [
    [
      "operation ID",
      (outcome, otherOperation) => ({
        ...outcome,
        clientOperationId: otherOperation.clientOperationId,
      }),
    ],
    [
      "actor",
      (outcome, _otherOperation, originalOperation) => ({
        ...outcome,
        actorId: ids.otherActor,
        operationSha256: createHash("sha256")
          .update(
            drawingCollaborationOperationDigestSource(
              operationInput(originalOperation),
              ids.otherActor,
            ),
          )
          .digest("hex"),
      }),
    ],
    ["digest", (outcome) => ({ ...outcome, operationSha256: "f".repeat(64) })],
    [
      "result versions",
      (outcome) => ({
        ...outcome,
        resultVersions: { [ids.layer]: 99 },
      }),
    ],
    ["sequence", (outcome) => ({ ...outcome, sequence: 5 })],
  ];
  for (const [name, mutate] of mutations) {
    const fixture = await settledReceiptRecoveredDraft();
    const undone = undoDrawingCommandUnit(
      fixture.adapter.getSnapshot().state,
      ids.actor,
      historyEnvironment(600),
    );
    assert.ok(undone && !("kind" in undone), JSON.stringify(undone));
    for (const applied of undone.applied)
      await fixture.bridge.applyRecorded(applied);
    const checkpoint = withoutLocalOperations(undone.applied[0].state);
    delete checkpoint.structure.tombstones;
    const outcome = mutate(
      recentOutcome(undone.applied[0].operation, 4),
      undone.applied[1].operation,
      undone.applied[0].operation,
    );

    await assert.rejects(
      () =>
        fixture.adapter.replaceAuthoritative(checkpoint, {
          baseOperationSequence: 4,
          recentOutcomes: [outcome],
        }),
      /checkpoint|outcome|receipt|digest|result|sequence/i,
      name,
    );
    assert.equal(fixture.adapter.getSnapshot().quarantine, null, name);
    assert.equal(
      fixture.adapter.getSnapshot().state.operations.length,
      6,
      name,
    );
    fixture.adapter.dispose();
    fixture.document.destroy();
  }
});

test("rejects local ACK conflicts but accepts canonical receipts over stale server pending", async () => {
  for (const source of ["local", "server"]) {
    const fixture = await settledReceiptRecoveredDraft();
    const undone = undoDrawingCommandUnit(
      fixture.adapter.getSnapshot().state,
      ids.actor,
      historyEnvironment(600),
    );
    assert.ok(undone && !("kind" in undone), JSON.stringify(undone));
    for (const applied of undone.applied)
      await fixture.bridge.applyRecorded(applied);
    const operation = undone.applied[0].operation;
    if (source === "local")
      fixture.adapter.recordLocalAcknowledgement({
        clientOperationId: operation.clientOperationId,
        authoritativeSequence: 5,
        resultVersions: operation.resultVersions,
      });
    else
      fixture.document
        .getMap("operationStatus")
        .set(operation.clientOperationId, {
          operationId: operation.clientOperationId,
          status: "pending",
          authoritativeSequence: null,
          resultVersions: {},
        });
    const before = structuredClone(fixture.adapter.getSnapshot());
    const checkpoint = withoutLocalOperations(undone.applied[0].state);
    delete checkpoint.structure.tombstones;

    const replacement = fixture.adapter.replaceAuthoritative(checkpoint, {
      baseOperationSequence: 4,
      recentOutcomes: [recentOutcome(operation, 4)],
    });
    if (source === "local") {
      await assert.rejects(
        () => replacement,
        /acknowledgement conflicts|checkpoint/i,
        source,
      );
      assert.deepEqual(fixture.adapter.getSnapshot(), before, source);
    } else {
      await replacement;
      assert.equal(fixture.adapter.getSnapshot().quarantine, null);
      assert.equal(
        fixture.adapter.operationStatus(operation.clientOperationId).status,
        "acked",
      );
      assert.equal(
        fixture.document
          .getMap("operationStatus")
          .get(operation.clientOperationId).status,
        "pending",
        "canonical receipt authority must not rewrite protected server state",
      );
    }
    fixture.adapter.dispose();
    fixture.document.destroy();
  }
});

test("a later conflicting grouped receipt cannot leak an earlier checkpoint ACK", async () => {
  const fixture = await settledReceiptRecoveredDraft();
  const undone = undoDrawingCommandUnit(
    fixture.adapter.getSnapshot().state,
    ids.actor,
    historyEnvironment(600),
  );
  assert.ok(undone && !("kind" in undone), JSON.stringify(undone));
  for (const applied of undone.applied)
    await fixture.bridge.applyRecorded(applied);
  const first = undone.applied[0].operation;
  fixture.document.getMap("operationStatus").set(first.clientOperationId, {
    operationId: first.clientOperationId,
    status: "acked",
    authoritativeSequence: 6,
    resultVersions: first.resultVersions,
  });
  const checkpoint = withoutLocalOperations(undone.applied[1].state);
  delete checkpoint.structure.tombstones;

  await assert.rejects(
    () =>
      fixture.adapter.replaceAuthoritative(checkpoint, {
        baseOperationSequence: 5,
        recentOutcomes: undone.applied
          .slice(0, 2)
          .map(({ operation }, index) => recentOutcome(operation, index + 4)),
      }),
    /acknowledgement conflicts/i,
  );
  assert.equal(
    fixture.adapter.isOperationCheckpointAcknowledged(
      undone.applied[0].operation.clientOperationId,
      4,
    ),
    false,
  );
  assert.equal(fixture.adapter.getSnapshot().quarantine, null);
  fixture.adapter.dispose();
  fixture.document.destroy();
});

test("ignores exact compacted receipts outside the new checkpoint boundary", async () => {
  const compactedLayer = {
    ...stagingLayer,
    id: "79000000-0000-4000-8000-000000000900",
    name: "Previously committed layer",
    sortOrder: 3,
  };
  const fixture = await settledReceiptRecoveredDraft(compactedLayer);
  const replayBase = structuredClone(fixture.adapter.getSnapshot().state);
  delete replayBase.structure.layers[compactedLayer.id];
  const compacted = applyDrawingCommand(
    replayBase,
    {
      type: "mutate_structure",
      actorId: ids.actor,
      actions: [
        {
          kind: "put_layer",
          entity: compactedLayer,
          baseVersion: null,
        },
      ],
    },
    historyEnvironment(901),
  ).operation;
  fixture.adapter.appendDurableLocal(
    fixture.adapter.prepareRecordedLocal(compacted),
  );
  fixture.adapter.recordLocalAcknowledgement({
    clientOperationId: compacted.clientOperationId,
    authoritativeSequence: 1,
    resultVersions: compacted.resultVersions,
  });
  assert.equal(fixture.adapter.getSnapshot().quarantine, null);
  assert.ok(
    fixture.adapter
      .operations()
      .some(
        (operation) =>
          operation.clientOperationId === compacted.clientOperationId,
      ),
  );
  assert.ok(
    fixture.adapter
      .getSnapshot()
      .state.operations.every(
        (operation) =>
          operation.clientOperationId !== compacted.clientOperationId,
      ),
    "the old ACK is compacted outside recorded history",
  );

  const undone = undoDrawingCommandUnit(
    fixture.adapter.getSnapshot().state,
    ids.actor,
    historyEnvironment(600),
  );
  assert.ok(undone && !("kind" in undone), JSON.stringify(undone));
  for (const applied of undone.applied)
    await fixture.bridge.applyRecorded(applied);
  const checkpoint = withoutLocalOperations(undone.applied[0].state);
  delete checkpoint.structure.tombstones;
  const oldReceipt = recentOutcome(compacted, 1);
  await fixture.adapter.replaceAuthoritative(checkpoint, {
    baseOperationSequence: 4,
    recentOutcomes: [oldReceipt, recentOutcome(undone.applied[0].operation, 4)],
  });
  assert.equal(fixture.adapter.getSnapshot().quarantine, null);
  assert.deepEqual(
    fixture.adapter.getSnapshot().pendingOperationIds,
    undone.applied.slice(1).map(({ operation }) => operation.clientOperationId),
  );

  const before = structuredClone(fixture.adapter.getSnapshot());
  await assert.rejects(
    () =>
      fixture.adapter.replaceAuthoritative(checkpoint, {
        baseOperationSequence: 4,
        recentOutcomes: [{ ...oldReceipt, operationSha256: "f".repeat(64) }],
      }),
    /digest/i,
  );
  assert.deepEqual(fixture.adapter.getSnapshot(), before);
  fixture.adapter.dispose();
  fixture.document.destroy();
});

test("discards recovered DXF history when the authoritative graph changes", async () => {
  const { finalState, operations, states } = threePhasePlan();
  const canonicalReceipts = finalState.operations.map((operation, index) =>
    canonicalReceipt(operation, index + 1),
  );
  const authoritative = withoutLocalOperations(states[0]);
  const document = new Y.Doc();
  const localBaseMeta = initializeDrawingCollaborationDocument({
    document,
    projectId: ids.project,
    revisionId: ids.revision,
    baseSnapshotSha256: "b".repeat(64),
    baseOperationSequence: 1,
  });
  const adapter = createDrawingDraftAdapter({
    document,
    localBaseMeta,
    authoritativeState: authoritative,
    actorId: ids.actor,
    authorization: "editor",
    frozen: false,
    baseOperationSequence: 1,
  });
  const bridge = createDrawingCollaborationCommandBridge({
    adapter,
    outbox: { async enqueue() {} },
  });
  const prepared = await applyDrawingDxfImportOperations(
    adapter.getSnapshot().state,
    ids.actor,
    operations,
    canonicalReceipts.slice(0, 1),
  );
  bridge.hydrateCanonicalHistory(prepared.canonicalHistoryState);
  for (const [index, applied] of prepared.applied.entries()) {
    await bridge.applyRecorded(applied);
    adapter.recordLocalAcknowledgement({
      clientOperationId: applied.operation.clientOperationId,
      authoritativeSequence: index + 2,
      resultVersions: applied.operation.resultVersions,
    });
  }
  const changed = withoutLocalOperations(prepared.state);
  changed.structure.objects[ids.object].name = "Authoritative correction";
  changed.structure.objects[ids.object].version += 1;
  adapter.replaceAuthoritative(changed, { baseOperationSequence: 3 });

  assert.equal(
    adapter.getSnapshot().state.structure.objects[ids.object].name,
    "Authoritative correction",
  );
  assert.deepEqual(adapter.getSnapshot().state.operations, []);
  assert.deepEqual(adapter.getSnapshot().state.undoStackByActor, {});
  assert.deepEqual(adapter.getSnapshot().state.redoStackByActor, {});
  assert.equal(adapter.getSnapshot().quarantine, null);
  adapter.dispose();
  document.destroy();
});

test("does not preserve recovered DXF history around an unrelated pending edit", async () => {
  const { finalState, operations, states } = threePhasePlan();
  const canonicalReceipts = finalState.operations.map((operation, index) =>
    canonicalReceipt(operation, index + 1),
  );
  const unrelatedOperationId = "79000000-0000-4000-8000-000000000800";
  const unrelatedLayerId = "79000000-0000-4000-8000-000000000801";
  const authoritative = withoutLocalOperations(states[0]);
  const document = new Y.Doc();
  const localBaseMeta = initializeDrawingCollaborationDocument({
    document,
    projectId: ids.project,
    revisionId: ids.revision,
    baseSnapshotSha256: "b".repeat(64),
    baseOperationSequence: 1,
  });
  const adapter = createDrawingDraftAdapter({
    document,
    localBaseMeta,
    authoritativeState: authoritative,
    actorId: ids.actor,
    authorization: "editor",
    frozen: false,
    baseOperationSequence: 1,
    createId: () => unrelatedOperationId,
    now: () => "2026-09-02T12:00:00.000Z",
  });
  const bridge = createDrawingCollaborationCommandBridge({
    adapter,
    outbox: { async enqueue() {} },
  });
  const prepared = await applyDrawingDxfImportOperations(
    adapter.getSnapshot().state,
    ids.actor,
    operations,
    canonicalReceipts.slice(0, 1),
  );
  bridge.hydrateCanonicalHistory(prepared.canonicalHistoryState);
  for (const [index, applied] of prepared.applied.entries()) {
    await bridge.applyRecorded(applied);
    adapter.recordLocalAcknowledgement({
      clientOperationId: applied.operation.clientOperationId,
      authoritativeSequence: index + 2,
      resultVersions: applied.operation.resultVersions,
    });
  }
  await bridge.applyCommand({
    type: "mutate_structure",
    actorId: ids.actor,
    actions: [
      {
        kind: "put_layer",
        entity: {
          ...stagingLayer,
          id: unrelatedLayerId,
          name: "Pending unrelated layer",
          sortOrder: 2,
        },
        baseVersion: null,
      },
    ],
  });
  adapter.replaceAuthoritative(withoutLocalOperations(prepared.state), {
    baseOperationSequence: 3,
  });

  assert.equal(adapter.getSnapshot().quarantine, null);
  assert.deepEqual(adapter.getSnapshot().pendingOperationIds, [
    unrelatedOperationId,
  ]);
  assert.deepEqual(
    adapter
      .getSnapshot()
      .state.operations.map((operation) => operation.clientOperationId),
    [unrelatedOperationId],
  );
  assert.deepEqual(adapter.getSnapshot().state.undoStackByActor[ids.actor], [
    unrelatedOperationId,
  ]);
  assert.equal(
    adapter.getSnapshot().state.structure.layers[unrelatedLayerId].name,
    "Pending unrelated layer",
  );
  adapter.dispose();
  document.destroy();
});

test("classifies exact committed DXF plans after undo or redo without replaying original mutations", async () => {
  const { finalState, operations } = threePhasePlan();
  const canonicalReceipts = finalState.operations.map((operation, index) =>
    canonicalReceipt(operation, index + 1),
  );
  const undone = undoDrawingCommandUnit(
    finalState,
    ids.actor,
    historyEnvironment(400),
  );
  assert.ok(undone && !("kind" in undone), JSON.stringify(undone));
  const reloadedUndo = withoutLocalOperations(undone.state);
  delete reloadedUndo.structure.tombstones;

  const cancelled = await applyDrawingDxfImportOperations(
    reloadedUndo,
    ids.actor,
    operations,
    canonicalReceipts,
  );
  assert.equal(cancelled.canonicalDisposition, "reverted");
  assert.equal(cancelled.state, reloadedUndo);
  assert.deepEqual(cancelled.applied, []);
  assert.deepEqual(cancelled.alreadyMaterializedOperationIds, []);

  const redone = redoDrawingCommandUnit(
    undone.state,
    ids.actor,
    historyEnvironment(500),
  );
  assert.ok(redone && !("kind" in redone), JSON.stringify(redone));
  const reloadedRedo = withoutLocalOperations(redone.state);
  delete reloadedRedo.structure.tombstones;
  const advanced = await applyDrawingDxfImportOperations(
    reloadedRedo,
    ids.actor,
    operations,
    canonicalReceipts,
  );
  assert.equal(advanced.canonicalDisposition, "history_advanced");
  assert.equal(advanced.state, reloadedRedo);
  assert.deepEqual(advanced.applied, []);
  assert.deepEqual(
    advanced.alreadyMaterializedOperationIds,
    operations.map((operation) => operation.clientOperationId),
  );
});

test("rejects canonical DXF receipt authority mismatches before history hydration", async () => {
  const { finalState, operations, states } = threePhasePlan();
  const receipt = canonicalReceipt(finalState.operations[0], 7);
  const candidates = [
    ["actor", { ...receipt, actorId: ids.otherActor }],
    ["revision", { ...receipt, revisionId: ids.otherActor }],
    ["operation", { ...receipt, clientOperationId: ids.operation2 }],
    ["sequence", { ...receipt, sequence: 0 }],
    ["result", { ...receipt, resultVersions: { [ids.layer]: 99 } }],
    ["digest", { ...receipt, operationSha256: "f".repeat(64) }],
  ];

  for (const [name, candidate] of candidates)
    await assert.rejects(
      () =>
        applyDrawingDxfImportOperations(
          withoutLocalOperations(states[0]),
          ids.actor,
          operations,
          [candidate],
        ),
      /canonical receipt/i,
      name,
    );
});

test("rejects a DXF history member attached to another actor stack", async () => {
  const { finalState, operations } = threePhasePlan();
  const conflicted = structuredClone(finalState);
  conflicted.undoStackByActor[ids.otherActor] = [ids.operation1];
  conflicted.redoStackByActor[ids.otherActor] = [];

  await assert.rejects(
    () => applyDrawingDxfImportOperations(conflicted, ids.actor, operations),
    /history stack belongs to another actor/i,
  );
});

test("fails closed on a partial or different materialized DXF phase", async () => {
  const { operations, states } = threePhasePlan();
  const partial = withoutLocalOperations(states[0]);
  partial.objects[ids.object] = object;
  partial.structure.objects[ids.object] = object;
  await assert.rejects(
    () => applyDrawingDxfImportOperations(partial, ids.actor, operations),
    /partially materialized/i,
  );

  const different = withoutLocalOperations(states[1]);
  const changed = { ...object, name: "Changed after import" };
  different.objects[ids.object] = changed;
  different.structure.objects[ids.object] = changed;
  await assert.rejects(
    () => applyDrawingDxfImportOperations(different, ids.actor, operations),
    /existing|materialized|create/i,
  );
});

test("rejects adversarial DXF object/source compounds before recording", () => {
  const { operations } = threePhasePlan();
  const first = applyDrawingDxfImportOperation(
    initialState(),
    ids.actor,
    operations[0],
  );
  assert.equal(first.kind, "applied");
  const objectOperation = operations[1];
  const sourceAction = objectOperation.forward.actions[1];
  assert.equal(sourceAction.kind, "put_source");

  const candidates = [
    {
      label: "missing source",
      operation: {
        ...objectOperation,
        forward: {
          ...objectOperation.forward,
          actions: [objectOperation.forward.actions[0]],
        },
        inverse: {
          ...objectOperation.inverse,
          actions: [objectOperation.inverse.actions[1]],
        },
      },
    },
    {
      label: "source/object mismatch",
      operation: {
        ...objectOperation,
        forward: {
          ...objectOperation.forward,
          actions: [
            objectOperation.forward.actions[0],
            {
              ...sourceAction,
              entity: { ...sourceAction.entity, objectId: ids.workLayer },
            },
          ],
        },
      },
    },
    {
      label: "non-DXF source",
      operation: {
        ...objectOperation,
        forward: {
          ...objectOperation.forward,
          actions: [
            objectOperation.forward.actions[0],
            {
              ...sourceAction,
              entity: {
                id: ids.source,
                objectId: ids.object,
                revisionId: ids.revision,
                sourceFileId: ids.sourceFile,
                sourceSha256: "a".repeat(64),
                sourceKind: "pdf_region",
                pdfPageNumber: 1,
                x: 0,
                y: 0,
                width: 0.1,
                height: 0.1,
                version: 1,
              },
            },
          ],
        },
      },
    },
    {
      label: "geometry/entity mismatch",
      operation: {
        ...objectOperation,
        forward: {
          ...objectOperation.forward,
          actions: [
            objectOperation.forward.actions[0],
            {
              ...sourceAction,
              entity: { ...sourceAction.entity, entityType: "CIRCLE" },
            },
          ],
        },
      },
    },
  ];
  for (const candidate of candidates)
    assert.throws(
      () =>
        applyDrawingDxfImportOperation(
          first.applied.state,
          ids.actor,
          candidate.operation,
        ),
      /DXF import/i,
      candidate.label,
    );

  const unavailable = structuredClone(first.applied.state);
  const hiddenLayer = {
    ...unavailable.structure.layers[ids.layer],
    visible: false,
    locked: true,
  };
  unavailable.layers[ids.layer] = hiddenLayer;
  unavailable.structure.layers[ids.layer] = hiddenLayer;
  assert.throws(
    () =>
      applyDrawingDxfImportOperation(unavailable, ids.actor, objectOperation),
    /DXF import object\/source lineage pair is invalid/i,
  );
});

test("supports exact prefix resume and an exact whole-plan retry", async () => {
  const { operations } = threePhasePlan();
  const first = applyDrawingDxfImportOperation(
    initialState(),
    ids.actor,
    operations[0],
  );
  assert.equal(first.kind, "applied");

  const resumed = await applyDrawingDxfImportOperations(
    first.applied.state,
    ids.actor,
    operations,
  );
  assert.deepEqual(resumed.alreadyAppliedOperationIds, [ids.operation1]);
  assert.deepEqual(
    resumed.applied.map(({ operation }) => operation.clientOperationId),
    [ids.operation2, ids.operation3],
  );

  const retried = await applyDrawingDxfImportOperations(
    resumed.state,
    ids.actor,
    operations,
  );
  assert.deepEqual(retried.alreadyAppliedOperationIds, [
    ids.operation1,
    ids.operation2,
    ids.operation3,
  ]);
  assert.equal(retried.applied.length, 0);
  assert.equal(retried.state, resumed.state);
});

test("rejects a reused operation ID with a different envelope or actor", () => {
  const { operations } = threePhasePlan();
  const first = applyDrawingDxfImportOperation(
    initialState(),
    ids.actor,
    operations[0],
  );
  assert.equal(first.kind, "applied");
  const changed = {
    ...operations[0],
    createdAt: "2026-09-02T01:00:00.000Z",
  };

  assert.throws(
    () =>
      applyDrawingDxfImportOperation(first.applied.state, ids.actor, changed),
    /operation ID already exists with a different envelope/i,
  );
  assert.throws(
    () =>
      applyDrawingDxfImportOperation(
        first.applied.state,
        ids.otherActor,
        operations[0],
      ),
    /operation ID already exists with a different envelope/i,
  );
});

test("rejects non-exact, duplicate, and cross-revision plan input", async () => {
  const { operations } = threePhasePlan();
  assert.throws(
    () =>
      applyDrawingDxfImportOperation(initialState(), ids.actor, {
        ...operations[0],
        serverOnly: true,
      }),
    /not an exact DrawingOperationInput/i,
  );
  await assert.rejects(
    () =>
      applyDrawingDxfImportOperations(initialState(), ids.actor, [
        operations[0],
        operations[0],
      ]),
    /duplicate operation ID/i,
  );
  assert.throws(
    () =>
      applyDrawingDxfImportOperation(initialState(), ids.actor, {
        ...operations[0],
        revisionId: "79000000-0000-4000-8000-999999999999",
      }),
    /another revision/i,
  );
});
