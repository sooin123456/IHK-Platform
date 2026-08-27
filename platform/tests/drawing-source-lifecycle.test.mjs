import assert from "node:assert/strict";
import test from "node:test";

import * as Y from "yjs";

import {
  applyDrawingCommand,
  createDrawingCheckpointRestoreCommand,
  createDrawingDocumentState,
} from "../app/lukas/lib/drawing-commands.ts";
import {
  DRAWING_COLLABORATION_COLLECTIONS,
  DRAWING_COLLABORATION_SCHEMA_VERSION,
} from "../app/lukas/lib/drawing-collaboration-protocol.ts";
import {
  createDrawingOutbox,
  recoverPendingDrawingState,
} from "../app/lukas/lib/drawing-outbox.ts";
import {
  linkDrawingPdfRegionSourceCommand,
  unlinkDrawingObjectSourceCommand,
} from "../app/lukas/lib/drawing-source-links.ts";
import { DrawingOperationInputSchema } from "../app/lukas/lib/drawing-workspace.types.ts";
import { createDrawingDraftAdapter } from "../app/lukas/lib/drawing-yjs-draft.ts";

const ids = Object.fromEntries(
  [
    "project",
    "revision",
    "page",
    "canvas",
    "layer",
    "object",
    "source",
    "source2",
    "file",
    "actor",
    "linkOperation",
    "unlinkOperation",
    "checkpoint",
  ].map((name, index) => [
    name,
    `30000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
  ]),
);
const sha = "c".repeat(64);

function object() {
  return {
    id: ids.object,
    name: "Source target",
    layerId: ids.layer,
    geometry: {
      type: "rectangle",
      origin: { x: 0, y: 0 },
      width: 10,
      height: 10,
      rotation: 0,
    },
    style: { stroke: "#111111", strokeWidth: 1, fill: null },
    version: 1,
  };
}

function source(id = ids.source) {
  return {
    id,
    objectId: ids.object,
    revisionId: ids.revision,
    sourceFileId: ids.file,
    sourceSha256: sha,
    sourceKind: "pdf_region",
    pdfPageNumber: 1,
    x: 0.1,
    y: 0.2,
    width: 0.3,
    height: 0.4,
    version: 1,
  };
}

function state({ includeObject = true, sources = {} } = {}) {
  return createDrawingDocumentState({
    revisionId: ids.revision,
    structure: {
      pages: {
        [ids.page]: {
          id: ids.page,
          revisionId: ids.revision,
          name: "A1",
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
          canvasId: ids.canvas,
          sortOrder: 0,
          version: 1,
        },
      },
      objects: includeObject ? { [ids.object]: object() } : {},
      sources,
      styles: {},
      blocks: {},
      blockInstances: {},
      propertySchemas: {},
      propertyValues: {},
      tables: {},
    },
  });
}

function linkCommand(base, sourceId = ids.source) {
  return linkDrawingPdfRegionSourceCommand(base, ids.actor, ids.object, {
    id: sourceId,
    sourceFileId: ids.file,
    sourceSha256: sha,
    pdfPageNumber: 1,
    x: 0.1,
    y: 0.2,
    width: 0.3,
    height: 0.4,
  });
}

function applied(base, command, operationId) {
  return applyDrawingCommand(base, command, {
    createId: () => operationId,
    now: () => "2026-08-27T00:00:00.000Z",
  });
}

function initializedDocument() {
  const document = new Y.Doc();
  document.transact(() => {
    const meta = document.getMap("serverMeta");
    meta.set("schemaVersion", DRAWING_COLLABORATION_SCHEMA_VERSION);
    meta.set("projectId", ids.project);
    meta.set("revisionId", ids.revision);
    meta.set("baseSnapshotSha256", "d".repeat(64));
    meta.set("baseOperationSequence", 0);
    meta.set("freezeState", "active");
    meta.set("freezeRequestId", null);
    document.getArray("operationOrder");
    document.getArray("operations");
    document.getMap("operationStatus");
  });
  return document;
}

function memoryOutboxAdapter() {
  const records = new Map();
  let sequence = 0;
  return {
    async claimLegacy() {
      return 0;
    },
    async delete(id) {
      records.delete(id);
    },
    async enqueue(entry) {
      const stored = { ...entry, enqueueSequence: ++sequence };
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
}

test("source operations reuse the v1 four-collection Yjs ledger and project once", () => {
  const base = state();
  const document = initializedDocument();
  const adapter = createDrawingDraftAdapter({
    document,
    authoritativeState: base,
    actorId: ids.actor,
    authorization: "editor",
    frozen: false,
    createId: () => ids.linkOperation,
    now: () => "2026-08-27T00:00:00.000Z",
  });
  const prepared = adapter.prepareLocal(linkCommand(base));
  assert.equal(prepared.operation.schemaVersion, 1);
  assert.equal(prepared.operation.type, "mutate_structure");
  assert.equal(prepared.operation.forward.actions[0].kind, "put_source");
  assert.equal(adapter.appendDurableLocal(prepared), true);
  assert.deepEqual(adapter.getSnapshot().state.structure.sources, {
    [ids.source]: source(),
  });
  assert.deepEqual(
    [...document.share.keys()].sort(),
    DRAWING_COLLABORATION_COLLECTIONS,
  );
  assert.equal(document.share.has("sources"), false);
  adapter.dispose();
  document.destroy();
});

test("same-triple concurrent source contributions use the existing conflict projection", () => {
  const base = state();
  const first = applied(base, linkCommand(base), ids.linkOperation);
  const second = applied(
    base,
    linkCommand(base, ids.source2),
    ids.unlinkOperation,
  );
  const document = initializedDocument();
  const adapter = createDrawingDraftAdapter({
    document,
    authoritativeState: base,
    actorId: ids.actor,
    authorization: "editor",
    frozen: false,
  });
  assert.equal(
    adapter.appendDurableLocal(adapter.prepareRecordedLocal(first.operation)),
    true,
  );
  assert.equal(
    adapter.appendDurableLocal(adapter.prepareRecordedLocal(second.operation)),
    true,
  );
  assert.deepEqual(adapter.getSnapshot().pendingOperationIds, [
    ids.linkOperation,
    ids.unlinkOperation,
  ]);
  assert.deepEqual(adapter.getSnapshot().provisionalConflictOperationIds, [
    ids.unlinkOperation,
  ]);
  assert.deepEqual(adapter.getSnapshot().state.structure.sources, {
    [ids.source]: source(),
  });
  adapter.dispose();
  document.destroy();
});

test("outbox crash recovery replays link then unlink without losing evidence versions", () => {
  const base = state();
  const linked = applied(base, linkCommand(base), ids.linkOperation);
  const unlinked = applied(
    linked.state,
    unlinkDrawingObjectSourceCommand(linked.state, ids.actor, ids.source),
    ids.unlinkOperation,
  );

  const recoveryScope = {
    trustedOwnerId: ids.actor,
    revisionId: ids.revision,
  };
  const afterLink = recoverPendingDrawingState(
    base,
    [linked.operation],
    recoveryScope,
  );
  assert.deepEqual(afterLink.conflictedOperationIds, []);
  assert.deepEqual(afterLink.ambiguousOperationIds, []);
  assert.deepEqual(afterLink.state.structure.sources, {
    [ids.source]: source(),
  });

  const afterUnlink = recoverPendingDrawingState(base, [
    linked.operation,
    unlinked.operation,
  ], recoveryScope);
  assert.deepEqual(afterUnlink.conflictedOperationIds, []);
  assert.deepEqual(afterUnlink.ambiguousOperationIds, []);
  assert.deepEqual(afterUnlink.state.structure.sources, {});
  assert.equal(afterUnlink.state.structure.tombstones[ids.source].version, 2);
});

test("source outbox retry resends the unchanged v1 structure operation", async () => {
  const linked = applied(state(), linkCommand(state()), ids.linkOperation);
  const scheduled = [];
  const sent = [];
  const outbox = createDrawingOutbox(memoryOutboxAdapter(), {
    ownerId: ids.actor,
    revisionId: ids.revision,
    schedule(delayMs, retry) {
      scheduled.push({ delayMs, retry });
    },
  });
  await outbox.enqueue(linked.operation);
  let attempt = 0;
  const send = async (operation) => {
    sent.push(structuredClone(operation));
    attempt += 1;
    if (attempt === 1) throw new Error("offline");
    return {
      clientOperationId: operation.clientOperationId,
      status: "acked",
    };
  };
  await assert.rejects(outbox.flush(send), /offline/);
  assert.equal(scheduled[0].delayMs, 1000);
  await scheduled[0].retry();
  const canonical = DrawingOperationInputSchema.parse(linked.operation);
  assert.deepEqual(sent, [canonical, canonical]);
  assert.equal(sent[1].forward.actions[0].kind, "put_source");
  assert.deepEqual(await outbox.pending(), []);
  outbox.dispose();
});

test("checkpoint restore orders object/source additions and source/object deletions safely", () => {
  const empty = state({ includeObject: false });
  const linked = state({ sources: { [ids.source]: source() } });

  const additions = createDrawingCheckpointRestoreCommand(
    empty,
    linked,
    ids.actor,
    ids.checkpoint,
  );
  assert.deepEqual(
    additions.actions
      .filter((action) => ["put_object", "put_source"].includes(action.kind))
      .map((action) => action.kind),
    ["put_object", "put_source"],
  );
  const added = applied(empty, additions, ids.linkOperation);
  assert.deepEqual(added.state.structure.sources, { [ids.source]: source() });

  const deletions = createDrawingCheckpointRestoreCommand(
    linked,
    empty,
    ids.actor,
    ids.checkpoint,
  );
  assert.deepEqual(
    deletions.actions
      .filter((action) =>
        ["delete_source", "delete_object"].includes(action.kind),
      )
      .map((action) => action.kind),
    ["delete_source", "delete_object"],
  );
  const deleted = applied(linked, deletions, ids.unlinkOperation);
  assert.deepEqual(deleted.state.structure.sources, {});
  assert.deepEqual(deleted.state.objects, {});
});

test("checkpoint relink releases the active source triple before its replacement", () => {
  const current = state({ sources: { [ids.source2]: source(ids.source2) } });
  const checkpoint = state({ sources: { [ids.source]: source(ids.source) } });
  const command = createDrawingCheckpointRestoreCommand(
    current,
    checkpoint,
    ids.actor,
    ids.checkpoint,
  );
  assert.deepEqual(command.actions, [
    { kind: "delete_source", id: ids.source2, baseVersion: 1 },
    {
      kind: "put_source",
      entity: source(ids.source),
      baseVersion: null,
    },
  ]);
  const restored = applied(current, command, ids.linkOperation);
  assert.deepEqual(restored.state.structure.sources, {
    [ids.source]: source(ids.source),
  });
  assert.deepEqual(restored.operation.inverse.actions, [
    { kind: "delete_source", id: ids.source, baseVersion: 1 },
    {
      kind: "put_source",
      entity: source(ids.source2),
      baseVersion: null,
    },
  ]);
});
