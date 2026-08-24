import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createServer } from "vite";
import * as drawingCommands from "../app/lukas/lib/drawing-commands.ts";
import {
  DrawingLayerInputSchema,
  DrawingLayerSchema,
  DrawingObjectSchema,
} from "../app/lukas/lib/drawing-workspace.types.ts";

const {
  applyDrawingCommand,
  createDrawingDocumentState,
  LockedDrawingLayerError,
  redoDrawingCommand,
  undoDrawingCommand,
} = drawingCommands;

const vite = await createServer({
  appType: "custom",
  configFile: false,
  logLevel: "silent",
  resolve: {
    alias: { "~": fileURLToPath(new URL("../app", import.meta.url)) },
  },
  server: { middlewareMode: true },
});
const drawingTools = await vite.ssrLoadModule(
  "/app/lukas/components/drawing-canvas.client.tsx",
);
test.after(() => vite.close());

const ids = {
  revision: "00000000-0000-4000-8000-000000000001",
  layer: "00000000-0000-4000-8000-000000000002",
  lockedLayer: "00000000-0000-4000-8000-000000000003",
  rectangle: "00000000-0000-4000-8000-000000000004",
  copiedRectangle: "00000000-0000-4000-8000-000000000005",
  circle: "00000000-0000-4000-8000-000000000006",
  hiddenLayer: "00000000-0000-4000-8000-000000000007",
  hiddenRectangle: "00000000-0000-4000-8000-000000000008",
  lockedRectangle: "00000000-0000-4000-8000-000000000009",
};

function environment() {
  let operation = 10;
  return {
    createId: () =>
      `00000000-0000-4000-8000-${String(operation++).padStart(12, "0")}`,
    now: () => "2026-08-24T00:00:00.000Z",
  };
}

function layer(overrides = {}) {
  return {
    id: ids.layer,
    name: "Annotations",
    visible: true,
    locked: false,
    systemKind: "custom",
    version: 1,
    ...overrides,
  };
}

function rectangle(overrides = {}) {
  return {
    id: ids.rectangle,
    name: "Rectangle",
    layerId: ids.layer,
    geometry: {
      type: "rectangle",
      origin: { x: 0, y: 0 },
      width: 20,
      height: 10,
      rotation: 0,
    },
    style: { stroke: "#112233", strokeWidth: 2, fill: null },
    version: 1,
    ...overrides,
  };
}

function circle(overrides = {}) {
  return {
    id: ids.circle,
    name: "Circle",
    layerId: ids.layer,
    geometry: { type: "circle", center: { x: 10, y: 10 }, radius: 5 },
    style: { stroke: "#112233", strokeWidth: 2, fill: null },
    version: 1,
    ...overrides,
  };
}

test("canonical drawing objects require an exact trimmed name", () => {
  assert.equal(
    DrawingObjectSchema.strict().safeParse(rectangle()).success,
    true,
  );
  for (const candidate of [
    { ...rectangle(), name: "" },
    { ...rectangle(), name: " Rectangle " },
    { ...rectangle(), name: "x".repeat(256) },
    { ...rectangle(), rendererName: "Rectangle" },
  ]) {
    assert.equal(
      DrawingObjectSchema.strict().safeParse(candidate).success,
      false,
    );
  }
  const { name: _name, ...missingName } = rectangle();
  assert.equal(
    DrawingObjectSchema.strict().safeParse(missingName).success,
    false,
  );
});

test("canonical loaded layers reject corrupt source state without widening browser input", () => {
  for (const corruptSource of [
    layer({ systemKind: "source", visible: false, locked: true }),
    layer({ systemKind: "source", visible: true, locked: false }),
  ]) {
    assert.equal(DrawingLayerSchema.safeParse(corruptSource).success, false);
  }
  assert.equal(
    DrawingLayerInputSchema.safeParse({
      id: ids.layer,
      name: "Injected source",
      visible: true,
      locked: true,
      version: 1,
      systemKind: "source",
    }).success,
    false,
  );
});

function emptyState(overrides = {}) {
  return createDrawingDocumentState({
    revisionId: ids.revision,
    layers: [layer()],
    ...overrides,
  });
}

test("add appends an operation with an inverse and leaves its input state unchanged", () => {
  const state = emptyState();
  const added = applyDrawingCommand(
    state,
    { type: "add_objects", actorId: "actor-a", objects: [rectangle()] },
    environment(),
  );

  assert.equal(state.objects[ids.rectangle], undefined);
  assert.deepEqual(added.state.objects[ids.rectangle], rectangle());
  assert.equal(added.state.operations.length, 1);
  assert.equal(
    added.operation.clientOperationId,
    "00000000-0000-4000-8000-000000000010",
  );
  assert.deepEqual(added.operation.baseVersions, {});
  assert.deepEqual(added.operation.inverse, {
    type: "delete_objects",
    objectIds: [ids.rectangle],
  });
});

test("update moves an object and records the version it was based on", () => {
  const state = emptyState({ objects: [rectangle()] });
  const moved = applyDrawingCommand(
    state,
    {
      type: "update_objects",
      actorId: "actor-a",
      updates: [
        {
          objectId: ids.rectangle,
          patch: {
            geometry: {
              ...rectangle().geometry,
              origin: { x: 10, y: 0 },
            },
          },
        },
      ],
    },
    environment(),
  );

  assert.equal(state.objects[ids.rectangle].geometry.origin.x, 0);
  assert.equal(moved.state.objects[ids.rectangle].geometry.origin.x, 10);
  assert.equal(moved.state.objects[ids.rectangle].version, 2);
  assert.deepEqual(moved.operation.baseVersions, { [ids.rectangle]: 1 });
  assert.deepEqual(moved.operation.inverse, {
    type: "update_objects",
    updates: [
      {
        objectId: ids.rectangle,
        patch: {
          geometry: rectangle().geometry,
        },
      },
    ],
  });
});

test("update records and restores an object's trimmed name", () => {
  const state = emptyState({ objects: [rectangle()] });
  const renamed = applyDrawingCommand(
    state,
    {
      type: "update_objects",
      actorId: "actor-a",
      updates: [
        {
          objectId: ids.rectangle,
          baseVersion: 1,
          patch: { name: "Door outline" },
        },
      ],
    },
    environment(),
  );

  assert.equal(renamed.state.objects[ids.rectangle].name, "Door outline");
  assert.deepEqual(renamed.operation.inverse, {
    type: "update_objects",
    updates: [{ objectId: ids.rectangle, patch: { name: "Rectangle" } }],
  });
});

test("delete removes an object and records an add inverse", () => {
  const state = emptyState({ objects: [rectangle()] });
  const deleted = applyDrawingCommand(
    state,
    { type: "delete_objects", actorId: "actor-a", objectIds: [ids.rectangle] },
    environment(),
  );

  assert.equal(deleted.state.objects[ids.rectangle], undefined);
  assert.deepEqual(deleted.operation.inverse, {
    type: "add_objects",
    objects: [rectangle({ version: 3 })],
  });
  assert.deepEqual(deleted.operation.baseVersions, { [ids.rectangle]: 1 });
});

test("adding a copy uses its supplied new ID without changing the source object", () => {
  const source = rectangle();
  const copied = rectangle({ id: ids.copiedRectangle });
  const state = emptyState({ objects: [source] });
  const added = applyDrawingCommand(
    state,
    { type: "add_objects", actorId: "actor-a", objects: [copied] },
    environment(),
  );

  assert.deepEqual(added.state.objects[ids.rectangle], source);
  assert.deepEqual(added.state.objects[ids.copiedRectangle], copied);
  assert.deepEqual(added.operation.baseVersions, {});
});

