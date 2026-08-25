import assert from "node:assert/strict";
import test from "node:test";

import {
  blockInstanceBounds,
  blockInstanceRenderModel,
  drawingBlockSelectionCandidates,
  copyDrawingBlockInstanceCommand,
  createBlockFromSelection,
  deleteDrawingBlockCommand,
  deleteDrawingBlockInstanceCommand,
  insertDrawingBlockInstanceCommand,
  transformBlockPoint,
  updateDrawingBlockCommand,
  updateDrawingBlockInstanceCommand,
  worldObjectsToBlockPrimitives,
} from "../app/lukas/lib/drawing-blocks.ts";
import {
  applyDrawingCommand,
  createDrawingDocumentState,
  redoDrawingCommand,
  undoDrawingCommand,
} from "../app/lukas/lib/drawing-commands.ts";
import { deriveDrawingTransientState } from "../app/lukas/lib/drawing-document-store.client.ts";

const ids = {
  revision: "00000000-0000-4000-8000-000000000701",
  page: "00000000-0000-4000-8000-000000000702",
  canvas: "00000000-0000-4000-8000-000000000703",
  layer: "00000000-0000-4000-8000-000000000704",
  otherLayer: "00000000-0000-4000-8000-000000000705",
  objectA: "00000000-0000-4000-8000-000000000706",
  objectB: "00000000-0000-4000-8000-000000000707",
  style: "00000000-0000-4000-8000-000000000708",
  block: "00000000-0000-4000-8000-000000000709",
  instance: "00000000-0000-4000-8000-000000000710",
  copy: "00000000-0000-4000-8000-000000000711",
  actor: "00000000-0000-4000-8000-000000000712",
  operation: "00000000-0000-4000-8000-000000000713",
};

const inlineStyle = { stroke: "#112233", strokeWidth: 2, fill: null };

function object(id, layerId = ids.layer) {
  return {
    id,
    name: id === ids.objectA ? "Outline" : "Cable",
    layerId,
    geometry:
      id === ids.objectA
        ? {
            type: "rectangle",
            origin: { x: 10, y: 20 },
            width: 20,
            height: 10,
            rotation: 0,
          }
        : { type: "line", start: { x: 30, y: 25 }, end: { x: 40, y: 35 } },
    styleId: id === ids.objectA ? ids.style : null,
    style: id === ids.objectA ? { fill: "#abcdef" } : inlineStyle,
    version: 1,
  };
}

function structure(overrides = {}) {
  const base = {
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
      [ids.otherLayer]: {
        id: ids.otherLayer,
        name: "Other",
        visible: true,
        locked: false,
        systemKind: "custom",
        canvasId: ids.canvas,
        sortOrder: 1,
        version: 1,
      },
    },
    objects: {
      [ids.objectA]: object(ids.objectA),
      [ids.objectB]: object(ids.objectB),
    },
    styles: {
      [ids.style]: {
        id: ids.style,
        revisionId: ids.revision,
        name: "Preset",
        value: { stroke: "#445566", strokeWidth: 3, fill: null },
        version: 1,
      },
    },
    blocks: {},
    blockInstances: {},
    propertySchemas: {},
    propertyValues: {},
    tables: {},
  };
  return { ...base, ...overrides };
}

function state(overrides = {}) {
  return createDrawingDocumentState({
    revisionId: ids.revision,
    structure: structure(overrides),
  });
}

test("world objects become canonically ordered primitives relative to the deterministic selection origin", () => {
  const converted = worldObjectsToBlockPrimitives(
    [object(ids.objectB), object(ids.objectA)],
    (source) => `local-${source.id.at(-1)}`,
  );
  assert.deepEqual(converted.origin, { x: 10, y: 20 });
  assert.deepEqual(
    converted.primitives.map((primitive) => primitive.name),
    ["Outline", "Cable"],
  );
  assert.deepEqual(converted.primitives[0], {
    localId: "local-6",
    name: "Outline",
    geometry: {
      type: "rectangle",
      origin: { x: 0, y: 0 },
      width: 20,
      height: 10,
      rotation: 0,
    },
    styleId: ids.style,
    style: { fill: "#abcdef" },
  });
  assert.deepEqual(converted.primitives[1].geometry, {
    type: "line",
    start: { x: 20, y: 5 },
    end: { x: 30, y: 15 },
  });
});

