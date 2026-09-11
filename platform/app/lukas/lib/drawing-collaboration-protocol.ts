import { z } from "zod";

import type { DrawingWorkspaceCapability } from "./drawing-workspace.server.ts";
import {
  DrawingOperationInputSchema,
  type DrawingOperationInput,
} from "./drawing-workspace.types.ts";

export const DRAWING_COLLABORATION_SCHEMA_VERSION = 1 as const;
export const DRAWING_COLLABORATION_RECONSTRUCTED_CREATED_AT =
  "1970-01-01T00:00:00.000Z" as const;
export const DRAWING_COLLABORATION_SERVER_ORIGIN = Symbol(
  "drawing-collaboration-server",
);
export const DRAWING_COLLABORATION_SERVER_OWNED_COLLECTIONS = [
  "serverMeta",
  "operationStatus",
] as const;
export const DRAWING_COLLABORATION_CLIENT_APPEND_ONLY_COLLECTIONS = [
  "operationOrder",
  "operations",
] as const;
export const DRAWING_COLLABORATION_COLLECTIONS = [
  "operationOrder",
  "operationStatus",
  "operations",
  "serverMeta",
] as const;

export const DRAWING_COLLABORATION_LIMITS = {
  maxOperationBytes: 64 * 1024,
  maxOperations: 10_000,
  maxOperationContributions: 20_000,
  maxBaseVersions: 256,
  maxActionItems: 256,
  maxResultVersions: 256,
  maxSelectedIds: 100,
  maxSoftLocks: 50,
  maxDisplayNameLength: 120,
  maxActiveToolLength: 64,
} as const;

const CanonicalUuidSchema = z
  .string()
  .regex(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  );
const PositiveIntegerSchema = z.number().int().positive().safe();
const NonNegativeIntegerSchema = z.number().int().nonnegative().safe();

function canonicalUuid(value: unknown): string {
  return CanonicalUuidSchema.parse(value);
}

export function drawingRoomName(projectId: string, revisionId: string): string {
  return `drawing:${canonicalUuid(projectId)}:${canonicalUuid(revisionId)}`;
}

export function parseDrawingRoomName(roomName: string): {
  projectId: string;
  revisionId: string;
} {
  const matched = /^drawing:([^:]+):([^:]+)$/.exec(roomName);
  if (!matched) throw new Error("Drawing collaboration room name is invalid.");
  return {
    projectId: canonicalUuid(matched[1]),
    revisionId: canonicalUuid(matched[2]),
  };
}

const FreezeStateSchema = z.enum(["active", "freezing", "frozen", "released"]);

export const DrawingCollaborationMetaSchema = z
  .object({
    schemaVersion: z.literal(DRAWING_COLLABORATION_SCHEMA_VERSION),
    projectId: CanonicalUuidSchema,
    revisionId: CanonicalUuidSchema,
    baseSnapshotSha256: z.string().regex(/^[0-9a-f]{64}$/),
    baseOperationSequence: NonNegativeIntegerSchema,
    freezeState: FreezeStateSchema,
    freezeRequestId: CanonicalUuidSchema.nullable(),
  })
  .strict();

export type DrawingCollaborationMeta = z.infer<
  typeof DrawingCollaborationMetaSchema
>;

export const DrawingCollaborationStatusSchema = z
  .object({
    operationId: CanonicalUuidSchema,
    status: z.enum(["pending", "acked", "conflicted", "rejected"]),
    authoritativeSequence: PositiveIntegerSchema.nullable(),
    resultVersions: z.record(
      CanonicalUuidSchema,
      PositiveIntegerSchema.nullable(),
    ),
  })
  .strict()
  .superRefine((status, context) => {
    if (
      Object.keys(status.resultVersions).length >
      DRAWING_COLLABORATION_LIMITS.maxResultVersions
    )
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Too many result versions.",
      });
    if (status.status === "acked" && status.authoritativeSequence == null)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["authoritativeSequence"],
        message: "Acknowledged operations require an authoritative sequence.",
      });
    if (status.status !== "acked" && status.authoritativeSequence != null)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["authoritativeSequence"],
        message: "Only acknowledged operations have an authoritative sequence.",
      });
  });

export type DrawingCollaborationOperation = DrawingOperationInput & {
  actorId: string;
  schemaVersion: typeof DRAWING_COLLABORATION_SCHEMA_VERSION;
};

