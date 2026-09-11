import type {
  DrawingCanvas,
  DrawingGeometry,
  Point,
} from "./drawing-workspace.types.ts";

export const DRAWING_TEXT_LINE_HEIGHT = 1.2;
export const DRAWING_DIMENSION_FONT_SIZE = 12;
export const DRAWING_TEXT_GLYPH_WIDTH = 0.6;
export const DRAWING_DIMENSION_MAX_LABEL_CHARACTERS = 24;

export type DrawingDimensionCalibration = {
  id: string;
  millimetersPerNormalizedUnit: number;
  pageHeight: number;
  pageWidth: number;
};

export type DrawingDimensionContext =
  | { kind: "native_millimeters" }
  | { kind: "pdf"; calibration: DrawingDimensionCalibration | null };

type DrawingDimensionContextOrCalibration =
  | DrawingDimensionContext
  | DrawingDimensionCalibration
  | null;

function isDimensionContext(
  value: DrawingDimensionContextOrCalibration | undefined,
): value is DrawingDimensionContext {
  return Boolean(value && typeof value === "object" && "kind" in value);
}

function dimensionContext(
  value: DrawingDimensionContextOrCalibration | undefined,
):
  | DrawingDimensionContext
  | { kind: "legacy"; calibration: DrawingDimensionCalibration | null } {
  if (!isDimensionContext(value))
    return { kind: "legacy", calibration: value ?? null };
  if (value.kind === "native_millimeters") return value;
  if (value.kind === "pdf" && "calibration" in value) return value;
  throw new TypeError("Dimension context is invalid.");
}

function drawingFontSize(fontSize: number) {
  if (!Number.isFinite(fontSize) || fontSize <= 0)
    throw new RangeError("Drawing annotation font size must be positive.");
  return fontSize;
}

export function drawingDimensionContextForCanvas(
  canvas: Pick<
    DrawingCanvas,
    "pageId" | "widthMillimeters" | "heightMillimeters" | "background"
  >,
): DrawingDimensionContext {
  if (
    !Number.isFinite(canvas.widthMillimeters) ||
    canvas.widthMillimeters <= 0 ||
    !Number.isFinite(canvas.heightMillimeters) ||
    canvas.heightMillimeters <= 0
  )
    throw new RangeError("Drawing canvas dimensions must be positive.");
  if (!canvas.background) return { kind: "native_millimeters" };
  return {
    kind: "pdf",
    calibration: canvas.background.calibration
      ? {
          id: canvas.pageId,
          millimetersPerNormalizedUnit:
            canvas.background.calibration.millimetersPerNormalizedUnit,
          pageHeight: canvas.heightMillimeters,
          pageWidth: canvas.widthMillimeters,
        }
      : null,
  };
}

export function drawingTextLayout(
  geometry: Extract<DrawingGeometry, { type: "text" }>,
  fontSize: number,
) {
  const lines = geometry.text.split("\n");
  return {
    fontSize,
    height: Math.max(1, lines.length) * fontSize * DRAWING_TEXT_LINE_HEIGHT,
    lineHeight: DRAWING_TEXT_LINE_HEIGHT,
    width: geometry.width,
    wrap: "none" as const,
  };
}

export function drawingLayoutCorners(
  origin: Point,
  width: number,
  height: number,
): Point[] {
  return [
    origin,
    { x: origin.x + width, y: origin.y },
    { x: origin.x + width, y: origin.y + height },
    { x: origin.x, y: origin.y + height },
  ];
}

