import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { createServer } from "vite";
import { z } from "zod";

import routes from "../app/routes.ts";

const workspaceView = await import(
  "../app/lukas/lib/drawing-workspace-view.ts"
).catch(() => null);
const workspaceServer = await import(
  "../app/lukas/lib/drawing-workspace.server.ts"
).catch(() => ({}));
const workspacePaths = await import(
  "../app/lukas/lib/drawing-workspace-paths.ts"
).catch(() => ({}));
const vite = await createServer({
  appType: "custom",
  configFile: false,
  logLevel: "silent",
  resolve: {
    alias: { "~": fileURLToPath(new URL("../app", import.meta.url)) },
  },
  server: { middlewareMode: true },
});
const legacyScreen = await vite
  .ssrLoadModule("/app/lukas/screens/drawing-workspace-legacy.tsx")
  .catch(() => ({}));
const newScreen = await vite
  .ssrLoadModule("/app/lukas/screens/drawing-workspace-new.tsx")
  .catch(() => ({}));
const startComponent = await vite
  .ssrLoadModule("/app/lukas/components/drawing-workspace-start.tsx")
  .catch(() => ({}));
const workspaceScreen = {
  ...(await vite
    .ssrLoadModule("/app/lukas/screens/drawing-workspace.tsx")
    .catch(() => ({}))),
  ...(await vite
    .ssrLoadModule("/app/lukas/lib/drawing-workspace-route.server.ts")
    .catch(() => ({}))),
};
const workspaceExport = await vite
  .ssrLoadModule("/app/lukas/screens/drawing-workspace-export.ts")
  .catch(() => ({}));

test.after(() => vite.close());
const ids = {
  project: "00000000-0000-4000-8000-000000000002",
  file: "00000000-0000-4000-8000-000000000003",
  document: "00000000-0000-4000-8000-000000000004",
};

test("authorized drawing lineage builds one exact BOQ version and focused-line return", () => {
  const location = workspacePaths.drawingWorkspaceBoqReturnLocation;
  assert.equal(typeof location, "function");
  assert.equal(
    location(ids.project, ids.document, ids.file),
    `/projects/${ids.project}/boq?version=${ids.document}&line=${ids.file}`,
  );
  for (const malformed of ["not-a-uuid", `${ids.file}?download=manifest`])
    assert.throws(() => location(ids.project, ids.document, malformed));
});

test("drawing operation location is fixed for preview and canonical for production", () => {
  const location = workspacePaths.drawingWorkspaceOperationLocation;
  assert.equal(typeof location, "function");
  assert.equal(
    location({
      previewMode: true,
      projectId: ids.project,
      workspaceId: ids.document,
      pathname: "//attacker.example/operation",
    }),
    "/workspace-preview/drawing-workspace/operation",
  );
  assert.equal(
    location({
      previewMode: false,
      projectId: ids.project,
      workspaceId: ids.document,
      pathname: "/workspace-preview/drawing-workspace",
    }),
    `/projects/${ids.project}/workspaces/${ids.document}/operation`,
  );
  assert.throws(() =>
    location({
      previewMode: false,
      projectId: "not-a-uuid",
      workspaceId: ids.document,
      pathname: "/workspace-preview/drawing-workspace",
    }),
  );
});

test("estimate binding form accepts only an editable current draft revision and UUID BOQ", () => {
  const parse = workspaceScreen.parseDrawingEstimateBindingForm;
  assert.equal(typeof parse, "function");
  const form = new FormData();
  form.set("intent", "bind_drawing_estimate");
  form.set("drawing_revision_id", ids.document);
  form.set("boq_version_id", ids.file);
  const scope = {
    capability: "editor",
    projectId: ids.project,
    revisionId: ids.document,
    revisionStatus: "draft",
  };
  assert.deepEqual(parse(form, scope), {
    projectId: ids.project,
    drawingRevisionId: ids.document,
    boqVersionId: ids.file,
  });
  for (const capability of ["viewer", "commenter", "reviewer", "approver"])
    assert.throws(
      () => parse(form, { ...scope, capability }),
      (error) => error instanceof Response && error.status === 403,
    );
  assert.throws(
    () => parse(form, { ...scope, revisionStatus: "approved" }),
    (error) => error instanceof Response && error.status === 409,
  );
  form.set("drawing_revision_id", "00000000-0000-4000-8000-000000000099");
  assert.throws(
    () => parse(form, scope),
    (error) => error instanceof Response && error.status === 409,
  );
  form.set("drawing_revision_id", ids.document);
  form.set("boq_version_id", "not-a-uuid");
  assert.throws(
    () => parse(form, scope),
    (error) => error instanceof Response && error.status === 400,
  );
});

test("estimate binding route bounds malformed workspace and revision identities", async () => {
  const parse = workspaceScreen.parseDrawingEstimateBindingRoute;
  assert.equal(typeof parse, "function");
  assert.deepEqual(parse(ids.document, null), {
    workspaceId: ids.document,
    revisionId: undefined,
  });
  assert.deepEqual(parse(ids.document, ids.file), {
    workspaceId: ids.document,
    revisionId: ids.file,
  });
  for (const [workspaceId, revisionId] of [
    ["not-a-workspace", null],
    [ids.document, "not-a-revision"],
    [ids.document, ""],
  ]) {
    let thrown;
    try {
      parse(workspaceId, revisionId);
    } catch (error) {
      thrown = error;
    }
    assert.ok(thrown instanceof Response);
    assert.equal(thrown.status, 400);
    assert.deepEqual(
      await workspaceScreen.drawingEstimateBindingErrorResponse(thrown.clone()),
      {
        status: 400,
        error: "견적 연결 경로 식별자가 올바르지 않습니다.",
      },
    );
    assert.equal(
      await thrown.text(),
      "견적 연결 경로 식별자가 올바르지 않습니다.",
    );
  }
});

