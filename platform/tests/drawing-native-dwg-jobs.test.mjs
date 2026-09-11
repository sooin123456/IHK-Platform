import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer as createHttpServer } from "node:http";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { createServer } from "vite";
import { createClient } from "@supabase/supabase-js";

const contextKey = "__nativeDwgDrawingContext";
globalThis[contextKey] = () => {
  throw new Error("native DWG test context is not configured");
};

const vite = await createServer({
  appType: "custom",
  configFile: false,
  logLevel: "silent",
  plugins: [
    {
      enforce: "pre",
      load(id) {
        if (id === "\0virtual:native-dwg-context")
          return `export const drawingContext = (...args) => globalThis[${JSON.stringify(contextKey)}](...args);`;
      },
      name: "native-dwg-context",
      resolveId(source) {
        if (source.endsWith("lukas/lib/drawing-collaboration.server"))
          return "\0virtual:native-dwg-context";
      },
    },
  ],
  resolve: {
    alias: { "~": fileURLToPath(new URL("../app", import.meta.url)) },
  },
  server: { middlewareMode: true },
});

const jobs = await vite.ssrLoadModule(
  "/app/lukas/lib/drawing-native-dwg-jobs.server.ts",
);
const exportRoute = await vite.ssrLoadModule(
  "/app/lukas/lib/drawing-native-dwg-export.server.ts",
);
const downloadRoute = await vite.ssrLoadModule(
  "/app/lukas/lib/drawing-native-dwg-download.server.ts",
);
const exportResource = await vite.ssrLoadModule(
  "/app/lukas/screens/drawing-native-dwg-export.ts",
);
const downloadResource = await vite.ssrLoadModule(
  "/app/lukas/screens/drawing-native-dwg-download.ts",
);

test("native DWG resource routes expose only framework server entrypoints", () => {
  assert.deepEqual(Object.keys(exportResource).sort(), ["action", "loader"]);
  assert.deepEqual(Object.keys(downloadResource).sort(), ["loader"]);
});

test.after(async () => {
  delete globalThis[contextKey];
  await vite.close();
});

const ids = Object.freeze({
  project: "81000000-0000-4000-8000-000000000001",
  document: "81000000-0000-4000-8000-000000000002",
  revision: "81000000-0000-4000-8000-000000000003",
  canvas: "81000000-0000-4000-8000-000000000004",
  request: "81000000-0000-4000-8000-000000000005",
  job: "81000000-0000-4000-8000-000000000006",
});
const scope = Object.freeze({
  projectId: ids.project,
  documentId: ids.document,
  revisionId: ids.revision,
  revisionVersion: 7,
  canvasId: ids.canvas,
  snapshotSha256: "a".repeat(64),
});
const artifact = (kind, sha256 = "b".repeat(64), byteSize = 12) => ({
  kind,
  sha256,
  byteSize,
});
const receipt = Object.freeze({
  jobId: ids.job,
  attempt: 2,
  qualification: "experimental-unqualified",
  source: scope,
  writerBuildSha256: "c".repeat(64),
  structureSha256: "d".repeat(64),
  artifacts: [
    artifact("dwg"),
    artifact("source_manifest", "e".repeat(64), 13),
    artifact("authority", "f".repeat(64), 14),
    artifact("report", "0".repeat(64), 15),
  ],
  createdAt: "2026-09-06T01:02:03.000Z",
});

function rpcClient(value, expectedName, expectedArgs) {
  return {
    async rpc(name, args) {
      assert.equal(name, expectedName);
      assert.deepEqual(args, expectedArgs);
      return { data: value, error: null };
    },
  };
}

test("user helpers validate exact DTOs and send only the approved RPC arguments", async () => {
  assert.deepEqual(
    await jobs.requestNativeDrawingDwgExport(
      rpcClient(
        { accepted: true, jobId: ids.job, requestId: ids.request },
        "lukas_drawing_request_native_dwg_export",
        { p_scope: scope, p_request_id: ids.request },
      ),
      { ...scope, requestId: ids.request },
    ),
    { accepted: true, jobId: ids.job, requestId: ids.request },
  );
  const status = {
    jobId: ids.job,
    status: "completed",
    attemptCount: 2,
    lastErrorCode: null,
    createdAt: "2026-09-06T01:00:00.000Z",
    qualification: "experimental-unqualified",
    receipt,
  };
  assert.deepEqual(
    await jobs.getNativeDrawingDwgExportStatus(
      rpcClient(status, "lukas_drawing_native_dwg_export_status", {
        p_scope: scope,
        p_job_id: ids.job,
      }),
      scope,
      ids.job,
    ),
    status,
  );
});

