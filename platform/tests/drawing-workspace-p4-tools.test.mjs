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
const scaleControl = await vite.ssrLoadModule(
  "/app/lukas/components/drawing-scale-control.tsx",
);
const awareness = await vite.ssrLoadModule(
  "/app/lukas/lib/drawing-awareness.ts",
);
test.after(() => vite.close());

const layerId = "10000000-0000-4000-8000-000000000001";
const wallId = "10000000-0000-4000-8000-000000000002";
const objectId = "10000000-0000-4000-8000-000000000003";
const openingId = "10000000-0000-4000-8000-000000000004";
const otherLayerId = "10000000-0000-4000-8000-000000000005";
function layer(id = layerId, overrides = {}) {
  return {
    id,
    name: "Work",
    visible: true,
    locked: false,
    systemKind: "work",
    version: 1,
    ...overrides,
  };
}
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

test("viewport culling keeps two 16px frames of offscreen pan coverage", () => {
  assert.deepEqual(
    tools.drawingCanvasViewportBounds(
      { width: 100, height: 80 },
      { x: 0, y: 0, zoom: 1 },
    ),
    { x: -32, y: -32, width: 164, height: 144 },
  );
});

test("saved region annotations project exact world bounds through the viewport", () => {
  assert.deepEqual(
    tools.drawingCanvasRegionAnnotationScreenBounds(
      { x: -10, y: 15, width: 30, height: 20 },
      { x: 100, y: -50, zoom: 2.5 },
    ),
    { left: 75, top: -12.5, width: 75, height: 50 },
  );
});

test("region picker converts screen drag endpoints to exact normalized world bounds", () => {
  const viewport = { x: 100, y: 200, zoom: 2 };
  let result = tools.drawingCanvasRegionPickTransition(
    { kind: "idle" },
    {
      type: "pointer_down",
      button: 0,
      pointerId: 7,
      screenPoint: { x: 80, y: 160 },
    },
    viewport,
  );
  result = tools.drawingCanvasRegionPickTransition(
    result.state,
    {
      type: "pointer_up",
      pointerId: 7,
      screenPoint: { x: 100, y: 180 },
    },
    viewport,
  );

  assert.deepEqual(result, {
    state: { kind: "idle" },
    region: { x: -10, y: -20, width: 10, height: 10 },
  });
});

test("region picker preserves signed unsnapped coordinates and normalizes reverse drags", () => {
  const viewport = { x: 7, y: 11, zoom: 2 };
  let result = tools.drawingCanvasRegionPickTransition(
    { kind: "idle" },
    {
      type: "pointer_down",
      button: 0,
      pointerId: 7,
      screenPoint: { x: -3, y: -4 },
    },
    viewport,
  );
  result = tools.drawingCanvasRegionPickTransition(
    result.state,
    {
      type: "pointer_up",
      pointerId: 7,
      screenPoint: { x: 5, y: 12 },
    },
    viewport,
  );

  assert.deepEqual(result.region, {
    x: -5,
    y: -7.5,
    width: 4,
    height: 8,
  });

  result = tools.drawingCanvasRegionPickTransition(
    { kind: "idle" },
    {
      type: "pointer_down",
      button: 0,
      pointerId: 7,
      screenPoint: { x: 120, y: 200 },
    },
    { x: 100, y: 200, zoom: 2 },
  );
  result = tools.drawingCanvasRegionPickTransition(
    result.state,
    {
      type: "pointer_up",
      pointerId: 7,
      screenPoint: { x: 100, y: 180 },
    },
    { x: 100, y: 200, zoom: 2 },
  );
  assert.deepEqual(result.region, { x: 0, y: -10, width: 10, height: 10 });
});

