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
  createDrawingDocumentFromTemplate,
  handleWorkspaceMutation,
  linkDrawingObjectIssue,
  loadAllDrawingObjects,
  loadAllDrawingRows,
  loadDrawingWorkspace,
  loadDrawingTemplateCandidates,
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
  issue: "00000000-0000-4000-8000-000000000011",
  link: "00000000-0000-4000-8000-000000000012",
};

const sourceSha = "a".repeat(64);

const p2Ids = {
  canvas: "00000000-0000-4000-8000-000000000013",
  style: "00000000-0000-4000-8000-000000000014",
  block: "00000000-0000-4000-8000-000000000015",
  instance: "00000000-0000-4000-8000-000000000016",
  schema: "00000000-0000-4000-8000-000000000017",
  value: "00000000-0000-4000-8000-000000000018",
  table: "00000000-0000-4000-8000-000000000019",
  template: "00000000-0000-4000-8000-000000000020",
};

test("workspace object loading uses an ID keyset beyond the Supabase response cap", async () => {
  const calls = [];
  const rows = Array.from({ length: 2_005 }, (_, index) => ({
    id: String(index).padStart(5, "0"),
  }));
  const client = {
    from(table) {
      assert.equal(table, "lukas_drawing_objects");
      const builder = {
        select() {
          return builder;
        },
        eq() {
          return builder;
        },
        order() {
          return builder;
        },
        gt(column, cursor) { calls.push(["gt", column, cursor]); return builder; },
        limit(size) {
          const cursor = calls.findLast((call) => call[0] === "gt")?.[2];
          const from = cursor == null ? 0 : rows.findIndex((row) => row.id === cursor) + 1;
          calls.push(["limit", size]);
          return Promise.resolve({
            data: rows.slice(from, from + size),
            error: null,
          });
        },
      };
      return builder;
    },
  };

  const loaded = await loadAllDrawingObjects(
    client,
    ids.project,
    ids.revision,
    1_000,
  );
  assert.equal(loaded.length, 2_005);
  assert.deepEqual(calls.filter((call) => call[0] === "limit"), [
    ["limit", 1_000], ["limit", 1_000], ["limit", 1_000],
  ]);
});

test("bounded drawing row pagination has deterministic ID ties and removes duplicate rows", async () => {
  const calls = [];
  const rows = Array.from({ length: 2_005 }, (_, index) => ({
    id: String(index).padStart(5, "0"),
  }));
  rows.splice(1_000, 0, { id: "00999" });
  const client = {
    from(table) {
      const builder = {
        select() { return builder; },
        eq() { return builder; },
        order(column) { calls.push([table, "order", column]); return builder; },
        gt(_column, cursor) { calls.push([table, "gt", cursor]); return builder; },
        limit(size) {
          const cursor = calls.findLast((call) => call[1] === "gt")?.[2];
          const from = cursor == null ? 0 : rows.findIndex((row) => row.id > cursor);
          calls.push([table, "limit", size]);
          return Promise.resolve({ data: rows.slice(from, from + size), error: null });
        },
        range(from, to) {
          calls.push([table, from, to]);
          return Promise.resolve({ data: rows.slice(from, to + 1), error: null });
        },
      };
      return builder;
    },
  };
  const loaded = await loadAllDrawingRows(client, {
    table: "lukas_drawing_blocks",
    projectId: ids.project,
    revisionId: ids.revision,
    order: ["id"],
    pageSize: 1_000,
  });
  assert.equal(loaded.length, 2_005);
  assert.equal(new Set(loaded.map((row) => row.id)).size, 2_005);
  assert.deepEqual(loaded.map((row) => row.id), [...loaded.map((row) => row.id)].sort());
  assert.deepEqual(calls.filter((call) => call[1] === "limit"), [
    ["lukas_drawing_blocks", "limit", 1_000],
    ["lukas_drawing_blocks", "limit", 1_000],
    ["lukas_drawing_blocks", "limit", 1_000],
  ]);
});

