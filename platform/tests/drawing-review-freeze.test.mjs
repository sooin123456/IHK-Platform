import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import * as Y from "yjs";

import * as drawingFreezeModule from "../collaboration/src/freeze.ts";
import {
  createDrawingFreezeSecretVerifier,
  createDrawingFreezeCoordinator as createProductionFreezeCoordinator,
  drawingFreezeManifest,
} from "../collaboration/src/freeze.ts";
import { DRAWING_COLLABORATION_SERVER_ORIGIN } from "../app/lukas/lib/drawing-collaboration-protocol.ts";
import {
  createDrawingCollaborationServer as createProductionCollaborationServer,
  validateDrawingClientUpdate,
} from "../collaboration/src/server.ts";
import { requestDrawingCollaborativeReview } from "../app/lukas/lib/drawing-workspace.server.ts";

const ids = {
  project: "00000000-0000-4000-8000-000000000901",
  revision: "00000000-0000-4000-8000-000000000902",
  actor: "00000000-0000-4000-8000-000000000903",
  operation: "00000000-0000-4000-8000-000000000904",
  layer: "00000000-0000-4000-8000-000000000905",
};
const roomName = `drawing:${ids.project}:${ids.revision}`;

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

function document(status = "acked") {
  const doc = new Y.Doc();
  const meta = doc.getMap("serverMeta");
  meta.set("schemaVersion", 1);
  meta.set("projectId", ids.project);
  meta.set("revisionId", ids.revision);
  meta.set("baseSnapshotSha256", "a".repeat(64));
  meta.set("baseOperationSequence", 0);
  meta.set("freezeState", "active");
  meta.set("freezeRequestId", null);
  doc.getArray("operations").push([operation()]);
  doc.getArray("operationOrder").push([ids.operation]);
  doc.getMap("operationStatus").set(ids.operation, {
    operationId: ids.operation,
    status,
    authoritativeSequence: status === "acked" ? 1 : null,
    resultVersions: status === "acked" ? { [ids.layer]: 1 } : {},
  });
  return doc;
}