test("region picker rejects undersized, wrong-pointer, cancelled, and non-finite drags", () => {
  const viewport = { x: 0, y: 0, zoom: 1 };
  let result = tools.drawingCanvasRegionPickTransition(
    { kind: "idle" },
    {
      type: "pointer_down",
      button: 0,
      pointerId: 7,
      screenPoint: { x: 10, y: 20 },
    },
    viewport,
  );
  const started = result.state;
  assert.deepEqual(
    tools.drawingCanvasRegionPickTransition(
      started,
      { type: "pointer_move", pointerId: 8, screenPoint: { x: 30, y: 40 } },
      viewport,
    ),
    { state: started, region: null },
  );
  assert.deepEqual(
    tools.drawingCanvasRegionPickTransition(
      started,
      { type: "pointer_up", pointerId: 8, screenPoint: { x: 30, y: 40 } },
      viewport,
    ),
    { state: started, region: null },
  );
  result = tools.drawingCanvasRegionPickTransition(
    started,
    { type: "pointer_up", pointerId: 7, screenPoint: { x: 13, y: 24 } },
    viewport,
  );
  assert.deepEqual(result, { state: { kind: "idle" }, region: null });

  result = tools.drawingCanvasRegionPickTransition(
    { kind: "idle" },
    {
      type: "pointer_down",
      button: 0,
      pointerId: 7,
      screenPoint: { x: 10, y: 20 },
    },
    viewport,
  );
  assert.deepEqual(
    tools.drawingCanvasRegionPickTransition(
      result.state,
      { type: "pointer_cancel", pointerId: 7 },
      viewport,
    ),
    { state: { kind: "idle" }, region: null },
  );
  assert.deepEqual(
    tools.drawingCanvasRegionPickTransition(
      { kind: "idle" },
      {
        type: "pointer_down",
        button: 0,
        pointerId: 7,
        screenPoint: { x: Number.NaN, y: 20 },
      },
      viewport,
    ),
    { state: { kind: "idle" }, region: null },
  );
});

test("region picker accepts exactly 4 by 4 pixels but rejects either smaller axis", () => {
  const complete = (point) => {
    const started = tools.drawingCanvasRegionPickTransition(
      { kind: "idle" },
      {
        type: "pointer_down",
        button: 0,
        pointerId: 7,
        screenPoint: { x: 10, y: 20 },
      },
      { x: 0, y: 0, zoom: 1 },
    );
    return tools.drawingCanvasRegionPickTransition(
      started.state,
      { type: "pointer_up", pointerId: 7, screenPoint: point },
      { x: 0, y: 0, zoom: 1 },
    ).region;
  };
  assert.deepEqual(complete({ x: 14, y: 24 }), {
    x: 10,
    y: 20,
    width: 4,
    height: 4,
  });
  assert.equal(complete({ x: 14, y: 23 }), null);
  assert.equal(complete({ x: 13, y: 24 }), null);
});

test("armed region picker consumes non-owner input and cancels only a second touch", () => {
  const route = (event) =>
    tools.drawingCanvasRegionPickerPointerDisposition({
      armed: true,
      activePointerId: 7,
      event,
    });
  for (const type of [
    "pointer_down",
    "pointer_move",
    "pointer_up",
    "pointer_cancel",
  ])
    assert.equal(
      route({ type, pointerId: 8, pointerType: "mouse" }),
      "consume",
    );
  assert.equal(
    route({ type: "pointer_down", pointerId: 8, pointerType: "touch" }),
    "cancel",
  );
  assert.equal(
    tools.drawingCanvasRegionPickerPointerDisposition({
      armed: true,
      activePointerId: null,
      event: {
        type: "pointer_down",
        pointerId: 8,
        pointerType: "mouse",
        button: 2,
        isPrimary: true,
      },
    }),
    "consume",
  );
});

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
    layers: { [layerId]: layer() },
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

test("PDF calibration capture normalizes viewport points in order and rejects non-background clicks", () => {
  assert.equal(typeof tools.drawingCanvasNormalizedBackgroundPoint, "function");
  const viewport = { x: 10, y: 20, zoom: 2 };
  const background = {
    kind: "pdf",
    width: 100,
    height: 200,
    pageNumber: 1,
    signedUrl: "https://example.test/source.pdf",
  };
  const captured = [
    tools.drawingCanvasNormalizedBackgroundPoint(
      { x: 10, y: 20 },
      viewport,
      background,
    ),
    tools.drawingCanvasNormalizedBackgroundPoint(
      { x: 210, y: 420 },
      viewport,
      background,
    ),
  ];
  assert.deepEqual(captured, [
    { x: 0, y: 0 },
    { x: 1, y: 1 },
  ]);
  assert.deepEqual(Object.keys(captured[0]).sort(), ["x", "y"]);
  assert.equal(
    tools.drawingCanvasNormalizedBackgroundPoint(
      { x: 211, y: 420 },
      viewport,
      background,
    ),
    null,
  );
  assert.equal(
    tools.drawingCanvasNormalizedBackgroundPoint({ x: 10, y: 20 }, viewport, {
      kind: "blank",
      width: 100,
      height: 200,
    }),
    null,
  );
});

