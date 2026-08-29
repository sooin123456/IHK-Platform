import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
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
const exportDialogModule = await vite.ssrLoadModule(
  "/app/lukas/components/drawing-export-dialog.tsx",
);
const previewModule = await vite.ssrLoadModule(
  "/app/lukas/screens/local-drawing-workspace-preview.tsx",
);
test.after(() => vite.close());

test("drawing export audit refuses a followed login redirect as an artifact", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    blob: async () => new Blob(["login"]),
    headers: new Headers({ "content-type": "text/html" }),
    ok: true,
    redirected: true,
    status: 200,
  });
  try {
    await assert.rejects(
      exportDialogModule.auditDrawingExport(
        new Blob(["<svg/>"]),
        "drawing.svg",
        "00000000-0000-4000-8000-000000000001",
        "00000000-0000-4000-8000-000000000002",
        "00000000-0000-4000-8000-000000000003",
      ),
      /redirect/i,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

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

test("review rejection version fences the prior browser freeze request", () => {
  const revisionId = "00000000-0000-4000-8000-000000000123";
  assert.notEqual(
    workspaceModule.drawingReviewFreezeStorageKey(revisionId, 1),
    workspaceModule.drawingReviewFreezeStorageKey(revisionId, 2),
  );
});

test("review submit stays disabled for pending, conflicted, or volatile work", () => {
  const canSubmit = workspaceModule.drawingReviewSubmissionEnabled;
  assert.equal(
    canSubmit({
      outboxReady: true,
      reviewPreparing: false,
      pending: 0,
      conflicted: false,
      volatileCount: 0,
      persistenceFailed: false,
    }),
    true,
  );
  for (const blocked of [
    { pending: 1 },
    { conflicted: true },
    { volatileCount: 1 },
    { persistenceFailed: true },
  ])
    assert.equal(
      canSubmit({
        outboxReady: true,
        reviewPreparing: false,
        pending: 0,
        conflicted: false,
        volatileCount: 0,
        persistenceFailed: false,
        ...blocked,
      }),
      false,
    );
});

test("workspace SSR shell keeps an empty inspector collapsed for a canvas-first desktop", () => {
  const html = renderWorkspace();
  assert.match(html, /<main class="[^"]*xl:h-dvh[^"]*xl:overflow-hidden/);
  assert.match(html, /xl:\[contain:strict\]/);
  assert.match(
    html,
    /grid-cols-1[^"]*xl:grid-cols-\[15rem_minmax\(0,1fr\)\][^"]*xl:overflow-hidden/,
  );
  assert.match(
    html,
    /aria-label="도면 도구 패널" class="[^"]*order-2[^"]*xl:order-1/,
  );
  assert.match(
    html,
    /aria-label="도면 캔버스" class="[^"]*order-1[^"]*xl:order-2/,
  );
  assert.match(html, /aria-label="속성 검사기"[^>]*hidden=""/);
  assert.match(html, /aria-label="왼쪽 도구 패널 숨기기"/);
  assert.match(html, /aria-label="속성 검사기 열기"/);
  assert.match(html, /aria-label="캔버스 도구"/);
  assert.match(html, /aria-label="P2 도면 객체 미리보기"/);
});

test("workspace makes modes, tools, and business lineage visible without icon guesswork", async () => {
  const html = renderWorkspace();
  assert.match(html, /aria-label="도면 작업실 보기"/);
  assert.match(html, />2D 도면</);
  assert.match(html, />IFC 3D</);
  assert.match(html, />분할 보기</);
  assert.match(html, /aria-label="캔버스 작성 도구"/);
  assert.match(
    html,
    /aria-label="캔버스 도구" class="[^"]*overflow-x-auto[^"]*" style="max-width:calc\(100% - 2rem\)"/,
  );
  for (const label of [
    "선택",
    "선",
    "건축",
    "폴리라인",
    "사각형",
    "원",
    "텍스트",
    "치수",
    "이동",
    "화면 맞춤",
  ])
    assert.match(html, new RegExp(`data-tool-label="${label}"[^>]*>${label}<`));
  assert.match(html, /aria-label="업무 계보"/);
  for (const step of ["원본", "객체", "이슈", "승인", "물량·금액"])
    assert.match(html, new RegExp(`data-lineage-step="${step}"[^>]*>${step}<`));
  assert.match(html, /aria-label="선택 객체 업무 계보"/);
  assert.match(html, /객체를 선택하면 원본부터 물량·금액까지 연결 상태를 안내합니다/);
});

test("business lineage points to the earliest missing link", () => {
  const summarize = workspaceModule.drawingWorkspaceLineageProgress;
  assert.equal(typeof summarize, "function");
  assert.deepEqual(
    summarize({
      hasApproval: false,
      hasIssue: false,
      hasObject: false,
      hasQuantity: false,
      hasSource: false,
    }),
    {
      completed: 0,
      next: "object",
      total: 5,
    },
  );
  assert.deepEqual(
    summarize({
      hasApproval: false,
      hasIssue: false,
      hasObject: true,
      hasQuantity: false,
      hasSource: false,
    }),
    {
      completed: 1,
      next: "source",
      total: 5,
    },
  );
  assert.deepEqual(
    summarize({
      hasApproval: true,
      hasIssue: true,
      hasObject: true,
      hasQuantity: true,
      hasSource: true,
    }),
    {
      completed: 5,
      next: null,
      total: 5,
    },
  );
});

test("split view remains a real two-pane workspace on tablet widths", async () => {
  const source = await readFile(
    new URL("../app/lukas/components/drawing-workspace.tsx", import.meta.url),
    "utf8",
  );
  assert.match(source, /window\.matchMedia\("\(max-width: 767px\)"\)/);
  assert.match(source, /md:grid-cols-\[minmax\(20rem,1fr\)_minmax\(20rem,1fr\)\]/);
  assert.match(
    source,
    /aria-label="분할 보기 패널"[^>]*className="[^"]*md:hidden/,
  );
  assert.doesNotMatch(
    source,
    /aria-label="분할 보기 패널"[^>]*className="[^"]*lg:hidden/,
  );
});

test("tablet toolbar gives labeled tools their intrinsic width", async () => {
  const css = await readFile(
    new URL("../app/app.css", import.meta.url),
    "utf8",
  );
  const tabletToolbarButtons = css.match(
    /\.drawing-workspace-toolbar \[data-slot="button"\][\s\S]*?\}/,
  )?.[0];
  assert.ok(tabletToolbarButtons, "tablet toolbar button rule must exist");
  assert.match(tabletToolbarButtons, /width:\s*auto/);
  assert.doesNotMatch(tabletToolbarButtons, /\n\s*width:\s*44px/);
});

