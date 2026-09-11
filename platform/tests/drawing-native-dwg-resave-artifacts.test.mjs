import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createServer } from "vite";

import { resaveArtifactFixture } from "./fixtures/drawing-native-dwg-resave-artifacts.mjs";
import { uuid } from "./fixtures/drawing-native-dwg-resave-source.mjs";

const vite = await createServer({
  appType: "custom",
  configFile: false,
  logLevel: "silent",
  resolve: {
    alias: { "~": fileURLToPath(new URL("../app", import.meta.url)) },
  },
  server: { middlewareMode: true },
});
test.after(() => vite.close());
const { buildNativeDrawingDwgResaveAttestation: buildAttestation } =
  await vite.ssrLoadModule(
    "/app/lukas/lib/drawing-native-dwg-resave-attestation.server.ts",
  );
const artifactsModule = await vite
  .ssrLoadModule("/app/lukas/lib/drawing-native-dwg-resave-artifacts.server.ts")
  .catch(() => ({}));

function api() {
  for (const name of [
    "NATIVE_DWG_RESAVE_ARTIFACT_LIMITS",
    "NativeDrawingDwgResaveArtifactKindSchema",
    "NativeDrawingDwgResaveReceiptSchema",
    "NativeDrawingDwgResaveDescriptorSchema",
    "buildNativeDrawingDwgResaveArtifacts",
    "nativeDrawingDwgResaveArtifactPath",
    "validateNativeDrawingDwgResaveStagedArtifacts",
    "validateNativeDrawingDwgResaveReceipt",
  ])
    assert.ok(artifactsModule[name], `Required artifact API absent: ${name}`);
  return artifactsModule;
}
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const cloneResult = (result) => ({
  report: structuredClone(result.report),
  reportBytes: Buffer.from(result.reportBytes),
  dwgBytes: Buffer.from(result.dwgBytes),
});

test("builds the four exact ordered artifacts through the production verifier", async () => {
  const f = await resaveArtifactFixture(buildAttestation);
  const { buildNativeDrawingDwgResaveArtifacts: build } = api();
  const artifacts = await build(f.claim, f.result, f.imageId);
  assert.deepEqual(
    artifacts.metadata.map(({ kind }) => kind),
    ["dwg", "edit_request", "authority", "report"],
  );
  assert.equal(
    artifacts.bytesByKind.edit_request.toString("utf8"),
    f.claim.attestation.request.text,
  );
  assert.equal(
    artifacts.bytesByKind.authority.toString("utf8"),
    f.claim.attestation.authority.text,
  );
  assert.deepEqual(artifacts.bytesByKind.report, f.result.reportBytes);
  assert.equal(artifacts.metadata[0].sha256, sha256(f.result.dwgBytes));
  assert.equal(artifacts.metadata[0].byteSize, f.result.dwgBytes.byteLength);
  assert.deepEqual(artifacts.claim, f.claim);
});

test("snapshots caller claim and native buffers before the attestation await", async () => {
  const f = await resaveArtifactFixture(buildAttestation);
  const { buildNativeDrawingDwgResaveArtifacts: build } = api();
  const expectedClaim = structuredClone(f.claim);
  const expectedDwg = Buffer.from(f.result.dwgBytes);
  const expectedReport = Buffer.from(f.result.reportBytes);
  const pending = build(f.claim, f.result, f.imageId);
  f.claim.payload.approved.approvalDecision = "superseded";
  f.claim.attestation.request.handles[0] = "3A";
  f.result.dwgBytes.fill(0);
  f.result.reportBytes.fill(0);
  const artifacts = await pending;
  assert.deepEqual(artifacts.claim, expectedClaim);
  assert.deepEqual(artifacts.bytesByKind.dwg, expectedDwg);
  assert.deepEqual(artifacts.bytesByKind.report, expectedReport);
});

test("rejects unpinned, changed-attestation, no-op and extra claim/result inputs", async () => {
  const f = await resaveArtifactFixture(buildAttestation);
  const { buildNativeDrawingDwgResaveArtifacts: build } = api();
  await assert.rejects(build(f.claim, f.result, `sha256:${"d".repeat(64)}`));
  const changedPayload = structuredClone(f.claim);
  changedPayload.payload.analysis.result.reportText += " ";
  await assert.rejects(build(changedPayload, f.result, f.imageId));
  const noOp = structuredClone(f.claim);
  noOp.attestation.request = null;
  await assert.rejects(build(noOp, f.result, f.imageId));
  await assert.rejects(build({ ...f.claim, extra: true }, f.result, f.imageId));
  await assert.rejects(build(f.claim, { ...f.result, extra: true }, f.imageId));
});