test("production calibration router isolates tool and selection dispatch while retaining pan zoom and Escape", () => {
  assert.equal(typeof tools.createDrawingCalibrationInputRouter, "function");
  for (const activeTool of ["select", "pan", "polyline", "space", "area"]) {
    const captured = [];
    const order = [];
    let controllerState = tools.createDrawingToolControllerState(
      context({ activeTool }),
    );
    let selectionState = tools.createDrawingSelectionState([wallId]);
    const controllerBaseline = structuredClone(controllerState);
    const selectionBaseline = structuredClone(selectionState);
    let toolCalls = 0;
    let selectionCalls = 0;
    let commandCalls = 0;
    let panCalls = 0;
    let wheelCalls = 0;
    const router = tools.createDrawingCalibrationInputRouter(() => ({
      active: true,
      activeTool,
      background: {
        kind: "pdf",
        width: 100,
        height: 200,
        pageNumber: 1,
        signedUrl: "https://example.test/source.pdf",
      },
      viewport: { x: 10, y: 20, zoom: 2 },
      onPoint: (point) => captured.push(point),
    }));
    const onCommand = () => {
      commandCalls += 1;
    };
    const dispatch = (event) => {
      order.push("dispatch");
      if (activeTool === "select") {
        selectionCalls += 1;
        if (!event.type.startsWith("pointer_")) return;
        const selectionEvent =
          event.type === "pointer_down"
            ? {
                type: event.type,
                candidateId: null,
                pointerId: event.pointerId,
                screenPoint: event.screenPoint,
                shiftKey: false,
              }
            : event.type === "pointer_cancel"
              ? { type: event.type, pointerId: event.pointerId }
              : {
                  type: event.type,
                  pointerId: event.pointerId,
                  screenPoint: event.screenPoint,
                };
        const result = tools.drawingSelectionEventTransition(
          selectionState,
          selectionEvent,
          {
            actorId: "actor-a",
            canEdit: true,
            layers: { [layerId]: layer() },
            objects: { [wallId]: wall },
            snap: { gridSize: 0 },
            viewport: { x: 0, y: 0, zoom: 1 },
          },
        );
        selectionState = result.state;
        if (result.command) onCommand(result.command);
        return;
      }
      toolCalls += 1;
      const result = tools.drawingToolEventTransition(
        controllerState,
        event,
        context({ activeTool }),
      );
      controllerState = result.state;
      if (result.command) onCommand(result.command);
    };
    const route = (event) =>
      router(event, {
        onDispatch: () => dispatch(event),
        onPan: () => {
          panCalls += 1;
        },
        onWheel: () => {
          wheelCalls += 1;
        },
      });

    for (const screenPoint of [
      { x: 60, y: 120 },
      { x: 160, y: 320 },
    ])
      route({
        type: "pointer_down",
        activeTool,
        button: 0,
        pointerId: 1,
        screenPoint,
        shiftKey: false,
        spacePressed: false,
      });
    for (const event of [
      {
        type: "pointer_move",
        activeTool,
        pointerId: 1,
        screenPoint: { x: 100, y: 200 },
        shiftKey: false,
      },
      {
        type: "pointer_up",
        activeTool,
        pointerId: 1,
        screenPoint: { x: 100, y: 200 },
        shiftKey: false,
      },
      { type: "pointer_cancel", activeTool, pointerId: 1 },
      { type: "double_click", activeTool },
    ])
      route(event);
    route({ type: "key_down", activeTool, key: "Escape" });

    assert.deepEqual(captured, [
      { x: 0.25, y: 0.25 },
      { x: 0.75, y: 0.75 },
    ]);
    assert.deepEqual(order, []);
    assert.equal(toolCalls, 0);
    assert.equal(selectionCalls, 0);
    assert.equal(commandCalls, 0);
    assert.deepEqual(controllerState, controllerBaseline);
    assert.deepEqual(selectionState, selectionBaseline);

    for (const input of [
      { button: 1, spacePressed: false },
      { button: 0, spacePressed: true },
    ])
      route({
        type: "pointer_down",
        activeTool,
        pointerId: 2,
        screenPoint: { x: 100, y: 200 },
        shiftKey: false,
        ...input,
      });
    route({ type: "wheel", activeTool });
    assert.equal(panCalls, 2);
    assert.equal(wheelCalls, 1);
    assert.equal(toolCalls, 0);
    assert.equal(selectionCalls, 0);
    assert.equal(commandCalls, 0);
  }
});