type DrawingCollaborationOperationDigestInput = Pick<
  DrawingOperationInput,
  | "baseVersions"
  | "clientOperationId"
  | "forward"
  | "inverse"
  | "revisionId"
  | "type"
> &
  Partial<Pick<DrawingOperationInput, "historyAction" | "originalOperationId">>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value))
      throw new RangeError("Drawing operation digest number is invalid.");
    return JSON.stringify(value);
  }
  if (Array.isArray(value))
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  if (isRecord(value))
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  throw new RangeError("Drawing operation digest value is invalid.");
}

/** Immutable operation body shared by Postgres receipts and local recovery. */
export function drawingCollaborationOperationDigestSource(
  operation: DrawingCollaborationOperationDigestInput,
  actorId: string,
) {
  if (
    Boolean(operation.historyAction) !== Boolean(operation.originalOperationId)
  )
    throw new Error("Drawing operation history digest is incomplete.");
  return canonicalJson({
    actorId: canonicalUuid(actorId),
    baseVersions: operation.baseVersions,
    clientOperationId: operation.clientOperationId,
    forward: operation.forward,
    ...(operation.historyAction && operation.originalOperationId
      ? {
          historyAction: operation.historyAction,
          originalOperationId: operation.originalOperationId,
        }
      : {}),
    inverse: operation.inverse,
    revisionId: operation.revisionId,
    schemaVersion: DRAWING_COLLABORATION_SCHEMA_VERSION,
    type: operation.type,
  });
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]) {
  const actual = Object.keys(value).sort();
  return (
    actual.length === keys.length &&
    actual.every((key, index) => key === keys[index])
  );
}

function report(
  context: z.RefinementCtx,
  path: (string | number)[],
  message: string,
) {
  context.addIssue({ code: z.ZodIssueCode.custom, path, message });
}

function hasBoundedArrays(value: unknown): boolean {
  if (Array.isArray(value))
    return (
      value.length <= DRAWING_COLLABORATION_LIMITS.maxActionItems &&
      value.every(hasBoundedArrays)
    );
  return !isRecord(value) || Object.values(value).every(hasBoundedArrays);
}

const operationKeys = [
  "actorId",
  "baseVersions",
  "clientOperationId",
  "createdAt",
  "forward",
  "inverse",
  "revisionId",
  "schemaVersion",
  "type",
] as const;

const historyOperationKeys = [
  "actorId",
  "baseVersions",
  "clientOperationId",
  "createdAt",
  "forward",
  "historyAction",
  "inverse",
  "originalOperationId",
  "revisionId",
  "schemaVersion",
  "type",
] as const;

const DrawingCollaborationOperationValidatedSchema = z
  .unknown()
  .superRefine((value, context) => {
    if (
      !isRecord(value) ||
      (!hasExactKeys(value, operationKeys) &&
        !hasExactKeys(value, historyOperationKeys))
    ) {
      report(
        context,
        [],
        "Drawing collaboration operations have exact fields.",
      );
      return;
    }
    if (!CanonicalUuidSchema.safeParse(value.actorId).success)
      report(
        context,
        ["actorId"],
        "Drawing collaboration actor must be a canonical UUID.",
      );
    if (value.schemaVersion !== DRAWING_COLLABORATION_SCHEMA_VERSION)
      report(
        context,
        ["schemaVersion"],
        "Unsupported drawing collaboration schema version.",
      );
    const {
      actorId: _actorId,
      schemaVersion: _schemaVersion,
      ...operation
    } = value;
    const parsed = DrawingOperationInputSchema.safeParse(operation);
    if (!parsed.success) {
      report(
        context,
        [],
        "Drawing operation does not match the existing canonical contract.",
      );
      return;
    }
    if (
      Object.keys(parsed.data.baseVersions).length >
      DRAWING_COLLABORATION_LIMITS.maxBaseVersions
    )
      report(
        context,
        ["baseVersions"],
        "Too many drawing operation base versions.",
      );
    if (
      !hasBoundedArrays(parsed.data.forward) ||
      !hasBoundedArrays(parsed.data.inverse)
    )
      report(
        context,
        [],
        "Drawing operation action collection exceeds its limit.",
      );
    if (
      new TextEncoder().encode(JSON.stringify(value)).byteLength >
      DRAWING_COLLABORATION_LIMITS.maxOperationBytes
    )
      report(
        context,
        [],
        "Drawing collaboration operation exceeds its byte limit.",
      );
  });

