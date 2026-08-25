import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";

import {
  applyDrawingCommand,
  createDrawingDocumentState,
  redoDrawingCommand,
  undoDrawingCommand,
} from "../app/lukas/lib/drawing-commands.ts";
import { deleteDrawingBlockInstanceCommand } from "../app/lukas/lib/drawing-blocks.ts";

const ids = Object.fromEntries(
  [
    "revision",
    "page",
    "canvas",
    "layer",
    "objectA",
    "objectB",
    "circle",
    "text",
    "number",
    "boolean",
    "date",
    "enum",
    "value",
    "newValue",
    "table",
    "column",
    "row",
    "actor",
    "operation",
    "block",
    "instance",
  ].map((name, index) => [
    name,
    `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
  ]),
);

const style = { stroke: "#112233", strokeWidth: 1, fill: null };

function rectangle(id, name) {
  return {
    id,
    name,
    layerId: ids.layer,
    geometry: {
      type: "rectangle",
      origin: { x: 0, y: 0 },
      width: 10,
      height: 20,
      rotation: 0,
    },
    styleId: null,
    style,
    version: 1,
  };
}

function propertySchema(id, name, valueType, overrides = {}) {
  return {
    id,
    revisionId: ids.revision,
    name,
    valueType,
    enumOptions: valueType === "enum" ? ["30 min", "60 min"] : [],
    appliesTo: ["rectangle"],
    required: false,
    version: 1,
    ...overrides,
  };
}

function structure(overrides = {}) {
  const schemas = {
    [ids.text]: propertySchema(ids.text, "Mark", "text"),
    [ids.number]: propertySchema(ids.number, "Width", "number"),
    [ids.boolean]: propertySchema(ids.boolean, "Exterior", "boolean"),
    [ids.date]: propertySchema(ids.date, "Install date", "date"),
    [ids.enum]: propertySchema(ids.enum, "Fire rating", "enum"),
  };
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
      [ids.objectA]: rectangle(ids.objectA, "Door 01"),
      [ids.objectB]: rectangle(ids.objectB, "Door 02"),
      [ids.circle]: {
        ...rectangle(ids.circle, "Round"),
        geometry: { type: "circle", center: { x: 5, y: 5 }, radius: 5 },
      },
    },
    styles: {},
    blocks: {},
    blockInstances: {},
    propertySchemas: schemas,
    propertyValues: {},
    tables: {},
    ...overrides,
  };
}

function state(overrides = {}) {
  return createDrawingDocumentState({
    revisionId: ids.revision,
    structure: structure(overrides),
  });
}

const properties = await import("../app/lukas/lib/drawing-properties.ts").catch(
  () => ({}),
);

test("native property input parsing preserves all five canonical value types", () => {
  assert.equal(typeof properties.parseDrawingPropertyInput, "function");
  const schemas = structure().propertySchemas;
  assert.equal(
    properties.parseDrawingPropertyInput(schemas[ids.text], "Door A"),
    "Door A",
  );
  assert.equal(
    properties.parseDrawingPropertyInput(schemas[ids.number], "900"),
    900,
  );
  assert.equal(
    properties.parseDrawingPropertyInput(schemas[ids.boolean], false),
    false,
  );
  assert.equal(
    properties.parseDrawingPropertyInput(schemas[ids.date], "2026-08-25"),
    "2026-08-25",
  );
  assert.equal(
    properties.parseDrawingPropertyInput(schemas[ids.enum], "60 min"),
    "60 min",
  );
  assert.throws(() =>
    properties.parseDrawingPropertyInput(schemas[ids.number], "Infinity"),
  );
  assert.throws(() =>
    properties.parseDrawingPropertyInput(schemas[ids.date], "2026-02-30"),
  );
  assert.throws(() =>
    properties.parseDrawingPropertyInput(schemas[ids.enum], "90 min"),
  );
});

test("property commands enforce exactly one applicable target", () => {
  assert.equal(
    typeof properties.setDrawingPropertySelectionValuesCommand,
    "function",
  );
  const current = state();
  assert.throws(() =>
    properties.setDrawingPropertySelectionValuesCommand(
      current,
      ids.actor,
      [ids.objectA, ids.objectA],
      { [ids.text]: "duplicate" },
    ),
  );
  assert.throws(() =>
    properties.setDrawingPropertySelectionValuesCommand(
      current,
      ids.actor,
      [ids.circle],
      { [ids.text]: "wrong geometry" },
    ),
  );
});

test("required-property review failures are stable and null is incomplete", () => {
  assert.equal(typeof properties.missingRequiredDrawingProperties, "function");
  const required = propertySchema(ids.text, "Mark", "text", { required: true });
  const current = state({
    propertySchemas: { [ids.text]: required },
    propertyValues: {
      [ids.value]: {
        id: ids.value,
        schemaId: ids.text,
        objectId: ids.objectA,
        blockInstanceId: null,
        value: null,
        version: 1,
      },
    },
  });
  assert.deepEqual(properties.missingRequiredDrawingProperties(current), [
    { schemaId: ids.text, schemaName: "Mark", targetId: ids.objectA },
    { schemaId: ids.text, schemaName: "Mark", targetId: ids.objectB },
  ]);
  const complete = state({
    propertySchemas: {
      [ids.boolean]: propertySchema(ids.boolean, "Exterior", "boolean", {
        required: true,
      }),
    },
    propertyValues: {
      [ids.value]: {
        id: ids.value,
        schemaId: ids.boolean,
        objectId: ids.objectA,
        blockInstanceId: null,
        value: false,
        version: 1,
      },
      [ids.newValue]: {
        id: ids.newValue,
        schemaId: ids.boolean,
        objectId: ids.objectB,
        blockInstanceId: null,
        value: true,
        version: 1,
      },
    },
  });
  assert.deepEqual(properties.missingRequiredDrawingProperties(complete), []);
});

test("schema evolution fails before it can invalidate an existing value", () => {
  assert.equal(
    typeof properties.updateDrawingPropertySchemaCommand,
    "function",
  );
  const current = state({
    propertyValues: {
      [ids.value]: {
        id: ids.value,
        schemaId: ids.number,
        objectId: ids.objectA,
        blockInstanceId: null,
        value: 900,
        version: 1,
      },
    },
  });
  assert.throws(() =>
    properties.updateDrawingPropertySchemaCommand(
      current,
      ids.actor,
      ids.number,
      { valueType: "boolean" },
    ),
  );
});

test("target-reference cleanup removes values and schedule rows in one version-aware batch", () => {
  assert.equal(
    typeof properties.cleanupDrawingTargetReferencesCommand,
    "function",
  );
  const table = {
    id: ids.table,
    revisionId: ids.revision,
    name: "Door schedule",
    columns: [
      { id: ids.column, name: "Note", kind: "text", propertySchemaId: null },
    ],
    rows: [
      { id: ids.row, objectId: ids.objectA, blockInstanceId: null, cells: {} },
    ],
    version: 2,
  };
  const current = state({
    propertyValues: {
      [ids.value]: {
        id: ids.value,
        schemaId: ids.text,
        objectId: ids.objectA,
        blockInstanceId: null,
        value: "D-01",
        version: 3,
      },
    },
    tables: { [ids.table]: table },
  });
  const command = properties.cleanupDrawingTargetReferencesCommand(
    current,
    ids.actor,
    [ids.objectA],
  );
  assert.deepEqual(command.actions, [
    { kind: "delete_property_value", id: ids.value, baseVersion: 3 },
    {
      kind: "put_table",
      entity: { ...table, rows: [] },
      baseVersion: 2,
    },
  ]);
  const applied = applyDrawingCommand(current, command, {
    createId: () => ids.operation,
    now: () => "2026-08-25T00:00:00.000Z",
  });
  assert.deepEqual(applied.state.structure.propertyValues, {});
  assert.deepEqual(applied.state.structure.tables[ids.table].rows, []);
  assert.deepEqual(applied.operation.inverse, {
    type: "mutate_structure",
    actions: [
      { kind: "put_table", entity: table, baseVersion: 3 },
      {
        kind: "put_property_value",
        entity: current.structure.propertyValues[ids.value],
        baseVersion: null,
      },
    ],
  });
});

test("ordinary object deletion is one atomic reference-aware operation with one-step undo and redo", () => {
  assert.equal(
    typeof properties.deleteDrawingObjectsWithReferencesCommand,
    "function",
  );
  const table = {
    id: ids.table,
    revisionId: ids.revision,
    name: "Door schedule",
    columns: [
      { id: ids.column, name: "Note", kind: "text", propertySchemaId: null },
    ],
    rows: [
      { id: ids.row, objectId: ids.objectA, blockInstanceId: null, cells: {} },
    ],
    version: 2,
  };
  const current = state({
    propertyValues: {
      [ids.value]: {
        id: ids.value,
        schemaId: ids.text,
        objectId: ids.objectA,
        blockInstanceId: null,
        value: "D-01",
        version: 3,
      },
    },
    tables: { [ids.table]: table },
  });
  const command = properties.deleteDrawingObjectsWithReferencesCommand(
    current,
    ids.actor,
    [ids.objectA],
  );
  assert.deepEqual(command, {
    type: "mutate_objects_with_references",
    actorId: ids.actor,
    objectAction: "delete",
    objects: [current.objects[ids.objectA]],
    actions: [
      { kind: "delete_property_value", id: ids.value, baseVersion: 3 },
      {
        kind: "put_table",
        entity: { ...table, rows: [] },
        baseVersion: 2,
      },
    ],
  });
  const deleted = applyDrawingCommand(current, command, {
    createId: () => ids.operation,
    now: () => "2026-08-25T00:00:00.000Z",
  });
  assert.equal(deleted.state.operations.length, 1);
  assert.equal(deleted.state.objects[ids.objectA], undefined);
  assert.deepEqual(deleted.state.structure.propertyValues, {});
  assert.deepEqual(deleted.state.structure.tables[ids.table].rows, []);
  assert.deepEqual(deleted.operation.baseVersions, {
    [ids.objectA]: 1,
    [ids.value]: 3,
    [ids.table]: 2,
  });

  const restored = undoDrawingCommand(deleted.state, ids.actor, {
    createId: () => randomUUID(),
    now: () => "2026-08-25T00:00:01.000Z",
  });
  assert.ok(restored && !("kind" in restored));
  assert.equal(restored.state.operations.length, 2);
  assert.equal(restored.state.objects[ids.objectA].version, 3);
  assert.equal(
    restored.state.structure.propertyValues[ids.value].objectId,
    ids.objectA,
  );
  assert.equal(
    restored.state.structure.tables[ids.table].rows[0].objectId,
    ids.objectA,
  );

  const deletedAgain = redoDrawingCommand(restored.state, ids.actor, {
    createId: () => randomUUID(),
    now: () => "2026-08-25T00:00:02.000Z",
  });
  assert.ok(deletedAgain && !("kind" in deletedAgain));
  assert.equal(deletedAgain.state.operations.length, 3);
  assert.equal(deletedAgain.state.objects[ids.objectA], undefined);
  assert.deepEqual(deletedAgain.state.structure.propertyValues, {});
  assert.deepEqual(deletedAgain.state.structure.tables[ids.table].rows, []);
});

test("block-instance deletion cascades property and schedule references atomically", () => {
  const block = {
    id: ids.block,
    revisionId: ids.revision,
    name: "Door symbol",
    primitives: [
      {
        localId: "door",
        name: "Door",
        geometry: rectangle(ids.objectA, "Door").geometry,
        styleId: null,
        style,
      },
    ],
    version: 1,
  };
  const instance = {
    id: ids.instance,
    lineageId: ids.instance,
    blockId: ids.block,
    layerId: ids.layer,
    name: "Door instance",
    origin: { x: 0, y: 0 },
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
    version: 2,
  };
  const schema = propertySchema(ids.text, "Mark", "text", {
    appliesTo: ["block_instance"],
  });
  const value = {
    id: ids.value,
    schemaId: ids.text,
    objectId: null,
    blockInstanceId: ids.instance,
    value: "D-01",
    version: 3,
  };
  const table = {
    id: ids.table,
    revisionId: ids.revision,
    name: "Instance schedule",
    columns: [
      {
        id: ids.column,
        name: "Name",
        kind: "object_name",
        propertySchemaId: null,
      },
    ],
    rows: [
      { id: ids.row, objectId: null, blockInstanceId: ids.instance, cells: {} },
    ],
    version: 4,
  };
  const current = state({
    blocks: { [ids.block]: block },
    blockInstances: { [ids.instance]: instance },
    propertySchemas: { [ids.text]: schema },
    propertyValues: { [ids.value]: value },
    tables: { [ids.table]: table },
  });
  const command = deleteDrawingBlockInstanceCommand(
    current,
    ids.actor,
    ids.instance,
  );
  assert.deepEqual(command.actions, [
    { kind: "delete_property_value", id: ids.value, baseVersion: 3 },
    {
      kind: "put_table",
      entity: { ...table, rows: [] },
      baseVersion: 4,
    },
    { kind: "delete_block_instance", id: ids.instance, baseVersion: 2 },
  ]);
  const applied = applyDrawingCommand(current, command, {
    createId: () => ids.operation,
    now: () => "2026-08-25T00:00:00.000Z",
  });
  assert.equal(applied.state.structure.blockInstances[ids.instance], undefined);
  assert.deepEqual(applied.state.structure.propertyValues, {});
  assert.deepEqual(applied.state.structure.tables[ids.table].rows, []);
});

test("multi-selection property edits are one atomic batch with exact bases and inverse", () => {
  assert.equal(
    typeof properties.setDrawingPropertySelectionValuesCommand,
    "function",
  );
  const current = state({
    propertyValues: {
      [ids.value]: {
        id: ids.value,
        schemaId: ids.text,
        objectId: ids.objectA,
        blockInstanceId: null,
        value: "old",
        version: 3,
      },
    },
  });
  const command = properties.setDrawingPropertySelectionValuesCommand(
    current,
    ids.actor,
    [ids.objectB, ids.objectA],
    { [ids.text]: "new" },
    () => ids.newValue,
  );
  assert.equal(command.type, "mutate_structure");
  assert.deepEqual(command.actions, [
    {
      kind: "put_property_value",
      entity: { ...current.structure.propertyValues[ids.value], value: "new" },
      baseVersion: 3,
    },
    {
      kind: "put_property_value",
      entity: {
        id: ids.newValue,
        schemaId: ids.text,
        objectId: ids.objectB,
        blockInstanceId: null,
        value: "new",
        version: 1,
      },
      baseVersion: null,
    },
  ]);
  const applied = applyDrawingCommand(current, command, {
    createId: () => ids.operation,
    now: () => "2026-08-25T00:00:00.000Z",
  });
  assert.deepEqual(applied.operation.inverse, {
    type: "mutate_structure",
    actions: [
      { kind: "delete_property_value", id: ids.newValue, baseVersion: 1 },
      {
        kind: "put_property_value",
        entity: current.structure.propertyValues[ids.value],
        baseVersion: 4,
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
const propertyComponents = await vite
  .ssrLoadModule("/app/lukas/components/drawing-properties-panel.tsx")
  .catch(() => ({}));

test("property field selection identity synchronously discards prior dirty edits", () => {
  assert.equal(
    typeof propertyComponents.synchronizeDrawingPropertyDirtySelection,
    "function",
  );
  const dirty = new Set([ids.text]);
  const identity = { current: ids.objectA };
  assert.equal(
    propertyComponents.synchronizeDrawingPropertyDirtySelection(
      dirty,
      identity,
      [ids.objectB, ids.objectA],
    ),
    `${ids.objectB}|${ids.objectA}`,
  );
  assert.deepEqual([...dirty], []);
  assert.equal(identity.current, `${ids.objectB}|${ids.objectA}`);
  dirty.add(ids.text);
  propertyComponents.synchronizeDrawingPropertyDirtySelection(
    dirty,
    identity,
    [ids.objectA, ids.objectB],
  );
  assert.deepEqual([...dirty], []);
});

test("viewer property markup stays readable while every mutation control is absent", () => {
  assert.equal(typeof propertyComponents.DrawingPropertiesPanel, "function");
  assert.equal(typeof propertyComponents.DrawingPropertyFields, "function");
  const current = state({
    propertyValues: {
      [ids.value]: {
        id: ids.value,
        schemaId: ids.text,
        objectId: ids.objectA,
        blockInstanceId: null,
        value: "D-01",
        version: 1,
      },
    },
  });
  const panel = renderToStaticMarkup(
    createElement(propertyComponents.DrawingPropertiesPanel, {
      actorId: ids.actor,
      canEdit: false,
      onCommand() {},
      state: current,
    }),
  );
  const fields = renderToStaticMarkup(
    createElement(propertyComponents.DrawingPropertyFields, {
      actorId: ids.actor,
      canEdit: false,
      onCommand() {},
      selectedIds: [ids.objectA],
      state: current,
    }),
  );
  assert.match(panel, /사용자 속성/);
  assert.match(panel, /Mark/);
  assert.match(fields, /D-01/);
  assert.doesNotMatch(panel + fields, /<form|<input|<select|<button/);

  const editor = renderToStaticMarkup(
    createElement(propertyComponents.DrawingPropertiesPanel, {
      actorId: ids.actor,
      canEdit: true,
      onCommand() {},
      state: current,
    }),
  );
  for (const label of [
    "새 속성 이름",
    "값 형식",
    "적용 대상",
    "필수 속성",
    "속성 추가",
  ])
    assert.match(editor, new RegExp(label));
  assert.match(editor, /type="checkbox"/);
  assert.match(editor, /<select/);
});
