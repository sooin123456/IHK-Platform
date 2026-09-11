import { createHash } from "node:crypto";

import type { Json } from "database.types";
import { z } from "zod";

import {
  contentTypeMatchesProjectKind,
  fileMatchesProjectKind,
} from "./drawing-entry.ts";
import {
  DRAWING_DXF_IMPORT_LIMITS,
  type DrawingDxfUnitSelection,
} from "./drawing-dxf-import.server.ts";
import {
  DRAWING_DXF_IMPORT_PLAN_LIMITS,
  buildDrawingDxfImportPlan,
  type DrawingDxfImportPlan,
} from "./drawing-dxf-import-plan.server.ts";
import {
  loadDrawingCadImportCanonicalReceipts,
  type DrawingCadImportCanonicalReceipt,
} from "./drawing-cad-import-receipts.server.ts";
import { DrawingOperationInputSchema } from "./drawing-workspace.types.ts";
import type {
  DrawingWorkspace,
  DrawingWorkspaceCapability,
  DrawingWorkspaceClient,
} from "./drawing-workspace.server.ts";

const Uuid = z.string().uuid();
const Sha256 = z.string().regex(/^[0-9a-f]{64}$/);
const DrawingDxfUnitSelectionSchema = z.union([
  z.object({ code: z.literal(1), label: z.literal("in") }).strict(),
  z.object({ code: z.literal(2), label: z.literal("ft") }).strict(),
  z.object({ code: z.literal(4), label: z.literal("mm") }).strict(),
  z.object({ code: z.literal(5), label: z.literal("cm") }).strict(),
  z.object({ code: z.literal(6), label: z.literal("m") }).strict(),
]);

const DrawingDxfImportTargetSchema = z
  .object({
    revisionId: Uuid,
    canvasId: Uuid,
    sourceFileId: Uuid,
    createdAt: z.string().datetime({ offset: true }),
    unitOverride: DrawingDxfUnitSelectionSchema.optional(),
  })
  .strict();

const DrawingDxfProjectImportInputSchema = DrawingDxfImportTargetSchema.extend({
  projectId: Uuid,
  actorId: Uuid,
}).strict();

const DrawingDxfPlanAttestationInputSchema = z
  .object({
    actorId: Uuid,
    projectId: Uuid,
    revisionId: Uuid,
    canvasId: Uuid,
    sourceFileId: Uuid,
    sourceSha256: Sha256,
    requestId: Uuid,
    operations: z
      .array(DrawingOperationInputSchema)
      .min(1)
      .max(DRAWING_DXF_IMPORT_PLAN_LIMITS.maxOperations),
  })
  .strict();

const DrawingDxfPlanAttestationReceiptSchema = z
  .object({
    planId: Uuid,
    planCount: z
      .number()
      .int()
      .min(1)
      .max(DRAWING_DXF_IMPORT_PLAN_LIMITS.maxOperations),
    alreadyAppliedCount: z.number().int().min(0),
  })
  .strict();

const DrawingDxfSourceFileSchema = z.object({
  id: Uuid,
  project_id: Uuid,
  kind: z.literal("dxf"),
  original_filename: z.string().trim().min(1).max(1_024),
  storage_path: z.string().trim().min(1).max(2_048),
  content_type: z.string().trim().min(1).max(255),
  byte_size: z
    .number()
    .int()
    .safe()
    .positive()
    .max(DRAWING_DXF_IMPORT_LIMITS.maxBytes),
  sha256: Sha256,
  immutable: z.literal(true),
  created_at: z.string().datetime({ offset: true }),
});

type DrawingDxfSourceClient = Pick<DrawingWorkspaceClient, "from" | "storage">;
type DrawingDxfPlanAttestationClient = Pick<DrawingWorkspaceClient, "rpc">;

export type DrawingDxfCanonicalReceipt = DrawingCadImportCanonicalReceipt;

export type PreparedDrawingDxfProjectImport = DrawingDxfImportPlan & {
  canonicalReceipts: DrawingDxfCanonicalReceipt[];
};

export class DrawingDxfSourceError extends Error {
  readonly status: 400 | 503;

  constructor(message: string, status: 400 | 503 = 400) {
    super(message);
    this.name = "DrawingDxfSourceError";
    this.status = status;
  }
}

function sourceError(message: string, status: 400 | 503 = 400) {
  return new DrawingDxfSourceError(message, status);
}