test("window capture is the sole Escape cancellation owner before canvas routing", () => {
  assert.equal(
    typeof scaleControl.handleDrawingCalibrationEscapeKey,
    "function",
  );
  let cancellations = 0;
  let commandCalls = 0;
  const cancel = () => {
    cancellations += 1;
  };
  const router = tools.createDrawingCalibrationInputRouter(() => ({
    active: true,
    background: {
      kind: "pdf",
      width: 100,
      height: 200,
      pageNumber: 1,
      signedUrl: "https://example.test/source.pdf",
    },
    viewport: { x: 0, y: 0, zoom: 1 },
  }));

  scaleControl.handleDrawingCalibrationEscapeKey({ key: "Escape" }, cancel);
  router(
    { type: "key_down", activeTool: "polyline", key: "Escape" },
    { onDispatch: () => (commandCalls += 1) },
  );

  assert.equal(cancellations, 1);
  assert.equal(commandCalls, 0);
});

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
      layers: { [layerId]: layer(layerId, { locked: true }) },
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
  for (const event of [
    { type: "double_click" },
    { type: "key_down", key: "Enter" },
  ]) {
    const rejected = tools.drawingToolEventTransition(
      invalid,
      event,
      areaContext,
    );
    assert.equal(rejected.command, null);
    assert.deepEqual(rejected.state.session, invalid.session);
    assert.match(rejected.state.validationMessage, /경계|다각형/);
  }
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

test("same-ID layer lock, hide, source downgrade, and capability loss cancel sessions and release capture", () => {
  const wallContext = context({ activeTool: "wall" });
  const startedWall = pointerDown(
    tools.createDrawingToolControllerState(wallContext),
    { x: 0, y: 0 },
    wallContext,
  );
  for (const downgraded of [
    context({
      activeTool: "wall",
      layers: { [layerId]: layer(layerId, { locked: true }) },
    }),
    context({
      activeTool: "wall",
      layers: { [layerId]: layer(layerId, { visible: false }) },
    }),
    context({
      activeTool: "wall",
      layers: {
        [layerId]: layer(layerId, { locked: true, systemKind: "source" }),
      },
    }),
    context({ activeTool: "wall", canEdit: false }),
  ]) {
    const cancelled = tools.drawingToolEventTransition(
      startedWall.state,
      { type: "sync_context" },
      downgraded,
    );
    assert.deepEqual(cancelled.state.session, { tool: "idle" });
    assert.equal(cancelled.command, null);
  }

  const rectangleContext = context({ activeTool: "rectangle" });
  const dragging = pointerDown(
    tools.createDrawingToolControllerState(rectangleContext),
    { x: 0, y: 0 },
    rectangleContext,
  );
  assert.deepEqual(dragging.pointerCapture, { type: "set", pointerId: 1 });
  const cancelledDrag = tools.drawingToolEventTransition(
    dragging.state,
    { type: "sync_context" },
    context({
      activeTool: "rectangle",
      layers: { [layerId]: layer(layerId, { locked: true }) },
    }),
  );
  assert.deepEqual(cancelledDrag.pointerCapture, {
    type: "release",
    pointerId: 1,
  });
  assert.deepEqual(cancelledDrag.state.session, { tool: "idle" });
});

test("wall and grid reconcile competing object and grid snaps onto an exact Shift ray", () => {
  for (const tool of ["wall", "grid"]) {
    const objectSnapped = tools.commitDrawingPoint(
      tools.beginDrawingToolSession(tool, { x: 0, y: 0 }, snap),
      { x: 720, y: 735 },
      options({
        constrain: true,
        snap: {
          ...snap,
          objectCandidates: [{ x: 720, y: 735 }],
          tolerancePixels: 30,
        },
      }),
    ).command.objects[0].geometry.end;
    assert.equal(Math.abs(objectSnapped.x), Math.abs(objectSnapped.y));
    assert.notDeepEqual(objectSnapped, { x: 720, y: 735 });

    const gridSnapped = tools.commitDrawingPoint(
      tools.beginDrawingToolSession(tool, { x: 10, y: 20 }, snap),
      { x: 910, y: 520 },
      options({
        constrain: true,
        snap: { ...snap, gridSize: 100, tolerancePixels: 100 },
      }),
    ).command.objects[0].geometry.end;
    assert.equal(Math.abs(gridSnapped.x - 10), Math.abs(gridSnapped.y - 20));
  }
});

