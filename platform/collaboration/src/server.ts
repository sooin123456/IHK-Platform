import { createHmac, timingSafeEqual } from "node:crypto";
import { pathToFileURL } from "node:url";

import { Server } from "@hocuspocus/server";
import * as Y from "yjs";
import { z } from "zod";

import {
  DRAWING_COLLABORATION_SCHEMA_VERSION,
  DRAWING_COLLABORATION_SERVER_ORIGIN,
  DrawingAwarenessStateSchema,
  DrawingCollaborationClientAppendSchema,
  DrawingCollaborationMetaSchema,
  DrawingCollaborationStatusSchema,
  parseDrawingRoomName,
  validateDrawingCollaborationAppend,
} from "../../app/lukas/lib/drawing-collaboration-protocol.ts";
import {
  authorizeDrawingRoom,
  createDrawingAccessTokenVerifier,
  type DrawingConnectionContext,
  type DrawingRoomAuthorization,
  type VerifiedDrawingUser,
} from "./auth.ts";
import {
  parseDrawingCollaborationConfig,
  type DrawingCollaborationConfig,
} from "./config.ts";
import {
  createDrawingCollaborationStorage,
  createPostgresDrawingCollaborationDatabase,
  type DrawingAcceptedOperation,
  type DrawingCollaborationDatabase,
  type DrawingStorageScope,
} from "./storage.ts";

type CollaborationStorage = ReturnType<
  typeof createDrawingCollaborationStorage
>;
type TrackedConnection = {
  context: DrawingConnectionContext;
  readOnly: boolean;
  close: (event?: { code: number; reason: string }) => void;
};

const ReceiptSchema = z
  .object({
    receiptId: z.string().uuid(),
    roomName: z.string().transform((value, context) => {
      try {
        parseDrawingRoomName(value);
        return value;
      } catch {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Invalid room.",
        });
        return z.NEVER;
      }
    }),
    operationId: z.string().uuid(),
    outcome: z.enum(["rejected", "conflicted"]),
    resultVersions: z
      .record(z.string().uuid(), z.number().int().positive())
      .refine((value) => Object.keys(value).length <= 256),
  })
  .strict();

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}

function same(left: unknown, right: unknown): boolean {
  return canonical(left) === canonical(right);
}

function documentCollections(document: Y.Doc) {
  return {
    serverMeta: document.getMap("serverMeta").toJSON(),
    operationOrder: document.getArray<string>("operationOrder").toArray(),
    operations: document.getMap("operations").toJSON(),
    operationStatus: document.getMap("operationStatus").toJSON(),
  };
}

function ensureDrawingCollections(document: Y.Doc) {
  document.getMap("serverMeta");
  document.getArray("operationOrder");
  document.getMap("operations");
  document.getMap("operationStatus");
}

function validateLedgerWithoutAppend(document: Y.Doc, roomName: string) {
  const names = [...document.share.keys()].sort();
  const required = [
    "operationOrder",
    "operationStatus",
    "operations",
    "serverMeta",
  ];
  if (!same(names, required))
    throw new Error("Drawing document collections are invalid.");
  const value = documentCollections(document);
  const room = parseDrawingRoomName(roomName);
  const meta = DrawingCollaborationMetaSchema.parse(value.serverMeta);
  if (meta.projectId !== room.projectId || meta.revisionId !== room.revisionId)
    throw new Error("Drawing document scope does not match its room.");
  DrawingCollaborationClientAppendSchema.parse({
    operationOrder: value.operationOrder,
    operations: value.operations,
  });
  for (const [operationId, status] of Object.entries(value.operationStatus)) {
    if (!(operationId in value.operations))
      throw new Error("Drawing status must reference an operation.");
    DrawingCollaborationStatusSchema.parse(status);
  }
  const encoded = Y.encodeStateAsUpdate(document);
  if (encoded.byteLength > 8 * 1024 * 1024)
    throw new Error("Drawing collaboration document is too large.");
}

export function validatePersistedDrawingState(
  state: Uint8Array,
  scope: Pick<DrawingStorageScope, "projectId" | "revisionId">,
) {
  const document = new Y.Doc();
  Y.applyUpdate(document, state, DRAWING_COLLABORATION_SERVER_ORIGIN);
  try {
    ensureDrawingCollections(document);
    validateLedgerWithoutAppend(
      document,
      `drawing:${scope.projectId}:${scope.revisionId}`,
    );
  } finally {
    document.destroy();
  }
}

