import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { createServer } from "vite";

const drawingContextKey = "__drawingRoomActionContext";
globalThis[drawingContextKey] = () => {
  throw new Error("Drawing room action context is not configured.");
};

const vite = await createServer({
  appType: "custom",
  configFile: false,
  logLevel: "silent",
  plugins: [
    {
      enforce: "pre",
      load(id) {
        if (id === "\0virtual:drawing-room-action-context")
          return `
            export const drawingContext = (...args) => globalThis[${JSON.stringify(drawingContextKey)}](...args);
            export const listDrawingAssignees = () => { throw new Error("loader only"); };
            export const listDrawingFiles = () => { throw new Error("loader only"); };
            export const loadDrawingRoom = () => { throw new Error("loader only"); };
            export const mutateDrawingIssue = () => { throw new Error("action not expected"); };
            export const parseDrawingMutationForm = () => { throw new Error("action not expected"); };
          `;
      },
      name: "drawing-room-action-context",
      resolveId(source) {
        if (source.endsWith("lukas/lib/drawing-collaboration.server"))
          return "\0virtual:drawing-room-action-context";
      },
    },
  ],
  resolve: {
    alias: { "~": fileURLToPath(new URL("../app", import.meta.url)) },
  },
  server: { middlewareMode: true },
});
const drawingRoom = await vite.ssrLoadModule(
  "/app/lukas/screens/drawing-room.tsx",
);

test.after(async () => {
  delete globalThis[drawingContextKey];
  await vite.close();
});

const ids = {
  currentFile: "50000000-0000-4000-8000-000000000001",
  newAnchor: "50000000-0000-4000-8000-000000000002",
  otherFile: "50000000-0000-4000-8000-000000000008",
  previousAnchor: "50000000-0000-4000-8000-000000000003",
  previousFile: "50000000-0000-4000-8000-000000000004",
  project: "50000000-0000-4000-8000-000000000005",
  issue: "50000000-0000-4000-8000-000000000006",
};

function relinkRequest({ currentFileId = ids.currentFile } = {}) {
  const form = new FormData();
  form.set("intent", "relink_anchor");
  form.set("previous_anchor_id", ids.previousAnchor);
  form.set("new_anchor_id", ids.newAnchor);
  form.set("current_file_id", currentFileId);
  form.set(
    "anchor_json",
    JSON.stringify({
      kind: "pdf_region",
      fileId: currentFileId,
      pageNumber: 1,
      x: 0.1,
      y: 0.2,
      width: 0.3,
      height: 0.4,
      label: "새 근거",
    }),
  );
  form.set("note", "개정본에서 다시 확인");
  return new Request(
    `http://app.test/projects/${ids.project}/drawings/${ids.currentFile}`,
    {
      body: form,
      method: "POST",
    },
  );
}

function committedRelinkClient({ currentFileId = ids.currentFile } = {}) {
  const rows = new Map([
    [
      ids.previousAnchor,
      {
        id: ids.previousAnchor,
        issue_id: ids.issue,
        project_id: ids.project,
        file_id: ids.previousFile,
        anchor_kind: "pdf_region",
        element_id: null,
        ifc_global_id: null,
        camera_json: null,
        page_number: 1,
        x: 0.05,
        y: 0.05,
        width: 0.1,
        height: 0.1,
        label: "이전 근거",
        active: false,
        deactivation_note: "개정본에서 다시 확인",
        replaces_anchor_id: null,
      },
    ],
    [
      ids.newAnchor,
      {
        id: ids.newAnchor,
        issue_id: ids.issue,
        project_id: ids.project,
        file_id: currentFileId,
        anchor_kind: "pdf_region",
        element_id: null,
        ifc_global_id: null,
        camera_json: null,
        page_number: 1,
        x: 0.1,
        y: 0.2,
        width: 0.3,
        height: 0.4,
        label: "새 근거",
        active: true,
        deactivation_note: null,
        replaces_anchor_id: ids.previousAnchor,
      },
    ],
  ]);
  let rpcCalls = 0;
  return {
    client: {
      from(table) {
        if (table === "lukas_qto_files") {
          const query = {
            select() {
              return query;
            },
            eq() {
              return query;
            },
            maybeSingle() {
              return Promise.resolve({
                data: { id: currentFileId },
                error: null,
              });
            },
          };
          return query;
        }
        assert.equal(table, "lukas_drawing_issue_anchors");
        let id = null;
        const query = {
          select() {
            return query;
          },
          eq(column, value) {
            if (column === "id") id = value;
            return query;
          },
          maybeSingle() {
            return Promise.resolve({ data: rows.get(id) ?? null, error: null });
          },
        };
        return query;
      },
      async rpc() {
        rpcCalls += 1;
        throw new Error("a replayed relink must not mutate again");
      },
    },
    rpcCalls: () => rpcCalls,
  };
}

