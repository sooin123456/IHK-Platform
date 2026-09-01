import assert from "node:assert/strict";
import test from "node:test";
import * as Y from "yjs";

import {
  createDrawingCollaborationCommandBridge,
  drawingCollaborationAuthority,
  drawingCollaborationLifecycleKey,
  drawingCollaborationPhaseForProviderStatus,
  drawingCollaborationProviderReady,
  openDrawingCollaborationLocalAttempt,
  reconcileDrawingCollaborationDraft,
  synchronizeDrawingCollaborationCheckpoint,
} from "../app/lukas/lib/drawing-collaboration-client.ts";
import {
  applyDrawingCommand,
  createDrawingDocumentState,
} from "../app/lukas/lib/drawing-commands.ts";
import { appendDrawingCollaborationOperation } from "../app/lukas/lib/drawing-collaboration-yjs.ts";
import { createDrawingDraftAdapter } from "../app/lukas/lib/drawing-yjs-draft.ts";
import { resolveDrawingOpening } from "../app/lukas/lib/drawing-semantic-geometry.ts";
import { normalizeDrawingCanonicalSources } from "../app/lukas/lib/drawing-workspace.types.ts";
import {
  deliverDrawingCollaborationOutcome,
  handleWorkspaceMutation,
  loadDrawingWorkspaceCollaborationBootstrap,
} from "../app/lukas/lib/drawing-workspace.server.ts";

const ids = {
  user: "00000000-0000-4000-8000-000000000601",
  other: "00000000-0000-4000-8000-000000000602",
  project: "00000000-0000-4000-8000-000000000603",
  revision: "00000000-0000-4000-8000-000000000604",
  operation: "00000000-0000-4000-8000-000000000605",
  object: "00000000-0000-4000-8000-000000000606",
  page: "00000000-0000-4000-8000-000000000607",
  canvas: "00000000-0000-4000-8000-000000000608",
  layer: "00000000-0000-4000-8000-000000000609",
  wall: "00000000-0000-4000-8000-000000000610",
  opening: "00000000-0000-4000-8000-000000000611",
  area: "00000000-0000-4000-8000-000000000612",
  semanticOperationA: "00000000-0000-4000-8000-000000000613",
  semanticOperationB: "00000000-0000-4000-8000-000000000614",
  propertyValue: "00000000-0000-4000-8000-000000000615",
};

const operation = {
  clientOperationId: ids.operation,
  revisionId: ids.revision,
  actorId: ids.user,
  schemaVersion: 1,
  type: "update_objects",
  baseVersions: { [ids.object]: 1 },
  forward: {
    type: "update_objects",
    updates: [{ objectId: ids.object, patch: { name: "After" } }],
  },
  inverse: {
    type: "update_objects",
    updates: [{ objectId: ids.object, patch: { name: "Before" } }],
  },
  createdAt: "2026-08-26T00:00:00.000Z",
};

function semanticState() {
  const wall = {
    id: ids.wall,
    name: "Wall",
    layerId: ids.layer,
    geometry: {
      type: "wall",
      semanticVersion: 1,
      start: { x: 0, y: 0 },
      end: { x: 1000, y: 0 },
      thicknessMillimeters: 200,
      heightMillimeters: 3000,
    },
    styleId: null,
    style: { stroke: "#111111", strokeWidth: 1, fill: null },
    version: 1,
  };
  const opening = {
    id: ids.opening,
    name: "D-01",
    layerId: ids.layer,
    geometry: {
      type: "opening",
      semanticVersion: 1,
      hostWallId: ids.wall,
      offsetMillimeters: 500,
      widthMillimeters: 100,
      heightMillimeters: 2100,
      sillHeightMillimeters: 0,
      openingKind: "door",
    },
    styleId: null,
    style: { stroke: "#111111", strokeWidth: 1, fill: null },
    version: 1,
  };
  const area = {
    id: ids.area,
    name: "Area",
    layerId: ids.layer,
    geometry: {
      type: "area",
      semanticVersion: 1,
      boundary: [
        { x: 0, y: 100 },
        { x: 100, y: 100 },
        { x: 100, y: 200 },
        { x: 0, y: 200 },
      ],
    },
    styleId: null,
    style: { stroke: "#111111", strokeWidth: 1, fill: "#eeeeee" },
    version: 1,
  };
  return createDrawingDocumentState({
    revisionId: ids.revision,
    structure: {
      pages: {
        [ids.page]: {
          id: ids.page,
          revisionId: ids.revision,
          name: "Plan",
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
          widthMillimeters: 1200,
          heightMillimeters: 800,
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
          canvasId: ids.canvas,
          sortOrder: 0,
          version: 1,
        },
      },
      objects: { [wall.id]: wall, [opening.id]: opening, [area.id]: area },
      styles: {},
      blocks: {},
      blockInstances: {},
      propertySchemas: {},
      propertyValues: {},
      tables: {},
    },
  });
}

