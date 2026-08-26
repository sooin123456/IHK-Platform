import assert from "node:assert/strict";
import test from "node:test";

import * as Y from "yjs";

import {
  applyDrawingCommand,
  createDrawingDocumentState,
  redoDrawingCommand,
  undoDrawingCommand,
} from "../app/lukas/lib/drawing-commands.ts";
import {
  createDrawingCollaborationCommandBridge,
  reconcileDrawingCollaborationDraft,
} from "../app/lukas/lib/drawing-collaboration-client.ts";

const draftModule = await import("../app/lukas/lib/drawing-yjs-draft.ts").catch(
  () => null,
);
const persistenceModule = await import(
  "../app/lukas/lib/drawing-yjs-persistence.client.ts"
).catch(() => null);
const yjsModule = await import(
  "../app/lukas/lib/drawing-collaboration-yjs.ts"
).catch(() => null);

const ids = {
  project: "00000000-0000-4000-8000-000000000501",
  revision: "00000000-0000-4000-8000-000000000502",
  actorA: "00000000-0000-4000-8000-000000000503",
  actorB: "00000000-0000-4000-8000-000000000504",
  layer: "00000000-0000-4000-8000-000000000505",
  objectA: "00000000-0000-4000-8000-000000000506",
  objectB: "00000000-0000-4000-8000-000000000507",
  operationA: "00000000-0000-4000-8000-000000000508",
  operationB: "00000000-0000-4000-8000-000000000509",
  operationC: "00000000-0000-4000-8000-000000000510",
};

function requireModule() {
  assert.ok(draftModule, "drawing Yjs draft adapter must exist");
  return draftModule;
}

function requireYjsModule() {
  assert.ok(yjsModule, "drawing Yjs ledger reader must exist");
  return yjsModule;
}

function object(id, x = 0, name = id === ids.objectA ? "A" : "B") {
  return {
    id,
    name,
    layerId: ids.layer,
    geometry: {
      type: "rectangle",
      origin: { x, y: 0 },
      width: 10,
      height: 10,
      rotation: 0,
    },
    style: { stroke: "#111111", strokeWidth: 1, fill: null },
    version: 1,
  };
}

function baseState(objects = [object(ids.objectA), object(ids.objectB, 20)]) {
  return createDrawingDocumentState({
    revisionId: ids.revision,
    layers: [
      {
        id: ids.layer,
        name: "Work",
        visible: true,
        locked: false,
        systemKind: "work",
        version: 1,
      },
    ],
    objects,
  });
}

function initializedDoc() {
  const doc = new Y.Doc();
  doc.transact(() => {
    const meta = doc.getMap("serverMeta");
    meta.set("schemaVersion", 1);
    meta.set("projectId", ids.project);
    meta.set("revisionId", ids.revision);
    meta.set("baseSnapshotSha256", "a".repeat(64));
    meta.set("baseOperationSequence", 0);
    meta.set("freezeState", "active");
    meta.set("freezeRequestId", null);
    doc.getArray("operationOrder");
    doc.getArray("operations");
    doc.getMap("operationStatus");
  });
  return doc;
}

function recorded(
  state,
  command,
  operationId,
  createdAt = "2026-08-26T00:00:00.000Z",
) {
  const applied = applyDrawingCommand(state, command, {
    createId: () => operationId,
    now: () => createdAt,
  });
  const operation = applied.operation;
  return {
    state: applied.state,
    envelope: {
      clientOperationId: operation.clientOperationId,
      revisionId: operation.revisionId,
      actorId: operation.actorId,
      schemaVersion: 1,
      type: operation.type,
      baseVersions: operation.baseVersions,
      forward: operation.forward,
      inverse: operation.inverse,
      createdAt: operation.createdAt,
    },
  };
}

function append(doc, envelope) {
  doc.transact(() => {
    doc.getArray("operations").push([envelope]);
    doc.getArray("operationOrder").push([envelope.clientOperationId]);
  });
}

function status(doc, operationId, value) {
  doc.transact(() => doc.getMap("operationStatus").set(operationId, value));
}

