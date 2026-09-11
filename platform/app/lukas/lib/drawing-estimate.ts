import {
  measureDrawingObjectForCanvas,
  shiftDrawingDecimalLeft,
} from "./drawing-measurements.ts";
import type {
  DrawingBlockInstance,
  DrawingCanvas,
  DrawingObject,
  DrawingPropertySchema,
  DrawingPropertyValue,
} from "./drawing-workspace.types.ts";

export const DRAWING_ESTIMATE_CLASSIFICATION_SCHEMA_NAME = "적산 분류";
export const DRAWING_ESTIMATE_TRADE_SCHEMA_NAME = "공종";
export const DRAWING_ESTIMATE_ITEM_CODE_SCHEMA_NAME = "품목 코드";
export const DRAWING_ESTIMATE_EVIDENCE_KIND_SCHEMA_NAME = "근거 상태";
export const DRAWING_ESTIMATE_EVIDENCE_REASON_SCHEMA_NAME = "근거 사유";

export type DrawingEstimateSubjectRef =
  | { kind: "object"; id: string }
  | { kind: "block_instance"; id: string };

export type DrawingEstimateSubjectMetadata = {
  classification: string | null;
  trade: string | null;
  itemCode: string | null;
  evidenceKind: string | null;
  evidenceReason: string | null;
};

export type DrawingEstimateQuantity =
  | { status: "ready"; unit: "EA" | "m" | "m2"; quantity: string }
  | { status: "missing_evidence"; unit: string; reason: string }
  | { status: "review"; unit: string; reason: string };

export type DrawingEstimateBinding = {
  id: string;
  projectId: string;
  drawingRevisionId: string;
  boqVersionId: string;
  createdAt: string;
};

export type DrawingEstimateBoqGraph = {
  id: string;
  projectId: string;
  title: string;
  versionNo: number;
  status: "draft";
  engineVersion: "VERIFIED-BOQ-1.1";
  calculationPolicy: "general_half_away" | "ems_component_truncate";
  quantityScale: number;
  priceBook: { id: string; name: string };
  lines: Array<{
    id: string;
    sectionCode: string;
    itemCode: string;
    itemName: string;
    specification: string;
    unit: "EA" | "m" | "m2" | "m3";
    signedAdjustment: string;
    adjustmentReason: string;
  }>;
  resources: Array<{
    id: string;
    code: string;
    type: "material" | "labor" | "equipment" | "expense";
    unit: string;
    unitPriceKrw: string;
  }>;
  components: Array<{
    id: string;
    lineId: string;
    resourceId: string;
    coefficient: string;
  }>;
};

export type DrawingEstimateEvidence = {
  subjectRef: DrawingEstimateSubjectRef;
  evidenceSha256: string;
  status: "ready" | "missing_evidence" | "needs_review";
  evidenceKind: string | null;
  reason: string | null;
};

export type DrawingEstimateSummaryRow = {
  classification: string | null;
  itemCode: string;
  itemName: string;
  quantity: string | null;
  unit: string;
  totalUnitRateKrw: string | null;
  amountKrw: string | null;
  state:
    | "draft"
    | "assumption"
    | "needs_review"
    | "missing_evidence"
    | "confirmed";
  reason: string | null;
  subjectRefs: DrawingEstimateSubjectRef[];
  evidence: DrawingEstimateEvidence[];
};

export type DrawingEstimateSummary = {
  status: "unbound" | "draft" | "confirmed" | "needs_review";
  binding: DrawingEstimateBinding | null;
  boq: {
    id: string;
    title: string;
    versionNo: number;
    priceBookName: string;
    status: string;
    engineVersion: string;
  } | null;
  rows: DrawingEstimateSummaryRow[];
  directCostKrw: string;
  missingRateCount: number;
  reviewCount: number;
};

type DrawingEstimateQuantityInput = {
  subject: DrawingEstimateSubjectRef;
  object?: DrawingObject | null;
  blockInstance?: DrawingBlockInstance | null;
  canvas: DrawingCanvas;
  metadata: DrawingEstimateSubjectMetadata;
  objects?: Readonly<Record<string, DrawingObject>>;
};

const metadataNames = {
  classification: DRAWING_ESTIMATE_CLASSIFICATION_SCHEMA_NAME,
  trade: DRAWING_ESTIMATE_TRADE_SCHEMA_NAME,
  itemCode: DRAWING_ESTIMATE_ITEM_CODE_SCHEMA_NAME,
  evidenceKind: DRAWING_ESTIMATE_EVIDENCE_KIND_SCHEMA_NAME,
  evidenceReason: DRAWING_ESTIMATE_EVIDENCE_REASON_SCHEMA_NAME,
} as const;

