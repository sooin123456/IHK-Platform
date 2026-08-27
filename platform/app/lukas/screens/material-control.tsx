import type { Route } from "./+types/material-control";

import { createHash, randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "database.types";
import {
  ArrowLeft,
  Boxes,
  Calculator,
  Factory,
  FileCheck2,
  Truck,
} from "lucide-react";
import { Form, Link, data, redirect } from "react-router";
import { z } from "zod";

import { Button } from "~/core/components/ui/button";
import { Input } from "~/core/components/ui/input";
import { Label } from "~/core/components/ui/label";
import makeServerClient from "~/core/lib/supa-client.server";
import { storageObjectPath } from "~/lukas/lib/storage-object-key.server";
import { ProjectWorkspaceNav } from "~/lukas/components/project-workspace-nav";
import { MaterialBoqLineage } from "~/lukas/components/material-boq-lineage";
import { verifyConcreteTakeoffBundle } from "~/lukas/lib/concrete-takeoff-artifact.server";
import {
  buildMaterialControlSummaries,
  calculateRequiredQuantity,
  carbonFactorRow,
  deriveMaterialPlansFromApprovedTakeoff,
  listMaterialBoqLineage,
  materialPlanRow,
  materialTransactionRow,
} from "~/lukas/lib/material-control.server";
import {
  createP6MaterialHandoff,
  parseP6MaterialHandoffForm,
} from "~/lukas/lib/drawing-quantity-lineage.server";

type SourceFile = {
  id: string;
  kind: string;
  original_filename: string;
  sha256: string;
};
type PlanRow = {
  id: string;
  material_code: string;
  material_name: string;
  specification: string;
  unit: string;
  design_quantity: string | number;
  allowance_rate: string | number;
  required_quantity: string | number;
  rule_id: string;
  baseline_factor_id: string | null;
  source_sha256: string;
  required_by: string | null;
  source_artifact_id: string | null;
  source_group_key: string | null;
  created_at: string;
};
type TakeoffArtifactRow = {
  id: string;
  report_file_id: string;
  manifest_file_id: string;
  report_sha256: string;
  manifest_sha256: string;
  row_count: number;
  input_sha256: unknown;
  status_counts: unknown;
  created_at: string;
};
type TakeoffApprovalRow = {
  id: string;
  artifact_id: string;
  decision: "approved" | "rejected" | "deferred";
  decision_sequence: number;
  created_at: string;
};
type TakeoffFileRow = {
  id: string;
  original_filename: string;
  storage_path: string;
  sha256: string;
  byte_size: number;
};
type FactorRow = {
  id: string;
  material_code: string;
  product_name: string;
  manufacturer: string;
  declared_unit: string;
  gwp_a1_a3_per_unit: string | number;
  source_type: "product_epd" | "industry_average" | "generic";
  standard: string;
  epd_program_operator: string;
  epd_declaration_number: string;
  epd_verifier: string;
  pcr_reference: string;
  source_sha256: string;
  valid_until: string | null;
  created_at: string;
};
type TransactionRow = {
  id: string;
  material_plan_id: string;
  transaction_type:
    | "purchase_order"
    | "goods_receipt"
    | "invoice_evidence"
    | "installation"
    | "return_to_supplier"
    | "waste_disposal";
  document_number: string;
  supplier_name: string;
  occurred_on: string;
  quantity: string | number;
  unit_price_krw: string | number | null;
  amount_krw: string | number | null;
  related_order_id: string | null;
  carbon_factor_id: string | null;
  evidence_sha256: string | null;
  received_by_name: string;
  event_location: string;
  created_at: string;
};
type Table<Row, Insert> = {
  Row: Row;
  Insert: Insert;
  Update: Partial<Insert>;
  Relationships: [];
};
type FactorInsert = Omit<FactorRow, "id" | "created_at"> & {
  id?: string;
  project_id: string;
  geography: string;
  valid_from: string | null;
  source_file_id: string;
  source_sha256: string;
  created_by: string;
  created_at?: string;
};
type PlanInsert = Omit<
  PlanRow,
  "id" | "created_at" | "source_artifact_id" | "source_group_key"
> & {
  id?: string;
  project_id: string;
  source_file_id: string;
  source_sha256: string;
  source_artifact_id?: string | null;
  source_group_key?: string | null;
  created_by: string;
  created_at?: string;
};
type TransactionInsert = Omit<TransactionRow, "id" | "created_at"> & {
  id?: string;
  project_id: string;
  carbon_factor_id: string | null;
  evidence_file_id: string | null;
  evidence_sha256: string | null;
  site_acknowledgement: boolean;
  note: string;
  created_by: string;
  created_at?: string;
};
type DrawingMaterialLinkRow = {
  boq_rate_component_id: string;
  project_id: string;
  boq_version_id: string;
};
type MaterialDatabase = Omit<Database, "public"> & {
  public: Omit<Database["public"], "Tables"> & {
    Tables: Omit<
      Database["public"]["Tables"],
      | "lukas_qto_carbon_factors"
      | "lukas_drawing_material_links"
      | "lukas_qto_material_plans"
      | "lukas_qto_material_transactions"
    > & {
      lukas_qto_carbon_factors: Table<FactorRow & FactorInsert, FactorInsert>;
      lukas_drawing_material_links: Table<DrawingMaterialLinkRow, never>;
      lukas_qto_material_plans: Table<PlanRow & PlanInsert, PlanInsert>;
      lukas_qto_material_transactions: Table<
        TransactionRow & TransactionInsert,
        TransactionInsert
      >;
    };
  };
};
type Db = SupabaseClient<MaterialDatabase>;

const units = ["m3", "kg", "t", "m2", "m", "EA"] as const;
const shaPattern = /^[0-9a-f]{64}$/;
const maxEvidenceBytes = 20 * 1024 * 1024;
const evidenceMimeTypes = new Set([
  "image/jpeg",
  "image/png",
  "application/pdf",
  "text/csv",
]);
const optionalUuid = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().uuid().optional(),
);
const optionalDate = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
);
const optionalKrw = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().regex(/^\d+$/).optional(),
);

