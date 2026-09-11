import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

const jobs = await import(
  "../app/lukas/lib/drawing-native-dwg-import-jobs.server.ts"
);

const ids = Object.freeze({
  project: "91000000-0000-4000-8000-000000000001",
  document: "91000000-0000-4000-8000-000000000002",
  revision: "91000000-0000-4000-8000-000000000003",
  canvas: "91000000-0000-4000-8000-000000000004",
  file: "91000000-0000-4000-8000-000000000005",
  request: "91000000-0000-4000-8000-000000000006",
  job: "91000000-0000-4000-8000-000000000007",
  actor: "91000000-0000-4000-8000-000000000008",
  verification: "91000000-0000-4000-8000-000000000009",
  lease: "91000000-0000-4000-8000-00000000000a",
});
const sourceBytes = Buffer.from("AC1024strict-job-codec");
const sourceSha256 = createHash("sha256").update(sourceBytes).digest("hex");
const report = Object.freeze({
  schemaVersion: "1hk-dwg-import/1",
  qualification: "experimental-unqualified",
  source: {
    sha256: sourceSha256,
    byteSize: sourceBytes.byteLength,
    headerVersion: "AC1024",
  },
  engine: { name: "ACadSharp", version: "3.7.1" },
  coordinateSystem: "WCS_NATIVE_UNITS",
  unitCode: 4,
  modelSpaceHandle: "1F",
  layers: [],
  entities: [],
  coverage: {
    modelSpaceEntities: 0,
    importedEntities: 0,
    unsupportedEntities: 0,
    nonModelSpaceEntities: 0,
  },
  unsupported: [],
  readerNotificationCount: 0,
});
const reportText = JSON.stringify(report);
const reportSha256 = createHash("sha256").update(reportText).digest("hex");
const scope = Object.freeze({
  projectId: ids.project,
  documentId: ids.document,
  revisionId: ids.revision,
  canvasId: ids.canvas,
  sourceFileId: ids.file,
  sourceSha256,
  unitOverride: null,
});
const source = Object.freeze({
  verificationId: ids.verification,
  fileId: ids.file,
  bucket: "lukas-qto",
  path: `projects/${ids.project}/source drawings/a b#.dwg`,
  sha256: sourceSha256,
  byteSize: sourceBytes.byteLength,
  headerVersion: "AC1024",
});
const imageId = `sha256:${"a".repeat(64)}`;
const claim = Object.freeze({
  jobId: ids.job,
  attemptNumber: 1,
  leaseToken: ids.lease,
  leaseExpiresAt: "2026-09-06T10:05:00.000Z",
  readerImageId: imageId,
  actorId: ids.actor,
  scope,
  source,
});
const receipt = Object.freeze({
  jobId: ids.job,
  attemptNumber: 1,
  readerImageId: imageId,
  reportSha256,
  reportByteSize: Buffer.byteLength(reportText),
  source: {
    verificationId: ids.verification,
    fileId: ids.file,
    sha256: sourceSha256,
    byteSize: sourceBytes.byteLength,
    headerVersion: "AC1024",
  },
  qualification: "experimental-unqualified",
  persistenceAuthority: "not-issued",
});

function client(data, expectedName, expectedArgs, error = null) {
  return {
    rpc(name, args) {
      assert.equal(name, expectedName);
      assert.deepEqual(args, expectedArgs);
      return {
        abortSignal(signal) {
          assert.ok(signal instanceof AbortSignal);
          return Promise.resolve({ data, error });
        },
      };
    },
  };
}

test("strict public scope, status and receipt codecs reject extra and cross-identity data", () => {
  assert.deepEqual(jobs.NativeDrawingDwgImportScopeSchema.parse(scope), scope);
  for (const invalid of [
    { ...scope, actorId: ids.actor },
    { ...scope, unitOverride: 3 },
    { ...scope, sourceSha256: sourceSha256.toUpperCase() },
  ])
    assert.throws(() => jobs.NativeDrawingDwgImportScopeSchema.parse(invalid));

  assert.deepEqual(
    jobs.NativeDrawingDwgImportStatusSchema.parse({
      jobId: ids.job,
      status: "analyzed",
      attemptCount: 1,
      failureCode: null,
      receipt,
    }).receipt,
    receipt,
  );
  for (const invalid of [
    { ...receipt, persistenceAuthority: "issued" },
    { ...receipt, jobId: ids.actor },
    { ...receipt, privatePath: source.path },
  ])
    assert.throws(() =>
      jobs.NativeDrawingDwgImportStatusSchema.parse({
        jobId: ids.job,
        status: "analyzed",
        attemptCount: 1,
        failureCode: null,
        receipt: invalid,
      }),
    );
  assert.throws(() =>
    jobs.NativeDrawingDwgImportStatusSchema.parse({
      jobId: ids.job,
      status: "processing",
      attemptCount: 1,
      failureCode: null,
      receipt,
    }),
  );
});