test("block transforms and bounds enclose every geometry at 30 degrees with signed nonzero scales", () => {
  const block = {
    id: ids.block,
    revisionId: ids.revision,
    name: "All shapes",
    version: 1,
    primitives: [
      {
        localId: "line",
        name: "Line",
        geometry: { type: "line", start: { x: 0, y: 0 }, end: { x: 10, y: 0 } },
        styleId: null,
        style: inlineStyle,
      },
      {
        localId: "poly",
        name: "Poly",
        geometry: {
          type: "polyline",
          points: [
            { x: 0, y: 0 },
            { x: 0, y: 10 },
            { x: 4, y: 6 },
          ],
          closed: false,
        },
        styleId: null,
        style: inlineStyle,
      },
      {
        localId: "rect",
        name: "Rect",
        geometry: {
          type: "rectangle",
          origin: { x: 2, y: 3 },
          width: 8,
          height: 4,
          rotation: 20,
        },
        styleId: null,
        style: inlineStyle,
      },
      {
        localId: "circle",
        name: "Circle",
        geometry: { type: "circle", center: { x: 12, y: 5 }, radius: 3 },
        styleId: null,
        style: inlineStyle,
      },
      {
        localId: "text",
        name: "Text",
        geometry: {
          type: "text",
          origin: { x: -4, y: -2 },
          width: 12,
          text: "Panel",
        },
        styleId: null,
        style: { ...inlineStyle, fontSize: 6 },
      },
      {
        localId: "dim",
        name: "Dimension",
        geometry: {
          type: "dimension",
          start: { x: 0, y: 12 },
          end: { x: 10, y: 12 },
          offset: 4,
          calibrationId: null,
        },
        styleId: null,
        style: inlineStyle,
      },
    ],
  };
  const instance = {
    id: ids.instance,
    blockId: ids.block,
    layerId: ids.layer,
    name: "Placed",
    origin: { x: 100, y: 50 },
    rotation: 30,
    scaleX: -2,
    scaleY: 3,
    version: 1,
  };
  assert.deepEqual(transformBlockPoint({ x: 2, y: 1 }, instance), {
    x: 100 - 4 * Math.cos(Math.PI / 6) - 3 * Math.sin(Math.PI / 6),
    y: 50 - 4 * Math.sin(Math.PI / 6) + 3 * Math.cos(Math.PI / 6),
  });
  const bounds = blockInstanceBounds(block, instance, {});
  assert.ok(Number.isFinite(bounds.x) && Number.isFinite(bounds.y));
  for (const primitive of block.primitives) {
    const single = blockInstanceBounds(
      { ...block, primitives: [primitive] },
      instance,
      {},
    );
    assert.ok(single.x >= bounds.x - 1e-9);
    assert.ok(single.y >= bounds.y - 1e-9);
    assert.ok(single.x + single.width <= bounds.x + bounds.width + 1e-9);
    assert.ok(single.y + single.height <= bounds.y + bounds.height + 1e-9);
  }
  assert.throws(
    () => blockInstanceBounds(block, { ...instance, scaleX: 0 }, {}),
    /scale/i,
  );
  assert.throws(
    () => blockInstanceBounds(block, { ...instance, rotation: Infinity }, {}),
    /finite/i,
  );
});

test("multiline text bounds use the renderer line-height contract after rotation and nonuniform scale", () => {
  const block = {
    id: ids.block,
    revisionId: ids.revision,
    name: "Multiline",
    version: 1,
    primitives: [
      {
        localId: "text",
        name: "Text",
        geometry: {
          type: "text",
          origin: { x: -4, y: -2 },
          width: 12,
          text: "Panel\nA",
        },
        styleId: null,
        style: { ...inlineStyle, fontSize: 6 },
      },
    ],
  };
  const bounds = blockInstanceBounds(
    block,
    {
      id: ids.instance,
      blockId: ids.block,
      layerId: ids.layer,
      name: "Placed",
      origin: { x: 100, y: 50 },
      rotation: 30,
      scaleX: -2,
      scaleY: 3,
      version: 1,
    },
    {},
  );
  assert.ok(Math.abs(bounds.x - 67.54359353944897) < 1e-9);
  assert.ok(Math.abs(bounds.y - 36.80384757729337) < 1e-9);
  assert.ok(Math.abs(bounds.width - 42.38460969082652) < 1e-9);
  assert.ok(Math.abs(bounds.height - 49.41229744348774) < 1e-9);
});

