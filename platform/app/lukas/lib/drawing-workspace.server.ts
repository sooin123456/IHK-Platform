import type { SupabaseClient } from "@supabase/supabase-js";
import { createHmac } from "node:crypto";
import type { Database, Json } from "database.types";
import { z } from "zod";
import {
  DRAWING_COLLABORATION_SCHEMA_VERSION,
  drawingRoomName,
} from "./drawing-collaboration-protocol.ts";

import {
  DrawingGeometrySchema,
  DrawingBlockInstanceSchema,
  DrawingBlockSchema,
  DrawingCanvasSchema,
  DrawingLayerInputSchema,
  DrawingLayerSchema,
  DrawingObjectNameSchema,
  DrawingObjectSchema,
  DrawingOperationInputSchema,
  DrawingPageSchema,
  DrawingPropertySchemaSchema,
  DrawingPropertyValueSchema,
  DrawingStructureActionSchema,
  DrawingStyleDefinitionSchema,
  DrawingStyleOverrideSchema,
  DrawingStructureLayerSchema,
  DrawingTableSchema,
} from "./drawing-workspace.types.ts";
import { validateDrawingSemanticReferences } from "./drawing-structure.ts";
import {
  deriveDrawingServerMeasurementEvidence,
  type DrawingServerMeasurementEvidence,
} from "./drawing-semantic-schedules.ts";
import type {
  DrawingBlockInstance,
  DrawingBlock,
  DrawingCanvas,
  DrawingLayer,
  DrawingObject,
  DrawingOperationInput,
  DrawingPage,
  DrawingPropertySchema,
  DrawingPropertyValue,
  DrawingStyleDefinition,
  DrawingTable,
} from "./drawing-workspace.types.ts";

type TableDefinition<Row, Insert = never, Update = never> = {
  Row: Row;
  Insert: Insert;
  Update: Update;
  Relationships: [];
};

export type DrawingWorkspaceCapability =
  "admin" | "editor" | "reviewer" | "commenter" | "viewer";

export type DrawingWorkspaceFile = {
  id: string;
  project_id: string;
  kind: "pdf" | "ifc";
  original_filename: string;
  storage_path: string;
  content_type: string | null;
  byte_size: number;
  sha256: string;
  immutable: boolean;
  created_at: string;
};

type DrawingDocumentRow = {
  id: string;
  project_id: string;
  source_file_id: string | null;
  source_sha256: string | null;
  title: string;
  created_by: string;
  created_at: string;
  updated_at: string;
};

type DrawingRevisionRow = {
  id: string;
  document_id: string;
  project_id: string;
  parent_revision_id: string | null;
  sequence: number;
  status: "draft" | "review_requested" | "approved" | "superseded";
  version: number;
  created_by: string;
  review_requested_at: string | null;
  approved_at: string | null;
  created_at: string;
  updated_at: string;
};

type DrawingPageRow = {
  id: string;
  revision_id: string;
  project_id: string;
  name: string;
  page_number: number;
  width_mm: number;
  height_mm: number;
  background_source_file_id: string | null;
  background_source_sha256: string | null;
  background_pdf_page: number | null;
  calibration: Json | null;
  created_at: string;
  updated_at: string;
};

type DrawingLayerRow = {
  id: string;
  page_id: string;
  revision_id: string;
  project_id: string;
  name: string;
  sort_order: number;
  visible: boolean;
  locked: boolean;
  system_kind: "source" | "work" | "custom";
  version: number;
  created_by: string;
  created_at: string;
  updated_at: string;
};

type DrawingObjectRow = {
  id: string;
  name: string;
  lineage_id: string;
  page_id: string;
  layer_id: string;
  revision_id: string;
  project_id: string;
  object_type:
    | "line"
    | "polyline"
    | "rectangle"
    | "circle"
    | "text"
    | "dimension"
    | "wall"
    | "opening"
    | "space"
    | "area"
    | "grid"
    | "arc";
  geometry: Json;
  style: Json;
  status: "active" | "deleted";
  version: number;
  created_by: string;
  updated_by: string;
  created_at: string;
  updated_at: string;
};

type DrawingSnapshotRow = {
  id: string;
  revision_id: string;
  project_id: string;
  revision_version: number;
  operation_sequence: number;
  canonical_json: Json;
  sha256: string;
  created_by: string;
  created_at: string;
};

export type DrawingWorkspaceIssue = {
  id: string;
  project_id: string;
  title: string;
  priority: "low" | "normal" | "high" | "urgent";
  status: "open" | "in_progress" | "resolution_requested" | "closed";
  updated_at: string;
};

export type DrawingObjectIssueLink = {
  id: string;
  object_id: string;
  revision_id: string;
  issue_id: string;
  project_id: string;
  created_by: string;
  created_at: string;
};

type DrawingRpc<Args> = { Args: Args; Returns: Json };

export type DrawingWorkspaceDatabase = Omit<Database, "public"> & {
  public: Omit<Database["public"], "Tables" | "Functions"> & {
    Tables: Database["public"]["Tables"] & {
      lukas_drawing_documents: TableDefinition<DrawingDocumentRow>;
      lukas_drawing_revisions: TableDefinition<DrawingRevisionRow>;
      lukas_drawing_pages: TableDefinition<DrawingPageRow>;
      lukas_drawing_layers: TableDefinition<DrawingLayerRow>;
      lukas_drawing_objects: TableDefinition<DrawingObjectRow>;
      lukas_drawing_canvases: TableDefinition<Record<string, unknown>>;
      lukas_drawing_styles: TableDefinition<Record<string, unknown>>;
      lukas_drawing_blocks: TableDefinition<Record<string, unknown>>;
      lukas_drawing_block_instances: TableDefinition<Record<string, unknown>>;
      lukas_drawing_property_schemas: TableDefinition<Record<string, unknown>>;
      lukas_drawing_property_values: TableDefinition<Record<string, unknown>>;
      lukas_drawing_tables: TableDefinition<Record<string, unknown>>;
      lukas_drawing_snapshots: TableDefinition<DrawingSnapshotRow>;
      lukas_drawing_issues: TableDefinition<DrawingWorkspaceIssue>;
      lukas_drawing_object_issue_links: TableDefinition<DrawingObjectIssueLink>;
    };
    Functions: Database["public"]["Functions"] & {
      lukas_drawing_create_document: DrawingRpc<{
        p_project_id: string;
        p_source_file_id: string | null;
        p_title: string;
        p_blank: boolean;
      }>;
      lukas_drawing_apply_operation: DrawingRpc<{
        p_revision_id: string;
        p_client_operation_id: string;
        p_operation_type: DrawingOperationInput["type"];
        p_base_versions: Json;
        p_forward: Json;
        p_inverse: Json;
        p_history_action: "undo" | "redo" | null;
        p_original_operation_id: string | null;
      }>;
      lukas_drawing_create_from_template: DrawingRpc<{
        p_source_revision_id: string;
        p_title: string;
        p_source_file_id: string | null;
        p_client_request_id: string;
      }>;
      lukas_drawing_request_review: DrawingRpc<{ p_revision_id: string }>;
      lukas_drawing_request_collaborative_review: DrawingRpc<{
        p_revision_id: string;
        p_request_id: string;
        p_manifest_sha256: string;
        p_manifest_count: number;
        p_base_operation_sequence: number;
        p_subject_revision_version: number;
        p_state_vector_base64: string;
        p_operation_statuses: Json;
        p_manifest: Json;
      }>;
      lukas_drawing_record_revision_decision: DrawingRpc<{
        p_revision_id: string;
        p_subject_version: number;
        p_snapshot_sha256: string;
        p_decision: "approved" | "rejected";
        p_note: string;
      }>;
      lukas_drawing_restore_approved_snapshot: DrawingRpc<{
        p_source_revision_id: string;
        p_request_id: string;
      }>;
      lukas_drawing_link_object_issue: DrawingRpc<{
        p_object_id: string;
        p_issue_id: string;
      }>;
      lukas_drawing_collaboration_bootstrap: DrawingRpc<{
        p_revision_id: string;
      }>;
    };
  };
};

export type DrawingWorkspaceClient = SupabaseClient<DrawingWorkspaceDatabase>;

const drawingObjectPageSize = 1_000;
const drawingRowsMaxPageSize = 1_000;

type DrawingRowsTable =
  | "lukas_drawing_pages"
  | "lukas_drawing_canvases"
  | "lukas_drawing_layers"
  | "lukas_drawing_objects"
  | "lukas_drawing_styles"
  | "lukas_drawing_blocks"
  | "lukas_drawing_block_instances"
  | "lukas_drawing_property_schemas"
  | "lukas_drawing_property_values"
  | "lukas_drawing_tables"
  | "lukas_drawing_revisions"
  | "lukas_drawing_documents"
  | "lukas_drawing_snapshots"
  | "lukas_drawing_issues"
  | "lukas_drawing_object_issue_links";

type DrawingRowOrder = {
  column: string;
  direction: "asc" | "desc";
};

type DrawingRowsQuery = {
  table: DrawingRowsTable;
  projectId: string;
  revisionId?: string;
  // Transport is always raw-ID ascending keyset.  This descriptor controls
  // only the complete in-memory canonical order; callers include `id` as the
  // deterministic final tie-breaker (normally ascending).
  order: readonly DrawingRowOrder[];
  pageSize?: number;
  filters?: ReadonlyArray<readonly [string, unknown]>;
  select?: string;
};

type DrawingRowsRequest = {
  select(columns: string): DrawingRowsRequest;
  eq(column: string, value: unknown): DrawingRowsRequest;
  order(column: string): DrawingRowsRequest;
  gt(column: string, value: string): DrawingRowsRequest;
  limit(count: number): PromiseLike<{
    data: unknown;
    error: { message: string } | null;
  }>;
};

/**
 * Supabase applies a response cap even to otherwise unbounded selects.  Keep
 * every workspace collection complete, ordered, and stable across pages.
 */
export async function loadAllDrawingRows<TRow extends { id: string }>(
  client: Pick<DrawingWorkspaceClient, "from">,
  query: DrawingRowsQuery,
): Promise<TRow[]> {
  const pageSize = query.pageSize ?? drawingObjectPageSize;
  if (
    !Number.isInteger(pageSize) ||
    pageSize <= 0 ||
    pageSize > drawingRowsMaxPageSize
  )
    throw new Error("Drawing row page size must be between 1 and 1000.");
  if (!query.order.some((order) => order.column === "id"))
    throw new Error("Drawing row pagination requires an ID tie-breaker.");

  const rows = new Map<string, TRow>();
  let cursor: string | null = null;
  for (;;) {
    let request: DrawingRowsRequest = client
      .from(query.table)
      .select(query.select ?? "*")
      .eq("project_id", query.projectId);
    if (query.revisionId) request = request.eq("revision_id", query.revisionId);
    for (const [column, value] of query.filters ?? [])
      request = request.eq(column, value);
    if (cursor !== null) request = request.gt("id", cursor);
    const { data, error } = await request.order("id").limit(pageSize);
    if (error)
      throw new Error(
        `도면 ${query.table}을 불러오지 못했습니다: ${error.message}`,
      );
    if (
      !Array.isArray(data) ||
      data.some(
        (row) =>
          !row ||
          typeof row !== "object" ||
          typeof (row as { id?: unknown }).id !== "string",
      )
    )
      throw new Error(`도면 ${query.table} 응답 형식이 올바르지 않습니다.`);
    const page: TRow[] = data as TRow[];
    for (const row of page) {
      if (rows.has(row.id))
        throw new Error(`도면 ${query.table} 응답에 중복 ID가 있습니다.`);
      if (cursor !== null && row.id <= cursor)
        throw new Error(
          `도면 ${query.table} keyset cursor가 진행하지 않았습니다.`,
        );
      rows.set(row.id, row);
    }
    if (page.length > 0) cursor = page.at(-1)!.id;
    if (page.length < pageSize)
      return [...rows.values()].sort((left, right) =>
        query.order.reduce((result, order) => {
          if (result !== 0) return result;
          const a = (left as Record<string, unknown>)[order.column];
          const b = (right as Record<string, unknown>)[order.column];
          const compared =
            typeof a === "number" && typeof b === "number"
              ? a - b
              : String(a).localeCompare(String(b));
          return order.direction === "asc" ? compared : -compared;
        }, 0),
      );
  }
}