function semanticDocument() {
  const document = new Y.Doc();
  document.transact(() => {
    const meta = document.getMap("serverMeta");
    meta.set("schemaVersion", 1);
    meta.set("projectId", ids.project);
    meta.set("revisionId", ids.revision);
    meta.set("baseSnapshotSha256", "a".repeat(64));
    meta.set("baseOperationSequence", 0);
    meta.set("freezeState", "active");
    meta.set("freezeRequestId", null);
    document.getArray("operationOrder");
    document.getArray("operations");
    document.getMap("operationStatus");
  });
  return document;
}

function semanticEnvelope(command, operationId, actorId) {
  const applied = applyDrawingCommand(
    semanticState(),
    { ...command, actorId },
    {
      createId: () => operationId,
      now: () => "2026-08-26T01:00:00.000Z",
    },
  );
  return {
    clientOperationId: operationId,
    revisionId: ids.revision,
    actorId,
    schemaVersion: 1,
    type: applied.operation.type,
    baseVersions: applied.operation.baseVersions,
    forward: applied.operation.forward,
    inverse: applied.operation.inverse,
    createdAt: applied.operation.createdAt,
  };
}

function semanticAdapter(document) {
  return createDrawingDraftAdapter({
    document,
    authoritativeState: semanticState(),
    actorId: ids.user,
    authorization: "editor",
    frozen: false,
  });
}

test("collaboration lifecycle identity uses only user, project, and revision IDs", () => {
  assert.equal(
    drawingCollaborationLifecycleKey(ids.user, ids.project, ids.revision),
    `${ids.user}\0${ids.project}\0${ids.revision}`,
  );
});

test("transactional bootstrap status and canWrite override a stale draft workspace row", () => {
  assert.deepEqual(
    drawingCollaborationAuthority({
      fallbackCapability: "editor",
      fallbackRevisionStatus: "draft",
      bootstrap: {
        capability: "editor",
        revisionStatus: "review_requested",
        canWrite: false,
      },
    }),
    {
      capability: "editor",
      revisionStatus: "review_requested",
      canWrite: false,
    },
  );
});

test("provider disconnect is visibly degraded and reconnect becomes connected", () => {
  assert.equal(
    drawingCollaborationPhaseForProviderStatus("disconnected"),
    "degraded",
  );
  assert.equal(
    drawingCollaborationPhaseForProviderStatus("connected"),
    "connected",
  );
  assert.equal(
    drawingCollaborationPhaseForProviderStatus("connecting"),
    "connecting",
  );
});

