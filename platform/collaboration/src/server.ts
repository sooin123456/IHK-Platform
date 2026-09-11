import { createHmac, timingSafeEqual } from "node:crypto";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";

import { Server } from "@hocuspocus/server";
import {
  applyAwarenessUpdate,
  encodeAwarenessUpdate,
  removeAwarenessStates,
  type Awareness,
} from "y-protocols/awareness";
import * as Y from "yjs";
import { z } from "zod";

import {
  DRAWING_COLLABORATION_SCHEMA_VERSION,
  DRAWING_COLLABORATION_LIMITS,
  DRAWING_COLLABORATION_SERVER_ORIGIN,
  DRAWING_COLLABORATION_COLLECTIONS,
  DrawingAwarenessStateSchema,
  DrawingCollaborationClientAppendSchema,
  DrawingCollaborationMetaSchema,
  DrawingCollaborationOperationSchema,
  DrawingCollaborationStatusSchema,
  drawingCollaborationOperationFromSnapshotOutcome,
  parseDrawingRoomName,
  resolveDrawingCollaborationOperation,
  type DrawingCollaborationOperation,
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
  type DrawingServiceStorageScope,
  type DrawingStoredState,
} from "./storage.ts";
import {
  createDrawingFreezeCoordinator,
  createDrawingFreezeSecretVerifier,
  reconcileDrawingFreezeMetadata,
} from "./freeze.ts";

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
  document?: {
    awareness: Awareness;
    getClients: (connection: any) => Set<any>;
  };
};

class OutcomeReceiptAuthenticationError extends Error {}

export const DRAWING_OUTCOME_RECEIPT_MAX_BYTES = 96 * 1024;

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
    outcome: z.enum(["acked", "rejected", "conflicted"]),
    authoritativeSequence: z.number().int().positive().nullable().optional(),
    resultVersions: z
      .record(z.string().uuid(), z.number().int().positive().nullable())
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
    if (
      (receipt.outcome === "acked") !==
      (typeof receipt.authoritativeSequence === "number")
    )
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["authoritativeSequence"],
        message:
          "Only acknowledged receipts require an authoritative sequence.",
      });
  });