function deferred() {
  let resolve;
  const promise = new Promise((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

async function assertIdentityStable(doc, reconcile) {
  const bytes = Y.encodeStateAsUpdate(doc);
  const vector = Y.encodeStateVector(doc);
  let updates = 0;
  const onUpdate = () => {
    updates += 1;
  };
  doc.on("update", onUpdate);
  try {
    await reconcile();
    await reconcile();
    assert.deepEqual(Y.encodeStateAsUpdate(doc), bytes);
    assert.deepEqual(Y.encodeStateVector(doc), vector);
    assert.equal(updates, 0);
  } finally {
    doc.off("update", onUpdate);
  }
}

function createDrawingFreezeCoordinator(input) {
  if (input.database.acquireFreezeLease)
    return createProductionFreezeCoordinator({
      ...input,
      setInterval: input.setInterval ?? (() => 1),
      clearInterval: input.clearInterval ?? (() => {}),
    });
  const testOwnerToken = input.ownerToken ?? randomUUID();
  let leaseRequestId = null;
  let leaseExpiresAtMs = null;
  const now = input.now ?? Date.now;
  const readFreeze = input.database.readFreeze.bind(input.database);
  const releaseFreeze = input.database.releaseFreeze?.bind(input.database);
  const syncReleasedState = input.database.syncReleasedState?.bind(
    input.database,
  );
  return createProductionFreezeCoordinator({
    ...input,
    ownerToken: testOwnerToken,
    setInterval: input.setInterval ?? (() => 1),
    clearInterval: input.clearInterval ?? (() => {}),
    database: {
      ...input.database,
      acquireFreezeLease: async (value) => {
        leaseRequestId = value.requestId;
        leaseExpiresAtMs = now() + value.leaseMs;
      },
      renewFreezeLease: async (value) => {
        leaseExpiresAtMs = now() + value.leaseMs;
      },
      releaseFreezeLease: async () => {
        leaseRequestId = null;
        leaseExpiresAtMs = null;
      },
      async readFreeze(scope) {
        const state = await readFreeze(scope);
        return state && leaseRequestId
          ? {
              ...state,
              ownerToken: testOwnerToken,
              ownerRequestId: leaseRequestId,
              leaseExpiresAtMs,
            }
          : state;
      },
      async releaseFreeze(value) {
        const state = await releaseFreeze(value);
        leaseRequestId = null;
        leaseExpiresAtMs = null;
        return state;
      },
      async syncReleasedState(value) {
        const state = await syncReleasedState(value);
        leaseRequestId = null;
        leaseExpiresAtMs = null;
        return state;
      },
    },
  });
}

function createDrawingCollaborationServer(input) {
  return createProductionCollaborationServer({
    ...input,
    setInterval: input.setInterval ?? (() => 1),
    clearInterval: input.clearInterval ?? (() => {}),
    storage: {
      ...input.storage,
      freeze: input.storage.freeze
        ? {
            acquireFreezeLease: async () => {},
            renewFreezeLease: async () => {},
            releaseFreezeLease: async () => {},
            ...input.storage.freeze,
          }
        : undefined,
    },
  });
}

function leasedFreezeStore(now) {
  let state = {
    state: "active",
    requestId: null,
    revisionStatus: "draft",
    revisionVersion: 1,
  };
  let lease = null;
  const calls = { begins: 0, completes: 0, releases: 0 };
  const snapshot = () => ({
    ...state,
    ownerToken: lease?.ownerToken ?? null,
    ownerRequestId: lease?.requestId ?? null,
    leaseExpiresAtMs: lease?.expiresAtMs ?? null,
  });
  const owns = (input) =>
    lease?.ownerToken === input.ownerToken &&
    lease.requestId === input.requestId &&
    lease.expiresAtMs > now();
  const requireOwner = (input) => {
    if (input.ownerToken === undefined) return;
    if (!owns(input)) throw new Error("Drawing freeze lease is not owned.");
  };
  const shared = {
    async acquireFreezeLease(input) {
      if (
        lease?.expiresAtMs > now() &&
        (lease.ownerToken !== input.ownerToken ||
          lease.requestId !== input.requestId)
      )
        throw new Error("Drawing freeze lease is busy.");
      if (
        lease?.expiresAtMs <= now() &&
        ["freezing", "frozen"].includes(state.state) &&
        state.requestId !== input.requestId
      )
        throw new Error("Drawing freeze recovery request does not match.");
      lease = {
        ownerToken: input.ownerToken,
        requestId: input.requestId,
        expiresAtMs: now() + input.leaseMs,
      };
      return snapshot();
    },
    async renewFreezeLease(input) {
      requireOwner(input);
      lease.expiresAtMs = now() + input.leaseMs;
      return snapshot();
    },
    async releaseFreezeLease(input) {
      requireOwner(input);
      lease = null;
      return snapshot();
    },
    async readFreeze() {
      return snapshot();
    },
    async beginFreeze(input) {
      requireOwner(input);
      if (state.state === "freezing" && state.requestId === input.requestId)
        return snapshot();
      calls.begins += 1;
      state = {
        state: "freezing",
        requestId: input.requestId,
        revisionStatus: "draft",
        revisionVersion: 1,
        frozenSubjectRevisionVersion: 1,
      };
      return snapshot();
    },
    async completeFreeze(input) {
      requireOwner(input);
      if (state.state !== "frozen") calls.completes += 1;
      state = {
        ...state,
        state: "frozen",
        manifestSha256: input.manifest.sha256,
        manifestCount: input.manifest.count,
        frozenBaseOperationSequence: input.manifest.baseOperationSequence,
        stateVectorBase64: input.manifest.stateVectorBase64,
        operationStatuses: input.manifest.operationStatuses,
      };
      return snapshot();
    },
    async releaseFreeze(input) {
      requireOwner(input);
      calls.releases += 1;
      state = {
        state: "released",
        requestId: input.requestId,
        revisionStatus: "draft",
        revisionVersion: 1,
      };
      lease = null;
      return snapshot();
    },
    async syncReleasedState(input) {
      requireOwner(input);
      lease = null;
      return snapshot();
    },
  };
  return {
    calls,
    database(overrides = {}) {
      return { ...shared, ...overrides };
    },
    snapshot,
  };
}

test("a foreign persisted lease fences a second coordinator before the owner reads", async () => {
  let clock = 0;
  const store = leasedFreezeStore(() => clock);
  const readStarted = deferred();
  const allowRead = deferred();
  let firstRead = true;
  const ownerDocument = document();
  const foreignDocument = document();
  const requestId = randomUUID();
  const owner = createDrawingFreezeCoordinator({
    database: store.database({
      async readFreeze() {
        if (firstRead) {
          firstRead = false;
          readStarted.resolve();
          await allowRead.promise;
        }
        return store.snapshot();
      },
    }),
    ownerToken: randomUUID(),
    now: () => clock,
    leaseMs: 100,
    setInterval: () => 1,
    clearInterval: () => {},
  });
  const foreign = createDrawingFreezeCoordinator({
    database: store.database(),
    ownerToken: randomUUID(),
    now: () => clock,
    leaseMs: 100,
    setInterval: () => 1,
    clearInterval: () => {},
  });
  const freezing = owner.freeze({
    document: ownerDocument,
    roomName,
    requestId,
  });
  await readStarted.promise;
  try {
    const held = await foreign.reconcileLoaded({
      document: foreignDocument,
      roomName,
    });
    assert.equal(held.freezeState, "freezing");
    assert.equal(held.freezeRequestId, requestId);
    assert.equal(
      foreignDocument.getMap("serverMeta").get("freezeState"),
      "freezing",
    );
    await assertIdentityStable(foreignDocument, () =>
      foreign.reconcileLoaded({ document: foreignDocument, roomName }),
    );
    assert.throws(() =>
      validateDrawingClientUpdate(
        foreignDocument,
        Y.encodeStateAsUpdate(document()),
        {
          userId: ids.actor,
          projectId: ids.project,
          revisionId: ids.revision,
          canWrite: true,
        },
      ),
    );
    assert.deepEqual(store.calls, { begins: 0, completes: 0, releases: 0 });
  } finally {
    allowRead.resolve();
    await freezing.catch(() => undefined);
  }
  const frozen = await freezing;
  assert.equal(frozen.freezeState, "frozen");
  assert.deepEqual(store.calls, { begins: 1, completes: 1, releases: 0 });
  clock += 1;
});

test("an expired persisted lease permits one takeover and denies stale completion", async () => {
  let clock = 0;
  const store = leasedFreezeStore(() => clock);
  const ownerPaused = deferred();
  const resumeOwner = deferred();
  const requestId = randomUUID();
  const ownerDocument = document();
  const takeoverDocument = document();
  const owner = createDrawingFreezeCoordinator({
    database: store.database(),
    reconcile: async () => {
      ownerPaused.resolve();
      await resumeOwner.promise;
    },
    ownerToken: randomUUID(),
    now: () => clock,
    leaseMs: 100,
    setInterval: () => 1,
    clearInterval: () => {},
  });
  const takeover = createDrawingFreezeCoordinator({
    database: store.database(),
    ownerToken: randomUUID(),
    now: () => clock,
    leaseMs: 100,
    setInterval: () => 1,
    clearInterval: () => {},
  });
  const original = owner.freeze({
    document: ownerDocument,
    roomName,
    requestId,
  });
  await ownerPaused.promise;
  const held = await takeover.reconcileLoaded({
    document: takeoverDocument,
    roomName,
  });
  assert.equal(held.freezeState, "freezing");
  assert.deepEqual(store.calls, { begins: 1, completes: 0, releases: 0 });
  assert.throws(() =>
    validateDrawingClientUpdate(
      takeoverDocument,
      Y.encodeStateAsUpdate(document()),
      {
        userId: ids.actor,
        projectId: ids.project,
        revisionId: ids.revision,
        canWrite: true,
      },
    ),
  );
  clock = 101;
  const recovered = await takeover.reconcileLoaded({
    document: takeoverDocument,
    roomName,
  });
  assert.equal(recovered.freezeState, "released");
  assert.deepEqual(store.calls, { begins: 1, completes: 1, releases: 1 });
  resumeOwner.resolve();
  await assert.rejects(original, /lease|owned/i);
  assert.deepEqual(store.calls, { begins: 1, completes: 1, releases: 1 });
});

test("the active owner heartbeat renews the persisted cross-instance fence", async () => {
  let clock = 0;
  let heartbeat = null;
  const store = leasedFreezeStore(() => clock);
  const paused = deferred();
  const resume = deferred();
  const requestId = randomUUID();
  const owner = createDrawingFreezeCoordinator({
    database: store.database(),
    reconcile: async () => {
      paused.resolve();
      await resume.promise;
    },
    ownerToken: randomUUID(),
    now: () => clock,
    leaseMs: 100,
    heartbeatMs: 25,
    setInterval(callback) {
      heartbeat = callback;
      return 1;
    },
    clearInterval: () => {},
  });
  const foreign = createDrawingFreezeCoordinator({
    database: store.database(),
    ownerToken: randomUUID(),
    now: () => clock,
    leaseMs: 100,
    setInterval: () => 1,
    clearInterval: () => {},
  });
  const freezing = owner.freeze({
    document: document(),
    roomName,
    requestId,
  });
  await paused.promise;
  clock = 50;
  heartbeat();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(store.snapshot().leaseExpiresAtMs, 150);
  clock = 101;
  const held = await foreign.reconcileLoaded({
    document: document(),
    roomName,
  });
  assert.equal(held.freezeState, "freezing");
  assert.deepEqual(store.calls, { begins: 1, completes: 0, releases: 0 });
  resume.resolve();
  assert.equal((await freezing).freezeState, "frozen");
  assert.deepEqual(store.calls, { begins: 1, completes: 1, releases: 0 });
});

test("a detached-load preparation heartbeat persists until cancel", async () => {
  let clock = 2_000;
  const intervals = [];
  const store = leasedFreezeStore(() => clock);
  const coordinator = createProductionFreezeCoordinator({
    database: store.database(),
    ownerToken: randomUUID(),
    now: () => clock,
    setInterval(callback) {
      intervals.push(callback);
      return intervals.length;
    },
    clearInterval() {},
  });
  const requestId = randomUUID();
  await coordinator.prepare({ roomName, requestId });
  const initialExpiry = store.snapshot().leaseExpiresAtMs;
  clock += 20_000;
  intervals[0]();
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(store.snapshot().leaseExpiresAtMs > initialExpiry);
  await coordinator.cancelPreparation({ roomName, requestId });
  assert.equal(store.snapshot().ownerToken, null);
});

test("same-request preparations share acquisition and only the last cancel releases", async () => {
  const clock = 4_000;
  const acquireStarted = deferred();
  const allowAcquire = deferred();
  const store = leasedFreezeStore(() => clock);
  const database = store.database();
  const acquire = database.acquireFreezeLease.bind(database);
  let acquires = 0;
  database.acquireFreezeLease = async (input) => {
    acquires += 1;
    acquireStarted.resolve();
    await allowAcquire.promise;
    return acquire(input);
  };
  const coordinator = createProductionFreezeCoordinator({
    database,
    ownerToken: randomUUID(),
    now: () => clock,
    setInterval: () => 1,
    clearInterval() {},
  });
  const requestId = randomUUID();
  const first = coordinator.prepare({ roomName, requestId });
  await acquireStarted.promise;
  const second = coordinator.prepare({ roomName, requestId });
  assert.equal(acquires, 1);
  allowAcquire.resolve();
  await Promise.all([first, second]);
  await coordinator.cancelPreparation({ roomName, requestId });
  assert.equal(store.snapshot().ownerRequestId, requestId);
  await coordinator.cancelPreparation({ roomName, requestId });
  assert.equal(store.snapshot().ownerToken, null);
});

test("an owner failure cannot release a same-request handoff preparation", async () => {
  const clock = 6_000;
  const completeStarted = deferred();
  const allowComplete = deferred();
  const store = leasedFreezeStore(() => clock);
  const coordinator = createProductionFreezeCoordinator({
    database: store.database({
      async completeFreeze() {
        completeStarted.resolve();
        await allowComplete.promise;
        throw new Error("forced owner failure");
      },
    }),
    ownerToken: randomUUID(),
    now: () => clock,
    setInterval: () => 1,
    clearInterval() {},
  });
  const requestId = randomUUID();
  const freezing = coordinator.freeze({
    document: document(),
    roomName,
    requestId,
  });
  await completeStarted.promise;
  await coordinator.prepare({ roomName, requestId });
  allowComplete.resolve();
  await assert.rejects(freezing, /forced owner failure/);
  assert.equal(store.calls.releases, 0);
  assert.equal(store.snapshot().ownerRequestId, requestId);
  await coordinator.cancelPreparation({ roomName, requestId });
  assert.equal(store.snapshot().ownerToken, null);
});

test("freeze manifest compares only immutable business fields and authoritative outcome", () => {
  const first = drawingFreezeManifest(document());
  const changedNoise = document();
  changedNoise.getArray("operations").delete(0, 1);
  changedNoise.getArray("operations").insert(0, [
    operation({
      createdAt: "2030-01-01T00:00:00.000Z",
      schemaVersion: 1,
    }),
  ]);
  const second = drawingFreezeManifest(changedNoise);
  assert.equal(first.sha256, second.sha256);
  assert.equal(first.count, 1);
  assert.deepEqual(Object.keys(first.operations[0]).sort(), [
    "actorId",
    "baseVersions",
    "clientOperationId",
    "forward",
    "historyAction",
    "inverse",
    "operationType",
    "originalOperationId",
    "resultVersions",
    "revisionId",
    "sequence",
  ]);
  assert.equal("createdAt" in first.operations[0], false);
  assert.equal("schemaVersion" in first.operations[0], false);
  assert.match(first.stateVectorBase64, /^[A-Za-z0-9+/]+={0,2}$/);
  assert.deepEqual(first.operationStatuses, [
    {
      clientOperationId: ids.operation,
      status: "acked",
      authoritativeSequence: 1,
      resultVersions: { [ids.layer]: 1 },
    },
  ]);
});

test("freeze manifest preserves an authoritative deleted result", () => {
  const deleted = document();
  deleted.getMap("operationStatus").set(ids.operation, {
    operationId: ids.operation,
    status: "acked",
    authoritativeSequence: 1,
    resultVersions: { [ids.layer]: null },
  });

  const manifest = drawingFreezeManifest(deleted);

  assert.deepEqual(manifest.operations[0].resultVersions, {
    [ids.layer]: null,
  });
  assert.deepEqual(manifest.operationStatuses[0].resultVersions, {
    [ids.layer]: null,
  });
});

test("pending and conflicted ledgers cannot freeze", () => {
  for (const status of ["pending", "conflicted"])
    assert.throws(
      () => drawingFreezeManifest(document(status)),
      /pending|conflict/i,
    );
});

test("freeze persists freezing before frozen and is idempotent across a lost response", async () => {
  const doc = document();
  const requestId = randomUUID();
  const calls = [];
  let persisted = null;
  const database = {
    async beginFreeze(input) {
      calls.push("freezing");
      persisted = { state: "freezing", requestId: input.requestId };
      return persisted;
    },
    async completeFreeze(input) {
      calls.push("frozen");
      persisted = {
        state: "frozen",
        requestId: input.requestId,
        manifestSha256: input.manifest.sha256,
        manifestCount: input.manifest.count,
        frozenBaseOperationSequence: input.manifest.baseOperationSequence,
      };
      throw new Error("freeze response was lost after commit");
    },
    async releaseFreeze() {
      calls.push("released");
    },
    async readFreeze() {
      return persisted;
    },
  };
  const coordinator = createDrawingFreezeCoordinator({ database });
  const first = await coordinator.freeze({
    document: doc,
    roomName,
    requestId,
  });
  const second = await coordinator.freeze({
    document: doc,
    roomName,
    requestId,
  });
  assert.deepEqual(calls, ["freezing", "frozen"]);
  assert.equal(first.manifestSha256, second.manifestSha256);
  assert.deepEqual(first.operations, second.operations);
  assert.equal(first.operations.length, 1);
  assert.equal(first.stateVectorBase64, second.stateVectorBase64);
  assert.deepEqual(first.operationStatuses, second.operationStatuses);
  assert.equal(doc.getMap("serverMeta").get("freezeState"), "frozen");

  const attacker = new Y.Doc();
  Y.applyUpdate(attacker, Y.encodeStateAsUpdate(doc));
  const candidate = operation({ clientOperationId: randomUUID() });
  attacker.getArray("operations").push([candidate]);
  attacker.getArray("operationOrder").push([candidate.clientOperationId]);
  const update = Y.encodeStateAsUpdate(attacker, Y.encodeStateVector(doc));
  assert.throws(() =>
    validateDrawingClientUpdate(doc, update, {
      userId: ids.actor,
      projectId: ids.project,
      revisionId: ids.revision,
      canWrite: true,
    }),
  );
});

test("a detached active owner fences a separately loaded document before begin commits", async () => {
  const ownerDocument = document();
  const loadedDocument = document();
  const requestId = randomUUID();
  const readStarted = deferred();
  const allowOwnerRead = deferred();
  let ownerRead = true;
  let state = {
    state: "active",
    requestId: null,
    revisionStatus: "draft",
    revisionVersion: 1,
  };
  const database = {
    async readFreeze() {
      if (ownerRead) {
        ownerRead = false;
        readStarted.resolve();
        await allowOwnerRead.promise;
      }
      return state;
    },
    async beginFreeze(input) {
      state = {
        state: "freezing",
        requestId: input.requestId,
        revisionStatus: "draft",
        revisionVersion: 1,
        frozenSubjectRevisionVersion: 1,
      };
      return state;
    },
    async completeFreeze(input) {
      state = {
        ...state,
        state: "frozen",
        manifestSha256: input.manifest.sha256,
        manifestCount: input.manifest.count,
        frozenBaseOperationSequence: input.manifest.baseOperationSequence,
        stateVectorBase64: input.manifest.stateVectorBase64,
        operationStatuses: input.manifest.operationStatuses,
      };
      return state;
    },
    async releaseFreeze() {
      throw new Error("must not release");
    },
    async syncReleasedState() {
      throw new Error("unused");
    },
  };
  const coordinator = createDrawingFreezeCoordinator({ database });
  const freeze = coordinator.freeze({
    document: ownerDocument,
    roomName,
    requestId,
  });
  await readStarted.promise;
  try {
    const held = await coordinator.reconcileLoaded({
      document: loadedDocument,
      roomName,
    });
    assert.equal(held.freezeState, "freezing");
    assert.equal(
      loadedDocument.getMap("serverMeta").get("freezeState"),
      "freezing",
    );
    assert.equal(
      loadedDocument.getMap("serverMeta").get("freezeRequestId"),
      requestId,
    );
    await assertIdentityStable(loadedDocument, () =>
      coordinator.reconcileLoaded({ document: loadedDocument, roomName }),
    );
    assert.throws(() =>
      validateDrawingClientUpdate(
        loadedDocument,
        Y.encodeStateAsUpdate(document()),
        {
          userId: ids.actor,
          projectId: ids.project,
          revisionId: ids.revision,
          canWrite: true,
        },
      ),
    );
  } finally {
    allowOwnerRead.resolve();
    await freeze.catch(() => undefined);
  }
  const frozen = await freeze;
  assert.equal(frozen.freezeState, "frozen");
});

test("the server owns a room before deferred detached storage load", async () => {
  const storedDocument = document();
  const liveDocument = document();
  const requestId = randomUUID();
  const loadStarted = deferred();
  const allowLoad = deferred();
  let failLoad = true;
  let state = {
    state: "active",
    requestId: null,
    revisionStatus: "draft",
    revisionVersion: 1,
  };
  const runtime = createDrawingCollaborationServer({
    config: {
      port: 0,
      supabaseUrl: "https://example.supabase.co",
      databaseUrl: "postgres://unused",
      allowedOrigins: new Set(["https://app.example.com"]),
      internalSecret: "i".repeat(32),
      freezeSecret: "f".repeat(32),
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
      async loadService() {
        loadStarted.resolve();
        await allowLoad.promise;
        if (failLoad) throw new Error("detached load failed");
        return { yjsState: Y.encodeStateAsUpdate(storedDocument) };
      },
      store: async () => ({ generation: 1, sha256: "a".repeat(64) }),
      bootstrap: async () => ({ sha256: "a".repeat(64), operationSequence: 0 }),
      freeze: {
        async readFreeze() {
          return state;
        },
        async beginFreeze(input) {
          state = {
            state: "freezing",
            requestId: input.requestId,
            revisionStatus: "draft",
            revisionVersion: 1,
            frozenSubjectRevisionVersion: 1,
          };
          return state;
        },
        async completeFreeze(input) {
          state = {
            ...state,
            state: "frozen",
            manifestSha256: input.manifest.sha256,
            manifestCount: input.manifest.count,
            frozenBaseOperationSequence: input.manifest.baseOperationSequence,
            stateVectorBase64: input.manifest.stateVectorBase64,
            operationStatuses: input.manifest.operationStatuses,
          };
          return state;
        },
        async releaseFreeze() {
          throw new Error("must not release");
        },
        async syncReleasedState() {
          throw new Error("unused");
        },
      },
    },
    setInterval: () => 1,
    clearInterval: () => {},
  });
  const freezing = runtime.applyFreezeRequest(
    JSON.stringify({ action: "freeze", roomName, freezeRequestId: requestId }),
    "f".repeat(32),
  );
  await loadStarted.promise;
  try {
    for (const persistedState of ["active", "released", "freezing", "frozen"]) {
      state = {
        state: persistedState,
        requestId: persistedState === "active" ? null : requestId,
        revisionStatus: "draft",
        revisionVersion: 1,
        ...(persistedState === "freezing" || persistedState === "frozen"
          ? { frozenSubjectRevisionVersion: 1 }
          : {}),
      };
      const candidate = persistedState === "active" ? liveDocument : document();
      runtime.hocuspocus.documents.set(roomName, candidate);
      const held = await runtime.reconcileLoadedDocument(candidate, roomName);
      assert.equal(held.freezeState, "freezing");
      await runtime.runReconciliationCheck();
      assert.equal(
        candidate.getMap("serverMeta").get("freezeState"),
        "freezing",
      );
      assert.equal(
        candidate.getMap("serverMeta").get("freezeRequestId"),
        requestId,
      );
      await assertIdentityStable(candidate, () =>
        runtime.reconcileLoadedDocument(candidate, roomName),
      );
      runtime.hocuspocus.documents.delete(roomName);
    }
    state = {
      state: "active",
      requestId: null,
      revisionStatus: "draft",
      revisionVersion: 1,
    };
    assert.equal(
      liveDocument.getMap("serverMeta").get("freezeState"),
      "freezing",
    );
    assert.equal(
      liveDocument.getMap("serverMeta").get("freezeRequestId"),
      requestId,
    );
    assert.throws(() =>
      validateDrawingClientUpdate(
        liveDocument,
        Y.encodeStateAsUpdate(document()),
        {
          userId: ids.actor,
          projectId: ids.project,
          revisionId: ids.revision,
          canWrite: true,
        },
      ),
    );
    runtime.hocuspocus.documents.set(roomName, liveDocument);
    allowLoad.resolve();
    await assert.rejects(freezing, /detached load failed/);
    assert.equal(liveDocument.getMap("serverMeta").get("freezeState"), "active");
    assert.equal(liveDocument.getMap("serverMeta").get("freezeRequestId"), null);
    runtime.hocuspocus.documents.delete(roomName);
    await assertIdentityStable(liveDocument, () =>
      runtime.reconcileLoadedDocument(liveDocument, roomName),
    );
    failLoad = false;
    const frozen = await runtime.applyFreezeRequest(
      JSON.stringify({ action: "freeze", roomName, freezeRequestId: requestId }),
      "f".repeat(32),
    );
    assert.equal(frozen.freezeState, "frozen");
  } finally {
    allowLoad.resolve();
    await freezing.catch(() => undefined);
    runtime.hocuspocus.documents.delete(roomName);
    await runtime.stop();
  }
});

test("a committed freezing snapshot reconciles without mutating its identity", async () => {
  const doc = document();
  const requestId = "00000000-0000-4000-8000-000000000906";
  const state = {
    state: "freezing",
    requestId,
    revisionStatus: "review_requested",
    revisionVersion: 1,
    frozenSubjectRevisionVersion: 1,
  };
  const unexpectedMutation = () => {
    throw new Error("freeze mutation must not run");
  };
  const coordinator = createProductionFreezeCoordinator({
    database: {
      async readFreeze() {
        return state;
      },
      acquireFreezeLease: unexpectedMutation,
      renewFreezeLease: unexpectedMutation,
      releaseFreezeLease: unexpectedMutation,
      beginFreeze: unexpectedMutation,
      completeFreeze: unexpectedMutation,
      releaseFreeze: unexpectedMutation,
      syncReleasedState: unexpectedMutation,
    },
  });
  const reconciled = await coordinator.reconcileLoaded({ document: doc, roomName });
  assert.equal(reconciled.freezeState, "freezing");
  assert.equal(reconciled.freezeRequestId, requestId);
  await assertIdentityStable(doc, () =>
    coordinator.reconcileLoaded({ document: doc, roomName }),
  );
});

test("freeze metadata reconciliation changes only the differing field", async () => {
  const doc = document();
  const meta = doc.getMap("serverMeta");
  const keysChanged = [];
  const origins = [];
  const observer = (event, transaction) => {
    keysChanged.push([...event.keysChanged].sort());
    origins.push(transaction.origin);
  };
  meta.observe(observer);
  try {
    drawingFreezeModule.reconcileDrawingFreezeMetadata(doc, "freezing", null);
    assert.deepEqual(keysChanged, [["freezeState"]]);
    assert.deepEqual(origins, [DRAWING_COLLABORATION_SERVER_ORIGIN]);

    keysChanged.length = 0;
    origins.length = 0;
    const requestId = "00000000-0000-4000-8000-000000000907";
    drawingFreezeModule.reconcileDrawingFreezeMetadata(
      doc,
      "freezing",
      requestId,
    );
    assert.deepEqual(keysChanged, [["freezeRequestId"]]);
    assert.deepEqual(origins, [DRAWING_COLLABORATION_SERVER_ORIGIN]);

    keysChanged.length = 0;
    origins.length = 0;
    await assertIdentityStable(doc, () =>
      drawingFreezeModule.reconcileDrawingFreezeMetadata(
        doc,
        "freezing",
        requestId,
      ),
    );
    assert.deepEqual(keysChanged, []);
    assert.deepEqual(origins, []);
  } finally {
    meta.unobserve(observer);
  }
});

test("a live Hocuspocus freeze persists only through the freeze transaction", async () => {
  const source = document();
  const requestId = randomUUID();
  const freezeStore = leasedFreezeStore(Date.now);
  const freezeDatabase = freezeStore.database();
  const completeFreeze = freezeDatabase.completeFreeze;
  const completeEntered = deferred();
  const allowComplete = deferred();
  const completedStates = [];
  let durableComplete = false;
  let unloadedBeforeComplete = false;
  let actorStores = 0;
  let serviceStores = 0;
  freezeDatabase.completeFreeze = async (input) => {
    completedStates.push(input.yjsState);
    completeEntered.resolve();
    await allowComplete.promise;
    const frozen = await completeFreeze(input);
    durableComplete = true;
    return frozen;
  };
  const runtime = createDrawingCollaborationServer({
    config: {
      port: 0,
      supabaseUrl: "https://example.supabase.co",
      databaseUrl: "postgres://unused",
      allowedOrigins: new Set(["https://app.example.com"]),
      internalSecret: "i".repeat(32),
      freezeSecret: "f".repeat(32),
      authorizationIntervalMs: 30_000,
      debounceMs: 1,
      maxDebounceMs: 2,
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
        yjsState: Y.encodeStateAsUpdate(source),
        generation: 1,
        sha256: "a".repeat(64),
        baseOperationSequence: 0,
      }),
      async store() {
        actorStores += 1;
        return { generation: 2, sha256: "b".repeat(64) };
      },
      async storeService() {
        serviceStores += 1;
        return { generation: 2, sha256: "b".repeat(64) };
      },
      freeze: freezeDatabase,
    },
  });
  const context = await runtime.hooks.authenticate({
    token: "x",
    origin: "https://app.example.com",
    roomName,
  });
  const live = await runtime.hocuspocus.createDocument(
    roomName,
    new Request("http://localhost"),
    "freeze-store-test",
    { readOnly: false, isAuthenticated: true },
    context,
  );
  const unloaded = new Promise((resolve) => {
    const timeout = setTimeout(() => resolve(false), 500);
    live.once("destroy", () => {
      unloadedBeforeComplete = !durableComplete;
      clearTimeout(timeout);
      resolve(true);
    });
  });

  try {
    const freezing = runtime.applyFreezeRequest(
      JSON.stringify({
        action: "freeze",
        roomName,
        freezeRequestId: requestId,
      }),
      "f".repeat(32),
    );
    await completeEntered.promise;
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(live.isDestroyed, false);
    assert.equal(runtime.hocuspocus.documents.has(roomName), true);
    await assert.rejects(
      () =>
        runtime.hooks.store({
          document: live,
          roomName,
          context: {},
        }),
      /store scope is invalid/,
    );

    allowComplete.resolve();
    const frozen = await freezing;
    assert.equal(frozen.freezeState, "frozen");
    assert.equal(await unloaded, true);
    assert.equal(unloadedBeforeComplete, false);
    assert.equal(actorStores, 0);
    assert.equal(serviceStores, 0);
    assert.equal(runtime.hocuspocus.documents.has(roomName), false);
    assert.equal(live.isDestroyed, true);
    assert.equal(completedStates.length, 1);
    const persisted = new Y.Doc();
    Y.applyUpdate(persisted, completedStates[0]);
    assert.equal(persisted.getMap("serverMeta").get("freezeState"), "frozen");
    assert.equal(
      persisted.getMap("serverMeta").get("freezeRequestId"),
      requestId,
    );
    persisted.destroy();
  } finally {
    allowComplete.resolve();
    await runtime.stop();
    source.destroy();
  }
});

test("a persisted preparation lease rejects foreign live updates during detached load", async () => {
  let currentTime = 1_000;
  const store = leasedFreezeStore(() => currentTime);
  const loadStarted = deferred();
  const allowLoad = deferred();
  const source = document();
  const runtime = (loadService) =>
    createProductionCollaborationServer({
      config: {
        port: 0,
        supabaseUrl: "https://example.supabase.co",
        databaseUrl: "postgres://unused",
        allowedOrigins: new Set(["https://app.example.com"]),
        internalSecret: "i".repeat(32),
        freezeSecret: "f".repeat(32),
        authorizationIntervalMs: 30_000,
        debounceMs: 10,
        maxDebounceMs: 20,
      },
      verifyToken: async () => ({
        userId: ids.actor,
        email: null,
        expiresAtMs: currentTime + 60_000,
      }),
      authorize: async () => ({
        capability: "editor",
        canWrite: true,
        revisionStatus: "draft",
      }),
      storage: {
        load: async () => null,
        loadService,
        store: async () => ({ generation: 1, sha256: "a".repeat(64) }),
        bootstrap: async () => ({
          sha256: "a".repeat(64),
          operationSequence: 0,
        }),
        freeze: store.database(),
      },
      now: () => currentTime,
      setInterval: () => 1,
      clearInterval: () => {},
    });
  const owner = runtime(async () => {
    loadStarted.resolve();
    await allowLoad.promise;
    return { yjsState: Y.encodeStateAsUpdate(source) };
  });
  const foreign = runtime(async () => ({
    yjsState: Y.encodeStateAsUpdate(source),
  }));
  const requestId = randomUUID();
  const freezing = owner.applyFreezeRequest(
    JSON.stringify({ action: "freeze", roomName, freezeRequestId: requestId }),
    "f".repeat(32),
  );
  await loadStarted.promise;
  assert.equal(store.snapshot().ownerRequestId, requestId);

  const foreignDocument = document();
  const connection = {
    readOnly: false,
    closeCalls: [],
    close(event) {
      this.closeCalls.push(event);
    },
    requestToken() {},
  };
  await assert.rejects(
    foreign.hooks.beforeSync({
      context: {
        userId: ids.actor,
        email: null,
        expiresAtMs: currentTime + 60_000,
        projectId: ids.project,
        revisionId: ids.revision,
        roomName,
        displayName: "Editor",
        color: "#000000",
        lastAuthorizedAt: currentTime,
        capability: "editor",
        canWrite: true,
        revisionStatus: "draft",
      },
      document: foreignDocument,
      connection,
      type: 2,
      payload: Y.encodeStateAsUpdate(document()),
    }),
    /frozen for review/,
  );
  assert.equal(connection.readOnly, true);
  assert.equal(connection.closeCalls[0]?.reason, "review-freeze");
  assert.equal(
    foreignDocument.getMap("serverMeta").get("freezeState"),
    "freezing",
  );
  assert.equal(
    foreignDocument.getMap("serverMeta").get("freezeRequestId"),
    requestId,
  );

  allowLoad.resolve();
  const frozen = await freezing;
  assert.equal(frozen.freezeState, "frozen");
  assert.equal(store.calls.begins, 1);
  assert.equal(store.calls.completes, 1);
  await owner.stop();
  await foreign.stop();
});

test("a same-request server retry shares the active owner before detached load", async () => {
  const clock = 8_000;
  let loads = 0;
  const completeStarted = deferred();
  const allowComplete = deferred();
  const store = leasedFreezeStore(() => clock);
  const database = store.database({
    async completeFreeze() {
      completeStarted.resolve();
      await allowComplete.promise;
      throw new Error("forced complete failure");
    },
  });
  const runtime = createProductionCollaborationServer({
    config: {
      port: 0,
      supabaseUrl: "https://example.supabase.co",
      databaseUrl: "postgres://unused",
      allowedOrigins: new Set(["https://app.example.com"]),
      internalSecret: "i".repeat(32),
      freezeSecret: "f".repeat(32),
      authorizationIntervalMs: 30_000,
      debounceMs: 10,
      maxDebounceMs: 20,
    },
    verifyToken: async () => ({
      userId: ids.actor,
      email: null,
      expiresAtMs: clock + 60_000,
    }),
    authorize: async () => ({
      capability: "editor",
      canWrite: true,
      revisionStatus: "draft",
    }),
    storage: {
      load: async () => null,
      async loadService() {
        loads += 1;
        return { yjsState: Y.encodeStateAsUpdate(document()) };
      },
      store: async () => ({ generation: 1, sha256: "a".repeat(64) }),
      bootstrap: async () => ({
        sha256: "a".repeat(64),
        operationSequence: 0,
      }),
      freeze: database,
    },
    now: () => clock,
    setInterval: () => 1,
    clearInterval: () => {},
  });
  const requestId = randomUUID();
  const body = JSON.stringify({
    action: "freeze",
    roomName,
    freezeRequestId: requestId,
  });
  const first = runtime.applyFreezeRequest(body, "f".repeat(32));
  await completeStarted.promise;
  const retry = runtime.applyFreezeRequest(body, "f".repeat(32));
  assert.equal(loads, 1);
  allowComplete.resolve();
  await Promise.all([
    assert.rejects(first, /forced complete failure/),
    assert.rejects(retry, /forced complete failure/),
  ]);
  assert.equal(loads, 1);
  assert.equal(store.calls.releases, 1);
  await runtime.stop();
});

test("an active freeze owner fences periodic recovery until review commits", async () => {
  const doc = document();
  const requestId = randomUUID();
  const pause = deferred();
  const reached = deferred();
  let state = {
    state: "active",
    requestId: null,
    revisionStatus: "draft",
    revisionVersion: 1,
  };
  let begins = 0;
  let completes = 0;
  let releases = 0;
  const database = {
    async readFreeze() {
      return state;
    },
    async beginFreeze(input) {
      begins += 1;
      state = {
        state: "freezing",
        requestId: input.requestId,
        revisionStatus: "draft",
        revisionVersion: 1,
        frozenSubjectRevisionVersion: 1,
      };
      return state;
    },
    async completeFreeze(input) {
      completes += 1;
      state = {
        ...state,
        state: "frozen",
        manifestSha256: input.manifest.sha256,
        manifestCount: input.manifest.count,
        frozenBaseOperationSequence: input.manifest.baseOperationSequence,
        stateVectorBase64: input.manifest.stateVectorBase64,
        operationStatuses: input.manifest.operationStatuses,
        reviewCommitted: false,
      };
      return state;
    },
    async releaseFreeze() {
      releases += 1;
      state = {
        state: "released",
        requestId,
        revisionStatus: "draft",
        revisionVersion: 1,
      };
      return state;
    },
    async syncReleasedState() {
      return state;
    },
  };
  const coordinator = createDrawingFreezeCoordinator({
    database,
    async reconcile() {
      reached.resolve();
      await pause.promise;
    },
  });
  const original = coordinator.freeze({ document: doc, roomName, requestId });
  await reached.promise;
  const sameRequest = coordinator.freeze({
    document: doc,
    roomName,
    requestId,
  });
  await assert.rejects(
    coordinator.freeze({ document: doc, roomName, requestId: randomUUID() }),
    /already.*progress|owned/i,
  );
  const held = await coordinator.reconcileLoaded({ document: doc, roomName });
  assert.equal(held.freezeState, "freezing");
  await assert.rejects(
    coordinator.release({ document: doc, roomName, requestId }),
    /still in progress/i,
  );
  assert.equal(completes, 0);
  assert.equal(releases, 0);
  assert.throws(() =>
    validateDrawingClientUpdate(doc, Y.encodeStateAsUpdate(document()), {
      userId: ids.actor,
      projectId: ids.project,
      revisionId: ids.revision,
      canWrite: true,
    }),
  );
  pause.resolve();
  const [first, retry] = await Promise.all([original, sameRequest]);
  assert.equal(first.manifestSha256, retry.manifestSha256);
  assert.equal(begins, 1);
  assert.equal(completes, 1);
  await coordinator.reconcileLoaded({ document: doc, roomName });
  assert.equal(releases, 0);
  assert.equal(doc.getMap("serverMeta").get("freezeState"), "frozen");
  state = {
    ...state,
    revisionStatus: "review_requested",
    reviewCommitted: true,
  };
  await coordinator.reconcileLoaded({ document: doc, roomName });
  assert.equal(releases, 0);
});

test("a completed owner lease expires deterministically and recovers once", async () => {
  const doc = document();
  const requestId = randomUUID();
  let clock = 1_000;
  let state = {
    state: "active",
    requestId: null,
    revisionStatus: "draft",
    revisionVersion: 1,
  };
  let releases = 0;
  const database = {
    async readFreeze() {
      return state;
    },
    async beginFreeze(input) {
      state = {
        state: "freezing",
        requestId: input.requestId,
        revisionStatus: "draft",
        revisionVersion: 1,
        frozenSubjectRevisionVersion: 1,
      };
      return state;
    },
    async completeFreeze(input) {
      state = {
        ...state,
        state: "frozen",
        manifestSha256: input.manifest.sha256,
        manifestCount: input.manifest.count,
        frozenBaseOperationSequence: input.manifest.baseOperationSequence,
        stateVectorBase64: input.manifest.stateVectorBase64,
        operationStatuses: input.manifest.operationStatuses,
        reviewCommitted: false,
      };
      return state;
    },
    async releaseFreeze() {
      releases += 1;
      state = {
        state: "released",
        requestId,
        revisionStatus: "draft",
        revisionVersion: 1,
      };
      return state;
    },
    async syncReleasedState() {
      return state;
    },
  };
  const coordinator = createDrawingFreezeCoordinator({
    database,
    now: () => clock,
    completedLeaseMs: 100,
    leaseMs: 100,
  });
  await coordinator.freeze({ document: doc, roomName, requestId });
  clock = 1_099;
  await coordinator.reconcileLoaded({ document: doc, roomName });
  assert.equal(releases, 0);
  assert.equal(doc.getMap("serverMeta").get("freezeState"), "frozen");
  await assert.rejects(
    coordinator.freeze({ document: doc, roomName, requestId: randomUUID() }),
    /owned/i,
  );
  clock = 1_100;
  await coordinator.reconcileLoaded({ document: doc, roomName });
  await coordinator.reconcileLoaded({ document: doc, roomName });
  assert.equal(releases, 1);
  assert.equal(doc.getMap("serverMeta").get("freezeState"), "released");
});

test("validation failure releases the matching request but committed review never releases", async () => {
  for (const revisionStatus of ["draft", "review_requested", "approved"]) {
    const doc = document("pending");
    const requestId = randomUUID();
    const calls = [];
    const coordinator = createDrawingFreezeCoordinator({
      database: {
        async beginFreeze() {
          return { state: "freezing", requestId, revisionStatus };
        },
        async completeFreeze() {
          throw new Error("should not complete");
        },
        async releaseFreeze() {
          calls.push("released");
          return { state: "released", requestId, revisionStatus };
        },
        async readFreeze() {
          return { state: "freezing", requestId, revisionStatus };
        },
      },
    });
    await assert.rejects(() =>
      coordinator.freeze({ document: doc, roomName, requestId }),
    );
    assert.deepEqual(calls, revisionStatus === "draft" ? ["released"] : []);
  }
});

test("a review commit racing release leaves the live document frozen", async () => {
  const doc = document();
  const requestId = randomUUID();
  doc.getMap("serverMeta").set("freezeState", "frozen");
  doc.getMap("serverMeta").set("freezeRequestId", requestId);
  const coordinator = createDrawingFreezeCoordinator({
    database: {
      async readFreeze() {
        return { state: "frozen", requestId, revisionStatus: "draft" };
      },
      async beginFreeze() {
        throw new Error("unused");
      },
      async completeFreeze() {
        throw new Error("unused");
      },
      async releaseFreeze() {
        throw new Error("review committed before release");
      },
    },
  });
  await assert.rejects(() =>
    coordinator.release({ document: doc, roomName, requestId }),
  );
  assert.equal(doc.getMap("serverMeta").get("freezeState"), "frozen");
});

test("a fresh server resolves interrupted and rejected freezes before admission", async () => {
  const requestId = randomUUID();
  const interrupted = document();
  interrupted.getMap("serverMeta").set("freezeState", "freezing");
  interrupted.getMap("serverMeta").set("freezeRequestId", requestId);
  let state = {
    state: "freezing",
    requestId,
    revisionStatus: "draft",
    revisionVersion: 1,
    frozenSubjectRevisionVersion: 1,
  };
  const database = {
    async readFreeze() {
      return state;
    },
    async beginFreeze() {
      return state;
    },
    async completeFreeze(input) {
      state = {
        ...state,
        state: "frozen",
        manifestSha256: input.manifest.sha256,
        manifestCount: input.manifest.count,
        frozenBaseOperationSequence: input.manifest.baseOperationSequence,
        stateVectorBase64: input.manifest.stateVectorBase64,
        operationStatuses: input.manifest.operationStatuses,
      };
      return state;
    },
    async releaseFreeze() {
      state = {
        state: "released",
        requestId,
        revisionStatus: "draft",
        revisionVersion: state.revisionVersion,
      };
      return state;
    },
    async syncReleasedState() {
      throw new Error("unused");
    },
  };
  const createRuntime = () =>
    createDrawingCollaborationServer({
      config: {
        port: 0,
        supabaseUrl: "https://example.supabase.co",
        databaseUrl: "postgres://unused",
        allowedOrigins: new Set(["https://app.example.com"]),
        internalSecret: "i".repeat(32),
        freezeSecret: "f".repeat(32),
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
        store: async () => ({ generation: 1, sha256: "a".repeat(64) }),
        bootstrap: async () => ({
          sha256: "a".repeat(64),
          operationSequence: 0,
        }),
        freeze: database,
      },
      setInterval: () => 1,
      clearInterval: () => {},
    });
  const restarted = createRuntime();
  const recovered = await restarted.reconcileLoadedDocument(
    interrupted,
    roomName,
  );
  assert.equal(recovered.freezeState, "released");
  assert.equal(interrupted.getMap("serverMeta").get("freezeState"), "released");
  await restarted.stop();

  state = {
    state: "released",
    requestId,
    revisionStatus: "draft",
    revisionVersion: 2,
  };
  let synchronized = false;
  database.syncReleasedState = async (input) => {
    synchronized = true;
    const restored = new Y.Doc();
    Y.applyUpdate(restored, input.yjsState);
    assert.equal(restored.getMap("serverMeta").get("freezeState"), "released");
    restored.destroy();
    return state;
  };
  const afterRejection = new Y.Doc();
  Y.applyUpdate(afterRejection, Y.encodeStateAsUpdate(interrupted));
  afterRejection.transact(() => {
    afterRejection.getMap("serverMeta").set("freezeState", "frozen");
    afterRejection.getMap("serverMeta").set("freezeRequestId", requestId);
  });
  const secondRestart = createRuntime();
  const released = await secondRestart.reconcileLoadedDocument(
    afterRejection,
    roomName,
  );
  assert.equal(released.freezeState, "released");
  assert.equal(synchronized, true);
  assert.equal(
    afterRejection.getMap("serverMeta").get("freezeState"),
    "released",
  );
  await assertIdentityStable(afterRejection, () =>
    secondRestart.reconcileLoadedDocument(afterRejection, roomName),
  );
  await secondRestart.stop();
});

test("fresh servers replay exact committed freezes without acquiring a draft lease", async () => {
  for (const revisionStatus of ["review_requested", "reviewed", "approved"]) {
    const doc = document();
    const requestId = randomUUID();
    doc.getMap("serverMeta").set("freezeState", "frozen");
    doc.getMap("serverMeta").set("freezeRequestId", requestId);
    const manifest = drawingFreezeManifest(doc);
    const state = {
      state: "frozen",
      requestId,
      revisionStatus,
      revisionVersion: 1,
      frozenSubjectRevisionVersion: 1,
      manifestSha256: manifest.sha256,
      manifestCount: manifest.count,
      frozenBaseOperationSequence: manifest.baseOperationSequence,
      stateVectorBase64: manifest.stateVectorBase64,
      operationStatuses: manifest.operationStatuses,
      reviewCommitted: true,
    };
    let leaseAcquires = 0;
    let serviceLoads = 0;
    const runtime = createDrawingCollaborationServer({
      config: {
        port: 0,
        supabaseUrl: "https://example.supabase.co",
        databaseUrl: "postgres://unused",
        allowedOrigins: new Set(["https://app.example.com"]),
        internalSecret: "i".repeat(32),
        freezeSecret: "f".repeat(32),
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
        canWrite: false,
        revisionStatus,
      }),
      storage: {
        load: async () => null,
        async loadService() {
          serviceLoads += 1;
          return { yjsState: Y.encodeStateAsUpdate(doc) };
        },
        store: async () => ({ generation: 1, sha256: "a".repeat(64) }),
        bootstrap: async () => ({
          sha256: "a".repeat(64),
          operationSequence: 0,
        }),
        freeze: {
          async acquireFreezeLease() {
            leaseAcquires += 1;
            throw new Error("Drawing revision is permanently frozen");
          },
          async readFreeze() {
            return state;
          },
          async beginFreeze() {
            throw new Error("unused");
          },
          async completeFreeze() {
            throw new Error("unused");
          },
          async releaseFreeze() {
            throw new Error("unused");
          },
          async syncReleasedState() {
            throw new Error("must remain frozen");
          },
        },
      },
      setInterval: () => 1,
      clearInterval: () => {},
    });
    const recovered = await runtime.reconcileLoadedDocument(doc, roomName);
    assert.equal(recovered.freezeState, "frozen");
    await assertIdentityStable(doc, () =>
      runtime.reconcileLoadedDocument(doc, roomName),
    );
    const replayed = await runtime.applyFreezeRequest(
      JSON.stringify({
        action: "freeze",
        roomName,
        freezeRequestId: requestId,
      }),
      "f".repeat(32),
    );
    assert.equal(replayed.freezeState, "frozen");
    assert.equal(replayed.freezeRequestId, requestId);
    assert.equal(serviceLoads, 1);
    assert.equal(leaseAcquires, 0);
    await assert.rejects(
      runtime.applyFreezeRequest(
        JSON.stringify({
          action: "freeze",
          roomName,
          freezeRequestId: randomUUID(),
        }),
        "f".repeat(32),
      ),
      /permanently frozen/i,
    );
    assert.equal(serviceLoads, 1);
    assert.equal(leaseAcquires, 1);
    await runtime.stop();
  }
});