test("P4 concurrent semantic operations converge and preserve hosted opening projection", () => {
  const origin = semanticDocument();
  const left = new Y.Doc();
  const right = new Y.Doc();
  Y.applyUpdate(left, Y.encodeStateAsUpdate(origin));
  Y.applyUpdate(right, Y.encodeStateAsUpdate(origin));
  const wall = semanticState().objects[ids.wall];
  const wallEnvelope = semanticEnvelope(
    {
      type: "update_objects",
      updates: [
        {
          objectId: ids.wall,
          patch: {
            geometry: {
              ...wall.geometry,
              start: { x: 100, y: 0 },
              end: { x: 1100, y: 0 },
            },
          },
        },
      ],
    },
    ids.semanticOperationA,
    ids.user,
  );
  const areaEnvelope = semanticEnvelope(
    {
      type: "update_objects",
      updates: [{ objectId: ids.area, patch: { name: "Remote area" } }],
    },
    ids.semanticOperationB,
    ids.other,
  );
  appendDrawingCollaborationOperation(left, wallEnvelope);
  appendDrawingCollaborationOperation(right, areaEnvelope);
  const leftDelta = Y.encodeStateAsUpdate(left, Y.encodeStateVector(origin));
  const rightDelta = Y.encodeStateAsUpdate(right, Y.encodeStateVector(origin));

  const snapshots = [
    [leftDelta, rightDelta],
    [rightDelta, leftDelta],
  ].map((updates) => {
    const merged = semanticDocument();
    for (const update of updates) Y.applyUpdate(merged, update);
    return semanticAdapter(merged).getSnapshot();
  });
  assert.deepEqual(snapshots[0].state.objects, snapshots[1].state.objects);
  assert.equal(snapshots[0].state.objects[ids.area].name, "Remote area");
  assert.equal(
    snapshots[0].state.objects[ids.opening].geometry.hostWallId,
    ids.wall,
  );
  assert.deepEqual(
    resolveDrawingOpening(
      snapshots[0].state.objects[ids.opening].geometry,
      snapshots[0].state.objects,
    ).center,
    { x: 600, y: 0 },
  );
});

test("P4 concurrent same-wall edits use the existing version conflict path", () => {
  const document = semanticDocument();
  const wall = semanticState().objects[ids.wall];
  for (const [operationId, actorId, endX] of [
    [ids.semanticOperationA, ids.user, 900],
    [ids.semanticOperationB, ids.other, 800],
  ])
    appendDrawingCollaborationOperation(
      document,
      semanticEnvelope(
        {
          type: "update_objects",
          updates: [
            {
              objectId: ids.wall,
              patch: { geometry: { ...wall.geometry, end: { x: endX, y: 0 } } },
            },
          ],
        },
        operationId,
        actorId,
      ),
    );
  const snapshot = semanticAdapter(document).getSnapshot();
  assert.equal(snapshot.quarantine, null);
  assert.deepEqual(snapshot.provisionalConflictOperationIds, [
    ids.semanticOperationB,
  ]);
  assert.equal(snapshot.state.objects[ids.wall].geometry.end.x, 900);
  assert.equal(
    snapshot.state.objects[ids.opening].geometry.hostWallId,
    ids.wall,
  );
});

test("failed local initialization disposes each partial resource and a retry leaves one live attempt", async () => {
  const live = { documents: 0, persistence: 0, adapters: 0 };
  let attempt = 0;
  const open = () =>
    openDrawingCollaborationLocalAttempt({
      createDocument() {
        live.documents++;
        return {
          destroy() {
            live.documents--;
          },
        };
      },
      async openPersistence() {
        live.persistence++;
        return {
          async whenSynced() {},
          async dispose() {
            live.persistence--;
          },
        };
      },
      createAdapter() {
        live.adapters++;
        return {
          dispose() {
            live.adapters--;
          },
        };
      },
      async reconcile() {
        attempt++;
        if (attempt === 1) throw new Error("repair failed after adapter");
      },
    });

  await assert.rejects(open(), /repair failed after adapter/);
  assert.deepEqual(live, { documents: 0, persistence: 0, adapters: 0 });
  const recovered = await open();
  assert.deepEqual(live, { documents: 1, persistence: 1, adapters: 1 });
  await recovered.dispose();
  assert.deepEqual(live, { documents: 0, persistence: 0, adapters: 0 });
});

