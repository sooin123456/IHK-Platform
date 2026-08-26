import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import * as Y from "yjs";

import {
  createDrawingFreezeSecretVerifier,
  createDrawingFreezeCoordinator,
  drawingFreezeManifest,
} from "../collaboration/src/freeze.ts";
import {
  createDrawingCollaborationServer,
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
      if (body.action === "freeze")
        throw new Error("freeze response was lost");
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
            operations: manifest.operations,
          };
        },
      };
    },
  });
  assert.ok(result.snapshotId);
  assert.deepEqual(events, ["freeze", "reconcile", "database"]);
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
