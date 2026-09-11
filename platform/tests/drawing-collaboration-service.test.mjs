import assert from "node:assert/strict";
import {
  createHash,
  createHmac,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { HocuspocusProvider } from "@hocuspocus/provider";
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
import CrossWebSocket from "crossws/websocket";

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
const protocolModule = await import(
  "../app/lukas/lib/drawing-collaboration-protocol.ts"
).catch(() => null);
const collaborationClientModule =
  await import("../app/lukas/lib/drawing-collaboration-client.ts").catch(
    () => null,
  );

const ids = {
  project: "00000000-0000-4000-8000-000000000401",
  revision: "00000000-0000-4000-8000-000000000402",
  actor: "00000000-0000-4000-8000-000000000403",
  operation: "00000000-0000-4000-8000-000000000404",
  operation2: "00000000-0000-4000-8000-000000000407",
  operation3: "00000000-0000-4000-8000-000000000409",
  layer: "00000000-0000-4000-8000-000000000405",
  layer2: "00000000-0000-4000-8000-000000000408",
  layer3: "00000000-0000-4000-8000-000000000410",
};
const roomName = `drawing:${ids.project}:${ids.revision}`;
const supabaseUrl = "https://example.supabase.co";

function requireModules() {
  assert.ok(configModule, "collaboration config must exist");
  assert.ok(authModule, "collaboration auth must exist");
  assert.ok(storageModule, "collaboration storage must exist");
  assert.ok(serverModule, "collaboration server must exist");
  assert.ok(protocolModule, "collaboration protocol must exist");
  return {
    ...configModule,
    ...authModule,
    ...storageModule,
    ...serverModule,
    ...protocolModule,
  };
}

function storedState(state, generation = 1, baseOperationSequence = 0) {
  return {
    yjsState: state,
    generation,
    sha256: createHash("sha256").update(state).digest("hex"),
    baseOperationSequence,
  };
}

function durableBootstrapStorage() {
  let persisted = null;
  return storageModule.createDrawingCollaborationStorage({
    validateState: serverModule.validatePersistedDrawingState,
    database: {
      load: async () => persisted,
      initializeState: async (input) =>
        (persisted ??= storedState(
          input.state,
          1,
          input.baseOperationSequence,
        )),
      bootstrap: async () => ({ sha256: "a".repeat(64), operationSequence: 0 }),
      store: async (input) => {
        assert.equal(input.expectedGeneration, persisted.generation);
        assert.equal(input.expectedSha256, persisted.sha256);
        persisted = storedState(
          input.state,
          persisted.generation + 1,
          input.baseOperationSequence,
        );
        return persisted;
      },
    },
  });
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

function updateLayerOperation(overrides = {}) {
  return operation({
    type: "update_layer",
    baseVersions: { [ids.layer]: 1 },
    forward: {
      type: "update_layer",
      layerId: ids.layer,
      patch: { name: "Updated" },
    },
    inverse: {
      type: "update_layer",
      layerId: ids.layer,
      patch: { name: "Annotations" },
    },
    ...overrides,
  });
}

function deleteObjectOperation(overrides = {}) {
  return operation({
    type: "delete_objects",
    baseVersions: { [ids.layer]: 1 },
    forward: { type: "delete_objects", objectIds: [ids.layer] },
    inverse: {
      type: "add_objects",
      objects: [
        {
          id: ids.layer,
          name: "Deleted rectangle",
          layerId: ids.layer2,
          geometry: {
            type: "rectangle",
            origin: { x: 0, y: 0 },
            width: 10,
            height: 10,
            rotation: 0,
          },
          style: { stroke: "#111111", strokeWidth: 1, fill: null },
          version: 3,
        },
      ],
    },
    ...overrides,
  });
}

function oversizedSnapshotOutcome() {
  const objects = Array.from({ length: 250 }, (_, index) => ({
    id: `20000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    name: `Snapshot import ${index} ${"x".repeat(120)}`,
    layerId: ids.layer,
    geometry: {
      type: "line",
      start: { x: index, y: index },
      end: { x: index + 1, y: index + 1 },
    },
    style: { stroke: "#2563eb", strokeWidth: 2, fill: null },
    version: 1,
  }));
  return {
    revisionId: ids.revision,
    clientOperationId: ids.operation,
    actorId: ids.actor,
    operationType: "add_objects",
    baseVersions: {},
    forward: { type: "add_objects", objects },
    inverse: {
      type: "delete_objects",
      objectIds: objects.map(({ id }) => id),
    },
    sequence: 1,
    resultVersions: {},
  };
}

function largeValidReceiptOperation() {
  const objects = Array.from({ length: 100 }, (_, index) => ({
    id: `30000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    name: `Receipt object ${index} ${"x".repeat(180)}`,
    layerId: ids.layer,
    geometry: {
      type: "line",
      start: { x: index, y: index },
      end: { x: index + 1, y: index + 1 },
    },
    style: { stroke: "#2563eb", strokeWidth: 2, fill: null },
    version: 1,
  }));
  return operation({
    type: "add_objects",
    forward: { type: "add_objects", objects },
    inverse: {
      type: "delete_objects",
      objectIds: objects.map(({ id }) => id),
    },
  });
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
  doc.getArray("operations");
  doc.getMap("operationStatus");
  return doc;
}

function appendUpdate(current, envelope = operation()) {
  const next = new Y.Doc();
  Y.applyUpdate(next, Y.encodeStateAsUpdate(current));
  next.transact(() => {
    next.getArray("operations").push([envelope]);
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
    COLLABORATION_INSTANCE_ID: "collab-a",
    COLLABORATION_INTERNAL_SECRET: "x".repeat(32),
    COLLABORATION_FREEZE_SECRET: "f".repeat(32),
  };
  assert.equal(parseDrawingCollaborationConfig(valid).port, 1234);
  assert.equal(parseDrawingCollaborationConfig(valid).instanceId, "collab-a");
  for (const changed of [
    { SUPABASE_URL: "" },
    { COLLABORATION_DATABASE_URL: "" },
    { COLLABORATION_ALLOWED_ORIGINS: "" },
    { COLLABORATION_ALLOWED_ORIGINS: "*" },
    { COLLABORATION_INSTANCE_ID: "" },
    { COLLABORATION_INSTANCE_ID: "invalid instance" },
    { COLLABORATION_INTERNAL_SECRET: "short" },
    { COLLABORATION_FREEZE_SECRET: "short" },
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
        .getArray("operations")
        .push([operation({ createdAt: "2026-08-26T01:00:00.000Z" })]),
    (candidate) => candidate.getArray("operations").delete(0),
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

test("server bootstrap keeps oversized authoritative outcomes at the snapshot boundary", async () => {
  const { initializeDrawingCollaborationDocument } = requireModules();
  const document = new Y.Doc();

  await initializeDrawingCollaborationDocument(document, {
    projectId: ids.project,
    revisionId: ids.revision,
    bootstrap: async () => ({
      sha256: "a".repeat(64),
      operationSequence: 1,
      recentOutcomes: [oversizedSnapshotOutcome()],
    }),
  });

  assert.equal(document.getMap("serverMeta").get("baseOperationSequence"), 1);
  assert.deepEqual(document.getArray("operationOrder").toArray(), []);
  assert.deepEqual(document.getArray("operations").toArray(), []);
  assert.deepEqual(document.getMap("operationStatus").toJSON(), {});
});

test("client ingress and persisted validation reject malformed actor history transitions", () => {
  const { validateDrawingClientUpdate, validatePersistedDrawingState } =
    requireModules();
  const context = {
    userId: ids.actor,
    projectId: ids.project,
    revisionId: ids.revision,
    canWrite: true,
  };
  const current = initializedDocument();
  const original = updateLayerOperation();
  const originalUpdate = appendUpdate(current, original);
  assert.doesNotThrow(() =>
    validateDrawingClientUpdate(current, originalUpdate, context),
  );
  Y.applyUpdate(current, originalUpdate);
  const remote = updateLayerOperation({
    clientOperationId: randomUUID(),
    actorId: ids.layer2,
  });
  const remoteUpdate = appendUpdate(current, remote);
  assert.doesNotThrow(() =>
    validateDrawingClientUpdate(current, remoteUpdate, {
      ...context,
      userId: remote.actorId,
    }),
  );
  Y.applyUpdate(current, remoteUpdate);

  for (const malformed of [
    updateLayerOperation({
      clientOperationId: ids.operation2,
      historyAction: "undo",
      originalOperationId: ids.operation3,
    }),
    updateLayerOperation({
      clientOperationId: ids.operation2,
      actorId: ids.layer2,
      historyAction: "undo",
      originalOperationId: ids.operation,
    }),
    updateLayerOperation({
      clientOperationId: ids.operation2,
      historyAction: "redo",
      originalOperationId: ids.operation,
    }),
  ])
    assert.throws(() =>
      validateDrawingClientUpdate(current, appendUpdate(current, malformed), {
        ...context,
        userId: malformed.actorId,
      }),
    );

  const validUndo = updateLayerOperation({
    clientOperationId: ids.operation2,
    historyAction: "undo",
    originalOperationId: ids.operation,
  });
  const undoUpdate = appendUpdate(current, validUndo);
  assert.doesNotThrow(() =>
    validateDrawingClientUpdate(current, undoUpdate, context),
  );
  Y.applyUpdate(current, undoUpdate);
  const repeatedUndo = updateLayerOperation({
    clientOperationId: ids.operation3,
    historyAction: "undo",
    originalOperationId: ids.operation,
  });
  assert.throws(() =>
    validateDrawingClientUpdate(
      current,
      appendUpdate(current, repeatedUndo),
      context,
    ),
  );

  const poisoned = new Y.Doc();
  Y.applyUpdate(poisoned, Y.encodeStateAsUpdate(current));
  poisoned.transact(() => {
    poisoned.getArray("operations").push([repeatedUndo]);
    poisoned.getArray("operationOrder").push([ids.operation3]);
  });
  assert.throws(() =>
    validatePersistedDrawingState(Y.encodeStateAsUpdate(poisoned), context),
  );
});

test("service bootstrap reconstructs accepted history before a restart redo", async () => {
  const {
    initializeDrawingCollaborationDocument,
    validateDrawingClientUpdate,
  } = requireModules();
  const original = updateLayerOperation();
  const undo = updateLayerOperation({
    clientOperationId: ids.operation2,
    historyAction: "undo",
    originalOperationId: ids.operation,
  });
  const outcome = (envelope, sequence) => ({
    revisionId: ids.revision,
    clientOperationId: envelope.clientOperationId,
    actorId: envelope.actorId,
    operationType: envelope.type,
    baseVersions: envelope.baseVersions,
    forward: envelope.forward,
    inverse: envelope.inverse,
    ...(envelope.historyAction
      ? {
          historyAction: envelope.historyAction,
          originalOperationId: envelope.originalOperationId,
        }
      : {}),
    sequence,
    resultVersions: {},
  });
  const restarted = new Y.Doc();
  let bootstrapTransactions = 0;
  restarted.on("afterTransaction", () => {
    bootstrapTransactions += 1;
  });
  await initializeDrawingCollaborationDocument(restarted, {
    projectId: ids.project,
    revisionId: ids.revision,
    bootstrap: async () => ({
      sha256: "a".repeat(64),
      operationSequence: 2,
      recentOutcomes: [outcome(original, 1), outcome(undo, 2)],
    }),
  });
  assert.equal(
    bootstrapTransactions,
    1,
    "valid service history must be reconstructed in one Yjs transaction",
  );
  const redo = updateLayerOperation({
    clientOperationId: ids.operation3,
    historyAction: "redo",
    originalOperationId: ids.operation,
  });
  assert.doesNotThrow(() =>
    validateDrawingClientUpdate(restarted, appendUpdate(restarted, redo), {
      userId: ids.actor,
      projectId: ids.project,
      revisionId: ids.revision,
      canWrite: true,
    }),
  );
});

test("service bootstrap preserves authoritative deletion results", async () => {
  const { initializeDrawingCollaborationDocument } = requireModules();
  const deleted = deleteObjectOperation();
  const restarted = new Y.Doc();

  await initializeDrawingCollaborationDocument(restarted, {
    projectId: ids.project,
    revisionId: ids.revision,
    bootstrap: async () => ({
      sha256: "a".repeat(64),
      operationSequence: 1,
      recentOutcomes: [
        {
          revisionId: ids.revision,
          clientOperationId: deleted.clientOperationId,
          actorId: deleted.actorId,
          operationType: deleted.type,
          baseVersions: deleted.baseVersions,
          forward: deleted.forward,
          inverse: deleted.inverse,
          sequence: 1,
          resultVersions: { [ids.layer]: null },
        },
      ],
    }),
  });

  assert.deepEqual(
    restarted.getMap("operationStatus").get(ids.operation).resultVersions,
    { [ids.layer]: null },
  );
});

test("service bootstrap timestamp repair converges with the same durable client envelope", async () => {
  const {
    initializeDrawingCollaborationDocument,
    validateDrawingClientUpdate,
    validatePersistedDrawingState,
  } = requireModules();
  const durable = operation();
  const restarted = new Y.Doc();
  await initializeDrawingCollaborationDocument(restarted, {
    projectId: ids.project,
    revisionId: ids.revision,
    bootstrap: async () => ({
      sha256: "a".repeat(64),
      operationSequence: 1,
      recentOutcomes: [
        {
          revisionId: ids.revision,
          clientOperationId: durable.clientOperationId,
          actorId: durable.actorId,
          operationType: durable.type,
          baseVersions: durable.baseVersions,
          forward: durable.forward,
          inverse: durable.inverse,
          sequence: 1,
          resultVersions: { [ids.layer]: 1 },
        },
      ],
    }),
  });
  const client = new Y.Doc();
  Y.applyUpdate(client, Y.encodeStateAsUpdate(restarted));
  const serverVector = Y.encodeStateVector(restarted);
  client.transact(() => {
    client.getArray("operations").push([durable]);
    client.getArray("operationOrder").push([durable.clientOperationId]);
  });
  const update = Y.encodeStateAsUpdate(client, serverVector);
  const context = {
    userId: ids.actor,
    projectId: ids.project,
    revisionId: ids.revision,
    canWrite: true,
  };

  assert.doesNotThrow(() =>
    validateDrawingClientUpdate(restarted, update, context),
  );
  Y.applyUpdate(restarted, update);
  assert.doesNotThrow(() =>
    validatePersistedDrawingState(Y.encodeStateAsUpdate(restarted), context),
  );

  const live = initializedDocument();
  Y.applyUpdate(live, appendUpdate(live, durable));
  const fresh = new Y.Doc();
  Y.applyUpdate(fresh, Y.encodeStateAsUpdate(live));
  const liveVector = Y.encodeStateVector(live);
  fresh.transact(() => {
    fresh.getArray("operations").push([
      { ...durable, createdAt: "1970-01-01T00:00:00.000Z" },
    ]);
    fresh.getArray("operationOrder").push([durable.clientOperationId]);
  });
  const reconstructedUpdate = Y.encodeStateAsUpdate(fresh, liveVector);
  assert.doesNotThrow(() =>
    validateDrawingClientUpdate(live, reconstructedUpdate, context),
  );
  Y.applyUpdate(live, reconstructedUpdate);
  assert.doesNotThrow(() =>
    validatePersistedDrawingState(Y.encodeStateAsUpdate(live), context),
  );
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
    first.getArray("operations").push([firstOperation]);
    first.getArray("operationOrder").push([ids.operation]);
  });
  second.transact(() => {
    second.getArray("operations").push([secondOperation]);
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

test("clone validation accepts concurrent recovery of the same immutable operation ID", () => {
  const { validateDrawingClientUpdate, validatePersistedDrawingState } =
    requireModules();
  const base = initializedDocument();
  const baseState = Y.encodeStateAsUpdate(base);
  const baseVector = Y.encodeStateVector(base);
  const first = new Y.Doc();
  const second = new Y.Doc();
  Y.applyUpdate(first, baseState);
  Y.applyUpdate(second, baseState);
  for (const document of [first, second])
    document.transact(() => {
      document.getArray("operations").push([operation()]);
      document.getArray("operationOrder").push([ids.operation]);
    });
  const firstUpdate = Y.encodeStateAsUpdate(first, baseVector);
  const secondUpdate = Y.encodeStateAsUpdate(second, baseVector);
  const context = {
    userId: ids.actor,
    projectId: ids.project,
    revisionId: ids.revision,
    canWrite: true,
  };
  for (const [accepted, candidate] of [
    [firstUpdate, secondUpdate],
    [secondUpdate, firstUpdate],
  ]) {
    const merged = new Y.Doc();
    Y.applyUpdate(merged, baseState);
    Y.applyUpdate(merged, accepted);
    assert.doesNotThrow(() =>
      validateDrawingClientUpdate(merged, candidate, context),
    );
    Y.applyUpdate(merged, candidate);
    assert.doesNotThrow(() =>
      validatePersistedDrawingState(Y.encodeStateAsUpdate(merged), {
        projectId: ids.project,
        revisionId: ids.revision,
      }),
    );
  }
});

test("all boundaries reject one-sided duplicate contribution multiplicities", () => {
  const { validateDrawingClientUpdate, validatePersistedDrawingState } =
    requireModules();
  const context = {
    userId: ids.actor,
    projectId: ids.project,
    revisionId: ids.revision,
    canWrite: true,
  };
  for (const mutate of [
    (document) => document.getArray("operations").push([operation()]),
    (document) => document.getArray("operationOrder").push([ids.operation]),
  ]) {
    const current = initializedDocument();
    Y.applyUpdate(current, appendUpdate(current));
    const candidate = new Y.Doc();
    Y.applyUpdate(candidate, Y.encodeStateAsUpdate(current));
    const vector = Y.encodeStateVector(current);
    mutate(candidate);
    const update = Y.encodeStateAsUpdate(candidate, vector);
    assert.throws(() => validateDrawingClientUpdate(current, update, context));
    Y.applyUpdate(current, update);
    assert.throws(() =>
      validatePersistedDrawingState(Y.encodeStateAsUpdate(current), {
        projectId: ids.project,
        revisionId: ids.revision,
      }),
    );
  }
});

test("clone validation rejects every hidden mismatched envelope across 100 CRDT orders", () => {
  const { validateDrawingClientUpdate, validatePersistedDrawingState } =
    requireModules();
  const context = {
    userId: ids.actor,
    projectId: ids.project,
    revisionId: ids.revision,
    canWrite: true,
  };
  const canonical = operation();
  for (let trial = 0; trial < 100; trial++) {
    const mismatched =
      trial % 2
        ? {
            ...structuredClone(canonical),
            createdAt: "2026-08-26T00:00:01.000Z",
          }
        : {
            ...structuredClone(canonical),
            forward: {
              ...structuredClone(canonical.forward),
              layer: {
                ...structuredClone(canonical.forward.layer),
                name: `Mismatch ${trial}`,
              },
            },
          };
    const base = initializedDocument();
    const baseState = Y.encodeStateAsUpdate(base);
    const baseVector = Y.encodeStateVector(base);
    const accepted = new Y.Doc();
    const candidate = new Y.Doc();
    Y.applyUpdate(accepted, baseState);
    Y.applyUpdate(candidate, baseState);
    accepted.clientID = 20_001 + trial * 2;
    candidate.clientID = 20_000 + trial * 2;
    for (const [document, envelope] of [
      [accepted, trial % 2 ? canonical : mismatched],
      [candidate, trial % 2 ? mismatched : canonical],
    ])
      document.transact(() => {
        document.getArray("operations").push([envelope]);
        document.getArray("operationOrder").push([ids.operation]);
      });
    const current = new Y.Doc();
    Y.applyUpdate(current, baseState);
    Y.applyUpdate(current, Y.encodeStateAsUpdate(accepted, baseVector));
    assert.throws(
      () =>
        validateDrawingClientUpdate(
          current,
          Y.encodeStateAsUpdate(candidate, baseVector),
          context,
        ),
      undefined,
      `trial ${trial}`,
    );
    Y.applyUpdate(current, Y.encodeStateAsUpdate(candidate, baseVector));
    assert.throws(() =>
      validatePersistedDrawingState(Y.encodeStateAsUpdate(current), {
        projectId: ids.project,
        revisionId: ids.revision,
      }),
    );
  }
});

test("clone validation rejects delete-reinsert reordering of existing operation entries", () => {
  const { validateDrawingClientUpdate } = requireModules();
  const current = initializedDocument();
  Y.applyUpdate(current, appendUpdate(current));
  const second = operation({
    clientOperationId: ids.operation2,
    forward: {
      ...operation().forward,
      layer: { ...operation().forward.layer, id: ids.layer2, name: "Second" },
    },
  });
  Y.applyUpdate(current, appendUpdate(current, second));
  const attacker = new Y.Doc();
  Y.applyUpdate(attacker, Y.encodeStateAsUpdate(current));
  const vector = Y.encodeStateVector(current);
  const third = operation({
    clientOperationId: ids.operation3,
    forward: {
      ...operation().forward,
      layer: { ...operation().forward.layer, id: ids.layer3, name: "Third" },
    },
  });
  attacker.transact(() => {
    attacker.getArray("operationOrder").delete(0, 1);
    attacker.getArray("operationOrder").push([ids.operation, ids.operation3]);
    attacker.getArray("operations").push([third]);
  });
  assert.throws(() =>
    validateDrawingClientUpdate(
      current,
      Y.encodeStateAsUpdate(attacker, vector),
      {
        userId: ids.actor,
        projectId: ids.project,
        revisionId: ids.revision,
        canWrite: true,
      },
    ),
  );
});

test("clone validation rejects equal-value writes to protected CRDT structures", () => {
  const { validateDrawingClientUpdate } = requireModules();
  const current = initializedDocument();
  Y.applyUpdate(current, appendUpdate(current));
  const context = {
    userId: ids.actor,
    projectId: ids.project,
    revisionId: ids.revision,
    canWrite: true,
  };
  const maliciousUpdate = (mutation) => {
    const attacker = new Y.Doc();
    Y.applyUpdate(attacker, Y.encodeStateAsUpdate(current));
    const vector = Y.encodeStateVector(current);
    attacker.transact(mutation.bind(null, attacker));
    return Y.encodeStateAsUpdate(attacker, vector);
  };
  assert.throws(() =>
    validateDrawingClientUpdate(
      current,
      maliciousUpdate((attacker) =>
        attacker.getMap("serverMeta").set("freezeState", "active"),
      ),
      context,
    ),
  );
  const third = operation({
    clientOperationId: ids.operation3,
    forward: {
      ...operation().forward,
      layer: { ...operation().forward.layer, id: ids.layer3, name: "Third" },
    },
  });
  assert.throws(() =>
    validateDrawingClientUpdate(
      current,
      maliciousUpdate((attacker) => {
        const operations = attacker.getArray("operations");
        operations.delete(0, 1);
        operations.push([operation(), third]);
        attacker.getArray("operationOrder").push([ids.operation3]);
      }),
      context,
    ),
  );
  assert.throws(() =>
    validateDrawingClientUpdate(
      current,
      maliciousUpdate((attacker) => {
        const order = attacker.getArray("operationOrder");
        order.delete(0, 1);
        order.insert(0, [ids.operation]);
        order.push([ids.operation3]);
        attacker.getArray("operations").push([third]);
      }),
      context,
    ),
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
  const ownDocument = new Y.Doc();
  ownDocument.clientID = 1;
  const ownAwareness = new Awareness(ownDocument);
  ownAwareness.setLocalState({ user: { id: ids.actor } });
  applyAwarenessUpdate(
    roomAwareness,
    encodeAwarenessUpdate(ownAwareness, [1]),
    null,
  );
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
  await assert.doesNotReject(() =>
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
              awareness: roomAwareness,
              origin: { source: "connection", connection },
            }),
        },
      },
      connection,
    ),
  );
  assert.equal(roomAwareness.getStates().has(99), true);
  assert.equal(roomAwareness.getStates().has(1), false);
  ownAwareness.destroy();
  ownDocument.destroy();
  peerAwareness.destroy();
  peerDocument.destroy();
  roomAwareness.destroy();
  roomDocument.destroy();
  await runtime.stop();
});

test("real HocuspocusProvider syncs and publishes one bounded cursor state", async () => {
  const { createDrawingCollaborationServer } = requireModules();
  class OriginWebSocket extends CrossWebSocket {
    constructor(url) {
      super(url, [], { origin: "https://app.example.com" });
    }
  }
  const runtime = createDrawingCollaborationServer({
    config: {
      port: 0,
      instanceId: "collab-provider-a",
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
      email: "editor@example.com",
      expiresAtMs: Date.now() + 120_000,
    }),
    authorize: async () => ({
      capability: "editor",
      canWrite: true,
      revisionStatus: "draft",
    }),
    storage: durableBootstrapStorage(),
  });
  const server = await runtime.start();
  let provider;
  try {
    let resolveAdmission;
    const admission = new Promise((resolve) => {
      resolveAdmission = resolve;
    });
    const synced = new Promise((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("provider sync timed out")),
        2_000,
      );
      provider = new HocuspocusProvider({
        url: server.webSocketURL,
        name: roomName,
        token: "test-token",
        WebSocketPolyfill: OriginWebSocket,
        onSynced: () => {
          clearTimeout(timeout);
          resolve();
        },
        onAuthenticationFailed: ({ reason }) => {
          clearTimeout(timeout);
          reject(new Error(reason));
        },
        onStateless: ({ payload }) => {
          const value = JSON.parse(payload);
          if (value.type === "1hk-collaboration-admission")
            resolveAdmission(value.instanceId);
        },
      });
    });
    await synced;
    assert.equal(await admission, "collab-provider-a");
    provider.setAwarenessField("cursorWorld", { x: 12, y: 34 });
    const deadline = Date.now() + 2_000;
    let cursorState;
    while (Date.now() < deadline) {
      const document = runtime.hocuspocus.documents.get(roomName);
      cursorState = [...(document?.awareness.getStates().values() ?? [])].find(
        (state) => state.cursorWorld?.x === 12,
      );
      if (cursorState) break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.deepEqual(cursorState?.cursorWorld, { x: 12, y: 34 });
    assert.equal(cursorState?.user.id, ids.actor);
    const clientId = provider.awareness.clientID;
    provider.awareness.setLocalState(null);
    const removalDeadline = Date.now() + 2_000;
    while (Date.now() < removalDeadline) {
      const document = runtime.hocuspocus.documents.get(roomName);
      if (!document?.awareness.getStates().has(clientId)) break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(
      runtime.hocuspocus.documents
        .get(roomName)
        ?.awareness.getStates()
        .has(clientId) ?? false,
      false,
    );
    provider.awareness.setLocalState({ cursorWorld: { x: 56, y: 78 } });
    const republishDeadline = Date.now() + 2_000;
    while (Date.now() < republishDeadline) {
      const state = runtime.hocuspocus.documents
        .get(roomName)
        ?.awareness.getStates()
        .get(clientId);
      if (state?.cursorWorld?.x === 56) break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.deepEqual(
      runtime.hocuspocus.documents
        .get(roomName)
        ?.awareness.getStates()
        .get(clientId)?.cursorWorld,
      { x: 56, y: 78 },
    );
    provider.destroy();
    provider = undefined;
    const disconnectDeadline = Date.now() + 2_000;
    while (Date.now() < disconnectDeadline) {
      if (
        !runtime.hocuspocus.documents
          .get(roomName)
          ?.awareness.getStates()
          .has(clientId)
      )
        break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(
      runtime.hocuspocus.documents
        .get(roomName)
        ?.awareness.getStates()
        .has(clientId) ?? false,
      false,
    );
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("provider reconnect timed out")),
        2_000,
      );
      provider = new HocuspocusProvider({
        url: server.webSocketURL,
        name: roomName,
        token: "test-token",
        WebSocketPolyfill: OriginWebSocket,
        onSynced: () => {
          clearTimeout(timeout);
          resolve();
        },
        onAuthenticationFailed: ({ reason }) => {
          clearTimeout(timeout);
          reject(new Error(reason));
        },
      });
    });
    provider.setAwarenessField("cursorWorld", { x: 90, y: 12 });
    const reconnectDeadline = Date.now() + 2_000;
    while (Date.now() < reconnectDeadline) {
      const found = [
        ...(runtime.hocuspocus.documents
          .get(roomName)
          ?.awareness.getStates()
          .values() ?? []),
      ].some((state) => state.cursorWorld?.x === 90);
      if (found) break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(
      [
        ...(runtime.hocuspocus.documents
          .get(roomName)
          ?.awareness.getStates()
          .values() ?? []),
      ].some(
        (state) => state.cursorWorld?.x === 90 && state.user?.id === ids.actor,
      ),
      true,
    );
  } finally {
    provider?.destroy();
    await runtime.stop();
  }
});

test("production-shaped first boot keeps server metadata authoritative and converges its pending operation", async () => {
  const { createDrawingCollaborationServer } = requireModules();
  assert.ok(collaborationClientModule, "collaboration client must exist");
  class OriginWebSocket extends CrossWebSocket {
    constructor(url) {
      super(url, [], { origin: "https://app.example.com" });
    }
  }
  const document = new Y.Doc();
  collaborationClientModule.initializeDrawingCollaborationDocument({
    document,
    projectId: ids.project,
    revisionId: ids.revision,
    baseSnapshotSha256: "a".repeat(64),
    baseOperationSequence: 0,
  });
  document.transact(() => {
    document.getArray("operations").push([operation()]);
    document.getArray("operationOrder").push([ids.operation]);
  });
  const runtime = createDrawingCollaborationServer({
    config: {
      port: 0,
      instanceId: "collab-production-shape-a",
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
      email: "editor@example.com",
      expiresAtMs: Date.now() + 120_000,
    }),
    authorize: async () => ({
      capability: "editor",
      canWrite: true,
      revisionStatus: "draft",
    }),
    storage: durableBootstrapStorage(),
  });
  const server = await runtime.start();
  let provider;
  try {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("production-shaped sync timed out")),
        2_000,
      );
      provider = new HocuspocusProvider({
        url: server.webSocketURL,
        name: roomName,
        document,
        token: "test-token",
        WebSocketPolyfill: OriginWebSocket,
        onSynced: () => {
          clearTimeout(timeout);
          resolve();
        },
        onAuthenticationFailed: ({ reason }) => {
          clearTimeout(timeout);
          reject(new Error(reason));
        },
      });
    });
    await new Promise((resolve) => setTimeout(resolve, 150));
    const serverDocument = runtime.hocuspocus.documents.get(roomName);
    assert.equal(provider.isSynced, true);
    assert.ok(serverDocument, "room must remain loaded after the handshake");
    assert.deepEqual(serverDocument.getArray("operationOrder").toArray(), [
      ids.operation,
    ]);
    assert.deepEqual(document.getArray("operationOrder").toArray(), [
      ids.operation,
    ]);
    assert.equal(document.getMap("serverMeta").get("projectId"), ids.project);
  } finally {
    provider?.destroy();
    document.destroy();
    await runtime.stop();
  }
});

