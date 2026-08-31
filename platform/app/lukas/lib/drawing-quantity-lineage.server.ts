import type { SupabaseClient } from "@supabase/supabase-js";
import { createHash, randomUUID } from "node:crypto";
import postgres from "postgres";
import { z } from "zod";

import {
  convertDrawingMeasurement,
  deriveP6MaterialPlans,
  drawingObjectFingerprintSha256,
  P6_MEASUREMENT_RULE_VERSION,
  type DrawingQuantityMeasurementKind,
  type DrawingQuantityUnit,
  type P6MaterialComponentInput,
} from "./drawing-quantity-lineage.ts";
import { boqManifestStorageObjectPath } from "./storage-object-key.server.ts";
import {
  deriveAuthorizedDrawingMeasurementEvidence,
  parseDrawingWorkspaceCollaborationBootstrap,
} from "./drawing-workspace.server.ts";
import {
  DrawingObjectSchema,
  DrawingObjectSourceSchema,
} from "./drawing-workspace.types.ts";
import { compareExact, parseExactDecimal } from "./exact-decimal.server.ts";
import { collectBoundedRows } from "./material-control.server.ts";
import { buildVerifiedBoqCalculationManifest } from "./verified-boq-manifest.server.ts";
import {
  calculateVerifiedBoqV1_1,
  type VerifiedBoqV1_1Input,
} from "./verified-boq-v1-1.server.ts";

const Uuid = z.string().uuid();
const Sha256 = z.string().regex(/^[0-9a-f]{64}$/);
const MeasurementKind = z.enum(["length", "area", "count"]);
const DrawingUnit = z.enum(["EA", "m", "m2"]);
const BoqUnit = z.enum(["EA", "m", "m2", "m3"]);
const DecimalText = z
  .union([z.string(), z.number()])
  .transform(String)
  .pipe(z.string().regex(/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/));
const FiniteNumber = z
  .union([z.number(), z.string()])
  .transform(Number)
  .refine(Number.isFinite);
const P6Codes = [
  "P6A01",
  "P6Q01",
  "P6Q02",
  "P6Q03",
  "P6U01",
  "P6O01",
  "P6B04",
  "P6C01",
  "P6M01",
  "P6M02",
] as const;

export type P6LineageErrorCode = (typeof P6Codes)[number];

const safeMessages: Record<P6LineageErrorCode, string> = {
  P6A01: "도면 수량 근거를 확정할 권한이 없습니다.",
  P6Q01: "선택한 객체의 측정값을 확정할 수 없습니다.",
  P6Q02: "확정된 수량 근거는 변경할 수 없습니다.",
  P6Q03: "승인 도면 근거가 현재 객체와 일치하지 않습니다.",
  P6U01: "도면 수량 단위가 일치하지 않습니다.",
  P6O01: "다른 변경이 먼저 반영되었습니다. 다시 불러와 주세요.",
  P6B04: "도면 수량의 내역 연결 상태가 올바르지 않습니다.",
  P6C01: "확정 계산 근거가 일치하지 않습니다.",
  P6M01: "자재 인계 근거가 일치하지 않습니다.",
  P6M02: "확정된 자재 근거는 변경할 수 없습니다.",
};

export class DrawingQuantityLineageServerError extends Error {
  readonly code: P6LineageErrorCode;
  readonly requestId: string;

  constructor(
    code: P6LineageErrorCode,
    requestId: string = randomUUID(),
    message = safeMessages[code],
  ) {
    super(message);
    this.name = "DrawingQuantityLineageServerError";
    this.code = code;
    this.requestId = requestId;
  }
}

export type CreateDrawingQuantityLinkInput = {
  projectId: string;
  drawingRevisionId: string;
  drawingObjectId: string;
  measurementKind: DrawingQuantityMeasurementKind;
  linkId: string;
};

export type DrawingQuantityLinkRow = {
  id: string;
  projectId: string;
  drawingRevisionId: string;
  drawingRevisionVersion: number;
  drawingSnapshotSha256: string;
  drawingObjectId: string;
  drawingObjectLineageId: string;
  drawingObjectVersion: number;
  objectFingerprint: string;
  measurementKind: DrawingQuantityMeasurementKind;
  rawQuantity: string;
  unit: DrawingQuantityUnit;
  measurementRuleVersion: "P4_MEASUREMENT_V1";
  createdBy: string;
  createdAt: string;
};

export type DrawingObjectQuantityLineageRow = {
  quantity: DrawingQuantityLinkRow;
  boqLinks: Array<{
    id: string;
    boqVersionId: string;
    boqVersionStatus: "draft" | "in_review" | "approved" | "superseded";
    boqLineId: string;
    itemCode: string;
    allocationFactor: string;
    version: number;
  }>;
};

const CreateInputSchema = z
  .object({
    projectId: Uuid,
    drawingRevisionId: Uuid,
    drawingObjectId: Uuid,
    measurementKind: MeasurementKind,
    linkId: Uuid,
  })
  .strict();

const SnapshotObjectSchema = z
  .object({
    id: Uuid,
    lineageId: Uuid,
    pageId: Uuid,
    layerId: Uuid,
    name: z.string(),
    type: z.string(),
    geometry: z.unknown(),
    styleId: Uuid.nullable(),
    style: z.unknown(),
    version: z.number().int().positive(),
  })
  .strict();

const AuthoritySourceRowSchema = z
  .object({
    id: Uuid,
    object_id: Uuid,
    revision_id: Uuid,
    source_file_id: Uuid,
    source_sha256: Sha256,
    source_kind: z.enum(["pdf_region", "ifc_element"]),
    pdf_page_number: z.coerce.number().int().positive().nullable(),
    x: z.union([z.string(), z.number()]).transform(Number).nullable(),
    y: z.union([z.string(), z.number()]).transform(Number).nullable(),
    width: z.union([z.string(), z.number()]).transform(Number).nullable(),
    height: z.union([z.string(), z.number()]).transform(Number).nullable(),
    element_id: z.string().nullable(),
    ifc_global_id: z.string().nullable(),
    camera_json: z.unknown().nullable(),
    version: z.coerce.number().int().positive(),
  })
  .passthrough();

function authoritySource(input: unknown) {
  const row = AuthoritySourceRowSchema.parse(input);
  return DrawingObjectSourceSchema.parse(
    row.source_kind === "pdf_region"
      ? {
          id: row.id,
          objectId: row.object_id,
          revisionId: row.revision_id,
          sourceFileId: row.source_file_id,
          sourceSha256: row.source_sha256,
          sourceKind: row.source_kind,
          pdfPageNumber: row.pdf_page_number,
          x: row.x,
          y: row.y,
          width: row.width,
          height: row.height,
          version: row.version,
        }
      : {
          id: row.id,
          objectId: row.object_id,
          revisionId: row.revision_id,
          sourceFileId: row.source_file_id,
          sourceSha256: row.source_sha256,
          sourceKind: row.source_kind,
          ifcGlobalId: row.ifc_global_id,
          elementId: row.element_id,
          camera: row.camera_json,
          version: row.version,
        },
  );
}

type QuantityAuthority = {
  projectId: string;
  documentId: string;
  revisionId: string;
  revisionVersion: number;
  revisionStatus: "approved" | "superseded";
  operationSequence: number;
  canonicalJson: unknown;
  snapshotSha256: string;
  recomputedSnapshotSha256: string;
  approvalDecision: "approved";
  objectId: string;
  objectLineageId: string;
  objectVersion: number;
  sourceAnchors: unknown[];
  issueLinks: unknown[];
};

type PrivateInsertArgs = {
  p_actor_id: string;
  p_id: string;
  p_revision_id: string;
  p_object_id: string;
  p_measurement_kind: DrawingQuantityMeasurementKind;
  p_snapshot_sha256: string;
  p_object_lineage_id: string;
  p_object_version: number;
  p_object_fingerprint: string;
  p_raw_quantity: string;
  p_unit: DrawingQuantityUnit;
  p_measurement_rule_version: typeof P6_MEASUREMENT_RULE_VERSION;
};

type AuthorityTransaction = {
  loadAuthority(
    input: CreateDrawingQuantityLinkInput,
  ): Promise<QuantityAuthority>;
  insertQuantityLink(args: PrivateInsertArgs): Promise<unknown>;
};

/** @internal Optional fourth argument is a server-test seam, never route input. */
export type DrawingQuantityAuthority = {
  transaction<T>(
    run: (transaction: AuthorityTransaction) => Promise<T>,
    actor: { actorId: string; isStaff: boolean },
  ): Promise<T>;
};

const QuantityRowSchema = z
  .object({
    id: Uuid,
    project_id: Uuid,
    drawing_revision_id: Uuid,
    drawing_revision_version: z.coerce.number().int().positive(),
    drawing_snapshot_sha256: Sha256,
    drawing_object_id: Uuid,
    drawing_object_lineage_id: Uuid,
    drawing_object_version: z.coerce.number().int().positive(),
    object_fingerprint: Sha256,
    measurement_kind: MeasurementKind,
    raw_quantity: z.union([z.string(), z.number()]).transform(String),
    unit: z.enum(["EA", "m", "m2"]),
    measurement_rule_version: z.literal("P4_MEASUREMENT_V1"),
    created_by: Uuid,
    created_at: z.string(),
  })
  .passthrough();

