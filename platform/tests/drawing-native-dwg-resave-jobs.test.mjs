import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { fixture, uuid } from "./fixtures/drawing-native-dwg-resave-source.mjs";

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
const jobs = await vite
  .ssrLoadModule("/app/lukas/lib/drawing-native-dwg-resave-jobs.server.ts")
  .catch(() => ({}));
const { buildNativeDrawingDwgResaveAttestation: build } =
  await vite.ssrLoadModule(
    "/app/lukas/lib/drawing-native-dwg-resave-attestation.server.ts",
  );
const imageId = "sha256:" + "c".repeat(64);
const result = { jobId: uuid(90), requestId: uuid(91), hasChanges: true };
const status = {
  ...result,
  status: "processing",
  attemptCount: 1,
  failureCode: null,
};
const generic = (e) =>
  ["invalid", "unavailable"].includes(e.kind) && !e.message.includes("private");
test("malformed verified-user responses cannot authorize admission", async () => {
  const f = edited(),
    c = clients(f);
  c.user.auth.getUser = async () => ({ data: { user: { id: uuid(80) } } });
  await assert.rejects(
    jobs.requestNativeDrawingDwgResave(
      c.user,
      c.service,
      { ...f.scope, requestId: result.requestId },
      imageId,
    ),
    generic,
  );
  assert.equal(c.calls.length, 0);
});
test("present non-null falsy RPC errors cannot become successful admission", async () => {
  for (const error of [undefined, false, 0, ""]) {
    const f = edited(),
      c = clients(f, { error });
    // Explicit assignment preserves undefined instead of clients' default null.
    c.service.rpc = () => ({
      abortSignal: async () => ({ data: result, error }),
    });
    await assert.rejects(
      jobs.requestNativeDrawingDwgResave(
        c.user,
        c.service,
        { ...f.scope, requestId: result.requestId },
        imageId,
      ),
      generic,
      `malformed error ${String(error)} must not authorize success`,
    );
  }
});
test("an unchanged approved source persists a no-changes admission", async () => {
  const f = fixture(),
    c = clients(f, { response: { ...result, hasChanges: false } });
  assert.deepEqual(
    await jobs.requestNativeDrawingDwgResave(
      c.user,
      c.service,
      { ...f.scope, requestId: result.requestId },
      imageId,
    ),
    { ...result, hasChanges: false },
  );
  assert.equal(c.calls[1].args.p_attestation.request, null);
});
function clients(
  f,
  { userId = uuid(80), afterId = userId, response = result, error = null } = {},
) {
  const calls = [];
  let authCount = 0;
  const user = {
    auth: {
      getUser: async () => ({
        data: {
          user: {
            id: authCount++ === 0 ? userId : afterId,
            is_anonymous: false,
          },
        },
        error: null,
      }),
    },
    rpc(name, args) {
      calls.push({ name, args });
      return {
        abortSignal: async (signal) => {
          assert.ok(signal instanceof AbortSignal);
          return { data: f.payload, error: null };
        },
      };
    },
  };
  const service = {
    rpc(name, args) {
      calls.push({ name, args });
      return {
        abortSignal: async (signal) => {
          assert.ok(signal instanceof AbortSignal);
          return { data: response, error };
        },
      };
    },
  };
  return { user, service, calls };
}
function edited() {
  const f = fixture();
  f.canonical.objects[0].geometry.end.x += 10;
  f.rehash();
  return f;
}
test("request compiles approved source and admits only the verified actor and normalized scope", async () => {
  assert.equal(
    typeof jobs.requestNativeDrawingDwgResave,
    "function",
    "resave admission adapter must exist",
  );
  const f = edited(),
    c = clients(f);
  assert.deepEqual(
    await jobs.requestNativeDrawingDwgResave(
      c.user,
      c.service,
      { ...f.scope, requestId: result.requestId },
      imageId,
    ),
    result,
  );
  assert.deepEqual(
    c.calls.map((x) => x.name),
    [
      "lukas_qto_drawing_native_dwg_resave_source",
      "lukas_drawing_admit_native_dwg_resave",
    ],
  );
  const args = c.calls[1].args;
  assert.equal(args.p_actor_id, uuid(80));
  assert.equal(args.p_request_id, result.requestId);
  assert.deepEqual(args.p_scope, f.scope);
  assert.deepEqual(
    args.p_attestation,
    await build(f.scope, f.payload, imageId),
  );
});
test("untrusted request fields and changed login cannot reach service admission", async () => {
  for (const extra of [
    { actorId: uuid(81) },
    { attestation: {} },
    { edits: [] },
    { resaverImageId: imageId },
    { path: "private" },
  ]) {
    const f = edited(),
      c = clients(f);
    await assert.rejects(
      jobs.requestNativeDrawingDwgResave(
        c.user,
        c.service,
        { ...f.scope, requestId: result.requestId, ...extra },
        imageId,
      ),
      generic,
    );
    assert.equal(c.calls.length, 0);
  }
  const f = edited(),
    c = clients(f, { afterId: uuid(81) });
  await assert.rejects(
    jobs.requestNativeDrawingDwgResave(
      c.user,
      c.service,
      { ...f.scope, requestId: result.requestId },
      imageId,
    ),
    generic,
  );
  assert.equal(
    c.calls.filter((x) => x.name === "lukas_drawing_admit_native_dwg_resave")
      .length,
    0,
  );
});
test("uppercase browser UUIDs normalize and an abort-ignoring RPC cannot hang admission", async () => {
  const f = edited();
  const projectId = "93abcdef-0000-4000-8900-000000000001";
  const requestId = "93fedcba-0000-4000-8900-000000000091";
  f.scope.projectId = projectId;
  f.payload.approved.projectId = projectId;
  f.payload.analysis.scope.projectId = projectId;
  f.canonical.revision.projectId = projectId;
  f.rehash();
  const normalizedScope = {
    projectId: "93abcdef-0000-4000-8900-000000000001",
    documentId: "93000000-0000-4000-8900-000000000002",
    revisionId: "93000000-0000-4000-8900-000000000003",
    revisionVersion: 7,
    canvasId: "93000000-0000-4000-8900-000000000005",
    snapshotSha256:
      "7e119313537b8f0151ba9bb2bb15252c307ccb6cf8bd9ec2644ab97842fd3f72",
  };
  assert.deepEqual(f.scope, normalizedScope);
  const expectedResult = { ...result, requestId };
  const c = clients(f, { response: expectedResult });
  const request = Object.fromEntries(
    Object.entries({ ...f.scope, requestId }).map(([key, value]) => [
      key,
      key.endsWith("Id") ? value.toUpperCase() : value,
    ]),
  );
  assert.equal(request.projectId, "93ABCDEF-0000-4000-8900-000000000001");
  assert.equal(request.requestId, "93FEDCBA-0000-4000-8900-000000000091");
  assert.notEqual(request.projectId, projectId);
  assert.notEqual(request.requestId, requestId);
  assert.deepEqual(
    await jobs.requestNativeDrawingDwgResave(
      c.user,
      c.service,
      request,
      imageId,
    ),
    expectedResult,
  );
  assert.deepEqual(c.calls[0], {
    name: "lukas_qto_drawing_native_dwg_resave_source",
    args: { p_scope: normalizedScope },
  });
  assert.deepEqual(c.calls[1], {
    name: "lukas_drawing_admit_native_dwg_resave",
    args: {
      p_actor_id: uuid(80),
      p_scope: normalizedScope,
      p_request_id: "93fedcba-0000-4000-8900-000000000091",
      p_attestation: await build(normalizedScope, f.payload, imageId),
    },
  });
  const controller = new AbortController();
  c.user.rpc = () => ({
    abortSignal: () => {
      queueMicrotask(() => controller.abort());
      return new Promise(() => {});
    },
  });
  await assert.rejects(
    jobs.requestNativeDrawingDwgResave(
      c.user,
      c.service,
      { ...f.scope, requestId: result.requestId },
      imageId,
      controller.signal,
    ),
    generic,
  );
});
test("admission rejects mismatched identity, malformed responses, aborted and malformed transport", async () => {
  for (const response of [
    { ...result, requestId: uuid(92) },
    { ...result, hasChanges: false },
    { ...result, path: "private" },
    null,
    {},
  ]) {
    const f = edited(),
      c = clients(f, { response });
    await assert.rejects(
      jobs.requestNativeDrawingDwgResave(
        c.user,
        c.service,
        { ...f.scope, requestId: result.requestId },
        imageId,
      ),
      generic,
    );
  }
  const f = edited(),
    c = clients(f);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    jobs.requestNativeDrawingDwgResave(
      c.user,
      c.service,
      { ...f.scope, requestId: result.requestId },
      imageId,
      controller.signal,
    ),
    generic,
  );
  assert.equal(c.calls.length, 0);
  c.user.rpc = () => Promise.resolve({ data: f.payload, error: null });
  await assert.rejects(
    jobs.requestNativeDrawingDwgResave(
      c.user,
      c.service,
      { ...f.scope, requestId: result.requestId },
      imageId,
    ),
    generic,
  );
});
test("service errors expose only conflict, stale and capacity classifications", async () => {
  for (const [code, kind] of [
    ["PNR12", "conflict"],
    ["PNR13", "stale"],
    ["PNR15", "capacity"],
    ["XX000", "unavailable"],
  ]) {
    const f = edited(),
      c = clients(f, {
        error: { code, message: "private locator credentials" },
      });
    await assert.rejects(
      jobs.requestNativeDrawingDwgResave(
        c.user,
        c.service,
        { ...f.scope, requestId: result.requestId },
        imageId,
      ),
      (e) => e.kind === kind && !e.message.includes("private"),
    );
  }
});
test("status and cancel bind exact job identity and reject locators or inconsistent states", async () => {
  for (const [method, rpcName] of [
    [
      "getNativeDrawingDwgResaveStatus",
      "lukas_drawing_native_dwg_resave_status",
    ],
    ["cancelNativeDrawingDwgResave", "lukas_drawing_cancel_native_dwg_resave"],
  ]) {
    const f = edited();
    const c = clients(f, { response: status });
    assert.deepEqual(
      await jobs[method](c.service, f.scope, result.jobId),
      status,
    );
    assert.deepEqual(c.calls[0], {
      name: rpcName,
      args: { p_scope: f.scope, p_job_id: result.jobId },
    });
    for (const response of [
      { ...status, jobId: uuid(92) },
      { ...status, source: { path: "private" } },
      { ...status, status: "completed", attemptCount: 0 },
      { ...status, status: "no_changes" },
    ]) {
      await assert.rejects(
        jobs[method](clients(f, { response }).service, f.scope, result.jobId),
        generic,
      );
    }
  }
});
test("claim validates stored attestation and source against exact fresh payload and pinned image", async () => {
  const f = edited();
  const attestation = await build(f.scope, f.payload, imageId);
  const claim = {
    jobId: result.jobId,
    attemptNumber: 1,
    leaseToken: uuid(93),
    leaseExpiresAt: "2026-09-06T12:00:00.000Z",
    actorId: uuid(80),
    scope: f.scope,
    source: {
      ...f.payload.analysis.result.receipt.source,
      bucket: "lukas-qto",
      path: "owned/source.dwg",
    },
    attestation,
    payload: f.payload,
  };
  assert.deepEqual(
    jobs.parseNativeDrawingDwgResaveClaim(claim, imageId),
    claim,
  );
  for (const mutate of [
    (c) => (c.source.sha256 = "d".repeat(64)),
    (c) => (c.scope.revisionId = uuid(94)),
    (c) => (c.attestation.authority.sha256 = "d".repeat(64)),
    (c) => (c.payload.analysis.result.receipt.jobId = uuid(95)),
    (c) => (c.extra = true),
  ]) {
    const corrupted = structuredClone(claim);
    mutate(corrupted);
    assert.throws(
      () => jobs.parseNativeDrawingDwgResaveClaim(corrupted, imageId),
      generic,
    );
  }
  assert.throws(
    () =>
      jobs.parseNativeDrawingDwgResaveClaim(claim, "sha256:" + "d".repeat(64)),
    generic,
  );
});
