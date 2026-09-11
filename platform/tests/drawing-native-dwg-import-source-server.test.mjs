import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { buildNativeDrawingDwgImportPlan } from "../app/lukas/lib/drawing-native-dwg-import-plan.server.ts";
import {
  DrawingNativeDwgImportSourceError,
  prepareNativeDrawingDwgProjectImport,
} from "../app/lukas/lib/drawing-native-dwg-import-source.server.ts";
import { drawingCollaborationOperationDigestSource } from "../app/lukas/lib/drawing-collaboration-protocol.ts";

const ids = Object.freeze({
  project: "9c000000-0000-4000-8000-000000000001",
  document: "9c000000-0000-4000-8000-000000000002",
  revision: "9c000000-0000-4000-8000-000000000003",
  canvas: "9c000000-0000-4000-8000-000000000004",
  file: "9c000000-0000-4000-8000-000000000005",
  job: "9c000000-0000-4000-8000-000000000006",
  actor: "9c000000-0000-4000-8000-000000000007",
  verification: "9c000000-0000-4000-8000-000000000008",
});

const source = Object.freeze({
  verificationId: ids.verification,
  fileId: ids.file,
  sha256: "a".repeat(64),
  byteSize: 4_096,
  headerVersion: "AC1024",
});

const report = Object.freeze({
  schemaVersion: "1hk-dwg-import/1",
  qualification: "experimental-unqualified",
  source: {
    sha256: source.sha256,
    byteSize: source.byteSize,
    headerVersion: source.headerVersion,
  },
  engine: { name: "ACadSharp", version: "3.7.1" },
  coordinateSystem: "WCS_NATIVE_UNITS",
  unitCode: 4,
  modelSpaceHandle: "1F",
  layers: [{ handle: "10", name: "A-WALL", visible: false, locked: true }],
  entities: [
    {
      handle: "20",
      ownerHandle: "1F",
      layerHandle: "10",
      type: "LINE",
      geometry: { start: [0, 0, 0], end: [2, 0, 0] },
    },
  ],
  coverage: {
    modelSpaceEntities: 1,
    importedEntities: 1,
    unsupportedEntities: 0,
    nonModelSpaceEntities: 0,
  },
  unsupported: [],
  readerNotificationCount: 0,
});

function analysisReceipt(reportText, overrides = {}) {
  return {
    jobId: ids.job,
    attemptNumber: 1,
    readerImageId: `sha256:${"b".repeat(64)}`,
    reportSha256: createHash("sha256").update(reportText).digest("hex"),
    reportByteSize: Buffer.byteLength(reportText, "utf8"),
    source: { ...source },
    qualification: "experimental-unqualified",
    persistenceAuthority: "not-issued",
    ...overrides,
  };
}

function contextFor({ reportValue = report, receiptOverrides, change } = {}) {
  const reportText = JSON.stringify(reportValue);
  const receipt = analysisReceipt(reportText, receiptOverrides);
  const value = {
    scope: {
      projectId: ids.project,
      documentId: ids.document,
      revisionId: ids.revision,
      canvasId: ids.canvas,
      sourceFileId: ids.file,
      sourceSha256: source.sha256,
      unitOverride: null,
    },
    status: {
      jobId: ids.job,
      status: "analyzed",
      attemptCount: 1,
      failureCode: null,
      receipt,
    },
    result: { receipt: structuredClone(receipt), reportText },
  };
  change?.(value);
  return value;
}

function input(overrides = {}) {
  return {
    projectId: ids.project,
    revisionId: ids.revision,
    canvasId: ids.canvas,
    jobId: ids.job,
    actorId: ids.actor,
    ...overrides,
  };
}

function planned() {
  const reportText = JSON.stringify(report);
  return buildNativeDrawingDwgImportPlan({
    report,
    expectedSource: report.source,
    revisionId: ids.revision,
    canvasId: ids.canvas,
    sourceFileId: ids.file,
    analysisJobId: ids.job,
    reportSha256: createHash("sha256").update(reportText).digest("hex"),
  });
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

function sessionClient(context = contextFor(), { operationRows = [] } = {}) {
  const calls = [];
  return {
    calls,
    auth: {
      async getUser() {
        calls.push(["getUser"]);
        return {
          data: {
            user: {
              id: ids.actor,
              is_anonymous: false,
              app_metadata: {},
            },
          },
          error: null,
        };
      },
    },
    async rpc(name, args) {
      calls.push(["rpc", name, args]);
      return { data: context, error: null };
    },
    from(table) {
      calls.push(["from", table]);
      assert.equal(table, "lukas_drawing_operations");
      const filters = [];
      let operationIds = [];
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
        in(column, values) {
          operationIds = values;
          calls.push(["in", column, values]);
          return query;
        },
        order(column, options) {
          calls.push(["order", column, options]);
          return query;
        },
        limit(limit) {
          calls.push(["limit", limit]);
          return Promise.resolve({
            data: operationRows.filter(
              (row) =>
                operationIds.includes(row.client_operation_id) &&
                filters.every(([column, value]) => row[column] === value),
            ),
            error: null,
          });
        },
      };
      return query;
    },
  };
}