function missingRelinkClient() {
  return {
    from(table) {
      let anchorId = null;
      const query = {
        select() {
          return query;
        },
        eq(column, value) {
          if (table === "lukas_drawing_issue_anchors" && column === "id")
            anchorId = value;
          return query;
        },
        maybeSingle() {
          if (table === "lukas_qto_file_revisions")
            return Promise.resolve({
              data: {
                project_id: ids.project,
                previous_file_id: ids.previousFile,
                current_file_id: ids.currentFile,
              },
              error: null,
            });
          if (table === "lukas_drawing_issue_anchors")
            return Promise.resolve({
              data:
                anchorId === ids.previousAnchor
                  ? {
                      id: ids.previousAnchor,
                      issue_id: ids.issue,
                      project_id: ids.project,
                      file_id: ids.previousFile,
                      anchor_kind: "pdf_region",
                      ifc_global_id: null,
                      active: true,
                    }
                  : null,
              error: null,
            });
          if (table === "lukas_drawing_issues")
            return Promise.resolve({
              data: {
                id: ids.issue,
                project_id: ids.project,
                title: "재검토 이슈",
                status: "open",
              },
              error: null,
            });
          return Promise.resolve({
            data: table === "lukas_qto_files" ? { id: ids.currentFile } : null,
            error: null,
          });
        },
      };
      return query;
    },
    async rpc() {
      throw new Error("private database password and stack trace");
    },
  };
}

function setContext(client, { role = "reviewer" } = {}) {
  globalThis[drawingContextKey] = async () => ({
    client,
    headers: new Headers(),
    project: { id: ids.project },
    role,
    user: { id: "50000000-0000-4000-8000-000000000007" },
  });
}

test("legacy drawing-room action replays an exact committed relink before the relink RPC", async () => {
  const replay = committedRelinkClient();
  setContext(replay.client);

  const response = await drawingRoom.action({
    params: { fileId: ids.currentFile, projectId: ids.project },
    request: relinkRequest(),
  });

  assert.deepEqual(response.data, {
    ok: true,
    error: null,
    relink: {
      previousAnchorId: ids.previousAnchor,
      newAnchorId: ids.newAnchor,
    },
  });
  assert.equal(replay.rpcCalls(), 0);
});

test("legacy drawing-room action denies viewer and approver replay attempts", async () => {
  for (const role of ["viewer", "approver"]) {
    const replay = committedRelinkClient();
    setContext(replay.client, { role });

    const response = await drawingRoom.action({
      params: { fileId: ids.currentFile, projectId: ids.project },
      request: relinkRequest(),
    });

    assert.equal(response.init.status, 400, role);
    assert.equal(
      response.data.error,
      "도면 근거를 새 개정본에 연결할 권한이 없습니다.",
      role,
    );
    assert.equal(replay.rpcCalls(), 0, role);
  }
});

test("legacy drawing-room action rejects a relink current file that differs from its route", async () => {
  const replay = committedRelinkClient({ currentFileId: ids.otherFile });
  setContext(replay.client);

  const response = await drawingRoom.action({
    params: { fileId: ids.currentFile, projectId: ids.project },
    request: relinkRequest({ currentFileId: ids.otherFile }),
  });

  assert.equal(response.init.status, 400);
  assert.equal(
    response.data.error,
    "현재 작업실의 정확한 개정 관계에서만 근거를 연결할 수 있습니다.",
  );
  assert.equal(replay.rpcCalls(), 0);
});

test("legacy drawing-room action rejects replay for a route file outside its project", async () => {
  const replay = committedRelinkClient();
  const calls = [];
  const scopeFilters = [];
  const client = {
    ...replay.client,
    from(table) {
      calls.push(table);
      if (table === "lukas_qto_files") {
        const query = {
          select() {
            return query;
          },
          eq(column, value) {
            scopeFilters.push([column, value]);
            return query;
          },
          maybeSingle() {
            return Promise.resolve({ data: null, error: null });
          },
        };
        return query;
      }
      return replay.client.from(table);
    },
  };
  setContext(client);

  const response = await drawingRoom.action({
    params: { fileId: ids.currentFile, projectId: ids.project },
    request: relinkRequest(),
  });

  assert.equal(response.init.status, 400);
  assert.equal(
    response.data.error,
    "현재 작업실의 정확한 개정 관계에서만 근거를 연결할 수 있습니다.",
  );
  assert.deepEqual(calls, ["lukas_qto_files"]);
  assert.deepEqual(scopeFilters, [
    ["id", ids.currentFile],
    ["project_id", ids.project],
  ]);
  assert.equal(replay.rpcCalls(), 0);
});

test("legacy drawing-room action never serializes raw runtime failures", async () => {
  setContext(missingRelinkClient());

  const response = await drawingRoom.action({
    params: { fileId: ids.currentFile, projectId: ids.project },
    request: relinkRequest(),
  });

  assert.equal(response.init.status, 400);
  assert.equal(response.data.ok, false);
  assert.equal(
    response.data.error,
    "요청을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.",
  );
});

test("legacy room focuses every issue in the bounded revision review page", () => {
  const focusIssueIds = drawingRoom.revisionReviewFocusIssueIds;
  assert.equal(typeof focusIssueIds, "function");
  assert.deepEqual(
    focusIssueIds([
      { issueId: ids.issue },
      { issueId: ids.issue },
      { issueId: "50000000-0000-4000-8000-000000000009" },
    ]),
    [ids.issue, "50000000-0000-4000-8000-000000000009"],
  );
});
