import assert from "node:assert/strict";
import test from "node:test";

import * as drawingRuntime from "../app/lukas/lib/drawing-runtime.ts";

const {
  createVisibilityRenderGate,
  drawingLocalEditReady,
  drawingAuthoritativeSnapshotKey,
  drawingWorkspaceFirstPaintReady,
  drawingRealtimeState,
  drawingRealtimeTransition,
  markDrawingFirstUsable,
  scheduleDrawingLocalInitialization,
  scheduleDrawingSourceReadyConnection,
} = drawingRuntime;

test("local editing is ready only with an outbox, a command bridge, healthy persistence, and no conflict", () => {
  assert.equal(
    drawingLocalEditReady({
      outboxReady: true,
      bridgeReady: true,
      persistenceFailed: false,
      conflicted: false,
    }),
    true,
  );
  for (const input of [
    {
      outboxReady: false,
      bridgeReady: true,
      persistenceFailed: false,
      conflicted: false,
    },
    {
      outboxReady: true,
      bridgeReady: false,
      persistenceFailed: false,
      conflicted: false,
    },
    {
      outboxReady: true,
      bridgeReady: true,
      persistenceFailed: true,
      conflicted: false,
    },
    {
      outboxReady: true,
      bridgeReady: true,
      persistenceFailed: false,
      conflicted: true,
    },
  ])
    assert.equal(drawingLocalEditReady(input), false);
});

test("local initialization starts exactly once immediately after the first shell frame", () => {
  const frames = [];
  const timers = [];
  let starts = 0;
  const scheduler = {
    requestAnimationFrame(callback) {
      frames.push(callback);
      return frames.length;
    },
    cancelAnimationFrame() {},
    requestIdleCallback() {
      throw new Error("durability initialization must not wait for idle time");
    },
    cancelIdleCallback() {},
    setTimeout(callback) {
      timers.push(callback);
      return timers.length;
    },
    clearTimeout() {},
  };

  assert.equal(typeof scheduleDrawingLocalInitialization, "function");
  scheduleDrawingLocalInitialization({
    initialize: () => {
      starts += 1;
    },
    scheduler,
  });

  assert.equal(starts, 0);
  assert.equal(frames.length, 1);
  frames[0](0);
  assert.equal(starts, 0);
  assert.equal(timers.length, 2);
  timers[1]();
  assert.equal(starts, 1);
  timers[0]();
  assert.equal(starts, 1);
});

test("cancelling local initialization prevents queued shell work from starting", () => {
  const frames = [];
  const cancelledFrames = [];
  const clearedTimers = [];
  let starts = 0;
  const scheduler = {
    requestAnimationFrame(callback) {
      frames.push(callback);
      return 41;
    },
    cancelAnimationFrame(handle) {
      cancelledFrames.push(handle);
    },
    requestIdleCallback() {
      throw new Error("cancelled frame must not queue idle work");
    },
    cancelIdleCallback() {},
    setTimeout() {
      return 42;
    },
    clearTimeout(handle) {
      clearedTimers.push(handle);
    },
  };

  const cancel = scheduleDrawingLocalInitialization({
    initialize: () => {
      starts += 1;
    },
    scheduler,
  });
  assert.equal(typeof cancel, "function");
  cancel();
  frames[0](0);

  assert.equal(starts, 0);
  assert.deepEqual(cancelledFrames, [41]);
  assert.deepEqual(clearedTimers, [42]);
});

test("StrictMode cancellation and the fallback start only the live local initializer", () => {
  const frames = [];
  const timers = [];
  let starts = 0;
  const scheduler = {
    requestAnimationFrame(callback) {
      frames.push(callback);
      return frames.length;
    },
    cancelAnimationFrame() {},
    requestIdleCallback() {
      throw new Error("the fallback wins before the idle callback is queued");
    },
    cancelIdleCallback() {},
    setTimeout(callback) {
      timers.push(callback);
      return timers.length;
    },
    clearTimeout() {},
  };

  const cancelDiscardedMount = scheduleDrawingLocalInitialization({
    initialize: () => {
      starts += 1;
    },
    scheduler,
  });
  cancelDiscardedMount();
  scheduleDrawingLocalInitialization({
    initialize: () => {
      starts += 1;
    },
    scheduler,
  });

  timers[0]();
  timers[1]();
  frames[0](0);
  assert.equal(starts, 1);
});

