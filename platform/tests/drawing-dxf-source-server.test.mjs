import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  assertDrawingDxfImportScope,
  attestDrawingDxfImportPlan,
  DrawingDxfSourceError,
  parseDrawingDxfImportForm,
  prepareDrawingDxfProjectImport,
} from "../app/lukas/lib/drawing-dxf-source.server.ts";
import { buildDrawingDxfImportPlan } from "../app/lukas/lib/drawing-dxf-import-plan.server.ts";
import { drawingCollaborationOperationDigestSource } from "../app/lukas/lib/drawing-collaboration-protocol.ts";

const ids = {
  project: "43000000-0000-4000-8000-000000000001",
  revision: "43000000-0000-4000-8000-000000000002",
  canvas: "43000000-0000-4000-8000-000000000003",
  file: "43000000-0000-4000-8000-000000000004",
  actor: "43000000-0000-4000-8000-000000000005",
};

const createdAt = "2026-09-02T03:00:00.000Z";

function dxf({ units = 4 } = {}) {
  return new TextEncoder().encode(
    [
      "0",
      "SECTION",
      "2",
      "HEADER",
      "9",
      "$INSUNITS",
      "70",
      String(units),
      "0",
      "ENDSEC",
      "0",
      "SECTION",
      "2",
      "ENTITIES",
      "0",
      "LINE",
      "5",
      "1a2b",
      "8",
      "A-WALL",
      "10",
      "0",
      "20",
      "0",
      "11",
      "2",
      "21",
      "0",
      "0",
      "ENDSEC",
      "0",
      "EOF",
      "",
    ].join("\n"),
  );
}

function clientFor(bytes, overrides = {}) {
  const calls = [];
  const {
    queryError,
    operationQueryError,
    operationRows = [],
    downloadError,
    storedBytes,
    ...fileOverrides
  } = overrides;
  const file = {
    id: ids.file,
    project_id: ids.project,
    kind: "dxf",
    original_filename: "detail.dxf",
    storage_path: `projects/${ids.project}/sources/detail.dxf`,
    content_type: "application/dxf",
    byte_size: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    immutable: true,
    created_at: "2026-09-02T02:00:00.000Z",
    ...fileOverrides,
  };
  return {
    calls,
    from(table) {
      calls.push(["from", table]);
      if (table === "lukas_drawing_operations") {
        const filters = [];
        let operationIds = [];
        const query = {
          select(columns) {
            calls.push(["operation-select", columns]);
            return query;
          },
          eq(column, value) {
            filters.push([column, value]);
            calls.push(["operation-eq", column, value]);
            return query;
          },
          in(column, values) {
            assert.equal(column, "client_operation_id");
            operationIds = values;
            calls.push(["operation-in", column, values]);
            return query;
          },
          order(column, options) {
            calls.push(["operation-order", column, options]);
            return query;
          },
          limit(limit) {
            calls.push(["operation-limit", limit]);
            const visible = operationRows.filter(
              (row) =>
                operationIds.includes(row.client_operation_id) &&
                filters.every(([column, value]) => row[column] === value),
            );
            return Promise.resolve({
              data: visible,
              error: operationQueryError ? { message: "db down" } : null,
            });
          },
        };
        return query;
      }
      assert.equal(table, "lukas_qto_files");
      const filters = [];
      const query = {
        select(columns) {
          calls.push(["select", columns]);
          return query;
        },
        eq(column, value) {
          filters.push([column, value]);
          calls.push(["eq", column, value]);
          return query;
        },
        limit(limit) {
          calls.push(["limit", limit]);
          const visible =
            filters.every(([column, value]) => file[column] === value) &&
            queryError !== true;
          return Promise.resolve({
            data: visible ? [file] : [],
            error: queryError ? { message: "db down" } : null,
          });
        },
      };
      return query;
    },
    storage: {
      from(bucket) {
        calls.push(["bucket", bucket]);
        return {
          async download(path) {
            calls.push(["download", path]);
            if (downloadError)
              return { data: null, error: { message: "storage down" } };
            const stored = storedBytes ?? bytes;
            return { data: new Blob([stored]), error: null };
          },
        };
      },
    },
  };
}

