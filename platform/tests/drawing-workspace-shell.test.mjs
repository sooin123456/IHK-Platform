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
const exportDialogModule = await vite.ssrLoadModule(
  "/app/lukas/components/drawing-export-dialog.tsx",
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
            }),
          },
        ],
        { initialEntries: ["/"] },
      ),
    }),
  );
}

test("workspace SSR shell keeps the canvas first below xl and restores three columns at xl", () => {
  const html = renderWorkspace();
  assert.match(
    html,
    /grid-cols-1[^"]*xl:grid-cols-\[15rem_minmax\(0,1fr\)_18rem\]/,
  );
  assert.match(
    html,
    /aria-label="도면 도구 패널" class="[^"]*order-2[^"]*xl:order-1/,
  );
  assert.match(
    html,
    /aria-label="도면 캔버스" class="[^"]*order-1[^"]*xl:order-2/,
  );
  assert.match(
    html,
    /aria-label="속성 검사기" class="[^"]*order-3[^"]*max-h-\[28rem\][^"]*xl:max-h-none/,
  );
  assert.match(html, /aria-label="캔버스 도구"/);
  assert.match(html, /aria-label="P2 도면 객체 미리보기"/);
});

test("workspace SSR shell exposes one selected panel from five accessible tabs", () => {
  const html = renderWorkspace();
  assert.match(
    html,
    /role="tablist" aria-label="도면 도구" data-drawing-shortcuts="ignore"/,
  );
  assert.equal(html.match(/role="tab"/g)?.length, 5);
  assert.equal(html.match(/role="tabpanel"/g)?.length, 5);
  assert.equal(html.match(/role="tab"[^>]*aria-selected="true"/g)?.length, 1);
  assert.equal(html.match(/role="tab"[^>]*aria-selected="false"/g)?.length, 4);
  assert.equal(html.match(/role="tabpanel"[^>]*hidden=""/g)?.length, 4);
  for (const label of ["페이지·레이어", "스타일", "속성", "Schedule", "블록"])
    assert.match(html, new RegExp(`role="tab"[^>]*>${label}<`));
});

test("workspace panel tabs wrap with arrows and jump with Home and End", () => {
  const resolve = workspaceModule.resolveDrawingWorkspacePanelKey;
  assert.equal(resolve("structure", "ArrowRight"), "styles");
  assert.equal(resolve("structure", "ArrowLeft"), "blocks");
  assert.equal(resolve("blocks", "ArrowDown"), "structure");
  assert.equal(resolve("properties", "ArrowUp"), "styles");
  assert.equal(resolve("schedules", "Home"), "structure");
  assert.equal(resolve("styles", "End"), "blocks");
  assert.equal(resolve("styles", "Enter"), null);
});

test("local preview uses project-owned drawing copy", () => {
  const fixture = previewModule.localDrawingWorkspacePreviewFixture();
  assert.doesNotMatch(fixture.workspace.document.title, /Rayon/);
  assert.doesNotMatch(fixture.workspace.file.original_filename, /Rayon/);
  assert.doesNotMatch(renderWorkspace(), /Rayon \/ /);
});

test("workspace offers the native export dialog to editors and viewers", () => {
  const editor = renderWorkspace();
  const viewer = renderWorkspace({ capability: "viewer" });

  assert.match(editor, /<button[^>]*>[^<]*내보내기/);
  assert.match(viewer, /<button[^>]*>[^<]*내보내기/);
  assert.doesNotMatch(viewer, /name="intent"[^>]*value="export"/);
});

test("one export deadline times out at 30 seconds and disposes its timer once", () => {
  const createOperation = exportDialogModule.createDrawingExportOperation;
  assert.equal(
    typeof createOperation,
    "function",
    "the export dialog must expose its real operation deadline",
  );
  let scheduled;
  let scheduledMilliseconds;
  let timerCleanupCount = 0;
  const operation = createOperation({
    cancelScheduled: () => {
      timerCleanupCount += 1;
    },
    schedule: (callback, milliseconds) => {
      scheduled = callback;
      scheduledMilliseconds = milliseconds;
      return 17;
    },
  });

  assert.equal(scheduledMilliseconds, 30_000);
  assert.equal(operation.signal.aborted, false);
  scheduled();
  assert.equal(operation.signal.aborted, true);
  assert.match(operation.abortError().message, /30초.*시간을 초과/i);
  operation.finish();
  operation.finish();
  assert.equal(timerCleanupCount, 1);
});

test("user cancellation is idempotent and distinct from timeout", () => {
  const createOperation = exportDialogModule.createDrawingExportOperation;
  assert.equal(typeof createOperation, "function");
  let timerCleanupCount = 0;
  const operation = createOperation({
    cancelScheduled: () => {
      timerCleanupCount += 1;
    },
    schedule: () => 23,
  });

  operation.cancel();
  operation.cancel();
  assert.equal(operation.signal.aborted, true);
  assert.match(operation.abortError().message, /취소/);
  assert.doesNotMatch(operation.abortError().message, /시간을 초과/);
  operation.finish();
  assert.equal(timerCleanupCount, 1);
});

test("native download revokes its Blob URL exactly once even when click fails", () => {
  const originalDocument = globalThis.document;
  const originalCreateObjectUrl = URL.createObjectURL;
  const originalRevokeObjectUrl = URL.revokeObjectURL;
  let clickCount = 0;
  let createCount = 0;
  let revokeCount = 0;
  globalThis.document = {
    createElement(tagName) {
      assert.equal(tagName, "a");
      return {
        click() {
          clickCount += 1;
          throw new Error("native click failed");
        },
        download: "",
        href: "",
      };
    },
  };
  URL.createObjectURL = () => {
    createCount += 1;
    return "blob:drawing-export-test";
  };
  URL.revokeObjectURL = (href) => {
    assert.equal(href, "blob:drawing-export-test");
    revokeCount += 1;
  };

  try {
    assert.throws(
      () =>
        exportDialogModule.downloadDrawingExport(
          new Blob(["svg"]),
          "drawing.svg",
        ),
      /native click failed/,
    );
  } finally {
    globalThis.document = originalDocument;
    URL.createObjectURL = originalCreateObjectUrl;
    URL.revokeObjectURL = originalRevokeObjectUrl;
  }
  assert.deepEqual(
    { clickCount, createCount, revokeCount },
    {
      clickCount: 1,
      createCount: 1,
      revokeCount: 1,
    },
  );
});
