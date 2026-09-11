import assert from "node:assert/strict";
import { createHash, createHmac, randomUUID } from "node:crypto";
import test from "node:test";
import * as Y from "yjs";
import { HocuspocusProvider } from "@hocuspocus/provider";
import CrossWebSocket from "crossws/websocket";
import { openDrawingCollaborationConnection } from "../app/lukas/lib/drawing-collaboration-client.ts";
import { createDrawingCollaborationStorage } from "../collaboration/src/storage.ts";
import {
  createDrawingCollaborationServer,
  initializeDrawingCollaborationDocument,
  validateDrawingClientUpdate,
  validatePersistedDrawingState,
} from "../collaboration/src/server.ts";

const scope = {
  userId: randomUUID(),
  projectId: randomUUID(),
  revisionId: randomUUID(),
};
const roomName = `drawing:${scope.projectId}:${scope.revisionId}`;
const secret = "initialization-test-secret-32-characters";
const bootstrap = { sha256: "a".repeat(64), operationSequence: 0 };
const bytes = (doc) => Y.encodeStateAsUpdate(doc);
const hash = (state) => createHash("sha256").update(state).digest("hex");
function row(state, generation = 1, baseOperationSequence = 0) {
  return {
    yjsState: state,
    generation,
    sha256: hash(state),
    baseOperationSequence,
  };
}
async function canonical() {
  const doc = new Y.Doc();
  await initializeDrawingCollaborationDocument(doc, {
    ...scope,
    bootstrap: async () => bootstrap,
  });
  return doc;
}
function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function fixture(overrides = {}) {
  let persisted = null;
  const calls = {
    userInitializations: 0,
    serviceInitializations: 0,
    stores: 0,
    bootstraps: 0,
  };
  async function initialize(input, service) {
    calls[service ? "serviceInitializations" : "userInitializations"]++;
    persisted ??= row(input.state, 1, input.baseOperationSequence);
    return persisted;
  }
  async function store(input) {
    assert.equal(input.expectedGeneration, persisted?.generation ?? 0);
    assert.equal(input.expectedSha256, persisted?.sha256 ?? null);
    calls.stores++;
    persisted = row(
      input.state,
      (persisted?.generation ?? 0) + 1,
      input.baseOperationSequence,
    );
    return persisted;
  }
  const database = {
    load: async () => persisted,
    loadService: async () => persisted,
    bootstrap: async () => {
      calls.bootstraps++;
      return bootstrap;
    },
    bootstrapService: async () => {
      calls.bootstraps++;
      return bootstrap;
    },
    initializeState: (input) => initialize(input, false),
    initializeServiceState: (input) => initialize(input, true),
    store,
    storeService: store,
    ...overrides,
  };
  const storage = createDrawingCollaborationStorage({
    database,
    validateState: validatePersistedDrawingState,
    sleep: async () => {},
  });
  return {
    database,
    storage,
    calls,
    get persisted() {
      return persisted;
    },
    set persisted(value) {
      persisted = value;
    },
  };
}
function runtimeFor(
  storage,
  authorization = {
    capability: "editor",
    canWrite: true,
    revisionStatus: "draft",
  },
) {
  return createDrawingCollaborationServer({
    config: {
      port: 0,
      instanceId: "canonical-test",
      supabaseUrl: "https://example.supabase.co",
      databaseUrl: "postgres://unused",
      allowedOrigins: new Set(["https://app.example.com"]),
      internalSecret: secret,
      freezeSecret: secret,
      authorizationIntervalMs: 30_000,
      debounceMs: 10,
      maxDebounceMs: 20,
    },
    verifyToken: async () => ({
      userId: scope.userId,
      email: null,
      expiresAtMs: Date.now() + 120_000,
    }),
    authorize: async () => authorization,
    storage,
  });
}
function admit(runtime, document = new Y.Doc(), context = scope) {
  return {
    document,
    promise: runtime.hocuspocus.configuration.onLoadDocument({
      document,
      documentName: roomName,
      context,
    }),
  };
}

