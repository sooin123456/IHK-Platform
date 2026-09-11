import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { test } from "node:test";

import {
  NATIVE_DWG_WORKER_LIMITS,
  calculateNativeDwgWriterBuildSha256,
  runNativeDrawingDwgWorkerOnce,
  runNativeDrawingDwgWriter,
} from "../app/lukas/lib/drawing-native-dwg-worker.server.ts";

const evidenceDirectory = new URL(
  "../../docs/superpowers/evidence/2026-09-06-approved-native-dwg-source/",
  import.meta.url,
);
const request = JSON.parse(
  await readFile(new URL("request.json", evidenceDirectory), "utf8"),
);
const sourcePayload = JSON.parse(
  await readFile(new URL("source-payload.json", evidenceDirectory), "utf8"),
);
const writerArtifacts = {
  dwg: await readFile(new URL("writer/native.dwg", evidenceDirectory)),
  source_manifest: await readFile(
    new URL("writer/source-manifest.json", evidenceDirectory),
  ),
  report: await readFile(
    new URL("writer/native-report.json", evidenceDirectory),
  ),
};
const authorityBytes = await readFile(
  new URL("authority.json", evidenceDirectory),
);

const ids = {
  job: "81000000-0000-4000-8000-000000000001",
  lease: "81000000-0000-4000-8000-000000000002",
};
const writerBuildSha256 = "b".repeat(64);
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const artifactHashes = {
  dwg: "a9a14bcd0f8a505eae4e09d53ef18b5a08515c4542a25fed0f57b4a8d3a040d5",
  source_manifest:
    "56bbd9685cc66a94307c3f2f3daa0b931bc526db4d43c2656d5fe1437789b8f9",
  authority: "ab1235c72ec61946c9c8c71b66ac2059fc9813201c66c50370fb3926d34a9cd3",
  report: "bc9f4530c4c480179f7dddd7004ec3bc7eaf1fe114c851ccb6cbe1887d40cc5f",
};
const fileNames = {
  dwg: "native.dwg",
  source_manifest: "source-manifest.json",
  authority: "authority.json",
  report: "native-report.json",
};

function completedHarness(overrides = {}) {
  const events = [];
  const stored = new Map();
  const claim = {
    jobId: ids.job,
    projectId: request.projectId,
    attempt: 1,
    leaseToken: ids.lease,
    leaseExpiresAt: "2099-01-01T00:00:00.000Z",
    writerBuildSha256,
    source: {
      request: structuredClone(request),
      payload: structuredClone(sourcePayload),
    },
  };
  let metadata;
  const dependencies = {
    async claim() {
      events.push("claim");
      return claim;
    },
    async convert() {
      events.push("convert");
      return structuredClone(writerArtifacts);
    },
    async stage(input) {
      events.push("stage");
      metadata = input.artifacts;
      return input.artifacts.map((artifact) => ({
        ...artifact,
        path: `projects/${claim.projectId}/native-dwg/${claim.jobId}/${claim.attempt}/${artifact.sha256}/${fileNames[artifact.kind]}`,
      }));
    },
    async upload({ kind, path, bytes }) {
      events.push(`upload:${kind}`);
      stored.set(path, Buffer.from(bytes));
      return "uploaded";
    },
    async read({ kind, path }) {
      events.push(`read:${kind}`);
      const bytes = stored.get(path);
      if (!bytes) throw new Error("missing");
      return bytes;
    },
    async settle() {
      events.push("settle");
      return "closed";
    },
    async publish() {
      events.push("publish");
      return {
        jobId: claim.jobId,
        attempt: claim.attempt,
        qualification: "experimental-unqualified",
        source: claim.source.request,
        writerBuildSha256: claim.writerBuildSha256,
        structureSha256:
          "ffa54a46fcdc82a6bbb61db4938f3545119bb48e2031c765872ba5624fcf7f4a",
        artifacts: metadata,
        createdAt: "2026-09-06T00:00:00.000Z",
      };
    },
    async fail(input) {
      events.push(`fail:${input.errorCode}`);
      return input.retryable ? "retry_wait" : "failed";
    },
    ...overrides,
  };
  return { claim, dependencies, events, stored };
}

