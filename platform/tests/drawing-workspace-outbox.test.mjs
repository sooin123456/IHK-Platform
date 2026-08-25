import assert from "node:assert/strict";
import test from "node:test";

import {
  canPersistDrawingMutation,
  claimLegacyDrawingOperations,
  createDrawingOutbox,
  createDrawingPersistenceQueue,
  createIndexedDbDrawingOutboxAdapter,
  drawingSaveStatus,
  recoverPendingDrawingState,
  restoreDrawingWorkspaceState,
  sendDrawingOperation,
  prepareDrawingReview,
} from "../app/lukas/lib/drawing-outbox.client.ts";
import {
  applyDrawingCommand,
  createDrawingDocumentState,
} from "../app/lukas/lib/drawing-commands.ts";
import { DrawingOperationInputSchema } from "../app/lukas/lib/drawing-workspace.types.ts";
import { parseWorkspaceMutation } from "../app/lukas/lib/drawing-workspace.server.ts";

const ids = {
  revisionA: "00000000-0000-4000-8000-000000000001",
  revisionB: "00000000-0000-4000-8000-000000000002",
  ownerA: "00000000-0000-4000-8000-000000000020",
  ownerB: "00000000-0000-4000-8000-000000000021",
  layer: "00000000-0000-4000-8000-000000000003",
  object: "00000000-0000-4000-8000-000000000004",
  operation1: "00000000-0000-4000-8000-000000000005",
  operation2: "00000000-0000-4000-8000-000000000006",
  operation3: "00000000-0000-4000-8000-000000000007",
};

function operation(clientOperationId, overrides = {}) {
  return {
    clientOperationId,
    revisionId: ids.revisionA,
    type: "update_objects",
    baseVersions: { [ids.object]: 1 },
    forward: {
      type: "update_objects",
      updates: [{ objectId: ids.object, patch: { name: "Door" } }],
    },
    inverse: {
      type: "update_objects",
      updates: [{ objectId: ids.object, patch: { name: "Rectangle" } }],
    },
    createdAt: "2026-08-24T01:00:00.000Z",
    ...overrides,
  };
}

function memoryAdapter(events = []) {
  const records = new Map();
  let enqueueSequence = 0;
  return {
    async delete(clientOperationId) {
      events.push(`delete:${clientOperationId}`);
      records.delete(clientOperationId);
    },
    async list() {
      return structuredClone([...records.values()]);
    },
    async claimLegacy(revisionId, ownerId) {
      let claimed = 0;
      for (const [id, record] of records) {
        if (record.ownerId || record.operation.revisionId !== revisionId)
          continue;
        records.set(id, {
          ...record,
          ownerId,
          enqueueSequence: ++enqueueSequence,
        });
        claimed += 1;
      }
      return claimed;
    },
    async enqueue(record) {
      const stored = { ...record, enqueueSequence: ++enqueueSequence };
      events.push(`put:${record.operation.clientOperationId}`);
      records.set(record.operation.clientOperationId, structuredClone(stored));
      return structuredClone(stored);
    },
    async put(record) {
      events.push(`put:${record.operation.clientOperationId}`);
      records.set(record.operation.clientOperationId, structuredClone(record));
    },
  };
}

function fakeIndexedDb({ blocked = false, records = [] } = {}) {
  const storedRecords = structuredClone(records);
  const store = {
    createdIndexes: [],
    indexNames: {
      contains(name) {
        return name === "revision_created_at" || name === "status";
      },
    },
    createIndex(name) {
      this.createdIndexes.push(name);
    },
    getAll() {
      const request = {};
      queueMicrotask(() => {
        request.result = structuredClone(storedRecords);
        request.onsuccess?.();
      });
      return request;
    },
    put(record) {
      const index = storedRecords.findIndex(
        (candidate) => candidate.clientOperationId === record.clientOperationId,
      );
      if (index === -1) storedRecords.push(structuredClone(record));
      else storedRecords[index] = structuredClone(record);
    },
  };
  const database = {
    closed: false,
    objectStoreNames: { contains: () => true },
    close() {
      this.closed = true;
    },
    transaction() {
      const transaction = { objectStore: () => store };
      setTimeout(() => transaction.oncomplete?.(), 0);
      return transaction;
    },
  };
  const request = {
    result: database,
    transaction: { objectStore: () => store },
    succeedLate() {
      this.onsuccess?.();
    },
  };
  const factory = {
    openCalls: 0,
    open() {
      this.openCalls += 1;
      database.closed = false;
      queueMicrotask(() => {
        if (blocked) request.onblocked?.();
        else {
          request.onupgradeneeded?.();
          request.onsuccess?.();
        }
      });
      return request;
    },
  };
  return { database, factory, request, store };
}

function scopedOutbox(adapter, options = {}) {
  return createDrawingOutbox(adapter, {
    ownerId: ids.ownerA,
    revisionId: ids.revisionA,
    ...options,
  });
}

function rectangle(overrides = {}) {
  return {
    id: ids.object,
    name: "Rectangle",
    layerId: ids.layer,
    geometry: {
      type: "rectangle",
      origin: { x: 0, y: 0 },
      width: 10,
      height: 20,
      rotation: 0,
    },
    style: { stroke: "#112233", strokeWidth: 2, fill: null },
    version: 1,
    ...overrides,
  };
}

function state() {
  return createDrawingDocumentState({
    revisionId: ids.revisionA,
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
    objects: [rectangle()],
  });
}

