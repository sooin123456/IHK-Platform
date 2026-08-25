import assert from "node:assert/strict";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { exportJWK, generateKeyPair, SignJWT } from "jose";
import * as Y from "yjs";

const configModule = await import("../collaboration/src/config.ts").catch(
  () => null,
);
const authModule = await import("../collaboration/src/auth.ts").catch(
  () => null,
);
const storageModule = await import("../collaboration/src/storage.ts").catch(
  () => null,
);
const serverModule = await import("../collaboration/src/server.ts").catch(
  () => null,
);

const ids = {
  project: "00000000-0000-4000-8000-000000000401",
  revision: "00000000-0000-4000-8000-000000000402",
  actor: "00000000-0000-4000-8000-000000000403",
  operation: "00000000-0000-4000-8000-000000000404",
  layer: "00000000-0000-4000-8000-000000000405",
};
const roomName = `drawing:${ids.project}:${ids.revision}`;
const supabaseUrl = "https://example.supabase.co";

function requireModules() {
  assert.ok(configModule, "collaboration config must exist");
  assert.ok(authModule, "collaboration auth must exist");
  assert.ok(storageModule, "collaboration storage must exist");
  assert.ok(serverModule, "collaboration server must exist");
  return { ...configModule, ...authModule, ...storageModule, ...serverModule };
}

async function signingFixture(algorithm = "RS256") {
  const pair = await generateKeyPair(algorithm);
  const publicJwk = await exportJWK(pair.publicKey);
  return {
    privateKey: pair.privateKey,
    jwks: {
      keys: [{ ...publicJwk, kid: "active", alg: algorithm, use: "sig" }],
    },
    async token(overrides = {}, options = {}) {
      const now = Math.floor(Date.now() / 1000);
      const claims = {
        sub: ids.actor,
        role: "authenticated",
        aud: "authenticated",
        is_anonymous: false,
        email: "editor@example.com",
        ...overrides,
      };
      return new SignJWT(claims)
        .setProtectedHeader({ alg: algorithm, kid: "active" })
        .setIssuer(options.issuer ?? `${supabaseUrl}/auth/v1`)
        .setIssuedAt(now)
        .setExpirationTime(options.expiration ?? now + 60)
        .sign(pair.privateKey);
    },
  };
}

function operation(overrides = {}) {
  return {
    clientOperationId: ids.operation,
    revisionId: ids.revision,
    actorId: ids.actor,
    schemaVersion: 1,
    type: "add_layer",
    baseVersions: {},
    forward: {
      type: "add_layer",
      layer: {
        id: ids.layer,
        name: "Annotations",
        visible: true,
        locked: false,
        version: 1,
      },
    },
    inverse: {},
    createdAt: "2026-08-26T00:00:00.000Z",
    ...overrides,
  };
}

function initializedDocument() {
  const doc = new Y.Doc();
  doc.getMap("serverMeta").set("schemaVersion", 1);
  doc.getMap("serverMeta").set("projectId", ids.project);
  doc.getMap("serverMeta").set("revisionId", ids.revision);
  doc.getMap("serverMeta").set("baseSnapshotSha256", "a".repeat(64));
  doc.getMap("serverMeta").set("baseOperationSequence", 0);
  doc.getMap("serverMeta").set("freezeState", "active");
  doc.getMap("serverMeta").set("freezeRequestId", null);
  doc.getArray("operationOrder");
  doc.getMap("operations");
  doc.getMap("operationStatus");
  return doc;
}

function appendUpdate(current, envelope = operation()) {
  const next = new Y.Doc();
  Y.applyUpdate(next, Y.encodeStateAsUpdate(current));
  next.transact(() => {
    next.getMap("operations").set(envelope.clientOperationId, envelope);
    next.getArray("operationOrder").push([envelope.clientOperationId]);
  });
  return Y.encodeStateAsUpdate(next, Y.encodeStateVector(current));
}