function quantityRow(input: unknown): DrawingQuantityLinkRow {
  const row = QuantityRowSchema.parse(input);
  return {
    id: row.id,
    projectId: row.project_id,
    drawingRevisionId: row.drawing_revision_id,
    drawingRevisionVersion: row.drawing_revision_version,
    drawingSnapshotSha256: row.drawing_snapshot_sha256,
    drawingObjectId: row.drawing_object_id,
    drawingObjectLineageId: row.drawing_object_lineage_id,
    drawingObjectVersion: row.drawing_object_version,
    objectFingerprint: row.object_fingerprint,
    measurementKind: row.measurement_kind,
    rawQuantity: row.raw_quantity,
    unit: row.unit,
    measurementRuleVersion: row.measurement_rule_version,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

function p6Error(error: unknown, requestId: string) {
  if (error instanceof DrawingQuantityLineageServerError) return error;
  const explicit =
    typeof error === "object" && error !== null && "code" in error
      ? String(error.code)
      : error instanceof Error
        ? error.message.match(/^(P6[A-Z][0-9]{2}):/)?.[1]
        : null;
  const code =
    error instanceof z.ZodError
      ? "P6B04"
      : P6Codes.includes(explicit as P6LineageErrorCode)
        ? (explicit as P6LineageErrorCode)
        : "P6C01";
  return new DrawingQuantityLineageServerError(code, requestId);
}

async function requireQuantityWriter(
  client: SupabaseClient,
  actorId: string,
  projectId: string,
) {
  const { data: auth, error: authError } = await client.auth.getUser();
  const user = auth.user;
  if (authError || !user || user.is_anonymous || user.id !== actorId)
    throw new DrawingQuantityLineageServerError("P6A01");
  const { data: project, error: projectError } = await client
    .from("lukas_qto_projects")
    .select("id,owner_id")
    .eq("id", projectId)
    .single();
  if (projectError || !project)
    throw new DrawingQuantityLineageServerError("P6A01");
  if (project.owner_id === actorId || user.app_metadata.role === "hangil_staff")
    return { actorId, isStaff: user.app_metadata.role === "hangil_staff" };
  const { data: member, error: memberError } = await client
    .from("lukas_qto_project_members")
    .select("role")
    .eq("project_id", projectId)
    .eq("user_id", actorId)
    .maybeSingle();
  if (memberError || member?.role !== "estimator")
    throw new DrawingQuantityLineageServerError("P6A01");
  return { actorId, isStaff: false };
}

function deriveInsertArgs(
  actorId: string,
  input: CreateDrawingQuantityLinkInput,
  authority: QuantityAuthority,
): PrivateInsertArgs {
  if (
    authority.projectId !== input.projectId ||
    authority.revisionId !== input.drawingRevisionId ||
    authority.objectId !== input.drawingObjectId ||
    authority.snapshotSha256 !== authority.recomputedSnapshotSha256 ||
    authority.approvalDecision !== "approved" ||
    !["approved", "superseded"].includes(authority.revisionStatus)
  )
    throw new DrawingQuantityLineageServerError("P6Q03");
  const bootstrap = parseDrawingWorkspaceCollaborationBootstrap({
    canonicalJson: authority.canonicalJson,
    operationSequence: authority.operationSequence,
    schemaVersion: 2,
    sha256: authority.snapshotSha256,
    revisionStatus: authority.revisionStatus,
    capability: "editor",
    canWrite: false,
    recentOutcomes: [],
  });
  if (
    bootstrap.canonicalJson.revision.id !== authority.revisionId ||
    bootstrap.canonicalJson.revision.documentId !== authority.documentId ||
    bootstrap.canonicalJson.revision.projectId !== authority.projectId ||
    bootstrap.canonicalJson.revision.version !== authority.revisionVersion
  )
    throw new DrawingQuantityLineageServerError("P6Q03");
  const matches = bootstrap.canonicalJson.objects.filter(
    (candidate) =>
      typeof candidate === "object" &&
      candidate !== null &&
      "id" in candidate &&
      candidate.id === input.drawingObjectId,
  );
  if (matches.length !== 1)
    throw new DrawingQuantityLineageServerError("P6Q03");
  const snapshotSources = bootstrap.canonicalJson.sources
    .filter((source) => source.objectId === input.drawingObjectId)
    .sort((left, right) => left.id.localeCompare(right.id));
  const liveSources = authority.sourceAnchors
    .map(authoritySource)
    .sort((left, right) => left.id.localeCompare(right.id));
  const snapshotIssueIds = bootstrap.canonicalJson.issues
    .filter(
      (issue) =>
        typeof issue === "object" &&
        issue !== null &&
        "objectId" in issue &&
        issue.objectId === input.drawingObjectId,
    )
    .map((issue) => Uuid.parse((issue as { id?: unknown }).id))
    .sort();
  const liveIssueIds = authority.issueLinks
    .map((issue) =>
      Uuid.parse(
        z.object({ issue_id: Uuid }).passthrough().parse(issue).issue_id,
      ),
    )
    .sort();
  if (
    JSON.stringify(snapshotSources) !== JSON.stringify(liveSources) ||
    JSON.stringify(snapshotIssueIds) !== JSON.stringify(liveIssueIds)
  )
    throw new DrawingQuantityLineageServerError("P6Q03");
  const snapshotObject = SnapshotObjectSchema.parse(matches[0]);
  if (
    snapshotObject.lineageId !== authority.objectLineageId ||
    snapshotObject.version !== authority.objectVersion
  )
    throw new DrawingQuantityLineageServerError("P6Q03");
  const object = DrawingObjectSchema.parse({
    id: snapshotObject.id,
    name: snapshotObject.name,
    layerId: snapshotObject.layerId,
    geometry: snapshotObject.geometry,
    styleId: snapshotObject.styleId,
    style: snapshotObject.style,
    version: snapshotObject.version,
  });
  if (object.geometry.type !== snapshotObject.type)
    throw new DrawingQuantityLineageServerError("P6Q03");
  const evidence = deriveAuthorizedDrawingMeasurementEvidence(bootstrap);
  const measurement = evidence.measurements[input.drawingObjectId]?.measurement;
  if (!measurement) throw new DrawingQuantityLineageServerError("P6Q01");
  const value = convertDrawingMeasurement(measurement, input.measurementKind);
  return {
    p_actor_id: actorId,
    p_id: input.linkId,
    p_revision_id: input.drawingRevisionId,
    p_object_id: input.drawingObjectId,
    p_measurement_kind: input.measurementKind,
    p_snapshot_sha256: authority.snapshotSha256,
    p_object_lineage_id: authority.objectLineageId,
    p_object_version: authority.objectVersion,
    p_object_fingerprint: drawingObjectFingerprintSha256(object),
    p_raw_quantity: value.rawQuantity,
    p_unit: value.unit,
    p_measurement_rule_version: value.measurementRuleVersion,
  };
}

export async function createDrawingQuantityLink(
  userClient: SupabaseClient,
  actorId: string,
  input: CreateDrawingQuantityLinkInput,
  authority?: DrawingQuantityAuthority,
): Promise<DrawingQuantityLinkRow> {
  const requestId = randomUUID();
  let parsed: CreateDrawingQuantityLinkInput;
  try {
    parsed = CreateInputSchema.parse({ ...input, projectId: input.projectId });
    Uuid.parse(actorId);
    const trustedActor = await requireQuantityWriter(
      userClient,
      actorId,
      parsed.projectId,
    );
    const trusted = authority ?? databaseAuthority();
    return await trusted.transaction(async (transaction) => {
      const approved = await transaction.loadAuthority(parsed);
      const args = deriveInsertArgs(actorId, parsed, approved);
      return quantityRow(await transaction.insertQuantityLink(args));
    }, trustedActor);
  } catch (error) {
    const bounded = p6Error(error, requestId);
    console.error("Drawing quantity authority failed", {
      requestId: bounded.requestId,
      code: bounded.code,
      projectId: input.projectId,
      revisionId: input.drawingRevisionId,
      objectId: input.drawingObjectId,
      linkId: input.linkId,
    });
    throw bounded;
  }
}

function databaseAuthority(): DrawingQuantityAuthority {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new DrawingQuantityLineageServerError("P6C01");
  return {
    async transaction(run, actor) {
      const sql = postgres(databaseUrl, { max: 1, prepare: false });
      try {
        const result = await sql.begin(async (tx) => {
          await tx.unsafe("set local role service_role");
          await tx`
            select pg_catalog.set_config('request.jwt.claim.sub',${actor.actorId},true),
              pg_catalog.set_config('request.jwt.claims',${JSON.stringify({
                sub: actor.actorId,
                is_anonymous: false,
                app_metadata: actor.isStaff ? { role: "hangil_staff" } : {},
              })},true)
          `;
          return run({
            async loadAuthority(input) {
              const rows = await tx`
                select r.project_id, r.document_id, r.id as revision_id,
                  r.version as revision_version, r.status as revision_status,
                  s.operation_sequence, s.canonical_json,
                  s.sha256 as snapshot_sha256,
                  pg_catalog.encode(extensions.digest(
                    pg_catalog.convert_to(s.canonical_json::text,'UTF8'),
                    'sha256'
                  ),'hex') as recomputed_snapshot_sha256,
                  a.decision as approval_decision,
                  o.id as object_id, o.lineage_id as object_lineage_id,
                  o.version as object_version
                from public.lukas_drawing_revisions r
                join public.lukas_drawing_documents d
                  on d.id=r.document_id and d.project_id=r.project_id
                join public.lukas_drawing_snapshots s
                  on s.revision_id=r.id and s.project_id=r.project_id
                  and s.revision_version=r.version
                join public.lukas_drawing_revision_approvals a
                  on a.revision_id=s.revision_id and a.project_id=s.project_id
                  and a.subject_version=s.revision_version
                  and a.snapshot_sha256=s.sha256 and a.decision='approved'
                join public.lukas_drawing_objects o
                  on o.id=${input.drawingObjectId}::uuid
                  and o.revision_id=r.id and o.project_id=r.project_id
                  and o.status='active'
                left join public.lukas_qto_files f
                  on f.id=d.source_file_id and f.project_id=d.project_id
                  and f.sha256=d.source_sha256
                where r.id=${input.drawingRevisionId}::uuid
                  and r.project_id=${input.projectId}::uuid
                  and r.status in ('approved','superseded')
                  and s.schema_version=2
                  and (d.source_file_id is null or (
                    f.id is not null and f.immutable=true and f.kind in ('pdf','ifc')
                  ))
              `;
              if (rows.length !== 1)
                throw new DrawingQuantityLineageServerError("P6Q03");
              const sources = await tx`
                select os.*, f.id is not null and f.immutable=true
                  and f.sha256=os.source_sha256 as valid_file
                from public.lukas_drawing_object_sources os
                left join public.lukas_qto_files f
                  on f.id=os.source_file_id and f.project_id=os.project_id
                where os.project_id=${input.projectId}::uuid
                  and os.revision_id=${input.drawingRevisionId}::uuid
                  and os.object_id=${input.drawingObjectId}::uuid
                  and os.status='active'
                order by os.id
              `;
              if (sources.some((source) => source.valid_file !== true))
                throw new DrawingQuantityLineageServerError("P6Q03");
              const issues = await tx`
                select l.issue_id
                from public.lukas_drawing_object_issue_links l
                join public.lukas_drawing_issues i
                  on i.id=l.issue_id and i.project_id=l.project_id
                where l.project_id=${input.projectId}::uuid
                  and l.revision_id=${input.drawingRevisionId}::uuid
                  and l.object_id=${input.drawingObjectId}::uuid
                order by l.issue_id
              `;
              const row = rows[0];
              return {
                projectId: row.project_id,
                documentId: row.document_id,
                revisionId: row.revision_id,
                revisionVersion: Number(row.revision_version),
                revisionStatus: row.revision_status,
                operationSequence: Number(row.operation_sequence),
                canonicalJson: row.canonical_json,
                snapshotSha256: row.snapshot_sha256,
                recomputedSnapshotSha256: row.recomputed_snapshot_sha256,
                approvalDecision: row.approval_decision,
                objectId: row.object_id,
                objectLineageId: row.object_lineage_id,
                objectVersion: Number(row.object_version),
                sourceAnchors: sources,
                issueLinks: issues,
              } as QuantityAuthority;
            },
            async insertQuantityLink(args) {
              const rows = await tx`
                select * from private.lukas_drawing_insert_quantity_link(
                  ${args.p_actor_id}::uuid, ${args.p_id}::uuid,
                  ${args.p_revision_id}::uuid, ${args.p_object_id}::uuid,
                  ${args.p_measurement_kind}, ${args.p_snapshot_sha256},
                  ${args.p_object_lineage_id}::uuid, ${args.p_object_version}::bigint,
                  ${args.p_object_fingerprint}, ${args.p_raw_quantity}::numeric,
                  ${args.p_unit}, ${args.p_measurement_rule_version}
                )
              `;
              if (rows.length !== 1)
                throw new DrawingQuantityLineageServerError("P6O01");
              return rows[0];
            },
          });
        });
        return result as unknown as Awaited<ReturnType<typeof run>>;
      } finally {
        await sql.end({ timeout: 5 });
      }
    },
  };
}

const BoqLinkSchema = z
  .object({
    id: Uuid,
    quantity_link_id: Uuid,
    boq_version_id: Uuid,
    boq_line_id: Uuid,
    allocation_factor: z.union([z.string(), z.number()]).transform(String),
    version: z.coerce.number().int().positive(),
    boq_version: z.object({
      status: z.enum(["draft", "in_review", "approved", "superseded"]),
    }),
    boq_line: z.object({ item_code: z.string() }),
  })
  .passthrough();

const CursorSchema = z
  .object({ createdAt: z.string().datetime(), id: Uuid })
  .strict();

function parseCursor(cursor: string | null) {
  if (!cursor) return null;
  try {
    return CursorSchema.parse(
      JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")),
    );
  } catch {
    throw new DrawingQuantityLineageServerError("P6O01");
  }
}

function encodeCursor(row: DrawingQuantityLinkRow) {
  return Buffer.from(
    JSON.stringify({ createdAt: row.createdAt, id: row.id }),
    "utf8",
  ).toString("base64url");
}

export async function listDrawingObjectQuantityLineage(
  userClient: SupabaseClient,
  input: {
    projectId: string;
    revisionId: string;
    objectId: string;
    cursor: string | null;
    limit?: number;
    boqEvidence?: { boqVersionId: string; boqLineId: string };
  },
): Promise<{
  rows: DrawingObjectQuantityLineageRow[];
  nextCursor: string | null;
}> {
  const projectId = Uuid.parse(input.projectId);
  const revisionId = Uuid.parse(input.revisionId);
  const objectId = Uuid.parse(input.objectId);
  const limit = Math.min(200, Math.max(1, input.limit ?? 200));
  const cursor = parseCursor(input.cursor);
  const exactLink = input.boqEvidence
    ? BoqLinkSchema.parse(
        await exactRow(
          userClient,
          "lukas_drawing_boq_links",
          "id,quantity_link_id,boq_version_id,boq_line_id,allocation_factor,version,boq_version:lukas_qto_boq_versions!inner(status),boq_line:lukas_qto_boq_lines!inner(item_code),quantity:lukas_drawing_quantity_links!inner(id)",
          [
            ["project_id", projectId],
            ["boq_version_id", Uuid.parse(input.boqEvidence.boqVersionId)],
            ["boq_line_id", Uuid.parse(input.boqEvidence.boqLineId)],
            ["quantity.drawing_revision_id", revisionId],
            ["quantity.drawing_object_id", objectId],
          ],
        ),
      )
    : null;
  let query = userClient
    .from("lukas_drawing_quantity_links")
    .select("*")
    .eq("project_id", projectId)
    .eq("drawing_revision_id", revisionId)
    .eq("drawing_object_id", objectId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false });
  if (cursor)
    query = query.or(
      `created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`,
    );
  const { data, error } = await query.limit(limit + 1);
  if (error) throw new DrawingQuantityLineageServerError("P6A01");
  const recent = (data ?? []).map(quantityRow);
  const exactQuantity =
    exactLink &&
    !recent.slice(0, limit).some((row) => row.id === exactLink.quantity_link_id)
      ? quantityRow(
          await exactRow(userClient, "lukas_drawing_quantity_links", "*", [
            ["id", exactLink.quantity_link_id],
            ["project_id", projectId],
            ["drawing_revision_id", revisionId],
            ["drawing_object_id", objectId],
          ]),
        )
      : null;
  const recentLimit = exactQuantity ? Math.max(0, limit - 1) : limit;
  const recentPage = recent.slice(0, recentLimit);
  const quantities = exactQuantity
    ? [exactQuantity, ...recentPage]
    : recentPage;
  const quantityIds = quantities.map((row) => row.id);
  let links: z.infer<typeof BoqLinkSchema>[] = [];
  if (quantityIds.length) {
    const { data: linkRows, error: linkError } = await userClient
      .from("lukas_drawing_boq_links")
      .select(
        "id,quantity_link_id,boq_version_id,boq_line_id,allocation_factor,version,boq_version:lukas_qto_boq_versions!inner(status),boq_line:lukas_qto_boq_lines!inner(item_code)",
      )
      .eq("project_id", projectId)
      .in("quantity_link_id", quantityIds)
      .order("id", { ascending: true })
      .limit(200);
    if (linkError) throw new DrawingQuantityLineageServerError("P6A01");
    links = (linkRows ?? []).map((row) => BoqLinkSchema.parse(row));
    if (exactLink && !links.some((link) => link.id === exactLink.id))
      links.unshift(exactLink);
  }
  return {
    rows: quantities.map((quantity) => ({
      quantity,
      boqLinks: links
        .filter((link) => link.quantity_link_id === quantity.id)
        .map((link) => ({
          id: link.id,
          boqVersionId: link.boq_version_id,
          boqVersionStatus: link.boq_version.status,
          boqLineId: link.boq_line_id,
          itemCode: link.boq_line.item_code,
          allocationFactor: link.allocation_factor,
          version: link.version,
        })),
    })),
    nextCursor:
      recent.length > recentLimit && recentPage.length
        ? encodeCursor(recentPage.at(-1)!)
        : null,
  };
}

async function exactRow(
  client: SupabaseClient,
  table: string,
  select: string,
  filters: Array<[string, unknown]>,
) {
  let query = client.from(table).select(select);
  for (const [column, value] of filters) query = query.eq(column, value);
  const { data, error } = await query.single();
  if (error || !data) throw new Error("연결된 도면 근거를 열 수 없습니다.");
  return data as unknown as Record<string, unknown>;
}

export async function resolveDrawingWorkspaceEntry(
  userClient: SupabaseClient,
  input: {
    projectId: string;
    revisionId: string;
    objectId: string;
    boqVersionId: string;
    boqLineId: string;
    fileId?: string;
  },
): Promise<{
  documentId: string;
  objectId: string;
  revisionId: string;
  boqVersionId: string;
  boqLineId: string;
  evidenceFileId?: string;
  evidenceKind?: "pdf" | "ifc";
}> {
  try {
    const parsed = {
      projectId: Uuid.parse(input.projectId),
      revisionId: Uuid.parse(input.revisionId),
      objectId: Uuid.parse(input.objectId),
      boqVersionId: Uuid.parse(input.boqVersionId),
      boqLineId: Uuid.parse(input.boqLineId),
      fileId: input.fileId ? Uuid.parse(input.fileId) : undefined,
    };
    const revision = await exactRow(
      userClient,
      "lukas_drawing_revisions",
      "id,document_id,project_id",
      [
        ["id", parsed.revisionId],
        ["project_id", parsed.projectId],
      ],
    );
    const documentId = Uuid.parse(revision.document_id);
    await exactRow(
      userClient,
      "lukas_drawing_documents",
      "id,project_id,source_file_id",
      [
        ["id", documentId],
        ["project_id", parsed.projectId],
      ],
    );
    await Promise.all([
      exactRow(userClient, "lukas_drawing_objects", "id", [
        ["id", parsed.objectId],
        ["revision_id", parsed.revisionId],
        ["project_id", parsed.projectId],
      ]),
      exactRow(userClient, "lukas_qto_boq_versions", "id", [
        ["id", parsed.boqVersionId],
        ["project_id", parsed.projectId],
      ]),
      exactRow(userClient, "lukas_qto_boq_lines", "id", [
        ["id", parsed.boqLineId],
        ["version_id", parsed.boqVersionId],
        ["project_id", parsed.projectId],
      ]),
      exactRow(
        userClient,
        "lukas_drawing_boq_links",
        "id,quantity:lukas_drawing_quantity_links!inner(id)",
        [
          ["project_id", parsed.projectId],
          ["boq_version_id", parsed.boqVersionId],
          ["boq_line_id", parsed.boqLineId],
          ["quantity.drawing_revision_id", parsed.revisionId],
          ["quantity.drawing_object_id", parsed.objectId],
        ],
      ),
    ]);
    const entry = {
      documentId,
      objectId: parsed.objectId,
      revisionId: parsed.revisionId,
      boqVersionId: parsed.boqVersionId,
      boqLineId: parsed.boqLineId,
    };
    if (!parsed.fileId) return entry;
    await exactRow(userClient, "lukas_drawing_object_sources", "id", [
      ["project_id", parsed.projectId],
      ["revision_id", parsed.revisionId],
      ["object_id", parsed.objectId],
      ["source_file_id", parsed.fileId],
      ["status", "active"],
    ]);
    const file = await exactRow(userClient, "lukas_qto_files", "id,kind", [
      ["id", parsed.fileId],
      ["project_id", parsed.projectId],
      ["immutable", true],
    ]);
    if (file.kind !== "pdf" && file.kind !== "ifc")
      throw new Error("unsupported evidence file");
    return {
      ...entry,
      evidenceFileId: parsed.fileId,
      evidenceKind: file.kind,
    };
  } catch {
    throw new Error("연결된 도면 근거를 열 수 없습니다.");
  }
}

export function drawingWorkspaceEntryLocation(
  projectId: string,
  entry: Awaited<ReturnType<typeof resolveDrawingWorkspaceEntry>>,
) {
  const project = Uuid.parse(projectId);
  const documentId = Uuid.parse(entry.documentId);
  const search = new URLSearchParams({
    revision: Uuid.parse(entry.revisionId),
    object: Uuid.parse(entry.objectId),
    boq: Uuid.parse(entry.boqVersionId),
    line: Uuid.parse(entry.boqLineId),
  });
  if (entry.evidenceFileId) {
    const evidenceFileId = Uuid.parse(entry.evidenceFileId);
    search.set("evidence", evidenceFileId);
    if (entry.evidenceKind === "ifc") {
      search.set("view", "split");
      search.set("ifc", evidenceFileId);
    } else search.set("view", "2d");
  }
  return `/projects/${project}/workspaces/${documentId}?${search}`;
}

export type CreateP6MaterialHandoffInput = {
  projectId: string;
  boqVersionId: string;
  operationId: string;
  selectedRateComponentIds: string[];
};

type ApprovedMaterialComponent = P6MaterialComponentInput & {
  resourceType: string;
  resourcePriceBookId: string;
  boqLineUnit?: string;
};

type P6MaterialHandoffContext = {
  ownerId: string;
  projectId: string;
  boqVersionId: string;
  priceBookId: string;
  resultSha256: string;
  components: ApprovedMaterialComponent[];
};

type P6MaterialPlanInsert = {
  id: string;
  materialResourceId: string;
  materialCode: string;
  materialName: string;
  specification: string;
  unit: string;
  designQuantity: string;
  allowanceRate: "0";
  requiredQuantity: string;
  ruleId: "P6_MATERIAL_HANDOFF_V1";
};

type P6MaterialLinkInsert = {
  id: string;
  boqLineId: string;
  boqRateComponentId: string;
  materialResourceId: string;
  materialPlanId: string;
  derivedDesignQuantity: string;
};

type P6MaterialHandoffAuthority = {
  loadApprovedExport(
    userClient: SupabaseClient,
    actorId: string,
    boqVersionId: string,
  ): Promise<{
    resultSha256: string;
    manifestSha256: string;
    handoffSha256: string;
    manifestJson: Uint8Array;
  }>;
  loadContext(
    userClient: SupabaseClient,
    input: CreateP6MaterialHandoffInput,
  ): Promise<P6MaterialHandoffContext>;
  persistManifest(input: {
    userClient: SupabaseClient;
    actorId: string;
    boqVersionId: string;
    operationId: string;
    ownerId: string;
    projectId: string;
    handoffSha256: string;
    manifestFileSha256: string;
    bytes: Uint8Array;
    path: string;
  }): Promise<string>;
  insertHandoff(input: {
    actorId: string;
    boqVersionId: string;
    resultSha256: string;
    manifestFileId: string;
    manifestFileSha256: string;
    plans: P6MaterialPlanInsert[];
    links: P6MaterialLinkInsert[];
  }): Promise<unknown>;
};

const CreateMaterialHandoffSchema = z
  .object({
    projectId: Uuid,
    boqVersionId: Uuid,
    operationId: Uuid,
    selectedRateComponentIds: z.array(Uuid).min(1).max(2_000),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      new Set(value.selectedRateComponentIds).size !==
      value.selectedRateComponentIds.length
    )
      context.addIssue({ code: "custom", message: "중복 구성요소" });
  });

