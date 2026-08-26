import type {
  Bounds,
  DrawingGeometry,
  DrawingObject,
  PdfCalibration,
  Point,
  Viewport,
} from "./drawing-workspace.types.ts";
import { resolveDrawingOpening } from "./drawing-semantic-geometry.ts";

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

function rectangleCorners(
  geometry: Extract<DrawingGeometry, { type: "rectangle" }>,
) {
  const radians = (geometry.rotation * Math.PI) / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  return [
    { x: 0, y: 0 },
    { x: geometry.width, y: 0 },
    { x: geometry.width, y: geometry.height },
    { x: 0, y: geometry.height },
  ].map(({ x, y }) => ({
    x: geometry.origin.x + x * cosine - y * sine,
    y: geometry.origin.y + x * sine + y * cosine,
  }));
}

function dimensionOffsetPoints(
  geometry: Extract<DrawingGeometry, { type: "dimension" }>,
) {
  const lineLength = distance(geometry.start, geometry.end);
  const offsetX =
    (-(geometry.end.y - geometry.start.y) / lineLength) * geometry.offset;
  const offsetY =
    ((geometry.end.x - geometry.start.x) / lineLength) * geometry.offset;
  return [
    { x: geometry.start.x + offsetX, y: geometry.start.y + offsetY },
    { x: geometry.end.x + offsetX, y: geometry.end.y + offsetY },
  ];
}

function arcPoint(
  geometry: Extract<DrawingGeometry, { type: "arc" }>,
  angleDegrees: number,
): Point {
  const radians = (angleDegrees * Math.PI) / 180;
  return {
    x: geometry.center.x + geometry.radius * Math.cos(radians),
    y: geometry.center.y + geometry.radius * Math.sin(radians),
  };
}

function normalizedDegrees(value: number): number {
  return ((value % 360) + 360) % 360;
}

function arcContainsAngle(
  geometry: Extract<DrawingGeometry, { type: "arc" }>,
  angleDegrees: number,
): boolean {
  if (Math.abs(geometry.sweepAngleDegrees) === 360) return true;
  const travelled =
    geometry.sweepAngleDegrees > 0
      ? normalizedDegrees(angleDegrees - geometry.startAngleDegrees)
      : normalizedDegrees(geometry.startAngleDegrees - angleDegrees);
  return travelled <= Math.abs(geometry.sweepAngleDegrees);
}

function arcBounds(geometry: Extract<DrawingGeometry, { type: "arc" }>) {
  const points = [
    arcPoint(geometry, geometry.startAngleDegrees),
    arcPoint(geometry, geometry.startAngleDegrees + geometry.sweepAngleDegrees),
    ...[0, 90, 180, 270]
      .filter((angle) => arcContainsAngle(geometry, angle))
      .map((angle) => arcPoint(geometry, angle)),
  ];
  return boundsForPoints(points);
}

