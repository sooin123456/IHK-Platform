export { buildDrawingP4PerformanceFixture } from "../../app/lukas/lib/drawing-p4-performance.ts";

import type { DrawingObject } from "../../app/lukas/lib/drawing-workspace.types.ts";
import {
  resolveDrawingServerEvidenceStatus,
  type DrawingMeasurementEvidenceCurrent,
  type DrawingMeasurementEvidenceError,
  type DrawingServerMeasurementEvidence,
} from "../../app/lukas/lib/drawing-semantic-schedules.ts";

function exact(value: unknown, expected: unknown, label: string) {
  if (JSON.stringify(value) !== JSON.stringify(expected))
    throw new Error(`P4 hosted ${label} is not exact`);
}

export function assertDrawingP4HostedServerEvidence({
  evidence,
  evidenceError,
  current,
  objects,
}: {
  evidence: DrawingServerMeasurementEvidence | null;
  evidenceError: DrawingMeasurementEvidenceError | null;
  current: DrawingMeasurementEvidenceCurrent | null;
  objects: DrawingObject[];
}) {
  if (evidenceError) throw new Error("P4 hosted measurement derivation failed");
  if (!evidence) throw new Error("P4 hosted measurement evidence is absent");
  if (
    resolveDrawingServerEvidenceStatus(evidence, current).status !== "confirmed"
  )
    throw new Error("P4 hosted measurement evidence is stale");
  if (evidence.ruleVersion !== "P4_MEASUREMENT_V1")
    throw new Error("P4 hosted measurement rule is not V1");

  const objectOfType = (
    label: string,
    predicate: (object: DrawingObject) => boolean,
  ) => {
    const matches = objects.filter(predicate);
    if (matches.length !== 1)
      throw new Error(`P4 hosted ${label} identity is not exact`);
    return matches[0];
  };
  const semanticObjects = {
    wall: objectOfType("wall", ({ geometry }) => geometry.type === "wall"),
    opening: objectOfType(
      "door",
      ({ geometry }) =>
        geometry.type === "opening" && geometry.openingKind === "door",
    ),
    space: objectOfType("space", ({ geometry }) => geometry.type === "space"),
    area: objectOfType("area", ({ geometry }) => geometry.type === "area"),
    grid: objectOfType("grid", ({ geometry }) => geometry.type === "grid"),
    arc: objectOfType("arc", ({ geometry }) => geometry.type === "arc"),
  };

  const sortedObjects = [...objects].sort((left, right) =>
    left.id.localeCompare(right.id),
  );
  exact(
    evidence.objectIds,
    sortedObjects.map(({ id }) => id),
    "object IDs",
  );
  exact(
    evidence.objectLineage,
    sortedObjects.map(({ id, version }) => ({
      objectId: id,
      objectVersion: version,
    })),
    "object lineage",
  );

  const exactMeasurements = new Map([
    [
      semanticObjects.wall.id,
      { lengthMillimeters: "200", areaSquareMillimeters: null, count: "1" },
    ],
    [
      semanticObjects.opening.id,
      {
        lengthMillimeters: "90",
        areaSquareMillimeters: "189000",
        count: "1",
      },
    ],
    [
      semanticObjects.space.id,
      {
        lengthMillimeters: "640",
        areaSquareMillimeters: "24000",
        count: "1",
      },
    ],
    [
      semanticObjects.area.id,
      {
        lengthMillimeters: "400",
        areaSquareMillimeters: "10000",
        count: "1",
      },
    ],
    [
      semanticObjects.grid.id,
      { lengthMillimeters: "400", areaSquareMillimeters: null, count: "1" },
    ],
    [
      semanticObjects.arc.id,
      {
        lengthMillimeters: "125.663706",
        areaSquareMillimeters: null,
        count: "1",
      },
    ],
  ]);
  sortedObjects.forEach((object) => {
    const item = evidence.measurements[object.id];
    if (
      !item ||
      item.documentId !== evidence.documentId ||
      item.revisionId !== evidence.revisionId ||
      item.revisionVersion !== evidence.revisionVersion ||
      item.snapshotSha256 !== evidence.snapshotSha256 ||
      item.operationCheckpoint !== evidence.operationCheckpoint ||
      item.objectId !== object.id ||
      item.objectVersion !== object.version ||
      item.ruleVersion !== "P4_MEASUREMENT_V1"
    )
      throw new Error("P4 hosted measurement item lineage is not exact");
    exact(
      item.measurement,
      {
        ruleVersion: "P4_MEASUREMENT_V1",
        ...exactMeasurements.get(object.id),
      },
      `${object.geometry.type} measurement`,
    );
  });

  exact(
    evidence.schedules.room.rows,
    [
      {
        objectId: semanticObjects.space.id,
        cells: {
          number: "P4-101",
          name: "P4 hosted room",
          area: "0.024 m²",
          count: "1",
        },
      },
    ],
    "room schedule",
  );
  exact(
    evidence.schedules.door.rows,
    [
      {
        objectId: semanticObjects.opening.id,
        cells: {
          mark: "P4 hosted door",
          width: "90 mm",
          height: "2100 mm",
          count: "1",
        },
      },
    ],
    "door schedule",
  );
  exact(
    evidence.schedules.finish.rows,
    [
      {
        objectId: semanticObjects.space.id,
        cells: {
          number: "P4-101",
          name: "P4 hosted room",
          floor: "tile",
          wall: "paint",
          ceiling: "acoustic",
          area: "0.024 m²",
        },
      },
    ],
    "finish schedule",
  );
  return evidence;
}

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
