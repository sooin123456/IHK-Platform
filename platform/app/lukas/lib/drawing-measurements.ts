import {
  drawingSemanticScaledInteger,
  normalizeDrawingSemanticNumber,
  resolveDrawingOpening,
} from "./drawing-semantic-geometry.ts";
import type {
  DrawingCanvas,
  DrawingObject,
  Point,
} from "./drawing-workspace.types.ts";

const measurableGeometryTypes = new Set<DrawingObject["geometry"]["type"]>([
  "line",
  "polyline",
  "rectangle",
  "circle",
  "wall",
  "opening",
  "space",
  "area",
  "grid",
  "arc",
]);

export function drawingObjectSupportsMeasurement(object: DrawingObject) {
  return measurableGeometryTypes.has(object.geometry.type);
}

export const DRAWING_MEASUREMENT_RULE_VERSION = "P4_MEASUREMENT_V1" as const;

export const DRAWING_MEASUREMENT_PI_NUMERATOR = 3_141_592_653_589_793n;
export const DRAWING_MEASUREMENT_PI_DENOMINATOR = 1_000_000_000_000_000n;

const MICROMILLIMETERS_PER_MILLIMETER = 1_000_000n;
const MICRODEGREES_PER_DEGREE = 1_000_000n;

export type DrawingMeasurement = {
  ruleVersion: typeof DRAWING_MEASUREMENT_RULE_VERSION;
  lengthMillimeters: string | null;
  areaSquareMillimeters: string | null;
  count: "1";
};

export type DrawingMeasurementUnit =
  | "millimeters"
  | "meters"
  | "squareMillimeters"
  | "squareMeters"
  | "count";

export class DrawingMeasurementCalibrationRequiredError extends Error {
  constructor() {
    super("PDF 축척 보정이 필요합니다.");
    this.name = "DrawingMeasurementCalibrationRequiredError";
  }
}

export class DrawingMeasurementCalibrationGeometryUnsupportedError extends Error {
  constructor() {
    super("PDF 축척으로 이 도형을 정확히 변환할 수 없습니다.");
    this.name = "DrawingMeasurementCalibrationGeometryUnsupportedError";
  }
}

function toMicromillimeters(value: number): bigint {
  const scaled = drawingSemanticScaledInteger(value);
  if (scaled === null)
    throw new RangeError(
      "Drawing measurement values must be validated six-decimal numbers.",
    );
  return scaled;
}

function integerSquareRoot(value: bigint): bigint {
  if (value < 0n)
    throw new RangeError("Square root input must be nonnegative.");
  if (value < 2n) return value;
  let estimate = 1n << BigInt((value.toString(2).length + 1) >> 1);
  while (true) {
    const next = (estimate + value / estimate) >> 1n;
    if (next >= estimate) return estimate;
    estimate = next;
  }
}

/** Rounds an exact rational once; ties move away from zero. */
function roundHalfAwayFromZero(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n)
    throw new RangeError("Rounding denominator must be positive.");
  const sign = numerator < 0n ? -1n : 1n;
  const magnitude = numerator < 0n ? -numerator : numerator;
  const quotient = magnitude / denominator;
  const remainder = magnitude % denominator;
  const rounded = remainder * 2n >= denominator ? quotient + 1n : quotient;
  return sign * rounded;
}

function roundedSquareRoot(value: bigint): bigint {
  const lower = integerSquareRoot(value);
  const upper = lower + 1n;
  return value - lower * lower < upper * upper - value ? lower : upper;
}

function distanceMicromillimeters(first: Point, second: Point): bigint {
  const deltaX = toMicromillimeters(second.x) - toMicromillimeters(first.x);
  const deltaY = toMicromillimeters(second.y) - toMicromillimeters(first.y);
  return roundedSquareRoot(deltaX * deltaX + deltaY * deltaY);
}

function squaredDistanceMicromillimeters(first: Point, second: Point): bigint {
  const deltaX = toMicromillimeters(second.x) - toMicromillimeters(first.x);
  const deltaY = toMicromillimeters(second.y) - toMicromillimeters(first.y);
  return deltaX * deltaX + deltaY * deltaY;
}

function positiveHalfAwayBucket(numerator: bigint, denominator: bigint) {
  return (numerator * 2n + denominator) / (denominator * 2n);
}

function boundaryPerimeterMicromillimeters(points: readonly Point[]): bigint {
  const squaredEdges = points.map((point, index) =>
    squaredDistanceMicromillimeters(point, points[(index + 1) % points.length]),
  );
  // Each scaled integer root is a lower bound with error below one scaled
  // unit. Increase precision until the summed lower/upper error interval is
  // wholly inside one final micromillimetre rounding bucket.
  for (let precision = 1_000_000n; ; precision *= 1_000_000n) {
    let lowerBound = 0n;
    let uncertainty = 0n;
    for (const squaredEdge of squaredEdges) {
      const scaledSquare = squaredEdge * precision * precision;
      const root = integerSquareRoot(scaledSquare);
      lowerBound += root;
      if (root * root !== scaledSquare) uncertainty += 1n;
    }
    if (
      positiveHalfAwayBucket(lowerBound, precision) ===
      positiveHalfAwayBucket(lowerBound + uncertainty, precision)
    )
      return roundHalfAwayFromZero(lowerBound, precision);
  }
}