function serviceLoader(plan, overrides = {}) {
  const calls = [];
  const loader = async () => {
    calls.push(["load"]);
    return {
      default: {
        async rpc(name, args) {
          calls.push(["rpc", name, args]);
          if (overrides.throwTransport) throw new Error("private transport");
          return {
            data: overrides.receipt ?? {
              planId: plan.requestId,
              planCount: plan.operations.length,
              alreadyAppliedCount: overrides.alreadyAppliedCount ?? 0,
            },
            error: overrides.error ?? null,
          };
        },
      },
    };
  };
  return { calls, loader };
}

test("authenticated native preparation validates context before issuing exact operations", async () => {
  const plan = planned();
  const session = sessionClient();
  const service = serviceLoader(plan);

  const prepared = await prepareNativeDrawingDwgProjectImport(
    session,
    input(),
    service.loader,
  );

  assert.equal(prepared.persistenceAuthority, "operation-attested");
  assert.equal(prepared.qualification, "experimental-unqualified");
  assert.equal(prepared.sourceSha256, source.sha256);
  assert.deepEqual(prepared.canonicalReceipts, []);
  assert.deepEqual(session.calls.slice(0, 2), [
    ["getUser"],
    [
      "rpc",
      "lukas_drawing_native_dwg_import_context",
      { p_job_id: ids.job, p_include_result: true },
    ],
  ]);
  assert.deepEqual(service.calls, [
    ["load"],
    [
      "rpc",
      "lukas_drawing_attest_dwg_import_plan",
      { p_job_id: ids.job, p_operations: plan.operations },
    ],
  ]);
  assert.equal(contextFor().result.receipt.persistenceAuthority, "not-issued");
});

test("authenticated actor and target mismatches fail before service credentials load", async () => {
  const plan = planned();
  for (const [name, session, mutation] of [
    [
      "actor",
      (() => {
        const value = sessionClient();
        value.auth.getUser = async () => ({
          data: {
            user: {
              id: crypto.randomUUID(),
              is_anonymous: false,
              app_metadata: {},
            },
          },
          error: null,
        });
        return value;
      })(),
      input(),
    ],
    [
      "project",
      sessionClient(
        contextFor({
          change(value) {
            value.scope.projectId = crypto.randomUUID();
          },
        }),
      ),
      input(),
    ],
    [
      "revision",
      sessionClient(
        contextFor({
          change(value) {
            value.scope.revisionId = crypto.randomUUID();
          },
        }),
      ),
      input(),
    ],
    [
      "canvas",
      sessionClient(
        contextFor({
          change(value) {
            value.scope.canvasId = crypto.randomUUID();
          },
        }),
      ),
      input(),
    ],
  ]) {
    const service = serviceLoader(plan);
    await assert.rejects(
      prepareNativeDrawingDwgProjectImport(session, mutation, service.loader),
      DrawingNativeDwgImportSourceError,
      name,
    );
    assert.deepEqual(service.calls, [], name);
  }
});

test("malformed resolved auth transport is mapped to the safe actor error", async () => {
  for (const authResponse of [undefined, null, { data: null, error: null }]) {
    const session = sessionClient();
    session.auth.getUser = async () => authResponse;
    const service = serviceLoader(planned());

    await assert.rejects(
      prepareNativeDrawingDwgProjectImport(session, input(), service.loader),
      (error) =>
        error instanceof DrawingNativeDwgImportSourceError &&
        error.status === 403,
    );
    assert.deepEqual(service.calls, []);
  }
});

test("raw client reports and malformed authenticated envelopes are rejected", async () => {
  const service = serviceLoader(planned());
  await assert.rejects(
    prepareNativeDrawingDwgProjectImport(
      sessionClient(),
      input({ report }),
      service.loader,
    ),
  );
  await assert.rejects(
    prepareNativeDrawingDwgProjectImport(
      sessionClient({ ...contextFor(), privilegedPath: "/tmp/source.dwg" }),
      input(),
      service.loader,
    ),
    DrawingNativeDwgImportSourceError,
  );
  assert.deepEqual(service.calls, []);
});

