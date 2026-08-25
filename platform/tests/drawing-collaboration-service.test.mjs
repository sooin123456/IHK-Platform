import assert from "node:assert/strict";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { exportJWK, generateKeyPair, SignJWT } from "jose";
import {
  applyAwarenessUpdate,
  Awareness,
  encodeAwarenessUpdate,
} from "y-protocols/awareness";
import * as Y from "yjs";
import {
  IncomingMessage,
  MessageReceiver,
  OutgoingMessage,
} from "@hocuspocus/server";

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
  operation2: "00000000-0000-4000-8000-000000000407",
  layer: "00000000-0000-4000-8000-000000000405",
  layer2: "00000000-0000-4000-8000-000000000408",
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
      const builder = new SignJWT(claims)
        .setProtectedHeader({ alg: algorithm, kid: "active" })
        .setIssuer(options.issuer ?? `${supabaseUrl}/auth/v1`)
        .setIssuedAt(now);
      if (!options.omitExpiration)
        builder.setExpirationTime(options.expiration ?? now + 60);
      return builder.sign(pair.privateKey);
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
    await fixture.token({}, { omitExpiration: true }),
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
  const verifyToken = async () => ({
    userId: ids.actor,
    email: null,
    expiresAtMs: Date.now() + 60_000,
  });
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

test("clone validation accepts concurrent Y.Array appends in either Yjs order", () => {
  const { validateDrawingClientUpdate } = requireModules();
  const base = initializedDocument();
  const baseState = Y.encodeStateAsUpdate(base);
  const baseVector = Y.encodeStateVector(base);
  const first = new Y.Doc();
  const second = new Y.Doc();
  Y.applyUpdate(first, baseState);
  Y.applyUpdate(second, baseState);
  first.clientID = 100;
  second.clientID = 50;
  const firstOperation = operation();
  const secondOperation = operation({
    clientOperationId: ids.operation2,
    forward: {
      ...operation().forward,
      layer: { ...operation().forward.layer, id: ids.layer2, name: "Second" },
    },
  });
  first.transact(() => {
    first.getMap("operations").set(ids.operation, firstOperation);
    first.getArray("operationOrder").push([ids.operation]);
  });
  second.transact(() => {
    second.getMap("operations").set(ids.operation2, secondOperation);
    second.getArray("operationOrder").push([ids.operation2]);
  });
  const firstUpdate = Y.encodeStateAsUpdate(first, baseVector);
  const secondUpdate = Y.encodeStateAsUpdate(second, baseVector);
  const context = {
    userId: ids.actor,
    projectId: ids.project,
    revisionId: ids.revision,
    canWrite: true,
  };
  const firstArrival = new Y.Doc();
  Y.applyUpdate(firstArrival, baseState);
  Y.applyUpdate(firstArrival, firstUpdate);
  assert.doesNotThrow(() =>
    validateDrawingClientUpdate(firstArrival, secondUpdate, context),
  );
  const secondArrival = new Y.Doc();
  Y.applyUpdate(secondArrival, baseState);
  Y.applyUpdate(secondArrival, secondUpdate);
  assert.doesNotThrow(() =>
    validateDrawingClientUpdate(secondArrival, firstUpdate, context),
  );
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

test("Awareness binds one clientId to its connection and bounds ten-second leases", async () => {
  const { createDrawingCollaborationServer } = requireModules();
  const now = 1_000;
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
    now: () => now,
    verifyToken: async () => ({
      userId: ids.actor,
      email: null,
      expiresAtMs: 60_000,
    }),
    authorize: async () => ({
      capability: "editor",
      canWrite: true,
      revisionStatus: "draft",
    }),
    storage: {
      load: async () => null,
      store: async () => ({ generation: 1, sha256: "a".repeat(64) }),
    },
    setInterval: () => 1,
    clearInterval: () => {},
  });
  const context = await runtime.hooks.authenticate({
    token: "x",
    origin: "https://app.example.com",
    roomName,
  });
  const connection = { context };
  const peer = {};
  const document = {
    getConnections: () => [connection, peer],
    getClients: (target) =>
      target === connection ? new Set([1]) : new Set([99]),
  };
  const state = (expiresAt = now + 10_000) => ({
    pageId: null,
    canvasId: null,
    cursorWorld: null,
    selectedIds: [],
    activeTool: null,
    softLocks: [{ entityId: ids.layer, leaseId: ids.operation2, expiresAt }],
  });
  await assert.rejects(() =>
    runtime.hooks.beforeAwareness({
      context,
      connection,
      document,
      states: new Map([[99, state()]]),
    }),
  );
  await assert.rejects(() =>
    runtime.hooks.beforeAwareness({
      context,
      connection,
      document,
      states: new Map([
        [1, state()],
        [2, state()],
      ]),
    }),
  );
  await assert.rejects(() =>
    runtime.hooks.beforeAwareness({
      context,
      connection,
      document,
      states: new Map([[1, state(now + 10_001)]]),
    }),
  );
  await assert.doesNotReject(() =>
    runtime.hooks.beforeAwareness({
      context,
      connection,
      document,
      states: new Map([[1, state()]]),
    }),
  );
  const peerDocument = new Y.Doc();
  peerDocument.clientID = 99;
  const peerAwareness = new Awareness(peerDocument);
  peerAwareness.setLocalState({ user: { id: ids.actor } });
  const roomDocument = new Y.Doc();
  const roomAwareness = new Awareness(roomDocument);
  applyAwarenessUpdate(
    roomAwareness,
    encodeAwarenessUpdate(peerAwareness, [99]),
    null,
  );
  peerAwareness.setLocalState(null);
  const removalFrame = new OutgoingMessage(roomName)
    .createAwarenessUpdateMessage(peerAwareness, [99])
    .toUint8Array();
  const removalMessage = new IncomingMessage(removalFrame);
  removalMessage.readVarString();
  await assert.rejects(() =>
    new MessageReceiver(removalMessage).apply(
      {
        name: roomName,
        awareness: roomAwareness,
        getConnections: document.getConnections,
        getClients: document.getClients,
        callbacks: {
          beforeHandleAwareness: (_room, states) =>
            runtime.hooks.beforeAwareness({
              context,
              connection,
              document,
              states,
            }),
        },
      },
      connection,
    ),
  );
  assert.equal(roomAwareness.getStates().has(99), true);
  peerAwareness.destroy();
  peerDocument.destroy();
  roomAwareness.destroy();
  roomDocument.destroy();
  await runtime.stop();
});

