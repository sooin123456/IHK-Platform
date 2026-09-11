import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import test from "node:test";

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

const { buildNativeDrawingDwgResaveAttestation: buildAttestation } =
  await vite.ssrLoadModule(
    "/app/lukas/lib/drawing-native-dwg-resave-attestation.server.ts",
  );
const publicationModule = await vite
  .ssrLoadModule(
    "/app/lukas/lib/drawing-native-dwg-resave-publication.server.ts",
  )
  .catch(() => ({}));
const workerModule = await vite.ssrLoadModule(
  "/app/lukas/lib/drawing-native-dwg-resave-worker.server.ts",
);
const { NativeDwgConfirmedUploadError } = await vite.ssrLoadModule(
  "/native-dwg-worker/src/supabase.ts",
);

function api() {
  for (const name of [
    "publishNativeDrawingDwgResaveArtifacts",
    "runNativeDrawingDwgResaveToStorage",
  ])
    assert.equal(
      typeof publicationModule[name],
      "function",
      `Required publication API absent: ${name}`,
    );
  for (const name of [
    "callNativeDrawingDwgResaveAttemptRpc",
    "readNativeDrawingDwgResaveAttemptControl",
    "NativeDrawingDwgResaveStaleLease",
  ])
    assert.ok(workerModule[name], `Required worker helper absent: ${name}`);
  return publicationModule;
}

const deferred = () => Promise.withResolvers();
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const rpcNames = {
  lukas_drawing_native_dwg_resave_control: "control",
  lukas_drawing_stage_native_dwg_resave: "stage",
  lukas_drawing_close_native_dwg_resave_upload: "close",
  lukas_drawing_publish_native_dwg_resave: "publish",
  lukas_drawing_ack_native_dwg_resave_cancel: "ack",
  lukas_drawing_fail_native_dwg_resave: "fail",
};
const filenames = {
  dwg: "resaved.dwg",
  edit_request: "edit-request.json",
  authority: "authority.json",
  report: "native-report.json",
};