test("architectural tool menu uses the existing portalled dropdown trigger", () => {
  const html = renderWorkspace();
  assert.match(
    html,
    /data-slot="dropdown-menu-trigger"[^>]*aria-label="건축 객체"/,
  );
});

test("quantity lineage status belongs only to the selected drawing object", () => {
  const hasLineage = workspaceModule.drawingObjectHasQuantityLineage;
  assert.equal(typeof hasLineage, "function");
  const rows = [
    {
      quantity: {
        drawingObjectId: "object-a",
      },
    },
  ];
  assert.equal(hasLineage(rows, "object-a"), true);
  assert.equal(hasLineage(rows, "object-b"), false);
  assert.equal(hasLineage(rows, null), false);
  assert.equal(hasLineage(undefined, "object-a"), false);
});

test("workspace dock shortcuts recover both desktop docks outside editable controls", () => {
  const resolve = workspaceModule.resolveDrawingWorkspaceDockShortcut;
  assert.equal(typeof resolve, "function");
  assert.equal(resolve({ key: "[", target: null }), "left");
  assert.equal(resolve({ key: "]", target: null }), "inspector");
  for (const modifier of ["altKey", "ctrlKey", "metaKey", "shiftKey"])
    assert.equal(resolve({ key: "[", target: null, [modifier]: true }), null);
  assert.equal(
    resolve({
      key: "[",
      target: { tagName: "INPUT", closest: () => null },
    }),
    null,
  );
  assert.equal(resolve({ key: "Escape", target: null }), null);
});