test("initialization adopts only the durable winner and seeds user and service CAS tokens", async () => {
  const winner = await canonical();
  const candidate = await canonical();
  const winnerRow = row(bytes(winner), 7);
  const f = fixture({ initializeState: async () => winnerRow });
  f.persisted = winnerRow;
  try {
    const result = await f.storage.initializeState({
      ...scope,
      state: bytes(candidate),
      baseOperationSequence: 0,
      baseSnapshotSha256: bootstrap.sha256,
    });
    assert.deepEqual(result.yjsState, bytes(winner));
    assert.notDeepEqual(result.yjsState, bytes(candidate));
    await f.storage.storeService({
      projectId: scope.projectId,
      revisionId: scope.revisionId,
      state: bytes(winner),
      baseOperationSequence: 0,
    });
    // The user token still identifies the returned winner, independently of service writes.
    f.persisted = winnerRow;
    await f.storage.store({
      ...scope,
      state: bytes(winner),
      baseOperationSequence: 0,
    });
  } finally {
    winner.destroy();
    candidate.destroy();
  }
});

test("browser admission waits for initialization and discards the losing bootstrap origin", async () => {
  const winner = await canonical();
  const gate = deferred();
  const entered = deferred();
  const f = fixture({
    initializeState: async () => {
      entered.resolve();
      await gate.promise;
      f.persisted = row(bytes(winner));
      return f.persisted;
    },
  });
  const runtime = runtimeFor(f.storage);
  const loading = admit(runtime);
  try {
    await Promise.race([entered.promise, loading.promise]);
    assert.equal(loading.document.share.size, 0);
    gate.resolve();
    await loading.promise;
    assert.deepEqual(bytes(loading.document), bytes(winner));
    assert.equal(f.calls.stores, 0);
    assert.doesNotThrow(() =>
      validateDrawingClientUpdate(loading.document, bytes(winner), {
        ...scope,
        canWrite: true,
      }),
    );
  } finally {
    gate.resolve();
    await loading.promise.catch(() => {});
    loading.document.destroy();
    winner.destroy();
    await runtime.stop();
  }
});

test("stale graph initialization rebuilds at most three candidates, while other failures propagate", async () => {
  for (const [code, failures, expectedAttempts] of [
    ["P3S04", 2, 3],
    ["P3S04", 3, 3],
    ["P3A02", 1, 1],
  ]) {
    let attempts = 0;
    const candidates = [];
    const f = fixture({
      initializeState: async (input) => {
        candidates.push(input.state);
        if (++attempts <= failures)
          throw Object.assign(new Error("initializer refused"), { code });
        f.persisted = row(input.state);
        return f.persisted;
      },
    });
    const runtime = runtimeFor(f.storage);
    const loading = admit(runtime);
    try {
      if (code === "P3S04" && failures === 2) await loading.promise;
      else {
        await assert.rejects(loading.promise, { code });
        assert.equal(loading.document.share.size, 0);
      }
      assert.equal(attempts, expectedAttempts);
      assert.equal(f.calls.bootstraps, expectedAttempts);
      for (let i = 1; i < candidates.length; i++)
        assert.notDeepEqual(candidates[i], candidates[i - 1]);
    } finally {
      loading.document.destroy();
      await runtime.stop();
    }
  }
});

test("invalid winners never enter the payload or seed usable CAS tokens", async () => {
  const wrong = await canonical();
  wrong.getMap("serverMeta").set("revisionId", randomUUID());
  let token;
  const f = fixture({
    initializeState: async () => row(bytes(wrong), 9),
    store: async (input) => {
      token = input.expectedGeneration;
      return { generation: 1, sha256: "b".repeat(64) };
    },
  });
  const runtime = runtimeFor(f.storage);
  const loading = admit(runtime);
  try {
    await assert.rejects(loading.promise, /scope/);
    assert.equal(loading.document.share.size, 0);
    await f.storage.store({
      ...scope,
      state: bytes(wrong),
      baseOperationSequence: 0,
    });
    assert.equal(token, 0);
  } finally {
    wrong.destroy();
    loading.document.destroy();
    await runtime.stop();
  }
});