test("enqueue is durable before send and stores only the canonical operation", async () => {
  const events = [];
  const outbox = scopedOutbox(memoryAdapter(events));
  await outbox.enqueue({
    ...operation(ids.operation1),
    actorId: "local-only",
    undoable: true,
  });
  await outbox.flush(async (queued) => {
    events.push(`send:${queued.clientOperationId}`);
    return { clientOperationId: queued.clientOperationId, status: "acked" };
  });

  assert.equal(events[0], `put:${ids.operation1}`);
  assert.equal(events[1], `send:${ids.operation1}`);
  assert.deepEqual(await outbox.pending(), []);
});

test("a recorded mutate_structure operation parses and enqueues unchanged", async () => {
  const pageId = "00000000-0000-4000-8000-000000000030";
  const paperId = "00000000-0000-4000-8000-000000000031";
  const modelId = "00000000-0000-4000-8000-000000000032";
  const modelLayerId = "00000000-0000-4000-8000-000000000036";
  const workLayer = {
    id: ids.layer, name: "Work", visible: true, locked: false, systemKind: "work", canvasId: paperId, sortOrder: 0, version: 1,
  };
  const initial = createDrawingDocumentState({
    revisionId: ids.revisionA,
    structure: {
      pages: { [pageId]: { id: pageId, revisionId: ids.revisionA, name: "Page 1", sortOrder: 0, version: 1 } },
      canvases: { [paperId]: { id: paperId, pageId, name: "Paper", spaceKind: "paper", widthMillimeters: 210, heightMillimeters: 297, background: null, sortOrder: 0, version: 1 } },
      layers: { [ids.layer]: workLayer }, objects: { [ids.object]: rectangle({ layerId: ids.layer }) }, styles: {}, blocks: {}, blockInstances: {}, propertySchemas: {}, propertyValues: {}, tables: {},
    },
  });
  const applied = applyDrawingCommand(initial, {
    type: "mutate_structure", actorId: ids.ownerA,
    actions: [
      { kind: "put_canvas", entity: { id: modelId, pageId, name: "Model", spaceKind: "model", widthMillimeters: 100, heightMillimeters: 100, background: null, sortOrder: 1, version: 1 }, baseVersion: null },
      { kind: "put_layer", entity: { id: modelLayerId, name: "Model work", visible: true, locked: false, systemKind: "custom", canvasId: modelId, sortOrder: 0, version: 1 }, baseVersion: null },
    ],
  }, { createId: () => ids.operation3, now: () => "2026-08-24T01:00:00.000Z" });
  assert.equal(DrawingOperationInputSchema.safeParse(applied.operation).success, true);
  const outbox = scopedOutbox(memoryAdapter());
  await outbox.enqueue(applied.operation);
  assert.equal((await outbox.pending())[0].type, "mutate_structure");
});

test("referenced-style updates survive the command, operation, outbox, and server boundaries", async () => {
  const pageId = "00000000-0000-4000-8000-000000000033";
  const canvasId = "00000000-0000-4000-8000-000000000034";
  const styleId = "00000000-0000-4000-8000-000000000035";
  const initial = createDrawingDocumentState({
    revisionId: ids.revisionA,
    structure: {
      pages: { [pageId]: { id: pageId, revisionId: ids.revisionA, name: "Page 1", sortOrder: 0, version: 1 } },
      canvases: { [canvasId]: { id: canvasId, pageId, name: "Paper", spaceKind: "paper", widthMillimeters: 210, heightMillimeters: 297, background: null, sortOrder: 0, version: 1 } },
      layers: { [ids.layer]: { id: ids.layer, name: "Work", visible: true, locked: false, systemKind: "work", canvasId, sortOrder: 0, version: 1 } },
      objects: { [ids.object]: rectangle({ layerId: ids.layer, styleId, style: { fill: "#ffffff" } }) },
      styles: { [styleId]: { id: styleId, revisionId: ids.revisionA, name: "Default", value: { stroke: "#111111", strokeWidth: 2, fill: null }, version: 1 } },
      blocks: {}, blockInstances: {}, propertySchemas: {}, propertyValues: {}, tables: {},
    },
  });
  const applied = applyDrawingCommand(initial, {
    type: "update_objects", actorId: ids.ownerA,
    updates: [{ objectId: ids.object, patch: { styleId, style: { fill: "#aabbcc" } } }],
  }, { createId: () => ids.operation3, now: () => "2026-08-24T01:00:00.000Z" });
  assert.equal(DrawingOperationInputSchema.safeParse(applied.operation).success, true);
  const outbox = scopedOutbox(memoryAdapter());
  await outbox.enqueue(applied.operation);
  const queued = (await outbox.pending())[0];
  assert.deepEqual(queued.forward.updates[0].patch, { styleId, style: { fill: "#aabbcc" } });
  const operation = Object.fromEntries(
    ["baseVersions", "clientOperationId", "createdAt", "forward", "inverse", "revisionId", "type"]
      .map((key) => [key, applied.operation[key]]),
  );
  const form = new FormData();
  form.set("intent", "apply_operation");
  form.set("operation_json", JSON.stringify(operation));
  assert.deepEqual(parseWorkspaceMutation(form), {
    intent: "apply_operation", operation,
  });
});

