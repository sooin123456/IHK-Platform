import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createMemoryRouter, RouterProvider } from "react-router";
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
const workspaceModule = await vite.ssrLoadModule(
  "/app/lukas/components/drawing-workspace.tsx",
);
const realtimeModule = await vite.ssrLoadModule(
  "/app/lukas/lib/drawing-workspace-realtime.ts",
);
const previewModule = await vite.ssrLoadModule(
  "/app/lukas/screens/local-drawing-workspace-preview.tsx",
);
test.after(() => vite.close());

function renderWorkspace(overrides = {}) {
  const fixture = {
    ...previewModule.localDrawingWorkspacePreviewFixture(),
    ...overrides,
  };
  return renderToStaticMarkup(
    createElement(RouterProvider, {
      router: createMemoryRouter(
        [
          {
            path: "/",
            element: createElement(workspaceModule.default, {
              ...fixture,
              previewMode: true,
              realtimeAdapter:
                realtimeModule.createInertDrawingWorkspaceRealtimeAdapter(),
            }),
          },
        ],
        { initialEntries: ["/"] },
      ),
    }),
  );
}

test("task modes expose only their focused panel group and preferred inspector", () => {
  const resolve = workspaceModule.drawingWorkspaceModeDefinition;
  assert.equal(typeof resolve, "function");
  assert.deepEqual(resolve("author"), {
    defaultPanel: "structure",
    inspector: "object",
    label: "작성",
    panels: ["structure", "styles", "blocks"],
  });
  assert.deepEqual(resolve("review"), {
    defaultPanel: "collaboration",
    inspector: "object",
    label: "검토",
    panels: ["collaboration", "history"],
  });
  assert.deepEqual(resolve("quantity"), {
    defaultPanel: "schedules",
    inspector: "result",
    label: "수량·금액",
    panels: ["schedules", "properties"],
  });
});

test("workspace panel keyboard navigation stays inside the visible mode group", () => {
  const resolve = workspaceModule.resolveDrawingWorkspacePanelKey;
  const authorPanels = ["structure", "styles", "blocks"];
  const reviewPanels = ["collaboration", "history"];
  const quantityPanels = ["schedules", "properties"];

  assert.equal(resolve("structure", "ArrowLeft", authorPanels), "blocks");
  assert.equal(resolve("blocks", "ArrowRight", authorPanels), "structure");
  assert.equal(resolve("collaboration", "End", reviewPanels), "history");
  assert.equal(resolve("history", "ArrowRight", reviewPanels), "collaboration");
  assert.equal(resolve("properties", "Home", quantityPanels), "schedules");
  assert.equal(resolve("schedules", "ArrowUp", quantityPanels), "properties");
  assert.equal(resolve("styles", "Enter", authorPanels), null);
});

test("mode keyboard navigation wraps between the three task choices", () => {
  const resolve = workspaceModule.resolveDrawingWorkspaceModeKey;
  assert.equal(typeof resolve, "function");
  assert.equal(resolve("author", "ArrowRight"), "review");
  assert.equal(resolve("review", "ArrowDown"), "quantity");
  assert.equal(resolve("quantity", "ArrowRight"), "author");
  assert.equal(resolve("author", "ArrowLeft"), "quantity");
  assert.equal(resolve("quantity", "Home"), "author");
  assert.equal(resolve("author", "End"), "quantity");
  assert.equal(resolve("review", "Enter"), null);
});

test("opening a panel in another task mode selects that mode's relevant inspector", () => {
  const transition = workspaceModule.drawingWorkspaceModeChangeForPanel;
  assert.deepEqual(transition("author", "schedules"), {
    inspector: "result",
    mode: "quantity",
  });
  assert.deepEqual(transition("quantity", "collaboration"), {
    inspector: "object",
    mode: "review",
  });
  assert.deepEqual(transition("author", "styles"), {
    inspector: null,
    mode: "author",
  });
});

test("rendered editor presents task modes while save and review gates stay visible", () => {
  const html = renderWorkspace();

  assert.match(html, /role="radiogroup" aria-label="작업 모드"/);
  assert.equal(html.match(/role="radio"/g)?.length, 3);
  for (const label of ["작성", "검토", "수량·금액"])
    assert.match(html, new RegExp(`role="radio"[^>]*>${label}<`));
  assert.match(html, /role="radio"[^>]*aria-checked="true"[^>]*>작성</);
  assert.match(html, /aria-label="저장 상태: [^"]+"/);
  assert.match(html, />[^<]*검토 요청</);
  assert.match(
    html,
    /<button(?=[^>]*id="drawing-object-inspector-tab")(?=[^>]*aria-selected="true")[^>]*>/,
  );
});