test("estimate binding failures stay bounded for validation and duplicate conflicts", async () => {
  const bounded = workspaceScreen.drawingEstimateBindingErrorResponse;
  assert.equal(typeof bounded, "function");
  assert.deepEqual(
    await bounded(
      new workspaceServer.DrawingWorkspaceConflictError("raw db detail"),
    ),
    {
      status: 409,
      error: "현재 도면 개정 또는 BOQ 버전에 이미 견적이 연결되어 있습니다.",
    },
  );
  assert.deepEqual(
    await bounded(
      new Response("견적 연결에는 도면 편집 권한이 필요합니다.", {
        status: 403,
      }),
    ),
    {
      status: 403,
      error: "견적 연결에는 도면 편집 권한이 필요합니다.",
    },
  );
  const routeSource = await readFile(
    new URL("../app/lukas/screens/drawing-workspace.tsx", import.meta.url),
    "utf8",
  );
  const estimateAction = routeSource.slice(
    routeSource.indexOf('if (intent === "bind_drawing_estimate")'),
    routeSource.indexOf(
      "\n  const workspace = await loadDrawingWorkspace(client",
      routeSource.indexOf('if (intent === "bind_drawing_estimate")'),
    ),
  );
  assert.match(estimateAction, /drawingWorkspaceActionErrorResponse\(error/);
});

test("workspace action failures use the bounded Korean recovery union", async () => {
  const bound = workspaceScreen.drawingWorkspaceActionErrorResponse;
  assert.equal(typeof bound, "function");
  const validation = await bound(
    new z.ZodError([
      {
        code: "invalid_type",
        expected: "string",
        path: ["title"],
        message: "Required",
      },
    ]),
    { requestId: ids.file },
  );
  assert.equal(validation.status, 400);
  assert.equal(validation.body.kind, "validation");
  assert.deepEqual(validation.body.fieldErrors, {
    title: ["입력값이 올바르지 않습니다."],
  });

  assert.deepEqual(
    await bound(
      new workspaceServer.DrawingWorkspaceConflictError("raw conflict"),
      { requestId: ids.file },
    ),
    {
      status: 409,
      body: {
        ok: false,
        kind: "conflict",
        error: "최신 작업실을 다시 불러와 변경 내용을 비교해 주세요.",
        requestId: ids.file,
      },
    },
  );
  assert.deepEqual(
    await bound(
      new workspaceServer.DrawingWorkspaceRetryableError("raw retry"),
      { requestId: ids.file },
    ),
    {
      status: 503,
      body: {
        ok: false,
        kind: "retryable",
        error: "같은 요청 ID로 다시 시도해 주세요.",
        requestId: ids.file,
      },
    },
  );
  assert.deepEqual(
    await bound(
      new workspaceServer.DrawingWorkspaceRejectedError(
        "승인된 개정은 변경할 수 없습니다.",
      ),
      { requestId: ids.file },
    ),
    {
      status: 409,
      body: {
        ok: false,
        kind: "rejected",
        error: "승인된 개정은 변경할 수 없습니다. 새 개정을 만들어 주세요.",
        requestId: ids.file,
      },
    },
  );
  assert.deepEqual(
    await bound(new Response("raw missing object detail", { status: 404 }), {
      requestId: ids.file,
    }),
    {
      status: 409,
      body: {
        ok: false,
        kind: "rejected",
        error: "현재 개정 상태에서는 이 작업을 수행할 수 없습니다.",
        requestId: ids.file,
      },
    },
  );

  const originalConsoleError = console.error;
  const logged = [];
  console.error = (...values) => logged.push(values);
  try {
    const unknown = await bound(new Error("server-only secret"), {
      requestId: ids.file,
    });
    assert.equal(unknown.status, 500);
    assert.equal(unknown.body.kind, "unknown");
    assert.match(unknown.body.error, new RegExp(ids.file));
    assert.doesNotMatch(unknown.body.error, /server-only secret/);
    assert.equal(logged.length, 1);
  } finally {
    console.error = originalConsoleError;
  }
});

test("workspace action retains review freeze and estimate correlation IDs", async () => {
  const requestId = workspaceScreen.actionRequestId;
  assert.equal(typeof requestId, "function");
  const review = new FormData();
  review.set("intent", "request_review");
  review.set("freeze_request_id", ids.file);
  assert.equal(requestId(review), ids.file);
  const estimate = new FormData();
  estimate.set("intent", "bind_drawing_estimate");
  estimate.set("client_request_id", ids.document);
  assert.equal(requestId(estimate), ids.document);
  const retry = await workspaceScreen.drawingWorkspaceActionErrorResponse(
    new workspaceServer.DrawingWorkspaceRetryableError("transient"),
    { requestId: requestId(estimate) },
  );
  assert.equal(retry.status, 503);
  assert.equal(retry.body.requestId, ids.document);

  const malformed = new FormData();
  malformed.set("client_request_id", "not-a-uuid");
  const fallback = requestId(malformed);
  assert.match(fallback, /^[0-9a-f]{8}-[0-9a-f-]{27}$/);
  assert.notEqual(fallback, "not-a-uuid");
});

test("general action workspace loading bounds validation, conflict, and retry failures", async () => {
  const load = workspaceScreen.loadDrawingWorkspaceActionScope;
  assert.equal(typeof load, "function");
  const validation = await load(async () => {
    throw new z.ZodError([
      {
        code: "invalid_type",
        expected: "string",
        path: ["workspaceId"],
        message: "Required",
      },
    ]);
  }, ids.file);
  assert.equal(validation.ok, false);
  assert.equal(validation.failure.status, 400);
  assert.deepEqual(validation.failure.body.fieldErrors, {
    workspaceId: ["입력값이 올바르지 않습니다."],
  });
  for (const [error, status, kind] of [
    [
      new workspaceServer.DrawingWorkspaceConflictError("stale"),
      409,
      "conflict",
    ],
    [
      new workspaceServer.DrawingWorkspaceRetryableError("retry"),
      503,
      "retryable",
    ],
  ]) {
    const result = await load(async () => {
      throw error;
    }, ids.file);
    assert.equal(result.ok, false);
    assert.equal(result.failure.status, status);
    assert.equal(result.failure.body.kind, kind);
    assert.equal(result.failure.body.requestId, ids.file);
  }
});

test("real mutation failures retain Zod fields, unknown secrecy, and approved-revision recovery", async () => {
  const workspace = {
    primarySource: null,
    templateCandidates: [],
    document: null,
  };
  let validationError;
  try {
    const invalid = new FormData();
    invalid.set("intent", "create_layer");
    await workspaceServer.handleWorkspaceMutation({
      client: {},
      projectId: ids.project,
      capability: "editor",
      workspace,
      form: invalid,
    });
  } catch (error) {
    validationError = error;
  }
  const validation = await workspaceScreen.drawingWorkspaceActionErrorResponse(
    validationError,
    { requestId: ids.file },
  );
  assert.equal(validation.status, 400);
  assert.equal(validation.body.kind, "validation");
  assert.ok(Object.keys(validation.body.fieldErrors).length > 0);

  let unknownError;
  try {
    const create = new FormData();
    create.set("intent", "create_document");
    create.set("title", "A-101");
    create.set("document_mode", "blank");
    await workspaceServer.handleWorkspaceMutation({
      client: {
        async rpc() {
          throw new TypeError("server-only transport detail");
        },
      },
      projectId: ids.project,
      capability: "editor",
      workspace,
      form: create,
    });
  } catch (error) {
    unknownError = error;
  }
  const originalConsoleError = console.error;
  console.error = () => {};
  try {
    const unknown = await workspaceScreen.drawingWorkspaceActionErrorResponse(
      unknownError,
      { requestId: ids.file },
    );
    assert.equal(unknown.status, 500);
    assert.equal(unknown.body.kind, "unknown");
    assert.doesNotMatch(unknown.body.error, /transport detail/);
  } finally {
    console.error = originalConsoleError;
  }

  const approvedWorkspace = {
    ...workspace,
    document: { revision: { status: "approved" } },
  };
  const createLayer = new FormData();
  createLayer.set("intent", "create_layer");
  createLayer.set("name", "마감");
  const rejected = await workspaceServer.handleWorkspaceMutation({
    client: {},
    projectId: ids.project,
    capability: "editor",
    workspace: approvedWorkspace,
    form: createLayer,
  });
  const approved = await workspaceScreen.drawingWorkspaceActionErrorResponse(
    new workspaceServer.DrawingWorkspaceRejectedError(rejected.body.error),
    { requestId: ids.file },
  );
  assert.equal(approved.status, 409);
  assert.match(approved.body.error, /새 개정/);
});

test("source-free BOQ focus accepts an exact tuple without inventing evidence", () => {
  const parse = workspaceScreen.parseDrawingWorkspaceLineageSearch;
  assert.equal(typeof parse, "function");
  assert.deepEqual(
    parse(
      new URLSearchParams({
        revision: ids.file,
        object: ids.document,
        boq: "00000000-0000-4000-8000-000000000005",
        line: "00000000-0000-4000-8000-000000000006",
      }),
    ),
    {
      revisionId: ids.file,
      objectId: ids.document,
      boqVersionId: "00000000-0000-4000-8000-000000000005",
      boqLineId: "00000000-0000-4000-8000-000000000006",
      evidenceFileId: null,
      cursor: null,
    },
  );
});

function listQueryClient(rows) {
  const calls = [];
  return {
    calls,
    from(table) {
      calls.push(table);
      const result = { data: rows[table] ?? [], error: null };
      const query = {
        select() {
          return query;
        },
        eq() {
          return query;
        },
        in() {
          return query;
        },
        order() {
          return Promise.resolve(result);
        },
        maybeSingle() {
          return Promise.resolve({
            data: Array.isArray(result.data)
              ? (result.data[0] ?? null)
              : result.data,
            error: null,
          });
        },
      };
      return query;
    },
  };
}

test("source-free issue room loads comments without calling the file-room loader", async () => {
  const client = listQueryClient({
    lukas_drawing_issue_comments: [
      {
        id: "00000000-0000-4000-8000-000000000010",
        issue_id: ids.file,
        author_id: ids.project,
        body: "원본 없는 객체 검토",
        created_at: "2026-08-31T00:00:00.000Z",
      },
    ],
    lukas_drawing_comment_mentions: [],
    lukas_drawing_canvas_region_anchors: [],
  });
  let fileRoomCalls = 0;
  const room = await workspaceScreen.loadDrawingWorkspaceIssueRoom(
    client,
    ids.project,
    {
      primarySource: null,
      document: {
        revision: {
          issues: [{ id: ids.file, title: "객체 이슈", status: "open" }],
        },
      },
    },
    async () => {
      fileRoomCalls += 1;
    },
  );
  assert.equal(fileRoomCalls, 0);
  assert.equal(room.issues[0].id, ids.file);
  assert.equal(room.comments[0].body, "원본 없는 객체 검토");
  assert.deepEqual(client.calls, [
    "lukas_drawing_issue_comments",
    "lukas_drawing_canvas_region_anchors",
    "lukas_drawing_comment_mentions",
  ]);
});

test("object issue scope validates object to revision to document to project", async () => {
  const scoped = scopeQueryClient({
    lukas_drawing_objects: {
      id: ids.file,
      revision_id: "00000000-0000-4000-8000-000000000005",
      project_id: ids.project,
    },
    lukas_drawing_revisions: {
      id: "00000000-0000-4000-8000-000000000005",
      document_id: ids.document,
      project_id: ids.project,
    },
    lukas_drawing_documents: {
      id: ids.document,
      project_id: ids.project,
    },
  });
  await workspaceScreen.assertDrawingObjectIssueScope(scoped, {
    projectId: ids.project,
    documentId: ids.document,
    revisionId: "00000000-0000-4000-8000-000000000005",
    objectId: ids.file,
  });
  assert.deepEqual(scoped.calls, [
    "lukas_drawing_objects",
    "lukas_drawing_revisions",
    "lukas_drawing_documents",
  ]);

  await assert.rejects(
    workspaceScreen.assertDrawingObjectIssueScope(scoped, {
      projectId: ids.project,
      documentId: "00000000-0000-4000-8000-000000000099",
      revisionId: "00000000-0000-4000-8000-000000000005",
      objectId: ids.file,
    }),
    (error) => error instanceof Response && error.status === 404,
  );

  const retrying = scopeQueryClient(
    {},
    {
      lukas_drawing_objects: {
        code: "40001",
        message: "serialization detail",
      },
    },
  );
  let retryError;
  try {
    await workspaceScreen.assertDrawingObjectIssueScope(retrying, {
      projectId: ids.project,
      documentId: ids.document,
      revisionId: "00000000-0000-4000-8000-000000000005",
      objectId: ids.file,
    });
  } catch (error) {
    retryError = error;
  }
  const bounded = await workspaceScreen.drawingWorkspaceActionErrorResponse(
    retryError,
    { requestId: ids.file },
  );
  assert.equal(bounded.status, 503);
  assert.equal(bounded.body.requestId, ids.file);

  const disconnected = scopeQueryClient(
    {},
    {
      lukas_drawing_objects: {
        code: "PGRST000",
        message: "database connection unavailable",
      },
    },
  );
  let disconnectedError;
  try {
    await workspaceScreen.assertDrawingObjectIssueScope(disconnected, {
      projectId: ids.project,
      documentId: ids.document,
      revisionId: "00000000-0000-4000-8000-000000000005",
      objectId: ids.file,
    });
  } catch (error) {
    disconnectedError = error;
  }
  const disconnectedBounded =
    await workspaceScreen.drawingWorkspaceActionErrorResponse(
      disconnectedError,
      { requestId: ids.file },
    );
  assert.equal(disconnectedBounded.status, 503);
  assert.equal(disconnectedBounded.body.requestId, ids.file);
});

function scopeQueryClient(rows, errors = {}) {
  const calls = [];
  return {
    calls,
    from(table) {
      calls.push(table);
      const filters = [];
      const query = {
        select() {
          return query;
        },
        eq(column, value) {
          filters.push([column, value]);
          return query;
        },
        maybeSingle: async () => {
          const row = rows[table] ?? null;
          const matches =
            row && filters.every(([column, value]) => row[column] === value);
          return {
            data: matches ? row : null,
            error: errors[table] ?? null,
          };
        },
      };
      return query;
    },
  };
}

test("canonical export remains document-scoped when source_file_id is null", async () => {
  const sourceFree = scopeQueryClient({
    lukas_drawing_revisions: {
      id: ids.file,
      document_id: ids.document,
      project_id: ids.project,
    },
    lukas_drawing_documents: {
      id: ids.document,
      project_id: ids.project,
      source_file_id: null,
    },
  });
  await workspaceExport.validateDrawingExportScope(sourceFree, {
    fileId: null,
    projectId: ids.project,
    revisionId: ids.file,
    workspaceId: ids.document,
  });
  assert.doesNotMatch(sourceFree.calls.join(","), /lukas_qto_files/);

  for (const input of [
    { workspaceId: "00000000-0000-4000-8000-000000000099" },
    { projectId: "00000000-0000-4000-8000-000000000098" },
  ])
    await assert.rejects(
      workspaceExport.validateDrawingExportScope(sourceFree, {
        fileId: null,
        projectId: ids.project,
        revisionId: ids.file,
        workspaceId: ids.document,
        ...input,
      }),
      (error) => error instanceof Response && error.status === 404,
    );
});

function flatten(routesToFlatten) {
  return routesToFlatten.flatMap((route) => [
    route,
    ...flatten(route.children ?? []),
  ]);
}

test("workspace route keeps the collaboration room and removes file operation/export authority aliases", () => {
  const registered = flatten(routes).filter((route) =>
    route.path?.startsWith("/projects/:projectId/drawings/:fileId"),
  );
  assert.deepEqual(
    registered.map((route) => [route.path, route.file]),
    [
      [
        "/projects/:projectId/drawings/:fileId",
        "lukas/screens/drawing-room.tsx",
      ],
      [
        "/projects/:projectId/drawings/:fileId/workspace",
        "lukas/screens/drawing-workspace-legacy.tsx",
      ],
    ],
  );
});

test("workspace routes register static start before dynamic canonical identity and keep only GET compatibility resolvers", () => {
  const byPath = new Map(
    flatten(routes).map((route) => [route.path, route.file]),
  );
  assert.equal(
    byPath.get("/projects/:projectId/workspaces/new"),
    "lukas/screens/drawing-workspace-new.tsx",
  );
  assert.equal(
    byPath.get("/projects/:projectId/workspaces/:workspaceId"),
    "lukas/screens/drawing-workspace.tsx",
  );
  assert.equal(
    byPath.get("/projects/:projectId/workspaces/:workspaceId/operation"),
    "lukas/screens/drawing-workspace-operation.ts",
  );
  assert.equal(
    byPath.get("/projects/:projectId/workspaces/:workspaceId/export"),
    "lukas/screens/drawing-workspace-export.ts",
  );
  assert.equal(
    byPath.get("/projects/:projectId/drawings/:fileId/workspace"),
    "lukas/screens/drawing-workspace-legacy.tsx",
  );
  assert.equal(
    byPath.get("/projects/:projectId/workspace"),
    "lukas/screens/drawing-workspace-legacy.tsx",
  );
  for (const removed of [
    "/projects/:projectId/workspace/operation",
    "/projects/:projectId/drawings/:fileId/workspace/operation",
    "/projects/:projectId/drawings/:fileId/workspace/export",
  ])
    assert.equal(byPath.has(removed), false, removed);

  const privateChildren = flatten(routes);
  const startIndex = privateChildren.findIndex(
    ({ path }) => path === "/projects/:projectId/workspaces/new",
  );
  const dynamicIndex = privateChildren.findIndex(
    ({ path }) => path === "/projects/:projectId/workspaces/:workspaceId",
  );
  assert.ok(startIndex >= 0 && startIndex < dynamicIndex);
});

function legacyClient({ documents = [], file = null } = {}) {
  const observations = { from: [], rpc: [] };
  const client = {
    from(table) {
      observations.from.push(table);
      const filters = [];
      const chain = {
        eq(column, value) {
          filters.push(["eq", column, value]);
          return chain;
        },
        in(column, values) {
          filters.push(["in", column, values]);
          return chain;
        },
        limit() {
          return chain;
        },
        maybeSingle: async () => ({
          data:
            table === "lukas_qto_files"
              ? file
              : documents.length > 0
                ? documents[0]
                : null,
          error: null,
        }),
        order() {
          return chain;
        },
        select() {
          return chain;
        },
      };
      return chain;
    },
    rpc(name, args) {
      observations.rpc.push({ name, args });
      throw new Error("legacy GET must not call an RPC");
    },
  };
  return { client, observations };
}

test("legacy project GET resolves latest document canonically without creating state", async () => {
  const { client, observations } = legacyClient({
    documents: [{ id: ids.document }],
  });
  assert.equal(
    await legacyScreen.resolveLegacyDrawingWorkspace(client, ids.project),
    `/projects/${ids.project}/workspaces/${ids.document}`,
  );
  assert.deepEqual(observations.rpc, []);
});

test("legacy file GET resolves latest matching document and ignores document query overrides", async () => {
  const { client, observations } = legacyClient({
    file: {
      id: ids.file,
      project_id: ids.project,
      kind: "pdf",
      immutable: true,
    },
    documents: [{ id: ids.document }],
  });
  assert.equal(
    await legacyScreen.resolveLegacyDrawingWorkspace(
      client,
      ids.project,
      ids.file,
    ),
    `/projects/${ids.project}/workspaces/${ids.document}`,
  );
  assert.deepEqual(observations.rpc, []);
});

test("legacy file with no document redirects to source-prefilled start", async () => {
  const { client } = legacyClient({
    file: {
      id: ids.file,
      project_id: ids.project,
      kind: "pdf",
      immutable: true,
    },
  });
  assert.equal(
    await legacyScreen.resolveLegacyDrawingWorkspace(
      client,
      ids.project,
      ids.file,
    ),
    `/projects/${ids.project}/workspaces/new?sourceFileId=${ids.file}`,
  );
});

test("legacy IFC file with no document preserves the existing IFC drawing room", async () => {
  const { client, observations } = legacyClient({
    file: {
      id: ids.file,
      project_id: ids.project,
      kind: "ifc",
      immutable: true,
    },
  });
  assert.equal(
    await legacyScreen.resolveLegacyDrawingWorkspace(
      client,
      ids.project,
      ids.file,
    ),
    `/projects/${ids.project}/drawings/${ids.file}`,
  );
  assert.deepEqual(observations.rpc, []);
});

test("legacy zero-file zero-document project redirects to blank start", async () => {
  const { client, observations } = legacyClient();
  assert.equal(
    await legacyScreen.resolveLegacyDrawingWorkspace(client, ids.project),
    `/projects/${ids.project}/workspaces/new`,
  );
  assert.deepEqual(observations.rpc, []);
});

function startForm(values) {
  const form = new FormData();
  for (const [key, value] of Object.entries(values)) form.set(key, value);
  return form;
}

test("new workspace start mutation is an exhaustive closed discriminated union", () => {
  const common = {
    title: "새 적산 작업실",
    clientRequestId: "00000000-0000-4000-8000-000000000010",
    clientCreatedAt: "2026-08-31T01:02:03.000Z",
  };
  assert.deepEqual(
    newScreen.parseDrawingWorkspaceStartForm(
      startForm({ intent: "create_blank", ...common }),
    ),
    { intent: "create_blank", ...common },
  );
  assert.deepEqual(
    newScreen.parseDrawingWorkspaceStartForm(
      startForm({
        intent: "create_starter",
        ...common,
        starterKey: "interior-basic",
        starterVersion: "1",
      }),
    ),
    {
      intent: "create_starter",
      ...common,
      starterKey: "interior-basic",
      starterVersion: 1,
    },
  );
  assert.deepEqual(
    newScreen.parseDrawingWorkspaceStartForm(
      startForm({
        intent: "create_pdf",
        ...common,
        sourceFileId: ids.file,
      }),
    ),
    { intent: "create_pdf", ...common, sourceFileId: ids.file },
  );
  assert.deepEqual(
    newScreen.parseDrawingWorkspaceStartForm(
      startForm({
        intent: "create_library_template",
        libraryVersionId: ids.document,
        clientRequestId: common.clientRequestId,
      }),
    ),
    {
      intent: "create_library_template",
      libraryVersionId: ids.document,
      clientRequestId: common.clientRequestId,
    },
  );
  assert.throws(
    () =>
      newScreen.parseDrawingWorkspaceStartForm(
        startForm({ intent: "create_blank", ...common, injected: "true" }),
      ),
    /허용|field|입력/i,
  );
  assert.throws(
    () =>
      newScreen.parseDrawingWorkspaceStartForm(
        startForm({ intent: "unknown", ...common }),
      ),
    /작업|intent|입력/i,
  );
});

test("failed start validation preserves the submitted retry identity and isolates its field error", async () => {
  const clientRequestId = "00000000-0000-4000-8000-000000000010";
  const clientCreatedAt = "2026-08-31T01:02:03.000Z";
  const response = await newScreen.action({
    request: new Request(
      `http://app.test/projects/${ids.project}/workspaces/new`,
      {
        method: "POST",
        body: startForm({
          intent: "create_blank",
          title: "",
          clientRequestId,
          clientCreatedAt,
        }),
      },
    ),
    params: { projectId: ids.project },
  });
  assert.equal(response.init.status, 400);
  assert.equal(response.data.clientRequestId, clientRequestId);
  assert.equal(response.data.clientCreatedAt, clientCreatedAt);
  assert.equal(
    startComponent.drawingWorkspaceStartFieldError(
      response.data,
      { clientRequestId, clientCreatedAt },
      "title",
    ),
    "작업실 이름을 입력하세요.",
  );
  assert.equal(
    startComponent.drawingWorkspaceStartFieldError(
      response.data,
      {
        clientRequestId: "00000000-0000-4000-8000-000000000011",
        clientCreatedAt,
      },
      "title",
    ),
    undefined,
  );
});

test("sourceFileId and starterKey focus only their exact matching start choice", () => {
  assert.equal(
    startComponent.drawingWorkspaceStartChoiceFocused(ids.file, ids.file),
    true,
  );
  assert.equal(
    startComponent.drawingWorkspaceStartChoiceFocused(ids.file, ids.document),
    false,
  );
  assert.equal(
    startComponent.drawingWorkspaceStartChoiceFocused(undefined, ids.file),
    false,
  );
});

test("workspace paths validate UUID identity and keep source optional", () => {
  assert.equal(
    workspacePaths.drawingWorkspacePath(ids.project, ids.document),
    `/projects/${ids.project}/workspaces/${ids.document}`,
  );
  assert.equal(
    workspacePaths.drawingWorkspaceNewPath(ids.project),
    `/projects/${ids.project}/workspaces/new`,
  );
  assert.equal(
    workspacePaths.drawingWorkspaceNewPath(ids.project, ids.file),
    `/projects/${ids.project}/workspaces/new?sourceFileId=${ids.file}`,
  );
  assert.equal(
    workspacePaths.drawingWorkspaceOperationPath(ids.project, ids.document),
    `/projects/${ids.project}/workspaces/${ids.document}/operation`,
  );
  assert.equal(
    workspacePaths.drawingWorkspaceExportPath(ids.project, ids.document),
    `/projects/${ids.project}/workspaces/${ids.document}/export`,
  );
  assert.throws(
    () => workspacePaths.drawingWorkspacePath("not-a-uuid", ids.document),
    /uuid/i,
  );
});

test("project original-file download is an authenticated resource route", () => {
  const registered = flatten(routes).find(
    (route) => route.path === "/projects/:projectId/files/:fileId/download",
  );
  assert.deepEqual(registered && [registered.path, registered.file], [
    "/projects/:projectId/files/:fileId/download",
    "lukas/screens/project-file-download.ts",
  ]);
});

test("collaboration room exposes an accessible link to the additive workspace", async () => {
  const source = await readFile(
    new URL("../app/lukas/screens/drawing-room.tsx", import.meta.url),
    "utf8",
  );
  assert.match(
    source,
    /to=\{`\/projects\/\$\{project\.id\}\/drawings\/\$\{room\.file\.id\}\/workspace`\}/,
  );
  assert.match(source, />\s*도면 편집 작업실\s*</);
});

test("new workspace screen owns blank and PDF-background creation without replacing the room", async () => {
  const source = await readFile(
    new URL("../app/lukas/screens/drawing-workspace-new.tsx", import.meta.url),
    "utf8",
  );
  assert.match(source, /create_blank/);
  assert.match(source, /create_starter/);
  assert.match(source, /create_pdf/);
  assert.match(source, /create_library_template/);
  assert.match(source, /clientCreatedAt/);
  assert.doesNotMatch(source, /Unexpected error/);
});

test("workspace document renders the accessible editor shell", async () => {
  const [screen, shell] = await Promise.all([
    readFile(
      new URL("../app/lukas/screens/drawing-workspace.tsx", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../app/lukas/components/drawing-workspace.tsx", import.meta.url),
      "utf8",
    ),
  ]);

  assert.match(screen, /DrawingWorkspaceClient/);
  assert.match(screen, /협업 도면실/);
  assert.match(shell, /도면 작업실/);
  assert.match(shell, /저장됨/);
  assert.match(shell, /aria-label=\{`저장 상태:/);
  assert.match(shell, /aria-label="실행 취소"/);
  assert.match(shell, /aria-label="다시 실행"/);
  assert.match(shell, /aria-label="도면 도구 패널"/);
  assert.match(shell, /aria-label="도면 캔버스"/);
  assert.match(shell, /aria-label="속성 검사기"/);
});

test("same-session saved drawing objects become linkable without a loader reload", () => {
  assert.equal(
    workspaceView.drawingIssueLinkReady({
      capability: "editor",
      objectIds: ["same-session-object"],
      saveStatus: "저장됨",
      selectedIds: ["same-session-object"],
      status: "draft",
    }),
    true,
  );
  for (const blocked of [
    { saveStatus: "저장 중" },
    { saveStatus: "충돌 검토 필요" },
    { objectIds: [] },
    { selectedIds: [] },
    { capability: "reviewer" },
    { status: "review_requested" },
  ])
    assert.equal(
      workspaceView.drawingIssueLinkReady({
        capability: "editor",
        objectIds: ["same-session-object"],
        saveStatus: "저장됨",
        selectedIds: ["same-session-object"],
        status: "draft",
        ...blocked,
      }),
      false,
    );
});

test("workspace wires durable collaborative recovery and the four visible save states", async () => {
  const shell = await readFile(
    new URL("../app/lukas/components/drawing-workspace.tsx", import.meta.url),
    "utf8",
  );
  assert.match(shell, /createDrawingOutbox/);
  assert.match(shell, /createDrawingPersistenceQueue/);
  assert.match(shell, /reconcileDrawingCollaborationDraft/);
  assert.match(shell, /sendDrawingOperation/);
  assert.match(shell, /createDrawingCollaborationCommandBridge/);
  assert.match(shell, /const saveStatus = drawingSaveStatus/);
  assert.match(shell, /\{saveStatus\}/);
  assert.match(
    shell,
    /canPersistDrawingMutation\(\s*effectiveCapability,\s*persistenceState/,
  );
  assert.match(shell, /로컬 저장 실패/);
  assert.match(shell, /다시 시도/);
  assert.match(shell, /beforeunload/);
  assert.match(shell, /useBlocker/);
  assert.match(shell, /legacyEntries/);
  assert.match(shell, /이전 브라우저 작업/);
});

test("layers and inspector expose native labeled controls", async () => {
  const [shell, layers, inspector] = await Promise.all([
    readFile(
      new URL("../app/lukas/components/drawing-workspace.tsx", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL(
        "../app/lukas/components/drawing-layers-panel.tsx",
        import.meta.url,
      ),
      "utf8",
    ),
    readFile(
      new URL("../app/lukas/components/drawing-inspector.tsx", import.meta.url),
      "utf8",
    ),
  ]);
  assert.match(shell, /<DrawingLayersPanel/);
  assert.match(shell, /<DrawingInspector/);
  assert.match(
    shell,
    /\{authorityCanWrite \? \(\s*<fieldset[\s\S]*?disabled=\{!editing\.canEdit\}[\s\S]*?<Button\s+aria-label="선 도구"/,
  );
  assert.match(
    shell,
    /\{editing\.canEdit \? \(\s*<>\s*<Button\s+aria-label="실행 취소"/,
  );
  assert.match(shell, /\{editing\.canEdit \? \(\s*<DrawingCommandMenu/);
  for (const label of [
    "새 레이어 이름",
    "레이어 추가",
    "레이어 이름",
    "레이어 표시",
    "레이어 잠금",
    "활성 레이어",
  ]) {
    assert.match(layers, new RegExp(label));
  }
  for (const label of [
    "객체 이름",
    "레이어",
    "선 색상",
    "선 두께",
    "채우기",
    "텍스트",
  ]) {
    assert.match(inspector, new RegExp(label));
  }
  assert.match(inspector, /<input/);
  assert.match(inspector, /<select/);
  assert.match(inspector, /<button/);
});

test("page tree and canvas-scoped layer controls use native labeled interactions", async () => {
  const [shell, pages, layers] = await Promise.all([
    readFile(
      new URL("../app/lukas/components/drawing-workspace.tsx", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL(
        "../app/lukas/components/drawing-pages-panel.tsx",
        import.meta.url,
      ),
      "utf8",
    ),
    readFile(
      new URL(
        "../app/lukas/components/drawing-layers-panel.tsx",
        import.meta.url,
      ),
      "utf8",
    ),
  ]);
  assert.match(shell, /<DrawingPagesPanel/);
  assert.match(shell, /documentStore\.selectCanvas/);
  assert.match(shell, /activeCanvasId=\{drawingState\.activeCanvasId\}/);
  assert.doesNotMatch(pages, /role="tree(?:item)?"/);
  assert.match(pages, /<ul/);
  assert.match(pages, /type="button"/);
  assert.match(pages, /nextDrawingCanvasFocusIntent/);
  assert.match(pages, /useLayoutEffect/);
  assert.match(pages, /aria-describedby/);
  assert.match(pages, /defaultCanvas \|\| tailIndex === 0/);
  for (const label of [
    "새 페이지 이름",
    "페이지 추가",
    "용지 캔버스 추가",
    "모델 캔버스 추가",
    "페이지 이름",
    "캔버스 이름",
  ]) {
    assert.match(pages, new RegExp(label));
  }
  assert.match(pages, /\{canEdit \? \(/);
  assert.match(layers, /sortOrder/);
  assert.match(layers, /레이어 위로 이동/);
  assert.match(layers, /레이어 아래로 이동/);
  assert.match(layers, /activeCanvasId/);
});

test("review controls require capability, requested status, separate maker, and exact evidence", () => {
  assert.ok(workspaceView);
  const base = {
    revisionId: "00000000-0000-4000-8000-000000000005",
    revisionVersion: 7,
    status: "review_requested",
    createdBy: "00000000-0000-4000-8000-000000000001",
    currentUserId: "00000000-0000-4000-8000-000000000002",
    reviewEvidence: {
      subjectVersion: 7,
      snapshotSha256: "b".repeat(64),
    },
  };
  assert.deepEqual(
    workspaceView.drawingWorkspaceReviewControls({
      ...base,
      capability: "reviewer",
    }),
    {
      requestReview: false,
      decisionEvidence: base.reviewEvidence,
    },
  );
  assert.deepEqual(
    workspaceView.drawingWorkspaceReviewControls({
      ...base,
      capability: "approver",
      status: "reviewed",
    }),
    {
      requestReview: false,
      decisionEvidence: base.reviewEvidence,
    },
  );
  assert.deepEqual(
    workspaceView.drawingWorkspaceReviewControls({
      ...base,
      capability: "editor",
      status: "draft",
      reviewEvidence: null,
    }),
    { requestReview: true, decisionEvidence: null },
  );
  for (const changes of [
    { capability: "viewer" },
    { capability: "reviewer", status: "approved" },
    { capability: "reviewer", currentUserId: base.createdBy },
    { capability: "reviewer", reviewEvidence: null },
    {
      capability: "reviewer",
      reviewEvidence: { ...base.reviewEvidence, subjectVersion: 6 },
    },
  ]) {
    assert.equal(
      workspaceView.drawingWorkspaceReviewControls({
        ...base,
        ...changes,
      }).decisionEvidence,
      null,
    );
  }
});

test("revision decision form fields bind the exact immutable snapshot", () => {
  assert.ok(workspaceView);
  assert.deepEqual(
    workspaceView.drawingRevisionDecisionFields({
      revisionId: "00000000-0000-4000-8000-000000000005",
      evidence: {
        subjectVersion: 7,
        snapshotSha256: "b".repeat(64),
      },
      decision: "approved",
      note: "확인 완료",
    }),
    {
      intent: "record_revision_decision",
      revision_id: "00000000-0000-4000-8000-000000000005",
      subject_version: "7",
      snapshot_sha256:
        "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      decision: "approved",
      note: "확인 완료",
    },
  );
});

test("client module loading resolves, rejects, and ignores completion after disposal", async () => {
  assert.ok(workspaceView);
  assert.equal(typeof workspaceView.loadDrawingClientModule, "function");

  const resolved = [];
  let resolveModule;
  workspaceView.loadDrawingClientModule({
    load: () =>
      new Promise((resolve) => {
        resolveModule = resolve;
      }),
    errorMessage: "failed",
    onState: (state) => resolved.push(state),
  });
  assert.deepEqual(resolved, [{ status: "loading" }]);
  resolveModule("canvas");
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(resolved, [
    { status: "loading" },
    { status: "ready", value: "canvas" },
  ]);

  const rejected = [];
  workspaceView.loadDrawingClientModule({
    load: () => Promise.reject(new Error("network")),
    errorMessage: "stable error",
    onState: (state) => rejected.push(state),
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(rejected, [
    { status: "loading" },
    { status: "error", message: "stable error" },
  ]);

  const disposed = [];
  let resolveDisposed;
  const dispose = workspaceView.loadDrawingClientModule({
    load: () =>
      new Promise((resolve) => {
        resolveDisposed = resolve;
      }),
    errorMessage: "failed",
    onState: (state) => disposed.push(state),
  });
  dispose();
  resolveDisposed("late module");
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(disposed, [{ status: "loading" }]);
});

test("IFC workspace surface never accepts a raw source URL", () => {
  assert.ok(workspaceView);
  const surface = workspaceView.drawingWorkspaceSurface({
    file: {
      id: "00000000-0000-4000-8000-000000000003",
      kind: "ifc",
      immutable: true,
      originalFilename: "model.ifc",
      byteSize: 2048,
    },
    page: { width: 841, height: 594, backgroundPdfPage: null },
    sourceUrl: "https://storage.test/model",
  });
  assert.deepEqual(surface, {
    layout: "canvas",
    background: { kind: "blank", width: 841, height: 594 },
    ifcViewer: null,
    sourceError: null,
  });
  assert.equal(
    workspaceView.drawingWorkspaceSurface({
      file: {
        id: "00000000-0000-4000-8000-000000000003",
        kind: "ifc",
        immutable: true,
        originalFilename: "model.ifc",
        byteSize: 2048,
      },
      page: null,
      sourceUrl: null,
    }).sourceError,
    null,
  );
  for (const changes of [
    { immutable: true, sourceUrl: null },
    { immutable: false, sourceUrl: "https://storage.test/model" },
  ]) {
    const failedClosed = workspaceView.drawingWorkspaceSurface({
      file: {
        id: "00000000-0000-4000-8000-000000000003",
        kind: "ifc",
        immutable: changes.immutable,
        originalFilename: "model.ifc",
        byteSize: 2048,
      },
      page: null,
      sourceUrl: changes.sourceUrl,
    });
    assert.deepEqual(failedClosed, {
      layout: "canvas",
      background: { kind: "blank", width: 841, height: 594 },
      ifcViewer: null,
      sourceError: null,
    });
  }
});

test("PDF and blank workspace surfaces remain a single canvas", () => {
  assert.ok(workspaceView);
  const file = {
    id: "00000000-0000-4000-8000-000000000003",
    kind: "pdf",
    immutable: true,
    originalFilename: "plan.pdf",
    byteSize: 2048,
  };
  assert.deepEqual(
    workspaceView.drawingWorkspaceSurface({
      file: null,
      page: { width: 200, height: 100, backgroundPdfPage: null },
      sourceUrl: null,
    }),
    {
      layout: "canvas",
      background: { kind: "blank", width: 200, height: 100 },
      ifcViewer: null,
      sourceError: null,
    },
  );
  assert.deepEqual(
    workspaceView.drawingWorkspaceSurface({
      file,
      page: { width: 200, height: 100, backgroundPdfPage: 2 },
      sourceUrl: "https://storage.test/plan",
    }),
    {
      layout: "canvas",
      background: {
        kind: "pdf",
        width: 200,
        height: 100,
        pageNumber: 2,
        signedUrl: "https://storage.test/plan",
      },
      ifcViewer: null,
      sourceError: null,
    },
  );
  assert.deepEqual(
    workspaceView.drawingWorkspaceSurface({
      file,
      page: { width: 200, height: 100, backgroundPdfPage: null },
      sourceUrl: null,
    }),
    {
      layout: "canvas",
      background: { kind: "blank", width: 200, height: 100 },
      ifcViewer: null,
      sourceError: null,
    },
  );
});

test("PDF image placement view model contains rendered pixels in page world bounds", () => {
  assert.ok(workspaceView);
  assert.equal(typeof workspaceView.drawingPdfImagePlacement, "function");
  assert.deepEqual(
    workspaceView.drawingPdfImagePlacement(
      { width: 400, height: 200 },
      { width: 100, height: 100 },
    ),
    { x: 0, y: 25, width: 100, height: 50 },
  );
});

test("workspace route wires the verified source bundle and controlled IFC surface", async () => {
  const [screen, shell, canvas] = await Promise.all([
    readFile(
      new URL("../app/lukas/screens/drawing-workspace.tsx", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../app/lukas/components/drawing-workspace.tsx", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL(
        "../app/lukas/components/drawing-canvas.client.tsx",
        import.meta.url,
      ),
      "utf8",
    ),
  ]);
  assert.match(
    screen,
    /parseDrawingWorkspaceViewState\(\s*new URL\(request\.url\)\.searchParams/s,
  );
  assert.match(
    screen,
    /loadDrawingWorkspaceSourceBundle\(\s*client,\s*workspace,\s*selectedIfcFileId,\s*viewState\.view !== "2d"/s,
  );
  assert.match(screen, /sourceBundle=\{loaderData\.sourceBundle\}/);
  assert.match(screen, /selectedIfcFileId=\{loaderData\.selectedIfcFileId\}/);
  assert.match(screen, /viewMode=\{loaderData\.viewState\.view\}/);
  assert.doesNotMatch(screen, /loadDrawingWorkspaceSourceUrl/);
  assert.match(shell, /drawingWorkspaceReviewControls\(/);
  assert.match(shell, /drawingRevisionDecisionFields\(/);
  assert.match(shell, /name="decision"/);
  assert.doesNotMatch(shell, /name="review"/);
  assert.match(
    shell,
    /value=\{\s*effectiveCapability === "approver" \? "approved" : "reviewed"\s*\}/s,
  );
  assert.match(shell, /value="rejected"/);
  assert.equal(shell.match(/loadDrawingClientModule\(/g)?.length, 2);
  assert.match(shell, /2D 도면/);
  assert.match(shell, /IFC 3D/);
  assert.match(shell, /분할 보기/);
  assert.match(shell, /IFC 파일 선택/);
  assert.match(shell, /검증된 IFC 파생물 보기/);
  assert.doesNotMatch(shell, /byteSize=\{selectedIfc\.byteSize\}/);
  assert.match(shell, /<IfcViewer/);
  assert.doesNotMatch(shell, /target="_blank"/);
  assert.equal(canvas.match(/drawingPanGestureTransition\(/g)?.length, 4);
  assert.match(canvas, /drawingPdfImagePlacement\(rendered\.canvasSize/);
  assert.doesNotMatch(canvas, /containPdfSource/);
  assert.match(canvas, /x=\{pdfSource\.bounds\.x\}/);
  assert.match(canvas, /y=\{pdfSource\.bounds\.y\}/);
});

test("workspace exposes six authoring tools, transient previews, and an accessible native command menu", async () => {
  const [shell, canvas, menu] = await Promise.all([
    readFile(
      new URL("../app/lukas/components/drawing-workspace.tsx", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL(
        "../app/lukas/components/drawing-canvas.client.tsx",
        import.meta.url,
      ),
      "utf8",
    ),
    readFile(
      new URL(
        "../app/lukas/components/drawing-command-menu.tsx",
        import.meta.url,
      ),
      "utf8",
    ),
  ]);
  for (const label of [
    "선 도구",
    "폴리라인 도구",
    "사각형 도구",
    "원 도구",
    "텍스트 도구",
    "치수 도구",
  ]) {
    assert.match(shell, new RegExp(label));
  }
  assert.match(shell, /DrawingCommandMenu/);
  assert.match(shell, /event\.(metaKey \|\| event\.ctrlKey)/);
  assert.match(shell, /event\.key\.toLowerCase\(\) !== "k"/);
  assert.match(canvas, /name="drawing-preview"/);
  assert.match(canvas, /미보정/);
  assert.match(canvas, /drawingToolEventTransition\(/);
  assert.doesNotMatch(canvas, /event\.evt\.detail/);
  assert.match(canvas, /geometrySnapPoints\(/);
  assert.match(canvas, /memo\(function CommittedDrawingLayer/);
  assert.match(canvas, /<CommittedDrawingLayer/);
  assert.equal(canvas.match(/<Layer(?:\s|>)/g)?.length, 3);
  for (const name of [
    "drawing-background",
    "drawing-objects",
    "drawing-overlay",
  ])
    assert.match(canvas, new RegExp(`name="${name}"`));
  assert.match(menu, /<dialog/);
  assert.match(menu, /aria-labelledby="drawing-command-menu-title"/);
  assert.match(menu, /aria-label="도면 명령 검색"/);
  assert.match(menu, /\.showModal\(\)/);
  assert.match(menu, /onKeyDown=\{/);
  assert.doesNotMatch(menu, /role="listbox"/);
  assert.doesNotMatch(menu, /role="option"/);
});

test("workspace exposes grouped architectural tools and a focused semantic inspector", async () => {
  const [shell, canvas, menu, inspector] = await Promise.all([
    readFile(
      new URL("../app/lukas/components/drawing-workspace.tsx", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL(
        "../app/lukas/components/drawing-canvas.client.tsx",
        import.meta.url,
      ),
      "utf8",
    ),
    readFile(
      new URL(
        "../app/lukas/components/drawing-command-menu.tsx",
        import.meta.url,
      ),
      "utf8",
    ),
    readFile(
      new URL(
        "../app/lukas/components/drawing-semantic-inspector.tsx",
        import.meta.url,
      ),
      "utf8",
    ),
  ]);
  assert.match(shell, /aria-label="건축 객체"/);
  for (const label of [
    "벽 도구",
    "개구부 도구",
    "공간 도구",
    "영역 도구",
    "그리드 도구",
    "호 도구",
  ]) {
    assert.match(shell, new RegExp(label));
    assert.match(menu, new RegExp(label));
  }
  assert.match(shell, /objects=\{resolvedObjects\.objects\}/);
  assert.match(canvas, /name="drawing-semantic-label"/);
  assert.match(canvas, /data-rendered-semantic-object-count/);
  assert.match(canvas, /resolveDrawingOpening/);
  for (const label of [
    "벽 두께",
    "벽 높이",
    "개구부 종류",
    "벽 기준 오프셋",
    "공간 번호",
    "바닥 마감",
    "호 반지름",
    "미리보기",
    "서버 계산 · V1",
  ])
    assert.match(inspector, new RegExp(label));
  assert.match(inspector, /type: "update_objects"/);
  assert.match(inspector, /baseVersion: object\.version/);
});

test("workspace remounts Canvas with sanitized transient props at each authorization boundary", async () => {
  const shell = await readFile(
    new URL("../app/lukas/components/drawing-workspace.tsx", import.meta.url),
    "utf8",
  );
  assert.match(shell, /drawingTransientAuthorizationKey\(drawingState/);
  assert.match(shell, /activeLayer: authorizationLayer/);
  assert.match(shell, /authorizationProbe\.state\.layers/);
  assert.match(shell, /transientInputInvalidatedRef\.current = true/);
  assert.match(shell, /key=\{authorizationKey\}/);
  assert.match(shell, /activeTool=\{transient\.activeTool as DrawingTool\}/);
  assert.match(shell, /selectedIds=\{transient\.selectedIds\}/);
});

test("route measurement loading propagates authorized bootstrap denial", async () => {
  assert.equal(
    typeof workspaceServer.loadDrawingWorkspaceMeasurementState,
    "function",
  );
  const revisionId = "70000000-0000-4000-8000-000000000001";
  const client = {
    async rpc(name, args) {
      assert.equal(name, "lukas_drawing_collaboration_bootstrap");
      assert.deepEqual(args, { p_revision_id: revisionId });
      return {
        data: null,
        error: { code: "42501", message: "permission denied" },
      };
    },
  };

  await assert.rejects(
    workspaceServer.loadDrawingWorkspaceMeasurementState(client, {
      documentId: "70000000-0000-4000-8000-000000000002",
      revisionId,
      revisionVersion: 1,
    }),
    /permission denied/,
  );
});