test("storage retries transient reads and uses exact generation/SHA CAS without stale overwrite", async () => {
  const { createDrawingCollaborationStorage } = requireModules();
  let loads = 0;
  let storeAttempts = 0;
  let lookupAttempts = 0;
  let serviceStores = 0;
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
      async loadService() {
        return {
          yjsState: new Uint8Array([1]),
          generation: 7,
          sha256: "d".repeat(64),
          baseOperationSequence: 3,
        };
      },
      async storeService(input) {
        serviceStores += 1;
        assert.equal("userId" in input, false);
        assert.equal(input.expectedGeneration, 7);
        return { generation: 8, sha256: "e".repeat(64) };
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
  const serviceScope = { projectId: ids.project, revisionId: ids.revision };
  await storage.loadService(serviceScope);
  await storage.storeService({
    ...serviceScope,
    state: new Uint8Array([2]),
    baseOperationSequence: 3,
  });
  assert.equal(serviceStores, 1);
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
  assert.equal(
    merged
      .getArray("operations")
      .toArray()
      .some((value) => value.clientOperationId === ids.operation),
    true,
  );
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
  assert.equal(
    live
      .getArray("operations")
      .toArray()
      .some((value) => value.clientOperationId === ids.operation2),
    true,
  );
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
  const deletionBody = JSON.stringify({
    receiptId: ids.operation,
    roomName,
    operationId: ids.operation,
    operation: deleteObjectOperation(),
    outcome: "acked",
    authoritativeSequence: 8,
    resultVersions: { [ids.layer]: null },
  });
  const deletionSignature = createHmac("sha256", secret)
    .update(deletionBody)
    .digest("hex");
  assert.deepEqual(verifier(deletionBody, deletionSignature).resultVersions, {
    [ids.layer]: null,
  });
  const historyOperation = operation({
    historyAction: "undo",
    originalOperationId: ids.operation2,
  });
  const acceptedBody = JSON.stringify({
    receiptId: ids.operation,
    roomName,
    operationId: ids.operation,
    operation: historyOperation,
    outcome: "acked",
    authoritativeSequence: 9,
    resultVersions: { [ids.layer]: 1 },
  });
  const acceptedSignature = createHmac("sha256", secret)
    .update(acceptedBody)
    .digest("hex");
  const acceptedReceipt = verifier(acceptedBody, acceptedSignature);
  assert.equal(acceptedReceipt.authoritativeSequence, 9);
  assert.equal(acceptedReceipt.operation.historyAction, "undo");
  assert.equal(acceptedReceipt.operation.originalOperationId, ids.operation2);
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

test("signed outcome receipts preserve every protocol-valid operation size", () => {
  const {
    createOutcomeReceiptVerifier,
    DRAWING_OUTCOME_RECEIPT_MAX_BYTES,
    DrawingCollaborationOperationSchema,
  } = requireModules();
  const secret = "large-receipt-secret-that-is-long-enough";
  const receipt = {
    receiptId: "00000000-0000-4000-8000-000000000406",
    roomName,
    operationId: ids.operation,
    operation: largeValidReceiptOperation(),
    outcome: "acked",
    authoritativeSequence: 1,
    resultVersions: Object.fromEntries(
      largeValidReceiptOperation().forward.objects.map(({ id }) => [id, 1]),
    ),
  };
  DrawingCollaborationOperationSchema.parse(receipt.operation);
  const body = JSON.stringify(receipt);
  assert.ok(Buffer.byteLength(body) > 16 * 1024);
  assert.ok(Buffer.byteLength(body) < DRAWING_OUTCOME_RECEIPT_MAX_BYTES);
  const signature = createHmac("sha256", secret).update(body).digest("hex");

  assert.equal(
    createOutcomeReceiptVerifier(secret)(body, signature).operation.type,
    "add_objects",
  );
});

test("signed outcome receipt verifier has one explicit 96 KiB boundary", () => {
  const { createOutcomeReceiptVerifier, DRAWING_OUTCOME_RECEIPT_MAX_BYTES } =
    requireModules();
  const secret = "bounded-receipt-secret-that-is-long-enough";
  const receipt = JSON.stringify({
    receiptId: "00000000-0000-4000-8000-000000000406",
    roomName,
    operationId: ids.operation,
    operation: operation(),
    outcome: "rejected",
    resultVersions: {},
  });
  assert.equal(DRAWING_OUTCOME_RECEIPT_MAX_BYTES, 96 * 1024);
  const atLimit = receipt.padEnd(DRAWING_OUTCOME_RECEIPT_MAX_BYTES, " ");
  const aboveLimit = `${atLimit} `;
  const verify = createOutcomeReceiptVerifier(secret);

  assert.doesNotThrow(() =>
    verify(
      atLimit,
      createHmac("sha256", secret).update(atLimit).digest("hex"),
    ),
  );
  assert.throws(() =>
    verify(
      aboveLimit,
      createHmac("sha256", secret).update(aboveLimit).digest("hex"),
    ),
  );
});

test("outcome endpoint persists a protocol-valid receipt above the legacy 16 KiB cap", async () => {
  const { createDrawingCollaborationServer } = requireModules();
  const secret = "large-endpoint-secret-that-is-long-enough";
  const largeOperation = largeValidReceiptOperation();
  const body = JSON.stringify({
    receiptId: "00000000-0000-4000-8000-000000000406",
    roomName,
    operationId: ids.operation,
    operation: largeOperation,
    outcome: "acked",
    authoritativeSequence: 1,
    resultVersions: Object.fromEntries(
      largeOperation.forward.objects.map(({ id }) => [id, 1]),
    ),
  });
  assert.ok(Buffer.byteLength(body) > 16 * 1024);
  let persisted = null;
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
      expiresAtMs: Date.now() + 60_000,
    }),
    authorize: async () => ({
      capability: "editor",
      canWrite: true,
      revisionStatus: "draft",
    }),
    storage: {
      load: async () => null,
      store: async () => {
        throw new Error("receipt must use service storage");
      },
      loadService: async () =>
        persisted ? storedState(persisted, stores + 1) : null,
      initializeServiceState: async (input) => {
        persisted ??= input.state;
        return storedState(persisted, 1, input.baseOperationSequence);
      },
      bootstrapService: async () => ({
        sha256: "a".repeat(64),
        operationSequence: 0,
      }),
      async storeService(input) {
        stores += 1;
        persisted = input.state;
        return {
          generation: stores,
          sha256: "a".repeat(64),
          state: input.state,
          baseOperationSequence: input.baseOperationSequence,
        };
      },
    },
    setInterval: () => 1,
    clearInterval: () => {},
  });
  const server = await runtime.start();
  try {
    const response = await fetch(`${server.httpURL}/internal/outcomes`, {
      method: "POST",
      body,
      headers: {
        "x-1hk-signature": createHmac("sha256", secret)
          .update(body)
          .digest("hex"),
      },
    });
    assert.equal(response.status, 204);
    assert.equal(stores, 1);
    const document = new Y.Doc();
    Y.applyUpdate(document, persisted);
    assert.equal(
      document.getMap("operationStatus").get(ids.operation).status,
      "acked",
    );
  } finally {
    await runtime.stop();
  }
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

test("poll reconciliation preserves exact accepted history lineage", async () => {
  const { reconcileAcceptedDrawingOperations } = requireModules();
  const doc = initializedDocument();
  const original = updateLayerOperation();
  Y.applyUpdate(doc, appendUpdate(doc, original));
  const undo = updateLayerOperation({
    clientOperationId: ids.operation2,
    historyAction: "undo",
    originalOperationId: ids.operation,
  });
  Y.applyUpdate(doc, appendUpdate(doc, undo));
  const accepted = (envelope, sequence) => ({
    revisionId: ids.revision,
    clientOperationId: envelope.clientOperationId,
    actorId: envelope.actorId,
    operationType: envelope.type,
    baseVersions: envelope.baseVersions,
    forward: envelope.forward,
    inverse: envelope.inverse,
    historyAction: envelope.historyAction ?? null,
    originalOperationId: envelope.originalOperationId ?? null,
    sequence,
    resultVersions: {},
  });
  await reconcileAcceptedDrawingOperations(doc, async () => [
    accepted(original, 1),
    accepted(undo, 2),
  ]);
  assert.equal(
    doc.getMap("operationStatus").get(ids.operation2).status,
    "acked",
  );

  const mismatch = initializedDocument();
  Y.applyUpdate(mismatch, appendUpdate(mismatch, original));
  Y.applyUpdate(mismatch, appendUpdate(mismatch, undo));
  await assert.rejects(() =>
    reconcileAcceptedDrawingOperations(mismatch, async () => [
      accepted(original, 1),
      { ...accepted(undo, 2), historyAction: "redo" },
    ]),
  );
  assert.equal(mismatch.getMap("operationStatus").size, 0);
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
  let initializations = 0;
  const storage = {
    load: async () => {
      throw Object.assign(new Error("removed actor"), { code: "P3A01" });
    },
    store: async () => {
      throw Object.assign(new Error("removed actor"), { code: "P3A02" });
    },
    bootstrap: async () => {
      throw Object.assign(new Error("removed actor"), { code: "P3A01" });
    },
    loadService: async () =>
      persisted
        ? {
            yjsState: persisted,
            generation: stores + 1,
            sha256: createHash("sha256").update(persisted).digest("hex"),
            baseOperationSequence: 0,
          }
        : null,
    initializeServiceState: async (input) => {
      initializations += 1;
      persisted ??= input.state;
      return storedState(persisted, 1, input.baseOperationSequence);
    },
    bootstrapService: async () => ({
      sha256: "a".repeat(64),
      operationSequence: 0,
    }),
    async storeService(input) {
      stores += 1;
      assert.equal("userId" in input, false);
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
  assert.equal(initializations, 1);
});

test("signed outcome replay accepts only a clock-repaired DB bootstrap operation", async () => {
  const { createDrawingCollaborationServer } = requireModules();
  const secret = "receipt-secret-that-is-long-enough";
  const durable = operation();
  const resultVersions = { [ids.layer]: 1 };
  const signedReceipt = (envelope) => {
    const body = JSON.stringify({
      receiptId: "00000000-0000-4000-8000-000000000406",
      roomName,
      operationId: ids.operation,
      operation: envelope,
      outcome: "acked",
      authoritativeSequence: 1,
      resultVersions,
    });
    return {
      body,
      signature: createHmac("sha256", secret).update(body).digest("hex"),
    };
  };
  let stores = 0;
  let persisted = null;
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
      expiresAtMs: Date.now() + 60_000,
    }),
    authorize: async () => ({
      capability: "editor",
      canWrite: true,
      revisionStatus: "draft",
    }),
    storage: {
      load: async () => null,
      store: async () => {
        throw new Error("receipt must not use actor storage");
      },
      loadService: async () =>
        persisted ? storedState(persisted, stores + 1, 1) : null,
      initializeServiceState: async (input) => {
        persisted ??= input.state;
        return storedState(persisted, 1, input.baseOperationSequence);
      },
      bootstrapService: async () => ({
        sha256: "a".repeat(64),
        operationSequence: 1,
        recentOutcomes: [
          {
            revisionId: ids.revision,
            clientOperationId: durable.clientOperationId,
            actorId: durable.actorId,
            operationType: durable.type,
            baseVersions: durable.baseVersions,
            forward: durable.forward,
            inverse: durable.inverse,
            sequence: 1,
            resultVersions,
          },
        ],
      }),
      async storeService(input) {
        stores += 1;
        persisted = input.state;
        return {
          generation: stores,
          sha256: "a".repeat(64),
          state: input.state,
          baseOperationSequence: input.baseOperationSequence,
        };
      },
    },
    setInterval: () => 1,
    clearInterval: () => {},
  });

  try {
    const replay = signedReceipt(durable);
    await runtime.applyOutcomeReceipt(replay.body, replay.signature);
    assert.equal(stores, 1);

    const tampered = signedReceipt({
      ...durable,
      forward: {
        ...durable.forward,
        layer: { ...durable.forward.layer, name: "Tampered" },
      },
    });
    await assert.rejects(
      () => runtime.applyOutcomeReceipt(tampered.body, tampered.signature),
      /operation is immutable/,
    );
    assert.equal(stores, 1, "durable-field tampering must not be persisted");
  } finally {
    await runtime.stop();
  }
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
        throw new Error(`user store is forbidden for ${input.userId}`);
      },
      async storeService(input) {
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
  assert.equal("userId" in storedScopes.at(-1), false);
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

test("service reauthorization strips locks on a live read-only downgrade without dropping presence", async () => {
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
    [
      1,
      {
        user: { id: randomUUID(), displayName: "spoof", color: "#ffffff" },
        pageId: ids.project,
        canvasId: ids.revision,
        cursorWorld: { x: 12, y: 34 },
        selectedIds: [ids.layer],
        activeTool: "select",
        softLocks: [
          {
            entityId: ids.layer,
            leaseId: ids.operation2,
            expiresAt: 10_000,
          },
        ],
      },
    ],
  ]);
  await runtime.hooks.beforeAwareness({ context, states: awareness });
  assert.equal(awareness.get(1).user.id, ids.actor);
  assert.deepEqual(awareness.get(1).softLocks, [
    {
      entityId: ids.layer,
      leaseId: ids.operation2,
      expiresAt: 10_000,
    },
  ]);
  const sourceDocument = new Y.Doc();
  sourceDocument.clientID = 1;
  const sourceAwareness = new Awareness(sourceDocument);
  sourceAwareness.setLocalState(awareness.get(1));
  const roomDocument = new Y.Doc();
  const roomAwareness = new Awareness(roomDocument);
  applyAwarenessUpdate(
    roomAwareness,
    encodeAwarenessUpdate(sourceAwareness, [1]),
    null,
  );
  const propagated = [];
  roomAwareness.on("update", ({ updated }) => {
    if (updated.includes(1)) propagated.push(roomAwareness.getStates().get(1));
  });
  connection.document = {
    awareness: roomAwareness,
    getClients: (target) => (target === connection ? new Set([1]) : new Set()),
  };
  access = { capability: "viewer", canWrite: false, revisionStatus: "draft" };
  now = 5_000;
  await runtime.runPassiveAuthorizationCheck();
  assert.equal(connection.readOnly, true);
  assert.equal(connection.closed, false);
  assert.deepEqual(roomAwareness.getStates().get(1).cursorWorld, {
    x: 12,
    y: 34,
  });
  assert.deepEqual(roomAwareness.getStates().get(1).selectedIds, [ids.layer]);
  assert.deepEqual(
    roomAwareness.getStates().get(1).softLocks,
    [],
    "a live downgrade must immediately rewrite its old edit lock",
  );
  assert.deepEqual(
    propagated.at(-1)?.softLocks,
    [],
    "the server rewrite must be propagated without waiting for a heartbeat",
  );
  await runtime.hooks.beforeAwareness({ context, states: awareness });
  assert.deepEqual(awareness.get(1).cursorWorld, { x: 12, y: 34 });
  assert.deepEqual(awareness.get(1).selectedIds, [ids.layer]);
  assert.deepEqual(
    awareness.get(1).softLocks,
    [],
    "read-only Awareness must keep presence fields but never accept locks",
  );
  access = { capability: "editor", canWrite: true, revisionStatus: "draft" };
  now = 90_000;
  await runtime.runPassiveAuthorizationCheck();
  assert.equal(connection.tokenRequests, 1);
  now = 120_000;
  await runtime.runPassiveAuthorizationCheck();
  assert.equal(connection.closed, true);
  await runtime.stop();
  sourceAwareness.destroy();
  sourceDocument.destroy();
  roomAwareness.destroy();
  roomDocument.destroy();
});

