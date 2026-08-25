import assert from "node:assert/strict";
import test from "node:test";
import {
  applyDrawingStructureActions,
  DrawingStructureError,
  resolveDrawingStyle,
} from "../app/lukas/lib/drawing-structure.ts";
import {
  DrawingObjectSchema,
  DrawingPropertyValueSchema,
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

test("structure reduction is atomic, ordered, and keeps inverse versions monotonic", () => {
  const original = canvas({ id: "00000000-0000-4000-8000-000000000090", name: "Model", spaceKind: "model", sortOrder: 1, version: 4 });
  const current = state({ canvases: { [ids.canvas]: canvas(), [original.id]: original } });
  const update = { kind: "put_canvas", entity: { ...original, name: "Updated" }, baseVersion: 4 };
  const updated = applyDrawingStructureActions(current, [update]);
  const restored = applyDrawingStructureActions(updated.state, updated.inverse);
  assert.equal(restored.state.canvases[original.id].name, "Model");
  assert.equal(restored.state.canvases[original.id].version, 6);
  assert.deepEqual(current.canvases[original.id], original);
  assert.throws(() => applyDrawingStructureActions(current, [
    { kind: "put_canvas", entity: { ...canvas(), id: "00000000-0000-4000-8000-000000000091", pageId: "00000000-0000-4000-8000-000000000092" }, baseVersion: null },
  ]), DrawingStructureError);
  assert.equal(current.canvases["00000000-0000-4000-8000-000000000091"], undefined);
});

test("default canvases, cross-kind IDs, nested extras, and invalid calendar dates fail closed", () => {
  const current = state({ canvases: { [ids.canvas]: canvas() } });
  assert.throws(() => applyDrawingStructureActions(current, [
    { kind: "put_canvas", entity: canvas({ id: "00000000-0000-4000-8000-000000000093", name: "Replacement", sortOrder: 0 }), baseVersion: null },
    { kind: "delete_canvas", id: ids.canvas, baseVersion: 1 },
  ]), DrawingStructureError);
  assert.throws(() => applyDrawingStructureActions(current, [
    { kind: "put_style", entity: { id: ids.canvas, revisionId: ids.revision, name: "Collision", value: { stroke: "#111111", strokeWidth: 1, fill: null }, version: 1 }, baseVersion: null },
  ]), DrawingStructureError);
  assert.throws(() => DrawingStructureActionSchema.parse({ kind: "put_canvas", entity: { ...canvas(), background: { sourceFileId: ids.style, sourceSha256: "a".repeat(64), pdfPageNumber: 1, calibration: { normalizedStart: { x: 0, y: 0 }, normalizedEnd: { x: 1, y: 1 }, realLengthMillimeters: 1, millimetersPerNormalizedUnit: 1, extra: true } } }, baseVersion: null }));
  assert.equal(DrawingPropertyValueSchema.safeParse({ id: ids.instance, schemaId: ids.style, objectId: ids.object, blockInstanceId: null, value: "2026-02-30", version: 1 }).success, true);
  const dateState = state({
    canvases: { [ids.canvas]: canvas() },
    objects: { [ids.object]: object() },
    propertySchemas: {
      [ids.block]: { id: ids.block, revisionId: ids.revision, name: "Due date", valueType: "date", enumOptions: [], appliesTo: ["rectangle"], required: false, version: 1 },
    },
  });
  assert.throws(() => applyDrawingStructureActions(dateState, [{ kind: "put_property_value", entity: { id: ids.instance, schemaId: ids.block, objectId: ids.object, blockInstanceId: null, value: "2026-02-30", version: 1 }, baseVersion: null }]), DrawingStructureError);
});

test("block conversion primitives must exactly represent the deleted objects", () => {
  const current = state({
    canvases: { [ids.canvas]: canvas() },
    objects: { [ids.object]: object({ styleId: null, style: { stroke: "#111111", strokeWidth: 2, fill: null } }) },
  });
  assert.throws(() => applyDrawingStructureActions(current, [
    { kind: "delete_object", id: ids.object, baseVersion: 1 },
    { kind: "put_block", entity: { id: ids.block, revisionId: ids.revision, name: "Block", primitives: [{ localId: "p", name: "Wrong", geometry: { ...object().geometry, width: 99 }, styleId: null, style: { stroke: "#111111", strokeWidth: 2, fill: null } }], version: 1 }, baseVersion: null },
    { kind: "put_block_instance", entity: { id: ids.instance, blockId: ids.block, layerId: ids.layer, name: "Block", origin: { x: 0, y: 0 }, rotation: 0, scaleX: 1, scaleY: 1, version: 1 }, baseVersion: null },
  ]), DrawingStructureError);
});

test("block conversion rejects objects from a layer other than its instance layer", () => {
  const otherLayer = "00000000-0000-4000-8000-000000000097";
  const current = state({
    canvases: { [ids.canvas]: canvas() },
    layers: {
      [ids.layer]: state().layers[ids.layer],
      [otherLayer]: { ...state().layers[ids.layer], id: otherLayer, name: "Details" },
    },
    objects: { [ids.object]: object({ layerId: otherLayer, styleId: null, style: { stroke: "#111111", strokeWidth: 2, fill: null } }) },
  });
  assert.throws(() => applyDrawingStructureActions(current, [
    { kind: "delete_object", id: ids.object, baseVersion: 1 },
    { kind: "put_block", entity: { id: ids.block, revisionId: ids.revision, name: "Block", primitives: [{ localId: "p", name: "Rectangle", geometry: object().geometry, styleId: null, style: { stroke: "#111111", strokeWidth: 2, fill: null } }], version: 1 }, baseVersion: null },
    { kind: "put_block_instance", entity: { id: ids.instance, blockId: ids.block, layerId: ids.layer, name: "Block", origin: { x: 0, y: 0 }, rotation: 0, scaleX: 1, scaleY: 1, version: 1 }, baseVersion: null },
  ]), DrawingStructureError);
});

test("block conversion preserves the canonical transformed primitive through its inverse", () => {
  const source = object({
    styleId: null,
    style: { stroke: "#111111", strokeWidth: 2, fill: null },
    geometry: { type: "rectangle", origin: { x: 14, y: 26 }, width: 20, height: 10, rotation: 0 },
  });
  const current = state({
    canvases: { [ids.canvas]: canvas() },
    objects: { [ids.object]: source },
  });
  const actions = [
    { kind: "delete_object", id: ids.object, baseVersion: 1 },
    { kind: "put_block", entity: {
      id: ids.block, revisionId: ids.revision, name: "Block", version: 1,
      primitives: [{ localId: "p", name: source.name, geometry: { type: "rectangle", origin: { x: 2, y: 3 }, width: 10, height: 5, rotation: 0 }, styleId: null, style: source.style }],
    }, baseVersion: null },
    { kind: "put_block_instance", entity: {
      id: ids.instance, blockId: ids.block, layerId: ids.layer, name: "Block", origin: { x: 10, y: 20 }, rotation: 0, scaleX: 2, scaleY: 2, version: 1,
    }, baseVersion: null },
  ];
  const converted = applyDrawingStructureActions(current, actions);
  assert.deepEqual(converted.state.blocks[ids.block].primitives[0].geometry, {
    type: "rectangle", origin: { x: 2, y: 3 }, width: 10, height: 5, rotation: 0,
  });
  const restored = applyDrawingStructureActions(converted.state, converted.inverse);
  assert.deepEqual(
    { ...restored.state.objects[ids.object], version: source.version },
    source,
  );
  const malformedInverse = structuredClone(converted.inverse);
  malformedInverse.at(-1).entity.name = "Unrelated";
  assert.throws(
    () => applyDrawingStructureActions(converted.state, malformedInverse),
    DrawingStructureError,
  );
  const withoutCapturedObjects = structuredClone(converted.state);
  withoutCapturedObjects.tombstones = {};
  assert.throws(
    () => applyDrawingStructureActions(withoutCapturedObjects, converted.inverse),
    DrawingStructureError,
  );
});

test("fresh structure entities start at version one and pages may remove their default canvas before themselves", () => {
  const current = state({ canvases: { [ids.canvas]: canvas() }, layers: {} });
  assert.throws(() => applyDrawingStructureActions(current, [{ kind: "put_canvas", entity: canvas({ id: "00000000-0000-4000-8000-000000000095", name: "Model", spaceKind: "model", sortOrder: 1, version: 99 }), baseVersion: null }]), DrawingStructureError);
  assert.throws(() => applyDrawingStructureActions(current, [{ kind: "put_style", entity: { id: "00000000-0000-4000-8000-000000000096", revisionId: ids.revision, name: "Fresh", value: { stroke: "#111111", strokeWidth: 1, fill: null }, version: 2 }, baseVersion: null }]), DrawingStructureError);
  const deleted = applyDrawingStructureActions(current, [
    { kind: "delete_canvas", id: ids.canvas, baseVersion: 1 },
    { kind: "delete_page", id: ids.page, baseVersion: 1 },
  ]);
  assert.deepEqual(deleted.state.pages, {});
  const restored = applyDrawingStructureActions(deleted.state, deleted.inverse);
  assert.equal(restored.state.canvases[ids.canvas].version, 3);
  assert.equal(restored.state.pages[ids.page].name, "Page 1");
});
