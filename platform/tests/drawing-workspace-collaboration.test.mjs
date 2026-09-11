import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import * as Y from "yjs";

import {
  createDrawingCollaborationCommandBridge,
  drawingCollaborationAuthority,
  drawingCollaborationLifecycleKey,
  drawingCollaborationPhaseForProviderStatus,
  drawingCollaborationProviderReady,
  drawingCollaborationRecentOutcomesKey,
  openDrawingCollaborationLocalAttempt,
  reconcileDrawingCollaborationDraft,
  synchronizeDrawingCollaborationCheckpoint,
} from "../app/lukas/lib/drawing-collaboration-client.ts";
import {
  applyDrawingCommand,
  createDrawingDocumentState,
} from "../app/lukas/lib/drawing-commands.ts";
import {
  DRAWING_COLLABORATION_LIMITS,
  DrawingCollaborationOperationSchema,
} from "../app/lukas/lib/drawing-collaboration-protocol.ts";
import {
  appendDrawingCollaborationOperation,
  readDrawingCollaborationLedger,
} from "../app/lukas/lib/drawing-collaboration-yjs.ts";
import { createDrawingOutbox } from "../app/lukas/lib/drawing-outbox.ts";
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

test("collaboration append publishes its envelope and order atomically", () => {
  const local = new Y.Doc();
  const remote = new Y.Doc();
  let updateCount = 0;
  local.on("update", (update) => {
    updateCount += 1;
    Y.applyUpdate(remote, update);
    assert.doesNotThrow(() => readDrawingCollaborationLedger(remote));
  });

  appendDrawingCollaborationOperation(local, operation);

  assert.equal(updateCount, 1);
  assert.deepEqual(readDrawingCollaborationLedger(remote).operationOrder, [
    operation.clientOperationId,
  ]);
  local.destroy();
  remote.destroy();
});

function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value))
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
    .join(",")}}`;
}

function outcomeOperationSha256(outcome) {
  return createHash("sha256")
    .update(
      canonicalJson({
        actorId: outcome.actorId,
        baseVersions: outcome.baseVersions,
        clientOperationId: outcome.clientOperationId,
        forward: outcome.forward,
        ...(outcome.historyAction
          ? {
              historyAction: outcome.historyAction,
              originalOperationId: outcome.originalOperationId,
            }
          : {}),
        inverse: outcome.inverse,
        revisionId: outcome.revisionId,
        schemaVersion: 1,
        type: outcome.operationType,
      }),
    )
    .digest("hex");
}

function localOperationSha256(input, actorId = input.actorId) {
  return outcomeOperationSha256({
    actorId,
    baseVersions: input.baseVersions,
    clientOperationId: input.clientOperationId,
    forward: input.forward,
    ...(input.historyAction
      ? {
          historyAction: input.historyAction,
          originalOperationId: input.originalOperationId,
        }
      : {}),
    inverse: input.inverse,
    operationType: input.type,
    revisionId: input.revisionId,
  });
}

function oversizedSnapshotOutcome() {
  const objects = Array.from({ length: 250 }, (_, index) => ({
    id: `10000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    name: `Snapshot import ${index} ${"x".repeat(120)}`,
    layerId: ids.layer,
    geometry: {
      type: "line",
      start: { x: index, y: index },
      end: { x: index + 1, y: index + 1 },
    },
    style: { stroke: "#2563eb", strokeWidth: 2, fill: null },
    version: 1,
  }));
  const outcome = {
    revisionId: ids.revision,
    clientOperationId: ids.operation,
    actorId: ids.user,
    operationType: "add_objects",
    baseVersions: {},
    forward: { type: "add_objects", objects },
    inverse: {
      type: "delete_objects",
      objectIds: objects.map(({ id }) => id),
    },
    sequence: 7,
    resultVersions: {},
  };
  return { ...outcome, operationSha256: outcomeOperationSha256(outcome) };
}

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

