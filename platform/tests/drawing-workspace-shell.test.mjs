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
const documentStoreModule = await vite.ssrLoadModule(
  "/app/lukas/lib/drawing-document-store.ts",
);
const drawingCommandsModule = await vite.ssrLoadModule(
  "/app/lukas/lib/drawing-commands.ts",
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

function deferred() {
  let reject;
  let resolve;
  const promise = new Promise((nextResolve, nextReject) => {
    reject = nextReject;
    resolve = nextResolve;
  });
  return { promise, reject, resolve };
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

test("local preview exposes its inert connected realtime state in the workspace top bar", () => {
  assert.match(
    renderWorkspace(),
    /aria-label="실시간 상태: 실시간 연결됨"[^>]*>[^<]*실시간 연결됨/,
  );
});

test("same-revision loader refresh keeps the locally edited drawing graph", () => {
  const local = drawingCommandsModule.createDrawingDocumentState({
    revisionId: "revision-a",
    layers: [
      {
        id: "00000000-0000-4000-8000-000000000101",
        locked: false,
        name: "Local edits",
        systemKind: "work",
        version: 1,
        visible: true,
      },
    ],
    objects: [
      {
        geometry: {
          height: 1,
          origin: { x: 0, y: 0 },
          rotation: 0,
          type: "rectangle",
          width: 1,
        },
        id: "00000000-0000-4000-8000-000000000102",
        layerId: "00000000-0000-4000-8000-000000000101",
        name: "Unsaved local edit",
        style: { fill: null, stroke: "#111111", strokeWidth: 1 },
        version: 1,
      },
    ],
  });
  const freshLoaderState = drawingCommandsModule.createDrawingDocumentState({
    revisionId: "revision-a",
    layers: [],
    objects: [],
  });
  const documentStore = documentStoreModule.createDrawingDocumentStore(local);
  const locallyEditedSnapshot = documentStore.getSnapshot();

  const lifecycleKey = "user-a:revision-a";
  const nextKey = workspaceModule.replaceDrawingWorkspaceGraphForLifecycle({
    documentStore,
    lifecycleKey,
    previousLifecycleKey: lifecycleKey,
    recoveredState: freshLoaderState,
  });

  assert.equal(nextKey, lifecycleKey);
  assert.equal(documentStore.getSnapshot(), locallyEditedSnapshot);
  assert.equal(
    documentStore.getSnapshot().objects["00000000-0000-4000-8000-000000000102"].name,
    "Unsaved local edit",
  );
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

test("real export lifecycle times out a stalled executor, clears its gate, and admits a second run", async () => {
  const createOperation = exportDialogModule.createDrawingExportOperation;
  const runLifecycle = exportDialogModule.runDrawingExportLifecycle;
  assert.equal(
    typeof runLifecycle,
    "function",
    "the dialog must use one production lifecycle boundary",
  );
  const activeOperationRef = { current: null };
  const firstExecutor = deferred();
  const statuses = [];
  const downloads = [];
  const terminalGateValues = [];
  let fireTimeout;
  const firstRun = runLifecycle({
    activeOperationRef,
    createOperation: () =>
      createOperation({
        cancelScheduled: () => {},
        schedule: (callback, milliseconds) => {
          assert.equal(milliseconds, 30_000);
          fireTimeout = callback;
          return 29;
        },
      }),
    download: (value) => downloads.push(value),
    execute: async () => firstExecutor.promise,
    publishStatus: (status) => {
      statuses.push(status);
      if (status.kind === "error" || status.kind === "success")
        terminalGateValues.push(activeOperationRef.current);
    },
  });
  await Promise.resolve();
  assert.notEqual(activeOperationRef.current, null);

  fireTimeout();
  assert.equal(
    await Promise.race([
      firstRun.then(() => "settled"),
      new Promise((resolve) => setTimeout(() => resolve("stalled"), 25)),
    ]),
    "settled",
  );
  assert.equal(activeOperationRef.current, null);
  assert.deepEqual(
    statuses.map(({ kind }) => kind),
    ["working", "error"],
  );
  assert.match(statuses.at(-1).message, /30초.*시간을 초과/i);
  assert.deepEqual(downloads, []);
  assert.deepEqual(terminalGateValues, [null]);

  let secondExecutorCount = 0;
  await runLifecycle({
    activeOperationRef,
    createOperation: () =>
      createOperation({
        cancelScheduled: () => {},
        schedule: () => 31,
      }),
    download: (value) => downloads.push(value),
    execute: async () => {
      secondExecutorCount += 1;
      return "second export";
    },
    publishStatus: (status) => {
      statuses.push(status);
      if (status.kind === "error" || status.kind === "success")
        terminalGateValues.push(activeOperationRef.current);
    },
  });
  assert.equal(secondExecutorCount, 1);
  assert.deepEqual(downloads, ["second export"]);
  assert.equal(statuses.at(-1).kind, "success");
  assert.deepEqual(terminalGateValues, [null, null]);

  firstExecutor.resolve("late first export");
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(downloads, ["second export"]);
  assert.equal(statuses.filter(({ kind }) => kind === "success").length, 1);
});

test("real export lifecycle cancels a stalled disposer once without blocking the next run", async () => {
  const createOperation = exportDialogModule.createDrawingExportOperation;
  const runLifecycle = exportDialogModule.runDrawingExportLifecycle;
  assert.equal(typeof runLifecycle, "function");
  const activeOperationRef = { current: null };
  const stalledDisposer = deferred();
  const disposerStarted = deferred();
  const statuses = [];
  const downloads = [];
  let disposerCount = 0;
  let firstOperation;
  const firstRun = runLifecycle({
    activeOperationRef,
    createOperation: () => {
      firstOperation = createOperation({ schedule: () => 37 });
      return firstOperation;
    },
    download: (value) => downloads.push(value),
    execute: async ({ registerDisposer }) => {
      registerDisposer(async () => {
        disposerCount += 1;
        disposerStarted.resolve();
        return stalledDisposer.promise;
      });
      return "first export";
    },
    publishStatus: (status) => statuses.push(status),
  });
  await disposerStarted.promise;

  firstOperation.cancel();
  assert.equal(
    await Promise.race([
      firstRun.then(() => "settled"),
      new Promise((resolve) => setTimeout(() => resolve("stalled"), 25)),
    ]),
    "settled",
  );
  assert.equal(disposerCount, 1);
  assert.equal(activeOperationRef.current, null);
  assert.deepEqual(downloads, []);
  assert.deepEqual(
    statuses.map(({ kind }) => kind),
    ["working", "error"],
  );
  assert.match(statuses.at(-1).message, /취소/);

  let secondExecutorCount = 0;
  await runLifecycle({
    activeOperationRef,
    createOperation: () =>
      createOperation({
        cancelScheduled: () => {},
        schedule: () => 41,
      }),
    download: (value) => downloads.push(value),
    execute: async () => {
      secondExecutorCount += 1;
      return "second export";
    },
    publishStatus: (status) => statuses.push(status),
  });
  assert.equal(secondExecutorCount, 1);
  assert.deepEqual(downloads, ["second export"]);
  assert.equal(statuses.at(-1).kind, "success");

  stalledDisposer.reject(new Error("late disposer failure"));
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(disposerCount, 1);
  assert.deepEqual(downloads, ["second export"]);
  assert.equal(statuses.filter(({ kind }) => kind === "success").length, 1);
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