export async function initializeDrawingCollaborationDocument(
  document: Y.Doc,
  input: {
    projectId: string;
    revisionId: string;
    bootstrap: () => Promise<unknown>;
  },
) {
  if (document.share.size) return document;
  const bootstrap = z
    .object({
      sha256: z.string().regex(/^[0-9a-f]{64}$/),
      operationSequence: z.number().int().nonnegative(),
    })
    .passthrough()
    .parse(await input.bootstrap());
  document.transact(() => {
    const meta = document.getMap("serverMeta");
    for (const [key, value] of Object.entries({
      schemaVersion: DRAWING_COLLABORATION_SCHEMA_VERSION,
      projectId: input.projectId,
      revisionId: input.revisionId,
      baseSnapshotSha256: bootstrap.sha256,
      baseOperationSequence: bootstrap.operationSequence,
      freezeState: "active",
      freezeRequestId: null,
    }))
      meta.set(key, value);
    document.getArray("operationOrder");
    document.getMap("operations");
    document.getMap("operationStatus");
  }, DRAWING_COLLABORATION_SERVER_ORIGIN);
  return document;
}

export function validateDrawingClientUpdate(
  current: Y.Doc,
  update: Uint8Array,
  context: Pick<
    DrawingConnectionContext,
    "userId" | "projectId" | "revisionId" | "canWrite"
  >,
) {
  if (!context.canWrite)
    throw new Error("Drawing collaboration room is read-only.");
  if (update.byteLength > 1024 * 1024)
    throw new Error("Drawing collaboration update is too large.");
  const before = documentCollections(current);
  const candidate = new Y.Doc();
  try {
    Y.applyUpdate(
      candidate,
      Y.encodeStateAsUpdate(current),
      DRAWING_COLLABORATION_SERVER_ORIGIN,
    );
    Y.applyUpdate(candidate, update);
    const after = documentCollections(candidate);
    if (
      !same(before.serverMeta, after.serverMeta) ||
      !same(before.operationStatus, after.operationStatus)
    )
      throw new Error("Clients cannot author server collaboration state.");
    validateDrawingCollaborationAppend(
      { operationOrder: before.operationOrder, operations: before.operations },
      { operationOrder: after.operationOrder, operations: after.operations },
      context.userId,
      `drawing:${context.projectId}:${context.revisionId}`,
    );
    validateLedgerWithoutAppend(
      candidate,
      `drawing:${context.projectId}:${context.revisionId}`,
    );
  } finally {
    candidate.destroy();
  }
}

export function sanitizeDrawingAwarenessState(
  input: Record<string, unknown>,
  identity: { userId: string; displayName: string; color: string },
) {
  return DrawingAwarenessStateSchema.parse({
    user: {
      id: identity.userId,
      displayName: identity.displayName,
      color: identity.color,
    },
    pageId: input.pageId ?? null,
    canvasId: input.canvasId ?? null,
    cursorWorld: input.cursorWorld ?? null,
    selectedIds: input.selectedIds ?? [],
    activeTool: input.activeTool ?? null,
    softLocks: input.softLocks ?? [],
  });
}

export function createOutcomeReceiptVerifier(secret: string) {
  if (secret.length < 32)
    throw new Error("Internal receipt secret is too short.");
  return (body: string, signature: string | undefined) => {
    const expected = createHmac("sha256", secret).update(body).digest();
    const supplied = /^[0-9a-f]{64}$/i.test(signature ?? "")
      ? Buffer.from(signature!, "hex")
      : Buffer.alloc(expected.byteLength);
    if (!timingSafeEqual(expected, supplied))
      throw new Error("Internal outcome receipt signature is invalid.");
    if (Buffer.byteLength(body) > 16 * 1024)
      throw new Error("Internal outcome receipt is too large.");
    return ReceiptSchema.parse(JSON.parse(body));
  };
}

