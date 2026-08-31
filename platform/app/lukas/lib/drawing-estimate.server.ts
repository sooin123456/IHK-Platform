import { createHash } from "node:crypto";
import { z } from "zod";

import {
  drawingEstimateMetadataForSubject,
  drawingEstimateQuantityForSubject,
  type DrawingEstimateBinding,
  type DrawingEstimateBoqGraph,
  type DrawingEstimateEvidence,
  type DrawingEstimateQuantity,
  type DrawingEstimateSubjectMetadata,
  type DrawingEstimateSubjectRef,
  type DrawingEstimateSummary,
  type DrawingEstimateSummaryRow,
} from "./drawing-estimate.ts";
import {
  addExact,
  compareExact,
  exactToString,
  exactZero,
  parseExactDecimal,
} from "./exact-decimal.server.ts";
import {
  DrawingWorkspaceConflictError,
  DrawingWorkspaceRejectedError,
  DrawingWorkspaceRpcError,
  loadDrawingWorkspaceCapability,
  type DrawingWorkspace,
  type DrawingWorkspaceClient,
} from "./drawing-workspace.server.ts";
import type {
  DrawingBlockInstance,
  DrawingCanvas,
  DrawingLayer,
  DrawingObject,
  DrawingPropertySchema,
  DrawingPropertyValue,
} from "./drawing-workspace.types.ts";
import {
  loadApprovedVerifiedBoqExport,
  type ApprovedVerifiedBoqExport,
} from "./verified-boq-approved-export.server.ts";
import {
  buildVerifiedBoqHandoffManifest,
  type VerifiedBoqHandoffManifest,
} from "./verified-boq-manifest.server.ts";
import {
  calculateVerifiedBoqCore,
  type VerifiedBoqCalculationMapping,
} from "./verified-boq.server.ts";

const IdSchema = z.string().uuid();
const BindDrawingEstimateInputSchema = z
  .object({
    projectId: IdSchema,
    drawingRevisionId: IdSchema,
    boqVersionId: IdSchema,
  })
  .strict();
const SummaryInputSchema = z.object({
  actorId: IdSchema,
  projectId: IdSchema,
});

const draftLineLimit = 1_000;
const draftGraphLimit = 5_000;
const approvedLinkLimit = 200;

function bytewise(left: string, right: string) {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, child]) => child !== undefined)
        .sort(([left], [right]) => bytewise(left, right))
        .map(([key, child]) => [key, canonicalValue(child)]),
    );
  return value;
}

function sha256(value: unknown) {
  return createHash("sha256")
    .update(JSON.stringify(canonicalValue(value)))
    .digest("hex");
}

function bindingFromRow(row: {
  id: string;
  project_id: string;
  drawing_revision_id: string;
  boq_version_id: string;
  created_at: string;
}): DrawingEstimateBinding {
  return {
    id: row.id,
    projectId: row.project_id,
    drawingRevisionId: row.drawing_revision_id,
    boqVersionId: row.boq_version_id,
    createdAt: row.created_at,
  };
}

function relationName(value: unknown) {
  const row = Array.isArray(value) ? value[0] : value;
  return row && typeof row === "object" && "name" in row
    ? String(row.name)
    : "";
}

function boqDescriptor(version: {
  id: string;
  title: string;
  version_no: number;
  status: string;
  engine_version: string;
  price_book?: unknown;
}) {
  return {
    id: version.id,
    title: version.title,
    versionNo: version.version_no,
    priceBookName: relationName(version.price_book),
    status: version.status,
    engineVersion: version.engine_version,
  };
}