test("wall and grid serialize noncanonical Shift starts onto one exact signed micromillimetre ray", () => {
  const scaled = (value) => BigInt(Math.round(value * 1_000_000));
  const absolute = (value) => (value < 0n ? -value : value);
  const cases = [
    {
      end: { x: 10, y: 10 },
      expectedSigns: [1, 1],
      snap,
    },
    {
      end: { x: -719, y: 734 },
      expectedSigns: [-1, 1],
      snap: {
        ...snap,
        objectCandidates: [{ x: -720, y: 735 }],
        tolerancePixels: 30,
      },
    },
    {
      end: { x: 910, y: -520 },
      expectedSigns: [1, -1],
      snap: { ...snap, gridSize: 100, tolerancePixels: 100 },
    },
  ];
  for (const tool of ["wall", "grid"])
    for (const fixture of cases) {
      const geometry = tools.commitDrawingPoint(
        tools.beginDrawingToolSession(
          tool,
          { x: 0.0000001, y: 0.0000005 },
          snap,
        ),
        fixture.end,
        options({ constrain: true, snap: fixture.snap }),
      ).command.objects[0].geometry;
      const deltaX = scaled(geometry.end.x) - scaled(geometry.start.x);
      const deltaY = scaled(geometry.end.y) - scaled(geometry.start.y);
      assert.equal(absolute(deltaX), absolute(deltaY));
      assert.equal(deltaX > 0n ? 1 : -1, fixture.expectedSigns[0]);
      assert.equal(deltaY > 0n ? 1 : -1, fixture.expectedSigns[1]);
    }
});

test("semantic narrow-phase selection falls through an empty top bounding box", () => {
  const rectangle = {
    id: objectId,
    name: "Under",
    layerId,
    geometry: {
      type: "rectangle",
      origin: { x: 0, y: 0 },
      width: 100,
      height: 100,
      rotation: 0,
    },
    style: { stroke: "#000000", strokeWidth: 1, fill: null },
    version: 1,
  };
  const concave = {
    id: openingId,
    name: "Top L",
    layerId,
    geometry: {
      type: "area",
      semanticVersion: 1,
      boundary: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 40 },
        { x: 40, y: 40 },
        { x: 40, y: 100 },
        { x: 0, y: 100 },
      ],
    },
    style: { stroke: "#000000", strokeWidth: 1, fill: "#ffffff" },
    version: 1,
  };
  const result = tools.drawingSelectionEventTransition(
    tools.createDrawingSelectionState(),
    {
      type: "pointer_down",
      candidateId: concave.id,
      pointerId: 7,
      screenPoint: { x: 80, y: 80 },
      shiftKey: false,
    },
    {
      actorId: "actor-a",
      canEdit: true,
      layers: { [layerId]: layer() },
      objects: { [rectangle.id]: rectangle, [concave.id]: concave },
      orderedCandidateIds: [rectangle.id, concave.id],
      snap: { gridSize: 0 },
      viewport: { x: 0, y: 0, zoom: 1 },
    },
  );
  assert.deepEqual(result.state.selectedIds, [rectangle.id]);
});

test("selection resolves canonical geometry when the renderer supplies no hit hint", () => {
  const wall = {
    id: wallId,
    name: "Wall",
    layerId,
    geometry: {
      type: "wall",
      semanticVersion: 1,
      start: { x: 100, y: 400 },
      end: { x: 1400, y: 400 },
      thicknessMillimeters: 200,
      heightMillimeters: 3000,
    },
    style: { stroke: "#000000", strokeWidth: 2, fill: null },
    version: 1,
  };
  const result = tools.drawingSelectionEventTransition(
    tools.createDrawingSelectionState(),
    {
      type: "pointer_down",
      candidateId: null,
      pointerId: 8,
      screenPoint: { x: 1380, y: 400 },
      shiftKey: false,
    },
    {
      actorId: "actor-a",
      canEdit: true,
      layers: { [layerId]: layer() },
      objects: { [wall.id]: wall },
      orderedCandidateIds: [wall.id],
      snap: { gridSize: 0 },
      viewport: { x: 0, y: 0, zoom: 1 },
    },
  );
  assert.deepEqual(result.state.selectedIds, [wall.id]);
});

