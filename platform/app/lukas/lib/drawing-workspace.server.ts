import type { SupabaseClient } from "@supabase/supabase-js";
import { createHash, createHmac } from "node:crypto";
import type { Database, Json } from "database.types";
import gltfValidator from "gltf-validator";
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
  DrawingObjectSourceSchema,
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
  normalizeDrawingCanonicalSources,
} from "./drawing-workspace.types.ts";
import { validateDrawingSemanticReferences } from "./drawing-structure.ts";
import {
  deriveDrawingServerMeasurementEvidence,
  type DrawingMeasurementEvidenceError,
  type DrawingMeasurementEvidenceLineage,
  type DrawingServerMeasurementEvidence,
} from "./drawing-semantic-schedules.ts";
import type {
  DrawingBlockInstance,
  DrawingBlock,
  DrawingCanvas,
  DrawingLayer,
  DrawingObject,
  DrawingObjectSource,
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
  | "admin"
  | "editor"
  | "reviewer"
  | "approver"
  | "commenter"
  | "viewer";

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

type DrawingWorkspaceSourceIdentity = {
  id: string;
  kind: "pdf" | "ifc";
  originalFilename: string;
  byteSize: number;
  sha256: string;
};

export type DrawingIfcDerivativeDescriptor =
  | {
      status: "not_applicable";
      version: null;
      sourceSha256: null;
      manifestByteSize: null;
      geometryByteSize: null;
      manifestSha256: null;
      geometrySha256: null;
      manifestSignedUrl: null;
      geometrySignedUrl: null;
    }
  | {
      status: "pending" | "failed";
      version: number | null;
      sourceSha256: string;
      manifestByteSize: null;
      geometryByteSize: null;
      manifestSha256: null;
      geometrySha256: null;
      manifestSignedUrl: null;
      geometrySignedUrl: null;
    }
  | {
      status: "ready";
      version: number;
      sourceSha256: string;
      /** Client authority: reject fetched bytes whose length differs. */
      manifestByteSize: number;
      /** Client authority: reject fetched bytes whose length differs. */
      geometryByteSize: number;
      /** Client authority: re-hash bytes fetched from the signed URL. */
      manifestSha256: string;
      /** Client authority: re-hash bytes fetched from the signed URL. */
      geometrySha256: string;
      manifestSignedUrl: string;
      geometrySignedUrl: string;
    };

export type DrawingWorkspacePdfSourceDescriptor =
  DrawingWorkspaceSourceIdentity & {
    kind: "pdf";
    signedUrl: string;
    derivative: DrawingIfcDerivativeDescriptor;
  };

export type DrawingWorkspaceIfcSourceDescriptor =
  DrawingWorkspaceSourceIdentity & {
    kind: "ifc";
    derivative: DrawingIfcDerivativeDescriptor;
  };

export type DrawingWorkspaceSourceDescriptor =
  | DrawingWorkspacePdfSourceDescriptor
  | DrawingWorkspaceIfcSourceDescriptor;

export type DrawingWorkspaceSourceCatalogItem = DrawingWorkspaceSourceIdentity;

const IfcDerivativePropertyValueSchema = z.union([
  z.string().max(4_000),
  z.number().finite(),
  z.boolean(),
  z.null(),
]);

const IfcDerivativePropertySchema = z
  .object({
    group: z.string().trim().min(1).max(160),
    name: z.string().trim().min(1).max(160),
    value: IfcDerivativePropertyValueSchema,
  })
  .strict();

const IfcDerivativeMeshMappingSchema = z
  .object({
    nodeId: z.string().trim().min(1).max(256),
    primitiveIndices: z.array(z.number().int().nonnegative()).min(1).max(1_000),
  })
  .strict()
  .superRefine((mapping, context) => {
    if (
      new Set(mapping.primitiveIndices).size !== mapping.primitiveIndices.length
    )
      context.addIssue({
        code: "custom",
        message: "primitiveIndices must be unique",
        path: ["primitiveIndices"],
      });
  });

const IfcDerivativeElementSchema = z
  .object({
    expressId: z.number().int().positive(),
    globalId: z.string().regex(/^[0-9A-Za-z_$]{22}$/),
    typeName: z.string().trim().min(1).max(160),
    name: z.string().max(500).nullable(),
    meshes: z.array(IfcDerivativeMeshMappingSchema).min(1).max(10_000),
    properties: z.array(IfcDerivativePropertySchema).max(10_000),
  })
  .strict();

export const IfcDerivativeManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    source: z
      .object({
        fileId: z.string().uuid(),
        sha256: z.string().regex(/^[0-9a-f]{64}$/),
      })
      .strict(),
    geometry: z.object({ sha256: z.string().regex(/^[0-9a-f]{64}$/) }).strict(),
    elements: z.array(IfcDerivativeElementSchema).max(1_000_000),
  })
  .strict()
  .superRefine((manifest, context) => {
    const expressIds = new Set<number>();
    const globalIds = new Set<string>();
    const meshPrimitiveTuples = new Set<string>();
    manifest.elements.forEach((element, index) => {
      if (expressIds.has(element.expressId))
        context.addIssue({
          code: "custom",
          message: "duplicate expressId",
          path: ["elements", index, "expressId"],
        });
      expressIds.add(element.expressId);
      if (globalIds.has(element.globalId))
        context.addIssue({
          code: "custom",
          message: "duplicate globalId",
          path: ["elements", index, "globalId"],
        });
      globalIds.add(element.globalId);
      element.meshes.forEach((mapping, mappingIndex) =>
        mapping.primitiveIndices.forEach((primitiveIndex) => {
          const tuple = `${mapping.nodeId}\0${primitiveIndex}`;
          if (meshPrimitiveTuples.has(tuple))
            context.addIssue({
              code: "custom",
              message: "duplicate nodeId and primitiveIndex tuple",
              path: [
                "elements",
                index,
                "meshes",
                mappingIndex,
                "primitiveIndices",
              ],
            });
          meshPrimitiveTuples.add(tuple);
        }),
      );
    });
  });

export type IfcDerivativeManifest = z.infer<typeof IfcDerivativeManifestSchema>;

type DrawingIfcDerivativeRow = {
  id: string;
  project_id: string;
  source_file_id: string;
  source_sha256: string;
  version: number;
  schema_version: number;
  status: "pending" | "ready" | "failed";
  manifest_json: Json | null;
  manifest_storage_path: string | null;
  manifest_byte_size: number | null;
  manifest_sha256: string | null;
  geometry_storage_path: string | null;
  geometry_byte_size: number | null;
  geometry_sha256: string | null;
};

type DrawingRevisionIfcDerivativeRow = {
  id: string;
  revision_id: string;
  revision_version: number;
  project_id: string;
  source_file_id: string;
  source_sha256: string;
  derivative_id: string;
  derivative_version: number;
  manifest_sha256: string;
  geometry_sha256: string;
};