test("split view preserves the lineage inspector and collapses only the left dock on compact desktop widths", () => {
  const resolve = workspaceModule.resolveDrawingWorkspaceSplitDockState;
  assert.equal(typeof resolve, "function");
  assert.deepEqual(
    resolve({
      enteringSplit: true,
      leftDockOpen: true,
      inspectorOpen: true,
      viewportWidth: 1280,
    }),
    { leftDockOpen: false, inspectorOpen: true },
  );
  assert.deepEqual(
    resolve({
      enteringSplit: true,
      leftDockOpen: true,
      inspectorOpen: true,
      viewportWidth: 1600,
    }),
    { leftDockOpen: true, inspectorOpen: true },
  );
  assert.deepEqual(
    resolve({
      enteringSplit: false,
      leftDockOpen: true,
      inspectorOpen: false,
      viewportWidth: 1280,
    }),
    { leftDockOpen: true, inspectorOpen: false },
  );
});

test("page and layer creation fail closed before the durable bridge is ready", async () => {
  const html = renderWorkspace();
  assert.doesNotMatch(html, /<details[^>]*>.*페이지 만들기/s);
  assert.doesNotMatch(html, /<details[^>]*>.*레이어 만들기/s);
  assert.doesNotMatch(html, /<details[^>]*open=""/);
  assert.match(html, />표·일람</);
  assert.doesNotMatch(html, />Schedule</);
  assert.doesNotMatch(html, /페이지 및 canvas|Paper canvas|Model canvas/);

  const [pagesPanel, layersPanel] = await Promise.all([
    readFile(
      new URL(
        "../app/lukas/components/drawing-pages-panel.tsx",
        import.meta.url,
      ),
      "utf8",
    ),
    readFile(
      new URL(
        "../app/lukas/components/drawing-layers-panel.tsx",
        import.meta.url,
      ),
      "utf8",
    ),
  ]);
  assert.match(pagesPanel, /<details[^>]*>.*페이지 만들기/s);
  assert.match(layersPanel, /<details[^>]*>.*레이어 만들기/s);
});

test("workspace creation and export copy stays Korean", async () => {
  const [tables, exportDialog] = await Promise.all([
    readFile(
      new URL(
        "../app/lukas/components/drawing-tables-panel.tsx",
        import.meta.url,
      ),
      "utf8",
    ),
    readFile(
      new URL(
        "../app/lukas/components/drawing-export-dialog.tsx",
        import.meta.url,
      ),
      "utf8",
    ),
  ]);
  assert.doesNotMatch(tables, /name: "Object name"|name: "Note"/);
  assert.doesNotMatch(exportDialog, /내보낼 canvas가 없습니다/);
});

test("workspace SSR shell exposes one selected panel from seven accessible tabs", () => {
  const html = renderWorkspace();
  assert.match(
    html,
    /role="tablist" aria-label="도면 도구" data-drawing-shortcuts="ignore"/,
  );
  assert.equal(html.match(/role="tab"/g)?.length, 7);
  assert.equal(html.match(/role="tabpanel"/g)?.length, 1);
  assert.equal(html.match(/role="tab"[^>]*aria-selected="true"/g)?.length, 1);
  assert.equal(html.match(/role="tab"[^>]*aria-selected="false"/g)?.length, 6);
  assert.match(html, /role="tabpanel"[^>]*id="drawing-panel-structure"/);
  assert.doesNotMatch(html, /role="tabpanel"[^>]*hidden=""/);
  for (const label of [
    "페이지·레이어",
    "스타일",
    "속성",
    "표·일람",
    "블록",
    "댓글·이슈",
    "변경 이력",
  ])
    assert.match(html, new RegExp(`role="tab"[^>]*>${label}<`));
});

test("workspace panel tabs wrap with arrows and jump with Home and End", () => {
  const resolve = workspaceModule.resolveDrawingWorkspacePanelKey;
  assert.equal(resolve("structure", "ArrowRight"), "styles");
  assert.equal(resolve("structure", "ArrowLeft"), "history");
  assert.equal(resolve("blocks", "ArrowDown"), "collaboration");
  assert.equal(resolve("properties", "ArrowUp"), "styles");
  assert.equal(resolve("schedules", "Home"), "structure");
  assert.equal(resolve("styles", "End"), "history");
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