test("dimension bounds include the deterministic rendered label rectangle", () => {
  const block = {
    id: ids.block,
    revisionId: ids.revision,
    name: "Dimension label",
    version: 1,
    primitives: [
      {
        localId: "dimension",
        name: "Dimension",
        geometry: {
          type: "dimension",
          start: { x: 0, y: 0 },
          end: { x: 10, y: 0 },
          offset: 4,
          calibrationId: null,
        },
        styleId: null,
        style: inlineStyle,
      },
    ],
  };
  assert.deepEqual(
    blockInstanceBounds(
      block,
      {
        id: ids.instance,
        blockId: ids.block,
        layerId: ids.layer,
        name: "Placed",
        origin: { x: 0, y: 0 },
        rotation: 0,
        scaleX: 1,
        scaleY: 1,
        version: 1,
      },
      {},
    ),
    { x: 0, y: 0, width: 26.599999999999998, height: 18.4 },
  );
});

test("calibrated dimension bounds reserve deterministic space for every finite numeric label", () => {
  const block = {
    id: ids.block,
    revisionId: ids.revision,
    name: "Calibrated dimension label",
    version: 1,
    primitives: [
      {
        localId: "dimension",
        name: "Dimension",
        geometry: {
          type: "dimension",
          start: { x: 0, y: 0 },
          end: { x: 10, y: 0 },
          offset: 4,
          calibrationId: ids.style,
        },
        styleId: null,
        style: inlineStyle,
      },
    ],
  };
  const bounds = blockInstanceBounds(
    block,
    {
      id: ids.instance,
      blockId: ids.block,
      layerId: ids.layer,
      name: "Placed",
      origin: { x: 0, y: 0 },
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
      version: 1,
    },
    {},
  );
  assert.ok(bounds.width >= 177.79);
  assert.equal(bounds.height, 18.4);
});

test("production render adapter orders committed and hit items together and dispatches the visual topmost overlap", async () => {
  const blocks = await import("../app/lukas/lib/drawing-blocks.ts");
  assert.equal(typeof blocks.drawingCanvasRenderAdapter, "function");
  const block = {
    id: ids.block,
    revisionId: ids.revision,
    name: "Overlap",
    version: 1,
    primitives: [
      {
        localId: "line",
        name: "Line",
        geometry: {
          type: "line",
          start: { x: 0, y: 0 },
          end: { x: 10, y: 10 },
        },
        styleId: null,
        style: inlineStyle,
      },
    ],
  };
  const instance = {
    id: ids.instance,
    blockId: ids.block,
    layerId: ids.otherLayer,
    name: "Top block",
    origin: { x: 10, y: 20 },
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
    version: 1,
  };
  const model = blockInstanceRenderModel(block, instance, {});
  const adapter = blocks.drawingCanvasRenderAdapter({
    layers: structure().layers,
    objects: [
      {
        ...object(ids.objectA),
        style: { ...inlineStyle },
      },
    ],
    blockInstances: [
      { ...model, bounds: blockInstanceBounds(block, instance, {}) },
    ],
    zoom: 1,
  });
  assert.deepEqual(
    adapter.items.map((item) => item.id),
    [ids.objectA, ids.instance],
  );
  assert.deepEqual(
    adapter.hitItems.map((item) => item.id),
    [ids.objectA, ids.instance],
  );
  assert.equal(adapter.topmostAt({ x: 15, y: 25 })?.id, ids.instance);
});