test("active metadata correction is stored with service authority before browser admission", async () => {
  const stale = await canonical();
  stale.getMap("serverMeta").set("freezeState", "freezing");
  stale.getMap("serverMeta").set("freezeRequestId", randomUUID());
  const f = fixture({
    freeze: {
      readFreeze: async () => ({
        state: "active",
        requestId: null,
        revisionStatus: "draft",
      }),
    },
  });
  f.persisted = row(bytes(stale));
  const runtime = runtimeFor(f.storage);
  const loading = admit(runtime);
  try {
    await loading.promise;
    assert.equal(
      loading.document.getMap("serverMeta").get("freezeState"),
      "active",
    );
    assert.equal(f.calls.stores, 1);
    assert.deepEqual(bytes(loading.document), f.persisted.yjsState);
  } finally {
    stale.destroy();
    loading.document.destroy();
    await runtime.stop();
  }
});

test("a foreign preparation lease cannot expose an unpersisted fence during first admission", async () => {
  const f = fixture({
    freeze: {
      readFreeze: async () => ({
        state: "active",
        requestId: null,
        revisionStatus: "draft",
        ownerToken: randomUUID(),
        ownerRequestId: randomUUID(),
        leaseExpiresAtMs: Date.now() + 60_000,
      }),
    },
  });
  const runtime = runtimeFor(f.storage);
  const loading = admit(runtime);
  try {
    await assert.rejects(
      loading.promise,
      (error) =>
        error.code === "DRAWING_RECONCILIATION_RETRY" &&
        error.retryable === true,
    );
    assert.equal(loading.document.share.size, 0);
    assert.equal(f.calls.stores, 0);
    assert.ok(
      f.persisted,
      "initial origin remains durable despite refused admission",
    );
  } finally {
    loading.document.destroy();
    await runtime.stop();
  }
});

test("detached authority and receipt loaders establish the same canonical origin before mutation", async () => {
  const winner = await canonical();
  for (const receipt of [false, true]) {
    const f = fixture({
      initializeServiceState: async () => {
        f.persisted = row(bytes(winner));
        return f.persisted;
      },
      freeze: {
        readFreeze: async () => ({
          state: "active",
          requestId: null,
          revisionStatus: "draft",
        }),
      },
    });
    const runtime = runtimeFor(f.storage);
    try {
      if (!receipt)
        await runtime.applyFreezeRequest(
          JSON.stringify({ action: "authority", roomName }),
          secret,
        );
      else {
        const operationId = randomUUID();
        const body = JSON.stringify({
          receiptId: randomUUID(),
          roomName,
          operationId,
          operation: {
            clientOperationId: operationId,
            revisionId: scope.revisionId,
            actorId: scope.userId,
            schemaVersion: 1,
            type: "add_layer",
            baseVersions: {},
            forward: {
              type: "add_layer",
              layer: {
                id: randomUUID(),
                name: "Layer",
                visible: true,
                locked: false,
                version: 1,
              },
            },
            inverse: {},
            createdAt: "2026-09-06T00:00:00.000Z",
          },
          outcome: "rejected",
          resultVersions: {},
        });
        await runtime.applyOutcomeReceipt(
          body,
          createHmac("sha256", secret).update(body).digest("hex"),
        );
      }
      assert.ok(f.persisted);
      const restored = new Y.Doc();
      try {
        Y.applyUpdate(restored, f.persisted.yjsState);
        assert.doesNotThrow(() =>
          validateDrawingClientUpdate(restored, bytes(winner), {
            ...scope,
            canWrite: true,
          }),
        );
      } finally {
        restored.destroy();
      }
      assert.equal(f.calls.bootstraps, 1);
      assert.equal(f.calls.stores, receipt ? 1 : 0);
    } finally {
      await runtime.stop();
    }
  }
  winner.destroy();
});

