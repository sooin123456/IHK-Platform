import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer as httpServer } from "node:http";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createServer } from "vite";
import { resaveArtifactFixture } from "./fixtures/drawing-native-dwg-resave-artifacts.mjs";
const vite = await createServer({
  appType: "custom",
  configFile: false,
  logLevel: "silent",
  server: { middlewareMode: true },
});
test.after(() => vite.close());
const entry = await vite
  .ssrLoadModule("/native-dwg-worker/src/resave.ts")
  .catch(() => ({}));
const { buildNativeDrawingDwgResaveAttestation: build } =
  await vite.ssrLoadModule(
    "/app/lukas/lib/drawing-native-dwg-resave-attestation.server.ts",
  );
const f = await resaveArtifactFixture(build);
const env = {
  SUPABASE_URL: "https://project.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "test-secret",
  NATIVE_DWG_RESAVER_IMAGE_ID: f.imageId,
  NATIVE_DWG_DOCKER_PATH: "/unused/docker",
  NATIVE_DWG_DOCKER_HOST: "unix:///unused/docker.sock",
};
test("resave config validates immutable image, origin, local socket, lease and poll bounds", () => {
  assert.equal(
    typeof entry.parseNativeDrawingDwgResaveWorkerConfig,
    "function",
  );
  assert.deepEqual(entry.parseNativeDrawingDwgResaveWorkerConfig(env), {
    supabaseUrl: "https://project.supabase.co",
    serviceRoleKey: "test-secret",
    resaverImageId: f.imageId,
    dockerPath: "/unused/docker",
    dockerHost: "unix:///unused/docker.sock",
    leaseSeconds: 900,
    pollMilliseconds: 1000,
  });
  for (const change of [
    { SUPABASE_URL: "https://user:secret@project.supabase.co" },
    { SUPABASE_URL: "https://project.supabase.co/path" },
    { NATIVE_DWG_RESAVER_IMAGE_ID: "resaver:latest" },
    { NATIVE_DWG_DOCKER_PATH: "docker" },
    { NATIVE_DWG_DOCKER_HOST: "unix:///tmp/../docker.sock" },
    { NATIVE_DWG_DOCKER_HOST: "tcp://localhost:2375" },
    { NATIVE_DWG_RESAVE_LEASE_SECONDS: "179" },
    { NATIVE_DWG_RESAVE_LEASE_SECONDS: "901" },
    { NATIVE_DWG_RESAVE_POLL_MILLISECONDS: "99" },
    { NATIVE_DWG_RESAVE_POLL_MILLISECONDS: "60001" },
  ])
    assert.throws(
      () =>
        entry.parseNativeDrawingDwgResaveWorkerConfig({ ...env, ...change }),
      /^Error: Native DWG resave worker configuration is invalid\.$/,
    );
});