test("strict scope and artifact validation rejects unknown input before transport", async () => {
  let calls = 0;
  const client = { rpc: async () => (calls += 1) };
  await assert.rejects(
    jobs.requestNativeDrawingDwgExport(client, {
      ...scope,
      requestId: ids.request,
      storagePath: "attacker/path",
    }),
    /invalid native DWG/i,
  );
  await assert.rejects(
    jobs.resolveNativeDrawingDwgDownload(client, scope, ids.job, "signed_url"),
    /invalid native DWG/i,
  );
  assert.equal(calls, 0);
});

test("request route enforces method, exact origin, body bound, and route scope", async () => {
  const client = rpcClient(
    { accepted: true, jobId: ids.job, requestId: ids.request },
    "lukas_drawing_request_native_dwg_export",
    { p_scope: scope, p_request_id: ids.request },
  );
  const headers = new Headers({ "Set-Cookie": "auth=refreshed; Path=/" });
  const make = (body, init = {}) =>
    new Request(
      `https://app.test/projects/${ids.project}/workspaces/${ids.document}/native-dwg`,
      {
        body: JSON.stringify(body),
        headers: {
          "Content-Type": "application/json",
          Origin: "https://app.test",
        },
        method: "POST",
        ...init,
      },
    );
  const response = await exportRoute.handleNativeDrawingDwgExportRequest({
    client,
    headers,
    projectId: ids.project,
    request: make({ ...scope, requestId: ids.request }),
    workspaceId: ids.document,
  });
  assert.equal(response.status, 202);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.match(response.headers.get("set-cookie"), /auth=refreshed/);
  assert.deepEqual(await response.json(), {
    accepted: true,
    jobId: ids.job,
    requestId: ids.request,
  });

  for (const request of [
    new Request("https://app.test/x", { method: "DELETE" }),
    make(
      { ...scope, requestId: ids.request },
      {
        headers: {
          Origin: "https://evil.test",
          "Content-Type": "application/json",
        },
      },
    ),
    make({
      ...scope,
      projectId: "81000000-0000-4000-8000-000000000099",
      requestId: ids.request,
    }),
    make({ ...scope, requestId: ids.request, path: "attacker" }),
    make({ filler: "x".repeat(20_000) }),
  ]) {
    await assert.rejects(
      exportRoute.handleNativeDrawingDwgExportRequest({
        client,
        headers: new Headers(),
        projectId: ids.project,
        request,
        workspaceId: ids.document,
      }),
      (error) =>
        error instanceof Response &&
        [400, 403, 405, 409, 413].includes(error.status),
    );
  }
});

