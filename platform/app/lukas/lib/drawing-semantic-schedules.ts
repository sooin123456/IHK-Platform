import type { DrawingDocumentState } from "./drawing-commands.ts";
import {
  DRAWING_MEASUREMENT_RULE_VERSION,
  formatDrawingMeasurement,
  measureDrawingObject,
  type DrawingMeasurement,
} from "./drawing-measurements.ts";
import { drawingSemanticScaledInteger } from "./drawing-semantic-geometry.ts";
import type { DrawingObject } from "./drawing-workspace.types.ts";

export type DrawingSemanticScheduleKind = "room" | "door" | "finish";

export type DrawingSemanticSchedule = {
  kind: DrawingSemanticScheduleKind;
  caption: string;
  columns: Array<{ key: string; label: string }>;
  rows: Array<{ objectId: string; cells: Record<string, string> }>;
  totals: { label: "합계"; cells: Record<string, string> };
};

export type DrawingServerMeasurementEvidenceItem = {
  revisionId: string;
  operationCheckpoint: number;
  objectId: string;
  ruleVersion: typeof DRAWING_MEASUREMENT_RULE_VERSION;
  measurement: DrawingMeasurement;
};

export type DrawingServerMeasurementEvidence = {
  revisionId: string;
  operationCheckpoint: number;
  ruleVersion: typeof DRAWING_MEASUREMENT_RULE_VERSION;
  objectIds: string[];
  measurements: Record<string, DrawingServerMeasurementEvidenceItem>;
  schedules: Record<DrawingSemanticScheduleKind, DrawingSemanticSchedule>;
};

type ScheduleState = Pick<DrawingDocumentState, "revisionId" | "objects">;

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
    const area = measureDrawingObject(
      object,
      state.objects,
    ).areaSquareMillimeters;
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
        const measurement = measureDrawingObject(object, state.objects);
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
        const measurement = measureDrawingObject(object, state.objects);
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
      const measurement = measureDrawingObject(object, state.objects);
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

export function deriveDrawingServerMeasurementEvidence({
  revisionId,
  operationCheckpoint,
  state,
}: {
  revisionId: string;
  operationCheckpoint: number;
  state: ScheduleState;
}): DrawingServerMeasurementEvidence {
  if (state.revisionId !== revisionId)
    throw new Error("Drawing measurement revision is inconsistent.");
  if (!Number.isSafeInteger(operationCheckpoint) || operationCheckpoint < 0)
    throw new Error("Drawing measurement operation checkpoint is invalid.");
  const objects = semanticObjects(state).sort((left, right) =>
    compareText(left.id, right.id),
  );
  const objectIds = objects.map((object) => object.id);
  const measurements = Object.fromEntries(
    objects.map((object) => [
      object.id,
      {
        revisionId,
        operationCheckpoint,
        objectId: object.id,
        ruleVersion: DRAWING_MEASUREMENT_RULE_VERSION,
        measurement: measureDrawingObject(object, state.objects),
      },
    ]),
  );
  return {
    revisionId,
    operationCheckpoint,
    ruleVersion: DRAWING_MEASUREMENT_RULE_VERSION,
    objectIds,
    measurements,
    schedules: {
      room: resolveDrawingSemanticSchedule("room", state),
      door: resolveDrawingSemanticSchedule("door", state),
      finish: resolveDrawingSemanticSchedule("finish", state),
    },
  };
}

export function resolveDrawingServerEvidenceStatus(
  evidence: DrawingServerMeasurementEvidence | null | undefined,
  current: {
    revisionId: string;
    operationCheckpoint: number | null;
    objectIds: readonly string[];
    hasUnconfirmedChanges: boolean;
  },
): {
  status: "confirmed" | "stale" | "unavailable";
  reason: "revision" | "checkpoint" | "objects" | "rule" | "unconfirmed" | null;
} {
  if (!evidence) return { status: "unavailable", reason: null };
  if (
    evidence.ruleVersion !== DRAWING_MEASUREMENT_RULE_VERSION ||
    evidence.objectIds.some(
      (objectId) =>
        evidence.measurements[objectId]?.revisionId !== evidence.revisionId ||
        evidence.measurements[objectId]?.operationCheckpoint !==
          evidence.operationCheckpoint ||
        evidence.measurements[objectId]?.objectId !== objectId ||
        evidence.measurements[objectId]?.ruleVersion !== evidence.ruleVersion ||
        evidence.measurements[objectId]?.measurement.ruleVersion !==
          evidence.ruleVersion,
    )
  )
    return { status: "stale", reason: "rule" };
  if (evidence.revisionId !== current.revisionId)
    return { status: "stale", reason: "revision" };
  if (evidence.operationCheckpoint !== current.operationCheckpoint)
    return { status: "stale", reason: "checkpoint" };
  if (current.hasUnconfirmedChanges)
    return { status: "stale", reason: "unconfirmed" };
  const currentIds = [...current.objectIds].sort(compareText);
  if (
    currentIds.length !== evidence.objectIds.length ||
    currentIds.some((objectId, index) => objectId !== evidence.objectIds[index])
  )
    return { status: "stale", reason: "objects" };
  return { status: "confirmed", reason: null };
}
