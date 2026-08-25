import assert from "node:assert/strict";
import test from "node:test";

import * as Y from "yjs";

import {
  applyDrawingCommand,
  createDrawingDocumentState,
} from "../app/lukas/lib/drawing-commands.ts";

const draftModule = await import("../app/lukas/lib/drawing-yjs-draft.ts").catch(
  () => null,
);
const persistenceModule = await import(
  "../app/lukas/lib/drawing-yjs-persistence.client.ts"
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
    doc.getMap("operations");
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
    doc.getMap("operations").set(envelope.clientOperationId, envelope);
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

test("authorization, freeze, and disposal stop mutation without authoring server status", () => {
  const doc = initializedDoc();
  const adapter = create(doc, { createId: () => ids.operationA });
  adapter.setAuthorization("viewer");
  assert.throws(() =>
    adapter.prepareLocal({
      type: "update_objects",
      actorId: ids.actorA,
      updates: [{ objectId: ids.objectA, patch: { name: "blocked" } }],
    }),
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
