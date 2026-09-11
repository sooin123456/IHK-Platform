import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";

import { HocuspocusProvider } from "@hocuspocus/provider";
import CrossWebSocket from "crossws/websocket";
import * as Y from "yjs";

import {
  createDrawingCollaborationStorage,
  createPostgresDrawingCollaborationDatabase,
} from "../../collaboration/src/storage.ts";
import {
  createDrawingCollaborationServer,
  validateDrawingClientUpdate,
  validatePersistedDrawingState,
} from "../../collaboration/src/server.ts";

const allowedOrigin = "https://task-3.example.test";
const editorToken = "task-3-fixed-editor-token";
const viewerToken = "task-3-fixed-viewer-token";

class OriginWebSocket extends CrossWebSocket {
  constructor(url) {
    super(url, [], { origin: allowedOrigin });
  }
}

function normalize(state) {
  const document = new Y.Doc();
  try {
    Y.applyUpdate(document, new Uint8Array(state));
    return Y.encodeStateAsUpdate(document);
  } finally {
    document.destroy();
  }
}

function stateHash(state) {
  return createHash("sha256").update(state).digest("hex");
}

function fixedTokenVerifier(ids) {
  const actors = new Map([
    [editorToken, ids.users.editor],
    [viewerToken, ids.users.viewer],
  ]);
  return async (token) => {
    const userId = actors.get(token);
    if (!userId) throw new Error("Task 3 fixture token is invalid.");
    return {
      userId,
      email: null,
      expiresAtMs: Date.now() + 120_000,
    };
  };
}

async function createRuntime(targetUrl, ids, instanceId) {
  const database = createPostgresDrawingCollaborationDatabase(targetUrl);
  try {
    const storage = createDrawingCollaborationStorage({
      database,
      validateState: validatePersistedDrawingState,
    });
    const runtime = createDrawingCollaborationServer({
      config: {
        port: 0,
        instanceId,
        supabaseUrl: "http://127.0.0.1",
        databaseUrl: targetUrl,
        allowedOrigins: new Set([allowedOrigin]),
        internalSecret: "i".repeat(32),
        freezeSecret: "f".repeat(32),
        authorizationIntervalMs: 30_000,
        debounceMs: 10,
        maxDebounceMs: 20,
      },
      verifyToken: fixedTokenVerifier(ids),
      authorize: database.authorize,
      storage,
    });
    return { database, storage, runtime };
  } catch (error) {
    await database.close?.();
    throw error;
  }
}

async function connect(
  url,
  roomName,
  document,
  token,
  Provider = HocuspocusProvider,
) {
  let provider;
  await new Promise((resolve, reject) => {
    let settled = false;
    const settle = (action) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      action();
    };
    const fail = (error) =>
      settle(() => {
        provider?.destroy();
        reject(error);
      });
    const timeout = setTimeout(
      () => fail(new Error("Task 3 canonical collaboration sync timed out.")),
      5_000,
    );
    provider = new Provider({
      url,
      name: roomName,
      document,
      token,
      WebSocketPolyfill: OriginWebSocket,
      onSynced: () => settle(resolve),
      onAuthenticationFailed: ({ reason }) => fail(new Error(reason)),
    });
  });
  return provider;
}

async function readState(owner, revisionId) {
  return (await owner`
    select project_id,revision_id,yjs_state,store_generation,yjs_sha256,
      byte_size,base_operation_sequence
    from private.lukas_drawing_collaboration_states
    where revision_id=${revisionId}::uuid
  `)[0];
}

function assertStateUnchanged(actual, expected) {
  assert.ok(actual, "canonical collaboration state disappeared after restart");
  assert.equal(actual.project_id, expected.project_id);
  assert.equal(actual.revision_id, expected.revision_id);
  assert.deepEqual(actual.yjs_state, expected.yjs_state);
  assert.equal(actual.store_generation, expected.store_generation);
  assert.equal(actual.yjs_sha256, expected.yjs_sha256);
  assert.equal(actual.byte_size, expected.byte_size);
  assert.equal(actual.base_operation_sequence, expected.base_operation_sequence);
}

