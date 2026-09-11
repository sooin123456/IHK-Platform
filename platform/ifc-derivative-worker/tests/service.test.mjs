import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { test } from "node:test";

import {
  boundedIfcDerivativePollDelay,
  createBoundedFetch,
  parseIfcDerivativeWorkerConfig,
  runIfcDerivativeWorkerLoop,
  startIfcDerivativeHealthServer,
} from "../src/service.ts";
import {
  createLeasedIfcDerivativeReadyWriter,
  createSupabaseIfcDerivativeWorkerDependencies,
  mapIfcDerivativeJobClaim,
} from "../src/supabase.ts";

const validEnvironment = {
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-secret-that-is-long-enough",
  IFC_DERIVATIVE_CONVERTER_PATH: "/opt/1hk/bin/ifc-derivative",
  PORT: "8080",
  IFC_DERIVATIVE_LEASE_SECONDS: "900",
  IFC_DERIVATIVE_POLL_MIN_MS: "1000",
  IFC_DERIVATIVE_POLL_MAX_MS: "30000",
  IFC_DERIVATIVE_POLL_JITTER_RATIO: "0.2",
};
const serverFile = new URL("../src/server.ts", import.meta.url);

test("config rejects malformed authority, binary, port, lease, and poll bounds", () => {
  const invalid = [
    { SUPABASE_URL: "http://example.supabase.co" },
    { SUPABASE_SERVICE_ROLE_KEY: "short" },
    { IFC_DERIVATIVE_CONVERTER_PATH: "bin/ifc-derivative" },
    { PORT: "0" },
    { IFC_DERIVATIVE_LEASE_SECONDS: "599" },
    { IFC_DERIVATIVE_POLL_MIN_MS: "0" },
    {
      IFC_DERIVATIVE_POLL_MIN_MS: "30001",
      IFC_DERIVATIVE_POLL_MAX_MS: "30000",
    },
    { IFC_DERIVATIVE_POLL_JITTER_RATIO: "1" },
  ];

  for (const override of invalid) {
    assert.throws(
      () =>
        parseIfcDerivativeWorkerConfig({
          ...validEnvironment,
          ...override,
        }),
      /IFC derivative worker configuration is invalid/,
      JSON.stringify(override),
    );
  }
});

test("config returns only validated non-secret operational values", () => {
  assert.deepEqual(parseIfcDerivativeWorkerConfig(validEnvironment), {
    supabaseUrl: "https://example.supabase.co",
    supabaseServiceRoleKey: "service-role-secret-that-is-long-enough",
    converterPath: "/opt/1hk/bin/ifc-derivative",
    port: 8080,
    leaseSeconds: 900,
    pollMinMilliseconds: 1000,
    pollMaxMilliseconds: 30000,
    pollJitterRatio: 0.2,
  });
});

test("config defaults keep the lease beyond the bounded converter window", () => {
  const config = parseIfcDerivativeWorkerConfig({
    SUPABASE_URL: validEnvironment.SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: validEnvironment.SUPABASE_SERVICE_ROLE_KEY,
    IFC_DERIVATIVE_CONVERTER_PATH:
      validEnvironment.IFC_DERIVATIVE_CONVERTER_PATH,
  });
  assert.deepEqual(
    {
      port: config.port,
      leaseSeconds: config.leaseSeconds,
      pollMinMilliseconds: config.pollMinMilliseconds,
      pollMaxMilliseconds: config.pollMaxMilliseconds,
      pollJitterRatio: config.pollJitterRatio,
    },
    {
      port: 8080,
      leaseSeconds: 900,
      pollMinMilliseconds: 1_000,
      pollMaxMilliseconds: 30_000,
      pollJitterRatio: 0.2,
    },
  );
});

const ids = {
  job: "71000000-0000-4000-8000-000000000001",
  project: "71000000-0000-4000-8000-000000000002",
  source: "71000000-0000-4000-8000-000000000003",
  actor: "71000000-0000-4000-8000-000000000004",
  lease: "71000000-0000-4000-8000-000000000005",
  derivative: "71000000-0000-4000-8000-000000000006",
};
const sourceBytes = new TextEncoder().encode("ISO-10303-21;ENDSEC;");
const converterSha256 = "d".repeat(64);
const rawClaim = {
  job_id: ids.job,
  project_id: ids.project,
  source_file_id: ids.source,
  source_storage_path: `${ids.actor}/${ids.project}/source-uploads/model.ifc`,
  source_byte_size: sourceBytes.byteLength,
  source_sha256: "a".repeat(64),
  requested_by: ids.actor,
  derivative_version: 7,
  lease_token: ids.lease,
  lease_expires_at: "2026-09-03T10:05:00.000Z",
  attempt_count: 2,
  generation: 2,
  converter_sha256: converterSha256,
};

