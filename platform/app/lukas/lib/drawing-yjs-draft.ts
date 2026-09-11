import * as Y from "yjs";

import {
  applyDrawingCommand,
  applyDrawingCommandForReplay,
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
  drawingCollaborationOperationDigestSource,
  drawingCollaborationWritableCapabilities,
  type DrawingCollaborationMeta,
  type DrawingCollaborationOperation,
} from "./drawing-collaboration-protocol.ts";
import {
  appendDrawingCollaborationOperation,
  readDrawingCollaborationLedger,
} from "./drawing-collaboration-yjs.ts";
import { validateDrawingStructureState } from "./drawing-structure.ts";
import {
  isValidatedDrawingDocumentState,
  type DrawingValidatedDocumentState,
} from "./drawing-document-store.ts";
import type { DrawingWorkspaceCapability } from "./drawing-workspace.server.ts";
import {
  DrawingHistoryGroupSchema,
  DrawingLayerSchema,
  DrawingObjectSchema,
  type DrawingStructureAction,
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
};

export type DrawingLocalAcknowledgement = {
  clientOperationId: string;
  authoritativeSequence: number;
  resultVersions: Record<string, number | null>;
};

export type DrawingCanonicalRecentOutcome = {
  revisionId: string;
  clientOperationId: string;
  actorId: string;
  sequence: number;
  resultVersions: Record<string, number | null>;
  operationSha256: string;
};

type DrawingAuthoritativeReplacementOptions = {
  baseOperationSequence?: number;
  recentOutcomes?: readonly DrawingCanonicalRecentOutcome[];
};

export type DrawingDraftAdapter = {
  getSnapshot(): DrawingDraftSnapshot;
  operations(): DrawingCollaborationOperation[];
  operationStatus(
    clientOperationId: string,
  ): ReturnType<typeof DrawingCollaborationStatusSchema.parse> | null;
  subscribe(listener: () => void): () => void;
  prepareLocal(command: DrawingCommand): PreparedDrawingDraft;
  preparePersistedLocal(
    operation: DrawingCollaborationOperation,
  ): PreparedDrawingDraft;
  prepareRecordedLocal(
    operation: DrawingRecordedOperation,
  ): PreparedDrawingDraft;
  appendDurableLocal(prepared: PreparedDrawingDraft): boolean;
  hydrateCanonicalHistory(state: DrawingDocumentState): boolean;
  recordLocalAcknowledgement(
    acknowledgement: DrawingLocalAcknowledgement,
    authority?: "canonical",
  ): boolean;
  isOperationCheckpointAcknowledged(
    clientOperationId: string,
    checkpoint: number,
  ): boolean;
  applyServerProjection(update: Uint8Array): boolean;
  replaceAuthoritative(
    state: DrawingDocumentState,
    options?: DrawingAuthoritativeReplacementOptions,
  ): void | Promise<void>;
  setAuthorization(capability: DrawingWorkspaceCapability): void;
  setFrozen(frozen: boolean): void;
  whenLocalPersistenceSynced(): Promise<void>;
  dispose(): void;
};

type DrawingDraftAdapterOptions = DrawingCommandEnvironment & {
  document: Y.Doc;
  authoritativeState: DrawingDocumentState;
  validatedAuthoritativeState?: DrawingValidatedDocumentState | null;
  actorId: string;
  authorization: DrawingWorkspaceCapability;
  frozen: boolean;
  enforceServerFreeze?: boolean;
  baseOperationSequence?: number;
  localPersistenceSynced?: Promise<unknown>;
  localBaseMeta?: DrawingCollaborationMeta;
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

function preserveCanonicalStructureMaps(
  state: DrawingDocumentState,
): DrawingDocumentState {
  if (!state.structure) return state;
  return {
    ...state,
    objects: state.structure.objects,
    layers: state.structure.layers,
  };
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
    ...(operation.originalOperationId && operation.historyAction
      ? {
          originalOperationId: operation.originalOperationId,
          historyAction: operation.historyAction,
        }
      : {}),
  });
}

const MAX_CANONICAL_DXF_HISTORY_OPERATIONS = 48;

type CanonicalDxfHistory = {
  actorId: string;
  revisionId: string;
  groupId: string;
  kind: "dxf_import" | "dwg_import";
  count: number;
  recoveredOperations: DrawingRecordedOperation[];
};

function stateGraph(state: DrawingDocumentState) {
  const {
    operations: _operations,
    undoStackByActor: _undo,
    redoStackByActor: _redo,
    ...graph
  } = state;
  return graph;
}

function canonicalCheckpointGraph(state: DrawingDocumentState) {
  const graph = stateGraph(state);
  if (!graph.structure) return graph;
  const { tombstones: _tombstones, ...structure } = graph.structure;
  return { ...graph, structure };
}

function sameCanonicalCheckpointGraph(
  checkpoint: DrawingDocumentState,
  expected: DrawingDocumentState,
) {
  const checkpointIncludesTombstones = Boolean(
    checkpoint.structure && Object.hasOwn(checkpoint.structure, "tombstones"),
  );
  return same(
    checkpointIncludesTombstones
      ? stateGraph(checkpoint)
      : canonicalCheckpointGraph(checkpoint),
    checkpointIncludesTombstones
      ? stateGraph(expected)
      : canonicalCheckpointGraph(expected),
  );
}

function canonicalDxfGroup(operation: DrawingRecordedOperation) {
  const forward = DrawingHistoryGroupSchema.safeParse(
    (operation.forward as { historyGroup?: unknown }).historyGroup,
  );
  const inverse = DrawingHistoryGroupSchema.safeParse(
    (operation.inverse as { historyGroup?: unknown }).historyGroup,
  );
  return forward.success && inverse.success && same(forward.data, inverse.data)
    ? forward.data
    : null;
}

const canonicalDxfCollectionForAction = {
  put_object: "objects",
  delete_object: "objects",
  put_source: "sources",
  delete_source: "sources",
  put_page: "pages",
  delete_page: "pages",
  put_canvas: "canvases",
  delete_canvas: "canvases",
  put_layer: "layers",
  delete_layer: "layers",
  put_style: "styles",
  delete_style: "styles",
  put_block: "blocks",
  delete_block: "blocks",
  put_block_instance: "blockInstances",
  delete_block_instance: "blockInstances",
  put_property_schema: "propertySchemas",
  delete_property_schema: "propertySchemas",
  put_property_value: "propertyValues",
  delete_property_value: "propertyValues",
  put_table: "tables",
  delete_table: "tables",
} as const satisfies Record<DrawingStructureAction["kind"], string>;