test("strip-compatible error fields preserve the accepted source-free and imported error contract", async () => {
  const sourceFree = await import(
    "../app/lukas/lib/drawing-native-dwg-jobs.server.ts"
  );
  const imported = await import(
    "../app/lukas/lib/drawing-native-dwg-resave-jobs.server.ts"
  );
  for (const [kind, message] of [
    ["invalid", "Invalid native DWG request."],
    ["unavailable", "Native DWG export is unavailable."],
    ["conflict", "Native DWG export state conflicts with this request."],
    ["capacity", "Native DWG export capacity is currently full."],
  ]) {
    const error = new sourceFree.NativeDrawingDwgJobError(kind);
    assert.equal(error.kind, kind);
    assert.equal(error.message, message);
    assert.equal(error.name, "NativeDrawingDwgJobError");
    assert.ok(error instanceof Error);
  }
  for (const kind of [
    "invalid",
    "unavailable",
    "conflict",
    "stale",
    "capacity",
  ]) {
    const error = new imported.NativeDrawingDwgResaveJobError(kind);
    assert.equal(error.kind, kind);
    assert.equal(error.message, `Native DWG resave ${kind}.`);
    assert.equal(error.name, "NativeDrawingDwgResaveJobError");
  }
});
test("worker once uses exact claim RPC, validates claim, and settles a claim received during shutdown", async () => {
  assert.equal(typeof entry.runNativeDrawingDwgResaveWorkerOnce, "function");
  const config = entry.parseNativeDrawingDwgResaveWorkerConfig(env);
  const stop = new AbortController();
  const calls = [];
  const dependencies = {
    serviceClient: {
      rpc(name, args) {
        calls.push({ name, args });
        return {
          abortSignal: async () => {
            if (name === "lukas_drawing_claim_native_dwg_resave") {
              stop.abort();
              return { data: f.claim, error: null };
            }
            if (name === "lukas_drawing_native_dwg_resave_control") {
              return {
                data: {
                  jobId: f.claim.jobId,
                  attemptNumber: 2,
                  leaseToken: f.claim.leaseToken,
                  action: "continue",
                  reason: null,
                },
                error: null,
              };
            }
            return {
              data: {
                jobId: f.claim.jobId,
                attemptNumber: 2,
                leaseToken: f.claim.leaseToken,
                status: "retry_wait",
              },
              error: null,
            };
          },
        };
      },
    },
    downloadSource: () => assert.fail("shutdown downloaded source"),
    storage: {
      upload: () => assert.fail("shutdown uploaded"),
      read: () => assert.fail("shutdown read"),
    },
    signal: stop.signal,
  };
  const result = await entry.runNativeDrawingDwgResaveWorkerOnce(
    config,
    dependencies,
  );
  assert.deepEqual(result, { outcome: "retry_scheduled" });
  assert.deepEqual(calls[0], {
    name: "lukas_drawing_claim_native_dwg_resave",
    args: { p_resaver_image_id: f.imageId, p_lease_seconds: 900 },
  });
  assert.ok(
    calls.some((c) => c.name === "lukas_drawing_fail_native_dwg_resave"),
  );
  calls.length = 0;
  assert.deepEqual(
    await entry.runNativeDrawingDwgResaveWorkerOnce(config, dependencies),
    { outcome: "idle" },
  );
  assert.equal(calls.length, 0);
  for (const data of [
    undefined,
    { jobId: f.claim.jobId },
    { ...f.claim, actorId: "invalid" },
  ]) {
    const names = [];
    assert.deepEqual(
      await entry.runNativeDrawingDwgResaveWorkerOnce(config, {
        ...dependencies,
        signal: undefined,
        serviceClient: {
          rpc(name) {
            names.push(name);
            return { abortSignal: async () => ({ data, error: null }) };
          },
        },
      }),
      { outcome: "control_uncertain" },
    );
    assert.deepEqual(names, ["lukas_drawing_claim_native_dwg_resave"]);
  }
});
test("actual strip-only Node CLI claims idle and SIGTERM exits cleanly with outcome-only sanitized logs", async (t) => {
  const calls = [];
  let child;
  const server = httpServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    calls.push({
      url: req.url,
      method: req.method,
      body: JSON.parse(Buffer.concat(chunks)),
    });
    res.writeHead(200, { "content-type": "application/json" });
    res.end("null");
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  t.after(async () => {
    if (child?.exitCode === null && child?.signalCode === null)
      child.kill("SIGKILL");
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
  });
  child = spawn(
    process.execPath,
    ["--experimental-strip-types", "native-dwg-worker/src/resave.ts"],
    {
      cwd: fileURLToPath(new URL("..", import.meta.url)),
      env: {
        PATH: process.env.PATH,
        NODE_OPTIONS: "--no-experimental-webstorage",
        ...env,
        SUPABASE_URL: `http://127.0.0.1:${server.address().port}`,
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let stdout = "",
    stderr = "",
    sentStop = false;
  child.stdout.on("data", (b) => {
    stdout += b;
    if (!sentStop && stdout.includes('"outcome":"idle"')) {
      sentStop = true;
      child.kill("SIGTERM");
    }
  });
  child.stderr.on("data", (b) => (stderr += b));
  const result = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(Error("CLI timeout"));
    }, 5000);
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal });
    });
  });
  assert.deepEqual(result, { code: 0, signal: null });
  assert.equal(stderr, "");
  assert.deepEqual(stdout.trim().split("\n").map(JSON.parse), [
    { event: "native_dwg_resave_worker_started" },
    { event: "native_dwg_resave_worker_result", outcome: "idle" },
    { event: "native_dwg_resave_worker_stopped" },
  ]);
  assert.deepEqual(calls, [
    {
      url: "/rest/v1/rpc/lukas_drawing_claim_native_dwg_resave",
      method: "POST",
      body: { p_resaver_image_id: f.imageId, p_lease_seconds: 900 },
    },
  ]);
  assert.doesNotMatch(stdout, /test-secret|sha256|receipt|leaseToken/);
});