export async function loadAllDrawingObjects(
  client: DrawingWorkspaceClient,
  projectId: string,
  revisionId: string,
  pageSize = drawingObjectPageSize,
) {
  return loadAllDrawingRows<DrawingObjectRow>(client, {
    table: "lukas_drawing_objects",
    projectId,
    revisionId,
    order: [
      { column: "created_at", direction: "asc" },
      { column: "id", direction: "asc" },
    ],
    pageSize,
    filters: [["status", "active"]],
  });
}

const Uuid = z.string().uuid();
const Sha256 = z.string().regex(/^[0-9a-f]{64}$/);
const Title = z.string().trim().min(1).max(240);
const LayerName = z.string().trim().min(1).max(255);
const DecisionNote = z.string().trim().max(5000);

const ObjectPatchSchema = z
  .object({
    name: DrawingObjectNameSchema.optional(),
    layerId: Uuid.optional(),
    geometry: DrawingGeometrySchema.optional(),
    styleId: Uuid.nullable().optional(),
    style: DrawingStyleOverrideSchema.optional(),
  })
  .strict()
  .refine((patch) => Object.keys(patch).length > 0);
const LayerPatchSchema = z
  .object({
    name: LayerName.optional(),
    visible: z.boolean().optional(),
    locked: z.boolean().optional(),
    canvasId: Uuid.optional(),
    sortOrder: z.number().int().nonnegative().max(2_147_483_647).optional(),
  })
  .strict()
  .refine((patch) => Object.keys(patch).length > 0);

const AddObjectsPayloadSchema = z
  .object({
    type: z.literal("add_objects"),
    objects: z.array(DrawingObjectSchema).min(1),
  })
  .strict();
const UpdateObjectsPayloadSchema = z
  .object({
    type: z.literal("update_objects"),
    updates: z
      .array(z.object({ objectId: Uuid, patch: ObjectPatchSchema }).strict())
      .min(1),
  })
  .strict();
const DeleteObjectsPayloadSchema = z
  .object({
    type: z.literal("delete_objects"),
    objectIds: z.array(Uuid).min(1),
  })
  .strict();
const AddLayerPayloadSchema = z
  .object({ type: z.literal("add_layer"), layer: DrawingLayerInputSchema })
  .strict();
const UpdateLayerPayloadSchema = z
  .object({
    type: z.literal("update_layer"),
    layerId: Uuid,
    patch: LayerPatchSchema,
  })
  .strict();
const MutateStructurePayloadSchema = z
  .object({
    type: z.literal("mutate_structure"),
    actions: z.array(DrawingStructureActionSchema).min(1),
  })
  .strict();
const MutateObjectsWithReferencesPayloadSchema = z
  .object({
    type: z.literal("mutate_objects_with_references"),
    objectAction: z.enum(["delete", "restore"]),
    objects: z.array(DrawingObjectSchema).min(1),
    actions: z.array(DrawingStructureActionSchema),
  })
  .strict();
const RestoreCheckpointPayloadSchema = z
  .object({
    type: z.literal("restore_checkpoint"),
    checkpointId: Uuid,
    actions: z.array(DrawingStructureActionSchema).min(1).max(5000),
  })
  .strict();

const OperationPayloadSchemas = {
  add_objects: AddObjectsPayloadSchema,
  update_objects: UpdateObjectsPayloadSchema,
  delete_objects: DeleteObjectsPayloadSchema,
  add_layer: AddLayerPayloadSchema,
  update_layer: UpdateLayerPayloadSchema,
  mutate_structure: MutateStructurePayloadSchema,
  mutate_objects_with_references: MutateObjectsWithReferencesPayloadSchema,
  restore_checkpoint: RestoreCheckpointPayloadSchema,
} as const;

const exactOperationKeys = [
  "baseVersions",
  "clientOperationId",
  "createdAt",
  "forward",
  "inverse",
  "revisionId",
  "type",
];
const exactHistoryOperationKeys = [
  ...exactOperationKeys,
  "historyAction",
  "originalOperationId",
].sort();

function sameJsonValue(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right))
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => sameJsonValue(value, right[index]))
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
        key === rightKeys[index] &&
        sameJsonValue(leftRecord[key], rightRecord[key]),
    )
  );
}

function parseExactPayload(schema: z.ZodTypeAny, value: unknown): unknown {
  const parsed = schema.parse(value);
  if (!sameJsonValue(parsed, value))
    throw new Error("도면 작업 도메인 JSON에 허용되지 않은 필드가 있습니다.");
  return parsed;
}

function parseOperation(value: unknown): DrawingOperationInput {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("도면 작업 JSON 형식이 올바르지 않습니다.");
  const keys = Object.keys(value).sort();
  if (!(
    (keys.length === exactOperationKeys.length &&
      keys.every((key, index) => key === exactOperationKeys[index])) ||
    (keys.length === exactHistoryOperationKeys.length &&
      keys.every((key, index) => key === exactHistoryOperationKeys[index]))
  ))
    throw new Error("도면 작업에 허용되지 않은 필드가 있습니다.");
  const operation = DrawingOperationInputSchema.parse(value);
  parseExactPayload(OperationPayloadSchemas[operation.type], operation.forward);
  const expectedInverse =
    operation.type === "add_objects"
      ? DeleteObjectsPayloadSchema
      : operation.type === "delete_objects"
        ? AddObjectsPayloadSchema
        : operation.type === "add_layer"
          ? z.object({}).strict()
          : operation.type === "mutate_structure"
            ? MutateStructurePayloadSchema
            : operation.type === "mutate_objects_with_references"
              ? MutateObjectsWithReferencesPayloadSchema
              : operation.type === "restore_checkpoint"
                ? RestoreCheckpointPayloadSchema
                : OperationPayloadSchemas[operation.type];
  parseExactPayload(expectedInverse, operation.inverse);
  return operation;
}

const CreateDocumentMutationSchema = z.object({
  intent: z.literal("create_document"),
  title: Title,
});
const CreateFromTemplateMutationSchema = z
  .object({
    intent: z.literal("create_from_template"),
    sourceRevisionId: Uuid,
    title: Title,
    sourceFileId: Uuid.nullable(),
    clientRequestId: Uuid,
  })
  .strict();
const ApplyOperationMutationSchema = z.object({
  intent: z.literal("apply_operation"),
  operation: DrawingOperationInputSchema,
});
const CreateLayerMutationSchema = z.object({
  intent: z.literal("create_layer"),
  name: LayerName,
});
const LinkIssueMutationSchema = z.object({
  intent: z.literal("link_issue"),
  objectId: Uuid,
  issueId: Uuid,
});
const RequestReviewMutationSchema = z.object({
  intent: z.literal("request_review"),
  revisionId: Uuid,
  requestId: Uuid,
});
const RecordRevisionDecisionMutationSchema = z.object({
  intent: z.literal("record_revision_decision"),
  revisionId: Uuid,
  subjectVersion: z.number().int().positive(),
  snapshotSha256: Sha256,
  decision: z.enum(["approved", "rejected"]),
  note: DecisionNote,
});
const RestoreApprovedSnapshotMutationSchema = z.object({
  intent: z.literal("restore_approved_snapshot"),
  sourceRevisionId: Uuid,
  requestId: Uuid,
});

export type WorkspaceMutation =
  | z.infer<typeof CreateDocumentMutationSchema>
  | z.infer<typeof CreateFromTemplateMutationSchema>
  | { intent: "apply_operation"; operation: DrawingOperationInput }
  | z.infer<typeof CreateLayerMutationSchema>
  | z.infer<typeof LinkIssueMutationSchema>
  | z.infer<typeof RequestReviewMutationSchema>
  | z.infer<typeof RestoreApprovedSnapshotMutationSchema>
  | z.infer<typeof RecordRevisionDecisionMutationSchema>;

const allowedFormFields = {
  create_document: new Set(["intent", "title", "document_mode"]),
  create_from_template: new Set([
    "intent",
    "source_revision_id",
    "title",
    "source_file_id",
    "client_request_id",
  ]),
  apply_operation: new Set(["intent", "operation_json"]),
  create_layer: new Set(["intent", "name"]),
  link_issue: new Set(["intent", "object_id", "issue_id"]),
  request_review: new Set(["intent", "revision_id", "freeze_request_id"]),
  restore_approved_snapshot: new Set([
    "intent",
    "source_revision_id",
    "request_id",
  ]),
  record_revision_decision: new Set([
    "intent",
    "revision_id",
    "subject_version",
    "snapshot_sha256",
    "decision",
    "note",
  ]),
} as const;

function assertAllowedFormFields(
  form: FormData,
  intent: keyof typeof allowedFormFields,
) {
  for (const key of form.keys())
    if (!allowedFormFields[intent].has(key as never))
      throw new Error("요청에 허용되지 않은 필드가 있습니다.");
}

function jsonFormValue(form: FormData, name: string): unknown {
  const value = form.get(name);
  if (typeof value !== "string") throw new Error("도면 작업 JSON이 없습니다.");
  try {
    return JSON.parse(value);
  } catch {
    throw new Error("도면 작업 JSON 형식이 올바르지 않습니다.");
  }
}

export function parseWorkspaceMutation(form: FormData): WorkspaceMutation {
  const intent = form.get("intent");
  if (typeof intent !== "string" || !(intent in allowedFormFields))
    throw new Error("지원하지 않는 도면 작업입니다.");
  const knownIntent = intent as keyof typeof allowedFormFields;
  assertAllowedFormFields(form, knownIntent);

  if (knownIntent === "create_document")
    return CreateDocumentMutationSchema.parse({
      intent,
      title: form.get("title"),
    });
  if (knownIntent === "create_from_template")
    return CreateFromTemplateMutationSchema.parse({
      intent,
      sourceRevisionId: form.get("source_revision_id"),
      title: form.get("title"),
      sourceFileId: form.get("source_file_id") || null,
      clientRequestId: form.get("client_request_id"),
    });
  if (knownIntent === "apply_operation")
    return ApplyOperationMutationSchema.parse({
      intent,
      operation: parseOperation(jsonFormValue(form, "operation_json")),
    });
  if (knownIntent === "create_layer")
    return CreateLayerMutationSchema.parse({ intent, name: form.get("name") });
  if (knownIntent === "link_issue")
    return LinkIssueMutationSchema.parse({
      intent,
      objectId: form.get("object_id"),
      issueId: form.get("issue_id"),
    });
  if (knownIntent === "request_review")
    return RequestReviewMutationSchema.parse({
      intent,
      revisionId: form.get("revision_id"),
      requestId: form.get("freeze_request_id"),
    });
  if (knownIntent === "restore_approved_snapshot")
    return RestoreApprovedSnapshotMutationSchema.parse({
      intent,
      sourceRevisionId: form.get("source_revision_id"),
      requestId: form.get("request_id"),
    });
  return RecordRevisionDecisionMutationSchema.parse({
    intent,
    revisionId: form.get("revision_id"),
    subjectVersion: Number(form.get("subject_version")),
    snapshotSha256: form.get("snapshot_sha256"),
    decision: form.get("decision"),
    note: form.get("note"),
  });
}

export type DrawingWorkspace = {
  file: DrawingWorkspaceFile;
  templateCandidates: DrawingTemplateCandidate[];
  document:
    | (DrawingDocumentRow & {
        revision: DrawingRevisionRow & {
          pages: Array<DrawingPageRow | DrawingWorkspaceP2Page>;
          layers: Array<DrawingLayerRow | DrawingLayer>;
          objects: Array<DrawingObjectRow | DrawingObject>;
          activePageId?: string;
          activeCanvasId?: string;
          canvases?: DrawingCanvas[];
          styles?: DrawingStyleDefinition[];
          blocks?: DrawingBlock[];
          blockInstances?: DrawingBlockInstance[];
          propertySchemas?: DrawingPropertySchema[];
          propertyValues?: DrawingPropertyValue[];
          tables?: DrawingTable[];
          issues: DrawingWorkspaceIssue[];
          issueLinks: DrawingObjectIssueLink[];
          reviewEvidence: {
            subjectVersion: number;
            snapshotSha256: string;
          } | null;
          checkpoints: Array<{
            id: string;
            createdAt: string;
            canonicalJson: Json;
          }>;
        };
      })
    | null;
};

