import assert from "node:assert/strict";
import test from "node:test";

import {
  applyDrawingCommand,
  copyDrawingSelection,
  createDrawingDocumentState,
  pasteDrawingClipboard,
} from "../app/lukas/lib/drawing-commands.ts";
import * as workspaceServer from "../app/lukas/lib/drawing-workspace.server.ts";
import {
  applyDrawingOperation,
  createDrawingDocument,
  handleWorkspaceMutation,
  loadDrawingWorkspace,
  loadDrawingWorkspaceCapability,
  parseWorkspaceMutation,
} from "../app/lukas/lib/drawing-workspace.server.ts";

const ids = {
  actor: "00000000-0000-4000-8000-000000000001",
  project: "00000000-0000-4000-8000-000000000002",
  file: "00000000-0000-4000-8000-000000000003",
  document: "00000000-0000-4000-8000-000000000004",
  revision: "00000000-0000-4000-8000-000000000005",
  page: "00000000-0000-4000-8000-000000000006",
  sourceLayer: "00000000-0000-4000-8000-000000000007",
  workLayer: "00000000-0000-4000-8000-000000000008",
  object: "00000000-0000-4000-8000-000000000009",
  operation: "00000000-0000-4000-8000-000000000010",
};

const sourceSha = "a".repeat(64);

function form(fields) {
  const result = new FormData();
  for (const [key, value] of Object.entries(fields))
    result.set(key, typeof value === "string" ? value : JSON.stringify(value));
  return result;
}

function operation(overrides = {}) {
  return {
    clientOperationId: ids.operation,
    revisionId: ids.revision,
    type: "add_objects",
    baseVersions: {},
    forward: {
      type: "add_objects",
      objects: [
        {
          id: ids.object,
          layerId: ids.workLayer,
          geometry: {
            type: "circle",
            center: { x: 10, y: 20 },
            radius: 4,
          },
          style: { stroke: "#112233", strokeWidth: 2, fill: null },
          version: 1,
        },
      ],
    },
    inverse: { type: "delete_objects", objectIds: [ids.object] },
    createdAt: "2026-08-24T02:00:00.000Z",
    ...overrides,
  };
}

test("mutation parsing preserves a valid operation without accepting authority fields", () => {
  const input = operation();
  assert.deepEqual(
    parseWorkspaceMutation(
      form({ intent: "apply_operation", operation_json: input }),
    ),
    { intent: "apply_operation", operation: input },
  );

  for (const authority of ["actor_id", "actorId", "project_id", "capability"])
    assert.throws(() =>
      parseWorkspaceMutation(
        form({
          intent: "apply_operation",
          operation_json: input,
          [authority]: ids.actor,
        }),
      ),
    );

  assert.throws(() =>
    parseWorkspaceMutation(
      form({
        intent: "apply_operation",
        operation_json: { ...input, actorId: ids.actor },
      }),
    ),
  );
});

test("mutation parsing rejects malformed canonical geometry before an RPC", () => {
  const malformed = operation();
  malformed.forward.objects[0].geometry.radius = -1;
  assert.throws(() =>
    parseWorkspaceMutation(
      form({ intent: "apply_operation", operation_json: malformed }),
    ),
  );
});

test("mutation parsing rejects unknown nested renderer fields instead of stripping them", () => {
  const rendererShaped = operation();
  rendererShaped.forward.objects[0].geometry.attrs = { radius: 4 };
  assert.throws(() =>
    parseWorkspaceMutation(
      form({ intent: "apply_operation", operation_json: rendererShaped }),
    ),
  );
});