test("object mutations on a locked layer fail with the domain lock error", () => {
  const locked = layer({ id: ids.lockedLayer, locked: true });
  const state = emptyState({
    layers: [layer(), locked],
    objects: [rectangle()],
  });

  for (const command of [
    {
      type: "add_objects",
      actorId: "actor-a",
      objects: [circle({ layerId: ids.lockedLayer })],
    },
    {
      type: "update_objects",
      actorId: "actor-a",
      updates: [
        { objectId: ids.rectangle, patch: { layerId: ids.lockedLayer } },
      ],
    },
    {
      type: "delete_objects",
      actorId: "actor-a",
      objectIds: [ids.rectangle],
    },
  ]) {
    const target =
      command.type === "delete_objects"
        ? emptyState({
            layers: [locked],
            objects: [rectangle({ layerId: ids.lockedLayer })],
          })
        : state;
    assert.throws(
      () => applyDrawingCommand(target, command, environment()),
      (error) =>
        error instanceof LockedDrawingLayerError &&
        error.code === "drawing_layer_locked",
    );
  }
});

test("undo appends an inverse without deleting another actor's separate command", () => {
  const env = environment();
  const addedByA = applyDrawingCommand(
    emptyState(),
    { type: "add_objects", actorId: "actor-a", objects: [rectangle()] },
    env,
  );
  const addedByB = applyDrawingCommand(
    addedByA.state,
    { type: "add_objects", actorId: "actor-b", objects: [circle()] },
    env,
  );
  const undone = undoDrawingCommand(addedByB.state, "actor-a", env);

  assert.equal(undone.operation.actorId, "actor-a");
  assert.equal(undone.operation.type, "delete_objects");
  assert.equal(undone.state.objects[ids.rectangle], undefined);
  assert.deepEqual(undone.state.objects[ids.circle], circle());
  assert.equal(
    undone.state.operations.some(
      (operation) => operation.actorId === "actor-b",
    ),
    true,
  );
});

test("add undo redo realizes exact tombstone bases and monotonic versions", () => {
  const env = environment();
  const added = applyDrawingCommand(
    emptyState(),
    { type: "add_objects", actorId: "actor-a", objects: [rectangle()] },
    env,
  );
  const undone = undoDrawingCommand(added.state, "actor-a", env);
  const redone = redoDrawingCommand(undone.state, "actor-a", env);

  assert.deepEqual(added.operation.realizedVersions, { [ids.rectangle]: 1 });
  assert.deepEqual(undone.operation.baseVersions, { [ids.rectangle]: 1 });
  assert.deepEqual(undone.operation.realizedVersions, { [ids.rectangle]: 2 });
  assert.deepEqual(redone.operation.baseVersions, { [ids.rectangle]: 2 });
  assert.deepEqual(redone.operation.forward, {
    type: "add_objects",
    objects: [rectangle({ version: 3 })],
  });
  assert.deepEqual(redone.operation.realizedVersions, { [ids.rectangle]: 3 });
  assert.equal(redone.state.objects[ids.rectangle].version, 3);
});

test("delete undo redo advances through tombstone restore and tombstone versions", () => {
  const env = environment();
  const initial = rectangle({ version: 7 });
  const deleted = applyDrawingCommand(
    emptyState({ objects: [initial] }),
    { type: "delete_objects", actorId: "actor-a", objectIds: [ids.rectangle] },
    env,
  );
  const restored = undoDrawingCommand(deleted.state, "actor-a", env);
  const deletedAgain = redoDrawingCommand(restored.state, "actor-a", env);
  const restoredAgain = undoDrawingCommand(deletedAgain.state, "actor-a", env);

  assert.deepEqual(deleted.operation.baseVersions, { [ids.rectangle]: 7 });
  assert.deepEqual(deleted.operation.realizedVersions, { [ids.rectangle]: 8 });
  assert.deepEqual(restored.operation.baseVersions, { [ids.rectangle]: 8 });
  assert.deepEqual(restored.operation.realizedVersions, { [ids.rectangle]: 9 });
  assert.equal(restored.state.objects[ids.rectangle].version, 9);
  assert.deepEqual(deletedAgain.operation.baseVersions, {
    [ids.rectangle]: 9,
  });
  assert.deepEqual(deletedAgain.operation.realizedVersions, {
    [ids.rectangle]: 10,
  });
  assert.equal(deletedAgain.state.objects[ids.rectangle], undefined);
  assert.deepEqual(restoredAgain.operation.baseVersions, {
    [ids.rectangle]: 10,
  });
  assert.deepEqual(restoredAgain.operation.realizedVersions, {
    [ids.rectangle]: 11,
  });
  assert.equal(restoredAgain.state.objects[ids.rectangle].version, 11);
});

test("undo returns a conflict when another actor changed its target object", () => {
  const env = environment();
  const addedByA = applyDrawingCommand(
    emptyState(),
    { type: "add_objects", actorId: "actor-a", objects: [rectangle()] },
    env,
  );
  const changedByB = applyDrawingCommand(
    addedByA.state,
    {
      type: "update_objects",
      actorId: "actor-b",
      updates: [
        {
          objectId: ids.rectangle,
          patch: {
            geometry: { ...rectangle().geometry, origin: { x: 10, y: 0 } },
          },
        },
      ],
    },
    env,
  );
  const undone = undoDrawingCommand(changedByB.state, "actor-a", env);

  assert.deepEqual(undone, { kind: "conflict", objectIds: [ids.rectangle] });
  assert.equal(changedByB.state.operations.length, 2);
});

test("undo then redo append new operations and keep the original history target", () => {
  const env = environment();
  const moved = applyDrawingCommand(
    emptyState({ objects: [rectangle()] }),
    {
      type: "update_objects",
      actorId: "actor-a",
      updates: [
        {
          objectId: ids.rectangle,
          patch: {
            geometry: { ...rectangle().geometry, origin: { x: 10, y: 0 } },
          },
        },
      ],
    },
    env,
  );
  const undone = undoDrawingCommand(moved.state, "actor-a", env);
  const redone = redoDrawingCommand(undone.state, "actor-a", env);

  assert.equal(undone.state.objects[ids.rectangle].geometry.origin.x, 0);
  assert.equal(undone.state.objects[ids.rectangle].version, 3);
  assert.equal(
    redone.operation.originalOperationId,
    moved.operation.clientOperationId,
  );
  assert.equal(redone.state.objects[ids.rectangle].geometry.origin.x, 10);
  assert.equal(redone.state.objects[ids.rectangle].version, 4);
  assert.equal(redone.state.operations.length, 3);
  assert.equal(redoDrawingCommand(redone.state, "actor-a", env), null);
});

test("a redone operation can be undone again without a false version conflict", () => {
  const env = environment();
  const moved = applyDrawingCommand(
    emptyState({ objects: [rectangle()] }),
    {
      type: "update_objects",
      actorId: "actor-a",
      updates: [
        {
          objectId: ids.rectangle,
          patch: {
            geometry: { ...rectangle().geometry, origin: { x: 10, y: 0 } },
          },
        },
      ],
    },
    env,
  );
  const firstUndo = undoDrawingCommand(moved.state, "actor-a", env);
  const redone = redoDrawingCommand(firstUndo.state, "actor-a", env);
  const secondUndo = undoDrawingCommand(redone.state, "actor-a", env);

  assert.equal(secondUndo.kind, undefined);
  assert.equal(secondUndo.state.objects[ids.rectangle].geometry.origin.x, 0);
  assert.equal(secondUndo.state.objects[ids.rectangle].version, 5);
});

