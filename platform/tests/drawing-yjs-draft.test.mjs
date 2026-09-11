import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import * as Y from "yjs";

import {
  applyDrawingCommand,
  createDrawingDocumentState,
  deleteDrawingWallWithOpeningsCommand,
  redoDrawingCommand,
  undoDrawingCommand,
} from "../app/lukas/lib/drawing-commands.ts";
import {
  createDrawingCollaborationCommandBridge,
  initializeDrawingCollaborationDocument,
  reconcileDrawingCollaborationDraft,
} from "../app/lukas/lib/drawing-collaboration-client.ts";
import { drawingCollaborationOperationDigestSource } from "../app/lukas/lib/drawing-collaboration-protocol.ts";
import {
  createDrawingDocumentStore,
  hydrateDrawingDocumentState,
} from "../app/lukas/lib/drawing-document-store.ts";

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
  page: "00000000-0000-4000-8000-000000000511",
  canvas: "00000000-0000-4000-8000-000000000512",
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

function hostedState() {
  const wallId = ids.objectA;
  const openings = [
    {
      id: ids.objectB,
      name: "D",
      layerId: ids.layer,
      geometry: {
        type: "opening",
        semanticVersion: 1,
        hostWallId: wallId,
        offsetMillimeters: 300,
        widthMillimeters: 200,
        heightMillimeters: 2100,
        sillHeightMillimeters: 0,
        openingKind: "door",
      },
      style: { stroke: "#111111", strokeWidth: 2, fill: null },
      version: 1,
    },
    {
      id: ids.operationC,
      name: "W",
      layerId: ids.layer,
      geometry: {
        type: "opening",
        semanticVersion: 1,
        hostWallId: wallId,
        offsetMillimeters: 800,
        widthMillimeters: 200,
        heightMillimeters: 1200,
        sillHeightMillimeters: 900,
        openingKind: "window",
      },
      style: { stroke: "#111111", strokeWidth: 2, fill: null },
      version: 1,
    },
  ];
  const wall = {
    id: wallId,
    name: "Host",
    layerId: ids.layer,
    geometry: {
      type: "wall",
      semanticVersion: 1,
      start: { x: 0, y: 0 },
      end: { x: 1200, y: 0 },
      thicknessMillimeters: 200,
      heightMillimeters: 3000,
    },
    style: { stroke: "#111111", strokeWidth: 2, fill: null },
    version: 1,
  };
  const pageId = "00000000-0000-4000-8000-000000000520";
  const canvasId = "00000000-0000-4000-8000-000000000521";
  return createDrawingDocumentState({
    revisionId: ids.revision,
    structure: {
      pages: {
        [pageId]: {
          id: pageId,
          revisionId: ids.revision,
          name: "A1",
          sortOrder: 0,
          version: 1,
        },
      },
      canvases: {
        [canvasId]: {
          id: canvasId,
          pageId,
          name: "Paper",
          spaceKind: "paper",
          widthMillimeters: 210,
          heightMillimeters: 297,
          background: null,
          sortOrder: 0,
          version: 1,
        },
      },
      layers: {
        [ids.layer]: {
          id: ids.layer,
          name: "Work",
          visible: true,
          locked: false,
          systemKind: "work",
          canvasId,
          sortOrder: 0,
          version: 1,
        },
      },
      objects: Object.fromEntries(
        [wall, ...openings].map((value) => [value.id, value]),
      ),
      styles: {},
      blocks: {},
      blockInstances: {},
      propertySchemas: {},
      propertyValues: {},
      tables: {},
    },
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

function envelopeFromOperation(operation) {
  return {
    clientOperationId: operation.clientOperationId,
    revisionId: operation.revisionId,
    actorId: operation.actorId,
    schemaVersion: 1,
    type: operation.type,
    baseVersions: operation.baseVersions,
    forward: operation.forward,
    inverse: operation.inverse,
    createdAt: operation.createdAt,
    ...(operation.originalOperationId
      ? {
          originalOperationId: operation.originalOperationId,
          historyAction: operation.historyAction,
        }
      : {}),
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

function countAuthoritativeGraphClones(run) {
  const clone = globalThis.structuredClone;
  let count = 0;
  globalThis.structuredClone = (value, options) => {
    if (
      value?.revisionId === ids.revision &&
      value?.objects &&
      value?.layers &&
      Array.isArray(value?.operations)
    )
      count += 1;
    return clone(value, options);
  };
  try {
    run();
    return count;
  } finally {
    globalThis.structuredClone = clone;
  }
}

function validatedBaseProof() {
  const state = hydrateDrawingDocumentState({
    revisionId: ids.revision,
    pages: [
      {
        id: ids.page,
        revisionId: ids.revision,
        name: "A1",
        sortOrder: 0,
        version: 1,
      },
    ],
    canvases: [
      {
        id: ids.canvas,
        pageId: ids.page,
        name: "Paper",
        spaceKind: "paper",
        widthMillimeters: 210,
        heightMillimeters: 297,
        background: null,
        sortOrder: 0,
        version: 1,
      },
    ],
    layers: [
      {
        id: ids.layer,
        name: "Work",
        visible: true,
        locked: false,
        systemKind: "work",
        canvasId: ids.canvas,
        sortOrder: 0,
        version: 1,
      },
    ],
    objects: [object(ids.objectA), object(ids.objectB, 20)],
    sources: [],
    styles: [],
    blocks: [],
    blockInstances: [],
    propertySchemas: [],
    propertyValues: [],
    tables: [],
  });
  return {
    state,
    proof: createDrawingDocumentStore(state).getValidatedInitialState(),
  };
}

test("a fresh empty ledger clones its validated authoritative graph only once", () => {
  let adapter;
  const clones = countAuthoritativeGraphClones(() => {
    adapter = create();
  });

  assert.equal(adapter.getSnapshot().quarantine, null);
  assert.equal(clones, 1);
  adapter.dispose();
});

test("a fresh empty ledger reuses an immutable validated hydration without cloning", () => {
  const { state, proof } = validatedBaseProof();
  let adapter;
  const clones = countAuthoritativeGraphClones(() => {
    adapter = create(initializedDoc(), {
      authoritativeState: state,
      validatedAuthoritativeState: proof,
    });
  });

  assert.equal(clones, 0);
  assert.strictEqual(adapter.getSnapshot().state, state);
  assert.equal(adapter.getSnapshot().quarantine, null);
  adapter.dispose();
});

test("an immutable base proof does not weaken offline ledger replay validation", () => {
  const { state, proof } = validatedBaseProof();
  const doc = initializedDoc();
  const operation = recorded(
    state,
    {
      type: "update_objects",
      actorId: ids.actorA,
      updates: [{ objectId: ids.objectA, patch: { name: "Offline proof" } }],
    },
    ids.operationA,
  );
  append(doc, operation.envelope);
  let adapter;
  const clones = countAuthoritativeGraphClones(() => {
    adapter = create(doc, {
      authoritativeState: state,
      validatedAuthoritativeState: proof,
    });
  });

  assert.ok(clones >= 1);
  assert.equal(
    adapter.getSnapshot().state.objects[ids.objectA].name,
    "Offline proof",
  );
  assert.equal(adapter.getSnapshot().quarantine, null);
  adapter.dispose();
});

test("a fabricated authoritative proof is rejected", () => {
  const state = baseState();
  assert.throws(() =>
    create(initializedDoc(), {
      authoritativeState: state,
      validatedAuthoritativeState: { state },
    }),
  );
});

function nativeDwgHistoryFixture({ secondChunk = false } = {}) {
  const layerId = "00000000-0000-4000-8000-000000000520";
  const objectId = "00000000-0000-4000-8000-000000000521";
  const sourceId = "00000000-0000-4000-8000-000000000522";
  const sourceFileId = "00000000-0000-4000-8000-000000000523";
  const jobId = "00000000-0000-4000-8000-000000000524";
  const groupId = "00000000-0000-4000-8000-000000000525";
  const importedLayer = {
    id: layerId,
    name: "QA_GEOMETRY",
    visible: true,
    locked: false,
    systemKind: "custom",
    canvasId: ids.canvas,
    sortOrder: 1,
    version: 1,
  };
  const importedObject = {
    id: objectId,
    name: "DWG LINE 4A",
    layerId,
    geometry: {
      type: "line",
      start: { x: 0, y: 0 },
      end: { x: 100, y: 0 },
    },
    styleId: null,
    style: { stroke: "#111827", strokeWidth: 1, fill: null },
    version: 1,
  };
  const importedSource = {
    id: sourceId,
    objectId,
    revisionId: ids.revision,
    sourceFileId,
    sourceSha256: "b".repeat(64),
    sourceKind: "dwg_entity",
    analysisJobId: jobId,
    reportSha256: "c".repeat(64),
    handle: "4A",
    ownerHandle: "40",
    layerHandle: "48",
    entityType: "LINE",
    sourceLayer: "QA_GEOMETRY",
    unitCode: 4,
    unitSource: "declared",
    importerVersion: 1,
    version: 1,
  };
  const secondObject = {
    ...importedObject,
    id: "00000000-0000-4000-8000-000000000529",
    name: "DWG LINE 4B",
    geometry: {
      type: "line",
      start: { x: 0, y: 10 },
      end: { x: 100, y: 10 },
    },
  };
  const secondSource = {
    ...importedSource,
    id: "00000000-0000-4000-8000-000000000530",
    objectId: secondObject.id,
    handle: "4B",
  };
  let state = validatedBaseProof().state;
  const commands = [
    [{ kind: "put_layer", entity: importedLayer, baseVersion: null }],
    [
      { kind: "put_object", entity: importedObject, baseVersion: null },
      { kind: "put_source", entity: importedSource, baseVersion: null },
    ],
    ...(secondChunk
      ? [
          [
            { kind: "put_object", entity: secondObject, baseVersion: null },
            { kind: "put_source", entity: secondSource, baseVersion: null },
          ],
        ]
      : []),
    [
      {
        kind: "put_layer",
        entity: { ...importedLayer, locked: true },
        baseVersion: 1,
      },
    ],
  ];
  for (const [index, actions] of commands.entries())
    state = applyDrawingCommand(
      state,
      {
        type: "mutate_structure",
        actorId: ids.actorA,
        historyGroup: {
          id: groupId,
          kind: "dwg_import",
          index,
          count: commands.length,
        },
        actions,
      },
      {
        createId: () =>
          `00000000-0000-4000-8000-${String(526 + index).padStart(12, "0")}`,
        now: () => `2026-09-06T00:00:0${index}.000Z`,
      },
    ).state;
  return { state, sourceId, secondSource };
}

test("canonical Yjs history hydrates a homogeneous native DWG import group", () => {
  const { state, sourceId } = nativeDwgHistoryFixture();
  const compacted = {
    ...structuredClone(state),
    operations: [],
    undoStackByActor: {},
    redoStackByActor: {},
  };
  const adapter = create(initializedDoc(), { authoritativeState: compacted });

  assert.equal(adapter.hydrateCanonicalHistory(state), true);
  assert.deepEqual(
    adapter
      .getSnapshot()
      .state.operations.map((operation) => operation.forward.historyGroup.kind),
    ["dwg_import", "dwg_import", "dwg_import"],
  );
  assert.equal(
    adapter.getSnapshot().state.structure.sources[sourceId].sourceKind,
    "dwg_entity",
  );
  adapter.dispose();
});

test("canonical Yjs history rejects native sources labeled as a DXF import", () => {
  const { state } = nativeDwgHistoryFixture();
  const mislabeled = structuredClone(state);
  for (const operation of mislabeled.operations) {
    operation.forward.historyGroup.kind = "dxf_import";
    operation.inverse.historyGroup.kind = "dxf_import";
  }
  const compacted = {
    ...structuredClone(mislabeled),
    operations: [],
    undoStackByActor: {},
    redoStackByActor: {},
  };
  const adapter = create(initializedDoc(), { authoritativeState: compacted });

  assert.throws(
    () => adapter.hydrateCanonicalHistory(mislabeled),
    /canonical contract/i,
  );
  adapter.dispose();
});

test("canonical Yjs history rejects source kinds alternating across chunks", () => {
  const { state, secondSource } = nativeDwgHistoryFixture({
    secondChunk: true,
  });
  const mixed = structuredClone(state);
  const dxfSource = {
    id: secondSource.id,
    objectId: secondSource.objectId,
    revisionId: secondSource.revisionId,
    sourceFileId: secondSource.sourceFileId,
    sourceSha256: secondSource.sourceSha256,
    sourceKind: "dxf_entity",
    entityKey: "entities:1",
    entityType: "LINE",
    sourceLayer: secondSource.sourceLayer,
    handle: secondSource.handle,
    unitCode: secondSource.unitCode,
    unitSource: secondSource.unitSource,
    importerVersion: secondSource.importerVersion,
    version: 1,
  };
  mixed.structure.sources[dxfSource.id] = dxfSource;
  const mixedAction = mixed.operations[2].forward.actions.find(
    (action) => action.kind === "put_source",
  );
  mixedAction.entity = dxfSource;
  const compacted = {
    ...structuredClone(mixed),
    operations: [],
    undoStackByActor: {},
    redoStackByActor: {},
  };
  const adapter = create(initializedDoc(), { authoritativeState: compacted });

  assert.throws(
    () => adapter.hydrateCanonicalHistory(mixed),
    /canonical contract/i,
  );
  adapter.dispose();
});

test("an offline ledger keeps the replay clone and full projection validation path", () => {
  const doc = initializedDoc();
  const operation = recorded(
    baseState(),
    {
      type: "update_objects",
      actorId: ids.actorA,
      updates: [{ objectId: ids.objectA, patch: { name: "Offline" } }],
    },
    ids.operationA,
  );
  append(doc, operation.envelope);
  let adapter;
  const clones = countAuthoritativeGraphClones(() => {
    adapter = create(doc);
  });

  assert.ok(clones >= 2);
  assert.equal(adapter.getSnapshot().quarantine, null);
  assert.equal(
    adapter.getSnapshot().state.objects[ids.objectA].name,
    "Offline",
  );
  adapter.dispose();
});

test("a malformed authoritative base cannot enter the trusted projection path", () => {
  const malformed = baseState();
  malformed.objects[ids.objectA].geometry.width = 0;

  assert.throws(() =>
    create(initializedDoc(), { authoritativeState: malformed }),
  );
});

test("structured projections preserve canonical object and layer map identity", () => {
  let published = null;
  const adapter = create(initializedDoc(), {
    authoritativeState: hostedState(),
    replaceProjection: (state) => {
      published = state;
    },
  });

  const snapshot = adapter.getSnapshot();
  assert.equal(snapshot.quarantine, null);
  assert.equal(snapshot.state.objects, snapshot.state.structure.objects);
  assert.equal(snapshot.state.layers, snapshot.state.structure.layers);

  const prepared = adapter.prepareLocal({
    type: "add_objects",
    actorId: ids.actorA,
    objects: [object("00000000-0000-4000-8000-000000000522", 40)],
  });
  assert.equal(adapter.appendDurableLocal(prepared), true);
  assert.ok(published);
  assert.equal(published.objects, published.structure.objects);
  assert.equal(published.layers, published.structure.layers);
});

test("client bootstrap keeps base metadata local while an offline operation remains projectable", () => {
  const doc = new Y.Doc();
  const localBaseMeta = initializeDrawingCollaborationDocument({
    document: doc,
    projectId: ids.project,
    revisionId: ids.revision,
    baseSnapshotSha256: "a".repeat(64),
    baseOperationSequence: 0,
  });
  assert.deepEqual(doc.getMap("serverMeta").toJSON(), {});
  assert.deepEqual(doc.getMap("operationStatus").toJSON(), {});

  const adapter = create(doc, { localBaseMeta });
  const pending = recorded(
    baseState(),
    {
      type: "update_objects",
      actorId: ids.actorA,
      updates: [{ objectId: ids.objectA, patch: { name: "Offline" } }],
    },
    ids.operationA,
  );
  append(doc, pending.envelope);
  assert.equal(adapter.getSnapshot().quarantine, null);
  assert.deepEqual(adapter.getSnapshot().pendingOperationIds, [ids.operationA]);
  assert.equal(
    adapter.getSnapshot().state.objects[ids.objectA].name,
    "Offline",
  );
  assert.deepEqual(doc.getMap("serverMeta").toJSON(), {});
  adapter.dispose();
  doc.destroy();
});

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

test("authoritative deletion replays a null result without quarantining the room", () => {
  const doc = initializedDoc();
  const deleted = recorded(
    baseState(),
    {
      type: "delete_objects",
      actorId: ids.actorA,
      objectIds: [ids.objectA],
    },
    ids.operationA,
  );
  append(doc, deleted.envelope);
  status(doc, ids.operationA, {
    operationId: ids.operationA,
    status: "acked",
    authoritativeSequence: 1,
    resultVersions: { [ids.objectA]: null },
  });

  const snapshot = create(doc).getSnapshot();

  assert.equal(snapshot.quarantine, null);
  assert.equal(snapshot.state.objects[ids.objectA], undefined);
  assert.equal(snapshot.state.objects[ids.objectB].name, "B");
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

test("bridge durably projects atomic host and two-opening delete undo", async () => {
  const doc = initializedDoc();
  let operationNumber = 0;
  const operationIds = [
    "00000000-0000-4000-8000-000000000522",
    "00000000-0000-4000-8000-000000000523",
  ];
  const adapter = create(doc, {
    authoritativeState: hostedState(),
    createId: () => operationIds[operationNumber++],
  });
  const bridge = createDrawingCollaborationCommandBridge({
    adapter,
    outbox: { async enqueue() {} },
  });
  await bridge.applyCommand(
    deleteDrawingWallWithOpeningsCommand(
      adapter.getSnapshot().state,
      ids.actorA,
      ids.objectA,
    ),
  );
  assert.deepEqual(adapter.getSnapshot().state.objects, {});
  const undone = undoDrawingCommand(adapter.getSnapshot().state, ids.actorA);
  assert.ok(undone && !("kind" in undone));
  await bridge.applyRecorded(undone);
  assert.deepEqual(
    Object.keys(adapter.getSnapshot().state.objects).sort(),
    [ids.objectA, ids.objectB, ids.operationC].sort(),
  );
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

test("compacted acknowledged add and undo authorize a pending redo over a fresh snapshot", () => {
  const initial = baseState([]);
  const added = applyDrawingCommand(
    initial,
    {
      type: "add_objects",
      actorId: ids.actorA,
      objects: [object(ids.objectA)],
    },
    { createId: () => ids.operationA, now: () => "2026-08-27T03:00:00.000Z" },
  );
  const undone = undoDrawingCommand(added.state, ids.actorA, {
    createId: () => ids.operationB,
    now: () => "2026-08-27T03:01:00.000Z",
  });
  assert.ok(undone && !("kind" in undone));
  const redone = redoDrawingCommand(undone.state, ids.actorA, {
    createId: () => ids.operationC,
    now: () => "2026-08-27T03:02:00.000Z",
  });
  assert.ok(redone && !("kind" in redone));
  const doc = initializedDoc();
  doc.getMap("serverMeta").set("baseOperationSequence", 2);
  for (const candidate of [added.operation, undone.operation, redone.operation])
    append(doc, envelopeFromOperation(candidate));
  status(doc, ids.operationA, {
    operationId: ids.operationA,
    status: "acked",
    authoritativeSequence: 1,
    resultVersions: added.operation.resultVersions,
  });
  status(doc, ids.operationB, {
    operationId: ids.operationB,
    status: "acked",
    authoritativeSequence: 2,
    resultVersions: undone.operation.resultVersions,
  });

  const adapter = create(doc, {
    authoritativeState: initial,
    baseOperationSequence: 2,
  });
  const snapshot = adapter.getSnapshot();

  assert.equal(snapshot.quarantine, null);
  assert.deepEqual(snapshot.provisionalConflictOperationIds, []);
  assert.equal(snapshot.state.objects[ids.objectA].version, 3);
  assert.deepEqual(snapshot.state.undoStackByActor[ids.actorA], [
    ids.operationA,
  ]);
});

test("compacted redo stays provisional when its acknowledged result lineage is wrong", () => {
  const initial = baseState([]);
  const added = applyDrawingCommand(
    initial,
    {
      type: "add_objects",
      actorId: ids.actorA,
      objects: [object(ids.objectA)],
    },
    { createId: () => ids.operationA, now: () => "2026-08-27T03:10:00.000Z" },
  );
  const undone = undoDrawingCommand(added.state, ids.actorA, {
    createId: () => ids.operationB,
    now: () => "2026-08-27T03:11:00.000Z",
  });
  assert.ok(undone && !("kind" in undone));
  const redone = redoDrawingCommand(undone.state, ids.actorA, {
    createId: () => ids.operationC,
    now: () => "2026-08-27T03:12:00.000Z",
  });
  assert.ok(redone && !("kind" in redone));
  const doc = initializedDoc();
  doc.getMap("serverMeta").set("baseOperationSequence", 2);
  for (const candidate of [added.operation, undone.operation, redone.operation])
    append(doc, envelopeFromOperation(candidate));
  status(doc, ids.operationA, {
    operationId: ids.operationA,
    status: "acked",
    authoritativeSequence: 1,
    resultVersions: added.operation.resultVersions,
  });
  status(doc, ids.operationB, {
    operationId: ids.operationB,
    status: "acked",
    authoritativeSequence: 2,
    resultVersions: { [ids.objectA]: 3 },
  });

  const snapshot = create(doc, {
    authoritativeState: initial,
    baseOperationSequence: 2,
  }).getSnapshot();

  assert.equal(snapshot.quarantine, null);
  assert.deepEqual(snapshot.provisionalConflictOperationIds, [ids.operationC]);
  assert.equal(snapshot.state.objects[ids.objectA], undefined);
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
    revisionId: ids.revision,
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

test("HTTP-only canonical authority ignores a stale realtime freeze without weakening revision freeze", () => {
  const doc = initializedDoc();
  doc.getMap("serverMeta").set("freezeState", "frozen");
  doc.getMap("serverMeta").set("freezeRequestId", ids.operationB);

  const editable = create(doc, { enforceServerFreeze: false });
  assert.equal(editable.getSnapshot().frozen, false);
  assert.doesNotThrow(() =>
    editable.prepareLocal({
      type: "update_objects",
      actorId: ids.actorA,
      updates: [{ objectId: ids.objectA, patch: { name: "HTTP authority" } }],
    }),
  );
  editable.dispose();

  const reviewed = create(doc, {
    enforceServerFreeze: false,
    frozen: true,
  });
  assert.equal(reviewed.getSnapshot().frozen, true);
  assert.throws(() =>
    reviewed.prepareLocal({
      type: "update_objects",
      actorId: ids.actorA,
      updates: [{ objectId: ids.objectA, patch: { name: "still frozen" } }],
    }),
  );
  reviewed.dispose();
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

test("local persistence is isolated by owner and revision without opening legacy v1", () => {
  assert.ok(persistenceModule);
  assert.equal(
    persistenceModule.drawingYjsPersistenceName(ids.actorA, ids.revision),
    `1hk:drawing-draft:v2:${ids.actorA}:${ids.revision}`,
  );
  assert.equal(
    persistenceModule.drawingYjsPersistenceName(ids.actorB, ids.revision),
    `1hk:drawing-draft:v2:${ids.actorB}:${ids.revision}`,
  );
  assert.notEqual(
    persistenceModule.drawingYjsPersistenceName(ids.actorA, ids.revision),
    `1hk:drawing-draft:v1:${ids.revision}`,
  );
  assert.throws(
    () =>
      persistenceModule.drawingYjsPersistenceName("not-a-user", ids.revision),
    /canonical owner UUID/,
  );
});

test("SSR never opens drawing IndexedDB", async () => {
  assert.ok(persistenceModule);
  assert.equal(
    await persistenceModule.openDrawingYjsPersistence({
      ownerId: ids.actorA,
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

test("one recovery contribution does not consume the 10,000 unique operation capacity", () => {
  const { readDrawingCollaborationLedger } = requireYjsModule();
  const template = recorded(
    baseState(),
    {
      type: "update_objects",
      actorId: ids.actorA,
      updates: [{ objectId: ids.objectA, patch: { name: "capacity" } }],
    },
    ids.operationA,
  ).envelope;
  const operationIds = Array.from(
    { length: 10_000 },
    (_, index) =>
      `40000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
  );
  const document = initializedDoc();
  document.transact(() => {
    document.getArray("operations").push(
      operationIds.map((clientOperationId) => ({
        ...template,
        clientOperationId,
      })),
    );
    document.getArray("operationOrder").push(operationIds);
  });
  append(document, {
    ...template,
    clientOperationId: operationIds[0],
    createdAt: "1970-01-01T00:00:00.000Z",
  });

  const ledger = readDrawingCollaborationLedger(document);

  assert.equal(ledger.operationOrder.length, 10_000);
  assert.equal(
    ledger.operations[operationIds[0]].createdAt,
    template.createdAt,
  );
});

test("repeated identical recovery contributions converge to one operation", () => {
  const { readDrawingCollaborationLedger } = requireYjsModule();
  const original = recorded(
    baseState(),
    {
      type: "update_objects",
      actorId: ids.actorA,
      updates: [{ objectId: ids.objectA, patch: { name: "bounded" } }],
    },
    ids.operationA,
  ).envelope;
  const document = initializedDoc();
  append(document, original);
  append(document, {
    ...original,
    createdAt: "1970-01-01T00:00:00.000Z",
  });
  append(document, structuredClone(original));

  const ledger = readDrawingCollaborationLedger(document);

  assert.deepEqual(ledger.operationOrder, [ids.operationA]);
  assert.deepEqual(ledger.operations[ids.operationA], original);
  const snapshot = create(document).getSnapshot();
  assert.equal(snapshot.quarantine, null);
  assert.deepEqual(snapshot.pendingOperationIds, [ids.operationA]);
});

test("local HTTP acknowledgement overlays projection without authoring protected server status", () => {
  const document = initializedDoc();
  const envelope = recorded(
    baseState(),
    {
      type: "update_objects",
      actorId: ids.actorA,
      updates: [{ objectId: ids.objectA, patch: { name: "HTTP ACK" } }],
    },
    ids.operationA,
  ).envelope;
  append(document, envelope);
  const adapter = create(document, { baseOperationSequence: 6 });

  adapter.recordLocalAcknowledgement({
    clientOperationId: ids.operationA,
    authoritativeSequence: 7,
    resultVersions: { [ids.objectA]: 2 },
  });

  assert.equal(
    adapter.getSnapshot().state.objects[ids.objectA].name,
    "HTTP ACK",
  );
  assert.deepEqual(adapter.getSnapshot().pendingOperationIds, []);
  assert.equal(
    adapter.isOperationCheckpointAcknowledged(ids.operationA, 6),
    false,
  );
  assert.equal(
    adapter.isOperationCheckpointAcknowledged(ids.operationA, 7),
    true,
  );
  assert.deepEqual(document.getMap("operationStatus").toJSON(), {});
  adapter.dispose();
  document.destroy();
});

test("server-verified acknowledgement supersedes only a stale pending status", () => {
  const document = initializedDoc();
  const envelope = recorded(
    baseState(),
    {
      type: "update_objects",
      actorId: ids.actorA,
      updates: [{ objectId: ids.objectA, patch: { name: "Recovered ACK" } }],
    },
    ids.operationA,
  ).envelope;
  append(document, envelope);
  status(document, ids.operationA, {
    operationId: ids.operationA,
    status: "pending",
    authoritativeSequence: null,
    resultVersions: {},
  });
  const adapter = create(document, { baseOperationSequence: 6 });
  const acknowledgement = {
    clientOperationId: ids.operationA,
    authoritativeSequence: 7,
    resultVersions: { [ids.objectA]: 2 },
  };

  assert.throws(() => adapter.recordLocalAcknowledgement(acknowledgement));
  assert.equal(
    adapter.recordLocalAcknowledgement(acknowledgement, "canonical"),
    true,
  );
  assert.equal(
    adapter.getSnapshot().state.objects[ids.objectA].name,
    "Recovered ACK",
  );
  assert.deepEqual(adapter.getSnapshot().pendingOperationIds, []);
  assert.equal(adapter.operationStatus(ids.operationA).status, "acked");
  assert.equal(
    document.getMap("operationStatus").get(ids.operationA).status,
    "pending",
  );

  adapter.dispose();
  document.destroy();
});

test("server-verified acknowledgement cannot replace an immutable server ACK", () => {
  const document = initializedDoc();
  const envelope = recorded(
    baseState(),
    {
      type: "update_objects",
      actorId: ids.actorA,
      updates: [{ objectId: ids.objectA, patch: { name: "Immutable ACK" } }],
    },
    ids.operationA,
  ).envelope;
  append(document, envelope);
  status(document, ids.operationA, {
    operationId: ids.operationA,
    status: "acked",
    authoritativeSequence: 8,
    resultVersions: { [ids.objectA]: 2 },
  });
  const adapter = create(document, { baseOperationSequence: 6 });

  assert.throws(
    () =>
      adapter.recordLocalAcknowledgement(
        {
          clientOperationId: ids.operationA,
          authoritativeSequence: 7,
          resultVersions: { [ids.objectA]: 2 },
        },
        "canonical",
      ),
    /conflicts with server status/,
  );

  adapter.dispose();
  document.destroy();
});

test("a canonical checkpoint absorbs stale ACK evidence without rewriting server status", () => {
  const document = initializedDoc();
  const envelope = recorded(
    baseState(),
    {
      type: "update_objects",
      actorId: ids.actorA,
      updates: [{ objectId: ids.objectA, patch: { name: "Absorbed ACK" } }],
    },
    ids.operationA,
  ).envelope;
  append(document, envelope);
  status(document, ids.operationA, {
    operationId: ids.operationA,
    status: "acked",
    authoritativeSequence: 8,
    resultVersions: { [ids.objectA]: 2 },
  });
  const adapter = create(document, { baseOperationSequence: 8 });

  assert.equal(
    adapter.recordLocalAcknowledgement(
      {
        clientOperationId: ids.operationA,
        authoritativeSequence: 7,
        resultVersions: { [ids.objectA]: 2 },
      },
      "canonical",
    ),
    false,
  );
  assert.deepEqual(adapter.operationStatus(ids.operationA), {
    operationId: ids.operationA,
    status: "acked",
    authoritativeSequence: 8,
    resultVersions: { [ids.objectA]: 2 },
  });
  assert.equal(adapter.getSnapshot().quarantine, null);

  adapter.dispose();
  document.destroy();
});

test("checkpoint absorption survives later canonical receipt revalidation", async () => {
  const document = initializedDoc();
  const applied = recorded(
    baseState(),
    {
      type: "update_objects",
      actorId: ids.actorA,
      updates: [{ objectId: ids.objectA, patch: { name: "Late server ACK" } }],
    },
    ids.operationA,
  );
  append(document, applied.envelope);
  const adapter = create(document, { baseOperationSequence: 8 });
  adapter.recordLocalAcknowledgement(
    {
      clientOperationId: ids.operationA,
      authoritativeSequence: 7,
      resultVersions: { [ids.objectA]: 2 },
    },
    "canonical",
  );
  const server = new Y.Doc();
  Y.applyUpdate(server, Y.encodeStateAsUpdate(document));
  status(server, ids.operationA, {
    operationId: ids.operationA,
    status: "acked",
    authoritativeSequence: 8,
    resultVersions: { [ids.objectA]: 2 },
  });

  assert.equal(
    adapter.applyServerProjection(
      Y.encodeStateAsUpdate(server, Y.encodeStateVector(document)),
    ),
    true,
  );
  assert.equal(adapter.getSnapshot().quarantine, null);
  assert.deepEqual(adapter.operationStatus(ids.operationA), {
    operationId: ids.operationA,
    status: "acked",
    authoritativeSequence: 8,
    resultVersions: { [ids.objectA]: 2 },
  });

  await adapter.replaceAuthoritative(applied.state, {
    baseOperationSequence: 9,
    recentOutcomes: [
      {
        revisionId: ids.revision,
        clientOperationId: ids.operationA,
        actorId: ids.actorA,
        sequence: 7,
        resultVersions: { [ids.objectA]: 2 },
        operationSha256: createHash("sha256")
          .update(
            drawingCollaborationOperationDigestSource(
              applied.envelope,
              ids.actorA,
            ),
          )
          .digest("hex"),
      },
    ],
  });
  assert.equal(adapter.getSnapshot().quarantine, null);
  assert.deepEqual(adapter.operationStatus(ids.operationA), {
    operationId: ids.operationA,
    status: "acked",
    authoritativeSequence: 8,
    resultVersions: { [ids.objectA]: 2 },
  });
  assert.deepEqual(document.getMap("operationStatus").get(ids.operationA), {
    operationId: ids.operationA,
    status: "acked",
    authoritativeSequence: 8,
    resultVersions: { [ids.objectA]: 2 },
  });
  assert.equal(
    adapter.getSnapshot().state.objects[ids.objectA].version,
    2,
    "the absorbed receipt must not replay the operation over its checkpoint",
  );

  adapter.dispose();
  server.destroy();
  document.destroy();
});

test("checkpoint revalidation rejects a mismatched server ACK beyond the captured boundary", async () => {
  const document = initializedDoc();
  const applied = recorded(
    baseState(),
    {
      type: "update_objects",
      actorId: ids.actorA,
      updates: [{ objectId: ids.objectA, patch: { name: "Ahead ACK" } }],
    },
    ids.operationA,
  );
  append(document, applied.envelope);
  status(document, ids.operationA, {
    operationId: ids.operationA,
    status: "acked",
    authoritativeSequence: 9,
    resultVersions: { [ids.objectA]: 2 },
  });
  const adapter = create(document, { baseOperationSequence: 8 });
  const recentOutcome = {
    revisionId: ids.revision,
    clientOperationId: ids.operationA,
    actorId: ids.actorA,
    sequence: 7,
    resultVersions: { [ids.objectA]: 2 },
    operationSha256: createHash("sha256")
      .update(
        drawingCollaborationOperationDigestSource(applied.envelope, ids.actorA),
      )
      .digest("hex"),
  };

  await assert.rejects(
    () =>
      adapter.replaceAuthoritative(applied.state, {
        baseOperationSequence: 9,
        recentOutcomes: [recentOutcome],
      }),
    /acknowledgement conflicts/i,
  );
  assert.equal(
    adapter.operationStatus(ids.operationA).authoritativeSequence,
    9,
  );
  assert.equal(adapter.getSnapshot().quarantine, null);

  adapter.dispose();
  document.destroy();
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
