import type { Route } from "./+types/verified-boq";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  ArrowLeft,
  BookOpenCheck,
  CheckCircle2,
  Download,
  Link2,
  ListTree,
  Send,
  ShieldCheck,
} from "lucide-react";
import { Form, Link, data, redirect } from "react-router";
import { z } from "zod";

import { Button } from "~/core/components/ui/button";
import { Input } from "~/core/components/ui/input";
import { Label } from "~/core/components/ui/label";
import makeServerClient from "~/core/lib/supa-client.server";
import { VerifiedBoqDrawingSources } from "~/lukas/components/verified-boq-drawing-sources";
import {
  deleteDrawingBoqLink,
  drawingQuantityLineageErrorResponse,
  listVerifiedBoqDrawingSources,
  loadVerifiedBoqV1_1Calculation,
  parseDrawingBoqMutationForm,
  putDrawingBoqLink,
  recheckAndDecideVerifiedBoqV1_1,
  submitVerifiedBoqV1_1,
  type VerifiedBoqDrawingSourceRow,
} from "~/lukas/lib/drawing-quantity-lineage.server";
import {
  compareExact,
  parseExactDecimal,
} from "~/lukas/lib/exact-decimal.server";
import {
  buildVerifiedBoqCsv,
  calculateVerifiedBoq,
  type BoqCalculationPolicy,
  type VerifiedBoqResult,
} from "~/lukas/lib/verified-boq.server";
import { buildVerifiedBoqXlsx } from "~/lukas/lib/verified-boq-xlsx.server";
import {
  compareVerifiedBoq,
  type VerifiedBoqComparison,
} from "~/lukas/lib/verified-boq-comparison.server";
import {
  assertVerifiedBoqSourceCoverage,
  listVerifiedBoqSources,
  resolveVerifiedBoqSource,
  sha256Bytes,
} from "~/lukas/lib/verified-boq-source.server";
import {
  buildVerifiedBoqPriceBookTemplateCsv,
  parseVerifiedBoqPriceBook,
} from "~/lukas/lib/verified-boq-pricebook.server";
import {
  buildVerifiedBoqStructureTemplateCsv,
  parseVerifiedBoqStructure,
} from "~/lukas/lib/verified-boq-structure.server";
import type { VerifiedBoqV1_1Result } from "~/lukas/lib/verified-boq-v1-1.server";

type Row = Record<string, unknown>;
type Project = { id: string; name: string; owner_id: string };
type FileRow = {
  id: string;
  kind: string;
  original_filename: string;
  sha256: string;
  immutable: boolean;
};
type PriceBook = {
  id: string;
  name: string;
  version_label: string;
  effective_date: string;
  rights_basis: string;
  source_file_id: string;
  source_sha256: string;
};
type Resource = {
  id: string;
  price_book_id: string;
  resource_code: string;
  resource_type: "material" | "labor" | "equipment" | "expense";
  resource_name: string;
  specification: string;
  unit: string;
  unit_price_krw: string | number;
};
type Version = {
  id: string;
  version_no: number;
  title: string;
  status: "draft" | "in_review" | "approved" | "superseded";
  calculation_policy: BoqCalculationPolicy;
  quantity_scale: number;
  price_book_id: string;
  supersedes_id: string | null;
  created_by: string;
  result_sha256: string | null;
  direct_cost_krw: string | number | null;
  engine_version: "VERIFIED-BOQ-1.0" | "VERIFIED-BOQ-1.1";
  input_state_sha256: string | null;
  manifest_sha256: string | null;
  line_count?: number | null;
};
type Section = { id: string; code: string; name: string; sort_order: number };
type WbsNode = {
  id: string;
  parent_id: string | null;
  code: string;
  name: string;
  sort_order: number;
};
type WbsAllocation = {
  id: string;
  line_id: string;
  wbs_node_id: string;
  allocation_percent: string | number;
};
type Line = {
  id: string;
  section_id: string;
  item_code: string;
  item_name: string;
  specification: string;
  unit: "EA" | "m" | "m2" | "m3";
  signed_adjustment: string | number;
  adjustment_reason: string;
  sort_order: number;
};
type Mapping = {
  id: string;
  line_id: string;
  source_file_id: string;
  source_sha256: string;
  source_subject_key: string;
  source_quantity: string | number;
  factor: string | number;
  unit: "EA" | "m" | "m2" | "m3";
  element_ids: string[];
};
type Exclusion = {
  id: string;
  source_file_id: string;
  source_sha256: string;
  source_subject_key: string;
  source_quantity: string | number;
  unit: "EA" | "m" | "m2" | "m3";
  element_ids: string[];
  reason: string;
};
type Component = {
  id: string;
  line_id: string;
  resource_id: string;
  coefficient: string | number;
};
type Approval = {
  id: string;
  decision: string;
  note: string;
  decided_by: string;
  created_at: string;
};
type IdentityLink = {
  revit_element_id: string;
  ifc_global_id: string;
  ifc_file_id: string;
};

const uuid = z.string().uuid();
const sha256 = z.string().regex(/^[0-9a-f]{64}$/);
const unit = z.enum(["EA", "m", "m2", "m3"]);
const decimal = z
  .string()
  .trim()
  .regex(/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/);

function untyped(client: unknown) {
  return client as SupabaseClient<any>;
}

async function getContext(request: Request, projectId: string) {
  const [typedClient, headers] = makeServerClient(request);
  const client = untyped(typedClient);
  const {
    data: { user },
  } = await typedClient.auth.getUser();
  if (!user || user.is_anonymous) throw redirect("/login");
  const { data: project, error } = await typedClient
    .from("lukas_qto_projects")
    .select("id,name,owner_id")
    .eq("id", projectId)
    .single();
  if (error || !project)
    throw new Response("프로젝트를 찾을 수 없습니다.", { status: 404 });
  const { data: membership } = await client
    .from("lukas_qto_project_members")
    .select("role")
    .eq("project_id", projectId)
    .eq("user_id", user.id)
    .maybeSingle();
  const role =
    user.app_metadata.role === "hangil_staff"
      ? "staff"
      : project.owner_id === user.id
        ? "owner"
        : String(membership?.role ?? "");
  return {
    client,
    headers,
    project: project as Project,
    user,
    role,
    mayEdit: ["owner", "staff", "estimator"].includes(role),
    mayReview: ["owner", "staff", "reviewer"].includes(role),
  };
}

async function resolveStoredBoqSource(
  client: SupabaseClient<any>,
  projectId: string,
  fileId: string,
  subjectKey: string,
  sourceUnit: "EA" | "m" | "m2" | "m3",
) {
  const loaded = await loadStoredBoqSource(client, projectId, fileId);
  return {
    file: loaded.file,
    sourceSha256: loaded.sourceSha256,
    resolved: resolveVerifiedBoqSource(
      loaded.sourceBytes,
      loaded.file.kind as "qto_csv" | "element_ledger",
      subjectKey,
      sourceUnit,
    ),
  };
}

async function loadStoredBoqSource(
  client: SupabaseClient<any>,
  projectId: string,
  fileId: string,
) {
  const { data: file } = await client
    .from("lukas_qto_files")
    .select("id,kind,sha256,immutable,storage_path")
    .eq("id", fileId)
    .eq("project_id", projectId)
    .single();
  if (!file?.immutable)
    throw new Error("변경되지 않는 원수량 파일만 연결할 수 있습니다.");
  if (!["qto_csv", "element_ledger"].includes(file.kind))
    throw new Error(
      "원수량은 QTO CSV 또는 객체별 수량표만 연결할 수 있습니다.",
    );
  const { data: sourceBlob, error: downloadError } = await client.storage
    .from("lukas-qto")
    .download(file.storage_path);
  if (downloadError || !sourceBlob)
    throw new Error("원수량 원본 파일을 읽지 못했습니다.");
  const sourceBytes = new Uint8Array(await sourceBlob.arrayBuffer());
  const sourceSha256 = sha256.parse(file.sha256);
  if (sha256Bytes(sourceBytes) !== sourceSha256)
    throw new Error("원수량 원본 파일의 고유 확인번호가 변경되었습니다.");
  return { file, sourceSha256, sourceBytes };
}

async function assertVersionSourceCoverage(
  client: SupabaseClient<any>,
  projectId: string,
  mappings: Mapping[],
  exclusions: Exclusion[],
) {
  const decisions = [
    ...mappings.map((row) => ({
      sourceFileId: row.source_file_id,
      sourceSha256: row.source_sha256,
      subjectKey: row.source_subject_key,
      quantity: String(row.source_quantity),
      unit: row.unit,
      elementIds: row.element_ids,
    })),
    ...exclusions.map((row) => ({
      sourceFileId: row.source_file_id,
      sourceSha256: row.source_sha256,
      subjectKey: row.source_subject_key,
      quantity: String(row.source_quantity),
      unit: row.unit,
      elementIds: row.element_ids,
    })),
  ];
  const groups = new Map<string, typeof decisions>();
  for (const decision of decisions) {
    const key = `${decision.sourceFileId}\u001f${decision.unit}`;
    const group = groups.get(key) ?? [];
    group.push(decision);
    groups.set(key, group);
  }
  for (const group of groups.values()) {
    const first = group[0];
    const loaded = await loadStoredBoqSource(
      client,
      projectId,
      first.sourceFileId,
    );
    if (group.some((row) => row.sourceSha256 !== loaded.sourceSha256))
      throw new Error("저장된 원수량 연결의 고유 확인번호가 원본과 다릅니다.");
    assertVerifiedBoqSourceCoverage(
      listVerifiedBoqSources(
        loaded.sourceBytes,
        loaded.file.kind as "qto_csv" | "element_ledger",
        first.unit,
      ),
      group,
    );
  }
}