function input(overrides = {}) {
  return {
    projectId: ids.project,
    revisionId: ids.revision,
    canvasId: ids.canvas,
    sourceFileId: ids.file,
    createdAt,
    actorId: ids.actor,
    ...overrides,
  };
}

function plannedResultVersions(operation) {
  return Object.fromEntries(
    operation.forward.actions.map((action) => [
      "entity" in action ? action.entity.id : action.id,
      "entity" in action
        ? action.baseVersion === null
          ? action.entity.version
          : action.baseVersion + 1
        : null,
    ]),
  );
}

function operationRow(operation, sequence, overrides = {}) {
  return {
    project_id: ids.project,
    revision_id: operation.revisionId,
    client_operation_id: operation.clientOperationId,
    operation_type: operation.type,
    base_versions: operation.baseVersions,
    forward: operation.forward,
    inverse: operation.inverse,
    result_versions: plannedResultVersions(operation),
    actor_id: ids.actor,
    history_action: null,
    original_operation_id: null,
    sequence,
    ...overrides,
  };
}

test("verified immutable project DXF is re-hashed before an atomic import plan is returned", async () => {
  const bytes = dxf();
  const client = clientFor(bytes);
  const before = createHash("sha256").update(bytes).digest("hex");
  const plan = await prepareDrawingDxfProjectImport(client, input());

  assert.equal(plan.report.blocking.length, 0);
  assert.equal(plan.objects.length, 1);
  assert.equal(plan.sources.length, 1);
  assert.equal(plan.sources[0].handle, "1A2B");
  assert.equal(plan.sources[0].unitCode, 4);
  assert.equal(plan.sources[0].unitSource, "declared");
  assert.ok(
    plan.operations.some((operation) =>
      operation.forward.actions?.some((action) => action.kind === "put_source"),
    ),
  );
  assert.equal(createHash("sha256").update(bytes).digest("hex"), before);
  assert.ok(
    client.calls.some(
      (call) =>
        call[0] === "eq" && call[1] === "project_id" && call[2] === ids.project,
    ),
  );
  assert.deepEqual(plan.canonicalReceipts, []);
});

test("project prepare returns only an exact canonical persisted DXF prefix", async () => {
  const bytes = dxf();
  const planned = await buildDrawingDxfImportPlan({
    bytes,
    revisionId: ids.revision,
    canvasId: ids.canvas,
    sourceFileId: ids.file,
    createdAt,
  });
  const rows = planned.operations
    .slice(0, 2)
    .map((operation, index) => operationRow(operation, index + 7));
  const client = clientFor(bytes, { operationRows: rows });

  const prepared = await prepareDrawingDxfProjectImport(client, input());

  assert.deepEqual(
    prepared.canonicalReceipts,
    rows.map((row) => ({
      clientOperationId: row.client_operation_id,
      revisionId: row.revision_id,
      actorId: row.actor_id,
      sequence: row.sequence,
      resultVersions: row.result_versions,
      operationSha256: createHash("sha256")
        .update(
          drawingCollaborationOperationDigestSource(
            planned.operations.find(
              (operation) =>
                operation.clientOperationId === row.client_operation_id,
            ),
            row.actor_id,
          ),
        )
        .digest("hex"),
    })),
  );
  assert.ok(
    client.calls.some(
      (call) =>
        call[0] === "operation-in" &&
        call[2].length === planned.operations.length,
    ),
  );
  assert.ok(
    client.calls.some(
      (call) => call[0] === "operation-order" && call[1] === "sequence",
    ),
  );
});

