import type { DrawingGeometry, Point } from "./drawing-workspace.types.ts";

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
  calibration?: DrawingDimensionCalibration | null,
) {
  if (geometry.calibrationId === null) return "미보정";
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
  calibration?: DrawingDimensionCalibration | null,
) {
  const display = drawingDimensionDisplayPoints(geometry);
  const text = drawingDimensionLabel(geometry, calibration);
  const width =
    Math.max(1, Array.from(text).length) *
    DRAWING_DIMENSION_FONT_SIZE *
    DRAWING_TEXT_GLYPH_WIDTH;
  const height = DRAWING_DIMENSION_FONT_SIZE * DRAWING_TEXT_LINE_HEIGHT;
  return {
    ...display,
    fontSize: DRAWING_DIMENSION_FONT_SIZE,
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
    width,
    wrap: "none" as const,
  };
}

/** Conservatively encloses calibrated numeric labels across the finite domain. */
export function drawingDimensionBoundsPoints(
  geometry: Extract<DrawingGeometry, { type: "dimension" }>,
) {
  const layout = drawingDimensionLayout(geometry);
  const width =
    geometry.calibrationId === null
      ? layout.width
      : Math.max(
          layout.width,
          DRAWING_DIMENSION_MAX_LABEL_CHARACTERS *
            DRAWING_DIMENSION_FONT_SIZE *
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
