import assert from "node:assert/strict";
import test from "node:test";
import {
  applyDrawingStructureActions,
  DrawingStructureError,
  resolveDrawingStyle,
} from "../app/lukas/lib/drawing-structure.ts";
import {
  DrawingObjectSchema,
  DrawingStructureActionSchema,
} from "../app/lukas/lib/drawing-workspace.types.ts";

const ids = {
  revision: "00000000-0000-4000-8000-000000000001",
  page: "00000000-0000-4000-8000-000000000002",
  canvas: "00000000-0000-4000-8000-000000000003",
  layer: "00000000-0000-4000-8000-000000000004",
  object: "00000000-0000-4000-8000-000000000005",
  style: "00000000-0000-4000-8000-000000000006",
  block: "00000000-0000-4000-8000-000000000007",
  instance: "00000000-0000-4000-8000-000000000008",
};

function canvas(overrides = {}) {
  return {
    id: ids.canvas,
    pageId: ids.page,
    name: "Paper",
    spaceKind: "paper",
    widthMillimeters: 210,
    heightMillimeters: 297,
    background: null,
    sortOrder: 0,
    version: 1,
    ...overrides,
  };
}

function object(overrides = {}) {
  return {
    id: ids.object,
    name: "Rectangle",
    layerId: ids.layer,
    geometry: {
      type: "rectangle",
      origin: { x: 0, y: 0 },
      width: 20,
      height: 10,
      rotation: 0,
    },
    styleId: ids.style,
    style: { fill: "#ffffff" },
    version: 1,
    ...overrides,
  };
}

function state(overrides = {}) {
  return {
    revisionId: ids.revision,
    pages: {
      [ids.page]: {
        id: ids.page,
        revisionId: ids.revision,
        name: "Page 1",
        sortOrder: 0,
        version: 1,
      },
    },
    canvases: {},
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
    objects: {},
    styles: {
      [ids.style]: {
        id: ids.style,
        revisionId: ids.revision,
        name: "Default",
        value: { stroke: "#111111", strokeWidth: 2, fill: null, fontSize: 12 },
        version: 1,
      },
    },
    blocks: {},
    blockInstances: {},
    propertySchemas: {},
    propertyValues: {},
    tables: {},
    ...overrides,
  };
}

test("structure actions reject unknown fields and restore exact prior entities", () => {
  const action = { kind: "put_canvas", entity: canvas(), baseVersion: null };
  const applied = applyDrawingStructureActions(state(), [action]);

  assert.deepEqual(applied.inverse, [
    { kind: "delete_canvas", id: ids.canvas, baseVersion: 1 },
  ]);
  assert.throws(() =>
    DrawingStructureActionSchema.parse({ ...action, authority: "admin" }),
  );

});

test("resolved style merges a referenced definition with finite validated overrides", () => {
  assert.deepEqual(resolveDrawingStyle(object(), Object.values(state().styles)), {
    stroke: "#111111",
    strokeWidth: 2,
    fill: "#ffffff",
    fontSize: 12,
  });
  assert.throws(() =>
    resolveDrawingStyle(
      object({ style: { strokeWidth: Number.POSITIVE_INFINITY } }),
      Object.values(state().styles),
    ),
  );
});

test("structure object actions require the matching block conversion batch", () => {
  const existingCanvas = canvas();
  const current = state({ canvases: { [existingCanvas.id]: existingCanvas } });
  const putObject = { kind: "put_object", entity: object({ styleId: null, style: { stroke: "#111111", strokeWidth: 2, fill: null } }), baseVersion: null };

  assert.throws(
    () => applyDrawingStructureActions(current, [putObject]),
    DrawingStructureError,
  );

  const block = {
    id: ids.block,
    revisionId: ids.revision,
    name: "Block",
    primitives: [{
      localId: "primitive-1",
      name: "Rectangle",
      geometry: object().geometry,
      styleId: null,
      style: { stroke: "#111111", strokeWidth: 2, fill: null },
    }],
    version: 1,
  };
  const instance = {
    id: ids.instance,
    blockId: ids.block,
    layerId: ids.layer,
    name: "Block 1",
    origin: { x: 0, y: 0 },
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
    version: 1,
  };

  const applied = applyDrawingStructureActions(
    { ...current, objects: { [ids.object]: putObject.entity } },
    [
    { kind: "delete_object", id: ids.object, baseVersion: 1 },
    { kind: "put_block", entity: block, baseVersion: null },
    { kind: "put_block_instance", entity: instance, baseVersion: null },
    ],
  );
  assert.equal(applied.state.blockInstances[ids.instance].blockId, ids.block);
});

test("block conversion batches pair a new instance with their new definition", () => {
  const existingCanvas = canvas();
  const current = state({
    canvases: { [existingCanvas.id]: existingCanvas },
    objects: { [ids.object]: object({ styleId: null, style: { stroke: "#111111", strokeWidth: 2, fill: null } }) },
    blocks: {
      [ids.style]: {
        id: ids.style,
        revisionId: ids.revision,
        name: "Existing block",
        primitives: [{
          localId: "existing-primitive",
          name: "Rectangle",
          geometry: object().geometry,
          styleId: null,
          style: { stroke: "#111111", strokeWidth: 2, fill: null },
        }],
        version: 1,
      },
    },
  });
  const unrelatedBlock = {
    id: ids.block,
    revisionId: ids.revision,
    name: "Unrelated block",
    primitives: [{
      localId: "unrelated-primitive",
      name: "Rectangle",
      geometry: object().geometry,
      styleId: null,
      style: { stroke: "#111111", strokeWidth: 2, fill: null },
    }],
    version: 1,
  };

  assert.throws(
    () =>
      applyDrawingStructureActions(current, [
        { kind: "delete_object", id: ids.object, baseVersion: 1 },
        { kind: "put_block", entity: unrelatedBlock, baseVersion: null },
        {
          kind: "put_block_instance",
          entity: {
            id: ids.instance,
            blockId: ids.style,
            layerId: ids.layer,
            name: "Existing block instance",
            origin: { x: 0, y: 0 },
            rotation: 0,
            scaleX: 1,
            scaleY: 1,
            version: 1,
          },
          baseVersion: null,
        },
      ]),
    DrawingStructureError,
  );
});

test("objects without a style reference retain complete inline styles", () => {
  const legacy = object({ styleId: null, style: { stroke: "#112233", strokeWidth: 2, fill: null } });
  assert.equal(DrawingObjectSchema.safeParse(legacy).success, true);
  assert.deepEqual(resolveDrawingStyle(legacy, []), legacy.style);
});
