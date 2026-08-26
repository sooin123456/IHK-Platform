import type {
  DrawingObject,
  DrawingOpeningGeometry,
  DrawingWallGeometry,
  Point,
} from "./drawing-workspace.types.ts";

export const DRAWING_SEMANTIC_SCALE = 1_000_000;
export const DRAWING_SEMANTIC_ABSOLUTE_MAX = 9_000_000_000;
const DRAWING_SEMANTIC_SCALE_BIGINT = BigInt(DRAWING_SEMANTIC_SCALE);

export class DrawingSemanticGeometryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DrawingSemanticGeometryError";
  }
}

function pointEquals(left: Point, right: Point): boolean {
  return left.x === right.x && left.y === right.y;
}

/** Converts one exact decimal-grid number without a binary multiplication check. */
export function drawingSemanticScaledInteger(value: number): bigint | null {
  if (!Number.isFinite(value)) return null;
  const match = value
    .toString()
    .match(/^(-?)(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i);
  if (!match) return null;
  const coefficient = BigInt(`${match[2]}${match[3] ?? ""}`);
  const decimalPlaces = (match[3]?.length ?? 0) - Number(match[4] ?? 0);
  let magnitude: bigint;
  if (decimalPlaces <= 6) {
    magnitude = coefficient * 10n ** BigInt(6 - decimalPlaces);
  } else {
    const divisor = 10n ** BigInt(decimalPlaces - 6);
    if (coefficient % divisor !== 0n) return null;
    magnitude = coefficient / divisor;
  }
  const scaled = match[1] === "-" ? -magnitude : magnitude;
  return scaled <= BigInt(Number.MAX_SAFE_INTEGER) &&
    scaled >= BigInt(Number.MIN_SAFE_INTEGER)
    ? scaled
    : null;
}

/** Quantizes a derived semantic value once onto the six-decimal grid. */
export function normalizeDrawingSemanticNumber(value: number): number {
  if (!Number.isFinite(value))
    throw new DrawingSemanticGeometryError(
      "Semantic geometry requires finite numeric output.",
    );
  const magnitude = Math.round(Math.abs(value) * DRAWING_SEMANTIC_SCALE);
  if (!Number.isSafeInteger(magnitude))
    throw new DrawingSemanticGeometryError(
      "Semantic geometry exceeds the exact six-decimal range.",
    );
  const scaled = value < 0 ? -magnitude : magnitude;
  return Number(BigInt(scaled)) / DRAWING_SEMANTIC_SCALE;
}

/** Adds authored and pointer values in fixed point so repeated moves do not drift. */
export function addDrawingSemanticNumbers(
  authored: number,
  delta: number,
): number {
  const authoredScaled = drawingSemanticScaledInteger(authored);
  if (authoredScaled === null)
    throw new DrawingSemanticGeometryError(
      "Authored semantic geometry must use the six-decimal grid.",
    );
  const normalizedDelta = normalizeDrawingSemanticNumber(delta);
  const deltaScaled = drawingSemanticScaledInteger(normalizedDelta);
  if (deltaScaled === null)
    throw new DrawingSemanticGeometryError(
      "Semantic translation must use the six-decimal grid.",
    );
  const result = authoredScaled + deltaScaled;
  if (
    result > BigInt(Number.MAX_SAFE_INTEGER) ||
    result < BigInt(Number.MIN_SAFE_INTEGER)
  )
    throw new DrawingSemanticGeometryError(
      "Semantic translation exceeds the exact six-decimal range.",
    );
  return Number(result) / Number(DRAWING_SEMANTIC_SCALE_BIGINT);
}

type IntegerPoint = { x: bigint; y: bigint };

function integerPoint(point: Point): IntegerPoint | null {
  const x = drawingSemanticScaledInteger(point.x);
  const y = drawingSemanticScaledInteger(point.y);
  return x === null || y === null ? null : { x, y };
}

function integerSquareRoot(value: bigint): bigint {
  if (value < 0n)
    throw new DrawingSemanticGeometryError(
      "Semantic square root requires a nonnegative value.",
    );
  if (value < 2n) return value;
  let estimate = 1n << BigInt((value.toString(2).length + 1) >> 1);
  while (true) {
    const next = (estimate + value / estimate) >> 1n;
    if (next >= estimate) return estimate;
    estimate = next;
  }
}

export type DrawingOpeningOffsetBounds = {
  minimumScaled: bigint;
  maximumScaled: bigint;
};

/** Derives the inclusive opening-centre interval from the exact host predicate. */
export function drawingOpeningOffsetBounds(
  wall: DrawingWallGeometry,
  widthMillimeters: number,
): DrawingOpeningOffsetBounds {
  const start = integerPoint(wall.start);
  const end = integerPoint(wall.end);
  const width = drawingSemanticScaledInteger(widthMillimeters);
  if (!start || !end || width === null || width <= 0n)
    throw new DrawingSemanticGeometryError(
      "Opening bounds require validated fixed-point geometry.",
    );
  const deltaX = end.x - start.x;
  const deltaY = end.y - start.y;
  const squaredHostLength = deltaX * deltaX + deltaY * deltaY;
  const doubledHostFloor = integerSquareRoot(4n * squaredHostLength);
  if (doubledHostFloor < width)
    throw new DrawingSemanticGeometryError(
      "Opening clear width must fit inside its host wall.",
    );
  return {
    minimumScaled: (width + 1n) / 2n,
    maximumScaled: (doubledHostFloor - width) / 2n,
  };
}

function orientation(
  first: IntegerPoint,
  second: IntegerPoint,
  third: IntegerPoint,
): bigint {
  return (
    (second.x - first.x) * (third.y - first.y) -
    (second.y - first.y) * (third.x - first.x)
  );
}

function between(value: bigint, first: bigint, second: bigint): boolean {
  return (
    value >= (first < second ? first : second) &&
    value <= (first > second ? first : second)
  );
}

function onSegment(
  point: IntegerPoint,
  start: IntegerPoint,
  end: IntegerPoint,
): boolean {
  return (
    orientation(start, end, point) === 0n &&
    between(point.x, start.x, end.x) &&
    between(point.y, start.y, end.y)
  );
}

function segmentsIntersect(
  firstStart: IntegerPoint,
  firstEnd: IntegerPoint,
  secondStart: IntegerPoint,
  secondEnd: IntegerPoint,
): boolean {
  const firstSecondStart = orientation(firstStart, firstEnd, secondStart);
  const firstSecondEnd = orientation(firstStart, firstEnd, secondEnd);
  const secondFirstStart = orientation(secondStart, secondEnd, firstStart);
  const secondFirstEnd = orientation(secondStart, secondEnd, firstEnd);
  if (
    ((firstSecondStart < 0n && firstSecondEnd > 0n) ||
      (firstSecondStart > 0n && firstSecondEnd < 0n)) &&
    ((secondFirstStart < 0n && secondFirstEnd > 0n) ||
      (secondFirstStart > 0n && secondFirstEnd < 0n))
  )
    return true;
  return (
    (firstSecondStart === 0n && onSegment(secondStart, firstStart, firstEnd)) ||
    (firstSecondEnd === 0n && onSegment(secondEnd, firstStart, firstEnd)) ||
    (secondFirstStart === 0n &&
      onSegment(firstStart, secondStart, secondEnd)) ||
    (secondFirstEnd === 0n && onSegment(firstEnd, secondStart, secondEnd))
  );
}

/** Validates one implicitly closed, non-degenerate simple boundary in O(n²). */
export function isSimpleDrawingBoundary(points: readonly Point[]): boolean {
  if (points.length < 3 || points.length > 4096) return false;
  const integerPoints = points.map(integerPoint);
  if (integerPoints.some((point) => point === null)) return false;
  const exactPoints = integerPoints as IntegerPoint[];
  for (let index = 0; index < points.length; index += 1) {
    if (pointEquals(points[index], points[(index + 1) % points.length]))
      return false;
  }

  let doubledArea = 0n;
  for (let index = 0; index < exactPoints.length; index += 1) {
    const point = exactPoints[index];
    const next = exactPoints[(index + 1) % exactPoints.length];
    doubledArea += point.x * next.y - next.x * point.y;
  }
  if (doubledArea === 0n) return false;

  for (let first = 0; first < exactPoints.length; first += 1) {
    const firstNext = (first + 1) % exactPoints.length;
    for (let second = first + 1; second < exactPoints.length; second += 1) {
      const secondNext = (second + 1) % exactPoints.length;
      if (first === second || firstNext === second || secondNext === first)
        continue;
      if (
        segmentsIntersect(
          exactPoints[first],
          exactPoints[firstNext],
          exactPoints[second],
          exactPoints[secondNext],
        )
      )
        return false;
    }
  }
  return true;
}

export type DrawingWallProjection = {
  point: Point;
  offsetMillimeters: number;
  distanceMillimeters: number;
};

/** Projects onto the finite wall centreline and clamps before either endpoint. */
export function projectPointToDrawingWall(
  point: Point,
  wall: DrawingWallGeometry,
): DrawingWallProjection {
  const deltaX = wall.end.x - wall.start.x;
  const deltaY = wall.end.y - wall.start.y;
  const squaredLength = deltaX * deltaX + deltaY * deltaY;
  if (
    !Number.isFinite(point.x) ||
    !Number.isFinite(point.y) ||
    !Number.isFinite(squaredLength) ||
    squaredLength <= 0
  )
    throw new DrawingSemanticGeometryError(
      "Wall projection requires finite geometry.",
    );
  const ratio = Math.min(
    1,
    Math.max(
      0,
      ((point.x - wall.start.x) * deltaX + (point.y - wall.start.y) * deltaY) /
        squaredLength,
    ),
  );
  const projected = {
    x: wall.start.x + deltaX * ratio,
    y: wall.start.y + deltaY * ratio,
  };
  return {
    point: projected,
    offsetMillimeters: Math.sqrt(squaredLength) * ratio,
    distanceMillimeters: Math.hypot(
      point.x - projected.x,
      point.y - projected.y,
    ),
  };
}

export type ResolvedDrawingOpening = {
  host: DrawingObject & { geometry: DrawingWallGeometry };
  center: Point;
  start: Point;
  end: Point;
  wallAngleDegrees: number;
};

/** Resolves canonical opening plan geometry without mutating the opening or host. */
export function resolveDrawingOpening(
  opening: DrawingOpeningGeometry,
  objects: Readonly<Record<string, DrawingObject>>,
): ResolvedDrawingOpening {
  const candidate = objects[opening.hostWallId];
  if (!candidate)
    throw new DrawingSemanticGeometryError("Opening host wall does not exist.");
  if (candidate.geometry.type !== "wall")
    throw new DrawingSemanticGeometryError("Opening host must be a wall.");
  const host = candidate as DrawingObject & { geometry: DrawingWallGeometry };
  const deltaX = host.geometry.end.x - host.geometry.start.x;
  const deltaY = host.geometry.end.y - host.geometry.start.y;
  const hostLength = Math.hypot(deltaX, deltaY);
  const halfWidth = opening.widthMillimeters / 2;
  const integerStart = integerPoint(host.geometry.start);
  const integerEnd = integerPoint(host.geometry.end);
  const integerOffset = drawingSemanticScaledInteger(opening.offsetMillimeters);
  const integerWidth = drawingSemanticScaledInteger(opening.widthMillimeters);
  if (
    !integerStart ||
    !integerEnd ||
    integerOffset === null ||
    integerWidth === null
  )
    throw new DrawingSemanticGeometryError(
      "Opening fit requires validated fixed-point geometry.",
    );
  const bounds = drawingOpeningOffsetBounds(
    host.geometry,
    opening.widthMillimeters,
  );
  if (
    integerOffset < bounds.minimumScaled ||
    integerOffset > bounds.maximumScaled
  )
    throw new DrawingSemanticGeometryError(
      "Opening clear width must fit inside its host wall.",
    );
  const integerSill = drawingSemanticScaledInteger(
    opening.sillHeightMillimeters,
  );
  const integerHeight = drawingSemanticScaledInteger(opening.heightMillimeters);
  const integerWallHeight = drawingSemanticScaledInteger(
    host.geometry.heightMillimeters,
  );
  if (
    opening.openingKind === "window" &&
    (integerSill === null ||
      integerHeight === null ||
      integerWallHeight === null ||
      integerSill + integerHeight > integerWallHeight)
  )
    throw new DrawingSemanticGeometryError(
      "Window sill and height must fit below the host wall height.",
    );
  const unitX = deltaX / hostLength;
  const unitY = deltaY / hostLength;
  const center = {
    x: host.geometry.start.x + unitX * opening.offsetMillimeters,
    y: host.geometry.start.y + unitY * opening.offsetMillimeters,
  };
  return {
    host,
    center,
    start: {
      x: center.x - unitX * halfWidth,
      y: center.y - unitY * halfWidth,
    },
    end: {
      x: center.x + unitX * halfWidth,
      y: center.y + unitY * halfWidth,
    },
    wallAngleDegrees: (Math.atan2(deltaY, deltaX) * 180) / Math.PI,
  };
}
