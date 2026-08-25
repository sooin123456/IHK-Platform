import { createHmac, timingSafeEqual } from "node:crypto";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";

import { Server } from "@hocuspocus/server";
import { removeAwarenessStates, type Awareness } from "y-protocols/awareness";
import * as Y from "yjs";
import { z } from "zod";

import {
  DRAWING_COLLABORATION_SCHEMA_VERSION,
  DRAWING_COLLABORATION_SERVER_ORIGIN,
  DRAWING_COLLABORATION_COLLECTIONS,
  DrawingAwarenessStateSchema,
  DrawingCollaborationClientAppendSchema,
  DrawingCollaborationMetaSchema,
  DrawingCollaborationOperationSchema,
  DrawingCollaborationStatusSchema,
  parseDrawingRoomName,
  validateDrawingCollaborationAppend,
} from "../../app/lukas/lib/drawing-collaboration-protocol.ts";
import {
  appendDrawingCollaborationOperation,
  readDrawingCollaborationLedger,
} from "../../app/lukas/lib/drawing-collaboration-yjs.ts";
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
type DrawingRuntimeContext = DrawingConnectionContext & {
  serviceAuthority?: boolean;
};
type TrackedConnection = {
  context: DrawingRuntimeContext;
  readOnly: boolean;
  close: (event?: { code: number; reason: string }) => void;
  requestToken?: () => void;
};

class OutcomeReceiptAuthenticationError extends Error {}

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
    operation: DrawingCollaborationOperationSchema,
    outcome: z.enum(["rejected", "conflicted"]),
    resultVersions: z
      .record(z.string().uuid(), z.number().int().positive())
      .refine((value) => Object.keys(value).length <= 256),
  })
  .strict()
  .superRefine((receipt, context) => {
    const room = parseDrawingRoomName(receipt.roomName);
    if (receipt.operation.clientOperationId !== receipt.operationId)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["operationId"],
        message: "Receipt operation ID must match its envelope.",
      });
    if (receipt.operation.revisionId !== room.revisionId)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["operation", "revisionId"],
        message: "Receipt operation revision must match its room.",
      });
  });

function same(left: unknown, right: unknown): boolean {
  return isDeepStrictEqual(left, right);
}

function documentCollections(document: Y.Doc) {
  return {
    serverMeta: document.getMap("serverMeta").toJSON(),
    ledger: readDrawingCollaborationLedger(document),
    operationStatus: document.getMap("operationStatus").toJSON(),
  };
}

function ensureDrawingCollections(document: Y.Doc) {
  document.getMap("serverMeta");
  document.getArray("operationOrder");
  document.getArray("operations");
  document.getMap("operationStatus");
}

function validateLedgerWithoutAppend(document: Y.Doc, roomName: string) {
  const names = [...document.share.keys()].sort();
  if (!same(names, DRAWING_COLLABORATION_COLLECTIONS))
    throw new Error("Drawing document collections are invalid.");
  const value = documentCollections(document);
  const room = parseDrawingRoomName(roomName);
  const meta = DrawingCollaborationMetaSchema.parse(value.serverMeta);
  if (meta.projectId !== room.projectId || meta.revisionId !== room.revisionId)
    throw new Error("Drawing document scope does not match its room.");
  DrawingCollaborationClientAppendSchema.parse({
    operationOrder: value.ledger.operationOrder,
    operations: value.ledger.operations,
  });
  for (const [operationId, status] of Object.entries(value.operationStatus)) {
    if (!(operationId in value.ledger.operations))
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
    document.getArray("operations");
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
    let protectedStructureChanged = false;
    const insertedOperations: unknown[] = [];
    const insertedOrder: unknown[] = [];
    candidate.getMap("serverMeta").observe(() => {
      protectedStructureChanged = true;
    });
    candidate.getMap("operationStatus").observe(() => {
      protectedStructureChanged = true;
    });
    candidate.getArray("operations").observe((event) => {
      if (event.changes.delta.some((change) => "delete" in change))
        protectedStructureChanged = true;
      for (const change of event.changes.delta)
        if (Array.isArray(change.insert))
          insertedOperations.push(...change.insert);
    });
    candidate.getArray("operationOrder").observe((event) => {
      if (event.changes.delta.some((change) => "delete" in change))
        protectedStructureChanged = true;
      for (const change of event.changes.delta)
        if (Array.isArray(change.insert)) insertedOrder.push(...change.insert);
    });
    Y.applyUpdate(candidate, update);
    if (protectedStructureChanged)
      throw new Error("Clients cannot rewrite protected collaboration state.");
    const after = documentCollections(candidate);
    if (
      !same(before.serverMeta, after.serverMeta) ||
      !same(before.operationStatus, after.operationStatus)
    )
      throw new Error("Clients cannot author server collaboration state.");
    validateLedgerWithoutAppend(
      candidate,
      `drawing:${context.projectId}:${context.revisionId}`,
    );
    const beforeLedger = before.ledger;
    const afterLedger = after.ledger;
    const inserted = insertedOperations.map((value) =>
      DrawingCollaborationOperationSchema.parse(value),
    );
    if (
      inserted.length !== insertedOrder.length ||
      !same(
        inserted.map((operation) => operation.clientOperationId).sort(),
        insertedOrder.map(String).sort(),
      )
    )
      throw new Error(
        "Drawing operation envelopes and order must append together.",
      );
    for (const operation of inserted) {
      if (operation.actorId !== context.userId)
        throw new Error(
          "Client may append only its verified actor operations.",
        );
      if (operation.revisionId !== context.revisionId)
        throw new Error(
          "Drawing operation revision must match the collaboration room.",
        );
    }
    if (same(beforeLedger, afterLedger)) return;
    validateDrawingCollaborationAppend(
      beforeLedger,
      afterLedger,
      context.userId,
      `drawing:${context.projectId}:${context.revisionId}`,
    );
  } finally {
    candidate.destroy();
  }
}