test("an approved Viewer initializes through user authority while edits and protected forgeries stay forbidden", async () => {
  const f = fixture({
    initializeServiceState: async () => {
      throw new Error("approved service bootstrap forbidden");
    },
  });
  const runtime = runtimeFor(f.storage, {
    capability: "viewer",
    canWrite: false,
    revisionStatus: "approved",
  });
  const context = await runtime.hooks.authenticate({
    token: "viewer",
    origin: "https://app.example.com",
    roomName,
  });
  assert.equal(context.canWrite, false);
  assert.equal(context.revisionStatus, "approved");
  const loading = admit(runtime, new Y.Doc(), context);
  try {
    await loading.promise;
    assert.equal(f.calls.userInitializations, 1);
    assert.throws(
      () =>
        validateDrawingClientUpdate(loading.document, bytes(loading.document), {
          ...scope,
          canWrite: false,
        }),
      /read-only/,
    );
    const forged = new Y.Doc();
    try {
      Y.applyUpdate(forged, bytes(loading.document));
      forged.getMap("serverMeta").set("baseSnapshotSha256", bootstrap.sha256);
      assert.throws(
        () =>
          validateDrawingClientUpdate(loading.document, bytes(forged), {
            ...scope,
            canWrite: true,
          }),
        /server-owned|protected|metadata/i,
      );
    } finally {
      forged.destroy();
    }
  } finally {
    loading.document.destroy();
    await runtime.stop();
  }
});

test("missing initializer support fails closed and never publishes a bootstrap candidate", async () => {
  for (const method of ["initializeState", "initializeServiceState"]) {
    const f = fixture({
      [method]: undefined,
      freeze: {
        readFreeze: async () => ({
          state: "active",
          requestId: null,
          revisionStatus: "draft",
        }),
      },
    });
    const runtime = runtimeFor(f.storage);
    const document = new Y.Doc();
    try {
      const load =
        method === "initializeState"
          ? admit(runtime, document).promise
          : runtime.applyFreezeRequest(
              JSON.stringify({ action: "authority", roomName }),
              secret,
            );
      await assert.rejects(load, /initialization is unavailable/);
      assert.equal(document.share.size, 0);
      assert.equal(f.persisted, null);
    } finally {
      document.destroy();
      await runtime.stop();
    }
  }
});

test("local freeze preparation refuses initial admission without projecting its transient identity", async () => {
  const gate = deferred();
  const entered = deferred();
  const f = fixture({
    loadService: async () => {
      entered.resolve();
      await gate.promise;
      return f.persisted;
    },
    freeze: {
      readFreeze: async () => ({
        state: "active",
        requestId: null,
        revisionStatus: "draft",
      }),
      acquireFreezeLease: async () => {},
      renewFreezeLease: async () => {},
      releaseFreezeLease: async () => {},
      beginFreeze: async () => {
        throw new Error("test freeze completion refused");
      },
    },
  });
  const runtime = runtimeFor(f.storage);
  const freezing = runtime.applyFreezeRequest(
    JSON.stringify({
      action: "freeze",
      roomName,
      freezeRequestId: randomUUID(),
    }),
    secret,
  );
  const freezeFailure = assert.rejects(
    freezing,
    /test freeze completion refused/,
  );
  await entered.promise;
  const loading = admit(runtime);
  try {
    await assert.rejects(loading.promise, {
      code: "DRAWING_RECONCILIATION_RETRY",
      retryable: true,
    });
    assert.equal(loading.document.share.size, 0);
    assert.equal(f.calls.stores, 0);
  } finally {
    gate.resolve();
    await freezeFailure;
    loading.document.destroy();
    await runtime.stop();
  }
});

test("malformed persisted bytes always destroy the validation document", () => {
  const destroy = Y.Doc.prototype.destroy;
  const destroyed = [];
  Y.Doc.prototype.destroy = function () {
    destroyed.push(this);
    return destroy.call(this);
  };
  try {
    assert.throws(() =>
      validatePersistedDrawingState(new Uint8Array([255]), scope),
    );
    assert.equal(destroyed.length, 1);
    assert.equal(destroyed[0].isDestroyed, true);
  } finally {
    Y.Doc.prototype.destroy = destroy;
  }
});

