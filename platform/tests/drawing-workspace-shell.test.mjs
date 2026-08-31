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
const scaleModule = await vite
  .ssrLoadModule("/app/lukas/components/drawing-scale-control.tsx")
  .catch(() => ({}));
const propertyModule = await vite.ssrLoadModule(
  "/app/lukas/components/drawing-properties-panel.tsx",
);
const estimateRailModule = await vite
  .ssrLoadModule("/app/lukas/components/drawing-estimate-result-rail.tsx")
  .catch(() => ({}));
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

test("drawing export audit refuses a successful response with the wrong content type", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    blob: async () => new Blob(["login"]),
    headers: new Headers({ "content-type": "text/html" }),
    ok: true,
    redirected: false,
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
      /응답 형식/,
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

function renderEstimateRail(overrides = {}) {
  const summary = {
    status: "draft",
    binding: {
      id: "32000000-0000-4000-8000-000000000001",
      projectId: "32000000-0000-4000-8000-000000000002",
      drawingRevisionId: "32000000-0000-4000-8000-000000000003",
      boqVersionId: "32000000-0000-4000-8000-000000000004",
      createdAt: "2026-08-31T00:00:00.000Z",
    },
    boq: {
      id: "32000000-0000-4000-8000-000000000004",
      title: "실내건축 초안",
      versionNo: 2,
      priceBookName: "회사 단가표",
      status: "draft",
      engineVersion: "VERIFIED-BOQ-1.1",
    },
    rows: [
      {
        classification: "바닥",
        itemCode: "F-001",
        itemName: "바닥 마감",
        quantity: "2.5",
        unit: "m2",
        totalUnitRateKrw: "10000",
        amountKrw: "26001",
        state: "draft",
        reason: null,
        subjectRefs: [{ kind: "object", id: "object-1" }],
        evidence: [],
      },
      {
        classification: "벽",
        itemCode: "W-001",
        itemName: "벽 마감",
        quantity: "3",
        unit: "m",
        totalUnitRateKrw: null,
        amountKrw: null,
        state: "missing_evidence",
        reason: "현장 원본을 연결하세요.",
        subjectRefs: [{ kind: "object", id: "object-2" }],
        evidence: [],
      },
    ],
    directCostKrw: "26001",
    missingRateCount: 1,
    reviewCount: 1,
  };
  return renderToStaticMarkup(
    createElement(RouterProvider, {
      router: createMemoryRouter(
        [
          {
            path: "/",
            element: createElement(
              estimateRailModule.DrawingEstimateResultRail,
              {
                capability: "editor",
                drawingRevisionId: "32000000-0000-4000-8000-000000000003",
                estimateOptions: [],
                projectId: "32000000-0000-4000-8000-000000000002",
                summary,
                workspaceId: "32000000-0000-4000-8000-000000000005",
                ...overrides,
              },
            ),
          },
        ],
        { initialEntries: ["/"] },
      ),
    }),
  );
}

test("estimate result rail renders server amounts, gap names, and BOQ navigation accessibly", () => {
  assert.equal(
    typeof estimateRailModule.DrawingEstimateResultRail,
    "function",
    "the focused estimate result rail must exist",
  );
  const html = renderEstimateRail();
  assert.match(html, /aria-label="총 예상 금액"/);
  assert.match(html, /26,001원/);
  assert.match(html, /aria-label="단가 누락 1건"/);
  assert.match(html, /aria-label="BOQ 상세 열기"/);
  assert.match(html, />초안</);
  assert.match(html, />근거 누락</);
  assert.match(html, /현장 원본을 연결하세요/);
});

test("estimate result rail exposes the approved binding control names", () => {
  const html = renderEstimateRail({
    estimateOptions: [
      {
        id: "32000000-0000-4000-8000-000000000004",
        title: "실내건축 초안",
        versionNo: 2,
        priceBookName: "회사 단가표",
      },
    ],
    summary: {
      status: "unbound",
      binding: null,
      boq: null,
      rows: [],
      directCostKrw: null,
      missingRateCount: 0,
      reviewCount: 0,
    },
  });
  assert.match(
    html,
    /<label[^>]*for="estimate-boq-version"[^>]*>\s*연결할 내역 버전\s*<\/label>/,
  );
  assert.match(
    html,
    /<button[^>]*type="submit"[^>]*>\s*내역 연결\s*<\/button>/,
  );
});

test("workspace shell mounts accessible result and intact object inspector panels", async () => {
  const source = await readFile(
    new URL("../app/lukas/components/drawing-workspace.tsx", import.meta.url),
    "utf8",
  );
  assert.match(source, /DrawingEstimateResultRail/);
  assert.match(source, /aria-label="검사기 보기"/);
  assert.match(source, /role="tablist"/);
  assert.match(source, /role="tabpanel"/);
  for (const label of ["결과", "객체"])
    assert.match(source, new RegExp(`>\\s*${label}\\s*<`));
  assert.match(source, /<DrawingInspector/);
});

test("estimate result rail keeps assumption reasons and confirmed exports distinct", () => {
  const base = {
    classification: "문",
    itemCode: "D-001",
    itemName: "문",
    quantity: "1",
    unit: "EA",
    totalUnitRateKrw: "9007199254740993.125",
    amountKrw: "30000",
    subjectRefs: [{ kind: "block_instance", id: "door-1" }],
    evidence: [],
  };
  const html = renderEstimateRail({
    summary: {
      status: "confirmed",
      binding: {
        id: "32000000-0000-4000-8000-000000000001",
        projectId: "32000000-0000-4000-8000-000000000002",
        drawingRevisionId: "32000000-0000-4000-8000-000000000003",
        boqVersionId: "32000000-0000-4000-8000-000000000004",
        createdAt: "2026-08-31T00:00:00.000Z",
      },
      boq: {
        id: "32000000-0000-4000-8000-000000000004",
        title: "승인 내역",
        versionNo: 2,
        priceBookName: "회사 단가표",
        status: "approved",
        engineVersion: "VERIFIED-BOQ-1.1",
      },
      rows: [
        { ...base, state: "assumption", reason: "기존 문 수량을 가정함" },
        { ...base, itemCode: "D-002", state: "confirmed", reason: null },
        {
          ...base,
          itemCode: "D-003",
          state: "needs_review",
          reason: "품목 확인 필요",
        },
      ],
      directCostKrw: "90000",
      missingRateCount: 0,
      reviewCount: 1,
    },
  });
  for (const label of ["확정", "가정값", "검토 필요"])
    assert.match(html, new RegExp(`>${label}<`));
  assert.match(html, /기존 문 수량을 가정함/);
  assert.match(html, /9,007,199,254,740,993\.125원/);
  for (const format of ["csv", "xlsx", "manifest"])
    assert.match(html, new RegExp(`download=${format}`));
});

function deferred() {
  let reject;
  let resolve;
  const promise = new Promise((nextResolve, nextReject) => {
    reject = nextReject;
    resolve = nextResolve;
  });
  return { promise, reject, resolve };
}

test("scale control exposes bounded source-free, PDF calibration, and read-only states", () => {
  assert.equal(typeof scaleModule.DrawingScaleControl, "function");
  const base = {
    actorId: "actor-a",
    canEdit: true,
    onCalibrationCaptureChange() {},
    onCommand() {},
    state: {},
  };
  const render = (canvas, canEdit = true) =>
    renderToStaticMarkup(
      createElement(scaleModule.DrawingScaleControl, {
        ...base,
        canvas,
        canEdit,
      }),
    );
  const blank = render({
    id: "30000000-0000-4000-8000-000000000001",
    pageId: "30000000-0000-4000-8000-000000000002",
    name: "Model",
    spaceKind: "model",
    widthMillimeters: 100,
    heightMillimeters: 100,
    background: null,
    sortOrder: 0,
    version: 1,
  });
  assert.match(blank, /기준 좌표 · 1 도면 단위 = 1 mm/);
  assert.doesNotMatch(blank, /두 점 선택/);

  const pdfCanvas = {
    id: "30000000-0000-4000-8000-000000000003",
    pageId: "30000000-0000-4000-8000-000000000002",
    name: "PDF",
    spaceKind: "paper",
    widthMillimeters: 100,
    heightMillimeters: 100,
    background: {
      sourceFileId: "30000000-0000-4000-8000-000000000004",
      sourceSha256: "b".repeat(64),
      pdfPageNumber: 1,
      calibration: null,
    },
    sortOrder: 0,
    version: 1,
  };
  const editable = render(pdfCanvas);
  assert.match(editable, /축척 미확정/);
  assert.match(editable, /두 점 선택/);
  for (const unit of ["mm", "cm", "m"])
    assert.match(editable, new RegExp(`value="${unit}"`));
  const readOnly = render(pdfCanvas, false);
  assert.match(readOnly, /조회 전용/);
  assert.doesNotMatch(readOnly, /<form/);

  const calibrated = render({
    ...pdfCanvas,
    background: {
      ...pdfCanvas.background,
      calibration: {
        normalizedStart: { x: 0, y: 0 },
        normalizedEnd: { x: 1, y: 0 },
        realLengthMillimeters: 3000,
        millimetersPerNormalizedUnit: 3000,
      },
    },
  });
  assert.match(calibrated, /3000 mm/);
  assert.match(calibrated, /다시 보정/);
  assert.match(calibrated, /초안 수량/);
});

test("assumption evidence validates and stale reasons clear in the same property value batch", () => {
  assert.equal(
    typeof propertyModule.prepareDrawingEvidencePropertyValues,
    "function",
  );
  const schemas = [
    { id: "31000000-0000-4000-8000-000000000001", name: "근거 상태" },
    { id: "31000000-0000-4000-8000-000000000002", name: "근거 사유" },
  ];
  assert.deepEqual(
    propertyModule.prepareDrawingEvidencePropertyValues(
      schemas,
      { [schemas[0].id]: "가정값", [schemas[1].id]: "  현장 확인 필요  " },
      {},
    ),
    { [schemas[0].id]: "가정값", [schemas[1].id]: "현장 확인 필요" },
  );
  assert.throws(
    () =>
      propertyModule.prepareDrawingEvidencePropertyValues(
        schemas,
        { [schemas[0].id]: "가정값", [schemas[1].id]: "   " },
        {},
      ),
    /근거 사유/,
  );
  assert.deepEqual(
    propertyModule.prepareDrawingEvidencePropertyValues(
      schemas,
      { [schemas[0].id]: "현장 실측" },
      { [schemas[0].id]: "가정값", [schemas[1].id]: "stale" },
    ),
    { [schemas[0].id]: "현장 실측", [schemas[1].id]: null },
  );
  assert.deepEqual(
    propertyModule.prepareDrawingEvidencePropertyValues(
      schemas,
      { [schemas[0].id]: null },
      { [schemas[0].id]: "가정값", [schemas[1].id]: "stale" },
    ),
    { [schemas[0].id]: null, [schemas[1].id]: null },
  );
  assert.deepEqual(
    propertyModule.prepareDrawingEvidencePropertyValues(
      schemas,
      { [schemas[0].id]: "현장 실측" },
      { [schemas[0].id]: null, [schemas[1].id]: null },
    ),
    { [schemas[0].id]: "현장 실측", [schemas[1].id]: null },
  );
});

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

test("workspace SSR shell opens the result inspector by default for an M1 workspace", () => {
  const html = renderWorkspace();
  assert.match(html, /<main class="[^"]*xl:h-dvh[^"]*xl:overflow-hidden/);
  assert.match(html, /xl:\[contain:strict\]/);
  assert.match(
    html,
    /grid-cols-1[^"]*xl:grid-cols-\[15rem_minmax\(0,1fr\)_18rem\][^"]*xl:overflow-hidden/,
  );
  assert.match(
    html,
    /aria-label="도면 도구 패널" class="[^"]*order-2[^"]*xl:order-1/,
  );
  assert.match(
    html,
    /aria-label="도면 캔버스" class="[^"]*order-1[^"]*xl:order-2/,
  );
  assert.match(html, /aria-label="속성 검사기"/);
  assert.doesNotMatch(html, /aria-label="속성 검사기"[^>]*hidden=""/);
  assert.match(html, /aria-label="왼쪽 도구 패널 숨기기"/);
  assert.match(html, /aria-label="속성 검사기 숨기기"/);
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
  assert.match(
    html,
    /객체를 선택하면 원본부터 물량·금액까지 연결 상태를 안내합니다/,
  );
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
  assert.match(
    source,
    /md:grid-cols-\[minmax\(20rem,1fr\)_minmax\(20rem,1fr\)\]/,
  );
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

test("workspace SSR shell exposes independent tool and inspector tablists accessibly", () => {
  const html = renderWorkspace();
  assert.match(
    html,
    /role="tablist" aria-label="도면 도구" data-drawing-shortcuts="ignore"/,
  );
  assert.equal(html.match(/role="tab"/g)?.length, 9);
  assert.equal(html.match(/role="tabpanel"/g)?.length, 3);
  assert.equal(html.match(/aria-selected="true"/g)?.length, 2);
  assert.equal(html.match(/aria-selected="false"/g)?.length, 7);
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
  assert.match(
    html,
    /<button(?=[^>]*id="drawing-estimate-result-tab")(?=[^>]*tabindex="0")[^>]*>/,
  );
  assert.match(
    html,
    /<button(?=[^>]*id="drawing-object-inspector-tab")(?=[^>]*tabindex="-1")[^>]*>/,
  );
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

test("inspector tabs wrap with arrows and jump with Home and End", () => {
  const resolve = workspaceModule.resolveDrawingInspectorModeKey;
  assert.equal(typeof resolve, "function");
  assert.equal(resolve("result", "ArrowRight"), "object");
  assert.equal(resolve("object", "ArrowRight"), "result");
  assert.equal(resolve("result", "ArrowLeft"), "object");
  assert.equal(resolve("object", "ArrowLeft"), "result");
  assert.equal(resolve("object", "Home"), "result");
  assert.equal(resolve("result", "End"), "object");
  assert.equal(resolve("result", "Enter"), null);
});

test("local preview uses project-owned drawing copy", () => {
  const fixture = previewModule.localDrawingWorkspacePreviewFixture();
  assert.doesNotMatch(fixture.workspace.document.title, /Rayon/);
  assert.doesNotMatch(
    fixture.workspace.primarySource.original_filename,
    /Rayon/,
  );
  assert.doesNotMatch(renderWorkspace(), /Rayon \/ /);
});

test("local preview exposes its inert connected realtime state in the workspace top bar", () => {
  assert.match(
    renderWorkspace(),
    /aria-label="실시간 상태: 실시간 연결됨"[^>]*>[\s\S]*?class="drawing-workspace-status-message">실시간 연결됨<\/span>/,
  );
});

test("workspace offers the native export dialog to editors and viewers", () => {
  const editor = renderWorkspace();
  const viewer = renderWorkspace({ capability: "viewer" });

  assert.match(editor, /<button[^>]*>[^<]*내보내기/);
  assert.match(viewer, /<button[^>]*>[^<]*내보내기/);
  assert.doesNotMatch(viewer, /name="intent"[^>]*value="export"/);
});

test("source-free documents keep the blank canvas and audited export launcher", () => {
  const fixture = previewModule.localDrawingWorkspacePreviewFixture();
  const html = renderWorkspace({
    selectedIfcFileId: null,
    sourceBundle: undefined,
    workspace: {
      ...fixture.workspace,
      primarySource: null,
      document: {
        ...fixture.workspace.document,
        source_file_id: null,
        source_sha256: null,
      },
    },
  });
  assert.match(html, /원본 없음 · 빈 캔버스/);
  assert.match(html, /<button[^>]*>[^<]*내보내기/);
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
