import { createHash } from "node:crypto";

import { z } from "zod";

import { drawingCollaborationOperationDigestSource } from "./drawing-collaboration-protocol.ts";
import { sameDrawingCanonicalValue } from "./drawing-structure.ts";
import {
  DrawingHistoryGroupSchema,
  DrawingOperationInputSchema,
  DrawingStructureActionSchema,
  type DrawingOperationInput,
} from "./drawing-workspace.types.ts";

const Uuid = z.string().uuid();
const StoredOperationSchema = z
  .object({
    project_id: Uuid,
    revision_id: Uuid,
    client_operation_id: Uuid,
    operation_type: z.literal("mutate_structure"),
    base_versions: z.record(Uuid, z.number().int().positive()),
    forward: z.record(z.string(), z.unknown()),
    inverse: z.record(z.string(), z.unknown()),
    result_versions: z.record(Uuid, z.number().int().positive().nullable()),
    actor_id: Uuid,
    history_action: z.null(),
    original_operation_id: z.null(),
    sequence: z.number().int().safe().positive(),
  })
  .strict();
const StructurePayloadSchema = z
  .object({
    type: z.literal("mutate_structure"),
    actions: z.array(DrawingStructureActionSchema).min(1),
    historyGroup: DrawingHistoryGroupSchema,
  })
  .strict();

export type DrawingCadImportCanonicalReceipt = {
  clientOperationId: string;
  revisionId: string;
  actorId: string;
  sequence: number;
  resultVersions: Record<string, number | null>;
  operationSha256: string;
};

type ReceiptError = (message: string, status?: 400 | 503) => Error;

function plannedResultVersions(operation: DrawingOperationInput) {
  if (operation.type !== "mutate_structure")
    throw new Error("canonical operation type is invalid");
  const forward = StructurePayloadSchema.safeParse(operation.forward);
  if (!forward.success)
    throw new Error("canonical operation payload is invalid");
  const entries = forward.data.actions.map(
    (action) =>
      [
        "entity" in action ? action.entity.id : action.id,
        "entity" in action
          ? action.baseVersion === null
            ? action.entity.version
            : action.baseVersion + 1
          : null,
      ] as const,
  );
  if (new Set(entries.map(([id]) => id)).size !== entries.length)
    throw new Error("canonical operation target is duplicated");
  return Object.fromEntries(entries);
}

export async function loadDrawingCadImportCanonicalReceipts(
  client: { from: (...args: never[]) => unknown },
  input: {
    projectId: string;
    revisionId: string;
    actorId: string;
    operations: DrawingOperationInput[];
    maxOperations: number;
  },
  fail: ReceiptError,
): Promise<DrawingCadImportCanonicalReceipt[]> {
  if (input.operations.length === 0) return [];
  const operationIds = input.operations.map(
    (operation) => operation.clientOperationId,
  );
  const query = Reflect.apply(client.from, client, [
    "lukas_drawing_operations",
  ]);
  const { data, error } = await query
    .select(
      "project_id,revision_id,client_operation_id,operation_type,base_versions,forward,inverse,result_versions,actor_id,history_action,original_operation_id,sequence",
    )
    .eq("project_id", input.projectId)
    .eq("revision_id", input.revisionId)
    .in("client_operation_id", operationIds)
    .order("sequence", { ascending: true })
    .limit(input.maxOperations + 1);
  if (error) throw fail("canonical operation receipt lookup failed", 503);
  if (!Array.isArray(data))
    throw fail("canonical operation receipt response is invalid");

  const rows = data.map((value) => {
    const parsed = StoredOperationSchema.safeParse(value);
    if (!parsed.success || !sameDrawingCanonicalValue(parsed.data, value))
      throw fail("canonical operation receipt is malformed");
    return parsed.data;
  });
  if (rows.length > input.operations.length)
    throw fail("canonical operation receipt prefix is too large");

  return rows.map((row, index) => {
    const operation = input.operations[index];
    const storedEnvelope = DrawingOperationInputSchema.safeParse({
      clientOperationId: row.client_operation_id,
      revisionId: row.revision_id,
      type: row.operation_type,
      baseVersions: row.base_versions,
      forward: row.forward,
      inverse: row.inverse,
      createdAt: operation?.createdAt,
    });
    let resultVersions: Record<string, number | null>;
    try {
      resultVersions = operation ? plannedResultVersions(operation) : {};
    } catch {
      throw fail("canonical operation receipt plan is invalid");
    }
    if (
      !operation ||
      !storedEnvelope.success ||
      row.project_id !== input.projectId ||
      row.revision_id !== input.revisionId ||
      row.actor_id !== input.actorId ||
      row.client_operation_id !== operation.clientOperationId ||
      (index > 0 && rows[index - 1].sequence >= row.sequence) ||
      !sameDrawingCanonicalValue(storedEnvelope.data, operation) ||
      !sameDrawingCanonicalValue(row.result_versions, resultVersions)
    )
      throw fail(
        "canonical operation receipt does not match the planned prefix",
      );
    const storedDigest = drawingCollaborationOperationDigestSource(
      storedEnvelope.data,
      row.actor_id,
    );
    const plannedDigest = drawingCollaborationOperationDigestSource(
      operation,
      input.actorId,
    );
    if (storedDigest !== plannedDigest)
      throw fail("canonical operation receipt digest is invalid");
    return {
      clientOperationId: row.client_operation_id,
      revisionId: row.revision_id,
      actorId: row.actor_id,
      sequence: row.sequence,
      resultVersions: row.result_versions,
      operationSha256: createHash("sha256").update(storedDigest).digest("hex"),
    };
  });
}