test("detached receipt documents are destroyed after immutable conflicts and persistence failures", async () => {
  const operationId = randomUUID();
  const operation = {
    clientOperationId: operationId,
    revisionId: scope.revisionId,
    actorId: scope.userId,
    schemaVersion: 1,
    type: "add_layer",
    baseVersions: {},
    forward: {
      type: "add_layer",
      layer: {
        id: randomUUID(),
        name: "Layer",
        visible: true,
        locked: false,
        version: 1,
      },
    },
    inverse: {},
    createdAt: "2026-09-06T00:00:00.000Z",
  };
  const send = (runtime, envelope) => {
    const body = JSON.stringify({
      receiptId: randomUUID(),
      roomName,
      operationId,
      operation: envelope,
      outcome: "rejected",
      resultVersions: {},
    });
    return runtime.applyOutcomeReceipt(
      body,
      createHmac("sha256", secret).update(body).digest("hex"),
    );
  };
  const f = fixture();
  const runtime = runtimeFor(f.storage);
  await send(runtime, operation);
  const getMap = Y.Doc.prototype.getMap;
  const observed = new Set();
  Y.Doc.prototype.getMap = function (...args) {
    observed.add(this);
    return getMap.apply(this, args);
  };
  try {
    await assert.rejects(
      send(runtime, {
        ...operation,
        forward: {
          ...operation.forward,
          layer: { ...operation.forward.layer, name: "Forged" },
        },
      }),
      /operation is immutable/,
    );
    assert.ok(observed.size > 0);
    assert.ok(
      [...observed].every((document) => document.isDestroyed),
      "immutable conflict must destroy every detached document",
    );
    observed.clear();
    f.database.storeService = async () => {
      throw new Error("test store unavailable");
    };
    await assert.rejects(send(runtime, operation), /test store unavailable/);
    assert.ok(observed.size > 0);
    assert.ok(
      [...observed].every((document) => document.isDestroyed),
      "failed store must destroy every detached document",
    );
  } finally {
    Y.Doc.prototype.getMap = getMap;
    await runtime.stop();
  }
});

test("initialization retries transient transport failures without changing the candidate", async () => {
  const candidate = await canonical();
  try {
    for (const service of [false, true]) {
      let attempts = 0;
      const method = service ? "initializeServiceState" : "initializeState";
      const f = fixture({
        [method]: async (input) => {
          assert.deepEqual(input.state, bytes(candidate));
          if (++attempts < 3)
            throw Object.assign(new Error("connection reset"), {
              code: "ECONNRESET",
            });
          return row(input.state);
        },
      });
      const value = await f.storage[method]({
        ...scope,
        state: bytes(candidate),
        baseOperationSequence: 0,
        baseSnapshotSha256: bootstrap.sha256,
      });
      assert.equal(attempts, 3);
      assert.deepEqual(value.yjsState, bytes(candidate));
    }
  } finally {
    candidate.destroy();
  }
});

test("admission reloads concurrent durable movement and fails retryably after three moving snapshots", async () => {
  for (const keepMoving of [false, true]) {
    const origins = await Promise.all(
      Array.from({ length: 7 }, () => canonical()),
    );
    let loads = 0;
    const f = fixture({
      load: async () => {
        const index = keepMoving ? Math.min(loads++, 6) : Math.min(loads++, 1);
        return row(bytes(origins[index]), index + 1);
      },
    });
    const runtime = runtimeFor(f.storage);
    const loading = admit(runtime);
    try {
      if (keepMoving) {
        await assert.rejects(loading.promise, {
          code: "DRAWING_RECONCILIATION_RETRY",
          retryable: true,
        });
        assert.equal(loads, 6);
        assert.equal(loading.document.share.size, 0);
      } else {
        await loading.promise;
        assert.deepEqual(bytes(loading.document), bytes(origins[1]));
      }
      assert.equal(f.calls.stores, 0);
    } finally {
      origins.forEach((doc) => doc.destroy());
      loading.document.destroy();
      await runtime.stop();
    }
  }
});