function polylineLengthMicromillimeters(
  points: readonly Point[],
  closed: boolean,
): bigint {
  let length = 0n;
  for (let index = 1; index < points.length; index += 1)
    length += distanceMicromillimeters(points[index - 1], points[index]);
  if (closed) length += distanceMicromillimeters(points.at(-1)!, points[0]);
  return length;
}

function boundaryAreaMicroSquareMillimeters(points: readonly Point[]): bigint {
  let doubledArea = 0n;
  for (let index = 0; index < points.length; index += 1) {
    const point = points[index];
    const next = points[(index + 1) % points.length];
    const x = toMicromillimeters(point.x);
    const y = toMicromillimeters(point.y);
    const nextX = toMicromillimeters(next.x);
    const nextY = toMicromillimeters(next.y);
    doubledArea += x * nextY - nextX * y;
  }
  const magnitude = doubledArea < 0n ? -doubledArea : doubledArea;
  return roundHalfAwayFromZero(magnitude, 2n * MICROMILLIMETERS_PER_MILLIMETER);
}

function formatScaledInteger(value: bigint, fractionalDigits = 6): string {
  const negative = value < 0n;
  const digits = (negative ? -value : value)
    .toString()
    .padStart(fractionalDigits + 1, "0");
  const whole = digits.slice(0, -fractionalDigits);
  const fraction = digits.slice(-fractionalDigits).replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole}${fraction ? `.${fraction}` : ""}`;
}

function emptyMeasurement(): DrawingMeasurement {
  return {
    ruleVersion: DRAWING_MEASUREMENT_RULE_VERSION,
    lengthMillimeters: null,
    areaSquareMillimeters: null,
    count: "1",
  };
}

function circleLengthMillimeters(radius: number): string {
  return formatScaledInteger(
    roundHalfAwayFromZero(
      2n * toMicromillimeters(radius) * DRAWING_MEASUREMENT_PI_NUMERATOR,
      DRAWING_MEASUREMENT_PI_DENOMINATOR,
    ),
  );
}

function circleAreaSquareMillimeters(radius: number): string {
  const scaledRadius = toMicromillimeters(radius);
  return formatScaledInteger(
    roundHalfAwayFromZero(
      scaledRadius * scaledRadius * DRAWING_MEASUREMENT_PI_NUMERATOR,
      MICROMILLIMETERS_PER_MILLIMETER * DRAWING_MEASUREMENT_PI_DENOMINATOR,
    ),
  );
}

/** Derives V1 values from canonical geometry; it never persists or mutates data. */
export function measureDrawingObject(
  object: DrawingObject,
  objects: Readonly<Record<string, DrawingObject>> = {},
): DrawingMeasurement {
  const measurement = emptyMeasurement();
  const geometry = object.geometry;
  switch (geometry.type) {
    case "line":
      measurement.lengthMillimeters = formatScaledInteger(
        distanceMicromillimeters(geometry.start, geometry.end),
      );
      break;
    case "polyline":
      measurement.lengthMillimeters = formatScaledInteger(
        polylineLengthMicromillimeters(geometry.points, geometry.closed),
      );
      if (geometry.closed)
        measurement.areaSquareMillimeters = formatScaledInteger(
          boundaryAreaMicroSquareMillimeters(geometry.points),
        );
      break;
    case "rectangle": {
      const width = toMicromillimeters(geometry.width);
      const height = toMicromillimeters(geometry.height);
      measurement.lengthMillimeters = formatScaledInteger(
        2n * (width + height),
      );
      measurement.areaSquareMillimeters = formatScaledInteger(
        roundHalfAwayFromZero(width * height, MICROMILLIMETERS_PER_MILLIMETER),
      );
      break;
    }
    case "circle":
      measurement.lengthMillimeters = circleLengthMillimeters(geometry.radius);
      measurement.areaSquareMillimeters = circleAreaSquareMillimeters(
        geometry.radius,
      );
      break;
    case "wall":
    case "grid":
      measurement.lengthMillimeters = formatScaledInteger(
        distanceMicromillimeters(geometry.start, geometry.end),
      );
      break;
    case "opening": {
      resolveDrawingOpening(geometry, objects);
      const width = toMicromillimeters(geometry.widthMillimeters);
      const height = toMicromillimeters(geometry.heightMillimeters);
      measurement.lengthMillimeters = formatScaledInteger(width);
      measurement.areaSquareMillimeters = formatScaledInteger(
        roundHalfAwayFromZero(width * height, MICROMILLIMETERS_PER_MILLIMETER),
      );
      break;
    }
    case "space":
    case "area":
      measurement.lengthMillimeters = formatScaledInteger(
        boundaryPerimeterMicromillimeters(geometry.boundary),
      );
      measurement.areaSquareMillimeters = formatScaledInteger(
        boundaryAreaMicroSquareMillimeters(geometry.boundary),
      );
      break;
    case "arc": {
      const radius = toMicromillimeters(geometry.radius);
      const sweep = toMicromillimeters(Math.abs(geometry.sweepAngleDegrees));
      measurement.lengthMillimeters = formatScaledInteger(
        roundHalfAwayFromZero(
          radius * sweep * DRAWING_MEASUREMENT_PI_NUMERATOR,
          180n * MICRODEGREES_PER_DEGREE * DRAWING_MEASUREMENT_PI_DENOMINATOR,
        ),
      );
      break;
    }
    case "text":
    case "dimension":
      break;
  }
  return measurement;
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

function calibratedDrawingObject(
  object: DrawingObject,
  canvas: DrawingCanvas,
  objects: Readonly<Record<string, DrawingObject>>,
): {
  object: DrawingObject;
  objects: Readonly<Record<string, DrawingObject>>;
} | null {
  const geometry = object.geometry;
  if (
    geometry.type === "line" ||
    geometry.type === "grid" ||
    geometry.type === "wall"
  )
    return {
      object: {
        ...object,
        geometry: {
          ...geometry,
          start: calibratedPoint(geometry.start, canvas),
          end: calibratedPoint(geometry.end, canvas),
        },
      },
      objects,
    };
  if (geometry.type === "polyline")
    return {
      object: {
        ...object,
        geometry: {
          ...geometry,
          points: geometry.points.map((point) =>
            calibratedPoint(point, canvas),
          ),
        },
      },
      objects,
    };
  if (geometry.type === "space" || geometry.type === "area")
    return {
      object: {
        ...object,
        geometry: {
          ...geometry,
          boundary: geometry.boundary.map((point) =>
            calibratedPoint(point, canvas),
          ),
        },
      },
      objects,
    };
  if (geometry.type === "rectangle") {
    if (
      canvas.widthMillimeters !== canvas.heightMillimeters &&
      geometry.rotation !== 0
    )
      return null;
    const origin = calibratedPoint(geometry.origin, canvas);
    const opposite = calibratedPoint(
      {
        x: geometry.origin.x + geometry.width,
        y: geometry.origin.y + geometry.height,
      },
      canvas,
    );
    return {
      object: {
        ...object,
        geometry: {
          ...geometry,
          origin,
          width: normalizeDrawingSemanticNumber(opposite.x - origin.x),
          height: normalizeDrawingSemanticNumber(opposite.y - origin.y),
        },
      },
      objects,
    };
  }
  if (geometry.type === "circle" || geometry.type === "arc") {
    if (canvas.widthMillimeters !== canvas.heightMillimeters) return null;
    return {
      object: {
        ...object,
        geometry: {
          ...geometry,
          center: calibratedPoint(geometry.center, canvas),
          radius: calibratedPoint({ x: geometry.radius, y: 0 }, canvas).x,
        },
      },
      objects,
    };
  }
  if (geometry.type === "opening") {
    const host = objects[geometry.hostWallId];
    if (!host || host.geometry.type !== "wall") return { object, objects };
    const horizontal = host.geometry.start.y === host.geometry.end.y;
    const vertical = host.geometry.start.x === host.geometry.end.x;
    if (!horizontal && !vertical) return null;
    const along = (value: number) =>
      horizontal
        ? calibratedPoint({ x: value, y: 0 }, canvas).x
        : calibratedPoint({ x: 0, y: value }, canvas).y;
    const perpendicular = (value: number) =>
      horizontal
        ? calibratedPoint({ x: 0, y: value }, canvas).y
        : calibratedPoint({ x: value, y: 0 }, canvas).x;
    const calibratedHost: DrawingObject = {
      ...host,
      geometry: {
        ...host.geometry,
        start: calibratedPoint(host.geometry.start, canvas),
        end: calibratedPoint(host.geometry.end, canvas),
        thicknessMillimeters: perpendicular(host.geometry.thicknessMillimeters),
        heightMillimeters: perpendicular(host.geometry.heightMillimeters),
      },
    };
    return {
      object: {
        ...object,
        geometry: {
          ...geometry,
          offsetMillimeters: along(geometry.offsetMillimeters),
          widthMillimeters: along(geometry.widthMillimeters),
          heightMillimeters: perpendicular(geometry.heightMillimeters),
          sillHeightMillimeters: perpendicular(geometry.sillHeightMillimeters),
        },
      },
      objects: { ...objects, [host.id]: calibratedHost },
    };
  }
  if (geometry.type === "dimension")
    return {
      object: {
        ...object,
        geometry: {
          ...geometry,
          start: calibratedPoint(geometry.start, canvas),
          end: calibratedPoint(geometry.end, canvas),
        },
      },
      objects,
    };
  return { object, objects };
}

/** Applies a PDF canvas calibration before calling the shared V1 kernel. */
export function measureDrawingObjectForCanvas(
  object: DrawingObject,
  canvas: DrawingCanvas | null | undefined,
  objects: Readonly<Record<string, DrawingObject>> = {},
): DrawingMeasurement {
  const pdfCanvas =
    canvas?.spaceKind === "paper" &&
    canvas.background !== null &&
    canvas.background.pdfPageNumber !== null;
  if (!pdfCanvas) return measureDrawingObject(object, objects);
  if (!canvas.background!.calibration)
    throw new DrawingMeasurementCalibrationRequiredError();
  const calibrated = calibratedDrawingObject(object, canvas, objects);
  if (!calibrated)
    throw new DrawingMeasurementCalibrationGeometryUnsupportedError();
  return measureDrawingObject(calibrated.object, calibrated.objects);
}

export function shiftDrawingDecimalLeft(value: string, places: number): string {
  const negative = value.startsWith("-");
  const unsigned = negative ? value.slice(1) : value;
  const [whole, fraction = ""] = unsigned.split(".");
  const digits = `${whole}${fraction}`.replace(/^0+(?=\d)/, "");
  const originalScale = fraction.length;
  const targetScale = originalScale + places;
  const padded = digits.padStart(targetScale + 1, "0");
  const integerPart = padded.slice(0, -targetScale);
  const fractionPart = padded.slice(-targetScale).replace(/0+$/, "");
  const normalized = `${integerPart}${fractionPart ? `.${fractionPart}` : ""}`;
  return negative && normalized !== "0" ? `-${normalized}` : normalized;
}

/** Formats exact strings with fixed symbols and no locale-dependent APIs. */
export function formatDrawingMeasurement(
  measurement: DrawingMeasurement,
  unit: DrawingMeasurementUnit,
): string | null {
  switch (unit) {
    case "millimeters":
      return measurement.lengthMillimeters === null
        ? null
        : `${measurement.lengthMillimeters} mm`;
    case "meters":
      return measurement.lengthMillimeters === null
        ? null
        : `${shiftDrawingDecimalLeft(measurement.lengthMillimeters, 3)} m`;
    case "squareMillimeters":
      return measurement.areaSquareMillimeters === null
        ? null
        : `${measurement.areaSquareMillimeters} mm²`;
    case "squareMeters":
      return measurement.areaSquareMillimeters === null
        ? null
        : `${shiftDrawingDecimalLeft(measurement.areaSquareMillimeters, 6)} m²`;
    case "count":
      return measurement.count;
  }
}

function roundDrawingDecimal(value: string, fractionalDigits: number) {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value);
  if (!match || !Number.isSafeInteger(fractionalDigits) || fractionalDigits < 0)
    throw new RangeError("Drawing display value is invalid.");
  const fraction = match[3] ?? "";
  const retained = fraction.slice(0, fractionalDigits);
  const digits = `${match[2]}${retained.padEnd(fractionalDigits, "0")}`;
  let scaled = BigInt(digits || "0");
  if (fraction.length > fractionalDigits && fraction[fractionalDigits] >= "5")
    scaled += 1n;
  if (match[1] && scaled !== 0n) scaled = -scaled;
  return formatScaledInteger(scaled, fractionalDigits);
}

/** Rounds only presentation text; canonical measurement evidence stays exact. */
export function formatDrawingMeasurementForDisplay(
  measurement: DrawingMeasurement,
  unit: DrawingMeasurementUnit,
): string | null {
  switch (unit) {
    case "millimeters":
      return measurement.lengthMillimeters === null
        ? null
        : `${roundDrawingDecimal(measurement.lengthMillimeters, 3)} mm`;
    case "meters":
      return measurement.lengthMillimeters === null
        ? null
        : `${roundDrawingDecimal(
            shiftDrawingDecimalLeft(measurement.lengthMillimeters, 3),
            3,
          )} m`;
    case "squareMillimeters":
      return measurement.areaSquareMillimeters === null
        ? null
        : `${roundDrawingDecimal(measurement.areaSquareMillimeters, 3)} mm²`;
    case "squareMeters":
      return measurement.areaSquareMillimeters === null
        ? null
        : `${roundDrawingDecimal(
            shiftDrawingDecimalLeft(measurement.areaSquareMillimeters, 6),
            3,
          )} m²`;
    case "count":
      return measurement.count;
  }
}
