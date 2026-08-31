import {
  measureDrawingObject,
  shiftDrawingDecimalLeft,
} from "./drawing-measurements.ts";
import { normalizeDrawingSemanticNumber } from "./drawing-semantic-geometry.ts";
import type {
  DrawingBlockInstance,
  DrawingCanvas,
  DrawingObject,
  DrawingPropertySchema,
  DrawingPropertyValue,
  Point,
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

function calibratedPoint(point: Point, canvas: DrawingCanvas): Point {
  const scale = canvas.background!.calibration!.millimetersPerNormalizedUnit;
  return {
    x: normalizeDrawingSemanticNumber(
      (point.x / canvas.widthMillimeters) * scale,
    ),
    y: normalizeDrawingSemanticNumber(
      (point.y / canvas.heightMillimeters) * scale,
    ),
  };
}

function calibratedObject(object: DrawingObject, canvas: DrawingCanvas) {
  const geometry = object.geometry;
  if (
    geometry.type === "line" ||
    geometry.type === "grid" ||
    geometry.type === "wall"
  )
    return {
      ...object,
      geometry: {
        ...geometry,
        start: calibratedPoint(geometry.start, canvas),
        end: calibratedPoint(geometry.end, canvas),
      },
    };
  if (geometry.type === "polyline")
    return {
      ...object,
      geometry: {
        ...geometry,
        points: geometry.points.map((point) => calibratedPoint(point, canvas)),
      },
    };
  if (geometry.type === "space" || geometry.type === "area")
    return {
      ...object,
      geometry: {
        ...geometry,
        boundary: geometry.boundary.map((point) =>
          calibratedPoint(point, canvas),
        ),
      },
    };
  if (geometry.type === "rectangle") {
    const origin = calibratedPoint(geometry.origin, canvas);
    const opposite = calibratedPoint(
      {
        x: geometry.origin.x + geometry.width,
        y: geometry.origin.y + geometry.height,
      },
      canvas,
    );
    return {
      ...object,
      geometry: {
        ...geometry,
        origin,
        width: normalizeDrawingSemanticNumber(opposite.x - origin.x),
        height: normalizeDrawingSemanticNumber(opposite.y - origin.y),
      },
    };
  }
  if (geometry.type === "circle" || geometry.type === "arc") {
    const scale = canvas.background!.calibration!.millimetersPerNormalizedUnit;
    return {
      ...object,
      geometry: {
        ...geometry,
        center: calibratedPoint(geometry.center, canvas),
        radius: normalizeDrawingSemanticNumber(
          (geometry.radius / canvas.widthMillimeters) * scale,
        ),
      },
    };
  }
  if (geometry.type === "opening") {
    const scale = canvas.background!.calibration!.millimetersPerNormalizedUnit;
    return {
      ...object,
      geometry: {
        ...geometry,
        offsetMillimeters: normalizeDrawingSemanticNumber(
          (geometry.offsetMillimeters / canvas.widthMillimeters) * scale,
        ),
        widthMillimeters: normalizeDrawingSemanticNumber(
          (geometry.widthMillimeters / canvas.widthMillimeters) * scale,
        ),
        heightMillimeters: normalizeDrawingSemanticNumber(
          (geometry.heightMillimeters / canvas.heightMillimeters) * scale,
        ),
        sillHeightMillimeters: normalizeDrawingSemanticNumber(
          (geometry.sillHeightMillimeters / canvas.heightMillimeters) * scale,
        ),
      },
    };
  }
  return object;
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
  const object = pdfCanvas(input.canvas)
    ? calibratedObject(activeObject, input.canvas)
    : activeObject;
  const measurement = measureDrawingObject(object, input.objects);
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