test("keyset transport rejects duplicate rows, caps pages, and applies numeric canonical order", async () => {
  const rows = [{ id: "0002", sort_order: 10 }, { id: "0001", sort_order: 2 }];
  const client = {
    from() {
      const builder = {
        select() { return builder; }, eq() { return builder; }, order() { return builder; }, gt() { return builder; },
        limit(size) { return Promise.resolve({ data: rows.slice(0, size), error: null }); },
      };
      return builder;
    },
  };
  const loaded = await loadAllDrawingRows(client, { table: "lukas_drawing_pages", projectId: ids.project, order: ["sort_order", "id"] });
  assert.deepEqual(loaded.map((row) => row.sort_order), [2, 10]);
  await assert.rejects(
    () => loadAllDrawingRows(client, { table: "lukas_drawing_pages", projectId: ids.project, order: ["id"], pageSize: 1_001 }),
    /between 1 and 1000/,
  );
  const duplicate = {
    from() {
      const builder = {
        select() { return builder; }, eq() { return builder; }, order() { return builder; }, gt() { return builder; },
        limit() { return Promise.resolve({ data: [{ id: "0001" }, { id: "0001" }], error: null }); },
      };
      return builder;
    },
  };
  await assert.rejects(
    () => loadAllDrawingRows(duplicate, { table: "lukas_drawing_blocks", projectId: ids.project, order: ["id"] }),
    /중복 ID/,
  );
});

test("P2 loader strictly converts snake-case rows and fails closed for broken canvas ancestry", async () => {
  const client = queryClient({
    lukas_qto_files: { data: { id: ids.file, project_id: ids.project, kind: "pdf", sha256: sourceSha, immutable: true }, error: null },
    lukas_drawing_documents: { data: { id: ids.document, project_id: ids.project, source_file_id: ids.file, source_sha256: sourceSha }, error: null },
    lukas_drawing_revisions: { data: { id: ids.revision, document_id: ids.document, project_id: ids.project, status: "draft", version: 1 }, error: null },
    lukas_drawing_pages: { data: [{ id: ids.page, revision_id: ids.revision, project_id: ids.project, name: "A-101", sort_order: 0, version: 1 }], error: null },
    lukas_drawing_canvases: { data: [{ id: p2Ids.canvas, page_id: ids.page, revision_id: ids.revision, project_id: ids.project, name: "Paper", space_kind: "paper", width_mm: 841, height_mm: 594, background_source_file_id: ids.file, background_source_sha256: sourceSha, background_pdf_page: 1, calibration: null, sort_order: 0, version: 1 }], error: null },
    lukas_drawing_layers: { data: [{ id: ids.sourceLayer, page_id: ids.page, canvas_id: p2Ids.canvas, revision_id: ids.revision, project_id: ids.project, name: "Source", sort_order: 0, visible: true, locked: true, system_kind: "source", version: 1 }, { id: ids.workLayer, page_id: ids.page, canvas_id: p2Ids.canvas, revision_id: ids.revision, project_id: ids.project, name: "Work", sort_order: 1, visible: true, locked: false, system_kind: "work", version: 1 }], error: null },
    lukas_drawing_objects: { data: [], error: null },
    lukas_drawing_styles: { data: [], error: null },
    lukas_drawing_blocks: { data: [], error: null },
    lukas_drawing_block_instances: { data: [], error: null },
    lukas_drawing_property_schemas: { data: [], error: null },
    lukas_drawing_property_values: { data: [], error: null },
    lukas_drawing_tables: { data: [], error: null },
  });
  const loaded = await loadDrawingWorkspace(client, ids.project, ids.file);
  assert.deepEqual(loaded.document.revision.pages[0], {
    id: ids.page,
    revisionId: ids.revision,
    name: "A-101",
    sortOrder: 0,
    version: 1,
    canvases: [{ id: p2Ids.canvas, pageId: ids.page, name: "Paper", spaceKind: "paper", widthMillimeters: 841, heightMillimeters: 594, background: { sourceFileId: ids.file, sourceSha256: sourceSha, pdfPageNumber: 1, calibration: null }, sortOrder: 0, version: 1 }],
    layers: [{ id: ids.sourceLayer, name: "Source", visible: true, locked: true, systemKind: "source", canvasId: p2Ids.canvas, sortOrder: 0, version: 1 }, { id: ids.workLayer, name: "Work", visible: true, locked: false, systemKind: "work", canvasId: p2Ids.canvas, sortOrder: 1, version: 1 }],
    objects: [],
    blockInstances: [],
  });
  for (const table of ["lukas_drawing_pages", "lukas_drawing_layers", "lukas_drawing_objects"])
    assert.equal(client.calls.filter((call) => call.table === table).length, 1, `${table} is loaded exactly once for P2`);

  const malformed = queryClient({
    ...Object.fromEntries(client.calls.map((call) => [call.table, { data: [], error: null }])),
    lukas_qto_files: { data: { id: ids.file, project_id: ids.project, kind: "pdf", sha256: sourceSha, immutable: true }, error: null },
    lukas_drawing_documents: { data: { id: ids.document, project_id: ids.project, source_file_id: ids.file, source_sha256: sourceSha }, error: null },
    lukas_drawing_revisions: { data: { id: ids.revision, document_id: ids.document, project_id: ids.project, status: "draft", version: 1 }, error: null },
    lukas_drawing_pages: { data: [{ id: ids.page, revision_id: ids.revision, project_id: ids.project, name: "A-101", sort_order: 0, version: 1 }], error: null },
    lukas_drawing_canvases: { data: [{ id: p2Ids.canvas, page_id: ids.page, revision_id: ids.revision, project_id: ids.project, name: "Paper", space_kind: "paper", width_mm: 841, height_mm: 594, background_source_file_id: ids.file, background_source_sha256: "b".repeat(64), background_pdf_page: 1, calibration: null, sort_order: 0, version: 1 }], error: null },
  });
  await assert.rejects(loadDrawingWorkspace(malformed, ids.project, ids.file), /source evidence|ancestry/i);
});

