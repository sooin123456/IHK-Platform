import type { DrawingDocumentState } from "./drawing-commands.ts";
import {
  DRAWING_MEASUREMENT_RULE_VERSION,
  drawingObjectSupportsMeasurement,
  formatDrawingMeasurement,
  measureDrawingObjectForCanvas,
  type DrawingMeasurement,
} from "./drawing-measurements.ts";
import { drawingSemanticScaledInteger } from "./drawing-semantic-geometry.ts";
import type {
  DrawingCanvas,
  DrawingObject,
} from "./drawing-workspace.types.ts";

export type DrawingSemanticScheduleKind = "room" | "door" | "finish";

export type DrawingSemanticSchedule = {
  kind: DrawingSemanticScheduleKind;
  caption: string;
  columns: Array<{ key: string; label: string }>;
  rows: Array<{ objectId: string; cells: Record<string, string> }>;
  totals: { label: "합계"; cells: Record<string, string> };
};

export type DrawingMeasurementEvidenceError = {
  code: "measurement_derivation_failed";
  message: "서버 측정 증거를 계산하지 못했습니다.";
};

export type DrawingSemanticSchedulePreview = {
  status: "available" | "error";
  schedule: DrawingSemanticSchedule;
  error: {
    code: "measurement_unavailable";
    message: "브라우저 Schedule을 계산하지 못했습니다.";
  } | null;
};

export type DrawingMeasurementEvidenceLineage = {
  documentId: string;
  revisionId: string;
  revisionVersion: number;
  snapshotSha256: string;
  operationCheckpoint: number;
};

export type DrawingMeasurementObjectLineage = {
  objectId: string;
  objectVersion: number;
};

export type DrawingServerMeasurementEvidenceItem =
  DrawingMeasurementEvidenceLineage & {
    objectId: string;
    objectVersion: number;
    objectFingerprint: string;
    ruleVersion: typeof DRAWING_MEASUREMENT_RULE_VERSION;
    measurement: DrawingMeasurement;
  };

export type DrawingServerMeasurementEvidence =
  DrawingMeasurementEvidenceLineage & {
    ruleVersion: typeof DRAWING_MEASUREMENT_RULE_VERSION;
    objectIds: string[];
    objectLineage: DrawingMeasurementObjectLineage[];
    objectFingerprints: Record<string, string>;
    measurements: Record<string, DrawingServerMeasurementEvidenceItem>;
    schedules: Record<DrawingSemanticScheduleKind, DrawingSemanticSchedule>;
  };

export type DrawingMeasurementEvidenceCurrent =
  DrawingMeasurementEvidenceLineage & {
    objectIds: string[];
    objectLineage: DrawingMeasurementObjectLineage[];
    objectFingerprints: Record<string, string>;
    hasUnconfirmedChanges: boolean;
  };

type ScheduleState = Pick<DrawingDocumentState, "revisionId" | "objects"> & {
  layers?: Readonly<Record<string, { canvasId?: string }>>;
  structure?: {
    canvases: Readonly<Record<string, DrawingCanvas>>;
  };
};

function measureScheduleObject(object: DrawingObject, state: ScheduleState) {
  const canvasId = state.layers?.[object.layerId]?.canvasId;
  const canvas = canvasId ? state.structure?.canvases[canvasId] : null;
  return measureDrawingObjectForCanvas(object, canvas, state.objects);
}

const scheduleDefinitions = {
  room: {
    caption: "Room schedule",
    columns: [
      { key: "number", label: "공간 번호" },
      { key: "name", label: "공간 이름" },
      { key: "area", label: "면적" },
      { key: "count", label: "수량" },
    ],
  },
  door: {
    caption: "Door schedule",
    columns: [
      { key: "mark", label: "문 마크" },
      { key: "width", label: "너비" },
      { key: "height", label: "높이" },
      { key: "count", label: "수량" },
    ],
  },
  finish: {
    caption: "Finish schedule",
    columns: [
      { key: "number", label: "공간 번호" },
      { key: "name", label: "공간 이름" },
      { key: "floor", label: "바닥 마감" },
      { key: "wall", label: "벽 마감" },
      { key: "ceiling", label: "천장 마감" },
      { key: "area", label: "면적" },
    ],
  },
} as const;

