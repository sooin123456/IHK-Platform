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
const { drawingConnectionSummary } = await vite.ssrLoadModule(
  "/app/lukas/components/drawing-collaboration-presence.tsx",
);

test.after(() => vite.close());

test("connection summary reports healthy only when both transports are connected", () => {
  assert.deepEqual(
    drawingConnectionSummary({
      collaborationEnabled: true,
      collaborationPhase: "connected",
      realtimePhase: "connected",
    }),
    { label: "모두 연결됨", tone: "healthy" },
  );
  assert.deepEqual(
    drawingConnectionSummary({
      collaborationEnabled: true,
      collaborationPhase: "connected",
      realtimePhase: "disconnected",
    }),
    { label: "실시간 연결 끊김", tone: "warning" },
  );
});

test("connection summary surfaces collaboration failures while realtime remains connected", () => {
  const cases = [
    ["denied", "공동 편집 중지"],
    ["degraded", "공동 편집 오프라인"],
    ["retrying", "공동 편집 재연결 중"],
  ];
  for (const [collaborationPhase, label] of cases) {
    assert.deepEqual(
      drawingConnectionSummary({
        collaborationEnabled: true,
        collaborationPhase,
        realtimePhase: "connected",
      }),
      { label, tone: "warning" },
    );
  }
});

test("connection summary distinguishes pending and plan-disabled collaboration", () => {
  assert.deepEqual(
    drawingConnectionSummary({
      collaborationEnabled: true,
      collaborationPhase: "connecting",
      realtimePhase: "connected",
    }),
    { label: "공동 편집 연결 중", tone: "pending" },
  );
  assert.deepEqual(
    drawingConnectionSummary({
      collaborationEnabled: false,
      collaborationPhase: "degraded",
      realtimePhase: "connected",
    }),
    { label: "실시간만 연결됨", tone: "limited" },
  );
});