test("P2 blank canvases do not sign an undefined legacy background and select the authoritative default canvas", async () => {
  const client = queryClient({
    lukas_qto_files: { data: { id: ids.file, project_id: ids.project, kind: "pdf", sha256: sourceSha, immutable: true, storage_path: "source.pdf" }, error: null },
    lukas_drawing_documents: { data: { id: ids.document, project_id: ids.project, source_file_id: ids.file, source_sha256: sourceSha }, error: null },
    lukas_drawing_revisions: { data: { id: ids.revision, document_id: ids.document, project_id: ids.project, status: "draft", version: 1 }, error: null },
    lukas_drawing_pages: { data: [{ id: ids.page, revision_id: ids.revision, project_id: ids.project, name: "A-101", sort_order: 0, version: 1 }], error: null },
    lukas_drawing_canvases: { data: [{ id: p2Ids.canvas, page_id: ids.page, revision_id: ids.revision, project_id: ids.project, name: "Paper", space_kind: "paper", width_mm: 841, height_mm: 594, background_source_file_id: null, background_source_sha256: null, background_pdf_page: null, calibration: null, sort_order: 0, version: 1 }], error: null },
    lukas_drawing_layers: { data: [{ id: ids.workLayer, page_id: ids.page, canvas_id: p2Ids.canvas, revision_id: ids.revision, project_id: ids.project, name: "Work", sort_order: 0, visible: true, locked: false, system_kind: "work", version: 1 }], error: null },
    lukas_drawing_objects: { data: [], error: null }, lukas_drawing_styles: { data: [], error: null }, lukas_drawing_blocks: { data: [], error: null }, lukas_drawing_block_instances: { data: [], error: null }, lukas_drawing_property_schemas: { data: [], error: null }, lukas_drawing_property_values: { data: [], error: null }, lukas_drawing_tables: { data: [], error: null },
  });
  const workspace = await loadDrawingWorkspace(client, ids.project, ids.file);
  assert.equal(workspace.document.revision.activePageId, ids.page);
  assert.equal(workspace.document.revision.activeCanvasId, p2Ids.canvas);
  assert.equal(await workspaceServer.loadDrawingWorkspaceSourceUrl({ storage: { from() { throw new Error("must not sign"); } } }, workspace), null);
});

test("template clone accepts only project-bound source IDs and parses its authoritative response", async () => {
  const calls = [];
  const client = { async rpc(name, args) { calls.push([name, args]); return { data: { documentId: ids.document, revisionId: ids.revision, sourceRevisionId: p2Ids.template }, error: null }; } };
  const result = await createDrawingDocumentFromTemplate(client, p2Ids.template, " Template draft ", ids.file);
  assert.deepEqual(result, { documentId: ids.document, revisionId: ids.revision, sourceRevisionId: p2Ids.template });
  assert.deepEqual(calls, [["lukas_drawing_create_from_template", { p_source_revision_id: p2Ids.template, p_title: "Template draft", p_source_file_id: ids.file }]]);
});

