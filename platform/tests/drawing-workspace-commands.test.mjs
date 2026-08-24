import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createServer } from "vite";
import {
  applyDrawingCommand,
  createDrawingDocumentState,
  LockedDrawingLayerError,
  redoDrawingCommand,
  undoDrawingCommand,
} from "../app/lukas/lib/drawing-commands.ts";

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
      patch: { visible: false },
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
    { type: "add_layer", actorId: "actor-a", layer: layer() },
    environment(),
  );

  assert.equal(undoDrawingCommand(added.state, "actor-a", environment()), null);
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
      detail: 1,
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
      detail: 1,
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
      detail: 1,
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

test("tool event adapter completes one polyline across click and double-click browser ordering", () => {
  const context = controllerContext({
    activeTool: "polyline",
    viewport: { x: 0, y: 0, zoom: 1 },
  });
  let state = drawingTools.createDrawingToolControllerState(context);
  for (const [detail, screenPoint] of [
    [1, { x: 1, y: 2 }],
    [1, { x: 19, y: 18 }],
    [1, { x: 31, y: 39 }],
  ]) {
    state = drawingTools.drawingToolEventTransition(
      state,
      {
        type: "pointer_down",
        button: 0,
        detail,
        pointerId: 1,
        screenPoint,
        shiftKey: false,
      },
      context,
    ).state;
  }
  const completed = drawingTools.drawingToolEventTransition(
    state,
    {
      type: "pointer_down",
      button: 0,
      detail: 2,
      pointerId: 1,
      screenPoint: { x: 31, y: 39 },
      shiftKey: false,
    },
    context,
  );
  assert.deepEqual(completed.command.objects[0].geometry.points, [
    { x: 0, y: 0 },
    { x: 21, y: 19 },
    { x: 30, y: 40 },
  ]);
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
        detail: 1,
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
        detail: 1,
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
      detail: 1,
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
});

test("edit downgrade invalidates a live tool session before any later commit", () => {
  const context = controllerContext();
  const started = drawingTools.drawingToolEventTransition(
    drawingTools.createDrawingToolControllerState(context),
    {
      type: "pointer_down",
      button: 0,
      detail: 1,
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
        detail: 1,
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
      detail: 1,
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
