import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import * as Y from "yjs";
import * as server from "../collaboration/src/server.ts";
import { drawingFreezeManifest } from "../collaboration/src/freeze.ts";
import {
  appendDrawingCollaborationOperation,
  readDrawingCollaborationLedger,
} from "../app/lukas/lib/drawing-collaboration-yjs.ts";
import { drawingCollaborationOperationFromSnapshotOutcome } from "../app/lukas/lib/drawing-collaboration-protocol.ts";

async function fixture() {
  const scope = { projectId: randomUUID(), revisionId: randomUUID() };
  const doc = new Y.Doc();
  await server.initializeDrawingCollaborationDocument(doc, {
    ...scope,
    bootstrap: async () => ({ sha256: "a".repeat(64), operationSequence: 0 }),
  });
  return { doc, scope };
}
function native(scope, sequence = 1) {
  const blockId = randomUUID();
  return {
    revisionId: scope.revisionId,
    clientOperationId: randomUUID(),
    actorId: randomUUID(),
    operationType: "mutate_structure",
    baseVersions: {},
    forward: {
      type: "mutate_structure",
      actions: [
        {
          kind: "put_block",
          baseVersion: null,
          entity: {
            id: blockId,
            revisionId: scope.revisionId,
            name: "Native door",
            version: 1,
            primitives: [
              {
                localId: "line",
                name: "Line",
                geometry: {
                  type: "line",
                  start: { x: 0, y: 0 },
                  end: { x: 100, y: 0 },
                },
                style: { stroke: "#000000", strokeWidth: 1, fill: null },
                styleId: null,
              },
            ],
          },
        },
      ],
    },
    inverse: {
      type: "mutate_structure",
      actions: [{ kind: "delete_block", id: blockId, baseVersion: 1 }],
    },
    historyAction: null,
    originalOperationId: null,
    sequence,
    resultVersions: { [blockId]: 1 },
  };
}
function envelope(row) {
  return drawingCollaborationOperationFromSnapshotOutcome({
    ...row,
    historyAction: undefined,
    originalOperationId: undefined,
  });
}
function ack(doc, row) {
  doc.getMap("operationStatus").set(row.clientOperationId, {
    operationId: row.clientOperationId,
    status: "acked",
    authoritativeSequence: row.sequence,
    resultVersions: row.resultVersions,
  });
}

test("native reconciliation fills missing sequence without rebasing or losing a client operation and reaches peers", async () => {
  assert.equal(typeof server.reconcileNativeDrawingOperations, "function");
  const { doc, scope } = await fixture();
  const imported = native(scope);
  const local = native(scope, 2);
  const localEnvelope = {
    ...envelope(local),
    createdAt: "2026-09-05T00:00:00.000Z",
  };
  appendDrawingCollaborationOperation(doc, localEnvelope);
  ack(doc, local);
  const peer = new Y.Doc();
  Y.applyUpdate(peer, Y.encodeStateAsUpdate(doc));
  doc.on("update", (update) => Y.applyUpdate(peer, update));
  const lookup = async (actual, after) => {
    assert.deepEqual(actual, scope);
    assert.equal(after, 0);
    return [imported];
  };
  assert.equal(
    await server.reconcileNativeDrawingOperations(doc, lookup),
    true,
  );
  assert.equal(
    await server.reconcileNativeDrawingOperations(doc, lookup),
    false,
  );
  assert.equal(doc.getMap("serverMeta").get("baseOperationSequence"), 0);
  assert.deepEqual(
    readDrawingCollaborationLedger(doc).operations[local.clientOperationId],
    localEnvelope,
  );
  assert.deepEqual(
    drawingFreezeManifest(peer).operations.map((o) => o.sequence),
    [1, 2],
  );
  const restarted = new Y.Doc();
  Y.applyUpdate(restarted, Y.encodeStateAsUpdate(doc));
  assert.equal(
    await server.reconcileNativeDrawingOperations(restarted, lookup),
    false,
  );
  doc.destroy();
  peer.destroy();
  restarted.destroy();
});