export function parseP6MaterialHandoffForm(form: FormData) {
  const allowed = new Set([
    "intent",
    "version_id",
    "operation_id",
    "component_id",
  ]);
  if ([...form.keys()].some((key) => !allowed.has(key)))
    throw new Error("허용되지 않은 필드가 포함되어 있습니다.");
  const single = (key: string) => {
    const values = form.getAll(key);
    if (values.length !== 1 || typeof values[0] !== "string")
      throw new DrawingQuantityLineageServerError("P6M01");
    return values[0];
  };
  const componentIds = form.getAll("component_id");
  if (componentIds.some((value) => typeof value !== "string"))
    throw new DrawingQuantityLineageServerError("P6M01");
  const parsed = z
    .object({
      boqVersionId: Uuid,
      operationId: Uuid,
      selectedRateComponentIds: z.array(Uuid).min(1).max(2_000),
    })
    .strict()
    .parse({
      boqVersionId: single("version_id"),
      operationId: single("operation_id"),
      selectedRateComponentIds: componentIds,
    });
  if (
    new Set(parsed.selectedRateComponentIds).size !==
    parsed.selectedRateComponentIds.length
  )
    throw new DrawingQuantityLineageServerError("P6M01");
  if (single("intent") !== "boq_handoff")
    throw new DrawingQuantityLineageServerError("P6M01");
  return { intent: "boq_handoff" as const, ...parsed };
}