/** Canonical authored points that are meaningful object-snap targets. */
export function geometrySnapPoints(
  geometry: DrawingGeometry,
  objects?: Readonly<Record<string, DrawingObject>>,
): Point[] {
  switch (geometry.type) {
    case "line":
      return [geometry.start, geometry.end];
    case "polyline":
      return geometry.points;
    case "rectangle":
      return rectangleCorners(geometry);
    case "circle":
      return [
        geometry.center,
        { x: geometry.center.x + geometry.radius, y: geometry.center.y },
        { x: geometry.center.x, y: geometry.center.y + geometry.radius },
        { x: geometry.center.x - geometry.radius, y: geometry.center.y },
        { x: geometry.center.x, y: geometry.center.y - geometry.radius },
      ];
    case "text":
      return [
        geometry.origin,
        { x: geometry.origin.x + geometry.width, y: geometry.origin.y },
      ];
    case "dimension":
      return [geometry.start, geometry.end, ...dimensionOffsetPoints(geometry)];
    case "wall":
    case "grid":
      return [geometry.start, geometry.end];
    case "space":
    case "area":
      return geometry.boundary;
    case "arc":
      return [
        geometry.center,
        arcPoint(geometry, geometry.startAngleDegrees),
        arcPoint(
          geometry,
          geometry.startAngleDegrees + geometry.sweepAngleDegrees,
        ),
      ];
    case "opening": {
      const resolved = resolveDrawingOpening(geometry, objects ?? {});
      return [resolved.start, resolved.center, resolved.end];
    }
  }
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

export function zoomViewportAroundPointer(
  pointer: Point,
  viewport: Viewport,
  requestedZoom: number,
): Viewport {
  if (
    !Number.isFinite(pointer.x) ||
    !Number.isFinite(pointer.y) ||
    !Number.isFinite(viewport.x) ||
    !Number.isFinite(viewport.y) ||
    !Number.isFinite(requestedZoom)
  ) {
    throw new Error("확대 기준점이 올바르지 않습니다.");
  }
  const worldPoint = screenToWorld(pointer, viewport);
  const zoom = Math.min(32, Math.max(0.05, requestedZoom));
  const scaledPoint = worldToScreen(worldPoint, { x: 0, y: 0, zoom });
  return {
    x: pointer.x - scaledPoint.x,
    y: pointer.y - scaledPoint.y,
    zoom,
  };
}

export function containPdfSource(
  source: { width: number; height: number },
  target: Bounds,
): Bounds {
  if (
    !Number.isFinite(source.width) ||
    !Number.isFinite(source.height) ||
    source.width <= 0 ||
    source.height <= 0 ||
    !Number.isFinite(target.x) ||
    !Number.isFinite(target.y) ||
    !Number.isFinite(target.width) ||
    !Number.isFinite(target.height) ||
    target.width <= 0 ||
    target.height <= 0
  ) {
    throw new Error("PDF 배경 크기가 올바르지 않습니다.");
  }
  const scale = Math.min(
    target.width / source.width,
    target.height / source.height,
  );
  const width = source.width * scale;
  const height = source.height * scale;
  return {
    x: target.x + (target.width - width) / 2,
    y: target.y + (target.height - height) / 2,
    width,
    height,
  };
}

export function drawingCanvasCursor(
  activeTool: "select" | "pan",
  spacePressed: boolean,
  panning: boolean,
) {
  if (panning) return "grabbing";
  return activeTool === "pan" || spacePressed ? "grab" : "default";
}

export type DrawingPanGesture = {
  pointerId: number;
  pointer: Point;
  viewport: Viewport;
};

type DrawingPanGestureEvent =
  | {
      type: "begin";
      activeTool: "select" | "pan";
      spacePressed: boolean;
      button: number;
      pointerId: number;
      pointer: Point;
      viewport: Viewport;
    }
  | { type: "move"; pointerId: number; pointer: Point }
  | { type: "end" | "cancel"; pointerId: number }
  | { type: "blur" };

export function drawingPanGestureTransition(
  gesture: DrawingPanGesture | null,
  event: DrawingPanGestureEvent,
): { gesture: DrawingPanGesture | null; viewport: Viewport | null } {
  if (event.type === "blur") return { gesture: null, viewport: null };
  if (event.type === "begin") {
    const shouldPan =
      event.button === 1 || event.activeTool === "pan" || event.spacePressed;
    return {
      gesture: shouldPan
        ? {
            pointerId: event.pointerId,
            pointer: event.pointer,
            viewport: event.viewport,
          }
        : gesture,
      viewport: null,
    };
  }
  if (!gesture || gesture.pointerId !== event.pointerId)
    return { gesture, viewport: null };
  if (event.type === "move")
    return {
      gesture,
      viewport: {
        ...gesture.viewport,
        x: gesture.viewport.x + event.pointer.x - gesture.pointer.x,
        y: gesture.viewport.y + event.pointer.y - gesture.pointer.y,
      },
    };
  return { gesture: null, viewport: null };
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

export function geometryBounds(
  geometry: DrawingGeometry,
  objects?: Readonly<Record<string, DrawingObject>>,
): Bounds {
  switch (geometry.type) {
    case "line":
    case "polyline":
      return boundsForPoints(
        geometry.type === "line"
          ? [geometry.start, geometry.end]
          : geometry.points,
      );
    case "rectangle": {
      return boundsForPoints(rectangleCorners(geometry));
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
      return boundsForPoints([
        geometry.start,
        geometry.end,
        ...dimensionOffsetPoints(geometry),
      ]);
    }
    case "wall": {
      const bounds = boundsForPoints([geometry.start, geometry.end]);
      const halfThickness = geometry.thicknessMillimeters / 2;
      return {
        x: bounds.x - halfThickness,
        y: bounds.y - halfThickness,
        width: bounds.width + geometry.thicknessMillimeters,
        height: bounds.height + geometry.thicknessMillimeters,
      };
    }
    case "grid":
      return boundsForPoints([geometry.start, geometry.end]);
    case "space":
    case "area":
      return boundsForPoints(geometry.boundary);
    case "arc":
      return arcBounds(geometry);
    case "opening": {
      const resolved = resolveDrawingOpening(geometry, objects ?? {});
      return boundsForPoints([resolved.start, resolved.end]);
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