const CollaborationCanonicalJsonSchema = z
  .object({
    schemaVersion: z.literal(2),
    revision: z
      .object({
        id: Uuid,
        documentId: Uuid,
        projectId: Uuid,
        sequence: z.number().int().positive(),
        version: z.number().int().positive(),
      })
      .strict(),
    sources: z.array(z.unknown()),
    pages: z.array(z.unknown()),
    canvases: z.array(z.unknown()),
    layers: z.array(z.unknown()),
    objects: z.array(z.unknown()),
    styles: z.array(z.unknown()),
    blocks: z.array(z.unknown()),
    blockInstances: z.array(z.unknown()),
    propertySchemas: z.array(z.unknown()),
    propertyValues: z.array(z.unknown()),
    tables: z.array(z.unknown()),
    issues: z.array(z.unknown()),
    operationSequence: z.number().int().nonnegative(),
  })
  .strict();

const CollaborationRecentOutcomeSchema = z
  .object({
    revisionId: Uuid,
    clientOperationId: Uuid,
    actorId: Uuid,
    operationType: z.enum([
      "add_objects",
      "update_objects",
      "delete_objects",
      "add_layer",
      "update_layer",
      "mutate_structure",
      "mutate_objects_with_references",
      "restore_checkpoint",
    ]),
    baseVersions: z.record(Uuid, z.number().int().positive()),
    forward: z.record(z.string(), z.unknown()),
    inverse: z.record(z.string(), z.unknown()),
    originalOperationId: Uuid.optional(),
    historyAction: z.enum(["undo", "redo"]).optional(),
    sequence: z.number().int().positive(),
    resultVersions: z.record(Uuid, z.number().int().positive()),
  })
  .strict()
  .superRefine((value, context) => {
    if (Boolean(value.originalOperationId) !== Boolean(value.historyAction))
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Drawing collaboration history outcome is incomplete.",
      });
  });

const DrawingWorkspaceCollaborationBootstrapSchema = z
  .object({
    canonicalJson: CollaborationCanonicalJsonSchema,
    operationSequence: z.number().int().nonnegative(),
    schemaVersion: z.literal(2),
    sha256: Sha256,
    revisionStatus: z.enum([
      "draft",
      "review_requested",
      "approved",
      "superseded",
    ]),
    capability: z.enum(["admin", "editor", "reviewer", "commenter", "viewer"]),
    canWrite: z.boolean(),
    recentOutcomes: z.array(CollaborationRecentOutcomeSchema).max(256),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.canonicalJson.operationSequence !== value.operationSequence)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["operationSequence"],
        message: "Drawing collaboration checkpoint is inconsistent.",
      });
    if (
      value.canWrite !==
      (value.revisionStatus === "draft" &&
        (value.capability === "admin" || value.capability === "editor"))
    )
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["canWrite"],
        message: "Drawing collaboration capability is inconsistent.",
      });
  });

export type DrawingWorkspaceCollaborationBootstrap = z.infer<
  typeof DrawingWorkspaceCollaborationBootstrapSchema
>;

const AuthorizedMeasurementObjectSchema = z
  .object({
    id: Uuid,
    lineageId: Uuid,
    pageId: Uuid,
    layerId: Uuid,
    name: DrawingObjectNameSchema,
    type: z.enum([
      "line",
      "polyline",
      "rectangle",
      "circle",
      "text",
      "dimension",
      "wall",
      "opening",
      "space",
      "area",
      "grid",
      "arc",
    ]),
    geometry: z.unknown(),
    styleId: Uuid.nullable(),
    style: DrawingStyleOverrideSchema,
    version: z.number().int().positive(),
  })
  .strict();

/** Derives evidence only from the already-authorized transactional bootstrap. */
export function deriveAuthorizedDrawingMeasurementEvidence(
  bootstrap: DrawingWorkspaceCollaborationBootstrap,
): DrawingServerMeasurementEvidence {
  if (bootstrap.operationSequence !== bootstrap.canonicalJson.operationSequence)
    throw new Error(
      "Drawing measurement operation checkpoint is inconsistent.",
    );
  const objects = bootstrap.canonicalJson.objects.map((input) => {
    const canonical = AuthorizedMeasurementObjectSchema.parse(input);
    const object = DrawingObjectSchema.parse({
      id: canonical.id,
      name: canonical.name,
      layerId: canonical.layerId,
      geometry: canonical.geometry,
      styleId: canonical.styleId,
      style: canonical.style,
      version: canonical.version,
    });
    if (object.geometry.type !== canonical.type)
      throw new Error("Drawing measurement object type is inconsistent.");
    return object;
  });
  const objectMap = Object.fromEntries(
    objects.map((object) => [object.id, object]),
  );
  if (Object.keys(objectMap).length !== objects.length)
    throw new Error("Drawing measurement object IDs are inconsistent.");
  return deriveDrawingServerMeasurementEvidence({
    revisionId: bootstrap.canonicalJson.revision.id,
    operationCheckpoint: bootstrap.operationSequence,
    state: {
      revisionId: bootstrap.canonicalJson.revision.id,
      objects: objectMap,
    },
  });
}

/** Loads graph, checkpoint, capability, and outcomes from one database snapshot. */
export async function loadDrawingWorkspaceCollaborationBootstrap(
  client: Pick<DrawingWorkspaceClient, "rpc">,
  revisionId: string,
): Promise<DrawingWorkspaceCollaborationBootstrap> {
  const parsedRevisionId = Uuid.parse(revisionId);
  const { data, error } = await client.rpc(
    "lukas_drawing_collaboration_bootstrap",
    { p_revision_id: parsedRevisionId },
  );
  const parsed = DrawingWorkspaceCollaborationBootstrapSchema.parse(
    rpcResult(data, error),
  );
  if (parsed.canonicalJson.revision.id !== parsedRevisionId)
    throw new Error("Drawing collaboration revision is inconsistent.");
  return parsed;
}

export async function deliverDrawingCollaborationOutcome({
  actorId,
  projectId,
  operation: input,
  outcome,
  authoritativeSequence = null,
  resultVersions = {},
  environment = process.env,
  fetcher = fetch,
}: {
  actorId: string;
  projectId: string;
  operation: unknown;
  outcome: "acked" | "conflicted" | "rejected";
  authoritativeSequence?: number | null;
  resultVersions?: Record<string, number>;
  environment?: Record<string, string | undefined>;
  fetcher?: (
    input: string,
    init: {
      method: "POST";
      body: string;
      headers: Record<string, string>;
    },
  ) => Promise<{ ok: boolean; status: number }>;
}) {
  const operation = DrawingOperationInputSchema.parse(input);
  const url = environment.COLLABORATION_INTERNAL_URL;
  const secret = environment.COLLABORATION_INTERNAL_SECRET;
  if (!url || !secret || secret.length < 32) return false;
  const endpoint = new URL("/internal/outcomes", url);
  if (endpoint.protocol !== "http:" && endpoint.protocol !== "https:")
    throw new Error("Drawing collaboration internal URL is invalid.");
  const body = JSON.stringify({
    receiptId: operation.clientOperationId,
    roomName: drawingRoomName(projectId, operation.revisionId),
    operationId: operation.clientOperationId,
    operation: {
      ...operation,
      actorId: Uuid.parse(actorId),
      schemaVersion: DRAWING_COLLABORATION_SCHEMA_VERSION,
    },
    outcome,
    authoritativeSequence,
    resultVersions,
  });
  const signature = createHmac("sha256", secret).update(body).digest("hex");
  const response = await fetcher(endpoint.toString(), {
    method: "POST",
    body,
    headers: {
      "content-type": "application/json",
      "x-1hk-signature": signature,
    },
  });
  return response.ok;
}

type DrawingWorkspaceP2Page = DrawingPage & {
  canvases: DrawingCanvas[];
  layers: DrawingLayer[];
  objects: DrawingObject[];
  blockInstances: DrawingBlockInstance[];
};

type DrawingWorkspaceP2 = {
  activePageId: string;
  activeCanvasId: string;
  pages: DrawingWorkspaceP2Page[];
  canvases: DrawingCanvas[];
  layers: DrawingLayer[];
  objects: DrawingObject[];
  styles: DrawingStyleDefinition[];
  blocks: DrawingBlock[];
  blockInstances: DrawingBlockInstance[];
  propertySchemas: DrawingPropertySchema[];
  propertyValues: DrawingPropertyValue[];
  tables: DrawingTable[];
};

export type DrawingTemplateCandidate = {
  revisionId: string;
  title: string;
  version: number;
  approvedAt: string;
  snapshotSha256: string;
};

const P2PageRowSchema = z
  .object({
    id: Uuid,
    revision_id: Uuid,
    project_id: Uuid,
    name: z.string(),
    sort_order: z.number().int().nonnegative(),
    version: z.number().int().positive(),
  })
  .strict();
const P2CanvasRowSchema = z
  .object({
    id: Uuid,
    page_id: Uuid,
    revision_id: Uuid,
    project_id: Uuid,
    name: z.string(),
    space_kind: z.enum(["paper", "model"]),
    width_mm: z.number(),
    height_mm: z.number(),
    background_source_file_id: Uuid.nullable(),
    background_source_sha256: z.string().nullable(),
    background_pdf_page: z.number().int().nullable(),
    calibration: z.unknown().nullable(),
    sort_order: z.number().int().nonnegative(),
    version: z.number().int().positive(),
  })
  .strict();
const P2LayerRowSchema = z
  .object({
    id: Uuid,
    page_id: Uuid,
    canvas_id: Uuid,
    revision_id: Uuid,
    project_id: Uuid,
    name: z.string(),
    sort_order: z.number().int().nonnegative(),
    visible: z.boolean(),
    locked: z.boolean(),
    system_kind: z.enum(["source", "work", "custom"]),
    version: z.number().int().positive(),
  })
  .strict();
const P2ObjectRowSchema = z
  .object({
    id: Uuid,
    name: z.string(),
    page_id: Uuid,
    layer_id: Uuid,
    revision_id: Uuid,
    project_id: Uuid,
    object_type: z.enum([
      "line",
      "polyline",
      "rectangle",
      "circle",
      "text",
      "dimension",
      "wall",
      "opening",
      "space",
      "area",
      "grid",
      "arc",
    ]),
    geometry: z.unknown(),
    style_id: Uuid.nullable(),
    style: z.unknown(),
    version: z.number().int().positive(),
  })
  .strict();
const P2StyleRowSchema = z
  .object({
    id: Uuid,
    revision_id: Uuid,
    project_id: Uuid,
    name: z.string(),
    value: z.unknown(),
    version: z.number().int().positive(),
  })
  .strict();
const P2BlockRowSchema = z
  .object({
    id: Uuid,
    revision_id: Uuid,
    project_id: Uuid,
    name: z.string(),
    primitives: z.unknown(),
    version: z.number().int().positive(),
  })
  .strict();
const P2BlockInstanceRowSchema = z
  .object({
    id: Uuid,
    lineage_id: Uuid,
    block_id: Uuid,
    layer_id: Uuid,
    revision_id: Uuid,
    project_id: Uuid,
    name: z.string(),
    origin: z.unknown(),
    rotation: z.number(),
    scale_x: z.number(),
    scale_y: z.number(),
    version: z.number().int().positive(),
  })
  .strict();
const P2PropertySchemaRowSchema = z
  .object({
    id: Uuid,
    revision_id: Uuid,
    project_id: Uuid,
    name: z.string(),
    value_type: z.unknown(),
    enum_options: z.unknown(),
    applies_to: z.unknown(),
    required: z.boolean(),
    version: z.number().int().positive(),
  })
  .strict();
const P2PropertyValueRowSchema = z
  .object({
    id: Uuid,
    schema_id: Uuid,
    object_id: Uuid.nullable(),
    block_instance_id: Uuid.nullable(),
    revision_id: Uuid,
    project_id: Uuid,
    value: z.unknown(),
    version: z.number().int().positive(),
  })
  .strict();
const P2TableRowSchema = z
  .object({
    id: Uuid,
    revision_id: Uuid,
    project_id: Uuid,
    name: z.string(),
    columns_json: z.unknown(),
    rows_json: z.unknown(),
    version: z.number().int().positive(),
  })
  .strict();

function p2RowError(entity: string): never {
  throw new Error(`Drawing ${entity} metadata is invalid.`);
}

function requireP2Ancestry(
  condition: unknown,
  message = "Drawing P2 ancestry is invalid.",
): asserts condition {
  if (!condition) throw new Error(message);
}