test("enqueue rejects a malformed nested operation before durable storage", async () => {
  const events = [];
  const outbox = scopedOutbox(memoryAdapter(events));
  await assert.rejects(
    outbox.enqueue(
      operation(ids.operation1, {
        forward: {
          type: "update_objects",
          updates: [
            {
              objectId: ids.object,
              patch: { name: "Door", rendererAttrs: { listening: true } },
            },
          ],
        },
      }),
    ),
  );
  assert.deepEqual(events, []);
});

test("a mismatched acknowledgement retains the operation and markAcked is idempotent", async () => {
  const outbox = scopedOutbox(memoryAdapter());
  await outbox.enqueue(operation(ids.operation1));

  await assert.rejects(
    outbox.flush(async () => ({
      clientOperationId: ids.operation2,
      status: "acked",
    })),
    /acknowledgement/i,
  );
  assert.deepEqual(
    (await outbox.pending()).map((item) => item.clientOperationId),
    [ids.operation1],
  );
  assert.equal(await outbox.markAcked(ids.operation1), true);
  assert.equal(await outbox.markAcked(ids.operation1), false);
});

test("flush orders the scoped revision and never accepts another revision", async () => {
  const outbox = scopedOutbox(memoryAdapter());
  await outbox.enqueue(
    operation(ids.operation2, { createdAt: "2026-08-24T02:00:00.000Z" }),
  );
  await outbox.enqueue(
    operation(ids.operation1, { createdAt: "2026-08-24T01:00:00.000Z" }),
  );
  await assert.rejects(
    outbox.enqueue(
      operation(ids.operation3, {
        revisionId: ids.revisionB,
        createdAt: "2026-08-24T00:30:00.000Z",
      }),
    ),
    /revision/i,
  );
  const sent = [];

  await outbox.flush(async (queued) => {
    sent.push(queued.clientOperationId);
    return queued.clientOperationId === ids.operation1
      ? {
          clientOperationId: queued.clientOperationId,
          status: "conflicted",
          error: "version changed",
        }
      : { clientOperationId: queued.clientOperationId, status: "acked" };
  });

  assert.deepEqual(sent, [ids.operation2, ids.operation1]);
  assert.deepEqual(
    (await outbox.entries()).map(({ operation: queued, status }) => [
      queued.clientOperationId,
      status,
    ]),
    [[ids.operation1, "conflicted"]],
  );
});

test("connection failures retain data and schedule bounded exponential retries", async () => {
  const scheduled = [];
  const outbox = scopedOutbox(memoryAdapter(), {
    schedule(delayMs, retry) {
      scheduled.push({ delayMs, retry });
      return scheduled.length;
    },
  });
  await outbox.enqueue(operation(ids.operation1));
  let attempts = 0;
  const send = async (queued) => {
    attempts += 1;
    if (attempts < 6) throw new Error("offline");
    return { clientOperationId: queued.clientOperationId, status: "acked" };
  };

  await assert.rejects(outbox.flush(send), /offline/);
  for (const expectedDelay of [1000, 2000, 4000, 8000]) {
    const scheduledRetry = scheduled.shift();
    assert.equal(scheduledRetry.delayMs, expectedDelay);
    await assert.rejects(scheduledRetry.retry(), /offline/);
  }
  const finalRetry = scheduled.shift();
  assert.equal(finalRetry.delayMs, 15000);
  await finalRetry.retry();
  assert.deepEqual(await outbox.pending(), []);
});

test("concurrent flush calls never double-send an operation", async () => {
  const outbox = scopedOutbox(memoryAdapter());
  await outbox.enqueue(operation(ids.operation1));
  let release;
  let sends = 0;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const send = async (queued) => {
    sends += 1;
    await gate;
    return { clientOperationId: queued.clientOperationId, status: "acked" };
  };

  const first = outbox.flush(send);
  const second = outbox.flush(send);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(sends, 1);
  release();
  await Promise.all([first, second]);
  assert.equal(sends, 1);
});

test("owner and revision scope quarantines shared-browser entries", async () => {
  const adapter = memoryAdapter();
  await adapter.enqueue({
    ownerId: ids.ownerB,
    operation: operation(ids.operation1),
    status: "pending",
    retryCount: 0,
  });
  await adapter.enqueue({
    ownerId: ids.ownerA,
    operation: operation(ids.operation2),
    status: "pending",
    retryCount: 0,
  });
  await adapter.enqueue({
    ownerId: ids.ownerA,
    operation: operation(ids.operation3, { revisionId: ids.revisionB }),
    status: "pending",
    retryCount: 0,
  });
  const outbox = scopedOutbox(adapter);
  const sent = [];

  await outbox.flush(async (queued) => {
    sent.push(queued.clientOperationId);
    return { clientOperationId: queued.clientOperationId, status: "acked" };
  });

  assert.deepEqual(sent, [ids.operation2]);
  assert.deepEqual(await outbox.pending(), []);
  assert.equal((await adapter.list()).length, 2);
  assert.deepEqual(
    (await adapter.list()).map((entry) => [
      entry.ownerId,
      entry.operation.revisionId,
    ]),
    [
      [ids.ownerB, ids.revisionA],
      [ids.ownerA, ids.revisionB],
    ],
  );
});

test("adapter-assigned sequence preserves same-timestamp enqueue order", async () => {
  const outbox = scopedOutbox(memoryAdapter());
  await outbox.enqueue(operation(ids.operation2));
  await outbox.enqueue(operation(ids.operation1));
  const sent = [];

  await outbox.flush(async (queued) => {
    sent.push(queued.clientOperationId);
    return { clientOperationId: queued.clientOperationId, status: "acked" };
  });

  assert.deepEqual(sent, [ids.operation2, ids.operation1]);
});