test("token sync strips live locks when refreshed authority becomes read-only", async () => {
  const { createDrawingCollaborationServer } = requireModules();
  let access = {
    capability: "editor",
    canWrite: true,
    revisionStatus: "draft",
  };
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
    },
    now: () => 0,
    setInterval: () => 1,
    clearInterval: () => {},
  });
  const context = await runtime.hooks.authenticate({
    token: "writer-token",
    origin: "https://app.example.com",
    roomName,
  });
  const sourceDocument = new Y.Doc();
  sourceDocument.clientID = 1;
  const sourceAwareness = new Awareness(sourceDocument);
  sourceAwareness.setLocalState({
    cursorWorld: { x: 7, y: 9 },
    selectedIds: [ids.layer],
    softLocks: [
      {
        entityId: ids.layer,
        leaseId: ids.operation2,
        expiresAt: 10_000,
      },
    ],
  });
  const roomDocument = new Y.Doc();
  const roomAwareness = new Awareness(roomDocument);
  applyAwarenessUpdate(
    roomAwareness,
    encodeAwarenessUpdate(sourceAwareness, [1]),
    null,
  );
  const connection = {
    context,
    readOnly: false,
    close() {},
    document: {
      awareness: roomAwareness,
      getClients: (target) =>
        target === connection ? new Set([1]) : new Set(),
    },
  };

  access = { capability: "viewer", canWrite: false, revisionStatus: "draft" };
  await runtime.hocuspocus.configuration.onTokenSync({
    token: "viewer-token",
    requestHeaders: new Headers({ origin: "https://app.example.com" }),
    documentName: roomName,
    context,
    connection,
  });

  assert.equal(connection.readOnly, true);
  assert.deepEqual(roomAwareness.getStates().get(1).cursorWorld, {
    x: 7,
    y: 9,
  });
  assert.deepEqual(roomAwareness.getStates().get(1).selectedIds, [ids.layer]);
  assert.deepEqual(roomAwareness.getStates().get(1).softLocks, []);
  await runtime.stop();
  sourceAwareness.destroy();
  sourceDocument.destroy();
  roomAwareness.destroy();
  roomDocument.destroy();
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
    storage: durableBootstrapStorage(),
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
  assert.equal(
    document
      .getArray("operations")
      .toArray()
      .some((value) => value.clientOperationId === ids.operation),
    true,
  );
  await runtime.stop();
});