test("redo reapplies a version-aware selection move against the post-undo version", () => {
  const env = environment();
  const state = emptyState({ objects: [rectangle()] });
  const command = drawingCommands.moveDrawingSelection(
    state,
    [ids.rectangle],
    "actor-a",
    { x: 10, y: 0 },
  );
  const moved = applyDrawingCommand(state, command, env);
  const undone = undoDrawingCommand(moved.state, "actor-a", env);
  const redone = redoDrawingCommand(undone.state, "actor-a", env);

  assert.equal(redone.state.objects[ids.rectangle].geometry.origin.x, 10);
  assert.equal(redone.state.objects[ids.rectangle].version, 4);
});

test("update_layer appends a valid inverse and supports actor-scoped undo and redo", () => {
  const env = environment();
  const updated = applyDrawingCommand(
    emptyState(),
    {
      type: "update_layer",
      actorId: "actor-a",
      layerId: ids.layer,
      patch: { name: "Review notes" },
    },
    env,
  );
  const undone = undoDrawingCommand(updated.state, "actor-a", env);
  const redone = redoDrawingCommand(undone.state, "actor-a", env);

  assert.deepEqual(updated.operation.baseVersions, { [ids.layer]: 1 });
  assert.deepEqual(updated.operation.inverse, {
    type: "update_layer",
    layerId: ids.layer,
    patch: { name: "Annotations" },
  });
  assert.equal(undone.operation.type, "update_layer");
  assert.equal(undone.state.layers[ids.layer].name, "Annotations");
  assert.equal(undone.state.layers[ids.layer].version, 3);
  assert.equal(redone.state.layers[ids.layer].name, "Review notes");
  assert.equal(redone.state.layers[ids.layer].version, 4);
});

test("undo of a layer update conflicts when another actor changed that layer", () => {
  const env = environment();
  const updatedByA = applyDrawingCommand(
    emptyState(),
    {
      type: "update_layer",
      actorId: "actor-a",
      layerId: ids.layer,
      patch: { name: "Review notes" },
    },
    env,
  );
  const updatedByB = applyDrawingCommand(
    updatedByA.state,
    {
      type: "update_layer",
      actorId: "actor-b",
      layerId: ids.layer,
      patch: { name: "Final notes" },
    },
    env,
  );

  assert.deepEqual(undoDrawingCommand(updatedByB.state, "actor-a", env), {
    kind: "conflict",
    objectIds: [ids.layer],
  });
});

test("add_layer remains non-undoable without a delete_layer command", () => {
  const added = applyDrawingCommand(
    createDrawingDocumentState({ revisionId: ids.revision }),
    {
      type: "add_layer",
      actorId: "actor-a",
      layer: {
        id: ids.layer,
        name: "Annotations",
        visible: true,
        locked: false,
        version: 1,
      },
    },
    environment(),
  );

  assert.equal(added.state.layers[ids.layer].systemKind, "custom");
  assert.equal(undoDrawingCommand(added.state, "actor-a", environment()), null);
});

test("layer commands trim unique names and preserve one active editable user layer", () => {
  const sourceId = "00000000-0000-4000-8000-000000000020";
  const workId = "00000000-0000-4000-8000-000000000021";
  const customId = "00000000-0000-4000-8000-000000000022";
  const state = createDrawingDocumentState({
    revisionId: ids.revision,
    layers: [
      layer({
        id: sourceId,
        name: "Source",
        locked: true,
        systemKind: "source",
      }),
      layer({ id: workId, name: "Work", systemKind: "work" }),
    ],
  });
  const add = drawingCommands.createDrawingLayerCommand(
    state,
    "actor-a",
    "  Details  ",
    () => customId,
  );
  assert.deepEqual(add, {
    type: "add_layer",
    actorId: "actor-a",
    layer: {
      id: customId,
      name: "Details",
      visible: true,
      locked: false,
      version: 1,
    },
  });
  const added = applyDrawingCommand(state, add, environment());
  assert.equal(
    drawingCommands.resolveActiveDrawingLayerId(added.state.layers, customId),
    customId,
  );
  assert.throws(() =>
    drawingCommands.createDrawingLayerCommand(
      added.state,
      "actor-a",
      " Details ",
      () => "00000000-0000-4000-8000-000000000023",
    ),
  );
  assert.throws(() =>
    drawingCommands.updateDrawingLayerCommand(state, "actor-a", sourceId, {
      visible: false,
    }),
  );
  assert.throws(() =>
    drawingCommands.updateDrawingLayerCommand(state, "actor-a", workId, {
      locked: true,
    }),
  );

  const hiddenWork = applyDrawingCommand(
    added.state,
    drawingCommands.updateDrawingLayerCommand(added.state, "actor-a", workId, {
      visible: false,
    }),
    environment(),
  );
  assert.equal(
    drawingCommands.resolveActiveDrawingLayerId(
      hiddenWork.state.layers,
      workId,
    ),
    customId,
  );
});

test("inspector builds one version-aware all-or-nothing multi-object command", () => {
  const secondLayerId = "00000000-0000-4000-8000-000000000024";
  const state = emptyState({
    layers: [layer(), layer({ id: secondLayerId, name: "Details" })],
    objects: [
      rectangle(),
      circle({ style: { stroke: "#445566", strokeWidth: 4, fill: "#ffffff" } }),
    ],
  });
  const command = drawingCommands.updateDrawingSelectionProperties(
    state,
    [ids.rectangle, ids.circle],
    "actor-a",
    { layerId: secondLayerId, stroke: "#abcdef", strokeWidth: 3, fill: null },
  );

  assert.deepEqual(command, {
    type: "update_objects",
    actorId: "actor-a",
    updates: [
      {
        objectId: ids.rectangle,
        baseVersion: 1,
        patch: {
          layerId: secondLayerId,
          style: { stroke: "#abcdef", strokeWidth: 3, fill: null },
        },
      },
      {
        objectId: ids.circle,
        baseVersion: 1,
        patch: {
          layerId: secondLayerId,
          style: { stroke: "#abcdef", strokeWidth: 3, fill: null },
        },
      },
    ],
  });
  assert.throws(() =>
    drawingCommands.updateDrawingSelectionProperties(
      state,
      [ids.rectangle, "missing"],
      "actor-a",
      { strokeWidth: 2 },
    ),
  );
  for (const patch of [
    { name: "  " },
    { stroke: "red" },
    { strokeWidth: Number.POSITIVE_INFINITY },
    { fill: "#xyzxyz" },
  ]) {
    assert.throws(() =>
      drawingCommands.updateDrawingSelectionProperties(
        state,
        [ids.rectangle],
        "actor-a",
        patch,
      ),
    );
  }
});

test("inspector text changes are available only when every target is text", () => {
  const textObject = rectangle({
    name: "Text",
    geometry: {
      type: "text",
      origin: { x: 1, y: 2 },
      width: 80,
      text: "old",
    },
  });
  const state = emptyState({ objects: [textObject] });
  const command = drawingCommands.updateDrawingSelectionProperties(
    state,
    [ids.rectangle],
    "actor-a",
    { text: "new" },
  );
  assert.deepEqual(command.updates[0].patch.geometry, {
    ...textObject.geometry,
    text: "new",
  });
  assert.throws(() =>
    drawingCommands.updateDrawingSelectionProperties(
      emptyState({ objects: [rectangle()] }),
      [ids.rectangle],
      "actor-a",
      { text: "new" },
    ),
  );
});

const snap = {
  gridSize: 10,
  objectCandidates: [{ x: 21, y: 19 }],
  tolerancePixels: 3,
  zoom: 1,
};

function commitOptions(overrides = {}) {
  return {
    actorId: "actor-a",
    layerId: ids.layer,
    objectId: "00000000-0000-4000-8000-000000000020",
    repeatMode: false,
    snap,
    ...overrides,
  };
}