test("deferred local persistence installs one coherent checkpoint before edit and provider readiness", async () => {
  let releasePersistence;
  const persistenceSynced = new Promise((resolve) => {
    releasePersistence = resolve;
  });
  const oldCheckpoint = {
    key: "old",
    state: { name: "old graph" },
    sha256: "a".repeat(64),
    operationSequence: 3,
    recentOutcomes: ["old outcome"],
  };
  const newCheckpoint = {
    key: "new",
    state: { name: "new graph" },
    sha256: "b".repeat(64),
    operationSequence: 4,
    recentOutcomes: ["new outcome"],
  };
  const captured = oldCheckpoint;
  let latest = oldCheckpoint;
  const evidence = {
    adapterBases: [],
    localMeta: [],
    reconciled: [],
    replacements: [],
    editReady: false,
    providerConnected: false,
  };

  const opening = openDrawingCollaborationLocalAttempt({
    createDocument() {
      evidence.localMeta.push({
        sha256: captured.sha256,
        operationSequence: captured.operationSequence,
      });
      return { destroy() {} };
    },
    async openPersistence() {
      return {
        whenSynced: () => persistenceSynced,
        async dispose() {},
      };
    },
    createAdapter() {
      evidence.adapterBases.push(captured.state.name);
      return {
        replaceAuthoritative(state, options) {
          evidence.replacements.push({
            name: state.name,
            operationSequence: options.baseOperationSequence,
          });
        },
        dispose() {},
      };
    },
    async reconcile() {
      evidence.reconciled.push(...captured.recentOutcomes);
    },
  });

  latest = newCheckpoint;
  assert.equal(evidence.editReady, false);
  assert.equal(evidence.providerConnected, false);
  releasePersistence();
  const attempt = await opening;
  const installedKey = await synchronizeDrawingCollaborationCheckpoint({
    appliedKey: captured.key,
    getCurrentCheckpoint: () => latest,
    applyCheckpoint: async (checkpoint) => {
      attempt.adapter.replaceAuthoritative(checkpoint.state, {
        baseOperationSequence: checkpoint.operationSequence,
      });
      evidence.reconciled.push(...checkpoint.recentOutcomes);
    },
  });
  evidence.editReady = true;
  evidence.providerConnected = true;

  assert.equal(installedKey, "new");
  assert.deepEqual(evidence.localMeta, [
    { sha256: "a".repeat(64), operationSequence: 3 },
  ]);
  assert.deepEqual(evidence.adapterBases, ["old graph"]);
  assert.deepEqual(evidence.replacements, [
    { name: "new graph", operationSequence: 4 },
  ]);
  assert.deepEqual(evidence.reconciled, ["old outcome", "new outcome"]);
  assert.equal(evidence.editReady, true);
  assert.equal(evidence.providerConnected, true);
});

test("a source mark during deferred checkpoint sync cannot connect the provider", () => {
  let sourceReady = false;
  let checkpointInstalled = false;
  let providerConnections = 0;
  const connect = () => {
    if (
      drawingCollaborationProviderReady({
        sourceReady,
        checkpointInstalled,
      })
    )
      providerConnections += 1;
  };

  sourceReady = true;
  connect();
  assert.equal(providerConnections, 0);
  checkpointInstalled = true;
  connect();
  assert.equal(providerConnections, 1);
});

test("continuously advancing checkpoints terminate bounded and fail closed", async () => {
  let sequence = 0;
  let applies = 0;
  let providerConnections = 0;
  await assert.rejects(
    synchronizeDrawingCollaborationCheckpoint({
      appliedKey: "checkpoint-0",
      getCurrentCheckpoint: () => ({ key: `checkpoint-${++sequence}` }),
      applyCheckpoint: async () => {
        applies += 1;
        if (applies > 5) throw new Error("test detected an unbounded loop");
      },
      maxAttempts: 3,
    }),
    /checkpoint.*converge|convergence/i,
  );
  assert.equal(applies, 3);
  assert.equal(providerConnections, 0);
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(applies, 3, "failed convergence cannot leave late apply work");
});

test("a slow checkpoint apply completes atomically before readiness", async () => {
  let current = { key: "checkpoint-1" };
  const mutations = [];
  const installed = await synchronizeDrawingCollaborationCheckpoint({
    appliedKey: "checkpoint-0",
    getCurrentCheckpoint: () => current,
    applyCheckpoint: async (checkpoint) => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      mutations.push(checkpoint.key);
      current = checkpoint;
    },
    maxAttempts: 4,
  });

  assert.equal(installed, "checkpoint-1");
  assert.deepEqual(
    mutations,
    ["checkpoint-1"],
    "readiness waits for the one atomic apply instead of timing it out",
  );
});

