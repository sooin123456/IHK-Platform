import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";

import { createServer } from "vite";

const ids = {
  actor: "00000000-0000-4000-8000-000000000001",
  canvas: "00000000-0000-4000-8000-000000000002",
  comment: "00000000-0000-4000-8000-000000000003",
  issue: "00000000-0000-4000-8000-000000000004",
  member: "00000000-0000-4000-8000-000000000005",
  operation: "00000000-0000-4000-8000-000000000006",
  page: "00000000-0000-4000-8000-000000000007",
  project: "00000000-0000-4000-8000-000000000008",
  revision: "00000000-0000-4000-8000-000000000009",
};

const vite = await createServer({
  appType: "custom",
  configFile: false,
  logLevel: "silent",
  resolve: {
    alias: { "~": fileURLToPath(new URL("../app", import.meta.url)) },
  },
  server: { middlewareMode: true },
});
const collaboration = await vite.ssrLoadModule(
  "/app/lukas/lib/drawing-collaboration.server.ts",
);
const workspace = await vite.ssrLoadModule(
  "/app/lukas/components/drawing-workspace.tsx",
);
const drawingCommands = await vite.ssrLoadModule(
  "/app/lukas/lib/drawing-commands.ts",
);
const drawingHistory = await vite.ssrLoadModule(
  "/app/lukas/lib/drawing-history.server.ts",
);

after(() => vite.close());

test("comment form keeps only explicit mention-picker UUID selections", () => {
  const form = new FormData();
  form.set("intent", "comment");
  form.set("issue_id", ids.issue);
  form.set("comment_id", ids.comment);
  form.set("body", "@임의문구와 선택 멤버");
  form.set("mentioned_user_ids", JSON.stringify([ids.member, ids.member]));
  assert.deepEqual(collaboration.parseDrawingMutationForm(form), {
    intent: "comment",
    issueId: ids.issue,
    commentId: ids.comment,
    body: "@임의문구와 선택 멤버",
    mentionedUserIds: [ids.member],
  });
});

test("canvas region form accepts signed finite world millimeters only", () => {
  const form = new FormData();
  form.set("intent", "add_canvas_region_anchor");
  form.set("issue_id", ids.issue);
  form.set("anchor_id", ids.comment);
  form.set("revision_id", ids.revision);
  form.set("page_id", ids.page);
  form.set("canvas_id", ids.canvas);
  form.set("x_mm", "-10.5");
  form.set("y_mm", "-2");
  form.set("width_mm", "30");
  form.set("height_mm", "20");
  form.set("label", "서측 영역");
  assert.deepEqual(collaboration.parseDrawingMutationForm(form), {
    intent: "add_canvas_region_anchor",
    issueId: ids.issue,
    anchorId: ids.comment,
    revisionId: ids.revision,
    pageId: ids.page,
    canvasId: ids.canvas,
    xMm: -10.5,
    yMm: -2,
    widthMm: 30,
    heightMm: 20,
    label: "서측 영역",
  });

  form.set("width_mm", "Infinity");
  assert.throws(() => collaboration.parseDrawingMutationForm(form));
});

test("workspace tab order exposes collaboration and bounded history panels", () => {
  assert.equal(
    workspace.resolveDrawingWorkspacePanelKey("blocks", "ArrowRight"),
    "collaboration",
  );
  assert.equal(
    workspace.resolveDrawingWorkspacePanelKey("collaboration", "ArrowRight"),
    "history",
  );
  assert.equal(
    workspace.resolveDrawingWorkspacePanelKey("history", "ArrowRight"),
    "structure",
  );
});