const planSchema = z.object({
  material_code: z.string().trim().min(1).max(80),
  material_name: z.string().trim().min(1).max(160),
  specification: z.string().trim().min(1).max(200),
  unit: z.enum(units),
  design_quantity: z.string().regex(/^\d+(?:\.\d{1,6})?$/),
  allowance_rate: z.string().regex(/^\d+(?:\.\d{1,6})?$/),
  rule_id: z.string().trim().min(1).max(120),
  required_by: optionalDate,
  source_file_id: z.string().uuid(),
  baseline_factor_id: optionalUuid,
});
const factorSchema = z
  .object({
    material_code: z.string().trim().min(1).max(80),
    product_name: z.string().trim().min(1).max(200),
    manufacturer: z.string().trim().max(160),
    declared_unit: z.enum(units),
    gwp_a1_a3_per_unit: z.string().regex(/^\d+(?:\.\d{1,6})?$/),
    source_type: z.enum(["product_epd", "industry_average", "generic"]),
    standard: z.string().trim().min(1).max(160),
    epd_program_operator: z.string().trim().max(200),
    epd_declaration_number: z.string().trim().max(160),
    epd_verifier: z.string().trim().max(200),
    pcr_reference: z.string().trim().max(200),
    geography: z.string().trim().max(120),
    valid_from: optionalDate,
    valid_until: optionalDate,
    source_file_id: z.string().uuid(),
  })
  .superRefine((value, context) => {
    if (
      value.source_type === "product_epd" &&
      (!value.manufacturer ||
        !value.epd_program_operator ||
        !value.epd_declaration_number ||
        !value.epd_verifier ||
        !value.pcr_reference ||
        !value.valid_until)
    )
      context.addIssue({
        code: "custom",
        message:
          "제품별 EPD는 제조사·운영기관·선언번호·검증자·PCR·만료일이 필요합니다.",
      });
  });
const transactionSchema = z.object({
  transaction_type: z.enum([
    "purchase_order",
    "goods_receipt",
    "invoice_evidence",
    "installation",
    "return_to_supplier",
    "waste_disposal",
  ]),
  material_plan_id: z.string().uuid(),
  document_number: z.string().trim().min(1).max(120),
  supplier_name: z.string().trim().min(1).max(160),
  occurred_on: z.string().min(10).max(10),
  quantity: z.string().regex(/^\d+(?:\.\d{1,6})?$/),
  unit_price_krw: optionalKrw,
  amount_krw: optionalKrw,
  related_order_id: optionalUuid,
  carbon_factor_id: optionalUuid,
  evidence_file_id: optionalUuid,
  received_by_name: z.string().trim().max(120),
  event_location: z.string().trim().max(240),
  site_acknowledgement: z.boolean(),
  note: z.string().trim().max(2000),
});

function formObject(form: FormData) {
  return Object.fromEntries(
    [...form.entries()].map(([key, value]) => [
      key,
      typeof value === "string" ? value : "",
    ]),
  );
}

function optional(value: string | undefined) {
  return value ? value : null;
}
function numberText(value: string | number | null) {
  return value === null ? null : String(value);
}
function formatNumber(value: string | null) {
  if (value === null) return "근거 없음";
  return new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 6 }).format(
    Number(value),
  );
}

function canonicalObject(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  return JSON.stringify(
    Object.fromEntries(
      Object.entries(value as Record<string, unknown>).sort(([left], [right]) =>
        left.localeCompare(right),
      ),
    ),
  );
}

async function sourceIdentity(db: Db, projectId: string, fileId: string) {
  const { data: file } = await db
    .from("lukas_qto_files")
    .select("id, sha256")
    .eq("project_id", projectId)
    .eq("id", fileId)
    .single();
  if (!file || !shaPattern.test(String(file.sha256)))
    throw new Error("선택한 원본 파일을 이 프로젝트에서 찾을 수 없습니다.");
  return { id: String(file.id), sha256: String(file.sha256) };
}

export const meta: Route.MetaFunction = ({ data }) => [
  {
    title: data?.project
      ? `${data.project.name} 자재관리 | 한길시스템`
      : "자재관리 | 한길시스템",
  },
];