test("an active flush drains operations durably enqueued before it completes", async () => {
  const outbox = scopedOutbox(memoryAdapter());
  await outbox.enqueue(operation(ids.operation1));
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const sent = [];
  const flushing = outbox.flush(async (queued) => {
    sent.push(queued.clientOperationId);
    if (queued.clientOperationId === ids.operation1) await gate;
    return { clientOperationId: queued.clientOperationId, status: "acked" };
  });
  await new Promise((resolve) => setImmediate(resolve));
  await outbox.enqueue(operation(ids.operation2));
  release();
  await flushing;

  assert.deepEqual(sent, [ids.operation1, ids.operation2]);
  assert.deepEqual(await outbox.pending(), []);
});

test("same-realm outbox instances coordinate one scoped send", async () => {
  const adapter = memoryAdapter();
  const first = scopedOutbox(adapter);
  const second = scopedOutbox(adapter);
  await first.enqueue(operation(ids.operation1));
  let release;
  let sends = 0;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const send = async (queued) => {
    sends += 1;
    await gate;
    return { clientOperationId: queued.clientOperationId, status: "acked" };
  };

  const firstFlush = first.flush(send);
  const secondFlush = second.flush(send);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(sends, 1);
  release();
  await Promise.all([firstFlush, secondFlush]);
  assert.equal(sends, 1);
});

test("dispose cancels scheduled retries and prevents the old instance from sending", async () => {
  const scheduled = [];
  const outbox = scopedOutbox(memoryAdapter(), {
    schedule(delayMs, retry) {
      const item = { cancelled: false, delayMs, retry };
      scheduled.push(item);
      return () => {
        item.cancelled = true;
      };
    },
  });
  await outbox.enqueue(operation(ids.operation1));
  let sends = 0;
  const send = async () => {
    sends += 1;
    throw new Error("offline");
  };
  await assert.rejects(outbox.flush(send), /offline/);

  outbox.dispose();
  assert.equal(scheduled[0].cancelled, true);
  await scheduled[0].retry();
  assert.equal(sends, 1);
});

test("a replacement instance takes over after the disposed active flush rejects", async () => {
  const adapter = memoryAdapter();
  const first = scopedOutbox(adapter);
  const scheduled = [];
  const second = scopedOutbox(adapter, {
    schedule(delayMs, retry) {
      scheduled.push({ delayMs, retry });
    },
  });
  await first.enqueue(operation(ids.operation1));
  let rejectFirst;
  const firstSend = new Promise((_, reject) => {
    rejectFirst = reject;
  });
  const oldFlush = first.flush(async () => firstSend);
  await new Promise((resolve) => setImmediate(resolve));
  first.dispose();
  let replacementSends = 0;
  let online = false;
  const replacementFlush = second.flush(async () => {
    replacementSends += 1;
    if (!online) throw new Error("still offline");
    return { clientOperationId: ids.operation1, status: "acked" };
  });

  rejectFirst(new Error("old transport failed"));
  await assert.rejects(oldFlush, /old transport/);
  await assert.rejects(replacementFlush, /still offline/);
  assert.equal(replacementSends, 1);
  assert.equal(scheduled.length, 1);

  online = true;
  await scheduled[0].retry();
  assert.equal(replacementSends, 2);
  assert.deepEqual(await second.pending(), []);
});

test("dispose aborts a hung send so the replacement can take over", async () => {
  const adapter = memoryAdapter();
  const first = scopedOutbox(adapter);
  const second = scopedOutbox(adapter);
  await first.enqueue(operation(ids.operation1));
  let observedAbort = false;
  const hung = first.flush(
    async (_queued, { signal }) =>
      new Promise((_, reject) => {
        signal.addEventListener("abort", () => {
          observedAbort = true;
          reject(new Error("aborted"));
        });
      }),
  );
  await new Promise((resolve) => setImmediate(resolve));
  first.dispose();

  let sends = 0;
  await second.flush(async (queued) => {
    sends += 1;
    return { clientOperationId: queued.clientOperationId, status: "acked" };
  });
  await assert.rejects(hung, /aborted/);
  assert.equal(observedAbort, true);
  assert.equal(sends, 1);
  assert.deepEqual(await second.pending(), []);
});

test("ownerless v1 rows stay quarantined until an editor confirms current-user attribution", async () => {
  const adapter = memoryAdapter();
  await adapter.put({
    operation: operation(ids.operation1),
    status: "pending",
    retryCount: 0,
  });
  const outbox = scopedOutbox(adapter);
  let sends = 0;
  const send = async (queued) => {
    sends += 1;
    return { clientOperationId: queued.clientOperationId, status: "acked" };
  };

  assert.equal((await outbox.legacyEntries()).length, 1);
  await outbox.flush(send);
  assert.equal(sends, 0);
  await assert.rejects(
    claimLegacyDrawingOperations({
      capability: "reviewer",
      confirmed: true,
      outbox,
    }),
    /editor/i,
  );
  assert.equal(
    await claimLegacyDrawingOperations({
      capability: "editor",
      confirmed: false,
      outbox,
    }),
    0,
  );
  assert.equal(
    await claimLegacyDrawingOperations({
      capability: "editor",
      confirmed: true,
      outbox,
    }),
    1,
  );
  assert.deepEqual(
    (await adapter.list()).map((entry) => [
      entry.ownerId,
      entry.enqueueSequence,
    ]),
    [[ids.ownerA, 1]],
  );
  await outbox.flush(send);
  assert.equal(sends, 1);
});