test("rejection authority immediately releases an already-loaded live room", async () => {
  const doc = document();
  const requestId = randomUUID();
  doc.getMap("serverMeta").set("freezeState", "frozen");
  doc.getMap("serverMeta").set("freezeRequestId", requestId);
  const state = {
    state: "released",
    requestId,
    revisionStatus: "draft",
    revisionVersion: 2,
  };
  let synchronized = 0;
  const runtime = createDrawingCollaborationServer({
    config: {
      port: 0,
      supabaseUrl: "https://example.supabase.co",
      databaseUrl: "postgres://unused",
      allowedOrigins: new Set(["https://app.example.com"]),
      internalSecret: "i".repeat(32),
      freezeSecret: "f".repeat(32),
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
      store: async () => ({ generation: 1, sha256: "a".repeat(64) }),
      bootstrap: async () => ({ sha256: "a".repeat(64), operationSequence: 0 }),
      freeze: {
        async readFreeze() {
          return state;
        },
        async beginFreeze() {
          throw new Error("unused");
        },
        async completeFreeze() {
          throw new Error("unused");
        },
        async releaseFreeze() {
          throw new Error("unused");
        },
        async syncReleasedState() {
          synchronized += 1;
          return state;
        },
      },
    },
    setInterval: () => 1,
    clearInterval: () => {},
  });
  runtime.hocuspocus.documents.set(roomName, doc);
  await runtime.applyFreezeRequest(
    JSON.stringify({ action: "authority", roomName }),
    "f".repeat(32),
  );
  assert.equal(synchronized, 1);
  assert.equal(doc.getMap("serverMeta").get("freezeState"), "released");
  const releasedBytes = Buffer.from(Y.encodeStateAsUpdate(doc));
  const releasedVector = Buffer.from(Y.encodeStateVector(doc));
  await runtime.runReconciliationCheck();
  await runtime.runReconciliationCheck();
  assert.equal(synchronized, 1);
  assert.deepEqual(Buffer.from(Y.encodeStateAsUpdate(doc)), releasedBytes);
  assert.deepEqual(Buffer.from(Y.encodeStateVector(doc)), releasedVector);
  await runtime.stop();
});