export async function attestDrawingDxfImportPlan(
  client: DrawingDxfPlanAttestationClient,
  rawInput: {
    actorId: string;
    projectId: string;
    revisionId: string;
    canvasId: string;
    sourceFileId: string;
    sourceSha256: string;
    requestId: string;
    operations: DrawingDxfImportPlan["operations"];
  },
) {
  const input = DrawingDxfPlanAttestationInputSchema.parse(rawInput);
  let response: Awaited<ReturnType<DrawingDxfPlanAttestationClient["rpc"]>>;
  try {
    response = await client.rpc("lukas_drawing_attest_dxf_import_plan", {
      p_actor_id: input.actorId,
      p_project_id: input.projectId,
      p_revision_id: input.revisionId,
      p_canvas_id: input.canvasId,
      p_source_file_id: input.sourceFileId,
      p_source_sha256: input.sourceSha256,
      p_operations: input.operations as unknown as Json,
    });
  } catch {
    throw sourceError("DXF import plan attestation is unavailable.", 503);
  }
  const { data, error } = response;
  if (error)
    throw sourceError("DXF import plan attestation is unavailable.", 503);
  const receipt = DrawingDxfPlanAttestationReceiptSchema.safeParse(data);
  if (
    !receipt.success ||
    receipt.data.planId !== input.requestId ||
    receipt.data.planCount !== input.operations.length ||
    receipt.data.alreadyAppliedCount > receipt.data.planCount
  )
    throw sourceError("DXF import plan attestation is invalid.", 503);
}

async function loadDrawingDxfAttestationAdminClient(): Promise<{
  default: DrawingDxfPlanAttestationClient;
}> {
  const { default: adminClient } = await import(
    "~/core/lib/supa-admin-client.server"
  );
  return { default: adminClient as DrawingDxfPlanAttestationClient };
}

export async function attestPreparedDrawingDxfImport(
  result: PreparedDrawingDxfProjectImport,
  input: {
    actorId: string;
    projectId: string;
    revisionId: string;
    canvasId: string;
    sourceFileId: string;
  },
  loadAdminClient: () => Promise<{
    default: DrawingDxfPlanAttestationClient;
  }> = loadDrawingDxfAttestationAdminClient,
) {
  if (result.report.blocking.length > 0 || result.operations.length === 0)
    return result;
  if (!result.requestId || !result.sourceSha256)
    throw sourceError("DXF import plan attestation is invalid.", 503);
  let adminClient: DrawingDxfPlanAttestationClient;
  try {
    adminClient = (await loadAdminClient()).default;
  } catch {
    throw sourceError("DXF import plan attestation is unavailable.", 503);
  }
  await attestDrawingDxfImportPlan(adminClient, {
    ...input,
    sourceSha256: result.sourceSha256,
    requestId: result.requestId,
    operations: result.operations,
  });
  return result;
}

const dxfImportFormFields = new Set([
  "intent",
  "revision_id",
  "canvas_id",
  "source_file_id",
  "created_at",
  "unit_code",
]);

const unitSelections = {
  "1": { code: 1, label: "in" },
  "2": { code: 2, label: "ft" },
  "4": { code: 4, label: "mm" },
  "5": { code: 5, label: "cm" },
  "6": { code: 6, label: "m" },
} as const;

export function parseDrawingDxfImportForm(form: FormData) {
  for (const key of form.keys())
    if (!dxfImportFormFields.has(key))
      throw new z.ZodError([
        { code: "custom", path: [key], message: "Unexpected field" },
      ]);
  for (const name of [
    "intent",
    "revision_id",
    "canvas_id",
    "source_file_id",
    "created_at",
    "unit_code",
  ])
    if (form.getAll(name).length !== 1)
      throw new z.ZodError([
        { code: "custom", path: [name], message: "Expected one value" },
      ]);
  const unitCode = z
    .enum(["", "1", "2", "4", "5", "6"])
    .parse(form.get("unit_code"));
  const parsed = DrawingDxfImportTargetSchema.parse({
    revisionId: form.get("revision_id"),
    canvasId: form.get("canvas_id"),
    sourceFileId: form.get("source_file_id"),
    createdAt: form.get("created_at"),
    ...(unitCode ? { unitOverride: unitSelections[unitCode] } : {}),
  });
  if (form.get("intent") !== "prepare_dxf_import")
    throw new z.ZodError([
      { code: "custom", path: ["intent"], message: "Invalid intent" },
    ]);
  return {
    revisionId: parsed.revisionId,
    canvasId: parsed.canvasId,
    sourceFileId: parsed.sourceFileId,
    createdAt: parsed.createdAt,
    unitOverride: parsed.unitOverride,
  };
}