test("a renderer hit hint does not scan unrelated selection candidates", () => {
  const candidateIds = Array.from(
    { length: 1_850 },
    (_, index) => `candidate-${index}`,
  );
  const preferredId = candidateIds[0];
  let objectReads = 0;
  const preferred = {
    id: preferredId,
    name: "Preferred",
    layerId,
    geometry: {
      type: "rectangle",
      origin: { x: 0, y: 0 },
      width: 100,
      height: 100,
      rotation: 0,
    },
    style: { stroke: "#000000", strokeWidth: 1, fill: null },
    version: 1,
  };
  const objects = new Proxy(
    Object.fromEntries(
      candidateIds.map((id, index) => [
        id,
        index === 0
          ? preferred
          : {
              ...preferred,
              id,
              geometry: {
                ...preferred.geometry,
                origin: { x: index * 200, y: 0 },
              },
            },
      ]),
    ),
    {
      get(target, property, receiver) {
        if (typeof property === "string" && property in target)
          objectReads += 1;
        return Reflect.get(target, property, receiver);
      },
    },
  );

  const result = tools.drawingSelectionEventTransition(
    tools.createDrawingSelectionState(),
    {
      type: "pointer_down",
      candidateId: preferredId,
      pointerId: 9,
      screenPoint: { x: 50, y: 50 },
      shiftKey: false,
    },
    {
      actorId: "actor-a",
      canEdit: true,
      layers: { [layerId]: layer() },
      objects,
      orderedCandidateIds: candidateIds,
      snap: { gridSize: 0 },
      viewport: { x: 0, y: 0, zoom: 1 },
    },
  );

  assert.deepEqual(result.state.selectedIds, [preferredId]);
  assert.ok(
    objectReads < 10,
    `expected bounded object reads, got ${objectReads}`,
  );
});

test("Canvas Shift selection and Awareness lock use the narrow-phase resolved target", () => {
  assert.equal(typeof tools.drawingCanvasSelectionPointerDown, "function");
  const under = {
    id: objectId,
    name: "Under",
    layerId,
    geometry: {
      type: "rectangle",
      origin: { x: 0, y: 0 },
      width: 100,
      height: 100,
      rotation: 0,
    },
    style: { stroke: "#000000", strokeWidth: 1, fill: null },
    version: 1,
  };
  const top = {
    id: openingId,
    name: "Top L",
    layerId,
    geometry: {
      type: "area",
      semanticVersion: 1,
      boundary: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 40 },
        { x: 40, y: 40 },
        { x: 40, y: 100 },
        { x: 0, y: 100 },
      ],
    },
    style: { stroke: "#000000", strokeWidth: 1, fill: "#ffffff" },
    version: 1,
  };
  const existing = {
    ...under,
    id: wallId,
    name: "Existing",
    geometry: {
      type: "rectangle",
      origin: { x: 200, y: 200 },
      width: 20,
      height: 20,
      rotation: 0,
    },
  };
  const objects = { [under.id]: under, [top.id]: top, [existing.id]: existing };
  const result = tools.drawingCanvasSelectionPointerDown(
    tools.createDrawingSelectionState([existing.id]),
    {
      type: "pointer_down",
      candidateId: top.id,
      pointerId: 7,
      screenPoint: { x: 80, y: 80 },
      shiftKey: true,
    },
    {
      actorId: "actor-a",
      canEdit: true,
      layers: { [layerId]: layer() },
      objects,
      orderedCandidateIds: [under.id, existing.id, top.id],
      snap: { gridSize: 0 },
      viewport: { x: 0, y: 0, zoom: 1 },
    },
    new Set(),
    new Set(Object.keys(objects)),
  );
  assert.deepEqual(result.state.selectedIds, [existing.id, under.id]);
  assert.equal(result.softLockId, under.id);

  const published = [];
  const lease = awareness.createDrawingSoftLockLease({
    createId: () => "10000000-0000-4000-8000-000000000099",
    now: () => 100,
    onChange: (locks) => published.push(locks),
  });
  lease.acquire(result.softLockId);
  assert.equal(published.at(-1)[0].entityId, under.id);
});