test("report hash, byte count, source and scope corruption fail before attestation", async () => {
  const cases = [
    contextFor({
      change(value) {
        value.result.receipt.reportSha256 = "c".repeat(64);
        value.status.receipt.reportSha256 = "c".repeat(64);
      },
    }),
    contextFor({
      change(value) {
        value.result.receipt.reportByteSize += 1;
        value.status.receipt.reportByteSize += 1;
      },
    }),
    contextFor({
      reportValue: {
        ...report,
        source: { ...report.source, sha256: "d".repeat(64) },
      },
    }),
    contextFor({
      change(value) {
        value.scope.sourceSha256 = "e".repeat(64);
      },
    }),
  ];
  for (const context of cases) {
    const service = serviceLoader(planned());
    await assert.rejects(
      prepareNativeDrawingDwgProjectImport(
        sessionClient(context),
        input(),
        service.loader,
      ),
      DrawingNativeDwgImportSourceError,
    );
    assert.deepEqual(service.calls, []);
  }
});

test("only an analyzed not-issued receipt can be promoted by preparation", async () => {
  const queued = contextFor({
    change(value) {
      value.status = {
        jobId: ids.job,
        status: "queued",
        attemptCount: 0,
        failureCode: null,
        receipt: null,
      };
      value.result = null;
    },
  });
  const partialAuthority = contextFor({
    change(value) {
      value.status.receipt.persistenceAuthority = "operation-attested";
      value.result.receipt.persistenceAuthority = "operation-attested";
    },
  });
  const mismatchedReceipt = contextFor({
    change(value) {
      value.result.receipt.readerImageId = `sha256:${"f".repeat(64)}`;
    },
  });
  for (const context of [queued, partialAuthority, mismatchedReceipt]) {
    const service = serviceLoader(planned());
    await assert.rejects(
      prepareNativeDrawingDwgProjectImport(
        sessionClient(context),
        input(),
        service.loader,
      ),
      DrawingNativeDwgImportSourceError,
    );
    assert.deepEqual(service.calls, []);
  }
});

test("malformed service transport and attestation receipts never return partial authority", async () => {
  const plan = planned();
  const valid = {
    planId: plan.requestId,
    planCount: plan.operations.length,
    alreadyAppliedCount: 0,
  };
  for (const overrides of [
    { throwTransport: true },
    { error: { message: "private database detail" } },
    { receipt: { ...valid, extra: true } },
    { receipt: { ...valid, planId: crypto.randomUUID() } },
    { receipt: { ...valid, planCount: valid.planCount - 1 } },
    {
      receipt: {
        ...valid,
        alreadyAppliedCount: valid.planCount + 1,
      },
    },
  ]) {
    const service = serviceLoader(plan, overrides);
    await assert.rejects(
      prepareNativeDrawingDwgProjectImport(
        sessionClient(),
        input(),
        service.loader,
      ),
      (error) =>
        error instanceof DrawingNativeDwgImportSourceError &&
        !error.message.includes("private"),
    );
  }
});

test("same analyzed job prepares an identical operation-attested replay", async () => {
  const plan = planned();
  const service = serviceLoader(plan);
  const first = await prepareNativeDrawingDwgProjectImport(
    sessionClient(),
    input(),
    service.loader,
  );
  const replay = await prepareNativeDrawingDwgProjectImport(
    sessionClient(),
    input(),
    service.loader,
  );

  assert.deepEqual(replay, first);
  assert.equal(service.calls.filter(([kind]) => kind === "load").length, 2);
});

test("preparation recovers only the exact persisted canonical prefix", async () => {
  const plan = planned();
  const rows = plan.operations
    .slice(0, 2)
    .map((operation, index) => operationRow(operation, index + 11));
  const service = serviceLoader(plan, { alreadyAppliedCount: rows.length });

  const prepared = await prepareNativeDrawingDwgProjectImport(
    sessionClient(contextFor(), { operationRows: rows }),
    input(),
    service.loader,
  );

  assert.deepEqual(
    prepared.canonicalReceipts,
    rows.map((row, index) => ({
      clientOperationId: row.client_operation_id,
      revisionId: row.revision_id,
      actorId: row.actor_id,
      sequence: row.sequence,
      resultVersions: row.result_versions,
      operationSha256: createHash("sha256")
        .update(
          drawingCollaborationOperationDigestSource(
            plan.operations[index],
            row.actor_id,
          ),
        )
        .digest("hex"),
    })),
  );
});

test("changed stored native operation is rejected instead of accepted as replay", async () => {
  const plan = planned();
  const first = operationRow(plan.operations[0], 11);
  for (const row of [
    { ...first, actor_id: crypto.randomUUID() },
    { ...first, forward: { ...first.forward, injected: true } },
    { ...first, result_versions: { [ids.canvas]: 99 } },
  ]) {
    const service = serviceLoader(plan, { alreadyAppliedCount: 1 });
    await assert.rejects(
      prepareNativeDrawingDwgProjectImport(
        sessionClient(contextFor(), { operationRows: [row] }),
        input(),
        service.loader,
      ),
      DrawingNativeDwgImportSourceError,
    );
  }
});