test("render models resolve live style definitions with primitive overrides and fail closed", () => {
  const block = {
    id: ids.block,
    revisionId: ids.revision,
    name: "Styled",
    version: 1,
    primitives: [
      {
        localId: "one",
        name: "Styled shape",
        geometry: object(ids.objectA).geometry,
        styleId: ids.style,
        style: { fill: "#abcdef" },
      },
    ],
  };
  const instance = {
    id: ids.instance,
    blockId: ids.block,
    layerId: ids.layer,
    name: "Styled 1",
    origin: { x: 0, y: 0 },
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
    version: 1,
  };
  const styles = structure().styles;
  assert.deepEqual(
    blockInstanceRenderModel(block, instance, styles).primitives[0].style,
    {
      stroke: "#445566",
      strokeWidth: 3,
      fill: "#abcdef",
    },
  );
  const updated = {
    ...styles,
    [ids.style]: {
      ...styles[ids.style],
      version: 2,
      value: { stroke: "#000000", strokeWidth: 5, fill: null },
    },
  };
  assert.equal(
    blockInstanceRenderModel(block, instance, updated).primitives[0].style
      .strokeWidth,
    5,
  );
  assert.equal(instance.version, 1);
  assert.throws(
    () => blockInstanceRenderModel(block, instance, {}),
    /does not exist/i,
  );
});

test("create from selection is one exact atomic structure command with undo and redo", () => {
  const current = state();
  const generated = [ids.block, ids.instance, "local-a", "local-b"];
  const command = createBlockFromSelection(
    current,
    [ids.objectB, ids.objectA],
    ids.actor,
    "Panel",
    {
      activeLayerId: ids.layer,
      createId: () => generated.shift(),
    },
  );
  assert.equal(command.type, "mutate_structure");
  assert.deepEqual(
    command.actions.map((action) => action.kind),
    ["put_block", "put_block_instance", "delete_object", "delete_object"],
  );
  assert.deepEqual(
    command.actions.slice(2).map((action) => action.id),
    [ids.objectA, ids.objectB],
  );
  const applied = applyDrawingCommand(current, command, {
    createId: () => ids.operation,
    now: () => "2026-08-25T00:00:00.000Z",
  });
  assert.deepEqual(Object.keys(applied.state.objects), []);
  assert.equal(
    applied.state.structure.blocks[ids.block].primitives[0].geometry.origin.x,
    0,
  );
  assert.deepEqual(
    applied.operation.inverse.actions.map((action) => action.kind),
    ["put_object", "put_object", "delete_block_instance", "delete_block"],
  );
  const undone = undoDrawingCommand(applied.state, ids.actor, {
    createId: () => "00000000-0000-4000-8000-000000000714",
  });
  assert.ok(undone && !("kind" in undone));
  assert.deepEqual(
    undone.state.objects[ids.objectA].geometry,
    current.objects[ids.objectA].geometry,
  );
  assert.equal(undone.state.structure.blocks[ids.block], undefined);
  const redone = redoDrawingCommand(undone.state, ids.actor, {
    createId: () => "00000000-0000-4000-8000-000000000715",
  });
  assert.ok(redone && !("kind" in redone));
  assert.equal(redone.state.objects[ids.objectA], undefined);
  assert.equal(
    redone.state.structure.blockInstances[ids.instance].name,
    "Panel",
  );
});

test("block conversion validator rejects a rotated or scaled creation instance", () => {
  const current = state({
    objects: {
      [ids.objectA]: {
        ...object(ids.objectA),
        geometry: {
          type: "rectangle",
          origin: { x: 10, y: 20 },
          width: 20,
          height: 10,
          rotation: 30,
        },
      },
    },
  });
  const block = {
    id: ids.block,
    revisionId: ids.revision,
    name: "Invalid conversion",
    primitives: [
      {
        localId: "local-a",
        name: "Outline",
        geometry: {
          type: "rectangle",
          origin: { x: 0, y: 0 },
          width: 10,
          height: 20,
          rotation: 0,
        },
        styleId: ids.style,
        style: { fill: "#abcdef" },
      },
    ],
    version: 1,
  };
  const instance = {
    id: ids.instance,
    blockId: ids.block,
    layerId: ids.layer,
    name: "Invalid conversion",
    origin: { x: 10, y: 20 },
    rotation: 30,
    scaleX: 2,
    scaleY: 0.5,
    version: 1,
  };
  assert.throws(
    () =>
      applyDrawingCommand(current, {
        type: "mutate_structure",
        actorId: ids.actor,
        actions: [
          { kind: "put_block", entity: block, baseVersion: null },
          { kind: "put_block_instance", entity: instance, baseVersion: null },
          { kind: "delete_object", id: ids.objectA, baseVersion: 1 },
        ],
      }),
    /translation-only|rotation.*zero|scale.*one/i,
  );
});