test("approved source stages all four verified identities before immutable upload and publication", async () => {
  const events = [];
  const staged = [];
  const stored = new Map();
  const sourceBefore = JSON.stringify(sourcePayload);
  const claim = {
    jobId: ids.job,
    projectId: request.projectId,
    attempt: 1,
    leaseToken: ids.lease,
    leaseExpiresAt: "2099-01-01T00:00:00.000Z",
    writerBuildSha256,
    source: { request, payload: sourcePayload },
  };
  const dependencies = {
    async claim() {
      events.push("claim");
      return claim;
    },
    async convert({ manifestBytes, expectedWriterBuildSha256 }) {
      events.push("convert");
      assert.deepEqual(manifestBytes, writerArtifacts.source_manifest);
      assert.equal(expectedWriterBuildSha256, writerBuildSha256);
      return writerArtifacts;
    },
    async stage(input) {
      events.push("stage");
      staged.push(input);
      return input.artifacts.map((artifact) => ({
        ...artifact,
        path: `projects/${request.projectId}/native-dwg/${ids.job}/1/${artifact.sha256}/${fileNames[artifact.kind]}`,
      }));
    },
    async upload({ kind, path, bytes }) {
      events.push(`upload:${kind}`);
      assert.equal(staged.length, 1);
      stored.set(path, Buffer.from(bytes));
      return "uploaded";
    },
    async read({ kind, path }) {
      events.push(`read:${kind}`);
      return stored.get(path);
    },
    async settle() {
      events.push("settle");
      return "closed";
    },
    async publish() {
      events.push("publish");
      return {
        jobId: ids.job,
        attempt: 1,
        qualification: "experimental-unqualified",
        source: request,
        writerBuildSha256,
        structureSha256:
          "ffa54a46fcdc82a6bbb61db4938f3545119bb48e2031c765872ba5624fcf7f4a",
        artifacts: staged[0].artifacts,
        createdAt: "2026-09-06T00:00:00.000Z",
      };
    },
    async fail() {
      assert.fail("completed work must not be failed");
    },
  };

  const outcome = await runNativeDrawingDwgWorkerOnce(dependencies);

  assert.equal(outcome, "completed");
  assert.deepEqual(events, [
    "claim",
    "convert",
    "stage",
    "upload:dwg",
    "read:dwg",
    "upload:source_manifest",
    "read:source_manifest",
    "upload:authority",
    "read:authority",
    "upload:report",
    "read:report",
    "settle",
    "publish",
  ]);
  assert.deepEqual(
    staged[0].artifacts,
    ["dwg", "source_manifest", "authority", "report"].map((kind) => ({
      kind,
      sha256: artifactHashes[kind],
      byteSize:
        kind === "authority"
          ? authorityBytes.byteLength
          : writerArtifacts[kind].byteLength,
    })),
  );
  assert.equal(JSON.stringify(sourcePayload), sourceBefore);
  assert.equal(sha256(authorityBytes), artifactHashes.authority);
});

test("worker stays idle when no durable job is claimable", async () => {
  const { dependencies, events } = completedHarness({
    async claim() {
      events.push("claim");
      return null;
    },
  });
  assert.equal(await runNativeDrawingDwgWorkerOnce(dependencies), "idle");
  assert.deepEqual(events, ["claim"]);
});

test("tampered approved source is terminal before conversion or staging", async () => {
  const { claim, dependencies, events } = completedHarness();
  claim.source.payload.snapshot.canonicalJsonText += " ";
  assert.equal(await runNativeDrawingDwgWorkerOnce(dependencies), "failed");
  assert.deepEqual(events, ["claim", "fail:source_unavailable"]);
});

test("writer artifact and report tampering is terminal before staging", async () => {
  const cases = [
    { name: "DWG header", mutate: (value) => (value.dwg[0] = 0) },
    {
      name: "source bytes",
      mutate: (value) => (value.source_manifest[0] ^= 1),
    },
    {
      name: "reported output hash",
      mutate(value) {
        const report = JSON.parse(Buffer.from(value.report).toString("utf8"));
        report.outputs.dwg.sha256 = "0".repeat(64);
        value.report = Buffer.from(`${JSON.stringify(report)}\n`);
      },
    },
    {
      name: "internal comparison",
      mutate(value) {
        const report = JSON.parse(Buffer.from(value.report).toString("utf8"));
        report.verification.failures = ["geometry mismatch"];
        value.report = Buffer.from(`${JSON.stringify(report)}\n`);
      },
    },
  ];
  for (const item of cases) {
    const { dependencies, events } = completedHarness({
      async convert() {
        events.push("convert");
        const value = structuredClone(writerArtifacts);
        item.mutate(value);
        return value;
      },
    });
    assert.equal(
      await runNativeDrawingDwgWorkerOnce(dependencies),
      "failed",
      item.name,
    );
    assert.deepEqual(
      events,
      ["claim", "convert", "fail:verification_failed"],
      item.name,
    );
  }
});

test("forged database path stops all storage writes", async () => {
  const { dependencies, events } = completedHarness({
    async stage(input) {
      events.push("stage");
      return input.artifacts.map((artifact, index) => ({
        ...artifact,
        path:
          index === 0
            ? "projects/foreign/native-dwg/forged/native.dwg"
            : `projects/${request.projectId}/native-dwg/${ids.job}/1/${artifact.sha256}/${fileNames[artifact.kind]}`,
      }));
    },
  });
  assert.equal(await runNativeDrawingDwgWorkerOnce(dependencies), "failed");
  assert.deepEqual(events, [
    "claim",
    "convert",
    "stage",
    "fail:publication_failed",
  ]);
});

