import * as Y from "yjs";

import {
  applyDrawingCommand,
  type DrawingCommand,
  type DrawingCommandEnvironment,
  type DrawingDocumentState,
  type DrawingRecordedOperation,
} from "./drawing-commands.ts";
import {
  DRAWING_COLLABORATION_SCHEMA_VERSION,
  DRAWING_COLLABORATION_SERVER_ORIGIN,
  DRAWING_COLLABORATION_COLLECTIONS,
  DrawingCollaborationMetaSchema,
  DrawingCollaborationOperationSchema,
  DrawingCollaborationStatusSchema,
  drawingCollaborationWritableCapabilities,
  type DrawingCollaborationOperation,
} from "./drawing-collaboration-protocol.ts";
import {
  appendDrawingCollaborationOperation,
  readDrawingCollaborationLedger,
} from "./drawing-collaboration-yjs.ts";
import { validateDrawingStructureState } from "./drawing-structure.ts";
import type { DrawingWorkspaceCapability } from "./drawing-workspace.server.ts";
import {
  DrawingLayerSchema,
  DrawingObjectSchema,
} from "./drawing-workspace.types.ts";

export type DrawingDraftQuarantine = {
  message: string;
  occurredAt: string;
};

export type DrawingDraftSnapshot = {
  state: DrawingDocumentState;
  pendingOperationIds: string[];
  conflictOperationIds: string[];
  rejectedOperationIds: string[];
  provisionalConflictOperationIds: string[];
  authorization: DrawingWorkspaceCapability;
  frozen: boolean;
  quarantine: DrawingDraftQuarantine | null;
};

export type PreparedDrawingDraft = {
  operation: DrawingCollaborationOperation;
  state: DrawingDocumentState;
  recordedOperation?: DrawingRecordedOperation;
};

export type DrawingDraftAdapter = {
  getSnapshot(): DrawingDraftSnapshot;
  operations(): DrawingCollaborationOperation[];
  subscribe(listener: () => void): () => void;
  prepareLocal(command: DrawingCommand): PreparedDrawingDraft;
  preparePersistedLocal(
    operation: DrawingCollaborationOperation,
  ): PreparedDrawingDraft;
  prepareRecordedLocal(
    operation: DrawingRecordedOperation,
  ): PreparedDrawingDraft;
  appendDurableLocal(prepared: PreparedDrawingDraft): boolean;
  applyServerProjection(update: Uint8Array): boolean;
  replaceAuthoritative(
    state: DrawingDocumentState,
    options?: { baseOperationSequence?: number },
  ): void;
  setAuthorization(capability: DrawingWorkspaceCapability): void;
  setFrozen(frozen: boolean): void;
  whenLocalPersistenceSynced(): Promise<void>;
  dispose(): void;
};

type DrawingDraftAdapterOptions = DrawingCommandEnvironment & {
  document: Y.Doc;
  authoritativeState: DrawingDocumentState;
  actorId: string;
  authorization: DrawingWorkspaceCapability;
  frozen: boolean;
  baseOperationSequence?: number;
  localPersistenceSynced?: Promise<unknown>;
  replaceProjection?: (state: DrawingDocumentState) => void;
};

function same(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right))
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => same(value, right[index]))
    );
  if (!left || !right || typeof left !== "object" || typeof right !== "object")
    return false;
  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const leftKeys = Object.keys(leftRecord).sort();
  const rightKeys = Object.keys(rightRecord).sort();
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every(
      (key, index) =>
        key === rightKeys[index] && same(leftRecord[key], rightRecord[key]),
    )
  );
}

function validateState(state: DrawingDocumentState) {
  for (const value of Object.values(state.objects))
    DrawingObjectSchema.parse(value);
  for (const value of Object.values(state.layers))
    DrawingLayerSchema.parse(value);
  if (state.structure)
    validateDrawingStructureState({
      revisionId: state.revisionId,
      ...state.structure,
    });
}

function envelopeFor(
  operation: DrawingRecordedOperation,
): DrawingCollaborationOperation {
  return DrawingCollaborationOperationSchema.parse({
    clientOperationId: operation.clientOperationId,
    revisionId: operation.revisionId,
    actorId: operation.actorId,
    schemaVersion: DRAWING_COLLABORATION_SCHEMA_VERSION,
    type: operation.type,
    baseVersions: operation.baseVersions,
    forward: operation.forward,
    inverse: operation.inverse,
    createdAt: operation.createdAt,
  });
}