function assertCanonicalDxfHistorySemantics(
  state: DrawingDocumentState,
  operations: DrawingRecordedOperation[],
) {
  if (!state.structure)
    throw new DrawingDraftIntegrityError(
      "Canonical DXF history requires drawing structure state; native DWG history uses the same invariant.",
    );
  const createdEntityCollections = new Map<string, string>();
  const materializedEntities = new Map<
    string,
    { version: number; [key: string]: unknown }
  >();
  for (const operation of operations) {
    const forward = (operation.forward as { actions: DrawingStructureAction[] })
      .actions;
    const inverse = (operation.inverse as { actions: DrawingStructureAction[] })
      .actions;
    const inverseById = new Map<string, DrawingStructureAction>();
    for (const action of inverse) {
      const entityId = "entity" in action ? action.entity.id : action.id;
      if (inverseById.has(entityId))
        throw new DrawingDraftIntegrityError(
          "Canonical DXF history inverse is ambiguous; native DWG history uses the same invariant.",
        );
      inverseById.set(entityId, action);
    }
    if (inverseById.size !== forward.length)
      throw new DrawingDraftIntegrityError(
        "Canonical DXF history inverse is incomplete; native DWG history uses the same invariant.",
      );
    for (const action of forward) {
      const entityId = "entity" in action ? action.entity.id : action.id;
      const collection = canonicalDxfCollectionForAction[action.kind];
      const createdCollection = createdEntityCollections.get(entityId);
      const previous = materializedEntities.get(entityId);
      const inverseAction = inverseById.get(entityId);
      const resultVersion = operation.resultVersions[entityId];
      const creates = "entity" in action && action.baseVersion === null;
      const expectedInverseKind = (
        "entity" in action
          ? creates
            ? action.kind.replace("put_", "delete_")
            : action.kind
          : action.kind.replace("delete_", "put_")
      ) as DrawingStructureAction["kind"];
      if (
        (createdCollection !== undefined && createdCollection !== collection) ||
        (!creates && (!createdCollection || !previous)) ||
        (creates && previous) ||
        !inverseAction ||
        inverseAction.kind !== expectedInverseKind ||
        canonicalDxfCollectionForAction[inverseAction.kind] !== collection ||
        ("entity" in action
          ? creates
            ? "entity" in inverseAction ||
              typeof resultVersion !== "number" ||
              inverseAction.baseVersion !== resultVersion
            : !previous ||
              !("entity" in inverseAction) ||
              typeof resultVersion !== "number" ||
              action.baseVersion !== previous.version ||
              inverseAction.baseVersion !== resultVersion ||
              !same(inverseAction.entity, previous)
          : !previous ||
            !("entity" in inverseAction) ||
            action.baseVersion !== previous.version ||
            inverseAction.baseVersion !== null ||
            !same(inverseAction.entity, previous) ||
            resultVersion !== null)
      )
        throw new DrawingDraftIntegrityError(
          "Canonical DXF history inverse does not match its forward action; native DWG history uses the same invariant.",
        );
      if (creates && createdCollection === undefined)
        createdEntityCollections.set(entityId, collection);
      if ("entity" in action) {
        if (typeof resultVersion !== "number")
          throw new DrawingDraftIntegrityError(
            "Canonical DXF history result version is invalid; native DWG history uses the same invariant.",
          );
        materializedEntities.set(entityId, {
          ...structuredClone(action.entity),
          version: resultVersion,
        });
      } else materializedEntities.delete(entityId);
    }
  }

  let base = structuredClone(state);
  const baseStructure = base.structure;
  if (!baseStructure)
    throw new DrawingDraftIntegrityError(
      "Canonical DXF history requires drawing structure state; native DWG history uses the same invariant.",
    );
  const structure = baseStructure as unknown as Record<
    string,
    Record<string, unknown>
  >;
  for (const [entityId, collection] of createdEntityCollections) {
    delete structure[collection][entityId];
    delete baseStructure.tombstones?.[entityId];
  }
  base = preserveCanonicalStructureMaps({
    ...base,
    operations: [],
    undoStackByActor: {},
    redoStackByActor: {},
  });
  let reproduced = base;
  for (const operation of operations)
    reproduced = replay(
      reproduced,
      envelopeFor(operation),
      operation.resultVersions,
    );
  if (
    !same(stateGraph(reproduced), stateGraph(state)) ||
    !same(reproduced.undoStackByActor, state.undoStackByActor) ||
    !same(reproduced.redoStackByActor, state.redoStackByActor)
  )
    throw new DrawingDraftIntegrityError(
      "Canonical DXF history does not reproduce its drawing state; native DWG history uses the same invariant.",
    );
}

function assertCanonicalDxfHistory(
  state: DrawingDocumentState,
  actorId: string,
) {
  const operations = state.operations;
  const anchor = operations[0] ? canonicalDxfGroup(operations[0]) : null;
  if (
    operations.length < 1 ||
    operations.length > MAX_CANONICAL_DXF_HISTORY_OPERATIONS ||
    !anchor ||
    anchor.index !== 0 ||
    anchor.count < operations.length ||
    anchor.count > MAX_CANONICAL_DXF_HISTORY_OPERATIONS ||
    new Set(operations.map((operation) => operation.clientOperationId)).size !==
      operations.length
  )
    throw new DrawingDraftIntegrityError(
      "Canonical DXF history operation bounds are invalid; native DWG history uses the same invariant.",
    );
  const groupId = anchor.id;
  for (const [index, operation] of operations.entries()) {
    const group = canonicalDxfGroup(operation);
    if (
      operation.actorId !== actorId ||
      operation.revisionId !== state.revisionId ||
      operation.type !== "mutate_structure" ||
      !operation.undoable ||
      operation.originalOperationId !== undefined ||
      operation.historyAction !== undefined ||
      !group ||
      group.kind !== anchor.kind ||
      group.id !== groupId ||
      group.index !== index ||
      group.count !== anchor.count
    )
      throw new DrawingDraftIntegrityError(
        "Canonical DXF history is incomplete or inconsistent; native DWG history uses the same invariant.",
      );
    envelopeFor(operation);
  }
  const operationIds = operations.map(
    (operation) => operation.clientOperationId,
  );
  if (
    !same(state.undoStackByActor[actorId] ?? [], operationIds) ||
    Object.entries(state.undoStackByActor).some(
      ([stackActor, stack]) => stackActor !== actorId && stack.length > 0,
    ) ||
    Object.values(state.redoStackByActor).some((stack) => stack.length > 0)
  )
    throw new DrawingDraftIntegrityError(
      "Canonical DXF history stacks are invalid; native DWG history uses the same invariant.",
    );
  assertCanonicalDxfHistorySemantics(state, operations);
  return {
    actorId,
    revisionId: state.revisionId,
    groupId,
    kind: anchor.kind,
    count: anchor.count,
    recoveredOperations: structuredClone(operations),
  } satisfies CanonicalDxfHistory;
}

function canonicalDxfHistoryFromState(
  state: DrawingDocumentState,
  actorId: string,
) {
  const anchor = state.operations[0]
    ? canonicalDxfGroup(state.operations[0])
    : null;
  if (!anchor || anchor.index !== 0) return null;
  try {
    return assertCanonicalDxfHistory(state, actorId);
  } catch {
    return null;
  }
}