test("strict service claim codec binds scope, source and immutable image", () => {
  assert.deepEqual(jobs.parseNativeDrawingDwgImportClaim(claim), claim);
  for (const invalid of [
    { ...claim, readerImageId: "reader:latest" },
    { ...claim, scope: { ...scope, sourceFileId: ids.actor } },
    { ...claim, source: { ...source, sha256: "b".repeat(64) } },
    { ...claim, source: { ...source, path: "../private.dwg" } },
    { ...claim, source: { ...source, bucket: "public" } },
    { ...claim, secret: "service-role" },
  ])
    assert.throws(() => jobs.parseNativeDrawingDwgImportClaim(invalid));
});

test("authenticated helpers send exact frozen RPC arguments and validate result evidence", async () => {
  assert.deepEqual(
    await jobs.requestNativeDrawingDwgImport(
      client({ jobId: ids.job }, "lukas_drawing_request_native_dwg_import", {
        p_scope: scope,
        p_request_id: ids.request,
      }),
      scope,
      ids.request,
    ),
    { jobId: ids.job },
  );
  const status = {
    jobId: ids.job,
    status: "analyzed",
    attemptCount: 1,
    failureCode: null,
    receipt,
  };
  assert.deepEqual(
    await jobs.getNativeDrawingDwgImportStatus(
      client(status, "lukas_drawing_native_dwg_import_status", {
        p_scope: scope,
        p_job_id: ids.job,
      }),
      scope,
      ids.job,
    ),
    status,
  );
  assert.deepEqual(
    await jobs.getNativeDrawingDwgImportResult(
      client(
        { receipt, reportText },
        "lukas_drawing_native_dwg_import_result",
        { p_scope: scope, p_job_id: ids.job },
      ),
      scope,
      ids.job,
    ),
    { receipt, reportText },
  );
});

test("result and status helpers fail closed on null, changed, malformed or oversized evidence", async () => {
  assert.equal(
    await jobs.getNativeDrawingDwgImportStatus(
      client(null, "lukas_drawing_native_dwg_import_status", {
        p_scope: scope,
        p_job_id: ids.job,
      }),
      scope,
      ids.job,
    ),
    null,
  );
  await assert.rejects(
    jobs.getNativeDrawingDwgImportResult(
      client(null, "lukas_drawing_native_dwg_import_result", {
        p_scope: scope,
        p_job_id: ids.job,
      }),
      scope,
      ids.job,
    ),
    (error) =>
      error instanceof jobs.NativeDrawingDwgImportJobError &&
      error.kind === "unavailable",
  );
  const cases = [
    { receipt: { ...receipt, reportSha256: "0".repeat(64) }, reportText },
    { receipt, reportText: JSON.stringify({ ...report, extra: true }) },
    { receipt, reportText: "x".repeat(33_554_433) },
  ];
  for (const value of cases)
    await assert.rejects(
      jobs.getNativeDrawingDwgImportResult(
        client(value, "lukas_drawing_native_dwg_import_result", {
          p_scope: scope,
          p_job_id: ids.job,
        }),
        scope,
        ids.job,
      ),
      /native DWG import/i,
    );
});

test("helpers require abortable RPC transport and map bounded database codes", async () => {
  await assert.rejects(
    jobs.requestNativeDrawingDwgImport(
      { rpc: async () => ({ data: { jobId: ids.job }, error: null }) },
      scope,
      ids.request,
    ),
    /transport/i,
  );
  await assert.rejects(
    jobs.requestNativeDrawingDwgImport(
      {
        rpc() {
          throw new Error("service secret and private SQL details");
        },
      },
      scope,
      ids.request,
    ),
    (error) =>
      error instanceof jobs.NativeDrawingDwgImportJobError &&
      error.kind === "unavailable" &&
      !error.message.includes("service secret"),
  );
  await assert.rejects(
    jobs.requestNativeDrawingDwgImport(
      client(
        null,
        "lukas_drawing_request_native_dwg_import",
        { p_scope: scope, p_request_id: ids.request },
        { code: "PNI05", details: "private queue state" },
      ),
      scope,
      ids.request,
    ),
    (error) =>
      error instanceof jobs.NativeDrawingDwgImportJobError &&
      error.kind === "capacity" &&
      !error.message.includes("private queue state"),
  );
});
