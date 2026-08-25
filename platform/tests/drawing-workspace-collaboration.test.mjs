import assert from "node:assert/strict";
import test from "node:test";

import {
  createDrawingCollaborationCommandBridge,
  drawingCollaborationAuthority,
  drawingCollaborationLifecycleKey,
  drawingCollaborationPhaseForProviderStatus,
  openDrawingCollaborationLocalAttempt,
  reconcileDrawingCollaborationDraft,
} from "../app/lukas/lib/drawing-collaboration-client.ts";
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
        return { destroy() { documents--; } };
      },
      async openPersistence() {
        return {
          async whenSynced() {},
          async dispose() { throw new Error("persistence close failed"); },
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