function create(doc = initializedDoc(), options = {}) {
  const { createDrawingDraftAdapter } = requireModule();
  return createDrawingDraftAdapter({
    document: doc,
    authoritativeState: baseState(),
    actorId: ids.actorA,
    authorization: "editor",
    frozen: false,
    ...options,
  });
}

test("projects base plus validated operations and publishes once per Yjs transaction", () => {
  const doc = initializedDoc();
  const adapter = create(doc);
  let publications = 0;
  adapter.subscribe(() => publications++);
  const first = recorded(
    baseState(),
    {
      type: "update_objects",
      actorId: ids.actorA,
      updates: [{ objectId: ids.objectA, patch: { name: "A1" } }],
    },
    ids.operationA,
  );
  append(doc, first.envelope);
  assert.equal(publications, 1);
  assert.equal(adapter.getSnapshot().state.objects[ids.objectA].name, "A1");
  assert.deepEqual(adapter.getSnapshot().pendingOperationIds, [ids.operationA]);
});

test("concurrent different-object edits converge in opposite update arrival order", () => {
  const origin = initializedDoc();
  const left = new Y.Doc();
  const right = new Y.Doc();
  Y.applyUpdate(left, Y.encodeStateAsUpdate(origin));
  Y.applyUpdate(right, Y.encodeStateAsUpdate(origin));
  const a = recorded(
    baseState(),
    {
      type: "update_objects",
      actorId: ids.actorA,
      updates: [{ objectId: ids.objectA, patch: { name: "left" } }],
    },
    ids.operationA,
  ).envelope;
  const b = recorded(
    baseState(),
    {
      type: "update_objects",
      actorId: ids.actorB,
      updates: [{ objectId: ids.objectB, patch: { name: "right" } }],
    },
    ids.operationB,
  ).envelope;
  append(left, a);
  append(right, b);
  const leftDelta = Y.encodeStateAsUpdate(left, Y.encodeStateVector(origin));
  const rightDelta = Y.encodeStateAsUpdate(right, Y.encodeStateVector(origin));
  const mergedA = initializedDoc();
  const mergedB = initializedDoc();
  Y.applyUpdate(mergedA, leftDelta);
  Y.applyUpdate(mergedA, rightDelta);
  Y.applyUpdate(mergedB, rightDelta);
  Y.applyUpdate(mergedB, leftDelta);
  const snapshotA = create(mergedA).getSnapshot();
  const snapshotB = create(mergedB).getSnapshot();
  assert.deepEqual(snapshotA.state.objects, snapshotB.state.objects);
  assert.equal(snapshotA.state.objects[ids.objectA].name, "left");
  assert.equal(snapshotA.state.objects[ids.objectB].name, "right");
});

test("authoritative outcome selects a same-object winner without quarantining the room", () => {
  const doc = initializedDoc();
  const a = recorded(
    baseState(),
    {
      type: "update_objects",
      actorId: ids.actorA,
      updates: [{ objectId: ids.objectA, patch: { name: "loser" } }],
    },
    ids.operationA,
  ).envelope;
  const b = recorded(
    baseState(),
    {
      type: "update_objects",
      actorId: ids.actorB,
      updates: [{ objectId: ids.objectA, patch: { name: "winner" } }],
    },
    ids.operationB,
  ).envelope;
  append(doc, a);
  append(doc, b);
  const adapter = create(doc);
  assert.deepEqual(adapter.getSnapshot().provisionalConflictOperationIds, [
    ids.operationB,
  ]);
  assert.equal(adapter.getSnapshot().quarantine, null);
  const server = new Y.Doc();
  Y.applyUpdate(server, Y.encodeStateAsUpdate(doc));
  status(server, ids.operationA, {
    operationId: ids.operationA,
    status: "conflicted",
    authoritativeSequence: null,
    resultVersions: {},
  });
  status(server, ids.operationB, {
    operationId: ids.operationB,
    status: "acked",
    authoritativeSequence: 1,
    resultVersions: { [ids.objectA]: 2 },
  });
  adapter.applyServerProjection(
    Y.encodeStateAsUpdate(server, Y.encodeStateVector(doc)),
  );
  assert.equal(adapter.getSnapshot().state.objects[ids.objectA].name, "winner");
  assert.deepEqual(adapter.getSnapshot().conflictOperationIds, [
    ids.operationA,
  ]);
  assert.deepEqual(adapter.getSnapshot().provisionalConflictOperationIds, []);
});