export type DrawingWorkspaceSourceBundle = {
  primary:
    | DrawingWorkspaceSourceDescriptor
    | DrawingWorkspaceSourceCatalogItem
    | null;
  pdf: DrawingWorkspacePdfSourceDescriptor | null;
  ifc: DrawingWorkspaceIfcSourceDescriptor | null;
  previousPdf: DrawingWorkspaceSourceCatalogItem | null;
  revisionEdge: {
    id: string;
    previousFileId: string;
    previousSha256: string;
    currentFileId: string;
    currentSha256: string;
  } | null;
  catalog: DrawingWorkspaceSourceCatalogItem[];
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
  status: "draft" | "review_requested" | "reviewed" | "approved" | "superseded";
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

type DrawingObjectSourceRow = {
  id: string;
  object_id: string;
  revision_id: string;
  project_id: string;
  source_file_id: string;
  source_sha256: string;
  source_kind: "pdf_region" | "ifc_element";
  pdf_page_number: number | null;
  x: number | null;
  y: number | null;
  width: number | null;
  height: number | null;
  element_id: string | null;
  ifc_global_id: string | null;
  camera: Json | null;
  version: number;
  status: "active" | "deleted";
};

type DrawingFileRevisionEdgeRow = {
  id: string;
  project_id: string;
  previous_file_id: string;
  previous_sha256: string;
  current_file_id: string;
  current_sha256: string;
  relation_kind: string;
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

type DrawingEstimateBindingRow = {
  id: string;
  project_id: string;
  drawing_revision_id: string;
  boq_version_id: string;
  created_by: string;
  created_at: string;
};

type DrawingEstimateBindingInsert = Omit<
  DrawingEstimateBindingRow,
  "id" | "created_at"
> & { id?: string; created_at?: string };

type DrawingQuantityLinkRow = {
  id: string;
  project_id: string;
  drawing_revision_id: string;
  drawing_revision_version: number;
  drawing_snapshot_sha256: string;
  drawing_object_id: string;
  drawing_object_lineage_id: string;
  drawing_object_version: number;
  object_fingerprint: string;
  measurement_kind: "length" | "area" | "count";
  raw_quantity: number;
  unit: "EA" | "m" | "m2";
  measurement_rule_version: "P4_MEASUREMENT_V1";
  created_by: string;
  created_at: string;
};

type DrawingBoqLinkRow = {
  id: string;
  project_id: string;
  quantity_link_id: string;
  boq_version_id: string;
  boq_line_id: string;
  allocation_factor: number;
  version: number;
  created_by: string;
  updated_by: string;
  created_at: string;
  updated_at: string;
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
      lukas_drawing_ifc_derivatives: TableDefinition<DrawingIfcDerivativeRow>;
      lukas_drawing_revision_ifc_derivatives: TableDefinition<DrawingRevisionIfcDerivativeRow>;
      lukas_drawing_documents: TableDefinition<DrawingDocumentRow>;
      lukas_drawing_revisions: TableDefinition<DrawingRevisionRow>;
      lukas_drawing_pages: TableDefinition<DrawingPageRow>;
      lukas_drawing_layers: TableDefinition<DrawingLayerRow>;
      lukas_drawing_objects: TableDefinition<DrawingObjectRow>;
      lukas_drawing_object_sources: TableDefinition<DrawingObjectSourceRow>;
      lukas_drawing_canvases: TableDefinition<Record<string, unknown>>;
      lukas_drawing_styles: TableDefinition<Record<string, unknown>>;
      lukas_drawing_blocks: TableDefinition<Record<string, unknown>>;
      lukas_drawing_block_instances: TableDefinition<Record<string, unknown>>;
      lukas_drawing_property_schemas: TableDefinition<Record<string, unknown>>;
      lukas_drawing_property_values: TableDefinition<Record<string, unknown>>;
      lukas_drawing_tables: TableDefinition<Record<string, unknown>>;
      lukas_drawing_snapshots: TableDefinition<DrawingSnapshotRow>;
      lukas_drawing_estimate_bindings: TableDefinition<
        DrawingEstimateBindingRow,
        DrawingEstimateBindingInsert
      >;
      lukas_drawing_quantity_links: TableDefinition<DrawingQuantityLinkRow>;
      lukas_drawing_boq_links: TableDefinition<DrawingBoqLinkRow>;
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
      lukas_drawing_create_document_idempotent: DrawingRpc<{
        p_project_id: string;
        p_source_file_id: string | null;
        p_title: string;
        p_blank: boolean;
        p_client_request_id: string;
        p_library_version_id: string | null;
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
        p_decision: "reviewed" | "approved" | "rejected";
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
      lukas_drawing_publish_ifc_derivative_ready: DrawingRpc<{
        p_project_id: string;
        p_source_file_id: string;
        p_source_sha256: string;
        p_version: number;
        p_manifest_json: Json;
        p_manifest_storage_path: string;
        p_manifest_byte_size: number;
        p_manifest_sha256: string;
        p_geometry_storage_path: string;
        p_geometry_byte_size: number;
        p_geometry_sha256: string;
        p_created_by: string;
      }>;
    };
  };
};

export type DrawingWorkspaceClient = SupabaseClient<DrawingWorkspaceDatabase>;

const drawingObjectPageSize = 1_000;
const drawingRowsMaxPageSize = 1_000;

type DrawingRowsTable =
  | "lukas_qto_files"
  | "lukas_drawing_ifc_derivatives"
  | "lukas_drawing_revision_ifc_derivatives"
  | "lukas_qto_file_revisions"
  | "lukas_drawing_pages"
  | "lukas_drawing_canvases"
  | "lukas_drawing_layers"
  | "lukas_drawing_objects"
  | "lukas_drawing_object_sources"
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
const DrawingWorkspacePreviousPdfRequestSchema = z
  .object({
    revisionEdgeId: Uuid,
    currentFileId: Uuid,
    currentSha256: Sha256,
    previousFileId: Uuid,
    previousSha256: Sha256,
    pageNumber: z.number().int().positive(),
  })
  .strict();
export type DrawingWorkspacePreviousPdfRequest = z.infer<
  typeof DrawingWorkspacePreviousPdfRequestSchema
>;

export function parseDrawingWorkspacePreviousPdfForm(form: FormData) {
  const fields = new Set([
    "intent",
    "revision_edge_id",
    "current_file_id",
    "current_sha256",
    "previous_file_id",
    "previous_sha256",
    "page_number",
  ]);
  if (
    form.get("intent") !== "load_pdf_compare" ||
    [...form.keys()].some(
      (key) => !fields.has(key) || form.getAll(key).length !== 1,
    )
  )
    throw new Error("PDF 개정 비교 요청 형식이 올바르지 않습니다.");
  return DrawingWorkspacePreviousPdfRequestSchema.parse({
    revisionEdgeId: form.get("revision_edge_id"),
    currentFileId: form.get("current_file_id"),
    currentSha256: form.get("current_sha256"),
    previousFileId: form.get("previous_file_id"),
    previousSha256: form.get("previous_sha256"),
    pageNumber: Number(form.get("page_number")),
  });
}
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

function workspaceMutationValidationError(field: string, message: string) {
  return new z.ZodError([
    {
      code: "custom",
      path: [field],
      message,
    },
  ]);
}

function parseExactPayload(schema: z.ZodTypeAny, value: unknown): unknown {
  const parsed = schema.parse(value);
  if (!sameJsonValue(parsed, value))
    throw workspaceMutationValidationError(
      "operation_json",
      "도면 작업 도메인 JSON에 허용되지 않은 필드가 있습니다.",
    );
  return parsed;
}

function parseOperation(value: unknown): DrawingOperationInput {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw workspaceMutationValidationError(
      "operation_json",
      "도면 작업 JSON 형식이 올바르지 않습니다.",
    );
  const keys = Object.keys(value).sort();
  if (
    !(
      (keys.length === exactOperationKeys.length &&
        keys.every((key, index) => key === exactOperationKeys[index])) ||
      (keys.length === exactHistoryOperationKeys.length &&
        keys.every((key, index) => key === exactHistoryOperationKeys[index]))
    )
  )
    throw workspaceMutationValidationError(
      "operation_json",
      "도면 작업에 허용되지 않은 필드가 있습니다.",
    );
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
  decision: z.enum(["reviewed", "approved", "rejected"]),
  note: DecisionNote,
});
const RestoreApprovedSnapshotMutationSchema = z.object({
  intent: z.literal("restore_approved_snapshot"),
  sourceRevisionId: Uuid,
  requestId: Uuid,
});

const DrawingQuantityLinkFormSchema = z
  .object({
    intent: z.literal("create_drawing_quantity_link"),
    linkId: Uuid,
    drawingRevisionId: Uuid,
    drawingObjectId: Uuid,
    measurementKind: z.enum(["length", "area", "count"]),
  })
  .strict();

export function parseDrawingQuantityLinkForm(form: FormData) {
  const allowed = new Set([
    "intent",
    "link_id",
    "revision_id",
    "object_id",
    "measurement_kind",
  ]);
  for (const key of form.keys())
    if (!allowed.has(key))
      throw new Error("요청에 허용되지 않은 필드가 있습니다.");
  return DrawingQuantityLinkFormSchema.parse({
    intent: form.get("intent"),
    linkId: form.get("link_id"),
    drawingRevisionId: form.get("revision_id"),
    drawingObjectId: form.get("object_id"),
    measurementKind: form.get("measurement_kind"),
  });
}

export function parseDrawingQuantityLineageSearch(
  searchParams: URLSearchParams,
) {
  try {
    const one = (name: string) => {
      const values = searchParams.getAll(name);
      if (values.length > 1) throw new Error("duplicate URL value");
      return values[0] ?? null;
    };
    const revision = one("revision");
    const object = one("object");
    const boq = one("boq");
    const line = one("line");
    const evidence = one("evidence");
    const cursor = one("quantityCursor");
    if (cursor && !object) throw new Error("orphan cursor");
    if (
      (boq || line || evidence) &&
      !(revision && object && boq && line && evidence)
    )
      throw new Error("incomplete BOQ evidence");
    return {
      revisionId: revision ? Uuid.parse(revision) : null,
      objectId: object ? Uuid.parse(object) : null,
      boqVersionId: boq ? Uuid.parse(boq) : null,
      boqLineId: line ? Uuid.parse(line) : null,
      evidenceFileId: evidence ? Uuid.parse(evidence) : null,
      cursor,
    };
  } catch {
    throw new Error("도면 수량 근거 URL이 올바르지 않습니다.");
  }
}

export function assertDrawingBoqEvidenceScope(
  lineage: {
    rows: Array<{
      boqLinks: Array<{ boqVersionId: string; boqLineId: string }>;
    }>;
  },
  input: { boqVersionId: string; boqLineId: string },
) {
  const boqVersionId = Uuid.parse(input.boqVersionId);
  const boqLineId = Uuid.parse(input.boqLineId);
  if (
    !lineage.rows.some((row) =>
      row.boqLinks.some(
        (link) =>
          link.boqVersionId === boqVersionId && link.boqLineId === boqLineId,
      ),
    )
  )
    throw new DrawingWorkspaceConflictError(
      "연결된 도면 근거를 열 수 없습니다.",
    );
  return { boqVersionId, boqLineId };
}

export type WorkspaceMutation =
  | z.infer<typeof CreateFromTemplateMutationSchema>
  | { intent: "apply_operation"; operation: DrawingOperationInput }
  | z.infer<typeof CreateLayerMutationSchema>
  | z.infer<typeof LinkIssueMutationSchema>
  | z.infer<typeof RequestReviewMutationSchema>
  | z.infer<typeof RestoreApprovedSnapshotMutationSchema>
  | z.infer<typeof RecordRevisionDecisionMutationSchema>;

const allowedFormFields = {
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
      throw workspaceMutationValidationError(
        key,
        "요청에 허용되지 않은 필드가 있습니다.",
      );
}

function jsonFormValue(form: FormData, name: string): unknown {
  const value = form.get(name);
  if (typeof value !== "string")
    throw workspaceMutationValidationError(name, "도면 작업 JSON이 없습니다.");
  try {
    return JSON.parse(value);
  } catch {
    throw workspaceMutationValidationError(
      name,
      "도면 작업 JSON 형식이 올바르지 않습니다.",
    );
  }
}