test("volatile persistence queues rapid commands and retries all failures in causal order", async () => {
  const persisted = [];
  let storageAvailable = false;
  const outbox = {
    async enqueue(queued) {
      if (!storageAvailable) throw new Error("quota exceeded");
      persisted.push(queued.clientOperationId);
    },
  };
  const snapshots = [];
  const queue = createDrawingPersistenceQueue({
    flush: async () => {},
    onChange: (snapshot) => snapshots.push(snapshot),
    outbox,
  });

  const first = queue.capture(operation(ids.operation1));
  const second = queue.capture(operation(ids.operation2));
  assert.equal(await first, false);
  assert.equal(await second, false);
  assert.deepEqual(queue.snapshot(), {
    failed: true,
    volatileCount: 2,
  });
  assert.equal(canPersistDrawingMutation("editor", queue.snapshot()), false);

  storageAvailable = true;
  assert.equal(await queue.retry(), true);
  assert.deepEqual(persisted, [ids.operation1, ids.operation2]);
  assert.deepEqual(queue.snapshot(), { failed: false, volatileCount: 0 });
  assert.equal(canPersistDrawingMutation("editor", queue.snapshot()), true);
  assert.ok(snapshots.some((snapshot) => snapshot.failed));
});

test("a hung durable enqueue remains visibly saving", () => {
  const queue = createDrawingPersistenceQueue({
    flush: async () => {},
    outbox: { enqueue: async () => new Promise(() => {}) },
  });

  void queue.capture(operation(ids.operation1));

  assert.equal(queue.snapshot().volatileCount, 1);
  assert.equal(
    drawingSaveStatus({
      pending: 0,
      volatileCount: queue.snapshot().volatileCount,
    }),
    "저장 중",
  );
  queue.dispose();
});

test("reload recovery applies exact-base work and retains ambiguous stale work", () => {
  const matching = recoverPendingDrawingState(state(), [
    operation(ids.operation1),
  ]);
  assert.equal(matching.state.objects[ids.object].name, "Door");
  assert.equal(matching.state.objects[ids.object].version, 2);
  assert.deepEqual(matching.conflictedOperationIds, []);

  const stale = recoverPendingDrawingState(state(), [
    operation(ids.operation1, {
      baseVersions: { [ids.object]: 2 },
    }),
  ]);
  assert.equal(stale.state.objects[ids.object].name, "Rectangle");
  assert.deepEqual(stale.conflictedOperationIds, []);
  assert.deepEqual(stale.ambiguousOperationIds, [ids.operation1]);
});

test("reload recovery never partially applies a conflicted multi-object operation", () => {
  const invalidSecondObject = "00000000-0000-4000-8000-000000000099";
  const recovered = recoverPendingDrawingState(state(), [
    operation(ids.operation1, {
      forward: {
        type: "update_objects",
        updates: [
          { objectId: ids.object, patch: { name: "Partially changed" } },
          { objectId: invalidSecondObject, patch: { name: "Missing" } },
        ],
      },
      inverse: {
        type: "update_objects",
        updates: [
          { objectId: ids.object, patch: { name: "Rectangle" } },
          { objectId: invalidSecondObject, patch: { name: "Missing" } },
        ],
      },
    }),
  ]);

  assert.equal(recovered.state.objects[ids.object].name, "Rectangle");
  assert.deepEqual(recovered.conflictedOperationIds, []);
  assert.deepEqual(recovered.ambiguousOperationIds, [ids.operation1]);
});

test("reload recovery restores a pending custom layer with its creation-version base", () => {
  const newLayer = "00000000-0000-4000-8000-000000000098";
  const recovered = recoverPendingDrawingState(state(), [
    operation(ids.operation1, {
      type: "add_layer",
      baseVersions: { [newLayer]: 1 },
      forward: {
        type: "add_layer",
        layer: {
          id: newLayer,
          name: "Markup",
          visible: true,
          locked: false,
          version: 1,
        },
      },
      inverse: {},
    }),
  ]);

  assert.equal(recovered.state.layers[newLayer].systemKind, "custom");
  assert.deepEqual(recovered.conflictedOperationIds, []);
});

test("reload recovery replays a P2 structure batch as one atomic unit", () => {
  const pageId = "00000000-0000-4000-8000-000000000201";
  const paperId = "00000000-0000-4000-8000-000000000202";
  const modelId = "00000000-0000-4000-8000-000000000203";
  const modelLayerId = "00000000-0000-4000-8000-000000000204";
  const initial = createDrawingDocumentState({
    revisionId: ids.revisionA,
    structure: {
      pages: { [pageId]: { id: pageId, revisionId: ids.revisionA, name: "A1", sortOrder: 0, version: 1 } },
      canvases: { [paperId]: { id: paperId, pageId, name: "Paper", spaceKind: "paper", widthMillimeters: 210, heightMillimeters: 297, background: null, sortOrder: 0, version: 1 } },
      layers: { [ids.layer]: { id: ids.layer, name: "Work", visible: true, locked: false, systemKind: "work", canvasId: paperId, sortOrder: 0, version: 1 } },
      objects: { [ids.object]: rectangle() }, styles: {}, blocks: {}, blockInstances: {}, propertySchemas: {}, propertyValues: {}, tables: {},
    },
  });
  const applied = applyDrawingCommand(initial, {
    type: "mutate_structure", actorId: ids.ownerA,
    actions: [
      { kind: "put_canvas", entity: { id: modelId, pageId, name: "Model", spaceKind: "model", widthMillimeters: 100, heightMillimeters: 100, background: null, sortOrder: 1, version: 1 }, baseVersion: null },
      { kind: "put_layer", entity: { id: modelLayerId, name: "Model work", visible: true, locked: false, systemKind: "custom", canvasId: modelId, sortOrder: 0, version: 1 }, baseVersion: null },
    ],
  }, { createId: () => ids.operation3, now: () => "2026-08-25T00:00:00.000Z" });

  const recovered = recoverPendingDrawingState(initial, [applied.operation]);

  assert.equal(recovered.ambiguousOperationIds.length, 0);
  assert.equal(recovered.state.structure.canvases[modelId].name, "Model");
  assert.equal(recovered.state.structure.layers[modelLayerId].canvasId, modelId);
});