export function sanitizeDrawingAwarenessState(
  input: Record<string, unknown>,
  identity: { userId: string; displayName: string; color: string },
  now = Date.now(),
) {
  const state = DrawingAwarenessStateSchema.parse({
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
  if (
    state.softLocks.some(
      (lock) => lock.expiresAt <= now || lock.expiresAt > now + 10_000,
    )
  )
    throw new Error("Drawing soft-lock leases must expire within ten seconds.");
  return state;
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
  transact: (mutation: () => void) => void | Promise<void> = (mutation) =>
    document.transact(mutation, DRAWING_COLLABORATION_SERVER_ORIGIN),
) {
  const operations = readDrawingCollaborationLedger(document).operations;
  const statuses = document.getMap("operationStatus");
  const pending = Object.keys(operations).filter((id) => {
    const status = statuses.get(id) as { status?: string } | undefined;
    return !status || status.status === "pending";
  });
  if (!pending.length) return false;
  const accepted = await lookup(pending.slice(0, 256));
  const revisionId = String(document.getMap("serverMeta").get("revisionId"));
  if (
    accepted.length > pending.length ||
    new Set(accepted.map((row) => row.clientOperationId)).size !==
      accepted.length
  )
    throw new Error("Accepted drawing operation lookup is invalid.");
  const validated = accepted.map((row) => {
    const envelope = operations[row.clientOperationId] as
      | Record<string, unknown>
      | undefined;
    if (
      !pending.includes(row.clientOperationId) ||
      !envelope ||
      !acceptedMatchesEnvelope(row, envelope, revisionId)
    )
      throw new Error(
        "Accepted drawing operation does not match its immutable envelope.",
      );
    return DrawingCollaborationStatusSchema.parse({
      operationId: row.clientOperationId,
      status: "acked",
      authoritativeSequence: row.sequence,
      resultVersions: row.resultVersions,
    });
  });
  await transact(() => {
    for (const status of validated) {
      statuses.set(status.operationId, status);
    }
  });
  return validated.length > 0;
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
    | "load"
    | "store"
    | "loadService"
    | "storeService"
    | "bootstrap"
    | "bootstrapService"
    | "lookupOperations"
    | "health"
    | "close"
  >;
  preflightAuth?: () => Promise<void>;
  purgeAuth?: () => void;
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

  function requireFreshToken(
    context: DrawingConnectionContext,
    connection?: TrackedConnection,
  ) {
    const remaining = context.expiresAtMs - now();
    if (remaining <= 0) {
      connection?.close({ code: 4401, reason: "token-expired" });
      throw new Error("Drawing access token expired.");
    }
    if (remaining <= dependencies.config.authorizationIntervalMs)
      connection?.requestToken?.();
  }

  async function reauthorize(
    context: DrawingConnectionContext,
    connection?: TrackedConnection,
  ) {
    requireFreshToken(context, connection);
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
    async beforeSync(input: {
      context: DrawingConnectionContext;
      document: Y.Doc;
      connection: TrackedConnection;
      type: number;
      payload: Uint8Array;
    }) {
      if (input.type !== 1 && input.type !== 2) return;
      await reauthorize(input.context, input.connection);
      input.connection.readOnly = !input.context.canWrite;
      if (!input.context.canWrite) return;
      validateDrawingClientUpdate(input.document, input.payload, input.context);
    },
    async beforeAwareness(input: {
      context: DrawingConnectionContext;
      states: Map<number, Record<string, unknown>>;
      connection?: TrackedConnection;
      awareness?: Awareness;
      origin?: unknown;
      document?: {
        getConnections: () => any[];
        getClients: (connection: any) => Set<any>;
      };
    }) {
      await reauthorize(input.context, input.connection);
      // Hocuspocus v4 seeds its scratch Awareness with one empty local state.
      const scratchClientId = [...input.states].find(
        ([, state]) => Object.keys(state).length === 0,
      )?.[0];
      if (scratchClientId !== undefined) input.states.delete(scratchClientId);
      if (input.states.size > 1)
        throw new Error("One Awareness client is allowed per connection.");
      if (input.connection && input.document) {
        const owned = input.document.getClients(input.connection);
        if (!input.states.size && owned.size && input.awareness) {
          removeAwarenessStates(input.awareness, [...owned], input.origin);
          return;
        }
        for (const clientId of input.states.keys()) {
          if (owned.size && !owned.has(clientId))
            throw new Error(
              "Awareness client does not belong to this connection.",
            );
          for (const peer of input.document.getConnections())
            if (
              peer !== input.connection &&
              input.document.getClients(peer).has(clientId)
            )
              throw new Error(
                "Awareness client belongs to another connection.",
              );
        }
      }
      for (const [clientId, state] of input.states) {
        const sanitized = sanitizeDrawingAwarenessState(
          state,
          input.context,
          now(),
        );
        if (
          new TextEncoder().encode(JSON.stringify(sanitized)).byteLength >
          16_384
        )
          throw new Error("Drawing Awareness update is too large.");
        input.states.set(clientId, sanitized);
      }
    },
    async store(input: {
      document: Y.Doc;
      roomName: string;
      context: Pick<
        DrawingRuntimeContext,
        "userId" | "projectId" | "revisionId"
      > & {
        serviceAuthority?: boolean;
      };
    }) {
      validateLedgerWithoutAppend(input.document, input.roomName);
      const meta = DrawingCollaborationMetaSchema.parse(
        input.document.getMap("serverMeta").toJSON(),
      );
      if (
        (!input.context.serviceAuthority && !input.context.userId) ||
        input.context.projectId !== meta.projectId ||
        input.context.revisionId !== meta.revisionId
      )
        throw new Error("Drawing collaboration store scope is invalid.");
      const state = Y.encodeStateAsUpdate(input.document);
      const stored = input.context.serviceAuthority
        ? await dependencies.storage.storeService({
            projectId: input.context.projectId,
            revisionId: input.context.revisionId,
            state,
            baseOperationSequence: meta.baseOperationSequence,
          })
        : await dependencies.storage.store({
            userId: input.context.userId,
            projectId: input.context.projectId,
            revisionId: input.context.revisionId,
            state,
            baseOperationSequence: meta.baseOperationSequence,
          });
      if (stored.state) {
        validatePersistedDrawingState(stored.state, input.context);
        Y.applyUpdate(input.document, stored.state, {
          source: "local",
          skipStoreHooks: true,
          context: input.context,
        });
      }
      return stored;
    },
  };

  const server = new Server<DrawingRuntimeContext>({
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
    beforeSync(payload) {
      return hooks.beforeSync({
        context: payload.context,
        document: payload.document,
        connection: payload.connection,
        type: payload.type,
        payload: payload.payload,
      });
    },
    beforeHandleAwareness(payload) {
      if (!payload.context)
        throw new Error("Authenticated Awareness context is required.");
      return hooks.beforeAwareness({
        context: payload.context,
        states: payload.states,
        connection: payload.connection,
        awareness: payload.awareness,
        origin: payload.transactionOrigin,
        document: payload.document,
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
      await hooks.store({
        document: payload.document,
        roomName: payload.documentName,
        context: payload.lastContext,
      });
    },
  });
  const hocuspocus = server.hocuspocus;

  function persistenceContext(document: Y.Doc): DrawingRuntimeContext {
    const meta = DrawingCollaborationMetaSchema.parse(
      document.getMap("serverMeta").toJSON(),
    );
    return {
      userId: "00000000-0000-4000-8000-000000000000",
      email: null,
      expiresAtMs: Number.POSITIVE_INFINITY,
      capability: "editor",
      canWrite: true,
      revisionStatus: "draft",
      projectId: meta.projectId,
      revisionId: meta.revisionId,
      roomName: `drawing:${meta.projectId}:${meta.revisionId}`,
      displayName: "server",
      color: "#000000",
      lastAuthorizedAt: now(),
      serviceAuthority: true,
    };
  }

  async function runPassiveAuthorizationCheck() {
    await Promise.all(
      [...connections].map(async (connection) => {
        try {
          await reauthorize(connection.context, connection);
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
    await Promise.allSettled(
      [...hocuspocus.documents.values()].map((document) =>
        (async () => {
          const context = persistenceContext(document);
          const changed = await reconcileAcceptedDrawingOperations(
            document,
            (ids) =>
              dependencies.storage.lookupOperations!(context.revisionId, ids),
            (mutation) =>
              document.transact(mutation, { source: "local", context }),
          );
          if (changed)
            await hooks.store({
              document,
              roomName: context.roomName,
              context,
            });
        })(),
      ),
    );
  }

  const interval = (dependencies.setInterval ?? globalThis.setInterval)(() => {
    void runPassiveAuthorizationCheck().catch(() => {});
    void runReconciliationCheck().catch(() => {});
  }, dependencies.config.authorizationIntervalMs);

  const verifyReceipt = createOutcomeReceiptVerifier(
    dependencies.config.internalSecret,
  );
  async function applyOutcomeReceipt(
    body: string,
    signature: string | undefined,
  ) {
    let receipt: ReturnType<typeof verifyReceipt>;
    try {
      receipt = verifyReceipt(body, signature);
    } catch {
      throw new OutcomeReceiptAuthenticationError(
        "Outcome receipt authentication failed.",
      );
    }
    const room = parseDrawingRoomName(receipt.roomName);
    const context: DrawingRuntimeContext = {
      userId: "00000000-0000-4000-8000-000000000000",
      email: null,
      expiresAtMs: Number.POSITIVE_INFINITY,
      capability: "editor",
      canWrite: true,
      revisionStatus: "draft",
      ...room,
      roomName: receipt.roomName,
      displayName: "server",
      color: "#000000",
      lastAuthorizedAt: now(),
      serviceAuthority: true,
    };
    const loadedDocument = hocuspocus.documents.get(receipt.roomName);
    const detached = !loadedDocument;
    const document: Y.Doc = loadedDocument ?? new Y.Doc();
    if (detached) {
      const stored = await dependencies.storage.loadService(room);
      if (stored) {
        Y.applyUpdate(
          document,
          stored.yjsState,
          DRAWING_COLLABORATION_SERVER_ORIGIN,
        );
        ensureDrawingCollections(document);
        validateLedgerWithoutAppend(document, receipt.roomName);
      } else {
        if (!dependencies.storage.bootstrapService)
          throw new Error(
            "Drawing collaboration service bootstrap is unavailable.",
          );
        await initializeDrawingCollaborationDocument(document, {
          projectId: room.projectId,
          revisionId: room.revisionId,
          bootstrap: () => dependencies.storage.bootstrapService!(room),
        });
      }
    }
    const operations = readDrawingCollaborationLedger(document).operations;
    const statuses = document.getMap("operationStatus");
    const existing = operations[receipt.operationId];
    const current = statuses.get(receipt.operationId) as
      | { status?: string; resultVersions?: unknown }
      | undefined;
    if (existing && !same(existing, receipt.operation))
      throw new Error("Outcome receipt operation is immutable.");
    if (
      current?.status === "acked" ||
      (current &&
        (current.status !== receipt.outcome ||
          !same(current.resultVersions, receipt.resultVersions)))
    )
      throw new Error("Outcome receipt conflicts with authoritative status.");
    document.transact(
      () => {
        if (!existing) {
          appendDrawingCollaborationOperation(document, receipt.operation);
        }
        if (!current)
          statuses.set(receipt.operationId, {
            operationId: receipt.operationId,
            status: receipt.outcome,
            authoritativeSequence: null,
            resultVersions: receipt.resultVersions,
          });
      },
      { source: "local", context },
    );
    await hooks.store({ document, roomName: receipt.roomName, context });
    if (detached) document.destroy();
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
            await applyOutcomeReceipt(
              body,
              request.headers["x-1hk-signature"] as string | undefined,
            );
            response.writeHead(204).end();
          } catch (error) {
            response
              .writeHead(
                error instanceof OutcomeReceiptAuthenticationError ? 401 : 503,
              )
              .end();
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
    purgeAuthCache() {
      dependencies.purgeAuth?.();
    },
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
    purgeAuth: tokenVerifier.purge,
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
  process.on("SIGHUP", () => runtime.purgeAuthCache());
  await runtime.start();
}