async function loadVersionData(client: SupabaseClient<any>, version: Version) {
  const [
    sectionResult,
    lineResult,
    wbsResult,
    allocationResult,
    mappingResult,
    exclusionResult,
    componentResult,
    approvalResult,
  ] = await Promise.all([
    client
      .from("lukas_qto_boq_sections")
      .select("id,code,name,sort_order")
      .eq("version_id", version.id)
      .order("sort_order"),
    client
      .from("lukas_qto_boq_lines")
      .select(
        "id,section_id,item_code,item_name,specification,unit,signed_adjustment,adjustment_reason,sort_order",
      )
      .eq("version_id", version.id)
      .order("sort_order"),
    client
      .from("lukas_qto_boq_wbs_nodes")
      .select("id,parent_id,code,name,sort_order")
      .eq("version_id", version.id)
      .order("sort_order"),
    client
      .from("lukas_qto_boq_wbs_allocations")
      .select("id,line_id,wbs_node_id,allocation_percent")
      .eq("version_id", version.id),
    client
      .from("lukas_qto_boq_quantity_mappings")
      .select(
        "id,line_id,source_file_id,source_sha256,source_subject_key,source_quantity,factor,unit,element_ids",
      )
      .eq("version_id", version.id),
    client
      .from("lukas_qto_boq_source_exclusions")
      .select(
        "id,source_file_id,source_sha256,source_subject_key,source_quantity,unit,element_ids,reason",
      )
      .eq("version_id", version.id),
    client
      .from("lukas_qto_boq_rate_components")
      .select("id,line_id,resource_id,coefficient")
      .eq("version_id", version.id),
    client
      .from("lukas_qto_boq_approvals")
      .select("id,decision,note,decided_by,created_at")
      .eq("version_id", version.id)
      .order("created_at", { ascending: false }),
  ]);
  for (const result of [
    sectionResult,
    lineResult,
    wbsResult,
    allocationResult,
    mappingResult,
    exclusionResult,
    componentResult,
    approvalResult,
  ])
    if (result.error) throw result.error;
  return {
    sections: (sectionResult.data ?? []) as Section[],
    lines: (lineResult.data ?? []) as Line[],
    wbsNodes: (wbsResult.data ?? []) as WbsNode[],
    wbsAllocations: (allocationResult.data ?? []) as WbsAllocation[],
    mappings: (mappingResult.data ?? []) as Mapping[],
    exclusions: (exclusionResult.data ?? []) as Exclusion[],
    components: (componentResult.data ?? []) as Component[],
    approvals: (approvalResult.data ?? []) as Approval[],
  };
}

function calculate(
  version: Version,
  rows: Awaited<ReturnType<typeof loadVersionData>>,
  resources: Resource[],
) {
  return calculateVerifiedBoq({
    versionId: version.id,
    calculationPolicy: version.calculation_policy,
    quantityScale: version.quantity_scale,
    lines: rows.lines.map((line) => ({
      id: line.id,
      sectionCode:
        rows.sections.find((section) => section.id === line.section_id)?.code ??
        "",
      itemCode: line.item_code,
      itemName: line.item_name,
      specification: line.specification,
      unit: line.unit,
      signedAdjustment: String(line.signed_adjustment),
      adjustmentReason: line.adjustment_reason,
    })),
    mappings: rows.mappings.map((mapping) => ({
      id: mapping.id,
      lineId: mapping.line_id,
      sourceFileId: mapping.source_file_id,
      sourceSha256: mapping.source_sha256,
      subjectKey: mapping.source_subject_key,
      sourceQuantity: String(mapping.source_quantity),
      factor: String(mapping.factor),
      unit: mapping.unit,
      elementIds: mapping.element_ids,
    })),
    exclusions: rows.exclusions.map((exclusion) => ({
      id: exclusion.id,
      sourceFileId: exclusion.source_file_id,
      sourceSha256: exclusion.source_sha256,
      subjectKey: exclusion.source_subject_key,
      sourceQuantity: String(exclusion.source_quantity),
      unit: exclusion.unit,
      elementIds: exclusion.element_ids,
      reason: exclusion.reason,
    })),
    resources: resources.map((resource) => ({
      id: resource.id,
      code: resource.resource_code,
      type: resource.resource_type,
      unitPriceKrw: String(resource.unit_price_krw),
    })),
    components: rows.components.map((component) => ({
      id: component.id,
      lineId: component.line_id,
      resourceId: component.resource_id,
      coefficient: String(component.coefficient),
    })),
  });
}

export const meta: Route.MetaFunction = ({ data: page }) => [
  {
    title: page?.project
      ? `${page.project.name} 검증 내역서 | 한길시스템`
      : "검증 내역서",
  },
];