test("template clone rejects browser authority fields, foreign candidates, and non-draft destinations", async () => {
  assert.throws(() => parseWorkspaceMutation(form({ intent: "create_from_template", source_revision_id: p2Ids.template, title: "Draft", project_id: ids.project })));
  const base = {
    ...loadedWorkspace(),
    templateCandidates: [{ revisionId: p2Ids.template, title: "Approved", approvedAt: "2026-08-25T00:00:00.000Z", snapshotSha256: sourceSha }],
  };
  const cloneForm = form({ intent: "create_from_template", source_revision_id: p2Ids.template, title: "Draft" });
  const accepted = await handleWorkspaceMutation({
    client: { async rpc() { return { data: { documentId: ids.document, revisionId: ids.revision, sourceRevisionId: p2Ids.template }, error: null }; } },
    projectId: ids.project, capability: "editor", workspace: base, form: cloneForm,
  });
  assert.equal(accepted.status, 200);
  const foreign = await handleWorkspaceMutation({
    client: { async rpc() { throw new Error("must not call"); } }, projectId: ids.project,
    capability: "editor", workspace: base,
    form: form({ intent: "create_from_template", source_revision_id: ids.actor, title: "Draft" }),
  });
  assert.equal(foreign.status, 404);
  const reviewed = await handleWorkspaceMutation({
    client: { async rpc() { throw new Error("must not call"); } }, projectId: ids.project,
    capability: "editor", workspace: { ...base, document: { ...base.document, revision: { ...base.document.revision, status: "review_requested" } } }, form: cloneForm,
  });
  assert.equal(reviewed.status, 409);
});

test("template candidates expose only approved project revisions with matching immutable snapshot evidence", async () => {
  const candidate = await loadDrawingTemplateCandidates(queryClient({
    lukas_drawing_revisions: { data: [{ id: p2Ids.template, document_id: ids.document, project_id: ids.project, status: "approved", version: 3, approved_at: "2026-08-25T00:00:00.000Z" }], error: null },
    lukas_drawing_documents: { data: [{ id: ids.document, project_id: ids.project, title: "Approved A-101" }], error: null },
    lukas_drawing_snapshots: { data: [{ id: ids.link, revision_id: p2Ids.template, project_id: ids.project, revision_version: 3, sha256: sourceSha }], error: null },
  }), ids.project);
  assert.deepEqual(candidate, [{ revisionId: p2Ids.template, title: "Approved A-101", approvedAt: "2026-08-25T00:00:00.000Z", snapshotSha256: sourceSha }]);
});

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
          name: "Circle",
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

test("blank canvas creation retains route source identity while omitting its PDF background", async () => {
  const calls = [];
  const client = {
    async rpc(name, args) {
      calls.push([name, args]);
      return { data: { documentId: ids.document }, error: null };
    },
  };
  await createDrawingDocument(
    client,
    ids.project,
    { id: ids.file, kind: "pdf" },
    {
      title: "Blank",
      mode: "blank",
    },
  );
  await createDrawingDocument(
    client,
    ids.project,
    { id: ids.file, kind: "pdf" },
    {
      title: "Background",
      mode: "pdf_background",
    },
  );
  assert.equal(calls[0][1].p_source_file_id, ids.file);
  assert.equal(calls[0][1].p_blank, true);
  assert.equal(calls[1][1].p_source_file_id, ids.file);
  assert.equal(calls[1][1].p_blank, false);
});

