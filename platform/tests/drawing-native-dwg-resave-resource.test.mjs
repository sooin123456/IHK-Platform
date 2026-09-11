import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer as httpServer } from "node:http";
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
  plugins: [
    {
      name: "context",
      enforce: "pre",
      resolveId(s) {
        if (s.endsWith("lukas/lib/drawing-collaboration.server"))
          return "\0context";
      },
      load(id) {
        if (id === "\0context")
          return "export const drawingContext = (...args) => globalThis.__resaveContext(...args);";
      },
    },
  ],
  server: { middlewareMode: true },
});
test.after(() => {
  delete globalThis.__resaveContext;
  return vite.close();
});
const resource = await vite
  .ssrLoadModule("/app/lukas/lib/drawing-native-dwg-resave-resource.server.ts")
  .catch(() => ({}));
const download = await vite
  .ssrLoadModule("/app/lukas/lib/drawing-native-dwg-resave-download.server.ts")
  .catch(() => ({}));
const { buildNativeDrawingDwgResaveAttestation: build } =
  await vite.ssrLoadModule(
    "/app/lukas/lib/drawing-native-dwg-resave-attestation.server.ts",
  );
const core = await vite.ssrLoadModule(
  "/app/lukas/lib/drawing-native-dwg-resave-artifacts.server.ts",
);
const f = await resaveArtifactFixture(build);
const { metadata, bytesByKind } =
  await core.buildNativeDrawingDwgResaveArtifacts(f.claim, f.result, f.imageId);
const { scope, jobId, actorId, attemptNumber } = f.claim;
const requestId = "91000000-0000-4000-8000-000000000098";
const accepted = { jobId, requestId, hasChanges: true };
const status = {
  ...accepted,
  status: "completed",
  attemptCount: 2,
  failureCode: null,
};

