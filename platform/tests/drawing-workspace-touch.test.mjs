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
const canvas = await vite.ssrLoadModule(
  "/app/lukas/components/drawing-canvas.client.tsx",
);
test.after(() => vite.close());

const viewport = { x: 10, y: 20, zoom: 2 };

test("one touch pointer remains a single selection gesture through release", () => {
  assert.equal(typeof canvas.createDrawingTouchGestureState, "function");
  assert.equal(typeof canvas.drawingTouchGestureTransition, "function");

  let state = canvas.createDrawingTouchGestureState();
  let result = canvas.drawingTouchGestureTransition(state, {
    type: "pointer_down",
    pointerId: 7,
    screenPoint: { x: 100, y: 120 },
    viewport,
  });
  assert.deepEqual(result.singleEvent, {
    type: "pointer_down",
    pointerId: 7,
    screenPoint: { x: 100, y: 120 },
  });
  assert.equal(result.cancelSinglePointerId, null);
  assert.equal(result.viewport, null);

  state = result.state;
  result = canvas.drawingTouchGestureTransition(state, {
    type: "pointer_move",
    pointerId: 7,
    screenPoint: { x: 130, y: 150 },
    viewport,
  });
  assert.deepEqual(result.singleEvent, {
    type: "pointer_move",
    pointerId: 7,
    screenPoint: { x: 130, y: 150 },
  });

  state = result.state;
  result = canvas.drawingTouchGestureTransition(state, {
    type: "pointer_up",
    pointerId: 7,
    screenPoint: { x: 130, y: 150 },
    viewport,
  });
  assert.deepEqual(result.singleEvent, {
    type: "pointer_up",
    pointerId: 7,
    screenPoint: { x: 130, y: 150 },
  });
  assert.deepEqual(result.state, canvas.createDrawingTouchGestureState());
});

test("second touch cancels selection, pinches around its midpoint, and suppresses phantom input", () => {
  let result = canvas.drawingTouchGestureTransition(
    canvas.createDrawingTouchGestureState(),
    {
      type: "pointer_down",
      pointerId: 1,
      screenPoint: { x: 100, y: 100 },
      viewport,
    },
  );
  result = canvas.drawingTouchGestureTransition(result.state, {
    type: "pointer_down",
    pointerId: 2,
    screenPoint: { x: 200, y: 100 },
    viewport,
  });
  assert.equal(result.cancelSinglePointerId, 1);
  assert.equal(result.singleEvent, null);

  result = canvas.drawingTouchGestureTransition(result.state, {
    type: "pointer_move",
    pointerId: 2,
    screenPoint: { x: 300, y: 100 },
    viewport,
  });
  assert.deepEqual(result.viewport, { x: -80, y: -60, zoom: 4 });
  assert.equal(result.singleEvent, null);

  result = canvas.drawingTouchGestureTransition(result.state, {
    type: "pointer_up",
    pointerId: 2,
    screenPoint: { x: 300, y: 100 },
    viewport: result.viewport,
  });
  assert.equal(result.singleEvent, null);
  result = canvas.drawingTouchGestureTransition(result.state, {
    type: "pointer_move",
    pointerId: 1,
    screenPoint: { x: 120, y: 120 },
    viewport,
  });
  assert.equal(result.singleEvent, null);
  assert.equal(result.viewport, null);
  result = canvas.drawingTouchGestureTransition(result.state, {
    type: "pointer_up",
    pointerId: 1,
    screenPoint: { x: 120, y: 120 },
    viewport,
  });
  assert.deepEqual(result.state, canvas.createDrawingTouchGestureState());

  result = canvas.drawingTouchGestureTransition(result.state, {
    type: "pointer_down",
    pointerId: 3,
    screenPoint: { x: 40, y: 50 },
    viewport,
  });
  assert.equal(result.singleEvent?.pointerId, 3);
});

test("pinch zoom uses the same finite limits as wheel zoom", () => {
  let result = canvas.drawingTouchGestureTransition(
    canvas.createDrawingTouchGestureState(),
    {
      type: "pointer_down",
      pointerId: 1,
      screenPoint: { x: 0, y: 0 },
      viewport: { x: 0, y: 0, zoom: 2 },
    },
  );
  result = canvas.drawingTouchGestureTransition(result.state, {
    type: "pointer_down",
    pointerId: 2,
    screenPoint: { x: 10, y: 0 },
    viewport: { x: 0, y: 0, zoom: 2 },
  });
  result = canvas.drawingTouchGestureTransition(result.state, {
    type: "pointer_move",
    pointerId: 2,
    screenPoint: { x: 1_000_000, y: 0 },
    viewport: { x: 0, y: 0, zoom: 2 },
  });
  assert.deepEqual(result.viewport, { x: 499_920, y: 0, zoom: 32 });
});

test("an unrelated third touch cannot terminate the active pinch", () => {
  let result = canvas.drawingTouchGestureTransition(
    canvas.createDrawingTouchGestureState(),
    {
      type: "pointer_down",
      pointerId: 1,
      screenPoint: { x: 100, y: 100 },
      viewport,
    },
  );
  result = canvas.drawingTouchGestureTransition(result.state, {
    type: "pointer_down",
    pointerId: 2,
    screenPoint: { x: 200, y: 100 },
    viewport,
  });
  result = canvas.drawingTouchGestureTransition(result.state, {
    type: "pointer_down",
    pointerId: 3,
    screenPoint: { x: 300, y: 100 },
    viewport,
  });
  result = canvas.drawingTouchGestureTransition(result.state, {
    type: "pointer_up",
    pointerId: 3,
    screenPoint: { x: 300, y: 100 },
    viewport,
  });
  result = canvas.drawingTouchGestureTransition(result.state, {
    type: "pointer_move",
    pointerId: 2,
    screenPoint: { x: 260, y: 100 },
    viewport,
  });

  assert.deepEqual(result.state.pinch?.pointerIds, [1, 2]);
  assert.notEqual(result.viewport, null);
  assert.equal(result.singleEvent, null);
});