function isCanonicalDxfHistoryProgression(
  state: DrawingDocumentState,
  history: CanonicalDxfHistory,
) {
  const operations = state.operations;
  const firstHistoryIndex = operations.findIndex(
    (operation) =>
      operation.originalOperationId !== undefined ||
      operation.historyAction !== undefined,
  );
  const originalCount =
    firstHistoryIndex < 0 ? operations.length : firstHistoryIndex;
  if (
    state.revisionId !== history.revisionId ||
    originalCount < history.recoveredOperations.length ||
    originalCount > history.count ||
    (firstHistoryIndex >= 0 && originalCount !== history.count) ||
    new Set(operations.map((operation) => operation.clientOperationId)).size !==
      operations.length
  )
    return false;

  const originals = operations.slice(0, originalCount);
  for (const [index, operation] of originals.entries()) {
    const group = canonicalDxfGroup(operation);
    if (
      operation.actorId !== history.actorId ||
      operation.revisionId !== history.revisionId ||
      operation.type !== "mutate_structure" ||
      !operation.undoable ||
      operation.originalOperationId !== undefined ||
      operation.historyAction !== undefined ||
      !group ||
      group.kind !== history.kind ||
      group.id !== history.groupId ||
      group.index !== index ||
      group.count !== history.count ||
      (index < history.recoveredOperations.length &&
        !same(operation, history.recoveredOperations[index]))
    )
      return false;
    try {
      envelopeFor(operation);
    } catch {
      return false;
    }
  }

  const originalsById = new Map(
    originals.map((operation, index) => [operation.clientOperationId, index]),
  );
  const undo = originals.map((operation) => operation.clientOperationId);
  const redo: string[] = [];
  for (const operation of operations.slice(originalCount)) {
    const originalOperationId = operation.originalOperationId;
    const originalIndex = originalOperationId
      ? originalsById.get(originalOperationId)
      : undefined;
    const group = canonicalDxfGroup(operation);
    if (
      !originalOperationId ||
      originalIndex === undefined ||
      operation.actorId !== history.actorId ||
      operation.revisionId !== history.revisionId ||
      operation.type !== "mutate_structure" ||
      !operation.historyAction ||
      !group ||
      group.kind !== history.kind ||
      group.id !== history.groupId ||
      group.index !== originalIndex ||
      group.count !== history.count
    )
      return false;
    const from = operation.historyAction === "undo" ? undo : redo;
    const to = operation.historyAction === "undo" ? redo : undo;
    if (from.at(-1) !== originalOperationId) return false;
    from.pop();
    to.push(originalOperationId);
    try {
      envelopeFor(operation);
    } catch {
      return false;
    }
  }

  return (
    same(state.undoStackByActor[history.actorId] ?? [], undo) &&
    same(state.redoStackByActor[history.actorId] ?? [], redo) &&
    Object.entries(state.undoStackByActor).every(
      ([actorId, stack]) => actorId === history.actorId || stack.length === 0,
    ) &&
    Object.entries(state.redoStackByActor).every(
      ([actorId, stack]) => actorId === history.actorId || stack.length === 0,
    )
  );
}

function preserveCanonicalDxfHistory(
  checkpoint: DrawingDocumentState,
  current: DrawingDocumentState,
) {
  let preserved: DrawingDocumentState = {
    ...structuredClone(checkpoint),
    operations: structuredClone(current.operations),
    undoStackByActor: structuredClone(current.undoStackByActor),
    redoStackByActor: structuredClone(current.redoStackByActor),
  };
  if (preserved.structure && current.structure) {
    const structure = { ...preserved.structure };
    if (Object.hasOwn(current.structure, "tombstones"))
      structure.tombstones = structuredClone(current.structure.tombstones);
    else delete structure.tombstones;
    preserved = preserveCanonicalStructureMaps({ ...preserved, structure });
  }
  return preserved;
}

function commandFor(operation: DrawingCollaborationOperation): DrawingCommand {
  return {
    ...(operation.forward as Omit<DrawingCommand, "actorId">),
    actorId: operation.actorId,
  } as DrawingCommand;
}

class DrawingDraftIntegrityError extends Error {}

const MAX_CANONICAL_RECENT_OUTCOMES = 256;

const canonicalRecentOutcomeKeys = [
  "actorId",
  "clientOperationId",
  "operationSha256",
  "resultVersions",
  "revisionId",
  "sequence",
] as const;

function validateCanonicalRecentOutcomes(
  outcomes: readonly DrawingCanonicalRecentOutcome[],
  revisionId: string,
  checkpointSequence: number,
) {
  if (
    outcomes.length > MAX_CANONICAL_RECENT_OUTCOMES ||
    new Set(outcomes.map((outcome) => outcome.clientOperationId)).size !==
      outcomes.length ||
    new Set(outcomes.map((outcome) => outcome.sequence)).size !==
      outcomes.length
  )
    throw new DrawingDraftIntegrityError(
      "Canonical drawing checkpoint outcomes are invalid.",
    );
  const validated = [];
  for (const [index, outcome] of outcomes.entries()) {
    if (
      outcome.revisionId !== revisionId ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
        outcome.actorId,
      ) ||
      !Number.isSafeInteger(outcome.sequence) ||
      outcome.sequence < 1 ||
      outcome.sequence > checkpointSequence ||
      (index > 0 && outcomes[index - 1].sequence >= outcome.sequence) ||
      !same(
        Object.keys(outcome).sort(),
        [...canonicalRecentOutcomeKeys].sort(),
      ) ||
      !/^[0-9a-f]{64}$/.test(outcome.operationSha256)
    )
      throw new DrawingDraftIntegrityError(
        "Canonical drawing checkpoint outcome boundary is invalid.",
      );
    let acknowledgement;
    try {
      acknowledgement = DrawingCollaborationStatusSchema.parse({
        operationId: outcome.clientOperationId,
        status: "acked",
        authoritativeSequence: outcome.sequence,
        resultVersions: outcome.resultVersions,
      });
    } catch {
      throw new DrawingDraftIntegrityError(
        "Canonical drawing checkpoint outcome digest or result is invalid.",
      );
    }
    validated.push({ acknowledgement, outcome });
  }
  return validated;
}

