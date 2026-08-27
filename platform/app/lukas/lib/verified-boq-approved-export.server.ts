import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  DrawingQuantityMeasurementKind,
  DrawingQuantityUnit,
} from "./drawing-quantity-lineage.ts";
import {
  DrawingQuantityLineageServerError,
  loadVerifiedBoqV1_1Calculation,
  type VerifiedBoqFreezeAuthority,
} from "./drawing-quantity-lineage.server.ts";
import { compareExact, parseExactDecimal } from "./exact-decimal.server.ts";
import {
  buildVerifiedBoqHandoffManifest,
  type VerifiedBoqApprovalEnvelope,
  type VerifiedBoqCalculationManifest,
} from "./verified-boq-manifest.server.ts";
import type { VerifiedBoqV1_1Result } from "./verified-boq-v1-1.server.ts";
import {
  buildVerifiedBoqXlsx,
  type VerifiedBoqWorkbookInput,
} from "./verified-boq-xlsx.server.ts";

export type ApprovedVerifiedBoqExport = {
  resultSha256: string;
  manifestSha256: string;
  handoffSha256: string;
  csv: Uint8Array;
  xlsx: Uint8Array;
  manifestJson: Uint8Array;
};

export function selectVerifiedBoqVersion<T extends { id: string }>(
  versions: readonly T[],
  requested: string | null,
  requireExact: boolean,
): T | null {
  const match = requested
    ? versions.find((version) => version.id === requested)
    : undefined;
  return match ?? (requested && requireExact ? null : (versions[0] ?? null));
}

export function approvedVerifiedBoqDownloadResponse(
  exported: ApprovedVerifiedBoqExport,
  format: "csv" | "xlsx" | "manifest",
  versionNo: number,
) {
  if (!Number.isSafeInteger(versionNo) || versionNo <= 0)
    throw new DrawingQuantityLineageServerError("P6C01");
  const file =
    format === "csv"
      ? {
          bytes: exported.csv,
          extension: "csv",
          type: "text/csv; charset=utf-8",
        }
      : format === "xlsx"
        ? {
            bytes: exported.xlsx,
            extension: "xlsx",
            type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          }
        : {
            bytes: exported.manifestJson,
            extension: "manifest.json",
            type: "application/json; charset=utf-8",
          };
  return new Response(Uint8Array.from(file.bytes).buffer, {
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Disposition": `attachment; filename="verified-boq-v${versionNo}.${file.extension}"`,
      "Content-Type": file.type,
    },
  });
}

export type VerifiedBoqWorkbookDrawingEvidence = {
  itemCode: string;
  quantityLinkId: string;
  revisionId: string;
  revisionVersion: number;
  snapshotSha256: string;
  objectId: string;
  lineageId: string;
  objectVersion: number;
  objectFingerprint: string;
  measurementKind: DrawingQuantityMeasurementKind;
  unit: DrawingQuantityUnit;
  rawQuantity: string;
  allocationFactor: string;
  measurementRuleVersion: "P4_MEASUREMENT_V1";
  sourceAnchorIds: string[];
  sourceFileSha256: string[];
  issueIds: string[];
};

type ApprovedInput = {
  result: VerifiedBoqV1_1Result;
  calculationManifest: VerifiedBoqCalculationManifest;
  approvalEnvelope: VerifiedBoqApprovalEnvelope;
  resources: VerifiedBoqWorkbookInput["resources"];
  legacyMappings: VerifiedBoqWorkbookInput["mappings"];
  drawingEvidence: VerifiedBoqWorkbookDrawingEvidence[];
  structures: VerifiedBoqWorkbookInput["structures"];
  review: VerifiedBoqWorkbookInput["review"];
};

const encoder = new TextEncoder();