async function cleanup(resources, primaryError) {
  const errors = [];
  for (const [label, operation] of resources) {
    try {
      await operation();
    } catch (error) {
      errors.push(new Error(`Task 3 cleanup failed: ${label}`, { cause: error }));
    }
  }
  if (primaryError && errors.length)
    throw new AggregateError(
      [primaryError, ...errors],
      "Task 3 proof and cleanup both failed",
    );
  if (primaryError) throw primaryError;
  if (errors.length)
    throw new AggregateError(errors, "Task 3 collaboration cleanup failed");
}

export async function proveCanonicalCollaborationSocketInitialization({
  owner,
  targetUrl,
  ids,
  createDocument,
}) {
  const created = await createDocument(
    owner,
    "authenticated",
    ids.users.editor,
    ids.project,
    "M1 actual PostgreSQL canonical socket initialization",
    randomUUID(),
  );
  ids.documents.push(created.documentId);
  ids.revisions.push(created.revisionId);
  const scope = {
    projectId: ids.project,
    revisionId: created.revisionId,
  };
  const roomName = `drawing:${scope.projectId}:${scope.revisionId}`;
  const viewerDocument = new Y.Doc();
  const editorDocument = new Y.Doc();
  let viewerProvider;
  let editorProvider;
  let first;
  let restarted;
  let firstStopped = false;
  let primaryError;
  try {
    first = await createRuntime(targetUrl, ids, "task-3-canonical-first");
    const firstServer = await first.runtime.start();
    const rejectedDocument = new Y.Doc();
    let rejectedProvider;
    let rejectedDestroyCount = 0;
    class RejectedProvider extends HocuspocusProvider {
      constructor(options) {
        super(options);
        rejectedProvider = this;
      }

      destroy() {
        rejectedDestroyCount += 1;
        super.destroy();
      }
    }
    try {
      await assert.rejects(
        connect(
          firstServer.webSocketURL,
          roomName,
          rejectedDocument,
          "task-3-invalid-token",
          RejectedProvider,
        ),
        /auth|invalid|permission/i,
      );
      assert.equal(
        rejectedDestroyCount,
        1,
        "failed authentication must destroy its unreturned provider",
      );
      assert.equal(
        rejectedProvider.configuration.websocketProvider.shouldConnect,
        false,
        "failed authentication must stop managed WebSocket reconnect checks",
      );
    } finally {
      rejectedDocument.destroy();
      if (rejectedDestroyCount === 0) rejectedProvider?.destroy();
    }
    viewerProvider = await connect(
      firstServer.webSocketURL,
      roomName,
      viewerDocument,
      viewerToken,
    );

    const initial = await readState(owner, scope.revisionId);
    assert.ok(
      initial,
      "untouched Viewer sync must durably initialize canonical collaboration state",
    );
    assert.equal(Number(initial.store_generation), 1);
    assert.equal(initial.yjs_sha256, stateHash(initial.yjs_state));
    assert.deepEqual(
      Y.encodeStateAsUpdate(viewerDocument),
      normalize(initial.yjs_state),
    );
    assert.equal(viewerDocument.getArray("operationOrder").length, 0);

    const viewerAccess = await first.database.authorize(
      ids.users.viewer,
      scope.projectId,
      scope.revisionId,
    );
    assert.equal(viewerAccess.capability, "viewer");
    assert.equal(viewerAccess.canWrite, false);
    const viewerAttempt = new Y.Doc();
    try {
      Y.applyUpdate(viewerAttempt, Y.encodeStateAsUpdate(viewerDocument));
      const clientOperationId = randomUUID();
      viewerAttempt.transact(() => {
        viewerAttempt.getArray("operations").push([{
          clientOperationId,
          revisionId: scope.revisionId,
          actorId: ids.users.viewer,
          schemaVersion: 1,
          type: "add_layer",
          baseVersions: {},
          forward: {
            type: "add_layer",
            layer: {
              id: randomUUID(),
              name: "Viewer forbidden layer",
              visible: true,
              locked: false,
              version: 1,
            },
          },
          inverse: {},
          createdAt: "2026-09-06T00:00:00.000Z",
        }]);
        viewerAttempt.getArray("operationOrder").push([clientOperationId]);
      });
      const attemptedState = Y.encodeStateAsUpdate(viewerAttempt);
      const attemptedUpdate = Y.encodeStateAsUpdate(
        viewerAttempt,
        Y.encodeStateVector(viewerDocument),
      );
      assert.notDeepEqual(attemptedState, new Uint8Array(initial.yjs_state));
      assert.doesNotThrow(() =>
        validateDrawingClientUpdate(viewerDocument, attemptedUpdate, {
          userId: ids.users.viewer,
          ...scope,
          canWrite: true,
        }),
      );
      await assert.rejects(
        first.storage.store({
          userId: ids.users.viewer,
          ...scope,
          state: attemptedState,
          baseOperationSequence: Number(initial.base_operation_sequence),
        }),
        (error) => {
          assert.equal(error.code, "P3A02");
          return true;
        },
      );
    } finally {
      viewerAttempt.destroy();
    }
    assertStateUnchanged(await readState(owner, scope.revisionId), initial);

    const cachedWinner = new Uint8Array(Y.encodeStateAsUpdate(viewerDocument));
    assert.deepEqual(cachedWinner, new Uint8Array(initial.yjs_state));
    viewerProvider.destroy();
    viewerProvider = undefined;
    await first.runtime.stop();
    firstStopped = true;

    Y.applyUpdate(editorDocument, cachedWinner);
    restarted = await createRuntime(
      targetUrl,
      ids,
      "task-3-canonical-restarted",
    );
    const secondServer = await restarted.runtime.start();
    editorProvider = await connect(
      secondServer.webSocketURL,
      roomName,
      editorDocument,
      editorToken,
    );
    assert.equal(editorProvider.isSynced, true);
    assert.equal(editorDocument.getArray("operationOrder").length, 0);
    const reloaded = await readState(owner, scope.revisionId);
    assertStateUnchanged(reloaded, initial);
    assert.deepEqual(Y.encodeStateAsUpdate(editorDocument), cachedWinner);
    assert.deepEqual(normalize(reloaded.yjs_state), cachedWinner);

    const forged = new Y.Doc();
    try {
      Y.applyUpdate(forged, cachedWinner);
      forged.getMap("serverMeta").set("baseSnapshotSha256", "f".repeat(64));
      assert.throws(
        () =>
          validateDrawingClientUpdate(
            editorDocument,
            Y.encodeStateAsUpdate(forged),
            {
              userId: ids.users.editor,
              ...scope,
              canWrite: true,
            },
          ),
        /server-owned|protected|metadata/i,
      );
    } finally {
      forged.destroy();
    }
    assertStateUnchanged(await readState(owner, scope.revisionId), initial);

    const evidence = {
      generation: Number(initial.store_generation),
      sha256: initial.yjs_sha256,
      byteSize: Number(initial.byte_size),
      baseOperationSequence: Number(initial.base_operation_sequence),
      operationCount: 0,
      reloadExact: true,
      viewerOrdinaryStoreDenied: true,
      protectedMetadataRejected: true,
    };
    process.stdout.write(
      `${JSON.stringify({
        event: "m1_canonical_collaboration_socket_proof_passed",
        evidence,
      })}\n`,
    );
    return evidence;
  } catch (error) {
    primaryError = error;
  } finally {
    await cleanup(
      [
        ["editor provider", async () => editorProvider?.destroy()],
        ["Viewer provider", async () => viewerProvider?.destroy()],
        ["restarted runtime/database", async () => restarted?.runtime.stop()],
        [
          "first runtime/database",
          async () => {
            if (first && !firstStopped) await first.runtime.stop();
          },
        ],
        ["editor document", async () => editorDocument.destroy()],
        ["Viewer document", async () => viewerDocument.destroy()],
      ],
      primaryError,
    );
  }
}