test("keeps undo history actor-scoped and excludes acknowledged checkpoint operations", () => {
  const doc = initializedDoc();
  const a = recorded(
    baseState(),
    {
      type: "update_objects",
      actorId: ids.actorA,
      updates: [{ objectId: ids.objectA, patch: { name: "A1" } }],
    },
    ids.operationA,
  );
  const b = recorded(
    a.state,
    {
      type: "update_objects",
      actorId: ids.actorB,
      updates: [{ objectId: ids.objectB, patch: { name: "B1" } }],
    },
    ids.operationB,
  );
  append(doc, a.envelope);
  append(doc, b.envelope);
  const adapter = create(doc);
  assert.deepEqual(adapter.getSnapshot().state.undoStackByActor[ids.actorA], [
    ids.operationA,
  ]);
  assert.deepEqual(adapter.getSnapshot().state.undoStackByActor[ids.actorB], [
    ids.operationB,
  ]);
  const checkpoint = baseState([
    { ...object(ids.objectA), name: "A1", version: 2 },
    { ...object(ids.objectB, 20), name: "B1", version: 2 },
  ]);
  adapter.replaceAuthoritative(checkpoint, { baseOperationSequence: 2 });
  const server = new Y.Doc();
  Y.applyUpdate(server, Y.encodeStateAsUpdate(doc));
  status(server, ids.operationA, {
    operationId: ids.operationA,
    status: "acked",
    authoritativeSequence: 1,
    resultVersions: { [ids.objectA]: 2 },
  });
  status(server, ids.operationB, {
    operationId: ids.operationB,
    status: "acked",
    authoritativeSequence: 2,
    resultVersions: { [ids.objectB]: 2 },
  });
  adapter.applyServerProjection(
    Y.encodeStateAsUpdate(server, Y.encodeStateVector(doc)),
  );
  assert.equal(adapter.getSnapshot().state.operations.length, 0);
  assert.equal(adapter.getSnapshot().state.objects[ids.objectB].name, "B1");
});

test("prepareLocal is side-effect free and durable append is idempotent", () => {
  const doc = initializedDoc();
  let publications = 0;
  const adapter = create(doc, {
    createId: () => ids.operationA,
    now: () => "2026-08-26T00:00:00.000Z",
  });
  adapter.subscribe(() => publications++);
  const prepared = adapter.prepareLocal({
    type: "update_objects",
    actorId: ids.actorA,
    updates: [{ objectId: ids.objectA, patch: { name: "prepared" } }],
  });
  assert.equal(adapter.getSnapshot().state.objects[ids.objectA].name, "A");
  assert.equal(doc.getArray("operationOrder").length, 0);
  assert.equal(publications, 0);
  assert.equal(adapter.appendDurableLocal(prepared), true);
  assert.equal(adapter.appendDurableLocal(prepared), false);
  assert.equal(publications, 1);
  assert.equal(
    adapter.getSnapshot().state.objects[ids.objectA].name,
    "prepared",
  );
  assert.equal(doc.getArray("operationOrder").length, 1);
});

test("a durable new layer projects instead of becoming a provisional conflict", () => {
  const doc = initializedDoc();
  const adapter = create(doc);
  const layerId = "00000000-0000-4000-8000-000000000511";
  const prepared = adapter.prepareLocal({
    type: "add_layer",
    actorId: ids.actorA,
    layer: {
      id: layerId,
      name: "Realtime local edit",
      visible: true,
      locked: false,
      version: 1,
    },
  });
  adapter.appendDurableLocal(prepared);
  assert.equal(
    adapter.getSnapshot().state.layers[layerId].name,
    "Realtime local edit",
  );
  assert.deepEqual(adapter.getSnapshot().provisionalConflictOperationIds, []);
});