export function parseWorkspaceMutation(form: FormData): WorkspaceMutation {
  const intent = form.get("intent");
  if (typeof intent !== "string" || !(intent in allowedFormFields))
    throw workspaceMutationValidationError(
      "intent",
      "지원하지 않는 도면 작업입니다.",
    );
  const knownIntent = intent as keyof typeof allowedFormFields;
  assertAllowedFormFields(form, knownIntent);

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

export type DrawingWorkspaceDocument = DrawingDocumentRow & {
  revision: DrawingRevisionRow & {
    pages: Array<DrawingPageRow | DrawingWorkspaceP2Page>;
    layers: Array<DrawingLayerRow | DrawingLayer>;
    objects: Array<DrawingObjectRow | DrawingObject>;
    sources?: DrawingObjectSource[];
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
};

export type DrawingWorkspace = {
  primarySource: DrawingWorkspaceFile | null;
  templateCandidates: DrawingTemplateCandidate[];
  document: DrawingWorkspaceDocument;
};

export function assertDrawingQuantityWorkspaceScope(
  workspace: DrawingWorkspace,
  input: { fileId: string; revisionId: string; objectId: string },
) {
  const document = workspace.document;
  if (
    !workspace.primarySource ||
    workspace.primarySource.id !== Uuid.parse(input.fileId) ||
    document.revision.id !== Uuid.parse(input.revisionId) ||
    !document.revision.objects.some((object) => object.id === input.objectId) ||
    (document.source_file_id !== null &&
      document.source_file_id !== workspace.primarySource.id)
  )
    throw new DrawingWorkspaceConflictError(
      "연결된 도면 근거를 열 수 없습니다.",
    );
  return { requiresEntryResolution: document.source_file_id === null };
}

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
  .strict()
  .transform((value) => ({
    ...value,
    sources: normalizeDrawingCanonicalSources(value.sources, value.revision.id),
  }));

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
      "reviewed",
      "approved",
      "superseded",
    ]),
    capability: z.enum([
      "admin",
      "editor",
      "reviewer",
      "approver",
      "commenter",
      "viewer",
    ]),
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

export function parseDrawingWorkspaceCollaborationBootstrap(input: unknown) {
  return DrawingWorkspaceCollaborationBootstrapSchema.parse(input);
}

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
    documentId: bootstrap.canonicalJson.revision.documentId,
    revisionId: bootstrap.canonicalJson.revision.id,
    revisionVersion: bootstrap.canonicalJson.revision.version,
    snapshotSha256: bootstrap.sha256,
    operationCheckpoint: bootstrap.operationSequence,
    state: {
      revisionId: bootstrap.canonicalJson.revision.id,
      objects: objectMap,
    },
  });
}

export type DrawingWorkspaceMeasurementState = {
  authorizedCapability: DrawingWorkspaceCapability;
  collaborationBootstrap: DrawingWorkspaceCollaborationBootstrap | null;
  measurementEvidence: DrawingServerMeasurementEvidence | null;
  measurementEvidenceError: DrawingMeasurementEvidenceError | null;
};

export type DrawingAuthorizedMeasurementEvidenceResult = {
  evidence: DrawingServerMeasurementEvidence | null;
  error: DrawingMeasurementEvidenceError | null;
};