test("block conversion rejects partial, stale, cross-layer, inactive, hidden, and locked selections without mutation", () => {
  const current = state();
  const before = structuredClone(current);
  for (const [candidate, selected, activeLayerId] of [
    [current, [ids.objectA, "00000000-0000-4000-8000-000000000799"], ids.layer],
    [current, [ids.objectA], ids.otherLayer],
    [
      state({
        objects: {
          [ids.objectA]: object(ids.objectA),
          [ids.objectB]: object(ids.objectB, ids.otherLayer),
        },
      }),
      [ids.objectA, ids.objectB],
      ids.layer,
    ],
    [
      state({
        layers: {
          ...structure().layers,
          [ids.layer]: { ...structure().layers[ids.layer], visible: false },
        },
      }),
      [ids.objectA],
      ids.layer,
    ],
    [
      state({
        layers: {
          ...structure().layers,
          [ids.layer]: { ...structure().layers[ids.layer], locked: true },
        },
      }),
      [ids.objectA],
      ids.layer,
    ],
  ]) {
    assert.throws(() =>
      createBlockFromSelection(candidate, selected, ids.actor, "Panel", {
        activeLayerId,
        createId: () => crypto.randomUUID(),
      }),
    );
  }
  const staleCommand = createBlockFromSelection(
    current,
    [ids.objectA],
    ids.actor,
    "Panel",
    {
      activeLayerId: ids.layer,
      createId: (() => {
        const values = [ids.block, ids.instance, "local-a"];
        return () => values.shift();
      })(),
    },
  );
  const stale = structuredClone(current);
  stale.objects[ids.objectA].version = 2;
  stale.structure.objects = stale.objects;
  assert.throws(
    () => applyDrawingCommand(stale, staleCommand),
    /base version/i,
  );
  assert.deepEqual(current, before);
});

test("definition and instance commands preserve identity, transforms, guards, copy, and exact deletion", () => {
  const block = {
    id: ids.block,
    revisionId: ids.revision,
    name: "Symbol",
    primitives: [
      {
        localId: "one",
        name: "Line",
        geometry: { type: "line", start: { x: 0, y: 0 }, end: { x: 10, y: 0 } },
        styleId: null,
        style: inlineStyle,
      },
    ],
    version: 1,
  };
  const current = state({
    objects: {},
    blocks: { [ids.block]: block },
    blockInstances: {},
  });
  const insert = insertDrawingBlockInstanceCommand(
    current,
    ids.actor,
    ids.block,
    { x: 12, y: 34 },
    { activeLayerId: ids.layer, createId: () => ids.instance },
  );
  const inserted = applyDrawingCommand(current, insert).state;
  assert.deepEqual(insert.actions[0].entity.origin, { x: 12, y: 34 });
  const copied = copyDrawingBlockInstanceCommand(
    inserted,
    ids.actor,
    ids.instance,
    { createId: () => ids.copy, offset: { x: 5, y: -2 } },
  );
  assert.equal(copied.actions[0].entity.blockId, ids.block);
  assert.deepEqual(copied.actions[0].entity.origin, { x: 17, y: 32 });
  const transformed = updateDrawingBlockInstanceCommand(
    inserted,
    ids.actor,
    ids.instance,
    {
      name: "Placed",
      layerId: ids.otherLayer,
      origin: { x: 1, y: 2 },
      rotation: 30,
      scaleX: -2,
      scaleY: 0.5,
    },
  );
  const transformedState = applyDrawingCommand(inserted, transformed).state;
  assert.deepEqual(transformedState.structure.blockInstances[ids.instance], {
    ...inserted.structure.blockInstances[ids.instance],
    name: "Placed",
    layerId: ids.otherLayer,
    origin: { x: 1, y: 2 },
    rotation: 30,
    scaleX: -2,
    scaleY: 0.5,
    version: 2,
  });
  assert.throws(
    () =>
      updateDrawingBlockInstanceCommand(inserted, ids.actor, ids.instance, {
        scaleY: 0,
      }),
    /scale/i,
  );
  assert.throws(
    () => deleteDrawingBlockCommand(inserted, ids.actor, ids.block),
    /referenced/i,
  );
  const deleteInstance = deleteDrawingBlockInstanceCommand(
    inserted,
    ids.actor,
    ids.instance,
  );
  const withoutInstance = applyDrawingCommand(inserted, deleteInstance).state;
  assert.equal(
    withoutInstance.structure.blockInstances[ids.instance],
    undefined,
  );
  const renamed = updateDrawingBlockCommand(
    withoutInstance,
    ids.actor,
    ids.block,
    { name: "Renamed" },
  );
  assert.equal(
    applyDrawingCommand(withoutInstance, renamed).state.structure.blocks[
      ids.block
    ].name,
    "Renamed",
  );
  assert.equal(
    deleteDrawingBlockCommand(withoutInstance, ids.actor, ids.block).actions[0]
      .kind,
    "delete_block",
  );

  const locked = state({
    objects: {},
    blocks: { [ids.block]: block },
    blockInstances: {
      [ids.instance]: inserted.structure.blockInstances[ids.instance],
    },
    layers: {
      ...structure().layers,
      [ids.layer]: { ...structure().layers[ids.layer], locked: true },
    },
  });
  assert.throws(
    () => copyDrawingBlockInstanceCommand(locked, ids.actor, ids.instance),
    /visible unlocked/i,
  );
  assert.throws(
    () => deleteDrawingBlockInstanceCommand(locked, ids.actor, ids.instance),
    /visible unlocked/i,
  );
});