test("line click-click snaps both committed points and emits one add command", () => {
  const started = drawingTools.beginDrawingToolSession(
    "line",
    { x: 2, y: 1 },
    snap,
  );
  const completed = drawingTools.commitDrawingPoint(
    started,
    { x: 19, y: 18 },
    commitOptions(),
  );

  assert.deepEqual(completed.command.objects[0].geometry, {
    type: "line",
    start: { x: 0, y: 0 },
    end: { x: 21, y: 19 },
  });
  assert.deepEqual(completed.session, { tool: "idle" });
  assert.equal(completed.nextTool, "select");
});

test("polyline multi-click plus Enter snaps every vertex into one command", () => {
  let session = drawingTools.beginDrawingToolSession(
    "polyline",
    { x: 1, y: 2 },
    snap,
  );
  session = drawingTools.commitDrawingPoint(
    session,
    { x: 19, y: 18 },
    commitOptions(),
  ).session;
  session = drawingTools.commitDrawingPoint(
    session,
    { x: 31, y: 39 },
    commitOptions(),
  ).session;
  const completed = drawingTools.completeDrawingToolSession(
    session,
    commitOptions(),
  );

  assert.deepEqual(completed.command.objects[0].geometry, {
    type: "polyline",
    points: [
      { x: 0, y: 0 },
      { x: 21, y: 19 },
      { x: 30, y: 40 },
    ],
    closed: false,
  });
  assert.equal(completed.command.objects.length, 1);
});

test("rectangle drag normalizes an up-left drag after snapping", () => {
  const started = drawingTools.beginDrawingToolSession(
    "rectangle",
    { x: 31, y: 39 },
    snap,
  );
  const completed = drawingTools.commitDrawingPoint(
    started,
    { x: 2, y: 1 },
    commitOptions(),
  );

  assert.deepEqual(completed.command.objects[0].geometry, {
    type: "rectangle",
    origin: { x: 0, y: 0 },
    width: 30,
    height: 40,
    rotation: 0,
  });
});

test("circle center-radius drag commits the snapped Euclidean radius", () => {
  const started = drawingTools.beginDrawingToolSession(
    "circle",
    { x: 1, y: 2 },
    snap,
  );
  const completed = drawingTools.commitDrawingPoint(
    started,
    { x: 31, y: 39 },
    commitOptions(),
  );

  assert.deepEqual(completed.command.objects[0].geometry, {
    type: "circle",
    center: { x: 0, y: 0 },
    radius: 50,
  });
});

test("text Enter ignores empty input and commits non-empty text at a snapped origin", () => {
  const session = drawingTools.beginDrawingToolSession(
    "text",
    { x: 19, y: 18 },
    snap,
  );
  assert.equal(
    drawingTools.completeDrawingToolSession(
      session,
      commitOptions({ text: "   " }),
    ).command,
    null,
  );
  const completed = drawingTools.completeDrawingToolSession(
    session,
    commitOptions({ text: "  현장 메모  " }),
  );

  assert.deepEqual(completed.command.objects[0].geometry, {
    type: "text",
    origin: { x: 21, y: 19 },
    text: "현장 메모",
    width: 160,
  });
});

test("dimension commits explicit calibrated or visibly uncalibrated evidence", () => {
  const calibrationId = "00000000-0000-4000-8000-000000000099";
  for (const expected of [calibrationId, null]) {
    const started = drawingTools.beginDrawingToolSession(
      "dimension",
      { x: 2, y: 1 },
      snap,
    );
    const completed = drawingTools.commitDrawingPoint(
      started,
      { x: 31, y: 39 },
      commitOptions({ calibrationId: expected }),
    );
    assert.deepEqual(completed.command.objects[0].geometry, {
      type: "dimension",
      start: { x: 0, y: 0 },
      end: { x: 30, y: 40 },
      offset: 12,
      calibrationId: expected,
    });
    assert.equal(
      drawingTools.dimensionLabel(
        completed.command.objects[0].geometry,
        expected === null
          ? null
          : {
              id: calibrationId,
              millimetersPerNormalizedUnit: 100,
              pageHeight: 100,
              pageWidth: 100,
            },
      ),
      expected === null ? "미보정" : "50.0 mm",
    );
    if (expected !== null) {
      assert.equal(
        drawingTools.dimensionLabel(completed.command.objects[0].geometry),
        "보정 확인 불가",
      );
    }
  }
});

test("dimension adapter applies the canonical perpendicular offset", () => {
  assert.deepEqual(
    drawingTools.dimensionDisplayPoints({
      type: "dimension",
      start: { x: 0, y: 0 },
      end: { x: 10, y: 0 },
      offset: 4,
      calibrationId: null,
    }),
    {
      displayStart: { x: 0, y: 4 },
      displayEnd: { x: 10, y: 4 },
      label: { x: 5, y: 4 },
    },
  );
});

test("Shift constrains line and dimension endpoints to 45-degree increments", () => {
  for (const tool of ["line", "dimension"]) {
    const session = drawingTools.beginDrawingToolSession(
      tool,
      { x: 0, y: 0 },
      { ...snap, gridSize: 0, objectCandidates: [] },
    );
    const completed = drawingTools.commitDrawingPoint(
      session,
      { x: 9, y: 4 },
      commitOptions({
        constrain: true,
        snap: { ...snap, gridSize: 0, objectCandidates: [] },
      }),
    );
    assert.ok(
      Math.abs(completed.command.objects[0].geometry.end.x - 6.964) < 0.001,
    );
    assert.ok(
      Math.abs(completed.command.objects[0].geometry.end.y - 6.964) < 0.001,
    );
  }
});

test("Escape cancels without a command and Backspace removes the last polyline point", () => {
  let session = drawingTools.beginDrawingToolSession(
    "polyline",
    { x: 1, y: 2 },
    snap,
  );
  session = drawingTools.commitDrawingPoint(
    session,
    { x: 31, y: 39 },
    commitOptions(),
  ).session;
  assert.deepEqual(drawingTools.removeLastPolylinePoint(session), {
    tool: "polyline",
    points: [{ x: 0, y: 0 }],
  });
  assert.deepEqual(drawingTools.cancelDrawingToolSession(), {
    command: null,
    nextTool: "select",
    session: { tool: "idle" },
  });
});

test("repeat mode keeps the completed drawing tool active", () => {
  const completed = drawingTools.commitDrawingPoint(
    drawingTools.beginDrawingToolSession("line", { x: 0, y: 0 }, snap),
    { x: 20, y: 20 },
    commitOptions({ repeatMode: true }),
  );
  assert.equal(completed.nextTool, "line");
});

function controllerContext(overrides = {}) {
  return {
    activeTool: "line",
    actorId: "actor-a",
    calibrationId: null,
    canEdit: true,
    layerId: ids.layer,
    objectId: "00000000-0000-4000-8000-000000000020",
    repeatMode: false,
    snap: {
      gridSize: 10,
      objectCandidates: [{ x: 21, y: 19 }],
      tolerancePixels: 6,
    },
    viewport: { x: 100, y: 50, zoom: 2 },
    ...overrides,
  };
}

function controllerState(overrides = {}) {
  return drawingTools.createDrawingToolControllerState(
    controllerContext(overrides),
  );
}

test("tool event adapter converts Stage-relative screen points to world points before canonical snap", () => {
  let state = controllerState();
  let result = drawingTools.drawingToolEventTransition(
    state,
    {
      type: "pointer_down",
      button: 0,
      pointerId: 7,
      screenPoint: { x: 104, y: 52 },
      shiftKey: false,
    },
    controllerContext(),
  );
  state = result.state;
  assert.deepEqual(state.session, {
    tool: "line",
    start: { x: 0, y: 0 },
  });
  result = drawingTools.drawingToolEventTransition(
    state,
    {
      type: "pointer_down",
      button: 0,
      pointerId: 7,
      screenPoint: { x: 140, y: 88 },
      shiftKey: false,
    },
    controllerContext(),
  );
  assert.deepEqual(result.command.objects[0].geometry, {
    type: "line",
    start: { x: 0, y: 0 },
    end: { x: 21, y: 19 },
  });
});