test("provider connection waits for source readiness and is cancelled with its mount", () => {
  const frames = [];
  let ready = false;
  let connections = 0;
  const scheduler = {
    requestAnimationFrame(callback) {
      frames.push(callback);
      return frames.length;
    },
    cancelAnimationFrame() {},
    setTimeout() {
      return 99;
    },
    clearTimeout() {},
  };

  assert.equal(typeof scheduleDrawingSourceReadyConnection, "function");
  const cancel = scheduleDrawingSourceReadyConnection({
    isReady: () => ready,
    connect: (sourceReady) => {
      assert.equal(sourceReady, true);
      connections += 1;
    },
    scheduler,
  });
  frames.shift()(0);
  assert.equal(connections, 0);
  ready = true;
  frames.shift()(0);
  assert.equal(connections, 1);
  cancel();
  assert.equal(connections, 1);
});

test("provider fallback connects degraded when source readiness never arrives", () => {
  const frames = [];
  const timers = [];
  const connections = [];
  const scheduler = {
    requestAnimationFrame(callback) {
      frames.push(callback);
      return frames.length;
    },
    cancelAnimationFrame() {},
    setTimeout(callback) {
      timers.push(callback);
      return timers.length;
    },
    clearTimeout() {},
  };

  scheduleDrawingSourceReadyConnection({
    isReady: () => false,
    connect: (sourceReady) => connections.push(sourceReady),
    scheduler,
  });
  frames.shift()(0);
  assert.deepEqual(connections, []);
  timers[0]();
  assert.deepEqual(connections, [false]);
});

test("cancelling source readiness clears polling and fallback without connecting", () => {
  const frames = [];
  const timers = [];
  const cancelledFrames = [];
  const clearedTimers = [];
  let connections = 0;
  const scheduler = {
    requestAnimationFrame(callback) {
      frames.push(callback);
      return 7;
    },
    cancelAnimationFrame(handle) {
      cancelledFrames.push(handle);
    },
    setTimeout(callback) {
      timers.push(callback);
      return 8;
    },
    clearTimeout(handle) {
      clearedTimers.push(handle);
    },
  };
  const cancel = scheduleDrawingSourceReadyConnection({
    isReady: () => false,
    connect: () => {
      connections += 1;
    },
    scheduler,
  });

  cancel();
  frames[0](0);
  timers[0]();
  assert.equal(connections, 0);
  assert.deepEqual(cancelledFrames, [7]);
  assert.deepEqual(clearedTimers, [8]);
});

test("authoritative snapshot identity ignores loader object churn but follows checkpoint evidence", () => {
  const input = {
    revisionId: "revision-1",
    revisionVersion: 7,
    bootstrap: { sha256: "a".repeat(64), operationSequence: 41 },
  };
  assert.equal(typeof drawingAuthoritativeSnapshotKey, "function");
  assert.equal(
    drawingAuthoritativeSnapshotKey(structuredClone(input)),
    drawingAuthoritativeSnapshotKey(input),
  );
  assert.notEqual(
    drawingAuthoritativeSnapshotKey({
      ...input,
      bootstrap: { ...input.bootstrap, operationSequence: 42 },
    }),
    drawingAuthoritativeSnapshotKey(input),
  );
  assert.notEqual(
    drawingAuthoritativeSnapshotKey({
      ...input,
      bootstrap: { ...input.bootstrap, sha256: "b".repeat(64) },
    }),
    drawingAuthoritativeSnapshotKey(input),
  );

  const httpInput = {
    revisionId: "revision-1",
    revisionVersion: 7,
    revisionUpdatedAt: "2026-09-02T00:00:00.000000Z",
    sourceSha256: "c".repeat(64),
  };
  assert.equal(
    drawingAuthoritativeSnapshotKey(structuredClone(httpInput)),
    drawingAuthoritativeSnapshotKey(httpInput),
  );
  assert.notEqual(
    drawingAuthoritativeSnapshotKey({
      ...httpInput,
      revisionUpdatedAt: "2026-09-02T00:00:00.000001Z",
    }),
    drawingAuthoritativeSnapshotKey(httpInput),
  );
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