function compareText(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value))
      throw new RangeError("Drawing lineage number is invalid.");
    return JSON.stringify(value);
  }
  if (Array.isArray(value))
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort(compareText)
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(",")}}`;
  }
  throw new RangeError("Drawing lineage value is invalid.");
}

/** Exact collision-free canonical input used only to compare local evidence lineage. */
export function drawingMeasurementObjectFingerprint(object: DrawingObject) {
  return canonicalJson({
    geometry: object.geometry,
    id: object.id,
    name: object.name,
    version: object.version,
  });
}

function compareKeys(
  left: readonly string[],
  right: readonly string[],
): number {
  for (let index = 0; index < left.length; index += 1) {
    const compared = compareText(left[index] ?? "", right[index] ?? "");
    if (compared) return compared;
  }
  return 0;
}

function isSemanticObject(object: DrawingObject) {
  return "semanticVersion" in object.geometry;
}

function semanticObjects(state: ScheduleState) {
  return Object.values(state.objects).filter(isSemanticObject);
}

function measurableObjects(state: ScheduleState) {
  return Object.values(state.objects).filter(drawingObjectSupportsMeasurement);
}

function fixedInteger(value: string, fractionalDigits: number): bigint {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value);
  if (!match || (match[3]?.length ?? 0) > fractionalDigits)
    throw new RangeError("Drawing fixed-point value is invalid.");
  const magnitude = BigInt(
    `${match[2]}${(match[3] ?? "").padEnd(fractionalDigits, "0")}`,
  );
  return match[1] ? -magnitude : magnitude;
}

function formatFixedInteger(value: bigint, fractionalDigits: number) {
  const negative = value < 0n;
  const digits = (negative ? -value : value)
    .toString()
    .padStart(fractionalDigits + 1, "0");
  const whole = digits.slice(0, -fractionalDigits);
  const fraction = digits.slice(-fractionalDigits).replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole}${fraction ? `.${fraction}` : ""}`;
}

function formatSemanticMillimeters(value: number) {
  const scaled = drawingSemanticScaledInteger(value);
  if (scaled === null)
    throw new RangeError("Drawing schedule dimension is invalid.");
  return `${formatFixedInteger(scaled, 6)} mm`;
}

function areaTotal(objects: DrawingObject[], state: ScheduleState) {
  const total = objects.reduce((sum, object) => {
    const area = measureScheduleObject(object, state).areaSquareMillimeters;
    return area === null ? sum : sum + fixedInteger(area, 6);
  }, 0n);
  // Measurement area strings carry six fractional square-millimetre digits;
  // converting square millimetres to square metres adds six more places.
  return `${formatFixedInteger(total, 12)} m²`;
}

function spaceObjects(state: ScheduleState) {
  return semanticObjects(state)
    .filter(
      (
        object,
      ): object is DrawingObject & {
        geometry: Extract<DrawingObject["geometry"], { type: "space" }>;
      } => object.geometry.type === "space",
    )
    .sort((left, right) =>
      compareKeys(
        [left.geometry.number, left.name, left.id],
        [right.geometry.number, right.name, right.id],
      ),
    );
}

/** Resolves a fixed read-only projection across the complete revision map. */
export function resolveDrawingSemanticSchedule(
  kind: DrawingSemanticScheduleKind,
  state: ScheduleState,
): DrawingSemanticSchedule {
  const definition = scheduleDefinitions[kind];
  if (kind === "door") {
    const doors = semanticObjects(state)
      .filter(
        (
          object,
        ): object is DrawingObject & {
          geometry: Extract<DrawingObject["geometry"], { type: "opening" }>;
        } =>
          object.geometry.type === "opening" &&
          object.geometry.openingKind === "door",
      )
      .sort((left, right) =>
        compareKeys([left.name, left.id], [right.name, right.id]),
      );
    return {
      kind,
      caption: definition.caption,
      columns: [...definition.columns],
      rows: doors.map((object) => {
        const measurement = measureScheduleObject(object, state);
        return {
          objectId: object.id,
          cells: {
            mark: object.name,
            width: formatDrawingMeasurement(measurement, "millimeters") ?? "",
            height: formatSemanticMillimeters(
              object.geometry.heightMillimeters,
            ),
            count: measurement.count,
          },
        };
      }),
      totals: {
        label: "합계",
        cells: {
          mark: "",
          width: "",
          height: "",
          count: String(doors.length),
        },
      },
    };
  }

  const spaces = spaceObjects(state);
  if (kind === "room")
    return {
      kind,
      caption: definition.caption,
      columns: [...definition.columns],
      rows: spaces.map((object) => {
        const measurement = measureScheduleObject(object, state);
        return {
          objectId: object.id,
          cells: {
            number: object.geometry.number,
            name: object.name,
            area: formatDrawingMeasurement(measurement, "squareMeters") ?? "",
            count: measurement.count,
          },
        };
      }),
      totals: {
        label: "합계",
        cells: {
          number: "",
          name: "",
          area: areaTotal(spaces, state),
          count: String(spaces.length),
        },
      },
    };

  return {
    kind,
    caption: definition.caption,
    columns: [...definition.columns],
    rows: spaces.map((object) => {
      const measurement = measureScheduleObject(object, state);
      return {
        objectId: object.id,
        cells: {
          number: object.geometry.number,
          name: object.name,
          floor: object.geometry.finishes.floor ?? "",
          wall: object.geometry.finishes.wall ?? "",
          ceiling: object.geometry.finishes.ceiling ?? "",
          area: formatDrawingMeasurement(measurement, "squareMeters") ?? "",
        },
      };
    }),
    totals: {
      label: "합계",
      cells: {
        number: "",
        name: "",
        floor: "",
        wall: "",
        ceiling: "",
        area: areaTotal(spaces, state),
      },
    },
  };
}