export async function bindDrawingEstimate(
  client: DrawingWorkspaceClient,
  actorIdValue: string,
  inputValue: z.input<typeof BindDrawingEstimateInputSchema>,
): Promise<DrawingEstimateBinding> {
  const actorId = IdSchema.parse(actorIdValue);
  const input = BindDrawingEstimateInputSchema.parse(inputValue);
  const { data: project, error: projectError } = await client
    .from("lukas_qto_projects")
    .select("id,owner_id")
    .eq("id", input.projectId)
    .single();
  if (projectError || !project)
    throw new DrawingWorkspaceRejectedError(
      "견적 프로젝트를 확인할 수 없습니다.",
    );
  const capability = await loadDrawingWorkspaceCapability(
    client,
    input.projectId,
    actorId,
    project.owner_id,
  );
  if (capability !== "admin" && capability !== "editor")
    throw new DrawingWorkspaceRejectedError(
      "견적 연결에는 도면 편집 권한이 필요합니다.",
    );

  const { data: revision, error: revisionError } = await client
    .from("lukas_drawing_revisions")
    .select("id,project_id,status")
    .eq("id", input.drawingRevisionId)
    .eq("project_id", input.projectId)
    .eq("status", "draft")
    .single();
  if (revisionError || !revision)
    throw new DrawingWorkspaceRejectedError(
      "같은 프로젝트의 draft 도면 개정이 아닙니다.",
    );

  const { data: version, error: versionError } = await client
    .from("lukas_qto_boq_versions")
    .select("id,project_id,status,engine_version")
    .eq("id", input.boqVersionId)
    .eq("project_id", input.projectId)
    .eq("status", "draft")
    .eq("engine_version", "VERIFIED-BOQ-1.1")
    .single();
  if (versionError || !version)
    throw new DrawingWorkspaceRejectedError(
      "같은 프로젝트의 draft VERIFIED-BOQ-1.1 내역이 아닙니다.",
    );

  const { data, error } = await client
    .from("lukas_drawing_estimate_bindings")
    .insert({
      project_id: input.projectId,
      drawing_revision_id: input.drawingRevisionId,
      boq_version_id: input.boqVersionId,
      created_by: actorId,
    })
    .select("id,project_id,drawing_revision_id,boq_version_id,created_at")
    .single();
  if (error?.code === "23505")
    throw new DrawingWorkspaceConflictError(error.message);
  if (error || !data)
    throw new DrawingWorkspaceRpcError(
      error?.message ?? "견적 연결 결과가 없습니다.",
    );
  return bindingFromRow(data);
}

export async function loadDrawingEstimateOptions(
  client: DrawingWorkspaceClient,
  projectIdValue: string,
): Promise<
  Array<{ id: string; title: string; versionNo: number; priceBookName: string }>
> {
  const projectId = IdSchema.parse(projectIdValue);
  const { data, error } = await client
    .from("lukas_qto_boq_versions")
    .select(
      "id,project_id,title,version_no,status,engine_version,created_at,price_book:lukas_qto_price_books!inner(name)",
    )
    .eq("project_id", projectId)
    .eq("status", "draft")
    .eq("engine_version", "VERIFIED-BOQ-1.1")
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(100);
  if (error)
    throw new DrawingWorkspaceRpcError(
      `견적 내역 선택지를 불러오지 못했습니다: ${error.message}`,
    );
  return (data ?? []).map((row) => ({
    id: row.id,
    title: row.title,
    versionNo: row.version_no,
    priceBookName: relationName(row.price_book),
  }));
}

type DraftSubject = {
  subjectRef: DrawingEstimateSubjectRef;
  canonicalSubject: DrawingObject | DrawingBlockInstance;
  metadata: DrawingEstimateSubjectMetadata;
  quantity: DrawingEstimateQuantity;
  evidenceSha256: string;
  line: DrawingEstimateBoqGraph["lines"][number] | null;
};

function subjectRefOrder(
  left: DrawingEstimateSubjectRef,
  right: DrawingEstimateSubjectRef,
) {
  return bytewise(left.kind, right.kind) || bytewise(left.id, right.id);
}

function exactSum(values: readonly string[]) {
  return exactToString(
    values.reduce(
      (total, value) => addExact(total, parseExactDecimal(value)),
      exactZero,
    ),
  );
}

function evidenceFor(subject: DraftSubject): DrawingEstimateEvidence {
  return {
    subjectRef: subject.subjectRef,
    evidenceSha256: subject.evidenceSha256,
    status:
      subject.quantity.status === "ready"
        ? "ready"
        : subject.quantity.status === "missing_evidence"
          ? "missing_evidence"
          : "needs_review",
    evidenceKind: subject.metadata.evidenceKind,
    reason:
      subject.quantity.status === "ready"
        ? subject.metadata.evidenceReason
        : subject.quantity.reason,
  };
}

function uniqueSorted(values: readonly (string | null)[]) {
  return [
    ...new Set(values.filter((value): value is string => Boolean(value))),
  ].sort(bytewise);
}

function draftBoqSummary(boq: DrawingEstimateBoqGraph) {
  return {
    id: boq.id,
    title: boq.title,
    versionNo: boq.versionNo,
    priceBookName: boq.priceBook.name,
    status: boq.status,
    engineVersion: boq.engineVersion,
  };
}