test("shift selection replaces the current selection when candidate kind changes", async () => {
  const blocks = await import("../app/lukas/lib/drawing-blocks.ts");
  assert.equal(typeof blocks.drawingKindExclusiveSelection, "function");
  assert.deepEqual(
    blocks.drawingKindExclusiveSelection(
      [ids.objectA, ids.objectB],
      ids.instance,
      true,
      new Set([ids.objectA, ids.objectB]),
      new Set([ids.instance]),
    ),
    [ids.instance],
  );
  assert.deepEqual(
    blocks.drawingKindExclusiveSelection(
      [ids.instance],
      ids.objectA,
      true,
      new Set([ids.objectA, ids.objectB]),
      new Set([ids.instance]),
    ),
    [ids.objectA],
  );
});

test("mixed instance-object shortcuts fail before producing any partial command", async () => {
  const blocks = await import("../app/lukas/lib/drawing-blocks.ts");
  assert.equal(typeof blocks.drawingSelectionEntityKind, "function");
  const block = {
    id: ids.block,
    revisionId: ids.revision,
    name: "Mixed guard",
    primitives: [
      {
        localId: "line",
        name: "Line",
        geometry: {
          type: "line",
          start: { x: 0, y: 0 },
          end: { x: 10, y: 0 },
        },
        styleId: null,
        style: inlineStyle,
      },
    ],
    version: 1,
  };
  const instance = {
    id: ids.instance,
    blockId: ids.block,
    layerId: ids.layer,
    name: "Placed",
    origin: { x: 10, y: 20 },
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
    version: 1,
  };
  const current = state({
    blocks: { [ids.block]: block },
    blockInstances: { [ids.instance]: instance },
  });
  const before = structuredClone(current);
  assert.equal(
    blocks.drawingSelectionEntityKind(current, [ids.objectA, ids.instance]),
    "mixed",
  );
  for (const operation of [
    () =>
      blocks.deleteDrawingBlockInstancesCommand(current, ids.actor, [
        ids.objectA,
        ids.instance,
      ]),
    () =>
      blocks.moveDrawingBlockInstancesCommand(
        current,
        ids.actor,
        [ids.objectA, ids.instance],
        { x: 1, y: 0 },
      ),
    () =>
      blocks.duplicateDrawingBlockInstancesCommand(current, ids.actor, [
        ids.objectA,
        ids.instance,
      ]),
  ]) {
    assert.throws(operation, /one selection kind|block instances/i);
  }
  assert.deepEqual(current, before);
});