test("tool event adapter models drag preview and pointer capture through release", () => {
  const context = controllerContext({
    activeTool: "rectangle",
    viewport: { x: 0, y: 0, zoom: 1 },
  });
  let result = drawingTools.drawingToolEventTransition(
    drawingTools.createDrawingToolControllerState(context),
    {
      type: "pointer_down",
      button: 0,
      pointerId: 9,
      screenPoint: { x: 31, y: 39 },
      shiftKey: false,
    },
    context,
  );
  assert.deepEqual(result.pointerCapture, { type: "set", pointerId: 9 });
  result = drawingTools.drawingToolEventTransition(
    result.state,
    {
      type: "pointer_move",
      pointerId: 9,
      screenPoint: { x: 2, y: 1 },
      shiftKey: false,
    },
    context,
  );
  assert.deepEqual(result.state.previewPoint, { x: 0, y: 0 });
  result = drawingTools.drawingToolEventTransition(
    result.state,
    {
      type: "pointer_up",
      pointerId: 9,
      screenPoint: { x: 2, y: 1 },
      shiftKey: false,
    },
    context,
  );
  assert.deepEqual(result.pointerCapture, { type: "release", pointerId: 9 });
  assert.deepEqual(result.command.objects[0].geometry, {
    type: "rectangle",
    origin: { x: 0, y: 0 },
    width: 30,
    height: 40,
    rotation: 0,
  });
});

test("tool event adapter ignores Chrome pointer detail and commits one terminal polyline vertex", () => {
  const context = controllerContext({
    activeTool: "polyline",
    viewport: { x: 0, y: 0, zoom: 1 },
  });
  let result = drawingTools.drawingToolEventTransition(
    drawingTools.createDrawingToolControllerState(context),
    {
      type: "pointer_down",
      button: 0,
      pointerId: 1,
      screenPoint: { x: 1, y: 2 },
      shiftKey: false,
    },
    context,
  );
  assert.equal(result.command, null);
  // Chrome reports both pointer-downs in the terminal double-click as zero.
  const commands = [];
  for (let click = 0; click < 2; click += 1) {
    result = drawingTools.drawingToolEventTransition(
      result.state,
      {
        type: "pointer_down",
        button: 0,
        detail: 0,
        pointerId: 1,
        screenPoint: { x: 19, y: 18 },
        shiftKey: false,
      },
      context,
    );
    if (result.command) commands.push(result.command);
  }
  result = drawingTools.drawingToolEventTransition(
    result.state,
    { type: "double_click" },
    context,
  );
  if (result.command) commands.push(result.command);

  assert.equal(commands.length, 1);
  assert.deepEqual(commands[0].objects[0].geometry.points, [
    { x: 0, y: 0 },
    { x: 21, y: 19 },
  ]);
});

test("double-click cannot create a polyline command with fewer than two vertices", () => {
  const context = controllerContext({
    activeTool: "polyline",
    viewport: { x: 0, y: 0, zoom: 1 },
  });
  const oneVertex = drawingTools.drawingToolEventTransition(
    drawingTools.createDrawingToolControllerState(context),
    {
      type: "pointer_down",
      button: 0,
      pointerId: 1,
      screenPoint: { x: 1, y: 2 },
      shiftKey: false,
    },
    context,
  );
  const completed = drawingTools.drawingToolEventTransition(
    oneVertex.state,
    { type: "double_click" },
    context,
  );

  assert.equal(completed.command, null);
  assert.equal(
    drawingTools.drawingToolEventTransition(
      completed.state,
      { type: "double_click" },
      context,
    ).command,
    null,
  );
});

test("tool event adapter owns Enter, Backspace, Escape, and text submission", () => {
  const polylineContext = controllerContext({
    activeTool: "polyline",
    viewport: { x: 0, y: 0, zoom: 1 },
  });
  let state = drawingTools.createDrawingToolControllerState(polylineContext);
  for (const screenPoint of [
    { x: 0, y: 0 },
    { x: 20, y: 20 },
    { x: 30, y: 40 },
  ]) {
    state = drawingTools.drawingToolEventTransition(
      state,
      {
        type: "pointer_down",
        button: 0,
        pointerId: 1,
        screenPoint,
        shiftKey: false,
      },
      polylineContext,
    ).state;
  }
  state = drawingTools.drawingToolEventTransition(
    state,
    { type: "key_down", key: "Backspace" },
    polylineContext,
  ).state;
  assert.equal(state.session.points.length, 2);
  const entered = drawingTools.drawingToolEventTransition(
    state,
    { type: "key_down", key: "Enter" },
    polylineContext,
  );
  assert.equal(entered.command.objects[0].geometry.type, "polyline");

  const escaped = drawingTools.drawingToolEventTransition(
    drawingTools.drawingToolEventTransition(
      controllerState(),
      {
        type: "pointer_down",
        button: 0,
        pointerId: 1,
        screenPoint: { x: 100, y: 50 },
        shiftKey: false,
      },
      controllerContext(),
    ).state,
    { type: "key_down", key: "Escape" },
    controllerContext(),
  );
  assert.deepEqual(escaped.state.session, { tool: "idle" });
  assert.equal(escaped.command, null);
  assert.equal(escaped.nextTool, "select");

  const textContext = controllerContext({ activeTool: "text" });
  const textStarted = drawingTools.drawingToolEventTransition(
    drawingTools.createDrawingToolControllerState(textContext),
    {
      type: "pointer_down",
      button: 0,
      pointerId: 1,
      screenPoint: { x: 100, y: 50 },
      shiftKey: false,
    },
    textContext,
  );
  const textEntered = drawingTools.drawingToolEventTransition(
    textStarted.state,
    { type: "key_down", key: "Enter", text: "메모" },
    textContext,
  );
  assert.equal(textEntered.command.objects[0].geometry.text, "메모");
  assert.equal(
    drawingTools.drawingToolSessionOwnsKey(state, "Backspace"),
    true,
  );
  assert.equal(
    drawingTools.drawingToolSessionOwnsKey(textStarted.state, "Backspace"),
    true,
  );
  assert.equal(
    drawingTools.drawingToolSessionOwnsKey(
      drawingTools.createDrawingToolControllerState(textContext),
      "Backspace",
    ),
    false,
  );
});

test("edit downgrade invalidates a live tool session before any later commit", () => {
  const context = controllerContext();
  const started = drawingTools.drawingToolEventTransition(
    drawingTools.createDrawingToolControllerState(context),
    {
      type: "pointer_down",
      button: 0,
      pointerId: 1,
      screenPoint: { x: 100, y: 50 },
      shiftKey: false,
    },
    context,
  );
  const downgradedContext = controllerContext({
    canEdit: false,
    layerId: null,
  });
  const invalidated = drawingTools.drawingToolEventTransition(
    started.state,
    { type: "sync_context" },
    downgradedContext,
  );
  assert.deepEqual(invalidated.state.session, { tool: "idle" });
  assert.equal(invalidated.state.previewPoint, null);
  assert.equal(
    drawingTools.drawingToolEventTransition(
      started.state,
      {
        type: "pointer_down",
        button: 0,
        pointerId: 1,
        screenPoint: { x: 140, y: 90 },
        shiftKey: false,
      },
      downgradedContext,
    ).command,
    null,
  );
});