test("bridge normalizes recorded undo and redo while every local and remote transaction projects once", async () => {
  const doc = initializedDoc();
  let operationNumber = 0;
  let publications = 0;
  const adapter = create(doc, {
    createId: () =>
      [ids.operationA, ids.operationB, ids.operationC][operationNumber++],
  });
  adapter.subscribe(() => publications++);
  const queued = [];
  const bridge = createDrawingCollaborationCommandBridge({
    adapter,
    outbox: {
      async enqueue(value) {
        queued.push(value);
      },
    },
  });

  await bridge.applyCommand({
    type: "update_objects",
    actorId: ids.actorA,
    updates: [{ objectId: ids.objectA, patch: { name: "local" } }],
  });
  append(
    doc,
    recorded(
      adapter.getSnapshot().state,
      {
        type: "update_objects",
        actorId: ids.actorB,
        updates: [{ objectId: ids.objectB, patch: { name: "remote-1" } }],
      },
      "00000000-0000-4000-8000-000000000512",
    ).envelope,
  );
  const undone = undoDrawingCommand(adapter.getSnapshot().state, ids.actorA, {
    createId: () => ids.operationB,
    now: () => "2026-08-26T00:00:01.000Z",
  });
  assert.equal(undone?.operation.historyAction, "undo");
  await bridge.applyRecorded(undone);
  append(
    doc,
    recorded(
      adapter.getSnapshot().state,
      {
        type: "update_objects",
        actorId: ids.actorB,
        updates: [{ objectId: ids.objectB, patch: { name: "remote-2" } }],
      },
      "00000000-0000-4000-8000-000000000513",
    ).envelope,
  );
  const redone = redoDrawingCommand(adapter.getSnapshot().state, ids.actorA, {
    createId: () => ids.operationC,
    now: () => "2026-08-26T00:00:02.000Z",
  });
  assert.equal(redone?.operation.historyAction, "redo");
  await bridge.applyRecorded(redone);

  const snapshot = adapter.getSnapshot();
  assert.equal(snapshot.state.objects[ids.objectA].name, "local");
  assert.equal(snapshot.state.objects[ids.objectB].name, "remote-2");
  assert.deepEqual(snapshot.state.undoStackByActor[ids.actorA], [
    ids.operationA,
  ]);
  assert.deepEqual(snapshot.state.redoStackByActor[ids.actorA], []);
  assert.equal(publications, 5);
  const exactInputFields = [
    "baseVersions",
    "clientOperationId",
    "createdAt",
    "forward",
    "inverse",
    "historyAction",
    "originalOperationId",
    "revisionId",
    "type",
  ].sort();
  assert.equal(queued.length, 3);
  assert.deepEqual(Object.keys(queued[1]).sort(), exactInputFields);
  assert.deepEqual(Object.keys(queued[2]).sort(), exactInputFields);
});