async function setup() {
  const fixture = await resaveArtifactFixture(buildAttestation);
  const bytesByKind = {
    dwg: Buffer.from(fixture.result.dwgBytes),
    edit_request: Buffer.from(fixture.claim.attestation.request.text, "utf8"),
    authority: Buffer.from(fixture.claim.attestation.authority.text, "utf8"),
    report: Buffer.from(fixture.result.reportBytes),
  };
  const metadata = ["dwg", "edit_request", "authority", "report"].map(
    (kind) => ({
      kind,
      sha256: sha256(bytesByKind[kind]),
      byteSize: bytesByKind[kind].byteLength,
    }),
  );
  const identity = {
    jobId: fixture.claim.jobId,
    attemptNumber: fixture.claim.attemptNumber,
    leaseToken: fixture.claim.leaseToken,
  };
  const stagedArtifacts = metadata.map((item) => ({
    ...item,
    path: `projects/${fixture.claim.scope.projectId}/native-dwg-resave/${fixture.claim.jobId}/${fixture.claim.attemptNumber}/${item.sha256}/${filenames[item.kind]}`,
  }));
  const state = {
    stageState: "open",
    controlCount: 0,
    handlers: {},
    stored: new Map(),
  };
  const calls = [];
  const receipt = {
    schemaVersion: "1hk-dwg-resave-receipt/1",
    jobId: fixture.claim.jobId,
    attemptNumber: fixture.claim.attemptNumber,
    scope: fixture.claim.scope,
    resaverImageId: fixture.imageId,
    sourceSha256: fixture.claim.source.sha256,
    qualification: "experimental-unqualified",
    persistenceAuthority: "not-issued",
    artifacts: metadata,
    createdAt: "2026-09-06T00:00:00.000Z",
  };
  const defaultRpc = async (name, args) => {
    if (name === "control") {
      state.controlCount += 1;
      return {
        data: { ...identity, action: "continue", reason: null },
        error: null,
      };
    }
    if (name === "stage")
      return {
        data: {
          ...identity,
          uploadState: state.stageState,
          artifacts: stagedArtifacts,
        },
        error: null,
      };
    if (name === "close")
      return {
        data: { ...identity, uploadState: "closed" },
        error: null,
      };
    if (name === "publish") return { data: receipt, error: null };
    if (name === "ack")
      return { data: { ...identity, status: "cancelled" }, error: null };
    assert.equal(name, "fail");
    return {
      data: {
        ...identity,
        status: args.p_retryable ? "retry_wait" : "failed",
      },
      error: null,
    };
  };
  const serviceClient = {
    rpc(rawName, args) {
      const name = rpcNames[rawName];
      assert.ok(name, `Unexpected RPC ${rawName}`);
      return {
        async abortSignal(signal) {
          assert.equal(signal.aborted, false);
          calls.push({ name, args, signal });
          return state.handlers[name]
            ? state.handlers[name](args, signal, state.controlCount)
            : defaultRpc(name, args);
        },
      };
    },
  };
  const storage = {
    async upload(input) {
      calls.push({ name: `upload:${input.kind}`, input });
      if (state.handlers.upload)
        return state.handlers.upload(input, state.stored);
      state.stored.set(input.path, Buffer.from(input.bytes));
      return "uploaded";
    },
    async read(input) {
      calls.push({ name: `read:${input.kind}`, input });
      if (state.handlers.read) return state.handlers.read(input, state.stored);
      const bytes = state.stored.get(input.path);
      assert.ok(bytes, `No stored bytes for ${input.kind}`);
      return Buffer.from(bytes);
    },
  };
  const prepared = {
    outcome: "prepared",
    claim: fixture.claim,
    result: fixture.result,
  };
  const options = {
    prepared,
    serviceClient,
    storage,
    imageId: fixture.imageId,
  };
  return {
    fixture,
    bytesByKind,
    metadata,
    identity,
    stagedArtifacts,
    receipt,
    state,
    calls,
    serviceClient,
    storage,
    prepared,
    options,
    sequence: () => calls.map(({ name }) => name),
  };
}

test("publishes four artifacts in the literal stage/upload/read/close/control order", async () => {
  const h = await setup();
  const result = await api().publishNativeDrawingDwgResaveArtifacts(h.options);
  assert.deepEqual(result, { outcome: "completed", receipt: h.receipt });
  assert.deepEqual(h.sequence(), [
    "control",
    "stage",
    "upload:dwg",
    "read:dwg",
    "upload:edit_request",
    "read:edit_request",
    "upload:authority",
    "read:authority",
    "upload:report",
    "read:report",
    "close",
    "control",
    "publish",
  ]);
  assert.deepEqual(h.calls[1].args, {
    p_job_id: h.identity.jobId,
    p_attempt_number: 2,
    p_lease_token: h.identity.leaseToken,
    p_artifacts: h.metadata,
  });
  for (const [index, kind] of [
    "dwg",
    "edit_request",
    "authority",
    "report",
  ].entries()) {
    const upload = h.calls[2 + index * 2].input;
    assert.deepEqual(
      {
        kind: upload.kind,
        path: upload.path,
        bytes: Buffer.from(upload.bytes),
      },
      {
        kind,
        path: h.stagedArtifacts[index].path,
        bytes: h.bytesByKind[kind],
      },
    );
  }
});

test("a parent abort already in force performs no publication side effect and settles interruption", async () => {
  const h = await setup();
  const parent = new AbortController();
  parent.abort();
  const result = await api().publishNativeDrawingDwgResaveArtifacts({
    ...h.options,
    signal: parent.signal,
  });
  assert.equal(result.outcome, "retry_scheduled");
  assert.deepEqual(h.sequence(), ["control", "fail"]);
  assert.equal(h.calls[1].args.p_failure_code, "worker_interrupted");
  assert.equal(h.calls[1].args.p_retryable, true);
});