test("freeze authentication uses a separate constant-time bounded secret", () => {
  const secret = "f".repeat(32);
  const verify = createDrawingFreezeSecretVerifier(secret);
  assert.doesNotThrow(() => verify(secret));
  assert.throws(() => verify("x".repeat(32)), /authentication/i);
  assert.throws(() => verify("short"), /authentication/i);
  assert.throws(() => createDrawingFreezeSecretVerifier("short"));
});

test("application server freezes before the DB transition and releases the same request on validation failure", async () => {
  const requestId = randomUUID();
  const manifest = drawingFreezeManifest(document());
  const events = [];
  const fetcher = async (_url, init) => {
    const body = JSON.parse(init.body);
    events.push(body.action);
    assert.equal(init.headers["x-1hk-freeze-secret"], "f".repeat(32));
    assert.ok(init.signal instanceof AbortSignal);
    return {
      ok: true,
      status: 200,
      async json() {
        return {
          freezeState: body.action === "release" ? "released" : "frozen",
          freezeRequestId: requestId,
          manifestSha256: manifest.sha256,
          manifestCount: manifest.count,
          baseOperationSequence: manifest.baseOperationSequence,
          subjectRevisionVersion: 1,
          stateVectorBase64: manifest.stateVectorBase64,
          operationStatuses: manifest.operationStatuses,
          operations: manifest.operations,
        };
      },
    };
  };
  const client = {
    async rpc(name, args) {
      events.push("database");
      assert.equal(name, "lukas_drawing_request_collaborative_review");
      assert.equal(args.p_request_id, requestId);
      assert.equal(args.p_subject_revision_version, 1);
      assert.equal(args.p_state_vector_base64, manifest.stateVectorBase64);
      assert.deepEqual(args.p_operation_statuses, manifest.operationStatuses);
      return { data: null, error: { code: "P3F01", message: "mismatch" } };
    },
  };
  await assert.rejects(() =>
    requestDrawingCollaborativeReview({
      client,
      projectId: ids.project,
      revisionId: ids.revision,
      requestId,
      environment: {
        COLLABORATION_INTERNAL_URL: "http://collaboration.internal",
        COLLABORATION_FREEZE_SECRET: "f".repeat(32),
      },
      fetcher,
    }),
  );
  assert.deepEqual(events, ["freeze", "database", "release"]);

  events.length = 0;
  await assert.rejects(() =>
    requestDrawingCollaborativeReview({
      client,
      projectId: ids.project,
      revisionId: ids.revision,
      requestId,
      environment: {},
      fetcher,
    }),
  );
  assert.deepEqual(events, []);
});

