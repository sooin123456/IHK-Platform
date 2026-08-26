export { buildDrawingP4PerformanceFixture } from "../../app/lukas/lib/drawing-p4-performance.ts";

import type { DrawingObject } from "../../app/lukas/lib/drawing-workspace.types";

export function buildDrawingP4ProductionObjects(
  layerId: string,
  makeId: () => string,
): DrawingObject[] {
  const ids = Array.from({ length: 6 }, makeId);
  const style = { stroke: "#0f172a", strokeWidth: 2, fill: null };
  return [
    {
      id: ids[0],
      name: "P4 hosted wall",
      layerId,
      geometry: {
        type: "wall",
        semanticVersion: 1,
        start: { x: 40, y: 40 },
        end: { x: 240, y: 40 },
        thicknessMillimeters: 20,
        heightMillimeters: 3_000,
      },
      style,
      version: 1,
    },
    {
      id: ids[1],
      name: "P4 hosted door",
      layerId,
      geometry: {
        type: "opening",
        semanticVersion: 1,
        hostWallId: ids[0],
        offsetMillimeters: 100,
        widthMillimeters: 90,
        heightMillimeters: 2_100,
        sillHeightMillimeters: 0,
        openingKind: "door",
      },
      style,
      version: 1,
    },
    {
      id: ids[2],
      name: "P4 hosted room",
      layerId,
      geometry: {
        type: "space",
        semanticVersion: 1,
        boundary: [
          { x: 40, y: 80 },
          { x: 240, y: 80 },
          { x: 240, y: 200 },
          { x: 40, y: 200 },
        ],
        number: "P4-101",
        finishes: { floor: "tile", wall: "paint", ceiling: "acoustic" },
      },
      style: { ...style, fill: "#dbeafe55" },
      version: 1,
    },
    {
      id: ids[3],
      name: "P4 hosted area",
      layerId,
      geometry: {
        type: "area",
        semanticVersion: 1,
        boundary: [
          { x: 280, y: 80 },
          { x: 380, y: 80 },
          { x: 380, y: 180 },
          { x: 280, y: 180 },
        ],
      },
      style: { ...style, fill: "#fde68a55" },
      version: 1,
    },
    {
      id: ids[4],
      name: "P4 hosted grid",
      layerId,
      geometry: {
        type: "grid",
        semanticVersion: 1,
        start: { x: 20, y: 240 },
        end: { x: 420, y: 240 },
      },
      style,
      version: 1,
    },
    {
      id: ids[5],
      name: "P4 hosted arc",
      layerId,
      geometry: {
        type: "arc",
        semanticVersion: 1,
        center: { x: 320, y: 280 },
        radius: 40,
        startAngleDegrees: 0,
        sweepAngleDegrees: 180,
      },
      style,
      version: 1,
    },
  ];
}
