import { createHash } from "node:crypto";

import type { DrawingQuantitySource } from "./drawing-quantity-lineage.ts";
import type { BoqCalculationPolicy } from "./verified-boq.server.ts";
import {
  VERIFIED_BOQ_V1_1_ENGINE_VERSION,
  calculateVerifiedBoqV1_1,
  canonicalizeVerifiedBoqV1_1Input,
  type VerifiedBoqManifestPriceBook,
  type VerifiedBoqV1_1Input,
  type VerifiedBoqV1_1Line,
  type VerifiedBoqV1_1Result,
} from "./verified-boq-v1-1.server.ts";

export type VerifiedBoqCalculationManifest = {
  schemaVersion: "1HK_VERIFIED_BOQ_MANIFEST_V1";
  engineVersion: "VERIFIED-BOQ-1.1";
  projectId: string;
  boqVersionId: string;
  inputStateSha256: string;
  calculationPolicy: BoqCalculationPolicy;
  quantityScale: number;
  drawingSources: DrawingQuantitySource[];
  legacySources: Array<{
    fileId: string;
    fileSha256: string;
    subjectKey: string;
    unit: "EA" | "m" | "m2" | "m3";
    sourceQuantity: string;
    elementIds: string[];
  }>;
  mappings: Array<{
    sourceKind: "legacy" | "drawing";
    sourceId: string;
    lineId: string;
    allocationFactor: string;
  }>;
  lines: Array<{
    lineId: string;
    itemCode: string;
    unit: string;
    signedAdjustment: string;
    adjustmentReason: string;
  }>;
  priceBook: VerifiedBoqManifestPriceBook;
  resources: Array<{
    id: string;
    code: string;
    type: string;
    unit: string;
    unitPriceKrw: string;
  }>;
  rateComponents: Array<{
    id: string;
    lineId: string;
    resourceId: string;
    coefficient: string;
  }>;
  rules: Array<{
    measurementRuleVersion: string;
    engineVersion: string;
    calculationPolicy: string;
    quantityScale: number;
  }>;
  result: {
    resultSha256: string;
    status: "calculated" | "review";
    directCostKrw: string;
    canonicalLines: VerifiedBoqV1_1Line[];
  };
};

export type VerifiedBoqApprovalEnvelope = {
  versionId: string;
  resultSha256: string;
  manifestSha256: string;
  decision: "approved";
  decidedBy: string;
  decidedAt: string;
  note: string;
};

export type VerifiedBoqHandoffManifest = {
  calculationManifest: VerifiedBoqCalculationManifest;
  approvalEnvelope: VerifiedBoqApprovalEnvelope;
  resultSha256: string;
  manifestSha256: string;
  handoffSha256: string;
  evidenceFiles: Array<{ fileId: string; sha256: string }>;
};

const sha256Pattern = /^[0-9a-f]{64}$/;
const encoder = new TextEncoder();

