import assert from "node:assert/strict";
import test from "node:test";

import {
  applyDrawingCommand,
  createDrawingDocumentState,
} from "../app/lukas/lib/drawing-commands.ts";
import { resolveDrawingTable } from "../app/lukas/lib/drawing-tables.ts";

const schedules =
  await import("../app/lukas/lib/drawing-semantic-schedules.ts").catch(
    () => ({}),
  );

const ids = {
  revision: "50000000-0000-4000-8000-000000000001",
  page: "50000000-0000-4000-8000-000000000002",
  canvas: "50000000-0000-4000-8000-000000000003",
  layer: "50000000-0000-4000-8000-000000000004",
  roomA: "50000000-0000-4000-8000-000000000011",
  roomB: "50000000-0000-4000-8000-000000000012",
  roomC: "50000000-0000-4000-8000-000000000013",
  deletedRoom: "50000000-0000-4000-8000-000000000014",
  wall: "50000000-0000-4000-8000-000000000020",
  window: "50000000-0000-4000-8000-000000000021",
  doorB: "50000000-0000-4000-8000-000000000022",
  doorA: "50000000-0000-4000-8000-000000000023",
  area: "50000000-0000-4000-8000-000000000024",
  actor: "50000000-0000-4000-8000-000000000030",
  table: "50000000-0000-4000-8000-000000000031",
  column: "50000000-0000-4000-8000-000000000032",
  row: "50000000-0000-4000-8000-000000000033",
};

const style = { stroke: "#334155", strokeWidth: 1, fill: null };

function object(id, name, geometry) {
  return {
    id,
    name,
    layerId: ids.layer,
    geometry,
    styleId: null,
    style,
    version: 1,
  };
}

function space(id, name, number, width, height, finishes) {
  return object(id, name, {
    type: "space",
    semanticVersion: 1,
    boundary: [
      { x: 0, y: 0 },
      { x: width, y: 0 },
      { x: width, y: height },
      { x: 0, y: height },
    ],
    number,
    finishes,
  });
}

function opening(id, name, openingKind, offset, width, height) {
  return object(id, name, {
    type: "opening",
    semanticVersion: 1,
    hostWallId: ids.wall,
    offsetMillimeters: offset,
    widthMillimeters: width,
    heightMillimeters: height,
    sillHeightMillimeters: openingKind === "door" ? 0 : 900,
    openingKind,
  });
}

function mixedState() {
  const roomA = space(ids.roomA, "Room", "101", 1_000, 1_000, {
    floor: "Tile",
    wall: "Paint",
    ceiling: null,
  });
  const roomB = space(ids.roomB, "Room", "101", 2_000, 1_000, {
    floor: null,
    wall: "Paint",
    ceiling: "Acoustic",
  });
  const roomC = space(ids.roomC, "Storage", "102", 1_000, 500, {
    floor: "Epoxy",
    wall: null,
    ceiling: null,
  });
  const deletedRoom = space(ids.deletedRoom, "Deleted", "000", 9_000, 9_000, {
    floor: "Ignore",
    wall: "Ignore",
    ceiling: "Ignore",
  });
  const wall = object(ids.wall, "Wall", {
    type: "wall",
    semanticVersion: 1,
    start: { x: 0, y: 0 },
    end: { x: 10_000, y: 0 },
    thicknessMillimeters: 200,
    heightMillimeters: 3_000,
  });
  const window = opening(ids.window, "W-01", "window", 1_500, 1_200, 1_200);
  const doorB = opening(ids.doorB, "D-02", "door", 3_000, 1_000, 2_100);
  const doorA = opening(ids.doorA, "D-01", "door", 5_000, 900, 2_000);
  const area = object(ids.area, "Gross area", {
    type: "area",
    semanticVersion: 1,
    boundary: [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ],
  });
  const allObjects = [
    window,
    roomC,
    doorB,
    area,
    roomB,
    wall,
    doorA,
    roomA,
    deletedRoom,
  ];
  const current = createDrawingDocumentState({
    revisionId: ids.revision,
    structure: {
      pages: {
        [ids.page]: {
          id: ids.page,
          revisionId: ids.revision,
          name: "A-101",
          sortOrder: 0,
          version: 1,
        },
      },
      canvases: {
        [ids.canvas]: {
          id: ids.canvas,
          pageId: ids.page,
          name: "Paper",
          spaceKind: "paper",
          widthMillimeters: 20_000,
          heightMillimeters: 20_000,
          background: null,
          sortOrder: 0,
          version: 1,
        },
      },
      layers: {
        [ids.layer]: {
          id: ids.layer,
          name: "Work",
          visible: true,
          locked: false,
          systemKind: "work",
          canvasId: ids.canvas,
          sortOrder: 0,
          version: 1,
        },
      },
      // Intentionally neither semantic nor lexical order.
      objects: Object.fromEntries(allObjects.map((value) => [value.id, value])),
      styles: {},
      blocks: {},
      blockInstances: {},
      propertySchemas: {},
      propertyValues: {},
      tables: {},
    },
  });
  return applyDrawingCommand(
    current,
    {
      type: "delete_objects",
      actorId: ids.actor,
      objectIds: [ids.deletedRoom],
    },
    {
      createId: () => "50000000-0000-4000-8000-000000000099",
      now: () => "2026-08-27T00:00:00.000Z",
    },
  ).state;
}