const readyRecord = {
  projectId: ids.project,
  sourceFileId: ids.source,
  sourceSha256: "a".repeat(64),
  version: 7,
  createdBy: ids.actor,
  manifestJson: { schemaVersion: 1 },
  manifestStoragePath: "projects/ready/manifest.json",
  manifestByteSize: 11,
  manifestSha256: "b".repeat(64),
  geometryStoragePath: "projects/ready/geometry.glb",
  geometryByteSize: 22,
  geometrySha256: "c".repeat(64),
};

test("claim mapping validates the full snake_case row and returns the core camelCase contract", () => {
  assert.deepEqual(mapIfcDerivativeJobClaim([rawClaim]), {
    jobId: ids.job,
    projectId: ids.project,
    sourceFileId: ids.source,
    sourceStoragePath: rawClaim.source_storage_path,
    sourceByteSize: sourceBytes.byteLength,
    sourceSha256: "a".repeat(64),
    requestedBy: ids.actor,
    derivativeVersion: 7,
    leaseToken: ids.lease,
  });
  assert.equal(mapIfcDerivativeJobClaim([]), null);
  for (const rows of [
    [{ ...rawClaim, source_sha256: "A".repeat(64) }],
    [{ ...rawClaim, unexpected: "field" }],
    [rawClaim, rawClaim],
  ])
    assert.throws(
      () => mapIfcDerivativeJobClaim(rows),
      /IFC derivative claim is invalid/,
    );
});

test("leased publication writer sends the current job and lease identity", async () => {
  const calls = [];
  const writer = createLeasedIfcDerivativeReadyWriter(
    {
      async rpc(name, args) {
        calls.push([name, args]);
        return { data: ids.derivative, error: null };
      },
    },
    { jobId: ids.job, leaseToken: ids.lease },
  );
  assert.deepEqual(await writer.recordReady(readyRecord), {
    id: ids.derivative,
  });
  assert.deepEqual(calls, [
    [
      "lukas_drawing_publish_leased_ifc_derivative_ready",
      {
        p_job_id: ids.job,
        p_lease_token: ids.lease,
        p_project_id: ids.project,
        p_source_file_id: ids.source,
        p_source_sha256: "a".repeat(64),
        p_version: 7,
        p_manifest_json: readyRecord.manifestJson,
        p_manifest_storage_path: readyRecord.manifestStoragePath,
        p_manifest_byte_size: 11,
        p_manifest_sha256: "b".repeat(64),
        p_geometry_storage_path: readyRecord.geometryStoragePath,
        p_geometry_byte_size: 22,
        p_geometry_sha256: "c".repeat(64),
        p_created_by: ids.actor,
      },
    ],
  ]);
});

