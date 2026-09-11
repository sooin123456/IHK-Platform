import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
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
const drawingAwareness = await vite.ssrLoadModule(
  "/app/lukas/lib/drawing-awareness.ts",
);
const drawingHistory = await vite.ssrLoadModule(
  "/app/lukas/lib/drawing-history.server.ts",
);
const workspaceView = await vite.ssrLoadModule(
  "/app/lukas/lib/drawing-workspace-view.ts",
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

test("canvas region comments use the exact shared role allow-list", async () => {
  assert.equal(typeof workspaceView.drawingWorkspaceCanComment, "function");
  for (const capability of ["admin", "editor", "commenter", "reviewer"])
    assert.equal(workspaceView.drawingWorkspaceCanComment(capability), true);
  for (const capability of ["approver", "viewer"])
    assert.equal(workspaceView.drawingWorkspaceCanComment(capability), false);

  const source = await readFile(
    new URL("../app/lukas/components/drawing-workspace.tsx", import.meta.url),
    "utf8",
  );
  assert.match(source, /drawingWorkspaceCanComment\(effectiveCapability\)/);
  assert.match(source, /캔버스에서 영역 선택/);
  assert.match(source, /regionPicker=/);
});

test("workspace issue creation uses the exact shared comment authority", () => {
  for (const role of ["admin", "editor", "commenter", "reviewer"])
    assert.equal(workspaceView.drawingWorkspaceCanComment(role), true);
  for (const role of ["approver", "viewer"])
    assert.equal(workspaceView.drawingWorkspaceCanComment(role), false);
});

test("visible canvas region annotations require the exact revision page and canvas boundary", () => {
  assert.equal(
    typeof workspace.drawingVisibleCanvasRegionAnnotations,
    "function",
  );
  const matching = {
    id: "matching",
    issue_id: ids.issue,
    revision_id: ids.revision,
    page_id: ids.page,
    canvas_id: ids.canvas,
    x_mm: -12.5,
    y_mm: 24,
    width_mm: 80,
    height_mm: 45.5,
    label: "",
  };
  const annotations = workspace.drawingVisibleCanvasRegionAnnotations({
    anchors: [
      matching,
      { ...matching, id: "wrong-revision", revision_id: "other" },
      { ...matching, id: "wrong-page", page_id: "other" },
      { ...matching, id: "wrong-canvas", canvas_id: "other" },
      {
        ...matching,
        id: "unknown-issue",
        issue_id: "unknown",
        label: "",
      },
    ],
    canvasId: ids.canvas,
    issues: [{ id: ids.issue, title: "외벽 개구부 확인" }],
    pageId: ids.page,
    revisionId: ids.revision,
    selectedIssueId: ids.issue,
  });

  assert.deepEqual(annotations, [
    {
      id: "matching",
      issueId: ids.issue,
      label: "외벽 개구부 확인",
      x: -12.5,
      y: 24,
      width: 80,
      height: 45.5,
      selected: true,
    },
    {
      id: "unknown-issue",
      issueId: "unknown",
      label: "이슈 영역",
      x: -12.5,
      y: 24,
      width: 80,
      height: 45.5,
      selected: false,
    },
  ]);
});

test("a locally created issue wins selection once and later realtime issues preserve manual selection", () => {
  assert.equal(
    typeof workspace.transitionDrawingWorkspaceIssueSelection,
    "function",
  );
  const transition = workspace.transitionDrawingWorkspaceIssueSelection;
  const beforeCreatedIssueIsVisible = transition(
    { consumedCreatedIssueId: null, selectedIssueId: "existing" },
    { createdIssueId: "created", issues: [{ id: "existing" }] },
  );
  assert.deepEqual(beforeCreatedIssueIsVisible, {
    consumedCreatedIssueId: null,
    selectedIssueId: "existing",
  });

  const createdIssueBecomesVisible = transition(beforeCreatedIssueIsVisible, {
    createdIssueId: "created",
    issues: [{ id: "created" }, { id: "existing" }],
  });
  assert.deepEqual(createdIssueBecomesVisible, {
    consumedCreatedIssueId: "created",
    selectedIssueId: "created",
  });

  assert.deepEqual(
    transition(
      { ...createdIssueBecomesVisible, selectedIssueId: "existing" },
      {
        createdIssueId: "created",
        issues: [{ id: "unrelated" }, { id: "created" }, { id: "existing" }],
      },
    ),
    {
      consumedCreatedIssueId: "created",
      selectedIssueId: "existing",
    },
  );
});

test("whole issue selection is a pure repeatable React state transition", () => {
  assert.equal(
    typeof workspace.transitionDrawingWorkspaceIssueSelection,
    "function",
  );
  const transition = workspace.transitionDrawingWorkspaceIssueSelection;
  const current = {
    consumedCreatedIssueId: null,
    selectedIssueId: "existing",
  };
  const input = {
    createdIssueId: "created",
    issues: [{ id: "created" }, { id: "existing" }],
  };
  const expected = {
    consumedCreatedIssueId: "created",
    selectedIssueId: "created",
  };

  assert.deepEqual(transition(current, input), expected);
  assert.deepEqual(transition(current, input), expected);
  assert.notEqual(transition(current, input), current);
  assert.deepEqual(current, {
    consumedCreatedIssueId: null,
    selectedIssueId: "existing",
  });
  assert.equal(
    transition(current, {
      createdIssueId: null,
      issues: [{ id: "existing" }],
    }),
    current,
  );
});

test("canvas region picker ownership is bound to the exact capability and canvas boundary", () => {
  const boundary = {
    capability: "editor",
    issueId: ids.issue,
    revisionId: ids.revision,
    pageId: ids.page,
    canvasId: ids.canvas,
  };
  const key = workspace.drawingCanvasRegionPickerBoundaryKey(boundary);
  assert.equal(
    workspace.drawingCanvasRegionPickerIsArmed({
      armedBoundaryKey: key,
      currentBoundaryKey: key,
      canArm: true,
    }),
    true,
  );
  for (const changed of [
    { ...boundary, capability: "reviewer" },
    { ...boundary, issueId: ids.comment },
    { ...boundary, revisionId: ids.comment },
    { ...boundary, pageId: ids.comment },
    { ...boundary, canvasId: ids.comment },
  ])
    assert.equal(
      workspace.drawingCanvasRegionPickerIsArmed({
        armedBoundaryKey: key,
        currentBoundaryKey:
          workspace.drawingCanvasRegionPickerBoundaryKey(changed),
        canArm: true,
      }),
      false,
    );
  assert.equal(
    workspace.drawingCanvasRegionPickerBoundaryKey({
      ...boundary,
      pageId: null,
    }),
    null,
  );
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

test("activity history pages stay bounded while large operations use summary-only details", async () => {
  const calls = [];
  const largeOperationBody = {
    type: "add_objects",
    objects: Array.from({ length: 100 }, (_, index) => ({
      id: `object-${index}`,
      name: `운반되면 안 되는 원본 객체 ${index}`,
      geometry: {
        type: "rectangle",
        x: index,
        y: index,
        width: 10,
        height: 5,
      },
      style: { stroke: "#111827", fill: "#f8fafc", strokeWidth: 1 },
    })),
  };
  const rows = {
    lukas_drawing_operations: Array.from({ length: 11 }, (_, index) => ({
      id: `00000000-0000-4000-8000-${String(100 + index).padStart(12, "0")}`,
      client_operation_id: `00000000-0000-4000-9000-${String(100 + index).padStart(12, "0")}`,
      revision_id: ids.revision,
      actor_id: ids.actor,
      operation_type: "update_objects",
      forward: index === 0 ? largeOperationBody : { type: "update_objects" },
      history_action: null,
      original_operation_id: null,
      created_at: `2026-08-26T00:${String(40 - index).padStart(2, "0")}:00.000Z`,
    })),
    lukas_drawing_issue_events: Array.from({ length: 11 }, (_, index) => ({
      id: `00000000-0000-4000-8000-${String(200 + index).padStart(12, "0")}`,
      issue_id: ids.issue,
      project_id: ids.project,
      actor_id: ids.actor,
      event_type: "comment_added",
      to_value: {},
      note: "",
      created_at: `2026-08-26T00:${String(39 - index).padStart(2, "0")}:00.000Z`,
    })),
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
        or(value) {
          calls.push([table, "or", value]);
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
    createdAt: "2026-08-26T00:45:00.000Z",
    id: ids.comment,
    kind: "operation",
  });
  const page = await drawingHistory.loadDrawingActivityPage(
    client,
    ids.project,
    ids.revision,
    { cursor, limit: 10 },
  );
  assert.equal(page.items.length, 10);
  assert.equal(page.items[0].createdAt, "2026-08-26T00:40:00.000Z");
  assert.equal(
    page.items[0].clientOperationId,
    rows.lukas_drawing_operations[0].client_operation_id,
  );
  assert.deepEqual(page.items[0].detail, {
    type: "add_objects",
    itemCount: 100,
  });
  assert.equal(
    workspace.drawingActivityDescription(page.items[0]),
    "add_objects · 100개 항목",
  );
  assert.ok(
    Buffer.byteLength(JSON.stringify(page.items[0])) <
      Buffer.byteLength(JSON.stringify(largeOperationBody)) / 10,
  );
  assert.doesNotMatch(JSON.stringify(page), /운반되면 안 되는 원본 객체/);
  assert.ok(calls.some((call) => call[1] === "or"));
  assert.ok(
    calls.some(
      (call) => call.join(":") === "lukas_drawing_operations:limit:11",
    ),
  );
  assert.ok(page.nextCursor);
  await assert.rejects(
    drawingHistory.loadDrawingActivityPage(client, ids.project, ids.revision, {
      limit: 51,
    }),
  );
});

test("history links preserve document scope and persistence rejection", async () => {
  assert.equal(
    drawingHistory.drawingHistoryPageHref(ids.project, ids.canvas, ids.comment),
    `?document=${ids.project}&historyCursor=${ids.canvas}#history-${ids.comment}`,
  );
  await assert.rejects(
    workspace.persistDrawingRecordedOperation(
      {
        applyRecorded: async () => {
          throw new Error("outbox rejected");
        },
      },
      {},
    ),
    /outbox rejected/,
  );
});

test("activity detail and provenance stay bounded and human-readable", () => {
  const item = {
    kind: "operation",
    id: ids.operation,
    clientOperationId: ids.operation,
    createdAt: "2026-08-26T00:00:00.000Z",
    actorId: ids.actor,
    revisionId: ids.revision,
    action: "undo",
    detail: { type: "restore_checkpoint", itemCount: 500 },
    provenance: {
      historyAction: "undo",
      originalOperationId: ids.comment,
    },
  };
  assert.match(workspace.drawingActivityDescription(item), /500개 항목/);
  assert.ok(workspace.drawingActivityDescription(item).length <= 160);
  assert.match(workspace.drawingActivityProvenance(item), /원본 작업/);
  const issueEvent = {
    kind: "issue_event",
    id: ids.comment,
    createdAt: item.createdAt,
    actorId: ids.actor,
    issueId: ids.issue,
    action: "status_changed",
    detail: { to: "resolved", note: "현장 확인 완료" },
    provenance: { projectId: ids.project },
  };
  assert.match(
    workspace.drawingActivityDescription(issueEvent),
    /resolved.*현장 확인 완료/,
  );
});

test("workspace owns real target/comment and checkpoint restore controls", async () => {
  const source = await readFile(
    new URL("../app/lukas/components/drawing-workspace.tsx", import.meta.url),
    "utf8",
  );
  assert.match(source, /name="mentioned_user_ids"/);
  assert.match(source, /value="add_canvas_region_anchor"/);
  assert.match(source, /name="issue_id"/);
  assert.match(source, /이슈에 연결된 도면 객체/);
  assert.match(source, /연결된 캔버스 영역/);
  assert.match(source, /createDrawingCheckpointRestoreCommand/);
  assert.doesNotMatch(
    source,
    /effectiveRevisionStatus === "approved" && authority\.canWrite/,
  );
});

test("issue linking waits for the selected-object route transition", async () => {
  const source = await readFile(
    new URL("../app/lukas/components/drawing-workspace.tsx", import.meta.url),
    "utf8",
  );
  const issueLinkForm = source.slice(
    source.indexOf('value="link_issue"'),
    source.indexOf("선택 객체를 이슈에 연결") +
      "선택 객체를 이슈에 연결".length,
  );

  assert.match(
    issueLinkForm,
    /disabled=\{navigation\.state !== "idle"\}/,
    "a link click must not race the query navigation that commits object selection",
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
  assert.equal(applied.operation.undoable, false);
  assert.equal(
    drawingCommands.undoDrawingCommand(applied.state, ids.actor),
    null,
  );
});

test("checkpoint restore resolves structural object targets for soft-lock checks", () => {
  const current = basicState();
  const target = structuredClone(current);
  target.objects[ids.comment] = rectangle("Checkpoint", 1);
  const command = drawingCommands.createDrawingCheckpointRestoreCommand(
    current,
    target,
    ids.actor,
    ids.operation,
  );
  const conflict = drawingAwareness.drawingCommandSoftLockConflict(
    command,
    [
      {
        clientId: 2,
        user: { id: ids.member, displayName: "Peer", color: "#fff" },
        softLocks: [
          { entityId: ids.comment, leaseId: ids.canvas, expiresAt: 10_000 },
        ],
      },
    ],
    1,
  );
  assert.equal(conflict.lock.entityId, ids.comment);
});

test("checkpoint restore revives a modified tombstone into checkpoint content", () => {
  const checkpoint = basicState();
  const changed = drawingCommands.applyDrawingCommand(checkpoint, {
    type: "update_objects",
    actorId: ids.actor,
    updates: [{ objectId: ids.comment, patch: { name: "Changed later" } }],
  });
  const deleted = drawingCommands.applyDrawingCommand(changed.state, {
    type: "delete_objects",
    actorId: ids.actor,
    objectIds: [ids.comment],
  });
  const restored = drawingCommands.applyDrawingCommand(
    deleted.state,
    drawingCommands.createDrawingCheckpointRestoreCommand(
      deleted.state,
      checkpoint,
      ids.actor,
      ids.operation,
    ),
  );
  assert.equal(restored.state.objects[ids.comment].name, "Before");
  assert.equal(restored.operation.forward.actions[0].baseVersion, null);
});

test("checkpoint canonical graph removes database-only layer and object fields", () => {
  assert.deepEqual(
    workspace.canonicalCheckpointEntities(
      [{ id: ids.operation, pageId: ids.issue, name: "Layer" }],
      ["pageId"],
    ),
    [{ id: ids.operation, name: "Layer" }],
  );
});