test("room schedule is a fixed full-revision projection with exact totals and ID ties", () => {
  assert.equal(typeof schedules.resolveDrawingSemanticSchedule, "function");
  const room = schedules.resolveDrawingSemanticSchedule("room", mixedState());
  assert.deepEqual(room, {
    kind: "room",
    caption: "Room schedule",
    columns: [
      { key: "number", label: "공간 번호" },
      { key: "name", label: "공간 이름" },
      { key: "area", label: "면적" },
      { key: "count", label: "수량" },
    ],
    rows: [
      {
        objectId: ids.roomA,
        cells: { number: "101", name: "Room", area: "1 m²", count: "1" },
      },
      {
        objectId: ids.roomB,
        cells: { number: "101", name: "Room", area: "2 m²", count: "1" },
      },
      {
        objectId: ids.roomC,
        cells: {
          number: "102",
          name: "Storage",
          area: "0.5 m²",
          count: "1",
        },
      },
    ],
    totals: {
      label: "합계",
      cells: { number: "", name: "", area: "3.5 m²", count: "3" },
    },
  });
  assert.doesNotMatch(JSON.stringify(room), /Deleted|81 m²/);
});

test("door and finish schedules filter and format only their fixed semantic sources", () => {
  assert.equal(typeof schedules.resolveDrawingSemanticSchedule, "function");
  const current = mixedState();
  assert.deepEqual(schedules.resolveDrawingSemanticSchedule("door", current), {
    kind: "door",
    caption: "Door schedule",
    columns: [
      { key: "mark", label: "문 마크" },
      { key: "width", label: "너비" },
      { key: "height", label: "높이" },
      { key: "count", label: "수량" },
    ],
    rows: [
      {
        objectId: ids.doorA,
        cells: { mark: "D-01", width: "900 mm", height: "2000 mm", count: "1" },
      },
      {
        objectId: ids.doorB,
        cells: {
          mark: "D-02",
          width: "1000 mm",
          height: "2100 mm",
          count: "1",
        },
      },
    ],
    totals: {
      label: "합계",
      cells: { mark: "", width: "", height: "", count: "2" },
    },
  });
  assert.deepEqual(
    schedules.resolveDrawingSemanticSchedule("finish", current),
    {
      kind: "finish",
      caption: "Finish schedule",
      columns: [
        { key: "number", label: "공간 번호" },
        { key: "name", label: "공간 이름" },
        { key: "floor", label: "바닥 마감" },
        { key: "wall", label: "벽 마감" },
        { key: "ceiling", label: "천장 마감" },
        { key: "area", label: "면적" },
      ],
      rows: [
        {
          objectId: ids.roomA,
          cells: {
            number: "101",
            name: "Room",
            floor: "Tile",
            wall: "Paint",
            ceiling: "",
            area: "1 m²",
          },
        },
        {
          objectId: ids.roomB,
          cells: {
            number: "101",
            name: "Room",
            floor: "",
            wall: "Paint",
            ceiling: "Acoustic",
            area: "2 m²",
          },
        },
        {
          objectId: ids.roomC,
          cells: {
            number: "102",
            name: "Storage",
            floor: "Epoxy",
            wall: "",
            ceiling: "",
            area: "0.5 m²",
          },
        },
      ],
      totals: {
        label: "합계",
        cells: {
          number: "",
          name: "",
          floor: "",
          wall: "",
          ceiling: "",
          area: "3.5 m²",
        },
      },
    },
  );
});

