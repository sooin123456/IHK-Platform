import type { Route } from "./+types/project";

import { createHash } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "database.types";
import { useEffect, useState } from "react";

import {
  ArrowRight,
  Calculator,
  CheckCircle2,
  ClipboardCheck,
  FileSearch,
  FileUp,
  FolderOpen,
  GitCompareArrows,
  MessageSquareText,
  ShieldCheck,
} from "lucide-react";
import {
  Form,
  Link,
  data,
  redirect,
  useLocation,
  useNavigation,
  useSearchParams,
} from "react-router";
import { z } from "zod";

import { Button } from "~/core/components/ui/button";
import { Input } from "~/core/components/ui/input";
import { Label } from "~/core/components/ui/label";
import makeServerClient from "~/core/lib/supa-client.server";
import { recordProjectExport } from "~/lukas/lib/project-export-audit.server";
import {
  ProjectWorkspaceNav,
  type ProjectWorkspaceView,
} from "~/lukas/components/project-workspace-nav";
import {
  resolveConcreteTakeoffInputs,
  verifyConcreteTakeoffBundle,
} from "~/lukas/lib/concrete-takeoff-artifact.server";
import {
  resolvePreflightInputs,
  verifyPreflightBundle,
} from "~/lukas/lib/preflight-artifact.server";
import {
  buildElementLedgerRevisionSuggestions,
  buildElementLedgerSuggestions,
  LEDGER_REVIEW_VERSION,
  revisionComparisonUnavailable,
} from "~/lukas/lib/element-ledger-suggestions.server";
import {
  buildSuggestionEvaluation,
  buildSuggestionFeedbackExport,
} from "~/lukas/lib/suggestion-feedback.server";
import { storageObjectPath } from "~/lukas/lib/storage-object-key.server";

const fileKinds = [
  "ifc",
  "qto_csv",
  "element_ledger",
  "formwork_ledger",
  "estimate",
  "mapping",
  "other",
] as const;

const reviewStatuses = ["open", "in_review", "resolved", "blocked"] as const;
const suggestionDecisions = ["accepted", "rejected", "deferred"] as const;
const takeoffDecisions = ["approved", "rejected", "deferred"] as const;
const workflowStatuses = [
  "inquiry_received",
  "quote_review",
  "confirmed",
  "bim_modeling",
  "quantity_takeoff",
  "expert_review",
  "delivered",
] as const;
const workflowLabels: Record<(typeof workflowStatuses)[number], string> = {
  inquiry_received: "문의 접수",
  quote_review: "견적 검토",
  confirmed: "작업 확정",
  bim_modeling: "BIM 모델링",
  quantity_takeoff: "물량산출",
  expert_review: "전문가 검토",
  delivered: "납품 완료",
};
const maxUploadBytes = 200 * 1024 * 1024;
const maxAnalyzedLedgerBytes = 20 * 1024 * 1024;
const maxTakeoffBundleBytes = 20 * 1024 * 1024;

type MaterialPlanRow = {
  id: string;
  project_id: string;
  created_at: string;
};
type MaterialPlanInsert = Partial<MaterialPlanRow> & { project_id: string };
type MaterialPlanDatabase = Omit<Database, "public"> & {
  public: Omit<Database["public"], "Tables"> & {
    Tables: Database["public"]["Tables"] & {
      lukas_qto_material_plans: {
        Row: MaterialPlanRow;
        Insert: MaterialPlanInsert;
        Update: Partial<MaterialPlanInsert>;
        Relationships: [];
      };
    };
  };
};

function asFile(value: FormDataEntryValue | null): File | null {
  return value instanceof File && value.size > 0 ? value : null;
}

function kindLabel(kind: string) {
  const labels: Record<string, string> = {
    ifc: "IFC 모델",
    qto_csv: "QTO CSV",
    element_ledger: "요소 원장",
    formwork_ledger: "거푸집 Face 원장",
    estimate: "내역서",
    mapping: "매핑표",
    other: "기타",
  };
  return labels[kind] ?? kind;
}

const fileKindHelp: Record<(typeof fileKinds)[number], string> = {
  ifc: "Revit에서 내보낸 .ifc 모델",
  qto_csv: "분류별 수량을 모은 QTO .csv",
  element_ledger: "객체별 수량표(element-ledger.csv)",
  formwork_ledger: "거푸집 면적 검토표 .csv",
  estimate: "검토할 내역서 .csv 또는 Excel",
  mapping: "내역과 모델을 연결하는 매핑 .csv",
  other: "그 밖의 계산 근거 파일",
};

const fileKindAccept: Record<(typeof fileKinds)[number], string | undefined> = {
  ifc: ".ifc,application/octet-stream",
  qto_csv: ".csv,text/csv",
  element_ledger: ".csv,text/csv",
  formwork_ledger: ".csv,text/csv",
  estimate:
    ".csv,.xls,.xlsx,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  mapping: ".csv,text/csv",
  other: undefined,
};

function fileMatchesKind(kind: (typeof fileKinds)[number], filename: string) {
  const lower = filename.trim().toLowerCase();
  if (kind === "other") return true;
  if (kind === "ifc") return lower.endsWith(".ifc");
  if (kind === "estimate")
    return [".csv", ".xls", ".xlsx"].some((extension) =>
      lower.endsWith(extension),
    );
  return lower.endsWith(".csv");
}

function statusLabel(status: string) {
  const labels: Record<string, string> = {
    open: "미검토",
    in_review: "검토 중",
    resolved: "해결",
    blocked: "보류",
  };
  return labels[status] ?? status;
}

function decisionLabel(decision: string) {
  return (
    (
      {
        accepted: "승인",
        rejected: "수정 필요",
        deferred: "나중에 검토",
      } as Record<string, string>
    )[decision] ?? decision
  );
}

function takeoffDecisionLabel(decision: string) {
  return (
    (
      {
        approved: "승인",
        rejected: "수정 필요",
        deferred: "나중에 검토",
      } as Record<string, string>
    )[decision] ?? decision
  );
}

function rejectedWithoutNote(decision: string, note: string) {
  return decision === "rejected" && note.trim().length === 0;
}

function suggestionKindLabel(kind: string) {
  return (
    (
      {
        anomaly: "이상치",
        classification: "분류",
        mapping: "매핑",
        revision_change: "개정 차이",
      } as Record<string, string>
    )[kind] ?? kind
  );
}

function affectedCount(evidence: unknown) {
  if (!evidence || typeof evidence !== "object" || Array.isArray(evidence))
    return null;
  const value = (evidence as Record<string, unknown>).affected_count;
  return typeof value === "number" ? value : null;
}

function evidenceText(evidence: unknown, key: string) {
  if (!evidence || typeof evidence !== "object" || Array.isArray(evidence))
    return null;
  const value = (evidence as Record<string, unknown>)[key];
  return typeof value === "string" ? value : null;
}

type RevisionQuantityDelta = {
  measure: string;
  label: string;
  unit: string;
  previous: string;
  current: string;
  delta: string;
  comparable_count: number;
  not_evaluated_count: number;
};

function revisionQuantityDeltas(evidence: unknown): RevisionQuantityDelta[] {
  if (!evidence || typeof evidence !== "object" || Array.isArray(evidence))
    return [];
  const values = (evidence as Record<string, unknown>).quantity_deltas;
  if (!Array.isArray(values)) return [];
  return values.filter((value): value is RevisionQuantityDelta => {
    if (!value || typeof value !== "object" || Array.isArray(value))
      return false;
    const item = value as Record<string, unknown>;
    return (
      ["measure", "label", "unit", "previous", "current", "delta"].every(
        (key) => typeof item[key] === "string",
      ) &&
      typeof item.comparable_count === "number" &&
      typeof item.not_evaluated_count === "number"
    );
  });
}

function signedQuantity(value: string) {
  return value === "0" || value.startsWith("-") ? value : `+${value}`;
}

export const meta: Route.MetaFunction = ({ data }) => [
  {
    title: data?.project
      ? `${data.project.name} | 한길시스템`
      : "프로젝트 | 한길시스템",
  },
];

export async function loader({ request, params }: Route.LoaderArgs) {
  const [client] = makeServerClient(request);
  const materialDb = client as unknown as SupabaseClient<MaterialPlanDatabase>;
  const {
    data: { user },
  } = await client.auth.getUser();
  if (!user || user.is_anonymous) throw redirect("/login");

  const { data: project, error: projectError } = await client
    .from("lukas_qto_projects")
    .select(
      "id, name, owner_id, description, workflow_status, contact_name, contact_phone, created_at, updated_at",
    )
    .eq("id", params.projectId)
    .single();
  if (projectError || !project)
    throw new Response("프로젝트를 찾을 수 없습니다.", { status: 404 });

  const [
    { data: files, error: filesError },
    { data: reviews, error: reviewsError },
    { data: shares, error: sharesError },
    { data: suggestions, error: suggestionsError },
    { data: takeoffArtifacts, error: takeoffArtifactsError },
    { data: fileRevisions, error: fileRevisionsError },
    { data: preflightArtifacts, error: preflightArtifactsError },
    { data: materialPlans, error: materialPlansError },
  ] = await Promise.all([
    client
      .from("lukas_qto_files")
      .select(
        "id, kind, original_filename, content_type, byte_size, sha256, storage_path, created_at",
      )
      .eq("project_id", project.id)
      .order("created_at", { ascending: false }),
    client
      .from("lukas_qto_reviews")
      .select("id, file_id, status, note, created_at, updated_at")
      .eq("project_id", project.id)
      .order("updated_at", { ascending: false }),
    client
      .from("lukas_qto_shares")
      .select("id, token, permission, expires_at, created_at")
      .eq("project_id", project.id)
      .order("created_at", { ascending: false }),
    client
      .from("lukas_qto_suggestions")
      .select(
        "id, file_id, producer_kind, producer_version, source_sha256, suggestion_kind, subject_key, title, detail, confidence, evidence, created_at",
      )
      .eq("project_id", project.id)
      .order("created_at", { ascending: false }),
    client
      .from("lukas_qto_takeoff_artifacts")
      .select(
        "id, format_version, report_file_id, manifest_file_id, report_sha256, manifest_sha256, row_count, input_sha256, status_counts, created_at",
      )
      .eq("project_id", project.id)
      .order("created_at", { ascending: false }),
    client
      .from("lukas_qto_file_revisions")
      .select(
        "id, previous_file_id, previous_sha256, current_file_id, current_sha256, relation_kind, created_at",
      )
      .eq("project_id", project.id)
      .order("created_at", { ascending: false }),
    client
      .from("lukas_qto_preflight_artifacts")
      .select(
        "id, format_version, ruleset_version, scope_id, report_sha256, manifest_sha256, row_count, quantity_tolerance, krw_tolerance, status_counts, created_at",
      )
      .eq("project_id", project.id)
      .order("created_at", { ascending: false }),
    materialDb
      .from("lukas_qto_material_plans")
      .select("id, created_at")
      .eq("project_id", project.id)
      .order("created_at", { ascending: false }),
  ]);
  if (
    filesError ||
    reviewsError ||
    sharesError ||
    suggestionsError ||
    takeoffArtifactsError ||
    fileRevisionsError ||
    preflightArtifactsError ||
    materialPlansError
  )
    throw new Response("프로젝트 자료를 불러오지 못했습니다.", { status: 500 });

  const suggestionIds = (suggestions ?? []).map((suggestion) => suggestion.id);
  const { data: suggestionDecisionRows, error: decisionsError } =
    suggestionIds.length === 0
      ? { data: [], error: null }
      : await client
          .from("lukas_qto_suggestion_decisions")
          .select(
            "id, suggestion_id, decision, note, decision_sequence, created_at",
          )
          .in("suggestion_id", suggestionIds)
          .order("decision_sequence", { ascending: false });
  if (decisionsError)
    throw new Response("자동 검토 결정을 불러오지 못했습니다.", {
      status: 500,
    });

  const takeoffArtifactIds = (takeoffArtifacts ?? []).map(
    (artifact) => artifact.id,
  );
  const { data: takeoffApprovalRows, error: takeoffApprovalsError } =
    takeoffArtifactIds.length === 0
      ? { data: [], error: null }
      : await client
          .from("lukas_qto_takeoff_approvals")
          .select(
            "id, artifact_id, decision, note, decision_sequence, created_at",
          )
          .in("artifact_id", takeoffArtifactIds)
          .order("decision_sequence", { ascending: false });
  if (takeoffApprovalsError)
    throw new Response("산출 근거 승인 이력을 불러오지 못했습니다.", {
      status: 500,
    });
  const preflightArtifactIds = (preflightArtifacts ?? []).map(
    (artifact) => artifact.id,
  );
  const { data: preflightApprovalRows, error: preflightApprovalsError } =
    preflightArtifactIds.length === 0
      ? { data: [], error: null }
      : await client
          .from("lukas_qto_preflight_approvals")
          .select("id, artifact_id, decision, note, created_at")
          .in("artifact_id", preflightArtifactIds)
          .order("created_at", { ascending: false })
          .order("id", { ascending: false });
  if (preflightApprovalsError)
    throw new Response("사전검토 승인 이력을 불러오지 못했습니다.", {
      status: 500,
    });

  const signedLinks = await Promise.all(
    (files ?? []).map(async (file) => {
      const { data: signed } = await client.storage
        .from("lukas-qto")
        .createSignedUrl(file.storage_path, 300);
      return [file.id, signed?.signedUrl ?? null] as const;
    }),
  );

  return {
    project,
    files: files ?? [],
    reviews: reviews ?? [],
    shares: shares ?? [],
    suggestions: suggestions ?? [],
    suggestionDecisions: suggestionDecisionRows ?? [],
    suggestionEvaluation: buildSuggestionEvaluation(
      suggestions ?? [],
      suggestionDecisionRows ?? [],
    ),
    takeoffArtifacts: takeoffArtifacts ?? [],
    takeoffApprovals: takeoffApprovalRows ?? [],
    fileRevisions: fileRevisions ?? [],
    preflightArtifacts: preflightArtifacts ?? [],
    preflightApprovals: preflightApprovalRows ?? [],
    materialPlans: materialPlans ?? [],
    signedUrls: Object.fromEntries(signedLinks),
    publicShareEnabled: true,
    isStaff: user.app_metadata.role === "hangil_staff",
    isOwner: project.owner_id === user.id,
    suggestionPilotEnabled:
      user.app_metadata.role === "hangil_staff" &&
      process.env.LUKAS_ENABLE_AI_PILOT === "true",
  };
}