test("storage retries transient reads and uses exact generation/SHA CAS without stale overwrite", async () => {
  const { createDrawingCollaborationStorage } = requireModules();
  let loads = 0;
  let storeAttempts = 0;
  let lookupAttempts = 0;
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
      async lookupOperations() {
        lookupAttempts += 1;
        if (lookupAttempts === 1)
          throw Object.assign(new Error("connection reset"), {
            code: "ECONNRESET",
          });
        return [];
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
  await storage.lookupOperations(ids.revision, [ids.operation]);
  assert.equal(lookupAttempts, 2);
});

test("a Task 3 CAS conflict reloads, merges, validates, and retries once", async () => {
  const { createDrawingCollaborationStorage, validatePersistedDrawingState } =
    requireModules();
  const base = initializedDocument();
  const baseState = Y.encodeStateAsUpdate(base);
  const remote = new Y.Doc();
  Y.applyUpdate(remote, baseState);
  remote.getMap("serverMeta").set("baseOperationSequence", 5);
  const local = new Y.Doc();
  Y.applyUpdate(local, baseState);
  local.getMap("serverMeta").set("baseOperationSequence", 3);
  Y.applyUpdate(local, appendUpdate(local));
  let attempts = 0;
  const received = [];
  const storage = createDrawingCollaborationStorage({
    database: {
      load: async () => ({
        yjsState: Y.encodeStateAsUpdate(remote),
        generation: 4,
        sha256: "b".repeat(64),
        baseOperationSequence: 5,
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
  const stored = await storage.store({
    userId: ids.actor,
    projectId: ids.project,
    revisionId: ids.revision,
    state: Y.encodeStateAsUpdate(local),
    baseOperationSequence: 3,
  });
  assert.equal(attempts, 2);
  assert.equal(received[1].expectedGeneration, 4);
  assert.equal(received[1].expectedSha256, "b".repeat(64));
  assert.equal(received[1].baseOperationSequence, 5);
  assert.equal(stored.baseOperationSequence, 5);
  const merged = new Y.Doc();
  Y.applyUpdate(merged, stored.state);
  assert.equal(merged.getMap("operations").has(ids.operation), true);
  assert.equal(merged.getMap("serverMeta").get("baseOperationSequence"), 5);
});

test("store reconciliation applies authoritative merged bytes and checkpoint back to the live room", async () => {
  const { createDrawingCollaborationServer } = requireModules();
  const live = initializedDocument();
  Y.applyUpdate(live, appendUpdate(live));
  const authoritative = new Y.Doc();
  Y.applyUpdate(authoritative, Y.encodeStateAsUpdate(live));
  const second = operation({
    clientOperationId: ids.operation2,
    forward: {
      ...operation().forward,
      layer: { ...operation().forward.layer, id: ids.layer2, name: "Remote" },
    },
  });
  Y.applyUpdate(authoritative, appendUpdate(authoritative, second));
  authoritative.getMap("serverMeta").set("baseOperationSequence", 5);
  const authoritativeState = Y.encodeStateAsUpdate(authoritative);
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
    verifyToken: async () => ({
      userId: ids.actor,
      email: null,
      expiresAtMs: Date.now() + 60_000,
    }),
    authorize: async () => ({
      capability: "editor",
      canWrite: true,
      revisionStatus: "draft",
    }),
    storage: {
      load: async () => null,
      async store() {
        return {
          generation: 2,
          sha256: "b".repeat(64),
          state: authoritativeState,
          baseOperationSequence: 5,
        };
      },
    },
    setInterval: () => 1,
    clearInterval: () => {},
  });
  await runtime.hooks.store({
    document: live,
    roomName,
    context: {
      userId: ids.actor,
      projectId: ids.project,
      revisionId: ids.revision,
    },
  });
  assert.equal(live.getMap("operations").has(ids.operation2), true);
  assert.equal(live.getMap("serverMeta").get("baseOperationSequence"), 5);
  await runtime.stop();
});

test("accepted polling and signed outcome receipts are authoritative and idempotent", async () => {
  const { createOutcomeReceiptVerifier, reconcileAcceptedDrawingOperations } =
    requireModules();
  const secret = "receipt-secret-that-is-long-enough";
  const body = JSON.stringify({
    receiptId: "00000000-0000-4000-8000-000000000406",
    roomName,
    operationId: ids.operation,
    operation: operation(),
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

test("poll reconciliation validates the complete batch before one atomic status transaction", async () => {
  const { reconcileAcceptedDrawingOperations } = requireModules();
  const doc = initializedDocument();
  Y.applyUpdate(doc, appendUpdate(doc));
  const second = operation({
    clientOperationId: ids.operation2,
    forward: {
      ...operation().forward,
      layer: { ...operation().forward.layer, id: ids.layer2, name: "Second" },
    },
  });
  Y.applyUpdate(doc, appendUpdate(doc, second));
  const accepted = (envelope, sequence) => ({
    revisionId: ids.revision,
    clientOperationId: envelope.clientOperationId,
    actorId: envelope.actorId,
    operationType: envelope.type,
    baseVersions: envelope.baseVersions,
    forward: envelope.forward,
    inverse: envelope.inverse,
    sequence,
    resultVersions: {},
  });
  await assert.rejects(() =>
    reconcileAcceptedDrawingOperations(doc, async () => [
      accepted(operation(), 1),
      { ...accepted(second, 2), actorId: randomUUID() },
    ]),
  );
  assert.equal(doc.getMap("operationStatus").size, 0);
});

test("signed outcomes persist before 204 semantics, survive an unloaded room, and replay idempotently", async () => {
  const { createDrawingCollaborationServer } = requireModules();
  const secret = "receipt-secret-that-is-long-enough";
  const receipt = JSON.stringify({
    receiptId: "00000000-0000-4000-8000-000000000406",
    roomName,
    operationId: ids.operation,
    operation: operation(),
    outcome: "rejected",
    resultVersions: {},
  });
  const signature = createHmac("sha256", secret).update(receipt).digest("hex");
  let persisted = null;
  let stores = 0;
  const storage = {
    load: async () =>
      persisted
        ? {
            yjsState: persisted,
            generation: stores,
            sha256: "a".repeat(64),
            baseOperationSequence: 0,
          }
        : null,
    bootstrap: async () => ({
      sha256: "a".repeat(64),
      operationSequence: 0,
    }),
    async store(input) {
      stores += 1;
      assert.equal(input.userId, ids.actor);
      assert.equal(input.projectId, ids.project);
      assert.equal(input.revisionId, ids.revision);
      persisted = input.state;
      return {
        generation: stores,
        sha256: "a".repeat(64),
        state: input.state,
        baseOperationSequence: input.baseOperationSequence,
      };
    },
    lookupOperations: async () => [],
  };
  const makeRuntime = () =>
    createDrawingCollaborationServer({
      config: {
        port: 0,
        supabaseUrl,
        databaseUrl: "postgres://unused",
        allowedOrigins: new Set(["https://app.example.com"]),
        internalSecret: secret,
        authorizationIntervalMs: 30_000,
        debounceMs: 10,
        maxDebounceMs: 20,
      },
      verifyToken: async () => ({
        userId: ids.actor,
        email: null,
        expiresAtMs: Date.now() + 60_000,
      }),
      authorize: async () => ({
        capability: "editor",
        canWrite: true,
        revisionStatus: "draft",
      }),
      storage,
      setInterval: () => 1,
      clearInterval: () => {},
    });

  const first = makeRuntime();
  assert.equal(first.hocuspocus.documents.has(roomName), false);
  await first.applyOutcomeReceipt(receipt, signature);
  await first.stop();
  assert.ok(persisted);
  const stored = new Y.Doc();
  Y.applyUpdate(stored, persisted);
  assert.equal(
    stored.getMap("operationStatus").get(ids.operation).status,
    "rejected",
  );

  const restarted = makeRuntime();
  await restarted.applyOutcomeReceipt(receipt, signature);
  await restarted.stop();
  assert.equal(
    stores,
    2,
    "restart replay performs one idempotent durable store",
  );
});

test("polling persists server status with room scope and contains room lookup failures", async () => {
  const { createDrawingCollaborationServer } = requireModules();
  const pending = initializedDocument();
  Y.applyUpdate(pending, appendUpdate(pending));
  const storedScopes = [];
  let failLookup = false;
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
    verifyToken: async () => ({
      userId: ids.actor,
      email: null,
      expiresAtMs: Date.now() + 60_000,
    }),
    authorize: async () => ({
      capability: "editor",
      canWrite: true,
      revisionStatus: "draft",
    }),
    storage: {
      load: async () => ({
        yjsState: Y.encodeStateAsUpdate(pending),
        generation: 1,
        sha256: "a".repeat(64),
        baseOperationSequence: 0,
      }),
      async store(input) {
        storedScopes.push(input);
        return {
          generation: 2,
          sha256: "b".repeat(64),
          state: input.state,
          baseOperationSequence: input.baseOperationSequence,
        };
      },
      async lookupOperations() {
        if (failLookup) throw new Error("transient lookup failure");
        return [
          {
            revisionId: ids.revision,
            clientOperationId: ids.operation,
            actorId: ids.actor,
            operationType: "add_layer",
            baseVersions: {},
            forward: operation().forward,
            inverse: {},
            sequence: 1,
            resultVersions: {},
          },
        ];
      },
    },
    setInterval: () => 1,
    clearInterval: () => {},
  });
  const context = await runtime.hooks.authenticate({
    token: "x",
    origin: "https://app.example.com",
    roomName,
  });
  const document = await runtime.hocuspocus.createDocument(
    roomName,
    new Request("http://localhost"),
    "test",
    { readOnly: false, isAuthenticated: true },
    context,
  );
  await runtime.runReconciliationCheck();
  assert.equal(
    document.getMap("operationStatus").get(ids.operation).status,
    "acked",
  );
  assert.equal(storedScopes.at(-1).userId, ids.actor);
  assert.equal(storedScopes.at(-1).projectId, ids.project);
  assert.equal(storedScopes.at(-1).revisionId, ids.revision);
  failLookup = true;
  document.transact(
    () => document.getMap("operationStatus").delete(ids.operation),
    { source: "local", skipStoreHooks: true, context },
  );
  await assert.doesNotReject(() => runtime.runReconciliationCheck());
  await runtime.stop();
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
    verifyToken: async () => ({
      userId: ids.actor,
      email: null,
      expiresAtMs: 120_000,
    }),
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
    tokenRequests: 0,
    close() {
      this.closed = true;
    },
    requestToken() {
      this.tokenRequests += 1;
    },
  };
  assert.equal(intervalMs, 30_000);
  runtime.trackConnection(connection);
  await runtime.hooks.beforeSync({
    context,
    document: initializedDocument(),
    connection,
    type: 0,
    payload: new Uint8Array(),
  });
  const syncDocument = initializedDocument();
  await runtime.hooks.beforeSync({
    context,
    document: syncDocument,
    connection,
    type: 2,
    payload: appendUpdate(syncDocument),
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
  access = { capability: "editor", canWrite: true, revisionStatus: "draft" };
  now = 90_000;
  await runtime.runPassiveAuthorizationCheck();
  assert.equal(connection.tokenRequests, 1);
  now = 120_000;
  await runtime.runPassiveAuthorizationCheck();
  assert.equal(connection.closed, true);
  await runtime.stop();
});

test("Hocuspocus v4 decodes a real framed Sync/Update before collaboration validation", async () => {
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
    verifyToken: async () => ({
      userId: ids.actor,
      email: null,
      expiresAtMs: Date.now() + 60_000,
    }),
    authorize: async () => ({
      capability: "editor",
      canWrite: true,
      revisionStatus: "draft",
    }),
    storage: {
      load: async () => null,
      bootstrap: async () => ({
        sha256: "a".repeat(64),
        operationSequence: 0,
      }),
      async store(input) {
        return {
          generation: 1,
          sha256: "a".repeat(64),
          state: input.state,
          baseOperationSequence: input.baseOperationSequence,
        };
      },
    },
    setInterval: () => 1,
    clearInterval: () => {},
  });
  const context = await runtime.hooks.authenticate({
    token: "x",
    origin: "https://app.example.com",
    roomName,
  });
  const document = await runtime.hocuspocus.createDocument(
    roomName,
    new Request("http://localhost"),
    "frame-test",
    { readOnly: false, isAuthenticated: true },
    context,
  );
  const update = appendUpdate(document);
  const frame = new OutgoingMessage(roomName)
    .createSyncMessage()
    .writeUpdate(update)
    .toUint8Array();
  const message = new IncomingMessage(frame);
  assert.equal(message.readVarString(), roomName);
  const connection = {
    context,
    readOnly: false,
    request: new Request("http://localhost"),
    messageAddress: roomName,
    send() {},
    close() {},
    requestToken() {},
    callbacks: {
      beforeSync: (_connection, decoded) =>
        runtime.hooks.beforeSync({
          context,
          document,
          connection,
          type: decoded.type,
          payload: decoded.payload,
        }),
    },
  };
  await new MessageReceiver(message).apply(document, connection);
  assert.equal(document.getMap("operations").has(ids.operation), true);
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
    verifyToken: async () => ({
      userId: ids.actor,
      email: null,
      expiresAtMs: Date.now() + 120_000,
    }),
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
    verifyToken: async () => ({
      userId: ids.actor,
      email: null,
      expiresAtMs: Date.now() + 120_000,
    }),
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

test("outcome endpoint distinguishes invalid signatures from retriable persistence failures", async () => {
  const { createDrawingCollaborationServer } = requireModules();
  const secret = "receipt-secret-that-is-long-enough";
  const body = JSON.stringify({
    receiptId: "00000000-0000-4000-8000-000000000406",
    roomName,
    operationId: ids.operation,
    operation: operation(),
    outcome: "rejected",
    resultVersions: {},
  });
  const signature = createHmac("sha256", secret).update(body).digest("hex");
  let stores = 0;
  const runtime = createDrawingCollaborationServer({
    config: {
      port: 0,
      supabaseUrl,
      databaseUrl: "postgres://unused",
      allowedOrigins: new Set(["https://app.example.com"]),
      internalSecret: secret,
      authorizationIntervalMs: 30_000,
      debounceMs: 10,
      maxDebounceMs: 20,
    },
    verifyToken: async () => ({
      userId: ids.actor,
      email: null,
      expiresAtMs: Date.now() + 120_000,
    }),
    authorize: async () => ({
      capability: "editor",
      canWrite: true,
      revisionStatus: "draft",
    }),
    storage: {
      load: async () => null,
      bootstrap: async () => ({
        sha256: "a".repeat(64),
        operationSequence: 0,
      }),
      store: async () => {
        stores += 1;
        if (stores === 1) throw new Error("database unavailable");
        return { generation: stores, sha256: "a".repeat(64) };
      },
    },
  });
  const server = await runtime.start();
  try {
    const unavailable = await fetch(`${server.httpURL}/internal/outcomes`, {
      method: "POST",
      body,
      headers: { "x-1hk-signature": signature },
    });
    assert.equal(unavailable.status, 503);
    const unauthorized = await fetch(`${server.httpURL}/internal/outcomes`, {
      method: "POST",
      body,
      headers: { "x-1hk-signature": "0".repeat(64) },
    });
    assert.equal(unauthorized.status, 401);
  } finally {
    await runtime.stop();
  }
});

test("service startup fails closed when asymmetric JWKS preflight fails", async () => {
  const { createDrawingCollaborationServer } = requireModules();
  let purges = 0;
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
    purgeAuth: () => {
      purges += 1;
    },
    verifyToken: async () => ({
      userId: ids.actor,
      email: null,
      expiresAtMs: Date.now() + 120_000,
    }),
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
    runtime.purgeAuthCache();
    assert.equal(purges, 1);
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
  assert.match(dockerfile, /process\.env\.PORT/);
  assert.doesNotMatch(
    dockerfile,
    /@vercel|@supabase|service.?role|\bws\b|lib0/i,
  );
});