const BootstrapOutcomeSchema = z
  .object({
    revisionId: z.string().uuid(),
    clientOperationId: z.string().uuid(),
    actorId: z.string().uuid(),
    operationType: z.string(),
    baseVersions: z.record(z.string().uuid(), z.number().int().positive()),
    forward: z.record(z.string(), z.unknown()),
    inverse: z.record(z.string(), z.unknown()),
    historyAction: z.enum(["undo", "redo"]).optional(),
    originalOperationId: z.string().uuid().optional(),
    sequence: z.number().int().positive(),
    resultVersions: z.record(
      z.string().uuid(),
      z.number().int().positive().nullable(),
    ),
  })
  .strict()
  .superRefine((value, context) => {
    if (Boolean(value.historyAction) !== Boolean(value.originalOperationId))
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Drawing bootstrap history lineage is incomplete.",
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

function validateDrawingHistoryLedger(
  operationOrder: string[],
  operations: Record<string, DrawingCollaborationOperation>,
) {
  const undoByActor = new Map<string, string[]>();
  const redoByActor = new Map<string, string[]>();
  const actorByOperation = new Map<string, string>();
  for (const operationId of operationOrder) {
    const operation = operations[operationId];
    const undo = undoByActor.get(operation.actorId) ?? [];
    const redo = redoByActor.get(operation.actorId) ?? [];
    if (operation.historyAction && operation.originalOperationId) {
      if (
        actorByOperation.get(operation.originalOperationId) !==
        operation.actorId
      )
        throw new Error(
          "Drawing history original must belong to the same actor.",
        );
      const source = operation.historyAction === "undo" ? undo : redo;
      if (source.at(-1) !== operation.originalOperationId)
        throw new Error(
          "Drawing history transition does not match the actor stack.",
        );
      source.pop();
      (operation.historyAction === "undo" ? redo : undo).push(
        operation.originalOperationId,
      );
    } else if (operation.type !== "add_layer") {
      undo.push(operationId);
      redo.length = 0;
    }
    undoByActor.set(operation.actorId, undo);
    redoByActor.set(operation.actorId, redo);
    actorByOperation.set(operationId, operation.actorId);
  }
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
  validateDrawingHistoryLedger(
    value.ledger.operationOrder,
    value.ledger.operations,
  );
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
  try {
    Y.applyUpdate(document, state, DRAWING_COLLABORATION_SERVER_ORIGIN);
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
      recentOutcomes: z.array(BootstrapOutcomeSchema).max(256).optional(),
      historyOutcomes: z.array(BootstrapOutcomeSchema).max(10_000).optional(),
    })
    .passthrough()
    .parse(await input.bootstrap());
  const outcomes = bootstrap.historyOutcomes ?? bootstrap.recentOutcomes ?? [];
  if (
    new Set(outcomes.map((outcome) => outcome.clientOperationId)).size !==
      outcomes.length ||
    new Set(outcomes.map((outcome) => outcome.sequence)).size !==
      outcomes.length ||
    outcomes.some(
      (outcome, index) =>
        index > 0 && outcomes[index - 1].sequence >= outcome.sequence,
    ) ||
    outcomes.some(
      (outcome) =>
        outcome.revisionId !== input.revisionId ||
        outcome.sequence > bootstrap.operationSequence,
    )
  )
    throw new Error("Drawing collaboration bootstrap outcomes are invalid.");
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
    const includedOperationIds = new Set<string>();
    for (const outcome of outcomes) {
      const operation =
        drawingCollaborationOperationFromSnapshotOutcome(outcome);
      if (
        !operation ||
        (operation.historyAction &&
          !includedOperationIds.has(operation.originalOperationId!))
      )
        continue;
      appendDrawingCollaborationOperation(document, operation);
      includedOperationIds.add(operation.clientOperationId);
      document.getMap("operationStatus").set(operation.clientOperationId, {
        operationId: operation.clientOperationId,
        status: "acked",
        authoritativeSequence: outcome.sequence,
        resultVersions: outcome.resultVersions,
      });
    }
  }, DRAWING_COLLABORATION_SERVER_ORIGIN);
  validateLedgerWithoutAppend(
    document,
    `drawing:${input.projectId}:${input.revisionId}`,
  );
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
  const freezeState = DrawingCollaborationMetaSchema.parse(
    current.getMap("serverMeta").toJSON(),
  ).freezeState;
  if (freezeState !== "active" && freezeState !== "released")
    throw new Error("Drawing collaboration room is frozen.");
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