test("native reconciliation preserves pending work and rejects identity or status collisions atomically", async () => {
  for (const collision of ["durable", "status", "sequence", "scope"]) {
    const { doc, scope } = await fixture();
    const row = native(scope);
    const other = native(scope, 2);
    const pending = { ...envelope(row), createdAt: "2026-09-05T00:00:00.000Z" };
    appendDrawingCollaborationOperation(doc, pending);
    if (collision === "status")
      doc.getMap("operationStatus").set(row.clientOperationId, {
        operationId: row.clientOperationId,
        status: "rejected",
        authoritativeSequence: null,
        resultVersions: {},
      });
    if (collision === "sequence") {
      appendDrawingCollaborationOperation(doc, envelope(other));
      ack(doc, { ...other, sequence: 1 });
    }
    const before = Y.encodeStateAsUpdate(doc);
    const bad =
      collision === "durable"
        ? { ...row, actorId: randomUUID() }
        : collision === "scope"
          ? { ...row, revisionId: randomUUID() }
          : row;
    await assert.rejects(() =>
      server.reconcileNativeDrawingOperations(doc, async () => [bad]),
    );
    assert.deepEqual(Y.encodeStateAsUpdate(doc), before, collision);
    doc.destroy();
  }
  const { doc, scope } = await fixture();
  const imported = native(scope);
  const pending = native(scope, 2);
  appendDrawingCollaborationOperation(doc, {
    ...envelope(pending),
    createdAt: "2026-09-05T00:00:00.000Z",
  });
  await server.reconcileNativeDrawingOperations(doc, async () => [imported]);
  assert.equal(
    doc.getMap("operationStatus").has(pending.clientOperationId),
    false,
  );
  assert.throws(() => drawingFreezeManifest(doc));
  doc.destroy();
  const exact = await fixture();
  const row = native(exact.scope);
  const original = { ...envelope(row), createdAt: "2026-09-05T00:00:00.000Z" };
  appendDrawingCollaborationOperation(exact.doc, original);
  await server.reconcileNativeDrawingOperations(exact.doc, async () => [row]);
  assert.deepEqual(
    readDrawingCollaborationLedger(exact.doc).operations[row.clientOperationId],
    original,
    "exact pending envelope keeps its real client clock",
  );
  assert.equal(drawingFreezeManifest(exact.doc).count, 1);
  exact.doc.destroy();
});

test("native range pagination is complete and invalid or over-limit pages leave the ledger unchanged", async () => {
  const { doc, scope } = await fixture();
  const rows = Array.from({ length: 257 }, (_, i) => native(scope, i + 1));
  const cursors = [];
  await server.reconcileNativeDrawingOperations(doc, async (_, after) => {
    cursors.push(after);
    return rows.filter((r) => r.sequence > after).slice(0, 256);
  });
  assert.deepEqual(cursors, [0, 256]);
  assert.equal(drawingFreezeManifest(doc).count, 257);
  doc.destroy();
  for (const mode of ["unsorted", "oversized", "overflow"]) {
    const { doc, scope } = await fixture();
    const before = Y.encodeStateAsUpdate(doc);
    await assert.rejects(() =>
      server.reconcileNativeDrawingOperations(doc, async (_, after) =>
        mode === "unsorted"
          ? [native(scope, 2), native(scope, 1)]
          : Array.from({ length: mode === "oversized" ? 257 : 256 }, (_, i) =>
              native(scope, after + i + 1),
            ),
      ),
    );
    assert.deepEqual(Y.encodeStateAsUpdate(doc), before, mode);
    doc.destroy();
  }
});

test("native lookup cannot cross a room freeze boundary or mutate a frozen room", async () => {
  const { doc, scope } = await fixture();
  const row = native(scope);
  await assert.rejects(
    () =>
      server.reconcileNativeDrawingOperations(doc, async () => {
        doc.getMap("serverMeta").set("freezeState", "freezing");
        doc.getMap("serverMeta").set("freezeRequestId", randomUUID());
        return [row];
      }),
    /boundary changed/,
  );
  assert.equal(doc.getArray("operations").length, 0);
  doc.getMap("serverMeta").set("freezeState", "frozen");
  assert.equal(
    await server.reconcileNativeDrawingOperations(doc, async () => {
      throw new Error("frozen lookup forbidden");
    }),
    false,
  );
  doc.destroy();
});