test("instance clipboard is a deep snapshot and pastes on the current active canvas layer", async () => {
  const blocks = await import("../app/lukas/lib/drawing-blocks.ts");
  assert.equal(typeof blocks.copyDrawingBlockInstancesClipboard, "function");
  const secondCanvas = "00000000-0000-4000-8000-000000000716";
  const secondLayer = "00000000-0000-4000-8000-000000000717";
  const pastedId = "00000000-0000-4000-8000-000000000718";
  const block = {
    id: ids.block,
    revisionId: ids.revision,
    name: "Clipboard",
    primitives: [
      {
        localId: "line",
        name: "Line",
        geometry: {
          type: "line",
          start: { x: 0, y: 0 },
          end: { x: 10, y: 0 },
        },
        styleId: null,
        style: inlineStyle,
      },
    ],
    version: 1,
  };
  const instance = {
    id: ids.instance,
    blockId: ids.block,
    layerId: ids.layer,
    name: "Snapshot name",
    origin: { x: 10, y: 20 },
    rotation: 30,
    scaleX: -2,
    scaleY: 0.5,
    version: 4,
  };
  const current = state({
    canvases: {
      ...structure().canvases,
      [secondCanvas]: {
        id: secondCanvas,
        pageId: ids.page,
        name: "Model",
        spaceKind: "model",
        widthMillimeters: 500,
        heightMillimeters: 500,
        background: null,
        sortOrder: 1,
        version: 1,
      },
    },
    layers: {
      ...structure().layers,
      [secondLayer]: {
        id: secondLayer,
        name: "Other canvas",
        visible: true,
        locked: false,
        systemKind: "custom",
        canvasId: secondCanvas,
        sortOrder: 0,
        version: 1,
      },
    },
    objects: {},
    blocks: { [ids.block]: block },
    blockInstances: { [ids.instance]: instance },
  });
  const clipboard = blocks.copyDrawingBlockInstancesClipboard(current, [
    ids.instance,
  ]);
  current.structure.blockInstances[ids.instance].name = "Edited source";
  current.structure.blockInstances[ids.instance].origin.x = 999;
  const command = blocks.pasteDrawingBlockInstancesClipboardCommand(
    current,
    ids.actor,
    clipboard,
    {
      activeCanvasId: secondCanvas,
      activeLayerId: secondLayer,
      createId: () => pastedId,
      offset: { x: 10, y: 10 },
    },
  );
  assert.deepEqual(command.actions[0].entity, {
    ...instance,
    id: pastedId,
    layerId: secondLayer,
    origin: { x: 20, y: 30 },
    version: 1,
  });
  assert.throws(
    () =>
      blocks.pasteDrawingBlockInstancesClipboardCommand(
        state({ objects: {}, blocks: {}, blockInstances: {} }),
        ids.actor,
        clipboard,
        {
          activeCanvasId: ids.canvas,
          activeLayerId: ids.layer,
        },
      ),
    /definition.*no longer exists/i,
  );
});