test("layer switch cancels drag and releases capture instead of committing into the new layer", () => {
  const firstContext = controllerContext({
    activeTool: "rectangle",
    viewport: { x: 0, y: 0, zoom: 1 },
  });
  const started = drawingTools.drawingToolEventTransition(
    drawingTools.createDrawingToolControllerState(firstContext),
    {
      type: "pointer_down",
      button: 0,
      pointerId: 12,
      screenPoint: { x: 30, y: 40 },
      shiftKey: false,
    },
    firstContext,
  );
  const secondContext = controllerContext({
    activeTool: "rectangle",
    layerId: "00000000-0000-4000-8000-000000000030",
    viewport: { x: 0, y: 0, zoom: 1 },
  });
  const invalidated = drawingTools.drawingToolEventTransition(
    started.state,
    { type: "sync_context" },
    secondContext,
  );
  assert.deepEqual(invalidated.state.session, { tool: "idle" });
  assert.deepEqual(invalidated.pointerCapture, {
    type: "release",
    pointerId: 12,
  });
  const released = drawingTools.drawingToolEventTransition(
    invalidated.state,
    {
      type: "pointer_up",
      pointerId: 12,
      screenPoint: { x: 0, y: 0 },
      shiftKey: false,
    },
    secondContext,
  );
  assert.equal(released.command, null);
});

function selectionContext(overrides = {}) {
  const selectableCircle = circle({
    geometry: { type: "circle", center: { x: 35, y: 15 }, radius: 5 },
  });
  return {
    actorId: "actor-a",
    canEdit: true,
    layers: {
      [ids.layer]: layer(),
      [ids.lockedLayer]: layer({ id: ids.lockedLayer, locked: true }),
      [ids.hiddenLayer]: layer({ id: ids.hiddenLayer, visible: false }),
    },
    objects: {
      [ids.rectangle]: rectangle(),
      [ids.circle]: selectableCircle,
      [ids.hiddenRectangle]: rectangle({
        id: ids.hiddenRectangle,
        layerId: ids.hiddenLayer,
      }),
      [ids.lockedRectangle]: rectangle({
        id: ids.lockedRectangle,
        layerId: ids.lockedLayer,
      }),
    },
    snap: { gridSize: 10 },
    viewport: { x: 100, y: 50, zoom: 2 },
    ...overrides,
  };
}

function selectionPointer(state, event, context = selectionContext()) {
  return drawingTools.drawingSelectionEventTransition(state, event, context);
}

test("selection adapter confirms candidate clicks against domain bounds and Shift toggles", () => {
  assert.equal(typeof drawingTools.createDrawingSelectionState, "function");
  assert.equal(typeof drawingTools.drawingSelectionEventTransition, "function");
  let state = drawingTools.createDrawingSelectionState();
  state = selectionPointer(state, {
    type: "pointer_down",
    candidateId: ids.rectangle,
    pointerId: 21,
    screenPoint: { x: 110, y: 60 },
    shiftKey: false,
  }).state;
  assert.deepEqual(state.selectedIds, [ids.rectangle]);

  state = selectionPointer(state, {
    type: "pointer_down",
    candidateId: ids.circle,
    pointerId: 22,
    screenPoint: { x: 170, y: 80 },
    shiftKey: true,
  }).state;
  assert.deepEqual(state.selectedIds, [ids.rectangle, ids.circle]);

  state = selectionPointer(state, {
    type: "pointer_down",
    candidateId: ids.rectangle,
    pointerId: 23,
    screenPoint: { x: 110, y: 60 },
    shiftKey: true,
  }).state;
  assert.deepEqual(state.selectedIds, [ids.circle]);

  state = selectionPointer(state, {
    type: "pointer_down",
    candidateId: ids.rectangle,
    pointerId: 24,
    screenPoint: { x: 190, y: 140 },
    shiftKey: false,
  }).state;
  assert.deepEqual(state.selectedIds, [ids.circle]);
});

test("marquee uses world-space intersection and canonical rotated bounds", () => {
  assert.equal(typeof drawingTools.drawingSelectionEventTransition, "function");
  const rotated = rectangle({
    geometry: {
      type: "rectangle",
      origin: { x: 0, y: 0 },
      width: 20,
      height: 10,
      rotation: 90,
    },
  });
  const context = selectionContext({
    objects: { [ids.rectangle]: rotated },
    viewport: { x: 0, y: 0, zoom: 1 },
  });
  let result = selectionPointer(
    drawingTools.createDrawingSelectionState(),
    {
      type: "pointer_down",
      candidateId: null,
      pointerId: 25,
      screenPoint: { x: -12, y: 8 },
      shiftKey: false,
    },
    context,
  );
  result = selectionPointer(
    result.state,
    {
      type: "pointer_move",
      pointerId: 25,
      screenPoint: { x: -8, y: 12 },
    },
    context,
  );
  assert.equal(result.command, null);
  result = selectionPointer(
    result.state,
    {
      type: "pointer_up",
      pointerId: 25,
      screenPoint: { x: -8, y: 12 },
    },
    context,
  );
  assert.deepEqual(result.state.selectedIds, [ids.rectangle]);
  assert.equal(result.state.marquee, null);
});

test("direct and marquee selection exclude hidden and locked layers", () => {
  assert.equal(typeof drawingTools.drawingSelectionEventTransition, "function");
  let state = drawingTools.createDrawingSelectionState();
  for (const candidateId of [ids.hiddenRectangle, ids.lockedRectangle]) {
    state = selectionPointer(state, {
      type: "pointer_down",
      candidateId,
      pointerId: 26,
      screenPoint: { x: 110, y: 60 },
      shiftKey: false,
    }).state;
    assert.deepEqual(state.selectedIds, []);
  }
  let result = selectionPointer(state, {
    type: "pointer_down",
    candidateId: null,
    pointerId: 27,
    screenPoint: { x: 98, y: 48 },
    shiftKey: false,
  });
  result = selectionPointer(result.state, {
    type: "pointer_move",
    pointerId: 27,
    screenPoint: { x: 142, y: 72 },
  });
  result = selectionPointer(result.state, {
    type: "pointer_up",
    pointerId: 27,
    screenPoint: { x: 142, y: 72 },
  });
  assert.deepEqual(result.state.selectedIds, [ids.rectangle]);
});

test("selection drag keeps preview transient and emits one snapped multi-object update", () => {
  assert.equal(typeof drawingTools.drawingSelectionEventTransition, "function");
  const context = selectionContext({ viewport: { x: 0, y: 0, zoom: 1 } });
  let state = {
    ...drawingTools.createDrawingSelectionState(),
    selectedIds: [ids.rectangle, ids.circle],
  };
  let result = selectionPointer(
    state,
    {
      type: "pointer_down",
      candidateId: ids.rectangle,
      pointerId: 28,
      screenPoint: { x: 5, y: 5 },
      shiftKey: false,
    },
    context,
  );
  result = selectionPointer(
    result.state,
    {
      type: "pointer_move",
      pointerId: 28,
      screenPoint: { x: 16, y: 5 },
    },
    context,
  );
  assert.equal(result.command, null);
  assert.deepEqual(result.state.previewDelta, { x: 10, y: 0 });
  assert.deepEqual(context.objects[ids.rectangle].geometry.origin, {
    x: 0,
    y: 0,
  });
  result = selectionPointer(
    result.state,
    {
      type: "pointer_up",
      pointerId: 28,
      screenPoint: { x: 16, y: 5 },
    },
    context,
  );
  assert.equal(result.command.type, "update_objects");
  assert.equal(result.command.updates.length, 2);
  assert.deepEqual(result.command.updates[0], {
    objectId: ids.rectangle,
    baseVersion: 1,
    patch: {
      geometry: {
        ...rectangle().geometry,
        origin: { x: 10, y: 0 },
      },
    },
  });
  assert.deepEqual(result.command.updates[1].patch.geometry.center, {
    x: 45,
    y: 15,
  });
  assert.equal(result.state.drag, null);
  assert.deepEqual(result.state.previewDelta, { x: 0, y: 0 });
});