function propertyValueForSubject(
  subject: DrawingEstimateSubjectRef,
  schemaId: string,
  values: readonly DrawingPropertyValue[],
) {
  const matches = values.filter(
    (value) =>
      value.schemaId === schemaId &&
      (subject.kind === "object"
        ? value.objectId === subject.id && value.blockInstanceId === null
        : value.blockInstanceId === subject.id && value.objectId === null),
  );
  if (matches.length > 1)
    throw new Error(`Drawing estimate property ${schemaId} is duplicated.`);
  return matches[0]?.value;
}

/** Joins only the five approved schema names, their IDs, and the exact subject discriminator. */
export function drawingEstimateMetadataForSubject(
  subject: DrawingEstimateSubjectRef,
  schemas: readonly DrawingPropertySchema[],
  values: readonly DrawingPropertyValue[],
): DrawingEstimateSubjectMetadata {
  return Object.fromEntries(
    Object.entries(metadataNames).map(([key, name]) => {
      const matches = schemas.filter((schema) => schema.name === name);
      if (matches.length > 1)
        throw new Error(`Drawing estimate schema ${name} is duplicated.`);
      const value = matches[0]
        ? propertyValueForSubject(subject, matches[0].id, values)
        : null;
      const text =
        typeof value === "string" && value.trim() ? value.trim() : null;
      return [key, text];
    }),
  ) as DrawingEstimateSubjectMetadata;
}

function pdfCanvas(canvas: DrawingCanvas) {
  return (
    canvas.spaceKind === "paper" &&
    canvas.background !== null &&
    canvas.background.pdfPageNumber !== null
  );
}

function missingEvidenceReason(metadata: DrawingEstimateSubjectMetadata) {
  if (!metadata.evidenceKind) return "검토 필요: 근거 상태가 없습니다";
  if (metadata.evidenceKind !== "가정값") return null;
  const reason = metadata.evidenceReason?.trim() ?? "";
  return reason.length >= 1 && reason.length <= 500
    ? null
    : "검토 필요: 가정 근거 사유가 없습니다";
}

/** Derives one draft quantity without persisting measurement or money authority. */
export function drawingEstimateQuantityForSubject(
  input: DrawingEstimateQuantityInput,
  unit: string,
): DrawingEstimateQuantity {
  if (unit !== "EA" && unit !== "m" && unit !== "m2")
    return {
      status: "review",
      unit,
      reason: "검토 필요: 지원하지 않는 단위입니다",
    };
  if (!input.metadata.classification)
    return {
      status: "review",
      unit,
      reason: "검토 필요: 적산 분류가 없습니다",
    };
  const evidenceReason = missingEvidenceReason(input.metadata);
  if (evidenceReason)
    return { status: "missing_evidence", unit, reason: evidenceReason };

  const activeObject =
    input.subject.kind === "object" && input.object?.id === input.subject.id
      ? input.object
      : null;
  const activeBlock =
    input.subject.kind === "block_instance" &&
    input.blockInstance?.id === input.subject.id
      ? input.blockInstance
      : null;
  if (unit === "EA")
    return activeObject || activeBlock
      ? { status: "ready", unit, quantity: "1" }
      : { status: "review", unit, reason: "검토 필요: 수량 대상이 없습니다" };
  if (activeBlock || !activeObject)
    return {
      status: "review",
      unit,
      reason:
        unit === "m"
          ? "검토 필요: 길이 근거가 없습니다"
          : "검토 필요: 면적 근거가 없습니다",
    };
  if (pdfCanvas(input.canvas) && !input.canvas.background!.calibration)
    return {
      status: "missing_evidence",
      unit,
      reason: "검토 필요: PDF 축척 근거가 없습니다",
    };
  let measurement;
  try {
    measurement = measureDrawingObjectForCanvas(
      activeObject,
      input.canvas,
      input.objects,
    );
  } catch {
    return {
      status: "review",
      unit,
      reason: "검토 필요: PDF 측정 관계를 확인해야 합니다",
    };
  }
  const quantity =
    unit === "m"
      ? measurement.lengthMillimeters
        ? shiftDrawingDecimalLeft(measurement.lengthMillimeters, 3)
        : null
      : measurement.areaSquareMillimeters
        ? shiftDrawingDecimalLeft(measurement.areaSquareMillimeters, 6)
        : null;
  return quantity === null
    ? {
        status: "review",
        unit,
        reason:
          unit === "m"
            ? "검토 필요: 길이 근거가 없습니다"
            : "검토 필요: 면적 근거가 없습니다",
      }
    : { status: "ready", unit, quantity };
}