test("configuration fails closed without asymmetric auth and bounded service secrets", () => {
  const { parseDrawingCollaborationConfig } = requireModules();
  const valid = {
    NODE_ENV: "production",
    PORT: "1234",
    SUPABASE_URL: supabaseUrl,
    COLLABORATION_DATABASE_URL: "postgres://runtime:secret@db.internal/app",
    COLLABORATION_ALLOWED_ORIGINS: "https://app.example.com",
    COLLABORATION_INTERNAL_SECRET: "x".repeat(32),
  };
  assert.equal(parseDrawingCollaborationConfig(valid).port, 1234);
  for (const changed of [
    { SUPABASE_URL: "" },
    { COLLABORATION_DATABASE_URL: "" },
    { COLLABORATION_ALLOWED_ORIGINS: "" },
    { COLLABORATION_ALLOWED_ORIGINS: "*" },
    { COLLABORATION_INTERNAL_SECRET: "short" },
    { PORT: "0" },
  ]) {
    assert.throws(() =>
      parseDrawingCollaborationConfig({ ...valid, ...changed }),
    );
  }
});

test("JWT verification accepts RS256 and ES256 but rejects malformed claims and HS-only JWKS", async () => {
  const { verifyDrawingAccessToken } = requireModules();
  for (const algorithm of ["RS256", "ES256"]) {
    const fixture = await signingFixture(algorithm);
    const verified = await verifyDrawingAccessToken({
      token: await fixture.token(),
      supabaseUrl,
      jwks: fixture.jwks,
    });
    assert.equal(verified.userId, ids.actor);
    assert.equal(verified.email, "editor@example.com");
  }

  const fixture = await signingFixture();
  for (const token of [
    "bad-token",
    await fixture.token({ sub: "not-a-uuid" }),
    await fixture.token({ role: "anon" }),
    await fixture.token({ is_anonymous: true }),
    await fixture.token({ aud: "wrong" }),
    await fixture.token({}, { issuer: "https://wrong.example/auth/v1" }),
    await fixture.token({}, { expiration: Math.floor(Date.now() / 1000) - 1 }),
  ]) {
    await assert.rejects(() =>
      verifyDrawingAccessToken({ token, supabaseUrl, jwks: fixture.jwks }),
    );
  }
  const validToken = await fixture.token();
  await assert.rejects(() =>
    verifyDrawingAccessToken({
      token: validToken,
      supabaseUrl,
      jwks: { keys: [] },
    }),
  );
  await assert.rejects(() =>
    verifyDrawingAccessToken({
      token: validToken,
      supabaseUrl,
      jwks: { keys: [{ kty: "oct", k: "eA", alg: "HS256", kid: "legacy" }] },
    }),
  );
});