test("adapter construction failure closes the already-open persistence and document", async () => {
  const live = { documents: 0, persistence: 0 };
  await assert.rejects(
    openDrawingCollaborationLocalAttempt({
      createDocument() {
        live.documents++;
        return {
          destroy() {
            live.documents--;
          },
        };
      },
      async openPersistence() {
        live.persistence++;
        return {
          async whenSynced() {},
          async dispose() {
            live.persistence--;
          },
        };
      },
      createAdapter() {
        throw new Error("adapter construction failed");
      },
      async reconcile() {},
    }),
    /adapter construction failed/,
  );
  assert.deepEqual(live, { documents: 0, persistence: 0 });
});

test("document cleanup still runs when persistence disposal itself fails", async () => {
  let documents = 0;
  await assert.rejects(
    openDrawingCollaborationLocalAttempt({
      createDocument() {
        documents++;
        return {
          destroy() {
            documents--;
          },
        };
      },
      async openPersistence() {
        return {
          async whenSynced() {},
          async dispose() {
            throw new Error("persistence close failed");
          },
        };
      },
      createAdapter() {
        throw new Error("adapter construction failed");
      },
      async reconcile() {},
    }),
    /persistence close failed/,
  );
  assert.equal(documents, 0);
});

test("command bridge persists before appending and only then exposes the provider update", async () => {
  const events = [];
  const prepared = { operation, state: { revisionId: ids.revision } };
  const bridge = createDrawingCollaborationCommandBridge({
    adapter: {
      prepareLocal() {
        events.push("prepare");
        return prepared;
      },
      appendDurableLocal(value) {
        assert.equal(value, prepared);
        events.push("append");
        return true;
      },
    },
    outbox: {
      async enqueue(value) {
        assert.equal(value.clientOperationId, ids.operation);
        events.push("outbox");
      },
    },
    afterAppend() {
      events.push("provider");
    },
  });

  await bridge.applyCommand({ type: "update_objects", actorId: ids.user });
  assert.deepEqual(events, ["prepare", "outbox", "append", "provider"]);
});

test("command bridge never publishes when durable enqueue fails", async () => {
  const events = [];
  const bridge = createDrawingCollaborationCommandBridge({
    adapter: {
      prepareLocal() {
        events.push("prepare");
        return { operation, state: { revisionId: ids.revision } };
      },
      appendDurableLocal() {
        events.push("append");
        return true;
      },
    },
    outbox: {
      async enqueue() {
        events.push("outbox");
        throw new Error("disk full");
      },
    },
    afterAppend() {
      events.push("provider");
    },
  });
  await assert.rejects(
    bridge.applyCommand({ type: "update_objects", actorId: ids.user }),
    /disk full/,
  );
  assert.deepEqual(events, ["prepare", "outbox"]);
});

test("boot repair pairs outbox-only and Yjs-only operations without duplicates", async () => {
  const events = [];
  const yjsOnly = { ...operation, clientOperationId: ids.other };
  const outboxOnly = {
    ...operation,
    actorId: undefined,
    schemaVersion: undefined,
  };
  delete outboxOnly.actorId;
  delete outboxOnly.schemaVersion;
  await reconcileDrawingCollaborationDraft({
    actorId: ids.user,
    adapter: {
      operations: () => [yjsOnly],
      preparePersistedLocal(value) {
        events.push(`prepare:${value.clientOperationId}`);
        return { operation: value, state: { revisionId: ids.revision } };
      },
      appendDurableLocal(value) {
        events.push(`append:${value.operation.clientOperationId}`);
        return true;
      },
    },
    outbox: {
      async entries() {
        return [{ operation: outboxOnly, status: "pending" }];
      },
      async enqueue(value) {
        events.push(`enqueue:${value.clientOperationId}`);
      },
      async markAcked() {},
    },
    recentOutcomes: [],
  });
  assert.deepEqual(events, [
    `prepare:${ids.operation}`,
    `append:${ids.operation}`,
    `enqueue:${ids.other}`,
  ]);
});