test(
  "a late cancellation waits for an abort-ignoring POST, closes, then acknowledges",
  { timeout: 10_000 },
  async () => {
    const h = await setup();
    const postStarted = deferred();
    const postSettled = deferred();
    const cancellationObserved = deferred();
    const uploadAborted = deferred();
    h.state.handlers.upload = async (input, stored) => {
      assert.equal(input.kind, "dwg");
      input.signal.addEventListener("abort", uploadAborted.resolve, {
        once: true,
      });
      postStarted.resolve(input.signal);
      const value = await postSettled.promise;
      stored.set(input.path, Buffer.from(input.bytes));
      return value;
    };
    h.state.handlers.control = async (_args, _signal, priorCount) => {
      h.state.controlCount += 1;
      if (priorCount === 1) {
        cancellationObserved.resolve();
        return {
          data: {
            ...h.identity,
            action: "cancel",
            reason: "cancel_requested",
          },
          error: null,
        };
      }
      return {
        data: { ...h.identity, action: "continue", reason: null },
        error: null,
      };
    };
    const pending = api().publishNativeDrawingDwgResaveArtifacts(h.options);
    const uploadSignal = await postStarted.promise;
    await cancellationObserved.promise;
    await uploadAborted.promise;
    assert.equal(uploadSignal.aborted, true);
    assert.equal(h.sequence().includes("close"), false);
    assert.equal(h.sequence().includes("ack"), false);
    postSettled.resolve("uploaded");
    assert.equal((await pending).outcome, "cancelled");
    assert.deepEqual(h.sequence(), [
      "control",
      "stage",
      "upload:dwg",
      "control",
      "close",
      "ack",
    ]);
  },
);

test("snapshots prepared buffers and bound dependencies before its first await", async () => {
  const h = await setup();
  const expectedDwg = Buffer.from(h.prepared.result.dwgBytes);
  const pending = api().publishNativeDrawingDwgResaveArtifacts(h.options);
  h.prepared.result.dwgBytes.fill(0);
  h.prepared.result.reportBytes.fill(0);
  h.prepared.result.report.output.sha256 = "0".repeat(64);
  h.options.imageId = `sha256:${"d".repeat(64)}`;
  h.options.serviceClient = { rpc: assert.fail };
  h.storage.upload = assert.fail;
  h.storage.read = assert.fail;
  assert.equal((await pending).outcome, "completed");
  assert.deepEqual(
    Buffer.from(h.calls.find((call) => call.name === "upload:dwg").input.bytes),
    expectedDwg,
  );
});

test("a closed stage replay performs readback without any POST", async () => {
  const h = await setup();
  h.state.stageState = "closed";
  for (const artifact of h.stagedArtifacts)
    h.state.stored.set(artifact.path, h.bytesByKind[artifact.kind]);
  assert.equal(
    (await api().publishNativeDrawingDwgResaveArtifacts(h.options)).outcome,
    "completed",
  );
  assert.deepEqual(h.sequence(), [
    "control",
    "stage",
    "read:dwg",
    "read:edit_request",
    "read:authority",
    "read:report",
    "control",
    "publish",
  ]);
});

test("corrupt readback closes and settles terminal output_invalid", async () => {
  const h = await setup();
  h.state.handlers.read = async () => Buffer.from("corrupt");
  const result = await api().publishNativeDrawingDwgResaveArtifacts(h.options);
  assert.equal(result.outcome, "failed");
  assert.deepEqual(h.sequence(), [
    "control",
    "stage",
    "upload:dwg",
    "read:dwg",
    "close",
    "control",
    "fail",
  ]);
  assert.equal(h.calls.at(-1).args.p_failure_code, "output_invalid");
  assert.equal(h.calls.at(-1).args.p_retryable, false);
});

