import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import test from "node:test";

const storageModule = await import("../native-dwg-worker/src/supabase.ts");
function api() {
  for (const name of [
    "createNativeDwgResaveStorageTransport",
    "NativeDwgConfirmedUploadError",
    "NativeDwgUncertainUploadError",
  ])
    assert.ok(storageModule[name], `Required Storage API absent: ${name}`);
  return storageModule;
}
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const projectId = "94000000-0000-4000-8900-000000000001";
const jobId = "94000000-0000-4000-8900-000000000002";
const filenames = {
  dwg: "resaved.dwg",
  edit_request: "edit-request.json",
  authority: "authority.json",
  report: "native-report.json",
};
const pathFor = (kind, bytes) =>
  `projects/${projectId}/native-dwg-resave/${jobId}/2/${sha256(bytes)}/${filenames[kind]}`;
const signal = () => new AbortController().signal;

test("imported Storage uploads immutable copied bytes without upsert and reads full chunked bytes", async () => {
  const { createNativeDwgResaveStorageTransport: createTransport } = api();
  const sockets = new Set();
  const received = [];
  const stored = new Map();
  const server = createServer(async (request, response) => {
    if (request.method === "POST") {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const bytes = Buffer.concat(chunks);
      received.push({ headers: request.headers, bytes });
      stored.set(request.url, bytes);
      response.writeHead(200, { "content-type": "application/json" });
      response.write("{");
      return setImmediate(() => response.end("}"));
    }
    const bytes = stored.get(request.url);
    assert.ok(bytes);
    response.writeHead(200, { "content-type": "application/octet-stream" });
    response.write(bytes.subarray(0, 3));
    setImmediate(() => response.end(bytes.subarray(3)));
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.notEqual(address, null);
  try {
    const transport = createTransport(
      {
        supabaseUrl: `http://127.0.0.1:${address.port}`,
        serviceRoleKey: "service-secret",
      },
      {
        artifactLimits: {
          dwg: 64,
          edit_request: 64,
          authority: 64,
          report: 64,
        },
      },
    );
    const supplied = Buffer.from("AC1024immutable-upload");
    const expected = Buffer.from(supplied);
    const path = pathFor("dwg", supplied);
    const pending = transport.upload({
      kind: "dwg",
      path,
      bytes: supplied,
      signal: signal(),
    });
    supplied.fill(0);
    assert.equal(await pending, "uploaded");
    assert.equal(received[0].headers["x-upsert"], "false");
    assert.equal(
      received[0].headers["content-type"],
      "application/octet-stream",
    );
    assert.equal(received[0].headers.apikey, "service-secret");
    assert.deepEqual(received[0].bytes, expected);
    assert.deepEqual(
      Buffer.from(
        await transport.read({ kind: "dwg", path, signal: signal() }),
      ),
      expected,
    );
  } finally {
    for (const socket of sockets) socket.destroy();
    await new Promise((resolve) => server.close(resolve));
  }
});

test("classifies duplicate, definite refusal, disconnect and response-body uncertainty", async () => {
  const {
    createNativeDwgResaveStorageTransport: createTransport,
    NativeDwgConfirmedUploadError,
    NativeDwgUncertainUploadError,
  } = api();
  let mode = "duplicate";
  const sockets = new Set();
  const server = createServer(async (request, response) => {
    for await (const _chunk of request) void _chunk;
    if (mode === "disconnect") return request.socket.destroy();
    if (mode === "body-failure") {
      response.writeHead(200, { "content-type": "application/json" });
      response.write("{");
      return response.socket.destroy();
    }
    if (mode === "oversized-body") {
      response.writeHead(200, { "content-type": "application/json" });
      return response.end(Buffer.alloc(65537));
    }
    const status = mode === "duplicate" ? 409 : 503;
    response.writeHead(status, { "content-type": "application/json" });
    response.write(
      mode === "duplicate" ? '{"code":"Dupli' : '{"code":"Other",',
    );
    setImmediate(() =>
      response.end(mode === "duplicate" ? 'cate"}' : '"message":"no"}'),
    );
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.notEqual(address, null);
  const bytes = Buffer.from("{}");
  const input = {
    kind: "report",
    path: pathFor("report", bytes),
    bytes,
    signal: signal(),
  };
  try {
    const transport = createTransport({
      supabaseUrl: `http://127.0.0.1:${address.port}`,
      serviceRoleKey: "service-secret",
    });
    assert.equal(await transport.upload(input), "exists");
    mode = "refusal";
    await assert.rejects(
      transport.upload(input),
      NativeDwgConfirmedUploadError,
    );
    for (const uncertainMode of [
      "disconnect",
      "body-failure",
      "oversized-body",
    ]) {
      mode = uncertainMode;
      await assert.rejects(
        transport.upload(input),
        NativeDwgUncertainUploadError,
      );
    }
  } finally {
    for (const socket of sockets) socket.destroy();
    await new Promise((resolve) => server.close(resolve));
  }
});

test("distinguishes definite pre-send throws from rejected POST promises", async () => {
  const {
    createNativeDwgResaveStorageTransport: createTransport,
    NativeDwgConfirmedUploadError,
    NativeDwgUncertainUploadError,
  } = api();
  const bytes = Buffer.from("{}");
  const input = {
    kind: "report",
    path: pathFor("report", bytes),
    bytes,
    signal: signal(),
  };
  const config = {
    supabaseUrl: "https://storage.test",
    serviceRoleKey: "secret",
  };
  const beforeSend = createTransport(config, {
    fetch() {
      throw new Error("not sent");
    },
  });
  await assert.rejects(beforeSend.upload(input), NativeDwgConfirmedUploadError);
  const unknown = createTransport(config, {
    fetch() {
      return Promise.reject(new Error("unknown"));
    },
  });
  await assert.rejects(unknown.upload(input), NativeDwgUncertainUploadError);
});

test("enforces imported profile paths, hashes, kinds and lowered per-kind caps", async () => {
  const {
    createNativeDwgResaveStorageTransport: createTransport,
    createNativeDwgStorageTransport: createLegacy,
    NativeDwgConfirmedUploadError,
  } = api();
  const bytes = Buffer.from("{}");
  let fetchCalls = 0;
  const runtime = {
    artifactLimits: { dwg: 8, edit_request: 2, authority: 2, report: 2 },
    fetch() {
      fetchCalls++;
      return Promise.resolve(new Response("{}"));
    },
  };
  const transport = createTransport(
    { supabaseUrl: "https://storage.test", serviceRoleKey: "secret" },
    runtime,
  );
  for (const input of [
    { kind: "source_manifest", path: pathFor("report", bytes), bytes },
    {
      kind: "report",
      path: `projects/${projectId}/native-dwg/${jobId}/2/${sha256(bytes)}/native-report.json`,
      bytes,
    },
    { kind: "report", path: pathFor("authority", bytes), bytes },
    { kind: "report", path: pathFor("report", Buffer.from("other")), bytes },
    {
      kind: "report",
      path: pathFor("report", bytes),
      bytes: Buffer.from("123"),
    },
  ])
    await assert.rejects(
      transport.upload({ ...input, signal: signal() }),
      NativeDwgConfirmedUploadError,
    );
  assert.equal(fetchCalls, 0);
  assert.throws(() =>
    createTransport(
      { supabaseUrl: "https://storage.test", serviceRoleKey: "secret" },
      { artifactLimits: { report: 1048577 } },
    ),
  );
  const legacy = createLegacy(
    { supabaseUrl: "https://storage.test", serviceRoleKey: "secret" },
    { fetch: runtime.fetch, artifactLimits: { report: 2 } },
  );
  assert.equal(
    await legacy.upload({
      kind: "report",
      path: "legacy/arbitrary-safe-path",
      bytes,
      signal: signal(),
    }),
    "uploaded",
  );
  await assert.rejects(
    legacy.upload({
      kind: "edit_request",
      path: pathFor("edit_request", bytes),
      bytes,
      signal: signal(),
    }),
  );
});

test("bounds imported read streams at the lowered cap", async () => {
  const { createNativeDwgResaveStorageTransport: createTransport } = api();
  const sockets = new Set();
  let oversizedClosed = false;
  const server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "application/octet-stream" });
    response.on("close", () => {
      oversizedClosed = true;
    });
    response.write(Buffer.alloc(9));
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.notEqual(address, null);
  const bytes = Buffer.from("AC1024xx");
  try {
    const transport = createTransport(
      {
        supabaseUrl: `http://127.0.0.1:${address.port}`,
        serviceRoleKey: "service-secret",
      },
      { artifactLimits: { dwg: 8 } },
    );
    await assert.rejects(
      transport.read({
        kind: "dwg",
        path: pathFor("dwg", bytes),
        signal: signal(),
      }),
      /readback failed/,
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(oversizedClosed, true);
  } finally {
    for (const socket of sockets) socket.destroy();
    await new Promise((resolve) => server.close(resolve));
  }
});