test("application server reconciles the same freeze request after its response is lost", async () => {
  const requestId = randomUUID();
  const manifest = drawingFreezeManifest(document());
  const events = [];
  const result = await requestDrawingCollaborativeReview({
    client: {
      async rpc() {
        events.push("database");
        return { data: { snapshotId: randomUUID() }, error: null };
      },
    },
    projectId: ids.project,
    revisionId: ids.revision,
    requestId,
    environment: {
      COLLABORATION_INTERNAL_URL: "http://collaboration.internal",
      COLLABORATION_FREEZE_SECRET: "f".repeat(32),
    },
    async fetcher(_url, init) {
      const body = JSON.parse(init.body);
      events.push(body.action);
      if (body.action === "freeze") throw new Error("freeze response was lost");
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            freezeState: "frozen",
            freezeRequestId: requestId,
            manifestSha256: manifest.sha256,
            manifestCount: manifest.count,
            baseOperationSequence: manifest.baseOperationSequence,
            subjectRevisionVersion: 1,
            stateVectorBase64: manifest.stateVectorBase64,
            operationStatuses: manifest.operationStatuses,
            operations: manifest.operations,
          };
        },
      };
    },
  });
  assert.ok(result.snapshotId);
  assert.deepEqual(events, ["freeze", "reconcile", "database", "authority"]);
});