export async function loader({ request, params }: Route.LoaderArgs) {
  const [client] = makeServerClient(request);
  const db = client as unknown as Db;
  const {
    data: { user },
  } = await client.auth.getUser();
  if (!user || user.is_anonymous) throw redirect("/login");
  const { data: project } = await db
    .from("lukas_qto_projects")
    .select("id, name")
    .eq("id", params.projectId)
    .single();
  if (!project)
    throw new Response("프로젝트를 찾을 수 없습니다.", { status: 404 });
  const [
    { data: plans },
    { data: transactions },
    { data: factors },
    { data: files },
    { data: artifacts },
    { data: approvals },
  ] = await Promise.all([
    db
      .from("lukas_qto_material_plans")
      .select("*")
      .eq("project_id", project.id)
      .order("created_at"),
    db
      .from("lukas_qto_material_transactions")
      .select("*")
      .eq("project_id", project.id)
      .order("occurred_on"),
    db
      .from("lukas_qto_carbon_factors")
      .select("*")
      .eq("project_id", project.id)
      .order("created_at"),
    db
      .from("lukas_qto_files")
      .select("id, kind, original_filename, sha256")
      .eq("project_id", project.id)
      .order("created_at", { ascending: false }),
    db
      .from("lukas_qto_takeoff_artifacts")
      .select(
        "id, report_file_id, manifest_file_id, report_sha256, manifest_sha256, row_count, input_sha256, status_counts, created_at",
      )
      .eq("project_id", project.id)
      .eq("artifact_kind", "concrete_takeoff")
      .order("created_at", { ascending: false }),
    db
      .from("lukas_qto_takeoff_approvals")
      .select("id, artifact_id, decision, decision_sequence, created_at")
      .order("decision_sequence", { ascending: false }),
  ]);
  const planRows = (plans ?? []) as unknown as PlanRow[];
  const transactionRows = (transactions ?? []) as unknown as TransactionRow[];
  const factorRows = (factors ?? []) as unknown as FactorRow[];
  const artifactRows = (artifacts ?? []) as unknown as TakeoffArtifactRow[];
  const approvalRows = (approvals ?? []) as unknown as TakeoffApprovalRow[];
  const latestDecision = new Map<string, TakeoffApprovalRow>();
  for (const approval of approvalRows)
    if (!latestDecision.has(approval.artifact_id))
      latestDecision.set(approval.artifact_id, approval);
  const importedArtifactIds = new Set(
    planRows
      .map((plan) => plan.source_artifact_id)
      .filter((id): id is string => Boolean(id)),
  );
  const approvedTakeoffs = artifactRows
    .filter(
      (artifact) => latestDecision.get(artifact.id)?.decision === "approved",
    )
    .map((artifact) => ({
      id: artifact.id,
      createdAt: artifact.created_at,
      rowCount: artifact.row_count,
      reportSha256: artifact.report_sha256,
      alreadyImported: importedArtifactIds.has(artifact.id),
    }));
  const requestUrl = new URL(request.url);
  const lineage = await listMaterialBoqLineage(client, {
    projectId: project.id,
    cursor: requestUrl.searchParams.get("lineageCursor"),
  });
  const { data: approvedBoqRows } = await client
    .from("lukas_qto_boq_versions")
    .select("id,version_no,title,status")
    .eq("project_id", project.id)
    .eq("engine_version", "VERIFIED-BOQ-1.1")
    .in("status", ["approved", "superseded"])
    .order("version_no", { ascending: false })
    .limit(200);
  const approvedBoqIds = (approvedBoqRows ?? []).map((row) => row.id);
  const [componentResult, existingLinkResult] = approvedBoqIds.length
    ? await Promise.all([
        client
          .from("lukas_qto_boq_rate_components")
          .select(
            "id,version_id,coefficient,line:lukas_qto_boq_lines!inner(item_code),resource:lukas_qto_price_resources!inner(resource_code,resource_name,specification,unit,resource_type)",
          )
          .eq("project_id", project.id)
          .eq("resource.resource_type", "material")
          .in("version_id", approvedBoqIds)
          .order("id", { ascending: true })
          .limit(2_001),
        db
          .from("lukas_drawing_material_links")
          .select("boq_rate_component_id")
          .eq("project_id", project.id)
          .in("boq_version_id", approvedBoqIds)
          .limit(2_001),
      ])
    : [
        { data: [], error: null },
        { data: [], error: null },
      ];
  const componentRows = componentResult.data;
  if (
    componentResult.error ||
    existingLinkResult.error ||
    (componentRows?.length ?? 0) > 2_000 ||
    (existingLinkResult.data?.length ?? 0) > 2_000
  )
    throw new Response("승인 BOQ 자재 구성이 허용 범위를 초과했습니다.", {
      status: 409,
    });
  const handedComponentIds = new Set(
    (existingLinkResult.data ?? []).map((row) => row.boq_rate_component_id),
  );
  const approvedBoqs = (approvedBoqRows ?? [])
    .map((version) => ({
      id: version.id,
      label: `V${version.version_no} ${version.title} · ${version.status}`,
      components: (componentRows ?? [])
        .filter(
          (component) =>
            component.version_id === version.id &&
            !handedComponentIds.has(component.id),
        )
        .map((component) => ({
          id: component.id,
          itemCode: component.line.item_code,
          resourceCode: component.resource.resource_code,
          resourceName: component.resource.resource_name,
          specification: component.resource.specification,
          unit: component.resource.unit,
          coefficient: String(component.coefficient),
        })),
    }))
    .filter((version) => version.components.length > 0);
  const summaries = buildMaterialControlSummaries(
    planRows.map((row) =>
      materialPlanRow(row as unknown as Record<string, unknown>),
    ),
    transactionRows.map((row) =>
      materialTransactionRow(row as unknown as Record<string, unknown>),
    ),
    factorRows.map((row) =>
      carbonFactorRow(row as unknown as Record<string, unknown>),
    ),
    new Date().toISOString().slice(0, 10),
  );
  return {
    project,
    plans: planRows,
    transactions: transactionRows,
    factors: factorRows,
    files: (files ?? []) as unknown as SourceFile[],
    approvedTakeoffs,
    approvedBoqs,
    materialLineage: lineage,
    materialHandoffOperationId: randomUUID(),
    summaries,
  };
}

