import { z } from "zod";

import {
  applyDrawingCommand,
  type AppliedDrawingCommand,
  type DrawingDocumentState,
  type DrawingRecordedOperation,
} from "./drawing-commands.ts";
import { drawingCollaborationOperationDigestSource } from "./drawing-collaboration-protocol.ts";
import { sameDrawingCanonicalValue } from "./drawing-structure.ts";
import {
  DrawingHistoryGroupSchema,
  DrawingOperationInputSchema,
  DrawingStructureActionSchema,
  type DrawingHistoryGroup,
  type DrawingOperationInput,
  type DrawingStructureAction,
} from "./drawing-workspace.types.ts";

const ActorIdSchema = z.string().uuid();
const DrawingCadSourceSha256Schema = z.string().regex(/^[0-9a-f]{64}$/);
const DrawingCadCanonicalReceiptSchema = z
  .object({
    clientOperationId: z.string().uuid(),
    revisionId: z.string().uuid(),
    actorId: z.string().uuid(),
    sequence: z.number().int().positive(),
    resultVersions: z.record(
      z.string().uuid(),
      z.number().int().positive().nullable(),
    ),
    operationSha256: z.string().regex(/^[0-9a-f]{64}$/),
  })
  .strict();
export type DrawingCadCanonicalReceipt = z.infer<
  typeof DrawingCadCanonicalReceiptSchema
>;
type DrawingStructureOperationPayload = {
  type: "mutate_structure";
  actions: DrawingStructureAction[];
  historyGroup: DrawingHistoryGroup;
};
const MutateStructurePayloadSchema = z
  .object({
    type: z.literal("mutate_structure"),
    actions: z.array(DrawingStructureActionSchema).min(1),
    historyGroup: DrawingHistoryGroupSchema,
  })
  .strict();
type DrawingCadPlannedOperation = DrawingOperationInput & {
  type: "mutate_structure";
  forward: DrawingStructureOperationPayload;
  inverse: DrawingStructureOperationPayload;
};

export class DrawingCadImportClientError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DrawingCadImportClientError";
  }
}

type DrawingCadSourceIdentity = {
  sourceFileId: string;
  sourceSha256: string;
} & Record<string, unknown>;

export type DrawingCadImportClientConfig<Request> = {
  historyKind: DrawingHistoryGroup["kind"];
  sourceKind: "dxf_entity" | "dwg_entity";
  sourceIdentity: (
    source: Record<string, unknown>,
  ) => DrawingCadSourceIdentity | null;
  prepareRequest: (input: {
    operation: DrawingCadPlannedOperation;
    canvasId: string;
    source: DrawingCadSourceIdentity;
  }) => Request;
  preparedPlan: (input: unknown) => {
    requestId: string;
    sourceSha256: string;
    operations: readonly unknown[];
  } | null;
};

type DrawingCadQueuedGroupPrepare<Request> = (
  request: Request,
) => Promise<unknown>;

export type DrawingCadImportOperationResult =
  | { kind: "applied"; applied: AppliedDrawingCommand }
  | { kind: "already_applied"; state: DrawingDocumentState }
  | { kind: "already_materialized"; state: DrawingDocumentState };

export type AppliedDrawingCadImportOperations = {
  state: DrawingDocumentState;
  applied: AppliedDrawingCommand[];
  alreadyAppliedOperationIds: string[];
  alreadyMaterializedOperationIds: string[];
  canonicalHistoryState: DrawingDocumentState | null;
  canonicalDisposition: "current" | "reverted" | "history_advanced";
};

type StructureEntity = { id: string; version: number } & Record<
  string,
  unknown
>;