/** Converts only post-authorization derivation failures into bounded UI state. */
export function deriveAuthorizedDrawingMeasurementEvidenceResult(
  bootstrap: DrawingWorkspaceCollaborationBootstrap,
): DrawingAuthorizedMeasurementEvidenceResult {
  try {
    return {
      evidence: deriveAuthorizedDrawingMeasurementEvidence(bootstrap),
      error: null,
    };
  } catch {
    return {
      evidence: null,
      error: {
        code: "measurement_derivation_failed",
        message: "서버 측정 증거를 계산하지 못했습니다.",
      },
    };
  }
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

/** Authorization/bootstrap errors propagate; only later derivation is bounded. */
export async function loadDrawingWorkspaceMeasurementState(
  client: Pick<DrawingWorkspaceClient, "rpc">,
  expected: Pick<
    DrawingMeasurementEvidenceLineage,
    "documentId" | "revisionId" | "revisionVersion"
  >,
): Promise<DrawingWorkspaceMeasurementState> {
  const collaborationBootstrap =
    await loadDrawingWorkspaceCollaborationBootstrap(
      client,
      expected.revisionId,
    );
  if (
    collaborationBootstrap.canonicalJson.revision.documentId !==
    expected.documentId
  )
    throw new DrawingWorkspaceRpcError(
      "Drawing measurement document lineage is inconsistent.",
    );
  if (
    collaborationBootstrap.canonicalJson.revision.version !==
    expected.revisionVersion
  )
    throw new DrawingWorkspaceRpcError(
      "Drawing measurement revision lineage is inconsistent.",
    );
  const result = deriveAuthorizedDrawingMeasurementEvidenceResult(
    collaborationBootstrap,
  );
  return {
    authorizedCapability: collaborationBootstrap.capability,
    collaborationBootstrap: result.error ? null : collaborationBootstrap,
    measurementEvidence: result.evidence,
    measurementEvidenceError: result.error,
  };
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
  sources: DrawingObjectSource[];
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

const P2SourceRowSchema = z
  .object({
    id: Uuid,
    object_id: Uuid,
    revision_id: Uuid,
    project_id: Uuid,
    source_file_id: Uuid,
    source_sha256: Sha256,
    source_kind: z.enum(["pdf_region", "ifc_element"]),
    pdf_page_number: z.number().int().positive().nullable(),
    x: z.number().nullable(),
    y: z.number().nullable(),
    width: z.number().nullable(),
    height: z.number().nullable(),
    element_id: z.string().nullable(),
    ifc_global_id: z.string().nullable(),
    camera: z.unknown().nullable(),
    version: z.number().int().positive(),
    status: z.literal("active"),
  })
  .strict();

export async function loadDrawingRevisionSources(
  client: Pick<DrawingWorkspaceClient, "from">,
  projectId: string,
  revisionId: string,
): Promise<DrawingObjectSource[]> {
  const rows = await loadAllDrawingRows<DrawingObjectSourceRow>(client, {
    table: "lukas_drawing_object_sources",
    projectId,
    revisionId,
    filters: [["status", "active"]],
    order: [{ column: "id", direction: "asc" }],
    select:
      "id,object_id,revision_id,project_id,source_file_id,source_sha256,source_kind,pdf_page_number,x,y,width,height,element_id,ifc_global_id,camera:camera_json,version,status",
  });
  return rows.map((row) => {
    const parsed = P2SourceRowSchema.safeParse(row);
    if (
      !parsed.success ||
      parsed.data.project_id !== projectId ||
      parsed.data.revision_id !== revisionId
    )
      throw new Error("Drawing source metadata is invalid.");
    const value = parsed.data;
    return DrawingObjectSourceSchema.parse(
      value.source_kind === "pdf_region"
        ? {
            id: value.id,
            objectId: value.object_id,
            revisionId: value.revision_id,
            sourceFileId: value.source_file_id,
            sourceSha256: value.source_sha256,
            sourceKind: value.source_kind,
            pdfPageNumber: value.pdf_page_number,
            x: value.x,
            y: value.y,
            width: value.width,
            height: value.height,
            version: value.version,
          }
        : {
            id: value.id,
            objectId: value.object_id,
            revisionId: value.revision_id,
            sourceFileId: value.source_file_id,
            sourceSha256: value.source_sha256,
            sourceKind: value.source_kind,
            ifcGlobalId: value.ifc_global_id,
            elementId: value.element_id,
            camera: value.camera,
            version: value.version,
          },
    );
  });
}

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
  file: DrawingWorkspaceFile | null,
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
    sources: DrawingObjectSource[];
  },
  focusObjectId?: string,
  focusEvidenceFileId?: string,
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
  const sources = rows.sources;
  const byId = <T extends { id: string }>(values: T[]) =>
    new Set(values.map((value) => value.id));
  const pageIds = byId(pages),
    canvasIds = byId(canvases),
    layerIds = byId(layers),
    blockIds = byId(blocks),
    objectIds = byId(objects),
    instanceIds = byId(blockInstances),
    propertySchemaIds = byId(propertySchemas);
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
  requireP2Ancestry(
    sources.every(
      (source) =>
        source.revisionId === revisionId && objectIds.has(source.objectId),
    ),
    "Drawing source ancestry is invalid.",
  );
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
        (file !== null &&
          canvas.background.sourceFileId === file.id &&
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
  const focusedObject = focusObjectId
    ? objects.find((object) => object.id === focusObjectId)
    : null;
  if (focusObjectId && !focusedObject)
    throw new DrawingWorkspaceConflictError(
      "연결된 도면 근거를 열 수 없습니다.",
    );
  const focusedLayer = focusedObject
    ? layers.find((layer) => layer.id === focusedObject.layerId)
    : null;
  const focusedCanvas = focusedLayer
    ? canvases.find((canvas) => canvas.id === focusedLayer.canvasId)
    : null;
  if (focusedObject && (!focusedLayer || !focusedCanvas))
    throw new DrawingWorkspaceConflictError(
      "연결된 도면 근거를 열 수 없습니다.",
    );
  const focusedEvidence = focusEvidenceFileId
    ? sources.filter(
        (source) =>
          source.objectId === focusObjectId &&
          source.sourceFileId === focusEvidenceFileId,
      )
    : [];
  if (focusEvidenceFileId && focusedEvidence.length !== 1)
    throw new DrawingWorkspaceConflictError(
      "연결된 도면 근거를 열 수 없습니다.",
    );
  const focusedPdfEvidence = focusedEvidence.find(
    (source) => source.sourceKind === "pdf_region",
  );
  const focusedBackground = focusedCanvas?.background;
  if (
    focusedPdfEvidence &&
    (focusedBackground?.sourceFileId !== focusEvidenceFileId ||
      focusedBackground?.pdfPageNumber !== focusedPdfEvidence.pdfPageNumber)
  )
    throw new DrawingWorkspaceConflictError(
      "연결된 도면 근거를 열 수 없습니다.",
    );
  const activePage = focusedCanvas
    ? orderedPages.find((page) => page.id === focusedCanvas.pageId)
    : orderedPages[0];
  const activeCanvas =
    focusedCanvas ??
    (activePage &&
      sorted(
        canvases.filter(
          (canvas) =>
            canvas.pageId === activePage.id &&
            canvas.spaceKind === "paper" &&
            canvas.sortOrder === 0,
        ),
        (canvas) => canvas.sortOrder,
      )[0]);
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
    sources: sorted(sources, () => 0),
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

async function loadDrawingWorkspaceFile(
  client: DrawingWorkspaceClient,
  projectId: string,
  fileId: string,
) {
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
  return file as DrawingWorkspaceFile;
}

async function loadImmutableDrawingSource(
  client: DrawingWorkspaceClient,
  projectId: string,
  fileId: string,
  sha256: string | null,
) {
  if (!sha256)
    throw new Response("도면 원본을 찾을 수 없습니다.", { status: 404 });
  const file = await loadDrawingWorkspaceFile(client, projectId, fileId);
  if (file.sha256 !== sha256)
    throw new Response("도면 원본을 찾을 수 없습니다.", { status: 404 });
  return file;
}

type LoadDrawingWorkspaceInput = {
  projectId: string;
  workspaceId: string;
  revisionId?: string;
  focusObjectId?: string;
  focusEvidenceFileId?: string;
};

export async function loadDrawingWorkspace(
  client: DrawingWorkspaceClient,
  input: LoadDrawingWorkspaceInput,
): Promise<DrawingWorkspace> {
  const projectId = input.projectId;
  const documentId = input.workspaceId;
  const revisionId = input.revisionId;
  const focusObjectId = input.focusObjectId;
  const focusEvidenceFileId = input.focusEvidenceFileId;
  let file: DrawingWorkspaceFile | null = null;

  const documentQuery = client
    .from("lukas_drawing_documents")
    .select("*")
    .eq("project_id", projectId)
    .eq("id", Uuid.parse(documentId));
  const { data: document, error: documentError } =
    await documentQuery.maybeSingle();
  if (documentError)
    throw new Error(
      `도면 문서를 불러오지 못했습니다: ${documentError.message}`,
    );
  if (!document)
    throw new Response("도면 문서를 찾을 수 없습니다.", { status: 404 });

  let revisionQuery = client
    .from("lukas_drawing_revisions")
    .select("*")
    .eq("project_id", projectId)
    .eq("document_id", document.id);
  revisionQuery = revisionId
    ? revisionQuery.eq("id", Uuid.parse(revisionId))
    : revisionQuery.order("sequence", { ascending: false }).limit(1);
  const { data: revision, error: revisionError } =
    await revisionQuery.maybeSingle();
  if (revisionError)
    throw new Error(
      `도면 리비전을 불러오지 못했습니다: ${revisionError.message}`,
    );
  if (!revision)
    throw new Response("도면 리비전을 찾을 수 없습니다.", { status: 404 });
  if (
    document.project_id !== projectId ||
    revision.project_id !== projectId ||
    revision.document_id !== document.id
  )
    throw new Error("Drawing document ancestry is invalid.");

  if (!file && document.source_file_id)
    file = await loadImmutableDrawingSource(
      client,
      projectId,
      document.source_file_id,
      document.source_sha256,
    );

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
      sources,
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
      loadDrawingRevisionSources(client, projectId, revision.id),
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
      file,
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
        sources,
      },
      focusObjectId,
      focusEvidenceFileId,
    );
    const objectIds = new Set(p2.objects.map((object) => object.id));
    const issueIds = new Set(issues.map((issue) => issue.id));
    return {
      primarySource: file,
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
  if (
    revision.status === "review_requested" ||
    revision.status === "reviewed"
  ) {
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
    primarySource: file,
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
  if (!workspace.primarySource) return null;
  if (workspace.primarySource.kind === "ifc") return null;
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
  if (
    workspace.primarySource.kind === "pdf" &&
    !backgroundPage &&
    !p2Background
  )
    return null;
  if (
    (backgroundPage &&
      (backgroundPage.background_source_file_id !==
        workspace.primarySource.id ||
        backgroundPage.background_source_sha256 !==
          workspace.primarySource.sha256)) ||
    (p2Background &&
      (p2Background.sourceFileId !== workspace.primarySource.id ||
        p2Background.sourceSha256 !== workspace.primarySource.sha256))
  ) {
    throw new Response("도면 배경 원본 증거가 일치하지 않습니다.", {
      status: 409,
    });
  }
  const { data: signed, error } = await client.storage
    .from("lukas-qto")
    .createSignedUrl(workspace.primarySource.storage_path, 300);
  if (error || !signed?.signedUrl)
    throw new Response("도면 원본을 열지 못했습니다.", { status: 500 });
  return signed.signedUrl;
}

function drawingWorkspaceSourceCatalogItem(
  file: DrawingWorkspaceFile,
): DrawingWorkspaceSourceCatalogItem {
  return {
    id: file.id,
    kind: file.kind,
    originalFilename: file.original_filename,
    byteSize: file.byte_size,
    sha256: file.sha256,
  };
}

function canonicalIfcDerivativeJson(value: unknown): string {
  if (Array.isArray(value))
    return `[${value.map(canonicalIfcDerivativeJson).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(
        ([key, child]) =>
          `${JSON.stringify(key)}:${canonicalIfcDerivativeJson(child)}`,
      )
      .join(",")}}`;
  const serialized = JSON.stringify(value);
  if (serialized === undefined)
    throw new Error("Invalid derivative JSON value");
  return serialized;
}

const noIfcDerivative = (
  sourceSha256: string,
  status: "pending" | "failed" = "pending",
  version: number | null = null,
): DrawingIfcDerivativeDescriptor => ({
  status,
  version,
  sourceSha256,
  manifestByteSize: null,
  geometryByteSize: null,
  manifestSha256: null,
  geometrySha256: null,
  manifestSignedUrl: null,
  geometrySignedUrl: null,
});

const notApplicableDerivative: DrawingIfcDerivativeDescriptor = {
  status: "not_applicable",
  version: null,
  sourceSha256: null,
  manifestByteSize: null,
  geometryByteSize: null,
  manifestSha256: null,
  geometrySha256: null,
  manifestSignedUrl: null,
  geometrySignedUrl: null,
};

const ifcManifestMaxBytes = 32 * 1024 * 1024;
const ifcGeometryMaxBytes = 200 * 1024 * 1024;

function contentAddressedIfcDerivativePaths(row: DrawingIfcDerivativeRow) {
  const prefix = `projects/${row.project_id}/ifc-derivatives/${row.source_sha256}/v${row.version}`;
  return {
    manifest: `${prefix}/${row.manifest_sha256}.json`,
    geometry: `${prefix}/${row.geometry_sha256}.glb`,
  };
}

function readValidatedGlbDocument(bytes: Uint8Array): Record<string, unknown> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 12;
  let document: Record<string, unknown> | null = null;
  while (offset < bytes.byteLength) {
    const length = view.getUint32(offset, true);
    const type = view.getUint32(offset + 4, true);
    offset += 8;
    if (type === 0x4e4f534a) {
      const source = new TextDecoder("utf-8", { fatal: true })
        .decode(bytes.subarray(offset, offset + length))
        .trimEnd();
      document = JSON.parse(source) as Record<string, unknown>;
      break;
    }
    offset += length;
  }
  if (!document) throw new Error("GLB JSON is unavailable");
  return document;
}

async function validateSelfContainedGlb(
  bytes: Uint8Array,
  manifest: IfcDerivativeManifest,
) {
  const report = await gltfValidator.validateBytes(bytes, {
    format: "glb",
    maxIssues: 256,
    writeTimestamp: false,
  });
  if (!report?.issues || report.issues.truncated || report.issues.numErrors > 0)
    throw new Error("Khronos glTF validation failed");
  const document = readValidatedGlbDocument(bytes);
  const buffers = Array.isArray(document.buffers) ? document.buffers : [];
  for (const buffer of buffers) {
    const value = buffer as Record<string, unknown>;
    if ("uri" in value) throw new Error("GLB buffer must be embedded");
  }
  const images = Array.isArray(document.images) ? document.images : [];
  for (const image of images) {
    const uri = (image as Record<string, unknown>).uri;
    if (typeof uri === "string" && !uri.startsWith("data:"))
      throw new Error("GLB image URI must be embedded");
  }
  const nodes = Array.isArray(document.nodes) ? document.nodes : [];
  const meshes = Array.isArray(document.meshes) ? document.meshes : [];
  const nodesById = new Map<
    string,
    { node: Record<string, unknown>; ifcExpressId?: number }
  >();
  for (const value of nodes) {
    const node = value as Record<string, unknown>;
    if (!Number.isSafeInteger(node.mesh)) continue;
    const extras = node.extras;
    if (!extras || typeof extras !== "object" || Array.isArray(extras))
      throw new Error("GLB mesh node identity is unavailable");
    const values = extras as Record<string, unknown>;
    if (
      Object.keys(values).some(
        (key) => key !== "ifcNodeId" && key !== "ifcExpressId",
      ) ||
      typeof values.ifcNodeId !== "string" ||
      values.ifcNodeId.trim() !== values.ifcNodeId ||
      values.ifcNodeId.length < 1 ||
      values.ifcNodeId.length > 256 ||
      (values.ifcExpressId !== undefined &&
        (!Number.isSafeInteger(values.ifcExpressId) ||
          (values.ifcExpressId as number) < 1))
    )
      throw new Error("GLB mesh node extras are invalid");
    if (nodesById.has(values.ifcNodeId))
      throw new Error("GLB node identity is duplicated");
    nodesById.set(values.ifcNodeId, {
      node,
      ...(values.ifcExpressId === undefined
        ? {}
        : { ifcExpressId: values.ifcExpressId as number }),
    });
  }
  const claims = new Map<string, number>();
  for (const element of manifest.elements)
    for (const mapping of element.meshes) {
      const resolved = nodesById.get(mapping.nodeId);
      if (!resolved) throw new Error("GLB manifest node is unavailable");
      const mesh = meshes[resolved.node.mesh as number];
      if (!mesh || typeof mesh !== "object")
        throw new Error("GLB manifest mesh is unavailable");
      const primitives = (mesh as Record<string, unknown>).primitives;
      if (
        !Array.isArray(primitives) ||
        mapping.primitiveIndices.some((index) => index >= primitives.length)
      )
        throw new Error("GLB manifest primitive is unavailable");
      for (const primitiveIndex of mapping.primitiveIndices) {
        const tuple = `${mapping.nodeId}\0${primitiveIndex}`;
        if (claims.has(tuple))
          throw new Error("GLB primitive claim is duplicated");
        claims.set(tuple, element.expressId);
      }
    }
  for (const [nodeId, resolved] of nodesById) {
    const mesh = meshes[resolved.node.mesh as number];
    if (!mesh || typeof mesh !== "object")
      throw new Error("GLB manifest mesh is unavailable");
    const primitives = (mesh as Record<string, unknown>).primitives;
    if (!Array.isArray(primitives) || primitives.length < 1)
      throw new Error("GLB rendered primitive is unavailable");
    const owners = new Set<number>();
    for (
      let primitiveIndex = 0;
      primitiveIndex < primitives.length;
      primitiveIndex += 1
    ) {
      const expressId = claims.get(`${nodeId}\0${primitiveIndex}`);
      if (expressId === undefined)
        throw new Error("GLB rendered primitive is unclaimed");
      owners.add(expressId);
    }
    if (
      resolved.ifcExpressId !== undefined &&
      (owners.size !== 1 || !owners.has(resolved.ifcExpressId))
    )
      throw new Error(
        "GLB node ifcExpressId does not match primitive ownership",
      );
  }
}

type IfcSignedStorageReader = {
  createSignedUrl(
    path: string,
    expiresIn: number,
  ): Promise<{
    data: { signedUrl: string } | null;
    error: unknown;
  }>;
};

async function downloadIfcDerivativeBytes(
  storage: IfcSignedStorageReader,
  path: string,
  expectedSize: number,
  expectedSha256: string,
  fetchImpl: typeof fetch,
) {
  const signed = await storage.createSignedUrl(path, 30);
  if (signed.error || !signed.data?.signedUrl)
    throw new Response("IFC derivative 파일을 읽지 못했습니다.", {
      status: 500,
    });
  const controller = new AbortController();
  let response: Response;
  try {
    response = await fetchImpl(signed.data.signedUrl, {
      headers: { Range: `bytes=0-${expectedSize}` },
      signal: controller.signal,
    });
  } catch {
    throw new Response("IFC derivative 파일을 읽지 못했습니다.", {
      status: 500,
    });
  }
  if (!response.ok || !response.body) {
    controller.abort();
    throw new Response("IFC derivative 파일을 읽지 못했습니다.", {
      status: 500,
    });
  }
  const reader = response.body.getReader();
  const rejectSize = async () => {
    await reader.cancel().catch(() => undefined);
    controller.abort();
    throw new Response("IFC derivative 파일 크기가 일치하지 않습니다.", {
      status: 409,
    });
  };
  const contentLength = response.headers.get("content-length");
  if (
    contentLength !== null &&
    (!/^\d+$/.test(contentLength) || Number(contentLength) > expectedSize)
  )
    return rejectSize();
  const contentRange = response.headers.get("content-range");
  if (contentRange !== null) {
    const match = /^bytes 0-(\d+)\/(\d+)$/.exec(contentRange);
    if (
      !match ||
      Number(match[1]) + 1 !== expectedSize ||
      Number(match[2]) !== expectedSize
    )
      return rejectSize();
  }
  const bytes = new Uint8Array(expectedSize);
  let offset = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value || offset + value.byteLength > expectedSize) return rejectSize();
    bytes.set(value, offset);
    offset += value.byteLength;
  }
  if (offset !== expectedSize) return rejectSize();
  if (createHash("sha256").update(bytes).digest("hex") !== expectedSha256)
    throw new Response("IFC derivative 파일 해시가 일치하지 않습니다.", {
      status: 409,
    });
  return bytes;
}