test("actual CLI source transport is wired and every immediate refusal turn gets a bounded poll wait", async (t) => {
  const calls = [];
  let child;
  let claimCount = 0;
  const identity = {
    jobId: f.claim.jobId,
    attemptNumber: 2,
    leaseToken: f.claim.leaseToken,
  };
  const server = httpServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks)) : null;
    calls.push({
      url: req.url,
      body,
      at: Date.now(),
      authorization: req.headers.authorization,
    });
    let value;
    if (req.url === "/rest/v1/rpc/lukas_drawing_claim_native_dwg_resave")
      value = ++claimCount === 1 ? f.claim : { invalid: true };
    else if (req.url === "/rest/v1/rpc/lukas_drawing_native_dwg_resave_control")
      value = { ...identity, action: "continue", reason: null };
    else if (req.url === "/rest/v1/rpc/lukas_drawing_fail_native_dwg_resave")
      value = { ...identity, status: "retry_wait" };
    else if (req.url === "/storage/v1/object/lukas-qto/owned/source.dwg") {
      res.writeHead(200, {
        "content-length": String(f.sourceBytes.byteLength),
      });
      res.end(f.sourceBytes);
      return;
    } else {
      res.writeHead(404);
      res.end();
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(value));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  t.after(async () => {
    if (child?.exitCode === null && child?.signalCode === null)
      child.kill("SIGKILL");
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
  });
  child = spawn(
    process.execPath,
    ["--experimental-strip-types", "native-dwg-worker/src/resave.ts"],
    {
      cwd: fileURLToPath(new URL("..", import.meta.url)),
      env: {
        PATH: process.env.PATH,
        NODE_OPTIONS: "--no-experimental-webstorage",
        ...env,
        SUPABASE_URL: `http://127.0.0.1:${server.address().port}`,
        NATIVE_DWG_RESAVE_POLL_MILLISECONDS: "100",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let stdout = "",
    stderr = "",
    stop = false;
  child.stdout.on("data", (b) => {
    stdout += b;
    if (!stop && stdout.split('"outcome":"control_uncertain"').length === 3) {
      stop = true;
      child.kill("SIGTERM");
    }
  });
  child.stderr.on("data", (b) => (stderr += b));
  const exit = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(Error(`CLI timeout: ${stdout} ${stderr}`));
    }, 10000);
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal });
    });
  });
  assert.deepEqual(exit, { code: 0, signal: null });
  assert.equal(stderr, "");
  assert.deepEqual(
    stdout
      .trim()
      .split("\n")
      .map(JSON.parse)
      .filter((v) => v.outcome)
      .map((v) => v.outcome),
    ["retry_scheduled", "control_uncertain", "control_uncertain"],
  );
  assert.equal(calls.filter((c) => c.url.startsWith("/storage/")).length, 1);
  assert.equal(
    calls.find((c) => c.url.startsWith("/storage/")).authorization,
    "Bearer test-secret",
  );
  assert.equal(
    calls.find((c) => c.url.endsWith("/lukas_drawing_fail_native_dwg_resave"))
      .body.p_failure_code,
    "resaver_failed",
  );
  const claims = calls.filter((c) =>
    c.url.endsWith("/lukas_drawing_claim_native_dwg_resave"),
  );
  assert.ok(
    claims[2].at - claims[1].at >= 90,
    "immediate refusal must wait before claiming again",
  );
  assert.equal(
    calls.filter(
      (c) =>
        c.url.includes("admit") ||
        c.url.includes("upload") ||
        c.url.includes("publish"),
    ).length,
    0,
  );
  assert.doesNotMatch(
    stdout,
    /test-secret|sha256:|leaseToken|owned\/source|receipt/,
  );
});