test("reload recovery does not apply later work from a blocked revision", () => {
  const recovered = recoverPendingDrawingState(state(), [
    {
      operation: operation(ids.operation1),
      status: "conflicted",
      retryCount: 0,
    },
    {
      operation: operation(ids.operation2, {
        createdAt: "2026-08-24T02:00:00.000Z",
      }),
      status: "pending",
      retryCount: 0,
    },
  ]);

  assert.equal(recovered.state.objects[ids.object].name, "Rectangle");
  assert.deepEqual(recovered.conflictedOperationIds, []);
});

test("save status exposes only the four workspace states and never calls storage failure saved", () => {
  assert.equal(drawingSaveStatus({ pending: 0 }), "저장됨");
  assert.equal(drawingSaveStatus({ pending: 1, flushing: true }), "저장 중");
  assert.equal(
    drawingSaveStatus({ pending: 1, online: false }),
    "오프라인 저장",
  );
  assert.equal(
    drawingSaveStatus({ pending: 1, conflicted: true }),
    "충돌 검토 필요",
  );
  assert.equal(
    drawingSaveStatus({ pending: 0, storageError: true }),
    "저장 중",
  );
  assert.equal(drawingSaveStatus({ pending: 0, volatileCount: 1 }), "저장 중");
});

test("a failed durable enqueue sends nothing and the same operation can be retried", async () => {
  const adapter = memoryAdapter();
  const durableEnqueue = adapter.enqueue;
  let storageAvailable = false;
  adapter.enqueue = async (entry) => {
    if (!storageAvailable) throw new Error("quota exceeded");
    return durableEnqueue(entry);
  };
  const outbox = scopedOutbox(adapter);
  let sends = 0;

  await assert.rejects(outbox.enqueue(operation(ids.operation1)), /quota/);
  await outbox.flush(async (queued) => {
    sends += 1;
    return { clientOperationId: queued.clientOperationId, status: "acked" };
  });
  assert.equal(sends, 0);

  storageAvailable = true;
  await outbox.enqueue(operation(ids.operation1));
  await outbox.flush(async (queued) => {
    sends += 1;
    return { clientOperationId: queued.clientOperationId, status: "acked" };
  });
  assert.equal(sends, 1);
});

test("workspace transport posts the canonical operation and requires the echoed acknowledgement id", async () => {
  const input = operation(ids.operation1);
  const requests = [];
  const controller = new AbortController();
  const response = await sendDrawingOperation(
    input,
    "/workspace",
    async (...args) => {
      requests.push(args);
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            ok: true,
            kind: "success",
            error: null,
            clientOperationId: ids.operation1,
            result: { operationId: ids.operation3 },
          };
        },
      };
    },
    controller.signal,
  );

  assert.deepEqual(response, {
    clientOperationId: ids.operation1,
    status: "acked",
  });
  assert.equal(requests[0][0], "/workspace");
  assert.equal(requests[0][1].method, "POST");
  assert.equal(requests[0][1].signal, controller.signal);
  assert.equal(requests[0][1].body.get("intent"), "apply_operation");
  assert.deepEqual(
    JSON.parse(requests[0][1].body.get("operation_json")),
    input,
  );

  await assert.rejects(
    sendDrawingOperation(input, "/workspace", async () => ({
      ok: true,
      status: 200,
      async json() {
        return {
          ok: true,
          kind: "success",
          clientOperationId: ids.operation2,
          result: {},
        };
      },
    })),
    /acknowledgement/i,
  );
});

test("transient RPC action failures remain retryable", async () => {
  await assert.rejects(
    sendDrawingOperation(operation(ids.operation1), "/workspace", async () => ({
      ok: false,
      status: 400,
      async json() {
        return {
          ok: false,
          kind: "rpc",
          error: "temporary database failure",
        };
      },
    })),
    /temporary database failure/,
  );
});

test("online reload resends an uncertain acknowledgement before recovery", async () => {
  const outbox = scopedOutbox(memoryAdapter());
  await outbox.enqueue(operation(ids.operation1));
  const committed = state();
  committed.objects[ids.object] = rectangle({ name: "Door", version: 2 });
  let sends = 0;

  const recovered = await restoreDrawingWorkspaceState({
    online: true,
    outbox,
    send: async (queued) => {
      sends += 1;
      return { clientOperationId: queued.clientOperationId, status: "acked" };
    },
    serverState: committed,
  });

  assert.equal(sends, 1);
  assert.equal(recovered.state.objects[ids.object].name, "Door");
  assert.deepEqual(await outbox.pending(), []);
  assert.deepEqual(recovered.ambiguousOperationIds, []);
});