function commandFor(operation: DrawingCollaborationOperation): DrawingCommand {
  return {
    ...(operation.forward as Omit<DrawingCommand, "actorId">),
    actorId: operation.actorId,
  } as DrawingCommand;
}

class DrawingDraftIntegrityError extends Error {}

function replay(
  state: DrawingDocumentState,
  operation: DrawingCollaborationOperation,
  authoritativeResultVersions?: Record<string, number>,
  recordedOperation?: DrawingRecordedOperation,
): DrawingDocumentState {
  const applied = applyDrawingCommand(state, commandFor(operation), {
    createId: () => operation.clientOperationId,
    now: () => operation.createdAt,
  });
  if (!same(envelopeFor(applied.operation), operation))
    throw new DrawingDraftIntegrityError(
      "Drawing operation does not reproduce its canonical command.",
    );
  if (
    authoritativeResultVersions &&
    !same(applied.operation.realizedVersions, authoritativeResultVersions)
  )
    throw new DrawingDraftIntegrityError(
      "Drawing operation result versions are not authoritative.",
    );
  let next = applied.state;
  if (
    recordedOperation?.historyAction &&
    recordedOperation.originalOperationId
  ) {
    const actorId = operation.actorId;
    const originalOperationId = recordedOperation.originalOperationId;
    const undo = [...(state.undoStackByActor[actorId] ?? [])];
    const redo = [...(state.redoStackByActor[actorId] ?? [])];
    next = {
      ...applied.state,
      operations: [
        ...applied.state.operations.slice(0, -1),
        {
          ...applied.operation,
          originalOperationId,
          historyAction: recordedOperation.historyAction,
        },
      ],
      undoStackByActor: {
        ...applied.state.undoStackByActor,
        [actorId]:
          recordedOperation.historyAction === "undo"
            ? undo.slice(0, -1)
            : [...undo, originalOperationId],
      },
      redoStackByActor: {
        ...applied.state.redoStackByActor,
        [actorId]:
          recordedOperation.historyAction === "undo"
            ? [...redo, originalOperationId]
            : redo.slice(0, -1),
      },
    };
  }
  try {
    validateState(next);
  } catch (error) {
    throw new DrawingDraftIntegrityError(errorMessage(error));
  }
  return next;
}

function errorMessage(error: unknown) {
  return error instanceof Error
    ? error.message
    : "Drawing draft update is invalid.";
}

function cloneDocument(document: Y.Doc) {
  const clone = new Y.Doc();
  clone.getMap("serverMeta");
  clone.getArray("operationOrder");
  clone.getArray("operations");
  clone.getMap("operationStatus");
  Y.applyUpdate(clone, Y.encodeStateAsUpdate(document));
  return clone;
}

function entityVersion(state: DrawingDocumentState, entityId: string) {
  const direct = state.objects[entityId] ?? state.layers[entityId];
  if (direct) return direct.version;
  if (!state.structure) return undefined;
  for (const collection of Object.values(state.structure)) {
    if (
      !collection ||
      typeof collection !== "object" ||
      Array.isArray(collection)
    )
      continue;
    const entity = (collection as Record<string, { version?: unknown }>)[
      entityId
    ];
    if (typeof entity?.version === "number") return entity.version;
  }
  return undefined;
}

function hasVersionConflict(
  state: DrawingDocumentState,
  operation: DrawingCollaborationOperation,
) {
  return Object.entries(operation.baseVersions).some(([entityId, version]) => {
    const current = entityVersion(state, entityId);
    if (
      operation.type === "add_layer" &&
      current === undefined &&
      (operation.forward as { layer?: { id?: string; version?: number } }).layer
        ?.id === entityId
    )
      return (
        (operation.forward as { layer: { version: number } }).layer.version !==
        version
      );
    return current !== version;
  });
}