test("real WebSocket reports drawing-reconciling and explicit token retry adopts the same durable winner", async () => {
  class OriginWebSocket extends CrossWebSocket {
    constructor(url) {
      super(url, [], { origin: "https://app.example.com" });
    }
  }
  let foreignLease = true;
  const ownerToken = randomUUID();
  const ownerRequestId = randomUUID();
  const f = fixture({
    freeze: {
      readFreeze: async () => ({
        state: "active",
        requestId: null,
        revisionStatus: "draft",
        ownerToken: foreignLease ? ownerToken : null,
        ownerRequestId: foreignLease ? ownerRequestId : null,
        leaseExpiresAtMs: foreignLease ? Date.now() + 60_000 : null,
      }),
    },
  });
  const runtime = runtimeFor(f.storage);
  let refusedDocument;
  runtime.hocuspocus.configuration.extensions.unshift({
    onLoadDocument: ({ document }) => {
      refusedDocument ??= document;
    },
  });
  const server = await runtime.start();
  const client = new Y.Doc();
  const denied = deferred();
  const admission = deferred();
  const synced = deferred();
  let timeout;
  const deadline = new Promise((_, reject) => {
    timeout = setTimeout(
      () => reject(new Error("explicit token retry timed out")),
      3000,
    );
  });
  let provider;
  try {
    provider = new HocuspocusProvider({
      url: server.webSocketURL,
      name: roomName,
      document: client,
      token: "test-token",
      WebSocketPolyfill: OriginWebSocket,
      onAuthenticationFailed: ({ reason }) => denied.resolve(reason),
      onStateless: ({ payload }) => {
        if (JSON.parse(payload).type === "1hk-collaboration-admission")
          admission.resolve();
      },
      onSynced: () => synced.resolve(),
    });
    const reason = await Promise.race([denied.promise, deadline]);
    assert.equal(reason, "drawing-reconciling");
    assert.equal(refusedDocument.share.size, 0);
    assert.equal(refusedDocument.isDestroyed, true);
    assert.equal(client.share.size, 0);
    assert.equal(runtime.hocuspocus.documents.has(roomName), false);
    assert.equal(provider.isAuthenticated, false);
    assert.equal(provider.isSynced, false);
    assert.equal(f.calls.userInitializations, 1);
    assert.equal(f.calls.stores, 0);
    const winner = f.persisted;
    assert.ok(
      winner,
      "refused admission must retain the canonical initial row",
    );

    foreignLease = false;
    await provider.sendToken();
    await Promise.race([admission.promise, deadline]);
    assert.equal(provider.isAuthenticated, true);
    const admitted = runtime.hocuspocus.documents.get(roomName);
    assert.ok(admitted);
    assert.deepEqual(bytes(admitted), winner.yjsState);
    // sendToken retries admission; the provider's separate sync step requests state.
    provider.startSync();
    await Promise.race([synced.promise, deadline]);
    assert.equal(provider.isSynced, true);
    assert.deepEqual(bytes(client), winner.yjsState);
    assert.deepEqual(f.persisted, winner);
    assert.equal(f.calls.userInitializations, 1);
    assert.equal(f.calls.stores, 0);
  } finally {
    clearTimeout(timeout);
    provider?.destroy();
    client.destroy();
    refusedDocument?.destroy();
    await runtime.stop();
  }
});

test("application connection automatically recovers production lease refusal without replacing the canonical winner", async () => {
  const previousWebSocket = globalThis.WebSocket;
  globalThis.WebSocket = class extends CrossWebSocket {
    constructor(url) {
      super(url, [], { origin: "https://app.example.com" });
    }
  };
  let foreignLease = true;
  const ownerToken = randomUUID();
  const ownerRequestId = randomUUID();
  const f = fixture({
    freeze: {
      readFreeze: async () => ({
        state: "active",
        requestId: null,
        revisionStatus: "draft",
        ownerToken: foreignLease ? ownerToken : null,
        ownerRequestId: foreignLease ? ownerRequestId : null,
        leaseExpiresAtMs: foreignLease ? Date.now() + 60_000 : null,
      }),
    },
  });
  const runtime = runtimeFor(f.storage);
  const client = new Y.Doc();
  const retrying = deferred();
  const connected = deferred();
  const phases = [];
  let connection;
  let timeout;
  const deadline = new Promise((_, reject) => {
    timeout = setTimeout(
      () => reject(new Error("automatic application retry timed out")),
      4000,
    );
  });
  try {
    const server = await runtime.start();
    connection = await openDrawingCollaborationConnection({
      document: client,
      projectId: scope.projectId,
      revisionId: scope.revisionId,
      resolveToken: async () => "test-token",
      url: server.webSocketURL,
      onPhase(phase) {
        phases.push(phase);
        if (phase === "retrying") retrying.resolve();
        if (phase === "connected") connected.resolve();
      },
    });
    await Promise.race([retrying.promise, deadline]);
    assert.equal(phases.includes("connected"), false);
    assert.equal(client.share.size, 0);
    assert.equal(runtime.hocuspocus.documents.has(roomName), false);
    const winner = f.persisted;
    assert.ok(winner);
    foreignLease = false;
    // No provider.sendToken()/startSync() call from the test: application owns recovery.
    await Promise.race([connected.promise, deadline]);
    assert.deepEqual(bytes(client), winner.yjsState);
    assert.deepEqual(f.persisted, winner);
    assert.equal(f.calls.userInitializations, 1);
    assert.equal(f.calls.stores, 0);
  } finally {
    clearTimeout(timeout);
    connection?.dispose();
    client.destroy();
    await runtime.stop();
    globalThis.WebSocket = previousWebSocket;
  }
});