function beginMultiObjectSelectionDrag(context = selectionContext()) {
  return selectionPointer(
    {
      ...drawingTools.createDrawingSelectionState(),
      selectedIds: [ids.rectangle, ids.circle],
    },
    {
      type: "pointer_down",
      candidateId: ids.rectangle,
      pointerId: 29,
      screenPoint: { x: 110, y: 60 },
      shiftKey: false,
    },
    context,
  );
}

function finishMultiObjectSelectionDrag(state, context) {
  return selectionPointer(
    state,
    {
      type: "pointer_up",
      pointerId: 29,
      screenPoint: { x: 130, y: 60 },
    },
    context,
  );
}

test("drag snapshots selected versions and rejects a mid-drag version change", () => {
  const context = selectionContext();
  const started = beginMultiObjectSelectionDrag(context);
  assert.deepEqual(
    started.state.drag.snapshots.map(({ id, version }) => ({ id, version })),
    [
      { id: ids.rectangle, version: 1 },
      { id: ids.circle, version: 1 },
    ],
  );
  const changed = {
    ...context,
    objects: {
      ...context.objects,
      [ids.rectangle]: { ...context.objects[ids.rectangle], version: 2 },
    },
  };
  const finished = finishMultiObjectSelectionDrag(started.state, changed);
  assert.equal(finished.command, null);
  assert.equal(finished.state.drag, null);
});

test("drag rejects same-version geometry replacement instead of moving newer geometry", () => {
  const context = selectionContext();
  const started = beginMultiObjectSelectionDrag(context);
  const changed = {
    ...context,
    objects: {
      ...context.objects,
      [ids.circle]: {
        ...context.objects[ids.circle],
        geometry: {
          ...context.objects[ids.circle].geometry,
          center: { x: 45, y: 15 },
        },
      },
    },
  };
  const finished = finishMultiObjectSelectionDrag(started.state, changed);
  assert.equal(finished.command, null);
  assert.equal(finished.state.drag, null);
});

test("drag sync releases capture when one snapshot layer becomes ineligible", () => {
  const secondLayerId = "00000000-0000-4000-8000-000000000031";
  const base = selectionContext();
  const context = {
    ...base,
    layers: {
      ...base.layers,
      [secondLayerId]: layer({ id: secondLayerId }),
    },
    objects: {
      ...base.objects,
      [ids.circle]: { ...base.objects[ids.circle], layerId: secondLayerId },
    },
  };
  const started = beginMultiObjectSelectionDrag(context);
  const changed = {
    ...context,
    layers: {
      ...context.layers,
      [secondLayerId]: { ...context.layers[secondLayerId], locked: true },
    },
  };
  const synced = selectionPointer(
    started.state,
    { type: "sync_context" },
    changed,
  );
  assert.equal(synced.command, null);
  assert.equal(synced.state.drag, null);
  assert.deepEqual(synced.pointerCapture, { type: "release", pointerId: 29 });
});

test("selection handles stay screen-sized across zoom levels", () => {
  assert.equal(typeof drawingTools.drawingSelectionHandleSize, "function");
  assert.equal(drawingTools.drawingSelectionHandleSize(0.5), 16);
  assert.equal(drawingTools.drawingSelectionHandleSize(4), 2);
});

test("selection hit bounds expand thin canonical bounds by a fixed screen tolerance", () => {
  assert.equal(typeof drawingTools.drawingSelectionHitBounds, "function");
  const cases = [
    {
      geometry: {
        type: "text",
        origin: { x: 10, y: 20 },
        width: 40,
        text: "note",
      },
      expected: { x: 4, y: 14, width: 52, height: 12 },
    },
    {
      geometry: {
        type: "line",
        start: { x: 0, y: 5 },
        end: { x: 20, y: 5 },
      },
      expected: { x: -6, y: -1, width: 32, height: 12 },
    },
    {
      geometry: {
        type: "line",
        start: { x: 5, y: 0 },
        end: { x: 5, y: 20 },
      },
      expected: { x: -1, y: -6, width: 12, height: 32 },
    },
    {
      geometry: {
        type: "polyline",
        points: [
          { x: 7, y: 0 },
          { x: 7, y: 20 },
        ],
        closed: false,
      },
      expected: { x: 1, y: -6, width: 12, height: 32 },
    },
    {
      geometry: {
        type: "rectangle",
        origin: { x: 0, y: 0 },
        width: 20,
        height: 10,
        rotation: 90,
      },
      expected: { x: -16, y: -6, width: 22, height: 32 },
    },
  ];
  for (const { geometry, expected } of cases)
    assert.deepEqual(
      drawingTools.drawingSelectionHitBounds(geometry, 1),
      expected,
    );
  assert.deepEqual(
    drawingTools.drawingSelectionHitBounds(cases[0].geometry, 2),
    { x: 7, y: 17, width: 46, height: 6 },
  );
  assert.deepEqual(
    drawingTools.drawingSelectionHitBounds(cases[0].geometry, 0.5),
    { x: -2, y: 8, width: 64, height: 24 },
  );
});

test("selection candidates expand hits only after hidden and locked exclusion", () => {
  assert.equal(typeof drawingTools.drawingSelectionCandidates, "function");
  const context = selectionContext();
  assert.deepEqual(
    drawingTools
      .drawingSelectionCandidates(
        Object.values(context.objects),
        context.layers,
        2,
      )
      .map((candidate) => candidate.id),
    [ids.rectangle, ids.circle],
  );
});

test("arrow moves use millimeters and mutation commands filter locked or hidden objects", () => {
  assert.equal(typeof drawingCommands.moveDrawingSelection, "function");
  const context = selectionContext();
  const state = createDrawingDocumentState({
    revisionId: ids.revision,
    layers: Object.values(context.layers),
    objects: Object.values(context.objects),
  });
  const command = drawingCommands.moveDrawingSelection(
    state,
    [ids.rectangle, ids.hiddenRectangle, ids.lockedRectangle],
    "actor-a",
    { x: -10, y: 0 },
  );
  assert.deepEqual(command.updates, [
    {
      objectId: ids.rectangle,
      baseVersion: 1,
      patch: {
        geometry: {
          ...rectangle().geometry,
          origin: { x: -10, y: 0 },
        },
      },
    },
  ]);
});

test("copy strips identity and paste creates strict fresh objects at 20 mm", () => {
  assert.equal(typeof drawingCommands.copyDrawingSelection, "function");
  assert.equal(typeof drawingCommands.pasteDrawingClipboard, "function");
  const source = rectangle();
  const state = emptyState({ objects: [source] });
  const clipboard = drawingCommands.copyDrawingSelection(state, [
    ids.rectangle,
  ]);
  assert.deepEqual(clipboard, {
    items: [
      {
        name: "Rectangle",
        layerId: ids.layer,
        geometry: rectangle().geometry,
        style: rectangle().style,
      },
    ],
  });
  const freshIds = ["00000000-0000-4000-8000-000000000040"];
  const pasted = drawingCommands.pasteDrawingClipboard(
    clipboard,
    "actor-a",
    () => freshIds.shift(),
  );
  assert.equal(pasted.objects[0].id, "00000000-0000-4000-8000-000000000040");
  assert.equal(pasted.objects[0].version, 1);
  assert.deepEqual(pasted.objects[0].geometry.origin, { x: 20, y: 20 });
  assert.deepEqual(Object.keys(pasted.objects[0]).sort(), [
    "geometry",
    "id",
    "layerId",
    "name",
    "style",
    "version",
  ]);
  assert.deepEqual(
    DrawingObjectSchema.strict().parse(pasted.objects[0]),
    pasted.objects[0],
  );
  assert.deepEqual(source.geometry.origin, { x: 0, y: 0 });
});

