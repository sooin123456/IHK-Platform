import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "database.types";
import { z } from "zod";

import {
  DrawingGeometrySchema,
  DrawingLayerInputSchema,
  DrawingLayerSchema,
  DrawingObjectNameSchema,
  DrawingObjectSchema,
  DrawingOperationInputSchema,
  DrawingStructureActionSchema,
  DrawingStyleOverrideSchema,
} from "./drawing-workspace.types.ts";
import type { DrawingOperationInput } from "./drawing-workspace.types.ts";

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
    | "dimension";
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
      }>;
      lukas_drawing_request_review: DrawingRpc<{ p_revision_id: string }>;
      lukas_drawing_record_revision_decision: DrawingRpc<{
        p_revision_id: string;
        p_subject_version: number;
        p_snapshot_sha256: string;
        p_decision: "approved" | "rejected";
        p_note: string;
      }>;
      lukas_drawing_link_object_issue: DrawingRpc<{
        p_object_id: string;
        p_issue_id: string;
      }>;
    };
  };
};

export type DrawingWorkspaceClient = SupabaseClient<DrawingWorkspaceDatabase>;

const drawingObjectPageSize = 1_000;

export async function loadAllDrawingObjects(
  client: DrawingWorkspaceClient,
  projectId: string,
  revisionId: string,
  pageSize = drawingObjectPageSize,
) {
  if (!Number.isInteger(pageSize) || pageSize <= 0)
    throw new Error("Drawing object page size must be a positive integer.");
  const objects: DrawingObjectRow[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await client
      .from("lukas_drawing_objects")
      .select("*")
      .eq("project_id", projectId)
      .eq("revision_id", revisionId)
      .eq("status", "active")
      .order("created_at")
      .order("id")
      .range(from, from + pageSize - 1);
    if (error)
      throw new Error(`도면 객체를 불러오지 못했습니다: ${error.message}`);
    const page = data ?? [];
    objects.push(...page);
    if (page.length < pageSize) return objects;
  }
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

const OperationPayloadSchemas = {
  add_objects: AddObjectsPayloadSchema,
  update_objects: UpdateObjectsPayloadSchema,
  delete_objects: DeleteObjectsPayloadSchema,
  add_layer: AddLayerPayloadSchema,
  update_layer: UpdateLayerPayloadSchema,
  mutate_structure: MutateStructurePayloadSchema,
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
  if (
    keys.length !== exactOperationKeys.length ||
    keys.some((key, index) => key !== exactOperationKeys[index])
  )
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
            : OperationPayloadSchemas[operation.type];
  parseExactPayload(expectedInverse, operation.inverse);
  return operation;
}

const CreateDocumentMutationSchema = z.object({
  intent: z.literal("create_document"),
  title: Title,
});
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
});
const RecordRevisionDecisionMutationSchema = z.object({
  intent: z.literal("record_revision_decision"),
  revisionId: Uuid,
  subjectVersion: z.number().int().positive(),
  snapshotSha256: Sha256,
  decision: z.enum(["approved", "rejected"]),
  note: DecisionNote,
});

export type WorkspaceMutation =
  | z.infer<typeof CreateDocumentMutationSchema>
  | { intent: "apply_operation"; operation: DrawingOperationInput }
  | z.infer<typeof CreateLayerMutationSchema>
  | z.infer<typeof LinkIssueMutationSchema>
  | z.infer<typeof RequestReviewMutationSchema>
  | z.infer<typeof RecordRevisionDecisionMutationSchema>;

const allowedFormFields = {
  create_document: new Set(["intent", "title", "document_mode"]),
  apply_operation: new Set(["intent", "operation_json"]),
  create_layer: new Set(["intent", "name"]),
  link_issue: new Set(["intent", "object_id", "issue_id"]),
  request_review: new Set(["intent", "revision_id"]),
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
  document:
    | (DrawingDocumentRow & {
        revision: DrawingRevisionRow & {
          pages: DrawingPageRow[];
          layers: DrawingLayerRow[];
          objects: DrawingObjectRow[];
          issues: DrawingWorkspaceIssue[];
          issueLinks: DrawingObjectIssueLink[];
          reviewEvidence: {
            subjectVersion: number;
            snapshotSha256: string;
          } | null;
        };
      })
    | null;
};