export async function loadDrawingIfcDerivative(
  client: DrawingWorkspaceClient,
  file: DrawingWorkspaceFile,
  revision?: Pick<DrawingRevisionRow, "id" | "status" | "version">,
  runtime: { fetch?: typeof fetch } = {},
): Promise<DrawingIfcDerivativeDescriptor> {
  if (
    file.kind !== "ifc" ||
    !file.immutable ||
    !Uuid.safeParse(file.id).success ||
    !Uuid.safeParse(file.project_id).success ||
    !Sha256.safeParse(file.sha256).success
  )
    throw new Response("IFC derivative 원본 증거가 올바르지 않습니다.", {
      status: 409,
    });

  const protectedRevision = Boolean(
    revision &&
      ["review_requested", "reviewed", "approved", "superseded"].includes(
        revision.status,
      ),
  );
  let binding: DrawingRevisionIfcDerivativeRow | null = null;
  if (revision) {
    const bindingResult = await client
      .from("lukas_drawing_revision_ifc_derivatives")
      .select(
        "id,revision_id,revision_version,project_id,source_file_id,source_sha256,derivative_id,derivative_version,manifest_sha256,geometry_sha256",
      )
      .eq("project_id", file.project_id)
      .eq("revision_id", revision.id)
      .eq("revision_version", revision.version)
      .eq("source_file_id", file.id)
      .limit(2);
    if (bindingResult.error)
      throw new Response("IFC derivative 고정 증거를 확인하지 못했습니다.", {
        status: 500,
      });
    const bindings = Array.isArray(bindingResult.data)
      ? bindingResult.data
      : [];
    if (bindings.length > 1)
      throw new Response("IFC derivative 고정 증거가 중복되었습니다.", {
        status: 409,
      });
    binding = (bindings[0] as DrawingRevisionIfcDerivativeRow) ?? null;
  }
  if (protectedRevision && !binding)
    throw new Response("보호된 개정의 IFC derivative 고정 증거가 없습니다.", {
      status: 409,
    });

  let derivativeQuery = client
    .from("lukas_drawing_ifc_derivatives")
    .select(
      "id,project_id,source_file_id,source_sha256,version,schema_version,status,manifest_json,manifest_storage_path,manifest_byte_size,manifest_sha256,geometry_storage_path,geometry_byte_size,geometry_sha256",
    )
    .eq("project_id", file.project_id)
    .eq("source_file_id", file.id);
  if (binding)
    derivativeQuery = derivativeQuery
      .eq("id", binding.derivative_id)
      .eq("version", binding.derivative_version);
  else derivativeQuery = derivativeQuery.eq("status", "ready");
  const derivativeResult = await derivativeQuery
    .order("version", { ascending: false })
    .limit(2);
  if (derivativeResult.error)
    throw new Response("IFC derivative 증거를 확인하지 못했습니다.", {
      status: 500,
    });
  const candidates = Array.isArray(derivativeResult.data)
    ? derivativeResult.data
    : [];
  if (candidates.length > 1 && binding)
    throw new Response("고정된 IFC derivative 증거가 중복되었습니다.", {
      status: 409,
    });
  let candidate: DrawingIfcDerivativeRow | undefined = candidates[0];
  if (!candidate) {
    if (protectedRevision || binding)
      throw new Response("고정된 IFC derivative 증거를 찾을 수 없습니다.", {
        status: 409,
      });
    const latestResult = await client
      .from("lukas_drawing_ifc_derivatives")
      .select(
        "id,project_id,source_file_id,source_sha256,version,schema_version,status,manifest_json,manifest_storage_path,manifest_byte_size,manifest_sha256,geometry_storage_path,geometry_byte_size,geometry_sha256",
      )
      .eq("project_id", file.project_id)
      .eq("source_file_id", file.id)
      .order("version", { ascending: false })
      .limit(1);
    if (latestResult.error)
      throw new Response("IFC derivative 상태를 확인하지 못했습니다.", {
        status: 500,
      });
    candidate = Array.isArray(latestResult.data)
      ? latestResult.data[0]
      : undefined;
    if (!candidate) return noIfcDerivative(file.sha256);
  }
  const row = candidate as DrawingIfcDerivativeRow;
  if (
    row.project_id !== file.project_id ||
    row.source_file_id !== file.id ||
    row.source_sha256 !== file.sha256 ||
    row.schema_version !== 1 ||
    !Number.isSafeInteger(row.version) ||
    row.version < 1 ||
    !["pending", "ready", "failed"].includes(row.status)
  )
    throw new Response("IFC derivative 원본 계보가 일치하지 않습니다.", {
      status: 409,
    });
  if (row.status !== "ready")
    return noIfcDerivative(file.sha256, row.status, row.version);
  if (
    binding &&
    (binding.project_id !== file.project_id ||
      binding.revision_id !== revision?.id ||
      binding.revision_version !== revision.version ||
      binding.source_file_id !== file.id ||
      binding.source_sha256 !== file.sha256 ||
      binding.derivative_id !== row.id ||
      binding.derivative_version !== row.version ||
      binding.manifest_sha256 !== row.manifest_sha256 ||
      binding.geometry_sha256 !== row.geometry_sha256)
  )
    throw new Response("IFC derivative 고정 계보가 일치하지 않습니다.", {
      status: 409,
    });

  const manifest = IfcDerivativeManifestSchema.safeParse(row.manifest_json);
  if (
    !manifest.success ||
    row.schema_version !== manifest.data.schemaVersion ||
    manifest.data.source.fileId !== file.id ||
    manifest.data.source.sha256 !== file.sha256 ||
    manifest.data.geometry.sha256 !== row.geometry_sha256 ||
    !row.manifest_storage_path ||
    !row.geometry_storage_path ||
    !row.manifest_byte_size ||
    !row.geometry_byte_size ||
    !row.manifest_sha256 ||
    !Sha256.safeParse(row.manifest_sha256).success ||
    !row.geometry_sha256 ||
    !Sha256.safeParse(row.geometry_sha256).success ||
    createHash("sha256")
      .update(
        canonicalIfcDerivativeJson(manifest.success ? manifest.data : null),
      )
      .digest("hex") !== row.manifest_sha256
  )
    throw new Response("IFC derivative 해시 또는 버전이 일치하지 않습니다.", {
      status: 409,
    });

  const expectedPaths = contentAddressedIfcDerivativePaths(row);
  if (
    row.manifest_storage_path !== expectedPaths.manifest ||
    row.geometry_storage_path !== expectedPaths.geometry
  )
    throw new Response(
      "IFC derivative 저장 경로가 content-addressed 형식이 아닙니다.",
      {
        status: 409,
      },
    );
  if (
    !Number.isSafeInteger(row.manifest_byte_size) ||
    row.manifest_byte_size < 1 ||
    row.manifest_byte_size > ifcManifestMaxBytes ||
    !Number.isSafeInteger(row.geometry_byte_size) ||
    row.geometry_byte_size < 1 ||
    row.geometry_byte_size > ifcGeometryMaxBytes
  )
    throw new Response("IFC derivative 크기 증거가 올바르지 않습니다.", {
      status: 409,
    });
  const storage = client.storage.from("lukas-qto");
  const [manifestResult, geometryResult] = await Promise.all([
    storage.createSignedUrl(row.manifest_storage_path, 300),
    storage.createSignedUrl(row.geometry_storage_path, 300),
  ]);
  if (
    manifestResult.error ||
    geometryResult.error ||
    !manifestResult.data?.signedUrl ||
    !geometryResult.data?.signedUrl
  )
    throw new DrawingWorkspaceSourceUnavailableError(
      "IFC derivative 파일을 열지 못했습니다.",
    );
  return {
    status: "ready",
    version: row.version,
    sourceSha256: file.sha256,
    manifestByteSize: row.manifest_byte_size,
    geometryByteSize: row.geometry_byte_size,
    manifestSha256: row.manifest_sha256,
    geometrySha256: row.geometry_sha256,
    manifestSignedUrl: manifestResult.data.signedUrl,
    geometrySignedUrl: geometryResult.data.signedUrl,
  };
}