test("duplicate and Delete create add and delete commands without mutating originals", () => {
  assert.equal(typeof drawingCommands.duplicateDrawingSelection, "function");
  assert.equal(typeof drawingCommands.deleteDrawingSelection, "function");
  const state = emptyState({ objects: [rectangle()] });
  const freshIds = [
    "00000000-0000-4000-8000-000000000042",
    "00000000-0000-4000-8000-000000000043",
  ];
  const duplicate = drawingCommands.duplicateDrawingSelection(
    state,
    [ids.rectangle],
    "actor-a",
    () => freshIds.shift(),
  );
  assert.equal(duplicate.type, "add_objects");
  assert.equal(duplicate.objects[0].id, "00000000-0000-4000-8000-000000000042");
  assert.deepEqual(
    drawingCommands.deleteDrawingSelection(state, [ids.rectangle], "actor-a"),
    {
      type: "delete_objects",
      actorId: "actor-a",
      objectIds: [ids.rectangle],
    },
  );
  assert.deepEqual(state.objects[ids.rectangle], rectangle());
});

test("workspace shortcuts support Cmd and Ctrl variants with guarded focus", async () => {
  const shell = await vite.ssrLoadModule(
    "/app/lukas/components/drawing-workspace.client.tsx",
  );
  assert.equal(typeof shell.resolveDrawingWorkspaceShortcut, "function");
  const shortcut = (overrides = {}) =>
    shell.resolveDrawingWorkspaceShortcut({
      key: "c",
      code: "KeyC",
      altKey: false,
      ctrlKey: false,
      metaKey: true,
      shiftKey: false,
      target: null,
      ...overrides,
    });
  assert.deepEqual(shortcut(), { type: "copy" });
  assert.deepEqual(shortcut({ ctrlKey: true, metaKey: false, key: "v" }), {
    type: "paste",
  });
  assert.deepEqual(shortcut({ key: "d" }), { type: "duplicate" });
  assert.deepEqual(shortcut({ key: "z" }), { type: "undo" });
  assert.deepEqual(shortcut({ key: "Z", shiftKey: true }), { type: "redo" });
  assert.deepEqual(
    shortcut({
      key: "ArrowRight",
      code: "ArrowRight",
      metaKey: false,
      shiftKey: false,
    }),
    { type: "move", delta: { x: 1, y: 0 } },
  );
  assert.deepEqual(
    shortcut({
      key: "ArrowUp",
      code: "ArrowUp",
      metaKey: false,
      shiftKey: true,
    }),
    { type: "move", delta: { x: 0, y: -10 } },
  );
  assert.deepEqual(
    shortcut({ key: "Delete", code: "Delete", metaKey: false }),
    { type: "delete" },
  );
  assert.deepEqual(
    shortcut({ key: "Backspace", code: "Backspace", metaKey: false }),
    { type: "delete" },
  );
  for (const target of [
    { tagName: "INPUT", isContentEditable: false },
    { tagName: "TEXTAREA", isContentEditable: false },
    { tagName: "SELECT", isContentEditable: false },
    { tagName: "DIV", isContentEditable: true },
    {
      tagName: "BUTTON",
      isContentEditable: false,
      closest: (selector) => (selector.includes("role") ? {} : null),
    },
    {
      tagName: "BUTTON",
      isContentEditable: false,
      closest: (selector) =>
        selector === "[data-drawing-shortcuts='ignore']" ? {} : null,
    },
  ]) {
    assert.equal(shortcut({ target }), null);
    assert.equal(
      shortcut({
        key: "Backspace",
        code: "Backspace",
        metaKey: false,
        target,
      }),
      null,
    );
  }
  assert.equal(shortcut({ altKey: true }), null);
});

test("native dialog descendants own Backspace, Delete, and Cmd shortcuts", async () => {
  const shell = await vite.ssrLoadModule(
    "/app/lukas/components/drawing-workspace.client.tsx",
  );
  const nativeDialogButton = {
    tagName: "BUTTON",
    isContentEditable: false,
    closest: (selector) => (selector === "dialog" ? {} : null),
  };
  for (const event of [
    { key: "Backspace", metaKey: false },
    { key: "Delete", metaKey: false },
    { key: "c", metaKey: true },
  ]) {
    let defaultPrevented = false;
    const browserEvent = {
      code: event.key,
      altKey: false,
      ctrlKey: false,
      preventDefault: () => {
        defaultPrevented = true;
      },
      shiftKey: false,
      target: nativeDialogButton,
      ...event,
    };
    const shortcut = shell.resolveDrawingWorkspaceShortcut(browserEvent);
    if (shortcut) browserEvent.preventDefault();
    assert.equal(shortcut, null);
    assert.equal(defaultPrevented, false);
  }
  assert.deepEqual(
    shell.resolveDrawingWorkspaceShortcut({
      key: "Backspace",
      code: "Backspace",
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
      target: null,
    }),
    { type: "delete" },
  );
});

test("command registry filters Korean labels and stable IDs case-insensitively", async () => {
  const menu = await vite.ssrLoadModule(
    "/app/lukas/components/drawing-command-menu.tsx",
  );
  assert.deepEqual(
    menu
      .filterDrawingCommands(menu.DRAWING_COMMAND_REGISTRY, "사각형")
      .map((command) => command.id),
    ["rectangle"],
  );
  assert.deepEqual(
    menu
      .filterDrawingCommands(menu.DRAWING_COMMAND_REGISTRY, "ZOOM_TO")
      .map((command) => command.id),
    ["zoom_to_fit"],
  );
  assert.deepEqual(
    menu.DRAWING_COMMAND_REGISTRY.map((command) => command.id),
    [
      "select",
      "pan",
      "line",
      "polyline",
      "rectangle",
      "circle",
      "text",
      "dimension",
      "undo",
      "redo",
      "duplicate",
      "delete",
      "zoom_to_fit",
    ],
  );
});

test("command menu Enter only runs the selected enabled command and Escape closes", async () => {
  const menu = await vite.ssrLoadModule(
    "/app/lukas/components/drawing-command-menu.tsx",
  );
  const commands = [
    { id: "undo", label: "실행 취소", enabled: false },
    { id: "line", label: "선", enabled: true },
  ];
  assert.equal(menu.resolveDrawingCommandMenuKey("Enter", commands, 0), null);
  assert.deepEqual(menu.resolveDrawingCommandMenuKey("Enter", commands, 1), {
    kind: "run",
    commandId: "line",
  });
  assert.deepEqual(menu.resolveDrawingCommandMenuKey("Escape", commands, 1), {
    kind: "close",
  });
  assert.deepEqual(menu.resolveDrawingCommandDialogKey("Escape"), {
    kind: "close",
  });
  assert.equal(menu.resolveDrawingCommandDialogKey("Enter"), null);
});

test("editing context fails closed unless capability and an active layer both allow edits", async () => {
  const shell = await vite.ssrLoadModule(
    "/app/lukas/components/drawing-workspace.client.tsx",
  );
  const layers = [
    layer({ id: ids.lockedLayer, locked: true }),
    layer({ id: ids.layer, visible: false }),
    layer({
      id: "00000000-0000-4000-8000-000000000030",
      system_kind: "work",
    }),
  ];
  assert.deepEqual(shell.drawingEditingContext("editor", layers), {
    canEdit: true,
    layerId: "00000000-0000-4000-8000-000000000030",
  });
  assert.deepEqual(shell.drawingEditingContext("viewer", layers), {
    canEdit: false,
    layerId: null,
  });
  assert.deepEqual(
    shell.drawingEditingContext("admin", [layer({ locked: true })]),
    { canEdit: false, layerId: null },
  );
});