test("framework resources expose loader/action delegates and preserve bounded authenticated context errors", async () => {
  const screen = await vite.ssrLoadModule(
    "/app/lukas/screens/drawing-native-dwg-resave.ts",
  );
  const downloadScreen = await vite.ssrLoadModule(
    "/app/lukas/screens/drawing-native-dwg-resave-download.ts",
  );
  assert.deepEqual(Object.keys(screen).sort(), ["action", "loader"]);
  assert.deepEqual(Object.keys(downloadScreen), ["loader"]);
  const d = deps({ status: null });
  globalThis.__resaveContext = async (request, projectId) => {
    assert.equal(projectId, scope.projectId);
    return { client: d.client, headers: d.headers };
  };
  const response = await screen.loader({
    request: new Request(`${url}?${query}`),
    params: { projectId: scope.projectId, workspaceId: scope.documentId },
  });
  assert.deepEqual(await response.json(), { job: null, receipt: null });
  globalThis.__resaveContext = async () => {
    throw new Response("private SQL credentials", {
      status: 401,
      headers: { "set-cookie": "session=expired; HttpOnly" },
    });
  };
  try {
    await screen.loader({
      request: new Request(url),
      params: { projectId: scope.projectId, workspaceId: scope.documentId },
    });
    assert.fail("expected rejection");
  } catch (error) {
    assert.equal(error.status, 401);
    assert.equal(error.headers.get("set-cookie"), "session=expired; HttpOnly");
    assert.doesNotMatch(await error.text(), /private|credentials|SQL/);
  }
});
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
  createdAt: "2026-09-06T00:00:00Z",
};
const query = new URLSearchParams({
  revisionId: scope.revisionId,
  revisionVersion: String(scope.revisionVersion),
  canvasId: scope.canvasId,
  snapshotSha256: scope.snapshotSha256,
});
const url = `http://localhost/projects/${scope.projectId}/workspaces/${scope.documentId}/native-dwg-resave`;
const descriptor = {
  jobId,
  attemptNumber,
  kind: "dwg",
  bucket: "lukas-qto",
  ...metadata[0],
  path: `projects/${scope.projectId}/native-dwg-resave/${jobId}/2/${metadata[0].sha256}/resaved.dwg`,
};
function deps(options = {}) {
  const calls = [];
  let descriptors = 0,
    loads = 0;
  const client = {
    auth: {
      getUser: async () => ({ data: { user: { id: actorId } }, error: null }),
    },
    rpc(name, args) {
      calls.push({ name, args });
      return {
        abortSignal: async () => {
          if (name === "lukas_qto_drawing_native_dwg_resave_source")
            return { data: f.claim.payload, error: null };
          if (name === "lukas_drawing_native_dwg_resave_receipt")
            return { data: options.receipt ?? receipt, error: null };
          if (name === "lukas_drawing_native_dwg_resave_download_descriptor")
            return ++descriptors === 2 && options.revoke
              ? { data: null, error: { code: "forbidden" } }
              : { data: descriptor, error: null };
          return {
            data: Object.hasOwn(options, "status") ? options.status : status,
            error: null,
          };
        },
      };
    },
  };
  const service = {
    rpc(name, args) {
      calls.push({ name, args });
      return { abortSignal: async () => ({ data: accepted, error: null }) };
    },
    storage: {
      from(bucket) {
        assert.equal(bucket, "lukas-qto");
        return {
          download(path, _options, { signal }) {
            assert.equal(path, descriptor.path);
            return {
              asStream: () =>
                options.stream
                  ? options.stream(signal)
                  : Promise.resolve({
                      data: new Blob([bytesByKind.dwg]).stream(),
                      error: null,
                    }),
            };
          },
        };
      },
    },
  };
  return {
    client,
    headers: new Headers({ "x-auth-test": "preserved" }),
    projectId: scope.projectId,
    workspaceId: scope.documentId,
    imageId: f.imageId,
    loadServiceClient: async () => {
      loads++;
      return service;
    },
    calls,
    get loads() {
      return loads;
    },
  };
}
function post(body, headers = {}) {
  return new Request(url, {
    method: "POST",
    headers: {
      origin: "http://localhost",
      "content-type": "application/json",
      ...headers,
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}
const rejected = (code) => async (e) => {
  assert.ok(e instanceof Response);
  assert.equal(e.status, code);
  assert.equal(e.headers.get("cache-control"), "private, no-store");
  assert.doesNotMatch(await e.text(), /private|lukas_|sha256:/);
  return true;
};
async function reject(promise, code) {
  try {
    await promise;
    assert.fail("expected rejection");
  } catch (e) {
    await rejected(code)(e);
  }
}
test("resource admits strict authenticated intent via actual compiler and trusted image", async () => {
  assert.equal(
    typeof resource.handleNativeDrawingDwgResaveResource,
    "function",
  );
  const d = deps();
  const r = await resource.handleNativeDrawingDwgResaveResource({
    ...d,
    request: post({ intent: "request", ...scope, requestId }),
  });
  assert.equal(r.status, 202);
  assert.deepEqual(await r.json(), accepted);
  assert.equal(d.loads, 1);
  const admitted = d.calls.find(
    (c) => c.name === "lukas_drawing_admit_native_dwg_resave",
  );
  assert.equal(admitted.args.p_actor_id, actorId);
  assert.equal(admitted.args.p_attestation.resaverImageId, f.imageId);
  assert.equal(admitted.args.p_request_id, requestId);
  assert.equal("intent" in admitted.args.p_scope, false);
});
test("resource rejects origin, media, overflow, malformed UTF8, extra authority, route and query identities", async () => {
  const body = { intent: "request", ...scope, requestId };
  for (const request of [
    post(body, { origin: "http://evil.test" }),
    post(body, { origin: "" }),
  ])
    await reject(
      resource.handleNativeDrawingDwgResaveResource({ ...deps(), request }),
      403,
    );
  for (const request of [
    post(body, { "content-type": "text/plain" }),
    post("{"),
    post({ ...body, actorId }),
    post({ ...body, resaverImageId: f.imageId }),
    post({ ...body, path: "private" }),
    post({ ...body, intent: "other" }),
    new Request(url, {
      method: "POST",
      headers: {
        origin: "http://localhost",
        "content-type": "application/json",
      },
      body: new Uint8Array([0xff]),
    }),
  ])
    await reject(
      resource.handleNativeDrawingDwgResaveResource({ ...deps(), request }),
      400,
    );
  await reject(
    resource.handleNativeDrawingDwgResaveResource({
      ...deps(),
      request: post(" ".repeat(4097)),
    }),
    413,
  );
  await reject(
    resource.handleNativeDrawingDwgResaveResource({
      ...deps(),
      workspaceId: jobId,
      request: post(body),
    }),
    409,
  );
  for (const suffix of ["&unknown=x", "&revisionVersion=2", "&jobId=invalid"])
    await reject(
      resource.handleNativeDrawingDwgResaveResource({
        ...deps(),
        request: new Request(`${url}?${query}${suffix}`),
      }),
      400,
    );
  const d = deps();
  await reject(
    resource.handleNativeDrawingDwgResaveResource({
      ...d,
      imageId: undefined,
      request: post(body),
    }),
    503,
  );
  assert.equal(d.loads, 0);
});
test("GET idle and pending omit receipt; completed reads exact receipt; cancel needs no admin/image", async () => {
  for (const job of [null, { ...status, status: "processing" }, status]) {
    const d = deps({ status: job });
    const r = await resource.handleNativeDrawingDwgResaveResource({
      ...d,
      imageId: undefined,
      request: new Request(`${url}?${query}`),
    });
    assert.deepEqual(await r.json(), {
      job,
      receipt: job?.status === "completed" ? receipt : null,
    });
    assert.equal(d.loads, 0);
    assert.equal(
      d.calls.filter((c) => c.name.includes("receipt")).length,
      job?.status === "completed" ? 1 : 0,
    );
  }
  const d = deps({ status: { ...status, status: "cancel_requested" } });
  const r = await resource.handleNativeDrawingDwgResaveResource({
    ...d,
    imageId: undefined,
    request: post({ intent: "cancel", ...scope, jobId }),
  });
  assert.equal((await r.json()).job.status, "cancel_requested");
  assert.equal(d.loads, 0);
  assert.equal(d.calls[0].name, "lukas_drawing_cancel_native_dwg_resave");
  await reject(
    resource.handleNativeDrawingDwgResaveResource({
      ...deps({
        receipt: { ...receipt, scope: { ...scope, documentId: jobId } },
      }),
      request: new Request(`${url}?${query}`),
    }),
    400,
  );
});
function getDownload(
  d = deps(),
  request = new Request(`${url}/${jobId}/download/dwg?${query}`),
  runtime,
) {
  return download.handleNativeDrawingDwgResaveDownload(
    { ...d, request, scope, jobId, kind: "dwg" },
    runtime,
  );
}
test("download returns copied hash-verified bytes only after second authorization and never leaks locator", async () => {
  assert.equal(
    typeof download.handleNativeDrawingDwgResaveDownload,
    "function",
  );
  const d = deps();
  const r = await getDownload(d);
  assert.equal(r.headers.get("cache-control"), "private, no-store");
  assert.equal(r.headers.get("referrer-policy"), "no-referrer");
  assert.equal(r.headers.get("x-content-type-options"), "nosniff");
  assert.equal(r.headers.get("x-auth-test"), "preserved");
  assert.match(r.headers.get("content-disposition"), /^attachment;/);
  assert.equal(
    createHash("sha256")
      .update(Buffer.from(await r.arrayBuffer()))
      .digest("hex"),
    metadata[0].sha256,
  );
  assert.equal(d.calls.length, 2);
  await reject(getDownload(deps({ revoke: true })), 404);
  await reject(
    getDownload(
      deps({
        stream: async () => ({
          data: new Blob(["wrong"]).stream(),
          error: null,
        }),
      }),
    ),
    503,
  );
  const mutable = new Uint8Array(bytesByKind.dwg);
  let n = 0;
  const stream = new ReadableStream(
    {
      pull(c) {
        if (n++ === 0) c.enqueue(mutable);
        else {
          mutable.fill(0);
          c.close();
        }
      },
    },
    { highWaterMark: 0 },
  );
  const copied = await getDownload(
    deps({ stream: async () => ({ data: stream, error: null }) }),
  );
  assert.equal(
    createHash("sha256")
      .update(Buffer.from(await copied.arrayBuffer()))
      .digest("hex"),
    metadata[0].sha256,
  );
});
test("download deadline returns despite abort-ignoring GET/body/cancel and actual stalled loopback body", async () => {
  for (const stream of [
    () => new Promise(() => {}),
    async () => ({
      data: new ReadableStream({
        pull() {
          return new Promise(() => {});
        },
        cancel() {
          return new Promise(() => {});
        },
      }),
      error: null,
    }),
  ]) {
    const started = Date.now();
    await reject(
      getDownload(deps({ stream }), undefined, { downloadMilliseconds: 30 }),
      503,
    );
    assert.ok(Date.now() - started < 1000);
  }
  const server = httpServer((_q, r) => {
    r.writeHead(200);
    r.write("AC1024");
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  try {
    await reject(
      getDownload(
        deps({
          stream: async (signal) => ({
            data: (
              await fetch(`http://127.0.0.1:${server.address().port}`, {
                signal,
              })
            ).body,
            error: null,
          }),
        }),
        undefined,
        { downloadMilliseconds: 60 },
      ),
      503,
    );
  } finally {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
  }
});
