import assert from "node:assert/strict";
import test from "node:test";

import { createServer } from "vite";

const vite = await createServer({
  appType: "custom",
  configFile: false,
  logLevel: "silent",
  server: { middlewareMode: true },
});
const performanceEvidence = await vite.ssrLoadModule(
  "/e2e/utils/drawing-performance-evidence.ts",
);
test.after(() => vite.close());

test("nearest-rank p95 for 30 literal values is the 29th sorted value", () => {
  assert.equal(
    performanceEvidence.nearestRankPercentile(
      [
        30, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19,
        20, 21, 22, 23, 24, 25, 26, 27, 28, 29,
      ],
      0.95,
    ),
    29,
  );
});

test("nearest-rank percentile rejects fractions outside finite (0, 1]", () => {
  for (const fraction of [-Infinity, -1, 0, 1.000001, Infinity, NaN])
    assert.throws(
      () => performanceEvidence.nearestRankPercentile([1, 2], fraction),
      /M1 percentile fraction must be a finite number in \(0, 1\]/,
    );
});

test("quantized nominal-60 frame intervals calculate aggregate FPS", () => {
  const fps = performanceEvidence.calculateFramesPerSecond?.([
    16.6, 16.7, 16.7,
  ]);
  assert.ok(fps >= 60);
  assert.ok(fps < 60.01);
});

test("one slow interaction cannot hide inside pooled frame samples", () => {
  const summary = performanceEvidence.summarizeInteractionFrameTimes?.(
    {
      pan: Array.from({ length: 24 }, () => 8.3),
      selection: [...Array.from({ length: 21 }, () => 8.3), 50, 50, 50],
      zoom: Array.from({ length: 24 }, () => 8.3),
    },
    { maxP95Milliseconds: 16.7, minFramesPerSecond: 60 },
  );

  assert.equal(summary.status, "NOT MET");
  assert.equal(summary.p95FrameMilliseconds, 50);
  assert.equal(summary.interactions.selection.status, "NOT MET");
  assert.equal(summary.interactions.pan.status, "PASS");
  assert.equal(summary.interactions.zoom.status, "PASS");
});

test("summary gates the worst p95 and lowest aggregate FPS per interaction", () => {
  const summary = performanceEvidence.summarizeInteractionFrameTimes?.(
    {
      pan: Array.from({ length: 24 }, () => 16.6),
      selection: [
        ...Array.from({ length: 12 }, () => 16.6),
        ...Array.from({ length: 12 }, () => 16.7),
      ],
      zoom: Array.from({ length: 24 }, () => 8.3),
    },
    { maxP95Milliseconds: 16.7, minFramesPerSecond: 60 },
  );

  assert.equal(summary.status, "PASS");
  assert.equal(summary.p95FrameMilliseconds, 16.7);
  assert.ok(summary.calculatedFps >= 60);
  assert.equal(summary.sampleCount, 72);
});