export function createDrawingDraftAdapter(
  options: DrawingDraftAdapterOptions,
): DrawingDraftAdapter {
  const document = options.document;
  let authoritativeState = structuredClone(options.authoritativeState);
  validateState(authoritativeState);
  if (!options.actorId)
    throw new Error("Drawing collaboration actor is required.");
  let authorization = options.authorization;
  let locallyFrozen = options.frozen;
  let disposed = false;
  let baseOperationSequence = options.baseOperationSequence ?? 0;
  const recordedHistory = new Map<string, DrawingRecordedOperation>();
  const listeners = new Set<() => void>();
  const persistenceSynced = Promise.resolve(
    options.localPersistenceSynced,
  ).then(() => undefined);

  function project(candidate: Y.Doc): DrawingDraftSnapshot {
    if (
      !same(
        [...candidate.share.keys()].sort(),
        DRAWING_COLLABORATION_COLLECTIONS,
      )
    )
      throw new Error("Drawing document collections are invalid.");
    const meta = DrawingCollaborationMetaSchema.parse(
      candidate.getMap("serverMeta").toJSON(),
    );
    if (meta.revisionId !== authoritativeState.revisionId)
      throw new Error(
        "Drawing collaboration revision does not match the base state.",
      );
    const projectionBaseOperationSequence = Math.max(
      baseOperationSequence,
      meta.baseOperationSequence,
    );
    const ledger = readDrawingCollaborationLedger(candidate);
    const rawStatuses = candidate.getMap("operationStatus").toJSON();
    const statuses = new Map();
    for (const [operationId, value] of Object.entries(rawStatuses)) {
      const parsed = DrawingCollaborationStatusSchema.parse(value);
      if (parsed.operationId !== operationId || !ledger.operations[operationId])
        throw new Error(
          "Drawing collaboration status is outside its operation ledger.",
        );
      statuses.set(operationId, parsed);
    }

    const acknowledged = ledger.operationOrder
      .map((operationId) => ({
        operationId,
        operation: ledger.operations[operationId],
        status: statuses.get(operationId),
      }))
      .filter(
        (item) =>
          item.status?.status === "acked" &&
          item.status.authoritativeSequence > projectionBaseOperationSequence,
      )
      .sort(
        (left, right) =>
          left.status.authoritativeSequence -
            right.status.authoritativeSequence ||
          left.operationId.localeCompare(right.operationId),
      );
    if (
      new Set(acknowledged.map((item) => item.status.authoritativeSequence))
        .size !== acknowledged.length
    )
      throw new Error(
        "Drawing authoritative operation sequences must be unique.",
      );
    const pending = ledger.operationOrder
      .filter((operationId) => {
        const current = statuses.get(operationId);
        return !current || current.status === "pending";
      })
      .map((operationId) => ({
        operationId,
        operation: ledger.operations[operationId],
      }));

    let state = structuredClone(authoritativeState);
    for (const item of acknowledged)
      state = replay(
        state,
        item.operation,
        item.status.resultVersions,
        recordedHistory.get(item.operationId),
      );
    const provisionalConflictOperationIds: string[] = [];
    for (const item of pending) {
      if (hasVersionConflict(state, item.operation)) {
        provisionalConflictOperationIds.push(item.operationId);
        continue;
      }
      try {
        state = replay(
          state,
          item.operation,
          undefined,
          recordedHistory.get(item.operationId),
        );
      } catch (error) {
        if (error instanceof DrawingDraftIntegrityError) throw error;
        provisionalConflictOperationIds.push(item.operationId);
      }
    }
    validateState(state);
    const idsWith = (wanted: "conflicted" | "rejected") =>
      ledger.operationOrder.filter(
        (operationId) => statuses.get(operationId)?.status === wanted,
      );
    return {
      state,
      pendingOperationIds: pending.map((item) => item.operationId),
      conflictOperationIds: idsWith("conflicted"),
      rejectedOperationIds: idsWith("rejected"),
      provisionalConflictOperationIds,
      authorization,
      frozen: locallyFrozen || meta.freezeState !== "active",
      quarantine: null,
    };
  }

  let snapshot: DrawingDraftSnapshot;
  try {
    snapshot = project(document);
  } catch (error) {
    snapshot = {
      state: structuredClone(authoritativeState),
      pendingOperationIds: [],
      conflictOperationIds: [],
      rejectedOperationIds: [],
      provisionalConflictOperationIds: [],
      authorization,
      frozen: locallyFrozen,
      quarantine: {
        message: errorMessage(error),
        occurredAt: new Date().toISOString(),
      },
    };
  }

  const publish = (next: DrawingDraftSnapshot) => {
    snapshot = next;
    options.replaceProjection?.(next.state);
    for (const listener of listeners) listener();
  };
  const reproject = () => {
    try {
      publish(project(document));
    } catch (error) {
      publish({
        ...snapshot,
        quarantine: {
          message: errorMessage(error),
          occurredAt: new Date().toISOString(),
        },
      });
    }
  };
  const afterTransaction = () => {
    if (!disposed) reproject();
  };
  document.on("afterTransaction", afterTransaction);

  const assertLocalActor = (actorId: string) => {
    if (disposed) throw new Error("Drawing draft adapter is disposed.");
    if (actorId !== options.actorId)
      throw new Error("Drawing command actor does not match the local actor.");
  };
  const assertWritable = (actorId: string) => {
    assertLocalActor(actorId);
    if (
      !drawingCollaborationWritableCapabilities.includes(
        authorization as (typeof drawingCollaborationWritableCapabilities)[number],
      )
    )
      throw new Error("Drawing collaboration capability is read-only.");
    if (snapshot.frozen || locallyFrozen)
      throw new Error("Frozen drawing revisions cannot be edited.");
    if (snapshot.quarantine)
      throw new Error("Quarantined drawing drafts cannot be edited.");
  };

  return {
    getSnapshot: () => snapshot,
    operations: () => {
      if (disposed) return [];
      const ledger = readDrawingCollaborationLedger(document);
      return ledger.operationOrder.map((id) =>
        structuredClone(ledger.operations[id]),
      );
    },
    subscribe(listener) {
      if (disposed) return () => undefined;
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    prepareLocal(command) {
      assertWritable(command.actorId);
      const applied = applyDrawingCommand(snapshot.state, command, options);
      const operation = envelopeFor(applied.operation);
      return { operation, state: applied.state };
    },
    preparePersistedLocal(input) {
      const operation = DrawingCollaborationOperationSchema.parse(input);
      assertLocalActor(operation.actorId);
      return { operation, state: snapshot.state };
    },
    prepareRecordedLocal(recordedOperation) {
      assertWritable(recordedOperation.actorId);
      return {
        operation: envelopeFor(recordedOperation),
        state: snapshot.state,
        recordedOperation,
      };
    },
    appendDurableLocal(prepared) {
      const operation = DrawingCollaborationOperationSchema.parse(
        prepared.operation,
      );
      assertLocalActor(operation.actorId);
      const ledger = readDrawingCollaborationLedger(document);
      const existing = ledger.operations[operation.clientOperationId];
      if (existing !== undefined) {
        if (!same(existing, operation))
          throw new Error(
            "Drawing operation ID already has different content.",
          );
        return false;
      }
      if (prepared.recordedOperation?.historyAction)
        recordedHistory.set(
          operation.clientOperationId,
          structuredClone(prepared.recordedOperation),
        );
      try {
        document.transact(() => {
          appendDrawingCollaborationOperation(document, operation);
        });
      } catch (error) {
        recordedHistory.delete(operation.clientOperationId);
        throw error;
      }
      return true;
    },
    applyServerProjection(update) {
      if (disposed) return false;
      const candidate = cloneDocument(document);
      try {
        Y.applyUpdate(candidate, update);
        project(candidate);
      } catch (error) {
        publish({
          ...snapshot,
          quarantine: {
            message: errorMessage(error),
            occurredAt: new Date().toISOString(),
          },
        });
        candidate.destroy();
        return false;
      }
      candidate.destroy();
      Y.applyUpdate(document, update, DRAWING_COLLABORATION_SERVER_ORIGIN);
      return true;
    },
    replaceAuthoritative(state, next = {}) {
      if (disposed) return;
      validateState(state);
      if (state.revisionId !== authoritativeState.revisionId)
        throw new Error(
          "Authoritative drawing revision cannot change in-place.",
        );
      authoritativeState = structuredClone(state);
      if (next.baseOperationSequence !== undefined)
        baseOperationSequence = next.baseOperationSequence;
      reproject();
    },
    setAuthorization(capability) {
      if (disposed || capability === authorization) return;
      authorization = capability;
      reproject();
    },
    setFrozen(frozen) {
      if (disposed || frozen === locallyFrozen) return;
      locallyFrozen = frozen;
      reproject();
    },
    whenLocalPersistenceSynced: () => persistenceSynced,
    dispose() {
      if (disposed) return;
      disposed = true;
      document.off("afterTransaction", afterTransaction);
      listeners.clear();
    },
  };
}