test("status route accepts only exact query scope and returns durable no-store state", async () => {
  let queryError;
  const status = {
    jobId: ids.job,
    status: "retry_wait",
    attemptCount: 1,
    lastErrorCode: "upload_failed",
    createdAt: "2026-09-06T01:00:00.000Z",
    qualification: "experimental-unqualified",
    receipt: null,
  };
  const url = new URL(
    `https://app.test/projects/${ids.project}/workspaces/${ids.document}/native-dwg`,
  );
  url.search = new URLSearchParams({
    revisionId: ids.revision,
    revisionVersion: "7",
    canvasId: ids.canvas,
    snapshotSha256: scope.snapshotSha256,
    jobId: ids.job,
  }).toString();
  const response = await exportRoute.handleNativeDrawingDwgExportRequest({
    client: rpcClient(status, "lukas_drawing_native_dwg_export_status", {
      p_scope: scope,
      p_job_id: ids.job,
    }),
    headers: new Headers(),
    projectId: ids.project,
    request: new Request(url),
    workspaceId: ids.document,
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(await response.json(), status);

  url.searchParams.append("canvasId", ids.canvas);
  await assert.rejects(
    exportRoute.handleNativeDrawingDwgExportRequest({
      client: { rpc: () => assert.fail("invalid query reached RPC") },
      headers: new Headers(),
      projectId: ids.project,
      request: new Request(url),
      workspaceId: ids.document,
    }),
    (error) => error instanceof Response && error.status === 400,
  );

  url.searchParams.delete("canvasId");
  url.searchParams.set("canvasId", ids.canvas);
  url.searchParams.set("revisionVersion", "7e0");
  await assert.rejects(
    exportRoute.handleNativeDrawingDwgExportRequest({
      client: { rpc: () => assert.fail("non-canonical query reached RPC") },
      headers: new Headers({ "Set-Cookie": "auth=query; Path=/" }),
      projectId: ids.project,
      request: new Request(url),
      workspaceId: ids.document,
    }),
    (error) => ((queryError = error), error instanceof Response),
  );
  assert.equal(queryError.status, 400);
  assert.equal(queryError.headers.get("cache-control"), "private, no-store");
  assert.match(queryError.headers.get("set-cookie"), /auth=query/);
  assert.doesNotMatch(await queryError.text(), /7e0|SQL|path/i);
});

function descriptor(kind, bytes) {
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const filename = {
    dwg: "native.dwg",
    source_manifest: "source-manifest.json",
    authority: "authority.json",
    report: "native-report.json",
  }[kind];
  return {
    jobId: ids.job,
    kind,
    bucket: "lukas-qto",
    path: `projects/${ids.project}/native-dwg/${ids.job}/2/${sha256}/${filename}`,
    sha256,
    byteSize: bytes.byteLength,
  };
}

function validDownloadRequest() {
  return new Request(
    `https://app.test/download?revisionId=${ids.revision}&revisionVersion=7&canvasId=${ids.canvas}&snapshotSha256=${scope.snapshotSha256}`,
  );
}

test("download verifies the exact managed object then reauthorizes before attachment", async () => {
  const bytes = new TextEncoder().encode("verified native drawing");
  const expected = descriptor("dwg", bytes);
  let descriptorCalls = 0;
  const client = {
    async rpc(name, args) {
      descriptorCalls += 1;
      assert.equal(name, "lukas_drawing_native_dwg_download_descriptor");
      assert.deepEqual(args, {
        p_scope: scope,
        p_job_id: ids.job,
        p_kind: "dwg",
      });
      return { data: expected, error: null };
    },
  };
  let storageReads = 0;
  const serviceClient = {
    storage: {
      from(bucket) {
        assert.equal(bucket, "lukas-qto");
        return {
          download(path) {
            storageReads += 1;
            assert.equal(path, expected.path);
            return {
              async asStream() {
                return {
                  data: new Blob([bytes]).stream(),
                  error: null,
                };
              },
            };
          },
        };
      },
    },
  };
  const response = await downloadRoute.handleNativeDrawingDwgDownload({
    client,
    headers: new Headers({ "Set-Cookie": "auth=again; Path=/" }),
    jobId: ids.job,
    kind: "dwg",
    loadServiceClient: async () => serviceClient,
    projectId: ids.project,
    request: validDownloadRequest(),
    scope,
    workspaceId: ids.document,
  });
  assert.equal(descriptorCalls, 2);
  assert.equal(storageReads, 1);
  assert.equal(response.headers.get("content-type"), "application/acad");
  assert.equal(
    response.headers.get("content-disposition"),
    'attachment; filename="drawing-experimental.dwg"',
  );
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), bytes);
});

test("download route accepts GET with only the four query scope fields", async () => {
  const base = `https://app.test/projects/${ids.project}/workspaces/${ids.document}/native-dwg/${ids.job}/download/dwg?revisionId=${ids.revision}&revisionVersion=7&canvasId=${ids.canvas}&snapshotSha256=${scope.snapshotSha256}`;
  for (const request of [
    new Request(base, { method: "POST" }),
    new Request(`${base}&jobId=${ids.job}`),
  ]) {
    await assert.rejects(
      downloadRoute.handleNativeDrawingDwgDownload({
        client: { rpc: () => assert.fail("invalid download reached RPC") },
        headers: new Headers({ "Set-Cookie": "auth=download; Path=/" }),
        jobId: ids.job,
        kind: "dwg",
        loadServiceClient: async () =>
          assert.fail("invalid download reached Storage"),
        projectId: ids.project,
        request,
        scope,
        workspaceId: ids.document,
      }),
      (error) => error instanceof Response && [400, 405].includes(error.status),
    );
  }
});