function exactPlannedOperation(input: unknown): DrawingCadPlannedOperation {
  const parsed = DrawingOperationInputSchema.safeParse(input);
  if (
    !parsed.success ||
    !sameDrawingCanonicalValue(parsed.data, input) ||
    parsed.data.type !== "mutate_structure" ||
    parsed.data.originalOperationId !== undefined ||
    parsed.data.historyAction !== undefined
  )
    throw new DrawingCadImportClientError(
      "CAD import plan operation is not an exact DrawingOperationInput.",
    );
  return {
    ...parsed.data,
    type: "mutate_structure",
    forward: MutateStructurePayloadSchema.parse(
      parsed.data.forward,
    ) as DrawingStructureOperationPayload,
    inverse: MutateStructurePayloadSchema.parse(
      parsed.data.inverse,
    ) as DrawingStructureOperationPayload,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function cadHistoryGroupId(value: unknown): string | null {
  if (!isRecord(value)) return null;
  const historyGroup = value.historyGroup;
  if (
    !isRecord(historyGroup) ||
    (historyGroup.kind !== "dxf_import" && historyGroup.kind !== "dwg_import")
  )
    return null;
  return typeof historyGroup.id === "string" ? historyGroup.id : null;
}

function cadHistoryGroupKind(
  value: unknown,
): DrawingHistoryGroup["kind"] | null {
  if (!isRecord(value)) return null;
  const historyGroup = value.historyGroup;
  return isRecord(historyGroup) &&
    (historyGroup.kind === "dxf_import" || historyGroup.kind === "dwg_import")
    ? historyGroup.kind
    : null;
}

function queuedCadMarker<Request>(
  config: DrawingCadImportClientConfig<Request>,
  input: unknown,
): boolean {
  if (!isRecord(input)) return false;
  if (
    (input.historyAction === "undo" || input.historyAction === "redo") &&
    ActorIdSchema.safeParse(input.originalOperationId).success
  )
    return false;
  const forwardKind = cadHistoryGroupKind(input.forward);
  const inverseKind = cadHistoryGroupKind(input.inverse);
  if (forwardKind === null && inverseKind === null) return false;
  if (forwardKind === null || forwardKind !== inverseKind)
    throw new DrawingCadImportClientError(
      "Queued CAD import group has inconsistent history metadata.",
    );
  return forwardKind === config.historyKind;
}

function queuedExactPlannedOperation(
  input: unknown,
): DrawingCadPlannedOperation {
  try {
    return exactPlannedOperation(input);
  } catch {
    throw new DrawingCadImportClientError(
      "Queued CAD import group contains an invalid operation.",
    );
  }
}

function assertPlannedKind<Request>(
  config: DrawingCadImportClientConfig<Request>,
  operation: DrawingCadPlannedOperation,
) {
  if (
    operation.forward.historyGroup.kind !== config.historyKind ||
    operation.inverse.historyGroup.kind !== config.historyKind
  )
    throw new DrawingCadImportClientError(
      "CAD import operation has a different history kind.",
    );
  for (const action of [
    ...operation.forward.actions,
    ...operation.inverse.actions,
  ])
    if (
      action.kind === "put_source" &&
      (action.entity.sourceKind !== config.sourceKind ||
        action.entity.revisionId !== operation.revisionId ||
        config.sourceIdentity(action.entity) === null)
    )
      throw new DrawingCadImportClientError(
        "CAD import operation has invalid source identity.",
      );
}

function assertHomogeneousSourceIdentity<Request>(
  config: DrawingCadImportClientConfig<Request>,
  operations: readonly DrawingCadPlannedOperation[],
) {
  const sources = operations.flatMap((operation) =>
    [...operation.forward.actions, ...operation.inverse.actions].flatMap(
      (action) => {
        if (action.kind !== "put_source") return [];
        const source = config.sourceIdentity(action.entity);
        return source ? [source] : [];
      },
    ),
  );
  if (
    sources.length === 0 ||
    sources.some((source) => !sameDrawingCanonicalValue(source, sources[0]))
  )
    throw new DrawingCadImportClientError(
      "CAD import group has inconsistent source identity.",
    );
}

function queuedCadImportRequest<Request>(
  config: DrawingCadImportClientConfig<Request>,
  operation: DrawingCadPlannedOperation,
  knownOperations: readonly unknown[],
): {
  groupId: string;
  sourceSha256: string;
  request: Request;
  operations: DrawingCadPlannedOperation[];
} {
  const group = operation.forward.historyGroup;
  if (!sameDrawingCanonicalValue(group, operation.inverse.historyGroup))
    throw new DrawingCadImportClientError(
      "Queued CAD import group has inconsistent history metadata.",
    );

  const queued = knownOperations
    .filter((candidate) => {
      if (!isRecord(candidate)) return false;
      if (
        (candidate.historyAction === "undo" ||
          candidate.historyAction === "redo") &&
        ActorIdSchema.safeParse(candidate.originalOperationId).success
      )
        return false;
      return (
        cadHistoryGroupId(candidate.forward) === group.id ||
        cadHistoryGroupId(candidate.inverse) === group.id
      );
    })
    .map(queuedExactPlannedOperation);
  if (queued.length !== group.count)
    throw new DrawingCadImportClientError(
      "Queued CAD import group is incomplete.",
    );

  const operationIds = new Set<string>();
  for (let index = 0; index < queued.length; index += 1) {
    const candidate = queued[index];
    if (
      candidate.revisionId !== operation.revisionId ||
      candidate.forward.historyGroup.id !== group.id ||
      candidate.forward.historyGroup.kind !== config.historyKind ||
      !sameDrawingCanonicalValue(
        candidate.forward.historyGroup,
        candidate.inverse.historyGroup,
      ) ||
      candidate.forward.historyGroup.index !== index ||
      candidate.forward.historyGroup.count !== group.count ||
      operationIds.has(candidate.clientOperationId)
    )
      throw new DrawingCadImportClientError(
        "Queued CAD import group is incomplete or out of order.",
      );
    operationIds.add(candidate.clientOperationId);
  }
  if (!operationIds.has(operation.clientOperationId))
    throw new DrawingCadImportClientError(
      "Queued CAD import operation is not part of its complete group.",
    );
  const supplied = queued.find(
    (candidate) => candidate.clientOperationId === operation.clientOperationId,
  );
  if (!supplied || !sameDrawingCanonicalValue(supplied, operation))
    throw new DrawingCadImportClientError(
      "Queued CAD import operation does not match its complete group.",
    );

  const canvasIds = new Set<string>();
  const sources: DrawingCadSourceIdentity[] = [];
  for (const candidate of queued) {
    for (const action of [
      ...candidate.forward.actions,
      ...candidate.inverse.actions,
    ]) {
      if (action.kind === "put_layer") canvasIds.add(action.entity.canvasId);
      if (action.kind !== "put_source") continue;
      if (action.entity.sourceKind !== config.sourceKind)
        throw new DrawingCadImportClientError(
          "Queued CAD import group contains a source of another kind.",
        );
      if (action.entity.revisionId !== candidate.revisionId)
        throw new DrawingCadImportClientError(
          "Queued CAD import source belongs to another revision.",
        );
      const source = config.sourceIdentity(action.entity);
      if (
        !source ||
        !ActorIdSchema.safeParse(source.sourceFileId).success ||
        !DrawingCadSourceSha256Schema.safeParse(source.sourceSha256).success
      )
        throw new DrawingCadImportClientError(
          "Queued CAD import group has invalid source metadata.",
        );
      sources.push(source);
    }
  }
  if (canvasIds.size !== 1 || sources.length === 0)
    throw new DrawingCadImportClientError(
      "Queued CAD import group is missing canonical source metadata.",
    );
  const [source] = sources;
  if (
    sources.some((candidate) => !sameDrawingCanonicalValue(candidate, source))
  )
    throw new DrawingCadImportClientError(
      "Queued CAD import group has inconsistent source metadata.",
    );

  return {
    groupId: group.id,
    sourceSha256: source.sourceSha256,
    operations: queued,
    request: config.prepareRequest({
      operation,
      canvasId: [...canvasIds][0],
      source,
    }),
  };
}

export async function attestQueuedDrawingCadGroupBeforeSend<Request>({
  config,
  operation,
  knownOperations,
  prepare,
}: {
  config: DrawingCadImportClientConfig<Request>;
  operation: unknown;
  knownOperations: readonly unknown[];
  prepare: DrawingCadQueuedGroupPrepare<Request>;
}): Promise<string | null> {
  if (!queuedCadMarker(config, operation)) return null;
  const queued = queuedCadImportRequest(
    config,
    queuedExactPlannedOperation(operation),
    knownOperations,
  );
  let prepared: unknown;
  try {
    prepared = await prepare(queued.request);
  } catch (error) {
    if (error instanceof DrawingCadImportClientError) throw error;
    throw new DrawingCadImportClientError(
      "CAD import preparation is temporarily unavailable.",
    );
  }
  const parsed = config.preparedPlan(prepared);
  if (
    !parsed ||
    parsed.requestId !== queued.groupId ||
    parsed.sourceSha256 !== queued.sourceSha256 ||
    parsed.operations.length !== queued.operations.length ||
    !parsed.operations.every((candidate, index) =>
      sameDrawingCanonicalValue(candidate, queued.operations[index]),
    )
  )
    throw new DrawingCadImportClientError(
      "CAD import preparation does not match the queued group.",
    );
  return queued.groupId;
}

type DrawingCadImportSendGateEntry = {
  source: "prepared" | "recovered";
  operations: DrawingCadPlannedOperation[];
};

function sameQueuedCadOperations(
  left: readonly DrawingCadPlannedOperation[],
  right: readonly DrawingCadPlannedOperation[],
) {
  return (
    left.length === right.length &&
    left.every((operation, index) =>
      sameDrawingCanonicalValue(operation, right[index]),
    )
  );
}

/**
 * Keeps one workspace lifecycle's already-attested CAD plans exact while the
 * ordinary outbox remains the sole durable queue and retry authority.
 */
export function createDrawingCadImportSendGate<Request>(
  config: DrawingCadImportClientConfig<Request>,
) {
  const entries = new Map<string, DrawingCadImportSendGateEntry>();
  const cacheKey = (groupId: string) => `${config.historyKind}:${groupId}`;

  return {
    rememberPrepared(groupId: string, operations: readonly unknown[]) {
      if (operations.length === 0)
        throw new DrawingCadImportClientError(
          "Prepared CAD import group is empty.",
        );
      const exact = operations.map(queuedExactPlannedOperation);
      const queued = queuedCadImportRequest(config, exact[0], exact);
      if (queued.groupId !== groupId)
        throw new DrawingCadImportClientError(
          "Prepared CAD import group identity changed.",
        );
      entries.set(cacheKey(groupId), {
        source: "prepared",
        operations: queued.operations,
      });
    },

    async send<T>({
      operation,
      knownOperations,
      prepare,
      send,
    }: {
      operation: unknown;
      knownOperations: () => Promise<readonly unknown[]>;
      prepare: DrawingCadQueuedGroupPrepare<Request>;
      send: () => Promise<T>;
    }): Promise<T> {
      if (!queuedCadMarker(config, operation)) return send();
      const exact = queuedExactPlannedOperation(operation);
      if (
        !sameDrawingCanonicalValue(
          exact.forward.historyGroup,
          exact.inverse.historyGroup,
        )
      )
        throw new DrawingCadImportClientError(
          "Queued CAD import group has inconsistent history metadata.",
        );
      const groupId = exact.forward.historyGroup.id;
      const key = cacheKey(groupId);
      const cached = entries.get(key);
      const cachedOperation = cached?.operations.find(
        (candidate) => candidate.clientOperationId === exact.clientOperationId,
      );
      let known: readonly unknown[] | null = null;

      if (
        cached &&
        cachedOperation &&
        sameDrawingCanonicalValue(cachedOperation, exact)
      ) {
        if (cached.source === "prepared") return send();
        known = await knownOperations();
        try {
          const current = queuedCadImportRequest(config, exact, known);
          if (sameQueuedCadOperations(cached.operations, current.operations))
            return send();
        } catch (error) {
          entries.delete(key);
          throw error;
        }
      }
      entries.delete(key);
      known ??= await knownOperations();
      const attestedGroupId = await attestQueuedDrawingCadGroupBeforeSend({
        config,
        operation: exact,
        knownOperations: known,
        prepare,
      });
      if (!attestedGroupId)
        throw new DrawingCadImportClientError(
          "Queued CAD import attestation was not created.",
        );
      const recovered = queuedCadImportRequest(config, exact, known);
      entries.set(cacheKey(attestedGroupId), {
        source: "recovered",
        operations: recovered.operations,
      });
      return send();
    },
  };
}

function recordedOperationInput(
  operation: DrawingRecordedOperation,
): DrawingOperationInput {
  return DrawingOperationInputSchema.parse({
    clientOperationId: operation.clientOperationId,
    revisionId: operation.revisionId,
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

function existingOperation(
  state: DrawingDocumentState,
  actorId: string,
  planned: DrawingCadPlannedOperation,
): DrawingRecordedOperation | null {
  const matches = state.operations.filter(
    (operation) => operation.clientOperationId === planned.clientOperationId,
  );
  if (matches.length === 0) return null;
  if (
    matches.length !== 1 ||
    matches[0].actorId !== actorId ||
    !sameDrawingCanonicalValue(recordedOperationInput(matches[0]), planned)
  )
    throw new DrawingCadImportClientError(
      "CAD import operation ID already exists with a different envelope.",
    );
  return matches[0];
}

function assertRevision(
  state: DrawingDocumentState,
  planned: DrawingCadPlannedOperation,
) {
  if (planned.revisionId !== state.revisionId)
    throw new DrawingCadImportClientError(
      "CAD import plan operation belongs to another revision.",
    );
}

function actionId(action: DrawingStructureAction) {
  return "entity" in action ? action.entity.id : action.id;
}

function recordForAction(
  state: DrawingDocumentState,
  action: DrawingStructureAction,
): Record<string, StructureEntity> {
  const structure = state.structure;
  if (!structure)
    throw new DrawingCadImportClientError(
      "CAD import requires canonical drawing structure state.",
    );
  switch (action.kind.replace(/^put_|^delete_/, "")) {
    case "object":
      return structure.objects as Record<string, StructureEntity>;
    case "source":
      return (structure.sources ?? {}) as Record<string, StructureEntity>;
    case "page":
      return structure.pages as Record<string, StructureEntity>;
    case "canvas":
      return structure.canvases as Record<string, StructureEntity>;
    case "layer":
      return structure.layers as Record<string, StructureEntity>;
    case "style":
      return structure.styles as Record<string, StructureEntity>;
    case "block":
      return structure.blocks as Record<string, StructureEntity>;
    case "block_instance":
      return structure.blockInstances as Record<string, StructureEntity>;
    case "property_schema":
      return structure.propertySchemas as Record<string, StructureEntity>;
    case "property_value":
      return structure.propertyValues as Record<string, StructureEntity>;
    case "table":
      return structure.tables as Record<string, StructureEntity>;
    default:
      throw new DrawingCadImportClientError(
        "CAD import plan contains an unsupported structure action.",
      );
  }
}

function currentEntity(
  state: DrawingDocumentState,
  action: DrawingStructureAction,
): StructureEntity | undefined {
  return recordForAction(state, action)[actionId(action)];
}

function resultEntity(
  action: DrawingStructureAction,
): StructureEntity | undefined {
  if (!("entity" in action)) return undefined;
  return {
    ...(action.entity as StructureEntity),
    version:
      action.baseVersion === null
        ? action.entity.version
        : action.baseVersion + 1,
  };
}

function operationIsMaterialized(
  state: DrawingDocumentState,
  planned: DrawingCadPlannedOperation,
) {
  const results = planned.forward.actions.map((action) =>
    sameDrawingCanonicalValue(
      currentEntity(state, action),
      resultEntity(action),
    ),
  );
  if (results.every(Boolean)) return true;
  if (results.some(Boolean))
    throw new DrawingCadImportClientError(
      "CAD import operation is only partially materialized.",
    );
  return false;
}

function plannedResultVersions(operation: DrawingCadPlannedOperation) {
  const entries = operation.forward.actions.map(
    (action) =>
      [
        actionId(action),
        "entity" in action
          ? action.baseVersion === null
            ? action.entity.version
            : action.baseVersion + 1
          : null,
      ] as const,
  );
  if (new Set(entries.map(([id]) => id)).size !== entries.length)
    throw new DrawingCadImportClientError(
      "CAD import operation mutates one entity more than once.",
    );
  return Object.fromEntries(entries);
}

async function operationSha256(
  operation: DrawingCadPlannedOperation,
  actorId: string,
) {
  if (!globalThis.crypto?.subtle)
    throw new DrawingCadImportClientError(
      "CAD import canonical receipt digest verification is unavailable.",
    );
  try {
    const bytes = new TextEncoder().encode(
      drawingCollaborationOperationDigestSource(operation, actorId),
    );
    const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");
  } catch {
    throw new DrawingCadImportClientError(
      "CAD import canonical receipt digest verification failed.",
    );
  }
}

async function exactCanonicalReceipts(
  inputs: readonly unknown[],
  actorId: string,
  planned: DrawingCadPlannedOperation[],
) {
  const receipts = inputs.map((input) => {
    const parsed = DrawingCadCanonicalReceiptSchema.safeParse(input);
    if (!parsed.success || !sameDrawingCanonicalValue(parsed.data, input))
      throw new DrawingCadImportClientError(
        "CAD import canonical receipt is malformed.",
      );
    return parsed.data;
  });
  if (
    receipts.length > planned.length ||
    new Set(receipts.map((receipt) => receipt.clientOperationId)).size !==
      receipts.length ||
    new Set(receipts.map((receipt) => receipt.sequence)).size !==
      receipts.length ||
    new Set(receipts.map((receipt) => receipt.operationSha256)).size !==
      receipts.length
  )
    throw new DrawingCadImportClientError(
      "CAD import canonical receipt prefix is invalid.",
    );
  for (const [index, receipt] of receipts.entries()) {
    const operation = planned[index];
    if (
      !operation ||
      receipt.clientOperationId !== operation.clientOperationId ||
      receipt.revisionId !== operation.revisionId ||
      receipt.actorId !== actorId ||
      (index > 0 && receipts[index - 1].sequence >= receipt.sequence) ||
      !sameDrawingCanonicalValue(
        receipt.resultVersions,
        plannedResultVersions(operation),
      )
    )
      throw new DrawingCadImportClientError(
        "CAD import canonical receipt does not match the planned prefix.",
      );
    if (receipt.operationSha256 !== (await operationSha256(operation, actorId)))
      throw new DrawingCadImportClientError(
        "CAD import canonical receipt digest does not match its operation.",
      );
  }
  return receipts;
}

function historyGroupId(operation: DrawingRecordedOperation) {
  if (operation.type !== "mutate_structure") return null;
  const forward = operation.forward as { historyGroup?: { id?: unknown } };
  const inverse = operation.inverse as { historyGroup?: { id?: unknown } };
  return forward.historyGroup?.id === inverse.historyGroup?.id &&
    typeof forward.historyGroup?.id === "string"
    ? forward.historyGroup.id
    : (forward.historyGroup?.id ?? inverse.historyGroup?.id ?? null);
}

function assertRecoverableHistory(
  state: DrawingDocumentState,
  actorId: string,
  planned: DrawingCadPlannedOperation[],
  recorded: Array<DrawingRecordedOperation | null>,
) {
  const plannedIds = new Set(
    planned.map((operation) => operation.clientOperationId),
  );
  const groupId = planned[0]?.forward.historyGroup.id;
  if (
    groupId &&
    state.operations.some(
      (operation) =>
        !plannedIds.has(operation.clientOperationId) &&
        historyGroupId(operation) === groupId,
    )
  )
    throw new DrawingCadImportClientError(
      "CAD import history group ID collides with existing history.",
    );

  const recordedIds = recorded.flatMap((operation) =>
    operation ? [operation.clientOperationId] : [],
  );
  if (
    recorded.some((operation, index) =>
      operation === null
        ? recorded.slice(index + 1).some(Boolean)
        : operation.clientOperationId !== planned[index].clientOperationId,
    ) ||
    !sameDrawingCanonicalValue(
      state.operations
        .filter((operation) => plannedIds.has(operation.clientOperationId))
        .map((operation) => operation.clientOperationId),
      recordedIds,
    )
  )
    throw new DrawingCadImportClientError(
      "CAD import original receipts are incomplete or out of order.",
    );

  for (const stacks of [state.undoStackByActor, state.redoStackByActor])
    for (const [stackActor, stack] of Object.entries(stacks))
      if (
        stackActor !== actorId &&
        stack.some((operationId) => plannedIds.has(operationId))
      )
        throw new DrawingCadImportClientError(
          "CAD import history stack belongs to another actor.",
        );
  const undoMembers = (state.undoStackByActor[actorId] ?? []).filter((id) =>
    plannedIds.has(id),
  );
  const redoMembers = (state.redoStackByActor[actorId] ?? []).filter((id) =>
    plannedIds.has(id),
  );
  if (
    !sameDrawingCanonicalValue(undoMembers, recordedIds) ||
    redoMembers.length > 0
  )
    throw new DrawingCadImportClientError(
      "CAD import history stack is incomplete or out of order.",
    );
}

function recoverOriginalReceipts(
  state: DrawingDocumentState,
  actorId: string,
  planned: DrawingCadPlannedOperation[],
  receipts: DrawingCadCanonicalReceipt[],
  prefix: number,
  recorded: Array<DrawingRecordedOperation | null>,
) {
  const missing = planned
    .slice(0, prefix)
    .flatMap((operation, index) => (recorded[index] ? [] : [operation]));
  if (missing.length === 0) return state;
  if (receipts.length !== prefix)
    throw new DrawingCadImportClientError(
      "CAD import materialized prefix is missing canonical receipts.",
    );
  if (
    state.operations.length > 0 ||
    Object.values(state.undoStackByActor).some((stack) => stack.length > 0) ||
    Object.values(state.redoStackByActor).some((stack) => stack.length > 0)
  )
    throw new DrawingCadImportClientError(
      "CAD import canonical receipts cannot be merged into existing history.",
    );

  const operations = missing.map((operation) => {
    const receipt = receipts[operation.forward.historyGroup.index];
    const realizedVersions = Object.fromEntries(
      Object.entries(receipt.resultVersions).map(([id, version]) => {
        if (version === null)
          throw new DrawingCadImportClientError(
            "CAD import canonical receipt has an unsupported deletion result.",
          );
        return [id, version];
      }),
    );
    return {
      clientOperationId: operation.clientOperationId,
      revisionId: operation.revisionId,
      type: operation.type,
      actorId,
      baseVersions: operation.baseVersions,
      forward: operation.forward,
      inverse: operation.inverse,
      createdAt: operation.createdAt,
      resultVersions: receipt.resultVersions,
      realizedVersions,
      undoable: true,
    } satisfies DrawingRecordedOperation;
  });
  return {
    ...state,
    operations,
    undoStackByActor: {
      ...state.undoStackByActor,
      [actorId]: operations.map((operation) => operation.clientOperationId),
    },
    redoStackByActor: { ...state.redoStackByActor, [actorId]: [] },
  };
}

function inverseEntity(
  operation: DrawingCadPlannedOperation,
  action: DrawingStructureAction,
): StructureEntity | undefined {
  if (action.baseVersion === null) return undefined;
  const targetId = actionId(action);
  const inverse = operation.inverse.actions.find(
    (candidate) => actionId(candidate) === targetId,
  );
  if (!inverse || !("entity" in inverse))
    throw new DrawingCadImportClientError(
      "CAD import update is missing its exact prior entity.",
    );
  return inverse.entity as StructureEntity;
}

/** Infers the only exact materialized prefix when operation receipts were compacted. */
function materializedPrefix(
  state: DrawingDocumentState,
  operations: DrawingCadPlannedOperation[],
): number | null {
  const firstActions = new Map<string, DrawingStructureAction>();
  const operationForTarget = new Map<string, DrawingCadPlannedOperation>();
  for (const operation of operations)
    for (const action of operation.forward.actions) {
      const id = actionId(action);
      if (!firstActions.has(id)) {
        firstActions.set(id, action);
        operationForTarget.set(id, operation);
      }
    }

  const expected = new Map<string, StructureEntity | undefined>();
  for (const [id, action] of firstActions)
    expected.set(id, inverseEntity(operationForTarget.get(id)!, action));
  const snapshots = [new Map(expected)];
  for (const operation of operations) {
    for (const action of operation.forward.actions)
      expected.set(actionId(action), resultEntity(action));
    snapshots.push(new Map(expected));
  }

  const matches = snapshots.flatMap((snapshot, prefix) => {
    const exact = [...firstActions].every(([id, action]) => {
      const current = currentEntity(state, action);
      if (
        current === undefined &&
        state.structure?.tombstones?.[id] !== undefined
      )
        return false;
      return sameDrawingCanonicalValue(current, snapshot.get(id));
    });
    return exact ? [prefix] : [];
  });
  return matches.length === 1 ? matches[0] : null;
}

function entityWithoutVersion(entity: StructureEntity) {
  const { version: _version, ...value } = entity;
  return value;
}

/** Classifies committed create-only plans without inventing compacted history. */
function historicalCanonicalDisposition(
  state: DrawingDocumentState,
  operations: DrawingCadPlannedOperation[],
) {
  if (operations.length === 0) return null;
  const firstActions = new Map<string, DrawingStructureAction>();
  const finalEntities = new Map<string, StructureEntity | undefined>();
  for (const operation of operations)
    for (const action of operation.forward.actions) {
      const id = actionId(action);
      if (!firstActions.has(id)) firstActions.set(id, action);
      finalEntities.set(id, resultEntity(action));
    }
  if (
    [...firstActions.values()].some((action) => action.baseVersion !== null) ||
    [...finalEntities.values()].some((entity) => entity === undefined)
  )
    return null;

  const targets = [...firstActions].map(([id, action]) => ({
    current: currentEntity(state, action),
    expected: finalEntities.get(id)!,
  }));
  if (targets.every(({ current }) => current === undefined))
    return "reverted" as const;
  if (
    targets.every(
      ({ current, expected }) =>
        current !== undefined &&
        current.version > expected.version &&
        sameDrawingCanonicalValue(
          entityWithoutVersion(current),
          entityWithoutVersion(expected),
        ),
    )
  )
    return "history_advanced" as const;
  return null;
}

/**
 * Rebuilds one server-planned CAD mutation with the current actor. The caller
 * can pass the returned `applied` value directly to a collaboration bridge.
 */
export function applyDrawingCadImportOperation(
  config: DrawingCadImportClientConfig<unknown>,
  state: DrawingDocumentState,
  actorId: string,
  plannedInput: unknown,
): DrawingCadImportOperationResult {
  const actor = ActorIdSchema.parse(actorId);
  const planned = exactPlannedOperation(plannedInput);
  assertPlannedKind(config, planned);
  assertRevision(state, planned);
  if (existingOperation(state, actor, planned))
    return { kind: "already_applied", state };
  if (operationIsMaterialized(state, planned))
    return { kind: "already_materialized", state };

  const applied = applyDrawingCommand(
    state,
    {
      type: "mutate_structure",
      actorId: actor,
      actions: planned.forward.actions,
      historyGroup: planned.forward.historyGroup,
    },
    {
      createId: () => planned.clientOperationId,
      now: () => planned.createdAt,
    },
  );
  if (
    !sameDrawingCanonicalValue(
      recordedOperationInput(applied.operation),
      planned,
    )
  )
    throw new DrawingCadImportClientError(
      "CAD import plan does not match the regenerated operation.",
    );
  return { kind: "applied", applied };
}

/** Applies an exact operation sequence while preserving prefix-resume IDs. */
export async function applyDrawingCadImportOperations(
  config: DrawingCadImportClientConfig<unknown>,
  state: DrawingDocumentState,
  actorId: string,
  plannedInputs: readonly unknown[],
  canonicalReceiptInputs: readonly unknown[] = [],
): Promise<AppliedDrawingCadImportOperations> {
  const actor = ActorIdSchema.parse(actorId);
  const planned = plannedInputs.map(exactPlannedOperation);
  const ids = new Set<string>();
  for (const operation of planned) {
    assertPlannedKind(config, operation);
    assertRevision(state, operation);
    if (ids.has(operation.clientOperationId))
      throw new DrawingCadImportClientError(
        "CAD import plan contains a duplicate operation ID.",
      );
    ids.add(operation.clientOperationId);
  }
  if (planned.length > 0) assertHomogeneousSourceIdentity(config, planned);
  for (const [index, operation] of planned.entries()) {
    const group = operation.forward.historyGroup;
    if (
      group.id !== planned[0]?.forward.historyGroup.id ||
      group.index !== index ||
      group.count !== planned.length ||
      !sameDrawingCanonicalValue(operation.inverse.historyGroup, group)
    )
      throw new DrawingCadImportClientError(
        "CAD import history group is incomplete or out of order.",
      );
  }

  // A canonical reload may contain the exact entities but no compacted local
  // operation ledger. Resolve that state once for the whole ordered plan so a
  // later layer finalization can supersede the initial staging layer.
  const recorded = planned.map((operation) =>
    existingOperation(state, actor, operation),
  );
  const prefix = materializedPrefix(state, planned);
  const canonicalReceipts = await exactCanonicalReceipts(
    canonicalReceiptInputs,
    actor,
    planned,
  );
  assertRecoverableHistory(state, actor, planned, recorded);
  const canonicalDisposition =
    (prefix === null || prefix === 0) &&
    canonicalReceipts.length === planned.length
      ? historicalCanonicalDisposition(state, planned)
      : null;
  if (canonicalDisposition)
    return {
      state,
      applied: [],
      alreadyAppliedOperationIds: [],
      alreadyMaterializedOperationIds:
        canonicalDisposition === "history_advanced"
          ? planned.map((operation) => operation.clientOperationId)
          : [],
      canonicalHistoryState: null,
      canonicalDisposition,
    };
  if (
    canonicalReceipts.length > 0 &&
    (prefix === null || canonicalReceipts.length !== prefix)
  )
    throw new DrawingCadImportClientError(
      "CAD import canonical receipts do not match the materialized prefix.",
    );

  const recoveredHistoryState =
    prefix === null
      ? state
      : recoverOriginalReceipts(
          state,
          actor,
          planned,
          canonicalReceipts,
          prefix,
          recorded,
        );
  let next = recoveredHistoryState;
  const applied: AppliedDrawingCommand[] = [];
  const alreadyAppliedOperationIds: string[] = [];
  const alreadyMaterializedOperationIds: string[] = [];
  for (const [index, operation] of planned.entries()) {
    if (prefix !== null && index < prefix && !recorded[index]) {
      alreadyMaterializedOperationIds.push(operation.clientOperationId);
      continue;
    }
    const result = applyDrawingCadImportOperation(
      config,
      next,
      actor,
      operation,
    );
    if (result.kind === "already_applied") {
      alreadyAppliedOperationIds.push(operation.clientOperationId);
      next = result.state;
    } else if (result.kind === "already_materialized") {
      alreadyMaterializedOperationIds.push(operation.clientOperationId);
      next = result.state;
    } else {
      applied.push(result.applied);
      next = result.applied.state;
    }
  }
  return {
    state: next,
    applied,
    alreadyAppliedOperationIds,
    alreadyMaterializedOperationIds,
    canonicalHistoryState:
      recoveredHistoryState === state ? null : recoveredHistoryState,
    canonicalDisposition: "current",
  };
}

/** Binds one CAD source format to the shared exact-operation kernel. */
export function createDrawingCadImportClient<Request>(
  config: DrawingCadImportClientConfig<Request>,
) {
  return {
    applyOperation(
      state: DrawingDocumentState,
      actorId: string,
      plannedInput: unknown,
    ) {
      return applyDrawingCadImportOperation(
        config,
        state,
        actorId,
        plannedInput,
      );
    },
    applyOperations(
      state: DrawingDocumentState,
      actorId: string,
      plannedInputs: readonly unknown[],
      canonicalReceiptInputs: readonly unknown[] = [],
    ) {
      return applyDrawingCadImportOperations(
        config,
        state,
        actorId,
        plannedInputs,
        canonicalReceiptInputs,
      );
    },
    attestQueuedGroupBeforeSend(input: {
      operation: unknown;
      knownOperations: readonly unknown[];
      prepare: DrawingCadQueuedGroupPrepare<Request>;
    }) {
      return attestQueuedDrawingCadGroupBeforeSend({ config, ...input });
    },
    createSendGate() {
      return createDrawingCadImportSendGate(config);
    },
  };
}