test("activity history uses bounded independent keyset cursors", async () => {
  const calls = [];
  const rows = {
    lukas_drawing_operations: [
      {
        id: ids.operation,
        revision_id: ids.revision,
        actor_id: ids.actor,
        operation_type: "update_objects",
        forward: { type: "update_objects" },
        history_action: null,
        original_operation_id: null,
        created_at: "2026-08-26T00:00:00.000Z",
      },
    ],
    lukas_drawing_issue_events: [],
  };
  const client = {
    from(table) {
      const query = {
        select() {
          return query;
        },
        eq(column, value) {
          calls.push([table, "eq", column, value]);
          return query;
        },
        gt(column, value) {
          calls.push([table, "gt", column, value]);
          return query;
        },
        order() {
          return query;
        },
        async limit(value) {
          calls.push([table, "limit", value]);
          return { data: rows[table], error: null };
        },
      };
      return query;
    },
  };
  const cursor = drawingHistory.encodeDrawingHistoryCursor({
    operationId: ids.comment,
    eventId: ids.canvas,
  });
  const page = await drawingHistory.loadDrawingActivityPage(
    client,
    ids.project,
    ids.revision,
    { cursor, limit: 10 },
  );
  assert.equal(page.items.length, 1);
  assert.ok(
    calls.some(
      (call) =>
        call.join(":") === `lukas_drawing_operations:gt:id:${ids.comment}`,
    ),
  );
  assert.ok(
    calls.some(
      (call) => call.join(":") === "lukas_drawing_operations:limit:11",
    ),
  );
  assert.ok(
    calls.some(
      (call) =>
        call.join(":") === `lukas_drawing_issue_events:gt:id:${ids.canvas}`,
    ),
  );
  await assert.rejects(
    drawingHistory.loadDrawingActivityPage(client, ids.project, ids.revision, {
      limit: 51,
    }),
  );
});

function rectangle(name = "Before", version = 1) {
  return {
    id: ids.comment,
    name,
    layerId: ids.member,
    geometry: {
      type: "rectangle",
      origin: { x: 0, y: 0 },
      width: 10,
      height: 20,
      rotation: 0,
    },
    styleId: null,
    style: { stroke: "#111111", strokeWidth: 1, fill: null },
    version,
  };
}

function basicState() {
  return drawingCommands.createDrawingDocumentState({
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
          widthMillimeters: 420,
          heightMillimeters: 297,
          background: null,
          sortOrder: 0,
          version: 1,
        },
      },
      layers: {
        [ids.member]: {
          id: ids.member,
          name: "Work",
          visible: true,
          locked: false,
          systemKind: "work",
          canvasId: ids.canvas,
          sortOrder: 0,
          version: 1,
        },
      },
      objects: { [ids.comment]: rectangle() },
      styles: {},
      blocks: {},
      blockInstances: {},
      propertySchemas: {},
      propertyValues: {},
      tables: {},
    },
  });
}

test("single-operation revert refuses another actor and stale dependencies", () => {
  const first = drawingCommands.applyDrawingCommand(
    basicState(),
    {
      type: "update_objects",
      actorId: ids.actor,
      updates: [{ objectId: ids.comment, patch: { name: "First" } }],
    },
    { createId: () => ids.operation, now: () => "2026-08-26T00:00:00.000Z" },
  );
  const second = drawingCommands.applyDrawingCommand(first.state, {
    type: "update_objects",
    actorId: ids.actor,
    updates: [{ objectId: ids.comment, patch: { name: "Second" } }],
  });
  assert.throws(() =>
    drawingCommands.revertDrawingOperation(
      second.state,
      ids.member,
      ids.operation,
    ),
  );
  assert.deepEqual(
    drawingCommands.revertDrawingOperation(
      second.state,
      ids.actor,
      ids.operation,
    ),
    { kind: "conflict", objectIds: [ids.comment] },
  );
  const reverted = drawingCommands.revertDrawingOperation(
    first.state,
    ids.actor,
    ids.operation,
    { createId: () => ids.canvas, now: () => "2026-08-26T00:01:00.000Z" },
  );
  assert.equal(reverted.operation.originalOperationId, ids.operation);
  assert.equal(reverted.operation.historyAction, "undo");
  assert.equal(reverted.state.objects[ids.comment].name, "Before");
});

test("checkpoint restore emits one exact compound delta with current versions", () => {
  const current = basicState();
  const target = structuredClone(current);
  target.objects[ids.comment] = rectangle("Checkpoint", 1);
  const applied = drawingCommands.applyDrawingCommand(
    current,
    drawingCommands.createDrawingCheckpointRestoreCommand(
      current,
      target,
      ids.actor,
      ids.operation,
    ),
  );
  assert.equal(applied.operation.type, "restore_checkpoint");
  assert.equal(applied.operation.baseVersions[ids.comment], 1);
  assert.equal(applied.state.objects[ids.comment].name, "Checkpoint");
  assert.equal(applied.state.objects[ids.comment].version, 2);
  assert.equal(applied.operation.forward.actions.length, 1);
});