test("persisted history reconstructs redo after reload and same-actor cross-tab sync", async () => {
  const doc = initializedDoc();
  let operationNumber = 0;
  const adapter = create(doc, {
    createId: () => [ids.operationA, ids.operationB][operationNumber++],
  });
  const bridge = createDrawingCollaborationCommandBridge({
    adapter,
    outbox: { async enqueue() {} },
  });
  await bridge.applyCommand({
    type: "update_objects",
    actorId: ids.actorA,
    updates: [{ objectId: ids.objectA, patch: { name: "local" } }],
  });
  append(
    doc,
    recorded(
      adapter.getSnapshot().state,
      {
        type: "update_objects",
        actorId: ids.actorB,
        updates: [{ objectId: ids.objectB, patch: { name: "remote" } }],
      },
      "00000000-0000-4000-8000-000000000512",
    ).envelope,
  );
  const undone = undoDrawingCommand(adapter.getSnapshot().state, ids.actorA, {
    createId: () => ids.operationB,
    now: () => "2026-08-26T00:00:01.000Z",
  });
  await bridge.applyRecorded(undone);

  const reloadedDoc = initializedDoc();
  Y.applyUpdate(reloadedDoc, Y.encodeStateAsUpdate(doc));
  let publications = 0;
  const reloaded = create(reloadedDoc, { createId: () => ids.operationC });
  reloaded.subscribe(() => publications++);
  assert.deepEqual(
    reloaded.getSnapshot().state.undoStackByActor[ids.actorA],
    [],
  );
  assert.deepEqual(reloaded.getSnapshot().state.redoStackByActor[ids.actorA], [
    ids.operationA,
  ]);
  assert.deepEqual(reloaded.getSnapshot().state.undoStackByActor[ids.actorB], [
    "00000000-0000-4000-8000-000000000512",
  ]);
  const redone = redoDrawingCommand(reloaded.getSnapshot().state, ids.actorA, {
    createId: () => ids.operationC,
    now: () => "2026-08-26T00:00:02.000Z",
  });
  assert.ok(redone);
  await createDrawingCollaborationCommandBridge({
    adapter: reloaded,
    outbox: { async enqueue() {} },
  }).applyRecorded(redone);
  assert.equal(reloaded.getSnapshot().state.objects[ids.objectA].name, "local");
  assert.deepEqual(reloaded.getSnapshot().state.undoStackByActor[ids.actorA], [
    ids.operationA,
  ]);
  assert.deepEqual(
    reloaded.getSnapshot().state.redoStackByActor[ids.actorA],
    [],
  );
  assert.equal(publications, 1);

  Y.applyUpdate(reloadedDoc, Y.encodeStateAsUpdate(doc));
  assert.deepEqual(reloaded.getSnapshot().state.undoStackByActor[ids.actorA], [
    ids.operationA,
  ]);
  assert.deepEqual(
    reloaded.getSnapshot().state.redoStackByActor[ids.actorA],
    [],
  );
  assert.equal(publications, 2, "each received transaction projects only once");
});

test("durable enqueue race appends a provisional conflict and boot repair terminates with the remote winner", async () => {
  const doc = initializedDoc();
  const adapter = create(doc, { createId: () => ids.operationA });
  let releaseEnqueue;
  let durableOperation;
  const enqueueStarted = new Promise((resolve) => {
    releaseEnqueue = resolve;
  });
  const bridge = createDrawingCollaborationCommandBridge({
    adapter,
    outbox: {
      async enqueue(value) {
        durableOperation = value;
        await enqueueStarted;
      },
    },
  });
  const local = bridge.applyCommand({
    type: "update_objects",
    actorId: ids.actorA,
    updates: [{ objectId: ids.objectA, patch: { name: "local" } }],
  });
  await Promise.resolve();
  const remote = recorded(
    baseState(),
    {
      type: "update_objects",
      actorId: ids.actorB,
      updates: [{ objectId: ids.objectA, patch: { name: "remote" } }],
    },
    ids.operationB,
  ).envelope;
  append(doc, remote);
  releaseEnqueue();
  await local;
  assert.equal(adapter.getSnapshot().state.objects[ids.objectA].name, "remote");
  assert.deepEqual(adapter.getSnapshot().provisionalConflictOperationIds, [
    ids.operationA,
  ]);

  const recoveredDoc = initializedDoc();
  append(recoveredDoc, remote);
  const recovered = create(recoveredDoc);
  await reconcileDrawingCollaborationDraft({
    actorId: ids.actorA,
    adapter: recovered,
    outbox: {
      async entries() {
        return [{ operation: durableOperation, status: "pending" }];
      },
      async enqueue() {},
      async markAcked() {},
    },
    recentOutcomes: [],
  });
  assert.equal(recovered.operations().at(-1).clientOperationId, ids.operationA);
  assert.equal(
    recovered.getSnapshot().state.objects[ids.objectA].name,
    "remote",
  );
  assert.deepEqual(recovered.getSnapshot().provisionalConflictOperationIds, [
    ids.operationA,
  ]);
});