export async function action({ request, params }: Route.ActionArgs) {
  const [client, headers] = makeServerClient(request);
  const db = client as unknown as Db;
  const {
    data: { user },
  } = await client.auth.getUser();
  if (!user || user.is_anonymous)
    return data(
      { error: "이메일 로그인이 필요합니다." },
      { status: 401, headers },
    );
  const projectId = params.projectId!;
  const { data: project } = await db
    .from("lukas_qto_projects")
    .select("id, owner_id")
    .eq("id", projectId)
    .single();
  if (!project)
    return data(
      { error: "프로젝트 접근 권한이 없습니다." },
      { status: 403, headers },
    );
  const form = await request.formData();
  const values = formObject(form);
  try {
    if (values.intent === "boq_handoff") {
      const parsed = parseP6MaterialHandoffForm(form);
      await createP6MaterialHandoff(client, user.id, {
        projectId,
        boqVersionId: parsed.boqVersionId,
        operationId: parsed.operationId,
        selectedRateComponentIds: parsed.selectedRateComponentIds,
      });
    } else if (values.intent === "import_takeoff") {
      const artifactId = z.string().uuid().parse(values.artifact_id);
      const { data: artifact } = await db
        .from("lukas_qto_takeoff_artifacts")
        .select(
          "id, report_file_id, manifest_file_id, report_sha256, manifest_sha256, row_count, input_sha256, status_counts, created_at",
        )
        .eq("project_id", projectId)
        .eq("id", artifactId)
        .eq("artifact_kind", "concrete_takeoff")
        .single();
      if (!artifact) throw new Error("선택한 콘크리트 산출 근거가 없습니다.");
      const { data: latestApproval } = await db
        .from("lukas_qto_takeoff_approvals")
        .select("decision")
        .eq("artifact_id", artifactId)
        .order("decision_sequence", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (latestApproval?.decision !== "approved")
        throw new Error(
          "가장 최근 사람 결정이 승인인 산출 근거만 가져올 수 있습니다.",
        );
      const { data: artifactFiles } = await db
        .from("lukas_qto_files")
        .select("id, original_filename, storage_path, sha256, byte_size")
        .eq("project_id", projectId)
        .in("id", [artifact.report_file_id, artifact.manifest_file_id]);
      const takeoffFiles = (artifactFiles ?? []) as unknown as TakeoffFileRow[];
      const reportFile = takeoffFiles.find(
        (file) => file.id === artifact.report_file_id,
      );
      const manifestFile = takeoffFiles.find(
        (file) => file.id === artifact.manifest_file_id,
      );
      if (!reportFile || !manifestFile)
        throw new Error("산출 결과와 근거 기록 파일의 연결이 끊어졌습니다.");
      if (
        reportFile.byte_size > 20 * 1024 * 1024 ||
        manifestFile.byte_size > 20 * 1024 * 1024
      )
        throw new Error("웹 재검증 허용 크기 20MB를 초과했습니다.");
      const [reportDownload, manifestDownload] = await Promise.all([
        client.storage.from("lukas-qto").download(reportFile.storage_path),
        client.storage.from("lukas-qto").download(manifestFile.storage_path),
      ]);
      if (
        reportDownload.error ||
        manifestDownload.error ||
        !reportDownload.data ||
        !manifestDownload.data
      )
        throw new Error("승인 산출 원본을 다시 읽지 못했습니다.");
      const verified = verifyConcreteTakeoffBundle(
        new Uint8Array(await reportDownload.data.arrayBuffer()),
        reportFile.original_filename,
        new Uint8Array(await manifestDownload.data.arrayBuffer()),
      );
      if (
        verified.reportSha256 !== artifact.report_sha256 ||
        verified.reportSha256 !== reportFile.sha256 ||
        verified.manifestSha256 !== artifact.manifest_sha256 ||
        verified.manifestSha256 !== manifestFile.sha256 ||
        verified.rowCount !== artifact.row_count ||
        canonicalObject(verified.inputSha256) !==
          canonicalObject(artifact.input_sha256) ||
        canonicalObject(verified.statusCounts) !==
          canonicalObject(artifact.status_counts)
      )
        throw new Error("등록 당시 산출 근거와 현재 파일이 일치하지 않습니다.");
      const derived = deriveMaterialPlansFromApprovedTakeoff(verified.rows);
      const { error } = await db.from("lukas_qto_material_plans").insert(
        derived.map((plan): PlanInsert => ({
          project_id: projectId,
          material_code: plan.materialCode,
          material_name: plan.materialName,
          specification: plan.specification,
          unit: plan.unit,
          design_quantity: plan.designQuantity,
          allowance_rate: plan.allowanceRate,
          required_quantity: plan.requiredQuantity,
          rule_id: plan.ruleId,
          required_by: null,
          baseline_factor_id: null,
          source_file_id: reportFile.id,
          source_sha256: verified.reportSha256,
          source_artifact_id: artifact.id,
          source_group_key: plan.sourceGroupKey,
          created_by: user.id,
        })),
      );
      if (error?.code === "23505")
        throw new Error("이 승인 산출 결과는 이미 자재계획으로 가져왔습니다.");
      if (error) throw error;
    } else if (values.intent === "plan") {
      const parsed = planSchema.parse(values);
      const source = await sourceIdentity(db, projectId, parsed.source_file_id);
      const required = calculateRequiredQuantity(
        parsed.design_quantity,
        parsed.allowance_rate,
      );
      const { error } = await db.from("lukas_qto_material_plans").insert({
        project_id: projectId,
        material_code: parsed.material_code,
        material_name: parsed.material_name,
        specification: parsed.specification,
        unit: parsed.unit,
        design_quantity: parsed.design_quantity,
        allowance_rate: parsed.allowance_rate,
        required_quantity: required,
        rule_id: parsed.rule_id,
        required_by: optional(parsed.required_by),
        source_file_id: source.id,
        source_sha256: source.sha256,
        baseline_factor_id: optional(parsed.baseline_factor_id),
        created_by: user.id,
      });
      if (error) throw error;
    } else if (values.intent === "factor") {
      const parsed = factorSchema.parse(values);
      const source = await sourceIdentity(db, projectId, parsed.source_file_id);
      const { error } = await db.from("lukas_qto_carbon_factors").insert({
        project_id: projectId,
        material_code: parsed.material_code,
        product_name: parsed.product_name,
        manufacturer: parsed.manufacturer,
        declared_unit: parsed.declared_unit,
        gwp_a1_a3_per_unit: parsed.gwp_a1_a3_per_unit,
        source_type: parsed.source_type,
        standard: parsed.standard,
        epd_program_operator: parsed.epd_program_operator,
        epd_declaration_number: parsed.epd_declaration_number,
        epd_verifier: parsed.epd_verifier,
        pcr_reference: parsed.pcr_reference,
        geography: parsed.geography,
        valid_from: optional(parsed.valid_from),
        valid_until: optional(parsed.valid_until),
        source_file_id: source.id,
        source_sha256: source.sha256,
        created_by: user.id,
      });
      if (error) throw error;
    } else if (values.intent === "transaction") {
      const parsed = transactionSchema.parse({
        ...values,
        site_acknowledgement: form.get("site_acknowledgement") === "on",
      });
      const needsEvidence = parsed.transaction_type !== "purchase_order";
      const captured = form.get("evidence_capture");
      const capturedFile =
        captured instanceof File && captured.size > 0 ? captured : null;
      if (capturedFile && parsed.evidence_file_id)
        throw new Error("새 사진·PDF와 기존 증빙 중 하나만 선택하세요.");
      if (needsEvidence && !parsed.evidence_file_id && !capturedFile)
        throw new Error("입고·계산서에는 원본 증빙 파일이 필요합니다.");
      let evidence = parsed.evidence_file_id
        ? await sourceIdentity(db, projectId, parsed.evidence_file_id)
        : null;
      let uploaded: { id: string; storagePath: string } | null = null;
      try {
        if (capturedFile) {
          if (capturedFile.size > maxEvidenceBytes)
            throw new Error("현장 증빙은 20MB까지 업로드할 수 있습니다.");
          if (!evidenceMimeTypes.has(capturedFile.type))
            throw new Error("현장 증빙은 JPG, PNG, PDF 또는 CSV만 지원합니다.");
          const bytes = Buffer.from(await capturedFile.arrayBuffer());
          const sha256 = createHash("sha256").update(bytes).digest("hex");
          const storagePath = storageObjectPath({
            ownerId: project.owner_id,
            projectId,
            directory: "material-evidence",
            originalFilename: capturedFile.name,
          });
          const { error: storageError } = await client.storage
            .from("lukas-qto")
            .upload(storagePath, bytes, {
              contentType: capturedFile.type,
              upsert: false,
            });
          if (storageError)
            throw new Error(`증빙 파일 저장 실패: ${storageError.message}`);
          const { data: stored, error: metadataError } = await client
            .from("lukas_qto_files")
            .insert({
              project_id: projectId,
              uploaded_by: user.id,
              kind: "other",
              storage_path: storagePath,
              original_filename: capturedFile.name || "field-evidence",
              content_type: capturedFile.type,
              byte_size: capturedFile.size,
              sha256,
              immutable: true,
            })
            .select("id")
            .single();
          if (metadataError || !stored) {
            await client.storage.from("lukas-qto").remove([storagePath]);
            throw new Error(
              `증빙 파일 기록 실패: ${metadataError?.message ?? "파일 ID가 없습니다."}`,
            );
          }
          uploaded = { id: stored.id, storagePath };
          evidence = { id: stored.id, sha256 };
        }
        const { error } = await db
          .from("lukas_qto_material_transactions")
          .insert({
            project_id: projectId,
            material_plan_id: parsed.material_plan_id,
            transaction_type: parsed.transaction_type,
            document_number: parsed.document_number,
            supplier_name: parsed.supplier_name,
            occurred_on: parsed.occurred_on,
            quantity: parsed.quantity,
            unit_price_krw: optional(parsed.unit_price_krw),
            amount_krw: optional(parsed.amount_krw),
            related_order_id: optional(parsed.related_order_id),
            carbon_factor_id: optional(parsed.carbon_factor_id),
            evidence_file_id: evidence?.id ?? null,
            evidence_sha256: evidence?.sha256 ?? null,
            received_by_name: parsed.received_by_name,
            event_location: parsed.event_location,
            site_acknowledgement: parsed.site_acknowledgement,
            note: parsed.note,
            created_by: user.id,
          });
        if (error) throw error;
      } catch (error) {
        if (uploaded) {
          await client.from("lukas_qto_files").delete().eq("id", uploaded.id);
          await client.storage.from("lukas-qto").remove([uploaded.storagePath]);
        }
        throw error;
      }
    } else throw new Error("지원하지 않는 작업입니다.");
    return data({ ok: true }, { headers });
  } catch (error) {
    const message =
      error instanceof z.ZodError
        ? "입력 형식을 확인하세요."
        : error instanceof Error
          ? error.message
          : "기록하지 못했습니다.";
    return data({ error: message }, { status: 400, headers });
  }
}

export default function MaterialControl({
  loaderData,
  actionData,
}: Route.ComponentProps) {
  const orders = loaderData.transactions.filter(
    (row) => row.transaction_type === "purchase_order",
  );
  return (
    <main className="mx-auto w-full max-w-7xl px-4 pb-28 pt-6 sm:px-8 sm:py-10">
      <Link
        className="inline-flex items-center gap-1 text-sm text-muted-foreground underline underline-offset-4"
        to={`/projects/${loaderData.project.id}`}
      >
        <ArrowLeft className="size-4" /> 프로젝트로 돌아가기
      </Link>
      <header className="mt-5 flex flex-col gap-5 border-b pb-8 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-bold text-[#3024d8]">
            현장 자재 기록 · 시험 운영
          </p>
          <h1 className="mt-2 text-3xl font-bold">
            {loaderData.project.name} · 자재 관리
          </h1>
          <p className="mt-3 max-w-3xl text-muted-foreground">
            Revit 설치 프로그램과 별도의 현장 기록 화면입니다. 승인된 물량에서
            필요한 자재를 만들고, 발주·입고·설치·계산서를 순서대로 기록합니다.
            탄소 정보는 필요할 때 고급 입력에서 추가할 수 있습니다.
          </p>
        </div>
        <Button
          asChild
          disabled={loaderData.summaries.length === 0}
          variant="outline"
        >
          <a href={`/projects/${loaderData.project.id}/materials.csv`}>
            근거 CSV 내보내기
          </a>
        </Button>
      </header>
      <ProjectWorkspaceNav
        current="materials"
        projectId={loaderData.project.id}
      />
      {actionData && "error" in actionData ? (
        <p
          aria-live="assertive"
          className="mt-5 rounded-xl bg-destructive/10 p-3 text-sm text-destructive"
          role="alert"
        >
          {actionData.error}
        </p>
      ) : null}
      {actionData && "ok" in actionData && actionData.ok ? (
        <p
          aria-live="polite"
          className="mt-5 rounded-xl bg-emerald-50 p-3 text-sm font-medium text-emerald-800"
          role="status"
        >
          기록되었습니다. 아래 현황에 새 내용이 반영됐습니다.
        </p>
      ) : null}
      <section className="mt-8 grid gap-4 md:grid-cols-4">
        {[
          [Boxes, "자재계획", `${loaderData.plans.length}개`],
          [Truck, "발주·입고·설치·청구", `${loaderData.transactions.length}건`],
          [Factory, "탄소계수", `${loaderData.factors.length}개`],
          [
            FileCheck2,
            "검토 예외",
            `${loaderData.summaries.reduce((n, row) => n + row.findings.length, 0)}건`,
          ],
        ].map(([Icon, label, value]) => (
          <div
            className="rounded-2xl border bg-card p-5 shadow-sm"
            key={String(label)}
          >
            <Icon className="size-5 text-primary" />
            <p className="mt-4 text-sm text-muted-foreground">
              {String(label)}
            </p>
            <p className="mt-1 text-2xl font-bold">{String(value)}</p>
          </div>
        ))}
      </section>
      <MaterialBoqLineage
        approvedBoqs={loaderData.approvedBoqs}
        nextCursor={loaderData.materialLineage.nextCursor}
        operationId={loaderData.materialHandoffOperationId}
        projectId={loaderData.project.id}
        rows={loaderData.materialLineage.rows}
      />
      <section className="mt-8 rounded-2xl border border-primary/20 bg-primary/5 p-6">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-sm font-bold text-primary">승인 산출 연결</p>
            <h2 className="mt-1 text-xl font-semibold">
              확정된 콘크리트 수량을 자재계획으로 가져오기
            </h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
              사람이 최종 승인한 산출 결과를 다시 검증한 뒤 규격별 최종 m³만
              합산합니다. 산출 단계에서 적용된 할증은 다시 더하지 않으며,
              REVIEW·누락·변경된 파일은 가져오지 않습니다.
            </p>
          </div>
          {loaderData.approvedTakeoffs.length === 0 ? (
            <p className="rounded-xl border border-dashed bg-background px-4 py-3 text-sm text-muted-foreground">
              먼저 프로젝트에서 콘크리트 산출 근거를 승인하세요.
            </p>
          ) : (
            <Form
              className="flex min-w-0 flex-col gap-2 sm:min-w-[360px]"
              method="post"
            >
              <input name="intent" type="hidden" value="import_takeoff" />
              <Label htmlFor="approved-takeoff">승인된 산출 결과</Label>
              <select
                className="h-10 rounded-md border bg-background px-3 text-sm"
                id="approved-takeoff"
                name="artifact_id"
                required
              >
                {loaderData.approvedTakeoffs.map((artifact) => (
                  <option
                    disabled={artifact.alreadyImported}
                    key={artifact.id}
                    value={artifact.id}
                  >
                    {new Date(artifact.createdAt).toLocaleString("ko-KR")} ·{" "}
                    {artifact.rowCount}행
                    {artifact.alreadyImported ? " · 가져옴" : ""}
                  </option>
                ))}
              </select>
              <Button
                disabled={loaderData.approvedTakeoffs.every(
                  (artifact) => artifact.alreadyImported,
                )}
                type="submit"
              >
                규격별 자재계획 생성
              </Button>
            </Form>
          )}
        </div>
      </section>
      <section className="mt-8 rounded-2xl border bg-card p-6 shadow-sm">
        <div className="flex items-center gap-3">
          <Calculator className="size-5 text-primary" />
          <div>
            <h2 className="font-semibold">자재 흐름 한눈에 보기</h2>
            <p className="text-sm text-muted-foreground">
              입력값을 추정하지 않고 승인된 기록만 합산합니다.
            </p>
          </div>
        </div>
        {loaderData.summaries.length === 0 ? (
          <p className="mt-5 rounded-xl border border-dashed p-6 text-sm text-muted-foreground">
            아래에서 첫 콘크리트 자재계획을 등록하세요.
          </p>
        ) : (
          <div className="mt-5 overflow-x-auto">
            <table className="w-full min-w-[1100px] text-left text-sm">
              <thead className="border-b text-muted-foreground">
                <tr>
                  {[
                    "품목",
                    "설계",
                    "필요",
                    "발주",
                    "입고",
                    "설치",
                    "반품",
                    "폐기",
                    "현장잔량",
                    "청구",
                    "청구금액",
                    "기준 탄소",
                    "입고 탄소",
                    "상태",
                  ].map((h) => (
                    <th className="pb-3 font-medium" key={h}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loaderData.summaries.map((row) => (
                  <tr
                    className="border-b last:border-0"
                    key={row.materialPlanId}
                  >
                    <td className="py-4">
                      <p className="font-medium">{row.materialName}</p>
                      <p className="text-xs text-muted-foreground">
                        {row.materialCode} · {row.specification}
                      </p>
                    </td>
                    <td>
                      {formatNumber(row.designQuantity)} {row.unit}
                    </td>
                    <td>{formatNumber(row.requiredQuantity)}</td>
                    <td>{formatNumber(row.orderedQuantity)}</td>
                    <td>{formatNumber(row.receivedQuantity)}</td>
                    <td>{formatNumber(row.installedQuantity)}</td>
                    <td>{formatNumber(row.returnedQuantity)}</td>
                    <td>{formatNumber(row.wastedQuantity)}</td>
                    <td>{formatNumber(row.onSiteQuantity)}</td>
                    <td>{formatNumber(row.invoicedQuantity)}</td>
                    <td>{formatNumber(row.invoiceAmountKrw)}원</td>
                    <td>{formatNumber(row.baselineA1A3KgCo2e)}</td>
                    <td>{formatNumber(row.receivedA1A3KgCo2e)}</td>
                    <td>
                      {row.findings.length ? (
                        <span className="text-amber-700">
                          {row.findings.join(" · ")}
                        </span>
                      ) : (
                        <span className="text-emerald-700">일치</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <div className="mt-8 grid gap-6 xl:grid-cols-3">
        <EntryCard
          title="1. 자재계획 만들기"
          description="승인된 설계수량과 현장 여유분을 나눠 기록합니다."
        >
          <Form className="grid gap-3" method="post">
            <input name="intent" type="hidden" value="plan" />
            <Text
              name="material_code"
              label="자재코드"
              placeholder="CONC-25-270"
            />
            <Text
              name="material_name"
              label="자재명"
              placeholder="철근콘크리트"
            />
            <Text name="specification" label="규격" placeholder="25-270-15" />
            <Select name="unit" label="단위" values={units} />
            <Text name="design_quantity" label="설계수량" inputMode="decimal" />
            <Text
              name="allowance_rate"
              label="할증률"
              placeholder="0.03"
              inputMode="decimal"
            />
            <Text
              name="rule_id"
              label="승인 규칙 ID"
              placeholder="CONCRETE-LOSS-R1"
            />
            <Text name="required_by" label="필요일" type="date" />
            <FileSelect
              files={loaderData.files}
              label="설계수량 원본"
              name="source_file_id"
            />
            <SelectOptional
              name="baseline_factor_id"
              label="설계 기준 탄소계수"
              rows={loaderData.factors.map((f) => [
                f.id,
                `${f.product_name} · ${f.declared_unit}`,
              ])}
            />
            <Button type="submit">자재계획 기록</Button>
          </Form>
        </EntryCard>
        <EntryCard
          title="2. 발주·입고·설치·계산서"
          description="발주 외 모든 사건은 기존 발주와 원본 증빙이 필수입니다."
        >
          <Form
            className="grid gap-3"
            encType="multipart/form-data"
            method="post"
          >
            <input name="intent" type="hidden" value="transaction" />
            <Select
              name="transaction_type"
              label="기록 종류"
              values={[
                "purchase_order",
                "goods_receipt",
                "invoice_evidence",
                "installation",
                "return_to_supplier",
                "waste_disposal",
              ]}
              labels={[
                "내부 발주",
                "현장 입고",
                "매입계산서 증빙",
                "현장 설치",
                "공급사 반품",
                "폐기",
              ]}
            />
            <SelectOptional
              required
              name="material_plan_id"
              label="자재계획"
              rows={loaderData.plans.map((p) => [
                p.id,
                `${p.material_code} · ${p.specification}`,
              ])}
            />
            <Text name="document_number" label="문서번호" />
            <Text name="supplier_name" label="공급사" />
            <Text name="occurred_on" label="일자" type="date" />
            <Text name="quantity" label="수량" inputMode="decimal" />
            <Text
              name="unit_price_krw"
              label="단가(계산서만 필수)"
              inputMode="numeric"
            />
            <Text
              name="amount_krw"
              label="공급가액(계산서만 필수)"
              inputMode="numeric"
            />
            <SelectOptional
              name="related_order_id"
              label="연결 발주"
              rows={orders.map((o) => [
                o.id,
                `${o.document_number} · ${o.supplier_name}`,
              ])}
            />
            <SelectOptional
              name="carbon_factor_id"
              label="제품 탄소계수"
              rows={loaderData.factors.map((f) => [
                f.id,
                `${f.product_name} · ${f.declared_unit}`,
              ])}
            />
            <div className="grid gap-1.5">
              <Label htmlFor="evidence_capture">
                현장에서 사진·PDF 바로 첨부
              </Label>
              <Input
                accept="image/jpeg,image/png,application/pdf,text/csv"
                capture="environment"
                id="evidence_capture"
                name="evidence_capture"
                type="file"
              />
            </div>
            <FileSelect
              files={loaderData.files}
              label="또는 기존 증빙 선택"
              name="evidence_file_id"
              optional
            />
            <Text name="received_by_name" label="현장 인수자" />
            <Text
              name="event_location"
              label="현장 위치"
              placeholder="A동 1층 / 자재 야적장"
            />
            <label className="flex items-center gap-2 text-sm">
              <input name="site_acknowledgement" type="checkbox" /> 현장에서
              수량과 원본을 확인했습니다
            </label>
            <Text name="note" label="메모" />
            <Button type="submit">거래 기록</Button>
          </Form>
        </EntryCard>
        <details className="rounded-2xl border bg-card p-6 shadow-sm">
          <summary className="cursor-pointer list-none rounded-lg font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            3. 탄소 정보 입력 (고급)
            <span className="mt-1 block text-sm font-normal text-muted-foreground">
              제품 환경성적표(EPD)나 승인된 일반 계수가 있을 때만 입력합니다.
            </span>
          </summary>
          <Form className="mt-5 grid gap-3" method="post">
            <input name="intent" type="hidden" value="factor" />
            <Text
              name="material_code"
              label="자재코드"
              placeholder="CONC-25-270"
            />
            <Text
              name="product_name"
              label="제품·계수명"
              placeholder="레미콘 25-270-15"
            />
            <Text name="manufacturer" label="제조사" />
            <Select name="declared_unit" label="선언단위" values={units} />
            <Text
              name="gwp_a1_a3_per_unit"
              label="A1-A3 kgCO₂e/단위"
              inputMode="decimal"
            />
            <Select
              name="source_type"
              label="자료 종류"
              values={["product_epd", "industry_average", "generic"]}
              labels={["제품별 검증 EPD", "업종 평균", "일반 계수"]}
            />
            <Text
              name="standard"
              label="표준·PCR"
              placeholder="ISO 14025 / EN 15804"
            />
            <Text
              name="epd_program_operator"
              label="EPD 프로그램 운영기관"
              placeholder="제품별 EPD일 때 필수"
            />
            <Text
              name="epd_declaration_number"
              label="EPD 선언번호"
              placeholder="제품별 EPD일 때 필수"
            />
            <Text
              name="epd_verifier"
              label="제3자 검증기관·검증자"
              placeholder="제품별 EPD일 때 필수"
            />
            <Text
              name="pcr_reference"
              label="PCR 문서"
              placeholder="제품별 EPD일 때 필수"
            />
            <Text name="geography" label="적용 지역" placeholder="KR" />
            <Text name="valid_from" label="유효 시작" type="date" />
            <Text name="valid_until" label="유효 종료" type="date" />
            <FileSelect
              files={loaderData.files}
              label="탄소계수 원본"
              name="source_file_id"
            />
            <Button type="submit">탄소 정보 기록</Button>
          </Form>
        </details>
      </div>
    </main>
  );
}

function EntryCard({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border bg-card p-6 shadow-sm">
      <h2 className="font-semibold">{title}</h2>
      <p className="mb-5 mt-1 text-sm text-muted-foreground">{description}</p>
      {children}
    </section>
  );
}
function Text({
  label,
  name,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  name: string;
}) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={name}>{label}</Label>
      <Input id={name} name={name} {...props} />
    </div>
  );
}
function Select({
  label,
  name,
  values,
  labels,
}: {
  label: string;
  name: string;
  values: readonly string[];
  labels?: readonly string[];
}) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={name}>{label}</Label>
      <select
        className="h-11 rounded-md border bg-background px-3 text-sm"
        id={name}
        name={name}
        required
      >
        {values.map((value, i) => (
          <option key={value} value={value}>
            {labels?.[i] ?? value}
          </option>
        ))}
      </select>
    </div>
  );
}
function SelectOptional({
  label,
  name,
  rows,
  required = false,
}: {
  label: string;
  name: string;
  rows: [string, string][];
  required?: boolean;
}) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={name}>{label}</Label>
      <select
        className="h-11 rounded-md border bg-background px-3 text-sm"
        id={name}
        name={name}
        required={required}
      >
        <option value="">선택 안 함</option>
        {rows.map(([id, text]) => (
          <option key={id} value={id}>
            {text}
          </option>
        ))}
      </select>
    </div>
  );
}
function FileSelect({
  files,
  label,
  name,
  optional = false,
}: {
  files: SourceFile[];
  label: string;
  name: string;
  optional?: boolean;
}) {
  return (
    <SelectOptional
      label={label}
      name={name}
      required={!optional}
      rows={files.map((file) => [
        file.id,
        `${file.original_filename} · 확인번호 ${file.sha256.slice(0, 8)}`,
      ])}
    />
  );
}