test("authoritative checkpoint identity includes exact receipt digest and result versions", () => {
  const receipt = {
    revisionId: ids.revision,
    clientOperationId: ids.operation,
    actorId: ids.user,
    sequence: 7,
    resultVersions: { [ids.object]: 2, [ids.layer]: null },
    operationSha256: "a".repeat(64),
  };
  const key = drawingCollaborationRecentOutcomesKey([receipt]);
  assert.equal(
    key,
    drawingCollaborationRecentOutcomesKey([
      {
        ...receipt,
        resultVersions: { [ids.layer]: null, [ids.object]: 2 },
      },
    ]),
    "JSON property insertion order is not authoritative",
  );
  assert.notEqual(
    key,
    drawingCollaborationRecentOutcomesKey([
      { ...receipt, operationSha256: "b".repeat(64) },
    ]),
  );
  assert.notEqual(
    key,
    drawingCollaborationRecentOutcomesKey([{ ...receipt, actorId: ids.other }]),
  );
  assert.notEqual(
    key,
    drawingCollaborationRecentOutcomesKey([
      { ...receipt, resultVersions: { [ids.object]: 3, [ids.layer]: null } },
    ]),
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

test("provider transport status stays connecting until room synchronization", () => {
  assert.equal(
    drawingCollaborationPhaseForProviderStatus("disconnected"),
    "degraded",
  );
  assert.equal(
    drawingCollaborationPhaseForProviderStatus("connected"),
    "connecting",
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
            recentOutcomes: options.recentOutcomes,
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
      await attempt.adapter.replaceAuthoritative(checkpoint.state, {
        baseOperationSequence: checkpoint.operationSequence,
        recentOutcomes: checkpoint.recentOutcomes,
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
    {
      name: "new graph",
      operationSequence: 4,
      recentOutcomes: ["new outcome"],
    },
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
    revisionId: ids.revision,
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

test("boot repair keeps a recovery claim only after the Yjs append is durable", async () => {
  const events = [];
  const operations = [];
  let claimed = false;
  const outboxOnly = {
    ...operation,
    actorId: undefined,
    schemaVersion: undefined,
  };
  delete outboxOnly.actorId;
  delete outboxOnly.schemaVersion;
  const outbox = {
    async entries() {
      return [{ operation: outboxOnly, status: "pending" }];
    },
    async enqueue() {},
    async markAcked() {},
    async recoverOperation(_id, recover) {
      if (claimed) return false;
      claimed = true;
      events.push("claim");
      try {
        await recover();
        return true;
      } catch (error) {
        claimed = false;
        events.push("release");
        throw error;
      }
    },
  };
  const adapter = {
    operations: () => operations,
    preparePersistedLocal(value) {
      events.push("prepare");
      return { operation: value, state: { revisionId: ids.revision } };
    },
    appendDurableLocal(prepared) {
      const existing = operations.find(
        (candidate) =>
          candidate.clientOperationId === prepared.operation.clientOperationId,
      );
      if (existing) {
        assert.deepEqual(existing, prepared.operation);
        events.push("append-existing");
        return false;
      }
      operations.push(prepared.operation);
      events.push("append");
      return true;
    },
  };

  await assert.rejects(
    reconcileDrawingCollaborationDraft({
      actorId: ids.user,
      revisionId: ids.revision,
      adapter,
      outbox,
      recentOutcomes: [],
      async commitRecoveredOperation() {
        events.push("flush-failed");
        throw new Error("IndexedDB flush failed");
      },
    }),
    /IndexedDB flush failed/,
  );
  assert.deepEqual(events, [
    "claim",
    "prepare",
    "append",
    "flush-failed",
    "release",
  ]);

  events.length = 0;
  await reconcileDrawingCollaborationDraft({
    actorId: ids.user,
    revisionId: ids.revision,
    adapter,
    outbox,
    recentOutcomes: [],
    async commitRecoveredOperation() {
      events.push("flush-committed");
    },
  });
  assert.deepEqual(events, [
    "claim",
    "prepare",
    "append-existing",
    "flush-committed",
  ]);
});

test("authoritative outcomes repair committed-unshared operations and clear the outbox", async () => {
  const events = [];
  const acknowledgements = [];
  const tombstones = [];
  await reconcileDrawingCollaborationDraft({
    actorId: ids.user,
    revisionId: ids.revision,
    baseOperationSequence: 7,
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
      recordLocalAcknowledgement(value, authority) {
        assert.equal(authority, "canonical");
        acknowledgements.push(value);
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
      async markAcked(id, evidence) {
        events.push(`acked:${id}`);
        tombstones.push(evidence);
      },
    },
    recentOutcomes: [
      {
        revisionId: ids.revision,
        clientOperationId: ids.operation,
        actorId: ids.user,
        sequence: 7,
        resultVersions: {},
        operationSha256: localOperationSha256(operation),
      },
    ],
    async commitRecoveredOperation() {
      events.push("flush-recovered");
    },
  });
  assert.deepEqual(events, [
    `prepare:${ids.operation}`,
    `append:${ids.operation}`,
    "flush-recovered",
    `acked:${ids.operation}`,
  ]);
  assert.deepEqual(acknowledgements, [
    {
      clientOperationId: ids.operation,
      authoritativeSequence: 7,
      resultVersions: {},
    },
  ]);
  assert.deepEqual(tombstones, [
    {
      clientOperationId: ids.operation,
      authoritativeSequence: 7,
      resultVersions: {},
      operation,
    },
  ]);
});

test("a recovered canonical receipt persists its ACK tombstone across reload", async () => {
  const records = new Map();
  let enqueueSequence = 0;
  const storage = {
    async claimLegacy() {
      return 0;
    },
    async delete(id) {
      records.delete(id);
    },
    async enqueue(entry) {
      const stored = { ...entry, enqueueSequence: ++enqueueSequence };
      records.set(entry.operation.clientOperationId, structuredClone(stored));
      return structuredClone(stored);
    },
    async list() {
      return structuredClone([...records.values()]);
    },
    async put(entry) {
      records.set(entry.operation.clientOperationId, structuredClone(entry));
    },
  };
  const outboxOptions = {
    ownerId: ids.user,
    revisionId: ids.revision,
    broadcastChannelFactory: () => null,
  };
  const first = createDrawingOutbox(storage, outboxOptions);
  const {
    actorId: _actorId,
    schemaVersion: _schemaVersion,
    ...queued
  } = operation;
  await first.enqueue(queued);
  const localOperations = [];
  const localAcknowledgements = [];
  const adapter = {
    operations: () => localOperations,
    preparePersistedLocal(value) {
      return {
        operation: DrawingCollaborationOperationSchema.parse({
          ...value,
          actorId: ids.user,
          schemaVersion: 1,
        }),
        state: { revisionId: ids.revision },
      };
    },
    appendDurableLocal(prepared) {
      localOperations.push(prepared.operation);
      return true;
    },
    recordLocalAcknowledgement(acknowledgement, authority) {
      assert.equal(authority, "canonical");
      localAcknowledgements.push(acknowledgement);
      return true;
    },
  };
  const receipt = {
    revisionId: ids.revision,
    clientOperationId: ids.operation,
    actorId: ids.user,
    sequence: 7,
    resultVersions: {},
    operationSha256: localOperationSha256(operation),
  };

  await reconcileDrawingCollaborationDraft({
    actorId: ids.user,
    revisionId: ids.revision,
    baseOperationSequence: 7,
    adapter,
    outbox: first,
    recentOutcomes: [receipt],
  });
  assert.deepEqual(await first.acknowledgements(), [
    {
      clientOperationId: ids.operation,
      authoritativeSequence: 7,
      resultVersions: {},
      operation: queued,
    },
  ]);
  first.dispose();

  const reloaded = createDrawingOutbox(storage, outboxOptions);
  await reconcileDrawingCollaborationDraft({
    actorId: ids.user,
    revisionId: ids.revision,
    baseOperationSequence: 7,
    adapter,
    outbox: reloaded,
    recentOutcomes: [receipt],
  });
  assert.deepEqual(await reloaded.entries(), []);
  assert.equal((await reloaded.acknowledgements()).length, 1);
  assert.deepEqual(localAcknowledgements, [
    {
      clientOperationId: ids.operation,
      authoritativeSequence: 7,
      resultVersions: {},
    },
    {
      clientOperationId: ids.operation,
      authoritativeSequence: 7,
      resultVersions: {},
      operation: queued,
    },
  ]);
  for (const invalid of [
    { ...receipt, resultVersions: { [ids.object]: 3 } },
    { ...receipt, operationSha256: "f".repeat(64) },
  ])
    await assert.rejects(
      reconcileDrawingCollaborationDraft({
        actorId: ids.user,
        revisionId: ids.revision,
        baseOperationSequence: 7,
        adapter,
        outbox: reloaded,
        recentOutcomes: [invalid],
      }),
      /durable acknowledgement|operation digest/i,
    );
  assert.equal((await reloaded.acknowledgements()).length, 1);
  reloaded.dispose();
});

test("snapshot-only oversized outcomes do not enter the bounded local Yjs ledger", async () => {
  const outcome = oversizedSnapshotOutcome();
  const envelope = {
    clientOperationId: outcome.clientOperationId,
    revisionId: outcome.revisionId,
    actorId: outcome.actorId,
    schemaVersion: 1,
    type: outcome.operationType,
    baseVersions: outcome.baseVersions,
    forward: outcome.forward,
    inverse: outcome.inverse,
    createdAt: "1970-01-01T00:00:00.000Z",
  };
  assert.ok(
    new TextEncoder().encode(JSON.stringify(envelope)).byteLength >
      DRAWING_COLLABORATION_LIMITS.maxOperationBytes,
  );
  assert.equal(
    DrawingCollaborationOperationSchema.safeParse(envelope).success,
    false,
  );
  const events = [];

  await reconcileDrawingCollaborationDraft({
    actorId: ids.user,
    revisionId: ids.revision,
    baseOperationSequence: 7,
    adapter: {
      operations: () => [],
      preparePersistedLocal() {
        events.push("prepared");
        throw new Error("snapshot-only outcome entered the local ledger");
      },
      appendDurableLocal() {
        events.push("appended");
        return true;
      },
    },
    outbox: {
      async entries() {
        return [];
      },
      async enqueue() {},
      async markAcked(id) {
        events.push(`acked:${id}`);
      },
    },
    recentOutcomes: [outcome],
  });

  assert.deepEqual(events, [`acked:${ids.operation}`]);
});

test("snapshot-absorbed accepted history is acknowledged without replaying valid operations", async () => {
  const outcomes = Array.from({ length: 100 }, (_, index) => ({
    revisionId: ids.revision,
    clientOperationId: `30000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    actorId: ids.user,
    sequence: index + 1,
    resultVersions: {},
    operationSha256: "a".repeat(64),
  }));
  const acknowledged = [];

  await reconcileDrawingCollaborationDraft({
    actorId: ids.user,
    revisionId: ids.revision,
    baseOperationSequence: outcomes.length,
    adapter: {
      operations: () => [],
      preparePersistedLocal() {
        throw new Error("snapshot history must not be replayed into local Yjs");
      },
      appendDurableLocal() {
        throw new Error("snapshot history must not mutate local Yjs");
      },
    },
    outbox: {
      async entries() {
        return [];
      },
      async enqueue() {},
      async markAcked(id) {
        acknowledged.push(id);
      },
    },
    recentOutcomes: outcomes,
  });

  assert.deepEqual(
    acknowledged,
    outcomes.map(({ clientOperationId }) => clientOperationId),
  );
});

test("draft reconciliation rejects malformed checkpoint receipts before local repair", async () => {
  const first = {
    revisionId: ids.revision,
    clientOperationId: ids.operation,
    actorId: ids.user,
    sequence: 6,
    resultVersions: {},
    operationSha256: "a".repeat(64),
  };
  const second = {
    ...first,
    clientOperationId: ids.other,
    sequence: 7,
  };
  const cases = [
    [{ ...first, operationSha256: "A".repeat(64) }],
    [{ ...first, operationSha256: undefined }],
    [{ ...first, actorId: "not-an-actor" }],
    [{ ...first, revisionId: ids.other }],
    [first, { ...second, clientOperationId: first.clientOperationId }],
    [first, { ...second, sequence: first.sequence }],
    [second, first],
    [{ ...first, sequence: 8 }],
  ];

  for (const recentOutcomes of cases) {
    let reads = 0;
    await assert.rejects(
      reconcileDrawingCollaborationDraft({
        actorId: ids.user,
        revisionId: ids.revision,
        baseOperationSequence: 7,
        adapter: {
          operations: () => [],
          preparePersistedLocal() {
            throw new Error("invalid receipts must not repair local Yjs");
          },
          appendDurableLocal() {
            throw new Error("invalid receipts must not mutate local Yjs");
          },
        },
        outbox: {
          async entries() {
            reads += 1;
            return [];
          },
          async enqueue() {},
          async markAcked() {
            throw new Error(
              "invalid receipts must not acknowledge outbox work",
            );
          },
        },
        recentOutcomes,
      }),
      /collaboration bootstrap outcomes are invalid/i,
    );
    assert.equal(reads, 0);
  }
});

test("a digest-matching accepted legacy oversized outbox operation is acknowledged without entering Yjs", async () => {
  const outcome = oversizedSnapshotOutcome();
  const queued = {
    clientOperationId: outcome.clientOperationId,
    revisionId: outcome.revisionId,
    type: outcome.operationType,
    baseVersions: outcome.baseVersions,
    forward: outcome.forward,
    inverse: outcome.inverse,
    createdAt: "2026-08-26T00:00:00.000Z",
  };

  const events = [];
  await reconcileDrawingCollaborationDraft({
    actorId: ids.user,
    revisionId: ids.revision,
    baseOperationSequence: 7,
    adapter: {
      operations: () => [],
      preparePersistedLocal(value) {
        events.push("prepared");
        return { operation: value, state: { revisionId: ids.revision } };
      },
      appendDurableLocal() {
        events.push("appended");
        return true;
      },
    },
    outbox: {
      async entries() {
        return [{ operation: queued, status: "pending" }];
      },
      async enqueue() {},
      async markAcked(id) {
        events.push(`acked:${id}`);
      },
    },
    recentOutcomes: [outcome],
  });
  assert.deepEqual(events, [`acked:${ids.operation}`]);
});

test("a digest match does not bypass non-size collaboration protocol limits", async () => {
  const baseVersions = Object.fromEntries(
    Array.from({ length: 257 }, (_, index) => [
      `20000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      1,
    ]),
  );
  const queued = { ...operation, baseVersions };
  const acknowledgements = [];

  await assert.rejects(
    reconcileDrawingCollaborationDraft({
      actorId: ids.user,
      revisionId: ids.revision,
      baseOperationSequence: 7,
      adapter: {
        operations: () => [],
        preparePersistedLocal(value) {
          return { operation: value, state: { revisionId: ids.revision } };
        },
        appendDurableLocal() {
          return true;
        },
      },
      outbox: {
        async entries() {
          return [{ operation: queued, status: "pending" }];
        },
        async enqueue() {},
        async markAcked(id) {
          acknowledgements.push(id);
        },
      },
      recentOutcomes: [
        {
          revisionId: ids.revision,
          clientOperationId: queued.clientOperationId,
          actorId: ids.user,
          sequence: 7,
          resultVersions: {},
          operationSha256: localOperationSha256(queued),
        },
      ],
    }),
    /too many drawing operation base versions/i,
  );
  assert.deepEqual(acknowledgements, []);
});

test("accepted receipts verify every local operation digest before acknowledging any candidate", async () => {
  const second = { ...operation, clientOperationId: ids.semanticOperationA };
  const acknowledgements = [];

  await assert.rejects(
    reconcileDrawingCollaborationDraft({
      actorId: ids.user,
      revisionId: ids.revision,
      baseOperationSequence: 8,
      adapter: {
        operations: () => [],
        preparePersistedLocal(value) {
          return { operation: value, state: { revisionId: ids.revision } };
        },
        appendDurableLocal() {
          return true;
        },
      },
      outbox: {
        async entries() {
          return [
            { operation, status: "pending" },
            { operation: second, status: "pending" },
          ];
        },
        async enqueue() {},
        async markAcked(id) {
          acknowledgements.push(id);
        },
      },
      recentOutcomes: [
        {
          revisionId: ids.revision,
          clientOperationId: operation.clientOperationId,
          actorId: ids.user,
          sequence: 7,
          resultVersions: {},
          operationSha256: localOperationSha256(operation),
        },
        {
          revisionId: ids.revision,
          clientOperationId: second.clientOperationId,
          actorId: ids.user,
          sequence: 8,
          resultVersions: {},
          operationSha256: "f".repeat(64),
        },
      ],
    }),
    /operation digest does not match/i,
  );
  assert.deepEqual(acknowledgements, []);
});

test("an accepted receipt verifies both outbox and Yjs candidates sharing its ID", async () => {
  const localMismatch = {
    ...operation,
    forward: {
      type: "update_objects",
      updates: [{ objectId: ids.object, patch: { name: "Mismatch" } }],
    },
  };
  const acknowledgements = [];

  await assert.rejects(
    reconcileDrawingCollaborationDraft({
      actorId: ids.user,
      revisionId: ids.revision,
      baseOperationSequence: 7,
      adapter: {
        operations: () => [localMismatch],
        preparePersistedLocal(value) {
          return { operation: value, state: { revisionId: ids.revision } };
        },
        appendDurableLocal() {
          return true;
        },
      },
      outbox: {
        async entries() {
          return [{ operation, status: "pending" }];
        },
        async enqueue() {},
        async markAcked(id) {
          acknowledgements.push(id);
        },
      },
      recentOutcomes: [
        {
          revisionId: ids.revision,
          clientOperationId: operation.clientOperationId,
          actorId: ids.user,
          sequence: 7,
          resultVersions: {},
          operationSha256: localOperationSha256(operation),
        },
      ],
    }),
    /operation digest does not match/i,
  );
  assert.deepEqual(acknowledgements, []);
});

test("accepted Yjs-only work is not re-enqueued before its receipt acknowledgement", async () => {
  const events = [];

  await reconcileDrawingCollaborationDraft({
    actorId: ids.user,
    revisionId: ids.revision,
    baseOperationSequence: 7,
    adapter: {
      operations: () => [operation],
      preparePersistedLocal(value) {
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
      async enqueue() {
        events.push("enqueued");
      },
      async markAcked(id) {
        events.push(`acked:${id}`);
      },
    },
    recentOutcomes: [
      {
        revisionId: ids.revision,
        clientOperationId: operation.clientOperationId,
        actorId: ids.user,
        sequence: 7,
        resultVersions: {},
        operationSha256: localOperationSha256(operation),
      },
    ],
  });

  assert.deepEqual(events, [`acked:${ids.operation}`]);
});

test("a remote receipt may verify the matching shared Yjs operation without becoming local outbox work", async () => {
  const remoteOperation = {
    ...operation,
    actorId: ids.other,
    clientOperationId: ids.semanticOperationA,
  };
  const events = [];

  await reconcileDrawingCollaborationDraft({
    actorId: ids.user,
    revisionId: ids.revision,
    baseOperationSequence: 7,
    adapter: {
      operations: () => [remoteOperation],
      preparePersistedLocal() {
        throw new Error(
          "remote canonical history must not be recreated locally",
        );
      },
      appendDurableLocal() {
        throw new Error(
          "remote canonical history must not be appended locally",
        );
      },
    },
    outbox: {
      async entries() {
        return [];
      },
      async enqueue() {
        events.push("enqueued");
      },
      async markAcked() {
        events.push("acked");
      },
    },
    recentOutcomes: [
      {
        revisionId: ids.revision,
        clientOperationId: remoteOperation.clientOperationId,
        actorId: ids.other,
        sequence: 7,
        resultVersions: {},
        operationSha256: localOperationSha256(remoteOperation, ids.other),
      },
    ],
  });

  assert.deepEqual(events, []);
});

test("a checkpoint recognizes all 257 locally ACKed operations beyond the recent receipt window", async () => {
  const document = semanticDocument();
  const operations = Array.from({ length: 257 }, (_, index) => ({
    ...operation,
    clientOperationId: `30000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    createdAt: `2026-08-26T00:${String(Math.floor(index / 60)).padStart(2, "0")}:${String(index % 60).padStart(2, "0")}.000Z`,
  }));
  document.transact(() => {
    for (const [index, candidate] of operations.entries()) {
      appendDrawingCollaborationOperation(document, candidate);
      document.getMap("operationStatus").set(candidate.clientOperationId, {
        operationId: candidate.clientOperationId,
        status: "acked",
        authoritativeSequence: index + 1,
        resultVersions: { [ids.object]: 2 },
      });
    }
  });
  const adapter = createDrawingDraftAdapter({
    document,
    authoritativeState: semanticState(),
    actorId: ids.user,
    authorization: "editor",
    frozen: false,
    baseOperationSequence: operations.length,
  });
  const enqueued = [];
  const recentOutcomes = operations.slice(1).map((candidate, index) => ({
    revisionId: ids.revision,
    clientOperationId: candidate.clientOperationId,
    actorId: ids.user,
    sequence: index + 2,
    resultVersions: { [ids.object]: 2 },
    operationSha256: localOperationSha256(candidate),
  }));

  await reconcileDrawingCollaborationDraft({
    actorId: ids.user,
    revisionId: ids.revision,
    baseOperationSequence: operations.length,
    adapter,
    outbox: {
      async entries() {
        return [];
      },
      async enqueue(candidate) {
        enqueued.push(candidate.clientOperationId);
      },
      async markAcked() {},
    },
    recentOutcomes,
  });

  assert.deepEqual(enqueued, []);
  adapter.dispose();
  document.destroy();
});

test("pending or ahead-of-checkpoint local statuses remain eligible for repair enqueue", async () => {
  const document = semanticDocument();
  const pending = operation;
  const ahead = { ...operation, clientOperationId: ids.other };
  document.transact(() => {
    appendDrawingCollaborationOperation(document, pending);
    appendDrawingCollaborationOperation(document, ahead);
    document.getMap("operationStatus").set(pending.clientOperationId, {
      operationId: pending.clientOperationId,
      status: "pending",
      authoritativeSequence: null,
      resultVersions: {},
    });
    document.getMap("operationStatus").set(ahead.clientOperationId, {
      operationId: ahead.clientOperationId,
      status: "acked",
      authoritativeSequence: 8,
      resultVersions: { [ids.object]: 2 },
    });
  });
  const adapter = createDrawingDraftAdapter({
    document,
    authoritativeState: semanticState(),
    actorId: ids.user,
    authorization: "editor",
    frozen: false,
    baseOperationSequence: 7,
  });
  const enqueued = [];

  await reconcileDrawingCollaborationDraft({
    actorId: ids.user,
    revisionId: ids.revision,
    baseOperationSequence: 7,
    adapter,
    outbox: {
      async entries() {
        return [];
      },
      async enqueue(candidate) {
        enqueued.push(candidate.clientOperationId);
      },
      async markAcked() {},
    },
    recentOutcomes: [],
  });

  assert.deepEqual(enqueued.sort(), [ids.operation, ids.other].sort());
  adapter.dispose();
  document.destroy();
});

test("terminal rejected collaboration operations never resurrect into the outbox", async () => {
  const document = semanticDocument();
  document.transact(() => {
    appendDrawingCollaborationOperation(document, operation);
    document.getMap("operationStatus").set(operation.clientOperationId, {
      operationId: operation.clientOperationId,
      status: "rejected",
      authoritativeSequence: null,
      resultVersions: {},
    });
  });
  const adapter = createDrawingDraftAdapter({
    document,
    authoritativeState: semanticState(),
    actorId: ids.user,
    authorization: "editor",
    frozen: false,
    baseOperationSequence: 7,
  });
  const enqueued = [];

  await reconcileDrawingCollaborationDraft({
    actorId: ids.user,
    revisionId: ids.revision,
    baseOperationSequence: 7,
    adapter,
    outbox: {
      async entries() {
        return [];
      },
      async enqueue(candidate) {
        enqueued.push(candidate.clientOperationId);
      },
      async markAcked() {},
    },
    recentOutcomes: [],
  });

  assert.deepEqual(adapter.getSnapshot().rejectedOperationIds, [ids.operation]);
  assert.deepEqual(enqueued, []);
  adapter.dispose();
  document.destroy();
});

test("a durable HTTP ACK tombstone restores the local projection after reload without re-enqueue", async () => {
  const document = semanticDocument();
  appendDrawingCollaborationOperation(document, operation);
  document.getMap("operationStatus").set(ids.operation, {
    operationId: ids.operation,
    status: "pending",
    authoritativeSequence: null,
    resultVersions: {},
  });
  const adapter = createDrawingDraftAdapter({
    document,
    authoritativeState: semanticState(),
    actorId: ids.user,
    authorization: "editor",
    frozen: false,
    baseOperationSequence: 7,
  });
  const enqueued = [];

  await reconcileDrawingCollaborationDraft({
    actorId: ids.user,
    revisionId: ids.revision,
    baseOperationSequence: 7,
    adapter,
    outbox: {
      async entries() {
        return [];
      },
      async acknowledgements() {
        return [
          {
            clientOperationId: ids.operation,
            authoritativeSequence: 7,
            resultVersions: { [ids.object]: 2 },
            operation: {
              clientOperationId: operation.clientOperationId,
              revisionId: operation.revisionId,
              type: operation.type,
              baseVersions: operation.baseVersions,
              forward: operation.forward,
              inverse: operation.inverse,
              createdAt: operation.createdAt,
            },
          },
        ];
      },
      async enqueue(candidate) {
        enqueued.push(candidate.clientOperationId);
      },
      async markAcked() {},
    },
    recentOutcomes: [],
  });

  assert.deepEqual(enqueued, []);
  assert.deepEqual(adapter.getSnapshot().pendingOperationIds, []);
  assert.deepEqual(document.getMap("operationStatus").toJSON(), {
    [ids.operation]: {
      operationId: ids.operation,
      status: "pending",
      authoritativeSequence: null,
      resultVersions: {},
    },
  });
  adapter.dispose();
  document.destroy();
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
  assert.deepEqual(bootstrap.recentOutcomes, [
    {
      ...deletedOutcome,
      operationSha256: outcomeOperationSha256(deletedOutcome),
    },
  ]);
});

test("workspace collaboration bootstrap rejects malformed outcome lineage", async () => {
  const first = {
    revisionId: ids.revision,
    clientOperationId: ids.operation,
    actorId: ids.user,
    operationType: operation.type,
    baseVersions: operation.baseVersions,
    forward: operation.forward,
    inverse: operation.inverse,
    sequence: 6,
    resultVersions: {},
  };
  const second = {
    ...first,
    clientOperationId: ids.other,
    sequence: 7,
  };
  const cases = [
    [{ ...first, revisionId: ids.other }],
    [first, { ...second, clientOperationId: first.clientOperationId }],
    [first, { ...second, sequence: first.sequence }],
    [second, first],
    [{ ...first, sequence: 8 }],
  ];
  const payload = (recentOutcomes) => ({
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
    recentOutcomes,
  });

  for (const recentOutcomes of cases)
    await assert.rejects(
      loadDrawingWorkspaceCollaborationBootstrap(
        {
          async rpc() {
            return { data: payload(recentOutcomes), error: null };
          },
        },
        ids.revision,
      ),
      /collaboration bootstrap outcomes are invalid/i,
    );
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

test("snapshot-only accepted undo receipts stay at the authoritative boundary", async () => {
  const events = [];
  await reconcileDrawingCollaborationDraft({
    actorId: ids.user,
    revisionId: ids.revision,
    baseOperationSequence: 7,
    adapter: {
      operations: () => [],
      preparePersistedLocal() {
        throw new Error("snapshot receipt must not manufacture an operation");
      },
      appendDurableLocal() {
        throw new Error("snapshot receipt must not mutate local Yjs");
      },
    },
    outbox: {
      async entries() {
        return [];
      },
      async enqueue() {},
      async markAcked(id) {
        events.push(`acked:${id}`);
      },
    },
    recentOutcomes: [
      {
        revisionId: ids.revision,
        clientOperationId: ids.operation,
        actorId: ids.user,
        sequence: 7,
        resultVersions: {},
        operationSha256: "a".repeat(64),
      },
    ],
  });
  assert.deepEqual(events, [`acked:${ids.operation}`]);
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

test("accepted deletion receipt keeps the authoritative null result", async () => {
  const envelope = semanticEnvelope(
    { type: "delete_objects", objectIds: [ids.area] },
    ids.operation,
    ids.user,
  );
  const {
    actorId: _actorId,
    schemaVersion: _schemaVersion,
    ...input
  } = envelope;
  const form = new FormData();
  form.set("intent", "apply_operation");
  form.set("operation_json", JSON.stringify(input));
  let delivered;

  const result = await handleWorkspaceMutation({
    client: {
      async rpc() {
        return {
          data: {
            operationId: ids.operation,
            sequence: 7,
            resultVersions: { [ids.area]: null },
          },
          error: null,
        };
      },
    },
    projectId: ids.project,
    capability: "editor",
    actorId: ids.user,
    workspace: {
      document: { revision: { id: ids.revision, status: "draft" } },
    },
    form,
    async deliverOutcome(receipt) {
      delivered = receipt;
      return true;
    },
  });

  assert.equal(result.status, 200);
  assert.deepEqual(delivered.resultVersions, { [ids.area]: null });
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

test("a version conflict stays a client conflict but is rejected in the shared ledger", async () => {
  const request = new FormData();
  request.set("intent", "apply_operation");
  request.set(
    "operation_json",
    JSON.stringify({
      ...operation,
      actorId: undefined,
      schemaVersion: undefined,
    }),
  );
  let delivered;
  const result = await handleWorkspaceMutation({
    client: {
      async rpc() {
        return {
          data: null,
          error: { code: "P1C01", message: "Drawing object version conflict" },
        };
      },
    },
    projectId: ids.project,
    capability: "editor",
    actorId: ids.user,
    workspace: {
      document: { revision: { id: ids.revision, status: "draft" } },
    },
    form: request,
    async deliverOutcome(receipt) {
      delivered = receipt;
      return true;
    },
  });

  assert.equal(result.status, 409);
  assert.equal(result.body.kind, "conflict");
  assert.equal(delivered.outcome, "rejected");
});

test("a pending DXF attestation stays retryable without a terminal shared-ledger outcome", async () => {
  const request = new FormData();
  request.set("intent", "apply_operation");
  request.set(
    "operation_json",
    JSON.stringify({
      ...operation,
      actorId: undefined,
      schemaVersion: undefined,
    }),
  );
  let deliveries = 0;
  const result = await handleWorkspaceMutation({
    client: {
      async rpc() {
        return {
          data: null,
          error: {
            code: "P1T01",
            message: "DXF operation plan attestation is pending",
          },
        };
      },
    },
    projectId: ids.project,
    capability: "editor",
    actorId: ids.user,
    workspace: {
      document: { revision: { id: ids.revision, status: "draft" } },
    },
    form: request,
    async deliverOutcome() {
      deliveries += 1;
      return true;
    },
  });

  assert.equal(result.status, 503);
  assert.equal(result.body.kind, "retryable");
  assert.equal(deliveries, 0);
});

test("conflict discard settles the exact suffix in DB before shared ledger receipts", async () => {
  const {
    actorId: _actorId,
    schemaVersion: _schemaVersion,
    ...first
  } = operation;
  const second = {
    ...first,
    clientOperationId: ids.other,
    createdAt: "2026-08-26T00:01:00.000Z",
  };
  const request = new FormData();
  request.set("intent", "discard_conflicted_operations");
  request.set("revision_id", ids.revision);
  request.set("operations_json", JSON.stringify([first, second]));
  const calls = [];
  const delivered = [];
  const result = await handleWorkspaceMutation({
    client: {
      async rpc(name, args) {
        calls.push([name, args]);
        return {
          data: {
            dispositions: [
              {
                clientOperationId: ids.operation,
                status: "rejected",
                authoritativeSequence: null,
                resultVersions: {},
              },
              {
                clientOperationId: ids.other,
                status: "acked",
                authoritativeSequence: 8,
                resultVersions: { [ids.object]: 2 },
              },
            ],
          },
          error: null,
        };
      },
    },
    projectId: ids.project,
    capability: "editor",
    actorId: ids.user,
    workspace: {
      document: { revision: { id: ids.revision, status: "draft" } },
    },
    form: request,
    async deliverOutcome(receipt) {
      delivered.push(receipt);
      return true;
    },
  });

  assert.equal(result.status, 200);
  assert.equal(calls[0][0], "lukas_drawing_discard_operation_suffix");
  assert.deepEqual(calls[0][1], {
    p_revision_id: ids.revision,
    p_operations: [first, second],
  });
  assert.deepEqual(
    delivered.map(({ operation, outcome, authoritativeSequence }) => ({
      id: operation.clientOperationId,
      outcome,
      authoritativeSequence,
    })),
    [
      {
        id: ids.operation,
        outcome: "rejected",
        authoritativeSequence: null,
      },
      { id: ids.other, outcome: "acked", authoritativeSequence: 8 },
    ],
  );
});

test("HTTP-only operation acknowledgement bypasses the disabled collaboration receipt service", async () => {
  const request = new FormData();
  request.set("intent", "apply_operation");
  request.set(
    "operation_json",
    JSON.stringify({
      ...operation,
      actorId: undefined,
      schemaVersion: undefined,
    }),
  );
  let deliveries = 0;
  const result = await handleWorkspaceMutation({
    client: {
      async rpc(name) {
        assert.equal(name, "lukas_drawing_apply_operation");
        return {
          data: {
            operationId: ids.operation,
            sequence: 19,
            resultVersions: { [ids.object]: 2 },
          },
          error: null,
        };
      },
    },
    projectId: ids.project,
    capability: "editor",
    actorId: ids.user,
    collaborationEnabled: false,
    workspace: {
      document: { revision: { id: ids.revision, status: "draft" } },
    },
    form: request,
    async deliverOutcome() {
      deliveries += 1;
      throw new Error("disabled collaboration service must not be called");
    },
  });

  assert.equal(result.status, 200);
  assert.equal(result.body.clientOperationId, ids.operation);
  assert.deepEqual(result.body.result, {
    operationId: ids.operation,
    sequence: 19,
    resultVersions: { [ids.object]: 2 },
  });
  assert.equal(deliveries, 0);
});

test("HTTP-only operation conflict remains terminal without the disabled receipt service", async () => {
  const request = new FormData();
  request.set("intent", "apply_operation");
  request.set(
    "operation_json",
    JSON.stringify({
      ...operation,
      actorId: undefined,
      schemaVersion: undefined,
    }),
  );
  let deliveries = 0;
  const result = await handleWorkspaceMutation({
    client: {
      async rpc() {
        return {
          data: null,
          error: { code: "P1C01", message: "Drawing object version conflict" },
        };
      },
    },
    projectId: ids.project,
    capability: "editor",
    actorId: ids.user,
    collaborationEnabled: false,
    workspace: {
      document: { revision: { id: ids.revision, status: "draft" } },
    },
    form: request,
    async deliverOutcome() {
      deliveries += 1;
      return false;
    },
  });

  assert.equal(result.status, 409);
  assert.equal(result.body.kind, "conflict");
  assert.equal(deliveries, 0);
});

test("HTTP-only review uses the legacy snapshot authority without opening a collaboration freeze", async () => {
  const requestId = "00000000-0000-4000-8000-000000000619";
  const request = new FormData();
  request.set("intent", "request_review");
  request.set("revision_id", ids.revision);
  request.set("freeze_request_id", requestId);
  let collaborativeCalls = 0;
  let directCalls = 0;
  const result = await handleWorkspaceMutation({
    client: {},
    projectId: ids.project,
    capability: "editor",
    actorId: ids.user,
    collaborationEnabled: false,
    workspace: {
      document: { revision: { id: ids.revision, status: "draft" } },
    },
    form: request,
    async requestReview() {
      collaborativeCalls += 1;
      throw new Error("disabled collaboration freeze must not be called");
    },
    async requestReviewWithoutCollaboration(client, revisionId) {
      directCalls += 1;
      assert.deepEqual(client, {});
      assert.equal(revisionId, ids.revision);
      return {
        snapshotId: "00000000-0000-4000-8000-000000000620",
        subjectVersion: 1,
        snapshotSha256: "a".repeat(64),
        operationSequence: 0,
      };
    },
  });

  assert.equal(result.status, 200);
  assert.equal(collaborativeCalls, 0);
  assert.equal(directCalls, 1);
  assert.equal(result.body.result.subjectVersion, 1);
});
