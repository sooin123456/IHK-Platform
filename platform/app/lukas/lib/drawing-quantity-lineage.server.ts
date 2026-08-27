import type { SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { z } from "zod";

import {
  convertDrawingMeasurement,
  drawingObjectFingerprintSha256,
  P6_MEASUREMENT_RULE_VERSION,
  type DrawingQuantityMeasurementKind,
  type DrawingQuantityUnit,
} from "./drawing-quantity-lineage.ts";
import {
  deriveAuthorizedDrawingMeasurementEvidence,
  parseDrawingWorkspaceCollaborationBootstrap,
  resolveDrawingDocumentEntry,
  type DrawingWorkspaceClient,
} from "./drawing-workspace.server.ts";
import {
  DrawingObjectSchema,
  DrawingObjectSourceSchema,
} from "./drawing-workspace.types.ts";

const Uuid = z.string().uuid();
const Sha256 = z.string().regex(/^[0-9a-f]{64}$/);
const MeasurementKind = z.enum(["length", "area", "count"]);
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
  const code =
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    P6Codes.includes(error.code as P6LineageErrorCode)
      ? (error.code as P6LineageErrorCode)
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
  const quantities = (data ?? []).slice(0, limit).map(quantityRow);
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
      (data?.length ?? 0) > limit && quantities.length
        ? encodeCursor(quantities.at(-1)!)
        : null,
  };
}

async function exactRow(
  client: SupabaseClient,
  table: string,
  select: string,
  filters: Array<[string, string]>,
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
  },
): Promise<string> {
  try {
    const parsed = {
      projectId: Uuid.parse(input.projectId),
      revisionId: Uuid.parse(input.revisionId),
      objectId: Uuid.parse(input.objectId),
      boqVersionId: Uuid.parse(input.boqVersionId),
      boqLineId: Uuid.parse(input.boqLineId),
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
    ]);
    const entry = await resolveDrawingDocumentEntry(
      userClient as unknown as DrawingWorkspaceClient,
      parsed.projectId,
      Uuid.parse(revision.document_id),
      parsed.objectId,
    );
    const search = new URLSearchParams({
      document: entry.documentId,
      revision: parsed.revisionId,
      object: parsed.objectId,
      boq: parsed.boqVersionId,
      line: parsed.boqLineId,
    });
    return `/projects/${parsed.projectId}/drawings/${entry.fileId}/workspace?${search}`;
  } catch {
    throw new Error("연결된 도면 근거를 열 수 없습니다.");
  }
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