test("wall drag previews include visible hosted openings but commit only the wall", () => {
  assert.equal(typeof tools.drawingSelectionPreview, "function");
  const hostedOpening = {
    id: openingId,
    name: "D-01",
    layerId: otherLayerId,
    geometry: {
      type: "opening",
      semanticVersion: 1,
      hostWallId: wallId,
      offsetMillimeters: 1800,
      widthMillimeters: 900,
      heightMillimeters: 2100,
      sillHeightMillimeters: 0,
      openingKind: "door",
    },
    style: { stroke: "#000000", strokeWidth: 2, fill: null },
    version: 1,
  };
  const layers = {
    [layerId]: layer(),
    [otherLayerId]: layer(otherLayerId),
  };
  const objects = { [wallId]: wall, [openingId]: hostedOpening };
  const preview = tools.drawingSelectionPreview({
    actorId: "actor-a",
    delta: { x: 100, y: 50 },
    layers,
    objects,
    selectedIds: [wallId],
  });
  assert.deepEqual(preview.objectIds, [wallId, openingId]);
  assert.deepEqual(preview.objects[openingId].geometry, hostedOpening.geometry);
  assert.deepEqual(preview.objects[wallId].geometry.start, { x: 100, y: 50 });

  const withSelectedOpening = tools.drawingSelectionPreview({
    actorId: "actor-a",
    delta: { x: 100, y: 50 },
    layers,
    objects,
    selectedIds: [wallId, openingId],
  });
  assert.deepEqual(withSelectedOpening.objectIds, [wallId, openingId]);
  assert.deepEqual(
    withSelectedOpening.objects[openingId].geometry,
    hostedOpening.geometry,
  );

  const hiddenOpening = tools.drawingSelectionPreview({
    actorId: "actor-a",
    delta: { x: 100, y: 50 },
    layers: {
      ...layers,
      [otherLayerId]: layer(otherLayerId, { visible: false }),
    },
    objects,
    selectedIds: [wallId],
  });
  assert.deepEqual(hiddenOpening.objectIds, [wallId]);

  const selectionContext = {
    actorId: "actor-a",
    canEdit: true,
    layers,
    objects,
    orderedCandidateIds: [wallId, openingId],
    snap: { gridSize: 0 },
    viewport: { x: 0, y: 0, zoom: 1 },
  };
  let gesture = tools.drawingSelectionEventTransition(
    tools.createDrawingSelectionState(),
    {
      type: "pointer_down",
      candidateId: wallId,
      pointerId: 9,
      screenPoint: { x: 1000, y: 0 },
      shiftKey: false,
    },
    selectionContext,
  );
  gesture = tools.drawingSelectionEventTransition(
    gesture.state,
    { type: "pointer_move", pointerId: 9, screenPoint: { x: 1100, y: 50 } },
    selectionContext,
  );
  const committed = tools.drawingSelectionEventTransition(
    gesture.state,
    { type: "pointer_up", pointerId: 9, screenPoint: { x: 1100, y: 50 } },
    selectionContext,
  );
  assert.deepEqual(
    committed.command.updates.map((update) => update.objectId),
    [wallId],
  );
  const cancelled = tools.drawingSelectionEventTransition(
    gesture.state,
    { type: "pointer_cancel", pointerId: 9 },
    selectionContext,
  );
  assert.deepEqual(cancelled.state.previewDelta, { x: 0, y: 0 });

  const hostHidden = tools.drawingSelectionEventTransition(
    gesture.state,
    { type: "sync_context" },
    {
      ...selectionContext,
      layers: { ...layers, [layerId]: layer(layerId, { visible: false }) },
    },
  );
  assert.equal(hostHidden.state.drag, null);
  assert.deepEqual(hostHidden.state.previewDelta, { x: 0, y: 0 });
});

test("an opening drag fails closed before render when its non-active layer becomes ineligible", () => {
  const draggedOpening = {
    id: openingId,
    name: "D-01",
    layerId: otherLayerId,
    geometry: {
      type: "opening",
      semanticVersion: 1,
      hostWallId: wallId,
      offsetMillimeters: 1800,
      widthMillimeters: 900,
      heightMillimeters: 2100,
      sillHeightMillimeters: 0,
      openingKind: "door",
    },
    style: { stroke: "#000000", strokeWidth: 2, fill: null },
    version: 1,
  };
  const objects = { [wallId]: wall, [openingId]: draggedOpening };
  const baseContext = {
    actorId: "actor-a",
    canEdit: true,
    layers: {
      [layerId]: layer(),
      [otherLayerId]: layer(otherLayerId),
    },
    objects,
    orderedCandidateIds: [wallId, openingId],
    snap: { gridSize: 0 },
    viewport: { x: 0, y: 0, zoom: 1 },
  };
  let gesture = tools.drawingSelectionEventTransition(
    tools.createDrawingSelectionState(),
    {
      type: "pointer_down",
      candidateId: openingId,
      pointerId: 11,
      screenPoint: { x: 1800, y: 0 },
      shiftKey: false,
    },
    baseContext,
  );
  gesture = tools.drawingSelectionEventTransition(
    gesture.state,
    { type: "pointer_move", pointerId: 11, screenPoint: { x: 1900, y: 0 } },
    baseContext,
  );
  assert.deepEqual(gesture.state.previewDelta, { x: 100, y: 0 });

  const downgrades = [
    {
      ...baseContext,
      layers: {
        ...baseContext.layers,
        [otherLayerId]: layer(otherLayerId, { locked: true }),
      },
    },
    {
      ...baseContext,
      layers: {
        ...baseContext.layers,
        [otherLayerId]: layer(otherLayerId, { visible: false }),
      },
    },
    {
      ...baseContext,
      layers: {
        ...baseContext.layers,
        [otherLayerId]: layer(otherLayerId, { systemKind: "source" }),
      },
    },
    { ...baseContext, lockedEntityIds: new Set([openingId]) },
  ];
  for (const downgraded of downgrades) {
    const preview = tools.drawingSelectionPreview({
      actorId: "actor-a",
      canEdit: true,
      delta: gesture.state.previewDelta,
      layers: downgraded.layers,
      lockedEntityIds: downgraded.lockedEntityIds,
      objects,
      selectedIds: [openingId],
    });
    assert.deepEqual(preview.objectIds, []);
    assert.equal(preview.objects, objects);

    const cancelled = tools.drawingSelectionEventTransition(
      gesture.state,
      { type: "sync_context" },
      downgraded,
    );
    assert.deepEqual(cancelled.pointerCapture, {
      type: "release",
      pointerId: 11,
    });
    assert.equal(cancelled.softLockId, null);
    assert.equal(cancelled.command, null);
    assert.equal(cancelled.state.drag, null);
    const released = tools.drawingSelectionEventTransition(
      cancelled.state,
      { type: "pointer_up", pointerId: 11, screenPoint: { x: 1900, y: 0 } },
      downgraded,
    );
    assert.equal(released.command, null);
  }
});