test("Supabase adapter downloads privately with a cap and maps queue RPC arguments", async () => {
  const calls = [];
  const client = {
    async rpc(name, args) {
      calls.push(["rpc", name, args]);
      if (name === "lukas_drawing_claim_ifc_derivative_job_for_converter")
        return { data: [rawClaim], error: null };
      if (name === "lukas_drawing_complete_ifc_derivative_job")
        return { data: "completed", error: null };
      if (name === "lukas_drawing_fail_ifc_derivative_job")
        return { data: "retry_wait", error: null };
      if (name === "lukas_drawing_publish_leased_ifc_derivative_ready")
        return { data: ids.derivative, error: null };
      throw new Error("unexpected RPC");
    },
    storage: {
      from(bucket) {
        calls.push(["from", bucket]);
        return {
          async info(path) {
            calls.push(["info", path]);
            return {
              data: { size: sourceBytes.byteLength },
              error: null,
            };
          },
          async download(path, options, parameters) {
            calls.push(["download", path, options, parameters]);
            return { data: new Blob([sourceBytes]), error: null };
          },
          async upload() {
            throw new Error("not called in this adapter test");
          },
          async createSignedUrl() {
            throw new Error("source signed URL must not be created");
          },
        };
      },
    },
  };
  const converted = [];
  const published = [];
  const boundedFetch = async () => new Response();
  const dependencies = createSupabaseIfcDerivativeWorkerDependencies(
    client,
    {
      converterPath: "/opt/1hk/bin/ifc-derivative",
      converterSha256,
      leaseSeconds: 300,
    },
    {
      maxSourceBytes: 64,
      async convert(input) {
        converted.push(input);
        return {
          manifestBytes: new Uint8Array([1]),
          geometryBytes: new Uint8Array([2]),
        };
      },
      fetch: boundedFetch,
      async publish(_storage, _writer, input, publishRuntime) {
        published.push({ input, publishRuntime });
        return { id: ids.derivative };
      },
    },
  );

  const claim = await dependencies.claim();
  assert.deepEqual(claim, mapIfcDerivativeJobClaim([rawClaim]));
  assert.deepEqual(await dependencies.download(claim), sourceBytes);
  assert.deepEqual(
    await dependencies.convert({ sourceBytes, sourceFileId: ids.source }),
    { manifestBytes: new Uint8Array([1]), geometryBytes: new Uint8Array([2]) },
  );
  assert.equal(converted[0].binaryPath, "/opt/1hk/bin/ifc-derivative");
  assert.deepEqual(
    await dependencies.publish({
      jobId: ids.job,
      leaseToken: ids.lease,
      projectId: ids.project,
      sourceFileId: ids.source,
      sourceSha256: "a".repeat(64),
      version: 7,
      createdBy: ids.actor,
      manifestBytes: new Uint8Array([1]),
      geometryBytes: new Uint8Array([2]),
    }),
    { id: ids.derivative },
  );
  assert.deepEqual(published, [
    {
      input: {
        projectId: ids.project,
        sourceFileId: ids.source,
        sourceSha256: "a".repeat(64),
        version: 7,
        createdBy: ids.actor,
        manifestBytes: new Uint8Array([1]),
        geometryBytes: new Uint8Array([2]),
      },
      publishRuntime: { fetch: boundedFetch },
    },
  ]);
  await dependencies.complete({
    jobId: ids.job,
    leaseToken: ids.lease,
    derivativeVersion: 7,
    derivativeId: ids.derivative,
  });
  await dependencies.fail({
    jobId: ids.job,
    leaseToken: ids.lease,
    derivativeVersion: 7,
    retryable: true,
    errorCode: "publication_failed",
    errorMessage: "IFC derivative publication failed.",
  });

  assert.deepEqual(calls[0], [
    "rpc",
    "lukas_drawing_claim_ifc_derivative_job_for_converter",
    { p_converter_sha256: converterSha256, p_lease_seconds: 300 },
  ]);
  assert.deepEqual(calls[2], ["info", rawClaim.source_storage_path]);
  assert.deepEqual(calls[3].slice(0, 3), [
    "download",
    rawClaim.source_storage_path,
    {},
  ]);
  assert.ok(calls[3][3].signal instanceof AbortSignal);
  assert.deepEqual(calls.at(-2), [
    "rpc",
    "lukas_drawing_complete_ifc_derivative_job",
    {
      p_job_id: ids.job,
      p_lease_token: ids.lease,
      p_derivative_version: 7,
      p_derivative_id: ids.derivative,
    },
  ]);
  assert.deepEqual(calls.at(-1), [
    "rpc",
    "lukas_drawing_fail_ifc_derivative_job",
    {
      p_job_id: ids.job,
      p_lease_token: ids.lease,
      p_derivative_version: 7,
      p_retryable: true,
      p_error_code: "publication_failed",
      p_error_message: "IFC derivative publication failed.",
    },
  ]);
});

test("private download rejects an oversized response before reading its bytes", async () => {
  let downloads = 0;
  let arrayBufferReads = 0;
  const client = {
    async rpc() {
      return { data: [], error: null };
    },
    storage: {
      from() {
        return {
          async info() {
            return { data: { size: 5 }, error: null };
          },
          async download() {
            downloads += 1;
            return {
              data: {
                size: 5,
                async arrayBuffer() {
                  arrayBufferReads += 1;
                  return new Uint8Array(5).buffer;
                },
              },
              error: null,
            };
          },
        };
      },
    },
  };
  const dependencies = createSupabaseIfcDerivativeWorkerDependencies(
    client,
    {
      converterPath: "/opt/1hk/bin/ifc-derivative",
      converterSha256,
      leaseSeconds: 300,
    },
    { maxSourceBytes: 4 },
  );
  await assert.rejects(
    dependencies.download(mapIfcDerivativeJobClaim([rawClaim])),
    /IFC source download failed/,
  );
  assert.equal(downloads, 0);
  assert.equal(arrayBufferReads, 0);
});

