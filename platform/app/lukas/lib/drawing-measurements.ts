import {
  drawingSemanticScaledInteger,
  resolveDrawingOpening,
} from "./drawing-semantic-geometry.ts";
import type { DrawingObject, Point } from "./drawing-workspace.types.ts";

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
  "millimeters" | "meters" | "squareMillimeters" | "squareMeters" | "count";

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

/** Derives V1 values from canonical geometry; it never persists or mutates data. */
export function measureDrawingObject(
  object: DrawingObject,
  objects: Readonly<Record<string, DrawingObject>> = {},
): DrawingMeasurement {
  const measurement = emptyMeasurement();
  const geometry = object.geometry;
  switch (geometry.type) {
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
    case "line":
    case "polyline":
    case "rectangle":
    case "circle":
    case "text":
    case "dimension":
      break;
  }
  return measurement;
}

function shiftDecimalLeft(value: string, places: number): string {
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
        : `${shiftDecimalLeft(measurement.lengthMillimeters, 3)} m`;
    case "squareMillimeters":
      return measurement.areaSquareMillimeters === null
        ? null
        : `${measurement.areaSquareMillimeters} mm²`;
    case "squareMeters":
      return measurement.areaSquareMillimeters === null
        ? null
        : `${shiftDecimalLeft(measurement.areaSquareMillimeters, 6)} m²`;
    case "count":
      return measurement.count;
  }
}
