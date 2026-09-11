import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { createServer } from "vite";
import { z } from "zod";

import routes from "../app/routes.ts";
import * as drawingLayout from "../app/lukas/lib/drawing-layout.ts";

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
const drawingStartActionClientKey = "__drawingStartActionClient";
globalThis[drawingStartActionClientKey] = () => {
  throw new Error("Drawing start action client is not configured.");
};
const uploadFinalizeClientKey = "__projectUploadFinalizeClient";
const uploadFinalizeDelegateKey = "__projectUploadFinalizeDelegate";
globalThis[uploadFinalizeClientKey] = () => {
  throw new Error("Upload finalization client is not configured.");
};
globalThis[uploadFinalizeDelegateKey] = () => {
  throw new Error("Upload finalization delegate is not configured.");
};
const drawingStartActionVite = await createServer({
  appType: "custom",
  configFile: false,
  logLevel: "silent",
  plugins: [
    {
      enforce: "pre",
      load(id) {
        if (id === "\0virtual:drawing-start-action-client")
          return `export default (...args) => globalThis[${JSON.stringify(drawingStartActionClientKey)}](...args);`;
      },
      name: "drawing-start-action-client",
      resolveId(source) {
        if (source.endsWith("core/lib/supa-client.server.ts"))
          return "\0virtual:drawing-start-action-client";
      },
    },
  ],
  resolve: {
    alias: { "~": fileURLToPath(new URL("../app", import.meta.url)) },
  },
  server: { middlewareMode: true },
});
const uploadFinalizeVite = await createServer({
  appType: "custom",
  configFile: false,
  logLevel: "silent",
  plugins: [
    {
      enforce: "pre",
      load(id) {
        if (id === "\0virtual:project-upload-finalize-client")
          return `export default (...args) => globalThis[${JSON.stringify(uploadFinalizeClientKey)}](...args);`;
        if (id === "\0virtual:project-upload-finalize-delegate")
          return `export const action = (...args) => globalThis[${JSON.stringify(uploadFinalizeDelegateKey)}](...args);`;
      },
      name: "project-upload-finalize",
      resolveId(source, importer) {
        if (/core\/lib\/supa-client\.server(?:\.ts)?$/.test(source))
          return "\0virtual:project-upload-finalize-client";
        if (
          source === "./project" &&
          importer?.includes("/lukas/screens/project-upload-finalize.ts")
        )
          return "\0virtual:project-upload-finalize-delegate";
      },
    },
  ],
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
const newScreenAction = await drawingStartActionVite
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
  .ssrLoadModule("/app/lukas/screens/drawing-workspace-export.server.ts")
  .catch(() => ({}));
const measurementEvidenceResource = await vite
  .ssrLoadModule("/app/lukas/screens/drawing-workspace-measurement-evidence.ts")
  .catch(() => ({}));
const quantityLineageResource = await vite
  .ssrLoadModule("/app/lukas/screens/drawing-workspace-quantity-lineage.ts")
  .catch(() => ({}));
const uploadFinalizeResource = await uploadFinalizeVite
  .ssrLoadModule("/app/lukas/screens/project-upload-finalize.ts")
  .catch(() => ({}));

test.after(async () => {
  delete globalThis[drawingStartActionClientKey];
  delete globalThis[uploadFinalizeClientKey];
  delete globalThis[uploadFinalizeDelegateKey];
  await Promise.all([
    vite.close(),
    drawingStartActionVite.close(),
    uploadFinalizeVite.close(),
  ]);
});
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

test("PDF source attachment form is closed, exact, and idempotent", () => {
  const parse = workspaceScreen.parseDrawingWorkspaceSourceAttachForm;
  assert.equal(typeof parse, "function");
  const canvasId = "00000000-0000-4000-8000-000000000005";
  const requestId = "00000000-0000-4000-8000-000000000006";
  const valid = new FormData();
  valid.set("intent", "attach_source");
  valid.set("revision_id", ids.file);
  valid.set("canvas_id", canvasId);
  valid.set("source_file_id", ids.project);
  valid.set("request_id", requestId);
  assert.deepEqual(parse(valid), {
    revisionId: ids.file,
    canvasId,
    sourceFileId: ids.project,
    requestId,
  });

  const extra = new FormData();
  for (const [name, value] of valid) extra.append(name, value);
  extra.set("role", "admin");
  assert.throws(() => parse(extra), z.ZodError);
  const duplicate = new FormData();
  for (const [name, value] of valid) duplicate.append(name, value);
  duplicate.append("source_file_id", ids.document);
  assert.throws(() => parse(duplicate), z.ZodError);
});

test("PDF source attachment scope requires an editor, source-free draft, and default paper canvas", () => {
  const assertScope = workspaceScreen.assertDrawingWorkspaceSourceAttachScope;
  const canvasId = "00000000-0000-4000-8000-000000000005";
  const mutation = {
    revisionId: ids.file,
    canvasId,
    sourceFileId: ids.project,
    requestId: "00000000-0000-4000-8000-000000000006",
  };
  const workspace = {
    primarySource: null,
    document: {
      id: ids.document,
      source_file_id: null,
      source_sha256: null,
      revision: {
        id: ids.file,
        status: "draft",
        pages: [
          {
            id: "00000000-0000-4000-8000-000000000007",
            canvases: [
              {
                id: canvasId,
                spaceKind: "paper",
                background: null,
                sortOrder: 0,
              },
            ],
          },
        ],
      },
    },
  };
  assert.deepEqual(
    assertScope({ capability: "editor", mutation, workspace }),
    mutation,
  );

  for (const [input, status] of [
    [{ capability: "viewer", mutation, workspace }, 403],
    [
      {
        capability: "editor",
        mutation,
        workspace: {
          ...workspace,
          document: { ...workspace.document, source_file_id: ids.project },
        },
      },
      409,
    ],
    [
      {
        capability: "editor",
        mutation: { ...mutation, canvasId: ids.document },
        workspace,
      },
      409,
    ],
  ])
    assert.throws(
      () => assertScope(input),
      (error) => error instanceof Response && error.status === status,
    );
});

test("drawing measurement evidence uses one immutable checkpoint URL", () => {
  const location = workspacePaths.drawingWorkspaceMeasurementEvidencePath;
  assert.equal(typeof location, "function");
  const url = new URL(
    location({
      projectId: ids.project,
      workspaceId: ids.document,
      revisionId: ids.file,
      revisionVersion: 7,
      snapshotSha256: "a".repeat(64),
      operationCheckpoint: 19,
    }),
    "https://example.test",
  );
  assert.equal(
    url.pathname,
    `/projects/${ids.project}/workspaces/${ids.document}/measurement-evidence`,
  );
  assert.deepEqual(Object.fromEntries(url.searchParams), {
    revision: ids.file,
    version: "7",
    sha256: "a".repeat(64),
    operation: "19",
  });
  assert.throws(() =>
    location({
      projectId: ids.project,
      workspaceId: ids.document,
      revisionId: ids.file,
      revisionVersion: 0,
      snapshotSha256: "bad",
      operationCheckpoint: -1,
    }),
  );
});

test("measurement evidence resource accepts exactly one value for every checkpoint field", () => {
  const parse = measurementEvidenceResource.parseMeasurementEvidenceQuery;
  assert.equal(typeof parse, "function");
  const valid = new URLSearchParams({
    revision: ids.file,
    version: "7",
    sha256: "a".repeat(64),
    operation: "19",
  });
  assert.deepEqual(parse(valid), {
    revision: ids.file,
    version: 7,
    sha256: "a".repeat(64),
    operation: 19,
  });

  for (const invalid of [
    new URLSearchParams([...valid, ["unexpected", "1"]]),
    new URLSearchParams([...valid, ["revision", ids.document]]),
  ])
    assert.throws(
      () => parse(invalid),
      (error) => error instanceof Response && error.status === 400,
    );
});

test("measurement evidence resource keeps database failures distinct from stale checkpoints", async () => {
  const assertResult =
    measurementEvidenceResource.assertMeasurementEvidenceScopeResult;
  assert.equal(typeof assertResult, "function");

  let databaseFailure;
  try {
    assertResult({
      data: null,
      error: { message: "private database detail" },
    });
  } catch (error) {
    databaseFailure = error;
  }
  assert.ok(databaseFailure instanceof Response);
  assert.equal(databaseFailure.status, 503);
  assert.equal(
    await databaseFailure.text(),
    "측정 근거를 불러오지 못했습니다.",
  );

  assert.throws(
    () => assertResult({ data: null, error: null }),
    (error) => error instanceof Response && error.status === 409,
  );
  assert.doesNotThrow(() =>
    assertResult({ data: { id: ids.file }, error: null }),
  );
});

test("ordinary object selection keeps the 10k workspace loader stable", () => {
  const shouldRevalidate = workspaceScreen.shouldRevalidate;
  assert.equal(typeof shouldRevalidate, "function");
  const workspacePath = `/projects/${ids.project}/workspaces/${ids.document}`;
  const revision = "00000000-0000-4000-8000-000000000005";
  const objectA = "00000000-0000-4000-8000-000000000006";
  const objectB = "00000000-0000-4000-8000-000000000007";
  const decide = (current, next, extra = {}) =>
    shouldRevalidate({
      actionResult: undefined,
      currentParams: {},
      currentUrl: new URL(current, "https://example.test"),
      defaultShouldRevalidate: true,
      formAction: undefined,
      formData: null,
      formEncType: undefined,
      formMethod: undefined,
      nextParams: {},
      nextUrl: new URL(next, "https://example.test"),
      ...extra,
    });

  assert.equal(
    decide(
      workspacePath,
      `${workspacePath}?object=${objectA}&revision=${revision}`,
    ),
    false,
    "the first ordinary selection must not reload all 10k objects",
  );
  assert.equal(
    decide(
      `${workspacePath}?object=${objectA}&revision=${revision}`,
      `${workspacePath}?object=${objectB}&revision=${revision}`,
    ),
    false,
  );
  assert.equal(
    decide(
      `${workspacePath}?object=${objectA}&revision=${revision}`,
      workspacePath,
    ),
    false,
  );
  assert.equal(
    decide(
      `${workspacePath}?object=${objectA}&revision=${revision}`,
      `${workspacePath}?object=${objectB}&revision=${ids.file}`,
    ),
    true,
    "an explicit revision change still reloads authoritative state",
  );
  assert.equal(
    decide(
      `${workspacePath}?object=${objectA}&revision=${revision}`,
      `${workspacePath}?object=${objectB}&revision=${revision}&view=split`,
    ),
    true,
  );
  assert.equal(
    decide(
      `${workspacePath}?object=${objectA}&revision=${revision}&boq=${ids.file}&line=${ids.project}`,
      `${workspacePath}?object=${objectB}&revision=${revision}`,
    ),
    true,
    "a BOQ evidence transition keeps the full authorization loader",
  );
  const mutation = new FormData();
  mutation.set("intent", "apply_operation");
  assert.equal(
    decide(workspacePath, workspacePath, { formData: mutation }),
    true,
  );
});

test("object quantity lineage uses a strict small resource URL", () => {
  const location = workspacePaths.drawingWorkspaceQuantityLineagePath;
  assert.equal(typeof location, "function");
  assert.equal(
    location(ids.project, ids.document),
    `/projects/${ids.project}/workspaces/${ids.document}/quantity-lineage`,
  );
  assert.throws(() => location(ids.project, "not-a-uuid"));

  const parse = quantityLineageResource.parseQuantityLineageResourceQuery;
  assert.equal(typeof parse, "function");
  const valid = new URLSearchParams({
    revision: ids.file,
    object: ids.document,
  });
  assert.deepEqual(parse(valid), {
    revisionId: ids.file,
    objectId: ids.document,
    boqVersionId: null,
    boqLineId: null,
    evidenceFileId: null,
    cursor: null,
  });
  for (const invalid of [
    new URLSearchParams({ revision: ids.file }),
    new URLSearchParams([...valid, ["object", ids.project]]),
    new URLSearchParams([...valid, ["unexpected", "1"]]),
    new URLSearchParams([...valid, ["boq", ids.project]]),
  ])
    assert.throws(
      () => parse(invalid),
      (error) => error instanceof Response && error.status === 400,
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
    assert.equal(
      await thrown.text(),
      "견적 연결 경로 식별자가 올바르지 않습니다.",
    );
  }
});

test("estimate binding action uses the shared bounded error response", async () => {
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

test("workspace loader retries one incoherent read snapshot and preserves final failure", async () => {
  const retry = workspaceScreen.retryDrawingWorkspaceLoaderSnapshot;
  assert.equal(typeof retry, "function");

  let attempts = 0;
  const recovered = await retry(async () => {
    attempts += 1;
    if (attempts === 1)
      throw new workspaceServer.DrawingWorkspaceRetryableError("stale read");
    return "coherent";
  });
  assert.equal(recovered, "coherent");
  assert.equal(attempts, 2);

  attempts = 0;
  let exhausted;
  try {
    await retry(async () => {
      attempts += 1;
      throw new workspaceServer.DrawingWorkspaceRetryableError("still stale");
    });
  } catch (error) {
    exhausted = error;
  }
  assert.ok(exhausted instanceof Response);
  assert.equal(exhausted.status, 503);
  assert.equal(exhausted.headers.get("Retry-After"), "1");
  assert.equal(
    await exhausted.text(),
    "작업실이 변경 중입니다. 잠시 후 다시 열어 주세요.",
  );
  assert.equal(attempts, 2);

  attempts = 0;
  await assert.rejects(
    retry(async () => {
      attempts += 1;
      throw new Error("not retryable");
    }),
    /not retryable/,
  );
  assert.equal(attempts, 1);

  let staleFocus;
  try {
    await retry(async () => {
      throw new workspaceServer.DrawingWorkspaceConflictError(
        "internal canonical object detail",
      );
    });
  } catch (error) {
    staleFocus = error;
  }
  assert.ok(staleFocus instanceof Response);
  assert.equal(staleFocus.status, 404);
  assert.equal(await staleFocus.text(), "연결된 도면 근거를 열 수 없습니다.");
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
  const relink = new FormData();
  relink.set("intent", "relink_anchor");
  relink.set("new_anchor_id", ids.project);
  assert.equal(requestId(relink), ids.project);
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
    document: {
      revision: { id: ids.document, status: "draft" },
    },
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
    create.set("intent", "request_review");
    create.set("revision_id", ids.document);
    create.set("freeze_request_id", ids.file);
    await workspaceServer.handleWorkspaceMutation({
      client: {},
      projectId: ids.project,
      capability: "editor",
      workspace,
      form: create,
      async requestReview() {
        throw new TypeError("server-only transport detail");
      },
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
    document: { revision: { id: ids.document, status: "approved" } },
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
    {},
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

test("canonical revision relink is limited to one comment-capable primary source candidate", () => {
  const assertScope = workspaceScreen.assertDrawingWorkspaceRevisionRelinkScope;
  assert.equal(typeof assertScope, "function");
  const pdfFileId = ids.file;
  const previousAnchorId = "00000000-0000-4000-8000-000000000010";
  const mutation = {
    previousAnchorId,
    newAnchorId: "00000000-0000-4000-8000-000000000011",
    currentFileId: pdfFileId,
    anchor: {
      kind: "pdf_region",
      fileId: pdfFileId,
      pageNumber: 1,
      x: 0.1,
      y: 0.2,
      width: 0.3,
      height: 0.4,
      label: "새 개정 위치",
    },
    note: "새 PDF에서 다시 확인",
  };
  const candidate = {
    issueId: "00000000-0000-4000-8000-000000000012",
    issueTitle: "개정 검토",
    previousAnchorId,
    previousFileId: "00000000-0000-4000-8000-000000000013",
    sourceKind: "pdf_region",
    kind: "manual_reanchor_required",
    ifcGlobalId: null,
  };
  const workspace = {
    primarySource: { id: pdfFileId, kind: "pdf" },
  };

  assert.equal(
    assertScope({
      capability: "commenter",
      mutation,
      revisionReview: [candidate],
      workspace,
    }),
    candidate,
  );

  for (const [input, status] of [
    [{ capability: "viewer" }, 403],
    [{ capability: "approver" }, 403],
    [{ workspace: { primarySource: null } }, 409],
    [
      {
        mutation: {
          ...mutation,
          currentFileId: ids.project,
          anchor: { ...mutation.anchor, fileId: ids.project },
        },
      },
      409,
    ],
    [{ revisionReview: [] }, 409],
    [
      {
        revisionReview: [{ ...candidate, sourceKind: "ifc_element" }],
      },
      409,
    ],
  ])
    assert.throws(
      () =>
        assertScope({
          capability: "commenter",
          mutation,
          revisionReview: [candidate],
          workspace,
          ...input,
        }),
      (error) => error instanceof Response && error.status === status,
    );
});

test("primary-source issue room forwards all revision candidates for one bounded query", async () => {
  const calls = [];
  const room = { issues: [] };
  const result = await workspaceScreen.loadDrawingWorkspaceIssueRoom(
    {},
    ids.project,
    { primarySource: { id: ids.file } },
    { focusIssueIds: [ids.document, ids.document, ids.project] },
    async (_client, projectId, fileId, options) => {
      calls.push({ projectId, fileId, options });
      return room;
    },
  );
  assert.equal(result, room);
  assert.deepEqual(calls, [
    {
      projectId: ids.project,
      fileId: ids.file,
      options: { focusIssueIds: [ids.document, ids.document, ids.project] },
    },
  ]);
});

test("revision relink authority accepts an exact candidate beyond the visible page", async () => {
  const authorize =
    workspaceScreen.assertDrawingWorkspaceRevisionRelinkAuthority;
  assert.equal(typeof authorize, "function");
  const currentFileId = "00000000-0000-4000-8000-000000000101";
  const previousAnchorId = "00000000-0000-4000-8000-000000000151";
  const mutation = {
    previousAnchorId,
    newAnchorId: "00000000-0000-4000-8000-000000000152",
    currentFileId,
    anchor: {
      kind: "pdf_region",
      fileId: currentFileId,
      pageNumber: 1,
      x: 0.1,
      y: 0.2,
      width: 0.3,
      height: 0.4,
      label: "새 개정 위치",
    },
    note: "새 PDF에서 다시 확인",
  };
  const result = { data: null, error: null };
  const client = {
    from(table) {
      const row =
        table === "lukas_qto_file_revisions"
          ? {
              project_id: ids.project,
              previous_file_id: "00000000-0000-4000-8000-000000000111",
              current_file_id: currentFileId,
            }
          : table === "lukas_drawing_issue_anchors"
            ? {
                id: previousAnchorId,
                issue_id: "00000000-0000-4000-8000-000000000121",
                project_id: ids.project,
                file_id: "00000000-0000-4000-8000-000000000111",
                anchor_kind: "pdf_region",
                ifc_global_id: null,
                active: true,
              }
            : table === "lukas_drawing_issues"
              ? {
                  id: "00000000-0000-4000-8000-000000000121",
                  project_id: ids.project,
                  title: "51번째 검토 이슈",
                  status: "open",
                }
              : null;
      if (!row) throw new Error(`Unexpected table: ${table}`);
      const query = {
        select() {
          return query;
        },
        eq() {
          return query;
        },
        maybeSingle() {
          return Promise.resolve({ ...result, data: row });
        },
      };
      return query;
    },
  };

  assert.deepEqual(
    await authorize({
      baseClient: client,
      capability: "commenter",
      mutation,
      projectId: ids.project,
      workspace: { primarySource: { id: currentFileId, kind: "pdf" } },
    }),
    {
      issueId: "00000000-0000-4000-8000-000000000121",
      issueTitle: "51번째 검토 이슈",
      previousAnchorId,
      previousFileId: "00000000-0000-4000-8000-000000000111",
      sourceKind: "pdf_region",
      kind: "manual_reanchor_required",
      ifcGlobalId: null,
    },
  );
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
    byPath.get(
      "/projects/:projectId/workspaces/:workspaceId/measurement-evidence",
    ),
    "lukas/screens/drawing-workspace-measurement-evidence.ts",
  );
  assert.equal(
    byPath.get("/projects/:projectId/workspaces/:workspaceId/quantity-lineage"),
    "lukas/screens/drawing-workspace-quantity-lineage.ts",
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
  for (const intent of ["create_ifc", "create_dxf"]) {
    assert.deepEqual(
      newScreen.parseDrawingWorkspaceStartForm(
        startForm({ intent, ...common, sourceFileId: ids.file }),
      ),
      { intent, ...common, sourceFileId: ids.file },
    );
  }
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

test("new workspace start separates unused PDFs from sources that already have a canonical workspace", () => {
  const unusedFile = "00000000-0000-4000-8000-000000000005";
  assert.deepEqual(
    newScreen.bindDrawingWorkspacePdfSources(
      [
        { id: ids.file, original_filename: "existing.pdf" },
        { id: unusedFile, original_filename: "unused.pdf" },
      ],
      [{ id: ids.document, source_file_id: ids.file }],
    ),
    [
      {
        id: ids.file,
        original_filename: "existing.pdf",
        workspaceId: ids.document,
      },
      {
        id: unusedFile,
        original_filename: "unused.pdf",
        workspaceId: null,
      },
    ],
  );
});

function startResourcePromises({
  failLibrary = false,
  failStarters = false,
} = {}) {
  return {
    documents: Promise.resolve({ data: [], error: null }),
    files: Promise.resolve({
      data: [{ id: ids.file, original_filename: "A-101.pdf" }],
      error: null,
    }),
    libraryVersions: failLibrary
      ? Promise.reject(new Error("private organization library failure"))
      : Promise.resolve([{ id: ids.document }]),
    starters: failStarters
      ? Promise.reject(new Error("private starter catalog failure"))
      : Promise.resolve([{ definition: { key: "interior-basic" } }]),
  };
}

test("platform starter failure preserves mandatory PDF data and bounds its recovery notice", async () => {
  const resolve = newScreen.resolveDrawingWorkspaceStartResources;
  assert.equal(typeof resolve, "function");
  const result = await resolve(startResourcePromises({ failStarters: true }));

  assert.deepEqual(result.files, {
    data: [{ id: ids.file, original_filename: "A-101.pdf" }],
    error: null,
  });
  assert.deepEqual(result.starters, []);
  assert.deepEqual(result.libraryVersions, [{ id: ids.document }]);
  assert.deepEqual(result.catalogNotices, {
    nativeTemplates: null,
    organizationTemplates: null,
    starters:
      "기본 템플릿을 불러오지 못했습니다. 빈 작업실이나 PDF로 시작해 주세요.",
  });
  assert.deepEqual(result.nativeTemplates, []);
  assert.doesNotMatch(
    JSON.stringify(result),
    /private starter catalog failure/,
  );
});

test("organization template failure preserves platform starters and bounds its recovery notice", async () => {
  const result = await newScreen.resolveDrawingWorkspaceStartResources(
    startResourcePromises({ failLibrary: true }),
  );

  assert.deepEqual(result.starters, [
    { definition: { key: "interior-basic" } },
  ]);
  assert.deepEqual(result.libraryVersions, []);
  assert.deepEqual(result.catalogNotices, {
    nativeTemplates: null,
    organizationTemplates:
      "회사 템플릿을 불러오지 못했습니다. 빈 작업실이나 PDF로 시작해 주세요.",
    starters: null,
  });
  assert.deepEqual(result.nativeTemplates, []);
  assert.doesNotMatch(
    JSON.stringify(result),
    /private organization library failure/,
  );
});

test("both optional catalog failures preserve blank and PDF start resources", async () => {
  const result = await newScreen.resolveDrawingWorkspaceStartResources(
    startResourcePromises({ failLibrary: true, failStarters: true }),
  );

  assert.deepEqual(result.documents, { data: [], error: null });
  assert.deepEqual(result.files, {
    data: [{ id: ids.file, original_filename: "A-101.pdf" }],
    error: null,
  });
  assert.deepEqual(result.starters, []);
  assert.deepEqual(result.libraryVersions, []);
  assert.ok(result.catalogNotices.starters);
  assert.ok(result.catalogNotices.organizationTemplates);
});

test("starter deep links fall back only when the optional catalog is unavailable", async () => {
  const resolve = newScreen.resolveDrawingStarterSelection;
  const starters = [{ key: "interior-basic" }];
  assert.equal(resolve("interior-basic", starters, false), "interior-basic");
  assert.equal(resolve("interior-basic", [], true), undefined);
  assert.throws(
    () => resolve("interior-basic", [], false),
    (error) => error instanceof Response && error.status === 400,
  );
  assert.throws(
    () => resolve("not a valid key", [], true),
    (error) => error instanceof Response && error.status === 400,
  );
});

test("mandatory PDF authority failure propagates instead of becoming an optional catalog notice", async () => {
  const mandatoryFailure = new Error("mandatory PDF authority failed");
  await assert.rejects(
    newScreen.resolveDrawingWorkspaceStartResources({
      ...startResourcePromises({ failLibrary: true, failStarters: true }),
      files: Promise.reject(mandatoryFailure),
    }),
    (error) => error === mandatoryFailure,
  );
});

test("PDF source conflict redirects only to another creation and resumes its own partial request", () => {
  const requestId = "00000000-0000-4000-8000-000000000010";
  assert.equal(
    newScreen.reusablePdfWorkspaceId(
      { id: ids.document, creation_request_id: null },
      requestId,
    ),
    ids.document,
  );
  assert.equal(
    newScreen.reusablePdfWorkspaceId(
      {
        id: ids.document,
        creation_request_id: "00000000-0000-4000-8000-000000000011",
      },
      requestId,
    ),
    ids.document,
  );
  assert.equal(
    newScreen.reusablePdfWorkspaceId(
      { id: ids.document, creation_request_id: requestId },
      requestId,
    ),
    null,
  );
  assert.equal(newScreen.reusablePdfWorkspaceId(null, requestId), null);
});

test("unauthenticated malformed workspace start redirects before validation", async () => {
  const headers = new Headers({
    "Set-Cookie": "session=workspace-start; Path=/; HttpOnly",
  });
  globalThis[drawingStartActionClientKey] = () => [
    { auth: { getUser: async () => ({ data: { user: null } }) } },
    headers,
  ];

  await assert.rejects(
    newScreenAction.action({
      request: new Request(
        `http://app.test/projects/${ids.project}/workspaces/new?source=upload`,
        { method: "POST", body: new FormData() },
      ),
      params: { projectId: ids.project },
    }),
    (response) => {
      assert.equal(response.status, 302);
      assert.equal(
        response.headers.get("Location"),
        `/login?next=%2Fprojects%2F${ids.project}%2Fworkspaces%2Fnew%3Fsource%3Dupload`,
      );
      assert.equal(
        response.headers.get("Set-Cookie"),
        "session=workspace-start; Path=/; HttpOnly",
      );
      return true;
    },
  );
});

test("failed start validation preserves the submitted retry identity and isolates its field error", async () => {
  const clientRequestId = "00000000-0000-4000-8000-000000000010";
  const clientCreatedAt = "2026-08-31T01:02:03.000Z";
  const headers = new Headers();
  const project = { id: ids.project, name: "Test", owner_id: "actor" };
  const query = {
    eq() {
      return query;
    },
    select() {
      return query;
    },
    single: async () => ({ data: project, error: null }),
  };
  globalThis[drawingStartActionClientKey] = () => [
    {
      auth: {
        getUser: async () => ({
          data: {
            user: {
              app_metadata: {},
              id: "actor",
              is_anonymous: false,
            },
          },
        }),
      },
      from(table) {
        assert.equal(table, "lukas_qto_projects");
        return query;
      },
    },
    headers,
  ];
  const response = await newScreenAction.action({
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

test("project upload finalization is a dedicated authenticated JSON resource route", async () => {
  const registered = flatten(routes).find(
    (route) => route.path === "/projects/:projectId/files/finalize-upload",
  );
  assert.deepEqual(registered && [registered.path, registered.file], [
    "/projects/:projectId/files/finalize-upload",
    "lukas/screens/project-upload-finalize.ts",
  ]);

  const resource = await readFile(
    new URL("../app/lukas/screens/project-upload-finalize.ts", import.meta.url),
    "utf8",
  );
  assert.match(resource, /projectAction/);
  assert.doesNotMatch(resource, /\.formData\(\)/);
  assert.doesNotMatch(resource, /export default/);

  const actionSource = resource.slice(
    resource.indexOf("export async function action"),
  );
  const authIndex = actionSource.indexOf("await client.auth.getUser()");
  const parseIndex = actionSource.indexOf(
    "await parseProjectUploadFinalizationRequest(request)",
  );
  assert.ok(authIndex >= 0, "the resource action must authenticate directly");
  assert.ok(
    parseIndex > authIndex,
    "the resource action must authenticate before parsing its bounded body",
  );
});

function projectUploadFinalizationRequest(
  body,
  contentType = "application/json",
) {
  return new Request(
    `http://app.test/projects/${ids.project}/files/finalize-upload`,
    {
      body,
      headers: { "Content-Type": contentType },
      method: "POST",
    },
  );
}

async function projectUploadFinalizationActionStatus(request) {
  try {
    const result = await uploadFinalizeResource.action({
      params: { projectId: ids.project },
      request,
    });
    return result instanceof Response
      ? result.status
      : (result?.init?.status ?? 200);
  } catch (error) {
    if (error instanceof Response) return error.status;
    throw error;
  }
}

test("upload finalization parser accepts only the closed JSON wire payload", async () => {
  const parse = uploadFinalizeResource.parseProjectUploadFinalizationRequest;
  assert.equal(typeof parse, "function");
  const returnTo = `/projects/${ids.project}/workspaces/${ids.document}`;
  assert.deepEqual(
    await parse(
      projectUploadFinalizationRequest(
        JSON.stringify({ verificationId: ids.file, returnTo }),
        "application/json; charset=utf-8",
      ),
    ),
    { verificationId: ids.file, returnTo },
  );

  const multipart = new FormData();
  multipart.set("upload_verification_id", ids.file);
  multipart.set("source_file", new Blob(["not accepted"]), "drawing.pdf");
  for (const request of [
    projectUploadFinalizationRequest(
      JSON.stringify({ verificationId: ids.file }),
      "text/plain",
    ),
    new Request(
      `http://app.test/projects/${ids.project}/files/finalize-upload`,
      { body: multipart, method: "POST" },
    ),
  ])
    await assert.rejects(
      parse(request),
      (error) => error instanceof Response && error.status === 415,
    );

  for (const payload of [
    {},
    { verificationId: "not-a-uuid" },
    { verificationId: ids.file, intent: "upload" },
    { verificationId: ids.file, returnTo: "https://attacker.example/collect" },
  ])
    await assert.rejects(
      parse(projectUploadFinalizationRequest(JSON.stringify(payload))),
      (error) => error instanceof Response && error.status === 400,
    );
});

test("upload finalization parser caps the encoded JSON body at 2 KiB", async () => {
  const parse = uploadFinalizeResource.parseProjectUploadFinalizationRequest;
  assert.equal(typeof parse, "function");
  const payload = JSON.stringify({ verificationId: ids.file });
  const atLimit = payload.padEnd(2 * 1024, " ");
  assert.equal(new TextEncoder().encode(atLimit).byteLength, 2 * 1024);
  assert.deepEqual(await parse(projectUploadFinalizationRequest(atLimit)), {
    verificationId: ids.file,
  });
  await assert.rejects(
    parse(projectUploadFinalizationRequest(`${atLimit} `)),
    (error) => error instanceof Response && error.status === 413,
  );
});

test("upload finalization authenticates before consuming a malformed body", async () => {
  const events = [];
  globalThis[uploadFinalizeClientKey] = () => {
    events.push("client");
    return [
      {
        auth: {
          getUser: async () => {
            events.push("auth");
            return { data: { user: null } };
          },
        },
      },
      new Headers({ "Set-Cookie": "session=finalize; Path=/; HttpOnly" }),
    ];
  };
  let delegateCalls = 0;
  globalThis[uploadFinalizeDelegateKey] = () => {
    delegateCalls += 1;
  };

  await assert.rejects(
    uploadFinalizeResource.action({
      params: { projectId: ids.project },
      request: projectUploadFinalizationRequest("{"),
    }),
    (response) => {
      assert.equal(response.status, 302);
      assert.equal(
        response.headers.get("Location"),
        `/login?next=%2Fprojects%2F${ids.project}%2Ffiles%2Ffinalize-upload`,
      );
      assert.equal(
        response.headers.get("Set-Cookie"),
        "session=finalize; Path=/; HttpOnly",
      );
      return true;
    },
  );
  assert.deepEqual(events, ["client", "auth"]);
  assert.equal(delegateCalls, 0);
});

test("upload finalization rejects invalid and oversized JSON before delegation", async () => {
  globalThis[uploadFinalizeClientKey] = () => [
    {
      auth: {
        getUser: async () => ({
          data: { user: { id: ids.document, is_anonymous: false } },
        }),
      },
    },
    new Headers(),
  ];
  let delegateCalls = 0;
  globalThis[uploadFinalizeDelegateKey] = () => {
    delegateCalls += 1;
    return { data: { destination: `/projects/${ids.project}` } };
  };

  for (const [body, status] of [
    ["", 400],
    [JSON.stringify({ verificationId: "not-a-uuid" }), 400],
    [JSON.stringify({ verificationId: ids.file, unexpected: true }), 400],
    ["{".padEnd(2 * 1024 + 1, "x"), 413],
  ])
    assert.equal(
      await projectUploadFinalizationActionStatus(
        projectUploadFinalizationRequest(body),
      ),
      status,
    );
  assert.equal(delegateCalls, 0);
});

test("valid JSON finalization reuses the refreshed authenticated session", async () => {
  const events = [];
  const user = {
    app_metadata: {},
    id: ids.document,
    is_anonymous: false,
  };
  const client = {
    auth: {
      getUser: async () => {
        events.push("auth");
        return { data: { user } };
      },
    },
  };
  const refreshedHeaders = new Headers({
    "Set-Cookie": "session=refreshed; Path=/; HttpOnly",
  });
  globalThis[uploadFinalizeClientKey] = () => [client, refreshedHeaders];
  const returnTo = `/projects/${ids.project}/workspaces/${ids.document}`;
  const delegatedResult = {
    data: { destination: returnTo },
    init: { headers: refreshedHeaders },
  };
  let delegatedArgs;
  let delegatedContext;
  let delegatedForm;
  globalThis[uploadFinalizeDelegateKey] = async (args, context) => {
    events.push("project-action");
    delegatedArgs = args;
    delegatedContext = context;
    delegatedForm = Object.fromEntries(await args.request.formData());
    return delegatedResult;
  };

  const result = await uploadFinalizeResource.action({
    params: { projectId: ids.project },
    request: new Request(
      `http://app.test/projects/${ids.project}/files/finalize-upload`,
      {
        body: JSON.stringify({ verificationId: ids.file, returnTo }),
        headers: {
          "Content-Type": "application/json",
          Cookie: "session=stale",
        },
        method: "POST",
      },
    ),
  });

  assert.equal(result, delegatedResult);
  assert.deepEqual(result.data, { destination: returnTo });
  assert.equal(
    result.init.headers.get("Set-Cookie"),
    "session=refreshed; Path=/; HttpOnly",
  );
  assert.equal(delegatedContext.client, client);
  assert.equal(delegatedContext.headers, refreshedHeaders);
  assert.equal(delegatedContext.user, user);
  assert.equal(delegatedArgs.request.headers.get("Cookie"), null);
  assert.deepEqual(
    {
      params: delegatedArgs.params,
      form: delegatedForm,
    },
    {
      params: { projectId: ids.project },
      form: {
        intent: "upload",
        return_to: returnTo,
        upload_response_mode: "browser_recovery",
        upload_verification_id: ids.file,
      },
    },
  );
  assert.deepEqual(events, ["auth", "project-action"]);
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

test("DXF source start hands the exact selected file to the new workspace", async () => {
  const source = await readFile(
    new URL("../app/lukas/screens/drawing-workspace-new.tsx", import.meta.url),
    "utf8",
  );
  assert.match(
    source,
    /mutation\.intent === "create_dxf"[\s\S]*destination\.searchParams\.set\(\s*"dxfSourceFileId",\s*mutation\.sourceFileId,?\s*\)/,
  );
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
  assert.doesNotMatch(screen, /DrawingWorkspaceStart/);
  assert.doesNotMatch(screen, /document\s*===\s*null/);
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

test("approved snapshot restore is limited to admin editor and reviewer", () => {
  assert.equal(
    typeof workspaceView?.drawingWorkspaceCanRestoreApprovedSnapshot,
    "function",
  );
  for (const capability of ["admin", "editor", "reviewer"])
    assert.equal(
      workspaceView.drawingWorkspaceCanRestoreApprovedSnapshot(capability),
      true,
    );
  for (const capability of ["commenter", "approver", "viewer"])
    assert.equal(
      workspaceView.drawingWorkspaceCanRestoreApprovedSnapshot(capability),
      false,
    );
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
  assert.equal(canvas.match(/drawingPanGestureTransition\(/g)?.length, 6);
  assert.match(canvas, /drawingPdfImagePlacement\(rendered\.canvasSize/);
  assert.doesNotMatch(canvas, /containPdfSource/);
  assert.match(canvas, /x=\{pdfSource\.bounds\.x\}/);
  assert.match(canvas, /y=\{pdfSource\.bounds\.y\}/);
});

test("workspace source recovery keeps the authorized catalog and clears only an unavailable IFC selection", () => {
  const recover = workspaceScreen.recoverDrawingWorkspaceSourceFailure;
  assert.equal(typeof recover, "function");
  const ifcId = "10000000-0000-4000-8000-000000000002";
  const catalog = [
    {
      id: "10000000-0000-4000-8000-000000000001",
      kind: "pdf",
      originalFilename: "plan.pdf",
      byteSize: 4096,
      sha256: "a".repeat(64),
    },
    {
      id: ifcId,
      kind: "ifc",
      originalFilename: "model.ifc",
      byteSize: 8192,
      sha256: "b".repeat(64),
    },
  ];
  const recoveryBundle = {
    primary: catalog[0],
    pdf: null,
    ifc: null,
    previousPdf: null,
    revisionEdge: null,
    catalog,
  };
  const error = new workspaceServer.DrawingWorkspaceSourceUnavailableError(
    "IFC derivative 파일을 열지 못했습니다.",
    recoveryBundle,
  );

  assert.deepEqual(recover(error, ifcId), {
    sourceBundle: {
      ...recoveryBundle,
      error: "선택한 IFC 원본을 표시하지 못했습니다. 다시 시도해 주세요.",
    },
    selectedIfcFileId: null,
  });
  const loadedIfc = { ...catalog[1], derivative: { status: "pending" } };
  const pdfRecoveryBundle = {
    ...recoveryBundle,
    ifc: loadedIfc,
  };
  const pdfError = new workspaceServer.DrawingWorkspaceSourceUnavailableError(
    "도면 원본을 열지 못했습니다.",
    pdfRecoveryBundle,
  );
  assert.deepEqual(recover(pdfError, ifcId), {
    sourceBundle: {
      ...pdfRecoveryBundle,
      error: "PDF 원본 배경을 표시하지 못했습니다. 다시 시도해 주세요.",
    },
    selectedIfcFileId: ifcId,
  });
  assert.equal(recover(new Error("database down"), ifcId), null);
});

test("2D PDF recovery preserves an intentionally unloaded IFC selection", () => {
  const recover = workspaceScreen.recoverDrawingWorkspaceSourceFailure;
  assert.equal(typeof recover, "function");
  const pdf = {
    id: "10000000-0000-4000-8000-000000000001",
    kind: "pdf",
    originalFilename: "plan.pdf",
    byteSize: 4096,
    sha256: "a".repeat(64),
  };
  const ifc = {
    id: "10000000-0000-4000-8000-000000000002",
    kind: "ifc",
    originalFilename: "model.ifc",
    byteSize: 8192,
    sha256: "b".repeat(64),
  };
  const recoveryBundle = {
    primary: pdf,
    pdf: null,
    ifc: null,
    previousPdf: null,
    revisionEdge: null,
    catalog: [pdf, ifc],
  };
  const error = new workspaceServer.DrawingWorkspaceSourceUnavailableError(
    "도면 원본을 열지 못했습니다.",
    recoveryBundle,
  );

  assert.deepEqual(recover(error, ifc.id, false), {
    sourceBundle: {
      ...recoveryBundle,
      error: "PDF 원본 배경을 표시하지 못했습니다. 다시 시도해 주세요.",
    },
    selectedIfcFileId: ifc.id,
  });
});

test("workspace loader reuses one canonical graph after a metadata-only shell load", async () => {
  const screen = await readFile(
    new URL("../app/lukas/screens/drawing-workspace.tsx", import.meta.url),
    "utf8",
  );
  const loader = screen.slice(
    screen.indexOf("export async function loader"),
    screen.indexOf("export async function action"),
  );
  assert.match(
    loader,
    /await loadDrawingWorkspaceShell\([\s\S]*loadDrawingWorkspaceCollaborationBootstrap\([\s\S]*await Promise\.all\(\[[\s\S]*loadDrawingActivityPage\([\s\S]*loadDrawingWorkspaceIssueRoom\([\s\S]*listDrawingAssignees\([\s\S]*hydrateDrawingWorkspaceShell\(/,
  );
  assert.match(
    loader,
    /hydrateDrawingWorkspaceShell\([\s\S]*await Promise\.all\(\[[\s\S]*loadDrawingEstimateSummary\([\s\S]*canEdit\(capability\)[\s\S]*\? loadDrawingEstimateOptions\([\s\S]*loadDrawingWorkspaceSourceBundle\(/,
  );
  assert.doesNotMatch(loader, /await loadDrawingWorkspace\(/);
});

test("workspace loader keeps legacy revisions on their full graph without canonical hydration", async () => {
  const screen = await readFile(
    new URL("../app/lukas/screens/drawing-workspace.tsx", import.meta.url),
    "utf8",
  );
  const loader = screen.slice(
    screen.indexOf("export async function loader"),
    screen.indexOf("export async function action"),
  );
  assert.match(loader, /drawingWorkspaceUsesCanonicalGraph\(workspaceShell\)/);
  assert.match(
    loader,
    /usesCanonicalGraph\s*\?\s*loadDrawingWorkspaceCollaborationBootstrap\([\s\S]*:\s*Promise\.resolve\(null\)/,
  );
  assert.match(
    loader,
    /collaborationBootstrap\s*\?\s*hydrateDrawingWorkspaceShell\([\s\S]*:\s*workspaceShell/,
  );
  assert.match(
    loader,
    /collaborationBootstrap\s*\?\s*compactDrawingWorkspaceForLoader\([\s\S]*:\s*workspace/,
  );
  assert.match(
    loader,
    /measurementEvidenceUrl:\s*collaborationBootstrap\s*\?[\s\S]*:\s*null/,
  );
});

test("workspace loader keeps canonical HTTP editing available when realtime collaboration is not entitled", async () => {
  const screen = await readFile(
    new URL("../app/lukas/screens/drawing-workspace.tsx", import.meta.url),
    "utf8",
  );
  const loader = screen.slice(
    screen.indexOf("export async function loader"),
    screen.indexOf("export async function action"),
  );
  assert.match(
    loader,
    /projectOrganizationFeatureEnabled\([\s\S]*"realtime_collaboration"/,
  );
  assert.match(
    loader,
    /usesCanonicalGraph\s*\?\s*loadDrawingWorkspaceCollaborationBootstrap/,
  );
  assert.doesNotMatch(
    loader,
    /usesCanonicalGraph\s*&&\s*realtimeCollaborationEnabled\s*\?\s*loadDrawingWorkspaceCollaborationBootstrap/,
    "the canonical checkpoint remains required when realtime transport is not entitled",
  );
  assert.match(loader, /realtimeCollaborationEnabled,/);
  assert.match(
    screen,
    /collaborationEnabled=\{loaderData\.realtimeCollaborationEnabled\}/,
  );
  const action = screen.slice(screen.indexOf("export async function action"));
  assert.match(
    action,
    /\[\s*"apply_operation",\s*"discard_conflicted_operations",\s*"request_review",?\s*\]\.includes\(typeof intent === "string" \? intent : ""\)[\s\S]*projectOrganizationFeatureEnabled\([\s\S]*"realtime_collaboration"[\s\S]*handleWorkspaceMutation\([\s\S]*collaborationEnabled/,
  );
});

test("workspace keeps measurement tuples off the initial loader and requests them only for measurement UI", async () => {
  const [screen, shell, resource] = await Promise.all([
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
        "../app/lukas/screens/drawing-workspace-measurement-evidence.ts",
        import.meta.url,
      ),
      "utf8",
    ),
  ]);
  assert.match(screen, /measurementEvidenceUrl/);
  assert.doesNotMatch(screen, /compactDrawingServerMeasurementEvidence/);
  assert.doesNotMatch(
    screen,
    /measurementEvidence:\s*clientMeasurementEvidence/,
  );
  const consumerGate = shell.slice(
    shell.indexOf("const measurementEvidenceConsumerVisible"),
    shell.indexOf("const deferredMeasurementEvidence"),
  );
  assert.match(consumerGate, /activePanel === "schedules"/);
  assert.match(consumerGate, /inspectorOpen/);
  assert.match(consumerGate, /inspectorMode === "object"/);
  assert.match(
    consumerGate,
    /drawingObjectSupportsMeasurement\(selectedQuantityObject\)/,
  );
  assert.match(
    shell,
    /enabled:\s*drawingMeasurementEvidenceResourceReady\(\{[\s\S]*consumerVisible:\s*measurementEvidenceConsumerVisible/,
  );
  assert.match(resource, /Cache-Control["'],\s*["']private, no-store/);
  assert.match(resource, /loadDrawingWorkspaceMeasurementState/);
  assert.match(resource, /compactDrawingServerMeasurementEvidence/);
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
  assert.match(canvas, /drawingDimensionLayout\(/);
  const uncalibratedDimension = drawingLayout.drawingDimensionLayout(
    {
      type: "dimension",
      start: { x: 0, y: 0 },
      end: { x: 100, y: 0 },
      offset: 10,
      calibrationId: null,
    },
    { kind: "pdf", calibration: null },
  );
  assert.deepEqual(
    {
      text: uncalibratedDimension.text,
      warning: uncalibratedDimension.warning,
    },
    { text: "미보정", warning: true },
  );
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

test("workspace issue and canvas-region guards share the exact comment authority", async () => {
  assert.ok(workspaceView);
  for (const role of ["admin", "editor", "commenter", "reviewer"])
    assert.equal(workspaceView.drawingWorkspaceCanComment(role), true);
  for (const role of ["approver", "viewer"])
    assert.equal(workspaceView.drawingWorkspaceCanComment(role), false);

  const route = await readFile(
    new URL("../app/lukas/screens/drawing-workspace.tsx", import.meta.url),
    "utf8",
  );
  assert.match(route, /drawingWorkspaceCanComment\(capability\)/);
  assert.match(route, /댓글을 작성할 권한이 없습니다/);
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