test("uncertain upload remains open even if the object becomes readable", async () => {
  const { dependencies, events, stored } = completedHarness({
    async upload({ kind, path, bytes }) {
      events.push(`upload:${kind}`);
      stored.set(path, Buffer.from(bytes));
      if (kind === "dwg") throw new Error("lost response with private URL");
    },
  });
  assert.equal(
    await runNativeDrawingDwgWorkerOnce(dependencies),
    "retry_scheduled",
  );
  assert.equal(events.includes("settle"), false);
  assert.equal(events.includes("publish"), false);
  assert.equal(events.at(-1), "fail:upload_failed");
});

test("confirmed duplicate upload reconciles through exact readback", async () => {
  const { dependencies, events, stored } = completedHarness({
    async upload({ kind, path, bytes }) {
      events.push(`upload:${kind}`);
      stored.set(path, Buffer.from(bytes));
      return kind === "dwg" ? "exists" : "uploaded";
    },
  });
  assert.equal(await runNativeDrawingDwgWorkerOnce(dependencies), "completed");
  assert.equal(events.at(-2), "settle");
  assert.equal(events.at(-1), "publish");
});

test("uncertain or mismatching storage leaves the upload session open", async () => {
  for (const mode of ["uncertain", "mismatch"]) {
    const harness = completedHarness();
    harness.dependencies.upload = async ({ kind }) => {
      harness.events.push(`upload:${kind}`);
      throw new Error("transport stopped locally");
    };
    harness.dependencies.read = async ({ kind }) => {
      harness.events.push(`read:${kind}`);
      if (mode === "uncertain") throw new Error("remote state unknown");
      return new Uint8Array([1]);
    };
    assert.equal(
      await runNativeDrawingDwgWorkerOnce(harness.dependencies),
      "retry_scheduled",
      mode,
    );
    assert.equal(harness.events.includes("settle"), false, mode);
    assert.equal(harness.events.includes("publish"), false, mode);
    assert.equal(harness.events.at(-1), "fail:upload_failed", mode);
  }
});

test("post-read deadline exhaustion cannot settle or publish", async () => {
  let clock = 0;
  const harness = completedHarness();
  const originalRead = harness.dependencies.read;
  harness.dependencies.read = async (input) => {
    const result = await originalRead(input);
    clock = NATIVE_DWG_WORKER_LIMITS.attemptMilliseconds;
    return result;
  };
  assert.equal(
    await runNativeDrawingDwgWorkerOnce(harness.dependencies, {
      now: () => clock,
    }),
    "retry_scheduled",
  );
  assert.equal(harness.events.includes("settle"), false);
  assert.equal(harness.events.includes("publish"), false);
  assert.equal(harness.events.at(-1), "fail:budget_exceeded");
});

test("expired claims fail with the fixed lease classification", async () => {
  const { claim, dependencies, events } = completedHarness();
  claim.leaseExpiresAt = "2000-01-01T00:00:00.000Z";
  assert.equal(await runNativeDrawingDwgWorkerOnce(dependencies), "failed");
  assert.deepEqual(events, ["claim", "fail:lease_expired"]);
});

test("writer hashes ordered published bytes, uses a killed bounded process, and confines cleanup", async () => {
  const publishedDirectory = "/srv/native-writer";
  const dotnetPath = "/opt/dotnet";
  const root = "/tmp/1hk-native-dwg-fixed";
  const published = new Map([
    ["ACadSharp.dll", Buffer.from("engine")],
    ["DwgEngineQualification.dll", Buffer.from("writer")],
    ["DwgEngineQualification.runtimeconfig.json", Buffer.from("runtime")],
  ]);
  const calls = [];
  const runtime = {
    async mkdtemp(prefix) {
      calls.push(["mkdtemp", prefix]);
      return root;
    },
    async writeFile(path, bytes, options) {
      calls.push(["writeFile", path, Buffer.from(bytes), options]);
    },
    async execFile(binary, arguments_, options) {
      calls.push(["execFile", binary, arguments_, options]);
    },
    async readFile(path) {
      if (path.startsWith(`${publishedDirectory}/`))
        return published.get(path.slice(publishedDirectory.length + 1));
      if (path.endsWith("native.dwg")) return writerArtifacts.dwg;
      if (path.endsWith("source-manifest.json"))
        return writerArtifacts.source_manifest;
      if (path.endsWith("native-report.json")) return writerArtifacts.report;
      throw new Error("unexpected read");
    },
    async readdir(path) {
      if (path === publishedDirectory) return [...published.keys()].reverse();
      return ["source-manifest.json", "native.dwg", "native-report.json"];
    },
    async lstat(path) {
      const directory =
        path === publishedDirectory ||
        path === "/tmp" ||
        path === root ||
        path === `${root}/output`;
      const dotnetLink = path === dotnetPath;
      return {
        size: 1024,
        isDirectory: () => directory,
        isFile: () => !directory && !dotnetLink,
        isSymbolicLink: () => dotnetLink,
      };
    },
    async realpath(path) {
      return path === dotnetPath ? "/opt/dotnet-8-real" : path;
    },
    async rm(path, options) {
      calls.push(["rm", path, options]);
    },
    tmpdir() {
      return "/tmp";
    },
  };
  const expectedWriterBuildSha256 = await calculateNativeDwgWriterBuildSha256(
    publishedDirectory,
    runtime,
  );
  const output = await runNativeDrawingDwgWriter(
    {
      dotnetPath,
      publishedDirectory,
      manifestBytes: writerArtifacts.source_manifest,
      expectedWriterBuildSha256,
    },
    runtime,
  );
  assert.deepEqual(output, writerArtifacts);
  assert.deepEqual(calls[1].slice(0, 2), [
    "writeFile",
    `${root}/native.cad.json`,
  ]);
  assert.deepEqual(calls[1][3], { flag: "wx", mode: 0o600 });
  assert.equal(calls[2][0], "execFile");
  assert.equal(calls[2][1], dotnetPath);
  assert.deepEqual(calls[2][2], [
    `${publishedDirectory}/DwgEngineQualification.dll`,
    "write-native",
    "--input",
    `${root}/native.cad.json`,
    "--output-dir",
    `${root}/output`,
  ]);
  assert.equal(calls[2][3].shell, false);
  assert.equal(calls[2][3].timeout, 120_000);
  assert.equal(calls[2][3].killSignal, "SIGKILL");
  assert.equal(calls[2][3].maxBuffer, 64 * 1024);
  assert.deepEqual(calls.at(-1), [
    "rm",
    root,
    { recursive: true, force: true },
  ]);
});