test("authoritative outcomes repair committed-unshared operations and clear the outbox", async () => {
  const events = [];
  await reconcileDrawingCollaborationDraft({
    actorId: ids.user,
    adapter: {
      operations: () => [],
      preparePersistedLocal(value) {
        events.push(`prepare:${value.clientOperationId}`);
        return { operation: value, state: { revisionId: ids.revision } };
      },
      appendDurableLocal(value) {
        events.push(`append:${value.operation.clientOperationId}`);
        return true;
      },
    },
    outbox: {
      async entries() {
        return [{ operation, status: "pending" }];
      },
      async enqueue() {
        throw new Error("must not duplicate");
      },
      async markAcked(id) {
        events.push(`acked:${id}`);
      },
    },
    recentOutcomes: [
      {
        revisionId: ids.revision,
        clientOperationId: ids.operation,
        actorId: ids.user,
        operationType: operation.type,
        baseVersions: operation.baseVersions,
        forward: operation.forward,
        inverse: operation.inverse,
        sequence: 7,
        resultVersions: {},
      },
    ],
  });
  assert.deepEqual(events, [
    `prepare:${ids.operation}`,
    `append:${ids.operation}`,
    `acked:${ids.operation}`,
  ]);
});

test("workspace collaboration bootstrap preserves deleted result tombstones", async () => {
  const calls = [];
  const deletedOutcome = {
    revisionId: ids.revision,
    clientOperationId: ids.operation,
    actorId: ids.user,
    operationType: "mutate_objects_with_references",
    baseVersions: { [ids.object]: 2, [ids.propertyValue]: 1 },
    forward: {},
    inverse: {},
    sequence: 7,
    resultVersions: { [ids.object]: null, [ids.propertyValue]: null },
  };
  const client = {
    async rpc(name, args) {
      calls.push([name, args]);
      return {
        data: {
          canonicalJson: {
            schemaVersion: 2,
            revision: {
              id: ids.revision,
              documentId: ids.other,
              projectId: ids.project,
              sequence: 1,
              version: 1,
            },
            sources: [],
            pages: [],
            canvases: [],
            layers: [],
            objects: [],
            styles: [],
            blocks: [],
            blockInstances: [],
            propertySchemas: [],
            propertyValues: [],
            tables: [],
            issues: [],
            operationSequence: 7,
          },
          operationSequence: 7,
          schemaVersion: 2,
          sha256: "a".repeat(64),
          revisionStatus: "draft",
          capability: "editor",
          canWrite: true,
          recentOutcomes: [deletedOutcome],
        },
        error: null,
      };
    },
  };
  const bootstrap = await loadDrawingWorkspaceCollaborationBootstrap(
    client,
    ids.revision,
  );
  assert.deepEqual(calls, [
    ["lukas_drawing_collaboration_bootstrap", { p_revision_id: ids.revision }],
  ]);
  assert.equal(bootstrap.operationSequence, 7);
  assert.equal(bootstrap.canonicalJson.revision.id, ids.revision);
  assert.deepEqual(bootstrap.recentOutcomes, [deletedOutcome]);
});