export async function action({ request, params }: Route.ActionArgs) {
  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "");
  const [client, headers] = makeServerClient(request);
  const {
    data: { user },
  } = await client.auth.getUser();
  if (!user || user.is_anonymous)
    return data(
      { error: "이메일 로그인이 필요합니다." },
      { status: 401, headers },
    );

  const { data: project } = await client
    .from("lukas_qto_projects")
    .select("id, owner_id")
    .eq("id", params.projectId)
    .single();
  if (!project)
    return data(
      { error: "프로젝트 접근 권한이 없습니다." },
      { status: 404, headers },
    );
  const returnPath = new URL(request.url).pathname;

  if (intent === "suggestion_feedback_export") {
    if (user.app_metadata.role !== "hangil_staff")
      return data(
        { error: "한길시스템 담당자만 평가 데이터를 내보낼 수 있습니다." },
        { status: 403, headers },
      );
    const { data: suggestions, error: suggestionsError } = await client
      .from("lukas_qto_suggestions")
      .select(
        "id, file_id, producer_kind, producer_version, source_sha256, suggestion_kind, subject_key, title, detail, confidence, evidence, created_at",
      )
      .eq("project_id", project.id)
      .order("created_at", { ascending: true });
    if (suggestionsError)
      return data(
        { error: "자동 검토 제안을 내보내지 못했습니다." },
        { status: 500, headers },
      );
    const suggestionIds = (suggestions ?? []).map(
      (suggestion) => suggestion.id,
    );
    const { data: decisions, error: decisionsError } =
      suggestionIds.length === 0
        ? { data: [], error: null }
        : await client
            .from("lukas_qto_suggestion_decisions")
            .select("suggestion_id, decision, decision_sequence, created_at")
            .in("suggestion_id", suggestionIds)
            .order("decision_sequence", { ascending: true });
    if (decisionsError)
      return data(
        { error: "사람의 검토 결정을 내보내지 못했습니다." },
        { status: 500, headers },
      );
    const payload = buildSuggestionFeedbackExport(
      project.id,
      new Date().toISOString(),
      suggestions ?? [],
      decisions ?? [],
    );
    const artifact = `${JSON.stringify(payload, null, 2)}\n`;
    await recordProjectExport(
      client,
      project.id,
      "suggestion_feedback_json",
      artifact,
    );
    headers.set("Content-Type", "application/json; charset=utf-8");
    headers.set(
      "Content-Disposition",
      `attachment; filename="lukas-qto-feedback-${project.id}.json"`,
    );
    headers.set("Cache-Control", "private, no-store");
    return new Response(artifact, { headers });
  }

  if (intent === "workflow") {
    if (user.app_metadata.role !== "hangil_staff")
      return data(
        { error: "한길시스템 담당자만 진행 상태를 변경할 수 있습니다." },
        { status: 403, headers },
      );
    const parsed = z
      .enum(workflowStatuses)
      .safeParse(formData.get("workflow_status"));
    if (!parsed.success)
      return data(
        { error: "진행 상태를 확인하세요." },
        { status: 400, headers },
      );
    const { error } = await client
      .from("lukas_qto_projects")
      .update({ workflow_status: parsed.data })
      .eq("id", project.id);
    if (error) return data({ error: error.message }, { status: 400, headers });
    return redirect(returnPath, { headers });
  }

  if (intent === "share") {
    const permission = formData.get("permission");
    if (permission !== "view" && permission !== "review") {
      return data(
        { error: "공유 권한을 선택하세요." },
        { status: 400, headers },
      );
    }
    const { error } = await client.from("lukas_qto_shares").insert({
      project_id: project.id,
      created_by: user.id,
      permission,
    });
    if (error) return data({ error: error.message }, { status: 400, headers });
    return redirect(returnPath, { headers });
  }

  if (intent === "review") {
    const parsed = z
      .object({
        fileId: z.string().uuid().optional(),
        status: z.enum(reviewStatuses),
        note: z.string().trim().min(1, "검토 메모를 입력하세요.").max(5000),
      })
      .safeParse({
        fileId: String(formData.get("file_id") ?? "") || undefined,
        status: formData.get("status"),
        note: formData.get("note"),
      });
    if (!parsed.success)
      return data(
        { error: parsed.error.issues[0]?.message },
        { status: 400, headers },
      );

    const { error } = await client.from("lukas_qto_reviews").insert({
      project_id: project.id,
      file_id: parsed.data.fileId ?? null,
      author_id: user.id,
      status: parsed.data.status,
      note: parsed.data.note,
    });
    if (error) return data({ error: error.message }, { status: 400, headers });
    return redirect(returnPath, { headers });
  }

  if (intent === "suggestion_decision") {
    const parsed = z
      .object({
        suggestionId: z.string().uuid(),
        decision: z.enum(suggestionDecisions),
        note: z.string().trim().max(2000),
      })
      .safeParse({
        suggestionId: formData.get("suggestion_id"),
        decision: formData.get("decision"),
        note: formData.get("note") ?? "",
      });
    if (!parsed.success)
      return data(
        { error: parsed.error.issues[0]?.message ?? "검토 결정을 확인하세요." },
        { status: 400, headers },
      );
    if (rejectedWithoutNote(parsed.data.decision, parsed.data.note))
      return data(
        { error: "수정이 필요한 이유를 메모에 입력하세요." },
        { status: 400, headers },
      );
    const { data: suggestion } = await client
      .from("lukas_qto_suggestions")
      .select("id")
      .eq("id", parsed.data.suggestionId)
      .eq("project_id", project.id)
      .maybeSingle();
    if (!suggestion)
      return data(
        { error: "이 프로젝트의 자동 검토 제안이 아닙니다." },
        { status: 404, headers },
      );
    const { error } = await client
      .from("lukas_qto_suggestion_decisions")
      .insert({
        suggestion_id: suggestion.id,
        decided_by: user.id,
        decision: parsed.data.decision,
        note: parsed.data.note,
      });
    if (error) return data({ error: error.message }, { status: 400, headers });
    return redirect(returnPath, { headers });
  }

  if (intent === "preflight_decision") {
    const parsed = z
      .object({
        artifactId: z.string().uuid(),
        decision: z.enum(takeoffDecisions),
        note: z.string().trim().max(2000),
      })
      .safeParse({
        artifactId: formData.get("artifact_id"),
        decision: formData.get("decision"),
        note: formData.get("note") ?? "",
      });
    if (!parsed.success)
      return data(
        {
          error:
            parsed.error.issues[0]?.message ?? "사전검토 결정을 확인하세요.",
        },
        { status: 400, headers },
      );
    if (rejectedWithoutNote(parsed.data.decision, parsed.data.note))
      return data(
        { error: "수정이 필요한 이유를 메모에 입력하세요." },
        { status: 400, headers },
      );
    const { data: artifact } = await client
      .from("lukas_qto_preflight_artifacts")
      .select("id")
      .eq("id", parsed.data.artifactId)
      .eq("project_id", project.id)
      .maybeSingle();
    if (!artifact)
      return data(
        { error: "이 프로젝트의 사전검토 결과가 아닙니다." },
        { status: 404, headers },
      );
    const { error } = await client
      .from("lukas_qto_preflight_approvals")
      .insert({
        artifact_id: artifact.id,
        decided_by: user.id,
        decision: parsed.data.decision,
        note: parsed.data.note,
      });
    if (error) return data({ error: error.message }, { status: 400, headers });
    return redirect(returnPath, { headers });
  }

  if (intent === "preflight_upload") {
    const reportFile = asFile(formData.get("preflight_report"));
    const manifestFile = asFile(formData.get("preflight_manifest"));
    if (!reportFile || !manifestFile)
      return data(
        {
          error: "L1 사전검토 결과 CSV와 산출 근거 기록 CSV를 함께 선택하세요.",
        },
        { status: 400, headers },
      );
    if (
      reportFile.size > maxTakeoffBundleBytes ||
      manifestFile.size > maxTakeoffBundleBytes
    )
      return data(
        { error: "사전검토 결과와 산출 근거 기록은 각각 20MB까지 지원합니다." },
        { status: 400, headers },
      );
    const reportBuffer = Buffer.from(await reportFile.arrayBuffer());
    const manifestBuffer = Buffer.from(await manifestFile.arrayBuffer());
    let verified: ReturnType<typeof verifyPreflightBundle>;
    try {
      verified = verifyPreflightBundle(
        reportBuffer,
        reportFile.name,
        manifestBuffer,
      );
    } catch (error) {
      return data(
        {
          error:
            error instanceof Error
              ? error.message
              : "사전검토 bundle을 검증하지 못했습니다.",
        },
        { status: 400, headers },
      );
    }
    const inputHashes = Object.values(verified.inputs).map(
      (input) => input.sha256,
    );
    const { data: sourceFiles, error: sourceFilesError } = await client
      .from("lukas_qto_files")
      .select("id, kind, sha256, original_filename")
      .eq("project_id", project.id)
      .in("sha256", [...new Set(inputHashes)]);
    if (sourceFilesError)
      return data(
        { error: "사전검토 실행 원본을 확인하지 못했습니다." },
        { status: 500, headers },
      );
    let resolvedInputs: ReturnType<typeof resolvePreflightInputs>;
    try {
      resolvedInputs = resolvePreflightInputs(
        verified.inputs,
        sourceFiles ?? [],
      );
    } catch (error) {
      return data(
        {
          error:
            error instanceof Error
              ? error.message
              : "사전검토 입력 연결에 실패했습니다.",
        },
        { status: 409, headers },
      );
    }

    const reportPath = storageObjectPath({
      ownerId: project.owner_id,
      projectId: project.id,
      originalFilename: reportFile.name,
    });
    const manifestPath = storageObjectPath({
      ownerId: project.owner_id,
      projectId: project.id,
      originalFilename: manifestFile.name,
    });
    const storedPaths: string[] = [];
    const storedFileIds: string[] = [];
    const rollback = async () => {
      if (storedFileIds.length)
        await client.from("lukas_qto_files").delete().in("id", storedFileIds);
      if (storedPaths.length)
        await client.storage.from("lukas-qto").remove(storedPaths);
    };
    for (const [path, bytes] of [
      [reportPath, reportBuffer],
      [manifestPath, manifestBuffer],
    ] as const) {
      const { error } = await client.storage
        .from("lukas-qto")
        .upload(path, bytes, { contentType: "text/csv", upsert: false });
      if (error) {
        await rollback();
        return data(
          { error: `사전검토 파일 저장 실패: ${error.message}` },
          { status: 400, headers },
        );
      }
      storedPaths.push(path);
    }
    const { data: fileRows, error: fileRowsError } = await client
      .from("lukas_qto_files")
      .insert([
        {
          project_id: project.id,
          uploaded_by: user.id,
          kind: "other",
          storage_path: reportPath,
          original_filename: reportFile.name,
          content_type: "text/csv",
          byte_size: reportFile.size,
          sha256: verified.reportSha256,
          immutable: true,
        },
        {
          project_id: project.id,
          uploaded_by: user.id,
          kind: "other",
          storage_path: manifestPath,
          original_filename: manifestFile.name,
          content_type: "text/csv",
          byte_size: manifestFile.size,
          sha256: verified.manifestSha256,
          immutable: true,
        },
      ])
      .select("id, storage_path");
    if (fileRowsError || !fileRows || fileRows.length !== 2) {
      await rollback();
      return data(
        {
          error: `사전검토 파일 기록 실패: ${fileRowsError?.message ?? "파일 ID가 없습니다."}`,
        },
        { status: 400, headers },
      );
    }
    storedFileIds.push(...fileRows.map((row) => row.id));
    const reportRow = fileRows.find((row) => row.storage_path === reportPath);
    const manifestRow = fileRows.find(
      (row) => row.storage_path === manifestPath,
    );
    if (!reportRow || !manifestRow) {
      await rollback();
      return data(
        { error: "사전검토 파일 연결에 실패했습니다." },
        { status: 500, headers },
      );
    }
    let artifactId: string | null = null;
    let adminClient:
      | Awaited<typeof import("~/core/lib/supa-admin-client.server")>["default"]
      | null = null;
    let artifactError: { message: string } | null = null;
    try {
      ({ default: adminClient } = await import(
        "~/core/lib/supa-admin-client.server"
      ));
      const result = await adminClient
        .from("lukas_qto_preflight_artifacts")
        .insert({
          project_id: project.id,
          format_version: verified.formatVersion,
          ruleset_version: verified.rulesetVersion,
          scope_id: verified.scopeId,
          report_file_id: reportRow.id,
          manifest_file_id: manifestRow.id,
          report_sha256: verified.reportSha256,
          manifest_sha256: verified.manifestSha256,
          quantity_tolerance: verified.quantityTolerance,
          krw_tolerance: verified.krwTolerance,
          row_count: verified.rowCount,
          status_counts: verified.statusCounts,
          created_by: user.id,
        })
        .select("id")
        .single();
      artifactError = result.error;
      artifactId = result.data?.id ?? null;
      if (!artifactError && !artifactId)
        artifactError = { message: "사전검토 artifact ID가 없습니다." };
      if (!artifactError && artifactId) {
        const { error } = await adminClient
          .from("lukas_qto_preflight_inputs")
          .insert(
            resolvedInputs.map((input) => ({
              artifact_id: artifactId as string,
              project_id: project.id,
              input_role: input.role,
              file_id: input.file.id,
              source_sha256: input.input.sha256,
              source_id: input.input.sourceId,
            })),
          );
        artifactError = error;
      }
    } catch (error) {
      artifactError = {
        message:
          error instanceof Error
            ? error.message
            : "서버 승인 클라이언트를 시작하지 못했습니다.",
      };
    }
    if (artifactError) {
      if (artifactId && adminClient)
        await adminClient
          .from("lukas_qto_preflight_artifacts")
          .delete()
          .eq("id", artifactId);
      await rollback();
      return data(
        { error: `사전검토 등록 실패: ${artifactError.message}` },
        { status: 400, headers },
      );
    }
    return redirect(returnPath, { headers });
  }

  if (intent === "takeoff_decision") {
    const parsed = z
      .object({
        artifactId: z.string().uuid(),
        decision: z.enum(takeoffDecisions),
        note: z.string().trim().max(2000),
      })
      .safeParse({
        artifactId: formData.get("artifact_id"),
        decision: formData.get("decision"),
        note: formData.get("note") ?? "",
      });
    if (!parsed.success)
      return data(
        {
          error:
            parsed.error.issues[0]?.message ?? "산출 근거 결정을 확인하세요.",
        },
        { status: 400, headers },
      );
    if (rejectedWithoutNote(parsed.data.decision, parsed.data.note))
      return data(
        { error: "수정이 필요한 이유를 메모에 입력하세요." },
        { status: 400, headers },
      );
    const { data: artifact } = await client
      .from("lukas_qto_takeoff_artifacts")
      .select("id")
      .eq("id", parsed.data.artifactId)
      .eq("project_id", project.id)
      .maybeSingle();
    if (!artifact)
      return data(
        { error: "이 프로젝트의 산출 근거가 아닙니다." },
        { status: 404, headers },
      );
    const { error } = await client.from("lukas_qto_takeoff_approvals").insert({
      artifact_id: artifact.id,
      decided_by: user.id,
      decision: parsed.data.decision,
      note: parsed.data.note,
    });
    if (error) return data({ error: error.message }, { status: 400, headers });
    return redirect(returnPath, { headers });
  }

  if (intent === "takeoff_upload") {
    const reportFile = asFile(formData.get("takeoff_report"));
    const manifestFile = asFile(formData.get("takeoff_manifest"));
    if (!reportFile || !manifestFile)
      return data(
        {
          error:
            "Core가 만든 산출 결과 CSV와 산출 근거 기록 CSV를 함께 선택하세요.",
        },
        { status: 400, headers },
      );
    if (
      reportFile.size > maxTakeoffBundleBytes ||
      manifestFile.size > maxTakeoffBundleBytes
    ) {
      return data(
        { error: "산출 결과와 산출 근거 기록은 각각 20MB까지 지원합니다." },
        { status: 400, headers },
      );
    }
    const reportBuffer = Buffer.from(await reportFile.arrayBuffer());
    const manifestBuffer = Buffer.from(await manifestFile.arrayBuffer());
    let verified: ReturnType<typeof verifyConcreteTakeoffBundle>;
    try {
      verified = verifyConcreteTakeoffBundle(
        reportBuffer,
        reportFile.name,
        manifestBuffer,
      );
    } catch (error) {
      return data(
        {
          error:
            error instanceof Error
              ? error.message
              : "산출 근거 bundle을 검증하지 못했습니다.",
        },
        { status: 400, headers },
      );
    }

    const inputEntries = Object.entries(verified.inputSha256) as [
      keyof typeof verified.inputSha256,
      string,
    ][];
    const { data: sourceFiles, error: sourceFilesError } = await client
      .from("lukas_qto_files")
      .select("id, kind, sha256")
      .eq("project_id", project.id)
      .in("sha256", [...new Set(inputEntries.map(([, hash]) => hash))]);
    if (sourceFilesError)
      return data(
        { error: "산출 계산에 사용된 원본 파일을 확인하지 못했습니다." },
        { status: 500, headers },
      );
    let resolvedInputs: ReturnType<typeof resolveConcreteTakeoffInputs>;
    try {
      resolvedInputs = resolveConcreteTakeoffInputs(
        verified.inputSha256,
        sourceFiles ?? [],
      );
    } catch (error) {
      return data(
        {
          error:
            error instanceof Error
              ? error.message
              : "산출 입력 원본 연결에 실패했습니다.",
        },
        { status: 409, headers },
      );
    }

    const reportPath = storageObjectPath({
      ownerId: project.owner_id,
      projectId: project.id,
      originalFilename: reportFile.name,
    });
    const manifestPath = storageObjectPath({
      ownerId: project.owner_id,
      projectId: project.id,
      originalFilename: manifestFile.name,
    });
    const storedPaths: string[] = [];
    const storedFileIds: string[] = [];
    const rollback = async () => {
      if (storedFileIds.length > 0)
        await client.from("lukas_qto_files").delete().in("id", storedFileIds);
      if (storedPaths.length > 0)
        await client.storage.from("lukas-qto").remove(storedPaths);
    };
    for (const [path, bytes, contentType] of [
      [reportPath, reportBuffer, "text/csv"],
      [manifestPath, manifestBuffer, "text/csv"],
    ] as const) {
      const { error } = await client.storage
        .from("lukas-qto")
        .upload(path, bytes, { contentType, upsert: false });
      if (error) {
        await rollback();
        return data(
          { error: `산출 근거 파일 저장 실패: ${error.message}` },
          { status: 400, headers },
        );
      }
      storedPaths.push(path);
    }
    const { data: fileRows, error: fileRowsError } = await client
      .from("lukas_qto_files")
      .insert([
        {
          project_id: project.id,
          uploaded_by: user.id,
          kind: "other",
          storage_path: reportPath,
          original_filename: reportFile.name,
          content_type: "text/csv",
          byte_size: reportFile.size,
          sha256: verified.reportSha256,
          immutable: true,
        },
        {
          project_id: project.id,
          uploaded_by: user.id,
          kind: "other",
          storage_path: manifestPath,
          original_filename: manifestFile.name,
          content_type: "text/csv",
          byte_size: manifestFile.size,
          sha256: verified.manifestSha256,
          immutable: true,
        },
      ])
      .select("id, storage_path");
    if (fileRowsError || !fileRows || fileRows.length !== 2) {
      await rollback();
      return data(
        {
          error: `산출 근거 파일 기록 실패: ${fileRowsError?.message ?? "파일 ID가 없습니다."}`,
        },
        { status: 400, headers },
      );
    }
    storedFileIds.push(...fileRows.map((row) => row.id));
    const reportRow = fileRows.find((row) => row.storage_path === reportPath);
    const manifestRow = fileRows.find(
      (row) => row.storage_path === manifestPath,
    );
    if (!reportRow || !manifestRow) {
      await rollback();
      return data(
        { error: "산출 근거 파일 연결에 실패했습니다." },
        { status: 500, headers },
      );
    }

    let artifactError: { message: string } | null = null;
    let artifactId: string | null = null;
    let adminClient:
      | Awaited<typeof import("~/core/lib/supa-admin-client.server")>["default"]
      | null = null;
    try {
      ({ default: adminClient } = await import(
        "~/core/lib/supa-admin-client.server"
      ));
      const result = await adminClient
        .from("lukas_qto_takeoff_artifacts")
        .insert({
          project_id: project.id,
          artifact_kind: "concrete_takeoff",
          format_version: verified.formatVersion,
          report_file_id: reportRow.id,
          manifest_file_id: manifestRow.id,
          report_sha256: verified.reportSha256,
          manifest_sha256: verified.manifestSha256,
          row_count: verified.rowCount,
          input_sha256: verified.inputSha256,
          status_counts: verified.statusCounts,
          created_by: user.id,
        })
        .select("id")
        .single();
      artifactError = result.error;
      artifactId = result.data?.id ?? null;
      if (!artifactError && !artifactId)
        artifactError = { message: "산출 artifact ID가 없습니다." };
      if (!artifactError && artifactId) {
        const { error: inputLinkError } = await adminClient
          .from("lukas_qto_takeoff_inputs")
          .insert(
            resolvedInputs.map((input) => ({
              artifact_id: artifactId as string,
              project_id: project.id,
              input_role: input.role,
              file_id: input.file.id,
              source_sha256: input.hash,
            })),
          );
        artifactError = inputLinkError;
      }
    } catch (error) {
      artifactError = {
        message:
          error instanceof Error
            ? error.message
            : "서버 승인 클라이언트를 시작하지 못했습니다.",
      };
    }
    if (artifactError) {
      if (artifactId && adminClient)
        await adminClient
          .from("lukas_qto_takeoff_artifacts")
          .delete()
          .eq("id", artifactId);
      await rollback();
      return data(
        { error: `산출 근거 등록 실패: ${artifactError.message}` },
        { status: 400, headers },
      );
    }
    return redirect(returnPath, { headers });
  }

  if (intent !== "upload")
    return data({ error: "알 수 없는 요청입니다." }, { status: 400, headers });
  const file = asFile(formData.get("source_file"));
  const kind = String(formData.get("kind") ?? "");
  if (!file)
    return data(
      { error: "업로드할 파일을 선택하세요." },
      { status: 400, headers },
    );
  if (!fileKinds.includes(kind as (typeof fileKinds)[number])) {
    return data({ error: "파일 종류를 선택하세요." }, { status: 400, headers });
  }
  const validatedKind = kind as (typeof fileKinds)[number];
  if (!fileMatchesKind(validatedKind, file.name)) {
    return data(
      {
        error: `${kindLabel(validatedKind)}에 맞는 파일을 선택하세요. ${fileKindHelp[validatedKind]}`,
      },
      { status: 400, headers },
    );
  }
  if (file.size > maxUploadBytes) {
    return data(
      { error: "현재 웹 업로드는 파일당 200MB까지 가능합니다." },
      { status: 400, headers },
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const sha256 = createHash("sha256").update(buffer).digest("hex");
  const { data: previousFile, error: previousFileError } =
    kind === "other"
      ? { data: null, error: null }
      : await client
          .from("lukas_qto_files")
          .select("id, storage_path, byte_size, sha256")
          .eq("project_id", project.id)
          .eq("kind", kind)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
  if (previousFileError)
    return data(
      { error: "이전 개정 파일을 확인하지 못했습니다." },
      { status: 500, headers },
    );
  if (previousFile?.sha256 === sha256)
    return data(
      { error: "내용이 같은 파일이 이미 최신 개정으로 등록돼 있습니다." },
      { status: 409, headers },
    );
  let automaticSuggestions: ReturnType<typeof buildElementLedgerSuggestions> =
    [];
  if (kind === "element_ledger") {
    if (buffer.length > maxAnalyzedLedgerBytes) {
      return data(
        {
          error:
            "자동 검토용 요소 원장은 20MB까지 지원합니다. 더 큰 파일은 담당자에게 전달하세요.",
        },
        { status: 400, headers },
      );
    }
    const currentLedgerText = buffer.toString("utf8");
    try {
      automaticSuggestions = buildElementLedgerSuggestions(
        currentLedgerText,
        sha256,
      );
    } catch (error) {
      return data(
        {
          error:
            error instanceof Error
              ? error.message
              : "요소 원장을 읽지 못했습니다.",
        },
        { status: 400, headers },
      );
    }
    if (previousFile) {
      if (previousFile.byte_size > maxAnalyzedLedgerBytes) {
        automaticSuggestions.push(
          revisionComparisonUnavailable(
            sha256,
            previousFile.sha256,
            "PREVIOUS_LEDGER_TOO_LARGE",
          ),
        );
      } else {
        const { data: previousBlob, error: previousDownloadError } =
          await client.storage
            .from("lukas-qto")
            .download(previousFile.storage_path);
        if (previousDownloadError || !previousBlob) {
          automaticSuggestions.push(
            revisionComparisonUnavailable(
              sha256,
              previousFile.sha256,
              "PREVIOUS_LEDGER_DOWNLOAD_FAILED",
            ),
          );
        } else {
          try {
            automaticSuggestions.push(
              ...buildElementLedgerRevisionSuggestions(
                currentLedgerText,
                sha256,
                await previousBlob.text(),
                previousFile.sha256,
              ),
            );
          } catch {
            automaticSuggestions.push(
              revisionComparisonUnavailable(
                sha256,
                previousFile.sha256,
                "PREVIOUS_LEDGER_INVALID",
              ),
            );
          }
        }
      }
    }
  }
  const originalFilename = file.name || "source-file";
  const storagePath = storageObjectPath({
    ownerId: project.owner_id,
    projectId: project.id,
    originalFilename,
  });
  const { error: storageError } = await client.storage
    .from("lukas-qto")
    .upload(storagePath, buffer, {
      contentType: file.type || "application/octet-stream",
      upsert: false,
    });
  if (storageError)
    return data(
      { error: `파일 저장 실패: ${storageError.message}` },
      { status: 400, headers },
    );

  const { data: createdFile, error: metadataError } = await client
    .from("lukas_qto_files")
    .insert({
      project_id: project.id,
      uploaded_by: user.id,
      kind,
      storage_path: storagePath,
      original_filename: originalFilename,
      content_type: file.type || null,
      byte_size: file.size,
      sha256,
      immutable: true,
    })
    .select("id")
    .single();
  if (metadataError || !createdFile) {
    await client.storage.from("lukas-qto").remove([storagePath]);
    return data(
      {
        error: `파일 기록 실패: ${metadataError?.message ?? "파일 ID가 없습니다."}`,
      },
      { status: 400, headers },
    );
  }

  if (automaticSuggestions.length > 0 || previousFile) {
    let revisionCreated = false;
    let adminClient:
      | Awaited<typeof import("~/core/lib/supa-admin-client.server")>["default"]
      | null = null;
    try {
      ({ default: adminClient } = await import(
        "~/core/lib/supa-admin-client.server"
      ));
      if (previousFile) {
        const { error: revisionError } = await adminClient
          .from("lukas_qto_file_revisions")
          .insert({
            project_id: project.id,
            previous_file_id: previousFile.id,
            previous_sha256: previousFile.sha256,
            current_file_id: createdFile.id,
            current_sha256: sha256,
            relation_kind: "supersedes",
            created_by: user.id,
          });
        if (revisionError)
          throw new Error(`개정 연결 기록 실패: ${revisionError.message}`);
        revisionCreated = true;
      }
      if (automaticSuggestions.length > 0) {
        const batchId = crypto.randomUUID();
        const { error: suggestionError } = await adminClient
          .from("lukas_qto_suggestions")
          .insert(
            automaticSuggestions.map((suggestion) => ({
              batch_id: batchId,
              project_id: project.id,
              file_id: createdFile.id,
              created_by: user.id,
              producer_kind: "rule",
              producer_version: LEDGER_REVIEW_VERSION,
              source_sha256: sha256,
              suggestion_kind: suggestion.suggestionKind,
              subject_key: suggestion.subjectKey,
              title: suggestion.title,
              detail: suggestion.detail,
              confidence: suggestion.confidence,
              evidence: suggestion.evidence,
            })),
          );
        if (suggestionError)
          throw new Error(`자동 검토 기록 실패: ${suggestionError.message}`);
      }
    } catch (error) {
      if (revisionCreated && adminClient)
        await adminClient
          .from("lukas_qto_file_revisions")
          .delete()
          .eq("current_file_id", createdFile.id);
      await client.from("lukas_qto_files").delete().eq("id", createdFile.id);
      await client.storage.from("lukas-qto").remove([storagePath]);
      return data(
        {
          error:
            error instanceof Error
              ? error.message
              : "자동 검토·개정 연결 기록에 실패했습니다.",
        },
        { status: 400, headers },
      );
    }
  }

  return redirect(returnPath, { headers });
}

export default function Project({
  loaderData,
  actionData,
}: Route.ComponentProps) {
  const { pathname } = useLocation();
  const navigation = useNavigation();
  const [searchParams] = useSearchParams();
  const requestedUploadKind = searchParams.get("kind");
  const [uploadKind, setUploadKind] = useState<(typeof fileKinds)[number]>(
    () =>
      fileKinds.includes(requestedUploadKind as (typeof fileKinds)[number])
        ? (requestedUploadKind as (typeof fileKinds)[number])
        : "ifc",
  );
  useEffect(() => {
    if (fileKinds.includes(requestedUploadKind as (typeof fileKinds)[number]))
      setUploadKind(requestedUploadKind as (typeof fileKinds)[number]);
  }, [requestedUploadKind]);
  const uploadBusy =
    navigation.state !== "idle" &&
    navigation.formData?.get("intent") === "upload";
  const view: ProjectWorkspaceView = pathname.endsWith("/files")
    ? "files"
    : pathname.endsWith("/quantities")
      ? "quantities"
      : pathname.endsWith("/reviews")
        ? "reviews"
        : "overview";
  const ifcFile = loaderData.files.find((file) => file.kind === "ifc");
  const qtoFile = loaderData.files.find((file) => file.kind === "qto_csv");
  const elementLedgerFile = loaderData.files.find(
    (file) => file.kind === "element_ledger",
  );
  const mappingFile = loaderData.files.find((file) => file.kind === "mapping");
  const supportingSourceCount = loaderData.files.filter(
    (file) => file.kind === "other",
  ).length;
  const hasConcreteSourceSet = Boolean(
    ifcFile &&
      qtoFile &&
      elementLedgerFile &&
      mappingFile &&
      supportingSourceCount >= 3,
  );
  const hasReview = loaderData.reviews.length > 0;
  const latestDecisionBySuggestion = new Map<
    string,
    (typeof loaderData.suggestionDecisions)[number]
  >();
  for (const decision of loaderData.suggestionDecisions) {
    if (!latestDecisionBySuggestion.has(decision.suggestion_id))
      latestDecisionBySuggestion.set(decision.suggestion_id, decision);
  }
  const latestTakeoffApprovalByArtifact = new Map<
    string,
    (typeof loaderData.takeoffApprovals)[number]
  >();
  for (const approval of loaderData.takeoffApprovals) {
    if (!latestTakeoffApprovalByArtifact.has(approval.artifact_id))
      latestTakeoffApprovalByArtifact.set(approval.artifact_id, approval);
  }
  const fileById = new Map(loaderData.files.map((file) => [file.id, file]));
  const latestPreflightApprovalByArtifact = new Map<
    string,
    (typeof loaderData.preflightApprovals)[number]
  >();
  for (const approval of loaderData.preflightApprovals)
    if (!latestPreflightApprovalByArtifact.has(approval.artifact_id))
      latestPreflightApprovalByArtifact.set(approval.artifact_id, approval);
  const pendingTakeoffArtifacts = loaderData.takeoffArtifacts.filter(
    (artifact) => {
      const latest = latestTakeoffApprovalByArtifact.get(artifact.id);
      return !latest || latest.decision === "deferred";
    },
  );
  const pendingPreflightArtifacts = loaderData.preflightArtifacts.filter(
    (artifact) => {
      const latest = latestPreflightApprovalByArtifact.get(artifact.id);
      return !latest || latest.decision === "deferred";
    },
  );
  const pendingQuantityApprovalCount =
    pendingTakeoffArtifacts.length + pendingPreflightArtifacts.length;
  const pendingSuggestionCount = loaderData.suggestions.filter((suggestion) => {
    const latest = latestDecisionBySuggestion.get(suggestion.id);
    return !latest || latest.decision === "deferred";
  }).length;
  const firstPendingQuantityArtifactId =
    pendingTakeoffArtifacts[0]?.id ?? pendingPreflightArtifacts[0]?.id;
  const openReviewCount = loaderData.reviews.filter(
    (review) => review.status !== "resolved",
  ).length;
  const stages = [
    {
      done: hasConcreteSourceSet,
      label: "파일",
      detail: "산출 입력 7종",
    },
    {
      done: Boolean(
        loaderData.takeoffArtifacts.length ||
          loaderData.preflightArtifacts.length,
      ),
      label: "물량",
      detail: "산출 또는 검산 결과",
    },
    {
      done: Boolean(
        loaderData.takeoffApprovals.length ||
          loaderData.preflightApprovals.length ||
          loaderData.suggestionDecisions.length ||
          hasReview,
      ),
      label: "검토",
      detail: "사람의 결정 기록",
    },
    {
      done: loaderData.materialPlans.length > 0,
      label: "자재",
      detail: "승인 물량 이후 관리",
    },
  ];
  const completedStages = stages.filter((stage) => stage.done).length;
  const nextAction = !ifcFile
    ? {
        label: "IFC 파일 추가",
        detail: "Revit에서 내보낸 원본을 먼저 보관하세요.",
        href: `/projects/${loaderData.project.id}/files?kind=ifc#upload`,
      }
    : !qtoFile
      ? {
          label: "QTO CSV 추가",
          detail: "Revit에서 만든 분류별 수량표를 연결하세요.",
          href: `/projects/${loaderData.project.id}/files?kind=qto_csv#upload`,
        }
      : !elementLedgerFile
        ? {
            label: "객체별 수량표 추가",
            detail: "각 객체의 수량과 Element ID가 담긴 CSV를 연결하세요.",
            href: `/projects/${loaderData.project.id}/files?kind=element_ledger#upload`,
          }
        : !mappingFile
          ? {
              label: "내역 연결표 추가",
              detail: "모델 객체와 내역 항목을 연결한 CSV를 추가하세요.",
              href: `/projects/${loaderData.project.id}/files?kind=mapping#upload`,
            }
          : supportingSourceCount < 3
            ? {
                label: `계산 근거 파일 추가 (${supportingSourceCount}/3)`,
                detail: "내보내기 기록·계산 규칙·승인표를 각각 보관하세요.",
                href: `/projects/${loaderData.project.id}/files?kind=other#upload`,
              }
            : loaderData.takeoffArtifacts.length === 0
              ? {
                  label: "물량 산출 결과 등록",
                  detail: "추출 결과를 계산 근거와 함께 등록하세요.",
                  href: `/projects/${loaderData.project.id}/quantities`,
                }
              : pendingQuantityApprovalCount > 0
                ? {
                    label: `물량 확인 대기 ${pendingQuantityApprovalCount}건`,
                    detail:
                      "계산 근거를 확인하고 승인 또는 수정 필요를 기록하세요.",
                    href: `/projects/${loaderData.project.id}/quantities#quantity-decisions`,
                  }
                : pendingSuggestionCount + openReviewCount > 0
                  ? {
                      label: `검토 대기 ${pendingSuggestionCount + openReviewCount}건`,
                      detail: "자동 점검 경고와 검토 메모를 확인하세요.",
                      href: `/projects/${loaderData.project.id}/reviews`,
                    }
                  : loaderData.materialPlans.length === 0
                    ? {
                        label: "자재 계획 확인",
                        detail: "승인된 물량을 발주·입고 흐름으로 연결하세요.",
                        href: `/projects/${loaderData.project.id}/materials`,
                      }
                    : {
                        label: "최근 변경 확인",
                        detail: "새 파일과 검토 기록을 확인하세요.",
                        href: `/projects/${loaderData.project.id}/reviews`,
                      };
  const recentActivities = [
    ...loaderData.files.map((file) => ({
      id: `file-${file.id}`,
      label: `${kindLabel(file.kind)} 추가`,
      detail: file.original_filename,
      at: file.created_at,
    })),
    ...loaderData.reviews.map((review) => ({
      id: `review-${review.id}`,
      label: "검토 메모 기록",
      detail: statusLabel(review.status),
      at: review.updated_at,
    })),
    ...loaderData.takeoffArtifacts.map((artifact) => ({
      id: `takeoff-${artifact.id}`,
      label: "물량 산출 결과 등록",
      detail: `${artifact.row_count}행`,
      at: artifact.created_at,
    })),
    ...loaderData.preflightArtifacts.map((artifact) => ({
      id: `preflight-${artifact.id}`,
      label: "물량 검산 결과 등록",
      detail: artifact.ruleset_version,
      at: artifact.created_at,
    })),
  ]
    .sort((left, right) => Date.parse(right.at) - Date.parse(left.at))
    .slice(0, 3);
  return (
    <main className="mx-auto w-full max-w-6xl px-4 pb-28 pt-6 sm:px-8 sm:pb-12 sm:pt-10">
      <Link
        className="inline-flex min-h-11 items-center text-sm font-medium text-muted-foreground underline underline-offset-4"
        to="/workspace"
      >
        ← 내 프로젝트
      </Link>
      <header className="mt-2 flex flex-col gap-2 border-b border-border pb-6">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-[#efefff] px-3 py-1.5 text-xs font-bold text-[#3024d8] dark:bg-[#3024d8]/30 dark:text-[#c9c5ff]">
            {workflowLabels[
              loaderData.project.workflow_status as keyof typeof workflowLabels
            ] ?? loaderData.project.workflow_status}
          </span>
          <span className="text-xs text-muted-foreground">
            {view === "overview"
              ? "프로젝트 개요"
              : view === "files"
                ? "파일"
                : view === "quantities"
                  ? "물량"
                  : "검토"}
          </span>
        </div>
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
          {loaderData.project.name}
        </h1>
        {loaderData.project.description ? (
          <p className="max-w-3xl text-sm leading-6 text-muted-foreground sm:text-base">
            {loaderData.project.description}
          </p>
        ) : null}
        <div className="flex flex-wrap items-center gap-3">
          {loaderData.project.contact_name ? (
            <span className="text-sm text-muted-foreground">
              담당자 {loaderData.project.contact_name}
              {loaderData.project.contact_phone
                ? ` · ${loaderData.project.contact_phone}`
                : ""}
            </span>
          ) : null}
        </div>
      </header>

      <ProjectWorkspaceNav
        current={view}
        pendingQuantities={pendingQuantityApprovalCount}
        pendingReviews={pendingSuggestionCount + openReviewCount}
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

      {view === "overview" ? (
        <>
          <section className="mt-6 overflow-hidden rounded-3xl bg-[#17124a] p-6 text-white shadow-lg shadow-indigo-950/10 sm:p-8">
            <p className="text-xs font-bold tracking-[0.18em] text-[#b9b5ff]">
              지금 할 일
            </p>
            <div className="mt-3 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
                  {nextAction.label}
                </h2>
                <p className="mt-2 max-w-xl text-sm leading-6 text-indigo-100">
                  {nextAction.detail}
                </p>
              </div>
              <Button
                asChild
                className="min-h-12 bg-white text-[#17124a] hover:bg-indigo-50"
              >
                <Link to={nextAction.href}>
                  시작하기
                  <ArrowRight className="size-4" />
                </Link>
              </Button>
            </div>
          </section>

          <section
            aria-label="프로젝트 요약"
            className="mt-4 grid grid-cols-3 gap-2 sm:gap-4"
          >
            {[
              { label: "프로젝트 파일", value: loaderData.files.length },
              {
                label: "확인 필요",
                value:
                  pendingQuantityApprovalCount +
                  pendingSuggestionCount +
                  openReviewCount,
              },
              { label: "진행 단계", value: `${completedStages}/4` },
            ].map((metric) => (
              <div
                className="rounded-2xl border bg-card p-4 shadow-sm"
                key={metric.label}
              >
                <p className="text-xl font-bold sm:text-2xl">{metric.value}</p>
                <p className="mt-1 text-[11px] text-muted-foreground sm:text-xs">
                  {metric.label}
                </p>
              </div>
            ))}
          </section>

          <section className="mt-6 rounded-2xl border bg-card p-5 shadow-sm sm:p-6">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="font-semibold">진행 단계</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  파일 → 물량 → 검토 → 자재 순서로 이어집니다.
                </p>
              </div>
              <span className="text-sm font-bold text-[#3024d8]">
                {Math.round((completedStages / stages.length) * 100)}%
              </span>
            </div>
            <ol className="mt-5 grid grid-cols-4 gap-2">
              {stages.map((stage, index) => (
                <li className="min-w-0" key={stage.label}>
                  <div className="mb-3 flex items-center">
                    <span
                      className={`grid size-7 shrink-0 place-items-center rounded-full text-xs font-bold ${
                        stage.done
                          ? "bg-emerald-500 text-white"
                          : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {stage.done ? (
                        <CheckCircle2 className="size-4" />
                      ) : (
                        index + 1
                      )}
                    </span>
                    {index < stages.length - 1 ? (
                      <span
                        className={`h-0.5 flex-1 ${stage.done ? "bg-emerald-400" : "bg-muted"}`}
                      />
                    ) : null}
                  </div>
                  <p className="text-xs font-semibold sm:text-sm">
                    {stage.label}
                  </p>
                  <p className="mt-1 hidden text-xs leading-5 text-muted-foreground sm:block">
                    {stage.detail}
                  </p>
                </li>
              ))}
            </ol>
          </section>

          <section className="mt-6 grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
            <div className="rounded-2xl border bg-card p-5 shadow-sm sm:p-6">
              <div className="flex items-center justify-between gap-3">
                <h2 className="font-semibold">최근 활동</h2>
                <Link
                  className="text-sm font-medium text-[#3024d8]"
                  to={`/projects/${loaderData.project.id}/reviews`}
                >
                  전체 보기
                </Link>
              </div>
              {recentActivities.length === 0 ? (
                <p className="mt-4 rounded-xl bg-muted/50 p-4 text-sm text-muted-foreground">
                  아직 기록이 없습니다. 첫 파일을 추가해 주세요.
                </p>
              ) : (
                <ol className="mt-3 divide-y">
                  {recentActivities.map((activity) => (
                    <li
                      className="flex items-start justify-between gap-4 py-3"
                      key={activity.id}
                    >
                      <div>
                        <p className="text-sm font-medium">{activity.label}</p>
                        <p className="mt-1 line-clamp-1 text-xs text-muted-foreground">
                          {activity.detail}
                        </p>
                      </div>
                      <time
                        className="shrink-0 text-[11px] text-muted-foreground"
                        dateTime={activity.at}
                      >
                        {new Intl.DateTimeFormat("ko-KR", {
                          month: "short",
                          day: "numeric",
                        }).format(new Date(activity.at))}
                      </time>
                    </li>
                  ))}
                </ol>
              )}
            </div>

            <div className="rounded-2xl border bg-card p-5 shadow-sm sm:p-6">
              <h2 className="font-semibold">전체 도구</h2>
              <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-1">
                <Link
                  className="flex min-h-11 items-center justify-between rounded-xl bg-muted/50 px-4 text-sm font-medium hover:bg-muted"
                  to={`/projects/${loaderData.project.id}/element-identities`}
                >
                  모델 요소 연결 <ArrowRight className="size-4" />
                </Link>
                <Link
                  className="flex min-h-11 items-center justify-between rounded-xl bg-muted/50 px-4 text-sm font-medium hover:bg-muted"
                  to={`/projects/${loaderData.project.id}/information-requirements`}
                >
                  설계 요구사항 검사 <ArrowRight className="size-4" />
                </Link>
                {loaderData.isOwner || loaderData.isStaff ? (
                  <Link
                    className="flex min-h-11 items-center justify-between rounded-xl bg-muted/50 px-4 text-sm font-medium hover:bg-muted"
                    to={`/projects/${loaderData.project.id}/members`}
                  >
                    구성원·역할 <ArrowRight className="size-4" />
                  </Link>
                ) : null}
                {loaderData.suggestionPilotEnabled ? (
                  <Link
                    className="flex min-h-11 items-center justify-between rounded-xl bg-muted/50 px-4 text-sm font-medium hover:bg-muted"
                    to={`/projects/${loaderData.project.id}/suggestion-pilot`}
                  >
                    담당자 제안 파일럿 <ArrowRight className="size-4" />
                  </Link>
                ) : null}
              </div>
              {loaderData.isStaff ? (
                <details className="mt-4 rounded-xl border p-3">
                  <summary className="cursor-pointer text-sm font-medium">
                    프로젝트 상태 변경
                  </summary>
                  <Form className="mt-3 flex gap-2" method="post">
                    <input name="intent" type="hidden" value="workflow" />
                    <select
                      className="h-11 min-w-0 flex-1 rounded-md border bg-background px-3 text-sm text-foreground"
                      defaultValue={loaderData.project.workflow_status}
                      name="workflow_status"
                    >
                      {workflowStatuses.map((status) => (
                        <option key={status} value={status}>
                          {workflowLabels[status]}
                        </option>
                      ))}
                    </select>
                    <Button type="submit" variant="outline">
                      저장
                    </Button>
                  </Form>
                </details>
              ) : null}
            </div>
          </section>
        </>
      ) : null}

      {view === "files" ? (
        <>
          <div
            className="mt-6 grid gap-6 lg:grid-cols-[1.25fr_0.75fr]"
            id="upload"
          >
            <section className="rounded-2xl border bg-card p-6 shadow-sm">
              <div className="mb-5 flex items-center gap-3">
                <span className="rounded-xl bg-primary/10 p-2 text-primary">
                  <FileUp className="size-5" />
                </span>
                <div>
                  <h2 className="font-semibold">파일 추가</h2>
                  <p className="text-sm text-muted-foreground">
                    파일 종류를 고르면 맞는 형식만 선택할 수 있습니다.
                  </p>
                </div>
              </div>
              <Form
                className="grid gap-4 sm:grid-cols-[1fr_1fr_auto]"
                encType="multipart/form-data"
                method="post"
              >
                <input name="intent" type="hidden" value="upload" />
                <div className="grid gap-2">
                  <Label htmlFor="kind">자료 종류</Label>
                  <select
                    aria-describedby="kind-help"
                    className="h-11 rounded-md border bg-background px-3 text-sm"
                    id="kind"
                    name="kind"
                    onChange={(event) =>
                      setUploadKind(
                        event.currentTarget.value as (typeof fileKinds)[number],
                      )
                    }
                    required
                    value={uploadKind}
                  >
                    {fileKinds.map((kind) => (
                      <option key={kind} value={kind}>
                        {kindLabel(kind)}
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-muted-foreground" id="kind-help">
                    {fileKindHelp[uploadKind]}
                  </p>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="source_file">파일</Label>
                  <Input
                    accept={fileKindAccept[uploadKind]}
                    className="min-h-11"
                    disabled={uploadBusy}
                    id="source_file"
                    key={uploadKind}
                    name="source_file"
                    type="file"
                    required
                  />
                </div>
                <Button
                  className="min-h-11 self-end"
                  disabled={uploadBusy}
                  type="submit"
                >
                  {uploadBusy ? "업로드 중…" : "파일 업로드"}
                </Button>
              </Form>
              <p className="mt-4 text-xs text-muted-foreground">
                파일당 최대 200MB · 올린 원본은 바뀌지 않아 이후 결과와 안전하게
                비교할 수 있습니다.
              </p>
            </section>

            <aside className="rounded-2xl border bg-card p-6 shadow-sm">
              <div className="flex items-center gap-3">
                <span className="rounded-xl bg-emerald-500/10 p-2 text-emerald-600">
                  <ShieldCheck className="size-5" />
                </span>
                <div>
                  <h2 className="font-semibold">파일 보관 원칙</h2>
                  <p className="text-sm text-muted-foreground">
                    원본과 검토 메모를 분리합니다.
                  </p>
                </div>
              </div>
              <ul className="mt-4 space-y-2 text-sm text-muted-foreground">
                <li>• IFC/CSV 원본은 수정하지 않습니다.</li>
                <li>• 검토 상태와 메모만 별도로 기록합니다.</li>
                <li>• 다운로드 링크는 5분짜리 서명 URL입니다.</li>
              </ul>
            </aside>
          </div>

          <section className="mt-8 rounded-2xl border bg-card p-5 shadow-sm sm:p-6">
            <div className="mb-5 flex items-center gap-3">
              <FolderOpen className="size-5 text-primary" />
              <h2 className="font-semibold">
                프로젝트 파일 ({loaderData.files.length})
              </h2>
            </div>
            {loaderData.files.length === 0 ? (
              <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
                아직 보관된 파일이 없습니다.
              </p>
            ) : (
              <>
                <ul className="grid gap-3 sm:hidden">
                  {loaderData.files.map((file) => (
                    <li className="rounded-xl border p-4" key={file.id}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-xs font-bold text-[#3024d8]">
                            {kindLabel(file.kind)}
                          </p>
                          <p className="mt-1 break-words text-sm font-medium">
                            {file.original_filename}
                          </p>
                          <p className="mt-2 text-xs text-muted-foreground">
                            {(file.byte_size / 1024 / 1024).toFixed(2)} MB
                          </p>
                        </div>
                        <div className="flex shrink-0 flex-col items-end gap-2 text-sm">
                          {file.kind === "ifc" ? (
                            <Link
                              className="font-medium text-[#3024d8]"
                              to={`/projects/${loaderData.project.id}/ifc/${file.id}`}
                            >
                              3D·속성 보기
                            </Link>
                          ) : null}
                          {loaderData.signedUrls[file.id] ? (
                            <a
                              className="font-medium text-[#3024d8]"
                              href={loaderData.signedUrls[file.id] ?? "#"}
                            >
                              다운로드
                            </a>
                          ) : null}
                        </div>
                      </div>
                      <details className="mt-3 text-xs text-muted-foreground">
                        <summary className="cursor-pointer">원본 상세</summary>
                        <p className="mt-2 break-all font-mono">
                          확인번호 {file.sha256}
                        </p>
                      </details>
                    </li>
                  ))}
                </ul>
                <div className="hidden overflow-x-auto sm:block">
                  <table className="w-full min-w-[720px] text-left text-sm">
                    <thead className="border-b text-muted-foreground">
                      <tr>
                        <th className="pb-3 font-medium">종류</th>
                        <th className="pb-3 font-medium">파일</th>
                        <th className="pb-3 font-medium">크기</th>
                        <th className="pb-3 font-medium">파일 확인번호</th>
                        <th className="pb-3 font-medium"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {loaderData.files.map((file) => (
                        <tr className="border-b last:border-0" key={file.id}>
                          <td className="py-4">{kindLabel(file.kind)}</td>
                          <td className="py-4 font-medium">
                            {file.original_filename}
                          </td>
                          <td className="py-4 text-muted-foreground">
                            {(file.byte_size / 1024 / 1024).toFixed(2)} MB
                          </td>
                          <td
                            className="max-w-52 truncate py-4 font-mono text-xs text-muted-foreground"
                            title={file.sha256}
                          >
                            {file.sha256}
                          </td>
                          <td className="py-4 text-right">
                            <span className="inline-flex items-center gap-3">
                              {file.kind === "ifc" ? (
                                <Link
                                  className="inline-flex items-center gap-1 text-primary underline underline-offset-4"
                                  to={`/projects/${loaderData.project.id}/ifc/${file.id}`}
                                >
                                  <FileSearch className="size-3.5" />
                                  3D·속성 보기
                                </Link>
                              ) : null}
                              {loaderData.signedUrls[file.id] ? (
                                <a
                                  className="text-primary underline underline-offset-4"
                                  href={loaderData.signedUrls[file.id] ?? "#"}
                                >
                                  다운로드
                                </a>
                              ) : (
                                "링크 생성 실패"
                              )}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </section>

          <section className="mt-6 rounded-2xl border bg-card p-5 shadow-sm sm:p-6">
            <div className="flex items-start gap-3">
              <span className="rounded-xl bg-cyan-500/10 p-2 text-cyan-700">
                <GitCompareArrows className="size-5" />
              </span>
              <div>
                <h2 className="font-semibold">
                  파일 개정 ({loaderData.fileRevisions.length})
                </h2>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">
                  파일명이나 업로드 순서만으로 개정을 추정하지 않습니다. 같은
                  종류의 이전 파일과 새 파일을 개정 관계로 연결합니다.
                </p>
              </div>
            </div>
            {loaderData.fileRevisions.length === 0 ? (
              <p className="mt-5 rounded-xl border border-dashed p-5 text-sm text-muted-foreground">
                같은 종류의 두 번째 파일을 올리면 첫 개정 연결이 만들어집니다.
              </p>
            ) : (
              <ol className="mt-5 space-y-3">
                {loaderData.fileRevisions.map((revision) => {
                  const previous = fileById.get(revision.previous_file_id);
                  const current = fileById.get(revision.current_file_id);
                  return (
                    <li
                      className="grid gap-3 rounded-xl border p-4 md:grid-cols-[1fr_auto_1fr] md:items-center"
                      key={revision.id}
                    >
                      <div>
                        <p className="text-xs font-medium text-muted-foreground">
                          이전
                        </p>
                        <p className="mt-1 text-sm font-medium">
                          {previous?.original_filename ?? "원본 파일 없음"}
                        </p>
                        <p className="mt-1 break-all font-mono text-[10px] text-muted-foreground">
                          {revision.previous_sha256}
                        </p>
                      </div>
                      <GitCompareArrows className="size-5 text-primary" />
                      <div>
                        <p className="text-xs font-medium text-muted-foreground">
                          현재
                        </p>
                        <p className="mt-1 text-sm font-medium">
                          {current?.original_filename ?? "현재 파일 없음"}
                        </p>
                        <p className="mt-1 break-all font-mono text-[10px] text-muted-foreground">
                          {revision.current_sha256}
                        </p>
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}
          </section>
        </>
      ) : null}

      {view === "quantities" ? (
        <>
          <section
            className="mt-8 scroll-mt-24 rounded-2xl border bg-card p-6 shadow-sm"
            id={
              firstPendingQuantityArtifactId ? undefined : "quantity-decisions"
            }
          >
            <div className="flex flex-col gap-4 border-b pb-5 lg:flex-row lg:items-start lg:justify-between">
              <div className="flex items-start gap-3">
                <span className="rounded-xl bg-blue-500/10 p-2 text-blue-700">
                  <Calculator className="size-5" />
                </span>
                <div>
                  <h2 className="font-semibold">
                    물량 산출 결과 ({loaderData.takeoffArtifacts.length})
                  </h2>
                  <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">
                    Lukas QTO가 함께 만든 물량 결과와 계산 근거가 같은 작업에서
                    나온 파일인지 확인해 보관합니다.
                  </p>
                </div>
              </div>
              <Form
                className="grid w-full gap-3 lg:max-w-2xl lg:grid-cols-[1fr_1fr_auto]"
                encType="multipart/form-data"
                method="post"
              >
                <input name="intent" type="hidden" value="takeoff_upload" />
                <div className="grid gap-1.5">
                  <Label htmlFor="takeoff_report">① 물량 결과 CSV</Label>
                  <Input
                    accept=".csv,text/csv"
                    className="min-h-11"
                    id="takeoff_report"
                    name="takeoff_report"
                    required
                    type="file"
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="takeoff_manifest">② 계산 근거 CSV</Label>
                  <Input
                    accept=".csv,text/csv"
                    className="min-h-11"
                    id="takeoff_manifest"
                    name="takeoff_manifest"
                    required
                    type="file"
                  />
                </div>
                <Button
                  className="min-h-11 self-end"
                  type="submit"
                  variant="outline"
                >
                  두 파일 등록
                </Button>
              </Form>
            </div>
            <div className="mt-5 flex flex-col gap-3 rounded-2xl bg-[#17124a] p-5 text-white sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="font-semibold">승인 물량으로 내역·직접공사비 만들기</p>
                <p className="mt-1 text-sm leading-6 text-indigo-100">
                  품목과 고객 보유 단가를 연결하고, 계산식·Element ID 근거가 남는
                  검증 내역서를 작성합니다.
                </p>
              </div>
              <Button
                asChild
                className="min-h-11 shrink-0 bg-white text-[#17124a] hover:bg-indigo-50"
              >
                <Link to={`/projects/${loaderData.project.id}/boq`}>
                  검증 내역서 열기
                </Link>
              </Button>
            </div>
            {loaderData.takeoffArtifacts.length === 0 ? (
              <p className="mt-5 rounded-xl border border-dashed p-5 text-sm text-muted-foreground">
                아직 등록된 물량 결과가 없습니다. 프로그램이 함께 만든 두 CSV를
                위 순서대로 선택하세요.
              </p>
            ) : (
              <ul className="mt-5 space-y-4">
                {loaderData.takeoffArtifacts.map((artifact) => {
                  const latestApproval = latestTakeoffApprovalByArtifact.get(
                    artifact.id,
                  );
                  const statusCounts =
                    artifact.status_counts &&
                    typeof artifact.status_counts === "object" &&
                    !Array.isArray(artifact.status_counts)
                      ? (artifact.status_counts as Record<string, unknown>)
                      : {};
                  const inputHashes =
                    artifact.input_sha256 &&
                    typeof artifact.input_sha256 === "object" &&
                    !Array.isArray(artifact.input_sha256)
                      ? (artifact.input_sha256 as Record<string, unknown>)
                      : {};
                  return (
                    <li
                      className="scroll-mt-24 rounded-xl border p-5"
                      id={
                        artifact.id === firstPendingQuantityArtifactId
                          ? "quantity-decisions"
                          : undefined
                      }
                      key={artifact.id}
                    >
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium">
                              {artifact.format_version}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              {artifact.row_count}행
                            </span>
                            {latestApproval ? (
                              <span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-bold text-blue-700">
                                사람 결정:{" "}
                                {takeoffDecisionLabel(latestApproval.decision)}
                              </span>
                            ) : (
                              <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-bold text-amber-700">
                                사람 결정 대기
                              </span>
                            )}
                          </div>
                          <p
                            className="mt-3 font-mono text-xs text-muted-foreground"
                            title={artifact.report_sha256}
                          >
                            결과 파일 확인번호 · {artifact.report_sha256}
                          </p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            등록{" "}
                            {new Intl.DateTimeFormat("ko-KR", {
                              dateStyle: "medium",
                              timeStyle: "short",
                            }).format(new Date(artifact.created_at))}
                          </p>
                        </div>
                        <Button asChild size="sm" variant="outline">
                          <Link
                            to={`/projects/${loaderData.project.id}/takeoff/${artifact.id}`}
                          >
                            계산 근거 상세
                          </Link>
                        </Button>
                      </div>
                      <div className="mt-4 flex flex-wrap gap-2">
                        {Object.entries(statusCounts).map(([status, count]) => (
                          <span
                            className="rounded-lg bg-muted px-2.5 py-1 text-xs"
                            key={status}
                          >
                            {status} {String(count)}
                          </span>
                        ))}
                      </div>
                      <details className="mt-4 rounded-lg bg-muted/40 p-3">
                        <summary className="cursor-pointer text-xs font-medium">
                          원본·규칙 입력 파일 확인번호 7종
                        </summary>
                        <dl className="mt-3 grid gap-2">
                          {Object.entries(inputHashes).map(([name, hash]) => (
                            <div
                              className="grid gap-1 text-xs sm:grid-cols-[130px_1fr]"
                              key={name}
                            >
                              <dt className="font-medium">{name}</dt>
                              <dd className="break-all font-mono text-muted-foreground">
                                {String(hash)}
                              </dd>
                            </div>
                          ))}
                        </dl>
                      </details>
                      {latestApproval ? (
                        <p className="mt-3 text-xs text-muted-foreground">
                          최근 결정 메모: {latestApproval.note || "메모 없음"}
                        </p>
                      ) : null}
                      <Form
                        className="mt-4 grid gap-2 sm:grid-cols-[140px_1fr_auto]"
                        method="post"
                      >
                        <input
                          name="intent"
                          type="hidden"
                          value="takeoff_decision"
                        />
                        <input
                          name="artifact_id"
                          type="hidden"
                          value={artifact.id}
                        />
                        <div className="grid gap-1.5">
                          <Label htmlFor={`takeoff-decision-${artifact.id}`}>
                            결정
                          </Label>
                          <select
                            className="h-11 rounded-md border bg-background px-3 text-sm"
                            defaultValue={latestApproval?.decision ?? ""}
                            id={`takeoff-decision-${artifact.id}`}
                            name="decision"
                            required
                          >
                            <option disabled value="">
                              결정을 선택하세요
                            </option>
                            {takeoffDecisions.map((decision) => (
                              <option key={decision} value={decision}>
                                {takeoffDecisionLabel(decision)}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="grid gap-1.5">
                          <Label htmlFor={`takeoff-note-${artifact.id}`}>
                            판단 근거 (수정 필요 시 필수)
                          </Label>
                          <Input
                            className="min-h-11"
                            id={`takeoff-note-${artifact.id}`}
                            maxLength={2000}
                            name="note"
                            placeholder="확인한 내용과 다음 조치"
                          />
                        </div>
                        <Button
                          className="min-h-11 self-end"
                          type="submit"
                          variant="outline"
                        >
                          결정 기록
                        </Button>
                      </Form>
                    </li>
                  );
                })}
              </ul>
            )}
            <p className="mt-4 text-xs text-muted-foreground">
              승인 기록은 기존 행을 수정하지 않고 새 이력으로 추가됩니다. 최종
              수량은 계산식과 사람의 승인으로만 확정됩니다.
            </p>
          </section>

          <section className="mt-6 rounded-2xl border bg-card p-5 shadow-sm sm:p-6">
            <div className="flex flex-col gap-4 border-b pb-5 lg:flex-row lg:items-start lg:justify-between">
              <div className="flex items-start gap-3">
                <span className="rounded-xl bg-emerald-500/10 p-2 text-emerald-700">
                  <ClipboardCheck className="size-5" />
                </span>
                <div>
                  <h2 className="font-semibold">
                    물량 검산 ({loaderData.preflightArtifacts.length})
                  </h2>
                  <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">
                    검산 프로그램을 통과한 결과와 실행 기록을 함께 등록합니다.
                    사용한 QTO·내역서·매핑·IFC가 프로젝트 원본과 같은지
                    확인합니다.
                  </p>
                </div>
              </div>
              <Form
                className="grid w-full gap-3 lg:max-w-2xl lg:grid-cols-[1fr_1fr_auto]"
                encType="multipart/form-data"
                method="post"
              >
                <input name="intent" type="hidden" value="preflight_upload" />
                <div className="grid gap-1.5">
                  <Label htmlFor="preflight_report">① 검산 결과 CSV</Label>
                  <Input
                    accept=".csv,text/csv"
                    className="min-h-11"
                    id="preflight_report"
                    name="preflight_report"
                    required
                    type="file"
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="preflight_manifest">② 실행 기록 CSV</Label>
                  <Input
                    accept=".csv,text/csv"
                    className="min-h-11"
                    id="preflight_manifest"
                    name="preflight_manifest"
                    required
                    type="file"
                  />
                </div>
                <Button
                  className="min-h-11 self-end"
                  type="submit"
                  variant="outline"
                >
                  두 파일 등록
                </Button>
              </Form>
            </div>
            {loaderData.preflightArtifacts.length === 0 ? (
              <p className="mt-5 rounded-xl border border-dashed p-5 text-sm text-muted-foreground">
                Lukas QTO가 함께 만든 검산 결과와 실행 기록을 선택하세요. 사용한
                원본 파일은 먼저 파일 화면에 올려야 합니다.
              </p>
            ) : (
              <ul className="mt-5 space-y-4">
                {loaderData.preflightArtifacts.map((artifact) => {
                  const latest = latestPreflightApprovalByArtifact.get(
                    artifact.id,
                  );
                  const counts =
                    artifact.status_counts &&
                    typeof artifact.status_counts === "object" &&
                    !Array.isArray(artifact.status_counts)
                      ? (artifact.status_counts as Record<string, unknown>)
                      : {};
                  return (
                    <li
                      className="scroll-mt-24 rounded-xl border p-5"
                      id={
                        artifact.id === firstPendingQuantityArtifactId
                          ? "quantity-decisions"
                          : undefined
                      }
                      key={artifact.id}
                    >
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                          <div className="flex flex-wrap gap-2">
                            <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium">
                              {artifact.ruleset_version}
                            </span>
                            <span className="rounded-full bg-muted px-2.5 py-1 text-xs">
                              범위 {artifact.scope_id}
                            </span>
                            {latest ? (
                              <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-700">
                                사람 결정:{" "}
                                {takeoffDecisionLabel(latest.decision)}
                              </span>
                            ) : (
                              <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-bold text-amber-700">
                                결정 대기
                              </span>
                            )}
                          </div>
                          <p className="mt-3 font-mono text-xs text-muted-foreground">
                            결과 파일 확인번호 · {artifact.report_sha256}
                          </p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            허용오차 수량 {artifact.quantity_tolerance} · KRW{" "}
                            {artifact.krw_tolerance}
                          </p>
                        </div>
                        <Button asChild size="sm" variant="outline">
                          <Link
                            to={`/projects/${loaderData.project.id}/preflight/${artifact.id}`}
                          >
                            검산 근거 상세
                          </Link>
                        </Button>
                      </div>
                      <div className="mt-4 flex flex-wrap gap-2">
                        {Object.entries(counts).map(([status, count]) => (
                          <span
                            className="rounded-lg bg-muted px-2.5 py-1 text-xs"
                            key={status}
                          >
                            {status} {String(count)}
                          </span>
                        ))}
                      </div>
                      {latest ? (
                        <p className="mt-3 text-xs text-muted-foreground">
                          최근 결정 메모: {latest.note || "메모 없음"}
                        </p>
                      ) : null}
                      <Form
                        className="mt-4 grid gap-2 sm:grid-cols-[140px_1fr_auto]"
                        method="post"
                      >
                        <input
                          name="intent"
                          type="hidden"
                          value="preflight_decision"
                        />
                        <input
                          name="artifact_id"
                          type="hidden"
                          value={artifact.id}
                        />
                        <div className="grid gap-1.5">
                          <Label htmlFor={`preflight-decision-${artifact.id}`}>
                            결정
                          </Label>
                          <select
                            className="h-11 rounded-md border bg-background px-3 text-sm"
                            defaultValue={latest?.decision ?? ""}
                            id={`preflight-decision-${artifact.id}`}
                            name="decision"
                            required
                          >
                            <option disabled value="">
                              결정을 선택하세요
                            </option>
                            {takeoffDecisions.map((value) => (
                              <option key={value} value={value}>
                                {takeoffDecisionLabel(value)}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="grid gap-1.5">
                          <Label htmlFor={`preflight-note-${artifact.id}`}>
                            판단 근거 (수정 필요 시 필수)
                          </Label>
                          <Input
                            className="min-h-11"
                            id={`preflight-note-${artifact.id}`}
                            maxLength={2000}
                            name="note"
                            placeholder="확인한 내용과 다음 조치"
                          />
                        </div>
                        <Button
                          className="min-h-11 self-end"
                          type="submit"
                          variant="outline"
                        >
                          결정 기록
                        </Button>
                      </Form>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </>
      ) : null}

      {view === "reviews" ? (
        <>
          <section className="mt-8 rounded-2xl border bg-card p-6 shadow-sm">
            <div className="flex flex-col gap-2 border-b pb-5 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-3">
                <span className="rounded-xl bg-violet-500/10 p-2 text-violet-700">
                  <ShieldCheck className="size-5" />
                </span>
                <div>
                  <h2 className="font-semibold">
                    확인이 필요한 항목 ({loaderData.suggestions.length})
                  </h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    원본 파일 확인번호에 연결된 검사 결과입니다. 수량은 바꾸지
                    않으며 사람의 결정이 최종입니다.
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="w-fit rounded-full bg-muted px-3 py-1 text-xs font-medium text-muted-foreground">
                  정해진 규칙 점검 · 자동 승인 없음
                </span>
                {loaderData.isStaff ? (
                  <Form method="post">
                    <input
                      name="intent"
                      type="hidden"
                      value="suggestion_feedback_export"
                    />
                    <Button size="sm" type="submit" variant="outline">
                      검토 기록 JSON
                    </Button>
                  </Form>
                ) : null}
              </div>
            </div>
            {loaderData.suggestionEvaluation.length > 0 ? (
              <div className="mt-5">
                <div className="flex flex-wrap items-end justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-semibold">규칙 점검 현황</h3>
                    <p className="mt-1 text-xs text-muted-foreground">
                      가장 최근 사람 결정을 기준으로 계산합니다. 자동 점검은
                      최종 승인으로 사용하지 않습니다.
                    </p>
                  </div>
                  <span className="text-xs font-medium text-amber-700">
                    자동 승인 없음
                  </span>
                </div>
                <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {loaderData.suggestionEvaluation.map((metric) => (
                    <div
                      className="rounded-xl bg-muted/50 p-4"
                      key={`${metric.producer_kind}/${metric.producer_version}/${metric.suggestion_kind}`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-xs font-semibold">
                          {metric.producer_kind === "ai" ? "외부 제안" : "규칙"}{" "}
                          · {suggestionKindLabel(metric.suggestion_kind)}
                        </p>
                        <span className="text-xs text-muted-foreground">
                          총 {metric.total}건
                        </span>
                      </div>
                      <p
                        className="mt-2 truncate text-xs text-muted-foreground"
                        title={metric.producer_version}
                      >
                        {metric.producer_version}
                      </p>
                      <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                        <span>승인 {metric.accepted}</span>
                        <span>기각 {metric.rejected}</span>
                        <span>보류 {metric.deferred}</span>
                        <span>미결정 {metric.pending}</span>
                      </div>
                      <p className="mt-3 text-xs font-medium">
                        검토율 {Math.round(metric.decision_rate * 100)}% ·
                        승인률{" "}
                        {metric.acceptance_rate === null
                          ? "판정 불가"
                          : `${Math.round(metric.acceptance_rate * 100)}%`}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        확정 표본 {metric.accepted + metric.rejected}/
                        {metric.minimum_sample_size} · 자동 승격 없음
                        {metric.median_review_seconds === null
                          ? ""
                          : ` · 중앙 검토시간 ${Math.round(metric.median_review_seconds)}초`}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
            {loaderData.suggestions.length === 0 ? (
              <p className="mt-5 rounded-xl border border-dashed p-5 text-sm text-muted-foreground">
                {elementLedgerFile
                  ? "현재 요소 원장에서 자동 검토 경고가 발견되지 않았습니다."
                  : "요소 원장을 업로드하면 중복 Element ID, 수량 상태 오류, 분류·속성 누락을 자동 점검합니다."}
              </p>
            ) : (
              <ul className="mt-5 space-y-4">
                {loaderData.suggestions.map((suggestion) => {
                  const latestDecision = latestDecisionBySuggestion.get(
                    suggestion.id,
                  );
                  const count = affectedCount(suggestion.evidence);
                  const previousSha = evidenceText(
                    suggestion.evidence,
                    "previous_source_sha256",
                  );
                  const recommendation = evidenceText(
                    suggestion.evidence,
                    "recommendation",
                  );
                  const quantityDeltas = revisionQuantityDeltas(
                    suggestion.evidence,
                  );
                  const sourceFile = loaderData.files.find(
                    (file) => file.id === suggestion.file_id,
                  );
                  return (
                    <li className="rounded-xl border p-4" key={suggestion.id}>
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="text-sm font-semibold">
                              {suggestion.title}
                            </h3>
                            {count !== null ? (
                              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900">
                                영향 {count}건
                              </span>
                            ) : null}
                          </div>
                          <p className="mt-1 text-sm leading-6 text-muted-foreground">
                            {suggestion.detail}
                          </p>
                          {recommendation ? (
                            <p className="mt-2 rounded-lg bg-violet-50 px-3 py-2 text-sm text-violet-950">
                              <span className="font-semibold">추천:</span>{" "}
                              {recommendation}
                            </p>
                          ) : null}
                          {quantityDeltas.length > 0 ? (
                            <div className="mt-3 grid gap-2 sm:grid-cols-3">
                              {quantityDeltas.map((item) => (
                                <div
                                  className="rounded-lg border bg-muted/40 px-3 py-2"
                                  key={item.measure}
                                >
                                  <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                                    <span>{item.label}</span>
                                    <span>비교 {item.comparable_count}건</span>
                                  </div>
                                  <p className="mt-1 font-mono text-sm font-semibold text-foreground">
                                    {signedQuantity(item.delta)} {item.unit}
                                  </p>
                                  <p className="mt-1 text-xs text-muted-foreground">
                                    {item.previous} → {item.current}
                                    {item.not_evaluated_count > 0
                                      ? ` · 미산정 ${item.not_evaluated_count}건`
                                      : ""}
                                  </p>
                                </div>
                              ))}
                            </div>
                          ) : null}
                          <p className="mt-2 text-xs text-muted-foreground">
                            {sourceFile?.original_filename ?? "요소 원장"} ·
                            {suggestion.producer_kind === "ai"
                              ? "외부 모델 제안"
                              : "정해진 검사 규칙"}{" "}
                            {suggestion.producer_version} · 파일 확인번호{" "}
                            {suggestion.source_sha256.slice(0, 12)}…
                          </p>
                          {previousSha ? (
                            <p className="mt-1 text-xs text-muted-foreground">
                              개정 비교: 이전 파일 {previousSha.slice(0, 12)}… →
                              현재 파일 {suggestion.source_sha256.slice(0, 12)}…
                            </p>
                          ) : null}
                        </div>
                        {latestDecision ? (
                          <span className="w-fit rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-800">
                            현재 결정: {decisionLabel(latestDecision.decision)}
                          </span>
                        ) : (
                          <span className="w-fit rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-800">
                            결정 대기
                          </span>
                        )}
                      </div>
                      {latestDecision ? (
                        <p className="mt-3 rounded-lg bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
                          {latestDecision.note || "결정 메모 없음"} ·{" "}
                          {new Intl.DateTimeFormat("ko-KR", {
                            dateStyle: "medium",
                            timeStyle: "short",
                          }).format(new Date(latestDecision.created_at))}
                        </p>
                      ) : null}
                      <Form
                        className="mt-4 grid gap-2 sm:grid-cols-[140px_1fr_auto]"
                        method="post"
                      >
                        <input
                          name="intent"
                          type="hidden"
                          value="suggestion_decision"
                        />
                        <input
                          name="suggestion_id"
                          type="hidden"
                          value={suggestion.id}
                        />
                        <div className="grid gap-1.5">
                          <Label
                            htmlFor={`suggestion-decision-${suggestion.id}`}
                          >
                            결정
                          </Label>
                          <select
                            className="h-11 rounded-md border bg-background px-3 text-sm"
                            defaultValue={latestDecision?.decision ?? ""}
                            id={`suggestion-decision-${suggestion.id}`}
                            name="decision"
                            required
                          >
                            <option disabled value="">
                              결정을 선택하세요
                            </option>
                            {suggestionDecisions.map((decision) => (
                              <option key={decision} value={decision}>
                                {decisionLabel(decision)}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="grid gap-1.5">
                          <Label htmlFor={`suggestion-note-${suggestion.id}`}>
                            판단 근거 (수정 필요 시 필수)
                          </Label>
                          <Input
                            className="min-h-11"
                            id={`suggestion-note-${suggestion.id}`}
                            maxLength={2000}
                            name="note"
                            placeholder="확인한 내용과 다음 조치"
                          />
                        </div>
                        <Button
                          className="min-h-11 self-end"
                          type="submit"
                          variant="outline"
                        >
                          결정 기록
                        </Button>
                      </Form>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section className="mt-8 grid gap-6 lg:grid-cols-[0.8fr_1.2fr]">
            <div className="rounded-2xl border bg-card p-6 shadow-sm">
              <div className="mb-5 flex items-center gap-3">
                <MessageSquareText className="size-5 text-primary" />
                <h2 className="font-semibold">검토 메모 추가</h2>
              </div>
              <Form className="grid gap-4" method="post">
                <input name="intent" type="hidden" value="review" />
                <div className="grid gap-2">
                  <Label htmlFor="file_id">대상 파일 (선택)</Label>
                  <select
                    className="h-10 rounded-md border bg-background px-3 text-sm"
                    id="file_id"
                    name="file_id"
                  >
                    <option value="">프로젝트 전체</option>
                    {loaderData.files.map((file) => (
                      <option key={file.id} value={file.id}>
                        {file.original_filename}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="status">상태</Label>
                  <select
                    className="h-10 rounded-md border bg-background px-3 text-sm"
                    id="status"
                    name="status"
                    defaultValue="open"
                  >
                    {reviewStatuses.map((status) => (
                      <option key={status} value={status}>
                        {statusLabel(status)}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="note">메모</Label>
                  <textarea
                    className="min-h-28 rounded-md border bg-background p-3 text-sm"
                    id="note"
                    name="note"
                    maxLength={5000}
                    required
                    placeholder="확인한 근거와 다음 조치를 남기세요."
                  />
                </div>
                <Button type="submit">검토 메모 저장</Button>
              </Form>
            </div>
            <div className="rounded-2xl border bg-card p-6 shadow-sm">
              <h2 className="mb-5 font-semibold">
                검토 이력 ({loaderData.reviews.length})
              </h2>
              {loaderData.reviews.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  아직 검토 메모가 없습니다.
                </p>
              ) : (
                <ul className="space-y-4">
                  {loaderData.reviews.map((review) => (
                    <li
                      className="border-l-2 border-primary/30 pl-4"
                      key={review.id}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-sm font-medium">
                          {statusLabel(review.status)}
                        </span>
                        <time className="text-xs text-muted-foreground">
                          {new Intl.DateTimeFormat("ko-KR", {
                            dateStyle: "medium",
                            timeStyle: "short",
                          }).format(new Date(review.updated_at))}
                        </time>
                      </div>
                      <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">
                        {review.note}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>

          <section className="mt-8 rounded-2xl border bg-card p-6 shadow-sm">
            <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
              <div>
                <h2 className="font-semibold">검토 공유 링크</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  링크를 받은 사람은 원본을 수정할 수 없으며, 읽기 또는 검토
                  메모 작성만 할 수 있습니다.
                </p>
              </div>
              {loaderData.publicShareEnabled ? (
                <Form className="flex gap-2" method="post">
                  <input name="intent" type="hidden" value="share" />
                  <select
                    className="h-10 rounded-md border bg-background px-3 text-sm"
                    defaultValue="review"
                    name="permission"
                  >
                    <option value="view">보기만</option>
                    <option value="review">검토 메모 가능</option>
                  </select>
                  <Button type="submit" variant="outline">
                    링크 만들기
                  </Button>
                </Form>
              ) : (
                <span className="rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">
                  보안 검토 후 활성화
                </span>
              )}
            </div>
            {loaderData.publicShareEnabled ? (
              loaderData.shares.length === 0 ? (
                <p className="mt-5 text-sm text-muted-foreground">
                  아직 만든 공유 링크가 없습니다.
                </p>
              ) : (
                <ul className="mt-5 space-y-3">
                  {loaderData.shares.map((share) => {
                    const href = `/share/${share.token}`;
                    return (
                      <li
                        className="flex flex-col gap-2 rounded-xl border p-3 sm:flex-row sm:items-center sm:justify-between"
                        key={share.id}
                      >
                        <div>
                          <p className="text-sm font-medium">
                            {share.permission === "review"
                              ? "검토 메모 가능"
                              : "보기만"}
                          </p>
                          <p className="font-mono text-xs text-muted-foreground">
                            {typeof window === "undefined"
                              ? href
                              : `${window.location.origin}${href}`}
                          </p>
                        </div>
                        <a
                          className="text-sm text-primary underline underline-offset-4"
                          href={href}
                          rel="noreferrer"
                          target="_blank"
                        >
                          열기
                        </a>
                      </li>
                    );
                  })}
                </ul>
              )
            ) : (
              <p className="mt-5 text-sm text-muted-foreground">
                공유 링크를 공개하면 파일명·파일 확인번호·검토 메모가 링크를
                가진 사람에게 보입니다. 원본 다운로드는 공유되지 않습니다.
              </p>
            )}
          </section>
        </>
      ) : null}
    </main>
  );
}