test("project prepare rejects non-prefix or mismatched canonical DXF receipts", async () => {
  const bytes = dxf();
  const planned = await buildDrawingDxfImportPlan({
    bytes,
    revisionId: ids.revision,
    canvasId: ids.canvas,
    sourceFileId: ids.file,
    createdAt,
  });
  const [first, second] = planned.operations;
  const firstRow = operationRow(first, 7);
  const secondRow = operationRow(second, 8);
  const cases = [
    ["suffix-only", [secondRow]],
    ["actor", [{ ...firstRow, actor_id: crypto.randomUUID() }]],
    [
      "envelope",
      [{ ...firstRow, forward: { ...firstRow.forward, serverOnly: true } }],
    ],
    ["result", [{ ...firstRow, result_versions: { [ids.canvas]: 99 } }]],
    ["sequence", [firstRow, { ...secondRow, sequence: 7 }]],
  ];

  for (const [name, operationRows] of cases)
    await assert.rejects(
      prepareDrawingDxfProjectImport(
        clientFor(bytes, { operationRows }),
        input(),
      ),
      /canonical|receipt|operation|DXF/i,
      name,
    );
});

test("DXF source lookup, metadata, size, and stored SHA fail closed", async () => {
  const bytes = dxf();
  for (const [name, client] of [
    ["foreign project", clientFor(bytes, { project_id: crypto.randomUUID() })],
    ["wrong kind", clientFor(bytes, { kind: "other" })],
    ["mutable", clientFor(bytes, { immutable: false })],
    ["wrong extension", clientFor(bytes, { original_filename: "detail.dwg" })],
    ["wrong MIME", clientFor(bytes, { content_type: "image/png" })],
    ["empty", clientFor(bytes, { byte_size: 0 })],
    [
      "stored size drift",
      clientFor(bytes, { storedBytes: new Uint8Array([1]) }),
    ],
    ["stored SHA drift", clientFor(bytes, { storedBytes: dxf({ units: 5 }) })],
  ])
    await assert.rejects(
      prepareDrawingDxfProjectImport(client, input()),
      /DXF|원본|파일|저장|해시|크기/,
      name,
    );
});

test("unitless DXF returns UNIT_REQUIRED and the exact explicit-unit retry succeeds", async () => {
  const bytes = dxf({ units: 0 });
  const client = clientFor(bytes);
  const blocked = await prepareDrawingDxfProjectImport(client, input());
  assert.deepEqual(blocked.operations, []);
  assert.ok(
    blocked.report.blocking.some((issue) => issue.code === "UNIT_REQUIRED"),
  );

  const retried = await prepareDrawingDxfProjectImport(
    clientFor(bytes),
    input({ unitOverride: { code: 4, label: "mm" } }),
  );
  assert.equal(retried.report.blocking.length, 0);
  assert.equal(retried.sources[0].unitSource, "user_selected");
});

function importForm(overrides = {}) {
  const values = {
    intent: "prepare_dxf_import",
    revision_id: ids.revision,
    canvas_id: ids.canvas,
    source_file_id: ids.file,
    created_at: createdAt,
    unit_code: "4",
    ...overrides,
  };
  const form = new FormData();
  for (const [name, value] of Object.entries(values)) form.set(name, value);
  return form;
}

function workspace(overrides = {}) {
  return {
    primarySource: null,
    templateCandidates: [],
    document: {
      revision: {
        id: ids.revision,
        status: "draft",
        canvases: [{ id: ids.canvas }],
        ...overrides,
      },
    },
  };
}

test("DXF import form is exact and derives the unit label server-side", () => {
  const parsed = parseDrawingDxfImportForm(importForm());
  assert.deepEqual(parsed.unitOverride, { code: 4, label: "mm" });
  const polluted = importForm();
  polluted.set("project_id", crypto.randomUUID());
  assert.throws(() => parseDrawingDxfImportForm(polluted));
  const duplicate = importForm();
  duplicate.append("canvas_id", ids.canvas);
  assert.throws(() => parseDrawingDxfImportForm(duplicate));
});

test("DXF import scope blocks read-only, frozen, foreign revision and canvas before parsing bytes", () => {
  const mutation = parseDrawingDxfImportForm(importForm());
  assert.equal(
    assertDrawingDxfImportScope({
      capability: "editor",
      mutation,
      workspace: workspace(),
    }),
    mutation,
  );
  for (const [name, capability, scopedWorkspace] of [
    ["viewer", "viewer", workspace()],
    ["review", "editor", workspace({ status: "in_review" })],
    ["revision", "editor", workspace({ id: crypto.randomUUID() })],
    ["canvas", "editor", workspace({ canvases: [] })],
  ])
    assert.throws(
      () =>
        assertDrawingDxfImportScope({
          capability,
          mutation,
          workspace: scopedWorkspace,
        }),
      (error) => error instanceof Response && [403, 409].includes(error.status),
      name,
    );
});

