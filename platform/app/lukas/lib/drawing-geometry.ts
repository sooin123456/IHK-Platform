import type {
  Bounds,
  DrawingGeometry,
  DrawingObject,
  PdfCalibration,
  Point,
  Viewport,
} from "./drawing-workspace.types.ts";
import {
  drawingSemanticScaledInteger,
  resolveDrawingOpening,
} from "./drawing-semantic-geometry.ts";

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

const MICRODEGREES_PER_DEGREE = 1_000_000;
const FULL_TURN_MICRODEGREES = 360_000_000n;

function toMicrodegrees(value: number): bigint {
  const scaled = drawingSemanticScaledInteger(value);
  if (scaled === null)
    throw new RangeError("Arc angles must be validated six-decimal numbers.");
  return scaled;
}

function normalizeMicrodegrees(value: bigint): bigint {
  const remainder = value % FULL_TURN_MICRODEGREES;
  return remainder < 0n ? remainder + FULL_TURN_MICRODEGREES : remainder;
}

function arcPointAtMicrodegrees(
  geometry: Extract<DrawingGeometry, { type: "arc" }>,
  angleMicrodegrees: bigint,
): Point {
  const normalized = normalizeMicrodegrees(angleMicrodegrees);
  if (normalized === 0n)
    return { x: geometry.center.x + geometry.radius, y: geometry.center.y };
  if (normalized === 90_000_000n)
    return { x: geometry.center.x, y: geometry.center.y + geometry.radius };
  if (normalized === 180_000_000n)
    return { x: geometry.center.x - geometry.radius, y: geometry.center.y };
  if (normalized === 270_000_000n)
    return { x: geometry.center.x, y: geometry.center.y - geometry.radius };
  const normalizedDegrees = Number(normalized) / MICRODEGREES_PER_DEGREE;
  const radians = (normalizedDegrees * Math.PI) / 180;
  return {
    x: geometry.center.x + geometry.radius * Math.cos(radians),
    y: geometry.center.y + geometry.radius * Math.sin(radians),
  };
}

function arcEndMicrodegrees(
  geometry: Extract<DrawingGeometry, { type: "arc" }>,
): bigint {
  return normalizeMicrodegrees(
    toMicrodegrees(geometry.startAngleDegrees) +
      toMicrodegrees(geometry.sweepAngleDegrees),
  );
}

function arcContainsAngle(
  geometry: Extract<DrawingGeometry, { type: "arc" }>,
  angleDegrees: number,
): boolean {
  const sweep = toMicrodegrees(geometry.sweepAngleDegrees);
  const absoluteSweep = sweep < 0n ? -sweep : sweep;
  if (absoluteSweep === FULL_TURN_MICRODEGREES) return true;
  const start = normalizeMicrodegrees(
    toMicrodegrees(geometry.startAngleDegrees),
  );
  const angle = normalizeMicrodegrees(toMicrodegrees(angleDegrees));
  const travelled =
    sweep > 0n
      ? normalizeMicrodegrees(angle - start)
      : normalizeMicrodegrees(start - angle);
  return travelled <= absoluteSweep;
}

function arcBounds(geometry: Extract<DrawingGeometry, { type: "arc" }>) {
  const points = [
    arcPointAtMicrodegrees(
      geometry,
      toMicrodegrees(geometry.startAngleDegrees),
    ),
    arcPointAtMicrodegrees(geometry, arcEndMicrodegrees(geometry)),
    ...[0, 90, 180, 270]
      .filter((angle) => arcContainsAngle(geometry, angle))
      .map((angle) => arcPointAtMicrodegrees(geometry, toMicrodegrees(angle))),
  ];
  return boundsForPoints(points);
}

/** Canonical microdegree-normalized points used by semantic arc rendering. */
export function sampleDrawingArcPoints(
  geometry: Extract<DrawingGeometry, { type: "arc" }>,
): Point[] {
  const segments = Math.max(
    8,
    Math.ceil(Math.abs(geometry.sweepAngleDegrees) / 8),
  );
  const start = toMicrodegrees(geometry.startAngleDegrees);
  const sweep = toMicrodegrees(geometry.sweepAngleDegrees);
  return Array.from({ length: segments + 1 }, (_, index) =>
    arcPointAtMicrodegrees(
      geometry,
      start + (sweep * BigInt(index)) / BigInt(segments),
    ),
  );
}

/** Resolved line markers shared by opening rendering, bounds, and hit testing. */
export function drawingOpeningMarkerSegments(
  geometry: Extract<DrawingGeometry, { type: "opening" }>,
  resolved: ReturnType<typeof resolveDrawingOpening>,
): [Point, Point][] {
  const radians = (resolved.wallAngleDegrees * Math.PI) / 180;
  const normal = {
    x: -Math.sin(radians) * 35,
    y: Math.cos(radians) * 35,
  };
  const segments: [Point, Point][] = [[resolved.start, resolved.end]];
  if (geometry.openingKind === "window")
    segments.push([
      {
        x: resolved.start.x + normal.x,
        y: resolved.start.y + normal.y,
      },
      { x: resolved.end.x + normal.x, y: resolved.end.y + normal.y },
    ]);
  if (geometry.openingKind === "door")
    segments.push([
      resolved.start,
      {
        x: resolved.start.x + normal.x * 2.5,
        y: resolved.start.y + normal.y * 2.5,
      },
    ]);
  return segments;
}