test("online acknowledgement replays over the captured snapshot with server-current versions", async () => {
  const outbox = scopedOutbox(memoryAdapter());
  await outbox.enqueue(operation(ids.operation1));

  const recovered = await restoreDrawingWorkspaceState({
    online: true,
    outbox,
    send: async (queued) => ({
      clientOperationId: queued.clientOperationId,
      status: "acked",
    }),
    serverState: state(),
  });
  const next = applyDrawingCommand(recovered.state, {
    type: "update_objects",
    actorId: ids.ownerA,
    updates: [{ objectId: ids.object, patch: { name: "Door 2" } }],
  });

  assert.equal(recovered.state.objects[ids.object].name, "Door");
  assert.equal(recovered.state.objects[ids.object].version, 2);
  assert.deepEqual(next.operation.baseVersions, { [ids.object]: 2 });
  assert.equal(next.state.objects[ids.object].version, 3);
});

test("recovery skips an already represented ack then applies the next acknowledged operation", async () => {
  const outbox = scopedOutbox(memoryAdapter());
  const secondOperation = operation(ids.operation2, {
    baseVersions: { [ids.object]: 2 },
    forward: {
      type: "update_objects",
      updates: [{ objectId: ids.object, patch: { name: "Door 2" } }],
    },
    inverse: {
      type: "update_objects",
      updates: [{ objectId: ids.object, patch: { name: "Door" } }],
    },
  });
  await outbox.enqueue(operation(ids.operation1));
  await outbox.enqueue(secondOperation);
  const snapshot = state();
  snapshot.objects[ids.object] = rectangle({ name: "Door", version: 2 });

  const recovered = await restoreDrawingWorkspaceState({
    online: true,
    outbox,
    send: async (queued) => ({
      clientOperationId: queued.clientOperationId,
      status: "acked",
    }),
    serverState: snapshot,
  });
  const next = applyDrawingCommand(recovered.state, {
    type: "update_objects",
    actorId: ids.ownerA,
    updates: [{ objectId: ids.object, patch: { name: "Door 3" } }],
  });

  assert.equal(recovered.state.objects[ids.object].name, "Door 2");
  assert.equal(recovered.state.objects[ids.object].version, 3);
  assert.deepEqual(next.operation.baseVersions, { [ids.object]: 3 });
});

test("true acknowledged ambiguity restores durable conflict evidence", async () => {
  const outbox = scopedOutbox(memoryAdapter());
  await outbox.enqueue(operation(ids.operation1));
  const snapshot = state();
  snapshot.objects[ids.object] = rectangle({ name: "Other edit", version: 2 });

  const recovered = await restoreDrawingWorkspaceState({
    online: true,
    outbox,
    send: async (queued) => ({
      clientOperationId: queued.clientOperationId,
      status: "acked",
    }),
    serverState: snapshot,
  });

  assert.equal(recovered.state.objects[ids.object].name, "Other edit");
  assert.deepEqual(recovered.conflictedOperationIds, [ids.operation1]);
  assert.deepEqual(
    (await outbox.entries()).map((entry) => [
      entry.operation.clientOperationId,
      entry.status,
    ]),
    [[ids.operation1, "conflicted"]],
  );
});

test("IndexedDB upgrade preserves v1 records and installs close-on-versionchange", async () => {
  const record = {
    operation: operation(ids.operation1),
    status: "pending",
    retryCount: 0,
    clientOperationId: ids.operation1,
    revisionId: ids.revisionA,
    createdAt: operation(ids.operation1).createdAt,
  };
  const { factory, database, store } = fakeIndexedDb({ records: [record] });
  const adapter = createIndexedDbDrawingOutboxAdapter(factory);

  assert.deepEqual(
    (await adapter.list()).map((entry) => entry.operation),
    [operation(ids.operation1)],
  );
  assert.equal((await adapter.list())[0].ownerId, undefined);
  assert.equal(store.createdIndexes.includes("enqueue_sequence"), true);
  assert.equal(await adapter.claimLegacy(ids.revisionA, ids.ownerA), 1);
  assert.deepEqual(
    (await adapter.list()).map((entry) => [
      entry.ownerId,
      entry.enqueueSequence,
    ]),
    [[ids.ownerA, 1]],
  );
  database.onversionchange();
  assert.equal(database.closed, true);
});

test("legacy claim assigns sequences by causal v1 delivery order instead of UUID order", async () => {
  const laterByTime = operation(ids.operation1, {
    createdAt: "2026-08-24T02:00:00.000Z",
  });
  const earlierByTime = operation(ids.operation2, {
    createdAt: "2026-08-24T01:00:00.000Z",
  });
  const records = [
    {
      operation: laterByTime,
      status: "pending",
      retryCount: 0,
      clientOperationId: laterByTime.clientOperationId,
      revisionId: laterByTime.revisionId,
      createdAt: laterByTime.createdAt,
    },
    {
      operation: earlierByTime,
      status: "pending",
      retryCount: 0,
      clientOperationId: earlierByTime.clientOperationId,
      revisionId: earlierByTime.revisionId,
      createdAt: earlierByTime.createdAt,
    },
    {
      ownerId: ids.ownerB,
      enqueueSequence: 9,
      operation: operation(ids.operation3, { revisionId: ids.revisionB }),
      status: "pending",
      retryCount: 0,
      clientOperationId: ids.operation3,
      revisionId: ids.revisionB,
      createdAt: "2026-08-24T00:00:00.000Z",
    },
  ];
  const { factory } = fakeIndexedDb({ records });
  const adapter = createIndexedDbDrawingOutboxAdapter(factory);

  assert.equal(await adapter.claimLegacy(ids.revisionA, ids.ownerA), 2);
  const claimed = (await adapter.list()).filter(
    (entry) => entry.operation.revisionId === ids.revisionA,
  );
  assert.deepEqual(
    claimed.map((entry) => [
      entry.operation.clientOperationId,
      entry.ownerId,
      entry.enqueueSequence,
    ]),
    [
      [ids.operation1, ids.ownerA, 11],
      [ids.operation2, ids.ownerA, 10],
    ],
  );
  const untouched = (await adapter.list()).find(
    (entry) => entry.operation.revisionId === ids.revisionB,
  );
  assert.equal(untouched.ownerId, ids.ownerB);
  assert.equal(untouched.enqueueSequence, 9);
});