function acceptedMatchesEnvelope(
  accepted: DrawingAcceptedOperation,
  envelope: Record<string, unknown>,
  revisionId: string,
) {
  const comparisons: Array<[unknown, unknown]> = [
    [accepted.revisionId, revisionId],
    [accepted.actorId, envelope.actorId],
    [accepted.operationType, envelope.type],
    [accepted.baseVersions, envelope.baseVersions],
    [accepted.forward, envelope.forward],
    [accepted.inverse, envelope.inverse],
  ];
  return comparisons.every(([database, client]) => same(database, client));
}

export async function reconcileAcceptedDrawingOperations(
  document: Y.Doc,
  lookup: (operationIds: string[]) => Promise<DrawingAcceptedOperation[]>,
) {
  const operations = document.getMap("operations").toJSON();
  const statuses = document.getMap("operationStatus");
  const pending = Object.keys(operations).filter((id) => {
    const status = statuses.get(id) as { status?: string } | undefined;
    return !status || status.status === "pending";
  });
  if (!pending.length) return;
  const accepted = await lookup(pending.slice(0, 256));
  const revisionId = String(document.getMap("serverMeta").get("revisionId"));
  document.transact(() => {
    for (const row of accepted) {
      const envelope = operations[row.clientOperationId] as
        | Record<string, unknown>
        | undefined;
      if (!envelope || !acceptedMatchesEnvelope(row, envelope, revisionId))
        throw new Error(
          "Accepted drawing operation does not match its immutable envelope.",
        );
      statuses.set(row.clientOperationId, {
        operationId: row.clientOperationId,
        status: "acked",
        authoritativeSequence: row.sequence,
        resultVersions: row.resultVersions,
      });
    }
  }, DRAWING_COLLABORATION_SERVER_ORIGIN);
}

type Dependencies = {
  config: DrawingCollaborationConfig;
  verifyToken: (token: string) => Promise<VerifiedDrawingUser>;
  authorize: (
    userId: string,
    projectId: string,
    revisionId: string,
  ) => Promise<DrawingRoomAuthorization | null>;
  storage: Pick<
    CollaborationStorage,
    "load" | "store" | "bootstrap" | "lookupOperations" | "health" | "close"
  >;
  preflightAuth?: () => Promise<void>;
  now?: () => number;
  setInterval?: typeof globalThis.setInterval;
  clearInterval?: typeof globalThis.clearInterval;
  flush?: () => Promise<void>;
  destroy?: () => Promise<void>;
};