test("poll delay backs off with bounded jitter and resets after work", () => {
  const config = {
    pollMinMilliseconds: 1_000,
    pollMaxMilliseconds: 8_000,
    pollJitterRatio: 0.2,
  };
  assert.equal(
    boundedIfcDerivativePollDelay(1, config, () => 0.5),
    1_000,
  );
  assert.equal(
    boundedIfcDerivativePollDelay(2, config, () => 0.5),
    2_000,
  );
  assert.equal(
    boundedIfcDerivativePollDelay(20, config, () => 0.5),
    8_000,
  );
  assert.equal(
    boundedIfcDerivativePollDelay(2, config, () => 0),
    1_600,
  );
  assert.equal(
    boundedIfcDerivativePollDelay(2, config, () => 1),
    2_400,
  );
});

test("bounded fetch supplies a deadline without discarding caller cancellation", async () => {
  const caller = new AbortController();
  let observedSignal;
  const bounded = createBoundedFetch(async (_input, init) => {
    observedSignal = init.signal;
    return new Promise((_resolve, reject) => {
      init.signal.addEventListener(
        "abort",
        () => reject(new Error("request aborted")),
        { once: true },
      );
    });
  }, 10);
  await assert.rejects(
    bounded("https://example.invalid", { signal: caller.signal }),
    /request aborted/,
  );
  assert.ok(observedSignal.aborted);
  assert.equal(caller.signal.aborted, false);
});

test("worker loop runs one job at a time and gracefully finishes an active job", async () => {
  const controller = new AbortController();
  let release;
  let started;
  const startedPromise = new Promise((resolve) => {
    started = resolve;
  });
  const releasePromise = new Promise((resolve) => {
    release = resolve;
  });
  let active = 0;
  let maximumActive = 0;
  let calls = 0;
  const loop = runIfcDerivativeWorkerLoop({
    signal: controller.signal,
    pollMinMilliseconds: 100,
    pollMaxMilliseconds: 1_000,
    pollJitterRatio: 0,
    async runOnce() {
      calls += 1;
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      started();
      await releasePromise;
      active -= 1;
      return "completed";
    },
    async sleep() {
      throw new Error("must not sleep after shutdown");
    },
    log() {},
  });
  await startedPromise;
  controller.abort();
  release();
  await loop;
  assert.equal(calls, 1);
  assert.equal(maximumActive, 1);
  assert.equal(active, 0);
});

test("worker loop backs off on idle and logs no raw error detail", async () => {
  const controller = new AbortController();
  const delays = [];
  const logs = [];
  let calls = 0;
  await runIfcDerivativeWorkerLoop({
    signal: controller.signal,
    pollMinMilliseconds: 100,
    pollMaxMilliseconds: 1_000,
    pollJitterRatio: 0,
    random: () => 0.5,
    async runOnce() {
      calls += 1;
      if (calls === 1) throw new Error("secret-key-and-private-path");
      if (calls === 2) return "idle";
      return "completed";
    },
    async sleep(milliseconds) {
      delays.push(milliseconds);
      if (delays.length === 3) controller.abort();
    },
    log(event) {
      logs.push(event);
    },
  });
  assert.deepEqual(delays, [100, 200, 100]);
  assert.equal(calls, 3);
  assert.doesNotMatch(JSON.stringify(logs), /secret-key-and-private-path/);
  assert.deepEqual(
    logs.map((event) => event.event),
    ["worker_iteration_failed", "worker_iteration", "worker_iteration"],
  );
});

test("health endpoint reports running and stopping without operational detail", async () => {
  let stopping = false;
  const health = await startIfcDerivativeHealthServer({
    port: 0,
    isStopping: () => stopping,
  });
  try {
    const running = await fetch(`http://127.0.0.1:${health.port}/healthz`);
    assert.equal(running.status, 200);
    assert.deepEqual(await running.json(), { status: "ok" });

    const missing = await fetch(`http://127.0.0.1:${health.port}/missing`);
    assert.equal(missing.status, 404);

    stopping = true;
    const draining = await fetch(`http://127.0.0.1:${health.port}/healthz`);
    assert.equal(draining.status, 503);
    assert.deepEqual(await draining.json(), { status: "stopping" });
  } finally {
    await health.close();
  }
});

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve(server.address().port);
    });
  });
}