test("versionchange invalidates the cached handle and the adapter reopens", async () => {
  const { factory, database } = fakeIndexedDb();
  const adapter = createIndexedDbDrawingOutboxAdapter(factory);

  await adapter.list();
  database.onversionchange();
  await adapter.list();

  assert.equal(factory.openCalls, 2);
});

test("blocked IndexedDB initialization rejects and closes a late-success connection", async () => {
  const { factory, database, request } = fakeIndexedDb({ blocked: true });
  const adapter = createIndexedDbDrawingOutboxAdapter(factory);

  await assert.rejects(adapter.list(), /blocked/i);
  request.succeedLate();
  assert.equal(database.closed, true);
});

test("offline reload keeps a possibly committed operation pending without false conflict", async () => {
  const outbox = scopedOutbox(memoryAdapter());
  await outbox.enqueue(operation(ids.operation1));
  const committed = state();
  committed.objects[ids.object] = rectangle({ name: "Door", version: 2 });
  let sends = 0;

  const recovered = await restoreDrawingWorkspaceState({
    online: false,
    outbox,
    send: async (queued) => {
      sends += 1;
      return { clientOperationId: queued.clientOperationId, status: "acked" };
    },
    serverState: committed,
  });

  assert.equal(sends, 0);
  assert.deepEqual(recovered.conflictedOperationIds, []);
  assert.deepEqual(recovered.ambiguousOperationIds, [ids.operation1]);
  assert.deepEqual(
    (await outbox.entries()).map((entry) => entry.status),
    ["pending"],
  );
});

test("local persistence capability fails closed", () => {
  assert.equal(canPersistDrawingMutation("admin"), true);
  assert.equal(canPersistDrawingMutation("editor"), true);
  assert.equal(canPersistDrawingMutation("reviewer"), false);
  assert.equal(canPersistDrawingMutation("commenter"), false);
  assert.equal(canPersistDrawingMutation("viewer"), false);
  assert.equal(canPersistDrawingMutation("unknown"), false);
});

test("review preparation freezes edits before draining and confirms every scoped queue is empty", async () => {
  const events = [];
  const ready = await prepareDrawingReview({
    freeze() {
      events.push("freeze");
    },
    persistence: {
      async retry() {
        events.push("persistence");
        return true;
      },
      snapshot() {
        return { failed: false, volatileCount: 0 };
      },
    },
    async flush() {
      events.push("flush");
    },
    outbox: {
      async entries() {
        events.push("entries");
        return [];
      },
      async legacyEntries() {
        events.push("legacy");
        return [];
      },
    },
  });

  assert.equal(ready, true);
  assert.deepEqual(events, [
    "freeze",
    "persistence",
    "flush",
    "entries",
    "legacy",
  ]);
});

test("review preparation refuses pending, terminal, volatile, and quarantined work without submitting", async () => {
  for (const fixture of [
    {
      snapshot: { failed: false, volatileCount: 0 },
      entries: [{ status: "pending" }],
      legacy: [],
      retry: true,
    },
    {
      snapshot: { failed: false, volatileCount: 0 },
      entries: [{ status: "conflicted" }],
      legacy: [],
      retry: true,
    },
    {
      snapshot: { failed: true, volatileCount: 1 },
      entries: [],
      legacy: [],
      retry: false,
    },
    {
      snapshot: { failed: false, volatileCount: 0 },
      entries: [],
      legacy: [{}],
      retry: true,
    },
  ]) {
    let frozen = false;
    await assert.rejects(
      prepareDrawingReview({
        freeze() {
          frozen = true;
        },
        persistence: {
          async retry() {
            return fixture.retry;
          },
          snapshot() {
            return fixture.snapshot;
          },
        },
        async flush() {},
        outbox: {
          async entries() {
            return fixture.entries;
          },
          async legacyEntries() {
            return fixture.legacy;
          },
        },
      }),
      /검토 요청 전에.*저장|격리|충돌/i,
    );
    assert.equal(frozen, true);
  }
});

test("operation transport distinguishes terminal rejection from conflict on HTTP 409", async () => {
  for (const [kind, status] of [
    ["conflict", "conflicted"],
    ["rejected", "rejected"],
  ]) {
    const result = await sendDrawingOperation(
      operation(ids.operation1),
      "/workspace",
      async () => ({
        ok: false,
        status: 409,
        async json() {
          return { ok: false, kind, error: kind };
        },
      }),
    );
    assert.equal(result.status, status);
  }
});