test("authorization, freeze, and disposal stop mutation without authoring server status", () => {
  const doc = initializedDoc();
  const adapter = create(doc, { createId: () => ids.operationA });
  const alreadyDurable = adapter.prepareLocal({
    type: "update_objects",
    actorId: ids.actorA,
    updates: [
      { objectId: ids.objectA, patch: { name: "durable-before-downgrade" } },
    ],
  });
  adapter.setAuthorization("viewer");
  assert.throws(() =>
    adapter.prepareLocal({
      type: "update_objects",
      actorId: ids.actorA,
      updates: [{ objectId: ids.objectA, patch: { name: "blocked" } }],
    }),
  );
  assert.equal(adapter.appendDurableLocal(alreadyDurable), true);
  assert.equal(
    adapter.getSnapshot().state.objects[ids.objectA].name,
    "durable-before-downgrade",
  );
  append(
    doc,
    recorded(
      adapter.getSnapshot().state,
      {
        type: "update_objects",
        actorId: ids.actorB,
        updates: [{ objectId: ids.objectB, patch: { name: "observed" } }],
      },
      ids.operationB,
    ).envelope,
  );
  assert.equal(
    adapter.getSnapshot().state.objects[ids.objectB].name,
    "observed",
  );
  adapter.setAuthorization("editor");
  adapter.setFrozen(true);
  assert.throws(() =>
    adapter.prepareLocal({
      type: "update_objects",
      actorId: ids.actorA,
      updates: [{ objectId: ids.objectA, patch: { name: "frozen" } }],
    }),
  );
  assert.equal(doc.getMap("operationStatus").size, 0);
  adapter.dispose();
  assert.throws(() =>
    adapter.prepareLocal({
      type: "update_objects",
      actorId: ids.actorA,
      updates: [{ objectId: ids.objectA, patch: { name: "disposed" } }],
    }),
  );
});

test("a service-released failed review restores draft writability", () => {
  const doc = initializedDoc();
  const adapter = create(doc, { createId: () => ids.operationA });
  doc.getMap("serverMeta").set("freezeState", "released");
  doc.getMap("serverMeta").set("freezeRequestId", ids.operationB);
  assert.equal(adapter.getSnapshot().frozen, false);
  assert.doesNotThrow(() =>
    adapter.prepareLocal({
      type: "update_objects",
      actorId: ids.actorA,
      updates: [{ objectId: ids.objectA, patch: { name: "released" } }],
    }),
  );
});

test("malformed or oversized updates quarantine evidence and preserve the last projection", () => {
  const doc = initializedDoc();
  const adapter = create(doc);
  const before = structuredClone(adapter.getSnapshot().state);
  const malformed = new Y.Doc();
  Y.applyUpdate(malformed, Y.encodeStateAsUpdate(doc));
  append(malformed, { bad: true, clientOperationId: ids.operationA });
  assert.equal(
    adapter.applyServerProjection(
      Y.encodeStateAsUpdate(malformed, Y.encodeStateVector(doc)),
    ),
    false,
  );
  assert.deepEqual(adapter.getSnapshot().state, before);
  assert.match(adapter.getSnapshot().quarantine.message, /invalid|operation/i);
  assert.equal(doc.getArray("operationOrder").length, 0);

  const oversized = recorded(
    baseState(),
    {
      type: "update_objects",
      actorId: ids.actorA,
      updates: [{ objectId: ids.objectA, patch: { name: "valid" } }],
    },
    ids.operationB,
  ).envelope;
  oversized.forward = {
    type: "update_objects",
    updates: Array.from({ length: 256 }, () => ({
      objectId: ids.objectA,
      patch: { name: "x".repeat(255) },
    })),
  };
  oversized.inverse = {
    type: "update_objects",
    updates: Array.from({ length: 256 }, () => ({
      objectId: ids.objectA,
      patch: { name: "A" },
    })),
  };
  const oversizedDoc = initializedDoc();
  append(oversizedDoc, oversized);
  assert.equal(
    adapter.applyServerProjection(Y.encodeStateAsUpdate(oversizedDoc)),
    false,
  );
  assert.deepEqual(adapter.getSnapshot().state, before);
});

test("waits for local persistence before reporting sync", async () => {
  let release;
  const persistence = new Promise((resolve) => {
    release = resolve;
  });
  const adapter = create(initializedDoc(), {
    localPersistenceSynced: persistence,
  });
  let synced = false;
  const waiting = adapter.whenLocalPersistenceSynced().then(() => {
    synced = true;
  });
  await Promise.resolve();
  assert.equal(synced, false);
  release();
  await waiting;
  assert.equal(synced, true);
});