test("snapshot bootstrap sources are strict canonical evidence before client hydration", async () => {
  const canonicalSource = {
    id: "00000000-0000-4000-8000-000000000620",
    objectId: "00000000-0000-4000-8000-000000000621",
    revisionId: ids.revision,
    sourceFileId: "00000000-0000-4000-8000-000000000622",
    sourceSha256: "b".repeat(64),
    sourceKind: "pdf_region",
    pdfPageNumber: 1,
    x: 0.1,
    y: 0.2,
    width: 0.3,
    height: 0.4,
    version: 1,
  };
  const payload = (source) => ({
    canonicalJson: {
      schemaVersion: 2,
      revision: {
        id: ids.revision,
        documentId: ids.other,
        projectId: ids.project,
        sequence: 1,
        version: 1,
      },
      sources: [source],
      pages: [],
      canvases: [],
      layers: [],
      objects: [],
      styles: [],
      blocks: [],
      blockInstances: [],
      propertySchemas: [],
      propertyValues: [],
      tables: [],
      issues: [],
      operationSequence: 0,
    },
    operationSequence: 0,
    schemaVersion: 2,
    sha256: "a".repeat(64),
    revisionStatus: "approved",
    capability: "viewer",
    canWrite: false,
    recentOutcomes: [],
  });
  const client = (source) => ({
    async rpc() {
      return { data: payload(source), error: null };
    },
  });

  const loaded = await loadDrawingWorkspaceCollaborationBootstrap(
    client(canonicalSource),
    ids.revision,
  );
  assert.deepEqual(loaded.canonicalJson.sources, [canonicalSource]);
  await assert.rejects(
    loadDrawingWorkspaceCollaborationBootstrap(
      client({ ...canonicalSource, signedUrl: "https://example.invalid/file" }),
      ids.revision,
    ),
  );
});

test("trusted bootstrap and checkpoint boundaries canonicalize only the exact P4 source producer", async () => {
  const legacyPdf = {
    id: "00000000-0000-4000-8000-000000000623",
    objectId: "00000000-0000-4000-8000-000000000624",
    sourceFileId: "00000000-0000-4000-8000-000000000625",
    sourceSha256: "c".repeat(64),
    sourceKind: "pdf_region",
    pdfPageNumber: 2,
    x: 0.1,
    y: 0.2,
    width: 0.3,
    height: 0.4,
    elementId: null,
    ifcGlobalId: null,
    camera: null,
  };
  const legacyIfc = {
    id: "00000000-0000-4000-8000-000000000626",
    objectId: "00000000-0000-4000-8000-000000000627",
    sourceFileId: "00000000-0000-4000-8000-000000000628",
    sourceSha256: "d".repeat(64),
    sourceKind: "ifc_element",
    pdfPageNumber: null,
    x: null,
    y: null,
    width: null,
    height: null,
    elementId: "42",
    ifcGlobalId: "3ABCdefghijklmnopqrstu",
    camera: { position: [1, 2, 3], target: [4, 5, 6] },
  };
  const payload = (sources) => ({
    canonicalJson: {
      schemaVersion: 2,
      revision: {
        id: ids.revision,
        documentId: ids.other,
        projectId: ids.project,
        sequence: 1,
        version: 1,
      },
      sources,
      pages: [],
      canvases: [],
      layers: [],
      objects: [],
      styles: [],
      blocks: [],
      blockInstances: [],
      propertySchemas: [],
      propertyValues: [],
      tables: [],
      issues: [],
      operationSequence: 0,
    },
    operationSequence: 0,
    schemaVersion: 2,
    sha256: "e".repeat(64),
    revisionStatus: "approved",
    capability: "viewer",
    canWrite: false,
    recentOutcomes: [],
  });
  const load = (sources) =>
    loadDrawingWorkspaceCollaborationBootstrap(
      {
        async rpc() {
          return { data: payload(sources), error: null };
        },
      },
      ids.revision,
    );
  const loaded = await load([legacyPdf]);
  assert.deepEqual(loaded.canonicalJson.sources, [
    {
      id: legacyPdf.id,
      objectId: legacyPdf.objectId,
      revisionId: ids.revision,
      sourceFileId: legacyPdf.sourceFileId,
      sourceSha256: legacyPdf.sourceSha256,
      sourceKind: "pdf_region",
      pdfPageNumber: 2,
      x: 0.1,
      y: 0.2,
      width: 0.3,
      height: 0.4,
      version: 1,
    },
  ]);
  assert.deepEqual(
    normalizeDrawingCanonicalSources([legacyIfc], ids.revision),
    [
      {
        id: legacyIfc.id,
        objectId: legacyIfc.objectId,
        revisionId: ids.revision,
        sourceFileId: legacyIfc.sourceFileId,
        sourceSha256: legacyIfc.sourceSha256,
        sourceKind: "ifc_element",
        ifcGlobalId: legacyIfc.ifcGlobalId,
        elementId: "42",
        camera: legacyIfc.camera,
        version: 1,
      },
    ],
  );
  assert.throws(() =>
    normalizeDrawingCanonicalSources(
      [{ ...legacyPdf, ifcGlobalId: legacyIfc.ifcGlobalId }],
      ids.revision,
    ),
  );
  assert.throws(() =>
    normalizeDrawingCanonicalSources(
      [{ ...legacyPdf, signedUrl: "https://example.invalid/file" }],
      ids.revision,
    ),
  );
});