test("remote JWKS verification cache can be purged for signing-key rotation", async () => {
  const { createDrawingAccessTokenVerifier } = requireModules();
  const fixture = await signingFixture();
  let fetches = 0;
  const verifier = createDrawingAccessTokenVerifier({
    supabaseUrl,
    fetcher: async () => {
      fetches += 1;
      return new Response(JSON.stringify(fixture.jwks), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });
  const token = await fixture.token();
  await verifier.verify(token);
  await verifier.verify(token);
  assert.equal(fetches, 1);
  verifier.purge();
  await verifier.verify(token);
  assert.equal(fetches, 2);
});

test("room authorization binds verified user, origin, room and authoritative capability", async () => {
  const { authorizeDrawingRoom } = requireModules();
  const verifyToken = async () => ({ userId: ids.actor, email: null });
  const authorize = async () => ({
    capability: "editor",
    canWrite: true,
    revisionStatus: "draft",
  });
  const access = await authorizeDrawingRoom({
    token: "verified-by-injected-seam",
    origin: "https://app.example.com",
    roomName,
    allowedOrigins: new Set(["https://app.example.com"]),
    verifyToken,
    authorize,
  });
  assert.equal(access.userId, ids.actor);
  assert.equal(access.canWrite, true);
  assert.equal(access.projectId, ids.project);
  assert.equal(
    (
      await authorizeDrawingRoom({
        token: "x",
        origin: "https://app.example.com",
        roomName,
        allowedOrigins: new Set(["https://app.example.com"]),
        verifyToken,
        authorize: async () => ({
          capability: "reviewer",
          canWrite: false,
          revisionStatus: "draft",
        }),
      })
    ).canWrite,
    false,
  );

  await assert.rejects(() =>
    authorizeDrawingRoom({
      token: "x",
      origin: "https://evil.example",
      roomName,
      allowedOrigins: new Set(["https://app.example.com"]),
      verifyToken,
      authorize,
    }),
  );
  await assert.rejects(() =>
    authorizeDrawingRoom({
      token: "x",
      origin: "https://app.example.com",
      roomName: `${roomName}:extra`,
      allowedOrigins: new Set(["https://app.example.com"]),
      verifyToken,
      authorize,
    }),
  );
  await assert.rejects(() =>
    authorizeDrawingRoom({
      token: "x",
      origin: "https://app.example.com",
      roomName,
      allowedOrigins: new Set(["https://app.example.com"]),
      verifyToken,
      authorize: async () => {
        throw new Error("unavailable");
      },
    }),
  );
});

test("empty documents are initialized by the server and complete client updates are clone-validated", async () => {
  const {
    initializeDrawingCollaborationDocument,
    validateDrawingClientUpdate,
  } = requireModules();
  const empty = new Y.Doc();
  await initializeDrawingCollaborationDocument(empty, {
    projectId: ids.project,
    revisionId: ids.revision,
    bootstrap: async () => ({ sha256: "a".repeat(64), operationSequence: 0 }),
  });
  assert.equal(empty.getMap("serverMeta").get("projectId"), ids.project);

  const context = {
    userId: ids.actor,
    projectId: ids.project,
    revisionId: ids.revision,
    canWrite: true,
  };
  assert.doesNotThrow(() =>
    validateDrawingClientUpdate(empty, appendUpdate(empty), context),
  );
  assert.throws(() =>
    validateDrawingClientUpdate(
      empty,
      appendUpdate(empty, operation({ actorId: randomUUID() })),
      context,
    ),
  );
  assert.throws(() =>
    validateDrawingClientUpdate(empty, appendUpdate(empty), {
      ...context,
      canWrite: false,
    }),
  );
  assert.throws(() =>
    validateDrawingClientUpdate(
      empty,
      new Uint8Array(1024 * 1024 + 1),
      context,
    ),
  );

  const rewrite = new Y.Doc();
  Y.applyUpdate(rewrite, Y.encodeStateAsUpdate(empty));
  rewrite.getMap("serverMeta").set("freezeState", "frozen");
  assert.throws(() =>
    validateDrawingClientUpdate(
      empty,
      Y.encodeStateAsUpdate(rewrite, Y.encodeStateVector(empty)),
      context,
    ),
  );

  const existing = initializedDocument();
  Y.applyUpdate(existing, appendUpdate(existing));
  for (const mutate of [
    (candidate) =>
      candidate
        .getMap("operations")
        .set(
          ids.operation,
          operation({ createdAt: "2026-08-26T01:00:00.000Z" }),
        ),
    (candidate) => candidate.getMap("operations").delete(ids.operation),
    (candidate) => candidate.getArray("operationOrder").delete(0),
    (candidate) =>
      candidate.getMap("operationStatus").set(ids.operation, {
        operationId: ids.operation,
        status: "acked",
        authoritativeSequence: 1,
        resultVersions: {},
      }),
  ]) {
    const candidate = new Y.Doc();
    Y.applyUpdate(candidate, Y.encodeStateAsUpdate(existing));
    mutate(candidate);
    assert.throws(() =>
      validateDrawingClientUpdate(
        existing,
        Y.encodeStateAsUpdate(candidate, Y.encodeStateVector(existing)),
        context,
      ),
    );
  }
});

test("Awareness is bounded and identity is overwritten from verified context", () => {
  const { sanitizeDrawingAwarenessState } = requireModules();
  const value = sanitizeDrawingAwarenessState(
    {
      user: { id: randomUUID(), displayName: "spoof", color: "#ffffff" },
      pageId: null,
      canvasId: null,
      cursorWorld: { x: 1, y: 2 },
      selectedIds: [],
      activeTool: "select",
      softLocks: [],
      secret: "drop-me",
    },
    { userId: ids.actor, displayName: "Verified Editor", color: "#123456" },
  );
  assert.deepEqual(value.user, {
    id: ids.actor,
    displayName: "Verified Editor",
    color: "#123456",
  });
  assert.equal("secret" in value, false);
  assert.throws(() =>
    sanitizeDrawingAwarenessState(
      { ...value, selectedIds: Array.from({ length: 101 }, () => ids.layer) },
      value.user,
    ),
  );
});

test("storage retries transient reads and uses exact generation/SHA CAS without stale overwrite", async () => {
  const { createDrawingCollaborationStorage } = requireModules();
  let loads = 0;
  let storeAttempts = 0;
  const stores = [];
  const storage = createDrawingCollaborationStorage({
    database: {
      async load() {
        loads += 1;
        if (loads === 1)
          throw Object.assign(new Error("connection reset"), {
            code: "ECONNRESET",
          });
        return {
          yjsState: new Uint8Array([1]),
          generation: 4,
          sha256: "b".repeat(64),
          baseOperationSequence: 3,
        };
      },
      async store(input) {
        storeAttempts += 1;
        if (storeAttempts === 1)
          throw Object.assign(new Error("connection reset"), {
            code: "ECONNRESET",
          });
        stores.push(input);
        return { generation: 5, sha256: "c".repeat(64) };
      },
    },
    sleep: async () => {},
  });
  const scope = {
    userId: ids.actor,
    projectId: ids.project,
    revisionId: ids.revision,
  };
  await storage.load(scope);
  await storage.store({
    ...scope,
    state: new Uint8Array([2]),
    baseOperationSequence: 3,
  });
  assert.equal(loads, 2);
  assert.equal(storeAttempts, 2);
  assert.equal(stores[0].expectedGeneration, 4);
  assert.equal(stores[0].expectedSha256, "b".repeat(64));
});

test("a Task 3 CAS conflict reloads, merges, validates, and retries once", async () => {
  const { createDrawingCollaborationStorage, validatePersistedDrawingState } =
    requireModules();
  const remote = initializedDocument();
  const local = new Y.Doc();
  Y.applyUpdate(local, Y.encodeStateAsUpdate(remote));
  Y.applyUpdate(local, appendUpdate(local));
  let attempts = 0;
  const received = [];
  const storage = createDrawingCollaborationStorage({
    database: {
      load: async () => ({
        yjsState: Y.encodeStateAsUpdate(remote),
        generation: 4,
        sha256: "b".repeat(64),
        baseOperationSequence: 0,
      }),
      async store(input) {
        attempts += 1;
        received.push(input);
        if (attempts === 1)
          throw Object.assign(new Error("stale"), { code: "P3S03" });
        return { generation: 5, sha256: "c".repeat(64) };
      },
    },
    sleep: async () => {},
    validateState: validatePersistedDrawingState,
  });
  await storage.store({
    userId: ids.actor,
    projectId: ids.project,
    revisionId: ids.revision,
    state: Y.encodeStateAsUpdate(local),
    baseOperationSequence: 0,
  });
  assert.equal(attempts, 2);
  assert.equal(received[1].expectedGeneration, 4);
  assert.equal(received[1].expectedSha256, "b".repeat(64));
  const merged = new Y.Doc();
  Y.applyUpdate(merged, received[1].state);
  assert.equal(merged.getMap("operations").has(ids.operation), true);
});

test("accepted polling and signed outcome receipts are authoritative and idempotent", async () => {
  const { createOutcomeReceiptVerifier, reconcileAcceptedDrawingOperations } =
    requireModules();
  const secret = "receipt-secret-that-is-long-enough";
  const body = JSON.stringify({
    receiptId: "00000000-0000-4000-8000-000000000406",
    roomName,
    operationId: ids.operation,
    outcome: "rejected",
    resultVersions: {},
  });
  const signature = createHmac("sha256", secret).update(body).digest("hex");
  const verifier = createOutcomeReceiptVerifier(secret);
  assert.deepEqual(verifier(body, signature).outcome, "rejected");
  assert.throws(() => verifier(body, `${signature.slice(0, -1)}0`));
  assert.equal(
    timingSafeEqual(Buffer.from(signature), Buffer.from(signature)),
    true,
  );

  const doc = initializedDocument();
  Y.applyUpdate(doc, appendUpdate(doc));
  let lookups = 0;
  await reconcileAcceptedDrawingOperations(doc, async () => {
    lookups += 1;
    return [
      {
        revisionId: ids.revision,
        clientOperationId: ids.operation,
        actorId: ids.actor,
        operationType: "add_layer",
        baseVersions: {},
        forward: operation().forward,
        inverse: {},
        sequence: 9,
        resultVersions: { [ids.layer]: 1 },
      },
    ];
  });
  await reconcileAcceptedDrawingOperations(doc, async () => {
    lookups += 1;
    return [
      {
        revisionId: ids.revision,
        clientOperationId: ids.operation,
        actorId: ids.actor,
        operationType: "add_layer",
        baseVersions: {},
        forward: operation().forward,
        inverse: {},
        sequence: 9,
        resultVersions: { [ids.layer]: 1 },
      },
    ];
  });
  assert.equal(
    doc.getMap("operationStatus").get(ids.operation).status,
    "acked",
  );
  assert.equal(
    lookups,
    1,
    "acked rows are not polled again after a lost receipt",
  );
});

test("service hooks reauthorize token sync/messages/Awareness and passive connections", async () => {
  const { createDrawingCollaborationServer } = requireModules();
  let access = {
    capability: "editor",
    canWrite: true,
    revisionStatus: "draft",
  };
  let now = 0;
  let intervalMs = 0;
  const runtime = createDrawingCollaborationServer({
    config: {
      port: 0,
      supabaseUrl,
      databaseUrl: "postgres://unused",
      allowedOrigins: new Set(["https://app.example.com"]),
      internalSecret: "x".repeat(32),
      authorizationIntervalMs: 30_000,
      debounceMs: 10,
      maxDebounceMs: 20,
    },
    verifyToken: async () => ({ userId: ids.actor, email: null }),
    authorize: async () => access,
    storage: {
      load: async () => null,
      store: async () => ({ generation: 1, sha256: "a".repeat(64) }),
      bootstrap: async () => ({ sha256: "a".repeat(64), operationSequence: 0 }),
      lookupOperations: async () => [],
    },
    now: () => now,
    setInterval: (_callback, milliseconds) => {
      intervalMs = milliseconds;
      return 1;
    },
    clearInterval: () => {},
  });
  const context = await runtime.hooks.authenticate({
    token: "x",
    origin: "https://app.example.com",
    roomName,
  });
  const connection = {
    context,
    readOnly: false,
    closed: false,
    close() {
      this.closed = true;
    },
  };
  assert.equal(intervalMs, 30_000);
  runtime.trackConnection(connection);
  await runtime.hooks.beforeMessage({
    context,
    document: initializedDocument(),
    update: appendUpdate(initializedDocument()),
  });
  const awareness = new Map([
    [1, { user: { id: randomUUID(), displayName: "spoof", color: "#ffffff" } }],
  ]);
  await runtime.hooks.beforeAwareness({ context, states: awareness });
  assert.equal(awareness.get(1).user.id, ids.actor);
  access = { capability: "viewer", canWrite: false, revisionStatus: "draft" };
  now = 30_000;
  await runtime.runPassiveAuthorizationCheck();
  assert.equal(connection.readOnly, true);
  assert.equal(connection.closed, false);
  access = null;
  now = 60_000;
  await runtime.runPassiveAuthorizationCheck();
  assert.equal(connection.closed, true);
  await runtime.stop();
});

test("health distinguishes readiness and graceful shutdown flushes exactly once", async () => {
  const { createDrawingCollaborationServer } = requireModules();
  let flushes = 0;
  let destroys = 0;
  const runtime = createDrawingCollaborationServer({
    config: {
      port: 0,
      supabaseUrl,
      databaseUrl: "postgres://unused",
      allowedOrigins: new Set(["https://app.example.com"]),
      internalSecret: "x".repeat(32),
      authorizationIntervalMs: 30_000,
      debounceMs: 10,
      maxDebounceMs: 20,
    },
    verifyToken: async () => ({ userId: ids.actor, email: null }),
    authorize: async () => ({
      capability: "editor",
      canWrite: true,
      revisionStatus: "draft",
    }),
    storage: {
      load: async () => null,
      store: async () => ({ generation: 1, sha256: "a".repeat(64) }),
      bootstrap: async () => ({ sha256: "a".repeat(64), operationSequence: 0 }),
      lookupOperations: async () => [],
      health: async () => true,
    },
    flush: async () => {
      flushes += 1;
    },
    destroy: async () => {
      destroys += 1;
    },
    setInterval: () => 1,
    clearInterval: () => {},
  });
  assert.deepEqual(await runtime.health(), { live: true, ready: true });
  await Promise.all([runtime.stop(), runtime.stop()]);
  assert.equal(flushes, 1);
  assert.equal(destroys, 1);
  assert.deepEqual(await runtime.health(), { live: false, ready: false });
});

test("the one-port server exposes real liveness and readiness HTTP probes", async () => {
  const { createDrawingCollaborationServer } = requireModules();
  const runtime = createDrawingCollaborationServer({
    config: {
      port: 0,
      supabaseUrl,
      databaseUrl: "postgres://unused",
      allowedOrigins: new Set(["https://app.example.com"]),
      internalSecret: "x".repeat(32),
      authorizationIntervalMs: 30_000,
      debounceMs: 10,
      maxDebounceMs: 20,
    },
    verifyToken: async () => ({ userId: ids.actor, email: null }),
    authorize: async () => ({
      capability: "editor",
      canWrite: true,
      revisionStatus: "draft",
    }),
    storage: {
      load: async () => null,
      store: async () => ({ generation: 1, sha256: "a".repeat(64) }),
      bootstrap: async () => ({ sha256: "a".repeat(64), operationSequence: 0 }),
      lookupOperations: async () => [],
      health: async () => true,
    },
  });
  const server = await runtime.start();
  try {
    const response = await fetch(`${server.httpURL}/healthz`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { live: true, ready: true });
  } finally {
    await runtime.stop();
  }
});

test("service startup fails closed when asymmetric JWKS preflight fails", async () => {
  const { createDrawingCollaborationServer } = requireModules();
  const runtime = createDrawingCollaborationServer({
    config: {
      port: 0,
      supabaseUrl,
      databaseUrl: "postgres://unused",
      allowedOrigins: new Set(["https://app.example.com"]),
      internalSecret: "x".repeat(32),
      authorizationIntervalMs: 30_000,
      debounceMs: 10,
      maxDebounceMs: 20,
    },
    preflightAuth: async () => {
      throw new Error("HS256-only JWKS");
    },
    verifyToken: async () => ({ userId: ids.actor, email: null }),
    authorize: async () => ({
      capability: "editor",
      canWrite: true,
      revisionStatus: "draft",
    }),
    storage: {
      load: async () => null,
      store: async () => ({ generation: 1, sha256: "a".repeat(64) }),
      bootstrap: async () => ({
        sha256: "a".repeat(64),
        operationSequence: 0,
      }),
      lookupOperations: async () => [],
      health: async () => true,
    },
  });
  try {
    await assert.rejects(() => runtime.start(), /HS256-only/);
  } finally {
    await runtime.stop();
  }
});

test("collaboration OCI contract is Node 22 multi-stage, non-root, one-port and self-healthchecked", async () => {
  const dockerfile = await readFile(
    new URL("../collaboration/Dockerfile", import.meta.url),
    "utf8",
  );
  assert.match(dockerfile, /^FROM node:22-bookworm-slim AS build/m);
  assert.match(dockerfile, /^FROM node:22-bookworm-slim AS runtime/m);
  assert.match(dockerfile, /^USER node$/m);
  assert.match(dockerfile, /^EXPOSE 1234$/m);
  assert.equal((dockerfile.match(/^EXPOSE /gm) ?? []).length, 1);
  assert.match(dockerfile, /^HEALTHCHECK /m);
  assert.doesNotMatch(
    dockerfile,
    /@vercel|@supabase|service.?role|\bws\b|lib0/i,
  );
});
