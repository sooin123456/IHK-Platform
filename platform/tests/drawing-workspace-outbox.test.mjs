import assert from "node:assert/strict";
import test from "node:test";

import {
  createDrawingOutbox,
  drawingSaveStatus,
  recoverPendingDrawingState,
  sendDrawingOperation,
} from "../app/lukas/lib/drawing-outbox.client.ts";
import { createDrawingDocumentState } from "../app/lukas/lib/drawing-commands.ts";

const ids = {
  revisionA: "00000000-0000-4000-8000-000000000001",
  revisionB: "00000000-0000-4000-8000-000000000002",
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
  return {
    async delete(clientOperationId) {
      events.push(`delete:${clientOperationId}`);
      records.delete(clientOperationId);
    },
    async list() {
      return structuredClone([...records.values()]);
    },
    async put(record) {
      events.push(`put:${record.operation.clientOperationId}`);
      records.set(record.operation.clientOperationId, structuredClone(record));
    },
  };
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
  const outbox = createDrawingOutbox(memoryAdapter(events));
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

test("enqueue rejects a malformed nested operation before durable storage", async () => {
  const events = [];
  const outbox = createDrawingOutbox(memoryAdapter(events));
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
  const outbox = createDrawingOutbox(memoryAdapter());
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

test("flush orders each revision and a conflict blocks only that revision", async () => {
  const outbox = createDrawingOutbox(memoryAdapter());
  await outbox.enqueue(
    operation(ids.operation2, { createdAt: "2026-08-24T02:00:00.000Z" }),
  );
  await outbox.enqueue(
    operation(ids.operation1, { createdAt: "2026-08-24T01:00:00.000Z" }),
  );
  await outbox.enqueue(
    operation(ids.operation3, {
      revisionId: ids.revisionB,
      createdAt: "2026-08-24T00:30:00.000Z",
    }),
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

  assert.deepEqual(sent, [ids.operation1, ids.operation3]);
  assert.deepEqual(
    (await outbox.entries()).map(({ operation: queued, status }) => [
      queued.clientOperationId,
      status,
    ]),
    [
      [ids.operation1, "conflicted"],
      [ids.operation2, "pending"],
    ],
  );
});

test("connection failures retain data and schedule bounded exponential retries", async () => {
  const scheduled = [];
  const outbox = createDrawingOutbox(memoryAdapter(), {
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
  const outbox = createDrawingOutbox(memoryAdapter());
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

test("reload recovery applies matching pending operations and reports stale bases", () => {
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
  assert.deepEqual(stale.conflictedOperationIds, [ids.operation1]);
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
  assert.deepEqual(recovered.conflictedOperationIds, [ids.operation1]);
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
    "오프라인 저장",
  );
});

test("workspace transport posts the canonical operation and requires the echoed acknowledgement id", async () => {
  const input = operation(ids.operation1);
  const requests = [];
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
  );

  assert.deepEqual(response, {
    clientOperationId: ids.operation1,
    status: "acked",
  });
  assert.equal(requests[0][0], "/workspace");
  assert.equal(requests[0][1].method, "POST");
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
