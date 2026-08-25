import assert from "node:assert/strict";
import test from "node:test";

import { createDrawingDocumentState } from "../app/lukas/lib/drawing-commands.ts";
import {
  createDrawingDocumentStore,
  hydrateDrawingDocumentState,
} from "../app/lukas/lib/drawing-document-store.client.ts";

const ids = {
  revision: "00000000-0000-4000-8000-000000000101",
  page: "00000000-0000-4000-8000-000000000102",
  paper: "00000000-0000-4000-8000-000000000103",
  model: "00000000-0000-4000-8000-000000000104",
  work: "00000000-0000-4000-8000-000000000105",
  modelWork: "00000000-0000-4000-8000-000000000106",
  object: "00000000-0000-4000-8000-000000000107",
  style: "00000000-0000-4000-8000-000000000108",
  block: "00000000-0000-4000-8000-000000000109",
  schema: "00000000-0000-4000-8000-000000000110",
  table: "00000000-0000-4000-8000-000000000111",
  actor: "00000000-0000-4000-8000-000000000112",
  operation: "00000000-0000-4000-8000-000000000113",
};

function structure() {
  return {
    pages: {
      [ids.page]: { id: ids.page, revisionId: ids.revision, name: "A1", sortOrder: 0, version: 1 },
    },
    canvases: {
      [ids.paper]: { id: ids.paper, pageId: ids.page, name: "Paper", spaceKind: "paper", widthMillimeters: 210, heightMillimeters: 297, background: null, sortOrder: 0, version: 1 },
      [ids.model]: { id: ids.model, pageId: ids.page, name: "Model", spaceKind: "model", widthMillimeters: 210, heightMillimeters: 297, background: null, sortOrder: 1, version: 1 },
    },
    layers: {
      [ids.work]: { id: ids.work, name: "Work", visible: true, locked: false, systemKind: "work", canvasId: ids.paper, sortOrder: 0, version: 1 },
      [ids.modelWork]: { id: ids.modelWork, name: "Model work", visible: true, locked: false, systemKind: "custom", canvasId: ids.model, sortOrder: 0, version: 1 },
    },
    objects: {
      [ids.object]: { id: ids.object, name: "Rectangle", layerId: ids.work, geometry: { type: "rectangle", origin: { x: 0, y: 0 }, width: 10, height: 20, rotation: 0 }, style: { stroke: "#112233", strokeWidth: 2, fill: null }, version: 1 },
    },
    styles: {
      [ids.style]: { id: ids.style, revisionId: ids.revision, name: "Default", value: { stroke: "#112233", strokeWidth: 2, fill: null }, version: 1 },
    },
    blocks: {
      [ids.block]: { id: ids.block, revisionId: ids.revision, name: "Symbol", primitives: [{ localId: "rect", name: "Rectangle", geometry: { type: "rectangle", origin: { x: 0, y: 0 }, width: 10, height: 20, rotation: 0 }, styleId: null, style: { stroke: "#112233", strokeWidth: 2, fill: null } }], version: 1 },
    },
    blockInstances: {},
    propertySchemas: {
      [ids.schema]: { id: ids.schema, revisionId: ids.revision, name: "Code", valueType: "text", enumOptions: [], appliesTo: ["rectangle"], required: false, version: 1 },
    },
    propertyValues: {},
    tables: {
      [ids.table]: { id: ids.table, revisionId: ids.revision, name: "Schedule", columns: [{ id: "00000000-0000-4000-8000-000000000114", name: "Note", kind: "text", propertySchemaId: null }], rows: [], version: 1 },
    },
  };
}

test("hydrates every P2 collection into one canonical document state", () => {
  const state = hydrateDrawingDocumentState({
    revisionId: ids.revision,
    ...Object.fromEntries(Object.entries(structure()).map(([key, value]) => [key, Object.values(value)])),
  });

  assert.equal(state.structure.pages[ids.page].name, "A1");
  assert.equal(state.structure.canvases[ids.model].spaceKind, "model");
  assert.equal(state.objects[ids.object].layerId, ids.work);
  assert.equal(state.structure.styles[ids.style].name, "Default");
  assert.equal(state.structure.blocks[ids.block].name, "Symbol");
  assert.equal(state.structure.propertySchemas[ids.schema].name, "Code");
  assert.equal(state.structure.tables[ids.table].name, "Schedule");
});

test("store preserves canonical P2 state and falls back to the page default after active canvas deletion", () => {
  const initial = createDrawingDocumentState({ revisionId: ids.revision, structure: structure() });
  const store = createDrawingDocumentStore(initial, {
    activePageId: ids.page,
    activeCanvasId: ids.model,
    createId: () => ids.operation,
    now: () => "2026-08-25T00:00:00.000Z",
  });
  let notifications = 0;
  const unsubscribe = store.subscribe(() => { notifications += 1; });

  store.dispatch({
    type: "mutate_structure",
    actorId: ids.actor,
    actions: [
      { kind: "delete_layer", id: ids.modelWork, baseVersion: 1 },
      { kind: "delete_canvas", id: ids.model, baseVersion: 1 },
    ],
  });

  const snapshot = store.getSnapshot();
  assert.equal(snapshot.activePageId, ids.page);
  assert.equal(snapshot.activeCanvasId, ids.paper);
  assert.equal(snapshot.structure.canvases[ids.model], undefined);
  assert.equal(snapshot.structure.styles[ids.style].name, "Default");
  assert.equal(notifications, 1);
  assert.strictEqual(store.getSnapshot(), snapshot);
  store.selectCanvas(ids.paper);
  assert.strictEqual(store.getSnapshot(), snapshot);
  assert.equal(notifications, 1);
  unsubscribe();
  store.selectCanvas(ids.paper);
  assert.equal(notifications, 1);
});

test("store leaves the prior snapshot intact when a structure batch conflicts", () => {
  const initial = createDrawingDocumentState({ revisionId: ids.revision, structure: structure() });
  const store = createDrawingDocumentStore(initial);
  const before = store.getSnapshot();

  assert.throws(() => store.dispatch({
    type: "mutate_structure",
    actorId: ids.actor,
    actions: [
      { kind: "delete_layer", id: ids.modelWork, baseVersion: 1 },
      { kind: "delete_canvas", id: ids.model, baseVersion: 2 },
    ],
  }));

  assert.strictEqual(store.getSnapshot(), before);
  assert.ok(store.getSnapshot().structure.canvases[ids.model]);
});

test("hydration fails closed on a malformed P2 row", () => {
  const input = structure();
  input.canvases[ids.paper] = { ...input.canvases[ids.paper], widthMillimeters: 0 };

  assert.throws(() => hydrateDrawingDocumentState({
    revisionId: ids.revision,
    ...Object.fromEntries(Object.entries(input).map(([key, value]) => [key, Object.values(value)])),
  }));
});
