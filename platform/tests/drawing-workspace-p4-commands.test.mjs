import assert from "node:assert/strict";
import test from "node:test";

import * as drawingCommands from "../app/lukas/lib/drawing-commands.ts";
import {
  DrawingBlockError,
  createBlockFromSelection,
  worldObjectsToBlockPrimitives,
} from "../app/lukas/lib/drawing-blocks.ts";
import { DrawingPropertySchemaSchema } from "../app/lukas/lib/drawing-workspace.types.ts";
import {
  applyDrawingStructureActions,
  validateDrawingStructureState,
} from "../app/lukas/lib/drawing-structure.ts";
import { resolveDrawingOpening } from "../app/lukas/lib/drawing-semantic-geometry.ts";

const ids = Object.fromEntries(
  [
    "revision",
    "otherRevision",
    "page",
    "canvas",
    "otherCanvas",
    "layer",
    "peerLayer",
    "otherLayer",
    "wall",
    "opening",
    "otherObject",
    "propertySchema",
    "propertyValue",
    "table",
    "column",
    "row",
    "actor",
    "operation",
    "checkpoint",
    "newWall",
    "newOpening",
    "openingCopy",
  ].map((name, index) => [
    name,
    `10000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
  ]),
);

const style = { stroke: "#112233", strokeWidth: 2, fill: null };

function wall(overrides = {}) {
  return {
    id: ids.wall,
    name: "W-01",
    layerId: ids.layer,
    geometry: {
      type: "wall",
      semanticVersion: 1,
      start: { x: 0, y: 0 },
      end: { x: 1000, y: 0 },
      thicknessMillimeters: 200,
      heightMillimeters: 3000,
    },
    style,
    version: 1,
    ...overrides,
  };
}

function opening(overrides = {}) {
  return {
    id: ids.opening,
    name: "D-01",
    layerId: ids.layer,
    geometry: {
      type: "opening",
      semanticVersion: 1,
      hostWallId: ids.wall,
      offsetMillimeters: 500,
      widthMillimeters: 200,
      heightMillimeters: 2100,
      sillHeightMillimeters: 0,
      openingKind: "door",
    },
    style,
    version: 1,
    ...overrides,
  };
}

function page() {
  return {
    id: ids.page,
    revisionId: ids.revision,
    name: "A1",
    sortOrder: 0,
    version: 1,
  };
}

function canvas(id, overrides = {}) {
  return {
    id,
    pageId: ids.page,
    name: id === ids.canvas ? "Paper" : "Model",
    spaceKind: id === ids.canvas ? "paper" : "model",
    widthMillimeters: 210,
    heightMillimeters: 297,
    background: null,
    sortOrder: id === ids.canvas ? 0 : 1,
    version: 1,
    ...overrides,
  };
}

function layer(id, canvasId, overrides = {}) {
  return {
    id,
    name: id === ids.layer ? "Work" : id === ids.peerLayer ? "Peer" : "Other",
    visible: true,
    locked: false,
    systemKind: id === ids.layer ? "work" : "custom",
    canvasId,
    sortOrder: id === ids.layer ? 0 : 1,
    version: 1,
    ...overrides,
  };
}

function referenceFixtures() {
  return {
    propertySchemas: {
      [ids.propertySchema]: {
        id: ids.propertySchema,
        revisionId: ids.revision,
        name: "Mark",
        valueType: "text",
        enumOptions: [],
        appliesTo: ["opening"],
        required: false,
        version: 1,
      },
    },
    propertyValues: {
      [ids.propertyValue]: {
        id: ids.propertyValue,
        schemaId: ids.propertySchema,
        objectId: ids.opening,
        blockInstanceId: null,
        value: "D-01",
        version: 1,
      },
    },
    tables: {
      [ids.table]: {
        id: ids.table,
        revisionId: ids.revision,
        name: "Door schedule",
        columns: [
          {
            id: ids.column,
            name: "Name",
            kind: "object_name",
            propertySchemaId: null,
          },
        ],
        rows: [
          {
            id: ids.row,
            objectId: ids.opening,
            blockInstanceId: null,
            cells: {},
          },
        ],
        version: 1,
      },
    },
  };
}

function structure(objects = [], overrides = {}) {
  return {
    pages: { [ids.page]: page() },
    canvases: {
      [ids.canvas]: canvas(ids.canvas),
      [ids.otherCanvas]: canvas(ids.otherCanvas),
    },
    layers: {
      [ids.layer]: layer(ids.layer, ids.canvas),
      [ids.peerLayer]: layer(ids.peerLayer, ids.canvas),
      [ids.otherLayer]: layer(ids.otherLayer, ids.otherCanvas),
    },
    objects: Object.fromEntries(objects.map((object) => [object.id, object])),
    styles: {},
    blocks: {},
    blockInstances: {},
    propertySchemas: {},
    propertyValues: {},
    tables: {},
    ...overrides,
  };
}

function state(objects = [], overrides = {}) {
  return drawingCommands.createDrawingDocumentState({
    revisionId: overrides.revisionId ?? ids.revision,
    structure: structure(objects, overrides.structure),
  });
}

function environment() {
  let next = 0;
  return {
    createId: () =>
      next++ === 0
        ? ids.operation
        : `10000000-0000-4000-9000-${String(next).padStart(12, "0")}`,
    now: () => "2026-08-26T00:00:00.000Z",
  };
}

test("semantic references validate the completed graph, not input order", () => {
  assert.equal(
    typeof drawingCommands.validateDrawingSemanticReferences,
    "function",
  );
  const initial = state();
  assert.throws(() =>
    drawingCommands.applyDrawingCommand(initial, {
      type: "add_objects",
      actorId: ids.actor,
      objects: [opening()],
    }),
  );

  const applied = drawingCommands.applyDrawingCommand(initial, {
    type: "add_objects",
    actorId: ids.actor,
    objects: [opening(), wall()],
  });
  assert.deepEqual(Object.keys(applied.state.objects), [ids.opening, ids.wall]);
  assert.equal(
    resolveDrawingOpening(
      applied.state.objects[ids.opening].geometry,
      applied.state.objects,
    ).host.id,
    ids.wall,
  );
  const undone = drawingCommands.undoDrawingCommand(
    applied.state,
    ids.actor,
    environment(),
  );
  assert.equal(undone.kind, undefined);
  assert.deepEqual(undone.state.objects, {});
  const redone = drawingCommands.redoDrawingCommand(
    undone.state,
    ids.actor,
    environment(),
  );
  assert.equal(redone.kind, undefined);
  assert.equal(redone.state.objects[ids.opening].geometry.hostWallId, ids.wall);

  const raw = {
    revisionId: ids.revision,
    ...structure([], { objects: {} }),
  };
  const structured = applyDrawingStructureActions(
    raw,
    [
      { kind: "put_object", entity: opening(), baseVersion: null },
      { kind: "put_object", entity: wall(), baseVersion: null },
    ],
    { allowCheckpointRestore: true },
  );
  assert.deepEqual(Object.keys(structured.state.objects), [
    ids.opening,
    ids.wall,
  ]);
});

test("hydration rejects missing, non-wall, and foreign-canvas opening hosts", () => {
  assert.throws(() => state([opening()]));
  assert.throws(() =>
    state([
      {
        ...wall(),
        geometry: {
          type: "grid",
          semanticVersion: 1,
          start: { x: 0, y: 0 },
          end: { x: 1000, y: 0 },
        },
      },
      opening(),
    ]),
  );
  assert.throws(() => state([wall(), opening({ layerId: ids.otherLayer })]));
  assert.doesNotThrow(() =>
    validateDrawingStructureState({
      revisionId: ids.revision,
      ...structure([wall(), opening({ layerId: ids.peerLayer })]),
    }),
  );
});

test("wall and opening edits are final-graph atomic and host-aware", () => {
  const initial = state([wall(), opening()]);
  assert.throws(() =>
    drawingCommands.applyDrawingCommand(initial, {
      type: "update_objects",
      actorId: ids.actor,
      updates: [
        {
          objectId: ids.wall,
          baseVersion: 1,
          patch: {
            geometry: { ...wall().geometry, end: { x: 500, y: 0 } },
          },
        },
      ],
    }),
  );
  const resized = drawingCommands.applyDrawingCommand(initial, {
    type: "update_objects",
    actorId: ids.actor,
    updates: [
      {
        objectId: ids.wall,
        baseVersion: 1,
        patch: { geometry: { ...wall().geometry, end: { x: 500, y: 0 } } },
      },
      {
        objectId: ids.opening,
        baseVersion: 1,
        patch: {
          geometry: { ...opening().geometry, offsetMillimeters: 250 },
        },
      },
    ],
  });
  assert.equal(resized.state.objects[ids.wall].version, 2);
  assert.equal(resized.state.objects[ids.opening].version, 2);

  const moved = drawingCommands.applyDrawingCommand(
    initial,
    drawingCommands.moveDrawingSelection(initial, [ids.wall], ids.actor, {
      x: 100,
      y: 50,
    }),
  );
  assert.equal(moved.state.objects[ids.opening], initial.objects[ids.opening]);
  assert.deepEqual(
    resolveDrawingOpening(
      moved.state.objects[ids.opening].geometry,
      moved.state.objects,
    ).center,
    { x: 600, y: 50 },
  );
  const openingMove = drawingCommands.moveDrawingOpeningToPoint(
    initial,
    ids.opening,
    ids.actor,
    { x: 700, y: 40 },
  );
  assert.deepEqual(openingMove, {
    type: "update_objects",
    actorId: ids.actor,
    updates: [
      {
        objectId: ids.opening,
        baseVersion: 1,
        patch: {
          geometry: { ...opening().geometry, offsetMillimeters: 700 },
        },
      },
    ],
  });
  assert.equal(
    drawingCommands.moveDrawingOpeningToPoint(initial, ids.opening, ids.actor, {
      x: -100,
      y: 0,
    }).updates[0].patch.geometry.offsetMillimeters,
    100,
  );
  assert.equal(
    drawingCommands.moveDrawingOpeningToPoint(initial, ids.opening, ids.actor, {
      x: 1100,
      y: 0,
    }).updates[0].patch.geometry.offsetMillimeters,
    900,
  );
});

test("semantic translation moves authored coordinates but never XY-translates an opening", () => {
  assert.deepEqual(
    drawingCommands.translateDrawingGeometry(wall().geometry, { x: 2, y: 3 }),
    {
      ...wall().geometry,
      start: { x: 2, y: 3 },
      end: { x: 1002, y: 3 },
    },
  );
  for (const geometry of [
    {
      type: "space",
      semanticVersion: 1,
      boundary: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 0, y: 10 },
      ],
      number: "1",
      finishes: { floor: null, wall: null, ceiling: null },
    },
    {
      type: "area",
      semanticVersion: 1,
      boundary: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 0, y: 10 },
      ],
    },
  ]) {
    assert.deepEqual(
      drawingCommands.translateDrawingGeometry(geometry, { x: 2, y: 3 })
        .boundary,
      [
        { x: 2, y: 3 },
        { x: 12, y: 3 },
        { x: 2, y: 13 },
      ],
    );
  }
  assert.deepEqual(
    drawingCommands.translateDrawingGeometry(
      {
        type: "grid",
        semanticVersion: 1,
        start: { x: 0, y: 0 },
        end: { x: 10, y: 0 },
      },
      { x: 2, y: 3 },
    ),
    {
      type: "grid",
      semanticVersion: 1,
      start: { x: 2, y: 3 },
      end: { x: 12, y: 3 },
    },
  );
  assert.deepEqual(
    drawingCommands.translateDrawingGeometry(
      {
        type: "arc",
        semanticVersion: 1,
        center: { x: 0, y: 0 },
        radius: 10,
        startAngleDegrees: 0,
        sweepAngleDegrees: 90,
      },
      { x: 2, y: 3 },
    ).center,
    { x: 2, y: 3 },
  );
  assert.throws(() =>
    drawingCommands.translateDrawingGeometry(opening().geometry, {
      x: 2,
      y: 3,
    }),
  );
});

test("host walls require the explicit opening-first reference-aware delete command", () => {
  const references = referenceFixtures();
  const initial = state([wall(), opening()], {
    structure: {
      ...structure([wall(), opening()]),
      ...references,
    },
  });
  for (const objectIds of [[ids.wall], [ids.opening, ids.wall]]) {
    assert.throws(() =>
      drawingCommands.applyDrawingCommand(initial, {
        type: "delete_objects",
        actorId: ids.actor,
        objectIds,
      }),
    );
  }

  const command = drawingCommands.deleteDrawingWallWithOpeningsCommand(
    initial,
    ids.actor,
    ids.wall,
  );
  assert.equal(command.type, "mutate_objects_with_references");
  assert.deepEqual(
    command.objects.map((object) => object.id),
    [ids.opening, ids.wall],
  );
  assert.deepEqual(command.actions, [
    {
      kind: "delete_property_value",
      id: ids.propertyValue,
      baseVersion: 1,
    },
    {
      kind: "put_table",
      entity: { ...references.tables[ids.table], rows: [] },
      baseVersion: 1,
    },
  ]);

  const deleted = drawingCommands.applyDrawingCommand(
    initial,
    command,
    environment(),
  );
  assert.deepEqual(deleted.state.objects, {});
  assert.deepEqual(deleted.state.structure.propertyValues, {});
  assert.deepEqual(deleted.state.structure.tables[ids.table].rows, []);
  assert.deepEqual(deleted.operation.resultVersions, {
    [ids.propertyValue]: null,
    [ids.table]: 2,
    [ids.opening]: null,
    [ids.wall]: null,
  });

  const undone = drawingCommands.undoDrawingCommand(
    deleted.state,
    ids.actor,
    environment(),
  );
  assert.equal(undone.kind, undefined);
  assert.deepEqual(Object.keys(undone.state.objects), [ids.opening, ids.wall]);
  assert.equal(undone.state.objects[ids.opening].geometry.hostWallId, ids.wall);
  assert.equal(undone.state.objects[ids.opening].version, 3);
  assert.equal(undone.state.objects[ids.wall].version, 3);
  assert.equal(
    undone.state.structure.propertyValues[ids.propertyValue].objectId,
    ids.opening,
  );
  assert.equal(
    undone.state.structure.tables[ids.table].rows[0].objectId,
    ids.opening,
  );

  const redone = drawingCommands.redoDrawingCommand(
    undone.state,
    ids.actor,
    environment(),
  );
  assert.equal(redone.kind, undefined);
  assert.deepEqual(redone.state.objects, {});
  const reverted = drawingCommands.revertDrawingOperation(
    redone.state,
    ids.actor,
    deleted.operation.clientOperationId,
    environment(),
  );
  assert.equal(reverted.kind, undefined);
  assert.equal(
    reverted.state.objects[ids.opening].geometry.hostWallId,
    ids.wall,
  );
});

test("checkpoint restore accepts opening-before-wall actions only when its final graph is valid", () => {
  const current = state();
  const checkpoint = state([opening(), wall()]);
  const command = drawingCommands.createDrawingCheckpointRestoreCommand(
    current,
    checkpoint,
    ids.actor,
    ids.checkpoint,
  );
  assert.deepEqual(
    command.actions
      .filter((action) => action.kind === "put_object")
      .map((action) => action.entity.id),
    [ids.opening, ids.wall],
  );
  const restored = drawingCommands.applyDrawingCommand(current, command);
  assert.equal(
    restored.state.objects[ids.opening].geometry.hostWallId,
    ids.wall,
  );

  const deleteCommand = drawingCommands.createDrawingCheckpointRestoreCommand(
    state([opening(), wall()]),
    state(),
    ids.actor,
    ids.checkpoint,
  );
  assert.deepEqual(
    deleteCommand.actions
      .filter((action) => action.kind === "delete_object")
      .map((action) => action.id),
    [ids.opening, ids.wall],
  );
});

test("clipboard preallocates IDs, remaps copied hosts, and validates retained hosts", () => {
  const initial = state([wall(), opening()]);
  const clipboard = drawingCommands.copyDrawingSelection(initial, [
    ids.opening,
    ids.wall,
  ]);
  const allocated = [ids.newOpening, ids.newWall];
  const paste = drawingCommands.pasteDrawingClipboard(
    clipboard,
    ids.actor,
    () => allocated.shift(),
    initial,
  );
  assert.equal(paste.objects[0].id, ids.newOpening);
  assert.equal(paste.objects[1].id, ids.newWall);
  assert.equal(paste.objects[0].geometry.hostWallId, ids.newWall);
  assert.equal(paste.objects[0].geometry.offsetMillimeters, 500);
  assert.deepEqual(paste.objects[1].geometry.start, { x: 20, y: 20 });
  assert.doesNotThrow(() =>
    drawingCommands.applyDrawingCommand(initial, paste),
  );

  const openingOnly = drawingCommands.copyDrawingSelection(initial, [
    ids.opening,
  ]);
  const implicitSameRevision = drawingCommands.pasteDrawingClipboard(
    openingOnly,
    ids.actor,
    () => ids.openingCopy,
  );
  assert.doesNotThrow(() =>
    drawingCommands.applyDrawingCommand(initial, implicitSameRevision),
  );
  const retained = drawingCommands.pasteDrawingClipboard(
    openingOnly,
    ids.actor,
    () => ids.openingCopy,
    initial,
  );
  assert.equal(retained.objects[0].geometry.hostWallId, ids.wall);
  assert.doesNotThrow(() =>
    drawingCommands.applyDrawingCommand(initial, retained),
  );
  assert.throws(() =>
    drawingCommands.pasteDrawingClipboard(
      openingOnly,
      ids.actor,
      () => ids.openingCopy,
      state(),
    ),
  );
  assert.throws(() =>
    drawingCommands.pasteDrawingClipboard(
      openingOnly,
      ids.actor,
      () => ids.openingCopy,
      state([wall()], { revisionId: ids.otherRevision }),
    ),
  );
});

test("all semantic types accept custom properties and remain outside blocks", () => {
  const geometries = [
    wall().geometry,
    opening().geometry,
    {
      type: "space",
      semanticVersion: 1,
      boundary: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 0, y: 100 },
      ],
      number: "101",
      finishes: { floor: null, wall: null, ceiling: null },
    },
    {
      type: "area",
      semanticVersion: 1,
      boundary: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 0, y: 100 },
      ],
    },
    {
      type: "grid",
      semanticVersion: 1,
      start: { x: 0, y: 0 },
      end: { x: 100, y: 0 },
    },
    {
      type: "arc",
      semanticVersion: 1,
      center: { x: 0, y: 0 },
      radius: 100,
      startAngleDegrees: 0,
      sweepAngleDegrees: 90,
    },
  ];
  for (const geometry of geometries) {
    assert.equal(
      DrawingPropertySchemaSchema.safeParse({
        id: ids.propertySchema,
        revisionId: ids.revision,
        name: `Property ${geometry.type}`,
        valueType: "text",
        enumOptions: [],
        appliesTo: [geometry.type],
        required: false,
        version: 1,
      }).success,
      true,
      geometry.type,
    );
    const object = {
      ...wall({ id: ids.otherObject, name: geometry.type, geometry }),
    };
    assert.throws(
      () => worldObjectsToBlockPrimitives([object], () => "local-1"),
      DrawingBlockError,
      geometry.type,
    );
    assert.throws(
      () =>
        createBlockFromSelection(
          state(geometry.type === "opening" ? [wall(), object] : [object]),
          [object.id],
          ids.actor,
          "Semantic block",
          { activeLayerId: ids.layer, createId: () => ids.newWall },
        ),
      DrawingBlockError,
      geometry.type,
    );
  }
});
