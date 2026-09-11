import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { createClient } from "@supabase/supabase-js";

import {
  NativeDrawingDwgImportCompletionUncertainError,
  NativeDrawingDwgImportPublicationRejectedError,
  NativeDrawingDwgImportStaleLeaseError,
  runNativeDrawingDwgImportWorkerOnce,
} from "../app/lukas/lib/drawing-native-dwg-import-worker.server.ts";
import {
  createNativeDrawingDwgImportRpcFetch,
  createNativeDrawingDwgImportSourceTransport,
  createSupabaseNativeDrawingDwgImportDependencies,
} from "../native-dwg-worker/src/import-supabase.ts";
import { parseNativeDrawingDwgImportWorkerConfig } from "../native-dwg-worker/src/import.ts";

const ids = Object.freeze({
  project: "92000000-0000-4000-8000-000000000001",
  document: "92000000-0000-4000-8000-000000000002",
  revision: "92000000-0000-4000-8000-000000000003",
  canvas: "92000000-0000-4000-8000-000000000004",
  file: "92000000-0000-4000-8000-000000000005",
  job: "92000000-0000-4000-8000-000000000006",
  actor: "92000000-0000-4000-8000-000000000007",
  verification: "92000000-0000-4000-8000-000000000008",
  lease: "92000000-0000-4000-8000-000000000009",
});
const imageId = `sha256:${"a".repeat(64)}`;
const sourceBytes = Buffer.from("AC1024strict-native-import-worker");
const sourceSha256 = createHash("sha256").update(sourceBytes).digest("hex");
const scope = Object.freeze({
  projectId: ids.project,
  documentId: ids.document,
  revisionId: ids.revision,
  canvasId: ids.canvas,
  sourceFileId: ids.file,
  sourceSha256,
  unitOverride: 4,
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

function harness(change = {}) {
  const events = [];
  const claim = {
    jobId: ids.job,
    attemptNumber: 1,
    leaseToken: ids.lease,
    leaseExpiresAt: new Date(Date.now() + 170_000).toISOString(),
    readerImageId: imageId,
    actorId: ids.actor,
    scope,
    source,
  };
  const dependencies = {
    async claim() {
      events.push("claim");
      return claim;
    },
    async downloadSource() {
      events.push("download");
      return Buffer.from(sourceBytes);
    },
    async readSource(input) {
      events.push("read");
      assert.equal(input.readerImageId, imageId);
      assert.deepEqual(input.expectedSource, report.source);
      assert.ok(input.timeoutMilliseconds > 0);
      assert.ok(input.timeoutMilliseconds <= 120_000);
      return structuredClone(report);
    },
    async complete(input) {
      events.push("complete");
      assert.deepEqual(JSON.parse(input.reportText), report);
      const expectedDigest = createHash("sha256")
        .update(input.reportText)
        .digest("hex");
      assert.equal(input.reportSha256, expectedDigest);
      return {
        jobId: ids.job,
        attemptNumber: 1,
        readerImageId: imageId,
        reportSha256: expectedDigest,
        reportByteSize: Buffer.byteLength(input.reportText),
        source: {
          verificationId: ids.verification,
          fileId: ids.file,
          sha256: sourceSha256,
          byteSize: sourceBytes.byteLength,
          headerVersion: "AC1024",
        },
        qualification: "experimental-unqualified",
        persistenceAuthority: "not-issued",
      };
    },
    async fail(input) {
      events.push(`fail:${input.failureCode}:${input.retryable}`);
      return {
        jobId: ids.job,
        status: input.retryable ? "retry_wait" : "failed",
      };
    },
    ...change,
  };
  return { claim, dependencies, events };
}

test("worker is idle without a claim and publishes one strict immutable report", async () => {
  const idle = harness({
    async claim() {
      return null;
    },
  });
  assert.equal(
    await runNativeDrawingDwgImportWorkerOnce(idle.dependencies),
    "idle",
  );
  const completed = harness();
  assert.equal(
    await runNativeDrawingDwgImportWorkerOnce(completed.dependencies),
    "analyzed",
  );
  assert.deepEqual(completed.events, ["claim", "download", "read", "complete"]);
});

test("source length, hash and header corruption fail before native parsing", async () => {
  for (const bytes of [
    sourceBytes.subarray(0, sourceBytes.length - 1),
    Buffer.from(`AC1024${"x".repeat(sourceBytes.length - 6)}`),
    Buffer.from(`AC1027${sourceBytes.subarray(6).toString()}`),
  ]) {
    const item = harness({
      async downloadSource() {
        return bytes;
      },
    });
    assert.equal(
      await runNativeDrawingDwgImportWorkerOnce(item.dependencies),
      "failed",
    );
    assert.equal(item.events.includes("read"), false);
    assert.ok(item.events.includes("fail:source_mismatch:false"));
  }
});

test("invalid or source-changed reports fail without publication", async () => {
  for (const changed of [
    { ...report, extra: true },
    { ...report, source: { ...report.source, sha256: "0".repeat(64) } },
  ]) {
    const item = harness({
      async readSource() {
        item.events.push("read");
        return changed;
      },
    });
    assert.equal(
      await runNativeDrawingDwgImportWorkerOnce(item.dependencies),
      "failed",
    );
    assert.equal(item.events.includes("complete"), false);
    assert.ok(item.events.includes("fail:report_invalid:false"));
  }
});

test("reader failures are retried and bounded failure acknowledgement errors are safe", async () => {
  const readerFailure = harness({
    async readSource() {
      throw new Error("native stderr with source path and secret");
    },
  });
  assert.equal(
    await runNativeDrawingDwgImportWorkerOnce(readerFailure.dependencies),
    "retry_scheduled",
  );
  assert.ok(readerFailure.events.includes("fail:reader_failed:true"));

  const failureFailure = harness({
    async downloadSource() {
      throw new Error("service secret");
    },
    async fail() {
      throw new Error("database internals");
    },
  });
  await assert.rejects(
    runNativeDrawingDwgImportWorkerOnce(failureFailure.dependencies),
    /^Error: Native DWG import failure acknowledgement failed\.$/,
  );
});

test("cancellation before and after native read never publishes", async () => {
  for (const stage of ["download", "read"]) {
    const controller = new AbortController();
    const item = harness(
      stage === "download"
        ? {
            async downloadSource() {
              item.events.push("download");
              controller.abort();
              return Buffer.from(sourceBytes);
            },
          }
        : {
            async readSource() {
              item.events.push("read");
              controller.abort();
              return structuredClone(report);
            },
          },
    );
    assert.equal(
      await runNativeDrawingDwgImportWorkerOnce(item.dependencies, {
        signal: controller.signal,
      }),
      "retry_scheduled",
    );
    assert.equal(item.events.includes("complete"), false);
    assert.ok(item.events.includes("fail:worker_interrupted:true"));
    if (stage === "download") assert.equal(item.events.includes("read"), false);
  }
});

test("deadline before publication fails the attempt instead of publishing late", async () => {
  const item = harness();
  item.claim.leaseExpiresAt = new Date(Date.now() + 14_000).toISOString();
  assert.equal(
    await runNativeDrawingDwgImportWorkerOnce(item.dependencies),
    "retry_scheduled",
  );
  assert.equal(item.events.includes("complete"), false);
  assert.ok(item.events.includes("fail:worker_interrupted:true"));
});

test("stale and ambiguous completion are never retried or failed under another identity", async () => {
  for (const [error, outcome] of [
    [new NativeDrawingDwgImportStaleLeaseError(), "stale"],
    [
      new NativeDrawingDwgImportCompletionUncertainError(),
      "publication_uncertain",
    ],
  ]) {
    const item = harness({
      async complete() {
        item.events.push("complete");
        throw error;
      },
    });
    assert.equal(
      await runNativeDrawingDwgImportWorkerOnce(item.dependencies),
      outcome,
    );
    assert.equal(
      item.events.some((event) => event.startsWith("fail:")),
      false,
    );
    assert.equal(item.events.filter((event) => event === "complete").length, 1);
  }
  const malformed = harness({
    async complete() {
      malformed.events.push("complete");
      return { jobId: ids.job };
    },
  });
  assert.equal(
    await runNativeDrawingDwgImportWorkerOnce(malformed.dependencies),
    "publication_uncertain",
  );
  assert.equal(
    malformed.events.some((event) => event.startsWith("fail:")),
    false,
  );
});

test("configured-origin transport authorizes an exact encoded path and exact body", async (t) => {
  const requests = [];
  const server = createServer((request, response) => {
    requests.push({
      headers: request.headers,
      method: request.method,
      url: request.url,
    });
    response.writeHead(200, {
      "content-length": String(sourceBytes.byteLength),
      "content-type": "application/octet-stream",
    });
    response.end(sourceBytes);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const address = server.address();
  const origin = `http://127.0.0.1:${address.port}`;
  const transport = createNativeDrawingDwgImportSourceTransport({
    supabaseUrl: origin,
    serviceRoleKey: "service-secret",
  });
  assert.deepEqual(
    await transport.downloadSource({
      source,
      signal: new AbortController().signal,
    }),
    new Uint8Array(sourceBytes),
  );
  assert.deepEqual(
    requests.map(({ method, url }) => [method, url]),
    [
      [
        "GET",
        `/storage/v1/object/lukas-qto/projects/${ids.project}/source%20drawings/a%20b%23.dwg`,
      ],
    ],
  );
  assert.equal(requests[0].headers.apikey, "service-secret");
  assert.equal(requests[0].headers.authorization, "Bearer service-secret");
});

test("source transport accepts an exact chunked body but rejects redirects, lying lengths, short/oversized streams and stalls", async (t) => {
  const sockets = new Set();
  const server = createServer((request, response) => {
    const mode = request.url.split("/").at(-1);
    if (mode === "redirect") {
      response.writeHead(302, {
        location: "http://127.0.0.1:1/credential-target",
      });
      return response.end();
    }
    if (mode === "missing") {
      response.writeHead(200, {
        "content-type": "application/octet-stream",
        "transfer-encoding": "chunked",
      });
      response.write(sourceBytes.subarray(0, 7));
      return response.end(sourceBytes.subarray(7));
    }
    if (mode === "lying") {
      response.writeHead(200, {
        "content-length": String(sourceBytes.length + 1),
        "content-type": "application/octet-stream",
      });
      return response.end(sourceBytes);
    }
    if (mode === "short") {
      response.writeHead(200, {
        "content-type": "application/octet-stream",
        "transfer-encoding": "chunked",
      });
      return response.end(sourceBytes.subarray(0, sourceBytes.length - 1));
    }
    if (mode === "oversized") {
      response.writeHead(200, {
        "content-type": "application/octet-stream",
        "transfer-encoding": "chunked",
      });
      return response.end(Buffer.concat([sourceBytes, Buffer.from("x")]));
    }
    response.writeHead(200, {
      "content-length": String(sourceBytes.length),
      "content-type": "application/octet-stream",
    });
    response.write(sourceBytes.subarray(0, 4));
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise((resolve) => server.close(resolve));
  });
  const address = server.address();
  const origin = `http://127.0.0.1:${address.port}`;
  const transport = createNativeDrawingDwgImportSourceTransport({
    supabaseUrl: origin,
    serviceRoleKey: "service-secret",
  });
  assert.deepEqual(
    await transport.downloadSource({
      source: { ...source, path: "missing" },
      signal: new AbortController().signal,
    }),
    new Uint8Array(sourceBytes),
  );
  for (const path of ["redirect", "lying", "short", "oversized"]) {
    await assert.rejects(
      transport.downloadSource({
        source: { ...source, path },
        signal: new AbortController().signal,
      }),
      /^Error: Native DWG import source download failed\.$/,
    );
  }
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 30).unref();
  await assert.rejects(
    transport.downloadSource({
      source: { ...source, path: "stall" },
      signal: controller.signal,
    }),
    /^Error: Native DWG import source download failed\.$/,
  );
});

test("adapter rejects malicious origin, path and configuration before RPC or network", async () => {
  for (const supabaseUrl of [
    "https://user:pass@example.test",
    "https://example.test/tenant",
    "https://example.test?key=secret",
    "ftp://example.test",
  ])
    assert.throws(() =>
      createNativeDrawingDwgImportSourceTransport({
        supabaseUrl,
        serviceRoleKey: "service-secret",
      }),
    );
  const transport = createNativeDrawingDwgImportSourceTransport({
    supabaseUrl: "https://example.test",
    serviceRoleKey: "service-secret",
  });
  for (const path of ["/absolute", "../escape", "a//b", "a\\b", "a\u0000b"])
    await assert.rejects(
      transport.downloadSource({
        source: { ...source, path },
        signal: new AbortController().signal,
      }),
      /source download failed/i,
    );

  let rpcCalls = 0;
  assert.throws(() =>
    createSupabaseNativeDrawingDwgImportDependencies(
      {
        rpc() {
          rpcCalls += 1;
        },
      },
      {
        supabaseUrl: "https://example.test",
        serviceRoleKey: "service-secret",
        readerImageId: "reader:latest",
        dockerPath: "docker",
        dockerHost: "tcp://127.0.0.1:2375",
        leaseSeconds: 300,
      },
    ),
  );
  assert.equal(rpcCalls, 0);
});

test("publication adapter rejects a mismatched digest before sending the exact identity", async () => {
  const reportText = JSON.stringify(report);
  const reportSha256 = createHash("sha256").update(reportText).digest("hex");
  const receipt = {
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
  };
  const calls = [];
  const dependencies = createSupabaseNativeDrawingDwgImportDependencies(
    {
      rpc(name, args) {
        calls.push([name, args]);
        return {
          abortSignal() {
            return Promise.resolve({ data: receipt, error: null });
          },
        };
      },
    },
    {
      supabaseUrl: "https://example.test",
      serviceRoleKey: "service-secret",
      readerImageId: imageId,
      dockerPath: "/usr/bin/docker",
      dockerHost: "unix:///var/run/docker.sock",
      leaseSeconds: 300,
    },
  );
  const input = {
    jobId: ids.job,
    attemptNumber: 1,
    leaseToken: ids.lease,
    readerImageId: imageId,
    reportText,
    reportSha256,
    signal: new AbortController().signal,
  };
  await assert.rejects(
    dependencies.complete({ ...input, reportSha256: "0".repeat(64) }),
    NativeDrawingDwgImportPublicationRejectedError,
  );
  assert.equal(calls.length, 0);
  assert.deepEqual(await dependencies.complete(input), receipt);
  assert.deepEqual(calls, [
    [
      "lukas_drawing_complete_native_dwg_import",
      {
        p_job_id: ids.job,
        p_attempt_number: 1,
        p_lease_token: ids.lease,
        p_reader_image_id: imageId,
        p_report_text: reportText,
        p_report_sha256: reportSha256,
      },
    ],
  ]);
});

test("real Supabase RPC HTTP stays on the configured origin with service authorization", async (t) => {
  const calls = [];
  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    calls.push({
      authorization: request.headers.authorization,
      apikey: request.headers.apikey,
      body: JSON.parse(Buffer.concat(chunks).toString("utf8")),
      method: request.method,
      url: request.url,
    });
    response.writeHead(200, {
      "content-type": "application/json",
      "content-length": "4",
    });
    response.end("null");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const address = server.address();
  const origin = `http://127.0.0.1:${address.port}`;
  const serviceRoleKey = "local-service-role-key";
  const client = createClient(origin, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
    global: {
      fetch: createNativeDrawingDwgImportRpcFetch(origin),
    },
  });
  const dependencies = createSupabaseNativeDrawingDwgImportDependencies(
    client,
    {
      supabaseUrl: origin,
      serviceRoleKey,
      readerImageId: imageId,
      dockerPath: "/usr/bin/docker",
      dockerHost: "unix:///var/run/docker.sock",
      leaseSeconds: 300,
    },
  );
  assert.equal(
    await dependencies.claim({ signal: new AbortController().signal }),
    null,
  );
  assert.deepEqual(calls, [
    {
      authorization: `Bearer ${serviceRoleKey}`,
      apikey: serviceRoleKey,
      body: { p_reader_image_id: imageId, p_lease_seconds: 300 },
      method: "POST",
      url: "/rest/v1/rpc/lukas_drawing_claim_native_dwg_import",
    },
  ]);
});

test("real Supabase RPC redirect never forwards service authorization", async (t) => {
  let targetCalls = 0;
  const target = createServer((_request, response) => {
    targetCalls += 1;
    response.writeHead(200, { "content-type": "application/json" });
    response.end("null");
  });
  await new Promise((resolve) => target.listen(0, "127.0.0.1", resolve));
  const targetAddress = target.address();
  const redirector = createServer((_request, response) => {
    response.writeHead(302, {
      location: `http://127.0.0.1:${targetAddress.port}/credential-target`,
    });
    response.end();
  });
  await new Promise((resolve) => redirector.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    await new Promise((resolve) => redirector.close(resolve));
    await new Promise((resolve) => target.close(resolve));
  });
  const address = redirector.address();
  const origin = `http://127.0.0.1:${address.port}`;
  const serviceRoleKey = "redirect-service-role-key";
  const client = createClient(origin, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
    global: {
      fetch: createNativeDrawingDwgImportRpcFetch(origin),
    },
  });
  const dependencies = createSupabaseNativeDrawingDwgImportDependencies(
    client,
    {
      supabaseUrl: origin,
      serviceRoleKey,
      readerImageId: imageId,
      dockerPath: "/usr/bin/docker",
      dockerHost: "unix:///var/run/docker.sock",
      leaseSeconds: 300,
    },
  );
  await assert.rejects(
    dependencies.claim({ signal: new AbortController().signal }),
    /^Error: Native DWG import claim failed\.$/,
  );
  assert.equal(targetCalls, 0);
});