test("writer refuses symlinked builds and never cleans an unconfined path", async () => {
  let removed = false;
  const runtime = {
    async mkdtemp() {
      return "/outside/1hk-native-dwg-escape";
    },
    async writeFile() {},
    async execFile() {},
    async readFile() {
      return Buffer.from("writer");
    },
    async readdir() {
      return ["DwgEngineQualification.dll"];
    },
    async lstat(path) {
      return {
        isDirectory: () => path === "/srv/native-writer",
        isFile: () => path !== "/srv/native-writer",
        isSymbolicLink: () => false,
      };
    },
    async realpath(path) {
      return path;
    },
    async rm() {
      removed = true;
    },
    tmpdir() {
      return "/tmp";
    },
  };
  const build = await calculateNativeDwgWriterBuildSha256(
    "/srv/native-writer",
    runtime,
  );
  await assert.rejects(
    runNativeDrawingDwgWriter(
      {
        dotnetPath: "/opt/dotnet",
        publishedDirectory: "/srv/native-writer",
        manifestBytes: writerArtifacts.source_manifest,
        expectedWriterBuildSha256: build,
      },
      runtime,
    ),
    /^Error: Native DWG conversion failed\.$/,
  );
  assert.equal(removed, false);

  runtime.lstat = async (path) => ({
    isDirectory: () => path === "/srv/native-writer",
    isFile: () => path !== "/srv/native-writer",
    isSymbolicLink: () => path.endsWith(".dll"),
  });
  await assert.rejects(
    calculateNativeDwgWriterBuildSha256("/srv/native-writer", runtime),
    /configuration is invalid/,
  );
});

test("Supabase adapter maps exact RPC arguments and rejects malformed DTOs", async () => {
  const { createSupabaseNativeDwgWorkerDependencies } = await import(
    "../native-dwg-worker/src/supabase.ts"
  );
  const rpcCalls = [];
  const client = {
    rpc(name, args) {
      return {
        abortSignal(signal) {
          rpcCalls.push([name, args, signal]);
          return Promise.resolve(
            name === "lukas_drawing_claim_native_dwg_export"
              ? { data: completedHarness().claim, error: null }
              : { data: "closed", error: null },
          );
        },
      };
    },
  };
  const dependencies = createSupabaseNativeDwgWorkerDependencies(client, {
    supabaseUrl: "http://127.0.0.1:54321",
    serviceRoleKey: "service-secret",
    dotnetPath: "/opt/dotnet",
    publishedDirectory: "/srv/native-writer",
    writerBuildSha256,
    leaseSeconds: 900,
  });
  const signal = new AbortController().signal;
  assert.deepEqual(
    await dependencies.claim({ signal }),
    completedHarness().claim,
  );
  assert.deepEqual(rpcCalls[0], [
    "lukas_drawing_claim_native_dwg_export",
    { p_writer_build_sha256: writerBuildSha256, p_lease_seconds: 900 },
    signal,
  ]);
  client.rpc = () => ({
    abortSignal() {
      return Promise.resolve({ data: { extra: true }, error: null });
    },
  });
  await assert.rejects(dependencies.claim({ signal }), /claim failed/);
});

test("Supabase lifecycle RPC builders receive the operation AbortSignal", async () => {
  const { createSupabaseNativeDwgWorkerDependencies } = await import(
    "../native-dwg-worker/src/supabase.ts"
  );
  const signals = [];
  const client = {
    rpc(name) {
      return {
        abortSignal(signal) {
          signals.push([name, signal]);
          return Promise.resolve({
            data: completedHarness().claim,
            error: null,
          });
        },
      };
    },
  };
  const dependencies = createSupabaseNativeDwgWorkerDependencies(client, {
    supabaseUrl: "http://127.0.0.1:54321",
    serviceRoleKey: "service-secret",
    dotnetPath: "/opt/dotnet",
    publishedDirectory: "/srv/native-writer",
    writerBuildSha256,
    leaseSeconds: 900,
  });
  const signal = new AbortController().signal;
  assert.deepEqual(
    await dependencies.claim({ signal }),
    completedHarness().claim,
  );
  assert.deepEqual(signals, [
    ["lukas_drawing_claim_native_dwg_export", signal],
  ]);
});