test("stable domain SQLSTATEs map to terminal conflict or rejection while database retries stay transient", async () => {
  const workspace = loadedWorkspace();
  const applyForm = form({
    intent: "apply_operation",
    operation_json: operation(),
  });
  for (const [code, kind, status] of [
    ["P1C01", "conflict", 409],
    ["P1R01", "rejected", 404],
    ["40001", "retryable", 503],
    ["40P01", "retryable", 503],
  ]) {
    const result = await handleWorkspaceMutation({
      client: {
        async rpc() {
          return { data: null, error: { code, message: `failure ${code}` } };
        },
      },
      projectId: ids.project,
      capability: "editor",
      workspace,
      form: applyForm,
    });
    assert.equal(result.status, status);
    assert.equal(result.body.kind, kind);
  }
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

test("mutation parsing requires object names and rejects browser layer authority", () => {
  const missingName = operation();
  delete missingName.forward.objects[0].name;
  assert.throws(() =>
    parseWorkspaceMutation(
      form({ intent: "apply_operation", operation_json: missingName }),
    ),
  );

  const addLayer = operation({
    type: "add_layer",
    forward: {
      type: "add_layer",
      layer: {
        id: ids.sourceLayer,
        name: "Injected source",
        visible: true,
        locked: true,
        systemKind: "source",
        version: 1,
      },
    },
    inverse: {},
  });
  assert.throws(() =>
    parseWorkspaceMutation(
      form({ intent: "apply_operation", operation_json: addLayer }),
    ),
  );
});

test("pasted add payload is exact canonical DrawingObject input for server parsing", () => {
  const source = {
    id: ids.object,
    name: "Rectangle",
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
        systemKind: "work",
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
      const response = responses[table] ?? { data: [], error: null };
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
        gt(column, value) {
          call.filters.push(["gt", column, value]);
          return builder;
        },
        limit(value) {
          call.limit = value;
          if (value === 1) return builder;
          call.terminal = "limit";
          const rows = Array.isArray(response.data) ? response.data : [];
          const cursor = call.filters.find((filter) => filter[0] === "gt")?.[2];
          return Promise.resolve({ ...response, data: Array.isArray(response.data) ? rows.filter((row) => cursor == null || row.id > cursor).slice(0, value) : [] });
        },
        range(from, to) {
          call.range = [from, to];
          call.terminal = "range";
          return Promise.resolve({
            ...response,
            data: Array.isArray(response.data) ? response.data : [],
          });
        },
        single() {
          call.terminal = "single";
          return Promise.resolve(response);
        },
        maybeSingle() {
          call.terminal = "maybeSingle";
          return Promise.resolve(response);
        },
        then(resolve, reject) {
          call.terminal = "await";
          return Promise.resolve(response).then(resolve, reject);
        },
      };
      return builder;
    },
  };
}

function workspaceLoaderClient(layers, extraResponses = {}) {
  return queryClient({
    lukas_qto_files: {
      data: {
        id: ids.file,
        project_id: ids.project,
        kind: "pdf",
        sha256: sourceSha,
        immutable: true,
      },
      error: null,
    },
    lukas_drawing_documents: {
      data: { id: ids.document, project_id: ids.project },
      error: null,
    },
    lukas_drawing_revisions: {
      data: { id: ids.revision, status: "draft", version: 1 },
      error: null,
    },
    lukas_drawing_pages: { data: [{ id: ids.page }], error: null },
    lukas_drawing_layers: { data: layers, error: null },
    lukas_drawing_objects: { data: [], error: null },
    ...extraResponses,
  });
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
      data: [
        {
          id: ids.sourceLayer,
          page_id: ids.page,
          name: "Source",
          locked: true,
          visible: true,
          system_kind: "source",
          version: 1,
        },
        {
          id: ids.workLayer,
          page_id: ids.page,
          name: "Work",
          locked: false,
          visible: true,
          system_kind: "work",
          version: 1,
        },
      ],
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

test("workspace loading scopes searchable issues and current links to the project revision", async () => {
  const activeObject = operation().forward.objects[0];
  const objectRow = {
    ...activeObject,
    object_type: activeObject.geometry.type,
    layer_id: activeObject.layerId,
    status: "active",
  };
  const manyIssues = Array.from({ length: 1_005 }, (_, index) => ({
    id: `00000000-0000-4000-8000-${String(index + 100).padStart(12, "0")}`,
    project_id: ids.project, title: `issue ${index}`, priority: "high", status: "open", updated_at: "2026-08-24T03:00:00.000Z",
  }));
  const manyLinks = manyIssues.map((issue, index) => ({
    id: `00000000-0000-4000-8000-${String(index + 2_000).padStart(12, "0")}`,
    object_id: ids.object, revision_id: ids.revision, issue_id: issue.id, project_id: ids.project, created_by: ids.actor, created_at: "2026-08-24T03:00:00.000Z",
  }));
  const responses = {
    lukas_drawing_objects: { data: [objectRow], error: null },
    lukas_drawing_issues: {
      data: manyIssues,
      error: null,
    },
    lukas_drawing_object_issue_links: {
      data: [
        ...manyLinks,
        {
          id: ids.operation,
          object_id: "00000000-0000-4000-8000-000000000099",
          revision_id: ids.revision,
          issue_id: manyIssues[0].id,
          project_id: ids.project,
          created_by: ids.actor,
          created_at: "2026-08-24T03:00:00.000Z",
        },
      ],
      error: null,
    },
  };
  const client = workspaceLoaderClient(
    [
      {
        id: ids.sourceLayer,
        page_id: ids.page,
        name: "Source",
        system_kind: "source",
        visible: true,
        locked: true,
        version: 1,
      },
      {
        id: ids.workLayer,
        page_id: ids.page,
        name: "Work",
        system_kind: "work",
        visible: true,
        locked: false,
        version: 1,
      },
    ],
    responses,
  );

  const loaded = await loadDrawingWorkspace(client, ids.project, ids.file);
  assert.deepEqual(
    loaded.document.revision.issues,
    manyIssues,
  );
  assert.deepEqual(loaded.document.revision.issueLinks, [
    ...manyLinks,
  ]);
  const issueCall = client.calls.find(
    (call) => call.table === "lukas_drawing_issues",
  );
  const linkCall = client.calls.find(
    (call) => call.table === "lukas_drawing_object_issue_links",
  );
  assert.deepEqual(issueCall.filters, [["eq", "project_id", ids.project]]);
  assert.deepEqual(linkCall.filters, [
    ["eq", "project_id", ids.project],
    ["eq", "revision_id", ids.revision],
  ]);
  assert.equal(client.calls.filter((call) => call.table === "lukas_drawing_issues").length, 2);
  assert.equal(client.calls.filter((call) => call.table === "lukas_drawing_object_issue_links").length, 2);
});

test("workspace loading fails closed when source-layer metadata is missing", async () => {
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
  const client = queryClient({
    lukas_qto_files: { data: file, error: null },
    lukas_drawing_documents: {
      data: { id: ids.document, project_id: ids.project },
      error: null,
    },
    lukas_drawing_revisions: {
      data: { id: ids.revision, status: "draft", version: 1 },
      error: null,
    },
    lukas_drawing_pages: { data: [{ id: ids.page }], error: null },
    lukas_drawing_layers: {
      data: [{ id: ids.sourceLayer, name: "Source", locked: true }],
      error: null,
    },
    lukas_drawing_objects: { data: [], error: null },
  });

  await assert.rejects(
    loadDrawingWorkspace(client, ids.project, ids.file),
    /source layer metadata/i,
  );
});

test("workspace loading rejects invisible or unlocked source metadata", async () => {
  for (const source of [
    { visible: false, locked: true },
    { visible: true, locked: false },
  ]) {
    const client = workspaceLoaderClient([
      {
        id: ids.sourceLayer,
        page_id: ids.page,
        name: "Source",
        system_kind: "source",
        version: 1,
        ...source,
      },
      {
        id: ids.workLayer,
        page_id: ids.page,
        name: "Work",
        system_kind: "work",
        visible: true,
        locked: false,
        version: 1,
      },
    ]);

    await assert.rejects(
      loadDrawingWorkspace(client, ids.project, ids.file),
      /source layer metadata/i,
    );
  }
});

test("workspace loading rejects a page without an editable user layer", async () => {
  const client = workspaceLoaderClient([
    {
      id: ids.sourceLayer,
      page_id: ids.page,
      name: "Source",
      system_kind: "source",
      visible: true,
      locked: true,
      version: 1,
    },
    {
      id: ids.workLayer,
      page_id: ids.page,
      name: "Work",
      system_kind: "work",
      visible: true,
      locked: true,
      version: 1,
    },
  ]);

  await assert.rejects(
    loadDrawingWorkspace(client, ids.project, ids.file),
    /editable layer metadata/i,
  );
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
    lukas_drawing_pages: { data: [{ id: ids.page }], error: null },
    lukas_drawing_layers: {
      data: [
        {
          id: ids.sourceLayer,
          page_id: ids.page,
          name: "Source",
          locked: true,
          visible: true,
          system_kind: "source",
          version: 1,
        },
        {
          id: ids.workLayer,
          page_id: ids.page,
          name: "Work",
          locked: false,
          visible: true,
          system_kind: "work",
          version: 1,
        },
      ],
      error: null,
    },
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
      return { data: { operationId: ids.operation, sequence: 1, resultVersions: { [ids.object]: 1 } }, error: null };
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
        error: { code: "P1C01", message: "Drawing object version conflict" },
      };
    },
  };
  await assert.rejects(
    () => applyDrawingOperation(conflicting, input),
    (error) =>
      error.name === "DrawingWorkspaceConflictError" &&
      error.kind === "conflict",
  );
  await assert.rejects(
    () => applyDrawingOperation({ async rpc() { return { data: {}, error: null }; } }, input),
    /operationId|sequence|resultVersions/,
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

test("apply action echoes the server-validated client operation id for exact outbox acknowledgement", async () => {
  const input = operation();
  const result = await handleWorkspaceMutation({
    client: {
      async rpc() {
        return {
          data: { operationId: "00000000-0000-4000-8000-000000000011", sequence: 1, resultVersions: { [ids.object]: 1 } },
          error: null,
        };
      },
    },
    projectId: ids.project,
    capability: "editor",
    workspace: loadedWorkspace(),
    form: form({ intent: "apply_operation", operation_json: input }),
  });

  assert.deepEqual(result, {
    status: 200,
    body: {
      ok: true,
      kind: "success",
      error: null,
      clientOperationId: input.clientOperationId,
      result: { operationId: "00000000-0000-4000-8000-000000000011", sequence: 1, resultVersions: { [ids.object]: 1 } },
    },
  });
});

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

test("issue linking uses the narrow RPC and returns its authoritative link", async () => {
  const calls = [];
  const client = {
    async rpc(name, args) {
      calls.push([name, args]);
      return {
        data: {
          id: ids.link,
          objectId: ids.object,
          issueId: ids.issue,
          createdBy: ids.actor,
          createdAt: "2026-08-24T03:00:00.000Z",
        },
        error: null,
      };
    },
  };
  const result = await linkDrawingObjectIssue(client, ids.object, ids.issue);
  assert.deepEqual(calls, [
    [
      "lukas_drawing_link_object_issue",
      { p_object_id: ids.object, p_issue_id: ids.issue },
    ],
  ]);
  assert.equal(result.id, ids.link);
});

test("issue-link action permits only editors on the current draft", async () => {
  let rpcCalls = 0;
  const client = {
    async rpc() {
      rpcCalls += 1;
      return {
        data: {
          id: ids.link,
          objectId: ids.object,
          issueId: ids.issue,
          createdBy: ids.actor,
          createdAt: "2026-08-24T03:00:00.000Z",
        },
        error: null,
      };
    },
  };
  const linkForm = form({
    intent: "link_issue",
    object_id: ids.object,
    issue_id: ids.issue,
  });
  const currentWorkspace = () => {
    const workspace = loadedWorkspace();
    workspace.document.revision.objects = [{ id: ids.object }];
    workspace.document.revision.issues = [{ id: ids.issue }];
    workspace.document.revision.issueLinks = [];
    return workspace;
  };
  for (const capability of ["admin", "editor"]) {
    const response = await handleWorkspaceMutation({
      client,
      projectId: ids.project,
      capability,
      workspace: currentWorkspace(),
      form: linkForm,
    });
    assert.equal(response.status, 200);
    assert.equal(response.body.ok, true);
  }
  for (const capability of ["viewer", "commenter", "reviewer"]) {
    await assert.rejects(
      handleWorkspaceMutation({
        client,
        projectId: ids.project,
        capability,
        workspace: currentWorkspace(),
        form: linkForm,
      }),
      (error) => error instanceof Response && error.status === 403,
    );
  }
  for (const status of ["review_requested", "approved"]) {
    const workspace = currentWorkspace();
    workspace.document.revision.status = status;
    const response = await handleWorkspaceMutation({
      client,
      projectId: ids.project,
      capability: "editor",
      workspace,
      form: linkForm,
    });
    assert.equal(response.status, 409);
    assert.equal(response.body.kind, "conflict");
  }
  assert.equal(rpcCalls, 2);
});

test("issue-link action delegates same-session saved object identity to the authoritative RPC", async () => {
  let linkedObjectId = null;
  const workspace = loadedWorkspace();
  workspace.document.revision.objects = [];
  workspace.document.revision.issues = [{ id: ids.issue }];
  const response = await handleWorkspaceMutation({
    client: {
      async rpc(name, args) {
        assert.equal(name, "lukas_drawing_link_object_issue");
        linkedObjectId = args.p_object_id;
        return {
          data: {
            id: ids.link,
            objectId: ids.object,
            issueId: ids.issue,
            createdBy: ids.actor,
            createdAt: "2026-08-24T03:00:00.000Z",
          },
          error: null,
        };
      },
    },
    projectId: ids.project,
    capability: "editor",
    workspace,
    form: form({
      intent: "link_issue",
      object_id: ids.object,
      issue_id: ids.issue,
    }),
  });
  assert.equal(response.status, 200);
  assert.equal(linkedObjectId, ids.object);
});