export async function loadDrawingWorkspace(
  client: DrawingWorkspaceClient,
  projectId: string,
  fileId: string,
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

  const { data: document, error: documentError } = await client
    .from("lukas_drawing_documents")
    .select("*")
    .eq("project_id", projectId)
    .eq("source_file_id", fileId)
    .eq("source_sha256", file.sha256)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (documentError)
    throw new Error(
      `도면 문서를 불러오지 못했습니다: ${documentError.message}`,
    );
  if (!document) return { file: file as DrawingWorkspaceFile, document: null };

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
  if (!revision) return { file: file as DrawingWorkspaceFile, document: null };

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
      client
        .from("lukas_drawing_issues")
        .select("id,project_id,title,priority,status,updated_at")
        .eq("project_id", projectId)
        .order("updated_at", { ascending: false }),
      client
        .from("lukas_drawing_object_issue_links")
        .select(
          "id,object_id,revision_id,issue_id,project_id,created_by,created_at",
        )
        .eq("project_id", projectId)
        .eq("revision_id", revision.id)
        .order("created_at"),
    ]);
  const childError =
    pagesResult.error ??
    layersResult.error ??
    issuesResult.error ??
    linksResult.error;
  if (childError)
    throw new Error(`도면 내용을 불러오지 못했습니다: ${childError.message}`);
  const layers = layersResult.data ?? [];
  const pages = pagesResult.data ?? [];
  const issues = issuesResult.data ?? [];
  const activeObjectIds = new Set(objects.map((object) => object.id));
  const issueIds = new Set(issues.map((issue) => issue.id));
  const issueLinks = (linksResult.data ?? []).filter(
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
  return {
    file: file as DrawingWorkspaceFile,
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
    (page) => page.background_pdf_page !== null,
  );
  if (workspace.file.kind === "pdf" && !backgroundPage) return null;
  if (
    backgroundPage &&
    (backgroundPage.background_source_file_id !== workspace.file.id ||
      backgroundPage.background_source_sha256 !== workspace.file.sha256)
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

const drawingConflictCodes = new Set(["23505", "23P01", "P1C01"]);
const drawingRejectedCodes = new Set(["P1R01"]);

function rpcResult<T>(
  data: T | null,
  error: { code?: string; message: string } | null,
): T {
  if (error) {
    if (error.code && drawingConflictCodes.has(error.code))
      throw new DrawingWorkspaceConflictError(error.message);
    if (error.code && drawingRejectedCodes.has(error.code))
      throw new DrawingWorkspaceRejectedError(error.message);
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
  });
  return rpcResult(data, error);
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
      kind: "validation" | "rpc" | "conflict" | "rejected";
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

const WorkspaceDocumentModeSchema = z.enum(["blank", "pdf_background"]);

export async function handleWorkspaceMutation({
  client,
  projectId,
  capability,
  workspace,
  form,
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
  environment?: WorkspaceMutationEnvironment;
}): Promise<{ status: number; body: DrawingWorkspaceActionBody }> {
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
    } else {
      if (!canEditWorkspace(capability))
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
      } else if (mutation.intent === "apply_operation") {
        assertCurrentWorkspaceRevision(
          workspace,
          mutation.operation.revisionId,
        );
        result = await applyDrawingOperation(client, mutation.operation);
        clientOperationId = mutation.operation.clientOperationId;
      } else if (mutation.intent === "create_layer") {
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
        result = await requestDrawingReview(client, mutation.revisionId);
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
          : error instanceof DrawingWorkspaceRpcError
            ? "rpc"
            : "validation";
    return {
      status: kind === "conflict" || kind === "rejected" ? 409 : 400,
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