test("failed Hocuspocus initial admission destroys its unregistered payload", async () => {
  const f = fixture({ initializeState: undefined });
  const runtime = runtimeFor(f.storage);
  let refusedDocument;
  runtime.hocuspocus.configuration.extensions.unshift({
    onLoadDocument: ({ document }) => {
      refusedDocument = document;
    },
  });
  try {
    await assert.rejects(
      runtime.hocuspocus.createDocument(
        roomName,
        new Request("http://localhost"),
        "refused-initial-payload",
        { readOnly: false, isAuthenticated: true },
        scope,
      ),
      /initialization is unavailable/,
    );
    assert.equal(refusedDocument.share.size, 0);
    assert.equal(refusedDocument.isDestroyed, true);
    assert.equal(runtime.hocuspocus.documents.has(roomName), false);
  } finally {
    refusedDocument?.destroy();
    await runtime.stop();
  }
});

test("real WebSocket untouched room is durable before sync and replays its exact cached state after restart", async () => {
  class OriginWebSocket extends CrossWebSocket {
    constructor(url) {
      super(url, [], { origin: "https://app.example.com" });
    }
  }
  const f = fixture();
  const cached = new Y.Doc();
  const runtime = runtimeFor(f.storage);
  const firstServer = await runtime.start();
  let provider;
  let restarted;
  const connect = async (url, document) => {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("canonical socket sync timed out")),
        3000,
      );
      provider = new HocuspocusProvider({
        url,
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
  };
  try {
    await connect(firstServer.webSocketURL, cached);
    assert.ok(
      f.persisted,
      "untouched state must be stored before the first sync",
    );
    assert.equal(f.calls.userInitializations, 1);
    assert.equal(
      f.calls.stores,
      0,
      "no dirty operation is needed for initial persistence",
    );
    const durableBytes = f.persisted.yjsState;
    assert.deepEqual(bytes(cached), durableBytes);
    provider.destroy();
    provider = null;
    await runtime.stop();
    assert.equal(f.calls.stores, 0);
    assert.equal(runtime.hocuspocus.documents.size, 0);
    restarted = runtimeFor(
      createDrawingCollaborationStorage({
        database: f.database,
        validateState: validatePersistedDrawingState,
      }),
    );
    const secondServer = await restarted.start();
    await connect(secondServer.webSocketURL, cached);
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(provider.isSynced, true);
    const reloaded = restarted.hocuspocus.documents.get(roomName);
    assert.ok(reloaded, "honest replay must keep the reloaded room admitted");
    assert.deepEqual(bytes(reloaded), durableBytes);
    assert.deepEqual(bytes(cached), durableBytes);
    assert.equal(f.calls.userInitializations, 1);
    assert.equal(f.calls.stores, 0);
    assert.doesNotThrow(() =>
      validateDrawingClientUpdate(reloaded, bytes(cached), {
        ...scope,
        canWrite: true,
      }),
    );
  } finally {
    provider?.destroy();
    cached.destroy();
    await runtime.stop();
    await restarted?.stop();
  }
});
