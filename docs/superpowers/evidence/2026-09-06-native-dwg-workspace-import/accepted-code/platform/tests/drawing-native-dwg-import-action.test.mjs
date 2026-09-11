import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { createServer } from "vite";

const vite = await createServer({
  appType: "custom",
  configFile: false,
  logLevel: "silent",
  resolve: {
    alias: { "~": fileURLToPath(new URL("../app", import.meta.url)) },
  },
  server: { middlewareMode: true },
});
const actions = await vite.ssrLoadModule(
  "/app/lukas/lib/drawing-native-dwg-import-action.server.ts",
);
test.after(() => vite.close());

const ids = {
  actor: "8a000000-0000-4000-8000-000000000001",
  project: "8a000000-0000-4000-8000-000000000002",
  document: "8a000000-0000-4000-8000-000000000003",
  revision: "8a000000-0000-4000-8000-000000000004",
  canvas: "8a000000-0000-4000-8000-000000000005",
  file: "8a000000-0000-4000-8000-000000000006",
  request: "8a000000-0000-4000-8000-000000000007",
  job: "8a000000-0000-4000-8000-000000000008",
};
const sha256 = "a".repeat(64);

function workspace(overrides = {}) {
  return {
    primarySource: null,
    templateCandidates: [],
    document: {
      id: ids.document,
      project_id: ids.project,
      source_file_id: null,
      revision: {
        id: ids.revision,
        project_id: ids.project,
        document_id: ids.document,
        status: "draft",
        canvases: [{ id: ids.canvas }],
        pages: [],
        ...overrides.revision,
      },
      ...overrides.document,
    },
  };
}

function form(intent, fields) {
  const value = new FormData();
  value.set("intent", intent);
  for (const [name, field] of Object.entries(fields)) value.set(name, field);
  return value;
}

function requestForm(overrides = {}) {
  return form("request_native_dwg_import", {
    revision_id: ids.revision,
    canvas_id: ids.canvas,
    source_file_id: ids.file,
    request_id: ids.request,
    unit_code: "4",
    ...overrides,
  });
}

function statusForm(overrides = {}) {
  return form("native_dwg_import_status", {
    revision_id: ids.revision,
    canvas_id: ids.canvas,
    job_id: ids.job,
    ...overrides,
  });
}

function prepareForm(overrides = {}) {
  return form("prepare_native_dwg_import", {
    revision_id: ids.revision,
    canvas_id: ids.canvas,
    job_id: ids.job,
    ...overrides,
  });
}

function fileClient(file = {}) {
  const observations = { filters: [], selects: [] };
  const row = {
    id: ids.file,
    project_id: ids.project,
    kind: "dwg",
    sha256,
    immutable: true,
    ...file,
  };
  const builder = {
    select(value) {
      observations.selects.push(value);
      return this;
    },
    eq(column, value) {
      observations.filters.push([column, value]);
      return this;
    },
    async maybeSingle() {
      return { data: row, error: null };
    },
  };
  return {
    client: {
      from(table) {
        assert.equal(table, "lukas_qto_files");
        return builder;
      },
    },
    observations,
  };
}

function input(client, actionForm, overrides = {}) {
  return {
    actorId: ids.actor,
    capability: "editor",
    client,
    form: actionForm,
    projectId: ids.project,
    workspace: workspace(),
    ...overrides,
  };
}

test("editor request derives immutable DWG SHA and document scope on the server", async () => {
  const { client, observations } = fileClient();
  let requestedScope;
  let requestedId;
  const result = await actions.handleDrawingNativeDwgImportAction(
    input(client, requestForm()),
    {
      async requestImport(_client, scope, requestId) {
        requestedScope = scope;
        requestedId = requestId;
        return { jobId: ids.job };
      },
    },
  );

  assert.deepEqual(result, {
    ok: true,
    kind: "native_dwg_import_requested",
    error: null,
    result: { jobId: ids.job },
  });
  assert.deepEqual(requestedScope, {
    projectId: ids.project,
    documentId: ids.document,
    revisionId: ids.revision,
    canvasId: ids.canvas,
    sourceFileId: ids.file,
    sourceSha256: sha256,
    unitOverride: 4,
  });
  assert.equal(requestedId, ids.request);
  assert.deepEqual(observations.filters, [
    ["id", ids.file],
    ["project_id", ids.project],
    ["kind", "dwg"],
    ["immutable", true],
  ]);
});

test("blank unit selection is frozen as a null server scope override", async () => {
  const { client } = fileClient();
  let requestedScope;
  await actions.handleDrawingNativeDwgImportAction(
    input(client, requestForm({ unit_code: "" })),
    {
      async requestImport(_client, scope) {
        requestedScope = scope;
        return { jobId: ids.job };
      },
    },
  );
  assert.equal(requestedScope.unitOverride, null);
});

test("ordinary Supabase RPC builders are adapted inside the native request boundary", async () => {
  const { client } = fileClient();
  const calls = [];
  client.rpc = (name, args) => ({
    async abortSignal(signal) {
      calls.push([name, args, signal instanceof AbortSignal]);
      return { data: { jobId: ids.job }, error: null };
    },
  });
  const result = await actions.handleDrawingNativeDwgImportAction(
    input(client, requestForm()),
  );
  assert.equal(result.result.jobId, ids.job);
  assert.deepEqual(calls, [
    [
      "lukas_drawing_request_native_dwg_import",
      {
        p_scope: {
          projectId: ids.project,
          documentId: ids.document,
          revisionId: ids.revision,
          canvasId: ids.canvas,
          sourceFileId: ids.file,
          sourceSha256: sha256,
          unitOverride: 4,
        },
        p_request_id: ids.request,
      },
      true,
    ],
  ]);
});

