import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createServer } from "vite";

const vite = await createServer({
  appType: "custom",
  configFile: false,
  logLevel: "silent",
  resolve: {
    alias: { "~": fileURLToPath(new URL("../app", import.meta.url)) },
  },
  server: { middlewareMode: true },
});
const tools = await vite.ssrLoadModule(
  "/app/lukas/components/drawing-canvas.client.tsx",
);
test.after(() => vite.close());

const layerId = "10000000-0000-4000-8000-000000000001";
const wallId = "10000000-0000-4000-8000-000000000002";
const objectId = "10000000-0000-4000-8000-000000000003";
const wall = {
  id: wallId,
  name: "W-01",
  layerId,
  geometry: {
    type: "wall",
    semanticVersion: 1,
    start: { x: 0, y: 0 },
    end: { x: 4000, y: 0 },
    thicknessMillimeters: 200,
    heightMillimeters: 3000,
  },
  style: { stroke: "#0f172a", strokeWidth: 2, fill: null },
  version: 1,
};
const snap = {
  gridSize: 0,
  objectCandidates: [],
  tolerancePixels: 12,
  zoom: 1,
};

function options(overrides = {}) {
  return {
    actorId: "actor-a",
    layerId,
    objectId,
    objects: { [wallId]: wall },
    repeatMode: false,
    snap,
    ...overrides,
  };
}

function context(overrides = {}) {
  return {
    activeTool: "wall",
    actorId: "actor-a",
    calibrationId: null,
    canEdit: true,
    layerId,
    layers: { [layerId]: { visible: true, locked: false } },
    objectId,
    objects: { [wallId]: wall },
    repeatMode: false,
    snap: { gridSize: 0, objectCandidates: [], tolerancePixels: 12 },
    viewport: { x: 0, y: 0, zoom: 1 },
    ...overrides,
  };
}

function pointerDown(state, screenPoint, toolContext, shiftKey = false) {
  return tools.drawingToolEventTransition(
    state,
    {
      type: "pointer_down",
      button: 0,
      pointerId: 1,
      screenPoint,
      shiftKey,
    },
    toolContext,
  );
}

test("wall and grid use two points, semantic defaults, and the existing Shift constraint", () => {
  for (const tool of ["wall", "grid"]) {
    const session = tools.beginDrawingToolSession(tool, { x: 0, y: 0 }, snap);
    const completed = tools.commitDrawingPoint(
      session,
      { x: 900, y: 400 },
      options({ constrain: true }),
    );
    assert.equal(completed.command.type, "add_objects");
    assert.equal(completed.command.objects.length, 1);
    assert.equal(completed.command.objects[0].geometry.type, tool);
    assert.equal(
      completed.command.objects[0].geometry.end.x,
      completed.command.objects[0].geometry.end.y,
    );
    assert.equal(completed.command.objects[0].geometry.semanticVersion, 1);
  }
  const geometry = tools.commitDrawingPoint(
    tools.beginDrawingToolSession("wall", { x: 0, y: 0 }, snap),
    { x: 4000, y: 0 },
    options(),
  ).command.objects[0].geometry;
  assert.equal(geometry.thicknessMillimeters, 200);
  assert.equal(geometry.heightMillimeters, 3000);
});

test("opening selects the nearest eligible wall and emits one default hosted door", () => {
  const openingContext = context({ activeTool: "opening" });
  const result = pointerDown(
    tools.createDrawingToolControllerState(openingContext),
    { x: 1800, y: 8 },
    openingContext,
  );
  assert.equal(result.command.type, "add_objects");
  assert.equal(result.command.objects.length, 1);
  assert.deepEqual(result.command.objects[0].geometry, {
    type: "opening",
    semanticVersion: 1,
    hostWallId: wallId,
    offsetMillimeters: 1800,
    widthMillimeters: 900,
    heightMillimeters: 2100,
    sillHeightMillimeters: 0,
    openingKind: "door",
  });

  for (const blockedContext of [
    context({ activeTool: "opening", objects: {} }),
    context({ activeTool: "opening", lockedEntityIds: new Set([wallId]) }),
    context({
      activeTool: "opening",
      layers: { [layerId]: { visible: true, locked: true } },
    }),
  ]) {
    const blocked = pointerDown(
      tools.createDrawingToolControllerState(blockedContext),
      { x: 1800, y: 8 },
      blockedContext,
    );
    assert.equal(blocked.command, null);
    assert.deepEqual(blocked.state.session, { tool: "idle" });
  }
});

