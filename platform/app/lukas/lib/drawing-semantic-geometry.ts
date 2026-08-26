import type {
  DrawingObject,
  DrawingOpeningGeometry,
  DrawingWallGeometry,
  Point,
} from "./drawing-workspace.types.ts";

const DRAWING_SEMANTIC_SCALE = 1_000_000;

export class DrawingSemanticGeometryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DrawingSemanticGeometryError";
  }
}

function pointEquals(left: Point, right: Point): boolean {
  return left.x === right.x && left.y === right.y;
}

function scaledCoordinate(value: number): bigint | null {
  if (!Number.isFinite(value)) return null;
  const scaled = value * DRAWING_SEMANTIC_SCALE;
  return Number.isSafeInteger(scaled) ? BigInt(scaled) : null;
}

type IntegerPoint = { x: bigint; y: bigint };

function integerPoint(point: Point): IntegerPoint | null {
  const x = scaledCoordinate(point.x);
  const y = scaledCoordinate(point.y);
  return x === null || y === null ? null : { x, y };
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
  if (
    opening.offsetMillimeters - halfWidth < 0 ||
    opening.offsetMillimeters + halfWidth > hostLength
  )
    throw new DrawingSemanticGeometryError(
      "Opening clear width must fit inside its host wall.",
    );
  if (
    opening.openingKind === "window" &&
    opening.sillHeightMillimeters + opening.heightMillimeters >
      host.geometry.heightMillimeters
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