test("import CLI configuration requires an immutable image and explicit Docker socket", () => {
  assert.deepEqual(
    parseNativeDrawingDwgImportWorkerConfig({
      SUPABASE_URL: "https://project.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "service-secret",
      NATIVE_DWG_READER_IMAGE_ID: imageId,
      NATIVE_DWG_DOCKER_PATH: "/usr/local/bin/docker",
      NATIVE_DWG_DOCKER_HOST: "unix:///var/run/docker.sock",
    }),
    {
      supabaseUrl: "https://project.supabase.co",
      serviceRoleKey: "service-secret",
      readerImageId: imageId,
      dockerPath: "/usr/local/bin/docker",
      dockerHost: "unix:///var/run/docker.sock",
      leaseSeconds: 300,
      pollMilliseconds: 1_000,
    },
  );
  for (const change of [
    { NATIVE_DWG_READER_IMAGE_ID: "reader:latest" },
    { NATIVE_DWG_DOCKER_PATH: "docker" },
    { NATIVE_DWG_DOCKER_HOST: "tcp://127.0.0.1:2375" },
    { NATIVE_DWG_IMPORT_LEASE_SECONDS: "179" },
  ])
    assert.throws(() =>
      parseNativeDrawingDwgImportWorkerConfig({
        SUPABASE_URL: "https://project.supabase.co",
        SUPABASE_SERVICE_ROLE_KEY: "service-secret",
        NATIVE_DWG_READER_IMAGE_ID: imageId,
        NATIVE_DWG_DOCKER_PATH: "/usr/local/bin/docker",
        NATIVE_DWG_DOCKER_HOST: "unix:///var/run/docker.sock",
        ...change,
      }),
    );
});