test("space and area collect points, support Backspace, and complete only valid closed boundaries", () => {
  for (const tool of ["space", "area"]) {
    const toolContext = context({ activeTool: tool });
    let result = pointerDown(
      tools.createDrawingToolControllerState(toolContext),
      { x: 0, y: 0 },
      toolContext,
    );
    for (const point of [
      { x: 1000, y: 0 },
      { x: 1000, y: 800 },
      { x: 0, y: 800 },
      { x: 0, y: 900 },
    ])
      result = pointerDown(result.state, point, toolContext);
    result = tools.drawingToolEventTransition(
      result.state,
      { type: "key_down", key: "Backspace" },
      toolContext,
    );
    assert.equal(result.state.session.points.length, 4);
    result = tools.drawingToolEventTransition(
      result.state,
      { type: "key_down", key: "Enter" },
      toolContext,
    );
    assert.equal(result.command.objects[0].geometry.type, tool);
    assert.equal(result.command.objects[0].geometry.boundary.length, 4);
    assert.equal(result.command.objects[0].geometry.semanticVersion, 1);
    if (tool === "space") {
      assert.equal(result.command.objects[0].geometry.number, "");
      assert.deepEqual(result.command.objects[0].geometry.finishes, {
        floor: null,
        wall: null,
        ceiling: null,
      });
    }
  }

  const areaContext = context({ activeTool: "area" });
  let invalid = tools.createDrawingToolControllerState(areaContext);
  for (const point of [
    { x: 0, y: 0 },
    { x: 1000, y: 1000 },
    { x: 0, y: 1000 },
    { x: 1000, y: 0 },
  ])
    invalid = pointerDown(invalid, point, areaContext).state;
  assert.equal(
    tools.drawingToolEventTransition(
      invalid,
      { type: "double_click" },
      areaContext,
    ).command,
    null,
  );
  assert.deepEqual(
    tools.drawingToolEventTransition(
      invalid,
      { type: "key_down", key: "Escape" },
      areaContext,
    ).state.session,
    { tool: "idle" },
  );
});

test("arc uses center, radius/start, and sweep/end without committing a zero sweep", () => {
  const arcContext = context({ activeTool: "arc" });
  let result = pointerDown(
    tools.createDrawingToolControllerState(arcContext),
    { x: 100, y: 100 },
    arcContext,
  );
  result = pointerDown(result.state, { x: 200, y: 100 }, arcContext);
  assert.equal(result.command, null);
  assert.equal(result.state.session.tool, "arc");
  assert.equal(result.state.session.radius, 100);
  result = pointerDown(result.state, { x: 100, y: 200 }, arcContext);
  assert.deepEqual(result.command.objects[0].geometry, {
    type: "arc",
    semanticVersion: 1,
    center: { x: 100, y: 100 },
    radius: 100,
    startAngleDegrees: 0,
    sweepAngleDegrees: 90,
  });

  let zero = pointerDown(
    tools.createDrawingToolControllerState(arcContext),
    { x: 100, y: 100 },
    arcContext,
  );
  zero = pointerDown(zero.state, { x: 200, y: 100 }, arcContext);
  zero = pointerDown(zero.state, { x: 200, y: 100 }, arcContext);
  assert.equal(zero.command, null);
});

test("semantic completion respects repeat mode and capability/layer downgrade cancellation", () => {
  const repeat = context({ activeTool: "grid", repeatMode: true });
  let result = pointerDown(
    tools.createDrawingToolControllerState(repeat),
    { x: 0, y: 0 },
    repeat,
  );
  result = pointerDown(result.state, { x: 1000, y: 0 }, repeat);
  assert.equal(result.nextTool, "grid");
  assert.equal(result.command.objects.length, 1);

  const wallContext = context({ activeTool: "wall" });
  const started = pointerDown(
    tools.createDrawingToolControllerState(wallContext),
    { x: 0, y: 0 },
    wallContext,
  );
  for (const downgraded of [
    context({ activeTool: "wall", canEdit: false, layerId: null }),
    context({
      activeTool: "wall",
      layerId: "10000000-0000-4000-8000-000000000099",
    }),
  ]) {
    const cancelled = tools.drawingToolEventTransition(
      started.state,
      { type: "sync_context" },
      downgraded,
    );
    assert.equal(cancelled.command, null);
    assert.deepEqual(cancelled.state.session, { tool: "idle" });
  }
});