export const DrawingCollaborationOperationSchema =
  DrawingCollaborationOperationValidatedSchema as z.ZodType<DrawingCollaborationOperation>;

/**
 * Reconstructs only checkpoint outcomes that are also valid live-ledger entries.
 * A null result is still a valid authoritative operation: its effects already
 * live in the SHA-bound canonical snapshot and must not weaken live limits.
 */
export function drawingCollaborationOperationFromSnapshotOutcome(outcome: {
  clientOperationId: unknown;
  revisionId: unknown;
  actorId: unknown;
  operationType: unknown;
  baseVersions: unknown;
  forward: unknown;
  inverse: unknown;
  originalOperationId?: unknown;
  historyAction?: unknown;
}) {
  const operation = DrawingOperationInputSchema.parse({
    clientOperationId: outcome.clientOperationId,
    revisionId: outcome.revisionId,
    type: outcome.operationType,
    baseVersions: outcome.baseVersions,
    forward: outcome.forward,
    inverse: outcome.inverse,
    createdAt: DRAWING_COLLABORATION_RECONSTRUCTED_CREATED_AT,
    ...(outcome.originalOperationId === undefined
      ? {}
      : { originalOperationId: outcome.originalOperationId }),
    ...(outcome.historyAction === undefined
      ? {}
      : { historyAction: outcome.historyAction }),
  });
  const parsed = DrawingCollaborationOperationSchema.safeParse({
    ...operation,
    actorId: canonicalUuid(outcome.actorId),
    schemaVersion: DRAWING_COLLABORATION_SCHEMA_VERSION,
  });
  return parsed.success ? parsed.data : null;
}

export const DrawingCollaborationOperationOrderSchema = z
  .array(CanonicalUuidSchema)
  .max(DRAWING_COLLABORATION_LIMITS.maxOperationContributions)
  .superRefine((operationIds, context) => {
    if (new Set(operationIds).size > DRAWING_COLLABORATION_LIMITS.maxOperations)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Too many unique drawing operations.",
      });
  })
  .transform((operationIds) => [...new Set(operationIds)]);

const DrawingCollaborationLedgerSchema = z
  .object({
    operationOrder: DrawingCollaborationOperationOrderSchema,
    operations: z.record(
      CanonicalUuidSchema,
      DrawingCollaborationOperationSchema,
    ),
  })
  .strict()
  .superRefine((ledger, context) => {
    const operationIds = Object.keys(ledger.operations).sort();
    const orderedIds = [...ledger.operationOrder].sort();
    if (
      operationIds.length !== orderedIds.length ||
      operationIds.some((id, index) => id !== orderedIds[index])
    )
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Operation map and order must match exactly.",
      });
    for (const operationId of ledger.operationOrder) {
      if (ledger.operations[operationId]?.clientOperationId !== operationId)
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["operations", operationId],
          message: "Operation map key must equal client operation ID.",
        });
    }
  });

/** The only document collections a browser may author; server collections are absent. */
export const DrawingCollaborationClientAppendSchema =
  DrawingCollaborationLedgerSchema;

export type DrawingCollaborationLedger = z.infer<
  typeof DrawingCollaborationLedgerSchema
>;

function sameJsonValue(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right))
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => sameJsonValue(value, right[index]))
    );
  if (!isRecord(left) || !isRecord(right)) return false;
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every(
      (key, index) =>
        key === rightKeys[index] && sameJsonValue(left[key], right[key]),
    )
  );
}

/**
 * Postgres stores the durable operation body but not the client's clock. A
 * restart therefore reconstructs that one non-authoritative field with the
 * reserved epoch while every state-bearing field remains immutable.
 */
export function resolveDrawingCollaborationOperation(
  left: DrawingCollaborationOperation,
  right: DrawingCollaborationOperation,
): DrawingCollaborationOperation | null {
  if (sameJsonValue(left, right)) return left;
  const leftReconstructed =
    left.createdAt === DRAWING_COLLABORATION_RECONSTRUCTED_CREATED_AT;
  const rightReconstructed =
    right.createdAt === DRAWING_COLLABORATION_RECONSTRUCTED_CREATED_AT;
  if (leftReconstructed === rightReconstructed) return null;
  const { createdAt: _leftCreatedAt, ...leftDurable } = left;
  const { createdAt: _rightCreatedAt, ...rightDurable } = right;
  if (!sameJsonValue(leftDurable, rightDurable)) return null;
  return leftReconstructed ? right : left;
}