test("health distinguishes readiness and graceful shutdown flushes exactly once", async () => {
  const { createDrawingCollaborationServer } = requireModules();
  let flushes = 0;
  let destroys = 0;
  const runtime = createDrawingCollaborationServer({
    config: {
      port: 0,
      instanceId: "collab-runtime-a",
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
  assert.deepEqual(await runtime.health(), {
    live: true,
    ready: true,
    instanceId: "collab-runtime-a",
  });
  await Promise.all([runtime.stop(), runtime.stop()]);
  assert.equal(flushes, 1);
  assert.equal(destroys, 1);
  assert.deepEqual(await runtime.health(), {
    live: false,
    ready: false,
    instanceId: "collab-runtime-a",
  });
});

test("the one-port server exposes real liveness and readiness HTTP probes", async () => {
  const { createDrawingCollaborationServer } = requireModules();
  const runtime = createDrawingCollaborationServer({
    config: {
      port: 0,
      instanceId: "collab-health-a",
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
    assert.deepEqual(await response.json(), {
      live: true,
      ready: true,
      instanceId: "collab-health-a",
    });
  } finally {
    await runtime.stop();
  }
});

test("internal endpoints enforce their distinct bounded request sizes before parsing", async () => {
  const {
    createDrawingCollaborationServer,
    DRAWING_OUTCOME_RECEIPT_MAX_BYTES,
  } = requireModules();
  const secret = "bounded-internal-secret-is-long-enough";
  let serviceLoads = 0;
  let freezeReads = 0;
  const runtime = createDrawingCollaborationServer({
    config: {
      port: 0,
      supabaseUrl,
      databaseUrl: "postgres://unused",
      allowedOrigins: new Set(["https://app.example.com"]),
      internalSecret: secret,
      freezeSecret: secret,
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
      loadService: async () => {
        serviceLoads += 1;
        return null;
      },
      bootstrap: async () => ({ sha256: "a".repeat(64), operationSequence: 0 }),
      store: async () => ({ generation: 1, sha256: "a".repeat(64) }),
      freeze: {
        async readFreeze() {
          freezeReads += 1;
          return null;
        },
        async beginFreeze() {
          throw new Error("must not parse");
        },
        async completeFreeze() {
          throw new Error("must not parse");
        },
        async releaseFreeze() {
          throw new Error("must not parse");
        },
        async syncReleasedState() {
          throw new Error("must not parse");
        },
      },
    },
  });
  const server = await runtime.start();
  try {
    const outcomeBody = `${JSON.stringify({ valid: true })}${" ".repeat(
      DRAWING_OUTCOME_RECEIPT_MAX_BYTES,
    )}`;
    const outcome = await fetch(`${server.httpURL}/internal/outcomes`, {
      method: "POST",
      body: outcomeBody,
      headers: {
        "x-1hk-signature": createHmac("sha256", secret)
          .update(outcomeBody)
          .digest("hex"),
      },
    });
    assert.equal(outcome.status, 413);
    const freezeBody = `${JSON.stringify({ action: "freeze", roomName, freezeRequestId: randomUUID() })}${" ".repeat(17 * 1024)}`;
    const freeze = await fetch(`${server.httpURL}/internal/freeze`, {
      method: "POST",
      body: freezeBody,
      headers: { "x-1hk-freeze-secret": secret },
    });
    assert.equal(freeze.status, 413);
    assert.equal(serviceLoads, 0);
    assert.equal(freezeReads, 0);
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
  let persisted = null;
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
      loadService: async () => persisted,
      initializeServiceState: async (input) =>
        (persisted ??= storedState(
          input.state,
          1,
          input.baseOperationSequence,
        )),
      bootstrap: async () => ({
        sha256: "a".repeat(64),
        operationSequence: 0,
      }),
      bootstrapService: async () => ({
        sha256: "a".repeat(64),
        operationSequence: 0,
      }),
      store: async () => {
        throw new Error("receipt must not use actor storage");
      },
      storeService: async () => {
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
  assert.match(
    dockerfile,
    /COPY collaboration\/package\.json collaboration\/package-lock\.json/,
  );
  const manifest = JSON.parse(
    await readFile(
      new URL("../collaboration/package.json", import.meta.url),
      "utf8",
    ),
  );
  assert.deepEqual(Object.keys(manifest.dependencies).sort(), [
    "@hocuspocus/server",
    "jose",
    "postgres",
    "y-protocols",
    "yjs",
    "zod",
  ]);
  assert.equal("devDependencies" in manifest, false);
  const lock = JSON.parse(
    await readFile(
      new URL("../collaboration/package-lock.json", import.meta.url),
      "utf8",
    ),
  );
  assert.deepEqual(
    Object.keys(lock.packages)
      .filter((path) => path.startsWith("node_modules/"))
      .map((path) => path.slice("node_modules/".length))
      .sort(),
    [
      "@hocuspocus/common",
      "@hocuspocus/server",
      "async-mutex",
      "crossws",
      "isomorphic.js",
      "jose",
      "kleur",
      "lib0",
      "postgres",
      "tslib",
      "y-protocols",
      "yjs",
      "zod",
    ],
  );
});