test("lost-receipt bootstrap reconstructs exact persisted undo lineage", async () => {
  let repaired;
  await reconcileDrawingCollaborationDraft({
    actorId: ids.user,
    adapter: {
      operations: () => [],
      preparePersistedLocal(value) {
        repaired = value;
        return { operation: value, state: { revisionId: ids.revision } };
      },
      appendDurableLocal() {
        return true;
      },
    },
    outbox: {
      async entries() {
        return [];
      },
      async enqueue() {},
      async markAcked() {},
    },
    recentOutcomes: [
      {
        revisionId: ids.revision,
        clientOperationId: ids.operation,
        actorId: ids.user,
        operationType: operation.type,
        baseVersions: operation.baseVersions,
        forward: operation.forward,
        inverse: operation.inverse,
        historyAction: "undo",
        originalOperationId: "00000000-0000-4000-8000-000000000099",
        sequence: 7,
        resultVersions: {},
      },
    ],
  });
  assert.equal(repaired.historyAction, "undo");
  assert.equal(
    repaired.originalOperationId,
    "00000000-0000-4000-8000-000000000099",
  );
});

test("React server signs one idempotent collaboration outcome receipt", async () => {
  const requests = [];
  const result = await deliverDrawingCollaborationOutcome({
    actorId: ids.user,
    projectId: ids.project,
    operation: {
      ...operation,
      actorId: undefined,
      schemaVersion: undefined,
    },
    outcome: "acked",
    authoritativeSequence: 7,
    resultVersions: { [ids.object]: 2 },
    environment: {
      COLLABORATION_INTERNAL_URL: "http://collaboration.internal",
      COLLABORATION_INTERNAL_SECRET: "s".repeat(32),
      COLLABORATION_FREEZE_SECRET: "f".repeat(32),
    },
    fetcher: async (url, init) => {
      requests.push([url, init]);
      return { ok: true, status: 204 };
    },
  });
  assert.equal(result, true);
  assert.equal(requests.length, 1);
  assert.equal(
    requests[0][0],
    "http://collaboration.internal/internal/outcomes",
  );
  assert.match(requests[0][1].headers["x-1hk-signature"], /^[0-9a-f]{64}$/);
  const body = JSON.parse(requests[0][1].body);
  assert.equal(body.receiptId, ids.operation);
  assert.equal(body.operation.actorId, ids.user);
  assert.equal(body.outcome, "acked");
  assert.equal(body.authoritativeSequence, 7);
});

test("an accepted RPC with a lost receipt remains retryable under the same operation ID", async () => {
  const form = new FormData();
  form.set("intent", "apply_operation");
  form.set(
    "operation_json",
    JSON.stringify({
      ...operation,
      actorId: undefined,
      schemaVersion: undefined,
    }),
  );
  const result = await handleWorkspaceMutation({
    client: {
      async rpc() {
        return {
          data: {
            operationId: ids.operation,
            sequence: 7,
            resultVersions: { [ids.object]: 2 },
          },
          error: null,
        };
      },
    },
    projectId: ids.project,
    capability: "editor",
    actorId: ids.user,
    workspace: {
      document: {
        revision: {
          id: ids.revision,
          status: "draft",
        },
      },
    },
    form,
    async deliverOutcome() {
      throw new Error("receipt connection reset");
    },
  });
  assert.equal(result.status, 503);
  assert.equal(result.body.kind, "retryable");
});