test("SSR never opens drawing IndexedDB", async () => {
  assert.ok(persistenceModule);
  assert.equal(
    await persistenceModule.openDrawingYjsPersistence({
      revisionId: ids.revision,
      document: {},
    }),
    null,
  );
});

test("rejects an authoritative result-version mismatch", () => {
  const doc = initializedDoc();
  const operation = recorded(
    baseState(),
    {
      type: "update_objects",
      actorId: ids.actorA,
      updates: [{ objectId: ids.objectA, patch: { name: "acked" } }],
    },
    ids.operationA,
  ).envelope;
  append(doc, operation);
  status(doc, ids.operationA, {
    operationId: ids.operationA,
    status: "acked",
    authoritativeSequence: 1,
    resultVersions: { [ids.objectA]: 99 },
  });
  const snapshot = create(doc).getSnapshot();
  assert.ok(snapshot.quarantine);
  assert.equal(snapshot.state.objects[ids.objectA].name, "A");
});

test("an invalid candidate cannot advance the accepted checkpoint boundary", () => {
  const live = initializedDoc();
  const adapter = create(live);
  const invalid = new Y.Doc();
  Y.applyUpdate(invalid, Y.encodeStateAsUpdate(live));
  invalid.getMap("serverMeta").set("baseOperationSequence", 99);
  append(invalid, { clientOperationId: ids.operationB, invalid: true });
  assert.equal(
    adapter.applyServerProjection(Y.encodeStateAsUpdate(invalid)),
    false,
  );

  const valid = new Y.Doc();
  Y.applyUpdate(valid, Y.encodeStateAsUpdate(live));
  const operation = recorded(
    baseState(),
    {
      type: "update_objects",
      actorId: ids.actorA,
      updates: [{ objectId: ids.objectA, patch: { name: "accepted" } }],
    },
    ids.operationA,
  ).envelope;
  append(valid, operation);
  status(valid, ids.operationA, {
    operationId: ids.operationA,
    status: "acked",
    authoritativeSequence: 1,
    resultVersions: { [ids.objectA]: 2 },
  });
  assert.equal(
    adapter.applyServerProjection(Y.encodeStateAsUpdate(valid)),
    true,
  );
  assert.equal(
    adapter.getSnapshot().state.objects[ids.objectA].name,
    "accepted",
  );
});

test("a forged inverse quarantines instead of becoming a provisional conflict", () => {
  const doc = initializedDoc();
  const operation = recorded(
    baseState(),
    {
      type: "update_objects",
      actorId: ids.actorA,
      updates: [{ objectId: ids.objectA, patch: { name: "forward" } }],
    },
    ids.operationA,
  ).envelope;
  operation.inverse = {
    type: "update_objects",
    updates: [{ objectId: ids.objectA, patch: { name: "forged" } }],
  };
  append(doc, operation);
  const snapshot = create(doc).getSnapshot();
  assert.ok(snapshot.quarantine);
  assert.deepEqual(snapshot.provisionalConflictOperationIds, []);
  assert.equal(snapshot.state.objects[ids.objectA].name, "A");
});

test("duplicate authoritative sequences quarantine the projection", () => {
  const doc = initializedDoc();
  const a = recorded(
    baseState(),
    {
      type: "update_objects",
      actorId: ids.actorA,
      updates: [{ objectId: ids.objectA, patch: { name: "A1" } }],
    },
    ids.operationA,
  ).envelope;
  const b = recorded(
    baseState(),
    {
      type: "update_objects",
      actorId: ids.actorB,
      updates: [{ objectId: ids.objectB, patch: { name: "B1" } }],
    },
    ids.operationB,
  ).envelope;
  append(doc, a);
  append(doc, b);
  for (const [operationId, objectId] of [
    [ids.operationA, ids.objectA],
    [ids.operationB, ids.objectB],
  ])
    status(doc, operationId, {
      operationId,
      status: "acked",
      authoritativeSequence: 1,
      resultVersions: { [objectId]: 2 },
    });
  assert.ok(create(doc).getSnapshot().quarantine);
});

