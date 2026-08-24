import assert from "node:assert/strict";
import test from "node:test";
import {
  applyDrawingCommand,
  createDrawingDocumentState,
  LockedDrawingLayerError,
  redoDrawingCommand,
  undoDrawingCommand,
} from "../app/lukas/lib/drawing-commands.ts";

const ids = {
  revision: "00000000-0000-4000-8000-000000000001",
  layer: "00000000-0000-4000-8000-000000000002",
  lockedLayer: "00000000-0000-4000-8000-000000000003",
  rectangle: "00000000-0000-4000-8000-000000000004",
  copiedRectangle: "00000000-0000-4000-8000-000000000005",
  circle: "00000000-0000-4000-8000-000000000006",
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
    version: 1,
    ...overrides,
  };
}

function rectangle(overrides = {}) {
  return {
    id: ids.rectangle,
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
    layerId: ids.layer,
    geometry: { type: "circle", center: { x: 10, y: 10 }, radius: 5 },
    style: { stroke: "#112233", strokeWidth: 2, fill: null },
    version: 1,
    ...overrides,
  };
}

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
  assert.deepEqual(added.operation.baseVersions, { [ids.rectangle]: 1 });
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
    objects: [rectangle()],
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

test("layer commands apply but are not undo candidates in this command union", () => {
  const env = environment();
  const addedLayer = applyDrawingCommand(
    createDrawingDocumentState({ revisionId: ids.revision }),
    { type: "add_layer", actorId: "actor-a", layer: layer() },
    env,
  );
  const lockedLayer = applyDrawingCommand(
    addedLayer.state,
    {
      type: "update_layer",
      actorId: "actor-a",
      layerId: ids.layer,
      patch: { locked: true },
    },
    env,
  );

  assert.equal(lockedLayer.state.layers[ids.layer].locked, true);
  assert.equal(undoDrawingCommand(lockedLayer.state, "actor-a", env), null);
});