test("a definitively rejected DB transition safely releases the draft freeze", async () => {
  const requestId = randomUUID();
  const manifest = drawingFreezeManifest(document());
  const events = [];
  await assert.rejects(() =>
    requestDrawingCollaborativeReview({
      client: {
        async rpc() {
          events.push("database");
          return {
            data: null,
            error: { code: "P1R01", message: "permission revoked" },
          };
        },
      },
      projectId: ids.project,
      revisionId: ids.revision,
      requestId,
      environment: {
        COLLABORATION_INTERNAL_URL: "http://collaboration.internal",
        COLLABORATION_FREEZE_SECRET: "f".repeat(32),
      },
      async fetcher(_url, init) {
        const body = JSON.parse(init.body);
        events.push(body.action);
        return {
          ok: true,
          status: 200,
          async json() {
            return body.action === "release"
              ? { freezeState: "released", freezeRequestId: requestId }
              : {
                  freezeState: "frozen",
                  freezeRequestId: requestId,
                  manifestSha256: manifest.sha256,
                  manifestCount: manifest.count,
                  baseOperationSequence: manifest.baseOperationSequence,
                  subjectRevisionVersion: 1,
                  stateVectorBase64: manifest.stateVectorBase64,
                  operationStatuses: manifest.operationStatuses,
                  operations: manifest.operations,
                };
          },
        };
      },
    }),
  );
  assert.deepEqual(events, [
    "freeze",
    "database",
    "reconcile",
    "database",
    "release",
  ]);
});