test("real import CLI composes strict adapter config, claims idle and stops on SIGTERM", async (t) => {
  const calls = [];
  let child;
  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    calls.push({
      body: JSON.parse(Buffer.concat(chunks).toString("utf8")),
      method: request.method,
      url: request.url,
    });
    response.writeHead(200, {
      "content-type": "application/json",
      "content-length": "4",
    });
    response.end("null");
    response.once("finish", () => setTimeout(() => child.kill("SIGTERM"), 100));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    if (child && child.exitCode === null && child.signalCode === null)
      child.kill("SIGKILL");
    await new Promise((resolve) => server.close(resolve));
  });
  const address = server.address();
  const origin = `http://127.0.0.1:${address.port}`;
  child = spawn(
    process.execPath,
    [
      "--experimental-strip-types",
      fileURLToPath(
        new URL("../native-dwg-worker/src/import.ts", import.meta.url),
      ),
    ],
    {
      cwd: fileURLToPath(new URL("..", import.meta.url)),
      env: {
        PATH: process.env.PATH,
        SUPABASE_URL: origin,
        SUPABASE_SERVICE_ROLE_KEY: "cli-service-role-key",
        NATIVE_DWG_READER_IMAGE_ID: imageId,
        NATIVE_DWG_DOCKER_PATH: "/must-not-be-invoked/docker",
        NATIVE_DWG_DOCKER_HOST: "unix:///must-not-be-invoked/docker.sock",
        NATIVE_DWG_IMPORT_LEASE_SECONDS: "300",
        NATIVE_DWG_IMPORT_POLL_MILLISECONDS: "1000",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  const stdout = [];
  const stderr = [];
  child.stdout.on("data", (chunk) => stdout.push(chunk));
  child.stderr.on("data", (chunk) => stderr.push(chunk));
  const result = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("import CLI did not stop after SIGTERM"));
    }, 5_000);
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("exit", (code, signal) => {
      clearTimeout(timeout);
      resolve({ code, signal });
    });
  });
  assert.deepEqual(result, { code: 0, signal: null });
  assert.equal(Buffer.concat(stderr).toString("utf8"), "");
  assert.deepEqual(Buffer.concat(stdout).toString("utf8").trim().split("\n"), [
    '{"event":"native_dwg_import_worker_started"}',
    '{"event":"native_dwg_import_worker_stopped"}',
  ]);
  assert.deepEqual(calls, [
    {
      body: { p_reader_image_id: imageId, p_lease_seconds: 300 },
      method: "POST",
      url: "/rest/v1/rpc/lukas_drawing_claim_native_dwg_import",
    },
  ]);
});