test("pasted add payload is exact canonical DrawingObject input for server parsing", () => {
  const source = {
    id: ids.object,
    layerId: ids.workLayer,
    geometry: {
      type: "rectangle",
      origin: { x: 0, y: 0 },
      width: 20,
      height: 10,
      rotation: 0,
    },
    style: { stroke: "#112233", strokeWidth: 2, fill: null },
    version: 1,
  };
  const state = createDrawingDocumentState({
    revisionId: ids.revision,
    layers: [
      {
        id: ids.workLayer,
        name: "Work",
        visible: true,
        locked: false,
        version: 1,
      },
    ],
    objects: [source],
  });
  const pasted = pasteDrawingClipboard(
    copyDrawingSelection(state, [ids.object]),
    ids.actor,
    () => "00000000-0000-4000-8000-000000000011",
  );
  const applied = applyDrawingCommand(state, pasted, {
    createId: () => ids.operation,
    now: () => "2026-08-24T02:00:00.000Z",
  });
  const recorded = Object.fromEntries(
    [
      "baseVersions",
      "clientOperationId",
      "createdAt",
      "forward",
      "inverse",
      "revisionId",
      "type",
    ].map((key) => [key, applied.operation[key]]),
  );

  assert.deepEqual(
    parseWorkspaceMutation(
      form({ intent: "apply_operation", operation_json: recorded }),
    ),
    { intent: "apply_operation", operation: recorded },
  );
  const noncanonical = structuredClone(recorded);
  noncanonical.forward.objects[0].lineageId = ids.object;
  assert.throws(() =>
    parseWorkspaceMutation(
      form({ intent: "apply_operation", operation_json: noncanonical }),
    ),
  );
});

test("mutation parsing accepts only the approved narrow intent shapes", () => {
  const revision = ids.revision;
  assert.deepEqual(
    parseWorkspaceMutation(
      form({ intent: "create_document", title: " A-101 " }),
    ),
    { intent: "create_document", title: "A-101" },
  );
  assert.deepEqual(
    parseWorkspaceMutation(form({ intent: "create_layer", name: " 주석 " })),
    { intent: "create_layer", name: "주석" },
  );
  assert.deepEqual(
    parseWorkspaceMutation(
      form({
        intent: "link_issue",
        object_id: ids.object,
        issue_id: ids.actor,
      }),
    ),
    { intent: "link_issue", objectId: ids.object, issueId: ids.actor },
  );
  assert.deepEqual(
    parseWorkspaceMutation(
      form({ intent: "request_review", revision_id: revision }),
    ),
    { intent: "request_review", revisionId: revision },
  );
  assert.deepEqual(
    parseWorkspaceMutation(
      form({
        intent: "record_revision_decision",
        revision_id: revision,
        subject_version: "7",
        snapshot_sha256: sourceSha,
        decision: "rejected",
        note: " 치수 근거 보완 ",
      }),
    ),
    {
      intent: "record_revision_decision",
      revisionId: revision,
      subjectVersion: 7,
      snapshotSha256: sourceSha,
      decision: "rejected",
      note: "치수 근거 보완",
    },
  );

  assert.throws(() => parseWorkspaceMutation(form({ intent: "unknown" })));
  assert.throws(() =>
    parseWorkspaceMutation(
      form({ intent: "create_document", title: "A-101", role: "owner" }),
    ),
  );
});

function queryClient(responses) {
  const calls = [];
  return {
    calls,
    from(table) {
      const call = { table, filters: [], orders: [] };
      calls.push(call);
      const builder = {
        select(columns) {
          call.select = columns;
          return builder;
        },
        eq(column, value) {
          call.filters.push(["eq", column, value]);
          return builder;
        },
        in(column, values) {
          call.filters.push(["in", column, values]);
          return builder;
        },
        order(column, options) {
          call.orders.push([column, options]);
          return builder;
        },
        limit(value) {
          call.limit = value;
          return builder;
        },
        single() {
          call.terminal = "single";
          return Promise.resolve(responses[table]);
        },
        maybeSingle() {
          call.terminal = "maybeSingle";
          return Promise.resolve(responses[table]);
        },
        then(resolve, reject) {
          call.terminal = "await";
          return Promise.resolve(responses[table]).then(resolve, reject);
        },
      };
      return builder;
    },
  };
}

