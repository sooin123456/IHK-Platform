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
  const current = state();
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
    "새 Schedule 이름",
    "선택 대상을 Schedule로 추가",
    "Note",
    "Cost",
  ])
    assert.match(editor, new RegExp(label));
  assert.match(editor, /type="text"/);
  assert.match(editor, /type="number"/);
  assert.match(editor, /Schedule 저장/);
  assert.doesNotMatch(editor, /formula|수식|XLSX/i);
});