function bytewise(left: string, right: string) {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function csvCell(value: string, protect = false) {
  const safe =
    protect && (/^[=+\-@]/.test(value) || /^0[0-9]/.test(value))
      ? `'${value}`
      : value;
  return `"${safe.replaceAll('"', '""')}"`;
}

function joined(values: readonly string[]) {
  return [...new Set(values)].sort(bytewise).join("|");
}

function sameDecimal(left: string, right: string) {
  try {
    return (
      compareExact(parseExactDecimal(left), parseExactDecimal(right)) === 0
    );
  } catch {
    return false;
  }
}

function validateWorkbookEvidence(input: ApprovedInput) {
  const lineById = new Map(
    input.calculationManifest.lines.map((line) => [line.lineId, line]),
  );
  const sourceById = new Map(
    input.calculationManifest.drawingSources.map((source) => [
      source.quantityLinkId,
      source,
    ]),
  );
  const remaining = [...input.drawingEvidence];
  for (const row of remaining)
    if (
      row.sourceAnchorIds.length !== new Set(row.sourceAnchorIds).size ||
      row.sourceAnchorIds.some(
        (id) =>
          !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
            id,
          ),
      )
    )
      throw new DrawingQuantityLineageServerError("P6C01");
  for (const mapping of input.calculationManifest.mappings.filter(
    (row) => row.sourceKind === "drawing",
  )) {
    const line = lineById.get(mapping.lineId);
    const source = sourceById.get(mapping.sourceId);
    const sourceHashes = source
      ? joined(source.sourceAnchors.map((anchor) => anchor.sourceSha256))
      : "";
    const issueIds = source
      ? joined(source.issueLinks.map((issue) => issue.issueId))
      : "";
    const index = remaining.findIndex(
      (row) =>
        row.itemCode === line?.itemCode &&
        row.quantityLinkId === source?.quantityLinkId &&
        row.revisionId === source.revisionId &&
        row.revisionVersion === source.revisionVersion &&
        row.snapshotSha256 === source.snapshotSha256 &&
        row.objectId === source.objectId &&
        row.lineageId === source.lineageId &&
        row.objectVersion === source.objectVersion &&
        row.objectFingerprint === source.objectFingerprint &&
        row.measurementKind === source.measurementKind &&
        row.unit === source.unit &&
        sameDecimal(row.rawQuantity, source.rawQuantity) &&
        sameDecimal(row.allocationFactor, mapping.allocationFactor) &&
        row.measurementRuleVersion === source.measurementRuleVersion &&
        joined(row.sourceFileSha256) === sourceHashes &&
        joined(row.issueIds) === issueIds,
    );
    if (index < 0) throw new DrawingQuantityLineageServerError("P6C01");
    remaining.splice(index, 1);
  }
  if (remaining.length) throw new DrawingQuantityLineageServerError("P6C01");
}