function unavailableDrawingSemanticSchedule(
  kind: DrawingSemanticScheduleKind,
): DrawingSemanticSchedule {
  const definition = scheduleDefinitions[kind];
  const cells = Object.fromEntries(
    definition.columns.map((column) => [column.key, ""]),
  );
  for (const key of ["area", "count", "width", "height"])
    if (key in cells) cells[key] = "계산 불가";
  return {
    kind,
    caption: definition.caption,
    columns: [...definition.columns],
    rows: [],
    totals: { label: "합계", cells },
  };
}

/** Keeps one malformed schedule from removing the rest of the workspace. */
export function resolveDrawingSemanticSchedulePreview(
  kind: DrawingSemanticScheduleKind,
  state: ScheduleState,
): DrawingSemanticSchedulePreview {
  try {
    return {
      status: "available",
      schedule: resolveDrawingSemanticSchedule(kind, state),
      error: null,
    };
  } catch {
    return {
      status: "error",
      schedule: unavailableDrawingSemanticSchedule(kind),
      error: {
        code: "measurement_unavailable",
        message: "브라우저 Schedule을 계산하지 못했습니다.",
      },
    };
  }
}

export function deriveDrawingServerMeasurementEvidence({
  documentId,
  revisionId,
  revisionVersion,
  snapshotSha256,
  operationCheckpoint,
  state,
}: DrawingMeasurementEvidenceLineage & {
  state: ScheduleState;
}): DrawingServerMeasurementEvidence {
  if (state.revisionId !== revisionId)
    throw new Error("Drawing measurement revision is inconsistent.");
  if (!documentId) throw new Error("Drawing measurement document is invalid.");
  if (!Number.isSafeInteger(revisionVersion) || revisionVersion < 1)
    throw new Error("Drawing measurement revision version is invalid.");
  if (!/^[0-9a-f]{64}$/.test(snapshotSha256))
    throw new Error("Drawing measurement snapshot is invalid.");
  if (!Number.isSafeInteger(operationCheckpoint) || operationCheckpoint < 0)
    throw new Error("Drawing measurement operation checkpoint is invalid.");
  const objects = measurableObjects(state).sort((left, right) =>
    compareText(left.id, right.id),
  );
  const objectIds = objects.map((object) => object.id);
  const objectLineage = objects.map((object) => ({
    objectId: object.id,
    objectVersion: object.version,
  }));
  const objectFingerprints = Object.fromEntries(
    objects.map((object) => [
      object.id,
      drawingMeasurementObjectFingerprint(object),
    ]),
  );
  const measurements = Object.fromEntries(
    objects.map((object) => [
      object.id,
      {
        documentId,
        revisionId,
        revisionVersion,
        snapshotSha256,
        operationCheckpoint,
        objectId: object.id,
        objectVersion: object.version,
        objectFingerprint: objectFingerprints[object.id],
        ruleVersion: DRAWING_MEASUREMENT_RULE_VERSION,
        measurement: measureScheduleObject(object, state),
      },
    ]),
  );
  return {
    documentId,
    revisionId,
    revisionVersion,
    snapshotSha256,
    operationCheckpoint,
    ruleVersion: DRAWING_MEASUREMENT_RULE_VERSION,
    objectIds,
    objectLineage,
    objectFingerprints,
    measurements,
    schedules: {
      room: resolveDrawingSemanticSchedule("room", state),
      door: resolveDrawingSemanticSchedule("door", state),
      finish: resolveDrawingSemanticSchedule("finish", state),
    },
  };
}