test("semantic schedule output is byte-stable and keeps saved P2 schedules separate", () => {
  const current = mixedState();
  for (const kind of ["room", "door", "finish"]) {
    const first = JSON.stringify(
      schedules.resolveDrawingSemanticSchedule(kind, current),
    );
    const second = JSON.stringify(
      schedules.resolveDrawingSemanticSchedule(kind, current),
    );
    assert.equal(first, second);
  }
  const empty = createDrawingDocumentState({
    revisionId: ids.revision,
    layers: Object.values(current.layers),
    objects: [],
  });
  assert.deepEqual(
    schedules.resolveDrawingSemanticSchedule("room", empty).rows,
    [],
  );
  assert.deepEqual(
    schedules.resolveDrawingSemanticSchedule("room", empty).totals.cells,
    { number: "", name: "", area: "0 m²", count: "0" },
  );

  const p2State = createDrawingDocumentState({
    revisionId: ids.revision,
    structure: {
      ...current.structure,
      tables: {
        [ids.table]: {
          id: ids.table,
          revisionId: ids.revision,
          name: "Saved notes",
          columns: [
            {
              id: ids.column,
              name: "Note",
              kind: "text",
              propertySchemaId: null,
            },
          ],
          rows: [
            {
              id: ids.row,
              objectId: ids.roomA,
              blockInstanceId: null,
              cells: { [ids.column]: "editable P2 value" },
            },
          ],
          version: 1,
        },
      },
    },
  });
  assert.deepEqual(
    resolveDrawingTable(p2State.structure.tables[ids.table], p2State),
    [{ Note: "editable P2 value" }],
  );
});

test("server evidence binds authorized revision checkpoint object IDs and rule version", () => {
  assert.equal(
    typeof schedules.deriveDrawingServerMeasurementEvidence,
    "function",
  );
  assert.equal(typeof schedules.resolveDrawingServerEvidenceStatus, "function");
  const state = mixedState();
  const evidence = schedules.deriveDrawingServerMeasurementEvidence({
    revisionId: ids.revision,
    operationCheckpoint: 42,
    state,
  });
  const semanticIds = [
    ids.roomA,
    ids.roomB,
    ids.roomC,
    ids.wall,
    ids.window,
    ids.doorB,
    ids.doorA,
    ids.area,
  ].sort();
  assert.equal(evidence.revisionId, ids.revision);
  assert.equal(evidence.operationCheckpoint, 42);
  assert.equal(evidence.ruleVersion, "P4_MEASUREMENT_V1");
  assert.deepEqual(evidence.objectIds, semanticIds);
  assert.deepEqual(Object.keys(evidence.measurements), semanticIds);
  assert.deepEqual(evidence.measurements[ids.doorA], {
    revisionId: ids.revision,
    operationCheckpoint: 42,
    objectId: ids.doorA,
    ruleVersion: "P4_MEASUREMENT_V1",
    measurement: {
      ruleVersion: "P4_MEASUREMENT_V1",
      lengthMillimeters: "900",
      areaSquareMillimeters: "1800000",
      count: "1",
    },
  });
  assert.deepEqual(
    schedules.resolveDrawingServerEvidenceStatus(evidence, {
      revisionId: ids.revision,
      operationCheckpoint: 42,
      objectIds: semanticIds,
      hasUnconfirmedChanges: false,
    }),
    { status: "confirmed", reason: null },
  );
  for (const query of [
    {
      revisionId: ids.revision,
      operationCheckpoint: 43,
      objectIds: semanticIds,
      hasUnconfirmedChanges: false,
    },
    {
      revisionId: ids.revision,
      operationCheckpoint: 42,
      objectIds: semanticIds,
      hasUnconfirmedChanges: true,
    },
    {
      revisionId: ids.revision,
      operationCheckpoint: 42,
      objectIds: semanticIds.slice(1),
      hasUnconfirmedChanges: false,
    },
  ])
    assert.equal(
      schedules.resolveDrawingServerEvidenceStatus(evidence, query).status,
      "stale",
    );
});