test("viewer, frozen, wrong-project, wrong-canvas and stale-revision requests stop before file or native request", async () => {
  const cases = [
    { capability: "viewer" },
    { workspace: workspace({ revision: { status: "approved" } }) },
    { projectId: "8a000000-0000-4000-8000-000000000099" },
    {
      form: requestForm({ canvas_id: "8a000000-0000-4000-8000-000000000099" }),
    },
    {
      form: requestForm({
        revision_id: "8a000000-0000-4000-8000-000000000099",
      }),
    },
  ];
  for (const changed of cases) {
    let fileLoads = 0;
    let requests = 0;
    const client = {
      from() {
        fileLoads += 1;
        throw new Error("file lookup must not run");
      },
    };
    await assert.rejects(
      actions.handleDrawingNativeDwgImportAction(
        input(client, requestForm(), changed),
        {
          async requestImport() {
            requests += 1;
            throw new Error("native request must not run");
          },
        },
      ),
    );
    assert.equal(fileLoads, 0);
    assert.equal(requests, 0, JSON.stringify(changed));
  }
});

test("unverified, non-DWG and wrong-project file results fail before native request", async () => {
  for (const changed of [
    { immutable: false },
    { kind: "dxf" },
    { project_id: "8a000000-0000-4000-8000-000000000099" },
    { sha256: "invalid" },
  ]) {
    const { client } = fileClient(changed);
    let requests = 0;
    await assert.rejects(
      actions.handleDrawingNativeDwgImportAction(input(client, requestForm()), {
        async requestImport() {
          requests += 1;
          throw new Error("native request must not run");
        },
      }),
    );
    assert.equal(requests, 0, JSON.stringify(changed));
  }
});

function context(scope = {}, status = {}) {
  return {
    scope: {
      projectId: ids.project,
      documentId: ids.document,
      revisionId: ids.revision,
      canvasId: ids.canvas,
      sourceFileId: ids.file,
      sourceSha256: sha256,
      unitOverride: 5,
      ...scope,
    },
    status: {
      jobId: ids.job,
      status: "queued",
      attemptCount: 0,
      failureCode: null,
      receipt: null,
      ...status,
    },
    result: null,
  };
}

test("status loads only stored public context and validates its exact current scope", async () => {
  const calls = [];
  const client = {
    async rpc(name, args) {
      calls.push([name, args]);
      return { data: context(), error: null };
    },
  };
  const result = await actions.handleDrawingNativeDwgImportAction(
    input(client, statusForm()),
  );
  assert.deepEqual(calls, [
    [
      "lukas_drawing_native_dwg_import_context",
      { p_job_id: ids.job, p_include_result: false },
    ],
  ]);
  assert.deepEqual(result, {
    ok: true,
    kind: "native_dwg_import_status",
    error: null,
    result: context().status,
  });
  assert.equal("scope" in result, false);
  assert.equal("report" in result.result, false);
});

test("status rejects a mismatched stored project, document, revision, canvas or job", async () => {
  const contexts = [
    context({ projectId: "8a000000-0000-4000-8000-000000000099" }),
    context({ documentId: "8a000000-0000-4000-8000-000000000099" }),
    context({ revisionId: "8a000000-0000-4000-8000-000000000099" }),
    context({ canvasId: "8a000000-0000-4000-8000-000000000099" }),
    context({}, { jobId: "8a000000-0000-4000-8000-000000000099" }),
  ];
  for (const data of contexts) {
    let rpcCalls = 0;
    const client = {
      async rpc() {
        rpcCalls += 1;
        return { data, error: null };
      },
    };
    await assert.rejects(
      actions.handleDrawingNativeDwgImportAction(input(client, statusForm())),
    );
    assert.equal(rpcCalls, 1);
  }
});

test("prepare passes only the authenticated server actor and current job target", async () => {
  let preparedInput;
  const prepared = {
    requestId: ids.request,
    persistenceAuthority: "operation-attested",
  };
  const result = await actions.handleDrawingNativeDwgImportAction(
    input({}, prepareForm()),
    {
      async prepareImport(_client, value) {
        preparedInput = value;
        return prepared;
      },
    },
  );
  assert.deepEqual(preparedInput, {
    projectId: ids.project,
    revisionId: ids.revision,
    canvasId: ids.canvas,
    jobId: ids.job,
    actorId: ids.actor,
  });
  assert.deepEqual(result, {
    ok: true,
    kind: "native_dwg_import_prepared",
    error: null,
    result: prepared,
  });
});

test("unknown, duplicate, extra and malformed native forms are rejected without side effects", async () => {
  const duplicate = requestForm();
  duplicate.append("canvas_id", ids.canvas);
  const extra = requestForm();
  extra.set("source_sha256", sha256);
  const malformed = requestForm({ request_id: "not-a-uuid" });
  const unknown = form("unknown_native_dwg_intent", {});
  for (const actionForm of [duplicate, extra, malformed, unknown]) {
    let adminLoads = 0;
    await assert.rejects(
      actions.handleDrawingNativeDwgImportAction(
        input(
          {
            from() {
              adminLoads += 1;
              throw new Error("must not load source");
            },
            rpc() {
              adminLoads += 1;
              throw new Error("must not call RPC");
            },
          },
          actionForm,
        ),
        {
          async requestImport() {
            adminLoads += 1;
          },
          async prepareImport() {
            adminLoads += 1;
          },
        },
      ),
    );
    assert.equal(adminLoads, 0);
  }
});