function buildCsv(
  input: ApprovedInput,
  hashes: {
    resultSha256: string;
    manifestSha256: string;
    handoffSha256: string;
  },
) {
  const drawingByItem = new Map<string, VerifiedBoqWorkbookDrawingEvidence[]>();
  for (const row of input.drawingEvidence) {
    const rows = drawingByItem.get(row.itemCode) ?? [];
    rows.push(row);
    drawingByItem.set(row.itemCode, rows);
  }
  const legacyByItem = new Map<string, ApprovedInput["legacyMappings"]>();
  for (const row of input.legacyMappings) {
    const rows = legacyByItem.get(row.itemCode) ?? [];
    rows.push(row);
    legacyByItem.set(row.itemCode, rows);
  }
  const header = [
    "공종",
    "품목코드",
    "품목명",
    "규격",
    "단위",
    "원수량",
    "보정값",
    "보정 후 수량",
    "최종수량",
    "재료단가",
    "노무단가",
    "경비단가",
    "합계단가",
    "금액",
    "도면 수량 연결 ID",
    "도면 개정 ID",
    "도면 개정 버전",
    "도면 스냅샷 확인번호",
    "도면 객체 ID",
    "도면 계보 ID",
    "도면 객체 지문",
    "도면 원수량",
    "도면 배분 계수",
    "도면 측정 규칙",
    "도면 anchor ID",
    "도면 이슈 ID",
    "도면 원본 파일 확인번호",
    "Legacy 원본파일",
    "Legacy 원수량 묶음",
    "Legacy Element ID",
    "Legacy 원본 파일 확인번호",
    "결과 확인번호",
    "계산 manifest 확인번호",
    "인계 확인번호",
  ];
  const rows = input.result.lines.map((line) => {
    const drawing = drawingByItem.get(line.itemCode) ?? [];
    const legacy = legacyByItem.get(line.itemCode) ?? [];
    const text = (value: string) => csvCell(value, true);
    const value = (value: string | null | undefined) => csvCell(value ?? "");
    return [
      text(line.sectionCode),
      text(line.itemCode),
      text(line.itemName),
      text(line.specification),
      text(line.unit),
      value(line.rawQuantity),
      value(line.adjustment),
      value(line.adjustedQuantity),
      value(line.finalQuantity),
      value(line.materialUnitPriceKrw),
      value(line.laborUnitPriceKrw),
      value(line.expenseUnitPriceKrw),
      value(line.totalUnitPriceKrw),
      value(line.amountKrw),
      text(joined(drawing.map((row) => row.quantityLinkId))),
      text(joined(drawing.map((row) => row.revisionId))),
      value(joined(drawing.map((row) => String(row.revisionVersion)))),
      text(joined(drawing.map((row) => row.snapshotSha256))),
      text(joined(drawing.map((row) => row.objectId))),
      text(joined(drawing.map((row) => row.lineageId))),
      text(joined(drawing.map((row) => row.objectFingerprint))),
      value(joined(drawing.map((row) => row.rawQuantity))),
      value(joined(drawing.map((row) => row.allocationFactor))),
      text(joined(drawing.map((row) => row.measurementRuleVersion))),
      text(joined(drawing.flatMap((row) => row.sourceAnchorIds))),
      text(joined(drawing.flatMap((row) => row.issueIds))),
      text(joined(drawing.flatMap((row) => row.sourceFileSha256))),
      text(joined(legacy.map((row) => row.sourceFilename))),
      text(joined(legacy.map((row) => row.subjectKey))),
      text(joined(legacy.flatMap((row) => row.elementIds))),
      text(joined(legacy.map((row) => row.sourceSha256))),
      text(hashes.resultSha256),
      text(hashes.manifestSha256),
      text(hashes.handoffSha256),
    ].join(",");
  });
  return encoder.encode(
    `\uFEFF${header.map((value) => csvCell(value)).join(",")}\r\n${rows.join("\r\n")}\r\n`,
  );
}

export function buildApprovedVerifiedBoqExport(
  input: ApprovedInput,
): ApprovedVerifiedBoqExport {
  if (input.approvalEnvelope.decidedBy === input.review.makerId)
    throw new DrawingQuantityLineageServerError("P6A01");
  if (
    input.calculationManifest.result.resultSha256 !==
      input.result.canonicalSha256 ||
    input.calculationManifest.result.directCostKrw !==
      input.result.directCostKrw ||
    JSON.stringify(input.calculationManifest.result.canonicalLines) !==
      JSON.stringify(input.result.lines)
  )
    throw new DrawingQuantityLineageServerError("P6C01");
  validateWorkbookEvidence(input);
  const handoff = buildVerifiedBoqHandoffManifest(
    input.calculationManifest,
    input.approvalEnvelope,
  );
  const hashes = {
    resultSha256: input.result.canonicalSha256,
    manifestSha256: handoff.manifest.manifestSha256,
    handoffSha256: handoff.handoffSha256,
  };
  const drawingEvidence = [...input.drawingEvidence].sort((left, right) =>
    bytewise(
      `${left.itemCode}\u001f${left.quantityLinkId}`,
      `${right.itemCode}\u001f${right.quantityLinkId}`,
    ),
  );
  const canonicalJson = new TextDecoder().decode(handoff.canonicalBytes);
  return {
    ...hashes,
    csv: buildCsv({ ...input, drawingEvidence }, hashes),
    xlsx: buildVerifiedBoqXlsx({
      result: input.result,
      resources: input.resources,
      mappings: input.legacyMappings,
      structures: input.structures,
      review: input.review,
      drawingEvidence,
      approvedManifest: {
        ...hashes,
        versionId: input.approvalEnvelope.versionId,
        decidedBy: input.approvalEnvelope.decidedBy,
        decidedAt: input.approvalEnvelope.decidedAt,
        note: input.approvalEnvelope.note,
        canonicalJson,
      },
    }),
    manifestJson: handoff.canonicalBytes,
  };
}