function parseP2Workspace(
  projectId: string,
  revisionId: string,
  file: DrawingWorkspaceFile,
  rows: {
    pages: unknown[];
    canvases: unknown[];
    layers: unknown[];
    objects: unknown[];
    styles: unknown[];
    blocks: unknown[];
    blockInstances: unknown[];
    propertySchemas: unknown[];
    propertyValues: unknown[];
    tables: unknown[];
  },
): DrawingWorkspaceP2 {
  const pages = rows.pages.map((row) => {
    const value = P2PageRowSchema.safeParse(row);
    if (!value.success) return p2RowError("page");
    return DrawingPageSchema.parse({
      id: value.data.id,
      revisionId: value.data.revision_id,
      name: value.data.name,
      sortOrder: value.data.sort_order,
      version: value.data.version,
    });
  });
  const canvases = rows.canvases.map((row) => {
    const value = P2CanvasRowSchema.safeParse(row);
    if (!value.success) return p2RowError("canvas");
    const background =
      value.data.background_source_file_id === null
        ? null
        : {
            sourceFileId: value.data.background_source_file_id,
            sourceSha256: value.data.background_source_sha256,
            pdfPageNumber: value.data.background_pdf_page,
            calibration: value.data.calibration,
          };
    return DrawingCanvasSchema.parse({
      id: value.data.id,
      pageId: value.data.page_id,
      name: value.data.name,
      spaceKind: value.data.space_kind,
      widthMillimeters: value.data.width_mm,
      heightMillimeters: value.data.height_mm,
      background,
      sortOrder: value.data.sort_order,
      version: value.data.version,
    });
  });
  const layers = rows.layers.map((row) => {
    const value = P2LayerRowSchema.safeParse(row);
    if (!value.success) return p2RowError("layer");
    return DrawingStructureLayerSchema.parse({
      id: value.data.id,
      name: value.data.name,
      visible: value.data.visible,
      locked: value.data.locked,
      systemKind: value.data.system_kind,
      canvasId: value.data.canvas_id,
      sortOrder: value.data.sort_order,
      version: value.data.version,
    });
  });
  const objects = rows.objects.map((row) => {
    const value = P2ObjectRowSchema.safeParse(row);
    if (!value.success) return p2RowError("object");
    const object = DrawingObjectSchema.parse({
      id: value.data.id,
      name: value.data.name,
      layerId: value.data.layer_id,
      geometry: value.data.geometry,
      styleId: value.data.style_id,
      style: value.data.style,
      version: value.data.version,
    });
    requireP2Ancestry(
      object.geometry.type === value.data.object_type,
      "Drawing object type does not match its geometry.",
    );
    return object;
  });
  const styles = rows.styles.map((row) => {
    const value = P2StyleRowSchema.safeParse(row);
    if (!value.success) return p2RowError("style");
    return DrawingStyleDefinitionSchema.parse({
      id: value.data.id,
      revisionId: value.data.revision_id,
      name: value.data.name,
      value: value.data.value,
      version: value.data.version,
    });
  });
  const blocks = rows.blocks.map((row) => {
    const value = P2BlockRowSchema.safeParse(row);
    if (!value.success) return p2RowError("block");
    return DrawingBlockSchema.parse({
      id: value.data.id,
      revisionId: value.data.revision_id,
      name: value.data.name,
      primitives: value.data.primitives,
      version: value.data.version,
    });
  });
  const blockInstances = rows.blockInstances.map((row) => {
    const value = P2BlockInstanceRowSchema.safeParse(row);
    if (!value.success) return p2RowError("block instance");
    return DrawingBlockInstanceSchema.parse({
      id: value.data.id,
      lineageId: value.data.lineage_id,
      blockId: value.data.block_id,
      layerId: value.data.layer_id,
      name: value.data.name,
      origin: value.data.origin,
      rotation: value.data.rotation,
      scaleX: value.data.scale_x,
      scaleY: value.data.scale_y,
      version: value.data.version,
    });
  });
  const propertySchemas = rows.propertySchemas.map((row) => {
    const value = P2PropertySchemaRowSchema.safeParse(row);
    if (!value.success) return p2RowError("property schema");
    return DrawingPropertySchemaSchema.parse({
      id: value.data.id,
      revisionId: value.data.revision_id,
      name: value.data.name,
      valueType: value.data.value_type,
      enumOptions: value.data.enum_options,
      appliesTo: value.data.applies_to,
      required: value.data.required,
      version: value.data.version,
    });
  });
  const propertyValues = rows.propertyValues.map((row) => {
    const value = P2PropertyValueRowSchema.safeParse(row);
    if (!value.success) return p2RowError("property value");
    return DrawingPropertyValueSchema.parse({
      id: value.data.id,
      schemaId: value.data.schema_id,
      objectId: value.data.object_id,
      blockInstanceId: value.data.block_instance_id,
      value: value.data.value,
      version: value.data.version,
    });
  });
  const tables = rows.tables.map((row) => {
    const value = P2TableRowSchema.safeParse(row);
    if (!value.success) return p2RowError("table");
    return DrawingTableSchema.parse({
      id: value.data.id,
      revisionId: value.data.revision_id,
      name: value.data.name,
      columns: value.data.columns_json,
      rows: value.data.rows_json,
      version: value.data.version,
    });
  });
  const scopedRows = [
    ...rows.pages.map((row) => P2PageRowSchema.parse(row)),
    ...rows.canvases.map((row) => P2CanvasRowSchema.parse(row)),
    ...rows.layers.map((row) => P2LayerRowSchema.parse(row)),
    ...rows.objects.map((row) => P2ObjectRowSchema.parse(row)),
    ...rows.styles.map((row) => P2StyleRowSchema.parse(row)),
    ...rows.blocks.map((row) => P2BlockRowSchema.parse(row)),
    ...rows.blockInstances.map((row) => P2BlockInstanceRowSchema.parse(row)),
    ...rows.propertySchemas.map((row) => P2PropertySchemaRowSchema.parse(row)),
    ...rows.propertyValues.map((row) => P2PropertyValueRowSchema.parse(row)),
    ...rows.tables.map((row) => P2TableRowSchema.parse(row)),
  ];
  requireP2Ancestry(
    scopedRows.every(
      (row) => row.project_id === projectId && row.revision_id === revisionId,
    ),
  );
  const byId = <T extends { id: string }>(values: T[]) =>
    new Set(values.map((value) => value.id));
  const pageIds = byId(pages),
    canvasIds = byId(canvases),
    layerIds = byId(layers),
    blockIds = byId(blocks),
    objectIds = byId(objects),
    instanceIds = byId(blockInstances),
    propertySchemaIds = byId(propertySchemas);
  requireP2Ancestry(pages.every((page) => page.revisionId === revisionId));
  requireP2Ancestry(canvases.every((canvas) => pageIds.has(canvas.pageId)));
  requireP2Ancestry(
    rows.canvases.every((row) => {
      const canvas = P2CanvasRowSchema.parse(row);
      const fields = [
        canvas.background_source_file_id,
        canvas.background_source_sha256,
        canvas.background_pdf_page,
        canvas.calibration,
      ];
      return (
        fields.every((field) => field === null) ||
        (canvas.background_source_file_id !== null &&
          canvas.background_source_sha256 !== null)
      );
    }),
    "Drawing canvas background evidence is invalid.",
  );
  requireP2Ancestry(
    canvases.every(
      (canvas) =>
        canvas.background === null ||
        (canvas.background.sourceFileId === file.id &&
          canvas.background.sourceSha256 === file.sha256),
    ),
    "Drawing canvas source evidence is invalid.",
  );
  requireP2Ancestry(
    layers.every(
      (layer, index) =>
        canvasIds.has(layer.canvasId) &&
        P2LayerRowSchema.parse(rows.layers[index]).page_id ===
          canvases.find((canvas) => canvas.id === layer.canvasId)?.pageId,
    ),
  );
  requireP2Ancestry(
    objects.every((object, index) => {
      const layer = layers.find((candidate) => candidate.id === object.layerId);
      return (
        layerIds.has(object.layerId) &&
        layer &&
        P2ObjectRowSchema.parse(rows.objects[index]).page_id ===
          canvases.find((canvas) => canvas.id === layer.canvasId)?.pageId
      );
    }),
  );
  try {
    validateDrawingSemanticReferences({
      objects: Object.fromEntries(objects.map((object) => [object.id, object])),
      layers: Object.fromEntries(layers.map((layer) => [layer.id, layer])),
    });
  } catch {
    requireP2Ancestry(false, "Drawing semantic ancestry is invalid.");
  }
  requireP2Ancestry(
    blocks.every((block) => block.revisionId === revisionId) &&
      styles.every((style) => style.revisionId === revisionId) &&
      propertySchemas.every((schema) => schema.revisionId === revisionId) &&
      tables.every((table) => table.revisionId === revisionId),
  );
  requireP2Ancestry(
    blockInstances.every(
      (instance) =>
        blockIds.has(instance.blockId) && layerIds.has(instance.layerId),
    ),
  );
  const styleIds = byId(styles);
  requireP2Ancestry(
    objects.every(
      (object) => object.styleId == null || styleIds.has(object.styleId),
    ) &&
      blocks.every((block) =>
        block.primitives.every(
          (primitive) =>
            primitive.styleId === null || styleIds.has(primitive.styleId),
        ),
      ),
  );
  requireP2Ancestry(
    propertyValues.every(
      (value) =>
        propertySchemaIds.has(value.schemaId) &&
        (value.objectId === null || objectIds.has(value.objectId)) &&
        (value.blockInstanceId === null ||
          instanceIds.has(value.blockInstanceId)),
    ),
  );
  requireP2Ancestry(
    tables.every(
      (table) =>
        table.columns.every(
          (column) =>
            column.propertySchemaId === null ||
            propertySchemaIds.has(column.propertySchemaId),
        ) &&
        table.rows.every(
          (row) =>
            (row.objectId === null || objectIds.has(row.objectId)) &&
            (row.blockInstanceId === null ||
              instanceIds.has(row.blockInstanceId)),
        ),
    ),
  );
  for (const page of pages) {
    const pageCanvases = canvases.filter((canvas) => canvas.pageId === page.id);
    requireP2Ancestry(
      pageCanvases.length > 0 &&
        pageCanvases.filter(
          (canvas) => canvas.spaceKind === "paper" && canvas.sortOrder === 0,
        ).length === 1,
      "Drawing page default canvas is missing.",
    );
    requireP2Ancestry(
      pageCanvases.every((canvas) =>
        layers.some(
          (layer) =>
            layer.canvasId === canvas.id &&
            layer.systemKind !== "source" &&
            layer.visible &&
            !layer.locked,
        ),
      ),
      "Drawing canvas editable layer is missing.",
    );
  }
  const sorted = <T extends { id: string }>(
    values: T[],
    order: (value: T) => number,
  ) =>
    [...values].sort(
      (left, right) =>
        order(left) - order(right) || left.id.localeCompare(right.id),
    );
  const orderedPages = sorted(pages, (page) => page.sortOrder);
  const activePage = orderedPages[0];
  const activeCanvas =
    activePage &&
    sorted(
      canvases.filter(
        (canvas) =>
          canvas.pageId === activePage.id &&
          canvas.spaceKind === "paper" &&
          canvas.sortOrder === 0,
      ),
      (canvas) => canvas.sortOrder,
    )[0];
  requireP2Ancestry(
    activePage && activeCanvas,
    "Drawing default canvas is missing.",
  );
  return {
    activePageId: activePage.id,
    activeCanvasId: activeCanvas.id,
    pages: orderedPages.map((page) => ({
      ...page,
      canvases: sorted(
        canvases.filter((canvas) => canvas.pageId === page.id),
        (canvas) => canvas.sortOrder,
      ),
      layers: sorted(
        layers.filter((layer) =>
          canvases.some(
            (canvas) =>
              canvas.pageId === page.id && canvas.id === layer.canvasId,
          ),
        ),
        (layer) => layer.sortOrder,
      ),
      objects: sorted(
        objects.filter((object) =>
          layers.some(
            (layer) =>
              layer.id === object.layerId &&
              canvases.some(
                (canvas) =>
                  canvas.pageId === page.id && canvas.id === layer.canvasId,
              ),
          ),
        ),
        () => 0,
      ),
      blockInstances: sorted(
        blockInstances.filter((instance) =>
          layers.some(
            (layer) =>
              layer.id === instance.layerId &&
              canvases.some(
                (canvas) =>
                  canvas.pageId === page.id && canvas.id === layer.canvasId,
              ),
          ),
        ),
        () => 0,
      ),
    })),
    canvases: sorted(canvases, (canvas) => canvas.sortOrder),
    layers: sorted(layers, (layer) => layer.sortOrder),
    objects: sorted(objects, () => 0),
    styles: sorted(styles, () => 0),
    blocks: sorted(blocks, () => 0),
    blockInstances: sorted(blockInstances, () => 0),
    propertySchemas: sorted(propertySchemas, () => 0),
    propertyValues: sorted(propertyValues, () => 0),
    tables: sorted(tables, () => 0),
  };
}