type ManagedIfcDerivativeStorage = {
  from(bucket: string): {
    upload(
      path: string,
      body: Uint8Array,
      options: { contentType: string; upsert: false },
    ): Promise<{ data: { path: string } | null; error: unknown }>;
    createSignedUrl(
      path: string,
      expiresIn: number,
    ): Promise<{
      data: { signedUrl: string } | null;
      error: unknown;
    }>;
  };
};

/**
 * Managed ingestion only. The caller must hold a server-side service-role
 * client; authenticated users are denied by Storage RLS. Content addressing
 * plus upsert=false makes every publication no-clobber.
 */
export async function publishManagedIfcDerivativeObject(
  storage: ManagedIfcDerivativeStorage,
  input: {
    projectId: string;
    sourceSha256: string;
    version: number;
    bytes: Uint8Array;
    extension: "json" | "glb";
    contentType: "application/json" | "model/gltf-binary";
  },
  runtime: { fetch?: typeof fetch } = {},
) {
  Uuid.parse(input.projectId);
  Sha256.parse(input.sourceSha256);
  if (!Number.isSafeInteger(input.version) || input.version < 1)
    throw new Error("IFC derivative version is invalid");
  if (input.bytes.byteLength < 1)
    throw new Error("IFC derivative bytes are empty");
  const maximumBytes =
    input.extension === "json" ? ifcManifestMaxBytes : ifcGeometryMaxBytes;
  if (input.bytes.byteLength > maximumBytes)
    throw new Error("IFC derivative bytes exceed the managed limit");
  const sha256 = createHash("sha256").update(input.bytes).digest("hex");
  const path = `projects/${input.projectId}/ifc-derivatives/${input.sourceSha256}/v${input.version}/${sha256}.${input.extension}`;
  const bucket = storage.from("lukas-qto");
  await bucket.upload(path, input.bytes, {
    contentType: input.contentType,
    upsert: false,
  });
  try {
    await downloadIfcDerivativeBytes(
      bucket,
      path,
      input.bytes.byteLength,
      sha256,
      runtime.fetch ?? fetch,
    );
  } catch {
    throw new Error("IFC derivative managed publication failed");
  }
  return { path, byteSize: input.bytes.byteLength, sha256 };
}

/**
 * Publishes and re-verifies both content-addressed artifacts. If the second
 * artifact cannot be reconciled, the first is intentionally retained: an
 * exact hash-keyed object is safe to reuse, while deleting it could remove an
 * immutable object shared by an idempotent retry.
 */
export async function publishManagedIfcDerivativePair(
  storage: ManagedIfcDerivativeStorage,
  input: {
    projectId: string;
    sourceFileId: string;
    sourceSha256: string;
    version: number;
    manifestBytes: Uint8Array;
    geometryBytes: Uint8Array;
  },
  runtime: { fetch?: typeof fetch } = {},
) {
  const verified = await validateManagedIfcDerivativePair({
    sourceFileId: input.sourceFileId,
    sourceSha256: input.sourceSha256,
    manifestBytes: input.manifestBytes,
    geometryBytes: input.geometryBytes,
  });
  const common = {
    projectId: input.projectId,
    sourceSha256: input.sourceSha256,
    version: input.version,
  };
  const manifest = await publishManagedIfcDerivativeObject(
    storage,
    {
      ...common,
      bytes: input.manifestBytes,
      extension: "json",
      contentType: "application/json",
    },
    runtime,
  );
  const geometry = await publishManagedIfcDerivativeObject(
    storage,
    {
      ...common,
      bytes: input.geometryBytes,
      extension: "glb",
      contentType: "model/gltf-binary",
    },
    runtime,
  );
  return { manifest, geometry, verified };
}

export type ManagedIfcDerivativeReadyWriter = {
  recordReady(input: {
    projectId: string;
    sourceFileId: string;
    sourceSha256: string;
    version: number;
    createdBy: string;
    manifestJson: IfcDerivativeManifest;
    manifestStoragePath: string;
    manifestByteSize: number;
    manifestSha256: string;
    geometryStoragePath: string;
    geometryByteSize: number;
    geometrySha256: string;
  }): Promise<{ id: string }>;
};

/**
 * Managed-worker writer for ready rows. It maps the orchestration result onto
 * the service-only RPC. The service role remains the worker trust boundary;
 * this is not a defense against a compromised service credential.
 */
export function createManagedIfcDerivativeReadyWriter(
  client: Pick<DrawingWorkspaceClient, "rpc">,
): ManagedIfcDerivativeReadyWriter {
  return {
    async recordReady(input) {
      const { data, error } = await client.rpc(
        "lukas_drawing_publish_ifc_derivative_ready",
        {
          p_project_id: input.projectId,
          p_source_file_id: input.sourceFileId,
          p_source_sha256: input.sourceSha256,
          p_version: input.version,
          p_manifest_json: input.manifestJson,
          p_manifest_storage_path: input.manifestStoragePath,
          p_manifest_byte_size: input.manifestByteSize,
          p_manifest_sha256: input.manifestSha256,
          p_geometry_storage_path: input.geometryStoragePath,
          p_geometry_byte_size: input.geometryByteSize,
          p_geometry_sha256: input.geometrySha256,
          p_created_by: input.createdBy,
        },
      );
      if (error || typeof data !== "string")
        throw new Error("IFC derivative ready publication failed");
      Uuid.parse(data);
      return { id: data };
    },
  };
}

/**
 * Managed-worker entry point. It validates before writes, reconciles both
 * content-addressed objects, and records the ready row from that same exact
 * verification result through the narrow database writer contract.
 */