/** Pure preview adapter. It creates no quantity, BOQ-result, approval, or draft-state rows. */
export function deriveDraftDrawingEstimateSummary(input: {
  binding: DrawingEstimateBinding;
  boq: DrawingEstimateBoqGraph;
  workspace: DrawingWorkspace;
}): DrawingEstimateSummary {
  const revision = input.workspace.document.revision;
  if (
    input.workspace.document.project_id !== input.binding.projectId ||
    revision.id !== input.binding.drawingRevisionId ||
    input.boq.id !== input.binding.boqVersionId ||
    input.boq.projectId !== input.binding.projectId
  )
    throw new DrawingWorkspaceRejectedError(
      "견적 연결과 도면/내역 프로젝트가 일치하지 않습니다.",
    );

  const canvases = (revision.canvases ?? []) as DrawingCanvas[];
  const layers = (revision.layers ?? []).filter(
    (layer): layer is DrawingLayer => "canvasId" in layer,
  );
  const objects = revision.objects.filter(
    (object): object is DrawingObject => "layerId" in object,
  );
  const blockInstances = (revision.blockInstances ??
    []) as DrawingBlockInstance[];
  const propertySchemas = (revision.propertySchemas ??
    []) as DrawingPropertySchema[];
  const propertyValues = (revision.propertyValues ??
    []) as DrawingPropertyValue[];
  const canvasById = new Map(canvases.map((canvas) => [canvas.id, canvas]));
  const layerById = new Map(layers.map((layer) => [layer.id, layer]));
  const lineByCode = new Map(
    input.boq.lines.map((line) => [line.itemCode, line]),
  );
  const objectById = Object.fromEntries(
    objects.map((object) => [object.id, object]),
  );
  const subjects: DraftSubject[] = [];

  const addSubject = (
    subjectRef: DrawingEstimateSubjectRef,
    canonicalSubject: DrawingObject | DrawingBlockInstance,
  ) => {
    const metadata = drawingEstimateMetadataForSubject(
      subjectRef,
      propertySchemas,
      propertyValues,
    );
    if (!metadata.classification || !metadata.itemCode) return;
    const line = lineByCode.get(metadata.itemCode) ?? null;
    const layer = layerById.get(canonicalSubject.layerId);
    const canvas = layer?.canvasId ? canvasById.get(layer.canvasId) : undefined;
    let quantity: DrawingEstimateQuantity;
    if (!line)
      quantity = {
        status: "missing_evidence",
        unit: "",
        reason: "검토 필요: BOQ 품목 코드가 없습니다",
      };
    else if (!canvas)
      quantity = {
        status: "missing_evidence",
        unit: line.unit,
        reason: "검토 필요: 도면 캔버스 근거가 없습니다",
      };
    else
      quantity = drawingEstimateQuantityForSubject(
        {
          subject: subjectRef,
          object:
            subjectRef.kind === "object"
              ? (canonicalSubject as DrawingObject)
              : null,
          blockInstance:
            subjectRef.kind === "block_instance"
              ? (canonicalSubject as DrawingBlockInstance)
              : null,
          canvas,
          metadata,
          objects: objectById,
        },
        line.unit,
      );
    const calibration = canvas
      ? {
          canvasId: canvas.id,
          background:
            canvas.background === null
              ? null
              : {
                  sourceFileId: canvas.background.sourceFileId,
                  sourceSha256: canvas.background.sourceSha256,
                  pdfPageNumber: canvas.background.pdfPageNumber,
                  calibration: canvas.background.calibration,
                },
        }
      : null;
    subjects.push({
      subjectRef,
      canonicalSubject,
      metadata,
      quantity,
      evidenceSha256: sha256({
        revisionId: revision.id,
        revisionVersion: revision.version,
        subjectRef,
        canonicalSubject,
        metadata,
        quantity,
        calibration,
      }),
      line,
    });
  };
  for (const object of objects)
    addSubject({ kind: "object", id: object.id }, object);
  for (const block of blockInstances)
    addSubject({ kind: "block_instance", id: block.id }, block);

  const resourceIds = new Set(input.boq.resources.map((row) => row.id));
  const lineIds = new Set(input.boq.lines.map((row) => row.id));
  const components = input.boq.components.filter(
    (row) => lineIds.has(row.lineId) && resourceIds.has(row.resourceId),
  );
  const componentsByLine = new Map<string, typeof components>();
  for (const component of components) {
    const rows = componentsByLine.get(component.lineId) ?? [];
    rows.push(component);
    componentsByLine.set(component.lineId, rows);
  }
  const mappings: VerifiedBoqCalculationMapping[] = subjects.flatMap(
    (subject) =>
      subject.line && subject.quantity.status === "ready"
        ? [
            {
              id: `draft:${subject.subjectRef.kind}:${subject.subjectRef.id}:${subject.line.id}`,
              lineId: subject.line.id,
              sourceKind: "drawing" as const,
              sourceId: `${subject.subjectRef.kind}:${subject.subjectRef.id}`,
              sourceSha256: subject.evidenceSha256,
              sourceQuantity: subject.quantity.quantity,
              factor: "1",
              unit: subject.quantity.unit,
              elementIds: [],
            },
          ]
        : [],
  );
  const calculated = calculateVerifiedBoqCore(
    {
      versionId: input.boq.id,
      calculationPolicy: input.boq.calculationPolicy,
      quantityScale: input.boq.quantityScale,
      lines: input.boq.lines,
      mappings,
      exclusions: [],
      resources: input.boq.resources,
      components,
    },
    true,
  );
  const calculatedByCode = new Map(
    calculated.lines.map((line) => [line.itemCode, line]),
  );
  const groups = new Map<string, DraftSubject[]>();
  for (const subject of subjects) {
    const rows = groups.get(subject.metadata.itemCode!) ?? [];
    rows.push(subject);
    groups.set(subject.metadata.itemCode!, rows);
  }

  let missingRateCount = 0;
  const rows: DrawingEstimateSummaryRow[] = [];
  for (const [itemCode, group] of groups) {
    const line = lineByCode.get(itemCode) ?? null;
    const calculation = calculatedByCode.get(itemCode);
    const evidence = group
      .map(evidenceFor)
      .sort((left, right) =>
        subjectRefOrder(left.subjectRef, right.subjectRef),
      );
    const subjectRefs = evidence.map((row) => row.subjectRef);
    const hasMissing = group.some(
      (subject) => subject.quantity.status === "missing_evidence",
    );
    const hasReview = group.some(
      (subject) => subject.quantity.status === "review",
    );
    const allReady = group.every(
      (subject) => subject.quantity.status === "ready",
    );
    const missingRate = Boolean(
      line && (componentsByLine.get(line.id)?.length ?? 0) === 0,
    );
    if (missingRate) missingRateCount += 1;
    let state: DrawingEstimateSummaryRow["state"];
    let reason: string | null;
    let quantity: string | null = null;
    let amountKrw: string | null = null;
    let totalUnitRateKrw: string | null = null;
    if (hasMissing) {
      state = "missing_evidence";
      reason = uniqueSorted(evidence.map((row) => row.reason)).join("; ");
    } else if (!line) {
      state = "missing_evidence";
      reason = "검토 필요: BOQ 품목 코드가 없습니다";
    } else if (missingRate) {
      state = "missing_evidence";
      reason = "검토 필요: 단가 자원 연결이 없습니다";
      if (allReady)
        quantity = exactSum(
          group.map((subject) =>
            subject.quantity.status === "ready"
              ? subject.quantity.quantity
              : "0",
          ),
        );
    } else if (hasReview || calculation?.status !== "calculated") {
      state = "needs_review";
      reason =
        uniqueSorted(evidence.map((row) => row.reason)).join("; ") ||
        calculation?.message ||
        "검토 필요: 계산 결과를 확인해야 합니다";
    } else {
      quantity = calculation.finalQuantity;
      amountKrw = calculation.amountKrw;
      totalUnitRateKrw = calculation.totalUnitPriceKrw;
      const assumptionReasons = uniqueSorted(
        group
          .filter((subject) => subject.metadata.evidenceKind === "가정값")
          .map((subject) => subject.metadata.evidenceReason),
      );
      state = assumptionReasons.length ? "assumption" : "draft";
      reason = assumptionReasons.join("; ") || null;
    }
    rows.push({
      classification: uniqueSorted(
        group.map((subject) => subject.metadata.classification),
      ).join(", "),
      itemCode,
      itemName: line?.itemName ?? "",
      quantity,
      unit: line?.unit ?? "",
      totalUnitRateKrw,
      amountKrw,
      state,
      reason,
      subjectRefs,
      evidence,
    });
  }
  rows.sort((left, right) => bytewise(left.itemCode, right.itemCode));
  return {
    status: "draft",
    binding: input.binding,
    boq: draftBoqSummary(input.boq),
    rows,
    directCostKrw: exactSum(
      rows.flatMap((row) => (row.amountKrw === null ? [] : [row.amountKrw])),
    ),
    missingRateCount,
    reviewCount: rows.filter(
      (row) => row.state === "missing_evidence" || row.state === "needs_review",
    ).length,
  };
}

