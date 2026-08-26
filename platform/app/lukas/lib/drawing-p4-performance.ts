import type { DrawingObject } from "./drawing-workspace.types";

const id = (index: number) =>
  `40000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`;

export function buildDrawingP4PerformanceFixture(
  count: number,
  layerId: string,
) {
  if (count !== 10_000)
    throw new Error("The P4 release fixture requires exactly 10,000 objects");

  const composition = {
    wall: 2_000,
    opening: 2_000,
    space: 1_500,
    area: 1_500,
    grid: 1_500,
    arc: 1_500,
  } as const;
  const style = { stroke: "#2563eb", strokeWidth: 1, fill: null };
  const walls: DrawingObject[] = Array.from(
    { length: composition.wall },
    (_, index) => {
      const isolated = index < 2;
      const x = isolated ? 100 : 300 + (index % 50) * 40;
      const y = isolated ? 100 + index * 40 : 300 + Math.floor(index / 50) * 35;
      return {
        id: id(index),
        name: isolated ? `P4 selection ${index + 1}` : `P4 wall ${index + 1}`,
        layerId,
        geometry: {
          type: "wall",
          semanticVersion: 1,
          start: { x, y },
          end: { x: x + (isolated ? 200 : 30), y },
          thicknessMillimeters: 2,
          heightMillimeters: 3_000,
        },
        style,
        version: 1,
      };
    },
  );
  const openings: DrawingObject[] = walls.map((wall, index) => ({
    id: id(composition.wall + index),
    name: `P4 door ${index + 1}`,
    layerId,
    geometry: {
      type: "opening",
      semanticVersion: 1,
      hostWallId: wall.id,
      offsetMillimeters: index < 2 ? 100 : 15,
      widthMillimeters: 10,
      heightMillimeters: 2_100,
      sillHeightMillimeters: 0,
      openingKind: "door",
    },
    style,
    version: 1,
  }));
  const polygons = (type: "space" | "area", amount: number, offset: number) =>
    Array.from({ length: amount }, (_, index): DrawingObject => {
      const x = 300 + (index % 50) * 40;
      const y = 1_750 + Math.floor(index / 50) * 35;
      const boundary = [
        { x, y },
        { x: x + 20, y },
        { x: x + 20, y: y + 20 },
        { x, y: y + 20 },
      ];
      const geometry: DrawingObject["geometry"] =
        type === "space"
          ? {
              type: "space",
              semanticVersion: 1,
              boundary,
              number: String(index + 1),
              finishes: { floor: null, wall: null, ceiling: null },
            }
          : { type: "area", semanticVersion: 1, boundary };
      return {
        id: id(offset + index),
        name: `P4 ${type} ${index + 1}`,
        layerId,
        geometry,
        style: { ...style, fill: "#bfdbfe22" },
        version: 1,
      };
    });
  const spaces = polygons("space", composition.space, 4_000);
  const areas = polygons("area", composition.area, 5_500);
  const grids: DrawingObject[] = Array.from(
    { length: composition.grid },
    (_, index) => {
      const x = 300 + (index % 50) * 40;
      const y = 2_850 + Math.floor(index / 50) * 25;
      return {
        id: id(7_000 + index),
        name: `P4 grid ${index + 1}`,
        layerId,
        geometry: {
          type: "grid",
          semanticVersion: 1,
          start: { x, y },
          end: { x: x + 30, y },
        },
        style,
        version: 1,
      };
    },
  );
  const arcs: DrawingObject[] = Array.from(
    { length: composition.arc },
    (_, index) => ({
      id: id(8_500 + index),
      name: `P4 arc ${index + 1}`,
      layerId,
      geometry: {
        type: "arc",
        semanticVersion: 1,
        center: {
          x: 300 + (index % 50) * 40,
          y: 3_650 + Math.floor(index / 50) * 25,
        },
        radius: 10,
        startAngleDegrees: 0,
        sweepAngleDegrees: 180,
      },
      style,
      version: 1,
    }),
  );
  const objects = [
    ...walls,
    ...openings,
    ...spaces,
    ...areas,
    ...grids,
    ...arcs,
  ];
  return {
    composition,
    objects,
    selectionTarget: {
      id: walls[0].id,
      name: walls[0].name,
      world: { x: 110, y: 100 },
    },
    selectionTargets: walls.slice(0, 2).map((wall, index) => ({
      id: wall.id,
      name: wall.name,
      world: { x: 110, y: 100 + index * 40 },
    })),
  };
}