test("a typed definite upload rejection closes before retryable upload failure", async () => {
  const h = await setup();
  h.state.handlers.upload = async () => {
    throw new NativeDwgConfirmedUploadError();
  };
  const result = await api().publishNativeDrawingDwgResaveArtifacts(h.options);
  assert.equal(result.outcome, "retry_scheduled");
  assert.deepEqual(h.sequence(), [
    "control",
    "stage",
    "upload:dwg",
    "close",
    "control",
    "fail",
  ]);
  assert.equal(h.calls.at(-1).args.p_failure_code, "upload_failed");
  assert.equal(h.calls.at(-1).args.p_retryable, true);
});

test("an untyped upload rejection remains uncertain with no close or settlement", async () => {
  const h = await setup();
  h.state.handlers.upload = async () => {
    throw new Error("unknown POST completion");
  };
  assert.deepEqual(
    await api().publishNativeDrawingDwgResaveArtifacts(h.options),
    { outcome: "settlement_uncertain" },
  );
  assert.deepEqual(h.sequence(), ["control", "stage", "upload:dwg"]);
});

test("a lost stage reply attempts exact close before publication failure settlement", async () => {
  const h = await setup();
  h.state.handlers.stage = async () => {
    throw new Error("reply lost after stage commit");
  };
  const result = await api().publishNativeDrawingDwgResaveArtifacts(h.options);
  assert.equal(result.outcome, "retry_scheduled");
  assert.deepEqual(h.sequence(), [
    "control",
    "stage",
    "close",
    "control",
    "fail",
  ]);
  assert.equal(h.calls.at(-1).args.p_failure_code, "publication_failed");
});

test("unconfirmed closure after a lost stage reply stays settlement_uncertain", async () => {
  const h = await setup();
  h.state.handlers.stage = async () => {
    throw new Error("stage reply lost");
  };
  h.state.handlers.close = async () => ({
    data: null,
    error: { code: "PNR13" },
  });
  assert.deepEqual(
    await api().publishNativeDrawingDwgResaveArtifacts(h.options),
    { outcome: "settlement_uncertain" },
  );
  assert.deepEqual(h.sequence(), ["control", "stage", "close"]);
});

test("a lost close reply stays settlement_uncertain without fail, ack or publish", async () => {
  const h = await setup();
  h.state.handlers.close = async () => {
    throw new Error("close reply lost");
  };
  assert.deepEqual(
    await api().publishNativeDrawingDwgResaveArtifacts(h.options),
    { outcome: "settlement_uncertain" },
  );
  assert.equal(h.sequence().at(-1), "close");
  assert.equal(h.sequence().includes("fail"), false);
  assert.equal(h.sequence().includes("ack"), false);
  assert.equal(h.sequence().includes("publish"), false);
});

test("a lost publish reply replays once with the exact same identity", async () => {
  const h = await setup();
  let publishes = 0;
  h.state.handlers.publish = async () => {
    if (++publishes === 1) throw new Error("publish reply lost");
    return { data: h.receipt, error: null };
  };
  assert.equal(
    (await api().publishNativeDrawingDwgResaveArtifacts(h.options)).outcome,
    "completed",
  );
  const calls = h.calls.filter(({ name }) => name === "publish");
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0].args, calls[1].args);
  assert.deepEqual(calls[0].args, {
    p_job_id: h.identity.jobId,
    p_attempt_number: 2,
    p_lease_token: h.identity.leaseToken,
  });
});

test("two unknown publish replies return publication_uncertain without failure admission", async () => {
  const h = await setup();
  h.state.handlers.publish = async () => {
    throw new Error("publish reply lost");
  };
  assert.deepEqual(
    await api().publishNativeDrawingDwgResaveArtifacts(h.options),
    { outcome: "publication_uncertain" },
  );
  assert.equal(h.calls.filter(({ name }) => name === "publish").length, 2);
  assert.equal(h.sequence().includes("fail"), false);
});