export function drawingDimensionLabel(
  geometry: Extract<DrawingGeometry, { type: "dimension" }>,
  contextOrLegacyCalibration?: DrawingDimensionContextOrCalibration,
) {
  const context = dimensionContext(contextOrLegacyCalibration);
  if (context.kind === "native_millimeters") {
    if (geometry.calibrationId !== null) return "보정 확인 불가";
    const millimeters = Math.hypot(
      geometry.end.x - geometry.start.x,
      geometry.end.y - geometry.start.y,
    );
    return Number.isFinite(millimeters)
      ? `${millimeters.toFixed(1)} mm`
      : "보정 확인 불가";
  }
  if (geometry.calibrationId === null) return "미보정";
  const calibration = context.calibration;
  if (
    !calibration ||
    calibration.id !== geometry.calibrationId ||
    !Number.isFinite(calibration.pageWidth) ||
    !Number.isFinite(calibration.pageHeight) ||
    calibration.pageWidth <= 0 ||
    calibration.pageHeight <= 0 ||
    !Number.isFinite(calibration.millimetersPerNormalizedUnit) ||
    calibration.millimetersPerNormalizedUnit <= 0
  )
    return "보정 확인 불가";
  const normalizedDistance = Math.hypot(
    (geometry.end.x - geometry.start.x) / calibration.pageWidth,
    (geometry.end.y - geometry.start.y) / calibration.pageHeight,
  );
  return `${(
    normalizedDistance * calibration.millimetersPerNormalizedUnit
  ).toFixed(1)} mm`;
}

export function drawingDimensionDisplayPoints(
  geometry: Extract<DrawingGeometry, { type: "dimension" }>,
) {
  const lineLength = Math.hypot(
    geometry.end.x - geometry.start.x,
    geometry.end.y - geometry.start.y,
  );
  const offsetX =
    (-(geometry.end.y - geometry.start.y) / lineLength) * geometry.offset;
  const offsetY =
    ((geometry.end.x - geometry.start.x) / lineLength) * geometry.offset;
  const displayStart = {
    x: geometry.start.x + offsetX,
    y: geometry.start.y + offsetY,
  };
  const displayEnd = {
    x: geometry.end.x + offsetX,
    y: geometry.end.y + offsetY,
  };
  return {
    displayStart,
    displayEnd,
    label: {
      x: (displayStart.x + displayEnd.x) / 2,
      y: (displayStart.y + displayEnd.y) / 2,
    },
  };
}

export function drawingDimensionLayout(
  geometry: Extract<DrawingGeometry, { type: "dimension" }>,
  contextOrLegacyCalibration?: DrawingDimensionContextOrCalibration,
  resolvedFontSize = DRAWING_DIMENSION_FONT_SIZE,
) {
  const fontSize = drawingFontSize(resolvedFontSize);
  const display = drawingDimensionDisplayPoints(geometry);
  const text = drawingDimensionLabel(geometry, contextOrLegacyCalibration);
  const width =
    Math.max(1, Array.from(text).length) * fontSize * DRAWING_TEXT_GLYPH_WIDTH;
  const height = fontSize * DRAWING_TEXT_LINE_HEIGHT;
  const warning = text === "미보정" || text === "보정 확인 불가";
  return {
    ...display,
    fontSize,
    height,
    lineHeight: DRAWING_TEXT_LINE_HEIGHT,
    points: [
      geometry.start,
      geometry.end,
      display.displayStart,
      display.displayEnd,
      ...drawingLayoutCorners(display.label, width, height),
    ],
    text,
    warning,
    width,
    wrap: "none" as const,
  };
}

/** Conservatively encloses calibrated numeric labels across the finite domain. */
export function drawingDimensionBoundsPoints(
  geometry: Extract<DrawingGeometry, { type: "dimension" }>,
  contextOrLegacyCalibration?: DrawingDimensionContextOrCalibration,
  resolvedFontSize = DRAWING_DIMENSION_FONT_SIZE,
) {
  const contextAware = isDimensionContext(contextOrLegacyCalibration);
  const layout = drawingDimensionLayout(
    geometry,
    contextOrLegacyCalibration,
    resolvedFontSize,
  );
  const width =
    contextAware || geometry.calibrationId === null
      ? layout.width
      : Math.max(
          layout.width,
          DRAWING_DIMENSION_MAX_LABEL_CHARACTERS *
            layout.fontSize *
            DRAWING_TEXT_GLYPH_WIDTH,
        );
  return [
    geometry.start,
    geometry.end,
    layout.displayStart,
    layout.displayEnd,
    ...drawingLayoutCorners(layout.label, width, layout.height),
  ];
}