export async function loader({ request, params }: Route.LoaderArgs) {
  const context = await getContext(request, params.projectId!);
  const url = new URL(request.url);
  if (url.searchParams.get("download") === "pricebook-template")
    return new Response(buildVerifiedBoqPriceBookTemplateCsv(), {
      headers: {
        "Content-Disposition":
          'attachment; filename="verified-boq-pricebook-template.csv"',
        "Content-Type": "text/csv; charset=utf-8",
      },
    });
  if (url.searchParams.get("download") === "structure-template")
    return new Response(buildVerifiedBoqStructureTemplateCsv(), {
      headers: {
        "Content-Disposition":
          'attachment; filename="verified-boq-structure-template.csv"',
        "Content-Type": "text/csv; charset=utf-8",
      },
    });
  const [fileResult, bookResult, versionResult] = await Promise.all([
    context.client
      .from("lukas_qto_files")
      .select("id,kind,original_filename,sha256,immutable")
      .eq("project_id", context.project.id)
      .order("created_at", { ascending: false }),
    context.client
      .from("lukas_qto_price_books")
      .select(
        "id,name,version_label,effective_date,rights_basis,source_file_id,source_sha256",
      )
      .eq("project_id", context.project.id)
      .order("created_at", { ascending: false }),
    context.client
      .from("lukas_qto_boq_versions")
      .select(
        "id,version_no,title,status,calculation_policy,quantity_scale,price_book_id,supersedes_id,created_by,result_sha256,direct_cost_krw,engine_version,input_state_sha256,manifest_sha256,line_count",
      )
      .eq("project_id", context.project.id)
      .order("version_no", { ascending: false }),
  ]);
  for (const result of [fileResult, bookResult, versionResult])
    if (result.error) throw new Response(result.error.message, { status: 500 });
  const files = (fileResult.data ?? []) as FileRow[];
  const priceBooks = (bookResult.data ?? []) as PriceBook[];
  const versions = (versionResult.data ?? []) as Version[];
  const requested = url.searchParams.get("version");
  const version =
    versions.find((item) => item.id === requested) ?? versions[0] ?? null;
  let resources: Resource[] = [];
  let versionRows: Awaited<ReturnType<typeof loadVersionData>> | null = null;
  let result: VerifiedBoqResult | VerifiedBoqV1_1Result | null = null;
  let calculationError: string | null = null;
  let snapshotValid = true;
  let comparison: VerifiedBoqComparison | null = null;
  let identityLinks: IdentityLink[] = [];
  let drawingSources: VerifiedBoqDrawingSourceRow[] = [];
  let drawingSourcesHaveMore = false;
  if (version) {
    const [resourceResult, loaded, sourcePage] = await Promise.all([
      context.client
        .from("lukas_qto_price_resources")
        .select(
          "id,price_book_id,resource_code,resource_type,resource_name,specification,unit,unit_price_krw",
        )
        .eq("price_book_id", version.price_book_id)
        .order("resource_code"),
      loadVersionData(context.client, version),
      version.engine_version === "VERIFIED-BOQ-1.1"
        ? listVerifiedBoqDrawingSources(context.client, {
            projectId: context.project.id,
            boqVersionId: version.id,
            limit: 200,
          })
        : Promise.resolve({ rows: [], hasMore: false }),
    ]);
    if (resourceResult.error)
      throw new Response(resourceResult.error.message, { status: 500 });
    resources = (resourceResult.data ?? []) as Resource[];
    versionRows = loaded;
    drawingSources = sourcePage.rows;
    drawingSourcesHaveMore = sourcePage.hasMore;
    try {
      if (version.engine_version === "VERIFIED-BOQ-1.1") {
        const calculated = await loadVerifiedBoqV1_1Calculation(
          context.client,
          context.user.id,
          version.id,
        );
        result = calculated.result;
        if (
          version.status !== "draft" &&
          (version.input_state_sha256 !== calculated.parsed.inputStateSha256 ||
            version.result_sha256 !== result.canonicalSha256 ||
            version.manifest_sha256 !== calculated.manifest.manifestSha256)
        ) {
          snapshotValid = false;
          calculationError =
            "승인 요청 당시 입력·결과·manifest 확인번호와 현재 재계산 결과가 다릅니다. 승인·내보내기를 중지했습니다.";
        }
      } else {
        result = calculate(version, loaded, resources);
      }
      if (
        version.engine_version === "VERIFIED-BOQ-1.0" &&
        version.status !== "draft" &&
        version.result_sha256 !== result.canonicalSha256
      ) {
        snapshotValid = false;
        calculationError =
          "승인 요청 당시 결과 확인번호와 현재 재계산 결과가 다릅니다. 승인·내보내기를 중지했습니다.";
      }
      if (
        version.engine_version === "VERIFIED-BOQ-1.0" &&
        result.engineVersion === "VERIFIED-BOQ-1.0" &&
        version.supersedes_id
      ) {
        const previous = versions.find(
          (item) => item.id === version.supersedes_id,
        );
        if (previous?.engine_version === "VERIFIED-BOQ-1.0") {
          const [previousRows, previousResourcesResult] = await Promise.all([
            loadVersionData(context.client, previous),
            context.client
              .from("lukas_qto_price_resources")
              .select(
                "id,price_book_id,resource_code,resource_type,resource_name,specification,unit,unit_price_krw",
              )
              .eq("price_book_id", previous.price_book_id),
          ]);
          if (previousResourcesResult.error)
            throw previousResourcesResult.error;
          comparison = compareVerifiedBoq(
            calculate(
              previous,
              previousRows,
              (previousResourcesResult.data ?? []) as Resource[],
            ),
            result,
          );
        }
      }
    } catch (error) {
      calculationError =
        error instanceof Error ? error.message : "내역을 계산하지 못했습니다.";
    }
    if (result) {
      const elementIds = [
        ...new Set(result.lines.flatMap((line) => line.elementIds)),
      ].slice(0, 500);
      if (elementIds.length) {
        const { data: links, error: linkError } = await context.client
          .from("lukas_qto_element_identity_links")
          .select("revit_element_id,ifc_global_id,ifc_file_id")
          .eq("project_id", context.project.id)
          .in("revit_element_id", elementIds);
        if (linkError) throw new Response(linkError.message, { status: 500 });
        identityLinks = (links ?? []) as IdentityLink[];
      }
    }
  } else if (priceBooks[0]) {
    const { data: rows, error } = await context.client
      .from("lukas_qto_price_resources")
      .select(
        "id,price_book_id,resource_code,resource_type,resource_name,specification,unit,unit_price_krw",
      )
      .eq("price_book_id", priceBooks[0].id)
      .order("resource_code");
    if (error) throw new Response(error.message, { status: 500 });
    resources = (rows ?? []) as Resource[];
  }
  const download = url.searchParams.get("download");
  if (download && version && result && snapshotValid) {
    if (result.engineVersion !== "VERIFIED-BOQ-1.0")
      throw new Response("승인된 1.1 인계 내보내기는 전용 경로를 사용합니다.", {
        status: 409,
      });
    if (download === "xlsx" && versionRows) {
      const fileById = new Map(files.map((file) => [file.id, file]));
      const lineById = new Map(
        versionRows.lines.map((line) => [line.id, line]),
      );
      const workbook = buildVerifiedBoqXlsx({
        result,
        resources: resources.map((resource) => ({
          code: resource.resource_code,
          type: resource.resource_type,
          name: resource.resource_name,
          specification: resource.specification,
          unit: resource.unit,
          unitPriceKrw: String(resource.unit_price_krw),
        })),
        mappings: versionRows.mappings.map((mapping) => ({
          itemCode: lineById.get(mapping.line_id)?.item_code ?? "",
          sourceFilename:
            fileById.get(mapping.source_file_id)?.original_filename ?? "",
          sourceSha256: mapping.source_sha256,
          subjectKey: mapping.source_subject_key,
          sourceQuantity: String(mapping.source_quantity),
          factor: String(mapping.factor),
          unit: mapping.unit,
          elementIds: mapping.element_ids,
        })),
        exclusions: versionRows.exclusions.map((exclusion) => ({
          sourceFilename:
            fileById.get(exclusion.source_file_id)?.original_filename ?? "",
          sourceSha256: exclusion.source_sha256,
          subjectKey: exclusion.source_subject_key,
          sourceQuantity: String(exclusion.source_quantity),
          unit: exclusion.unit,
          elementIds: exclusion.element_ids,
          reason: exclusion.reason,
        })),
        structures: versionRows.lines.flatMap((line) => {
          const section = versionRows.sections.find(
            (item) => item.id === line.section_id,
          );
          const allocations = versionRows.wbsAllocations.filter(
            (item) => item.line_id === line.id,
          );
          if (allocations.length === 0)
            return [
              {
                itemCode: line.item_code,
                cbsCode: section?.code ?? "",
                cbsName: section?.name ?? "",
                wbsCode: "",
                wbsName: "",
                allocationPercent: "",
              },
            ];
          return allocations.map((allocation) => {
            const node = versionRows.wbsNodes.find(
              (item) => item.id === allocation.wbs_node_id,
            );
            return {
              itemCode: line.item_code,
              cbsCode: section?.code ?? "",
              cbsName: section?.name ?? "",
              wbsCode: node?.code ?? "",
              wbsName: node?.name ?? "",
              allocationPercent: String(allocation.allocation_percent),
            };
          });
        }),
        review: {
          projectName: context.project.name,
          versionLabel: `V${version.version_no} ${version.title}`,
          status: version.status,
          makerId: version.created_by,
          approvals: versionRows.approvals.map((approval) => ({
            decision: approval.decision,
            note: approval.note,
            decidedBy: approval.decided_by,
            createdAt: approval.created_at,
          })),
        },
      });
      return new Response(workbook, {
        headers: {
          "Content-Type":
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": `attachment; filename="verified-boq-v${version.version_no}.xlsx"`,
          "Cache-Control": "private, no-store",
        },
      });
    }
    if (download !== "csv")
      throw new Response("지원하지 않는 내보내기 형식입니다.", { status: 400 });
    return new Response(buildVerifiedBoqCsv(result), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="verified-boq-v${version.version_no}.csv"`,
        "Cache-Control": "private, no-store",
      },
    });
  }
  return data(
    {
      project: context.project,
      userId: context.user.id,
      role: context.role,
      mayEdit: context.mayEdit,
      mayReview: context.mayReview,
      files,
      priceBooks,
      versions,
      version,
      resources,
      versionRows,
      result,
      calculationError,
      snapshotValid,
      comparison,
      identityLinks,
      drawingSources,
      drawingSourcesHaveMore,
    },
    { headers: context.headers },
  );
}

export async function action({ request, params }: Route.ActionArgs) {
  const context = await getContext(request, params.projectId!);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const back = (versionId?: string) =>
    `/projects/${context.project.id}/boq${versionId ? `?version=${versionId}` : ""}`;
  try {
    if (
      [
        "price_book",
        "resource",
        "resource_import",
        "version",
        "section",
        "line",
        "wbs_node",
        "wbs_allocation",
        "structure_import",
        "mapping",
        "exclusion",
        "component",
        "drawing_boq_put",
        "drawing_boq_delete",
        "submit",
      ].includes(intent) &&
      !context.mayEdit
    )
      throw new Error("적산 담당자만 이 항목을 작성할 수 있습니다.");
    if (intent === "drawing_boq_put") {
      const mutation = parseDrawingBoqMutationForm(form);
      if (mutation.intent !== "drawing_boq_put")
        throw new Error("지원하지 않는 작업입니다.");
      const { data: scopedVersion, error: scopeError } = await context.client
        .from("lukas_qto_boq_versions")
        .select("id")
        .eq("id", mutation.boqVersionId)
        .eq("project_id", context.project.id)
        .single();
      if (scopeError || !scopedVersion)
        throw new Error("현재 프로젝트의 BOQ 버전이 아닙니다.");
      await putDrawingBoqLink(context.client, mutation);
      return redirect(back(mutation.boqVersionId), {
        headers: context.headers,
      });
    }
    if (intent === "drawing_boq_delete") {
      const mutation = parseDrawingBoqMutationForm(form);
      if (mutation.intent !== "drawing_boq_delete")
        throw new Error("지원하지 않는 작업입니다.");
      const { data: scopedLink, error: scopeError } = await context.client
        .from("lukas_drawing_boq_links")
        .select("id")
        .eq("id", mutation.id)
        .eq("project_id", context.project.id)
        .single();
      if (scopeError || !scopedLink)
        throw new Error("현재 프로젝트의 Drawing 배분이 아닙니다.");
      await deleteDrawingBoqLink(context.client, mutation);
      return redirect(
        back(new URL(request.url).searchParams.get("version") ?? undefined),
        { headers: context.headers },
      );
    }
    if (intent === "price_book") {
      const parsed = z
        .object({
          name: z.string().trim().min(1).max(160),
          version: z.string().trim().min(1).max(80),
          effective: z.string().date(),
          rights: z.enum(["customer_owned", "licensed", "public_authorized"]),
          note: z.string().trim().min(1).max(1000),
          fileId: uuid,
        })
        .parse({
          name: form.get("name"),
          version: form.get("version_label"),
          effective: form.get("effective_date"),
          rights: form.get("rights_basis"),
          note: form.get("license_note"),
          fileId: form.get("source_file_id"),
        });
      const { data: file } = await context.client
        .from("lukas_qto_files")
        .select("id,kind,sha256,immutable")
        .eq("id", parsed.fileId)
        .eq("project_id", context.project.id)
        .single();
      if (!file?.immutable)
        throw new Error(
          "변경되지 않는 원본 파일만 단가표 근거로 사용할 수 있습니다.",
        );
      if (!["estimate", "other"].includes(file.kind))
        throw new Error(
          "단가표는 내역서 또는 기타 근거 파일로 등록한 원본만 사용할 수 있습니다.",
        );
      const { error } = await context.client
        .from("lukas_qto_price_books")
        .insert({
          project_id: context.project.id,
          name: parsed.name,
          version_label: parsed.version,
          effective_date: parsed.effective,
          rights_basis: parsed.rights,
          license_note: parsed.note,
          source_file_id: file.id,
          source_sha256: sha256.parse(file.sha256),
          created_by: context.user.id,
        });
      if (error) throw error;
      return redirect(back(), { headers: context.headers });
    }
    if (intent === "resource") {
      const parsed = z
        .object({
          bookId: uuid,
          code: z.string().trim().min(1).max(80),
          type: z.enum(["material", "labor", "equipment", "expense"]),
          name: z.string().trim().min(1).max(160),
          specification: z.string().max(200),
          unit: z.enum(["EA", "m", "m2", "m3", "kg", "t", "day", "hr"]),
          price: decimal.refine(
            (value) => !value.startsWith("-"),
            "단가는 음수일 수 없습니다.",
          ),
        })
        .parse({
          bookId: form.get("price_book_id"),
          code: form.get("resource_code"),
          type: form.get("resource_type"),
          name: form.get("resource_name"),
          specification: form.get("specification") ?? "",
          unit: form.get("unit"),
          price: form.get("unit_price_krw"),
        });
      const { error } = await context.client
        .from("lukas_qto_price_resources")
        .insert({
          project_id: context.project.id,
          price_book_id: parsed.bookId,
          resource_code: parsed.code,
          resource_type: parsed.type,
          resource_name: parsed.name,
          specification: parsed.specification,
          unit: parsed.unit,
          unit_price_krw: parsed.price,
          created_by: context.user.id,
        });
      if (error) throw error;
      return redirect(back(), { headers: context.headers });
    }
    if (intent === "resource_import") {
      const bookId = uuid.parse(form.get("price_book_id"));
      const { data: book } = await context.client
        .from("lukas_qto_price_books")
        .select("id,source_file_id,source_sha256")
        .eq("id", bookId)
        .eq("project_id", context.project.id)
        .single();
      if (!book) throw new Error("단가표를 찾지 못했습니다.");
      const { data: file } = await context.client
        .from("lukas_qto_files")
        .select("id,original_filename,storage_path,sha256,immutable")
        .eq("id", book.source_file_id)
        .eq("project_id", context.project.id)
        .single();
      if (!file?.immutable || file.sha256 !== book.source_sha256)
        throw new Error("단가표 원본 파일의 등록 정보가 변경되었습니다.");
      const { data: sourceBlob, error: downloadError } =
        await context.client.storage
          .from("lukas-qto")
          .download(file.storage_path);
      if (downloadError || !sourceBlob)
        throw new Error("단가표 원본 파일을 읽지 못했습니다.");
      const sourceBytes = new Uint8Array(await sourceBlob.arrayBuffer());
      if (sha256Bytes(sourceBytes) !== sha256.parse(book.source_sha256))
        throw new Error("단가표 원본 파일의 고유 확인번호가 변경되었습니다.");
      const imported = parseVerifiedBoqPriceBook(
        sourceBytes,
        file.original_filename,
      );
      const { error } = await context.client
        .from("lukas_qto_price_resources")
        .insert(
          imported.map((resource) => ({
            project_id: context.project.id,
            price_book_id: book.id,
            resource_code: resource.resourceCode,
            resource_type: resource.resourceType,
            resource_name: resource.resourceName,
            specification: resource.specification,
            unit: resource.unit,
            unit_price_krw: resource.unitPriceKrw,
            created_by: context.user.id,
          })),
        );
      if (error) throw error;
      return redirect(back(), { headers: context.headers });
    }
    if (intent === "version") {
      const parsed = z
        .object({
          title: z.string().trim().min(1).max(160),
          policy: z.enum(["general_half_away", "ems_component_truncate"]),
          scale: z.coerce.number().int().min(0).max(9),
          bookId: uuid,
          supersedesId: z.union([uuid, z.literal("")]),
        })
        .parse({
          title: form.get("title"),
          policy: form.get("calculation_policy"),
          scale: form.get("quantity_scale"),
          bookId: form.get("price_book_id"),
          supersedesId: form.get("supersedes_id") ?? "",
        });
      if (parsed.supersedesId) {
        const { data: predecessor } = await context.client
          .from("lukas_qto_boq_versions")
          .select("id,status")
          .eq("id", parsed.supersedesId)
          .eq("project_id", context.project.id)
          .single();
        if (predecessor?.status !== "approved")
          throw new Error(
            "승인 완료된 내역만 새 개정의 이전 버전으로 선택할 수 있습니다.",
          );
      }
      const { data: previous } = await context.client
        .from("lukas_qto_boq_versions")
        .select("version_no")
        .eq("project_id", context.project.id)
        .order("version_no", { ascending: false })
        .limit(1)
        .maybeSingle();
      const { data: created, error } = await context.client
        .from("lukas_qto_boq_versions")
        .insert({
          project_id: context.project.id,
          version_no: Number(previous?.version_no ?? 0) + 1,
          title: parsed.title,
          status: "draft",
          calculation_policy: parsed.policy,
          quantity_scale: parsed.scale,
          price_book_id: parsed.bookId,
          supersedes_id: parsed.supersedesId || null,
          created_by: context.user.id,
          engine_version: "VERIFIED-BOQ-1.1",
        })
        .select("id")
        .single();
      if (error) throw error;
      return redirect(back(created.id), { headers: context.headers });
    }
    const versionId = uuid.parse(form.get("version_id"));
    const { data: version } = await context.client
      .from("lukas_qto_boq_versions")
      .select(
        "id,version_no,title,status,price_book_id,supersedes_id,calculation_policy,quantity_scale,created_by,result_sha256,direct_cost_krw,line_count,engine_version,input_state_sha256,manifest_sha256",
      )
      .eq("id", versionId)
      .eq("project_id", context.project.id)
      .single();
    if (!version) throw new Error("내역 버전을 찾을 수 없습니다.");
    if (intent === "structure_import") {
      const fileId = uuid.parse(form.get("source_file_id"));
      const { data: file } = await context.client
        .from("lukas_qto_files")
        .select("id,kind,original_filename,storage_path,sha256,immutable")
        .eq("id", fileId)
        .eq("project_id", context.project.id)
        .single();
      if (!file?.immutable || !["estimate", "other"].includes(file.kind))
        throw new Error(
          "내역 체계는 변경되지 않는 내역서 또는 기타 근거 파일에서만 가져올 수 있습니다.",
        );
      const { data: sourceBlob, error: downloadError } =
        await context.client.storage
          .from("lukas-qto")
          .download(file.storage_path);
      if (downloadError || !sourceBlob)
        throw new Error("내역 체계 원본 파일을 읽지 못했습니다.");
      const sourceBytes = new Uint8Array(await sourceBlob.arrayBuffer());
      if (sha256Bytes(sourceBytes) !== sha256.parse(file.sha256))
        throw new Error(
          "내역 체계 원본 파일의 고유 확인번호가 변경되었습니다.",
        );
      const imported = parseVerifiedBoqStructure(
        sourceBytes,
        file.original_filename,
      );
      const { error } = await context.client.rpc(
        "lukas_qto_import_boq_structure",
        {
          p_version_id: versionId,
          p_payload: imported,
        },
      );
      if (error) throw error;
      return redirect(back(versionId), { headers: context.headers });
    }
    if (intent === "section") {
      const parsed = z
        .object({
          code: z.string().trim().min(1).max(80),
          name: z.string().trim().min(1).max(160),
          parentId: z.union([uuid, z.literal("")]),
        })
        .parse({
          code: form.get("code"),
          name: form.get("name"),
          parentId: form.get("parent_id") ?? "",
        });
      const { error } = await context.client
        .from("lukas_qto_boq_sections")
        .insert({
          project_id: context.project.id,
          version_id: versionId,
          parent_id: parsed.parentId || null,
          code: parsed.code,
          name: parsed.name,
          created_by: context.user.id,
        });
      if (error) throw error;
    } else if (intent === "line") {
      const parsed = z
        .object({
          sectionId: uuid,
          code: z.string().trim().min(1).max(80),
          name: z.string().trim().min(1).max(200),
          specification: z.string().max(240),
          unit,
          adjustment: decimal,
          reason: z.string().max(1000),
        })
        .parse({
          sectionId: form.get("section_id"),
          code: form.get("item_code"),
          name: form.get("item_name"),
          specification: form.get("specification") ?? "",
          unit: form.get("unit"),
          adjustment: form.get("signed_adjustment") ?? "0",
          reason: form.get("adjustment_reason") ?? "",
        });
      if (parsed.adjustment !== "0" && !parsed.reason.trim())
        throw new Error("보정수량에는 사유가 필요합니다.");
      const { error } = await context.client
        .from("lukas_qto_boq_lines")
        .insert({
          project_id: context.project.id,
          version_id: versionId,
          section_id: parsed.sectionId,
          item_code: parsed.code,
          item_name: parsed.name,
          specification: parsed.specification,
          unit: parsed.unit,
          signed_adjustment: parsed.adjustment,
          adjustment_reason: parsed.reason,
          created_by: context.user.id,
        });
      if (error) throw error;
    } else if (intent === "wbs_node") {
      const parsed = z
        .object({
          code: z.string().trim().min(1).max(80),
          name: z.string().trim().min(1).max(160),
          parentId: z.union([uuid, z.literal("")]),
        })
        .parse({
          code: form.get("code"),
          name: form.get("name"),
          parentId: form.get("parent_id") ?? "",
        });
      const { error } = await context.client
        .from("lukas_qto_boq_wbs_nodes")
        .insert({
          project_id: context.project.id,
          version_id: versionId,
          parent_id: parsed.parentId || null,
          code: parsed.code,
          name: parsed.name,
          created_by: context.user.id,
        });
      if (error) throw error;
    } else if (intent === "wbs_allocation") {
      const parsed = z
        .object({
          lineId: uuid,
          nodeId: uuid,
          percent: decimal.refine(
            (value) =>
              compareExact(parseExactDecimal(value), parseExactDecimal("0")) >
                0 &&
              compareExact(
                parseExactDecimal(value),
                parseExactDecimal("100"),
              ) <= 0,
            "배분율은 0 초과 100 이하여야 합니다.",
          ),
        })
        .parse({
          lineId: form.get("line_id"),
          nodeId: form.get("wbs_node_id"),
          percent: form.get("allocation_percent"),
        });
      const { error } = await context.client
        .from("lukas_qto_boq_wbs_allocations")
        .insert({
          project_id: context.project.id,
          version_id: versionId,
          line_id: parsed.lineId,
          wbs_node_id: parsed.nodeId,
          allocation_percent: parsed.percent,
          created_by: context.user.id,
        });
      if (error) throw error;
    } else if (intent === "mapping") {
      const parsed = z
        .object({
          lineId: uuid,
          fileId: uuid,
          subject: z.string().trim().min(1).max(240),
          factor: decimal.refine(
            (value) => !value.startsWith("-") && value !== "0",
            "계수는 0보다 커야 합니다.",
          ),
        })
        .parse({
          lineId: form.get("line_id"),
          fileId: form.get("source_file_id"),
          subject: form.get("source_subject_key"),
          factor: form.get("factor"),
        });
      const { data: line } = await context.client
        .from("lukas_qto_boq_lines")
        .select("id,unit")
        .eq("id", parsed.lineId)
        .eq("version_id", versionId)
        .eq("project_id", context.project.id)
        .single();
      if (!line) throw new Error("연결할 품목을 찾지 못했습니다.");
      const { file, sourceSha256, resolved } = await resolveStoredBoqSource(
        context.client,
        context.project.id,
        parsed.fileId,
        parsed.subject,
        unit.parse(line.unit),
      );
      const { error } = await context.client
        .from("lukas_qto_boq_quantity_mappings")
        .insert({
          project_id: context.project.id,
          version_id: versionId,
          line_id: parsed.lineId,
          source_file_id: file.id,
          source_sha256: sourceSha256,
          source_subject_key: resolved.subjectKey,
          source_quantity: resolved.quantity,
          factor: parsed.factor,
          unit: resolved.unit,
          element_ids: resolved.elementIds,
          created_by: context.user.id,
        });
      if (error) throw error;
    } else if (intent === "exclusion") {
      const parsed = z
        .object({
          fileId: uuid,
          subject: z.string().trim().min(1).max(240),
          unit,
          reason: z.string().trim().min(1).max(1000),
        })
        .parse({
          fileId: form.get("source_file_id"),
          subject: form.get("source_subject_key"),
          unit: form.get("unit"),
          reason: form.get("reason"),
        });
      const { file, sourceSha256, resolved } = await resolveStoredBoqSource(
        context.client,
        context.project.id,
        parsed.fileId,
        parsed.subject,
        parsed.unit,
      );
      const { data: collision } = await context.client
        .from("lukas_qto_boq_quantity_mappings")
        .select("id")
        .eq("version_id", versionId)
        .eq("source_file_id", file.id)
        .eq("source_subject_key", resolved.subjectKey)
        .eq("unit", resolved.unit)
        .limit(1)
        .maybeSingle();
      if (collision)
        throw new Error(
          "이미 품목에 연결한 원수량은 동시에 제외할 수 없습니다.",
        );
      const { error } = await context.client
        .from("lukas_qto_boq_source_exclusions")
        .insert({
          project_id: context.project.id,
          version_id: versionId,
          source_file_id: file.id,
          source_sha256: sourceSha256,
          source_subject_key: resolved.subjectKey,
          source_quantity: resolved.quantity,
          unit: resolved.unit,
          element_ids: resolved.elementIds,
          reason: parsed.reason,
          created_by: context.user.id,
        });
      if (error) throw error;
    } else if (intent === "component") {
      const parsed = z
        .object({
          lineId: uuid,
          resourceId: uuid,
          coefficient: decimal.refine(
            (value) => !value.startsWith("-") && value !== "0",
            "소요계수는 0보다 커야 합니다.",
          ),
        })
        .parse({
          lineId: form.get("line_id"),
          resourceId: form.get("resource_id"),
          coefficient: form.get("coefficient"),
        });
      const { error } = await context.client
        .from("lukas_qto_boq_rate_components")
        .insert({
          project_id: context.project.id,
          version_id: versionId,
          line_id: parsed.lineId,
          resource_id: parsed.resourceId,
          coefficient: parsed.coefficient,
          created_by: context.user.id,
        });
      if (error) throw error;
    } else if (intent === "submit") {
      if (version.engine_version === "VERIFIED-BOQ-1.1") {
        const mutation = parseDrawingBoqMutationForm(form);
        if (mutation.intent !== "submit" || mutation.versionId !== versionId)
          throw new Error("지원하지 않는 작업입니다.");
        await submitVerifiedBoqV1_1(context.client, context.user.id, versionId);
        return redirect(back(versionId), { headers: context.headers });
      }
      const rows = await loadVersionData(context.client, version as Version);
      await assertVersionSourceCoverage(
        context.client,
        context.project.id,
        rows.mappings,
        rows.exclusions,
      );
      const { data: resourceRows, error: resourceError } = await context.client
        .from("lukas_qto_price_resources")
        .select(
          "id,price_book_id,resource_code,resource_type,resource_name,specification,unit,unit_price_krw",
        )
        .eq("price_book_id", version.price_book_id);
      if (resourceError) throw resourceError;
      const result = calculate(
        version as Version,
        rows,
        (resourceRows ?? []) as Resource[],
      );
      if (result.status !== "calculated" || result.lines.length === 0)
        throw new Error(
          "모든 품목에 원수량과 단가 자원을 연결해야 검토를 요청할 수 있습니다.",
        );
      if (version.supersedes_id) {
        const { data: previous } = await context.client
          .from("lukas_qto_boq_versions")
          .select(
            "id,version_no,title,status,calculation_policy,quantity_scale,price_book_id,supersedes_id,created_by,result_sha256,direct_cost_krw,engine_version,input_state_sha256,manifest_sha256,line_count",
          )
          .eq("id", version.supersedes_id)
          .eq("project_id", context.project.id)
          .single();
        if (!previous || !["approved", "superseded"].includes(previous.status))
          throw new Error("이전 승인 버전을 확인할 수 없습니다.");
        const [previousRows, previousResourcesResult] = await Promise.all([
          loadVersionData(context.client, previous as Version),
          context.client
            .from("lukas_qto_price_resources")
            .select(
              "id,price_book_id,resource_code,resource_type,resource_name,specification,unit,unit_price_krw",
            )
            .eq("price_book_id", previous.price_book_id),
        ]);
        if (previousResourcesResult.error) throw previousResourcesResult.error;
        const comparison = compareVerifiedBoq(
          calculate(
            previous as Version,
            previousRows,
            (previousResourcesResult.data ?? []) as Resource[],
          ),
          result,
        );
        if (comparison.status !== "comparable" || !comparison.amountCloses)
          throw new Error(
            "이전 버전과 금액 증감 합계가 닫히지 않아 승인 요청을 중지했습니다.",
          );
      }
      const { error } = await context.client
        .from("lukas_qto_boq_versions")
        .update({
          result_sha256: result.canonicalSha256,
          direct_cost_krw: result.directCostKrw,
          line_count: result.lines.length,
          status: "in_review",
        })
        .eq("id", versionId);
      if (error) throw error;
    } else if (intent === "decision") {
      if (!context.mayReview)
        throw new Error("검토자만 승인 결정을 기록할 수 있습니다.");
      if (version.engine_version === "VERIFIED-BOQ-1.1") {
        const mutation = parseDrawingBoqMutationForm(form);
        if (mutation.intent !== "decision" || mutation.versionId !== versionId)
          throw new Error("지원하지 않는 작업입니다.");
        await recheckAndDecideVerifiedBoqV1_1(
          context.client,
          context.user.id,
          mutation,
        );
        return redirect(back(versionId), { headers: context.headers });
      }
      const rows = await loadVersionData(context.client, version as Version);
      await assertVersionSourceCoverage(
        context.client,
        context.project.id,
        rows.mappings,
        rows.exclusions,
      );
      const { data: resourceRows, error: resourceError } = await context.client
        .from("lukas_qto_price_resources")
        .select(
          "id,price_book_id,resource_code,resource_type,resource_name,specification,unit,unit_price_krw",
        )
        .eq("price_book_id", version.price_book_id);
      if (resourceError) throw resourceError;
      const current = calculate(
        version as Version,
        rows,
        (resourceRows ?? []) as Resource[],
      );
      if (
        version.result_sha256 !== current.canonicalSha256 ||
        Number(version.line_count) !== current.lines.length
      )
        throw new Error(
          "승인 요청 이후 계산 입력이나 결과가 달라져 결정을 기록할 수 없습니다.",
        );
      const parsed = z
        .object({
          decision: z.enum(["approved", "rejected", "deferred"]),
          note: z.string().max(2000),
        })
        .parse({
          decision: form.get("decision"),
          note: form.get("note") ?? "",
        });
      const { error } = await context.client.rpc("lukas_qto_decide_boq", {
        p_version_id: versionId,
        p_decision: parsed.decision,
        p_note: parsed.note,
      });
      if (error) throw error;
    } else throw new Error("지원하지 않는 작업입니다.");
    return redirect(back(versionId), { headers: context.headers });
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      String(error.code).startsWith("P6")
    ) {
      const bounded = drawingQuantityLineageErrorResponse(error);
      return data(
        { error: bounded.body.error, errorCode: bounded.body.errorCode },
        { status: bounded.status, headers: context.headers },
      );
    }
    return data(
      {
        error: error instanceof Error ? error.message : "저장하지 못했습니다.",
      },
      { status: 400, headers: context.headers },
    );
  }
}

const moneyText = (value: string | number | null) => {
  if (value === null) return "—";
  const raw = String(value).trim();
  if (!/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/.test(raw)) return "—";
  const negative = raw.startsWith("-");
  const unsigned = negative ? raw.slice(1) : raw;
  const [rawInteger, rawFraction = ""] = unsigned.split(".");
  const integer = rawInteger.replace(/^0+(?=\d)/, "") || "0";
  const fraction = rawFraction.replace(/0+$/, "");
  const normalized = `${negative && (integer !== "0" || fraction) ? "-" : ""}${integer}${fraction ? `.${fraction}` : ""}`;
  const [normalizedInteger, normalizedFraction] = normalized
    .replace(/^-/, "")
    .split(".");
  const grouped = normalizedInteger.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${normalized.startsWith("-") ? "-" : ""}${grouped}${normalizedFraction ? `.${normalizedFraction}` : ""}원`;
};
const statusLabel: Record<string, string> = {
  draft: "작성 중",
  in_review: "승인 대기",
  approved: "승인 완료",
  superseded: "이전 개정",
};
const inputClass = "h-11 rounded-md border bg-background px-3 text-sm";

export default function VerifiedBoq({
  loaderData,
  actionData,
}: Route.ComponentProps) {
  const {
    project,
    files,
    priceBooks,
    versions,
    version,
    resources,
    versionRows,
    result,
  } = loaderData;
  const draft = version?.status === "draft" && loaderData.mayEdit;
  const activeBookId = version?.price_book_id ?? priceBooks[0]?.id ?? "";
  const currentResources = resources.filter(
    (resource) => resource.price_book_id === activeBookId,
  );
  const identityByElement = new Map(
    loaderData.identityLinks.map((link) => [link.revit_element_id, link]),
  );
  return (
    <main className="mx-auto w-full max-w-7xl px-5 pb-28 pt-8 sm:px-8">
      <Link
        className="inline-flex min-h-11 items-center gap-1 text-sm text-muted-foreground underline underline-offset-4"
        to={`/projects/${project.id}/quantities`}
      >
        <ArrowLeft className="size-4" /> 물량 화면으로
      </Link>
      <header className="mt-4 flex flex-col gap-4 border-b pb-7 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-xs font-bold tracking-[0.16em] text-primary">
            검증 내역서
          </p>
          <h1 className="mt-2 text-3xl font-bold">{project.name} 직접공사비</h1>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-muted-foreground">
            원본 물량은 바꾸지 않고 품목·단가 자원을 연결합니다. 각 금액에서
            원본 파일, Revit Element ID, 계산식을 다시 확인할 수 있습니다.
          </p>
        </div>
        {version &&
        result &&
        loaderData.snapshotValid &&
        version.engine_version === "VERIFIED-BOQ-1.0" ? (
          <div className="flex gap-2">
            <Button asChild className="min-h-11" variant="outline">
              <a href={`?version=${version.id}&download=xlsx`}>
                <Download className="size-4" /> Excel
              </a>
            </Button>
            <Button asChild className="min-h-11" variant="outline">
              <a href={`?version=${version.id}&download=csv`}>CSV</a>
            </Button>
          </div>
        ) : null}
      </header>
      {actionData?.error ? (
        <p
          aria-live="assertive"
          className="mt-5 rounded-xl bg-destructive/10 p-4 text-sm text-destructive"
          role="alert"
        >
          {actionData.error}
        </p>
      ) : null}

      <ol className="mt-6 grid gap-2 sm:grid-cols-5">
        {[
          "단가표 근거",
          "내역 버전",
          "품목",
          "물량·단가 연결",
          "검토·승인",
        ].map((label, index) => (
          <li className="rounded-xl border bg-card p-3 text-sm" key={label}>
            <span className="mr-2 font-bold text-primary">{index + 1}</span>
            {label}
          </li>
        ))}
      </ol>

      <section className="mt-6 grid gap-5 lg:grid-cols-2">
        <div className="rounded-2xl border bg-card p-5">
          <h2 className="flex items-center gap-2 font-semibold">
            <BookOpenCheck className="size-5 text-primary" /> 1. 단가표 등록
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            고객이 보유하거나 사용 권한이 있는 파일만 등록합니다.
          </p>
          {loaderData.mayEdit ? (
            <Form className="mt-4 grid gap-3" method="post">
              <input name="intent" type="hidden" value="price_book" />
              <div className="grid gap-2 sm:grid-cols-2">
                <Input
                  aria-label="단가표 이름"
                  name="name"
                  placeholder="단가표 이름"
                  required
                />
                <Input
                  aria-label="단가표 버전"
                  name="version_label"
                  placeholder="버전 예: 2026-08"
                  required
                />
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <Input
                  aria-label="기준일"
                  name="effective_date"
                  required
                  type="date"
                />
                <select
                  aria-label="사용 근거"
                  className={inputClass}
                  name="rights_basis"
                >
                  <option value="customer_owned">고객 보유</option>
                  <option value="licensed">사용권 보유</option>
                  <option value="public_authorized">공개·사용 허가</option>
                </select>
              </div>
              <select
                aria-label="단가표 원본 파일"
                className={inputClass}
                name="source_file_id"
                required
              >
                <option value="">원본 파일 선택</option>
                {files
                  .filter((file) => ["estimate", "other"].includes(file.kind))
                  .map((file) => (
                    <option key={file.id} value={file.id}>
                      {file.original_filename}
                    </option>
                  ))}
              </select>
              <Input
                aria-label="사용권 메모"
                name="license_note"
                placeholder="출처와 사용 권한을 적어주세요"
                required
              />
              <Button className="min-h-11" type="submit">
                단가표 근거 등록
              </Button>
            </Form>
          ) : null}
          <ul className="mt-4 space-y-2 text-sm">
            {priceBooks.map((book) => (
              <li className="rounded-xl bg-muted p-3" key={book.id}>
                <b>{book.name}</b> · {book.version_label}
                <br />
                <span className="text-xs text-muted-foreground">
                  기준일 {book.effective_date}
                </span>
              </li>
            ))}
          </ul>
        </div>
        <div className="rounded-2xl border bg-card p-5">
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-semibold">단가 자원</h2>
            <a
              className="text-sm text-primary underline underline-offset-4"
              href="?download=pricebook-template"
            >
              CSV 양식
            </a>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            재료·노무·경비 단가를 직접 입력하거나 등록한 고객 단가표
            CSV/XLSX에서 가져옵니다.
          </p>
          {loaderData.mayEdit && priceBooks.length ? (
            <Form className="mt-4 grid gap-3" method="post">
              <input name="intent" type="hidden" value="resource" />
              <select
                aria-label="단가표"
                className={inputClass}
                name="price_book_id"
                defaultValue={activeBookId}
              >
                {priceBooks.map((book) => (
                  <option key={book.id} value={book.id}>
                    {book.name} {book.version_label}
                  </option>
                ))}
              </select>
              <div className="grid gap-2 sm:grid-cols-2">
                <Input
                  aria-label="자원 코드"
                  name="resource_code"
                  placeholder="자원 코드"
                  required
                />
                <Input
                  aria-label="자원명"
                  name="resource_name"
                  placeholder="자원명"
                  required
                />
              </div>
              <div className="grid gap-2 sm:grid-cols-3">
                <select
                  aria-label="자원 구분"
                  className={inputClass}
                  name="resource_type"
                >
                  <option value="material">재료</option>
                  <option value="labor">노무</option>
                  <option value="expense">경비</option>
                  <option value="equipment">장비(경비)</option>
                </select>
                <select
                  aria-label="자원 단위"
                  className={inputClass}
                  name="unit"
                >
                  <option>EA</option>
                  <option>m</option>
                  <option>m2</option>
                  <option>m3</option>
                  <option>kg</option>
                  <option>t</option>
                  <option>day</option>
                  <option>hr</option>
                </select>
                <Input
                  aria-label="원화 단가"
                  inputMode="decimal"
                  name="unit_price_krw"
                  placeholder="원화 단가"
                  required
                />
              </div>
              <Input
                aria-label="자원 규격"
                name="specification"
                placeholder="규격(선택)"
              />
              <Button className="min-h-11" type="submit">
                단가 자원 추가
              </Button>
            </Form>
          ) : null}
          {loaderData.mayEdit && priceBooks.length ? (
            <Form className="mt-3 flex gap-2" method="post">
              <input name="intent" type="hidden" value="resource_import" />
              <select
                aria-label="가져올 단가표"
                className={`${inputClass} min-w-0 flex-1`}
                name="price_book_id"
              >
                {priceBooks.map((book) => (
                  <option key={book.id} value={book.id}>
                    {book.name} {book.version_label}
                  </option>
                ))}
              </select>
              <Button className="min-h-11" type="submit" variant="outline">
                원본에서 일괄 가져오기
              </Button>
            </Form>
          ) : null}
          <ul className="mt-4 max-h-60 space-y-2 overflow-auto text-sm">
            {currentResources.map((resource) => (
              <li
                className="flex justify-between rounded-xl border p-3"
                key={resource.id}
              >
                <span>
                  {resource.resource_code} · {resource.resource_name}
                </span>
                <b>{moneyText(resource.unit_price_krw)}</b>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="mt-5 rounded-2xl border bg-card p-5">
        <h2 className="flex items-center gap-2 font-semibold">
          <ListTree className="size-5 text-primary" /> 2. 내역 버전
        </h2>
        <div className="mt-4 flex flex-wrap gap-2">
          {versions.map((item) => (
            <Link
              className={`rounded-full border px-4 py-2 text-sm ${item.id === version?.id ? "bg-primary text-primary-foreground" : "bg-background"}`}
              key={item.id}
              to={`?version=${item.id}`}
            >
              V{item.version_no} {item.title} · {statusLabel[item.status]}
            </Link>
          ))}
        </div>
        {loaderData.mayEdit && priceBooks.length ? (
          <Form
            className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5"
            method="post"
          >
            <input name="intent" type="hidden" value="version" />
            <Input
              aria-label="내역 제목"
              name="title"
              placeholder="내역 제목"
              required
            />
            <select
              aria-label="단가표"
              className={inputClass}
              name="price_book_id"
            >
              {priceBooks.map((book) => (
                <option key={book.id} value={book.id}>
                  {book.name} {book.version_label}
                </option>
              ))}
            </select>
            <select
              aria-label="이전 승인 버전"
              className={inputClass}
              name="supersedes_id"
            >
              <option value="">첫 버전(이전 없음)</option>
              {versions
                .filter((item) => item.status === "approved")
                .map((item) => (
                  <option key={item.id} value={item.id}>
                    V{item.version_no}에서 새 개정
                  </option>
                ))}
            </select>
            <select
              aria-label="계산 방식"
              className={inputClass}
              name="calculation_policy"
            >
              <option value="general_half_away">일반 반올림</option>
              <option value="ems_component_truncate">EMS 구성별 절사</option>
            </select>
            <div className="flex gap-2">
              <Input
                aria-label="수량 소수 자릿수"
                className="w-24"
                defaultValue="6"
                max="9"
                min="0"
                name="quantity_scale"
                type="number"
              />
              <Button className="min-h-11 flex-1" type="submit">
                새 버전
              </Button>
            </div>
          </Form>
        ) : null}
      </section>

      {version && versionRows ? (
        <>
          {draft ? (
            <section className="mt-5 rounded-2xl border bg-card p-5">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <h2 className="font-semibold">CBS·WBS·품목 일괄 가져오기</h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    빈 내역 버전에만 적용됩니다. 먼저 CSV 양식을 내려받아
                    프로젝트 파일에 원본으로 등록하세요.
                  </p>
                </div>
                <Button asChild className="min-h-11" variant="outline">
                  <a href="?download=structure-template">CSV 양식</a>
                </Button>
              </div>
              <Form
                className="mt-4 flex flex-col gap-2 sm:flex-row"
                method="post"
              >
                <input name="intent" type="hidden" value="structure_import" />
                <input name="version_id" type="hidden" value={version.id} />
                <select
                  aria-label="가져올 내역 체계 원본"
                  className={`${inputClass} min-w-0 flex-1`}
                  name="source_file_id"
                  required
                >
                  <option value="">내역 체계 CSV/XLSX 선택</option>
                  {files
                    .filter(
                      (file) =>
                        file.immutable &&
                        ["estimate", "other"].includes(file.kind),
                    )
                    .map((file) => (
                      <option key={file.id} value={file.id}>
                        {file.original_filename}
                      </option>
                    ))}
                </select>
                <Button className="min-h-11" type="submit" variant="outline">
                  빈 버전에 가져오기
                </Button>
              </Form>
            </section>
          ) : null}
          <section className="mt-5 grid gap-5 lg:grid-cols-3">
            <div className="rounded-2xl border bg-card p-5">
              <h2 className="font-semibold">3. 공종(CBS)·품목</h2>
              {draft ? (
                <>
                  <Form className="mt-4 grid gap-2" method="post">
                    <input name="intent" type="hidden" value="section" />
                    <input name="version_id" type="hidden" value={version.id} />
                    <Input
                      aria-label="공종 코드"
                      name="code"
                      placeholder="공종 코드"
                      required
                    />
                    <Input
                      aria-label="공종명"
                      name="name"
                      placeholder="공종명"
                      required
                    />
                    <Button className="min-h-11" type="submit">
                      공종 추가
                    </Button>
                  </Form>
                  {versionRows.sections.length ? (
                    <Form className="mt-4 grid gap-2" method="post">
                      <input name="intent" type="hidden" value="line" />
                      <input
                        name="version_id"
                        type="hidden"
                        value={version.id}
                      />
                      <select
                        aria-label="공종"
                        className={inputClass}
                        name="section_id"
                      >
                        {versionRows.sections.map((section) => (
                          <option key={section.id} value={section.id}>
                            {section.code} {section.name}
                          </option>
                        ))}
                      </select>
                      <div className="grid gap-2 sm:grid-cols-2">
                        <Input
                          aria-label="품목 코드"
                          name="item_code"
                          placeholder="품목 코드"
                          required
                        />
                        <Input
                          aria-label="품목명"
                          name="item_name"
                          placeholder="품목명"
                          required
                        />
                      </div>
                      <div className="grid gap-2 sm:grid-cols-3">
                        <Input
                          aria-label="규격"
                          name="specification"
                          placeholder="규격"
                        />
                        <select
                          aria-label="품목 단위"
                          className={inputClass}
                          name="unit"
                        >
                          <option>EA</option>
                          <option>m</option>
                          <option>m2</option>
                          <option>m3</option>
                        </select>
                        <Input
                          aria-label="보정수량"
                          defaultValue="0"
                          inputMode="decimal"
                          name="signed_adjustment"
                        />
                      </div>
                      <Input
                        aria-label="보정 사유"
                        name="adjustment_reason"
                        placeholder="보정이 있을 때 사유 필수"
                      />
                      <Button className="min-h-11" type="submit">
                        품목 추가
                      </Button>
                    </Form>
                  ) : null}
                </>
              ) : null}
            </div>
            <div className="rounded-2xl border bg-card p-5">
              <h2 className="font-semibold">등록 품목</h2>
              <ul className="mt-4 space-y-2 text-sm">
                {versionRows.lines.map((line) => (
                  <li className="rounded-xl border p-3" key={line.id}>
                    <b>
                      {line.item_code} · {line.item_name}
                    </b>
                    <p className="mt-1 text-muted-foreground">
                      {line.specification || "규격 없음"} · {line.unit}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
            <div className="rounded-2xl border bg-card p-5">
              <h2 className="font-semibold">작업 위치(WBS)</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                동·층·구역처럼 실제 작업 위치로 품목 금액을 배분합니다.
              </p>
              {draft ? (
                <>
                  <Form className="mt-4 grid gap-2" method="post">
                    <input name="intent" type="hidden" value="wbs_node" />
                    <input name="version_id" type="hidden" value={version.id} />
                    <select
                      aria-label="상위 작업 위치"
                      className={inputClass}
                      name="parent_id"
                    >
                      <option value="">최상위</option>
                      {versionRows.wbsNodes.map((node) => (
                        <option key={node.id} value={node.id}>
                          {node.code} {node.name}
                        </option>
                      ))}
                    </select>
                    <Input
                      aria-label="WBS 코드"
                      name="code"
                      placeholder="WBS 코드"
                      required
                    />
                    <Input
                      aria-label="작업 위치 이름"
                      name="name"
                      placeholder="예: 본관 / 1층"
                      required
                    />
                    <Button className="min-h-11" type="submit">
                      작업 위치 추가
                    </Button>
                  </Form>
                  {versionRows.lines.length && versionRows.wbsNodes.length ? (
                    <Form
                      className="mt-4 grid gap-2 border-t pt-4"
                      method="post"
                    >
                      <input
                        name="intent"
                        type="hidden"
                        value="wbs_allocation"
                      />
                      <input
                        name="version_id"
                        type="hidden"
                        value={version.id}
                      />
                      <select
                        aria-label="배분 품목"
                        className={inputClass}
                        name="line_id"
                      >
                        {versionRows.lines.map((line) => (
                          <option key={line.id} value={line.id}>
                            {line.item_code} {line.item_name}
                          </option>
                        ))}
                      </select>
                      <select
                        aria-label="작업 위치"
                        className={inputClass}
                        name="wbs_node_id"
                      >
                        {versionRows.wbsNodes.map((node) => (
                          <option key={node.id} value={node.id}>
                            {node.code} {node.name}
                          </option>
                        ))}
                      </select>
                      <Input
                        aria-label="배분율"
                        defaultValue="100"
                        inputMode="decimal"
                        name="allocation_percent"
                      />
                      <Button className="min-h-11" type="submit">
                        배분 추가
                      </Button>
                    </Form>
                  ) : null}
                </>
              ) : null}
              <ul className="mt-4 space-y-2 text-sm">
                {versionRows.wbsAllocations.map((allocation) => (
                  <li className="rounded-xl border p-3" key={allocation.id}>
                    {versionRows.lines.find(
                      (line) => line.id === allocation.line_id,
                    )?.item_code ?? "품목"}{" "}
                    →{" "}
                    {versionRows.wbsNodes.find(
                      (node) => node.id === allocation.wbs_node_id,
                    )?.name ?? "WBS"}{" "}
                    <b>{String(allocation.allocation_percent)}%</b>
                  </li>
                ))}
              </ul>
            </div>
          </section>

          {version.engine_version === "VERIFIED-BOQ-1.1" ? (
            <div className="mt-5">
              <VerifiedBoqDrawingSources
                boqVersionId={version.id}
                editable={draft && loaderData.userId === version.created_by}
                lines={versionRows.lines.map((line) => ({
                  id: line.id,
                  itemCode: line.item_code,
                  itemName: line.item_name,
                  unit: line.unit,
                }))}
                rows={loaderData.drawingSources}
              />
              {loaderData.drawingSourcesHaveMore ? (
                <p className="mt-2 text-xs text-muted-foreground">
                  현재 버전에 연결된 근거를 우선하고, 나머지는 최신순으로 최대
                  200개까지 표시합니다.
                </p>
              ) : null}
            </div>
          ) : null}

          {draft && versionRows.lines.length ? (
            <section className="mt-5 grid gap-5 lg:grid-cols-2">
              <div className="rounded-2xl border bg-card p-5">
                <h2 className="flex items-center gap-2 font-semibold">
                  <Link2 className="size-5 text-primary" /> 4. 원수량 연결
                </h2>
                <Form className="mt-4 grid gap-3" method="post">
                  <input name="intent" type="hidden" value="mapping" />
                  <input name="version_id" type="hidden" value={version.id} />
                  <select
                    aria-label="연결할 품목"
                    className={inputClass}
                    name="line_id"
                  >
                    {versionRows.lines.map((line) => (
                      <option key={line.id} value={line.id}>
                        {line.item_code} {line.item_name}
                      </option>
                    ))}
                  </select>
                  <select
                    aria-label="원수량 파일"
                    className={inputClass}
                    name="source_file_id"
                  >
                    {files
                      .filter((file) =>
                        ["qto_csv", "element_ledger"].includes(file.kind),
                      )
                      .map((file) => (
                        <option key={file.id} value={file.id}>
                          {file.original_filename}
                        </option>
                      ))}
                  </select>
                  <Input
                    aria-label="원수량 묶음 키"
                    name="source_subject_key"
                    placeholder="QTO 검산키 또는 element:1001:volume"
                    required
                  />
                  <Input
                    aria-label="연결 계수"
                    defaultValue="1"
                    inputMode="decimal"
                    name="factor"
                  />
                  <p className="text-xs leading-5 text-muted-foreground">
                    수량·단위·Element ID는 입력하지 않습니다. 서버가 변경되지
                    않은 원본 CSV에서 직접 읽습니다. QTO는 64자리 검산키, 객체별
                    수량표는 예: element:1001:volume을 사용하세요.
                  </p>
                  <Button className="min-h-11" type="submit">
                    원수량 연결
                  </Button>
                </Form>
                <Form className="mt-5 grid gap-3 border-t pt-5" method="post">
                  <input name="intent" type="hidden" value="exclusion" />
                  <input name="version_id" type="hidden" value={version.id} />
                  <p className="text-sm font-semibold">원수량 제외 기록</p>
                  <select
                    aria-label="제외할 원수량 파일"
                    className={inputClass}
                    name="source_file_id"
                  >
                    {files
                      .filter((file) =>
                        ["qto_csv", "element_ledger"].includes(file.kind),
                      )
                      .map((file) => (
                        <option key={file.id} value={file.id}>
                          {file.original_filename}
                        </option>
                      ))}
                  </select>
                  <div className="grid gap-2 sm:grid-cols-[1fr_6rem]">
                    <Input
                      aria-label="제외할 원수량 키"
                      name="source_subject_key"
                      placeholder="검산키 또는 element:1001:volume"
                      required
                    />
                    <select
                      aria-label="제외 원수량 단위"
                      className={inputClass}
                      name="unit"
                    >
                      <option>EA</option>
                      <option>m</option>
                      <option>m2</option>
                      <option>m3</option>
                    </select>
                  </div>
                  <Input
                    aria-label="제외 사유"
                    name="reason"
                    placeholder="제외 사유를 반드시 기록하세요"
                    required
                  />
                  <Button className="min-h-11" type="submit" variant="outline">
                    제외 근거 저장
                  </Button>
                </Form>
                {versionRows.exclusions.length ? (
                  <ul className="mt-4 space-y-2 text-sm">
                    {versionRows.exclusions.map((exclusion) => (
                      <li
                        className="rounded-xl bg-muted p-3"
                        key={exclusion.id}
                      >
                        <b>제외</b> {exclusion.source_subject_key} ·{" "}
                        {String(exclusion.source_quantity)} {exclusion.unit}
                        <br />
                        <span className="text-xs text-muted-foreground">
                          {exclusion.reason} · Element{" "}
                          {exclusion.element_ids.join(", ")}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
              <div className="rounded-2xl border bg-card p-5">
                <h2 className="font-semibold">단가 자원 연결</h2>
                <Form className="mt-4 grid gap-3" method="post">
                  <input name="intent" type="hidden" value="component" />
                  <input name="version_id" type="hidden" value={version.id} />
                  <select
                    aria-label="연결할 품목"
                    className={inputClass}
                    name="line_id"
                  >
                    {versionRows.lines.map((line) => (
                      <option key={line.id} value={line.id}>
                        {line.item_code} {line.item_name}
                      </option>
                    ))}
                  </select>
                  <select
                    aria-label="단가 자원"
                    className={inputClass}
                    name="resource_id"
                  >
                    {currentResources.map((resource) => (
                      <option key={resource.id} value={resource.id}>
                        {resource.resource_code} {resource.resource_name} ·{" "}
                        {moneyText(resource.unit_price_krw)}
                      </option>
                    ))}
                  </select>
                  <Input
                    aria-label="자원 소요계수"
                    defaultValue="1"
                    inputMode="decimal"
                    name="coefficient"
                  />
                  <Button className="min-h-11" type="submit">
                    단가 자원 연결
                  </Button>
                </Form>
              </div>
            </section>
          ) : null}

          <section className="mt-5 rounded-2xl border bg-card p-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="font-semibold">계산 결과</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  {version.calculation_policy === "ems_component_truncate"
                    ? "재료·노무·경비 금액을 각각 절사 후 합산"
                    : "수량×합계단가를 반올림"}
                </p>
              </div>
              <div className="text-left sm:text-right">
                <p className="text-sm text-muted-foreground">직접공사비</p>
                <p className="text-2xl font-bold">
                  {result ? moneyText(result.directCostKrw) : "계산 전"}
                </p>
              </div>
            </div>
            {loaderData.calculationError ? (
              <p className="mt-4 rounded-xl bg-destructive/10 p-3 text-sm text-destructive">
                {loaderData.calculationError}
              </p>
            ) : null}
            <div className="mt-5 overflow-x-auto">
              <table className="w-full min-w-[900px] text-left text-sm">
                <thead className="border-b text-muted-foreground">
                  <tr>
                    <th className="pb-3">품목</th>
                    <th className="pb-3">원수량</th>
                    {result?.engineVersion === "VERIFIED-BOQ-1.1" ? (
                      <>
                        <th className="pb-3">보정값</th>
                        <th className="pb-3">보정 후 수량</th>
                      </>
                    ) : null}
                    <th className="pb-3">최종수량</th>
                    <th className="pb-3">재료/노무/경비</th>
                    <th className="pb-3">금액</th>
                    <th className="pb-3">근거</th>
                  </tr>
                </thead>
                <tbody>
                  {result?.lines.map((line) => (
                    <tr className="border-b" key={line.lineId}>
                      <td className="py-4">
                        <b>{line.itemCode}</b>
                        <br />
                        {line.itemName}
                      </td>
                      <td>{line.rawQuantity ?? "연결 필요"}</td>
                      {result.engineVersion === "VERIFIED-BOQ-1.1" &&
                      "adjustedQuantity" in line ? (
                        <>
                          <td>{line.adjustment}</td>
                          <td>{line.adjustedQuantity ?? "—"}</td>
                        </>
                      ) : null}
                      <td>
                        {line.finalQuantity ?? "—"} {line.unit}
                      </td>
                      <td>
                        {line.materialUnitPriceKrw ?? "—"} /{" "}
                        {line.laborUnitPriceKrw ?? "—"} /{" "}
                        {line.expenseUnitPriceKrw ?? "—"}
                      </td>
                      <td className="font-semibold">
                        {moneyText(line.amountKrw)}
                      </td>
                      <td>
                        <details>
                          <summary className="cursor-pointer text-primary">
                            계산식·요소
                          </summary>
                          <p className="mt-2 font-mono text-xs">
                            {line.formula || line.message}
                          </p>
                          <p className="mt-1 break-all text-xs">
                            Element {line.elementIds.join(", ") || "없음"}
                          </p>
                          {line.elementIds.some((id) =>
                            identityByElement.has(id),
                          ) ? (
                            <div className="mt-2 flex flex-wrap gap-2">
                              {line.elementIds.slice(0, 20).map((id) => {
                                const identity = identityByElement.get(id);
                                if (!identity) return null;
                                return (
                                  <Link
                                    className="inline-flex min-h-9 items-center rounded-lg border px-2 text-xs font-medium text-primary"
                                    key={id}
                                    target="_blank"
                                    to={`/projects/${project.id}/ifc/${identity.ifc_file_id}?globalId=${encodeURIComponent(identity.ifc_global_id)}`}
                                  >
                                    Element {id} · 3D에서 보기
                                  </Link>
                                );
                              })}
                            </div>
                          ) : null}
                          <p className="mt-1 break-all text-xs">
                            파일 확인번호{" "}
                            {line.sourceSha256.join(", ") || "없음"}
                          </p>
                        </details>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {loaderData.comparison ? (
            <section className="mt-5 rounded-2xl border bg-card p-5">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <h2 className="font-semibold">이전 승인 버전과 변경 비교</h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {loaderData.comparison.message}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">
                    직접공사비 증감
                  </p>
                  <p className="text-xl font-bold">
                    {moneyText(loaderData.comparison.amountDeltaKrw)}
                  </p>
                </div>
              </div>
              <div className="mt-4 overflow-x-auto">
                <table className="w-full min-w-[720px] text-left text-sm">
                  <thead className="border-b text-muted-foreground">
                    <tr>
                      <th className="pb-3">품목</th>
                      <th className="pb-3">변경</th>
                      <th className="pb-3">이전→현재 수량</th>
                      <th className="pb-3">금액 증감</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loaderData.comparison.rows.map((row) => (
                      <tr className="border-b" key={row.itemCode}>
                        <td className="py-3">
                          <b>{row.itemCode}</b> · {row.itemName}
                        </td>
                        <td>{row.changes.join(" · ")}</td>
                        <td>
                          {row.previousQuantity ?? "—"} →{" "}
                          {row.currentQuantity ?? "—"} {row.unit}
                        </td>
                        <td>{moneyText(row.amountDeltaKrw)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-4 text-xs text-muted-foreground">
                단위별 수량 증감:{" "}
                {Object.entries(loaderData.comparison.quantityDeltaByUnit)
                  .map(([key, value]) => `${key} ${value}`)
                  .join(" · ") || "없음"}
              </p>
            </section>
          ) : null}

          <section className="mt-5 rounded-2xl border bg-[#17124a] p-6 text-white">
            <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <h2 className="flex items-center gap-2 text-xl font-bold">
                  <ShieldCheck className="size-5" /> 5. 검토·승인
                </h2>
                <p className="mt-2 text-sm leading-6 text-indigo-100">
                  작성자와 승인자를 분리합니다. 승인된 버전은 직접 수정하지 않고
                  새 버전을 만듭니다.
                </p>
                <p className="mt-3 text-sm">
                  현재 상태: <b>{statusLabel[version.status]}</b>
                  {version.result_sha256 ? (
                    <span className="ml-2 break-all font-mono text-xs text-indigo-200">
                      {version.result_sha256}
                    </span>
                  ) : null}
                </p>
              </div>
              {draft &&
              result?.status === "calculated" &&
              result.lines.length ? (
                <Form method="post">
                  <input name="intent" type="hidden" value="submit" />
                  <input name="version_id" type="hidden" value={version.id} />
                  <Button
                    className="min-h-11 bg-white text-[#17124a] hover:bg-indigo-50"
                    type="submit"
                  >
                    <Send className="size-4" /> 승인 요청
                  </Button>
                </Form>
              ) : null}
            </div>
            {version.status === "in_review" &&
            loaderData.mayReview &&
            loaderData.snapshotValid ? (
              loaderData.userId === version.created_by ? (
                <p className="mt-5 rounded-xl bg-white/10 p-4 text-sm">
                  작성자는 스스로 승인할 수 없습니다. 다른 검토자가 확인해야
                  합니다.
                </p>
              ) : (
                <Form
                  className="mt-5 grid gap-3 sm:grid-cols-[12rem_1fr_auto]"
                  method="post"
                >
                  <input name="intent" type="hidden" value="decision" />
                  <input name="version_id" type="hidden" value={version.id} />
                  <select
                    aria-label="승인 결정"
                    className={`${inputClass} text-foreground`}
                    name="decision"
                    required
                  >
                    <option disabled value="">
                      결정을 선택하세요
                    </option>
                    <option value="approved">승인</option>
                    <option value="rejected">반려</option>
                    <option value="deferred">보류</option>
                  </select>
                  <Input
                    aria-label="검토 메모"
                    className="text-foreground"
                    name="note"
                    placeholder="검토 메모"
                  />
                  <Button
                    className="min-h-11 bg-white text-[#17124a] hover:bg-indigo-50"
                    type="submit"
                  >
                    <CheckCircle2 className="size-4" /> 결정 기록
                  </Button>
                </Form>
              )
            ) : null}
            <ul className="mt-5 space-y-2 text-sm">
              {versionRows.approvals.map((approval) => (
                <li className="rounded-xl bg-white/10 p-3" key={approval.id}>
                  {approval.decision} · {approval.note || "메모 없음"}{" "}
                  <span className="text-indigo-200">
                    {new Date(approval.created_at).toLocaleString("ko-KR")}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        </>
      ) : (
        <section className="mt-5 rounded-2xl border border-dashed p-8 text-center">
          <p className="font-semibold">먼저 단가표와 내역 버전을 만드세요.</p>
          <p className="mt-2 text-sm text-muted-foreground">
            사용자 보유 단가만 등록하며 표준단가를 임의로 제공하지 않습니다.
          </p>
        </section>
      )}
    </main>
  );
}