type FrozenDrawingInput = {
  lines: Array<{ id: string; itemCode: string }>;
  drawingLinks: Array<{
    line: string;
    factor: string;
    source: { id: string; anchors: Array<{ id: string }> };
  }>;
};

export function assertVerifiedBoqSourceAnchorIds(
  evidence: readonly VerifiedBoqWorkbookDrawingEvidence[],
  frozen: FrozenDrawingInput,
) {
  const itemByLine = new Map(
    frozen.lines.map((line) => [line.id, line.itemCode]),
  );
  const expected = frozen.drawingLinks.map((row) => ({
    itemCode: itemByLine.get(row.line),
    quantityLinkId: row.source.id,
    factor: row.factor,
    anchorIds: joined(row.source.anchors.map((anchor) => anchor.id)),
  }));
  const remaining = [...evidence];
  for (const row of expected) {
    const index = remaining.findIndex(
      (candidate) =>
        candidate.itemCode === row.itemCode &&
        candidate.quantityLinkId === row.quantityLinkId &&
        sameDecimal(candidate.allocationFactor, row.factor) &&
        joined(candidate.sourceAnchorIds) === row.anchorIds,
    );
    if (index < 0) throw new DrawingQuantityLineageServerError("P6C01");
    remaining.splice(index, 1);
  }
  if (remaining.length) throw new DrawingQuantityLineageServerError("P6C01");
}

function exactEquals(left: string | number | null, right: string) {
  if (left === null) return false;
  try {
    return (
      compareExact(
        parseExactDecimal(String(left)),
        parseExactDecimal(right),
      ) === 0
    );
  } catch {
    return false;
  }
}

const POSTGREST_PAGE_SIZE = 1_000;
const FILE_ID_BATCH_SIZE = 100;

async function loadAllVersionRows(
  userClient: SupabaseClient,
  table: "lukas_qto_boq_wbs_nodes" | "lukas_qto_boq_wbs_allocations",
  columns: string,
  versionId: string,
) {
  const rows: Record<string, unknown>[] = [];
  let from = 0;
  for (;;) {
    const result = await userClient
      .from(table)
      .select(columns)
      .eq("version_id", versionId)
      .order("id", { ascending: true })
      .range(from, from + POSTGREST_PAGE_SIZE - 1);
    if (result.error) throw new DrawingQuantityLineageServerError("P6A01");
    const page = (result.data ?? []) as unknown as Record<string, unknown>[];
    if (!page.length) return rows;
    rows.push(...page);
    if (rows.length > 10_000)
      throw new DrawingQuantityLineageServerError("P6C01");
    from += page.length;
  }
}

async function loadEvidenceFiles(
  userClient: SupabaseClient,
  fileIds: readonly string[],
) {
  const rows: Array<{
    id: string;
    original_filename: string;
    sha256: string;
    immutable: boolean;
  }> = [];
  const ids = [...new Set(fileIds)].sort(bytewise);
  for (let offset = 0; offset < ids.length; offset += FILE_ID_BATCH_SIZE) {
    const result = await userClient
      .from("lukas_qto_files")
      .select("id,original_filename,sha256,immutable")
      .in("id", ids.slice(offset, offset + FILE_ID_BATCH_SIZE));
    if (result.error) throw new DrawingQuantityLineageServerError("P6A01");
    rows.push(...(result.data ?? []));
  }
  if (
    rows.length !== ids.length ||
    new Set(rows.map((row) => row.id)).size !== ids.length
  )
    throw new DrawingQuantityLineageServerError("P6C01");
  return rows;
}