const TemplateRevisionRowSchema = z
  .object({
    id: Uuid,
    document_id: Uuid,
    project_id: Uuid,
    status: z.literal("approved"),
    version: z.number().int().positive(),
    approved_at: z.string().datetime(),
  })
  .strict();
const TemplateDocumentRowSchema = z
  .object({ id: Uuid, project_id: Uuid, title: z.string() })
  .strict();
const TemplateSnapshotRowSchema = z
  .object({
    id: Uuid,
    revision_id: Uuid,
    project_id: Uuid,
    revision_version: z.number().int().positive(),
    sha256: Sha256,
  })
  .strict();

export async function loadDrawingTemplateCandidates(
  client: DrawingWorkspaceClient,
  projectId: string,
): Promise<DrawingTemplateCandidate[]> {
  const [revisionRows, documentRows, snapshotRows] = await Promise.all([
    loadAllDrawingRows<{ id: string } & Record<string, unknown>>(client, {
      table: "lukas_drawing_revisions",
      projectId,
      order: [
        { column: "approved_at", direction: "asc" },
        { column: "id", direction: "asc" },
      ],
      filters: [["status", "approved"]],
      select: "id,document_id,project_id,status,version,approved_at",
    }),
    loadAllDrawingRows<{ id: string } & Record<string, unknown>>(client, {
      table: "lukas_drawing_documents",
      projectId,
      order: [{ column: "id", direction: "asc" }],
      select: "id,project_id,title",
    }),
    loadAllDrawingRows<{ id: string } & Record<string, unknown>>(client, {
      table: "lukas_drawing_snapshots",
      projectId,
      order: [
        { column: "revision_id", direction: "asc" },
        { column: "id", direction: "asc" },
      ],
      select: "id,revision_id,project_id,revision_version,sha256",
    }),
  ]);
  const documents = new Map(
    documentRows.map((row) => {
      const parsed = TemplateDocumentRowSchema.safeParse(row);
      if (!parsed.success) return p2RowError("template document");
      return [parsed.data.id, parsed.data] as const;
    }),
  );
  const snapshots = new Map(
    snapshotRows.map((row) => {
      const parsed = TemplateSnapshotRowSchema.safeParse(row);
      if (!parsed.success) return p2RowError("template snapshot");
      return [
        `${parsed.data.revision_id}:${parsed.data.revision_version}`,
        parsed.data,
      ] as const;
    }),
  );
  return revisionRows
    .map((row) => {
      const revision = TemplateRevisionRowSchema.safeParse(row);
      if (!revision.success) return p2RowError("template revision");
      const document = documents.get(revision.data.document_id);
      const snapshot = snapshots.get(
        `${revision.data.id}:${revision.data.version}`,
      );
      if (
        !document ||
        !snapshot ||
        document.project_id !== projectId ||
        snapshot.project_id !== projectId
      )
        return p2RowError("template candidate ancestry");
      return {
        revisionId: revision.data.id,
        title: Title.parse(document.title),
        version: revision.data.version,
        approvedAt: revision.data.approved_at,
        snapshotSha256: snapshot.sha256,
      };
    })
    .sort(
      (left, right) =>
        left.approvedAt.localeCompare(right.approvedAt) ||
        left.revisionId.localeCompare(right.revisionId),
    );
}

async function loadReviewEvidence(
  client: DrawingWorkspaceClient,
  projectId: string,
  revision: Pick<DrawingRevisionRow, "id" | "status" | "version">,
) {
  if (revision.status !== "review_requested") return null;
  const { data, error } = await client
    .from("lukas_drawing_snapshots")
    .select("revision_version,sha256")
    .eq("project_id", projectId)
    .eq("revision_id", revision.id)
    .eq("revision_version", revision.version)
    .maybeSingle();
  if (error)
    throw new Error(`도면 검토 스냅샷을 불러오지 못했습니다: ${error.message}`);
  if (!data) throw new Error("Drawing review snapshot evidence is missing.");
  return {
    subjectVersion: data.revision_version,
    snapshotSha256: Sha256.parse(data.sha256),
  };
}

