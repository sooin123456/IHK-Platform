import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";

import {
  applyDrawingCommand,
  createDrawingDocumentState,
} from "../app/lukas/lib/drawing-commands.ts";

const names = [
  "revision",
  "page",
  "canvas",
  "layer",
  "objectA",
  "objectB",
  "width",
  "rating",
  "exterior",
  "date",
  "widthValue",
  "ratingValue",
  "booleanValue",
  "dateValue",
  "table",
  "objectNameColumn",
  "widthColumn",
  "ratingColumn",
  "noteColumn",
  "costColumn",
  "rowA",
  "rowB",
  "actor",
  "operation",
];
const ids = Object.fromEntries(
  names.map((name, index) => [
    name,
    `10000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
  ]),
);
const style = { stroke: "#112233", strokeWidth: 1, fill: null };

function object(id, name, type = "rectangle") {
  return {
    id,
    name,
    layerId: ids.layer,
    geometry:
      type === "rectangle"
        ? { type, origin: { x: 0, y: 0 }, width: 10, height: 20, rotation: 0 }
        : { type: "circle", center: { x: 5, y: 5 }, radius: 5 },
    styleId: null,
    style,
    version: 1,
  };
}

function schema(id, name, valueType, enumOptions = []) {
  return {
    id,
    revisionId: ids.revision,
    name,
    valueType,
    enumOptions,
    appliesTo: ["rectangle"],
    required: false,
    version: 1,
  };
}

function table(overrides = {}) {
  return {
    id: ids.table,
    revisionId: ids.revision,
    name: "Door schedule",
    columns: [
      {
        id: ids.objectNameColumn,
        name: "object_name",
        kind: "object_name",
        propertySchemaId: null,
      },
      {
        id: ids.widthColumn,
        name: "width",
        kind: "property",
        propertySchemaId: ids.width,
      },
      {
        id: ids.ratingColumn,
        name: "fire_rating",
        kind: "property",
        propertySchemaId: ids.rating,
      },
    ],
    rows: [
      { id: ids.rowA, objectId: ids.objectA, blockInstanceId: null, cells: {} },
    ],
    version: 1,
    ...overrides,
  };
}

function structure(overrides = {}) {
  return {
    pages: {
      [ids.page]: {
        id: ids.page,
        revisionId: ids.revision,
        name: "A1",
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
        widthMillimeters: 210,
        heightMillimeters: 297,
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
    objects: {
      [ids.objectA]: object(ids.objectA, "Door 01"),
      [ids.objectB]: object(ids.objectB, "Door 02", "circle"),
    },
    styles: {},
    blocks: {},
    blockInstances: {},
    propertySchemas: {
      [ids.width]: schema(ids.width, "Width", "number"),
      [ids.rating]: schema(ids.rating, "Fire rating", "enum", [
        "30 min",
        "60 min",
      ]),
      [ids.exterior]: schema(ids.exterior, "Exterior", "boolean"),
      [ids.date]: schema(ids.date, "Install date", "date"),
    },
    propertyValues: {
      [ids.widthValue]: {
        id: ids.widthValue,
        schemaId: ids.width,
        objectId: ids.objectA,
        blockInstanceId: null,
        value: 900,
        version: 1,
      },
      [ids.ratingValue]: {
        id: ids.ratingValue,
        schemaId: ids.rating,
        objectId: ids.objectA,
        blockInstanceId: null,
        value: "60 min",
        version: 1,
      },
      [ids.booleanValue]: {
        id: ids.booleanValue,
        schemaId: ids.exterior,
        objectId: ids.objectA,
        blockInstanceId: null,
        value: false,
        version: 1,
      },
      [ids.dateValue]: {
        id: ids.dateValue,
        schemaId: ids.date,
        objectId: ids.objectA,
        blockInstanceId: null,
        value: "2026-08-25",
        version: 1,
      },
    },
    tables: { [ids.table]: table() },
    ...overrides,
  };
}

function state(overrides = {}) {
  return createDrawingDocumentState({
    revisionId: ids.revision,
    structure: structure(overrides),
  });
}

const tables = await import("../app/lukas/lib/drawing-tables.ts").catch(
  () => ({}),
);

test("schedule resolution preserves stored row and column order", () => {
  assert.equal(typeof tables.resolveDrawingTable, "function");
  const baseSchemas = structure().propertySchemas;
  const current = state({
    propertySchemas: {
      ...baseSchemas,
      [ids.rating]: {
        ...baseSchemas[ids.rating],
        appliesTo: ["rectangle", "circle"],
      },
    },
  });
  assert.deepEqual(
    tables.resolveDrawingTable(current.structure.tables[ids.table], current),
    [{ object_name: "Door 01", width: 900, fire_rating: "60 min" }],
  );
  const ordered = table({
    columns: [
      {
        id: ids.ratingColumn,
        name: "rating",
        kind: "property",
        propertySchemaId: ids.rating,
      },
      {
        id: ids.objectNameColumn,
        name: "name",
        kind: "object_name",
        propertySchemaId: null,
      },
    ],
    rows: [
      { id: ids.rowB, objectId: ids.objectB, blockInstanceId: null, cells: {} },
      { id: ids.rowA, objectId: ids.objectA, blockInstanceId: null, cells: {} },
    ],
  });
  const resolved = tables.resolveDrawingTable(ordered, current);
  assert.deepEqual(resolved.map(Object.keys), [
    ["rating", "name"],
    ["rating", "name"],
  ]);
  assert.equal(resolved[1].name, "Door 01");
});

test("schedule resolution marks a missing target without evaluating anything", () => {
  assert.equal(typeof tables.resolveDrawingTable, "function");
  assert.equal(typeof tables.DRAWING_TABLE_MISSING_TARGET, "string");
  const current = state();
  const missing = table({
    columns: [
      {
        id: ids.objectNameColumn,
        name: "name",
        kind: "object_name",
        propertySchemaId: null,
      },
      {
        id: ids.noteColumn,
        name: "note",
        kind: "text",
        propertySchemaId: null,
      },
    ],
    rows: [
      {
        id: ids.rowA,
        objectId: "10000000-0000-4000-8000-999999999999",
        blockInstanceId: null,
        cells: { [ids.noteColumn]: "=1+1" },
      },
    ],
  });
  assert.deepEqual(tables.resolveDrawingTable(missing, current), [
    { name: tables.DRAWING_TABLE_MISSING_TARGET, note: "=1+1" },
  ]);
});

test("schedule resolution validates property columns before missing rows and enforces appliesTo", () => {
  const current = state();
  const missingTarget = "10000000-0000-4000-8000-999999999998";
  assert.throws(
    () =>
      tables.resolveDrawingTable(
        table({
          columns: [
            {
              id: ids.widthColumn,
              name: "invalid_property",
              kind: "property",
              propertySchemaId: "10000000-0000-4000-8000-999999999997",
            },
          ],
          rows: [
            {
              id: ids.rowA,
              objectId: missingTarget,
              blockInstanceId: null,
              cells: {},
            },
          ],
        }),
        current,
      ),
    /property column.*invalid/i,
  );
  assert.throws(
    () =>
      tables.resolveDrawingTable(
        table({
          columns: [
            {
              id: ids.widthColumn,
              name: "width",
              kind: "property",
              propertySchemaId: ids.width,
            },
          ],
          rows: [
            {
              id: ids.rowB,
              objectId: ids.objectB,
              blockInstanceId: null,
              cells: {},
            },
          ],
        }),
        current,
      ),
    /does not apply|appliesTo/i,
  );
});

test("table commands reject incompatible target rows and duplicate column or row identity", () => {
  const current = state();
  assert.throws(
    () =>
      tables.updateDrawingTableCommand(current, ids.actor, ids.table, {
        rows: [
          {
            id: ids.rowB,
            objectId: ids.objectB,
            blockInstanceId: null,
            cells: {},
          },
        ],
      }),
    /does not apply|appliesTo/i,
  );
  const secondColumnId = "10000000-0000-4000-8000-999999999991";
  const secondRowId = "10000000-0000-4000-8000-999999999992";
  for (const patch of [
    {
      columns: [
        {
          id: ids.noteColumn,
          name: "Note",
          kind: "text",
          propertySchemaId: null,
        },
        {
          id: ids.noteColumn,
          name: "Other",
          kind: "number",
          propertySchemaId: null,
        },
      ],
    },
    {
      columns: [
        {
          id: ids.noteColumn,
          name: "Duplicate",
          kind: "text",
          propertySchemaId: null,
        },
        {
          id: secondColumnId,
          name: "Duplicate",
          kind: "number",
          propertySchemaId: null,
        },
      ],
    },
    {
      rows: [
        {
          id: secondRowId,
          objectId: ids.objectA,
          blockInstanceId: null,
          cells: {},
        },
        {
          id: secondRowId,
          objectId: ids.objectB,
          blockInstanceId: null,
          cells: {},
        },
      ],
    },
  ]) {
    assert.throws(
      () =>
        tables.updateDrawingTableCommand(current, ids.actor, ids.table, patch),
      /unique|duplicate|고유/i,
    );
  }
});

test("property formatting is deterministic for number, boolean, date, enum, and missing values", () => {
  assert.equal(typeof tables.formatDrawingTablePropertyValue, "function");
  const schemas = structure().propertySchemas;
  assert.equal(
    tables.formatDrawingTablePropertyValue(schemas[ids.width], 900),
    900,
  );
  assert.equal(
    tables.formatDrawingTablePropertyValue(schemas[ids.exterior], false),
    "false",
  );
  assert.equal(
    tables.formatDrawingTablePropertyValue(schemas[ids.date], "2026-08-25"),
    "2026-08-25",
  );
  assert.equal(
    tables.formatDrawingTablePropertyValue(schemas[ids.rating], "60 min"),
    "60 min",
  );
  assert.equal(
    tables.formatDrawingTablePropertyValue(schemas[ids.width], null),
    "",
  );
});

test("manual cells are restricted to text and number columns and formulas stay literal", () => {
  assert.equal(typeof tables.resolveDrawingTable, "function");
  const current = state();
  const manual = table({
    columns: [
      {
        id: ids.noteColumn,
        name: "note",
        kind: "text",
        propertySchemaId: null,
      },
      {
        id: ids.costColumn,
        name: "cost",
        kind: "number",
        propertySchemaId: null,
      },
    ],
    rows: [
      {
        id: ids.rowA,
        objectId: ids.objectA,
        blockInstanceId: null,
        cells: { [ids.noteColumn]: "=SUM(1,2)", [ids.costColumn]: 3 },
      },
    ],
  });
  assert.deepEqual(tables.resolveDrawingTable(manual, current), [
    { note: "=SUM(1,2)", cost: 3 },
  ]);
  assert.throws(() =>
    tables.resolveDrawingTable(
      {
        ...manual,
        rows: [{ ...manual.rows[0], cells: { [ids.noteColumn]: 3 } }],
      },
      current,
    ),
  );
  assert.throws(() =>
    tables.resolveDrawingTable(
      {
        ...table(),
        rows: [
          {
            ...table().rows[0],
            cells: { [ids.objectNameColumn]: "stored computed value" },
          },
        ],
      },
      current,
    ),
  );
});

test("table mutation is one strict version-aware command with an exact inverse", () => {
  assert.equal(typeof tables.updateDrawingTableCommand, "function");
  const current = state();
  const nextRows = [
    {
      id: ids.rowA,
      objectId: ids.objectA,
      blockInstanceId: null,
      cells: { [ids.noteColumn]: "literal" },
    },
  ];
  const columns = [
    {
      id: ids.objectNameColumn,
      name: "name",
      kind: "object_name",
      propertySchemaId: null,
    },
    { id: ids.noteColumn, name: "note", kind: "text", propertySchemaId: null },
  ];
  const command = tables.updateDrawingTableCommand(
    current,
    ids.actor,
    ids.table,
    {
      columns,
      rows: nextRows,
    },
  );
  assert.deepEqual(command.actions, [
    {
      kind: "put_table",
      entity: {
        ...current.structure.tables[ids.table],
        columns,
        rows: nextRows,
      },
      baseVersion: 1,
    },
  ]);
  const applied = applyDrawingCommand(current, command, {
    createId: () => ids.operation,
    now: () => "2026-08-25T00:00:00.000Z",
  });
  assert.deepEqual(applied.operation.inverse, {
    type: "mutate_structure",
    actions: [
      {
        kind: "put_table",
        entity: current.structure.tables[ids.table],
        baseVersion: 2,
      },
    ],
  });
});

const vite = await createServer({
  appType: "custom",
  configFile: false,
  logLevel: "silent",
  resolve: {
    alias: { "~": fileURLToPath(new URL("../app", import.meta.url)) },
  },
  server: { middlewareMode: true },
});
after(() => vite.close());
const tableComponents = await vite
  .ssrLoadModule("/app/lukas/components/drawing-tables-panel.tsx")
  .catch(() => ({}));
const semanticTableComponents = await vite
  .ssrLoadModule("/app/lukas/components/drawing-semantic-schedules-panel.tsx")
  .catch(() => ({}));
const semanticInspectorComponents = await vite
  .ssrLoadModule("/app/lukas/components/drawing-semantic-inspector.tsx")
  .catch(() => ({}));
const semanticSchedules =
  await import("../app/lukas/lib/drawing-semantic-schedules.ts");

function semanticWall(overrides = {}) {
  return {
    id: "10000000-0000-4000-8000-000000000091",
    name: "Draft wall",
    layerId: ids.layer,
    geometry: {
      type: "wall",
      semanticVersion: 1,
      start: { x: 0, y: 0 },
      end: { x: 1_000, y: 0 },
      thicknessMillimeters: 18,
      heightMillimeters: 3_000,
    },
    styleId: null,
    style,
    version: 1,
    ...overrides,
  };
}

test("semantic inspector draft preserves dirty fields across local movement projections", () => {
  const wall = semanticWall();
  const baseline = {
    objectId: wall.id,
    objectVersion: wall.version,
    fields: { thicknessMillimeters: 18, heightMillimeters: 3_000 },
  };
  const moved = semanticWall({
    version: 28,
    geometry: {
      ...wall.geometry,
      start: { x: 70, y: 40 },
      end: { x: 1_070, y: 40 },
    },
  });
  assert.deepEqual(
    semanticInspectorComponents.drawingSemanticInspectorDraftStatus(
      baseline,
      moved,
    ),
    { kind: "preserve", conflictedFields: [] },
  );
});

test("semantic inspector draft preserves unrelated projections and reports a same-field conflict", () => {
  const wall = semanticWall();
  const baseline = {
    objectId: wall.id,
    objectVersion: wall.version,
    fields: { thicknessMillimeters: 18 },
  };
  assert.deepEqual(
    semanticInspectorComponents.drawingSemanticInspectorDraftStatus(
      baseline,
      semanticWall({
        version: 2,
        geometry: { ...wall.geometry, heightMillimeters: 3_200 },
      }),
    ),
    { kind: "preserve", conflictedFields: [] },
  );
  assert.deepEqual(
    semanticInspectorComponents.drawingSemanticInspectorDraftStatus(
      baseline,
      semanticWall({
        version: 2,
        geometry: { ...wall.geometry, thicknessMillimeters: 24 },
      }),
    ),
    { kind: "preserve", conflictedFields: ["thicknessMillimeters"] },
  );
});

test("semantic inspector draft clears when selection changes or the object is deleted", () => {
  const wall = semanticWall();
  const baseline = {
    objectId: wall.id,
    objectVersion: wall.version,
    fields: { thicknessMillimeters: 18 },
  };
  assert.deepEqual(
    semanticInspectorComponents.drawingSemanticInspectorDraftStatus(
      baseline,
      semanticWall({ id: "10000000-0000-4000-8000-000000000099" }),
    ),
    { kind: "clear", conflictedFields: [] },
  );
  assert.deepEqual(
    semanticInspectorComponents.drawingSemanticInspectorDraftStatus(
      baseline,
      null,
    ),
    { kind: "clear", conflictedFields: [] },
  );
});

test("schedule panel renders semantic read-only DOM and native labeled editor cells", () => {
  assert.equal(typeof tableComponents.DrawingTablesPanel, "function");
  const current = state({
    tables: {
      [ids.table]: table({
        columns: [
          {
            id: ids.objectNameColumn,
            name: "Name",
            kind: "object_name",
            propertySchemaId: null,
          },
          {
            id: ids.noteColumn,
            name: "Note",
            kind: "text",
            propertySchemaId: null,
          },
          {
            id: ids.costColumn,
            name: "Cost",
            kind: "number",
            propertySchemaId: null,
          },
        ],
        rows: [
          {
            id: ids.rowA,
            objectId: ids.objectA,
            blockInstanceId: null,
            cells: { [ids.noteColumn]: "Check", [ids.costColumn]: 12 },
          },
        ],
      }),
    },
  });
  const render = (canEdit) =>
    renderToStaticMarkup(
      createElement(tableComponents.DrawingTablesPanel, {
        actorId: ids.actor,
        canEdit,
        onCommand() {},
        selectedIds: [ids.objectA],
        state: current,
      }),
    );
  const viewer = render(false);
  assert.match(viewer, /<table/);
  assert.match(viewer, /<thead/);
  assert.match(viewer, /<tbody/);
  assert.match(viewer, /Door schedule/);
  assert.match(viewer, /Door 01/);
  assert.doesNotMatch(viewer, /<form|<input|<select|<button/);

  const editor = render(true);
  for (const label of [
    "새 일람표 이름",
    "선택 대상을 일람표로 추가",
    "Note",
    "Cost",
  ])
    assert.match(editor, new RegExp(label));
  assert.match(editor, /type="text"/);
  assert.match(editor, /type="number"/);
  assert.match(editor, /일람표 저장/);
  assert.doesNotMatch(editor, /formula|수식|XLSX/i);
});

test("semantic schedules render read-only preview versus checkpoint-bound server evidence", () => {
  assert.equal(
    typeof semanticTableComponents.DrawingSemanticSchedulesPanel,
    "function",
  );
  const room = {
    id: "10000000-0000-4000-8000-000000000090",
    name: "Meeting room",
    layerId: ids.layer,
    geometry: {
      type: "space",
      semanticVersion: 1,
      boundary: [
        { x: 0, y: 0 },
        { x: 2_000, y: 0 },
        { x: 2_000, y: 1_000 },
        { x: 0, y: 1_000 },
      ],
      number: "201",
      finishes: { floor: "Tile", wall: "Paint", ceiling: null },
    },
    styleId: null,
    style,
    version: 1,
  };
  const semanticState = {
    revisionId: ids.revision,
    objects: { [room.id]: room },
    layers: {},
    operations: [],
    undoStackByActor: {},
    redoStackByActor: {},
  };
  const lineage = {
    documentId: "10000000-0000-4000-8000-000000000096",
    revisionId: ids.revision,
    revisionVersion: 2,
    snapshotSha256: "f".repeat(64),
    operationCheckpoint: 9,
  };
  const evidence = semanticSchedules.deriveDrawingServerMeasurementEvidence({
    ...lineage,
    state: semanticState,
  });
  const render = (operationCheckpoint, hasUnconfirmedChanges = false) =>
    renderToStaticMarkup(
      createElement(semanticTableComponents.DrawingSemanticSchedulesPanel, {
        evidence,
        hasUnconfirmedChanges,
        lineage: { ...lineage, operationCheckpoint },
        state: semanticState,
      }),
    );
  const confirmed = render(9);
  for (const label of [
    "건축 일람표",
    "Room schedule",
    "Door schedule",
    "Finish schedule",
    "서버 증거",
    "P4_MEASUREMENT_V1",
    "체크포인트 9",
    "Postgres 권한 확인 로드",
    "Meeting room",
    "2 m²",
    "원본 수정 · 속성 검사기",
  ])
    assert.match(confirmed, new RegExp(label));
  assert.equal((confirmed.match(/<table/g) ?? []).length, 3);
  assert.match(confirmed, /data-drawing-server-evidence=/);
  assert.doesNotMatch(confirmed, /<form|<input|<select|<button/);

  const stale = render(10, true);
  assert.match(stale, /미리보기/);
  assert.match(stale, /오래됨|미확정|일치하지/);
  assert.doesNotMatch(stale, /Room schedule · 서버 증거/);
  assert.doesNotMatch(stale, /data-drawing-server-evidence=/);
});

test("semantic inspector confirms only matching server object evidence", () => {
  assert.equal(
    typeof semanticInspectorComponents.DrawingSemanticInspector,
    "function",
  );
  const wall = {
    id: "10000000-0000-4000-8000-000000000091",
    name: "Wall evidence",
    layerId: ids.layer,
    geometry: {
      type: "wall",
      semanticVersion: 1,
      start: { x: 0, y: 0 },
      end: { x: 3_000, y: 4_000 },
      thicknessMillimeters: 200,
      heightMillimeters: 3_000,
    },
    styleId: null,
    style,
    version: 1,
  };
  const semanticState = {
    revisionId: ids.revision,
    objects: { [wall.id]: wall },
  };
  const lineage = {
    documentId: "10000000-0000-4000-8000-000000000097",
    revisionId: ids.revision,
    revisionVersion: 2,
    snapshotSha256: "a".repeat(64),
    operationCheckpoint: 11,
  };
  const evidence = semanticSchedules.deriveDrawingServerMeasurementEvidence({
    ...lineage,
    state: semanticState,
  });
  const render = (operationCheckpoint) =>
    renderToStaticMarkup(
      createElement(semanticInspectorComponents.DrawingSemanticInspector, {
        actorId: ids.actor,
        canEdit: false,
        evidence,
        hasUnconfirmedChanges: false,
        lineage: { ...lineage, operationCheckpoint },
        object: wall,
        onCommand() {},
        state: semanticState,
      }),
    );
  const confirmed = render(11);
  assert.match(confirmed, /서버 계산 · V1/);
  assert.match(confirmed, /확정 · 5000 mm/);
  assert.match(confirmed, /P4_MEASUREMENT_V1/);
  assert.match(confirmed, /체크포인트 11/);
  assert.match(confirmed, /Postgres 권한 확인 로드/);
  const stale = render(12);
  assert.match(stale, /오래됨|미확정|일치하지/);
  assert.doesNotMatch(stale, /확정 · 5000 mm/);
});

test("semantic Schedule and inspector reject old same-ID evidence after a versioned geometry change", () => {
  const room = {
    id: "10000000-0000-4000-8000-000000000092",
    name: "Lineage room",
    layerId: ids.layer,
    geometry: {
      type: "space",
      semanticVersion: 1,
      boundary: [
        { x: 0, y: 0 },
        { x: 1_000, y: 0 },
        { x: 1_000, y: 1_000 },
        { x: 0, y: 1_000 },
      ],
      number: "301",
      finishes: { floor: null, wall: null, ceiling: null },
    },
    styleId: null,
    style,
    version: 1,
  };
  const serverState = {
    revisionId: ids.revision,
    objects: { [room.id]: room },
  };
  const lineage = {
    documentId: "10000000-0000-4000-8000-000000000093",
    revisionId: ids.revision,
    revisionVersion: 3,
    snapshotSha256: "e".repeat(64),
    operationCheckpoint: 21,
  };
  const evidence = semanticSchedules.deriveDrawingServerMeasurementEvidence({
    ...lineage,
    state: serverState,
  });
  const changedRoom = {
    ...room,
    version: 2,
    geometry: {
      ...room.geometry,
      boundary: [
        { x: 0, y: 0 },
        { x: 4_000, y: 0 },
        { x: 4_000, y: 1_000 },
        { x: 0, y: 1_000 },
      ],
    },
  };
  const currentState = {
    revisionId: ids.revision,
    objects: { [room.id]: changedRoom },
    layers: {},
    operations: [],
    undoStackByActor: {},
    redoStackByActor: {},
  };
  const schedule = renderToStaticMarkup(
    createElement(semanticTableComponents.DrawingSemanticSchedulesPanel, {
      evidence,
      hasUnconfirmedChanges: false,
      lineage,
      state: currentState,
    }),
  );
  assert.match(schedule, /오래됨|미확정/);
  assert.match(schedule, /4 m²/);
  assert.doesNotMatch(schedule, /Room schedule · 서버 증거/);

  const inspector = renderToStaticMarkup(
    createElement(semanticInspectorComponents.DrawingSemanticInspector, {
      actorId: ids.actor,
      canEdit: false,
      evidence,
      hasUnconfirmedChanges: false,
      lineage,
      object: changedRoom,
      onCommand() {},
      state: currentState,
    }),
  );
  assert.match(inspector, /오래됨|미확정/);
  assert.doesNotMatch(inspector, /확정 · 1 m²/);
});

test("semantic Schedule keeps accessible unconfirmed output when server and preview derivation fail", () => {
  const opening = {
    id: "10000000-0000-4000-8000-000000000094",
    name: "Orphan door",
    layerId: ids.layer,
    geometry: {
      type: "opening",
      semanticVersion: 1,
      hostWallId: "10000000-0000-4000-8000-000000000095",
      openingKind: "door",
      offsetMillimeters: 1_000,
      widthMillimeters: 900,
      heightMillimeters: 2_100,
      sillHeightMillimeters: 0,
    },
    styleId: null,
    style,
    version: 1,
  };
  const state = {
    revisionId: ids.revision,
    objects: { [opening.id]: opening },
    layers: {},
    operations: [],
    undoStackByActor: {},
    redoStackByActor: {},
  };
  const markup = renderToStaticMarkup(
    createElement(semanticTableComponents.DrawingSemanticSchedulesPanel, {
      evidence: null,
      evidenceError: {
        code: "measurement_derivation_failed",
        message: "서버 측정 증거를 계산하지 못했습니다.",
      },
      hasUnconfirmedChanges: false,
      lineage: null,
      state,
    }),
  );
  assert.match(markup, /서버 측정 증거를 계산하지 못했습니다/);
  assert.match(markup, /미확정/);
  assert.match(markup, /계산 불가/);
  assert.match(markup, /role="alert"/);
  assert.match(markup, /Room schedule/);
  assert.match(markup, /Finish schedule/);
});