export async function publishManagedIfcDerivativeReady(
  storage: ManagedIfcDerivativeStorage,
  writer: ManagedIfcDerivativeReadyWriter,
  input: {
    projectId: string;
    sourceFileId: string;
    sourceSha256: string;
    version: number;
    createdBy: string;
    manifestBytes: Uint8Array;
    geometryBytes: Uint8Array;
  },
  runtime: { fetch?: typeof fetch } = {},
) {
  Uuid.parse(input.createdBy);
  const { manifest, geometry, verified } =
    await publishManagedIfcDerivativePair(
      storage,
      {
        projectId: input.projectId,
        sourceFileId: input.sourceFileId,
        sourceSha256: input.sourceSha256,
        version: input.version,
        manifestBytes: input.manifestBytes,
        geometryBytes: input.geometryBytes,
      },
      runtime,
    );
  if (
    manifest.byteSize !== verified.manifestByteSize ||
    manifest.sha256 !== verified.manifestSha256 ||
    geometry.byteSize !== verified.geometryByteSize ||
    geometry.sha256 !== verified.geometrySha256
  )
    throw new Error("IFC derivative managed publication failed");
  const row = await writer.recordReady({
    projectId: input.projectId,
    sourceFileId: input.sourceFileId,
    sourceSha256: input.sourceSha256,
    version: input.version,
    createdBy: input.createdBy,
    manifestJson: verified.manifest,
    manifestStoragePath: manifest.path,
    manifestByteSize: verified.manifestByteSize,
    manifestSha256: verified.manifestSha256,
    geometryStoragePath: geometry.path,
    geometryByteSize: verified.geometryByteSize,
    geometrySha256: verified.geometrySha256,
  });
  Uuid.parse(row.id);
  return { id: row.id, manifest, geometry };
}

/**
 * Ready-transition authority. Pair publication has already reconciled both
 * immutable objects byte-for-byte; validate their canonical relationship once
 * here instead of downloading a full GLB for every viewer request.
 */
export async function validateManagedIfcDerivativePair(input: {
  sourceFileId: string;
  sourceSha256: string;
  manifestBytes: Uint8Array;
  geometryBytes: Uint8Array;
}) {
  Uuid.parse(input.sourceFileId);
  Sha256.parse(input.sourceSha256);
  let manifest: IfcDerivativeManifest;
  try {
    const serializedManifest = new TextDecoder("utf-8", { fatal: true }).decode(
      input.manifestBytes,
    );
    manifest = IfcDerivativeManifestSchema.parse(
      JSON.parse(serializedManifest),
    );
    if (serializedManifest !== canonicalIfcDerivativeJson(manifest))
      throw new Error("IFC derivative manifest is not canonical");
    if (
      manifest.source.fileId !== input.sourceFileId ||
      manifest.source.sha256 !== input.sourceSha256 ||
      manifest.geometry.sha256 !==
        createHash("sha256").update(input.geometryBytes).digest("hex")
    )
      throw new Error("IFC derivative manifest lineage differs");
    await validateSelfContainedGlb(input.geometryBytes, manifest);
    return {
      manifest,
      manifestByteSize: input.manifestBytes.byteLength,
      manifestSha256: createHash("sha256")
        .update(input.manifestBytes)
        .digest("hex"),
      geometryByteSize: input.geometryBytes.byteLength,
      geometrySha256: createHash("sha256")
        .update(input.geometryBytes)
        .digest("hex"),
    };
  } catch {
    throw new Error("IFC derivative managed publication failed");
  }
}

export async function loadDrawingWorkspaceSourceBundle(
  client: DrawingWorkspaceClient,
  workspace: DrawingWorkspace,
  selectedIfcFileId: string | null,
  loadSelectedIfc = true,
): Promise<DrawingWorkspaceSourceBundle> {
  if (!workspace.primarySource)
    return {
      primary: null,
      pdf: null,
      ifc: null,
      previousPdf: null,
      revisionEdge: null,
      catalog: [],
    };
  const rows = await loadAllDrawingRows<DrawingWorkspaceFile>(client, {
    table: "lukas_qto_files",
    projectId: workspace.primarySource.project_id,
    filters: [["immutable", true]],
    order: [{ column: "id", direction: "asc" }],
    select:
      "id,project_id,kind,original_filename,storage_path,content_type,byte_size,sha256,immutable,created_at",
  });
  const validFile = (file: DrawingWorkspaceFile) =>
    file.project_id === workspace.primarySource!.project_id &&
    file.immutable === true &&
    (file.kind === "pdf" || file.kind === "ifc") &&
    Uuid.safeParse(file.id).success &&
    Sha256.safeParse(file.sha256).success &&
    typeof file.original_filename === "string" &&
    typeof file.storage_path === "string" &&
    Number.isSafeInteger(file.byte_size) &&
    file.byte_size >= 0;
  const selectedId =
    selectedIfcFileId ??
    (workspace.primarySource.kind === "ifc"
      ? workspace.primarySource.id
      : null);
  const selectedCandidate = selectedId
    ? rows.find((file) => file.id === selectedId)
    : null;
  if (
    selectedId &&
    (!selectedCandidate ||
      !validFile(selectedCandidate) ||
      selectedCandidate.kind !== "ifc")
  )
    throw new Response("선택한 IFC 원본을 찾을 수 없습니다.", {
      status: 404,
    });
  if (!validFile(workspace.primarySource))
    throw new Response("도면 원본 증거가 올바르지 않습니다.", {
      status: 400,
    });
  const catalog = rows
    .filter(validFile)
    .map(drawingWorkspaceSourceCatalogItem)
    .sort((left, right) => left.id.localeCompare(right.id));
  if (!catalog.some((file) => file.id === workspace.primarySource!.id))
    catalog.push(drawingWorkspaceSourceCatalogItem(workspace.primarySource));
  const workspaceRevision = workspace.document.revision;

  const revisionEdges =
    workspace.primarySource.kind === "pdf"
      ? await loadAllDrawingRows<DrawingFileRevisionEdgeRow>(client, {
          table: "lukas_qto_file_revisions",
          projectId: workspace.primarySource!.project_id,
          filters: [
            ["current_file_id", workspace.primarySource!.id],
            ["relation_kind", "supersedes"],
          ],
          order: [{ column: "id", direction: "asc" }],
          select:
            "id,project_id,previous_file_id,previous_sha256,current_file_id,current_sha256,relation_kind",
        })
      : [];
  if (revisionEdges.length > 1)
    throw new Response("PDF 바로 이전 개정 관계가 하나가 아닙니다.", {
      status: 409,
    });
  const revisionEdge = revisionEdges[0] ?? null;
  const previousFile = revisionEdge
    ? rows.find((file) => file.id === revisionEdge.previous_file_id)
    : null;
  if (
    revisionEdge &&
    (revisionEdge.project_id !== workspace.primarySource.project_id ||
      revisionEdge.current_file_id !== workspace.primarySource.id ||
      revisionEdge.current_sha256 !== workspace.primarySource.sha256 ||
      revisionEdge.relation_kind !== "supersedes" ||
      !previousFile ||
      !validFile(previousFile) ||
      previousFile.kind !== "pdf" ||
      previousFile.sha256 !== revisionEdge.previous_sha256)
  )
    throw new Response("PDF 바로 이전 개정 원본 증거가 일치하지 않습니다.", {
      status: 409,
    });

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
  if (
    (backgroundPage &&
      (backgroundPage.background_source_file_id !==
        workspace.primarySource.id ||
        backgroundPage.background_source_sha256 !==
          workspace.primarySource.sha256)) ||
    (p2Background &&
      (p2Background.sourceFileId !== workspace.primarySource.id ||
        p2Background.sourceSha256 !== workspace.primarySource.sha256))
  )
    throw new Response("도면 배경 원본 증거가 일치하지 않습니다.", {
      status: 409,
    });

  const signed = new Map<string, DrawingWorkspaceSourceDescriptor>();
  const loadSource = async (file: DrawingWorkspaceFile) => {
    const existing = signed.get(file.id);
    if (existing) return existing;
    if (file.kind === "ifc") {
      const descriptor: DrawingWorkspaceIfcSourceDescriptor = {
        ...drawingWorkspaceSourceCatalogItem(file),
        kind: "ifc",
        derivative: await loadDrawingIfcDerivative(client, file, {
          id: workspaceRevision.id,
          status: workspaceRevision.status,
          version: workspaceRevision.version,
        }),
      };
      signed.set(file.id, descriptor);
      return descriptor;
    }
    const { data, error } = await client.storage
      .from("lukas-qto")
      .createSignedUrl(file.storage_path, 300);
    if (error || !data?.signedUrl)
      throw new DrawingWorkspaceSourceUnavailableError(
        "도면 원본을 열지 못했습니다.",
      );
    const descriptor: DrawingWorkspacePdfSourceDescriptor = {
      ...drawingWorkspaceSourceCatalogItem(file),
      kind: "pdf",
      signedUrl: data.signedUrl,
      derivative: notApplicableDerivative,
    };
    signed.set(file.id, descriptor);
    return descriptor;
  };
  const primaryLoaded =
    workspace.primarySource.kind === "ifc"
      ? loadSelectedIfc
      : Boolean(backgroundPage || p2Background);
  const primary = primaryLoaded
    ? await loadSource(workspace.primarySource)
    : drawingWorkspaceSourceCatalogItem(workspace.primarySource);
  const pdf =
    workspace.primarySource.kind === "pdf" && primaryLoaded
      ? (primary as DrawingWorkspacePdfSourceDescriptor)
      : null;
  const ifc =
    selectedCandidate && loadSelectedIfc
      ? ((await loadSource(
          selectedCandidate,
        )) as DrawingWorkspaceIfcSourceDescriptor)
      : null;
  const previousPdf = previousFile
    ? drawingWorkspaceSourceCatalogItem(previousFile)
    : null;
  return {
    primary,
    pdf,
    ifc,
    previousPdf,
    revisionEdge: revisionEdge
      ? {
          id: revisionEdge.id,
          previousFileId: revisionEdge.previous_file_id,
          previousSha256: revisionEdge.previous_sha256,
          currentFileId: revisionEdge.current_file_id,
          currentSha256: revisionEdge.current_sha256,
        }
      : null,
    catalog,
  };
}