export async function loadDrawingWorkspace(
  client: DrawingWorkspaceClient,
  projectId: string,
  fileId: string,
  documentId?: string,
): Promise<DrawingWorkspace> {
  const { data: file, error: fileError } = await client
    .from("lukas_qto_files")
    .select(
      "id,project_id,kind,original_filename,storage_path,content_type,byte_size,sha256,immutable,created_at",
    )
    .eq("project_id", projectId)
    .eq("id", fileId)
    .in("kind", ["pdf", "ifc"])
    .eq("immutable", true)
    .single();
  if (fileError || !file)
    throw new Response("도면 원본을 찾을 수 없습니다.", { status: 404 });

  let documentQuery = client
    .from("lukas_drawing_documents")
    .select("*")
    .eq("project_id", projectId);
  if (documentId) {
    documentQuery = documentQuery.eq("id", Uuid.parse(documentId));
  } else {
    documentQuery = documentQuery
      .eq("source_file_id", fileId)
      .eq("source_sha256", file.sha256)
      .order("updated_at", { ascending: false })
      .limit(1);
  }
  const { data: document, error: documentError } =
    await documentQuery.maybeSingle();
  if (documentError)
    throw new Error(
      `도면 문서를 불러오지 못했습니다: ${documentError.message}`,
    );
  if (!document)
    return {
      file: file as DrawingWorkspaceFile,
      templateCandidates: await loadDrawingTemplateCandidates(
        client,
        projectId,
      ),
      document: null,
    };

  const { data: revision, error: revisionError } = await client
    .from("lukas_drawing_revisions")
    .select("*")
    .eq("project_id", projectId)
    .eq("document_id", document.id)
    .order("sequence", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (revisionError)
    throw new Error(
      `도면 리비전을 불러오지 못했습니다: ${revisionError.message}`,
    );
  if (!revision)
    return {
      file: file as DrawingWorkspaceFile,
      templateCandidates: [],
      document: null,
    };

  // A migrated revision is authoritatively identified by a canvas.  Probe it
  // before reading any large child collection so a request never mixes the
  // legacy and canonical P2 shapes.
  const { data: canvasProbe, error: canvasProbeError } = await client
    .from("lukas_drawing_canvases")
    .select("id")
    .eq("project_id", projectId)
    .eq("revision_id", revision.id)
    .order("id")
    .limit(1);
  if (canvasProbeError)
    throw new Error(
      `도면 캔버스 형식을 확인하지 못했습니다: ${canvasProbeError.message}`,
    );
  if (Array.isArray(canvasProbe) && canvasProbe.length > 0) {
    if (
      document.project_id !== projectId ||
      (!documentId &&
        (document.source_file_id !== file.id ||
          document.source_sha256 !== file.sha256)) ||
      revision.project_id !== projectId ||
      revision.document_id !== document.id
    )
      throw new Error("Drawing document source ancestry is invalid.");
    const [
      pages,
      canvases,
      layers,
      objects,
      styles,
      blocks,
      blockInstances,
      propertySchemas,
      propertyValues,
      tables,
      issues,
      links,
      templateCandidates,
      reviewEvidence,
      checkpoints,
    ] = await Promise.all([
      loadAllDrawingRows(client, {
        table: "lukas_drawing_pages",
        projectId,
        revisionId: revision.id,
        order: [
          { column: "sort_order", direction: "asc" },
          { column: "id", direction: "asc" },
        ],
        select: "id,revision_id,project_id,name,sort_order,version",
      }),
      loadAllDrawingRows(client, {
        table: "lukas_drawing_canvases",
        projectId,
        revisionId: revision.id,
        order: [
          { column: "sort_order", direction: "asc" },
          { column: "id", direction: "asc" },
        ],
        select:
          "id,page_id,revision_id,project_id,name,space_kind,width_mm,height_mm,background_source_file_id,background_source_sha256,background_pdf_page,calibration,sort_order,version",
      }),
      loadAllDrawingRows(client, {
        table: "lukas_drawing_layers",
        projectId,
        revisionId: revision.id,
        order: [
          { column: "sort_order", direction: "asc" },
          { column: "id", direction: "asc" },
        ],
        select:
          "id,page_id,canvas_id,revision_id,project_id,name,sort_order,visible,locked,system_kind,version",
      }),
      loadAllDrawingRows(client, {
        table: "lukas_drawing_objects",
        projectId,
        revisionId: revision.id,
        order: [{ column: "id", direction: "asc" }],
        filters: [["status", "active"]],
        select:
          "id,name,page_id,layer_id,revision_id,project_id,object_type,geometry,style_id,style,version",
      }),
      loadAllDrawingRows(client, {
        table: "lukas_drawing_styles",
        projectId,
        revisionId: revision.id,
        order: [{ column: "id", direction: "asc" }],
        select: "id,revision_id,project_id,name,value,version",
      }),
      loadAllDrawingRows(client, {
        table: "lukas_drawing_blocks",
        projectId,
        revisionId: revision.id,
        order: [{ column: "id", direction: "asc" }],
        select: "id,revision_id,project_id,name,primitives,version",
      }),
      loadAllDrawingRows(client, {
        table: "lukas_drawing_block_instances",
        projectId,
        revisionId: revision.id,
        order: [{ column: "id", direction: "asc" }],
        select:
          "id,lineage_id,block_id,layer_id,revision_id,project_id,name,origin,rotation,scale_x,scale_y,version",
      }),
      loadAllDrawingRows(client, {
        table: "lukas_drawing_property_schemas",
        projectId,
        revisionId: revision.id,
        order: [{ column: "id", direction: "asc" }],
        select:
          "id,revision_id,project_id,name,value_type,enum_options,applies_to,required,version",
      }),
      loadAllDrawingRows(client, {
        table: "lukas_drawing_property_values",
        projectId,
        revisionId: revision.id,
        order: [{ column: "id", direction: "asc" }],
        select:
          "id,schema_id,object_id,block_instance_id,revision_id,project_id,value,version",
      }),
      loadAllDrawingRows(client, {
        table: "lukas_drawing_tables",
        projectId,
        revisionId: revision.id,
        order: [{ column: "id", direction: "asc" }],
        select: "id,revision_id,project_id,name,columns_json,rows_json,version",
      }),
      loadAllDrawingRows<DrawingWorkspaceIssue>(client, {
        table: "lukas_drawing_issues",
        projectId,
        order: [
          { column: "updated_at", direction: "desc" },
          { column: "id", direction: "asc" },
        ],
        select: "id,project_id,title,priority,status,updated_at",
      }),
      loadAllDrawingRows<DrawingObjectIssueLink>(client, {
        table: "lukas_drawing_object_issue_links",
        projectId,
        revisionId: revision.id,
        order: [
          { column: "created_at", direction: "asc" },
          { column: "id", direction: "asc" },
        ],
        select:
          "id,object_id,revision_id,issue_id,project_id,created_by,created_at",
      }),
      loadDrawingTemplateCandidates(client, projectId),
      loadReviewEvidence(client, projectId, revision),
      loadAllDrawingRows<DrawingSnapshotRow>(client, {
        table: "lukas_drawing_snapshots",
        projectId,
        revisionId: revision.id,
        order: [
          { column: "created_at", direction: "desc" },
          { column: "id", direction: "asc" },
        ],
      }),
    ]);
    const p2 = parseP2Workspace(
      projectId,
      revision.id,
      file as DrawingWorkspaceFile,
      {
        pages,
        canvases,
        layers,
        objects,
        styles,
        blocks,
        blockInstances,
        propertySchemas,
        propertyValues,
        tables,
      },
    );
    const objectIds = new Set(p2.objects.map((object) => object.id));
    const issueIds = new Set(issues.map((issue) => issue.id));
    return {
      file: file as DrawingWorkspaceFile,
      templateCandidates,
      document: {
        ...document,
        revision: {
          ...revision,
          ...p2,
          issues,
          issueLinks: links.filter(
            (link) =>
              objectIds.has(link.object_id) && issueIds.has(link.issue_id),
          ),
          reviewEvidence,
          checkpoints: checkpoints.map((checkpoint) => ({
            id: checkpoint.id,
            createdAt: checkpoint.created_at,
            canonicalJson: checkpoint.canonical_json,
          })),
        },
      },
    };
  }

  const [pagesResult, layersResult, objects, issuesResult, linksResult] =
    await Promise.all([
      client
        .from("lukas_drawing_pages")
        .select("*")
        .eq("project_id", projectId)
        .eq("revision_id", revision.id)
        .order("page_number"),
      client
        .from("lukas_drawing_layers")
        .select("*")
        .eq("project_id", projectId)
        .eq("revision_id", revision.id)
        .order("sort_order"),
      loadAllDrawingObjects(client, projectId, revision.id),
      loadAllDrawingRows<DrawingWorkspaceIssue>(client, {
        table: "lukas_drawing_issues",
        projectId,
        order: [
          { column: "updated_at", direction: "desc" },
          { column: "id", direction: "asc" },
        ],
        select: "id,project_id,title,priority,status,updated_at",
      }),
      loadAllDrawingRows<DrawingObjectIssueLink>(client, {
        table: "lukas_drawing_object_issue_links",
        projectId,
        revisionId: revision.id,
        order: [
          { column: "created_at", direction: "asc" },
          { column: "id", direction: "asc" },
        ],
        select:
          "id,object_id,revision_id,issue_id,project_id,created_by,created_at",
      }),
    ]);
  const childError = pagesResult.error ?? layersResult.error ?? undefined;
  if (childError)
    throw new Error(`도면 내용을 불러오지 못했습니다: ${childError.message}`);
  const layers = layersResult.data ?? [];
  const pages = pagesResult.data ?? [];
  const issues = issuesResult;
  const activeObjectIds = new Set(objects.map((object) => object.id));
  const issueIds = new Set(issues.map((issue) => issue.id));
  const issueLinks = linksResult.filter(
    (link) =>
      activeObjectIds.has(link.object_id) && issueIds.has(link.issue_id),
  );
  const sourceLayers = layers.filter((layer) => layer.system_kind === "source");
  if (
    layers.some(
      (layer) =>
        layer.system_kind !== "source" &&
        layer.system_kind !== "work" &&
        layer.system_kind !== "custom",
    ) ||
    sourceLayers.length !== 1 ||
    !sourceLayers[0]?.visible ||
    !sourceLayers[0]?.locked ||
    !DrawingLayerSchema.safeParse({
      id: sourceLayers[0]?.id,
      name: sourceLayers[0]?.name,
      visible: sourceLayers[0]?.visible,
      locked: sourceLayers[0]?.locked,
      systemKind: sourceLayers[0]?.system_kind,
      version: sourceLayers[0]?.version,
    }).success
  ) {
    throw new Error("Drawing source layer metadata is missing.");
  }
  const pageIds = new Set(pages.map((page) => page.id));
  if (
    layers.some(
      (layer) =>
        !pageIds.has(layer.page_id) ||
        !DrawingLayerSchema.safeParse({
          id: layer.id,
          name: layer.name,
          visible: layer.visible,
          locked: layer.locked,
          systemKind: layer.system_kind,
          version: layer.version,
        }).success,
    )
  ) {
    throw new Error("Drawing layer metadata is invalid.");
  }
  if (
    pages.some(
      (page) =>
        !layers.some(
          (layer) =>
            layer.page_id === page.id &&
            layer.system_kind !== "source" &&
            layer.visible &&
            !layer.locked,
        ),
    )
  ) {
    throw new Error("Drawing editable layer metadata is missing.");
  }
  let reviewEvidence: {
    subjectVersion: number;
    snapshotSha256: string;
  } | null = null;
  if (revision.status === "review_requested") {
    const { data: snapshot, error: snapshotError } = await client
      .from("lukas_drawing_snapshots")
      .select("revision_version,sha256")
      .eq("project_id", projectId)
      .eq("revision_id", revision.id)
      .eq("revision_version", revision.version)
      .maybeSingle();
    if (snapshotError)
      throw new Error(
        `도면 검토 스냅샷을 불러오지 못했습니다: ${snapshotError.message}`,
      );
    if (snapshot) {
      reviewEvidence = {
        subjectVersion: snapshot.revision_version,
        snapshotSha256: Sha256.parse(snapshot.sha256),
      };
    }
  }
  const checkpoints = await loadAllDrawingRows<DrawingSnapshotRow>(client, {
    table: "lukas_drawing_snapshots",
    projectId,
    revisionId: revision.id,
    order: [
      { column: "created_at", direction: "desc" },
      { column: "id", direction: "asc" },
    ],
  });
  return {
    file: file as DrawingWorkspaceFile,
    templateCandidates: await loadDrawingTemplateCandidates(client, projectId),
    document: {
      ...document,
      revision: {
        ...revision,
        pages: pagesResult.data ?? [],
        layers,
        objects,
        issues,
        issueLinks,
        reviewEvidence,
        checkpoints: checkpoints.map((checkpoint) => ({
          id: checkpoint.id,
          createdAt: checkpoint.created_at,
          canonicalJson: checkpoint.canonical_json,
        })),
      },
    },
  };
}

export async function loadDrawingWorkspaceSourceUrl(
  client: DrawingWorkspaceClient,
  workspace: DrawingWorkspace,
): Promise<string | null> {
  if (!workspace.document) return null;
  const backgroundPage = workspace.document.revision.pages.find(
    (page): page is DrawingPageRow =>
      "background_pdf_page" in page &&
      typeof page.background_pdf_page === "number",
  );
  const p2Background =
    workspace.document.revision.pages
      .filter((page): page is DrawingWorkspaceP2Page => "canvases" in page)
      .flatMap((page) => page.canvases)
      .map((canvas) => canvas.background)
      .find(
        (background) =>
          background !== null && background.pdfPageNumber !== null,
      ) ?? null;
  if (workspace.file.kind === "pdf" && !backgroundPage && !p2Background)
    return null;
  if (
    (backgroundPage &&
      (backgroundPage.background_source_file_id !== workspace.file.id ||
        backgroundPage.background_source_sha256 !== workspace.file.sha256)) ||
    (p2Background &&
      (p2Background.sourceFileId !== workspace.file.id ||
        p2Background.sourceSha256 !== workspace.file.sha256))
  ) {
    throw new Response("도면 배경 원본 증거가 일치하지 않습니다.", {
      status: 409,
    });
  }
  const { data: signed, error } = await client.storage
    .from("lukas-qto")
    .createSignedUrl(workspace.file.storage_path, 300);
  if (error || !signed?.signedUrl)
    throw new Response("도면 원본을 열지 못했습니다.", { status: 500 });
  return signed.signedUrl;
}

const capabilityByRole: Record<string, DrawingWorkspaceCapability> = {
  owner: "admin",
  staff: "admin",
  estimator: "editor",
  reviewer: "reviewer",
  site: "commenter",
  procurement: "commenter",
  viewer: "viewer",
};

export async function loadDrawingWorkspaceCapability(
  client: DrawingWorkspaceClient,
  projectId: string,
  actorId: string,
  projectOwnerId: string,
  trustedProjectRole: string | null = null,
): Promise<DrawingWorkspaceCapability | null> {
  if (trustedProjectRole === "staff") return "admin";
  if (actorId === projectOwnerId) return "admin";
  const { data: membership, error } = await client
    .from("lukas_qto_project_members")
    .select("role")
    .eq("project_id", projectId)
    .eq("user_id", actorId)
    .maybeSingle();
  if (error)
    throw new Error(`도면 작업 권한을 확인하지 못했습니다: ${error.message}`);
  return membership ? (capabilityByRole[membership.role] ?? null) : null;
}

export class DrawingWorkspaceRpcError extends Error {
  readonly kind = "rpc" as const;

  constructor(message: string) {
    super(message);
    this.name = "DrawingWorkspaceRpcError";
  }
}

export class DrawingWorkspaceConflictError extends Error {
  readonly kind = "conflict" as const;

  constructor(message: string) {
    super(message);
    this.name = "DrawingWorkspaceConflictError";
  }
}

export class DrawingWorkspaceRejectedError extends Error {
  readonly kind = "rejected" as const;

  constructor(message: string) {
    super(message);
    this.name = "DrawingWorkspaceRejectedError";
  }
}

export class DrawingWorkspaceRetryableError extends Error {
  readonly kind = "retryable" as const;

  constructor(message: string) {
    super(message);
    this.name = "DrawingWorkspaceRetryableError";
  }
}

const drawingConflictCodes = new Set([
  "23505",
  "23P01",
  "P1C01",
  "P3F01",
  "P3F02",
]);
const drawingRejectedCodes = new Set(["P1R01"]);
const drawingRetryableCodes = new Set(["40001", "40P01"]);

function rpcResult<T>(
  data: T | null,
  error: { code?: string; message: string } | null,
): T {
  if (error) {
    if (error.code && drawingConflictCodes.has(error.code))
      throw new DrawingWorkspaceConflictError(error.message);
    if (error.code && drawingRejectedCodes.has(error.code))
      throw new DrawingWorkspaceRejectedError(error.message);
    if (error.code && drawingRetryableCodes.has(error.code))
      throw new DrawingWorkspaceRetryableError(error.message);
    throw new DrawingWorkspaceRpcError(error.message);
  }
  if (data === null)
    throw new DrawingWorkspaceRpcError("도면 작업 결과가 없습니다.");
  return data;
}

const CreateDocumentInputSchema = z.object({
  title: Title,
  mode: z.enum(["blank", "pdf_background"]),
});

export async function createDrawingDocument(
  client: DrawingWorkspaceClient,
  projectId: string,
  file: Pick<DrawingWorkspaceFile, "id" | "kind">,
  input: { title: string; mode: "blank" | "pdf_background" },
) {
  const parsed = CreateDocumentInputSchema.parse(input);
  const { data, error } = await client.rpc("lukas_drawing_create_document", {
    p_project_id: projectId,
    p_source_file_id: file.id,
    p_title: parsed.title,
    p_blank: file.kind !== "pdf" || parsed.mode === "blank",
  });
  return rpcResult(data, error);
}

const CreateFromTemplateResultSchema = z
  .object({
    documentId: Uuid,
    revisionId: Uuid,
    sourceRevisionId: Uuid,
  })
  .strict();

export function drawingTemplateWorkspaceLocation(
  projectId: string,
  fileId: string,
  documentId: string,
) {
  return `/projects/${Uuid.parse(projectId)}/drawings/${Uuid.parse(fileId)}/workspace?document=${Uuid.parse(documentId)}`;
}

export function drawingTemplateCloneLocation(
  projectId: string,
  fileId: string,
  result: unknown,
) {
  const clone = CreateFromTemplateResultSchema.parse(result);
  return drawingTemplateWorkspaceLocation(projectId, fileId, clone.documentId);
}

export async function createDrawingDocumentFromTemplate(
  client: DrawingWorkspaceClient,
  sourceRevisionId: string,
  title: string,
  sourceFileId: string | null,
  clientRequestId: string,
) {
  const parsed = CreateFromTemplateMutationSchema.parse({
    intent: "create_from_template",
    sourceRevisionId,
    title,
    sourceFileId,
    clientRequestId,
  });
  const { data, error } = await client.rpc(
    "lukas_drawing_create_from_template",
    {
      p_source_revision_id: parsed.sourceRevisionId,
      p_title: parsed.title,
      p_source_file_id: parsed.sourceFileId,
      p_client_request_id: parsed.clientRequestId,
    },
  );
  return CreateFromTemplateResultSchema.parse(rpcResult(data, error));
}

export async function applyDrawingOperation(
  client: DrawingWorkspaceClient,
  input: DrawingOperationInput,
) {
  const operation = parseOperation(input);
  const { data, error } = await client.rpc("lukas_drawing_apply_operation", {
    p_revision_id: operation.revisionId,
    p_client_operation_id: operation.clientOperationId,
    p_operation_type: operation.type,
    p_base_versions: operation.baseVersions as Json,
    p_forward: operation.forward as Json,
    p_inverse: operation.inverse as Json,
    p_history_action: operation.historyAction ?? null,
    p_original_operation_id: operation.originalOperationId ?? null,
  });
  const result = z
    .object({
      operationId: Uuid,
      sequence: z.number().int().positive(),
      resultVersions: z.record(Uuid, z.number().int().positive().nullable()),
      clientOperationId: Uuid.optional(),
    })
    .strict()
    .parse(rpcResult(data, error));
  if (
    result.clientOperationId &&
    result.clientOperationId !== operation.clientOperationId
  )
    throw new DrawingWorkspaceRpcError(
      "도면 작업 확인 응답의 클라이언트 작업 ID가 일치하지 않습니다.",
    );
  const expectedVersions = expectedOperationResultVersions(operation);
  const touched = Object.keys(expectedVersions);
  if (
    new Set(touched).size !== touched.length ||
    Object.keys(result.resultVersions).length !== touched.length ||
    touched.some(
      (id) =>
        !matchesOperationResultVersion(
          expectedVersions[id],
          result.resultVersions[id],
        ),
    )
  )
    throw new DrawingWorkspaceRpcError(
      "도면 작업 확인 응답이 요청 대상과 일치하지 않습니다.",
    );
  return result;
}

type OperationResultExpectation =
  | { kind: "deleted" }
  | { kind: "at_least"; version: number }
  | { kind: "exact"; version: number };

function matchesOperationResultVersion(
  expected: OperationResultExpectation,
  actual: number | null | undefined,
) {
  if (expected.kind === "deleted") return actual === null;
  return (
    typeof actual === "number" &&
    actual > 0 &&
    (expected.kind === "exact"
      ? actual === expected.version
      : actual >= expected.version)
  );
}

function expectedOperationResultVersions(
  operation: DrawingOperationInput,
): Record<string, OperationResultExpectation> {
  const expected: Record<string, OperationResultExpectation> = {};
  const add = (id: string, version: OperationResultExpectation) => {
    if (id in expected)
      throw new DrawingWorkspaceRpcError("도면 작업 대상 ID가 중복되었습니다.");
    expected[id] = version;
  };
  switch (operation.type) {
    case "add_objects":
      for (const object of AddObjectsPayloadSchema.parse(operation.forward)
        .objects) {
        const base = operation.baseVersions[object.id];
        add(
          object.id,
          base === undefined
            ? { kind: "at_least", version: object.version }
            : { kind: "exact", version: base + 1 },
        );
      }
      break;
    case "update_objects":
      for (const update of UpdateObjectsPayloadSchema.parse(operation.forward)
        .updates)
        add(update.objectId, {
          kind: "exact",
          version: operation.baseVersions[update.objectId] + 1,
        });
      break;
    case "delete_objects":
      for (const id of DeleteObjectsPayloadSchema.parse(operation.forward)
        .objectIds)
        add(id, { kind: "deleted" });
      break;
    case "add_layer": {
      const layer = AddLayerPayloadSchema.parse(operation.forward).layer;
      add(layer.id, { kind: "at_least", version: layer.version });
      break;
    }
    case "update_layer": {
      const layerId = UpdateLayerPayloadSchema.parse(operation.forward).layerId;
      add(layerId, {
        kind: "exact",
        version: operation.baseVersions[layerId] + 1,
      });
      break;
    }
    case "mutate_structure": {
      const forward = MutateStructurePayloadSchema.parse(
        operation.forward,
      ).actions;
      const inverse = MutateStructurePayloadSchema.parse(
        operation.inverse,
      ).actions;
      if (forward.length !== inverse.length)
        throw new DrawingWorkspaceRpcError(
          "도면 작업 확인 응답의 역작업 길이가 일치하지 않습니다.",
        );
      for (const [index, action] of forward.entries()) {
        const inverseAction = inverse[forward.length - index - 1];
        const targetId = structureActionTargetId(action);
        const inverseTargetId = structureActionTargetId(inverseAction);
        const entityKind = action.kind.replace(/^(put|delete)_/, "");
        const expectedInverseKind = action.kind.startsWith("delete_")
          ? `put_${entityKind}`
          : action.baseVersion === null
            ? `delete_${entityKind}`
            : `put_${entityKind}`;
        const inverseBaseIsExact = action.kind.startsWith("delete_")
          ? inverseAction.baseVersion === null
          : action.baseVersion === null
            ? inverseAction.baseVersion !== null
            : inverseAction.baseVersion === action.baseVersion + 1;
        if (
          inverseAction.kind !== expectedInverseKind ||
          inverseTargetId !== targetId ||
          !inverseBaseIsExact
        )
          throw new DrawingWorkspaceRpcError(
            "도면 작업 확인 응답의 역작업이 요청과 일치하지 않습니다.",
          );
        add(
          targetId,
          action.kind.startsWith("delete_")
            ? { kind: "deleted" }
            : { kind: "exact", version: inverseAction.baseVersion as number },
        );
      }
      break;
    }
    case "mutate_objects_with_references": {
      const forward = MutateObjectsWithReferencesPayloadSchema.parse(
        operation.forward,
      );
      const inverse = MutateObjectsWithReferencesPayloadSchema.parse(
        operation.inverse,
      );
      if (
        forward.objectAction === inverse.objectAction ||
        forward.objects.length !== inverse.objects.length ||
        forward.actions.length !== inverse.actions.length
      )
        throw new DrawingWorkspaceRpcError(
          "도면 객체 참조 작업의 역작업이 일치하지 않습니다.",
        );
      for (const [index, action] of forward.actions.entries()) {
        const inverseAction =
          inverse.actions[forward.actions.length - index - 1];
        const targetId = structureActionTargetId(action);
        const entityKind = action.kind.replace(/^(put|delete)_/, "");
        const expectedInverseKind = action.kind.startsWith("delete_")
          ? `put_${entityKind}`
          : action.baseVersion === null
            ? `delete_${entityKind}`
            : `put_${entityKind}`;
        if (
          structureActionTargetId(inverseAction) !== targetId ||
          inverseAction.kind !== expectedInverseKind
        )
          throw new DrawingWorkspaceRpcError(
            "도면 객체 참조 작업의 구조 역작업이 일치하지 않습니다.",
          );
        add(
          targetId,
          action.kind.startsWith("delete_")
            ? { kind: "deleted" }
            : { kind: "exact", version: inverseAction.baseVersion as number },
        );
      }
      for (const object of forward.objects)
        add(
          object.id,
          forward.objectAction === "delete"
            ? { kind: "deleted" }
            : { kind: "exact", version: object.version },
        );
      break;
    }
  }
  return expected;
}

function structureActionTargetId(
  action: { id: string } | { entity: { id: string } },
): string {
  return "id" in action ? action.id : action.entity.id;
}

const DrawingObjectIssueLinkResultSchema = z
  .object({
    id: Uuid,
    objectId: Uuid,
    issueId: Uuid,
    createdBy: Uuid,
    createdAt: z
      .string()
      .refine((value) => !Number.isNaN(Date.parse(value)), "Invalid datetime"),
  })
  .strict();

export async function linkDrawingObjectIssue(
  client: DrawingWorkspaceClient,
  objectId: string,
  issueId: string,
) {
  const { data, error } = await client.rpc("lukas_drawing_link_object_issue", {
    p_object_id: Uuid.parse(objectId),
    p_issue_id: Uuid.parse(issueId),
  });
  return DrawingObjectIssueLinkResultSchema.parse(rpcResult(data, error));
}

export async function requestDrawingReview(
  client: DrawingWorkspaceClient,
  revisionId: string,
) {
  const { data, error } = await client.rpc("lukas_drawing_request_review", {
    p_revision_id: Uuid.parse(revisionId),
  });
  return rpcResult(data, error);
}

const DrawingCollaborativeFreezeResultSchema = z
  .object({
    freezeState: z.literal("frozen"),
    freezeRequestId: Uuid,
    manifestSha256: Sha256,
    manifestCount: z.number().int().nonnegative().max(10_000),
    baseOperationSequence: z.number().int().nonnegative(),
    subjectRevisionVersion: z.number().int().positive(),
    stateVectorBase64: z
      .string()
      .min(1)
      .max(87_384)
      .regex(/^[A-Za-z0-9+/]+={0,2}$/)
      .refine((value) => value.length % 4 === 0),
    operationStatuses: z
      .array(
        z
          .object({
            clientOperationId: Uuid,
            status: z.enum(["acked", "rejected"]),
            authoritativeSequence: z.number().int().positive().nullable(),
            resultVersions: z.record(z.string(), z.number().int().positive()),
          })
          .strict(),
      )
      .max(10_000)
      .superRefine((items, context) => {
        if (
          new Set(items.map((item) => item.clientOperationId)).size !==
          items.length
        )
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Duplicate operation status.",
          });
        if (
          items.some(
            (item) =>
              (item.status === "acked") !==
              (item.authoritativeSequence !== null),
          )
        )
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Operation status sequence is invalid.",
          });
      }),
    operations: z.array(z.record(z.string(), z.unknown())).max(10_000),
  })
  .strict()
  .refine(
    (value) =>
      value.operations.length === value.manifestCount &&
      value.operationStatuses.filter((item) => item.status === "acked")
        .length === value.manifestCount,
  );

