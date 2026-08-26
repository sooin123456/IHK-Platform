import assert from "node:assert/strict";
import test from "node:test";
import * as Y from "yjs";

import {
  createDrawingCollaborationCommandBridge,
  drawingCollaborationAuthority,
  drawingCollaborationLifecycleKey,
  drawingCollaborationPhaseForProviderStatus,
  openDrawingCollaborationLocalAttempt,
  reconcileDrawingCollaborationDraft,
} from "../app/lukas/lib/drawing-collaboration-client.ts";
import {
  applyDrawingCommand,
  createDrawingDocumentState,
} from "../app/lukas/lib/drawing-commands.ts";
import { appendDrawingCollaborationOperation } from "../app/lukas/lib/drawing-collaboration-yjs.ts";
import { createDrawingDraftAdapter } from "../app/lukas/lib/drawing-yjs-draft.ts";
import { resolveDrawingOpening } from "../app/lukas/lib/drawing-semantic-geometry.ts";
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

test("workspace collaboration bootstrap is one authenticated transactional RPC", async () => {
  const calls = [];
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
          recentOutcomes: [],
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