test("workspace loading binds immutable PDF evidence to its project and performs no insert", async () => {
  const file = {
    id: ids.file,
    project_id: ids.project,
    kind: "pdf",
    original_filename: "A-101.pdf",
    storage_path: "projects/source.pdf",
    content_type: "application/pdf",
    byte_size: 1234,
    sha256: sourceSha,
    immutable: true,
    created_at: "2026-08-24T00:00:00.000Z",
  };
  const document = {
    id: ids.document,
    project_id: ids.project,
    source_file_id: ids.file,
    source_sha256: sourceSha,
    title: "A-101",
    created_by: ids.actor,
    created_at: "2026-08-24T00:00:00.000Z",
    updated_at: "2026-08-24T01:00:00.000Z",
  };
  const revision = {
    id: ids.revision,
    document_id: ids.document,
    project_id: ids.project,
    parent_revision_id: null,
    sequence: 1,
    status: "draft",
    version: 1,
    created_by: ids.actor,
    review_requested_at: null,
    approved_at: null,
    created_at: "2026-08-24T00:00:00.000Z",
    updated_at: "2026-08-24T01:00:00.000Z",
  };
  const client = queryClient({
    lukas_qto_files: { data: file, error: null },
    lukas_drawing_documents: { data: document, error: null },
    lukas_drawing_revisions: { data: revision, error: null },
    lukas_drawing_pages: { data: [{ id: ids.page }], error: null },
    lukas_drawing_layers: {
      data: [{ id: ids.sourceLayer, locked: true }],
      error: null,
    },
    lukas_drawing_objects: { data: [], error: null },
  });

  const loaded = await loadDrawingWorkspace(client, ids.project, ids.file);

  assert.equal(loaded.file.sha256, sourceSha);
  assert.equal(loaded.document.revision.id, ids.revision);
  assert.deepEqual(loaded.document.revision.pages, [{ id: ids.page }]);
  assert.deepEqual(client.calls[0].filters, [
    ["eq", "project_id", ids.project],
    ["eq", "id", ids.file],
    ["in", "kind", ["pdf", "ifc"]],
    ["eq", "immutable", true],
  ]);
  assert.equal(
    client.calls.some((call) => call.mutation),
    false,
  );
  assert.equal(file.sha256, sourceSha);
});

test("workspace loading returns a null document without creating one", async () => {
  const client = queryClient({
    lukas_qto_files: {
      data: {
        id: ids.file,
        project_id: ids.project,
        kind: "ifc",
        sha256: sourceSha,
        immutable: true,
      },
      error: null,
    },
    lukas_drawing_documents: { data: null, error: null },
  });
  const loaded = await loadDrawingWorkspace(client, ids.project, ids.file);
  assert.equal(loaded.document, null);
  assert.deepEqual(
    client.calls.map((call) => call.table),
    ["lukas_qto_files", "lukas_drawing_documents"],
  );
});