type DrawingFreezeFetcher = (
  input: string,
  init: {
    method: "POST";
    body: string;
    headers: Record<string, string>;
    signal: AbortSignal;
  },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export async function requestDrawingCollaborativeReview({
  client,
  projectId,
  revisionId,
  requestId,
  environment = process.env,
  fetcher = fetch as DrawingFreezeFetcher,
}: {
  client: Pick<DrawingWorkspaceClient, "rpc">;
  projectId: string;
  revisionId: string;
  requestId: string;
  environment?: Record<string, string | undefined>;
  fetcher?: DrawingFreezeFetcher;
}) {
  const scope = {
    projectId: Uuid.parse(projectId),
    revisionId: Uuid.parse(revisionId),
    requestId: Uuid.parse(requestId),
  };
  const url = environment.COLLABORATION_INTERNAL_URL;
  const secret = environment.COLLABORATION_FREEZE_SECRET;
  if (!url || !secret || secret.length < 32)
    throw new DrawingWorkspaceRetryableError(
      "공동 편집 동결 서비스를 사용할 수 없습니다.",
    );
  const endpoint = new URL("/internal/freeze", url);
  if (endpoint.protocol !== "http:" && endpoint.protocol !== "https:")
    throw new DrawingWorkspaceRetryableError(
      "공동 편집 동결 서비스 주소가 올바르지 않습니다.",
    );
  const callService = async (
    action: "freeze" | "reconcile" | "release" | "authority",
  ) => {
    const response = await fetcher(endpoint.toString(), {
      method: "POST",
      body: JSON.stringify(
        action === "authority"
          ? {
              action,
              roomName: drawingRoomName(scope.projectId, scope.revisionId),
            }
          : {
              action,
              roomName: drawingRoomName(scope.projectId, scope.revisionId),
              freezeRequestId: scope.requestId,
            },
      ),
      headers: {
        "content-type": "application/json",
        "x-1hk-freeze-secret": secret,
      },
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok)
      throw new DrawingWorkspaceRetryableError(
        "공동 편집 동결 서비스가 준비되지 않았습니다.",
      );
    return response.json();
  };
  const readFrozen = async (action: "freeze" | "reconcile") => {
    const value = DrawingCollaborativeFreezeResultSchema.parse(
      await callService(action),
    );
    if (value.freezeRequestId !== scope.requestId)
      throw new DrawingWorkspaceConflictError(
        "공동 편집 동결 요청이 일치하지 않습니다.",
      );
    return value;
  };
  let frozen;
  try {
    frozen = await readFrozen("freeze");
  } catch {
    // The freeze may have committed even when its HTTP response was lost.
    frozen = await readFrozen("reconcile");
  }
  const args = {
    p_revision_id: scope.revisionId,
    p_request_id: scope.requestId,
    p_manifest_sha256: frozen.manifestSha256,
    p_manifest_count: frozen.manifestCount,
    p_base_operation_sequence: frozen.baseOperationSequence,
    p_subject_revision_version: frozen.subjectRevisionVersion,
    p_state_vector_base64: frozen.stateVectorBase64,
    p_operation_statuses: frozen.operationStatuses as Json,
    p_manifest: frozen.operations as Json,
  };
  const transition = async () => {
    const { data, error } = await client.rpc(
      "lukas_drawing_request_collaborative_review",
      args,
    );
    return rpcResult(data, error);
  };
  try {
    const committed = await transition();
    await callService("authority").catch(() => undefined);
    return committed;
  } catch (error) {
    if (error instanceof DrawingWorkspaceConflictError) {
      await callService("release").catch(() => undefined);
      throw error;
    }
    // A database commit may have succeeded even when its response was lost.
    // Reconcile the persisted request, then repeat the idempotent transaction.
    await callService("reconcile");
    try {
      const committed = await transition();
      await callService("authority").catch(() => undefined);
      return committed;
    } catch (retryError) {
      // Release is authoritative and safe to attempt for every final failure:
      // the DB refuses it if either review attempt actually committed.
      await callService("release").catch(() => undefined);
      throw retryError;
    }
  }
}

export async function reconcileDrawingCollaborationAuthority({
  projectId,
  revisionId,
  environment = process.env,
  fetcher = fetch as DrawingFreezeFetcher,
}: {
  projectId: string;
  revisionId: string;
  environment?: Record<string, string | undefined>;
  fetcher?: DrawingFreezeFetcher;
}) {
  const url = environment.COLLABORATION_INTERNAL_URL;
  const secret = environment.COLLABORATION_FREEZE_SECRET;
  if (!url || !secret || secret.length < 32) return false;
  const response = await fetcher(new URL("/internal/freeze", url).toString(), {
    method: "POST",
    body: JSON.stringify({
      action: "authority",
      roomName: drawingRoomName(Uuid.parse(projectId), Uuid.parse(revisionId)),
    }),
    headers: {
      "content-type": "application/json",
      "x-1hk-freeze-secret": secret,
    },
    signal: AbortSignal.timeout(5_000),
  });
  return response.ok;
}

export async function restoreApprovedDrawingSnapshot(
  client: DrawingWorkspaceClient,
  sourceRevisionId: string,
  requestId: string,
) {
  const { data, error } = await client.rpc(
    "lukas_drawing_restore_approved_snapshot",
    {
      p_source_revision_id: Uuid.parse(sourceRevisionId),
      p_request_id: Uuid.parse(requestId),
    },
  );
  return rpcResult(data, error);
}

export async function recordDrawingRevisionDecision(
  client: DrawingWorkspaceClient,
  input: z.infer<typeof RecordRevisionDecisionMutationSchema>,
) {
  const parsed = RecordRevisionDecisionMutationSchema.parse(input);
  const { data, error } = await client.rpc(
    "lukas_drawing_record_revision_decision",
    {
      p_revision_id: parsed.revisionId,
      p_subject_version: parsed.subjectVersion,
      p_snapshot_sha256: parsed.snapshotSha256,
      p_decision: parsed.decision,
      p_note: parsed.note,
    },
  );
  return rpcResult(data, error);
}

export type DrawingWorkspaceActionBody =
  | {
      ok: true;
      kind: "success";
      error: null;
      result: unknown;
      clientOperationId?: string;
    }
  | {
      ok: false;
      kind: "validation" | "rpc" | "conflict" | "rejected" | "retryable";
      error: string;
    };

type WorkspaceMutationEnvironment = {
  createId: () => string;
  now: () => string;
};

function canEditWorkspace(capability: DrawingWorkspaceCapability) {
  return capability === "admin" || capability === "editor";
}

function canReviewWorkspace(capability: DrawingWorkspaceCapability) {
  return capability === "admin" || capability === "reviewer";
}

function canRestoreApprovedWorkspace(capability: DrawingWorkspaceCapability) {
  return (
    capability === "admin" ||
    capability === "editor" ||
    capability === "reviewer"
  );
}

function currentWorkspaceRevisionId(workspace: DrawingWorkspace) {
  if (!workspace.document) throw new Error("먼저 도면 문서를 만들어야 합니다.");
  return workspace.document.revision.id;
}

function assertCurrentWorkspaceRevision(
  workspace: DrawingWorkspace,
  revisionId: string,
) {
  if (currentWorkspaceRevisionId(workspace) !== revisionId)
    throw new DrawingWorkspaceConflictError(
      "현재 파일의 도면 리비전과 요청이 일치하지 않습니다.",
    );
}

function assertDraftWorkspace(workspace: DrawingWorkspace) {
  const revision = workspace.document?.revision;
  if (
    !revision ||
    (revision.status !== undefined && revision.status !== "draft")
  )
    throw new DrawingWorkspaceConflictError(
      "초안 리비전에서만 도면을 변경할 수 있습니다.",
    );
  return revision;
}

const WorkspaceDocumentModeSchema = z.enum(["blank", "pdf_background"]);

export async function handleWorkspaceMutation({
  client,
  projectId,
  capability,
  workspace,
  form,
  actorId,
  deliverOutcome = deliverDrawingCollaborationOutcome,
  requestReview = requestDrawingCollaborativeReview,
  reconcileDecision = reconcileDrawingCollaborationAuthority,
  environment = {
    createId: () => crypto.randomUUID(),
    now: () => new Date().toISOString(),
  },
}: {
  client: DrawingWorkspaceClient;
  projectId: string;
  capability: DrawingWorkspaceCapability;
  workspace: DrawingWorkspace;
  form: FormData;
  actorId?: string;
  deliverOutcome?: typeof deliverDrawingCollaborationOutcome;
  requestReview?: typeof requestDrawingCollaborativeReview;
  reconcileDecision?: typeof reconcileDrawingCollaborationAuthority;
  environment?: WorkspaceMutationEnvironment;
}): Promise<{ status: number; body: DrawingWorkspaceActionBody }> {
  let receiptOperation: DrawingOperationInput | null = null;
  try {
    const mutation = parseWorkspaceMutation(form);
    let result: unknown;
    let clientOperationId: string | undefined;

    if (mutation.intent === "record_revision_decision") {
      if (!canReviewWorkspace(capability))
        throw new Response("도면 리비전을 검토할 권한이 없습니다.", {
          status: 403,
        });
      assertCurrentWorkspaceRevision(workspace, mutation.revisionId);
      result = await recordDrawingRevisionDecision(client, mutation);
      if (mutation.decision === "rejected")
        await reconcileDecision({
          projectId,
          revisionId: mutation.revisionId,
        }).catch(() => false);
    } else {
      if (
        mutation.intent === "restore_approved_snapshot"
          ? !canRestoreApprovedWorkspace(capability)
          : !canEditWorkspace(capability)
      )
        throw new Response("도면을 편집할 권한이 없습니다.", { status: 403 });

      if (mutation.intent === "create_document") {
        if (workspace.document)
          throw new DrawingWorkspaceConflictError(
            "이 파일에는 이미 도면 문서가 있습니다.",
          );
        const mode = WorkspaceDocumentModeSchema.parse(
          form.get("document_mode") ?? "blank",
        );
        result = await createDrawingDocument(
          client,
          projectId,
          workspace.file,
          {
            title: mutation.title,
            mode,
          },
        );
      } else if (mutation.intent === "create_from_template") {
        if (workspace.document) assertDraftWorkspace(workspace);
        if (
          !workspace.templateCandidates.some(
            (candidate) => candidate.revisionId === mutation.sourceRevisionId,
          )
        )
          throw new DrawingWorkspaceRejectedError(
            "도면 template 대상은 사용할 수 없습니다.",
          );
        if (
          mutation.sourceFileId !== null &&
          mutation.sourceFileId !== workspace.file.id
        )
          throw new DrawingWorkspaceRejectedError(
            "도면 template 원본은 사용할 수 없습니다.",
          );
        result = await createDrawingDocumentFromTemplate(
          client,
          mutation.sourceRevisionId,
          mutation.title,
          mutation.sourceFileId,
          mutation.clientRequestId,
        );
      } else if (mutation.intent === "apply_operation") {
        assertDraftWorkspace(workspace);
        assertCurrentWorkspaceRevision(
          workspace,
          mutation.operation.revisionId,
        );
        receiptOperation = mutation.operation;
        result = await applyDrawingOperation(client, mutation.operation);
        clientOperationId = mutation.operation.clientOperationId;
        if (actorId) {
          const accepted = result as {
            sequence: number;
            resultVersions: Record<string, number | null>;
          };
          let delivered = false;
          try {
            delivered = await deliverOutcome({
              actorId,
              projectId,
              operation: mutation.operation,
              outcome: "acked",
              authoritativeSequence: accepted.sequence,
              resultVersions: Object.fromEntries(
                Object.entries(accepted.resultVersions).filter(
                  (entry): entry is [string, number] =>
                    typeof entry[1] === "number",
                ),
              ),
            });
          } catch {
            // The same idempotent RPC/outbox operation will retry the receipt.
          }
          if (!delivered)
            throw new DrawingWorkspaceRetryableError(
              "공동 편집 결과 전달을 다시 시도합니다.",
            );
        }
      } else if (mutation.intent === "create_layer") {
        assertDraftWorkspace(workspace);
        const revisionId = currentWorkspaceRevisionId(workspace);
        const operation = DrawingOperationInputSchema.parse({
          clientOperationId: environment.createId(),
          revisionId,
          type: "add_layer",
          baseVersions: {},
          forward: {
            type: "add_layer",
            layer: {
              id: environment.createId(),
              name: mutation.name,
              visible: true,
              locked: false,
              version: 1,
            },
          },
          inverse: {},
          createdAt: environment.now(),
        });
        result = await applyDrawingOperation(client, operation);
      } else if (mutation.intent === "request_review") {
        assertCurrentWorkspaceRevision(workspace, mutation.revisionId);
        result = await requestReview({
          client,
          projectId,
          revisionId: mutation.revisionId,
          requestId: mutation.requestId,
        });
      } else if (mutation.intent === "restore_approved_snapshot") {
        assertCurrentWorkspaceRevision(workspace, mutation.sourceRevisionId);
        result = await restoreApprovedDrawingSnapshot(
          client,
          mutation.sourceRevisionId,
          mutation.requestId,
        );
      } else {
        const revision = workspace.document?.revision;
        if (!revision)
          throw new DrawingWorkspaceConflictError(
            "먼저 도면 문서를 만들어야 합니다.",
          );
        if (revision.status !== "draft")
          throw new DrawingWorkspaceConflictError(
            "초안 리비전에서만 이슈를 연결할 수 있습니다.",
          );
        if (!revision.issues.some((issue) => issue.id === mutation.issueId))
          throw new DrawingWorkspaceConflictError(
            "현재 프로젝트의 이슈를 찾을 수 없습니다.",
          );
        result = await linkDrawingObjectIssue(
          client,
          mutation.objectId,
          mutation.issueId,
        );
      }
    }
    return {
      status: 200,
      body: {
        ok: true,
        kind: "success",
        error: null,
        ...(clientOperationId ? { clientOperationId } : {}),
        result,
      },
    };
  } catch (error) {
    if (error instanceof Response) throw error;
    const kind =
      error instanceof DrawingWorkspaceConflictError
        ? "conflict"
        : error instanceof DrawingWorkspaceRejectedError
          ? "rejected"
          : error instanceof DrawingWorkspaceRetryableError
            ? "retryable"
            : error instanceof DrawingWorkspaceRpcError
              ? "rpc"
              : "validation";
    if (
      actorId &&
      receiptOperation &&
      (kind === "conflict" || kind === "rejected")
    ) {
      try {
        const delivered = await deliverOutcome({
          actorId,
          projectId,
          operation: receiptOperation,
          outcome: kind === "conflict" ? "conflicted" : "rejected",
        });
        if (!delivered)
          return {
            status: 503,
            body: {
              ok: false,
              kind: "retryable",
              error: "공동 편집 결과 전달을 다시 시도합니다.",
            },
          };
      } catch {
        return {
          status: 503,
          body: {
            ok: false,
            kind: "retryable",
            error: "공동 편집 결과 전달을 다시 시도합니다.",
          },
        };
      }
    }
    return {
      status:
        kind === "conflict"
          ? 409
          : kind === "rejected"
            ? 404
            : kind === "retryable"
              ? 503
              : 400,
      body: {
        ok: false,
        kind,
        error:
          kind === "rejected"
            ? "도면 대상은 사용할 수 없습니다."
            : error instanceof Error
              ? error.message
              : "도면 작업을 저장하지 못했습니다.",
      },
    };
  }
}