function stripConnectionSoftLocks(connection: TrackedConnection, now: number) {
  const document = connection.document;
  if (!document) return;
  for (const clientId of document.getClients(connection)) {
    const current = document.awareness.getStates().get(clientId);
    if (
      !current ||
      !Array.isArray(current.softLocks) ||
      !current.softLocks.length
    )
      continue;
    const meta = document.awareness.meta.get(clientId);
    if (!meta) continue;
    const sanitized = sanitizeDrawingAwarenessState(
      { ...current, softLocks: [] },
      connection.context,
      now,
    );
    const update = encodeAwarenessUpdate(
      {
        meta: new Map([
          [clientId, { clock: meta.clock + 1, lastUpdated: now }],
        ]),
      } as Awareness,
      [clientId],
      new Map([[clientId, sanitized]]),
    );
    applyAwarenessUpdate(
      document.awareness,
      update,
      DRAWING_COLLABORATION_SERVER_ORIGIN,
    );
  }
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
    if (Buffer.byteLength(body) > DRAWING_OUTCOME_RECEIPT_MAX_BYTES)
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
    [accepted.historyAction ?? null, envelope.historyAction ?? null],
    [
      accepted.originalOperationId ?? null,
      envelope.originalOperationId ?? null,
    ],
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

/** Add only receipt-backed native imports missing from a room's durable ledger. */
export async function reconcileNativeDrawingOperations(
  document: Y.Doc,
  lookup: NonNullable<DrawingCollaborationDatabase["nativeOperations"]>,
) {
  const meta = DrawingCollaborationMetaSchema.parse(
    document.getMap("serverMeta").toJSON(),
  );
  if (meta.freezeState === "frozen") return false;
  const scope = { projectId: meta.projectId, revisionId: meta.revisionId };
  const rows: z.infer<typeof BootstrapOutcomeSchema>[] = [];
  let after = meta.baseOperationSequence;
  for (;;) {
    const page = await lookup(scope, after);
    if (!Array.isArray(page) || page.length > 256)
      throw new Error("Native drawing operation page is invalid.");
    for (const raw of page) {
      const row = BootstrapOutcomeSchema.parse({
        ...raw,
        historyAction: raw.historyAction ?? undefined,
        originalOperationId: raw.originalOperationId ?? undefined,
      });
      if (
        row.revisionId !== scope.revisionId ||
        row.sequence <= after ||
        row.operationType !== "mutate_structure" ||
        row.historyAction ||
        row.originalOperationId ||
        Object.keys(row.baseVersions).length
      )
        throw new Error(
          "Native drawing operation scope or sequence is invalid.",
        );
      rows.push(row);
      after = row.sequence;
    }
    if (rows.length > DRAWING_COLLABORATION_LIMITS.maxOperations)
      throw new Error("Too many native drawing operations.");
    if (page.length < 256) break;
  }
  if (
    !same(
      meta,
      DrawingCollaborationMetaSchema.parse(
        document.getMap("serverMeta").toJSON(),
      ),
    )
  )
    throw new Error("Native drawing room boundary changed during lookup.");
  const candidate = new Y.Doc();
  try {
    Y.applyUpdate(candidate, Y.encodeStateAsUpdate(document));
    const ledger = readDrawingCollaborationLedger(candidate);
    const statuses = candidate.getMap("operationStatus");
    const sequences = new Map<number, string>();
    for (const [id, raw] of statuses.entries()) {
      const status = DrawingCollaborationStatusSchema.parse(raw);
      if (status.status === "acked") {
        if (sequences.has(status.authoritativeSequence!))
          throw new Error("Drawing operation sequence collides.");
        sequences.set(status.authoritativeSequence!, id);
      }
    }
    let changed = false;
    for (const row of rows) {
      const operation = drawingCollaborationOperationFromSnapshotOutcome(row);
      if (
        !operation ||
        operation.forward.type !== "mutate_structure" ||
        !Array.isArray(operation.forward.actions) ||
        operation.forward.actions.length !== 1 ||
        operation.forward.actions[0].kind !== "put_block" ||
        operation.forward.actions[0].baseVersion !== null
      )
        throw new Error(
          "Native drawing operation cannot enter the live ledger.",
        );
      const existing = ledger.operations[row.clientOperationId];
      if (
        existing &&
        !resolveDrawingCollaborationOperation(existing, operation)
      )
        throw new Error("Native drawing operation identity collides.");
      const sequenceOwner = sequences.get(row.sequence);
      if (sequenceOwner && sequenceOwner !== row.clientOperationId)
        throw new Error("Native drawing operation sequence collides.");
      const status = DrawingCollaborationStatusSchema.parse({
        operationId: row.clientOperationId,
        status: "acked",
        authoritativeSequence: row.sequence,
        resultVersions: row.resultVersions,
      });
      const previous = statuses.get(row.clientOperationId);
      if (previous) {
        const parsed = DrawingCollaborationStatusSchema.parse(previous);
        if (parsed.status !== "pending" && !same(parsed, status))
          throw new Error("Native drawing operation status collides.");
      }
      if (!existing) {
        appendDrawingCollaborationOperation(candidate, operation);
        ledger.operations[row.clientOperationId] = operation;
        changed = true;
      }
      if (!same(previous, status)) {
        statuses.set(row.clientOperationId, status);
        changed = true;
      }
      sequences.set(row.sequence, row.clientOperationId);
    }
    validateLedgerWithoutAppend(
      candidate,
      `drawing:${scope.projectId}:${scope.revisionId}`,
    );
    if (changed) {
      const update = Y.encodeStateAsUpdate(
        candidate,
        Y.encodeStateVector(document),
      );
      document.transact(
        () => Y.applyUpdate(document, update),
        DRAWING_COLLABORATION_SERVER_ORIGIN,
      );
    }
    return changed;
  } finally {
    candidate.destroy();
  }
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
    | "initializeState"
    | "initializeServiceState"
    | "storeService"
    | "bootstrap"
    | "bootstrapService"
    | "lookupOperations"
    | "nativeOperations"
    | "freeze"
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
    const couldWrite = context.canWrite;
    const access = await dependencies.authorize(
      context.userId,
      context.projectId,
      context.revisionId,
    );
    if (!access)
      throw new Error("Drawing collaboration target is unavailable.");
    Object.assign(context, access, { lastAuthorizedAt: now() });
    if (couldWrite && !context.canWrite && connection)
      stripConnectionSoftLocks(connection, now());
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
      const freeze = await reconcileLoadedDocument(
        input.document,
        input.context.roomName,
      );
      if (freeze && ["freezing", "frozen"].includes(freeze.freezeState)) {
        input.connection.readOnly = true;
        input.connection.close({ code: 4403, reason: "review-freeze" });
        throw new Error("Drawing revision is frozen for review.");
      }
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
          input.context.canWrite ? state : { ...state, softLocks: [] },
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

  const preparingFreezeRequests = new Map<
    string,
    { requestId: string; count: number }
  >();
  const freezeCoordinator = dependencies.storage.freeze
    ? createDrawingFreezeCoordinator({
        database: dependencies.storage.freeze,
        now,
        setInterval: dependencies.setInterval,
        clearInterval: dependencies.clearInterval,
        reconcile: async (document) => {
          if (dependencies.storage.nativeOperations)
            await reconcileNativeDrawingOperations(
              document,
              dependencies.storage.nativeOperations,
            );
          if (!dependencies.storage.lookupOperations) return;
          const revisionId = String(
            document.getMap("serverMeta").get("revisionId"),
          );
          await reconcileAcceptedDrawingOperations(document, (ids) =>
            dependencies.storage.lookupOperations!(revisionId, ids),
          );
        },
      })
    : null;
  const reconcileLoadedDocument = async (document: Y.Doc, roomName: string) => {
    const preparing = preparingFreezeRequests.get(roomName);
    if (preparing) {
      reconcileDrawingFreezeMetadata(document, "freezing", preparing.requestId);
      return {
        freezeState: "freezing" as const,
        freezeRequestId: preparing.requestId,
      };
    }
    return (
      (await freezeCoordinator?.reconcileLoaded({ document, roomName })) ?? null
    );
  };

  function documentFromStored(
    stored: DrawingStoredState,
    scope: DrawingServiceStorageScope,
  ) {
    const document = new Y.Doc();
    try {
      Y.applyUpdate(
        document,
        stored.yjsState,
        DRAWING_COLLABORATION_SERVER_ORIGIN,
      );
      ensureDrawingCollections(document);
      validateLedgerWithoutAppend(
        document,
        `drawing:${scope.projectId}:${scope.revisionId}`,
      );
      return document;
    } catch (error) {
      document.destroy();
      throw error;
    }
  }

  async function loadCanonicalDocument(
    scope: DrawingStorageScope | DrawingServiceStorageScope,
    service: boolean,
  ) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const stored = service
        ? await dependencies.storage.loadService(scope)
        : await dependencies.storage.load(scope as DrawingStorageScope);
      if (stored) return documentFromStored(stored, scope);
      const bootstrap = service
        ? dependencies.storage.bootstrapService
        : dependencies.storage.bootstrap;
      const initialize = service
        ? dependencies.storage.initializeServiceState
        : dependencies.storage.initializeState;
      if (!bootstrap || !initialize)
        throw new Error(
          "Drawing collaboration canonical initialization is unavailable.",
        );
      const candidate = new Y.Doc();
      try {
        await initializeDrawingCollaborationDocument(candidate, {
          ...scope,
          bootstrap: () => bootstrap(scope as DrawingStorageScope),
        });
        const meta = DrawingCollaborationMetaSchema.parse(
          candidate.getMap("serverMeta").toJSON(),
        );
        const winner = await initialize({
          ...(scope as DrawingStorageScope),
          state: Y.encodeStateAsUpdate(candidate),
          baseOperationSequence: meta.baseOperationSequence,
          baseSnapshotSha256: meta.baseSnapshotSha256,
        });
        return documentFromStored(winner, scope);
      } catch (error) {
        if (
          attempt === 2 ||
          !error ||
          typeof error !== "object" ||
          !("code" in error) ||
          error.code !== "P3S04"
        )
          throw error;
      } finally {
        candidate.destroy();
      }
    }
    throw new Error(
      "Drawing collaboration canonical initialization exhausted.",
    );
  }

  function reconciliationRetry() {
    return Object.assign(
      new Error(
        "Drawing collaboration reconciliation is not durable; retry admission.",
      ),
      {
        code: "DRAWING_RECONCILIATION_RETRY",
        retryable: true,
        reason: "drawing-reconciling",
      },
    );
  }

  async function loadDurableAdmission(
    scope: DrawingStorageScope,
    roomName: string,
  ) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const document = await loadCanonicalDocument(scope, false);
      try {
        const before = Y.encodeStateAsUpdate(document);
        await reconcileLoadedDocument(document, roomName);
        validateLedgerWithoutAppend(document, roomName);
        const reconciled = Y.encodeStateAsUpdate(document);
        let stored = await dependencies.storage.load(scope);
        if (!stored) throw reconciliationRetry();
        let durable = documentFromStored(stored, scope);
        try {
          if (same(reconciled, Y.encodeStateAsUpdate(durable)))
            return reconciled;
          // Concurrent durable movement requires reconciliation from its new origin.
          if (!same(before, Y.encodeStateAsUpdate(durable))) continue;
          const meta = DrawingCollaborationMetaSchema.parse(
            document.getMap("serverMeta").toJSON(),
          );
          if (meta.freezeState !== "active") throw reconciliationRetry();
          // Only the guarded service store can persist an active metadata correction.
          // Load its CAS token and ensure it still represents this exact starting state.
          stored = await dependencies.storage.loadService(scope);
          if (!stored) throw reconciliationRetry();
          durable.destroy();
          durable = documentFromStored(stored, scope);
          if (!same(before, Y.encodeStateAsUpdate(durable))) continue;
          await hooks.store({
            document,
            roomName,
            context: persistenceContext(document),
          });
          stored = await dependencies.storage.load(scope);
          if (!stored) throw reconciliationRetry();
          durable.destroy();
          durable = documentFromStored(stored, scope);
          const corrected = Y.encodeStateAsUpdate(document);
          if (same(corrected, Y.encodeStateAsUpdate(durable))) return corrected;
        } finally {
          durable.destroy();
        }
      } finally {
        document.destroy();
      }
    }
    throw reconciliationRetry();
  }

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
      const couldWrite = payload.context.canWrite;
      const context = await hooks.tokenSync({
        token: payload.token,
        origin: payload.requestHeaders.get("origin"),
        roomName: payload.documentName,
      });
      payload.connection.readOnly = !context.canWrite;
      Object.assign(payload.context, context);
      if (couldWrite && !payload.context.canWrite)
        stripConnectionSoftLocks(payload.connection, now());
      return payload.context;
    },
    async connected(payload) {
      connections.add(payload.connection);
      payload.connection.sendStateless(
        JSON.stringify({
          type: "1hk-collaboration-admission",
          instanceId: dependencies.config.instanceId,
        }),
      );
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
      try {
        const state = await loadDurableAdmission(
          payload.context,
          payload.documentName,
        );
        Y.applyUpdate(
          payload.document,
          state,
          DRAWING_COLLABORATION_SERVER_ORIGIN,
        );
        ensureDrawingCollections(payload.document);
        return payload.document;
      } catch (error) {
        // Hocuspocus cannot unload a payload that has not entered its room map.
        payload.document.destroy();
        throw error;
      }
    },
    async onStoreDocument(payload) {
      if (
        payload.lastTransactionOrigin === DRAWING_COLLABORATION_SERVER_ORIGIN
      ) {
        let meta = DrawingCollaborationMetaSchema.parse(
          payload.document.getMap("serverMeta").toJSON(),
        );
        if (["freezing", "frozen"].includes(meta.freezeState)) {
          let sharedError: unknown = null;
          const shared = meta.freezeRequestId
            ? freezeCoordinator?.shareOwner({
                roomName: payload.documentName,
                requestId: meta.freezeRequestId,
              })
            : null;
          if (shared)
            try {
              await shared;
            } catch (error) {
              sharedError = error;
            }
          meta = DrawingCollaborationMetaSchema.parse(
            payload.document.getMap("serverMeta").toJSON(),
          );
          if (["freezing", "frozen"].includes(meta.freezeState)) {
            if (sharedError) throw sharedError;
            return;
          }
        }
        if (meta.freezeState === "released") return;
        await hooks.store({
          document: payload.document,
          roomName: payload.documentName,
          context: persistenceContext(payload.document),
        });
        return;
      }
      await hooks.store({
        document: payload.document,
        roomName: payload.documentName,
        context: payload.lastContext,
      });
    },
  });
  const hocuspocus = server.hocuspocus;

  const verifyFreezeSecret = dependencies.config.freezeSecret
    ? createDrawingFreezeSecretVerifier(dependencies.config.freezeSecret)
    : null;

  async function loadServiceDocument(roomName: string) {
    const room = parseDrawingRoomName(roomName);
    const loaded = hocuspocus.documents.get(roomName);
    if (loaded) return { document: loaded, detached: false };
    const document = await loadCanonicalDocument(room, true);
    return { document, detached: true };
  }

  async function applyFreezeRequest(
    body: string,
    suppliedSecret: string | undefined,
  ) {
    if (!verifyFreezeSecret || !freezeCoordinator)
      throw new OutcomeReceiptAuthenticationError(
        "Drawing freeze service is unavailable.",
      );
    try {
      verifyFreezeSecret(suppliedSecret);
    } catch {
      throw new OutcomeReceiptAuthenticationError(
        "Drawing freeze authentication failed.",
      );
    }
    const room = z.string().refine((value) => {
      try {
        parseDrawingRoomName(value);
        return true;
      } catch {
        return false;
      }
    });
    const request = z
      .discriminatedUnion("action", [
        z.object({ action: z.literal("authority"), roomName: room }).strict(),
        z
          .object({
            action: z.enum(["freeze", "reconcile", "release"]),
            roomName: room,
            freezeRequestId: z.string().uuid(),
          })
          .strict(),
      ])
      .parse(JSON.parse(body));
    if (request.action === "freeze" || request.action === "reconcile") {
      const shared = freezeCoordinator.shareOwner({
        roomName: request.roomName,
        requestId: request.freezeRequestId,
      });
      if (shared) {
        const frozen = await shared;
        for (const connection of [...connections])
          if (connection.context.roomName === request.roomName) {
            connection.readOnly = true;
            connection.close({ code: 4403, reason: "review-freeze" });
            connections.delete(connection);
          }
        return frozen;
      }
      if (
        await freezeCoordinator.hasCommittedFreeze({
          roomName: request.roomName,
          requestId: request.freezeRequestId,
        })
      ) {
        const loaded = await loadServiceDocument(request.roomName);
        try {
          const frozen = await freezeCoordinator.reconcileLoaded({
            document: loaded.document,
            roomName: request.roomName,
          });
          if (
            frozen?.freezeState !== "frozen" ||
            frozen.freezeRequestId !== request.freezeRequestId
          )
            throw new Error("Committed drawing freeze changed during replay.");
          for (const connection of [...connections])
            if (connection.context.roomName === request.roomName) {
              connection.readOnly = true;
              connection.close({ code: 4403, reason: "review-freeze" });
              connections.delete(connection);
            }
          return frozen;
        } finally {
          if (loaded.detached) loaded.document.destroy();
        }
      }
    }
    let releasePreparation = () => {};
    if (
      request.action === "release" &&
      preparingFreezeRequests.get(request.roomName)?.requestId ===
        request.freezeRequestId
    )
      throw new Error("Drawing freeze is still preparing.");
    if (request.action === "freeze" || request.action === "reconcile") {
      const existing = preparingFreezeRequests.get(request.roomName);
      if (existing && existing.requestId !== request.freezeRequestId)
        throw new Error("Drawing freeze is preparing another request.");
      preparingFreezeRequests.set(request.roomName, {
        requestId: request.freezeRequestId,
        count: (existing?.count ?? 0) + 1,
      });
      let released = false;
      releasePreparation = () => {
        if (released) return;
        released = true;
        const current = preparingFreezeRequests.get(request.roomName);
        if (current?.requestId !== request.freezeRequestId) return;
        if (current.count === 1)
          preparingFreezeRequests.delete(request.roomName);
        else current.count -= 1;
      };
    }
    let loaded: Awaited<ReturnType<typeof loadServiceDocument>> | null = null;
    let prepared = false;
    try {
      if (request.action === "freeze" || request.action === "reconcile") {
        await freezeCoordinator.prepare({
          roomName: request.roomName,
          requestId: request.freezeRequestId,
        });
        prepared = true;
      }
      loaded = await loadServiceDocument(request.roomName);
      if (request.action === "authority")
        return await reconcileLoadedDocument(loaded.document, request.roomName);
      if (request.action === "release")
        return await freezeCoordinator.release({
          document: loaded.document,
          roomName: request.roomName,
          requestId: request.freezeRequestId,
        });
      const freezing = freezeCoordinator.freeze({
        document: loaded.document,
        roomName: request.roomName,
        requestId: request.freezeRequestId,
      });
      prepared = false;
      releasePreparation();
      const frozen = await freezing;
      for (const connection of [...connections])
        if (connection.context.roomName === request.roomName) {
          connection.readOnly = true;
          connection.close({ code: 4403, reason: "review-freeze" });
          connections.delete(connection);
        }
      return frozen;
    } catch (error) {
      if (prepared && "freezeRequestId" in request)
        await freezeCoordinator
          .cancelPreparation({
            roomName: request.roomName,
            requestId: request.freezeRequestId,
          })
          .catch(() => undefined);
      releasePreparation();
      const liveDocument = hocuspocus.documents.get(request.roomName);
      if (liveDocument)
        await reconcileLoadedDocument(liveDocument, request.roomName).catch(
          () => undefined,
        );
      throw error;
    } finally {
      releasePreparation();
      if (loaded?.detached) loaded.document.destroy();
    }
  }

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
    if (
      !dependencies.storage.lookupOperations &&
      !dependencies.storage.nativeOperations &&
      !freezeCoordinator
    )
      return;
    await Promise.allSettled(
      [...hocuspocus.documents.values()].map((document) =>
        (async () => {
          const context = persistenceContext(document);
          await reconcileLoadedDocument(document, context.roomName);
          const meta = DrawingCollaborationMetaSchema.parse(
            document.getMap("serverMeta").toJSON(),
          );
          const nativeChanged =
            dependencies.storage.nativeOperations &&
            ["active", "released"].includes(meta.freezeState)
              ? await reconcileNativeDrawingOperations(
                  document,
                  dependencies.storage.nativeOperations,
                )
              : false;
          const changed = dependencies.storage.lookupOperations
            ? await reconcileAcceptedDrawingOperations(
                document,
                (ids) =>
                  dependencies.storage.lookupOperations!(
                    context.revisionId,
                    ids,
                  ),
                (mutation) =>
                  document.transact(mutation, { source: "local", context }),
              )
            : false;
          if (changed || nativeChanged)
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
    const { document, detached } = await loadServiceDocument(receipt.roomName);
    try {
      const operations = readDrawingCollaborationLedger(document).operations;
      const statuses = document.getMap("operationStatus");
      const existing = operations[receipt.operationId];
      const current = statuses.get(receipt.operationId) as
        | {
            status?: string;
            authoritativeSequence?: number | null;
            resultVersions?: unknown;
          }
        | undefined;
      if (
        existing &&
        !resolveDrawingCollaborationOperation(existing, receipt.operation)
      )
        throw new Error("Outcome receipt operation is immutable.");
      if (
        current &&
        (current.status !== receipt.outcome ||
          !same(current.resultVersions, receipt.resultVersions) ||
          (receipt.outcome === "acked" &&
            current.authoritativeSequence !== receipt.authoritativeSequence))
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
              authoritativeSequence:
                receipt.outcome === "acked"
                  ? receipt.authoritativeSequence!
                  : null,
              resultVersions: receipt.resultVersions,
            });
        },
        { source: "local", context },
      );
      await hooks.store({ document, roomName: receipt.roomName, context });
      return receipt;
    } finally {
      if (detached) document.destroy();
    }
  }

  async function health() {
    if (!live)
      return {
        live: false,
        ready: false,
        instanceId: dependencies.config.instanceId,
      };
    try {
      return {
        live: true,
        ready: authReady && ((await dependencies.storage.health?.()) ?? true),
        instanceId: dependencies.config.instanceId,
      };
    } catch {
      return {
        live: true,
        ready: false,
        instanceId: dependencies.config.instanceId,
      };
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
          const chunks: Buffer[] = [];
          let byteCount = 0;
          for await (const chunk of request) {
            const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            byteCount += bytes.byteLength;
            if (byteCount > DRAWING_OUTCOME_RECEIPT_MAX_BYTES) {
              response.writeHead(413).end();
              return;
            }
            chunks.push(bytes);
          }
          const body = Buffer.concat(chunks).toString("utf8");
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
        if (request.method === "POST" && url.pathname === "/internal/freeze") {
          const chunks: Buffer[] = [];
          let byteCount = 0;
          for await (const chunk of request) {
            const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            byteCount += bytes.byteLength;
            if (byteCount > 16 * 1024) {
              response.writeHead(413).end();
              return;
            }
            chunks.push(bytes);
          }
          const body = Buffer.concat(chunks).toString("utf8");
          try {
            const result = await applyFreezeRequest(
              body,
              request.headers["x-1hk-freeze-secret"] as string | undefined,
            );
            response.writeHead(200, { "content-type": "application/json" });
            response.end(JSON.stringify(result));
          } catch (error) {
            response
              .writeHead(
                error instanceof OutcomeReceiptAuthenticationError ? 401 : 409,
                { "content-type": "application/json" },
              )
              .end(JSON.stringify({ error: "Drawing freeze request failed." }));
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
      freezeCoordinator?.dispose();
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
    applyFreezeRequest,
    reconcileLoadedDocument,
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
