import * as Y from "yjs";

import {
  DRAWING_COLLABORATION_LIMITS,
  DrawingCollaborationClientAppendSchema,
  DrawingCollaborationOperationOrderSchema,
  DrawingCollaborationOperationSchema,
  type DrawingCollaborationLedger,
  type DrawingCollaborationOperation,
} from "./drawing-collaboration-protocol.ts";

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

/** Reads every append contribution. Y.Array keeps concurrent same-ID values visible. */
export function readDrawingCollaborationLedger(
  document: Y.Doc,
): DrawingCollaborationLedger {
  const rawOperations = document.getArray<unknown>("operations").toArray();
  const rawOrder = document.getArray<unknown>("operationOrder").toArray();
  if (rawOperations.length > DRAWING_COLLABORATION_LIMITS.maxOperations)
    throw new Error("Too many drawing operation contributions.");
  const operationOrder =
    DrawingCollaborationOperationOrderSchema.parse(rawOrder);
  const operations: Record<string, DrawingCollaborationOperation> = {};
  const contributionIds: string[] = [];
  for (const rawOperation of rawOperations) {
    const operation = DrawingCollaborationOperationSchema.parse(rawOperation);
    contributionIds.push(operation.clientOperationId);
    const existing = operations[operation.clientOperationId];
    if (existing && !same(existing, operation))
      throw new Error(
        "Drawing operation ID has mismatched concurrent envelopes.",
      );
    operations[operation.clientOperationId] = operation;
  }
  if (!same(contributionIds.sort(), (rawOrder as string[]).slice().sort()))
    throw new Error(
      "Drawing operation envelopes and order multiplicities must match.",
    );
  return DrawingCollaborationClientAppendSchema.parse({
    operationOrder,
    operations,
  });
}

export function appendDrawingCollaborationOperation(
  document: Y.Doc,
  operation: DrawingCollaborationOperation,
) {
  document
    .getArray<DrawingCollaborationOperation>("operations")
    .push([operation]);
  document
    .getArray<string>("operationOrder")
    .push([operation.clientOperationId]);
}