test("same durable operation ID from two offline docs converges once in both arrival orders", () => {
  const base = initializedDoc();
  const baseUpdate = Y.encodeStateAsUpdate(base);
  const baseVector = Y.encodeStateVector(base);
  const first = new Y.Doc();
  const second = new Y.Doc();
  Y.applyUpdate(first, baseUpdate);
  Y.applyUpdate(second, baseUpdate);
  const operation = recorded(
    baseState(),
    {
      type: "update_objects",
      actorId: ids.actorA,
      updates: [{ objectId: ids.objectA, patch: { name: "recovered" } }],
    },
    ids.operationA,
  ).envelope;
  append(first, operation);
  append(second, structuredClone(operation));
  const firstDelta = Y.encodeStateAsUpdate(first, baseVector);
  const secondDelta = Y.encodeStateAsUpdate(second, baseVector);

  for (const updates of [
    [firstDelta, secondDelta],
    [secondDelta, firstDelta],
  ]) {
    const merged = initializedDoc();
    for (const update of updates) Y.applyUpdate(merged, update);
    const snapshot = create(merged).getSnapshot();
    assert.equal(snapshot.quarantine, null);
    assert.deepEqual(snapshot.pendingOperationIds, [ids.operationA]);
    assert.equal(snapshot.state.objects[ids.objectA].name, "recovered");
    assert.equal(snapshot.state.operations.length, 1);
  }
});

test("raw operation and order multiplicities must match before canonical dedupe", () => {
  const { readDrawingCollaborationLedger } = requireYjsModule();
  const operation = recorded(
    baseState(),
    {
      type: "update_objects",
      actorId: ids.actorA,
      updates: [{ objectId: ids.objectA, patch: { name: "paired" } }],
    },
    ids.operationA,
  ).envelope;
  for (const mutate of [
    (document) => document.getArray("operations").push([operation]),
    (document) => document.getArray("operationOrder").push([ids.operationA]),
  ]) {
    const document = initializedDoc();
    append(document, operation);
    mutate(document);
    assert.throws(() => readDrawingCollaborationLedger(document));
    assert.ok(create(document).getSnapshot().quarantine);
  }
});

test("same durable ID with any mismatched offline envelope quarantines in 100 CRDT orders", () => {
  const base = initializedDoc();
  const baseUpdate = Y.encodeStateAsUpdate(base);
  const baseVector = Y.encodeStateVector(base);
  const canonical = recorded(
    baseState(),
    {
      type: "update_objects",
      actorId: ids.actorA,
      updates: [{ objectId: ids.objectA, patch: { name: "canonical" } }],
    },
    ids.operationA,
  ).envelope;
  for (let trial = 0; trial < 100; trial++) {
    const mismatched =
      trial % 2
        ? {
            ...structuredClone(canonical),
            createdAt: "2026-08-26T00:00:01.000Z",
          }
        : {
            ...structuredClone(canonical),
            forward: {
              ...structuredClone(canonical.forward),
              updates: [
                {
                  ...structuredClone(canonical.forward.updates[0]),
                  patch: { name: `mismatch-${trial}` },
                },
              ],
            },
          };
    const first = new Y.Doc();
    const second = new Y.Doc();
    Y.applyUpdate(first, baseUpdate);
    Y.applyUpdate(second, baseUpdate);
    first.clientID = 10_000 + trial * 2;
    second.clientID = 10_001 + trial * 2;
    append(first, trial % 2 ? canonical : mismatched);
    append(second, trial % 2 ? mismatched : canonical);
    const merged = initializedDoc();
    for (const update of trial % 2
      ? [
          Y.encodeStateAsUpdate(first, baseVector),
          Y.encodeStateAsUpdate(second, baseVector),
        ]
      : [
          Y.encodeStateAsUpdate(second, baseVector),
          Y.encodeStateAsUpdate(first, baseVector),
        ])
      Y.applyUpdate(merged, update);
    assert.ok(create(merged).getSnapshot().quarantine, `trial ${trial}`);
  }
});

test("unknown top-level Yjs collections quarantine the client projection", () => {
  const doc = initializedDoc();
  doc.getMap("rogue").set("value", true);
  const snapshot = create(doc).getSnapshot();
  assert.ok(snapshot.quarantine);
  assert.equal(snapshot.state.objects[ids.objectA].name, "A");
});