/** Validates the bounded append-only suffix that a verified editor may contribute. */
export function validateDrawingCollaborationAppend(
  currentValue: unknown,
  nextValue: unknown,
  verifiedActorId: string,
  roomName: string,
): DrawingCollaborationLedger {
  const current = DrawingCollaborationLedgerSchema.parse(currentValue);
  const next = DrawingCollaborationLedgerSchema.parse(nextValue);
  const actorId = CanonicalUuidSchema.parse(verifiedActorId);
  const room = parseDrawingRoomName(roomName);
  if (
    next.operationOrder.length === current.operationOrder.length &&
    sameJsonValue(next.operationOrder, current.operationOrder)
  ) {
    const operations: Record<string, DrawingCollaborationOperation> = {};
    for (const operationId of current.operationOrder) {
      const resolved = resolveDrawingCollaborationOperation(
        current.operations[operationId],
        next.operations[operationId],
      );
      if (!resolved)
        throw new Error("Existing drawing operations and order are immutable.");
      operations[operationId] = resolved;
    }
    return { operationOrder: next.operationOrder, operations };
  }
  if (next.operationOrder.length <= current.operationOrder.length)
    throw new Error("Client updates must append drawing operations.");
  const currentIds = new Set(current.operationOrder);
  const nextIds = new Set(next.operationOrder);
  const preservedOrder = next.operationOrder.filter((operationId) =>
    currentIds.has(operationId),
  );
  if (
    preservedOrder.length !== current.operationOrder.length ||
    preservedOrder.some(
      (operationId, index) => operationId !== current.operationOrder[index],
    )
  )
    throw new Error("Existing drawing operation order is immutable.");
  for (const operationId of current.operationOrder) {
    const resolved = nextIds.has(operationId)
      ? resolveDrawingCollaborationOperation(
          current.operations[operationId],
          next.operations[operationId],
        )
      : null;
    if (!resolved)
      throw new Error("Existing drawing operations and order are immutable.");
    next.operations[operationId] = resolved;
  }
  for (const appendedId of next.operationOrder.filter(
    (operationId) => !currentIds.has(operationId),
  )) {
    const appended = next.operations[appendedId];
    if (appended.actorId !== actorId)
      throw new Error("Client may append only its verified actor operations.");
    if (appended.revisionId !== room.revisionId)
      throw new Error(
        "Drawing operation revision must match the collaboration room.",
      );
  }
  return next;
}

const AwarenessUserSchema = z
  .object({
    id: CanonicalUuidSchema,
    displayName: z
      .string()
      .trim()
      .min(1)
      .max(DRAWING_COLLABORATION_LIMITS.maxDisplayNameLength),
    color: z.string().regex(/^#[0-9a-f]{6}$/i),
  })
  .strict();

const AwarenessSoftLockSchema = z
  .object({
    entityId: CanonicalUuidSchema,
    leaseId: CanonicalUuidSchema,
    expiresAt: PositiveIntegerSchema,
  })
  .strict();

export const DrawingAwarenessStateSchema = z
  .object({
    user: AwarenessUserSchema,
    pageId: CanonicalUuidSchema.nullable(),
    canvasId: CanonicalUuidSchema.nullable(),
    cursorWorld: z
      .object({ x: z.number().finite(), y: z.number().finite() })
      .strict()
      .nullable(),
    selectedIds: z
      .array(CanonicalUuidSchema)
      .max(DRAWING_COLLABORATION_LIMITS.maxSelectedIds),
    activeTool: z
      .string()
      .trim()
      .min(1)
      .max(DRAWING_COLLABORATION_LIMITS.maxActiveToolLength)
      .nullable(),
    softLocks: z
      .array(AwarenessSoftLockSchema)
      .max(DRAWING_COLLABORATION_LIMITS.maxSoftLocks),
  })
  .strict()
  .superRefine((state, context) => {
    if (new Set(state.selectedIds).size !== state.selectedIds.length)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["selectedIds"],
        message: "Selected IDs must be unique.",
      });
    if (
      new Set(state.softLocks.map((lock) => lock.entityId)).size !==
      state.softLocks.length
    )
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["softLocks"],
        message: "Soft locks must be unique by entity.",
      });
  });

export type DrawingAwarenessState = z.infer<typeof DrawingAwarenessStateSchema>;

export const drawingCollaborationWritableCapabilities = [
  "admin",
  "editor",
] as const satisfies readonly DrawingWorkspaceCapability[];
