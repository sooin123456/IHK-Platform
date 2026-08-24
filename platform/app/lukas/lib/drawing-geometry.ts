import type {
  Bounds,
  DrawingGeometry,
  PdfCalibration,
  Point,
  Viewport,
} from "./drawing-workspace.types.ts";

type SnapOptions = {
  gridSize: number;
  tolerancePixels: number;
  zoom: number;
};

type SnapResult = { point: Point; kind: "object" | "grid" | null };

function distance(first: Point, second: Point) {
  return Math.hypot(first.x - second.x, first.y - second.y);
}

function boundsForPoints(points: Point[]): Bounds {
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

export function worldToScreen(point: Point, view: Viewport): Point {
  return { x: point.x * view.zoom + view.x, y: point.y * view.zoom + view.y };
}

export function screenToWorld(point: Point, view: Viewport): Point {
  if (!Number.isFinite(view.zoom) || view.zoom <= 0)
    throw new Error("확대 배율이 올바르지 않습니다.");
  return {
    x: (point.x - view.x) / view.zoom,
    y: (point.y - view.y) / view.zoom,
  };
}

export function calibratePdf(
  normalizedStart: Point,
  normalizedEnd: Point,
  realLengthMillimeters: number,
): PdfCalibration {
  const normalizedDistance = distance(normalizedStart, normalizedEnd);
  if (
    !Number.isFinite(normalizedStart.x) ||
    !Number.isFinite(normalizedStart.y) ||
    !Number.isFinite(normalizedEnd.x) ||
    !Number.isFinite(normalizedEnd.y) ||
    normalizedDistance === 0 ||
    !Number.isFinite(realLengthMillimeters) ||
    realLengthMillimeters <= 0
  ) {
    throw new Error("PDF 보정 값이 올바르지 않습니다.");
  }

  return {
    normalizedStart,
    normalizedEnd,
    realLengthMillimeters,
    millimetersPerNormalizedUnit: realLengthMillimeters / normalizedDistance,
  };
}

export function geometryBounds(geometry: DrawingGeometry): Bounds {
  switch (geometry.type) {
    case "line":
    case "polyline":
      return boundsForPoints(
        geometry.type === "line"
          ? [geometry.start, geometry.end]
          : geometry.points,
      );
    case "rectangle": {
      const radians = (geometry.rotation * Math.PI) / 180;
      const cosine = Math.cos(radians);
      const sine = Math.sin(radians);
      const corners = [
        { x: 0, y: 0 },
        { x: geometry.width, y: 0 },
        { x: geometry.width, y: geometry.height },
        { x: 0, y: geometry.height },
      ].map(({ x, y }) => ({
        x: geometry.origin.x + x * cosine - y * sine,
        y: geometry.origin.y + x * sine + y * cosine,
      }));
      return boundsForPoints(corners);
    }
    case "circle":
      return {
        x: geometry.center.x - geometry.radius,
        y: geometry.center.y - geometry.radius,
        width: geometry.radius * 2,
        height: geometry.radius * 2,
      };
    case "text":
      return {
        x: geometry.origin.x,
        y: geometry.origin.y,
        width: geometry.width,
        height: 0,
      };
    case "dimension": {
      const lineLength = distance(geometry.start, geometry.end);
      const offsetX =
        (-(geometry.end.y - geometry.start.y) / lineLength) * geometry.offset;
      const offsetY =
        ((geometry.end.x - geometry.start.x) / lineLength) * geometry.offset;
      return boundsForPoints([
        geometry.start,
        geometry.end,
        { x: geometry.start.x + offsetX, y: geometry.start.y + offsetY },
        { x: geometry.end.x + offsetX, y: geometry.end.y + offsetY },
      ]);
    }
  }
}

export function snapWorldPoint(
  point: Point,
  objectCandidates: Point[],
  options: SnapOptions,
): SnapResult {
  if (!Number.isFinite(options.zoom) || options.zoom <= 0) {
    throw new Error("확대 배율이 올바르지 않습니다.");
  }
  if (
    !Number.isFinite(options.tolerancePixels) ||
    options.tolerancePixels < 0
  ) {
    throw new Error("스냅 허용 오차가 올바르지 않습니다.");
  }

  const tolerance = options.tolerancePixels / options.zoom;
  let objectPoint: Point | undefined;
  let objectDistance = Infinity;
  for (const candidate of objectCandidates) {
    const candidateDistance = distance(point, candidate);
    if (candidateDistance < objectDistance) {
      objectPoint = candidate;
      objectDistance = candidateDistance;
    }
  }

  const gridPoint =
    Number.isFinite(options.gridSize) && options.gridSize > 0
      ? {
          x: Math.round(point.x / options.gridSize) * options.gridSize,
          y: Math.round(point.y / options.gridSize) * options.gridSize,
        }
      : undefined;
  const gridDistance = gridPoint ? distance(point, gridPoint) : Infinity;

  if (
    objectPoint &&
    objectDistance <= tolerance &&
    objectDistance <= gridDistance
  ) {
    return { point: objectPoint, kind: "object" };
  }
  if (gridPoint && gridDistance <= tolerance)
    return { point: gridPoint, kind: "grid" };
  return { point, kind: null };
}