function close(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

function waitForOutput(stream, pattern) {
  return new Promise((resolve, reject) => {
    let output = "";
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`timed out waiting for ${pattern}; got ${output}`));
    }, 10_000);
    const onData = (chunk) => {
      output += chunk;
      if (pattern.test(output)) {
        cleanup();
        resolve(output);
      }
    };
    function cleanup() {
      clearTimeout(timeout);
      stream.off("data", onData);
    }
    stream.on("data", onData);
  });
}

test("process startup failure is fixed and never prints environment values", () => {
  const result = spawnSync(process.execPath, [serverFile.pathname], {
    encoding: "utf8",
    env: {
      PATH: process.env.PATH,
      ...validEnvironment,
      SUPABASE_SERVICE_ROLE_KEY: "secret-leak",
    },
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /"event":"worker_start_failed"/);
  assert.doesNotMatch(`${result.stdout}${result.stderr}`, /secret-leak/);
});

test("real process serves health, polls Supabase, and exits cleanly on SIGTERM", async () => {
  let claimRequests = 0;
  let claimedConverterSha256 = null;
  const supabase = createServer((request, response) => {
    if (
      request.method === "POST" &&
      request.url ===
        "/rest/v1/rpc/lukas_drawing_claim_ifc_derivative_job_for_converter"
    ) {
      let body = "";
      request.setEncoding("utf8");
      request.on("data", (chunk) => (body += chunk));
      request.on("end", () => {
        claimRequests += 1;
        claimedConverterSha256 = JSON.parse(body).p_converter_sha256;
        response.writeHead(200, { "content-type": "application/json" });
        response.end("[]");
      });
      return;
    }
    response.writeHead(404, { "content-type": "application/json" });
    response.end("{}");
  });
  const supabasePort = await listen(supabase);
  const reservation = createServer();
  const workerPort = await listen(reservation);
  await close(reservation);
  const serviceKey = "service-role-secret-that-must-not-be-logged";
  const converterPath = process.execPath;
  const child = spawn(process.execPath, [serverFile.pathname], {
    env: {
      PATH: process.env.PATH,
      SUPABASE_URL: `http://127.0.0.1:${supabasePort}`,
      SUPABASE_SERVICE_ROLE_KEY: serviceKey,
      IFC_DERIVATIVE_CONVERTER_PATH: converterPath,
      PORT: String(workerPort),
      IFC_DERIVATIVE_LEASE_SECONDS: "600",
      IFC_DERIVATIVE_POLL_MIN_MS: "100",
      IFC_DERIVATIVE_POLL_MAX_MS: "200",
      IFC_DERIVATIVE_POLL_JITTER_RATIO: "0",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  try {
    await waitForOutput(child.stdout, /"event":"worker_started"/);
    const health = await fetch(`http://127.0.0.1:${workerPort}/healthz`);
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { status: "ok" });
    child.kill("SIGTERM");
    const [code, signal] = await once(child, "exit");
    assert.equal(code, 0, stderr);
    assert.equal(signal, null);
    assert.ok(claimRequests >= 1);
    assert.equal(
      claimedConverterSha256,
      createHash("sha256").update(readFileSync(converterPath)).digest("hex"),
    );
    assert.match(stdout, /"event":"worker_stopping"/);
    assert.match(stdout, /"event":"worker_stopped"/);
    assert.doesNotMatch(`${stdout}${stderr}`, new RegExp(serviceKey));
    assert.doesNotMatch(`${stdout}${stderr}`, new RegExp(converterPath));
  } finally {
    if (child.exitCode === null) child.kill("SIGKILL");
    await close(supabase);
  }
});

test("production bundle includes local app modules and remains executable", () => {
  const directory = new URL("..", import.meta.url).pathname;
  const build = spawnSync("npm", ["run", "build"], {
    cwd: directory,
    encoding: "utf8",
  });
  assert.equal(build.status, 0, `${build.stdout}\n${build.stderr}`);
  const bundled = spawnSync(process.execPath, ["dist/server.mjs"], {
    cwd: directory,
    encoding: "utf8",
    env: {
      PATH: process.env.PATH,
      ...validEnvironment,
      SUPABASE_SERVICE_ROLE_KEY: "secret-leak",
    },
  });
  assert.equal(bundled.status, 1);
  assert.match(bundled.stderr, /"event":"worker_start_failed"/);
  assert.doesNotMatch(`${bundled.stdout}${bundled.stderr}`, /secret-leak/);
});