function bytewise(left: string, right: string) {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function sha256(value: Uint8Array | string) {
  return createHash("sha256").update(value).digest("hex");
}

function requireSha(value: string, label: string) {
  if (!sha256Pattern.test(value))
    throw new Error(`P6C01: ${label}가 올바르지 않습니다.`);
}

function canonicalDrawingSource(source: DrawingQuantitySource) {
  return {
    quantityLinkId: source.quantityLinkId,
    revisionId: source.revisionId,
    revisionVersion: source.revisionVersion,
    snapshotSha256: source.snapshotSha256,
    objectId: source.objectId,
    lineageId: source.lineageId,
    objectVersion: source.objectVersion,
    objectFingerprint: source.objectFingerprint,
    measurementKind: source.measurementKind,
    unit: source.unit,
    rawQuantity: source.rawQuantity,
    measurementRuleVersion: source.measurementRuleVersion,
    sourceAnchors: source.sourceAnchors,
    issueLinks: source.issueLinks,
  };
}

export function buildVerifiedBoqCalculationManifest(
  input: VerifiedBoqV1_1Input,
  result: VerifiedBoqV1_1Result,
  context: { projectId: string; inputStateSha256: string },
): {
  manifest: VerifiedBoqCalculationManifest;
  canonicalBytes: Uint8Array;
  manifestSha256: string;
} {
  requireSha(context.inputStateSha256, "입력 상태 확인번호");
  const canonical = canonicalizeVerifiedBoqV1_1Input(input);
  const recalculated = calculateVerifiedBoqV1_1(canonical);
  if (
    result.canonicalSha256 !== recalculated.canonicalSha256 ||
    JSON.stringify(result) !== JSON.stringify(recalculated)
  )
    throw new Error("P6C01: 계산 결과가 현재 입력과 일치하지 않습니다.");

  const sourceById = new Map<string, DrawingQuantitySource>();
  for (const mapping of canonical.drawingMappings)
    sourceById.set(mapping.quantityLinkId, mapping.source);
  const drawingSources = [...sourceById.values()]
    .sort((left, right) => bytewise(left.quantityLinkId, right.quantityLinkId))
    .map(canonicalDrawingSource);
  const legacySources = canonical.legacyMappings
    .map((mapping) => ({
      fileId: mapping.sourceFileId,
      fileSha256: mapping.sourceSha256,
      subjectKey: mapping.subjectKey,
      unit: mapping.unit,
      sourceQuantity: mapping.sourceQuantity,
      elementIds: mapping.elementIds,
    }))
    .sort((left, right) =>
      bytewise(JSON.stringify(left), JSON.stringify(right)),
    );
  const mappings = [
    ...canonical.legacyMappings.map((mapping) => ({
      sourceKind: "legacy" as const,
      sourceId: `${mapping.sourceFileId}\u001f${mapping.subjectKey}\u001f${mapping.unit}`,
      lineId: mapping.lineId,
      allocationFactor: mapping.factor,
    })),
    ...canonical.drawingMappings.map((mapping) => ({
      sourceKind: "drawing" as const,
      sourceId: mapping.quantityLinkId,
      lineId: mapping.lineId,
      allocationFactor: mapping.allocationFactor,
    })),
  ].sort((left, right) =>
    bytewise(JSON.stringify(left), JSON.stringify(right)),
  );
  const manifest: VerifiedBoqCalculationManifest = {
    schemaVersion: "1HK_VERIFIED_BOQ_MANIFEST_V1",
    engineVersion: VERIFIED_BOQ_V1_1_ENGINE_VERSION,
    projectId: context.projectId.normalize("NFKC").trim(),
    boqVersionId: canonical.versionId,
    inputStateSha256: context.inputStateSha256,
    calculationPolicy: canonical.calculationPolicy,
    quantityScale: canonical.quantityScale,
    drawingSources,
    legacySources,
    mappings,
    lines: canonical.lines.map((line) => ({
      lineId: line.id,
      itemCode: line.itemCode,
      unit: line.unit,
      signedAdjustment: line.signedAdjustment,
      adjustmentReason: line.adjustmentReason,
    })),
    priceBook: canonical.priceBook,
    resources: canonical.resources.map((resource) => ({
      id: resource.id,
      code: resource.code,
      type: resource.type,
      unit: resource.unit,
      unitPriceKrw: resource.unitPriceKrw,
    })),
    rateComponents: canonical.components.map((component) => ({
      id: component.id,
      lineId: component.lineId,
      resourceId: component.resourceId,
      coefficient: component.coefficient,
    })),
    rules: [
      {
        measurementRuleVersion: "P4_MEASUREMENT_V1",
        engineVersion: VERIFIED_BOQ_V1_1_ENGINE_VERSION,
        calculationPolicy: canonical.calculationPolicy,
        quantityScale: canonical.quantityScale,
      },
    ],
    result: {
      resultSha256: result.canonicalSha256,
      status: result.status,
      directCostKrw: result.directCostKrw,
      canonicalLines: result.lines,
    },
  };
  if (!manifest.projectId)
    throw new Error("P6C01: 프로젝트 ID가 비어 있습니다.");
  requireSha(manifest.priceBook.sourceSha256, "단가표 파일 확인번호");
  const canonicalBytes = encoder.encode(JSON.stringify(manifest));
  return {
    manifest,
    canonicalBytes,
    manifestSha256: sha256(canonicalBytes),
  };
}

export function buildVerifiedBoqHandoffManifest(
  calculation: VerifiedBoqCalculationManifest,
  approvalEnvelope: VerifiedBoqApprovalEnvelope,
): {
  manifest: VerifiedBoqHandoffManifest;
  canonicalBytes: Uint8Array;
  handoffSha256: string;
} {
  const calculationBytes = encoder.encode(JSON.stringify(calculation));
  const manifestSha256 = sha256(calculationBytes);
  const resultSha256 = calculation.result.resultSha256;
  if (
    approvalEnvelope.decision !== "approved" ||
    approvalEnvelope.versionId !== calculation.boqVersionId ||
    approvalEnvelope.resultSha256 !== resultSha256 ||
    approvalEnvelope.manifestSha256 !== manifestSha256
  )
    throw new Error("P6C01: 승인 봉투가 계산 결과와 일치하지 않습니다.");
  requireSha(resultSha256, "계산 결과 확인번호");

  const evidenceById = new Map<string, string>();
  const addEvidence = (fileId: string, digest: string) => {
    requireSha(digest, "근거 파일 확인번호");
    const prior = evidenceById.get(fileId);
    if (prior !== undefined && prior !== digest)
      throw new Error("P6C01: 같은 근거 파일의 확인번호가 다릅니다.");
    evidenceById.set(fileId, digest);
  };
  for (const source of calculation.drawingSources)
    for (const anchor of source.sourceAnchors)
      addEvidence(anchor.sourceFileId, anchor.sourceSha256);
  for (const source of calculation.legacySources)
    addEvidence(source.fileId, source.fileSha256);
  addEvidence(
    calculation.priceBook.sourceFileId,
    calculation.priceBook.sourceSha256,
  );
  const evidenceFiles = [...evidenceById]
    .sort(([left], [right]) => bytewise(left, right))
    .map(([fileId, digest]) => ({ fileId, sha256: digest }));
  const hashPayload = {
    calculationManifest: calculation,
    approvalEnvelope,
    resultSha256,
    manifestSha256,
    evidenceFiles,
  };
  const handoffSha256 = sha256(encoder.encode(JSON.stringify(hashPayload)));
  const manifest: VerifiedBoqHandoffManifest = {
    calculationManifest: calculation,
    approvalEnvelope,
    resultSha256,
    manifestSha256,
    handoffSha256,
    evidenceFiles,
  };
  return {
    manifest,
    canonicalBytes: encoder.encode(JSON.stringify(manifest)),
    handoffSha256,
  };
}
