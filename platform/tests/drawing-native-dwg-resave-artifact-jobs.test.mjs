import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { resaveArtifactFixture } from "./fixtures/drawing-native-dwg-resave-artifacts.mjs";
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
const jobs = await vite.ssrLoadModule(
  "/app/lukas/lib/drawing-native-dwg-resave-jobs.server.ts",
);
const adapters = await vite
  .ssrLoadModule(
    "/app/lukas/lib/drawing-native-dwg-resave-artifact-jobs.server.ts",
  )
  .catch(() => ({}));
const { buildNativeDrawingDwgResaveAttestation } = await vite.ssrLoadModule(
  "/app/lukas/lib/drawing-native-dwg-resave-attestation.server.ts",
);
const core = await vite.ssrLoadModule(
  "/app/lukas/lib/drawing-native-dwg-resave-artifacts.server.ts",
);
const f = await resaveArtifactFixture(buildNativeDrawingDwgResaveAttestation);
const { metadata } = await core.buildNativeDrawingDwgResaveArtifacts(
  f.claim,
  f.result,
  f.imageId,
);
const { scope, jobId, actorId, attemptNumber } = f.claim;
const receipt = {
  schemaVersion: "1hk-dwg-resave-receipt/1",
  jobId,
  attemptNumber,
  scope,
  resaverImageId: f.imageId,
  sourceSha256: f.claim.source.sha256,
  qualification: "experimental-unqualified",
  persistenceAuthority: "not-issued",
  artifacts: metadata,
  createdAt: "2026-09-06T00:00:00.000Z",
};
const descriptor = {
  jobId,
  attemptNumber,
  kind: "dwg",
  bucket: "lukas-qto",
  sha256: metadata[0].sha256,
  byteSize: metadata[0].byteSize,
  path: `projects/${scope.projectId}/native-dwg-resave/${jobId}/2/${metadata[0].sha256}/resaved.dwg`,
};
function client(
  name,
  args,
  response,
  { error = null, afterActor = actorId } = {},
) {
  let authCount = 0;
  return {
    auth: {
      getUser: async () => ({
        data: {
          user: {
            id: authCount++ === 0 ? actorId : afterActor,
            is_anonymous: false,
          },
        },
        error: null,
      }),
    },
    rpc(actualName, actualArgs) {
      assert.equal(actualName, name);
      assert.deepEqual(actualArgs, args);
      return {
        abortSignal: async (signal) => {
          assert.ok(signal instanceof AbortSignal);
          return { data: response, error };
        },
      };
    },
  };
}
const invalid = (e) => e.kind === "invalid" || e.kind === "unavailable";
test("receipt adapters require complete ordered receipt and exact normalized authorized scope", async () => {
  assert.equal(typeof adapters.getNativeDrawingDwgResaveReceipt, "function");
  const args = { p_scope: scope, p_job_id: jobId };
  const call = (response, options) =>
    adapters.getNativeDrawingDwgResaveReceipt(
      client(
        "lukas_drawing_native_dwg_resave_receipt",
        args,
        response,
        options,
      ),
      scope,
      jobId,
    );
  assert.deepEqual(await call(receipt), receipt);
  for (const bad of [
    null,
    { ...receipt, leaseToken: f.claim.leaseToken },
    { ...receipt, jobId: actorId },
    {
      ...receipt,
      scope: { ...scope, revisionVersion: scope.revisionVersion + 1 },
    },
    { ...receipt, artifacts: [...metadata].reverse() },
    { ...receipt, artifacts: metadata.slice(1) },
  ])
    await assert.rejects(call(bad), invalid);
  for (const error of [undefined, false, 0, ""]) {
    const c = client("lukas_drawing_native_dwg_resave_receipt", args, receipt);
    c.rpc = () => ({ abortSignal: async () => ({ data: receipt, error }) });
    await assert.rejects(
      adapters.getNativeDrawingDwgResaveReceipt(c, scope, jobId),
      invalid,
    );
  }
  await assert.rejects(call(receipt, { afterActor: jobId }), invalid);
  const uppercase = Object.fromEntries(
    Object.entries(scope).map(([k, v]) => [
      k,
      k.endsWith("Id") ? v.toUpperCase() : v,
    ]),
  );
  assert.deepEqual(
    await adapters.getNativeDrawingDwgResaveReceipt(
      client("lukas_drawing_native_dwg_resave_receipt", args, receipt),
      uppercase,
      jobId.toUpperCase(),
    ),
    receipt,
  );
});
test("download descriptor binds every path component to authorized project/job/attempt/kind/hash", async () => {
  assert.equal(
    typeof adapters.getNativeDrawingDwgResaveDownloadDescriptor,
    "function",
  );
  const args = { p_scope: scope, p_job_id: jobId, p_kind: "dwg" };
  const call = (response) =>
    adapters.getNativeDrawingDwgResaveDownloadDescriptor(
      client(
        "lukas_drawing_native_dwg_resave_download_descriptor",
        args,
        response,
      ),
      scope,
      jobId,
      "dwg",
    );
  assert.deepEqual(await call(descriptor), descriptor);
  for (const bad of [
    { ...descriptor, path: descriptor.path.replace(scope.projectId, actorId) },
    { ...descriptor, path: descriptor.path.replace("/2/", "/1/") },
    {
      ...descriptor,
      path: descriptor.path.replace("resaved.dwg", "native-report.json"),
    },
    {
      ...descriptor,
      path: descriptor.path.replace(metadata[0].sha256, "a".repeat(64)),
    },
    { ...descriptor, kind: "report" },
    { ...descriptor, jobId: actorId },
    { ...descriptor, source: "private" },
    { ...descriptor, byteSize: 209715201 },
  ])
    await assert.rejects(call(bad), invalid);
});
test("latest status authenticates before lookup, accepts null and completed with existing public shape", async () => {
  assert.equal(typeof jobs.getLatestNativeDrawingDwgResaveStatus, "function");
  const name = "lukas_drawing_native_dwg_resave_status",
    args = { p_scope: scope, p_job_id: null };
  assert.equal(
    await jobs.getLatestNativeDrawingDwgResaveStatus(
      client(name, args, null),
      scope,
    ),
    null,
  );
  const completed = {
    jobId,
    requestId: actorId,
    hasChanges: true,
    status: "completed",
    attemptCount: 2,
    failureCode: null,
  };
  assert.deepEqual(
    await jobs.getLatestNativeDrawingDwgResaveStatus(
      client(name, args, completed),
      scope,
    ),
    completed,
  );
  for (const failureCode of ["upload_failed", "publication_failed"])
    assert.equal(
      (
        await jobs.getLatestNativeDrawingDwgResaveStatus(
          client(name, args, { ...completed, status: "failed", failureCode }),
          scope,
        )
      ).failureCode,
      failureCode,
    );
  for (const response of [
    { ...completed, extra: true },
    { ...completed, status: "completed", attemptCount: 0 },
  ])
    await assert.rejects(
      jobs.getLatestNativeDrawingDwgResaveStatus(
        client(name, args, response),
        scope,
      ),
      invalid,
    );
  const unauth = client(name, args, null);
  unauth.auth.getUser = async () => ({ data: { user: null }, error: null });
  unauth.rpc = () => assert.fail("unauthenticated request reached RPC");
  await assert.rejects(
    jobs.getLatestNativeDrawingDwgResaveStatus(unauth, scope),
    invalid,
  );
  const c = client(name, args, null);
  c.rpc = () => assert.fail("strict invalid scope reached RPC");
  await assert.rejects(
    jobs.getLatestNativeDrawingDwgResaveStatus(c, { ...scope, extra: true }),
    invalid,
  );
});