test("review-requested workspace loads its exact project-bound snapshot evidence", async () => {
  const snapshotSha = "b".repeat(64);
  const file = {
    id: ids.file,
    project_id: ids.project,
    kind: "pdf",
    original_filename: "A-101.pdf",
    storage_path: "projects/source.pdf",
    content_type: "application/pdf",
    byte_size: 1234,
    sha256: sourceSha,
    immutable: true,
    created_at: "2026-08-24T00:00:00.000Z",
  };
  const document = {
    id: ids.document,
    project_id: ids.project,
    source_file_id: ids.file,
    source_sha256: sourceSha,
    title: "A-101",
    created_by: ids.actor,
    created_at: "2026-08-24T00:00:00.000Z",
    updated_at: "2026-08-24T01:00:00.000Z",
  };
  const revision = {
    id: ids.revision,
    document_id: ids.document,
    project_id: ids.project,
    parent_revision_id: null,
    sequence: 1,
    status: "review_requested",
    version: 7,
    created_by: ids.actor,
    review_requested_at: "2026-08-24T01:00:00.000Z",
    approved_at: null,
    created_at: "2026-08-24T00:00:00.000Z",
    updated_at: "2026-08-24T01:00:00.000Z",
  };
  const client = queryClient({
    lukas_qto_files: { data: file, error: null },
    lukas_drawing_documents: { data: document, error: null },
    lukas_drawing_revisions: { data: revision, error: null },
    lukas_drawing_pages: { data: [], error: null },
    lukas_drawing_layers: { data: [], error: null },
    lukas_drawing_objects: { data: [], error: null },
    lukas_drawing_snapshots: {
      data: { revision_version: 7, sha256: snapshotSha },
      error: null,
    },
  });

  const loaded = await loadDrawingWorkspace(client, ids.project, ids.file);

  assert.deepEqual(loaded.document.revision.reviewEvidence, {
    subjectVersion: 7,
    snapshotSha256: snapshotSha,
  });
  const snapshotCall = client.calls.find(
    (call) => call.table === "lukas_drawing_snapshots",
  );
  assert.equal(snapshotCall.select, "revision_version,sha256");
  assert.deepEqual(snapshotCall.filters, [
    ["eq", "project_id", ids.project],
    ["eq", "revision_id", ids.revision],
    ["eq", "revision_version", 7],
  ]);
  assert.equal(snapshotCall.terminal, "maybeSingle");
});

test("workspace source signing covers IFC and exact PDF evidence without source mutation", async () => {
  assert.equal(
    typeof workspaceServer.loadDrawingWorkspaceSourceUrl,
    "function",
  );
  const calls = [];
  const client = {
    storage: {
      from(bucket) {
        calls.push(["bucket", bucket]);
        return {
          async createSignedUrl(path, expiresIn) {
            calls.push(["sign", path, expiresIn]);
            return {
              data: { signedUrl: "https://storage.test/source" },
              error: null,
            };
          },
        };
      },
    },
  };
  const ifcWorkspace = {
    file: {
      id: ids.file,
      project_id: ids.project,
      kind: "ifc",
      original_filename: "model.ifc",
      storage_path: "projects/model.ifc",
      content_type: "application/x-step",
      byte_size: 2048,
      sha256: sourceSha,
      immutable: true,
      created_at: "2026-08-24T00:00:00.000Z",
    },
    document: loadedWorkspace().document,
  };
  assert.equal(
    await workspaceServer.loadDrawingWorkspaceSourceUrl(client, ifcWorkspace),
    "https://storage.test/source",
  );
  assert.deepEqual(calls, [
    ["bucket", "lukas-qto"],
    ["sign", "projects/model.ifc", 300],
  ]);

  const blankPdf = {
    ...ifcWorkspace,
    file: { ...ifcWorkspace.file, kind: "pdf" },
  };
  assert.equal(
    await workspaceServer.loadDrawingWorkspaceSourceUrl(client, blankPdf),
    null,
  );
  const mismatchedPdf = {
    ...blankPdf,
    document: {
      ...blankPdf.document,
      revision: {
        ...blankPdf.document.revision,
        pages: [
          {
            background_pdf_page: 1,
            background_source_file_id: ids.file,
            background_source_sha256: "c".repeat(64),
          },
        ],
      },
    },
  };
  await assert.rejects(
    workspaceServer.loadDrawingWorkspaceSourceUrl(client, mismatchedPdf),
    (error) => error instanceof Response && error.status === 409,
  );
  assert.equal(calls.length, 2);
});