function stableP6Uuid(...parts: string[]) {
  const bytes = createHash("sha256").update(parts.join("\u001f")).digest();
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.subarray(0, 16).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function positiveDecimal(value: string) {
  try {
    return compareExact(parseExactDecimal(value), parseExactDecimal("0")) > 0;
  } catch {
    return false;
  }
}

function materialHandoffRows(
  boqVersionId: string,
  operationId: string,
  components: ApprovedMaterialComponent[],
) {
  const derived = deriveP6MaterialPlans(components);
  const componentById = new Map(
    components.map((component) => [component.rateComponentId, component]),
  );
  const plans: P6MaterialPlanInsert[] = [];
  const links: P6MaterialLinkInsert[] = [];
  let linkIndex = 0;
  for (const [planIndex, plan] of derived.entries()) {
    // One operation owns one ordered plan set. Reusing it with any other
    // selection collides on the first plan and the private authority rejects it.
    const planId = stableP6Uuid(
      boqVersionId,
      operationId,
      "plan",
      String(planIndex),
    );
    const first = componentById.get(plan.components[0].rateComponentId);
    if (!first) throw new DrawingQuantityLineageServerError("P6M01");
    plans.push({
      id: planId,
      materialResourceId: first.resourceId,
      materialCode: plan.materialCode,
      materialName: plan.materialName,
      specification: plan.specification,
      unit: plan.unit,
      designQuantity: plan.designQuantity,
      allowanceRate: plan.allowanceRate,
      requiredQuantity: plan.requiredQuantity,
      ruleId: plan.ruleId,
    });
    for (const component of plan.components) {
      const source = componentById.get(component.rateComponentId);
      if (!source) throw new DrawingQuantityLineageServerError("P6M01");
      links.push({
        id: stableP6Uuid(
          boqVersionId,
          operationId,
          "link",
          String(linkIndex++),
        ),
        boqLineId: source.lineId,
        boqRateComponentId: source.rateComponentId,
        materialResourceId: source.resourceId,
        materialPlanId: planId,
        derivedDesignQuantity: component.derivedDesignQuantity,
      });
    }
  }
  return { plans, links };
}

async function loadMaterialHandoffContext(
  userClient: SupabaseClient,
  input: CreateP6MaterialHandoffInput,
): Promise<P6MaterialHandoffContext> {
  const boundedRows = async <Row>(
    loadPage: (
      from: number,
      to: number,
    ) => Promise<{ data: Row[] | null; error: unknown }>,
    maximum: number,
  ) => {
    try {
      return await collectBoundedRows(loadPage, maximum);
    } catch {
      throw new DrawingQuantityLineageServerError("P6M01");
    }
  };
  const { data: version, error: versionError } = await userClient
    .from("lukas_qto_boq_versions")
    .select("id,project_id,price_book_id,result_sha256,status")
    .eq("id", input.boqVersionId)
    .eq("project_id", input.projectId)
    .single();
  if (
    versionError ||
    !version ||
    !["approved", "superseded"].includes(String(version.status)) ||
    !Sha256.safeParse(version.result_sha256).success
  )
    throw new DrawingQuantityLineageServerError("P6M01");
  const [{ data: project, error: projectError }, componentRows] =
    await Promise.all([
      userClient
        .from("lukas_qto_projects")
        .select("id,owner_id")
        .eq("id", input.projectId)
        .single(),
      boundedRows(async (from, to) => {
        const { data, error } = await userClient
          .from("lukas_qto_boq_rate_components")
          .select("id,version_id,line_id,resource_id,coefficient")
          .eq("project_id", input.projectId)
          .eq("version_id", input.boqVersionId)
          .in("id", input.selectedRateComponentIds)
          .order("id", { ascending: true })
          .range(from, to);
        return { data, error };
      }, input.selectedRateComponentIds.length),
    ]);
  if (
    projectError ||
    !project ||
    componentRows.length !== input.selectedRateComponentIds.length
  )
    throw new DrawingQuantityLineageServerError("P6M01");
  const resourceIds = [...new Set(componentRows.map((row) => row.resource_id))];
  const lineIds = [...new Set(componentRows.map((row) => row.line_id))];
  const [resources, lines] = await Promise.all([
    boundedRows(async (from, to) => {
      const { data, error } = await userClient
        .from("lukas_qto_price_resources")
        .select(
          "id,project_id,price_book_id,resource_type,resource_code,resource_name,specification,unit",
        )
        .eq("project_id", input.projectId)
        .eq("price_book_id", version.price_book_id)
        .in("id", resourceIds)
        .order("id", { ascending: true })
        .range(from, to);
      return { data, error };
    }, resourceIds.length),
    boundedRows(async (from, to) => {
      const { data, error } = await userClient
        .from("lukas_qto_boq_lines")
        .select("id,version_id,project_id,item_code,unit")
        .eq("project_id", input.projectId)
        .eq("version_id", input.boqVersionId)
        .in("id", lineIds)
        .order("id", { ascending: true })
        .range(from, to);
      return { data, error };
    }, lineIds.length),
  ]);
  if (
    resources.length !== resourceIds.length ||
    lines.length !== lineIds.length
  )
    throw new DrawingQuantityLineageServerError("P6M01");
  const resourceById = new Map(resources.map((row) => [row.id, row]));
  const lineById = new Map(lines.map((row) => [row.id, row]));
  return {
    ownerId: Uuid.parse(project.owner_id),
    projectId: input.projectId,
    boqVersionId: input.boqVersionId,
    priceBookId: Uuid.parse(version.price_book_id),
    resultSha256: Sha256.parse(version.result_sha256),
    components: componentRows.map((row) => {
      const resource = resourceById.get(row.resource_id);
      const line = lineById.get(row.line_id);
      if (!resource || !line)
        throw new DrawingQuantityLineageServerError("P6M01");
      return {
        boqVersionId: input.boqVersionId,
        lineId: Uuid.parse(row.line_id),
        rateComponentId: Uuid.parse(row.id),
        resourceId: Uuid.parse(row.resource_id),
        resourceCode: String(resource.resource_code),
        resourceName: String(resource.resource_name),
        resourceSpecification: String(resource.specification),
        resourceUnit: String(resource.unit),
        resourceType: String(resource.resource_type),
        resourcePriceBookId: Uuid.parse(resource.price_book_id),
        resourceCoefficient: String(row.coefficient),
        finalQuantity: "",
        boqLineUnit: String(line.unit),
      };
    }),
  };
}

function applyApprovedManifest(
  context: P6MaterialHandoffContext,
  bytes: Uint8Array,
  handoffSha256: string,
) {
  const manifest = z
    .object({
      handoffSha256: Sha256,
      resultSha256: Sha256,
      calculationManifest: z.object({
        projectId: Uuid,
        boqVersionId: Uuid,
        rateComponents: z.array(
          z.object({
            id: Uuid,
            lineId: Uuid,
            resourceId: Uuid,
            coefficient: DecimalText,
          }),
        ),
        resources: z.array(
          z.object({
            id: Uuid,
            code: z.string(),
            type: z.string(),
            unit: z.string(),
          }),
        ),
        result: z.object({
          canonicalLines: z.array(
            z.object({
              lineId: Uuid,
              unit: z.string(),
              finalQuantity: DecimalText,
            }),
          ),
        }),
      }),
    })
    .parse(JSON.parse(new TextDecoder().decode(bytes)));
  if (
    manifest.handoffSha256 !== handoffSha256 ||
    manifest.resultSha256 !== context.resultSha256 ||
    manifest.calculationManifest.projectId !== context.projectId ||
    manifest.calculationManifest.boqVersionId !== context.boqVersionId
  )
    throw new DrawingQuantityLineageServerError("P6M01");
  const manifestComponents = new Map(
    manifest.calculationManifest.rateComponents.map((row) => [row.id, row]),
  );
  const manifestResources = new Map(
    manifest.calculationManifest.resources.map((row) => [row.id, row]),
  );
  const resultLines = new Map(
    manifest.calculationManifest.result.canonicalLines.map((row) => [
      row.lineId,
      row,
    ]),
  );
  return {
    ...context,
    components: context.components.map((component) => {
      const frozen = manifestComponents.get(component.rateComponentId);
      const resource = manifestResources.get(component.resourceId);
      const line = resultLines.get(component.lineId);
      if (
        !frozen ||
        !resource ||
        !line ||
        frozen.lineId !== component.lineId ||
        frozen.resourceId !== component.resourceId ||
        compareExact(
          parseExactDecimal(frozen.coefficient),
          parseExactDecimal(component.resourceCoefficient),
        ) !== 0 ||
        resource.code !== component.resourceCode ||
        resource.type !== component.resourceType ||
        resource.unit !== component.resourceUnit ||
        (component.boqLineUnit !== undefined &&
          line.unit !== component.boqLineUnit)
      )
        throw new DrawingQuantityLineageServerError("P6M01");
      return { ...component, finalQuantity: line.finalQuantity };
    }),
  };
}

async function persistMaterialManifest(
  input: Parameters<P6MaterialHandoffAuthority["persistManifest"]>[0],
) {
  const manifestFileId = stableP6Uuid(
    input.boqVersionId,
    input.operationId,
    "manifest",
  );
  const storage = input.userClient.storage.from("lukas-qto");
  const upload = await storage.upload(input.path, input.bytes, {
    contentType: "application/json",
    upsert: false,
  });
  if (upload.error) {
    const status = Number(
      (upload.error as unknown as { statusCode?: string; status?: number })
        .statusCode ?? (upload.error as unknown as { status?: number }).status,
    );
    if (status !== 409) throw new DrawingQuantityLineageServerError("P6M01");
  }
  const downloaded = await storage.download(input.path);
  if (downloaded.error || !downloaded.data)
    throw new DrawingQuantityLineageServerError("P6M01");
  const downloadedBytes = new Uint8Array(await downloaded.data.arrayBuffer());
  if (
    createHash("sha256").update(downloadedBytes).digest("hex") !==
      input.manifestFileSha256 ||
    !Buffer.from(downloadedBytes).equals(Buffer.from(input.bytes))
  )
    throw new DrawingQuantityLineageServerError("P6M01");
  const inserted = await input.userClient.from("lukas_qto_files").insert({
    id: manifestFileId,
    project_id: input.projectId,
    uploaded_by: input.actorId,
    kind: "other",
    storage_path: input.path,
    original_filename: `${input.handoffSha256}.manifest.json`,
    content_type: "application/json",
    byte_size: input.bytes.byteLength,
    sha256: input.manifestFileSha256,
    immutable: true,
  });
  if (inserted.error) {
    if (inserted.error.code !== "23505")
      throw new DrawingQuantityLineageServerError("P6M01");
    const { data: existing, error } = await input.userClient
      .from("lukas_qto_files")
      .select("id,project_id,storage_path,sha256,byte_size,immutable")
      .eq("id", manifestFileId)
      .eq("project_id", input.projectId)
      .maybeSingle();
    if (
      error ||
      !existing ||
      existing.storage_path !== input.path ||
      existing.sha256 !== input.manifestFileSha256 ||
      Number(existing.byte_size) !== input.bytes.byteLength ||
      existing.immutable !== true
    )
      throw new DrawingQuantityLineageServerError("P6O01");
  }
  return manifestFileId;
}

function databaseMaterialHandoffAuthority(): P6MaterialHandoffAuthority {
  return {
    async loadApprovedExport(userClient, actorId, boqVersionId) {
      const { loadApprovedVerifiedBoqExport } = await import(
        "./verified-boq-approved-export.server.ts"
      );
      return loadApprovedVerifiedBoqExport(userClient, actorId, boqVersionId);
    },
    loadContext: loadMaterialHandoffContext,
    persistManifest: persistMaterialManifest,
    async insertHandoff(input) {
      const databaseUrl = process.env.DATABASE_URL;
      if (!databaseUrl) throw new DrawingQuantityLineageServerError("P6C01");
      const sql = postgres(databaseUrl, { max: 1, prepare: false });
      try {
        const rows = await sql.begin(async (tx) => {
          await tx.unsafe("set local role service_role");
          return tx`
            select private.lukas_drawing_insert_material_handoff(
              ${input.actorId}::uuid,${input.boqVersionId}::uuid,
              ${input.resultSha256},${input.manifestFileId}::uuid,
              ${input.manifestFileSha256},${tx.json(input.plans)}::jsonb,
              ${tx.json(input.links)}::jsonb
            ) value
          `;
        });
        if (rows.length !== 1)
          throw new DrawingQuantityLineageServerError("P6O01");
        return rows[0].value;
      } finally {
        await sql.end({ timeout: 5 });
      }
    },
  };
}

/** @internal Optional fourth argument is a server-test seam, never route input. */
export async function createP6MaterialHandoff(
  userClient: SupabaseClient,
  actorId: string,
  input: CreateP6MaterialHandoffInput,
  authority?: P6MaterialHandoffAuthority,
): Promise<{
  manifestFileId: string;
  materialPlanIds: string[];
  materialLinkIds: string[];
}> {
  const requestId = randomUUID();
  try {
    const trusted = authority ?? databaseMaterialHandoffAuthority();
    const parsed = CreateMaterialHandoffSchema.parse(input);
    Uuid.parse(actorId);
    await requireQuantityWriter(userClient, actorId, parsed.projectId);
    const approved = await trusted.loadApprovedExport(
      userClient,
      actorId,
      parsed.boqVersionId,
    );
    Sha256.parse(approved.resultSha256);
    Sha256.parse(approved.manifestSha256);
    Sha256.parse(approved.handoffSha256);
    const loaded = await trusted.loadContext(userClient, parsed);
    if (
      loaded.projectId !== parsed.projectId ||
      loaded.boqVersionId !== parsed.boqVersionId ||
      loaded.resultSha256 !== approved.resultSha256 ||
      loaded.components.length !== parsed.selectedRateComponentIds.length ||
      loaded.components.some(
        (component) =>
          !parsed.selectedRateComponentIds.includes(
            component.rateComponentId,
          ) ||
          component.boqVersionId !== parsed.boqVersionId ||
          component.resourceType !== "material" ||
          component.resourcePriceBookId !== loaded.priceBookId ||
          !positiveDecimal(component.resourceCoefficient),
      )
    )
      throw new DrawingQuantityLineageServerError("P6M01");
    const context = applyApprovedManifest(
      loaded,
      approved.manifestJson,
      approved.handoffSha256,
    );
    const { plans, links } = materialHandoffRows(
      parsed.boqVersionId,
      parsed.operationId,
      context.components,
    );
    if (!plans.length || !links.length)
      throw new DrawingQuantityLineageServerError("P6M01");
    const manifestFileSha256 = createHash("sha256")
      .update(approved.manifestJson)
      .digest("hex");
    const path = boqManifestStorageObjectPath({
      ownerId: context.ownerId,
      projectId: context.projectId,
      manifestFileSha256,
    });
    const manifestFileId = await trusted.persistManifest({
      userClient,
      actorId,
      boqVersionId: parsed.boqVersionId,
      operationId: parsed.operationId,
      ownerId: context.ownerId,
      projectId: context.projectId,
      handoffSha256: approved.handoffSha256,
      manifestFileSha256,
      bytes: approved.manifestJson,
      path,
    });
    Uuid.parse(manifestFileId);
    await trusted.insertHandoff({
      actorId,
      boqVersionId: parsed.boqVersionId,
      resultSha256: approved.resultSha256,
      manifestFileId,
      manifestFileSha256,
      plans,
      links,
    });
    return {
      manifestFileId,
      materialPlanIds: plans.map((row) => row.id),
      materialLinkIds: links.map((row) => row.id),
    };
  } catch (error) {
    const bounded = p6Error(error, requestId);
    console.error("Approved BOQ material handoff failed", {
      requestId: bounded.requestId,
      code: bounded.code,
      projectId: input.projectId,
      boqVersionId: input.boqVersionId,
      operationId: input.operationId,
    });
    throw bounded;
  }
}

export type DrawingBoqLinkRow = {
  id: string;
  projectId: string;
  quantityLinkId: string;
  boqVersionId: string;
  boqLineId: string;
  allocationFactor: string;
  version: number;
  createdBy: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
};

export type PutDrawingBoqLinkInput = {
  id: string;
  quantityLinkId: string;
  boqVersionId: string;
  boqLineId: string;
  allocationFactor: string;
  baseVersion: number | null;
};

const AllocationFactor = DecimalText.refine((value) => {
  const match = /^(\d+)(?:\.(\d+))?$/.exec(value);
  if (!match || (match[2]?.length ?? 0) > 9) return false;
  const scaled =
    BigInt(match[1]) * 1_000_000_000n + BigInt((match[2] ?? "").padEnd(9, "0"));
  return scaled > 0n && scaled <= 1_000_000_000n;
}, "배분 계수는 0보다 크고 1 이하여야 합니다.");

const PutBoqLinkSchema = z
  .object({
    id: Uuid,
    quantityLinkId: Uuid,
    boqVersionId: Uuid,
    boqLineId: Uuid,
    allocationFactor: AllocationFactor,
    baseVersion: z.number().int().positive().nullable(),
  })
  .strict();

const DrawingBoqLinkRowSchema = z
  .object({
    id: Uuid,
    project_id: Uuid,
    quantity_link_id: Uuid,
    boq_version_id: Uuid,
    boq_line_id: Uuid,
    allocation_factor: DecimalText,
    version: z.coerce.number().int().positive(),
    created_by: Uuid,
    updated_by: Uuid,
    created_at: z.string(),
    updated_at: z.string(),
  })
  .passthrough();

function drawingBoqLinkRow(input: unknown): DrawingBoqLinkRow {
  const row = DrawingBoqLinkRowSchema.parse(input);
  return {
    id: row.id,
    projectId: row.project_id,
    quantityLinkId: row.quantity_link_id,
    boqVersionId: row.boq_version_id,
    boqLineId: row.boq_line_id,
    allocationFactor: row.allocation_factor,
    version: row.version,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function putDrawingBoqLink(
  userClient: SupabaseClient,
  input: PutDrawingBoqLinkInput,
): Promise<DrawingBoqLinkRow> {
  const requestId = randomUUID();
  try {
    const parsed = PutBoqLinkSchema.parse(input);
    const { data, error } = await userClient.rpc("lukas_drawing_put_boq_link", {
      p_id: parsed.id,
      p_quantity_link_id: parsed.quantityLinkId,
      p_boq_version_id: parsed.boqVersionId,
      p_boq_line_id: parsed.boqLineId,
      p_allocation_factor: parsed.allocationFactor,
      p_base_version: parsed.baseVersion,
    });
    if (error) throw error;
    return drawingBoqLinkRow(data);
  } catch (error) {
    throw p6Error(error, requestId);
  }
}

export async function deleteDrawingBoqLink(
  userClient: SupabaseClient,
  input: { id: string; baseVersion: number },
): Promise<void> {
  const requestId = randomUUID();
  try {
    const parsed = z
      .object({ id: Uuid, baseVersion: z.number().int().positive() })
      .strict()
      .parse(input);
    const { error } = await userClient.rpc("lukas_drawing_delete_boq_link", {
      p_id: parsed.id,
      p_base_version: parsed.baseVersion,
    });
    if (error) throw error;
  } catch (error) {
    throw p6Error(error, requestId);
  }
}

const SectionInputSchema = z
  .object({
    id: Uuid,
    parentId: Uuid.nullable(),
    code: z.string().max(80),
    name: z.string().max(160),
    sortOrder: z.coerce.number().int(),
  })
  .strict();

const LineInputSchema = z
  .object({
    id: Uuid,
    sectionId: Uuid,
    section: SectionInputSchema,
    itemCode: z.string().min(1).max(80),
    itemName: z.string().max(200),
    specification: z.string().max(240),
    unit: BoqUnit,
    adjustment: DecimalText,
    reason: z.string().max(1000),
    sortOrder: z.coerce.number().int(),
  })
  .strict();

const SourceAnchorInputSchema = z
  .object({
    id: Uuid,
    sourceFileId: Uuid,
    sourceSha256: Sha256,
    sourceKind: z.enum(["pdf_region", "ifc_element"]),
    pdfPageNumber: z.coerce.number().int().positive().nullable(),
    x: FiniteNumber.nullable(),
    y: FiniteNumber.nullable(),
    width: FiniteNumber.nullable(),
    height: FiniteNumber.nullable(),
    elementId: z.string().nullable(),
    ifcGlobalId: z.string().nullable(),
    camera: z.unknown().nullable(),
    version: z.coerce.number().int().positive(),
  })
  .strict();

const DrawingSourceInputSchema = z
  .object({
    id: Uuid,
    revisionId: Uuid,
    revisionVersion: z.coerce.number().int().positive(),
    snapshotSha256: Sha256,
    objectId: Uuid,
    lineageId: Uuid,
    objectVersion: z.coerce.number().int().positive(),
    fingerprint: Sha256,
    kind: MeasurementKind,
    rawQuantity: DecimalText,
    unit: DrawingUnit,
    rule: z.literal("P4_MEASUREMENT_V1"),
    anchors: z.array(SourceAnchorInputSchema).max(200),
    issues: z.array(z.object({ id: Uuid, issueId: Uuid }).strict()).max(200),
  })
  .strict();

const DrawingLinkInputSchema = z
  .object({
    id: Uuid,
    line: Uuid,
    factor: AllocationFactor,
    version: z.coerce.number().int().positive(),
    source: DrawingSourceInputSchema,
  })
  .strict();

const LegacyMappingInputSchema = z
  .object({
    id: Uuid,
    line: Uuid,
    fileId: Uuid,
    sha256: Sha256,
    subject: z.string().min(1).max(240),
    quantity: DecimalText,
    factor: DecimalText,
    unit: BoqUnit,
    elementIds: z.array(z.string()).max(10_000),
  })
  .strict();

const LegacyExclusionInputSchema = z
  .object({
    id: Uuid,
    fileId: Uuid,
    sha256: Sha256,
    subject: z.string().min(1).max(240),
    quantity: DecimalText,
    unit: BoqUnit,
    elementIds: z.array(z.string()).max(10_000),
    reason: z.string().max(1000),
  })
  .strict();

const ResourceInputSchema = z
  .object({
    id: Uuid,
    code: z.string().min(1).max(80),
    type: z.enum(["material", "labor", "equipment", "expense"]),
    name: z.string().max(160),
    specification: z.string().max(200),
    unit: z.string().min(1).max(20),
    unitPriceKrw: DecimalText,
    priceBookId: Uuid,
  })
  .strict();

const ComponentInputSchema = z
  .object({
    id: Uuid,
    line: Uuid,
    resourceId: Uuid,
    coefficient: DecimalText,
    resource: ResourceInputSchema,
  })
  .strict();

const PriceBookInputSchema = z
  .object({
    id: Uuid,
    name: z.string().max(160),
    versionLabel: z.string().max(80),
    fileId: Uuid,
    sha256: Sha256,
    effectiveDate: z.string(),
    currency: z.string().max(10),
    rightsBasis: z.string().max(80),
    licenseNote: z.string().max(1000),
  })
  .strict();

const VerifiedBoqV1_1DatabaseInputSchema = z
  .object({
    versionId: Uuid,
    projectId: Uuid,
    engineVersion: z.literal("VERIFIED-BOQ-1.1"),
    calculationPolicy: z.enum(["general_half_away", "ems_component_truncate"]),
    quantityScale: z.coerce.number().int().min(0).max(9),
    lines: z.array(LineInputSchema).max(5_000),
    drawingLinks: z.array(DrawingLinkInputSchema).max(10_000),
    legacyMappings: z.array(LegacyMappingInputSchema).max(10_000),
    legacyExclusions: z.array(LegacyExclusionInputSchema).max(10_000),
    components: z.array(ComponentInputSchema).max(10_000),
    priceBook: PriceBookInputSchema,
  })
  .strict();

const VerifiedBoqV1_1RpcSchema = z
  .object({
    inputStateSha256: Sha256,
    input: VerifiedBoqV1_1DatabaseInputSchema,
  })
  .strict();

export function parseVerifiedBoqV1_1RpcInput(value: unknown): {
  projectId: string;
  inputStateSha256: string;
  input: VerifiedBoqV1_1Input;
  databaseInput: z.infer<typeof VerifiedBoqV1_1DatabaseInputSchema>;
} {
  try {
    const parsed = VerifiedBoqV1_1RpcSchema.parse(value);
    const resources = new Map<string, z.infer<typeof ResourceInputSchema>>();
    for (const line of parsed.input.lines)
      if (line.sectionId !== line.section.id)
        throw new DrawingQuantityLineageServerError("P6B04");
    for (const component of parsed.input.components) {
      if (
        component.resourceId !== component.resource.id ||
        component.resource.priceBookId !== parsed.input.priceBook.id
      )
        throw new DrawingQuantityLineageServerError("P6B04");
      const prior = resources.get(component.resource.id);
      if (prior && JSON.stringify(prior) !== JSON.stringify(component.resource))
        throw new DrawingQuantityLineageServerError("P6B04");
      resources.set(component.resource.id, component.resource);
    }
    return {
      projectId: parsed.input.projectId,
      inputStateSha256: parsed.inputStateSha256,
      databaseInput: parsed.input,
      input: {
        engineVersion: "VERIFIED-BOQ-1.1",
        versionId: parsed.input.versionId,
        calculationPolicy: parsed.input.calculationPolicy,
        quantityScale: parsed.input.quantityScale,
        lines: parsed.input.lines.map((line) => ({
          id: line.id,
          sectionCode: line.section.code,
          itemCode: line.itemCode,
          itemName: line.itemName,
          specification: line.specification,
          unit: line.unit,
          signedAdjustment: line.adjustment,
          adjustmentReason: line.reason,
        })),
        legacyMappings: parsed.input.legacyMappings.map((row) => ({
          id: row.id,
          lineId: row.line,
          sourceFileId: row.fileId,
          sourceSha256: row.sha256,
          subjectKey: row.subject,
          sourceQuantity: row.quantity,
          factor: row.factor,
          unit: row.unit,
          elementIds: row.elementIds,
        })),
        drawingMappings: parsed.input.drawingLinks.map((row) => ({
          id: row.id,
          lineId: row.line,
          quantityLinkId: row.source.id,
          allocationFactor: row.factor,
          source: {
            quantityLinkId: row.source.id,
            revisionId: row.source.revisionId,
            revisionVersion: row.source.revisionVersion,
            snapshotSha256: row.source.snapshotSha256,
            objectId: row.source.objectId,
            lineageId: row.source.lineageId,
            objectVersion: row.source.objectVersion,
            objectFingerprint: row.source.fingerprint,
            measurementKind: row.source.kind,
            rawQuantity: row.source.rawQuantity,
            unit: row.source.unit,
            measurementRuleVersion: row.source.rule,
            sourceAnchors: row.source.anchors.map((anchor) => ({
              sourceFileId: anchor.sourceFileId,
              sourceSha256: anchor.sourceSha256,
              sourceKind: anchor.sourceKind,
              pdfRegion:
                anchor.sourceKind === "pdf_region" &&
                anchor.pdfPageNumber !== null &&
                anchor.x !== null &&
                anchor.y !== null &&
                anchor.width !== null &&
                anchor.height !== null
                  ? {
                      pageNumber: anchor.pdfPageNumber,
                      x: anchor.x,
                      y: anchor.y,
                      width: anchor.width,
                      height: anchor.height,
                    }
                  : null,
              ifcGlobalId:
                anchor.sourceKind === "ifc_element" ? anchor.ifcGlobalId : null,
            })),
            issueLinks: row.source.issues.map((issue) => ({
              issueId: issue.issueId,
            })),
          },
        })),
        priceBook: {
          id: parsed.input.priceBook.id,
          sourceFileId: parsed.input.priceBook.fileId,
          sourceSha256: parsed.input.priceBook.sha256,
          effectiveDate: parsed.input.priceBook.effectiveDate,
          rightsBasis: parsed.input.priceBook.rightsBasis,
        },
        exclusions: parsed.input.legacyExclusions.map((row) => ({
          id: row.id,
          sourceFileId: row.fileId,
          sourceSha256: row.sha256,
          subjectKey: row.subject,
          sourceQuantity: row.quantity,
          unit: row.unit,
          elementIds: row.elementIds,
          reason: row.reason,
        })),
        resources: [...resources.values()].map((row) => ({
          id: row.id,
          code: row.code,
          type: row.type,
          unit: row.unit,
          unitPriceKrw: row.unitPriceKrw,
        })),
        components: parsed.input.components.map((row) => ({
          id: row.id,
          lineId: row.line,
          resourceId: row.resourceId,
          coefficient: row.coefficient,
        })),
      },
    };
  } catch {
    throw new DrawingQuantityLineageServerError("P6B04");
  }
}

type FreezeArgs = {
  actorId: string;
  versionId: string;
  inputStateSha256: string;
  resultSha256: string;
  manifestSha256: string;
  directCostKrw: string;
  lineCount: number;
};

/** @internal Optional authority is a server-test seam, never request input. */
export type VerifiedBoqFreezeAuthority = {
  finalize(args: FreezeArgs, isStaff?: boolean): Promise<unknown>;
  loadFrozenInput(versionId: string): Promise<unknown>;
};

async function requireAuthenticatedActor(
  client: SupabaseClient,
  actorId: string,
) {
  const parsedActor = Uuid.parse(actorId);
  const { data, error } = await client.auth.getUser();
  if (
    error ||
    !data.user ||
    data.user.is_anonymous ||
    data.user.id !== parsedActor
  )
    throw new DrawingQuantityLineageServerError("P6A01");
  return {
    actorId: parsedActor,
    isStaff: data.user.app_metadata.role === "hangil_staff",
  };
}

async function requireVerifiedReviewer(
  client: SupabaseClient,
  actor: { actorId: string; isStaff: boolean },
  projectId: string,
) {
  const { data: project, error: projectError } = await client
    .from("lukas_qto_projects")
    .select("id,owner_id")
    .eq("id", Uuid.parse(projectId))
    .single();
  if (projectError || !project)
    throw new DrawingQuantityLineageServerError("P6A01");
  if (actor.isStaff || project.owner_id === actor.actorId) return;
  const { data: member, error: memberError } = await client
    .from("lukas_qto_project_members")
    .select("role")
    .eq("project_id", projectId)
    .eq("user_id", actor.actorId)
    .maybeSingle();
  if (memberError || member?.role !== "reviewer")
    throw new DrawingQuantityLineageServerError("P6A01");
}

function calculateFrozenInput(
  parsed: ReturnType<typeof parseVerifiedBoqV1_1RpcInput>,
) {
  const result = calculateVerifiedBoqV1_1(parsed.input);
  if (result.status !== "calculated" || result.lines.length === 0)
    throw new DrawingQuantityLineageServerError("P6B04");
  const manifest = buildVerifiedBoqCalculationManifest(parsed.input, result, {
    projectId: parsed.projectId,
    inputStateSha256: parsed.inputStateSha256,
  });
  return { result, manifest };
}

export async function submitVerifiedBoqV1_1(
  userClient: SupabaseClient,
  actorId: string,
  versionId: string,
  authority?: VerifiedBoqFreezeAuthority,
): Promise<{ resultSha256: string; manifestSha256: string }> {
  const requestId = randomUUID();
  try {
    const actor = await requireAuthenticatedActor(userClient, actorId);
    const parsedVersionId = Uuid.parse(versionId);
    const { data, error } = await userClient.rpc("lukas_qto_boq_v1_1_input", {
      p_version_id: parsedVersionId,
    });
    if (error) throw error;
    const parsed = parseVerifiedBoqV1_1RpcInput(data);
    if (parsed.input.versionId !== parsedVersionId)
      throw new DrawingQuantityLineageServerError("P6O01");
    const { result, manifest } = calculateFrozenInput(parsed);
    await (authority ?? databaseFreezeAuthority()).finalize(
      {
        actorId: actor.actorId,
        versionId: parsedVersionId,
        inputStateSha256: parsed.inputStateSha256,
        resultSha256: result.canonicalSha256,
        manifestSha256: manifest.manifestSha256,
        directCostKrw: result.directCostKrw,
        lineCount: result.lines.length,
      },
      actor.isStaff,
    );
    return {
      resultSha256: result.canonicalSha256,
      manifestSha256: manifest.manifestSha256,
    };
  } catch (error) {
    throw p6Error(error, requestId);
  }
}

export async function recheckAndDecideVerifiedBoqV1_1(
  userClient: SupabaseClient,
  actorId: string,
  input: {
    versionId: string;
    decision: "approved" | "rejected" | "deferred";
    note: string;
  },
  authority?: VerifiedBoqFreezeAuthority,
): Promise<void> {
  const requestId = randomUUID();
  try {
    const actor = await requireAuthenticatedActor(userClient, actorId);
    const parsed = z
      .object({
        versionId: Uuid,
        decision: z.enum(["approved", "rejected", "deferred"]),
        note: z.string().max(2000),
      })
      .strict()
      .parse(input);
    const { data: version, error: versionError } = await userClient
      .from("lukas_qto_boq_versions")
      .select(
        "id,project_id,created_by,status,engine_version,input_state_sha256,result_sha256,manifest_sha256",
      )
      .eq("id", parsed.versionId)
      .single();
    if (
      versionError ||
      !version ||
      version.status !== "in_review" ||
      version.engine_version !== "VERIFIED-BOQ-1.1" ||
      version.created_by === actor.actorId
    )
      throw new DrawingQuantityLineageServerError("P6A01");
    await requireVerifiedReviewer(userClient, actor, version.project_id);
    const frozen = parseVerifiedBoqV1_1RpcInput(
      await (authority ?? databaseFreezeAuthority()).loadFrozenInput(
        parsed.versionId,
      ),
    );
    if (
      frozen.projectId !== version.project_id ||
      frozen.input.versionId !== parsed.versionId ||
      frozen.inputStateSha256 !== version.input_state_sha256
    )
      throw new DrawingQuantityLineageServerError("P6C01");
    const { result, manifest } = calculateFrozenInput(frozen);
    if (
      result.canonicalSha256 !== version.result_sha256 ||
      manifest.manifestSha256 !== version.manifest_sha256
    )
      throw new DrawingQuantityLineageServerError("P6C01");
    const { error } = await userClient.rpc("lukas_qto_decide_boq", {
      p_version_id: parsed.versionId,
      p_decision: parsed.decision,
      p_note: parsed.note,
    });
    if (error) throw error;
  } catch (error) {
    throw p6Error(error, requestId);
  }
}

export async function loadVerifiedBoqV1_1Calculation(
  userClient: SupabaseClient,
  actorId: string,
  versionId: string,
  authority?: VerifiedBoqFreezeAuthority,
) {
  const requestId = randomUUID();
  try {
    const actor = await requireAuthenticatedActor(userClient, actorId);
    const parsedVersionId = Uuid.parse(versionId);
    const { data: version, error: versionError } = await userClient
      .from("lukas_qto_boq_versions")
      .select(
        "id,project_id,status,created_by,engine_version,input_state_sha256,result_sha256,manifest_sha256",
      )
      .eq("id", parsedVersionId)
      .single();
    if (
      versionError ||
      !version ||
      version.engine_version !== "VERIFIED-BOQ-1.1"
    )
      throw new DrawingQuantityLineageServerError("P6A01");
    let payload: unknown;
    if (version.status === "draft" && version.created_by === actor.actorId) {
      const { data, error } = await userClient.rpc("lukas_qto_boq_v1_1_input", {
        p_version_id: parsedVersionId,
      });
      if (error) throw error;
      payload = data;
    } else {
      payload = await (authority ?? databaseFreezeAuthority()).loadFrozenInput(
        parsedVersionId,
      );
    }
    const parsed = parseVerifiedBoqV1_1RpcInput(payload);
    if (
      parsed.projectId !== version.project_id ||
      parsed.input.versionId !== parsedVersionId
    )
      throw new DrawingQuantityLineageServerError("P6C01");
    const calculated = calculateFrozenInput(parsed);
    return {
      ...calculated,
      parsed,
      stored: {
        inputStateSha256: version.input_state_sha256 as string | null,
        resultSha256: version.result_sha256 as string | null,
        manifestSha256: version.manifest_sha256 as string | null,
      },
    };
  } catch (error) {
    throw p6Error(error, requestId);
  }
}

export type VerifiedBoqDrawingSourceRow = {
  quantity: DrawingQuantityLinkRow;
  allocationTotal: string;
  links: Array<
    DrawingBoqLinkRow & {
      workspaceHref: string | null;
      evidenceHrefs: Array<{
        href: string;
        sourceFileId: string;
        sourceKind: "pdf_region" | "ifc_element";
      }>;
    }
  >;
};

export async function listVerifiedBoqDrawingSources(
  userClient: SupabaseClient,
  input: { projectId: string; boqVersionId: string; limit?: number },
): Promise<{ rows: VerifiedBoqDrawingSourceRow[]; hasMore: boolean }> {
  const projectId = Uuid.parse(input.projectId);
  const boqVersionId = Uuid.parse(input.boqVersionId);
  const limit = Math.min(200, Math.max(1, input.limit ?? 200));
  const { data: linkData, error: linkError } = await userClient
    .from("lukas_drawing_boq_links")
    .select("*")
    .eq("project_id", projectId)
    .eq("boq_version_id", boqVersionId)
    .order("id", { ascending: true })
    .limit(201);
  if (linkError) throw new DrawingQuantityLineageServerError("P6A01");
  if ((linkData?.length ?? 0) > 200)
    throw new DrawingQuantityLineageServerError("P6B04");
  const rawLinks = (linkData ?? []).map(drawingBoqLinkRow);
  const mappedQuantityIds = [
    ...new Set(rawLinks.map((link) => link.quantityLinkId)),
  ];
  const { data: mappedData, error: mappedError } = mappedQuantityIds.length
    ? await userClient
        .from("lukas_drawing_quantity_links")
        .select("*")
        .eq("project_id", projectId)
        .in("id", mappedQuantityIds)
        .limit(201)
    : { data: [], error: null };
  if (mappedError || (mappedData?.length ?? 0) !== mappedQuantityIds.length)
    throw new DrawingQuantityLineageServerError("P6A01");
  const mappedById = new Map(
    (mappedData ?? []).map(quantityRow).map((row) => [row.id, row]),
  );
  if (mappedQuantityIds.some((id) => !mappedById.has(id)))
    throw new DrawingQuantityLineageServerError("P6A01");
  const mappedQuantities = mappedQuantityIds.map(
    (id) => mappedById.get(id) as DrawingQuantityLinkRow,
  );
  const { data: recentData, error: recentError } = await userClient
    .from("lukas_drawing_quantity_links")
    .select("*")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(201);
  if (recentError) throw new DrawingQuantityLineageServerError("P6A01");
  const mappedIds = new Set(mappedQuantityIds);
  const recentUnmapped = (recentData ?? [])
    .map(quantityRow)
    .filter((row) => !mappedIds.has(row.id));
  const remaining = Math.max(0, limit - mappedQuantities.length);
  const quantities = [
    ...mappedQuantities,
    ...recentUnmapped.slice(0, remaining),
  ];
  let links: VerifiedBoqDrawingSourceRow["links"] = [];
  if (rawLinks.length) {
    const linkedQuantityIds = new Set(
      rawLinks.map((link) => link.quantityLinkId),
    );
    const linkedQuantities = quantities.filter((row) =>
      linkedQuantityIds.has(row.id),
    );
    const revisionIds = [
      ...new Set(linkedQuantities.map((row) => row.drawingRevisionId)),
    ];
    const { data: revisionData, error: revisionError } = revisionIds.length
      ? await userClient
          .from("lukas_drawing_revisions")
          .select("id,document_id")
          .eq("project_id", projectId)
          .in("id", revisionIds)
          .limit(200)
      : { data: [], error: null };
    if (revisionError) throw new DrawingQuantityLineageServerError("P6A01");
    const revisions = new Map(
      (revisionData ?? []).map((row) => [
        String(row.id),
        String(row.document_id),
      ]),
    );
    const documentIds = [...new Set(revisions.values())];
    const { data: documentData, error: documentError } = documentIds.length
      ? await userClient
          .from("lukas_drawing_documents")
          .select("id,source_file_id")
          .eq("project_id", projectId)
          .in("id", documentIds)
          .limit(200)
      : { data: [], error: null };
    if (documentError) throw new DrawingQuantityLineageServerError("P6A01");
    const documents = new Map(
      (documentData ?? []).map((row) => [
        String(row.id),
        row.source_file_id ? String(row.source_file_id) : null,
      ]),
    );
    if (documentIds.some((id) => !documents.has(id)))
      throw new DrawingQuantityLineageServerError("P6A01");
    const { data: sourceData, error: sourceError } = linkedQuantities.length
      ? await userClient
          .from("lukas_drawing_object_sources")
          .select("revision_id,object_id,source_file_id,source_kind")
          .eq("project_id", projectId)
          .eq("status", "active")
          .in(
            "revision_id",
            linkedQuantities.map((row) => row.drawingRevisionId),
          )
          .in(
            "object_id",
            linkedQuantities.map((row) => row.drawingObjectId),
          )
          .order("source_file_id", { ascending: true })
          .limit(401)
      : { data: [], error: null };
    if (sourceError || (sourceData?.length ?? 0) > 400)
      throw new DrawingQuantityLineageServerError("P6B04");
    const sourceFiles = new Map<
      string,
      Map<string, "pdf_region" | "ifc_element">
    >();
    for (const row of sourceData ?? []) {
      const key = `${String(row.revision_id)}:${String(row.object_id)}`;
      const values = sourceFiles.get(key) ?? new Map();
      const sourceKind = String(row.source_kind);
      if (sourceKind !== "pdf_region" && sourceKind !== "ifc_element")
        throw new DrawingQuantityLineageServerError("P6B04");
      const sourceFileId = String(row.source_file_id);
      if (values.has(sourceFileId) && values.get(sourceFileId) !== sourceKind)
        throw new DrawingQuantityLineageServerError("P6B04");
      values.set(sourceFileId, sourceKind);
      sourceFiles.set(key, values);
    }
    const evidenceByQuantity = new Map<
      string,
      Map<string, "pdf_region" | "ifc_element">
    >();
    for (const quantity of linkedQuantities) {
      const evidence = sourceFiles.get(
        `${quantity.drawingRevisionId}:${quantity.drawingObjectId}`,
      );
      if (evidence?.size) evidenceByQuantity.set(quantity.id, evidence);
    }
    const entryFileByQuantity = new Map<string, string>();
    for (const quantity of linkedQuantities) {
      const documentId = revisions.get(quantity.drawingRevisionId);
      const documentFileId = documentId ? documents.get(documentId) : null;
      const evidence = evidenceByQuantity.get(quantity.id);
      const fallback = evidence?.size === 1 ? [...evidence.keys()][0] : null;
      const entryFileId = documentFileId ?? fallback;
      if (entryFileId) entryFileByQuantity.set(quantity.id, entryFileId);
    }
    const fileIds = [
      ...new Set([
        ...entryFileByQuantity.values(),
        ...[...evidenceByQuantity.values()].flatMap((rows) => [...rows.keys()]),
      ]),
    ];
    const { data: fileData, error: fileError } = fileIds.length
      ? await userClient
          .from("lukas_qto_files")
          .select("id,kind")
          .eq("project_id", projectId)
          .eq("immutable", true)
          .in("kind", ["pdf", "ifc"])
          .in("id", fileIds)
          .limit(601)
      : { data: [], error: null };
    if (fileError) throw new DrawingQuantityLineageServerError("P6A01");
    const validFiles = new Map(
      (fileData ?? []).map((row) => [String(row.id), String(row.kind)]),
    );
    if (fileIds.some((fileId) => !validFiles.has(fileId)))
      throw new DrawingQuantityLineageServerError("P6A01");
    const quantityById = new Map(quantities.map((row) => [row.id, row]));
    links = rawLinks.map((link) => {
      const quantity = quantityById.get(link.quantityLinkId);
      const documentId = quantity
        ? revisions.get(quantity.drawingRevisionId)
        : null;
      const evidence = evidenceByQuantity.get(link.quantityLinkId);
      const entryFileId = entryFileByQuantity.get(link.quantityLinkId);
      if (
        !quantity ||
        !documentId ||
        !evidence ||
        !entryFileId ||
        !validFiles.has(entryFileId)
      )
        return { ...link, workspaceHref: null, evidenceHrefs: [] };
      const evidenceHrefs = [...evidence].map(([fileId, sourceKind]) => {
        if (
          validFiles.get(fileId) !==
          (sourceKind === "ifc_element" ? "ifc" : "pdf")
        )
          throw new DrawingQuantityLineageServerError("P6B04");
        const search = new URLSearchParams({
          document: documentId,
          revision: quantity.drawingRevisionId,
          object: quantity.drawingObjectId,
          boq: link.boqVersionId,
          line: link.boqLineId,
          evidence: fileId,
          view: sourceKind === "ifc_element" ? "split" : "2d",
        });
        if (sourceKind === "ifc_element") search.set("ifc", fileId);
        return {
          href: `/projects/${projectId}/drawings/${entryFileId}/workspace?${search}`,
          sourceFileId: fileId,
          sourceKind,
        };
      });
      return {
        ...link,
        workspaceHref:
          evidenceHrefs.length === 1 ? evidenceHrefs[0].href : null,
        evidenceHrefs,
      };
    });
  }
  return {
    rows: quantities.map((quantity) => {
      const sourceLinks = links.filter(
        (link) => link.quantityLinkId === quantity.id,
      );
      const allocationTotal = sourceLinks.reduce(
        (total, link) =>
          total + allocationFactorBillionths(link.allocationFactor),
        0n,
      );
      return {
        quantity,
        allocationTotal: allocationFactorText(allocationTotal),
        links: sourceLinks,
      };
    }),
    hasMore: recentUnmapped.length > remaining,
  };
}

function allocationFactorBillionths(value: string) {
  const match = /^(\d+)(?:\.(\d+))?$/.exec(value);
  if (!match) throw new DrawingQuantityLineageServerError("P6B04");
  return (
    BigInt(match[1]) * 1_000_000_000n + BigInt((match[2] ?? "").padEnd(9, "0"))
  );
}

function allocationFactorText(value: bigint) {
  const whole = value / 1_000_000_000n;
  const fraction = (value % 1_000_000_000n)
    .toString()
    .padStart(9, "0")
    .replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

function databaseFreezeAuthority(): VerifiedBoqFreezeAuthority {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new DrawingQuantityLineageServerError("P6C01");
  return {
    async finalize(args, isStaff = false) {
      const sql = postgres(databaseUrl, { max: 1, prepare: false });
      try {
        return await sql.begin(async (tx) => {
          await tx.unsafe("set local role service_role");
          await tx`
            select pg_catalog.set_config('request.jwt.claim.sub',${args.actorId},true),
              pg_catalog.set_config('request.jwt.claims',${JSON.stringify({
                sub: args.actorId,
                is_anonymous: false,
                app_metadata: isStaff ? { role: "hangil_staff" } : {},
              })},true)
          `;
          const rows = await tx`
            select private.lukas_qto_finalize_boq_v1_1(
              ${args.actorId}::uuid,${args.versionId}::uuid,
              ${args.inputStateSha256},${args.resultSha256},
              ${args.manifestSha256},${args.directCostKrw}::numeric,
              ${args.lineCount}::integer
            ) value
          `;
          if (rows.length !== 1)
            throw new DrawingQuantityLineageServerError("P6O01");
          return rows[0].value;
        });
      } finally {
        await sql.end({ timeout: 5 });
      }
    },
    async loadFrozenInput(versionId) {
      const sql = postgres(databaseUrl, { max: 1, prepare: false });
      try {
        const rows = await sql`
          select pg_catalog.jsonb_build_object(
            'input',private.lukas_drawing_p6_input_state(v.id),
            'inputStateSha256',private.lukas_drawing_p6_input_sha256(v.id)
          ) value
          from public.lukas_qto_boq_versions v
          where v.id=${Uuid.parse(versionId)}::uuid
        `;
        if (rows.length !== 1)
          throw new DrawingQuantityLineageServerError("P6C01");
        return rows[0].value;
      } finally {
        await sql.end({ timeout: 5 });
      }
    },
  };
}

function formObject(form: FormData) {
  const result: Record<string, FormDataEntryValue> = {};
  for (const [key, value] of form) {
    if (key in result) throw new DrawingQuantityLineageServerError("P6B04");
    result[key] = value;
  }
  return result;
}

function assertFormKeys(
  values: Record<string, FormDataEntryValue>,
  allowed: readonly string[],
) {
  if (Object.keys(values).some((key) => !allowed.includes(key)))
    throw new Error("허용되지 않은 필드가 포함되어 있습니다.");
}

export function parseDrawingBoqMutationForm(form: FormData) {
  const values = formObject(form);
  const intent = z
    .enum(["drawing_boq_put", "drawing_boq_delete", "submit", "decision"])
    .parse(values.intent);
  if (intent === "drawing_boq_put") {
    assertFormKeys(values, [
      "intent",
      "id",
      "quantity_link_id",
      "version_id",
      "line_id",
      "allocation_factor",
      "base_version",
    ]);
    const base =
      values.base_version === "" ? null : Number(values.base_version);
    return {
      intent,
      ...PutBoqLinkSchema.parse({
        id: values.id,
        quantityLinkId: values.quantity_link_id,
        boqVersionId: values.version_id,
        boqLineId: values.line_id,
        allocationFactor: values.allocation_factor,
        baseVersion: base,
      }),
    };
  }
  if (intent === "drawing_boq_delete") {
    assertFormKeys(values, ["intent", "id", "base_version"]);
    return {
      intent,
      ...z
        .object({ id: Uuid, baseVersion: z.number().int().positive() })
        .parse({ id: values.id, baseVersion: Number(values.base_version) }),
    };
  }
  if (intent === "submit") {
    assertFormKeys(values, ["intent", "version_id"]);
    return { intent, versionId: Uuid.parse(values.version_id) };
  }
  assertFormKeys(values, ["intent", "version_id", "decision", "note"]);
  return {
    intent,
    versionId: Uuid.parse(values.version_id),
    decision: z
      .enum(["approved", "rejected", "deferred"])
      .parse(values.decision),
    note: z
      .string()
      .max(2000)
      .parse(values.note ?? ""),
  };
}

export function drawingQuantityLineageErrorResponse(error: unknown) {
  const bounded = p6Error(error, randomUUID());
  return {
    status:
      bounded.code === "P6A01" ? 403 : bounded.code === "P6O01" ? 409 : 422,
    body: {
      ok: false as const,
      kind: "drawing_quantity_link" as const,
      error: bounded.message,
      errorCode: bounded.code,
      requestId: bounded.requestId,
    },
  };
}