export async function loadDrawingWorkspacePreviousPdf(
  client: DrawingWorkspaceClient,
  workspace: DrawingWorkspace,
  request: DrawingWorkspacePreviousPdfRequest,
): Promise<DrawingWorkspacePdfSourceDescriptor> {
  const input = DrawingWorkspacePreviousPdfRequestSchema.parse(request);
  if (!workspace.primarySource || workspace.primarySource.kind !== "pdf")
    throw new Response("PDF 개정 비교를 사용할 수 없습니다.", {
      status: 409,
    });
  const activePageNumbers = [
    ...workspace.document.revision.pages
      .filter(
        (page): page is DrawingPageRow =>
          "background_pdf_page" in page &&
          page.background_source_file_id === workspace.primarySource!.id &&
          page.background_source_sha256 === workspace.primarySource!.sha256,
      )
      .map((page) => page.background_pdf_page),
    ...workspace.document.revision.pages
      .filter((page): page is DrawingWorkspaceP2Page => "canvases" in page)
      .flatMap((page) => page.canvases)
      .map((canvas) => canvas.background)
      .filter(
        (background) =>
          background?.sourceFileId === workspace.primarySource!.id &&
          background.sourceSha256 === workspace.primarySource!.sha256,
      )
      .map((background) => background!.pdfPageNumber),
  ];
  if (!activePageNumbers.includes(input.pageNumber))
    throw new Response("현재 PDF 페이지만 비교할 수 있습니다.", {
      status: 409,
    });

  const [files, edges] = await Promise.all([
    loadAllDrawingRows<DrawingWorkspaceFile>(client, {
      table: "lukas_qto_files",
      projectId: workspace.primarySource.project_id,
      filters: [["immutable", true]],
      order: [{ column: "id", direction: "asc" }],
      select:
        "id,project_id,kind,original_filename,storage_path,content_type,byte_size,sha256,immutable,created_at",
    }),
    loadAllDrawingRows<DrawingFileRevisionEdgeRow>(client, {
      table: "lukas_qto_file_revisions",
      projectId: workspace.primarySource.project_id,
      filters: [
        ["current_file_id", workspace.primarySource.id],
        ["relation_kind", "supersedes"],
      ],
      order: [{ column: "id", direction: "asc" }],
      select:
        "id,project_id,previous_file_id,previous_sha256,current_file_id,current_sha256,relation_kind",
    }),
  ]);
  const edge = edges.length === 1 ? edges[0] : null;
  const previous = edge
    ? files.find((file) => file.id === edge.previous_file_id)
    : null;
  if (
    !edge ||
    edge.id !== input.revisionEdgeId ||
    edge.project_id !== workspace.primarySource.project_id ||
    edge.current_file_id !== workspace.primarySource.id ||
    edge.current_file_id !== input.currentFileId ||
    edge.current_sha256 !== workspace.primarySource.sha256 ||
    edge.current_sha256 !== input.currentSha256 ||
    edge.previous_file_id !== input.previousFileId ||
    edge.previous_sha256 !== input.previousSha256 ||
    edge.relation_kind !== "supersedes" ||
    !previous ||
    previous.project_id !== workspace.primarySource.project_id ||
    previous.kind !== "pdf" ||
    previous.immutable !== true ||
    previous.sha256 !== edge.previous_sha256 ||
    !Uuid.safeParse(previous.id).success ||
    !Sha256.safeParse(previous.sha256).success ||
    typeof previous.storage_path !== "string" ||
    !Number.isSafeInteger(previous.byte_size) ||
    previous.byte_size < 0
  )
    throw new Response("PDF 바로 이전 개정 원본 증거가 일치하지 않습니다.", {
      status: 409,
    });
  const { data, error } = await client.storage
    .from("lukas-qto")
    .createSignedUrl(previous.storage_path, 300);
  if (error || !data?.signedUrl)
    throw new Response("이전 PDF 원본을 열지 못했습니다.", { status: 500 });
  return {
    ...drawingWorkspaceSourceCatalogItem(previous),
    kind: "pdf",
    signedUrl: data.signedUrl,
    derivative: notApplicableDerivative,
  };
}

const capabilityByRole: Record<string, DrawingWorkspaceCapability> = {
  owner: "admin",
  staff: "admin",
  estimator: "editor",
  reviewer: "reviewer",
  approver: "approver",
  site: "commenter",
  procurement: "commenter",
  viewer: "viewer",
};

export function drawingWorkspaceCapabilityForRole(
  role: string | null | undefined,
): DrawingWorkspaceCapability | null {
  return role ? (capabilityByRole[role] ?? null) : null;
}

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
  return drawingWorkspaceCapabilityForRole(membership?.role);
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

export class DrawingWorkspaceSourceUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DrawingWorkspaceSourceUnavailableError";
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

const CreateDocumentIdempotentInputSchema = z
  .object({
    title: Title,
    mode: z.enum(["blank", "pdf_background"]),
    sourceFile: z
      .object({ id: Uuid, kind: z.enum(["pdf", "ifc"]) })
      .strict()
      .nullable(),
    clientRequestId: Uuid,
    libraryVersionId: Uuid.optional(),
  })
  .strict();

export async function createDrawingDocumentIdempotent(
  client: DrawingWorkspaceClient,
  projectId: string,
  input: {
    title: string;
    mode: "blank" | "pdf_background";
    sourceFile: Pick<DrawingWorkspaceFile, "id" | "kind"> | null;
    clientRequestId: string;
    libraryVersionId?: string;
  },
) {
  const parsed = CreateDocumentIdempotentInputSchema.parse(input);
  const { data, error } = await client.rpc(
    "lukas_drawing_create_document_idempotent",
    {
      p_project_id: Uuid.parse(projectId),
      p_source_file_id: parsed.sourceFile?.id ?? null,
      p_title: parsed.title,
      p_blank: parsed.sourceFile?.kind !== "pdf" || parsed.mode === "blank",
      p_client_request_id: parsed.clientRequestId,
      p_library_version_id: parsed.libraryVersionId ?? null,
    },
  );
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
  Uuid.parse(fileId);
  return `/projects/${Uuid.parse(projectId)}/workspaces/${Uuid.parse(documentId)}`;
}

export async function resolveDrawingDocumentEntry(
  client: DrawingWorkspaceClient,
  projectId: string,
  documentId: string,
  objectId: string,
) {
  const parsedProjectId = Uuid.parse(projectId);
  const parsedDocumentId = Uuid.parse(documentId);
  const parsedObjectId = Uuid.parse(objectId);
  const { data: document, error: documentError } = await client
    .from("lukas_drawing_documents")
    .select("id,project_id,source_file_id")
    .eq("id", parsedDocumentId)
    .eq("project_id", parsedProjectId)
    .single();
  if (documentError || !document)
    throw new Error("연결된 도면 근거를 열 수 없습니다.");

  let fileId = document.source_file_id;
  if (!fileId) {
    const { data: sources, error: sourceError } = await client
      .from("lukas_drawing_object_sources")
      .select("source_file_id")
      .eq("project_id", parsedProjectId)
      .eq("object_id", parsedObjectId)
      .eq("status", "active")
      .order("source_file_id", { ascending: true })
      .limit(2);
    const identities = [
      ...new Set((sources ?? []).map((source) => source.source_file_id)),
    ];
    if (sourceError || identities.length !== 1)
      throw new Error("연결된 도면 근거를 열 수 없습니다.");
    fileId = identities[0];
  }

  const { data: file, error: fileError } = await client
    .from("lukas_qto_files")
    .select("id,project_id,kind,immutable")
    .eq("id", fileId)
    .eq("project_id", parsedProjectId)
    .in("kind", ["pdf", "ifc"])
    .eq("immutable", true)
    .single();
  if (fileError || !file) throw new Error("연결된 도면 근거를 열 수 없습니다.");
  return { documentId: parsedDocumentId, fileId: Uuid.parse(file.id) };
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

function canRecordRevisionDecision(
  capability: DrawingWorkspaceCapability,
  decision: "reviewed" | "approved" | "rejected",
) {
  if (decision === "reviewed") return capability === "reviewer";
  if (decision === "approved") return capability === "approver";
  return capability === "reviewer" || capability === "approver";
}

function canRestoreApprovedWorkspace(capability: DrawingWorkspaceCapability) {
  return (
    capability === "admin" ||
    capability === "editor" ||
    capability === "reviewer" ||
    capability === "approver"
  );
}

function currentWorkspaceRevisionId(workspace: DrawingWorkspace) {
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
  const revision = workspace.document.revision;
  if (revision.status === "approved" || revision.status === "superseded")
    throw new DrawingWorkspaceRejectedError(
      "승인된 개정은 변경할 수 없습니다.",
    );
  if (revision.status !== undefined && revision.status !== "draft")
    throw new DrawingWorkspaceConflictError(
      "초안 리비전에서만 도면을 변경할 수 있습니다.",
    );
  return revision;
}

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
      if (!canRecordRevisionDecision(capability, mutation.decision))
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

      if (mutation.intent === "create_from_template") {
        assertDraftWorkspace(workspace);
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
          mutation.sourceFileId !== (workspace.primarySource?.id ?? null)
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
        const revision = workspace.document.revision;
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
    if (error instanceof z.ZodError) throw error;
    if (
      !(error instanceof DrawingWorkspaceConflictError) &&
      !(error instanceof DrawingWorkspaceRejectedError) &&
      !(error instanceof DrawingWorkspaceRetryableError) &&
      !(error instanceof DrawingWorkspaceRpcError)
    )
      throw error;
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
          error instanceof Error
            ? error.message
            : "도면 작업을 저장하지 못했습니다.",
      },
    };
  }
}
