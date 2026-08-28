import assert from "node:assert/strict";
import test from "node:test";

import * as drawingRuntime from "../app/lukas/lib/drawing-runtime.ts";

const {
  createVisibilityRenderGate,
  drawingLocalEditReady,
  drawingWorkspaceFirstPaintReady,
  drawingRealtimeState,
  drawingRealtimeTransition,
  markDrawingFirstUsable,
} = drawingRuntime;

test("local editing is ready only with an outbox, a command bridge, and healthy persistence", () => {
  assert.equal(
    drawingLocalEditReady({
      outboxReady: true,
      bridgeReady: true,
      persistenceFailed: false,
    }),
    true,
  );
  for (const input of [
    { outboxReady: false, bridgeReady: true, persistenceFailed: false },
    { outboxReady: true, bridgeReady: false, persistenceFailed: false },
    { outboxReady: true, bridgeReady: true, persistenceFailed: true },
  ])
    assert.equal(drawingLocalEditReady(input), false);
});

test("collaboration waits only for the visible source frames required by the workspace", () => {
  const entries = new Set();
  const performance = {
    getEntriesByName(name) {
      return entries.has(name) ? [{}] : [];
    },
  };

  assert.equal(
    drawingWorkspaceFirstPaintReady(
      { requiresPdf: true, requiresIfc: true },
      performance,
    ),
    false,
  );
  entries.add("drawing-first-page");
  assert.equal(
    drawingWorkspaceFirstPaintReady(
      { requiresPdf: true, requiresIfc: false },
      performance,
    ),
    true,
  );
  assert.equal(
    drawingWorkspaceFirstPaintReady(
      { requiresPdf: true, requiresIfc: true },
      performance,
    ),
    false,
  );
  entries.add("drawing-first-ifc-frame");
  assert.equal(
    drawingWorkspaceFirstPaintReady(
      { requiresPdf: true, requiresIfc: true },
      performance,
    ),
    true,
  );
  assert.equal(
    drawingWorkspaceFirstPaintReady(
      { requiresPdf: false, requiresIfc: false },
      performance,
    ),
    true,
  );
});

test("hidden IFC render requests collapse into one render when visible again", () => {
  let hidden = true;
  let renders = 0;
  let firstRenders = 0;
  const gate = createVisibilityRenderGate({
    isHidden: () => hidden,
    render: () => {
      renders += 1;
    },
    onFirstRender: () => {
      firstRenders += 1;
    },
  });

  gate.request();
  gate.request();
  assert.equal(renders, 0);
  assert.equal(firstRenders, 0);

  hidden = false;
  gate.visibilityChanged();
  assert.equal(renders, 1);
  assert.equal(firstRenders, 1);
  gate.visibilityChanged();
  assert.equal(renders, 1);
  gate.request();
  assert.equal(renders, 2);
  assert.equal(firstRenders, 1);
});

test("drawing first usable marks distinguish PDF and IFC without duplicates", () => {
  const names = [];
  const recorded = new Set();
  const performance = {
    getEntriesByName(name) {
      return recorded.has(name) ? [{}] : [];
    },
    mark(name) {
      names.push(name);
      recorded.add(name);
    },
  };

  markDrawingFirstUsable("pdf", performance);
  markDrawingFirstUsable("pdf", performance);
  markDrawingFirstUsable("ifc", performance);

  assert.deepEqual(names, ["drawing-first-page", "drawing-first-ifc-frame"]);
});

test("first-paint readiness is scoped to one revision and source lifecycle", () => {
  const recorded = new Set();
  const performance = {
    getEntriesByName(name) {
      return recorded.has(name) ? [{}] : [];
    },
    mark(name) {
      recorded.add(name);
    },
  };
  const requirements = { requiresPdf: true, requiresIfc: true };

  markDrawingFirstUsable("pdf", performance, "revision-a:pdf-a:ifc-a");
  markDrawingFirstUsable("ifc", performance, "revision-a:pdf-a:ifc-a");
  assert.equal(
    drawingWorkspaceFirstPaintReady(
      requirements,
      performance,
      "revision-a:pdf-a:ifc-a",
    ),
    true,
  );
  assert.equal(
    drawingWorkspaceFirstPaintReady(
      requirements,
      performance,
      "revision-b:pdf-b:ifc-b",
    ),
    false,
  );
  markDrawingFirstUsable("pdf", performance, "revision-b:pdf-b:ifc-b");
  assert.equal(
    drawingWorkspaceFirstPaintReady(
      requirements,
      performance,
      "revision-b:pdf-b:ifc-b",
    ),
    false,
  );
});

test("workspace stages record measured production-boundary durations", () => {
  assert.equal(typeof drawingRuntime.startDrawingWorkspaceStage, "function");
  const measures = [];
  const times = [10, 24.5];
  const finish = drawingRuntime.startDrawingWorkspaceStage("render-adapter", {
    measure(name, options) {
      measures.push({ name, ...options });
    },
    now() {
      return times.shift();
    },
  });

  assert.equal(finish(), 14.5);
  assert.equal(finish(), 14.5);
  assert.deepEqual(measures, [
    {
      name: "drawing-workspace:render-adapter",
      start: 10,
      end: 24.5,
    },
  ]);
});

test("realtime transport failures produce an explicit reconnecting state", () => {
  assert.deepEqual(drawingRealtimeState("SUBSCRIBED"), {
    phase: "connected",
    message: "실시간 연결됨",
  });
  for (const status of ["CHANNEL_ERROR", "TIMED_OUT", "CLOSED"])
    assert.deepEqual(drawingRealtimeState(status), {
      phase: "disconnected",
      message:
        "실시간 연결이 끊겼습니다. 변경 내용은 다시 연결되면 갱신됩니다.",
    });
  assert.deepEqual(drawingRealtimeState("CONNECTING"), {
    phase: "connecting",
    message: "실시간 연결 중",
  });
});

test("realtime recovery requests one authoritative loader refresh", () => {
  const disconnected = drawingRealtimeState("CHANNEL_ERROR");
  assert.deepEqual(drawingRealtimeTransition(disconnected, "SUBSCRIBED"), {
    state: { phase: "connected", message: "실시간 연결됨" },
    shouldRevalidate: true,
  });
  assert.equal(
    drawingRealtimeTransition(drawingRealtimeState("CONNECTING"), "SUBSCRIBED")
      .shouldRevalidate,
    false,
  );
  assert.equal(
    drawingRealtimeTransition(drawingRealtimeState("SUBSCRIBED"), "SUBSCRIBED")
      .shouldRevalidate,
    false,
  );
});