test("missing receipt, unknown kind, malformed path and hash mismatch never leak Storage bytes", async () => {
  let serviceLoads = 0;
  const loadServiceClient = async () => {
    serviceLoads += 1;
    return {
      storage: {
        from() {
          return { download: () => assert.fail("forbidden Storage read") };
        },
      },
    };
  };
  for (const [client, kind, wantedStatus] of [
    [{ rpc: async () => ({ data: null, error: { code: "PNJ01" } }) }, "dwg"],
    [{ rpc: async () => assert.fail("unknown kind reached RPC") }, "zip", 400],
    [
      {
        rpc: async () => ({
          data: {
            ...descriptor("report", new Uint8Array([1])),
            path: "attacker/path",
          },
          error: null,
        }),
      },
      "report",
      503,
    ],
    [
      {
        rpc: async () => ({
          data: {
            ...descriptor("dwg", new Uint8Array([1])),
            byteSize: 100 * 1024 * 1024 + 1,
          },
          error: null,
        }),
      },
      "dwg",
      503,
    ],
    [
      {
        rpc: async () => {
          const value = descriptor("source_manifest", new Uint8Array([1]));
          return {
            data: {
              ...value,
              path: value.path.replace("/2/", "/4/"),
            },
            error: null,
          };
        },
      },
      "source_manifest",
      503,
    ],
  ]) {
    let rejection;
    await assert.rejects(
      downloadRoute.handleNativeDrawingDwgDownload({
        client,
        headers: new Headers(),
        jobId: ids.job,
        kind,
        loadServiceClient,
        projectId: ids.project,
        request: validDownloadRequest(),
        scope,
        workspaceId: ids.document,
      }),
      (error) => {
        rejection = error;
        return (
          error instanceof Response && [400, 404, 503].includes(error.status)
        );
      },
    );
    if (wantedStatus) assert.equal(rejection.status, wantedStatus);
  }
  assert.equal(serviceLoads, 0);

  const expected = descriptor("authority", new Uint8Array([1, 2, 3]));
  await assert.rejects(
    downloadRoute.handleNativeDrawingDwgDownload({
      client: { rpc: async () => ({ data: expected, error: null }) },
      headers: new Headers(),
      jobId: ids.job,
      kind: "authority",
      loadServiceClient: async () => ({
        storage: {
          from: () => ({
            download: () => ({
              asStream: async () => ({
                data: new Blob([[9, 9, 9]]).stream(),
                error: null,
              }),
            }),
          }),
        },
      }),
      projectId: ids.project,
      request: validDownloadRequest(),
      scope,
      workspaceId: ids.document,
    }),
    (error) => error instanceof Response && error.status === 503,
  );
});

test("download rejects a revoked second authorization after verification without exposing bytes", async () => {
  let revokedError;
  const bytes = new TextEncoder().encode("verified before revocation");
  const expected = descriptor("report", bytes);
  let authorizations = 0;
  const headers = new Headers({ "Set-Cookie": "auth=rotated; Path=/" });
  await assert.rejects(
    downloadRoute.handleNativeDrawingDwgDownload({
      client: {
        async rpc() {
          authorizations += 1;
          return authorizations === 1
            ? { data: expected, error: null }
            : { data: null, error: { code: "PNJ01" } };
        },
      },
      headers,
      jobId: ids.job,
      kind: "report",
      loadServiceClient: async () => ({
        storage: {
          from: () => ({
            download: () => ({
              asStream: async () => ({
                data: new Blob([bytes]).stream(),
                error: null,
              }),
            }),
          }),
        },
      }),
      projectId: ids.project,
      request: validDownloadRequest(),
      scope,
      workspaceId: ids.document,
    }),
    (error) => ((revokedError = error), error instanceof Response),
  );
  assert.equal(revokedError.status, 404);
  assert.equal(revokedError.headers.get("cache-control"), "private, no-store");
  assert.equal(revokedError.headers.get("referrer-policy"), "no-referrer");
  assert.match(revokedError.headers.get("set-cookie"), /auth=rotated/);
  assert.doesNotMatch(await revokedError.text(), /verified before revocation/);
  assert.equal(authorizations, 2);
});