test("semantic render cache is identity-bounded and stores only opening and arc views", () => {
  assert.equal(typeof tools.semanticRenderView, "function");
  assert.equal(tools.semanticRenderView(wall, { [wallId]: wall }), undefined);
  const arcObject = {
    ...wall,
    id: objectId,
    geometry: {
      type: "arc",
      semanticVersion: 1,
      center: { x: 0, y: 0 },
      radius: 100,
      startAngleDegrees: 0,
      sweepAngleDegrees: 90,
    },
  };
  const firstArc = tools.semanticRenderView(arcObject, {});
  assert.equal(tools.semanticRenderView(arcObject, {}), firstArc);
  assert.notEqual(
    tools.semanticRenderView({ ...arcObject, version: 2 }, {}),
    firstArc,
  );

  const openingObject = {
    ...wall,
    id: openingId,
    geometry: {
      type: "opening",
      semanticVersion: 1,
      hostWallId: wallId,
      offsetMillimeters: 1800,
      widthMillimeters: 900,
      heightMillimeters: 2100,
      sillHeightMillimeters: 0,
      openingKind: "door",
    },
  };
  const firstOpening = tools.semanticRenderView(openingObject, {
    [wallId]: wall,
  });
  assert.equal(
    tools.semanticRenderView(openingObject, { [wallId]: wall }),
    firstOpening,
  );
  assert.notEqual(
    tools.semanticRenderView(openingObject, {
      [wallId]: { ...wall, version: 2 },
    }),
    firstOpening,
  );
});

test("PDF owned cleanup uses a bounded once-only fence per generation", () => {
  assert.equal(typeof tools.scheduleDrawingPdfOwnedCleanup, "function");
  const callbacks = { frames: [], timers: [] };
  const cancelled = { frames: [], timers: [] };
  const scheduler = {
    requestFrame(callback) {
      callbacks.frames.push(callback);
      return callbacks.frames.length;
    },
    cancelFrame(id) {
      cancelled.frames.push(id);
    },
    setTimer(callback) {
      callbacks.timers.push(callback);
      return callbacks.timers.length;
    },
    clearTimer(id) {
      cancelled.timers.push(id);
    },
  };
  const oldCanvas = { width: 10 };
  const newCanvas = { width: 20 };
  const cleaned = [];
  tools.scheduleDrawingPdfOwnedCleanup(() => {
    oldCanvas.width = 0;
    cleaned.push("old");
  }, scheduler);
  tools.scheduleDrawingPdfOwnedCleanup(() => {
    newCanvas.width = 0;
    cleaned.push("new");
  }, scheduler);

  callbacks.timers[0]();
  callbacks.frames[0]();
  assert.deepEqual(cleaned, ["old"]);
  assert.deepEqual([oldCanvas.width, newCanvas.width], [0, 20]);
  callbacks.frames[1]();
  callbacks.timers[1]();
  assert.deepEqual(cleaned, ["old", "new"]);
  assert.deepEqual([oldCanvas.width, newCanvas.width], [0, 0]);
  assert.deepEqual(cancelled.frames, [1, 2]);
  assert.deepEqual(cancelled.timers, [1, 2]);
});