/** @internal Optional fourth argument is a server-test seam, never route input. */
export async function loadApprovedVerifiedBoqExport(
  userClient: SupabaseClient,
  actorId: string,
  versionId: string,
  authority?: VerifiedBoqFreezeAuthority,
): Promise<ApprovedVerifiedBoqExport> {
  try {
    const { data: version, error: versionError } = await userClient
      .from("lukas_qto_boq_versions")
      .select(
        "id,project_id,version_no,title,status,created_by,engine_version,input_state_sha256,result_sha256,manifest_sha256,direct_cost_krw,line_count",
      )
      .eq("id", versionId)
      .single();
    if (
      versionError ||
      !version ||
      version.engine_version !== "VERIFIED-BOQ-1.1" ||
      !["approved", "superseded"].includes(version.status)
    )
      throw new DrawingQuantityLineageServerError("P6A01");
    const { data: approvalRows, error: approvalError } = await userClient
      .from("lukas_qto_boq_approvals")
      .select("decision,note,decided_by,created_at")
      .eq("version_id", versionId)
      .order("created_at", { ascending: false });
    if (approvalError) throw new DrawingQuantityLineageServerError("P6A01");
    const approval = (approvalRows ?? []).find(
      (row) => row.decision === "approved",
    );
    if (!approval || approval.decided_by === version.created_by)
      throw new DrawingQuantityLineageServerError("P6A01");

    const calculation = await loadVerifiedBoqV1_1Calculation(
      userClient,
      actorId,
      versionId,
      authority,
    );
    if (
      calculation.parsed.inputStateSha256 !== version.input_state_sha256 ||
      calculation.result.canonicalSha256 !== version.result_sha256 ||
      calculation.manifest.manifestSha256 !== version.manifest_sha256 ||
      !exactEquals(version.direct_cost_krw, calculation.result.directCostKrw) ||
      version.line_count !== calculation.result.lines.length
    )
      throw new DrawingQuantityLineageServerError("P6C01");

    const frozen = calculation.parsed.databaseInput;
    const fileIds = [
      frozen.priceBook.fileId,
      ...frozen.legacyMappings.map((row) => row.fileId),
      ...frozen.drawingLinks.flatMap((row) =>
        row.source.anchors.map((anchor) => anchor.sourceFileId),
      ),
    ];
    const [projectResult, fileRows, wbsRows, allocationRows] =
      await Promise.all([
        userClient
          .from("lukas_qto_projects")
          .select("id,name")
          .eq("id", version.project_id)
          .single(),
        loadEvidenceFiles(userClient, fileIds),
        loadAllVersionRows(
          userClient,
          "lukas_qto_boq_wbs_nodes",
          "id,code,name",
          versionId,
        ),
        loadAllVersionRows(
          userClient,
          "lukas_qto_boq_wbs_allocations",
          "id,line_id,wbs_node_id,allocation_percent",
          versionId,
        ),
      ]);
    if (projectResult.error)
      throw new DrawingQuantityLineageServerError("P6A01");
    if (!projectResult.data)
      throw new DrawingQuantityLineageServerError("P6A01");
    const files = new Map(fileRows.map((row) => [row.id, row]));
    const expectedFiles = new Map<string, string>([
      [frozen.priceBook.fileId, frozen.priceBook.sha256],
      ...frozen.legacyMappings.map(
        (row) => [row.fileId, row.sha256] as [string, string],
      ),
      ...frozen.drawingLinks.flatMap((row) =>
        row.source.anchors.map(
          (anchor) =>
            [anchor.sourceFileId, anchor.sourceSha256] as [string, string],
        ),
      ),
    ]);
    if (
      [...expectedFiles].some(([id, digest]) => {
        const file = files.get(id);
        return !file || !file.immutable || file.sha256 !== digest;
      })
    )
      throw new DrawingQuantityLineageServerError("P6C01");

    const lineById = new Map(frozen.lines.map((line) => [line.id, line]));
    const resources = new Map(
      frozen.components.map((component) => [
        component.resource.id,
        component.resource,
      ]),
    );
    const nodes = new Map(wbsRows.map((node) => [node.id, node]));
    const allocations = allocationRows;
    if (
      allocations.some(
        (row) =>
          !lineById.has(String(row.line_id)) || !nodes.has(row.wbs_node_id),
      )
    )
      throw new DrawingQuantityLineageServerError("P6C01");
    const structures = frozen.lines.flatMap((line) => {
      const matches = allocations.filter((row) => row.line_id === line.id);
      if (!matches.length)
        return [
          {
            itemCode: line.itemCode,
            cbsCode: line.section.code,
            cbsName: line.section.name,
            wbsCode: "",
            wbsName: "",
            allocationPercent: "",
          },
        ];
      return matches.map((row) => {
        const node = nodes.get(row.wbs_node_id);
        if (!node) throw new DrawingQuantityLineageServerError("P6C01");
        return {
          itemCode: line.itemCode,
          cbsCode: line.section.code,
          cbsName: line.section.name,
          wbsCode: String(node.code),
          wbsName: String(node.name),
          allocationPercent: String(row.allocation_percent),
        };
      });
    });
    const approvalEnvelope: VerifiedBoqApprovalEnvelope = {
      versionId,
      resultSha256: calculation.result.canonicalSha256,
      manifestSha256: calculation.manifest.manifestSha256,
      decision: "approved",
      decidedBy: approval.decided_by,
      decidedAt: approval.created_at,
      note: approval.note,
    };
    const drawingEvidence = frozen.drawingLinks.map((row) => ({
      itemCode: lineById.get(row.line)?.itemCode ?? "",
      quantityLinkId: row.source.id,
      revisionId: row.source.revisionId,
      revisionVersion: row.source.revisionVersion,
      snapshotSha256: row.source.snapshotSha256,
      objectId: row.source.objectId,
      lineageId: row.source.lineageId,
      objectVersion: row.source.objectVersion,
      objectFingerprint: row.source.fingerprint,
      measurementKind: row.source.kind,
      unit: row.source.unit,
      rawQuantity: row.source.rawQuantity,
      allocationFactor: row.factor,
      measurementRuleVersion: row.source.rule,
      sourceAnchorIds: row.source.anchors.map((anchor) => anchor.id),
      sourceFileSha256: row.source.anchors.map((anchor) => anchor.sourceSha256),
      issueIds: row.source.issues.map((issue) => issue.issueId),
    }));
    assertVerifiedBoqSourceAnchorIds(drawingEvidence, frozen);
    return buildApprovedVerifiedBoqExport({
      result: calculation.result,
      calculationManifest: calculation.manifest.manifest,
      approvalEnvelope,
      resources: [...resources.values()].map((row) => ({
        code: row.code,
        type: row.type,
        name: row.name,
        specification: row.specification,
        unit: row.unit,
        unitPriceKrw: row.unitPriceKrw,
      })),
      legacyMappings: frozen.legacyMappings.map((row) => ({
        itemCode: lineById.get(row.line)?.itemCode ?? "",
        sourceFilename: files.get(row.fileId)?.original_filename ?? "",
        sourceSha256: row.sha256,
        subjectKey: row.subject,
        sourceQuantity: row.quantity,
        factor: row.factor,
        unit: row.unit,
        elementIds: row.elementIds,
      })),
      drawingEvidence,
      structures,
      review: {
        projectName: projectResult.data.name,
        versionLabel: `V${version.version_no} ${version.title}`,
        status: version.status,
        makerId: version.created_by,
        approvals: (approvalRows ?? []).map((row) => ({
          decision: row.decision,
          note: row.note,
          decidedBy: row.decided_by,
          createdAt: row.created_at,
        })),
      },
    });
  } catch (error) {
    if (error instanceof DrawingQuantityLineageServerError) throw error;
    throw new DrawingQuantityLineageServerError("P6C01");
  }
}