export function createDrawingCollaborationServer(dependencies: Dependencies) {
  const now = dependencies.now ?? Date.now;
  const connections = new Set<TrackedConnection>();
  let live = true;
  let authReady = !dependencies.preflightAuth;
  let started = false;
  let requestHandlerInstalled = false;
  let stopPromise: Promise<void> | null = null;

  const authenticate = (input: {
    token: string;
    origin: string | null;
    roomName: string;
  }) =>
    authorizeDrawingRoom({
      ...input,
      allowedOrigins: dependencies.config.allowedOrigins,
      verifyToken: dependencies.verifyToken,
      authorize: async (...args) => {
        const access = await dependencies.authorize(...args);
        if (!access)
          throw new Error("Drawing collaboration target is unavailable.");
        return access;
      },
      now,
    });

  async function reauthorize(context: DrawingConnectionContext) {
    const access = await dependencies.authorize(
      context.userId,
      context.projectId,
      context.revisionId,
    );
    if (!access)
      throw new Error("Drawing collaboration target is unavailable.");
    Object.assign(context, access, { lastAuthorizedAt: now() });
    return context;
  }

  const hooks = {
    authenticate,
    async tokenSync(input: {
      token: string;
      origin: string | null;
      roomName: string;
    }) {
      return authenticate(input);
    },
    async beforeMessage(input: {
      context: DrawingConnectionContext;
      document: Y.Doc;
      update: Uint8Array;
    }) {
      await reauthorize(input.context);
      validateDrawingClientUpdate(input.document, input.update, input.context);
    },
    async beforeAwareness(input: {
      context: DrawingConnectionContext;
      states: Map<number, Record<string, unknown>>;
    }) {
      await reauthorize(input.context);
      for (const [clientId, state] of input.states)
        input.states.set(
          clientId,
          sanitizeDrawingAwarenessState(state, input.context),
        );
    },
  };

  const server = new Server<DrawingConnectionContext>({
    port: dependencies.config.port,
    stopOnSignals: false,
    quiet: true,
    debounce: dependencies.config.debounceMs,
    maxDebounce: dependencies.config.maxDebounceMs,
    unloadImmediately: false,
    maxUnauthenticatedQueueSize: 1024 * 1024,
    maxUnauthenticatedQueueMessages: 100,
    maxPendingDocuments: 4,
    async onAuthenticate(payload) {
      const context = await hooks.authenticate({
        token: payload.token,
        origin: payload.requestHeaders.get("origin"),
        roomName: payload.documentName,
      });
      payload.connectionConfig.readOnly = !context.canWrite;
      return context;
    },
    async onTokenSync(payload) {
      const context = await hooks.tokenSync({
        token: payload.token,
        origin: payload.requestHeaders.get("origin"),
        roomName: payload.documentName,
      });
      payload.connection.readOnly = !context.canWrite;
      Object.assign(payload.context, context);
      return context;
    },
    async connected(payload) {
      connections.add(payload.connection);
      payload.connection.onClose(() => {
        connections.delete(payload.connection);
      });
    },
    beforeHandleMessage(payload) {
      return hooks.beforeMessage(payload);
    },
    beforeHandleAwareness(payload) {
      if (!payload.context)
        throw new Error("Authenticated Awareness context is required.");
      return hooks.beforeAwareness({
        context: payload.context,
        states: payload.states,
      });
    },
    async onLoadDocument(payload) {
      const scope = payload.context;
      const stored = await dependencies.storage.load(scope);
      if (stored) {
        Y.applyUpdate(
          payload.document,
          stored.yjsState,
          DRAWING_COLLABORATION_SERVER_ORIGIN,
        );
        ensureDrawingCollections(payload.document);
        validateLedgerWithoutAppend(payload.document, payload.documentName);
      } else {
        if (!dependencies.storage.bootstrap)
          throw new Error("Drawing collaboration bootstrap is unavailable.");
        await initializeDrawingCollaborationDocument(payload.document, {
          projectId: scope.projectId,
          revisionId: scope.revisionId,
          bootstrap: () => dependencies.storage.bootstrap!(scope),
        });
      }
      return payload.document;
    },
    async onStoreDocument(payload) {
      validateLedgerWithoutAppend(payload.document, payload.documentName);
      const meta = DrawingCollaborationMetaSchema.parse(
        payload.document.getMap("serverMeta").toJSON(),
      );
      await dependencies.storage.store({
        ...payload.lastContext,
        state: Y.encodeStateAsUpdate(payload.document),
        baseOperationSequence: meta.baseOperationSequence,
      });
    },
  });
  const hocuspocus = server.hocuspocus;

  async function runPassiveAuthorizationCheck() {
    await Promise.all(
      [...connections].map(async (connection) => {
        try {
          await reauthorize(connection.context);
          connection.readOnly = !connection.context.canWrite;
        } catch {
          connection.close({ code: 4403, reason: "permission-revoked" });
          connections.delete(connection);
        }
      }),
    );
  }

  async function runReconciliationCheck() {
    if (!dependencies.storage.lookupOperations) return;
    await Promise.all(
      [...hocuspocus.documents.values()].map((document) =>
        reconcileAcceptedDrawingOperations(document, (ids) =>
          dependencies.storage.lookupOperations!(
            String(document.getMap("serverMeta").get("revisionId")),
            ids,
          ),
        ),
      ),
    );
  }

  const interval = (dependencies.setInterval ?? globalThis.setInterval)(() => {
    void runPassiveAuthorizationCheck();
    void runReconciliationCheck();
  }, dependencies.config.authorizationIntervalMs);

  const verifyReceipt = createOutcomeReceiptVerifier(
    dependencies.config.internalSecret,
  );
  function applyOutcomeReceipt(body: string, signature: string | undefined) {
    const receipt = verifyReceipt(body, signature);
    const document = hocuspocus.documents.get(receipt.roomName);
    if (!document) return receipt;
    const operations = document.getMap("operations");
    if (!operations.has(receipt.operationId))
      throw new Error("Outcome receipt operation is unavailable.");
    const statuses = document.getMap("operationStatus");
    const current = statuses.get(receipt.operationId) as
      | { status?: string }
      | undefined;
    if (
      current?.status === "acked" ||
      (current &&
        (current.status !== receipt.outcome ||
          !same(
            (current as { resultVersions?: unknown }).resultVersions,
            receipt.resultVersions,
          )))
    )
      throw new Error("Outcome receipt conflicts with authoritative status.");
    if (!current)
      document.transact(
        () =>
          statuses.set(receipt.operationId, {
            operationId: receipt.operationId,
            status: receipt.outcome,
            authoritativeSequence: null,
            resultVersions: receipt.resultVersions,
          }),
        DRAWING_COLLABORATION_SERVER_ORIGIN,
      );
    return receipt;
  }

  async function health() {
    if (!live) return { live: false, ready: false };
    try {
      return {
        live: true,
        ready: authReady && ((await dependencies.storage.health?.()) ?? true),
      };
    } catch {
      return { live: true, ready: false };
    }
  }

  async function start() {
    if (started) return server;
    await dependencies.preflightAuth?.();
    authReady = true;
    const normalRequest = server.requestHandler;
    if (!requestHandlerInstalled)
      server.requestHandler = async (request, response) => {
        const url = new URL(request.url ?? "/", "http://localhost");
        if (
          request.method === "GET" &&
          (url.pathname === "/healthz" || url.pathname === "/livez")
        ) {
          const state = await health();
          const ready = url.pathname === "/livez" ? state.live : state.ready;
          response.writeHead(ready ? 200 : 503, {
            "content-type": "application/json",
          });
          response.end(JSON.stringify(state));
          return;
        }
        if (
          request.method === "POST" &&
          url.pathname === "/internal/outcomes"
        ) {
          let body = "";
          for await (const chunk of request) {
            body += chunk;
            if (Buffer.byteLength(body) > 16 * 1024) break;
          }
          try {
            applyOutcomeReceipt(
              body,
              request.headers["x-1hk-signature"] as string | undefined,
            );
            response.writeHead(204).end();
          } catch {
            response.writeHead(401).end();
          }
          return;
        }
        await normalRequest(request, response);
      };
    if (!requestHandlerInstalled) {
      server.httpServer.removeAllListeners("request");
      server.httpServer.on("request", (request, response) => {
        void server.requestHandler(request, response).catch(() => {
          if (!response.headersSent) response.writeHead(500);
          if (!response.writableEnded) response.end();
        });
      });
    }
    requestHandlerInstalled = true;
    await server.listen(dependencies.config.port);
    started = true;
    return server;
  }

  function stop() {
    if (stopPromise) return stopPromise;
    stopPromise = (async () => {
      live = false;
      (dependencies.clearInterval ?? globalThis.clearInterval)(interval);
      await dependencies.flush?.();
      if (dependencies.destroy) await dependencies.destroy();
      else if (started) await server.destroy();
      else
        for (const document of hocuspocus.documents.values())
          document.destroy();
      await dependencies.storage.close?.();
    })();
    return stopPromise;
  }

  return {
    hocuspocus,
    hooks,
    trackConnection(connection: TrackedConnection) {
      connections.add(connection);
    },
    runPassiveAuthorizationCheck,
    runReconciliationCheck,
    applyOutcomeReceipt,
    health,
    start,
    stop,
  };
}

export function createDrawingCollaborationServerFromEnvironment(
  environment: Record<string, string | undefined> = process.env,
) {
  const config = parseDrawingCollaborationConfig(environment);
  const database = createPostgresDrawingCollaborationDatabase(
    config.databaseUrl,
  );
  const storage = createDrawingCollaborationStorage({
    database,
    validateState: validatePersistedDrawingState,
  });
  const tokenVerifier = createDrawingAccessTokenVerifier({
    supabaseUrl: config.supabaseUrl,
  });
  return createDrawingCollaborationServer({
    config,
    storage,
    authorize: database.authorize!,
    preflightAuth: tokenVerifier.preflight,
    verifyToken: tokenVerifier.verify,
  });
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const runtime = createDrawingCollaborationServerFromEnvironment();
  const shutdown = () => void runtime.stop();
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
  await runtime.start();
}