test("document creation derives blank/background behavior from the authoritative file kind", async () => {
  const rpcCalls = [];
  const client = {
    async rpc(name, args) {
      rpcCalls.push([name, args]);
      return { data: { documentId: ids.document }, error: null };
    },
  };
  await createDrawingDocument(
    client,
    ids.project,
    { id: ids.file, kind: "pdf" },
    { title: " A-101 ", mode: "pdf_background" },
  );
  await createDrawingDocument(
    client,
    ids.project,
    { id: ids.file, kind: "ifc" },
    { title: " IFC 스케치 ", mode: "pdf_background" },
  );
  assert.deepEqual(rpcCalls, [
    [
      "lukas_drawing_create_document",
      {
        p_project_id: ids.project,
        p_source_file_id: ids.file,
        p_title: "A-101",
        p_blank: false,
      },
    ],
    [
      "lukas_drawing_create_document",
      {
        p_project_id: ids.project,
        p_source_file_id: ids.file,
        p_title: "IFC 스케치",
        p_blank: true,
      },
    ],
  ]);
});

test("operation RPC receives exact client operation fields and exposes conflicts", async () => {
  const input = operation();
  const calls = [];
  const successful = {
    async rpc(name, args) {
      calls.push([name, args]);
      return { data: { operationId: ids.operation }, error: null };
    },
  };
  await applyDrawingOperation(successful, input);
  assert.deepEqual(calls, [
    [
      "lukas_drawing_apply_operation",
      {
        p_revision_id: input.revisionId,
        p_client_operation_id: input.clientOperationId,
        p_operation_type: input.type,
        p_base_versions: input.baseVersions,
        p_forward: input.forward,
        p_inverse: input.inverse,
      },
    ],
  ]);

  const conflicting = {
    async rpc() {
      return {
        data: null,
        error: { code: "40001", message: "Drawing object version conflict" },
      };
    },
  };
  await assert.rejects(
    () => applyDrawingOperation(conflicting, input),
    (error) =>
      error.name === "DrawingWorkspaceConflictError" &&
      error.kind === "conflict",
  );
});

test("capability comes from project ownership or membership rows, never user metadata", async () => {
  const ownerClient = queryClient({});
  assert.equal(
    await loadDrawingWorkspaceCapability(
      ownerClient,
      ids.project,
      ids.actor,
      ids.actor,
    ),
    "admin",
  );
  assert.equal(ownerClient.calls.length, 0);

  const memberClient = queryClient({
    lukas_qto_project_members: { data: { role: "estimator" }, error: null },
  });
  assert.equal(
    await loadDrawingWorkspaceCapability(
      memberClient,
      ids.project,
      ids.actor,
      ids.document,
    ),
    "editor",
  );
  assert.deepEqual(memberClient.calls[0].filters, [
    ["eq", "project_id", ids.project],
    ["eq", "user_id", ids.actor],
  ]);
});

test("trusted staff context is admin without membership while viewer and outsider stay constrained", async () => {
  const staffClient = queryClient({});
  assert.equal(
    await loadDrawingWorkspaceCapability(
      staffClient,
      ids.project,
      ids.actor,
      ids.document,
      "staff",
    ),
    "admin",
  );
  assert.equal(staffClient.calls.length, 0);

  const viewerClient = queryClient({
    lukas_qto_project_members: { data: { role: "viewer" }, error: null },
  });
  assert.equal(
    await loadDrawingWorkspaceCapability(
      viewerClient,
      ids.project,
      ids.actor,
      ids.document,
      "viewer",
    ),
    "viewer",
  );

  const outsiderClient = queryClient({
    lukas_qto_project_members: { data: null, error: null },
  });
  assert.equal(
    await loadDrawingWorkspaceCapability(
      outsiderClient,
      ids.project,
      ids.actor,
      ids.document,
      null,
    ),
    null,
  );

  await assert.rejects(
    () =>
      handleWorkspaceMutation({
        client: { async rpc() {} },
        projectId: ids.project,
        capability: "viewer",
        workspace: { ...loadedWorkspace(), document: null },
        form: form({
          intent: "create_document",
          title: "A-101",
          document_mode: "blank",
        }),
      }),
    (error) => error instanceof Response && error.status === 403,
  );
});