test("Supabase adapter sends exact lifecycle RPCs and bounded immutable Storage options", async () => {
  const { createSupabaseNativeDwgWorkerDependencies } = await import(
    "../native-dwg-worker/src/supabase.ts"
  );
  const metadata = ["dwg", "source_manifest", "authority", "report"].map(
    (kind) => ({
      kind,
      sha256: artifactHashes[kind],
      byteSize:
        kind === "authority"
          ? authorityBytes.byteLength
          : writerArtifacts[kind].byteLength,
    }),
  );
  const paths = metadata.map((artifact) => ({
    ...artifact,
    path: `projects/${request.projectId}/native-dwg/${ids.job}/1/${artifact.sha256}/${fileNames[artifact.kind]}`,
  }));
  const calls = [];
  const receipt = {
    jobId: ids.job,
    attempt: 1,
    qualification: "experimental-unqualified",
    source: request,
    writerBuildSha256,
    structureSha256:
      "ffa54a46fcdc82a6bbb61db4938f3545119bb48e2031c765872ba5624fcf7f4a",
    artifacts: metadata,
    createdAt: "2026-09-06T00:00:00.000Z",
  };
  const client = {
    rpc(name, args) {
      return {
        abortSignal(signal) {
          calls.push(["rpc", name, args, signal]);
          const data = {
            lukas_drawing_stage_native_dwg_export: paths,
            lukas_drawing_settle_native_dwg_upload: "closed",
            lukas_drawing_publish_native_dwg_export: receipt,
            lukas_drawing_fail_native_dwg_export: "retry_wait",
          }[name];
          return Promise.resolve({ data, error: null });
        },
      };
    },
  };
  const storageFetch = async (url, init) => {
    calls.push(["fetch", String(url), init]);
    if (init.method === "GET") {
      return new Response(writerArtifacts.dwg, {
        status: 200,
        headers: { "content-type": "application/octet-stream" },
      });
    }
    return new Response("{}", {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  const dependencies = createSupabaseNativeDwgWorkerDependencies(
    client,
    {
      supabaseUrl: "http://127.0.0.1:54321",
      serviceRoleKey: "service-secret",
      dotnetPath: "/opt/dotnet",
      publishedDirectory: "/srv/native-writer",
      writerBuildSha256,
      leaseSeconds: 900,
    },
    { fetch: storageFetch },
  );
  const signal = new AbortController().signal;
  const identity = {
    jobId: ids.job,
    attempt: 1,
    leaseToken: ids.lease,
    signal,
  };
  assert.deepEqual(
    await dependencies.stage({
      ...identity,
      structureSha256: receipt.structureSha256,
      artifacts: metadata,
    }),
    paths,
  );
  await dependencies.upload({
    kind: "dwg",
    path: paths[0].path,
    bytes: writerArtifacts.dwg,
    signal,
  });
  assert.equal(
    Buffer.from(
      await dependencies.read({ kind: "dwg", path: paths[0].path, signal }),
    ).equals(writerArtifacts.dwg),
    true,
  );
  assert.equal(await dependencies.settle(identity), "closed");
  assert.deepEqual(await dependencies.publish(identity), receipt);
  assert.equal(
    await dependencies.fail({
      ...identity,
      errorCode: "upload_failed",
      retryable: true,
    }),
    "retry_wait",
  );
  assert.deepEqual(calls[0].slice(0, 3), [
    "rpc",
    "lukas_drawing_stage_native_dwg_export",
    {
      p_job_id: ids.job,
      p_attempt: 1,
      p_lease_token: ids.lease,
      p_structure_sha256: receipt.structureSha256,
      p_artifacts: metadata,
    },
  ]);
  assert.equal(calls[1][0], "fetch");
  assert.equal(
    calls[1][1],
    `http://127.0.0.1:54321/storage/v1/object/lukas-qto/${paths[0].path}`,
  );
  assert.equal(calls[1][2].method, "POST");
  assert.equal(calls[1][2].headers["x-upsert"], "false");
  assert.equal(calls[1][2].headers.authorization, "Bearer service-secret");
  assert.ok(calls[1][2].signal instanceof AbortSignal);
  assert.equal(calls[2][0], "fetch");
  assert.equal(calls[2][2].method, "GET");
  assert.ok(calls[2][2].signal instanceof AbortSignal);
  assert.deepEqual(
    calls.slice(3).map(([, name, args]) => [name, args]),
    [
      [
        "lukas_drawing_settle_native_dwg_upload",
        { p_job_id: ids.job, p_attempt: 1, p_lease_token: ids.lease },
      ],
      [
        "lukas_drawing_publish_native_dwg_export",
        { p_job_id: ids.job, p_attempt: 1, p_lease_token: ids.lease },
      ],
      [
        "lukas_drawing_fail_native_dwg_export",
        {
          p_job_id: ids.job,
          p_attempt: 1,
          p_lease_token: ids.lease,
          p_error_code: "upload_failed",
          p_retryable: true,
        },
      ],
    ],
  );
});

test("worker rejects malformed claim and publication DTOs without exposing data", async () => {
  const malformedClaim = completedHarness({
    async claim() {
      return { ...completedHarness().claim, extra: true };
    },
  });
  await assert.rejects(
    runNativeDrawingDwgWorkerOnce(malformedClaim.dependencies),
    /^Error: Native DWG claim is invalid\.$/,
  );

  const malformedReceipt = completedHarness({
    async publish() {
      malformedReceipt.events.push("publish");
      return { secretStoragePath: "projects/private/native.dwg" };
    },
  });
  assert.equal(
    await runNativeDrawingDwgWorkerOnce(malformedReceipt.dependencies),
    "retry_scheduled",
  );
  assert.equal(malformedReceipt.events.at(-1), "fail:publication_failed");
});

test("writer rejects wrong or changing builds and cleans only its own directory", async () => {
  const publishedDirectory = "/srv/native-writer";
  const root = "/tmp/1hk-native-dwg-build-change";
  let reads = 0;
  let removed = false;
  const runtime = {
    async mkdtemp() {
      return root;
    },
    async writeFile() {},
    async execFile() {},
    async readFile(path) {
      if (path.startsWith(`${publishedDirectory}/`)) {
        reads += 1;
        return Buffer.from(reads > 2 ? "changed" : "writer");
      }
      if (path.endsWith("native.dwg")) return writerArtifacts.dwg;
      if (path.endsWith("source-manifest.json"))
        return writerArtifacts.source_manifest;
      return writerArtifacts.report;
    },
    async readdir(path) {
      return path === publishedDirectory
        ? ["DwgEngineQualification.dll"]
        : ["native-report.json", "native.dwg", "source-manifest.json"];
    },
    async lstat(path) {
      return {
        size: 1024,
        isDirectory: () =>
          path === publishedDirectory ||
          path === "/tmp" ||
          path === root ||
          path === `${root}/output`,
        isFile: () =>
          path !== publishedDirectory &&
          path !== root &&
          path !== `${root}/output`,
        isSymbolicLink: () => false,
      };
    },
    async realpath(path) {
      return path;
    },
    async rm(path) {
      assert.equal(path, root);
      removed = true;
    },
    tmpdir() {
      return "/tmp";
    },
  };
  const build = await calculateNativeDwgWriterBuildSha256(
    publishedDirectory,
    runtime,
  );
  await assert.rejects(
    runNativeDrawingDwgWriter(
      {
        dotnetPath: "/opt/dotnet",
        publishedDirectory,
        manifestBytes: writerArtifacts.source_manifest,
        expectedWriterBuildSha256: "0".repeat(64),
      },
      runtime,
    ),
    /^Error: Native DWG conversion failed\.$/,
  );
  reads = 1;
  await assert.rejects(
    runNativeDrawingDwgWriter(
      {
        dotnetPath: "/opt/dotnet",
        publishedDirectory,
        manifestBytes: writerArtifacts.source_manifest,
        expectedWriterBuildSha256: build,
      },
      runtime,
    ),
    /^Error: Native DWG conversion failed\.$/,
  );
  assert.equal(removed, true);
});

test("writer failure waits for the bounded killed process and still cleans", async () => {
  const root = "/tmp/1hk-native-dwg-timeout";
  let removed = false;
  const runtime = {
    async mkdtemp() {
      return root;
    },
    async writeFile() {},
    async execFile(_binary, _arguments, options) {
      assert.equal(options.timeout, 120_000);
      assert.equal(options.killSignal, "SIGKILL");
      throw new Error("process exited after SIGKILL");
    },
    async readFile() {
      return Buffer.from("writer");
    },
    async readdir() {
      return ["DwgEngineQualification.dll"];
    },
    async lstat(path) {
      return {
        size: 1024,
        isDirectory: () =>
          path === "/srv/native-writer" || path === "/tmp" || path === root,
        isFile: () => path !== "/srv/native-writer" && path !== root,
        isSymbolicLink: () => false,
      };
    },
    async realpath(path) {
      return path;
    },
    async rm(path) {
      assert.equal(path, root);
      removed = true;
    },
    tmpdir() {
      return "/tmp";
    },
  };
  const build = await calculateNativeDwgWriterBuildSha256(
    "/srv/native-writer",
    runtime,
  );
  await assert.rejects(
    runNativeDrawingDwgWriter(
      {
        dotnetPath: "/opt/dotnet",
        publishedDirectory: "/srv/native-writer",
        manifestBytes: writerArtifacts.source_manifest,
        expectedWriterBuildSha256: build,
      },
      runtime,
    ),
    /^Error: Native DWG conversion failed\.$/,
  );
  assert.equal(removed, true);
});

test("real writer process timeout hard-kills a SIGTERM-resistant child before rejecting", async () => {
  const { runNativeDwgProcess } = await import(
    "../app/lukas/lib/drawing-native-dwg-worker.server.ts"
  );
  const startedAt = Date.now();
  await assert.rejects(
    runNativeDwgProcess(
      process.execPath,
      [
        "-e",
        "process.on('SIGTERM',()=>{});process.stdout.write('ready');setInterval(()=>{},1000)",
      ],
      {
        timeoutMilliseconds: 100,
        maxOutputBytes: 1024,
        signal: new AbortController().signal,
        env: { LANG: "C", LC_ALL: "C" },
      },
    ),
    /process failed/,
  );
  assert.ok(Date.now() - startedAt < 2_000);
});

test("writer canonicalizes the trusted macOS temporary parent before creating and cleaning", async () => {
  const publishedDirectory = "/srv/native-writer";
  const aliasedParent = "/var/folders/task/T";
  const canonicalParent = "/private/var/folders/task/T";
  const root = `${canonicalParent}/1hk-native-dwg-fixed`;
  const runtime = {
    async mkdtemp(prefix) {
      assert.equal(prefix, `${canonicalParent}/1hk-native-dwg-`);
      return root;
    },
    async writeFile() {},
    async execFile() {},
    async readFile(path) {
      if (path.startsWith(`${publishedDirectory}/`))
        return Buffer.from("writer");
      if (path.endsWith("native.dwg")) return writerArtifacts.dwg;
      if (path.endsWith("source-manifest.json"))
        return writerArtifacts.source_manifest;
      return writerArtifacts.report;
    },
    async readdir(path) {
      return path === publishedDirectory
        ? ["DwgEngineQualification.dll"]
        : ["native-report.json", "native.dwg", "source-manifest.json"];
    },
    async lstat(path) {
      const directory =
        path === publishedDirectory ||
        path === canonicalParent ||
        path === root ||
        path === `${root}/output`;
      return {
        size: 1024,
        isDirectory: () => directory,
        isFile: () => !directory,
        isSymbolicLink: () => false,
      };
    },
    async realpath(path) {
      return path === aliasedParent ? canonicalParent : path;
    },
    async rm(path) {
      assert.equal(path, root);
    },
    tmpdir() {
      return aliasedParent;
    },
  };
  const build = await calculateNativeDwgWriterBuildSha256(
    publishedDirectory,
    runtime,
  );
  assert.deepEqual(
    await runNativeDrawingDwgWriter(
      {
        dotnetPath: "/opt/dotnet",
        publishedDirectory,
        manifestBytes: writerArtifacts.source_manifest,
        expectedWriterBuildSha256: build,
      },
      runtime,
    ),
    writerArtifacts,
  );
});

test("explicit Storage transport bounds full response bodies and preserves upload uncertainty", async () => {
  const { createNativeDwgStorageTransport, NativeDwgUncertainUploadError } =
    await import("../native-dwg-worker/src/supabase.ts");
  const sockets = new Set();
  let stalledUploadClosed = false;
  let stalledBodyClosed = false;
  let oversizedClosed = false;
  const uploadContentTypes = [];
  const server = createServer((incoming, response) => {
    if (incoming.url?.endsWith("/stalled-upload")) {
      incoming.on("close", () => {
        stalledUploadClosed = true;
      });
      return;
    }
    if (incoming.url?.endsWith("/stalled-body")) {
      response.writeHead(200, { "content-type": "application/octet-stream" });
      response.write(Buffer.from("part"));
      response.on("close", () => {
        stalledBodyClosed = true;
      });
      return;
    }
    if (incoming.url?.endsWith("/oversized")) {
      response.writeHead(200, { "content-type": "application/octet-stream" });
      response.on("close", () => {
        oversizedClosed = true;
      });
      response.write(Buffer.alloc(40));
      return;
    }
    if (incoming.url?.endsWith("/duplicate")) {
      response.writeHead(409, { "content-type": "application/json" });
      return response.end('{"code":"ResourceAlreadyExists"}');
    }
    assert.equal(incoming.headers.apikey, "service-secret");
    assert.equal(incoming.headers.authorization, "Bearer service-secret");
    assert.equal(incoming.headers["x-upsert"], "false");
    uploadContentTypes.push(incoming.headers["content-type"]);
    response.writeHead(200, { "content-type": "application/json" });
    response.write("{");
    setImmediate(() => response.end("}"));
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  await new Promise((resolvePromise) =>
    server.listen(0, "127.0.0.1", resolvePromise),
  );
  const address = server.address();
  assert.notEqual(address, null);
  const baseUrl = `http://127.0.0.1:${address.port}`;
  try {
    const transport = createNativeDwgStorageTransport(
      { supabaseUrl: baseUrl, serviceRoleKey: "service-secret" },
      {
        artifactLimits: {
          dwg: 32,
          source_manifest: 32,
          authority: 32,
          report: 32,
        },
      },
    );
    assert.equal(
      await transport.upload({
        kind: "dwg",
        path: "projects/p/native-dwg/j/1/hash/native.dwg",
        bytes: Buffer.from("dwg"),
        signal: new AbortController().signal,
      }),
      "uploaded",
    );
    assert.equal(
      await transport.upload({
        kind: "report",
        path: "projects/p/native-dwg/j/1/hash/native-report.json",
        bytes: Buffer.from("{}"),
        signal: new AbortController().signal,
      }),
      "uploaded",
    );
    assert.deepEqual(uploadContentTypes, [
      "application/octet-stream",
      "application/json",
    ]);
    assert.equal(
      await transport.upload({
        kind: "dwg",
        path: "duplicate",
        bytes: Buffer.from("dwg"),
        signal: new AbortController().signal,
      }),
      "exists",
    );

    const uploadAbort = new AbortController();
    setTimeout(() => uploadAbort.abort(), 50).unref();
    await assert.rejects(
      transport.upload({
        kind: "dwg",
        path: "stalled-upload",
        bytes: Buffer.from("dwg"),
        signal: uploadAbort.signal,
      }),
      NativeDwgUncertainUploadError,
    );
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
    assert.equal(stalledUploadClosed, true);

    const readAbort = new AbortController();
    setTimeout(() => readAbort.abort(), 50).unref();
    await assert.rejects(
      transport.read({
        kind: "dwg",
        path: "stalled-body",
        signal: readAbort.signal,
      }),
      /readback failed/,
    );
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
    assert.equal(stalledBodyClosed, true);
    await assert.rejects(
      transport.read({
        kind: "dwg",
        path: "oversized",
        signal: new AbortController().signal,
      }),
      /readback failed/,
    );
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
    assert.equal(oversizedClosed, true);
  } finally {
    for (const socket of sockets) socket.destroy();
    await new Promise((resolvePromise) => server.close(resolvePromise));
  }
});

test("writer checks output size before reading an oversized file", async () => {
  const root = "/tmp/1hk-native-dwg-oversized";
  let outputReads = 0;
  const runtime = {
    async mkdtemp() {
      return root;
    },
    async writeFile() {},
    async execFile() {},
    async readFile(path) {
      if (path.startsWith("/srv/native-writer/")) return Buffer.from("writer");
      outputReads += 1;
      return writerArtifacts.dwg;
    },
    async readdir(path) {
      return path === "/srv/native-writer"
        ? ["DwgEngineQualification.dll"]
        : ["native-report.json", "native.dwg", "source-manifest.json"];
    },
    async lstat(path) {
      const directory =
        path === "/srv/native-writer" ||
        path === "/tmp" ||
        path === root ||
        path === `${root}/output`;
      return {
        size: path.endsWith("native.dwg")
          ? NATIVE_DWG_WORKER_LIMITS.dwgBytes + 1
          : 1024,
        isDirectory: () => directory,
        isFile: () => !directory,
        isSymbolicLink: () => false,
      };
    },
    async realpath(path) {
      return path;
    },
    async rm() {},
    tmpdir() {
      return "/tmp";
    },
  };
  const build = await calculateNativeDwgWriterBuildSha256(
    "/srv/native-writer",
    runtime,
  );
  await assert.rejects(
    runNativeDrawingDwgWriter(
      {
        dotnetPath: "/opt/dotnet",
        publishedDirectory: "/srv/native-writer",
        manifestBytes: writerArtifacts.source_manifest,
        expectedWriterBuildSha256: build,
      },
      runtime,
    ),
    /^Error: Native DWG conversion failed\.$/,
  );
  assert.equal(outputReads, 0);
});

test("native worker config uses stable absolute environment names", async () => {
  const { parseNativeDwgWorkerConfig } = await import(
    "../native-dwg-worker/src/index.ts"
  );
  assert.deepEqual(
    parseNativeDwgWorkerConfig({
      SUPABASE_URL: "http://127.0.0.1:54321",
      SUPABASE_SERVICE_ROLE_KEY: "service-secret",
      NATIVE_DWG_DOTNET_PATH: "/opt/homebrew/bin/dotnet",
      NATIVE_DWG_PUBLISHED_DIRECTORY: "/srv/native-writer",
    }),
    {
      supabaseUrl: "http://127.0.0.1:54321",
      supabaseServiceRoleKey: "service-secret",
      dotnetPath: "/opt/homebrew/bin/dotnet",
      publishedDirectory: "/srv/native-writer",
      leaseSeconds: 900,
      pollMilliseconds: 1_000,
    },
  );
  assert.throws(
    () =>
      parseNativeDwgWorkerConfig({
        SUPABASE_URL: "http://127.0.0.1:54321",
        SUPABASE_SERVICE_ROLE_KEY: "service-secret",
        NATIVE_DWG_DOTNET_PATH: "dotnet",
        NATIVE_DWG_PUBLISHED_DIRECTORY: "/srv/native-writer",
      }),
    /configuration is invalid/,
  );
});
