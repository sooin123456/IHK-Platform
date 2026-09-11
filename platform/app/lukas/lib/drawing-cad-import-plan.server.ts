import { createHash } from "node:crypto";

import {
  DRAWING_COLLABORATION_SCHEMA_VERSION,
  DrawingCollaborationOperationSchema,
} from "./drawing-collaboration-protocol.ts";
import {
  DrawingOperationInputSchema,
  type DrawingHistoryGroup,
  type DrawingObject,
  type DrawingObjectSource,
  type DrawingOperationInput,
  type DrawingStructureAction,
  type DrawingStructureLayer,
} from "./drawing-workspace.types.ts";

export const DRAWING_CAD_IMPORT_PLAN_LIMITS = Object.freeze({
  maxOperations: 48,
  maxSerializedBytes: 3 * 1024 * 1024,
});

const dummyActorId = "72000000-0000-4000-8000-000000000000";

function deterministicUuid(seed: string) {
  const bytes = createHash("sha256").update(seed).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function deterministicCreatedAt(requestId: string) {
  const seed = requestId.replaceAll("-", "").slice(0, 12);
  const twentyYearsInMilliseconds = 20 * 365 * 24 * 60 * 60 * 1_000;
  const offset = Number.parseInt(seed, 16) % twentyYearsInMilliseconds;
  return new Date(Date.UTC(2000, 0, 1) + offset).toISOString();
}

function operationFits(operation: DrawingOperationInput) {
  return DrawingCollaborationOperationSchema.safeParse({
    ...operation,
    actorId: dummyActorId,
    schemaVersion: DRAWING_COLLABORATION_SCHEMA_VERSION,
  }).success;
}

function makeOperation(input: {
  requestId: string;
  revisionId: string;
  historyKind: DrawingHistoryGroup["kind"];
  createdAt: string;
  phase: string;
  chunkIndex: number;
  forward: DrawingStructureAction[];
  inverse: DrawingStructureAction[];
}) {
  const historyGroup = {
    id: input.requestId,
    kind: input.historyKind,
    index: DRAWING_CAD_IMPORT_PLAN_LIMITS.maxOperations - 1,
    count: DRAWING_CAD_IMPORT_PLAN_LIMITS.maxOperations,
  };
  const baseVersions = Object.fromEntries(
    input.forward.flatMap((action) =>
      action.baseVersion === null
        ? []
        : [["id" in action ? action.id : action.entity.id, action.baseVersion]],
    ),
  );
  return DrawingOperationInputSchema.parse({
    clientOperationId: deterministicUuid(
      `${input.requestId}:operation:${input.phase}:${input.chunkIndex}`,
    ),
    revisionId: input.revisionId,
    type: "mutate_structure",
    baseVersions,
    forward: {
      type: "mutate_structure",
      actions: input.forward,
      historyGroup,
    },
    inverse: {
      type: "mutate_structure",
      actions: input.inverse,
      historyGroup,
    },
    createdAt: input.createdAt,
  });
}

function chunkAtomic<T>(input: {
  items: readonly T[];
  requestId: string;
  revisionId: string;
  historyKind: DrawingHistoryGroup["kind"];
  createdAt: string;
  phase: string;
  actions: (items: readonly T[]) => {
    forward: DrawingStructureAction[];
    inverse: DrawingStructureAction[];
  };
}) {
  const operations: DrawingOperationInput[] = [];
  let chunk: T[] = [];
  const operationFor = (items: readonly T[]) =>
    makeOperation({
      requestId: input.requestId,
      revisionId: input.revisionId,
      historyKind: input.historyKind,
      createdAt: input.createdAt,
      phase: input.phase,
      chunkIndex: operations.length,
      ...input.actions(items),
    });
  for (const item of input.items) {
    const candidate = [...chunk, item];
    if (operationFits(operationFor(candidate))) {
      chunk = candidate;
      continue;
    }
    if (chunk.length === 0) throw new Error("PLAN_OPERATION_ITEM_LIMIT");
    operations.push(operationFor(chunk));
    chunk = [item];
    if (!operationFits(operationFor(chunk)))
      throw new Error("PLAN_OPERATION_ITEM_LIMIT");
  }
  if (chunk.length > 0) operations.push(operationFor(chunk));
  return operations;
}

export function buildDrawingCadImportPlanPhases(input: {
  requestId: string;
  revisionId: string;
  historyKind: DrawingHistoryGroup["kind"];
  layers: readonly DrawingStructureLayer[];
  records: readonly { object: DrawingObject; source: DrawingObjectSource }[];
}): { layers: DrawingStructureLayer[]; operations: DrawingOperationInput[] } {
  const createdAt = deterministicCreatedAt(input.requestId);
  const initialLayers = input.layers.map((layer) => ({
    ...layer,
    visible: true,
    locked: false,
    version: 1,
  }));
  const finalized = input.layers.map((layer, index) => ({
    initial: initialLayers[index],
    final:
      layer.visible && !layer.locked
        ? initialLayers[index]
        : { ...layer, version: 2 },
    update: { ...layer, version: 1 },
  }));
  const common = {
    requestId: input.requestId,
    revisionId: input.revisionId,
    historyKind: input.historyKind,
    createdAt,
  };
  let operations = [
    ...chunkAtomic({
      ...common,
      phase: "layers:create",
      items: initialLayers,
      actions: (layers) => ({
        forward: layers.map((layer) => ({
          kind: "put_layer" as const,
          entity: layer,
          baseVersion: null,
        })),
        inverse: [...layers].reverse().map((layer) => ({
          kind: "delete_layer" as const,
          id: layer.id,
          baseVersion: 1,
        })),
      }),
    }),
    ...chunkAtomic({
      ...common,
      phase: "objects:sources",
      items: input.records,
      actions: (records) => ({
        forward: records.flatMap(({ object, source }) => [
          { kind: "put_object" as const, entity: object, baseVersion: null },
          { kind: "put_source" as const, entity: source, baseVersion: null },
        ]),
        inverse: [...records].reverse().flatMap(({ object, source }) => [
          { kind: "delete_source" as const, id: source.id, baseVersion: 1 },
          { kind: "delete_object" as const, id: object.id, baseVersion: 1 },
        ]),
      }),
    }),
    ...chunkAtomic({
      ...common,
      phase: "layers:finalize",
      items: finalized.filter(({ initial, final }) => final !== initial),
      actions: (layers) => ({
        forward: layers.map(({ update }) => ({
          kind: "put_layer" as const,
          entity: update,
          baseVersion: 1,
        })),
        inverse: [...layers].reverse().map(({ initial }) => ({
          kind: "put_layer" as const,
          entity: initial,
          baseVersion: 2,
        })),
      }),
    }),
  ];
  operations = operations.map((operation, index) => {
    const historyGroup = {
      id: input.requestId,
      kind: input.historyKind,
      index,
      count: operations.length,
    };
    return DrawingOperationInputSchema.parse({
      ...operation,
      forward: { ...operation.forward, historyGroup },
      inverse: { ...operation.inverse, historyGroup },
    });
  });
  if (operations.some((operation) => !operationFits(operation)))
    throw new Error("PLAN_OPERATION_ITEM_LIMIT");
  return { layers: finalized.map(({ final }) => final), operations };
}