export const DRAWING_SEMANTIC_RENDER_METRICS = {
  areaFill: "#fde68a66",
  doorMarkerWidth: 6,
  gridBubbleRadius: 18,
  gridBubbleStrokeWidth: 2,
  gridDash: [16, 8] as const,
  gridLabelWidth: 80,
  labelFontSize: 14,
  labelYOffset: 7,
  openingCutExtra: 4,
  openingWidth: 10,
  spaceFill: "#dbeafe66",
  spaceLabelWidth: 180,
  voidWidth: 2,
  windowMarkerWidth: 5,
} as const;

export function drawingPolygonCentroid(points: readonly Point[]): Point {
  let doubledArea = 0;
  let x = 0;
  let y = 0;
  for (let index = 0; index < points.length; index += 1) {
    const point = points[index];
    const next = points[(index + 1) % points.length];
    const cross = point.x * next.y - next.x * point.y;
    doubledArea += cross;
    x += (point.x + next.x) * cross;
    y += (point.y + next.y) * cross;
  }
  return doubledArea === 0
    ? points[0]
    : { x: x / (doubledArea * 3), y: y / (doubledArea * 3) };
}

export function drawingSemanticLabelLayout(
  geometry: Extract<DrawingGeometry, { type: "space" | "area" | "grid" }>,
  objectName: string,
) {
  const metrics = DRAWING_SEMANTIC_RENDER_METRICS;
  if (geometry.type === "grid") {
    const angle =
      (Math.atan2(
        geometry.end.y - geometry.start.y,
        geometry.end.x - geometry.start.x,
      ) *
        180) /
      Math.PI;
    return {
      fontSize: metrics.labelFontSize,
      rotation: angle > 90 || angle < -90 ? angle + 180 : angle,
      text: objectName || "Grid",
      width: metrics.gridLabelWidth,
      x: geometry.end.x - metrics.gridLabelWidth / 2,
      y: geometry.end.y - metrics.labelYOffset,
    };
  }
  const centroid = drawingPolygonCentroid(geometry.boundary);
  const width = metrics.spaceLabelWidth;
  return {
    fontSize: metrics.labelFontSize,
    rotation: 0,
    text:
      geometry.type === "space"
        ? [geometry.number, objectName].filter(Boolean).join(" · ") || "공간"
        : objectName || "영역",
    width,
    x: centroid.x - width / 2,
    y: centroid.y - metrics.labelYOffset,
  };
}

function pointToSegmentDistance(point: Point, start: Point, end: Point) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return distance(point, start);
  const amount = Math.max(
    0,
    Math.min(
      1,
      ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared,
    ),
  );
  return distance(point, {
    x: start.x + dx * amount,
    y: start.y + dy * amount,
  });
}

function pointInPolygon(point: Point, boundary: readonly Point[]) {
  let inside = false;
  for (
    let index = 0, previous = boundary.length - 1;
    index < boundary.length;
    previous = index++
  ) {
    const currentPoint = boundary[index];
    const previousPoint = boundary[previous];
    if (
      currentPoint.y > point.y !== previousPoint.y > point.y &&
      point.x <
        ((previousPoint.x - currentPoint.x) * (point.y - currentPoint.y)) /
          (previousPoint.y - currentPoint.y) +
          currentPoint.x
    )
      inside = !inside;
  }
  return inside;
}

/** Semantic narrow phase after the existing bounds broad phase. */
export function drawingGeometryHitTest(
  geometry: DrawingGeometry,
  point: Point,
  tolerance: number,
  objects: Readonly<Record<string, DrawingObject>> = {},
) {
  if (!Number.isFinite(tolerance) || tolerance < 0)
    throw new Error("선택 허용 오차가 올바르지 않습니다.");
  if (geometry.type === "wall")
    return (
      pointToSegmentDistance(point, geometry.start, geometry.end) <=
      geometry.thicknessMillimeters / 2 + tolerance
    );
  if (geometry.type === "grid")
    return (
      pointToSegmentDistance(point, geometry.start, geometry.end) <= tolerance
    );
  if (geometry.type === "arc") {
    const samples = sampleDrawingArcPoints(geometry);
    return samples
      .slice(1)
      .some(
        (end, index) =>
          pointToSegmentDistance(point, samples[index], end) <= tolerance,
      );
  }
  if (geometry.type === "opening") {
    const resolved = resolveDrawingOpening(geometry, objects);
    return drawingOpeningMarkerSegments(geometry, resolved).some(
      ([start, end]) =>
        pointToSegmentDistance(point, start, end) <= tolerance + 5,
    );
  }
  if (geometry.type === "space" || geometry.type === "area")
    return (
      pointInPolygon(point, geometry.boundary) ||
      geometry.boundary.some(
        (start, index) =>
          pointToSegmentDistance(
            point,
            start,
            geometry.boundary[(index + 1) % geometry.boundary.length],
          ) <= tolerance,
      )
    );
  return true;
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
        arcPointAtMicrodegrees(
          geometry,
          toMicrodegrees(geometry.startAngleDegrees),
        ),
        arcPointAtMicrodegrees(geometry, arcEndMicrodegrees(geometry)),
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
      return boundsForPoints(
        drawingOpeningMarkerSegments(geometry, resolved).flat(),
      );
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