function attestationClient(receipt, error = null) {
  const calls = [];
  return {
    calls,
    async rpc(name, args) {
      calls.push([name, args]);
      return { data: receipt, error };
    },
  };
}

function attestationInput(plan) {
  return {
    actorId: ids.actor,
    projectId: ids.project,
    revisionId: ids.revision,
    canvasId: ids.canvas,
    sourceFileId: ids.file,
    sourceSha256: plan.sourceSha256,
    requestId: plan.requestId,
    operations: plan.operations,
  };
}

test("DXF attestation sends the exact immutable plan identities and operations to the issuer", async () => {
  const plan = await buildDrawingDxfImportPlan({
    bytes: dxf(),
    revisionId: ids.revision,
    canvasId: ids.canvas,
    sourceFileId: ids.file,
    createdAt,
  });
  const client = attestationClient({
    planId: plan.requestId,
    planCount: plan.operations.length,
    alreadyAppliedCount: 0,
  });

  await attestDrawingDxfImportPlan(client, attestationInput(plan));

  assert.deepEqual(client.calls, [
    [
      "lukas_drawing_attest_dxf_import_plan",
      {
        p_actor_id: ids.actor,
        p_project_id: ids.project,
        p_revision_id: ids.revision,
        p_canvas_id: ids.canvas,
        p_source_file_id: ids.file,
        p_source_sha256: plan.sourceSha256,
        p_operations: plan.operations,
      },
    ],
  ]);
});

test("DXF attestation accepts exact, repeated, and committed-prefix receipts", async () => {
  const plan = await buildDrawingDxfImportPlan({
    bytes: dxf(),
    revisionId: ids.revision,
    canvasId: ids.canvas,
    sourceFileId: ids.file,
    createdAt,
  });
  for (const alreadyAppliedCount of [0, 1, plan.operations.length]) {
    const client = attestationClient({
      planId: plan.requestId,
      planCount: plan.operations.length,
      alreadyAppliedCount,
    });
    await attestDrawingDxfImportPlan(client, attestationInput(plan));
  }
});

test("DXF attestation fails closed for issuer errors and invalid receipts", async () => {
  const plan = await buildDrawingDxfImportPlan({
    bytes: dxf(),
    revisionId: ids.revision,
    canvasId: ids.canvas,
    sourceFileId: ids.file,
    createdAt,
  });
  const valid = {
    planId: plan.requestId,
    planCount: plan.operations.length,
    alreadyAppliedCount: 0,
  };
  const cases = [
    ["rpc error", undefined, { message: "database detail" }],
    ["malformed", { planId: plan.requestId }, null],
    ["wrong plan", { ...valid, planId: crypto.randomUUID() }, null],
    ["wrong count", { ...valid, planCount: valid.planCount - 1 }, null],
    ["overcount", { ...valid, alreadyAppliedCount: valid.planCount + 1 }, null],
  ];
  for (const [name, receipt, error] of cases)
    await assert.rejects(
      attestDrawingDxfImportPlan(
        attestationClient(receipt, error),
        attestationInput(plan),
      ),
      (caught) =>
        caught instanceof DrawingDxfSourceError &&
        caught.status === 503 &&
        !caught.message.includes("database detail"),
      name,
    );
});

test("DXF attestation maps a thrown issuer transport failure to a retryable source error", async () => {
  const plan = await buildDrawingDxfImportPlan({
    bytes: dxf(),
    revisionId: ids.revision,
    canvasId: ids.canvas,
    sourceFileId: ids.file,
    createdAt,
  });
  await assert.rejects(
    attestDrawingDxfImportPlan(
      {
        async rpc() {
          throw new Error("issuer transport detail");
        },
      },
      attestationInput(plan),
    ),
    (caught) =>
      caught instanceof DrawingDxfSourceError &&
      caught.status === 503 &&
      !caught.message.includes("issuer transport detail"),
  );
});