test("status helper rejects a receipt attached to another exact source", async () => {
  await assert.rejects(
    jobs.getNativeDrawingDwgExportStatus(
      {
        rpc: async () => ({
          data: {
            jobId: ids.job,
            status: "completed",
            attemptCount: 2,
            lastErrorCode: null,
            createdAt: "2026-09-06T01:00:00.000Z",
            qualification: "experimental-unqualified",
            receipt: {
              ...receipt,
              source: { ...scope, revisionVersion: 8 },
            },
          },
          error: null,
        }),
      },
      scope,
      ids.job,
    ),
    /invalid native DWG/i,
  );
});

test("route auth denial occurs before any service client creation and preserves bounded headers", async () => {
  let serviceLoads = 0;
  globalThis[contextKey] = async () => {
    throw new Response("not allowed", {
      status: 403,
      headers: { "Set-Cookie": "auth=expired; Path=/" },
    });
  };
  let denial;
  await assert.rejects(
    downloadResource.loader({
      request: new Request(
        `https://app.test/projects/${ids.project}/workspaces/${ids.document}/native-dwg/${ids.job}/download/dwg?revisionId=${ids.revision}&revisionVersion=7&canvasId=${ids.canvas}&snapshotSha256=${scope.snapshotSha256}`,
      ),
      params: {
        projectId: ids.project,
        workspaceId: ids.document,
        jobId: ids.job,
        kind: "dwg",
      },
      context: { loadServiceClient: () => (serviceLoads += 1) },
    }),
    (error) => (
      (denial = error), error instanceof Response && error.status === 403
    ),
  );
  assert.equal(serviceLoads, 0);
  assert.equal(denial.headers.get("cache-control"), "private, no-store");
  assert.equal(denial.headers.get("referrer-policy"), "no-referrer");
  assert.match(denial.headers.get("set-cookie"), /auth=expired/);
  assert.equal(await denial.text(), "not allowed");
});

test("download cancels real Storage HTTP before headers and during body on deadline or request abort", async () => {
  for (const phase of ["headers", "body"]) {
    for (const cause of ["deadline", "request"]) {
      const bytes = new Uint8Array([1, 2, 3]);
      const expected = descriptor("dwg", bytes);
      let closed = false;
      let release;
      const server = createHttpServer((_request, response) => {
        response.on("close", () => {
          closed = true;
        });
        if (phase === "body") {
          response.writeHead(200, { "Content-Type": "application/acad" });
          response.write(bytes.subarray(0, 1));
        }
        // The old unbounded implementation finishes successfully at this guard.
        release = setTimeout(
          () => response.end(phase === "body" ? bytes.subarray(1) : bytes),
          300,
        );
      });
      await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
      const serviceClient = createClient(
        `http://127.0.0.1:${server.address().port}`,
        "local-test-only",
        {
          auth: { persistSession: false, autoRefreshToken: false },
        },
      );
      const controller = new AbortController();
      const abortTimer =
        cause === "request" ? setTimeout(() => controller.abort(), 80) : null;
      let authorizations = 0;
      try {
        await assert.rejects(
          downloadRoute.handleNativeDrawingDwgDownload(
            {
              client: {
                rpc: async () => {
                  authorizations += 1;
                  return { data: expected, error: null };
                },
              },
              headers: new Headers(),
              jobId: ids.job,
              kind: "dwg",
              loadServiceClient: async () => serviceClient,
              projectId: ids.project,
              request: new Request(validDownloadRequest(), {
                signal: controller.signal,
              }),
              scope,
              workspaceId: ids.document,
            },
            { downloadMilliseconds: cause === "deadline" ? 80 : 1000 },
          ),
          (error) => error instanceof Response && error.status === 503,
          `${phase}/${cause}`,
        );
        await new Promise((resolve) => setTimeout(resolve, 20));
        assert.equal(
          closed,
          true,
          `${phase}/${cause}: actual HTTP connection closed`,
        );
        assert.equal(
          authorizations,
          1,
          "cancelled body must not reach final authorization",
        );
      } finally {
        clearTimeout(abortTimer);
        clearTimeout(release);
        server.closeAllConnections();
        await new Promise((resolve) => server.close(resolve));
      }
    }
  }
});