function replay(
  state: DrawingDocumentState,
  operation: DrawingCollaborationOperation,
  authoritativeResultVersions?: Record<string, number | null>,
): DrawingDocumentState {
  const applied = applyDrawingCommandForReplay(
    state,
    commandFor(operation),
    {
      createId: () => operation.clientOperationId,
      now: () => operation.createdAt,
    },
    {
      originalOperationId: operation.originalOperationId,
      historyAction: operation.historyAction,
    },
    operation.baseVersions,
  );
  const reproduced = envelopeFor({
    ...applied.operation,
    originalOperationId: operation.originalOperationId,
    historyAction: operation.historyAction,
  });
  if (!same(reproduced, operation))
    throw new DrawingDraftIntegrityError(
      "Drawing operation does not reproduce its canonical command.",
    );
  if (
    authoritativeResultVersions &&
    !same(applied.operation.resultVersions, authoritativeResultVersions)
  )
    throw new DrawingDraftIntegrityError(
      "Drawing operation result versions are not authoritative.",
    );
  let next = applied.state;
  if (operation.historyAction && operation.originalOperationId) {
    const actorId = operation.actorId;
    const originalOperationId = operation.originalOperationId;
    const undo = [...(state.undoStackByActor[actorId] ?? [])];
    const redo = [...(state.redoStackByActor[actorId] ?? [])];
    const expectedOriginal =
      operation.historyAction === "undo" ? undo.at(-1) : redo.at(-1);
    if (expectedOriginal !== originalOperationId)
      throw new DrawingDraftIntegrityError(
        "Drawing history operation does not match the actor stack.",
      );
    next = {
      ...applied.state,
      operations: [
        ...applied.state.operations.slice(0, -1),
        {
          ...applied.operation,
          originalOperationId,
          historyAction: operation.historyAction,
        },
      ],
      undoStackByActor: {
        ...applied.state.undoStackByActor,
        [actorId]:
          operation.historyAction === "undo"
            ? undo.slice(0, -1)
            : [...undo, originalOperationId],
      },
      redoStackByActor: {
        ...applied.state.redoStackByActor,
        [actorId]:
          operation.historyAction === "undo"
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
  const forward = operation.forward as { type?: string; objectAction?: string };
  const restoresDeletedObjects =
    Boolean(operation.historyAction) &&
    (forward.type === "add_objects" ||
      (forward.type === "mutate_objects_with_references" &&
        forward.objectAction === "restore"));
  return Object.entries(operation.baseVersions).some(([entityId, version]) => {
    const current =
      entityVersion(state, entityId) ??
      (restoresDeletedObjects
        ? [...state.operations]
            .reverse()
            .find(
              (candidate) => candidate.realizedVersions[entityId] !== undefined,
            )?.realizedVersions[entityId]
        : undefined);
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

type CollaborationStatusEvidence = {
  status: "pending" | "acked" | "conflicted" | "rejected";
  authoritativeSequence: number | null;
  resultVersions: Record<string, number | null>;
};

type CollaborationAcknowledgementEvidence = CollaborationStatusEvidence & {
  operationId: string;
};

type DeferredCanonicalCheckpoint = {
  baseState: DrawingDocumentState;
  baseOperationSequence: number;
  canonicalHistory: CanonicalDxfHistory | null;
  checkpoint: DrawingDocumentState;
  receipts: Array<{
    acknowledgement: CollaborationAcknowledgementEvidence;
    outcome: DrawingCanonicalRecentOutcome;
  }>;
  installedAcknowledgementIds: string[];
  missingOperationIds: string[];
};

function restoreCompactedObjectHistory(
  state: DrawingDocumentState,
  pending: DrawingCollaborationOperation,
  operationOrder: string[],
  operations: Record<string, DrawingCollaborationOperation>,
  statuses: Map<string, CollaborationStatusEvidence>,
  baseOperationSequence: number,
) {
  if (
    pending.type !== "add_objects" ||
    pending.historyAction !== "redo" ||
    !pending.originalOperationId
  )
    return null;
  const original = operations[pending.originalOperationId];
  const originalStatus = statuses.get(pending.originalOperationId);
  if (
    !original ||
    !originalStatus ||
    originalStatus.status !== "acked" ||
    originalStatus.authoritativeSequence === null ||
    originalStatus.authoritativeSequence > baseOperationSequence ||
    original.type !== "add_objects" ||
    original.historyAction ||
    original.actorId !== pending.actorId
  )
    return null;
  const lineage = operationOrder
    .map((operationId) => ({
      operation: operations[operationId],
      status: statuses.get(operationId),
    }))
    .filter(
      (
        item,
      ): item is {
        operation: DrawingCollaborationOperation;
        status: CollaborationStatusEvidence & {
          status: "acked";
          authoritativeSequence: number;
        };
      } =>
        item.operation?.originalOperationId === pending.originalOperationId &&
        item.status?.status === "acked" &&
        item.status.authoritativeSequence !== null &&
        item.status.authoritativeSequence <= baseOperationSequence,
    )
    .sort(
      (left, right) =>
        left.status.authoritativeSequence - right.status.authoritativeSequence,
    );
  const undo = lineage.at(-1);
  if (
    !undo ||
    originalStatus.authoritativeSequence >= undo.status.authoritativeSequence ||
    undo.operation.type !== "delete_objects" ||
    undo.operation.historyAction !== "undo" ||
    undo.operation.actorId !== pending.actorId ||
    !same(original.inverse, undo.operation.forward) ||
    !same(undo.operation.forward, pending.inverse) ||
    !same(undo.operation.inverse, pending.forward)
  )
    return null;
  try {
    let proof = replay(state, original, originalStatus.resultVersions);
    proof = replay(proof, undo.operation, undo.status.resultVersions);
    const restored = (pending.forward as { objects?: Array<{ id?: string }> })
      .objects;
    if (
      !Array.isArray(restored) ||
      restored.some((object) => !object.id || proof.objects[object.id])
    )
      return null;
    return {
      ...state,
      operations: proof.operations,
      undoStackByActor: proof.undoStackByActor,
      redoStackByActor: proof.redoStackByActor,
    };
  } catch {
    return null;
  }
}

export function createDrawingDraftAdapter(
  options: DrawingDraftAdapterOptions,
): DrawingDraftAdapter {
  const document = options.document;
  const validatedAuthoritativeState = options.validatedAuthoritativeState;
  if (
    validatedAuthoritativeState &&
    (!isValidatedDrawingDocumentState(validatedAuthoritativeState) ||
      validatedAuthoritativeState.state !== options.authoritativeState)
  )
    throw new Error("Drawing authoritative state proof is invalid.");
  let authoritativeState = validatedAuthoritativeState
    ? validatedAuthoritativeState.state
    : structuredClone(options.authoritativeState);
  if (!validatedAuthoritativeState) validateState(authoritativeState);
  if (!options.actorId)
    throw new Error("Drawing collaboration actor is required.");
  let authorization = options.authorization;
  let locallyFrozen = options.frozen;
  let disposed = false;
  let baseOperationSequence = options.baseOperationSequence ?? 0;
  let canonicalDxfHistory: CanonicalDxfHistory | null = null;
  const localAcknowledgements = new Map<
    string,
    CollaborationAcknowledgementEvidence
  >();
  const canonicalLocalAcknowledgementIds = new Set<string>();
  const checkpointAbsorbsLocalAcknowledgement = (
    server: CollaborationStatusEvidence,
    acknowledgement: CollaborationAcknowledgementEvidence,
    boundary = baseOperationSequence,
  ) =>
    server.status === "acked" &&
    server.authoritativeSequence !== null &&
    acknowledgement.authoritativeSequence !== null &&
    server.authoritativeSequence <= boundary &&
    acknowledgement.authoritativeSequence <= boundary;
  const acceptsLocalAcknowledgement = (
    operationId: string,
    server: CollaborationStatusEvidence,
    acknowledgement: CollaborationAcknowledgementEvidence,
  ) =>
    same(server, acknowledgement) ||
    (server.status === "pending" &&
      canonicalLocalAcknowledgementIds.has(operationId)) ||
    checkpointAbsorbsLocalAcknowledgement(server, acknowledgement);
  let deferredCanonicalCheckpoint: DeferredCanonicalCheckpoint | null = null;
  let deferredCanonicalVerification = Promise.resolve();
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
    const serverMeta = candidate.getMap("serverMeta").toJSON();
    const meta = DrawingCollaborationMetaSchema.parse(
      Object.keys(serverMeta).length === 0 ? options.localBaseMeta : serverMeta,
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
    const deferredAcknowledgements = new Map(
      deferredCanonicalCheckpoint?.receipts
        .filter(({ outcome }) =>
          deferredCanonicalCheckpoint?.missingOperationIds.includes(
            outcome.clientOperationId,
          ),
        )
        .map(({ acknowledgement }) => [
          acknowledgement.operationId,
          acknowledgement,
        ]) ?? [],
    );
    const statuses = new Map();
    for (const [operationId, value] of Object.entries(rawStatuses)) {
      const parsed = DrawingCollaborationStatusSchema.parse(value);
      const deferred = deferredAcknowledgements.get(operationId);
      if (
        parsed.operationId !== operationId ||
        (deferred && !same(parsed, deferred)) ||
        (!ledger.operations[operationId] && !deferred)
      )
        throw new Error(
          "Drawing collaboration status is outside its operation ledger.",
        );
      statuses.set(operationId, parsed);
    }
    for (const [operationId, acknowledgement] of localAcknowledgements) {
      if (!ledger.operations[operationId])
        throw new Error(
          "Drawing local acknowledgement is outside its operation ledger.",
        );
      const existing = statuses.get(operationId);
      if (
        existing &&
        !acceptsLocalAcknowledgement(operationId, existing, acknowledgement)
      )
        throw new Error(
          "Drawing local acknowledgement conflicts with server status.",
        );
      if (
        existing &&
        checkpointAbsorbsLocalAcknowledgement(existing, acknowledgement)
      )
        continue;
      statuses.set(operationId, acknowledgement);
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
        return (
          !deferredAcknowledgements.has(operationId) &&
          (!current || current.status === "pending")
        );
      })
      .map((operationId) => ({
        operationId,
        operation: ledger.operations[operationId],
      }));

    const freshEmptyLedger =
      ledger.operationOrder.length === 0 && statuses.size === 0;
    let state = freshEmptyLedger
      ? authoritativeState
      : structuredClone(authoritativeState);
    for (const item of acknowledged)
      state = replay(state, item.operation, item.status.resultVersions);
    const provisionalConflictOperationIds: string[] = [];
    for (const item of pending) {
      let replayBase = state;
      if (hasVersionConflict(state, item.operation)) {
        const restoredHistory = restoreCompactedObjectHistory(
          state,
          item.operation,
          ledger.operationOrder,
          ledger.operations,
          statuses,
          projectionBaseOperationSequence,
        );
        if (!restoredHistory) {
          provisionalConflictOperationIds.push(item.operationId);
          continue;
        }
        replayBase = restoredHistory;
      }
      try {
        state = replay(replayBase, item.operation);
      } catch (error) {
        if (error instanceof DrawingDraftIntegrityError) throw error;
        provisionalConflictOperationIds.push(item.operationId);
      }
    }
    if (!freshEmptyLedger) {
      state = preserveCanonicalStructureMaps(state);
      validateState(state);
    }
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
      frozen:
        locallyFrozen ||
        (options.enforceServerFreeze !== false &&
          meta.freezeState !== "active" &&
          meta.freezeState !== "released"),
      quarantine: null,
    };
  }

  let snapshot: DrawingDraftSnapshot;
  try {
    snapshot = project(document);
  } catch (error) {
    snapshot = {
      state: authoritativeState,
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
  if (!snapshot.quarantine)
    canonicalDxfHistory = canonicalDxfHistoryFromState(
      snapshot.state,
      options.actorId,
    );

  const publish = (next: DrawingDraftSnapshot) => {
    const nextCanonicalDxfHistory =
      canonicalDxfHistory || next.quarantine
        ? canonicalDxfHistory
        : canonicalDxfHistoryFromState(next.state, options.actorId);
    options.replaceProjection?.(next.state);
    canonicalDxfHistory = nextCanonicalDxfHistory;
    snapshot = next;
    for (const listener of listeners) {
      try {
        listener();
      } catch {
        // A subscriber cannot veto an already committed projection.
      }
    }
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
    if (!disposed) {
      reproject();
      scheduleDeferredCanonicalVerification();
    }
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

  const canonicalHistoryAtCheckpoint = (checkpointSequence: number) => {
    if (!canonicalDxfHistory || checkpointSequence < baseOperationSequence)
      return null;
    try {
      const ledger = readDrawingCollaborationLedger(document);
      const statuses = new Map<string, CollaborationStatusEvidence>();
      for (const [operationId, value] of Object.entries(
        document.getMap("operationStatus").toJSON(),
      )) {
        const status = DrawingCollaborationStatusSchema.parse(value);
        if (
          status.operationId !== operationId ||
          !ledger.operations[operationId]
        )
          return null;
        statuses.set(operationId, status);
      }
      for (const [operationId, acknowledgement] of localAcknowledgements) {
        const current = statuses.get(operationId);
        if (
          current &&
          !acceptsLocalAcknowledgement(operationId, current, acknowledgement)
        )
          return null;
        statuses.set(operationId, acknowledgement);
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
            item.status.authoritativeSequence !== null &&
            item.status.authoritativeSequence > baseOperationSequence &&
            item.status.authoritativeSequence <= checkpointSequence,
        )
        .sort(
          (left, right) =>
            left.status!.authoritativeSequence! -
              right.status!.authoritativeSequence! ||
            left.operationId.localeCompare(right.operationId),
        );
      if (
        new Set(acknowledged.map((item) => item.status!.authoritativeSequence))
          .size !== acknowledged.length
      )
        return null;
      let boundary = structuredClone(authoritativeState);
      for (const item of acknowledged)
        boundary = replay(
          boundary,
          item.operation,
          item.status!.resultVersions,
        );
      boundary = preserveCanonicalStructureMaps(boundary);
      validateState(boundary);
      return isCanonicalDxfHistoryProgression(boundary, canonicalDxfHistory)
        ? boundary
        : null;
    } catch {
      return null;
    }
  };

  const assertCanonicalOutcomeDigest = async (
    local: DrawingCollaborationOperation,
    outcome: DrawingCanonicalRecentOutcome,
  ) => {
    if (outcome.actorId !== local.actorId)
      throw new DrawingDraftIntegrityError(
        "Canonical drawing checkpoint receipt does not match local history.",
      );
    if (!globalThis.crypto?.subtle)
      throw new DrawingDraftIntegrityError("SHA-256 is unavailable.");
    const bytes = new TextEncoder().encode(
      drawingCollaborationOperationDigestSource(local, outcome.actorId),
    );
    const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
    const actual = Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");
    if (actual !== outcome.operationSha256)
      throw new DrawingDraftIntegrityError(
        "Canonical drawing checkpoint receipt digest does not match local history.",
      );
  };

  const verifiedCanonicalCheckpointAcknowledgements = async (
    outcomes: readonly DrawingCanonicalRecentOutcome[],
    checkpointSequence: number,
    checkpoint: DrawingDocumentState,
    allowLateReceiptRetry = true,
  ) => {
    const history = canonicalDxfHistory;
    const capturedSnapshot = snapshot;
    const capturedBaseSequence = baseOperationSequence;
    const capturedMeta = document.getMap("serverMeta").toJSON();
    const capturedStatuses = document.getMap("operationStatus").toJSON();
    const capturedLocalAcknowledgements = [...localAcknowledgements];
    const capturedAuthorization = authorization;
    const capturedFrozen = locallyFrozen;
    const validated = validateCanonicalRecentOutcomes(
      outcomes,
      authoritativeState.revisionId,
      checkpointSequence,
    );
    const ledger = readDrawingCollaborationLedger(document);
    const recorded = new Map(
      snapshot.state.operations.map((operation) => [
        operation.clientOperationId,
        operation,
      ]),
    );
    const matched: Array<{
      acknowledgement: CollaborationAcknowledgementEvidence;
      local: DrawingCollaborationOperation;
    }> = [];
    const unseen: Array<{
      acknowledgement: CollaborationAcknowledgementEvidence;
      outcome: DrawingCanonicalRecentOutcome;
    }> = [];
    const receipts: DeferredCanonicalCheckpoint["receipts"] = [];
    const digestInputs: Array<{
      local: DrawingCollaborationOperation;
      outcome: DrawingCanonicalRecentOutcome;
    }> = [];
    for (const { acknowledgement, outcome } of validated) {
      const local = ledger.operations[outcome.clientOperationId];
      if (!local) {
        if (
          history &&
          outcome.actorId === history.actorId &&
          outcome.sequence > capturedBaseSequence
        ) {
          const receipt = { acknowledgement, outcome };
          unseen.push(receipt);
          receipts.push(receipt);
        }
        continue;
      }
      // Older receipts describe operations already compacted into the current
      // base. They may remain in the bounded Yjs ledger without a recorded
      // history row and cannot prove this newer checkpoint boundary.
      if (outcome.sequence <= capturedBaseSequence) {
        const localStatus = localAcknowledgements.get(
          outcome.clientOperationId,
        );
        const serverValue = document
          .getMap("operationStatus")
          .get(outcome.clientOperationId);
        const serverStatus =
          serverValue === undefined
            ? undefined
            : DrawingCollaborationStatusSchema.parse(serverValue);
        if (localStatus || serverStatus) {
          if (
            (localStatus &&
              !same(localStatus, acknowledgement) &&
              !checkpointAbsorbsLocalAcknowledgement(
                localStatus,
                acknowledgement,
                capturedBaseSequence,
              )) ||
            (serverStatus &&
              serverStatus.status !== "pending" &&
              !same(serverStatus, acknowledgement) &&
              !checkpointAbsorbsLocalAcknowledgement(
                serverStatus,
                acknowledgement,
                capturedBaseSequence,
              ))
          )
            throw new DrawingDraftIntegrityError(
              "Canonical drawing checkpoint acknowledgement conflicts with local state.",
            );
        }
        digestInputs.push({ local, outcome });
        continue;
      }
      if (!history) {
        digestInputs.push({ local, outcome });
        continue;
      }
      const localRecorded = recorded.get(outcome.clientOperationId);
      if (
        !localRecorded ||
        localRecorded.actorId !== local.actorId ||
        !same(localRecorded.resultVersions, outcome.resultVersions)
      )
        throw new DrawingDraftIntegrityError(
          "Canonical drawing checkpoint receipt does not match local history.",
        );
      digestInputs.push({ local, outcome });
      matched.push({ acknowledgement, local });
      receipts.push({ acknowledgement, outcome });
    }
    await Promise.all(
      digestInputs.map(({ local, outcome }) =>
        assertCanonicalOutcomeDigest(local, outcome),
      ),
    );
    if (
      disposed ||
      canonicalDxfHistory !== history ||
      baseOperationSequence !== capturedBaseSequence
    )
      throw new DrawingDraftIntegrityError(
        "Canonical drawing checkpoint verification became stale.",
      );
    if (snapshot !== capturedSnapshot) {
      const missingIds = new Set(
        unseen.map(({ outcome }) => outcome.clientOperationId),
      );
      const nextLedger = readDrawingCollaborationLedger(document);
      const nextStatuses = document.getMap("operationStatus").toJSON();
      const expectedAcknowledgements = new Map(
        unseen.map(({ acknowledgement }) => [
          acknowledgement.operationId,
          acknowledgement,
        ]),
      );
      const exactLateReceiptArrival =
        missingIds.size > 0 &&
        [...missingIds].every((operationId) =>
          Boolean(nextLedger.operations[operationId]),
        ) &&
        nextLedger.operationOrder.length ===
          ledger.operationOrder.length + missingIds.size &&
        same(
          nextLedger.operationOrder.filter(
            (operationId) => !missingIds.has(operationId),
          ),
          ledger.operationOrder,
        ) &&
        ledger.operationOrder.every((operationId) =>
          same(
            nextLedger.operations[operationId],
            ledger.operations[operationId],
          ),
        ) &&
        Object.entries(capturedStatuses).every(([operationId, status]) =>
          same(nextStatuses[operationId], status),
        ) &&
        Object.entries(nextStatuses).every(
          ([operationId, status]) =>
            Object.hasOwn(capturedStatuses, operationId) ||
            same(expectedAcknowledgements.get(operationId), status),
        ) &&
        same(document.getMap("serverMeta").toJSON(), capturedMeta) &&
        same([...localAcknowledgements], capturedLocalAcknowledgements) &&
        authorization === capturedAuthorization &&
        locallyFrozen === capturedFrozen;
      if (history && exactLateReceiptArrival && allowLateReceiptRetry)
        return verifiedCanonicalCheckpointAcknowledgements(
          outcomes,
          checkpointSequence,
          checkpoint,
          false,
        );
      throw new DrawingDraftIntegrityError(
        "Canonical drawing checkpoint verification became stale.",
      );
    }
    if (!history) return { acknowledgements: [], deferredCheckpoint: null };
    if (unseen.length === 0) {
      let receiptBoundary = structuredClone(authoritativeState);
      for (const { acknowledgement, local } of matched)
        receiptBoundary = replay(
          receiptBoundary,
          local,
          acknowledgement.resultVersions,
        );
      receiptBoundary = preserveCanonicalStructureMaps(receiptBoundary);
      validateState(receiptBoundary);
      if (!sameCanonicalCheckpointGraph(checkpoint, receiptBoundary))
        throw new DrawingDraftIntegrityError(
          "Canonical drawing checkpoint does not match its exact receipts.",
        );
    }
    return {
      acknowledgements: matched.flatMap(({ acknowledgement, local }) =>
        local.actorId === history.actorId &&
        acknowledgement.authoritativeSequence! > capturedBaseSequence
          ? [acknowledgement]
          : [],
      ),
      deferredCheckpoint:
        unseen.length === 0
          ? null
          : {
              baseState: structuredClone(authoritativeState),
              baseOperationSequence: capturedBaseSequence,
              canonicalHistory: structuredClone(history),
              checkpoint: structuredClone(checkpoint),
              receipts: structuredClone(receipts),
              installedAcknowledgementIds: [],
              missingOperationIds: unseen.map(
                ({ outcome }) => outcome.clientOperationId,
              ),
            },
    };
  };

  function scheduleDeferredCanonicalVerification() {
    deferredCanonicalVerification = deferredCanonicalVerification
      .then(async () => {
        const proof = deferredCanonicalCheckpoint;
        if (!proof || disposed) return;
        const ledger = readDrawingCollaborationLedger(document);
        const resolved = proof.receipts.map(({ acknowledgement, outcome }) => ({
          acknowledgement,
          outcome,
          operation: ledger.operations[outcome.clientOperationId],
        }));
        if (resolved.some(({ operation }) => !operation)) return;
        await Promise.all(
          resolved.map(({ operation, outcome }) =>
            assertCanonicalOutcomeDigest(operation!, outcome),
          ),
        );
        if (disposed || deferredCanonicalCheckpoint !== proof) return;
        const currentLedger = readDrawingCollaborationLedger(document);
        if (
          resolved.some(
            ({ operation, outcome }) =>
              !same(
                currentLedger.operations[outcome.clientOperationId],
                operation,
              ),
          )
        )
          throw new DrawingDraftIntegrityError(
            "Deferred drawing checkpoint receipt changed during verification.",
          );
        let boundary = structuredClone(proof.baseState);
        for (const { acknowledgement, operation } of resolved)
          boundary = replay(
            boundary,
            operation!,
            acknowledgement.resultVersions,
          );
        boundary = preserveCanonicalStructureMaps(boundary);
        validateState(boundary);
        if (!sameCanonicalCheckpointGraph(proof.checkpoint, boundary))
          throw new DrawingDraftIntegrityError(
            "Canonical drawing checkpoint does not match its deferred receipts.",
          );

        const insertedAcknowledgements: string[] = [];
        for (const operationId of proof.missingOperationIds) {
          const acknowledgement = proof.receipts.find(
            (receipt) => receipt.outcome.clientOperationId === operationId,
          )!.acknowledgement;
          const current = localAcknowledgements.get(operationId);
          const serverValue = document
            .getMap("operationStatus")
            .get(operationId);
          const server =
            serverValue === undefined
              ? undefined
              : DrawingCollaborationStatusSchema.parse(serverValue);
          if (
            (current && !same(current, acknowledgement)) ||
            (server &&
              server.status !== "pending" &&
              !same(server, acknowledgement))
          )
            throw new DrawingDraftIntegrityError(
              "Canonical drawing checkpoint acknowledgement conflicts with local state.",
            );
          if (!current && (!server || server.status === "pending")) {
            localAcknowledgements.set(operationId, acknowledgement);
            canonicalLocalAcknowledgementIds.add(operationId);
            insertedAcknowledgements.push(operationId);
          }
        }
        deferredCanonicalCheckpoint = null;
        try {
          publish(project(document));
        } catch (error) {
          deferredCanonicalCheckpoint = proof;
          for (const operationId of insertedAcknowledgements) {
            localAcknowledgements.delete(operationId);
            canonicalLocalAcknowledgementIds.delete(operationId);
          }
          throw error;
        }
      })
      .catch((error) => {
        if (disposed) return;
        const proof = deferredCanonicalCheckpoint;
        let recovered = snapshot;
        if (proof) {
          authoritativeState = proof.baseState;
          baseOperationSequence = proof.baseOperationSequence;
          canonicalDxfHistory = proof.canonicalHistory;
          for (const operationId of proof.installedAcknowledgementIds) {
            localAcknowledgements.delete(operationId);
            canonicalLocalAcknowledgementIds.delete(operationId);
          }
          deferredCanonicalCheckpoint = null;
          try {
            recovered = project(document);
          } catch {
            // The quarantine below remains fail-closed if the received op is bad.
          }
        }
        const quarantined = {
          ...recovered,
          quarantine: {
            message: errorMessage(error),
            occurredAt: new Date().toISOString(),
          },
        };
        try {
          publish(quarantined);
        } catch {
          snapshot = quarantined;
        }
      });
  }

  return {
    getSnapshot: () => snapshot,
    operations: () => {
      if (disposed) return [];
      const ledger = readDrawingCollaborationLedger(document);
      return ledger.operationOrder.map((id) =>
        structuredClone(ledger.operations[id]),
      );
    },
    operationStatus(clientOperationId) {
      if (disposed) return null;
      const local = localAcknowledgements.get(clientOperationId);
      const serverValue = document
        .getMap("operationStatus")
        .get(clientOperationId);
      const server =
        serverValue === undefined
          ? null
          : DrawingCollaborationStatusSchema.parse(serverValue);
      if (
        local &&
        server &&
        !acceptsLocalAcknowledgement(clientOperationId, server, local)
      )
        throw new DrawingDraftIntegrityError(
          "Drawing local acknowledgement conflicts with server status.",
        );
      if (
        local &&
        server &&
        checkpointAbsorbsLocalAcknowledgement(server, local)
      )
        return structuredClone(server);
      return structuredClone(local ?? server);
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
      document.transact(() => {
        appendDrawingCollaborationOperation(document, operation);
      });
      return true;
    },
    hydrateCanonicalHistory(input) {
      assertWritable(options.actorId);
      if (
        snapshot.pendingOperationIds.length > 0 ||
        snapshot.conflictOperationIds.length > 0 ||
        snapshot.rejectedOperationIds.length > 0 ||
        snapshot.provisionalConflictOperationIds.length > 0 ||
        snapshot.state.operations.length > 0 ||
        Object.values(snapshot.state.undoStackByActor).some(
          (stack) => stack.length > 0,
        ) ||
        Object.values(snapshot.state.redoStackByActor).some(
          (stack) => stack.length > 0,
        )
      )
        throw new DrawingDraftIntegrityError(
          "Canonical DXF history requires a clean compacted draft; native DWG history uses the same invariant.",
        );
      const candidate = structuredClone(input);
      validateState(candidate);
      const recoveredHistory = assertCanonicalDxfHistory(
        candidate,
        options.actorId,
      );
      if (
        candidate.revisionId !== authoritativeState.revisionId ||
        !same(stateGraph(candidate), stateGraph(snapshot.state))
      )
        throw new DrawingDraftIntegrityError(
          "Canonical DXF history does not match the current drawing graph; native DWG history uses the same invariant.",
        );

      const previous = authoritativeState;
      authoritativeState = candidate;
      reproject();
      if (snapshot.quarantine || !same(snapshot.state, candidate)) {
        authoritativeState = previous;
        reproject();
        throw new DrawingDraftIntegrityError(
          "Canonical DXF history could not be installed exactly; native DWG history uses the same invariant.",
        );
      }
      canonicalDxfHistory = recoveredHistory;
      return true;
    },
    recordLocalAcknowledgement(input, authority) {
      if (disposed) throw new Error("Drawing draft adapter is disposed.");
      const acknowledgement = DrawingCollaborationStatusSchema.parse({
        operationId: input.clientOperationId,
        status: "acked",
        authoritativeSequence: input.authoritativeSequence,
        resultVersions: input.resultVersions,
      });
      const ledger = readDrawingCollaborationLedger(document);
      const operation = ledger.operations[acknowledgement.operationId];
      if (!operation || operation.actorId !== options.actorId)
        throw new Error(
          "Drawing local acknowledgement is outside the local operation ledger.",
        );
      const current = localAcknowledgements.get(acknowledgement.operationId);
      if (current) {
        if (!same(current, acknowledgement))
          throw new Error("Drawing local acknowledgement is immutable.");
        if (authority === "canonical")
          canonicalLocalAcknowledgementIds.add(acknowledgement.operationId);
        return false;
      }
      const serverStatus = document
        .getMap("operationStatus")
        .get(acknowledgement.operationId);
      if (serverStatus !== undefined) {
        const parsed = DrawingCollaborationStatusSchema.parse(serverStatus);
        const checkpointAbsorbsMismatch =
          authority === "canonical" &&
          checkpointAbsorbsLocalAcknowledgement(parsed, acknowledgement);
        if (
          !same(parsed, acknowledgement) &&
          (authority !== "canonical" || parsed.status !== "pending") &&
          !checkpointAbsorbsMismatch
        )
          throw new Error(
            "Drawing local acknowledgement conflicts with server status.",
          );
        if (same(parsed, acknowledgement) || checkpointAbsorbsMismatch)
          return false;
      }
      localAcknowledgements.set(acknowledgement.operationId, acknowledgement);
      if (authority === "canonical")
        canonicalLocalAcknowledgementIds.add(acknowledgement.operationId);
      reproject();
      return true;
    },
    isOperationCheckpointAcknowledged(clientOperationId, checkpoint) {
      if (disposed || !Number.isInteger(checkpoint) || checkpoint < 0)
        return false;
      const ledger = readDrawingCollaborationLedger(document);
      if (!ledger.operations[clientOperationId]) return false;
      const local = localAcknowledgements.get(clientOperationId);
      if (local)
        return (
          local.status === "acked" &&
          local.authoritativeSequence !== null &&
          local.authoritativeSequence <= checkpoint
        );
      const parsed = DrawingCollaborationStatusSchema.safeParse(
        document.getMap("operationStatus").get(clientOperationId),
      );
      return (
        parsed.success &&
        parsed.data.status === "acked" &&
        parsed.data.authoritativeSequence !== null &&
        parsed.data.authoritativeSequence <= checkpoint
      );
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
      if (deferredCanonicalCheckpoint)
        throw new DrawingDraftIntegrityError(
          "A canonical drawing checkpoint receipt is still pending verification.",
        );
      if (state.revisionId !== authoritativeState.revisionId)
        throw new Error(
          "Authoritative drawing revision cannot change in-place.",
        );
      const checkpoint = structuredClone(state);
      validateState(checkpoint);
      const checkpointSequence = next.baseOperationSequence;
      if (
        checkpointSequence !== undefined &&
        (!Number.isSafeInteger(checkpointSequence) ||
          checkpointSequence < baseOperationSequence)
      )
        throw new DrawingDraftIntegrityError(
          "Authoritative drawing checkpoint sequence regressed.",
        );
      const install = (
        acknowledgements: CollaborationAcknowledgementEvidence[] = [],
        deferredCheckpoint: DeferredCanonicalCheckpoint | null = null,
      ) => {
        if (deferredCanonicalCheckpoint)
          throw new DrawingDraftIntegrityError(
            "A canonical drawing checkpoint receipt is still pending verification.",
          );
        const insertableAcknowledgements: CollaborationAcknowledgementEvidence[] =
          [];
        for (const acknowledgement of acknowledgements) {
          const operationId = acknowledgement.operationId;
          const current = localAcknowledgements.get(operationId);
          const serverValue = document
            .getMap("operationStatus")
            .get(operationId);
          const server =
            serverValue === undefined
              ? undefined
              : DrawingCollaborationStatusSchema.parse(serverValue);
          if (
            (current && !same(current, acknowledgement)) ||
            (server &&
              server.status !== "pending" &&
              !same(server, acknowledgement))
          )
            throw new DrawingDraftIntegrityError(
              "Canonical drawing checkpoint acknowledgement conflicts with local state.",
            );
          if (!current && (!server || server.status === "pending")) {
            insertableAcknowledgements.push(acknowledgement);
          }
        }
        for (const acknowledgement of insertableAcknowledgements) {
          localAcknowledgements.set(
            acknowledgement.operationId,
            acknowledgement,
          );
          canonicalLocalAcknowledgementIds.add(acknowledgement.operationId);
        }
        const insertedAcknowledgements = insertableAcknowledgements.map(
          (acknowledgement) => acknowledgement.operationId,
        );
        const checkpointHistory =
          checkpointSequence === undefined ||
          snapshot.quarantine !== null ||
          snapshot.conflictOperationIds.length > 0 ||
          snapshot.rejectedOperationIds.length > 0 ||
          snapshot.provisionalConflictOperationIds.length > 0
            ? null
            : canonicalHistoryAtCheckpoint(checkpointSequence);
        const canPreserveHistory =
          canonicalDxfHistory !== null &&
          checkpointHistory !== null &&
          isCanonicalDxfHistoryProgression(
            snapshot.state,
            canonicalDxfHistory,
          ) &&
          sameCanonicalCheckpointGraph(checkpoint, checkpointHistory);
        const previousAuthoritativeState = authoritativeState;
        const previousCanonicalDxfHistory = canonicalDxfHistory;
        const previousBaseOperationSequence = baseOperationSequence;
        const previousDeferredCanonicalCheckpoint = deferredCanonicalCheckpoint;
        authoritativeState = canPreserveHistory
          ? preserveCanonicalDxfHistory(checkpoint, checkpointHistory)
          : checkpoint;
        if (!canPreserveHistory) canonicalDxfHistory = null;
        if (checkpointSequence !== undefined)
          baseOperationSequence = checkpointSequence;
        if (deferredCheckpoint)
          deferredCanonicalCheckpoint = {
            ...deferredCheckpoint,
            baseState: previousAuthoritativeState,
            baseOperationSequence: previousBaseOperationSequence,
            canonicalHistory: previousCanonicalDxfHistory
              ? structuredClone(previousCanonicalDxfHistory)
              : null,
            installedAcknowledgementIds: insertedAcknowledgements,
          };
        try {
          publish(project(document));
        } catch (error) {
          authoritativeState = previousAuthoritativeState;
          canonicalDxfHistory = previousCanonicalDxfHistory;
          baseOperationSequence = previousBaseOperationSequence;
          deferredCanonicalCheckpoint = previousDeferredCanonicalCheckpoint;
          for (const operationId of insertedAcknowledgements) {
            localAcknowledgements.delete(operationId);
            canonicalLocalAcknowledgementIds.delete(operationId);
          }
          throw new DrawingDraftIntegrityError(errorMessage(error));
        }
        if (deferredCheckpoint) scheduleDeferredCanonicalVerification();
      };
      if (next.recentOutcomes === undefined) {
        install();
        return;
      }
      return verifiedCanonicalCheckpointAcknowledgements(
        next.recentOutcomes,
        checkpointSequence ?? baseOperationSequence,
        checkpoint,
      ).then(({ acknowledgements, deferredCheckpoint }) => {
        install(acknowledgements, deferredCheckpoint);
      });
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
      localAcknowledgements.clear();
      canonicalLocalAcknowledgementIds.clear();
      deferredCanonicalCheckpoint = null;
      listeners.clear();
    },
  };
}