export function drawingMeasurementEvidenceCurrent(
  lineage: DrawingMeasurementEvidenceLineage | null | undefined,
  state: ScheduleState,
  hasUnconfirmedChanges: boolean,
): DrawingMeasurementEvidenceCurrent | null {
  if (!lineage) return null;
  const objects = measurableObjects(state).sort((left, right) =>
    compareText(left.id, right.id),
  );
  return {
    ...lineage,
    objectIds: objects.map((object) => object.id),
    objectLineage: objects.map((object) => ({
      objectId: object.id,
      objectVersion: object.version,
    })),
    objectFingerprints: Object.fromEntries(
      objects.map((object) => [
        object.id,
        drawingMeasurementObjectFingerprint(object),
      ]),
    ),
    hasUnconfirmedChanges,
  };
}

export function resolveDrawingServerEvidenceStatus(
  evidence: DrawingServerMeasurementEvidence | null | undefined,
  current: DrawingMeasurementEvidenceCurrent | null,
): {
  status: "confirmed" | "stale" | "unavailable";
  reason:
    | "document"
    | "revision"
    | "snapshot"
    | "checkpoint"
    | "objects"
    | "rule"
    | "unconfirmed"
    | null;
} {
  if (!evidence) return { status: "unavailable", reason: null };
  if (!current) return { status: "stale", reason: "document" };
  const evidenceIds = [...evidence.objectIds].sort(compareText);
  const evidenceLineage = [...evidence.objectLineage].sort((left, right) =>
    compareText(left.objectId, right.objectId),
  );
  if (
    evidence.ruleVersion !== DRAWING_MEASUREMENT_RULE_VERSION ||
    evidenceLineage.length !== evidenceIds.length ||
    evidenceLineage.some((lineage, index) => {
      const objectId = evidenceIds[index];
      const item = evidence.measurements[objectId];
      const fingerprint = evidence.objectFingerprints[objectId];
      return (
        lineage.objectId !== objectId ||
        !Number.isSafeInteger(lineage.objectVersion) ||
        lineage.objectVersion < 1 ||
        !fingerprint ||
        item?.documentId !== evidence.documentId ||
        item?.revisionId !== evidence.revisionId ||
        item?.revisionVersion !== evidence.revisionVersion ||
        item?.snapshotSha256 !== evidence.snapshotSha256 ||
        item?.operationCheckpoint !== evidence.operationCheckpoint ||
        item?.objectId !== objectId ||
        item?.objectVersion !== lineage.objectVersion ||
        item?.objectFingerprint !== fingerprint ||
        item?.ruleVersion !== evidence.ruleVersion ||
        item?.measurement.ruleVersion !== evidence.ruleVersion
      );
    })
  )
    return { status: "stale", reason: "rule" };
  if (evidence.documentId !== current.documentId)
    return { status: "stale", reason: "document" };
  if (evidence.revisionId !== current.revisionId)
    return { status: "stale", reason: "revision" };
  if (evidence.revisionVersion !== current.revisionVersion)
    return { status: "stale", reason: "revision" };
  if (evidence.snapshotSha256 !== current.snapshotSha256)
    return { status: "stale", reason: "snapshot" };
  if (evidence.operationCheckpoint !== current.operationCheckpoint)
    return { status: "stale", reason: "checkpoint" };
  if (current.hasUnconfirmedChanges)
    return { status: "stale", reason: "unconfirmed" };
  const currentIds = [...current.objectIds].sort(compareText);
  const currentLineage = [...current.objectLineage].sort((left, right) =>
    compareText(left.objectId, right.objectId),
  );
  if (
    currentIds.length !== evidence.objectIds.length ||
    currentLineage.length !== evidenceLineage.length ||
    currentIds.some((objectId, index) => objectId !== evidenceIds[index]) ||
    currentLineage.some(
      (lineage, index) =>
        lineage.objectId !== evidenceLineage[index]?.objectId ||
        lineage.objectVersion !== evidenceLineage[index]?.objectVersion ||
        current.objectFingerprints[lineage.objectId] !==
          evidence.objectFingerprints[lineage.objectId],
    )
  )
    return { status: "stale", reason: "objects" };
  return { status: "confirmed", reason: null };
}