test("production cache and unified adapter handle one thousand instances without selection recompute and invalidate definitions and styles", async () => {
  const blocks = await import("../app/lukas/lib/drawing-blocks.ts");
  assert.equal(typeof blocks.createDrawingBlockRenderCache, "function");
  const block = {
    id: ids.block,
    revisionId: ids.revision,
    name: "Bench",
    primitives: [
      {
        localId: "line",
        name: "Line",
        geometry: {
          type: "line",
          start: { x: 0, y: 0 },
          end: { x: 10, y: 10 },
        },
        styleId: ids.style,
        style: {},
      },
    ],
    version: 1,
  };
  const instances = Object.fromEntries(
    Array.from({ length: 1_000 }, (_, index) => {
      const id = `10000000-0000-4000-8${String(index).padStart(3, "0")}-000000000001`;
      return [
        id,
        {
          id,
          blockId: ids.block,
          layerId: ids.layer,
          name: `I${index}`,
          origin: { x: index, y: index % 20 },
          rotation: 30,
          scaleX: 2,
          scaleY: 0.5,
          version: 1,
        },
      ];
    }),
  );
  const blocksMap = { [ids.block]: block };
  const styles = structure().styles;
  const layers = structure().layers;
  const cache = blocks.createDrawingBlockRenderCache();
  const started = performance.now();
  const first = cache.select({
    activeCanvasId: ids.canvas,
    blocks: blocksMap,
    instances,
    layers,
    styles,
  });
  const adapter = blocks.drawingCanvasRenderAdapter({
    blockInstances: first.instances,
    layers,
    objects: [],
    zoom: 1,
  });
  const elapsed = performance.now() - started;
  assert.equal(adapter.items.length, 1_000);
  assert.ok(
    elapsed < 250,
    `1,000 production cached render/hit items took ${elapsed.toFixed(1)}ms`,
  );
  assert.equal(cache.resolveCount, 1_000);
  const selectionRerender = cache.select({
    activeCanvasId: ids.canvas,
    blocks: blocksMap,
    instances,
    layers,
    styles,
  });
  assert.equal(selectionRerender, first);
  assert.equal(cache.resolveCount, 1_000);
  const changedBlock = {
    ...blocksMap,
    [ids.block]: { ...block, name: "Changed", version: 2 },
  };
  cache.select({
    activeCanvasId: ids.canvas,
    blocks: changedBlock,
    instances,
    layers,
    styles,
  });
  assert.equal(cache.resolveCount, 2_000);
  cache.select({
    activeCanvasId: ids.canvas,
    blocks: changedBlock,
    instances,
    layers,
    styles: {
      ...styles,
      [ids.style]: {
        ...styles[ids.style],
        value: { ...styles[ids.style].value, strokeWidth: 9 },
        version: 2,
      },
    },
  });
  assert.equal(cache.resolveCount, 3_000);
});

test("active-canvas transient state and hit candidates include eligible instances as one target and fail closed", () => {
  const block = {
    id: ids.block,
    revisionId: ids.revision,
    name: "Hit",
    primitives: [
      {
        localId: "line",
        name: "Line",
        geometry: {
          type: "line",
          start: { x: 0, y: 0 },
          end: { x: 10, y: 10 },
        },
        styleId: null,
        style: inlineStyle,
      },
    ],
    version: 1,
  };
  const instance = {
    id: ids.instance,
    blockId: ids.block,
    layerId: ids.layer,
    name: "Hit 1",
    origin: { x: 20, y: 30 },
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
    version: 1,
  };
  const current = state({
    objects: {},
    blocks: { [ids.block]: block },
    blockInstances: { [ids.instance]: instance },
  });
  const snapshot = {
    ...current,
    activePageId: ids.page,
    activeCanvasId: ids.canvas,
  };
  const derived = deriveDrawingTransientState(snapshot, {
    canEdit: true,
    canSelect: true,
    activeLayerId: ids.layer,
    activeTool: "select",
    selectedIds: [ids.instance],
  });
  assert.equal(
    derived.state.structure.blockInstances[ids.instance].blockId,
    ids.block,
  );
  assert.deepEqual(derived.selectedIds, [ids.instance]);
  assert.deepEqual(
    drawingBlockSelectionCandidates(
      [instance],
      { [ids.block]: block },
      structure().layers,
      {},
      2,
    ),
    [{ id: ids.instance, bounds: { x: 17, y: 27, width: 16, height: 16 } }],
  );
  assert.deepEqual(
    drawingBlockSelectionCandidates(
      [{ ...instance, layerId: ids.otherLayer }],
      { [ids.block]: block },
      {
        ...structure().layers,
        [ids.otherLayer]: {
          ...structure().layers[ids.otherLayer],
          locked: true,
        },
      },
      {},
      2,
    ),
    [],
  );
  assert.throws(
    () =>
      drawingBlockSelectionCandidates(
        [instance],
        {},
        structure().layers,
        {},
        2,
      ),
    /missing block/i,
  );
  const styled = {
    ...block,
    primitives: [{ ...block.primitives[0], styleId: ids.style, style: {} }],
  };
  assert.throws(
    () =>
      drawingBlockSelectionCandidates(
        [instance],
        { [ids.block]: styled },
        structure().layers,
        {},
        2,
      ),
    /does not exist/i,
  );
});