test("internal freeze handler rejects browser credentials and returns a persisted manifest", async () => {
  const source = document();
  const requestId = randomUUID();
  let persisted = null;
  const runtime = createDrawingCollaborationServer({
    config: {
      port: 1234,
      supabaseUrl: "https://example.supabase.co",
      databaseUrl: "postgres://unused",
      allowedOrigins: new Set(["https://app.example.com"]),
      internalSecret: "o".repeat(32),
      freezeSecret: "f".repeat(32),
      authorizationIntervalMs: 30_000,
      debounceMs: 1_000,
      maxDebounceMs: 10_000,
    },
    async verifyToken() {
      throw new Error("unused");
    },
    async authorize() {
      return null;
    },
    storage: {
      async load() {
        return null;
      },
      async store() {
        throw new Error("unused");
      },
      async loadService() {
        return {
          yjsState: Y.encodeStateAsUpdate(source),
          generation: 1,
          sha256: "a".repeat(64),
          baseOperationSequence: 0,
        };
      },
      async storeService() {
        throw new Error("unused");
      },
      async lookupOperations() {
        return [];
      },
      freeze: {
        async readFreeze() {
          return persisted;
        },
        async beginFreeze(input) {
          persisted = {
            state: "freezing",
            requestId: input.requestId,
            revisionStatus: "draft",
          };
          return persisted;
        },
        async completeFreeze(input) {
          persisted = {
            state: "frozen",
            requestId: input.requestId,
            revisionStatus: "draft",
            manifestSha256: input.manifest.sha256,
            manifestCount: input.manifest.count,
            frozenBaseOperationSequence: input.manifest.baseOperationSequence,
          };
          return persisted;
        },
        async releaseFreeze() {
          throw new Error("unused");
        },
      },
    },
  });
  const body = JSON.stringify({
    action: "freeze",
    roomName,
    freezeRequestId: requestId,
  });
  await assert.rejects(() => runtime.applyFreezeRequest(body, "o".repeat(32)));
  const frozen = await runtime.applyFreezeRequest(body, "f".repeat(32));
  assert.equal(frozen.freezeState, "frozen");
  assert.equal(frozen.operations.length, 1);
  await runtime.stop();
});
