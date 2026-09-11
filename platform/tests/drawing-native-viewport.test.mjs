import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { createServer } from "vite";
import {
  worldToScreen,
  zoomViewportAroundPointer,
} from "../app/lukas/lib/drawing-geometry.ts";
import { drawingWorkspaceObjectFocusViewport } from "../app/lukas/lib/drawing-workspace-view.ts";

test("native A3 model fits with margins and wheel zoom does not jump to the old minimum", async (t) => {
  const vite = await createServer({
    appType: "custom",
    configFile: false,
    logLevel: "silent",
    resolve: { alias: { "~": path.resolve("app") } },
    server: { middlewareMode: true },
  });
  t.after(() => vite.close());
  const { drawingFittedViewport } = await vite.ssrLoadModule(
    "/app/lukas/components/drawing-canvas.client.tsx",
  );
  for (const size of [
    { width: 912, height: 512 },
    { width: 600, height: 400 },
  ]) {
    const background = { kind: "blank", width: 21000, height: 14850 };
    const viewport = drawingFittedViewport(size, background);
    const topLeft = worldToScreen({ x: 0, y: 0 }, viewport);
    const bottomRight = worldToScreen(
      { x: background.width, y: background.height },
      viewport,
    );
    assert.ok(
      topLeft.x >= 39.999 && topLeft.y >= 39.999,
      JSON.stringify({ size, viewport, topLeft }),
    );
    assert.ok(
      bottomRight.x <= size.width - 39.999 &&
        bottomRight.y <= size.height - 39.999,
    );
    const pointer = { x: size.width / 2, y: size.height / 2 };
    const zoomed = zoomViewportAroundPointer(
      pointer,
      viewport,
      viewport.zoom * 1.05,
    );
    assert.equal(
      zoomed.zoom,
      viewport.zoom * 1.05,
      "first wheel event preserves fitted zoom continuity",
    );
  }
});

test("focusing a native model-sized area fits its complete bounds", () => {
  for (const origin of [
    { x: 0, y: 0 },
    { x: -18000, y: -9000 },
  ]) {
    const result = drawingWorkspaceObjectFocusViewport({
      bounds: { ...origin, width: 21000, height: 14850 },
      canvasId: "canvas",
      pageId: "page",
      viewportSize: { width: 912, height: 512 },
    });
    const start = worldToScreen(origin, result.viewport);
    const end = worldToScreen(
      { x: origin.x + 21000, y: origin.y + 14850 },
      result.viewport,
    );
    assert.ok(start.x >= 47.999 && start.y >= 47.999);
    assert.ok(end.x <= 912 - 47.999 && end.y <= 512 - 47.999);
  }
});