test("final control cancellation after closure wins before publication", async () => {
  const h = await setup();
  h.state.handlers.control = async (_args, _signal, priorCount) => {
    h.state.controlCount += 1;
    return {
      data: {
        ...h.identity,
        action: priorCount === 1 ? "cancel" : "continue",
        reason: priorCount === 1 ? "cancel_requested" : null,
      },
      error: null,
    };
  };
  assert.deepEqual(
    await api().publishNativeDrawingDwgResaveArtifacts(h.options),
    { outcome: "cancelled" },
  );
  assert.deepEqual(h.sequence().slice(-3), ["close", "control", "ack"]);
  assert.equal(h.sequence().includes("publish"), false);
});

test("storage wrapper runs the accepted native attempt once before publication", async () => {
  const h = await setup();
  let nativeCalls = 0;
  const result = await api().runNativeDrawingDwgResaveToStorage({
    claim: h.fixture.claim,
    serviceClient: h.serviceClient,
    async downloadSource({ source, signal }) {
      assert.deepEqual(source, h.fixture.claim.source);
      assert.equal(signal.aborted, false);
      return h.fixture.sourceBytes;
    },
    async resave() {
      nativeCalls += 1;
      return h.fixture.result;
    },
    dockerPath: "/owned/docker",
    dockerHost: "unix:///owned/socket",
    imageId: h.fixture.imageId,
    storage: h.storage,
  });
  assert.equal(result.outcome, "completed");
  assert.equal(nativeCalls, 1);
  assert.equal(
    h.sequence().filter((name) => name.startsWith("upload:")).length,
    4,
  );
});

test("nonprepared native outcome passes through and never touches Storage", async () => {
  const h = await setup();
  h.state.handlers.control = async () => {
    h.state.controlCount += 1;
    return {
      data: {
        ...h.identity,
        action: "cancel",
        reason: "cancel_requested",
      },
      error: null,
    };
  };
  const result = await api().runNativeDrawingDwgResaveToStorage({
    claim: h.fixture.claim,
    serviceClient: h.serviceClient,
    downloadSource: async () => assert.fail("must not download"),
    resave: async () => assert.fail("must not execute native"),
    dockerPath: "/owned/docker",
    dockerHost: "unix:///owned/socket",
    imageId: h.fixture.imageId,
    storage: h.storage,
  });
  assert.deepEqual(result, { outcome: "cancelled" });
  assert.deepEqual(h.sequence(), ["control", "ack"]);
});

test("success handoff detaches shutdown before its queued microtask can be observed", async () => {
  const h = await setup();
  const parent = new AbortController();
  const events = [];
  const queueAbort = (remaining) =>
    queueMicrotask(() =>
      remaining === 0 ? parent.abort() : queueAbort(remaining - 1),
    );
  parent.signal.addEventListener("abort", () => events.push("abort"));
  const signal = {
    get aborted() {
      return parent.signal.aborted;
    },
    addEventListener(...args) {
      return parent.signal.addEventListener(...args);
    },
    removeEventListener(...args) {
      events.push("detached");
      return parent.signal.removeEventListener(...args);
    },
  };
  h.state.handlers.control = async (_args, _signal, priorCount) => {
    h.state.controlCount += 1;
    if (priorCount === 1) queueAbort(8);
    return {
      data: { ...h.identity, action: "continue", reason: null },
      error: null,
    };
  };
  h.state.handlers.publish = async () => {
    events.push("publish");
    return { data: h.receipt, error: null };
  };
  const result = await api().publishNativeDrawingDwgResaveArtifacts({
    ...h.options,
    signal,
  });
  assert.equal(result.outcome, "completed");
  assert.ok(parent.signal.aborted);
  assert.ok(
    events.indexOf("detached") < events.indexOf("abort"),
    JSON.stringify(events),
  );
  assert.ok(
    events.indexOf("abort") < events.indexOf("publish"),
    JSON.stringify(events),
  );
});