test("rejects report object/bytes disagreement and source/request/output mismatches", async () => {
  const f = await resaveArtifactFixture(buildAttestation);
  const { buildNativeDrawingDwgResaveArtifacts: build } = api();
  const changes = [
    (result) => (result.report.verification.inventoriedEntityCount = 2),
    (result) => (result.report.source.sha256 = "0".repeat(64)),
    (result) => (result.report.request.sha256 = "0".repeat(64)),
    (result) => (result.report.output.sha256 = "0".repeat(64)),
    (result) => (result.dwgBytes = Buffer.from("short")),
    (result) => {
      result.dwgBytes = Buffer.from("XXXXXXwrong-header");
      Object.assign(result.report.output, {
        sha256: sha256(result.dwgBytes),
        byteSize: result.dwgBytes.byteLength,
      });
      result.reportBytes = Buffer.from(JSON.stringify(result.report));
    },
  ];
  for (const change of changes) {
    const result = cloneResult(f.result);
    change(result);
    await assert.rejects(build(f.claim, result, f.imageId));
  }
});

test("validates exact staged replay, immutable paths and a closed response", async () => {
  const f = await resaveArtifactFixture(buildAttestation);
  const {
    buildNativeDrawingDwgResaveArtifacts: build,
    nativeDrawingDwgResaveArtifactPath: artifactPath,
    validateNativeDrawingDwgResaveStagedArtifacts: validate,
  } = api();
  const built = await build(f.claim, f.result, f.imageId);
  const staged = {
    jobId: f.claim.jobId,
    attemptNumber: f.claim.attemptNumber,
    leaseToken: f.claim.leaseToken,
    uploadState: "open",
    artifacts: built.metadata.map((metadata) => ({
      ...metadata,
      path: artifactPath(
        f.claim.scope,
        f.claim.jobId,
        f.claim.attemptNumber,
        metadata,
      ),
    })),
  };
  assert.deepEqual(validate(staged, built.claim, built.metadata), staged);
  assert.equal(
    validate({ ...staged, uploadState: "closed" }, built.claim, built.metadata)
      .uploadState,
    "closed",
  );
  const mutations = [
    (value) => value.artifacts.reverse(),
    (value) => (value.artifacts[1] = value.artifacts[0]),
    (value) => value.artifacts.pop(),
    (value) => (value.jobId = uuid(92)),
    (value) => (value.attemptNumber = 1),
    (value) => (value.leaseToken = uuid(93)),
    (value) => (value.artifacts[0].sha256 = "0".repeat(64)),
    (value) => (value.artifacts[0].path += "-other"),
    (value) =>
      (value.artifacts[0].path = value.artifacts[0].path.replace(
        f.claim.scope.projectId,
        uuid(94),
      )),
    (value) => (value.extra = true),
  ];
  for (const mutate of mutations) {
    const changed = structuredClone(staged);
    mutate(changed);
    assert.throws(() => validate(changed, built.claim, built.metadata));
  }
});

test("validates the exact public receipt and self-consistent descriptor", async () => {
  const f = await resaveArtifactFixture(buildAttestation);
  const {
    buildNativeDrawingDwgResaveArtifacts: build,
    nativeDrawingDwgResaveArtifactPath: artifactPath,
    validateNativeDrawingDwgResaveReceipt: validate,
    NativeDrawingDwgResaveDescriptorSchema: descriptorSchema,
  } = api();
  const built = await build(f.claim, f.result, f.imageId);
  const receipt = {
    schemaVersion: "1hk-dwg-resave-receipt/1",
    jobId: f.claim.jobId,
    attemptNumber: f.claim.attemptNumber,
    scope: f.claim.scope,
    resaverImageId: f.imageId,
    sourceSha256: f.claim.source.sha256,
    qualification: "experimental-unqualified",
    persistenceAuthority: "not-issued",
    artifacts: built.metadata,
    createdAt: "2026-09-06T00:00:00.000Z",
  };
  assert.deepEqual(validate(receipt, built.claim, built.metadata), receipt);
  for (const change of [
    { authority: f.claim.attestation.authority.text },
    { leaseToken: f.claim.leaseToken },
    { sourceSha256: "0".repeat(64) },
    { artifacts: built.metadata.toReversed() },
  ])
    assert.throws(() =>
      validate({ ...receipt, ...change }, built.claim, built.metadata),
    );

  const metadata = built.metadata[0];
  const descriptor = {
    jobId: f.claim.jobId,
    attemptNumber: f.claim.attemptNumber,
    kind: metadata.kind,
    bucket: "lukas-qto",
    path: artifactPath(
      f.claim.scope,
      f.claim.jobId,
      f.claim.attemptNumber,
      metadata,
    ),
    sha256: metadata.sha256,
    byteSize: metadata.byteSize,
  };
  assert.deepEqual(descriptorSchema.parse(descriptor), descriptor);
  assert.throws(() =>
    descriptorSchema.parse({
      ...descriptor,
      path: descriptor.path.replace("resaved.dwg", "native-report.json"),
    }),
  );
});

test("publishes fixed safe artifact limits and strict kinds", () => {
  const {
    NATIVE_DWG_RESAVE_ARTIFACT_LIMITS: limits,
    NativeDrawingDwgResaveArtifactKindSchema: kindSchema,
  } = api();
  assert.deepEqual(limits, {
    dwg: 209715200,
    edit_request: 2097152,
    authority: 67108864,
    report: 1048576,
  });
  assert.deepEqual(kindSchema.options, [
    "dwg",
    "edit_request",
    "authority",
    "report",
  ]);
  assert.throws(() => kindSchema.parse("source_manifest"));
});