export function assertDrawingDxfImportScope({
  capability,
  mutation,
  workspace,
}: {
  capability: DrawingWorkspaceCapability;
  mutation: ReturnType<typeof parseDrawingDxfImportForm>;
  workspace: DrawingWorkspace;
}) {
  if (capability !== "admin" && capability !== "editor")
    throw new Response("DXF 도면을 가져올 권한이 없습니다.", { status: 403 });
  const revision = workspace.document.revision;
  if (revision.status !== "draft" || revision.id !== mutation.revisionId)
    throw new Response("현재 초안 개정에만 DXF를 가져올 수 있습니다.", {
      status: 409,
    });
  if (!revision.canvases?.some((canvas) => canvas.id === mutation.canvasId))
    throw new Response("현재 개정의 캔버스를 찾을 수 없습니다.", {
      status: 409,
    });
  return mutation;
}

export async function prepareDrawingDxfProjectImport(
  client: DrawingDxfSourceClient,
  rawInput: {
    projectId: string;
    revisionId: string;
    canvasId: string;
    sourceFileId: string;
    createdAt: string;
    actorId: string;
    unitOverride?: DrawingDxfUnitSelection;
  },
): Promise<PreparedDrawingDxfProjectImport> {
  const input = DrawingDxfProjectImportInputSchema.parse(rawInput);
  const { data, error } = await client
    .from("lukas_qto_files")
    .select(
      "id,project_id,kind,original_filename,storage_path,content_type,byte_size,sha256,immutable,created_at",
    )
    .eq("project_id", input.projectId)
    .eq("id", input.sourceFileId)
    .eq("kind", "dxf")
    .eq("immutable", true)
    .limit(2);

  if (error) throw sourceError("DXF 원본 파일 조회에 실패했습니다.", 503);
  if (!Array.isArray(data) || data.length !== 1)
    throw sourceError("프로젝트의 변경 불가 DXF 원본 파일을 찾을 수 없습니다.");

  const parsed = DrawingDxfSourceFileSchema.safeParse(data[0]);
  if (!parsed.success)
    throw sourceError("DXF 원본 파일 메타데이터가 유효하지 않습니다.");
  const file = parsed.data;
  if (
    file.project_id !== input.projectId ||
    file.id !== input.sourceFileId ||
    !fileMatchesProjectKind("dxf", file.original_filename) ||
    !contentTypeMatchesProjectKind("dxf", file.content_type)
  )
    throw sourceError("선택한 파일은 가져올 수 있는 DXF 원본이 아닙니다.");

  const { data: blob, error: storageError } = await client.storage
    .from("lukas-qto")
    .download(file.storage_path);
  if (storageError || !blob)
    throw sourceError("DXF 원본 저장 파일을 읽을 수 없습니다.", 503);
  if (
    blob.size !== file.byte_size ||
    blob.size <= 0 ||
    blob.size > DRAWING_DXF_IMPORT_LIMITS.maxBytes
  )
    throw sourceError("DXF 원본 저장 파일의 크기가 등록 정보와 다릅니다.");

  const bytes = new Uint8Array(await blob.arrayBuffer());
  const storedSha256 = createHash("sha256").update(bytes).digest("hex");
  if (storedSha256 !== file.sha256)
    throw sourceError("DXF 원본 저장 파일의 해시가 등록 정보와 다릅니다.");

  const plan = await buildDrawingDxfImportPlan({
    bytes,
    revisionId: input.revisionId,
    canvasId: input.canvasId,
    sourceFileId: file.id,
    createdAt: input.createdAt,
    unitOverride: input.unitOverride,
  });
  const prepared = {
    ...plan,
    canonicalReceipts: await loadDrawingCadImportCanonicalReceipts(
      client,
      {
        projectId: input.projectId,
        revisionId: input.revisionId,
        actorId: input.actorId,
        operations: plan.operations,
        maxOperations: DRAWING_DXF_IMPORT_PLAN_LIMITS.maxOperations,
      },
      (message, status) => sourceError(`DXF ${message}.`, status),
    ),
  };
  if (
    new TextEncoder().encode(JSON.stringify(prepared)).byteLength >
    DRAWING_DXF_IMPORT_PLAN_LIMITS.maxSerializedBytes
  )
    throw sourceError("DXF canonical receipt response exceeds its size limit.");
  return prepared;
}