function loadedWorkspace(revisionId = ids.revision) {
  return {
    file: {
      id: ids.file,
      project_id: ids.project,
      kind: "pdf",
      original_filename: "A-101.pdf",
      storage_path: "projects/source.pdf",
      content_type: "application/pdf",
      byte_size: 1234,
      sha256: sourceSha,
      immutable: true,
      created_at: "2026-08-24T00:00:00.000Z",
    },
    document: {
      id: ids.document,
      project_id: ids.project,
      source_file_id: ids.file,
      source_sha256: sourceSha,
      title: "A-101",
      created_by: ids.actor,
      created_at: "2026-08-24T00:00:00.000Z",
      updated_at: "2026-08-24T00:00:00.000Z",
      revision: {
        id: revisionId,
        document_id: ids.document,
        project_id: ids.project,
        parent_revision_id: null,
        sequence: 1,
        status: "draft",
        version: 1,
        created_by: ids.actor,
        review_requested_at: null,
        approved_at: null,
        created_at: "2026-08-24T00:00:00.000Z",
        updated_at: "2026-08-24T00:00:00.000Z",
        pages: [],
        layers: [],
        objects: [],
        reviewEvidence: null,
      },
    },
  };
}

test("action contract returns 409 for stale revision and pre-existing document preconditions", async () => {
  let rpcCalls = 0;
  const client = {
    async rpc() {
      rpcCalls += 1;
      return { data: {}, error: null };
    },
  };
  const stale = operation({
    revisionId: "00000000-0000-4000-8000-000000000099",
  });
  assert.deepEqual(
    await handleWorkspaceMutation({
      client,
      projectId: ids.project,
      capability: "editor",
      workspace: loadedWorkspace(),
      form: form({ intent: "apply_operation", operation_json: stale }),
    }),
    {
      status: 409,
      body: {
        ok: false,
        kind: "conflict",
        error: "현재 파일의 도면 리비전과 요청이 일치하지 않습니다.",
      },
    },
  );
  assert.deepEqual(
    await handleWorkspaceMutation({
      client,
      projectId: ids.project,
      capability: "editor",
      workspace: loadedWorkspace(),
      form: form({
        intent: "create_document",
        title: "A-101",
        document_mode: "blank",
      }),
    }),
    {
      status: 409,
      body: {
        ok: false,
        kind: "conflict",
        error: "이 파일에는 이미 도면 문서가 있습니다.",
      },
    },
  );
  assert.equal(rpcCalls, 0);
});

test("action contract maps stable database conflict codes to 409 and validation failures to 400", async () => {
  const raceClient = {
    async rpc() {
      return {
        data: null,
        error: { code: "23505", message: "duplicate key value" },
      };
    },
  };
  assert.deepEqual(
    await handleWorkspaceMutation({
      client: raceClient,
      projectId: ids.project,
      capability: "editor",
      workspace: { ...loadedWorkspace(), document: null },
      form: form({
        intent: "create_document",
        title: "A-101",
        document_mode: "blank",
      }),
    }),
    {
      status: 409,
      body: {
        ok: false,
        kind: "conflict",
        error: "duplicate key value",
      },
    },
  );

  const validation = await handleWorkspaceMutation({
    client: raceClient,
    projectId: ids.project,
    capability: "editor",
    workspace: { ...loadedWorkspace(), document: null },
    form: form({ intent: "unknown" }),
  });
  assert.equal(validation.status, 400);
  assert.equal(validation.body.kind, "validation");

  const rpcFailure = await handleWorkspaceMutation({
    client: {
      async rpc() {
        return {
          data: null,
          error: { code: "P0001", message: "RPC precondition failed" },
        };
      },
    },
    projectId: ids.project,
    capability: "editor",
    workspace: { ...loadedWorkspace(), document: null },
    form: form({
      intent: "create_document",
      title: "A-101",
      document_mode: "blank",
    }),
  });
  assert.equal(rpcFailure.status, 400);
  assert.equal(rpcFailure.body.kind, "rpc");
});