type StoredVersion = {
  id: string;
  project_id: string;
  version_no: number;
  title: string;
  status: string;
  engine_version: string;
  price_book_id: string;
  calculation_policy?: string;
  quantity_scale?: number;
  result_sha256: string | null;
  manifest_sha256: string | null;
  price_book?: unknown;
};

type ApprovedEstimateAuthority = {
  loadApprovedExport(
    client: DrawingWorkspaceClient,
    actorId: string,
    versionId: string,
  ): Promise<ApprovedVerifiedBoqExport>;
};

const defaultApprovedAuthority: ApprovedEstimateAuthority = {
  loadApprovedExport: loadApprovedVerifiedBoqExport,
};

function sameDecimal(left: unknown, right: string) {
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

function approvedConflict(message: string): never {
  throw new DrawingWorkspaceConflictError(`승인 견적 확인 실패: ${message}`);
}

function validateApprovedExport(
  exported: ApprovedVerifiedBoqExport,
  version: StoredVersion,
  projectId: string,
) {
  let handoff: VerifiedBoqHandoffManifest;
  try {
    handoff = JSON.parse(new TextDecoder().decode(exported.manifestJson));
  } catch {
    return approvedConflict("manifest JSON이 올바르지 않습니다.");
  }
  let rebuilt;
  try {
    rebuilt = buildVerifiedBoqHandoffManifest(
      handoff.calculationManifest,
      handoff.approvalEnvelope,
    );
  } catch {
    return approvedConflict("manifest hash가 올바르지 않습니다.");
  }
  if (
    handoff.calculationManifest.projectId !== projectId ||
    handoff.calculationManifest.boqVersionId !== version.id ||
    handoff.approvalEnvelope.versionId !== version.id ||
    handoff.resultSha256 !== exported.resultSha256 ||
    handoff.manifestSha256 !== exported.manifestSha256 ||
    handoff.handoffSha256 !== exported.handoffSha256 ||
    rebuilt.manifest.resultSha256 !== exported.resultSha256 ||
    rebuilt.manifest.manifestSha256 !== exported.manifestSha256 ||
    rebuilt.handoffSha256 !== exported.handoffSha256 ||
    JSON.stringify(handoff) !== JSON.stringify(rebuilt.manifest) ||
    version.result_sha256 !== exported.resultSha256 ||
    version.manifest_sha256 !== exported.manifestSha256
  )
    return approvedConflict(
      "project/version/result/manifest hash가 일치하지 않습니다.",
    );
  return handoff;
}

async function deriveApprovedDrawingEstimateSummary(
  client: DrawingWorkspaceClient,
  binding: DrawingEstimateBinding,
  version: StoredVersion,
  exported: ApprovedVerifiedBoqExport,
): Promise<DrawingEstimateSummary> {
  const handoff = validateApprovedExport(exported, version, binding.projectId);
  const manifest = handoff.calculationManifest;
  const drawingMappings = manifest.mappings.filter(
    (mapping) => mapping.sourceKind === "drawing",
  );
  const { data: boqLinkRows, error: boqLinksError } = await client
    .from("lukas_drawing_boq_links")
    .select(
      "id,project_id,quantity_link_id,boq_version_id,boq_line_id,allocation_factor",
    )
    .eq("project_id", binding.projectId)
    .eq("boq_version_id", version.id)
    .order("id", { ascending: true })
    .limit(approvedLinkLimit + 1);
  if (boqLinksError) throw new DrawingWorkspaceRpcError(boqLinksError.message);
  if ((boqLinkRows ?? []).length > approvedLinkLimit)
    return approvedConflict("BOQ link bound를 초과했습니다.");
  const sourceIds = [...new Set(drawingMappings.map((row) => row.sourceId))];
  let quantityRows: Array<{
    id: string;
    project_id: string;
    drawing_revision_id: string;
    drawing_revision_version: number;
    drawing_snapshot_sha256: string;
    drawing_object_id: string;
    drawing_object_lineage_id: string;
    drawing_object_version: number;
    object_fingerprint: string;
    measurement_kind: string;
    raw_quantity: unknown;
    unit: string;
    measurement_rule_version: string;
  }> = [];
  if (sourceIds.length) {
    const result = await client
      .from("lukas_drawing_quantity_links")
      .select(
        "id,project_id,drawing_revision_id,drawing_revision_version,drawing_snapshot_sha256,drawing_object_id,drawing_object_lineage_id,drawing_object_version,object_fingerprint,measurement_kind,raw_quantity,unit,measurement_rule_version",
      )
      .eq("project_id", binding.projectId)
      .eq("drawing_revision_id", binding.drawingRevisionId)
      .in("id", sourceIds)
      .order("id", { ascending: true })
      .limit(approvedLinkLimit + 1);
    if (result.error) throw new DrawingWorkspaceRpcError(result.error.message);
    quantityRows = (result.data ?? []) as typeof quantityRows;
    if (quantityRows.length > approvedLinkLimit)
      return approvedConflict("quantity link bound를 초과했습니다.");
  }
  const sourceById = new Map(
    manifest.drawingSources.map((source) => [source.quantityLinkId, source]),
  );
  if (
    sourceById.size !== sourceIds.length ||
    quantityRows.length !== sourceIds.length
  )
    return approvedConflict("persisted quantity link가 일치하지 않습니다.");
  const quantityById = new Map(quantityRows.map((row) => [row.id, row]));
  const links = boqLinkRows ?? [];
  const linkedKeys = new Set<string>();
  const snapshotKeys = new Set<string>();
  for (const mapping of drawingMappings) {
    const source = sourceById.get(mapping.sourceId);
    const quantity = quantityById.get(mapping.sourceId);
    const link = links.find(
      (row) =>
        row.quantity_link_id === mapping.sourceId &&
        row.boq_line_id === mapping.lineId &&
        sameDecimal(row.allocation_factor, mapping.allocationFactor),
    );
    if (!source || !quantity || !link)
      return approvedConflict(
        "persisted drawing/BOQ link가 일치하지 않습니다.",
      );
    const key = `${mapping.sourceId}\u001f${mapping.lineId}`;
    if (linkedKeys.has(key))
      return approvedConflict("BOQ link가 중복되었습니다.");
    linkedKeys.add(key);
    if (
      quantity.project_id !== binding.projectId ||
      quantity.drawing_revision_id !== binding.drawingRevisionId ||
      quantity.drawing_revision_id !== source.revisionId ||
      quantity.drawing_revision_version !== source.revisionVersion ||
      quantity.drawing_snapshot_sha256 !== source.snapshotSha256 ||
      quantity.drawing_object_id !== source.objectId ||
      quantity.drawing_object_lineage_id !== source.lineageId ||
      quantity.drawing_object_version !== source.objectVersion ||
      quantity.object_fingerprint !== source.objectFingerprint ||
      quantity.measurement_kind !== source.measurementKind ||
      quantity.unit !== source.unit ||
      !sameDecimal(quantity.raw_quantity, source.rawQuantity) ||
      quantity.measurement_rule_version !== source.measurementRuleVersion
    )
      return approvedConflict("approved drawing snapshot이 일치하지 않습니다.");
    snapshotKeys.add(
      `${source.revisionId}\u001f${source.revisionVersion}\u001f${source.snapshotSha256}`,
    );
  }
  if (snapshotKeys.size > 1)
    return approvedConflict(
      "drawing link가 하나의 승인 snapshot에 고정되지 않았습니다.",
    );

  const mappingsByLine = new Map<string, typeof drawingMappings>();
  for (const mapping of drawingMappings) {
    const rows = mappingsByLine.get(mapping.lineId) ?? [];
    rows.push(mapping);
    mappingsByLine.set(mapping.lineId, rows);
  }
  const rows: DrawingEstimateSummaryRow[] = [];
  for (const line of manifest.result.canonicalLines) {
    const mappings = mappingsByLine.get(line.lineId) ?? [];
    if (!mappings.length) continue;
    if (
      line.status !== "calculated" ||
      line.finalQuantity === null ||
      line.amountKrw === null
    )
      return approvedConflict(
        "approved result row가 계산 완료 상태가 아닙니다.",
      );
    const sources = mappings.map(
      (mapping) => sourceById.get(mapping.sourceId)!,
    );
    const subjectRefs = [
      ...new Map(
        sources.map((source) => [
          source.objectId,
          { kind: "object" as const, id: source.objectId },
        ]),
      ).values(),
    ].sort(subjectRefOrder);
    rows.push({
      classification: null,
      itemCode: line.itemCode,
      itemName: line.itemName,
      quantity: line.finalQuantity,
      unit: line.unit as "EA" | "m" | "m2" | "m3",
      totalUnitRateKrw: line.totalUnitPriceKrw,
      amountKrw: line.amountKrw,
      state: "confirmed",
      reason: "승인된 도면 snapshot과 BOQ 결과",
      subjectRefs,
      evidence: sources
        .map((source) => ({
          subjectRef: { kind: "object" as const, id: source.objectId },
          evidenceSha256: source.objectFingerprint,
          status: "ready" as const,
          evidenceKind: "approved_snapshot",
          reason: null,
        }))
        .sort((left, right) =>
          subjectRefOrder(left.subjectRef, right.subjectRef),
        ),
    });
  }
  rows.sort((left, right) => bytewise(left.itemCode, right.itemCode));
  return {
    status: "confirmed",
    binding,
    boq: boqDescriptor(version),
    rows,
    directCostKrw: exactSum(rows.map((row) => row.amountKrw!)),
    missingRateCount: 0,
    reviewCount: 0,
  };
}

function reviewSummary(
  binding: DrawingEstimateBinding,
  version: StoredVersion,
): DrawingEstimateSummary {
  return {
    status: "needs_review",
    binding,
    boq: boqDescriptor(version),
    rows: [],
    directCostKrw: "0",
    missingRateCount: 0,
    reviewCount: 1,
  };
}

function boundedRows<T>(rows: T[] | null, limit: number, label: string): T[] {
  if ((rows ?? []).length > limit)
    throw new DrawingWorkspaceConflictError(`${label} bound를 초과했습니다.`);
  return rows ?? [];
}

async function loadDraftBoqGraph(
  client: DrawingWorkspaceClient,
  version: StoredVersion,
): Promise<DrawingEstimateBoqGraph> {
  const projectId = version.project_id;
  const versionId = version.id;
  const [
    priceBookResult,
    sectionResult,
    lineResult,
    componentResult,
    resourceResult,
  ] = await Promise.all([
    client
      .from("lukas_qto_price_books")
      .select("id,project_id,name")
      .eq("id", version.price_book_id)
      .eq("project_id", projectId)
      .single(),
    client
      .from("lukas_qto_boq_sections")
      .select("id,project_id,version_id,code,sort_order")
      .eq("project_id", projectId)
      .eq("version_id", versionId)
      .order("sort_order", { ascending: true })
      .order("code", { ascending: true })
      .order("id", { ascending: true })
      .limit(draftLineLimit + 1),
    client
      .from("lukas_qto_boq_lines")
      .select(
        "id,project_id,version_id,section_id,item_code,item_name,specification,unit,signed_adjustment,adjustment_reason,sort_order",
      )
      .eq("project_id", projectId)
      .eq("version_id", versionId)
      .order("sort_order", { ascending: true })
      .order("item_code", { ascending: true })
      .order("id", { ascending: true })
      .limit(draftLineLimit + 1),
    client
      .from("lukas_qto_boq_rate_components")
      .select("id,project_id,version_id,line_id,resource_id,coefficient")
      .eq("project_id", projectId)
      .eq("version_id", versionId)
      .order("line_id", { ascending: true })
      .order("id", { ascending: true })
      .limit(draftGraphLimit + 1),
    client
      .from("lukas_qto_price_resources")
      .select(
        "id,project_id,price_book_id,resource_code,resource_type,unit,unit_price_krw",
      )
      .eq("project_id", projectId)
      .eq("price_book_id", version.price_book_id)
      .order("resource_code", { ascending: true })
      .order("id", { ascending: true })
      .limit(draftGraphLimit + 1),
  ]);
  const error =
    priceBookResult.error ??
    sectionResult.error ??
    lineResult.error ??
    componentResult.error ??
    resourceResult.error;
  if (error)
    throw new DrawingWorkspaceRpcError(
      `draft BOQ graph를 불러오지 못했습니다: ${error.message}`,
    );
  if (!priceBookResult.data)
    throw new DrawingWorkspaceConflictError("draft BOQ price book이 없습니다.");
  const sections = boundedRows(
    sectionResult.data,
    draftLineLimit,
    "BOQ section",
  );
  const lines = boundedRows(lineResult.data, draftLineLimit, "BOQ line");
  const components = boundedRows(
    componentResult.data,
    draftGraphLimit,
    "BOQ component",
  );
  const resources = boundedRows(
    resourceResult.data,
    draftGraphLimit,
    "price resource",
  );
  const sectionCodeById = new Map(
    sections.map((section) => [section.id, section.code]),
  );
  return {
    id: version.id,
    projectId: version.project_id,
    title: version.title,
    versionNo: version.version_no,
    status: "draft",
    engineVersion: "VERIFIED-BOQ-1.1",
    calculationPolicy: version.calculation_policy as
      | "general_half_away"
      | "ems_component_truncate",
    quantityScale: version.quantity_scale!,
    priceBook: {
      id: priceBookResult.data.id,
      name: priceBookResult.data.name,
    },
    lines: lines.map((line) => ({
      id: line.id,
      sectionCode: sectionCodeById.get(line.section_id) ?? "",
      itemCode: line.item_code,
      itemName: line.item_name,
      specification: line.specification,
      unit: line.unit as "EA" | "m" | "m2" | "m3",
      signedAdjustment: String(line.signed_adjustment),
      adjustmentReason: line.adjustment_reason,
    })),
    resources: resources.map((resource) => ({
      id: resource.id,
      code: resource.resource_code,
      type: resource.resource_type as
        | "material"
        | "labor"
        | "equipment"
        | "expense",
      unit: resource.unit,
      unitPriceKrw: String(resource.unit_price_krw),
    })),
    components: components.map((component) => ({
      id: component.id,
      lineId: component.line_id,
      resourceId: component.resource_id,
      coefficient: String(component.coefficient),
    })),
  };
}

export async function loadDrawingEstimateSummary(
  client: DrawingWorkspaceClient,
  inputValue: {
    actorId: string;
    projectId: string;
    workspace: DrawingWorkspace;
  },
  authority: ApprovedEstimateAuthority = defaultApprovedAuthority,
): Promise<DrawingEstimateSummary> {
  const input = SummaryInputSchema.parse(inputValue);
  const workspace = inputValue.workspace;
  if (
    workspace.document.project_id !== input.projectId ||
    !IdSchema.safeParse(workspace.document.revision.id).success
  )
    throw new DrawingWorkspaceRejectedError(
      "견적 workspace 프로젝트가 일치하지 않습니다.",
    );
  const { data: bindingRow, error: bindingError } = await client
    .from("lukas_drawing_estimate_bindings")
    .select("id,project_id,drawing_revision_id,boq_version_id,created_at")
    .eq("project_id", input.projectId)
    .eq("drawing_revision_id", workspace.document.revision.id)
    .limit(1)
    .maybeSingle();
  if (bindingError) throw new DrawingWorkspaceRpcError(bindingError.message);
  if (!bindingRow)
    return {
      status: "unbound",
      binding: null,
      boq: null,
      rows: [],
      directCostKrw: "0",
      missingRateCount: 0,
      reviewCount: 0,
    };
  const binding = bindingFromRow(bindingRow);
  const { data: versionRow, error: versionError } = await client
    .from("lukas_qto_boq_versions")
    .select(
      "id,project_id,version_no,title,status,engine_version,price_book_id,calculation_policy,quantity_scale,result_sha256,manifest_sha256,price_book:lukas_qto_price_books(name)",
    )
    .eq("id", binding.boqVersionId)
    .eq("project_id", input.projectId)
    .limit(1)
    .single();
  if (versionError || !versionRow)
    throw new DrawingWorkspaceRejectedError(
      "견적 BOQ 버전이 같은 프로젝트에 없습니다.",
    );
  const version = versionRow as unknown as StoredVersion;
  if (version.engine_version !== "VERIFIED-BOQ-1.1")
    return reviewSummary(binding, version);
  if (version.status === "draft") {
    const graph = await loadDraftBoqGraph(client, version);
    return deriveDraftDrawingEstimateSummary({
      binding,
      boq: graph,
      workspace,
    });
  }
  if (version.status === "approved" || version.status === "superseded") {
    const exported = await authority.loadApprovedExport(
      client,
      input.actorId,
      version.id,
    );
    return deriveApprovedDrawingEstimateSummary(
      client,
      binding,
      version,
      exported,
    );
  }
  return reviewSummary(binding, version);
}
