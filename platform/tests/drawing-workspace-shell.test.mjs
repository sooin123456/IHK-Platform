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

test("collaboration entitlement disables network transports without disabling the local editor", async () => {
  const [workspaceSource, presenceSource] = await Promise.all([
    readFile(
      new URL("../app/lukas/components/drawing-workspace.tsx", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL(
        "../app/lukas/components/drawing-collaboration-presence.tsx",
        import.meta.url,
      ),
      "utf8",
    ),
  ]);
  assert.match(workspaceSource, /collaborationEnabled = true/);
  assert.match(
    workspaceSource,
    /useDrawingWorkspaceRealtime\([\s\S]*enabled: collaborationEnabled/,
  );
  assert.match(
    workspaceSource,
    /const runConnect = async \(\) => \{[\s\S]*!collaborationEnabled/,
  );
  assert.match(
    workspaceSource,
    /openPersistence:[\s\S]{0,180}collaborationPersistenceFactory\(/,
  );
  assert.match(
    workspaceSource,
    /createDrawingDraftAdapter\(\{[\s\S]{0,900}enforceServerFreeze:\s*collaborationEnabled/,
  );
  assert.match(
    workspaceSource,
    /<DrawingCollaborationConnectionStatus[\s\S]*enabled=\{collaborationEnabled\}/,
  );
  assert.match(presenceSource, /회사 플랜에서 공동 편집 꺼짐/);
});

test("cross-tab outbox wakeups reuse reconciliation without re-enqueueing settled operations", async () => {
  const source = await readFile(
    new URL("../app/lukas/components/drawing-workspace.tsx", import.meta.url),
    "utf8",
  );
  assert.match(source, /onExternalChange:\s*handleExternalOutboxChange/);
  assert.match(
    source,
    /const reconcileExternalAttempt[\s\S]*currentAttempt\.persistence\?\.flush\(\)[\s\S]*reconcileDrawingCollaborationDraft\([\s\S]*pendingExternalOutboxChange[\s\S]*await reconcileExternalAttempt\(\)[\s\S]*connection\?\.flush\(\)[\s\S]*await flush\(\)/,
  );
  assert.match(
    source,
    /settledExternalOutboxChange[\s\S]*requestExportCheckpointRevalidation\(\)/,
  );
  assert.doesNotMatch(
    source,
    /settledExternalOutboxChange[\s\S]{0,350}if \(!\(await requestExportCheckpointRevalidation\(\)\)\) return/,
  );
  assert.match(
    source,
    /catch \{[\s\S]{0,500}exportCheckpointRetryTimer\s*=\s*window\.setTimeout\([\s\S]{0,260}requestExportCheckpointRevalidation/,
    "a rejected settled-ACK revalidation must schedule its own recovery",
  );
  assert.match(
    source,
    /exportCheckpointRetryTimer[\s\S]*window\.clearTimeout\(exportCheckpointRetryTimer\)/,
    "the retry timer must be disposed with the workspace lifecycle",
  );
  const acknowledgement = sourceContractSection(
    source,
    "beforeAcknowledged: async",
    "onAcknowledged:",
  );
  assert.match(
    acknowledgement,
    /enqueueDrawingMutation\([\s\S]*recordLocalAcknowledgement\([\s\S]*trackUndurableWork:\s*false/,
    "acknowledgement projection must serialize with checkpoint verification without raising a false unsaved prompt",
  );
});

test("queued DXF operations recover one exact attestation before transport", async () => {
  const source = await readFile(
    new URL("../app/lukas/components/drawing-workspace.tsx", import.meta.url),
    "utf8",
  );
  assert.match(
    source,
    /const dxfImportSendGate = useMemo\([\s\S]*createDrawingDxfImportSendGate\(\)[\s\S]*\[persistenceLifecycleKey\]/,
  );
  assert.match(
    source,
    /await outbox\.flush\(\(operation, context\) =>[\s\S]*dxfImportSendGate\.send\([\s\S]*knownOperations: \(\) => outbox\.replayableOperations\(\)[\s\S]*prepareDrawingDxfImportOverHttp\([\s\S]*sendDrawingOperation\(/,
  );
  assert.match(
    source,
    /const prepared = await applyDrawingDxfImportOperations\([\s\S]*dxfImportSendGate\.rememberPrepared\(planRequestId, plan\.operations\)[\s\S]*for \(const applied of prepared\.applied\)/,
  );
});

test("a terminal conflict freezes editing and exposes an authoritative suffix reset", async () => {
  const source = await readFile(
    new URL("../app/lukas/components/drawing-workspace.tsx", import.meta.url),
    "utf8",
  );
  assert.match(
    source,
    /saveState\.conflicted[\s\S]*충돌 작업 폐기 후 최신 상태 열기/,
  );
  assert.match(
    source,
    /setLocalEditBridgeReady\(false\)[\s\S]*await commandQueueRef\.current[\s\S]*sendDrawingConflictDiscard\([\s\S]*settleConflictedSuffix/,
    "the UI must stop edits and settle only the server-proven causal suffix",
  );
  assert.match(
    source,
    /settleConflictedSuffix[\s\S]*finalizeDrawingConflictReset/,
    "the stale Yjs cache must be destroyed before canonical reload",
  );
  assert.match(
    source,
    /서버에 이미 저장된 변경은 유지됩니다/,
    "the destructive confirmation must describe the authority boundary",
  );
});

test("an authoritative conflict settlement reloads even when local cache cleanup fails", async () => {
  const events = [];
  await workspaceModule.finalizeDrawingConflictReset({
    disposeLocalDraft: async () => {
      events.push("dispose");
      throw new Error("IndexedDB deletion failed");
    },
    reload: () => events.push("reload"),
  });

  assert.deepEqual(events, ["dispose", "reload"]);
});

test("P2 revision fallback projects nested page envelopes to canonical pages", () => {
  const revision =
    previewModule.localDrawingWorkspacePreviewFixture().workspace.document
      .revision;
  const page = revision.pages[0];
  const hydrated = workspaceModule.drawingStateFromRevision({
    ...revision,
    pages: revision.pages.map((candidate) => ({
      ...candidate,
      canvases: revision.canvases.filter(
        (canvas) => canvas.pageId === candidate.id,
      ),
      layers: revision.layers,
      objects: revision.objects,
      blockInstances: revision.blockInstances,
    })),
  });

  assert.deepEqual(Object.keys(hydrated.structure.pages[page.id]).sort(), [
    "id",
    "name",
    "revisionId",
    "sortOrder",
    "version",
  ]);
});

test("audited export launcher stays disabled until outbox and canonical save are settled", () => {
  const Launcher = workspaceModule.DrawingExportLauncher;
  assert.equal(typeof Launcher, "function");
  const props = {
    auditRequired: true,
    checkpointSha256: "a".repeat(64),
    createdAt: "2026-09-02T00:00:00.000Z",
    documentState: {},
    operationCheckpoint: 4,
    projectId: "00000000-0000-4000-8000-000000000001",
    revisionId: "00000000-0000-4000-8000-000000000002",
    revisionVersion: 1,
    sourceUrl: null,
    title: "saved export",
    workspaceId: "00000000-0000-4000-8000-000000000003",
  };
  for (const blocked of [
    { outboxReady: false, saveStatus: "저장됨" },
    { outboxReady: true, saveStatus: "저장 중" },
    { outboxReady: true, saveStatus: "오프라인 저장" },
    { outboxReady: true, saveStatus: "충돌 검토 필요" },
  ]) {
    const html = renderToStaticMarkup(
      createElement(Launcher, { ...props, ...blocked }),
    );
    assert.match(html, /<button[^>]*disabled=""[^>]*>내보내기<\/button>/);
  }
  const ready = renderToStaticMarkup(
    createElement(Launcher, {
      ...props,
      outboxReady: true,
      saveStatus: "저장됨",
    }),
  );
  assert.doesNotMatch(ready, /<button[^>]*disabled=""/);
});

test("audited export waits for the acknowledged checkpoint to be installed after revalidation", () => {
  const ready = workspaceModule.drawingExportCheckpointReady;
  assert.equal(typeof ready, "function");
  const base = {
    authoritativeCheckpointKey: "checkpoint-5",
    installedCheckpointKey: "checkpoint-5",
    operationSequence: 5,
    revalidationPending: false,
  };
  assert.equal(ready(base), true);
  assert.equal(
    ready({ ...base, revalidationPending: true }),
    false,
    "acknowledgement closes export before loader revalidation resolves",
  );
  assert.equal(
    ready({
      ...base,
      operationSequence: 6,
      authoritativeCheckpointKey: "checkpoint-6",
    }),
    false,
    "fresh loader evidence stays closed until the adapter installs it",
  );
  assert.equal(
    ready({
      ...base,
      operationSequence: 6,
      authoritativeCheckpointKey: "checkpoint-6",
      installedCheckpointKey: "checkpoint-6",
    }),
    true,
  );
  assert.equal(
    ready({ ...base, revalidationPending: true }),
    false,
    "an idempotent acknowledgement stays closed only while revalidation is pending",
  );
  assert.equal(
    ready(base),
    true,
    "an idempotent recovered acknowledgement does not invent a higher operation floor",
  );
});

test("drawing export keeps one pending request identity until success or options change", () => {
  const identity = exportDialogModule.drawingExportAuditRequestIdentity;
  assert.equal(typeof identity, "function");
  let sequence = 0;
  const createRequestId = () => `request-${++sequence}`;
  const first = identity(null, "pdf|checkpoint-5", createRequestId);
  const failedResponseRetry = identity(
    first,
    "pdf|checkpoint-5",
    createRequestId,
  );
  const changedOptions = identity(
    failedResponseRetry,
    "png|checkpoint-5",
    createRequestId,
  );

  assert.equal(failedResponseRetry.requestId, first.requestId);
  assert.equal(changedOptions.requestId, "request-2");
  assert.equal(
    identity(null, "png|checkpoint-5", createRequestId).requestId,
    "request-3",
    "clearing the identity after success starts the next export attempt",
  );
});

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

test("viewer estimate rail keeps read-only BOQ access without the rate mutation entry", () => {
  const html = renderEstimateRail({ capability: "viewer" });
  assert.doesNotMatch(html, />단가표 가져오기</);
  assert.match(html, /aria-label="BOQ 상세 열기"/);
});

test("estimate result rail exposes the approved binding control names", () => {
  const props = {
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
  };
  const html = renderEstimateRail(props);
  assert.equal(
    renderEstimateRail(props),
    html,
    "the same estimate binding form must render identically on server and client",
  );
  const section = estimateRailModule.DrawingEstimateResultRail({
    capability: "editor",
    drawingRevisionId: "32000000-0000-4000-8000-000000000003",
    projectId: "32000000-0000-4000-8000-000000000002",
    workspaceId: "32000000-0000-4000-8000-000000000005",
    ...props,
  });
  const bindingForm = section.props.children.find(
    (child) => child?.props?.method === "post",
  );
  const requestIdInput = { value: "" };
  const submitEvent = {
    currentTarget: {
      elements: {
        namedItem(name) {
          assert.equal(name, "client_request_id");
          return requestIdInput;
        },
      },
    },
  };
  bindingForm.props.onSubmit(submitEvent);
  const firstRequestId = requestIdInput.value;
  assert.match(firstRequestId, /^[0-9a-f-]{36}$/);
  bindingForm.props.onSubmit(submitEvent);
  assert.equal(
    requestIdInput.value,
    firstRequestId,
    "retry keeps its request ID",
  );
  assert.match(
    html,
    /<label[^>]*for="estimate-boq-version"[^>]*>\s*연결할 내역 버전\s*<\/label>/,
  );
  assert.match(
    html,
    /<button[^>]*type="submit"[^>]*>\s*내역 연결\s*<\/button>/,
  );
  assert.match(
    html,
    /<input[^>]*type="hidden"[^>]*name="drawing_revision_id"[^>]*value="32000000-0000-4000-8000-000000000003"/,
  );
});

test("workspace shell mounts accessible result and object inspector panels", () => {
  const html = renderWorkspace();
  assert.match(html, /aria-label="검사기 보기"[^>]*role="tablist"/);
  for (const label of ["결과", "객체"])
    assert.match(html, new RegExp(`role="tab"[^>]*>${label}<`));
  assert.match(html, /id="drawing-estimate-result-panel" role="tabpanel"/);
  assert.match(html, /id="drawing-object-inspector-panel" role="tabpanel"/);
  assert.match(html, />객체 검사기</);
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

test("review submit stays disabled until local commands and every save boundary are settled", () => {
  const canSubmit = workspaceModule.drawingReviewSubmissionEnabled;
  const ready = {
    outboxReady: true,
    reviewPreparing: false,
    pending: 0,
    conflicted: false,
    volatileCount: 0,
    persistenceFailed: false,
    localMutationCount: 0,
    saveStatus: "저장됨",
  };
  assert.equal(canSubmit(ready), true);
  for (const blocked of [
    { pending: 1 },
    { conflicted: true },
    { volatileCount: 1 },
    { persistenceFailed: true },
    { localMutationCount: 1 },
    { saveStatus: "저장 중" },
    { saveStatus: "오프라인 저장" },
  ])
    assert.equal(
      canSubmit({
        ...ready,
        ...blocked,
      }),
      false,
    );
});

test("navigation protection includes commands queued before durable outbox storage", async () => {
  const hasUndurableWork = workspaceModule.drawingWorkspaceHasUndurableWork;
  const shouldBlock = workspaceModule.drawingWorkspaceShouldBlockNavigation;
  assert.equal(
    hasUndurableWork({ localMutationCount: 0, volatileCount: 0 }),
    false,
  );
  assert.equal(
    hasUndurableWork({ localMutationCount: 1, volatileCount: 0 }),
    true,
  );
  assert.equal(
    hasUndurableWork({ localMutationCount: 0, volatileCount: 1 }),
    true,
  );
  assert.equal(
    shouldBlock({
      activeRevisionId: "revision-a",
      currentPathname: "/projects/a/workspaces/b",
      currentSearch: "?revision=revision-a&object=object-a",
      hasUndurableWork: true,
      nextPathname: "/projects/a/workspaces/b",
      nextSearch: "?revision=revision-a&ifc=file-a&view=split",
    }),
    false,
    "same-route lineage URL synchronization must remain able to cancel stale navigation",
  );
  assert.equal(
    shouldBlock({
      activeRevisionId: "revision-a",
      currentPathname: "/projects/a/workspaces/b",
      currentSearch: "?revision=revision-a&object=object-a",
      hasUndurableWork: true,
      nextPathname: "/projects/a/workspaces/b",
      nextSearch: "?revision=revision-b",
    }),
    true,
    "a query-only revision switch must not replace a workspace with undurable work",
  );
  assert.equal(
    shouldBlock({
      activeRevisionId: "revision-a",
      currentPathname: "/projects/a/workspaces/b",
      currentSearch: "",
      hasUndurableWork: true,
      nextPathname: "/projects/a/drawings",
      nextSearch: "",
    }),
    true,
  );
  assert.equal(
    shouldBlock({
      activeRevisionId: "revision-a",
      currentPathname: "/projects/a/workspaces/b",
      currentSearch: "",
      hasUndurableWork: false,
      nextPathname: "/projects/a/drawings",
      nextSearch: "",
    }),
    false,
  );
  const source = await readFile(
    new URL("../app/lukas/components/drawing-workspace.tsx", import.meta.url),
    "utf8",
  );
  assert.match(
    source,
    /useBlocker\([\s\S]{0,240}drawingWorkspaceShouldBlockNavigation/,
  );
  assert.match(
    source,
    /BeforeUnloadEvent[\s\S]{0,260}undurableMutationCountRef\.current[\s\S]{0,180}persistenceRef\.current\?\.snapshot\(\)\.volatileCount/,
  );
  assert.match(
    source,
    /installedAuthoritativeCheckpointKeyRef[\s\S]{0,1300}trackUndurableWork:\s*false/,
    "authoritative checkpoint reconciliation is already durable and must not raise a false unsaved-work prompt",
  );
  const queue = sourceContractSection(
    source,
    "const enqueueDrawingMutation = useCallback",
    "const activeIdentityRef",
  );
  assert.match(
    queue,
    /collaborationAdapterRef\.current\?\.getSnapshot\(\)\.state\s*\?\?\s*next/,
    "serialized projection must follow the adapter state after persistence, including recorded commands",
  );
});

test("workspace query mutations merge with the latest same-route navigation intent", () => {
  const resolve = workspaceModule.resolveDrawingWorkspaceSearchParams;
  assert.equal(typeof resolve, "function");

  const pending = resolve({
    committedSearch: "",
    currentPathname: "/projects/project-a/workspaces/workspace-a",
    pendingLocation: {
      pathname: "/projects/project-a/workspaces/workspace-a",
      search: "?object=object-a&revision=revision-a",
    },
  });
  pending.set("ifc", "ifc-a");
  assert.equal(
    pending.toString(),
    "object=object-a&revision=revision-a&ifc=ifc-a",
  );

  assert.equal(
    resolve({
      committedSearch: "view=2d",
      currentPathname: "/projects/project-a/workspaces/workspace-a",
      pendingLocation: {
        pathname: "/projects/project-a/files",
        search: "?kind=ifc",
      },
    }).toString(),
    "view=2d",
    "a navigation to another route must not become this workspace's query base",
  );
});

function sourceContractSection(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `missing source marker: ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `missing source marker: ${endMarker}`);
  return source.slice(start, end);
}

test("save guard contract: history revert enters the tracked mutation queue", async () => {
  const source = await readFile(
    new URL("../app/lukas/components/drawing-workspace.tsx", import.meta.url),
    "utf8",
  );
  const commitApplied = sourceContractSection(
    source,
    "const commitApplied = useCallback",
    "const applyCommand = useCallback",
  );
  const revertOperation = sourceContractSection(
    source,
    "const revertOperation = useCallback",
    "const restoreCheckpoint = useCallback",
  );
  const revertUsesTrackedBoundary =
    /\benqueueDrawingMutation\s*\(/.test(revertOperation) ||
    (/\bcommitApplied\s*\(/.test(revertOperation) &&
      /\benqueueDrawingMutation\s*\(/.test(commitApplied));

  assert.equal(
    revertUsesTrackedBoundary,
    true,
    "history revert must be counted until its outbox write is durable",
  );
  assert.ok(
    commitApplied.indexOf("revertDrawingOperation(") >
      commitApplied.indexOf("enqueueDrawingMutation("),
    "history revert must be derived from the latest serialized state inside the queue",
  );
  assert.match(
    commitApplied,
    /return\s+adapter\.getSnapshot\(\)\.state/,
    "the queue projection must use the adapter state after the durable append",
  );
});

test("save guard contract: checkpoint restore enters the tracked mutation queue", async () => {
  const source = await readFile(
    new URL("../app/lukas/components/drawing-workspace.tsx", import.meta.url),
    "utf8",
  );
  const restoreCheckpoint = sourceContractSection(
    source,
    "const restoreCheckpoint = useCallback",
    "const blockMutationAdapter = useMemo",
  );
  const restoreUsesTrackedBoundary =
    /\benqueueDrawingMutation\s*\(/.test(restoreCheckpoint) ||
    /(?:^|[^\w.])applyCommand\s*\(\s*command\b/m.test(restoreCheckpoint);

  assert.equal(
    restoreUsesTrackedBoundary,
    true,
    "checkpoint restore must not persist through bridge.applyCommand directly",
  );
});

test("save guard contract: external settled ACK starts revalidation before reconciliation awaits", async () => {
  const source = await readFile(
    new URL("../app/lukas/components/drawing-workspace.tsx", import.meta.url),
    "utf8",
  );
  const settledBranch = sourceContractSection(
    source,
    "if (settledExternalOutboxChange)",
    "if (!pendingExternalOutboxChange",
  );
  const revalidation = settledBranch.indexOf(
    "requestExportCheckpointRevalidation()",
  );
  const firstAwait = settledBranch.indexOf("await ");

  assert.notEqual(revalidation, -1, "settled ACK must request revalidation");
  assert.ok(
    firstAwait === -1 || revalidation < firstAwait,
    "settled ACK must close checkpoint readiness before refresh or reconciliation yields",
  );
  const externalReconciliation = sourceContractSection(
    source,
    "const reconcileExternalAttempt",
    "const processExternalOutboxChanges",
  );
  assert.match(settledBranch, /await reconcileExternalAttempt\(\)/);
  assert.match(
    externalReconciliation,
    /enqueueDrawingMutation\([\s\S]*trackUndurableWork:\s*false/,
    "external reconciliation must serialize with authoritative checkpoint installation without creating a false unsaved prompt",
  );
});

test("save guard contract: DXF readiness stays closed during router revalidation", async () => {
  const source = await readFile(
    new URL("../app/lukas/components/drawing-workspace.tsx", import.meta.url),
    "utf8",
  );
  const checkpointReadiness = sourceContractSection(
    source,
    "const exportCheckpointReady = drawingExportCheckpointReady",
    "const sourceAttachPending",
  );
  const dxfReadiness = sourceContractSection(
    source,
    "const dxfImportReady = Boolean",
    "useEffect(() => {",
  );
  const routerRevalidationClosesReadiness =
    /revalidator\.state\s*!==\s*["']idle["']/.test(checkpointReadiness) ||
    /revalidator\.state\s*===\s*["']idle["']/.test(dxfReadiness);

  assert.equal(
    routerRevalidationClosesReadiness,
    true,
    "DXF import must remain disabled for realtime and other router revalidations",
  );
  assert.match(
    checkpointReadiness,
    /realtimeCheckpointRevalidationPending/,
    "the realtime debounce window must close DXF readiness before router revalidation starts",
  );
});

test("DXF import waits for the latest acknowledged checkpoint to be installed", async () => {
  const source = await readFile(
    new URL("../app/lukas/components/drawing-workspace.tsx", import.meta.url),
    "utf8",
  );
  assert.match(
    source,
    /const dxfImportReady = Boolean\([\s\S]{0,520}exportCheckpointReady/,
  );
});

test("review preparation freezes admission before draining accepted commands and persistence", async () => {
  const prepare = workspaceModule.prepareDrawingWorkspaceReview;
  assert.equal(typeof prepare, "function");
  const events = [];
  let releaseCommands;
  const commandsDrained = new Promise((resolve) => {
    releaseCommands = resolve;
  });
  const preparing = prepare({
    freeze() {
      events.push("freeze");
    },
    async drainCommands() {
      events.push("drain");
      await commandsDrained;
    },
    persistence: {
      async retry() {
        events.push("persistence");
        return true;
      },
      snapshot() {
        return { failed: false, volatileCount: 0 };
      },
    },
    async flush() {
      events.push("flush");
    },
    outbox: {
      async entries() {
        events.push("entries");
        return [];
      },
      async legacyEntries() {
        events.push("legacy");
        return [];
      },
    },
  });

  assert.deepEqual(events, ["freeze", "drain"]);
  releaseCommands();
  assert.equal(await preparing, true);
  assert.deepEqual(events, [
    "freeze",
    "drain",
    "persistence",
    "flush",
    "entries",
    "legacy",
  ]);
});

test("review freeze blocks mutation commands from toolbar and keyboard entry points", () => {
  const input = {
    blockSelectionCanMutate: true,
    canEdit: true,
    canRedo: true,
    canUndo: true,
    reviewFrozen: true,
    selectionHasRemoteLock: false,
    selectionKind: "object",
  };
  for (const command of ["line", "duplicate", "delete", "undo", "redo"])
    assert.equal(
      workspaceModule.drawingWorkspaceCommandEnabled(command, input),
      false,
    );
  for (const command of ["select", "pan", "zoom_to_fit"])
    assert.equal(
      workspaceModule.drawingWorkspaceCommandEnabled(command, input),
      true,
    );

  const shortcutEnabled = workspaceModule.drawingWorkspaceShortcutEnabled;
  assert.equal(typeof shortcutEnabled, "function");
  assert.equal(shortcutEnabled({ type: "copy" }, true), true);
  for (const shortcut of [
    { type: "paste" },
    { type: "duplicate" },
    { type: "delete" },
    { type: "undo" },
    { type: "redo" },
    { type: "move", delta: { x: 1, y: 0 } },
  ])
    assert.equal(shortcutEnabled(shortcut, true), false);
});

test("workspace SSR shell opens the object inspector by default for author mode", () => {
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

test("workspace keeps labeled primary tools and groups secondary shapes", async () => {
  const html = renderWorkspace();
  const source = await readFile(
    new URL("../app/lukas/components/drawing-workspace.tsx", import.meta.url),
    "utf8",
  );
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
    "도형",
    "텍스트",
    "치수",
    "이동",
    "화면 맞춤",
  ])
    assert.match(html, new RegExp(`data-tool-label="${label}"[^>]*>${label}<`));
  assert.match(html, /data-slot="dropdown-menu-trigger"[^>]*aria-label="도형 도구"/);
  assert.match(source, /<DropdownMenuRadioGroup\s+value=\{transient\.activeTool\}/);
  assert.match(source, /<DropdownMenuRadioItem[\s\S]*?value=\{tool\}/);
  for (const secondaryTool of ["폴리라인 도구", "사각형 도구", "원 도구"])
    assert.doesNotMatch(html, new RegExp(`<button[^>]*aria-label="${secondaryTool}"`));
  assert.match(source, /aria-label="업무 계보"/);
  for (const step of ["원본", "객체", "이슈", "승인", "물량·금액", "자재 인계"])
    assert.match(source, new RegExp(`\\["${step}",`));
  assert.match(source, /aria-label="선택 객체 업무 계보"/);
  assert.doesNotMatch(source, /\["자재·현장",/);
  assert.match(
    source,
    /객체를 선택하면 원본부터 자재 인계까지 연결 상태를 안내합니다/,
  );
});

test("an unselected workspace keeps the inspector focused on selection instead of empty lineage", () => {
  const html = renderWorkspace();
  const inspector = html.slice(html.indexOf('aria-label="속성 검사기"'));
  assert.match(inspector, /객체를 선택/);
  assert.doesNotMatch(inspector, /aria-label="선택 객체 업무 계보"/);
  assert.doesNotMatch(inspector, /id="drawing-inspector-source"/);
});

test("workspace connection details are collapsed without losing live status semantics", () => {
  const html = renderWorkspace();
  const details = html.match(/<details[^>]*data-workspace-connections[^>]*>[\s\S]*?<\/details>/)?.[0];
  assert.ok(details, "connection details must remain accessible from the header");
  assert.doesNotMatch(details.split(">")[0], /\bopen=/);
  assert.match(details, /<summary[\s\S]*연결 상태/);
  assert.match(details, /aria-label="실시간 상태:/);
  assert.match(html, /aria-label="저장 상태:/);
});

test("read-only workspace keeps navigation tools without shape or command launchers", () => {
  const html = renderWorkspace({ capability: "viewer" });
  assert.match(html, /aria-label="선택 도구"/);
  assert.match(html, /aria-label="이동 도구"/);
  assert.doesNotMatch(html, /aria-label="도형 도구"/);
  assert.doesNotMatch(html, /aria-label="명령 검색 열기"/);
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
      hasMaterial: false,
      hasSource: false,
    }),
    {
      completed: 0,
      next: "object",
      total: 6,
    },
  );
  assert.deepEqual(
    summarize({
      hasApproval: false,
      hasIssue: false,
      hasObject: true,
      hasQuantity: false,
      hasMaterial: false,
      hasSource: false,
    }),
    {
      completed: 1,
      next: "source",
      total: 6,
    },
  );
  assert.deepEqual(
    summarize({
      hasApproval: true,
      hasIssue: true,
      hasObject: true,
      hasQuantity: true,
      hasMaterial: true,
      hasSource: true,
    }),
    {
      completed: 6,
      next: null,
      total: 6,
    },
  );
  assert.deepEqual(
    summarize({
      hasApproval: true,
      hasIssue: true,
      hasMaterial: false,
      hasObject: true,
      hasQuantity: true,
      hasSource: true,
    }),
    {
      completed: 5,
      next: "material",
      total: 6,
    },
  );
});

test("split view remains a real two-pane workspace on tablet widths", async () => {
  const source = await readFile(
    new URL("../app/lukas/components/drawing-workspace.tsx", import.meta.url),
    "utf8",
  );
  assert.match(source, /window\.matchMedia\("\(max-width: 767px\)"\)/);
  assert.match(source, /md:grid-cols-\[minmax\(0,1fr\)_minmax\(0,1fr\)\]/);
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

test("tablet dock breakpoint meets the xl desktop shell without a 1200px gap", async () => {
  const source = await readFile(new URL("../app/lukas/components/drawing-workspace.tsx", import.meta.url), "utf8");
  const css = await readFile(new URL("../app/app.css", import.meta.url), "utf8");
  const tabletQuery = "(min-width: 768px) and (max-width: 1279px)";
  assert.ok(source.includes(tabletQuery), "dock state must stay tablet until xl");
  assert.ok(css.includes(`@media ${tabletQuery}`), "dock layout must use the same boundary");
});

test("the 2d renderer pane fills the available canvas height", async () => {
  const source = await readFile(new URL("../app/lukas/components/drawing-workspace.tsx", import.meta.url), "utf8");
  assert.ok(source.includes('className={`h-full min-h-0 min-w-0 ${activeView'), "the renderer must receive the full workspace height, not only its 512px minimum");
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

test("quantity lineage never reuses stale rows while a new selection loads", () => {
  const resolve = workspaceModule.resolveDrawingQuantityLineageSelection;
  assert.equal(typeof resolve, "function");
  const initial = { rows: [{ quantity: { drawingObjectId: "object-a" } }] };
  const fetched = {
    objectId: "object-b",
    quantityLineage: {
      rows: [{ quantity: { drawingObjectId: "object-b" } }],
    },
  };
  assert.equal(
    resolve({
      fetched: null,
      initial,
      initialObjectId: "object-a",
      selectedObjectId: "object-b",
    }),
    null,
  );
  assert.equal(
    resolve({
      fetched,
      initial,
      initialObjectId: "object-a",
      selectedObjectId: "object-b",
    }),
    fetched.quantityLineage,
  );
  assert.equal(
    resolve({
      fetched,
      initial,
      initialObjectId: "object-a",
      selectedObjectId: "object-a",
    }),
    initial,
  );
});

test("material lineage belongs only to an exact selected object BOQ link", () => {
  const hasLineage = workspaceModule.drawingObjectHasMaterialLineage;
  assert.equal(typeof hasLineage, "function");
  const rows = [
    {
      quantity: { drawingObjectId: "object-a" },
      boqLinks: [{ hasMaterialLineage: true }],
    },
    {
      quantity: { drawingObjectId: "object-b" },
      boqLinks: [{ hasMaterialLineage: false }],
    },
  ];
  assert.equal(hasLineage(rows, "object-a"), true);
  assert.equal(hasLineage(rows, "object-b"), false);
  assert.equal(hasLineage(rows, null), false);
  assert.equal(hasLineage(undefined, "object-a"), false);
});

test("every measurable primitive can request its quantity lineage", async () => {
  const source = await readFile(
    new URL("../app/lukas/components/drawing-workspace.tsx", import.meta.url),
    "utf8",
  );
  assert.match(source, /drawingObjectSupportsMeasurement\(selected\)/);
  assert.doesNotMatch(
    source,
    /!\["wall", "opening", "space", "area", "grid", "arc"\]\.includes/,
  );
});

test("selecting another measurable object clears stale exact BOQ evidence scope", async () => {
  const source = await readFile(
    new URL("../app/lukas/components/drawing-workspace.tsx", import.meta.url),
    "utf8",
  );
  const selectionSync = sourceContractSection(
    source,
    "if (!selectedDrawingObjectId) return;",
    "const selectedObjectAlreadyLinked",
  );
  for (const parameter of ["boq", "line", "evidence"])
    assert.match(
      selectionSync,
      new RegExp(`next\\.delete\\(["']${parameter}["']\\)`),
      `object selection must clear stale ${parameter} authority`,
    );
});

test("entering a creation tool clears stale URL selection authority", async () => {
  const source = await readFile(
    new URL("../app/lukas/components/drawing-workspace.tsx", import.meta.url),
    "utf8",
  );
  const toolTransition = sourceContractSection(
    source,
    "const setAuthorizedTool",
    "const setAuthorizedSelection",
  );
  assert.match(
    toolTransition,
    /tool !== ["']select["'] && tool !== ["']pan["'][\s\S]*replaceWorkspaceSearchParams\(\(next\) => \{[\s\S]*drawingWorkspaceLineageSearchParams[\s\S]*next\.delete\(name\)/,
    "a drawing tool must cancel an in-flight deep link before its new object selection is published",
  );
  assert.match(
    toolTransition,
    /name !== ["']revision["']/,
    "clearing object focus must not switch away from the revision being edited",
  );
});

test("selection lineage URL sync waits for an authoritative object checkpoint", () => {
  const ready = workspaceModule.drawingWorkspaceLineageSearchSyncReady;
  assert.equal(typeof ready, "function");
  assert.equal(
    ready({
      authoritativeObjectExists: false,
      hasCollaborationBootstrap: true,
      saveStatus: "저장됨",
    }),
    false,
    "a locally-created object must not become a loader-authorized deep link before acknowledgement",
  );
  assert.equal(
    ready({
      authoritativeObjectExists: true,
      hasCollaborationBootstrap: true,
      saveStatus: "저장 중",
    }),
    true,
    "an object already present in the authoritative checkpoint is safe to focus",
  );
  assert.equal(
    ready({
      authoritativeObjectExists: false,
      hasCollaborationBootstrap: false,
      saveStatus: "저장 중",
    }),
    false,
    "legacy workspaces must wait until their local save has settled",
  );
  assert.equal(
    ready({
      authoritativeObjectExists: false,
      hasCollaborationBootstrap: false,
      saveStatus: "저장됨",
    }),
    true,
  );
});

test("a mutation tracks a pending single-object lineage selection before its URL commits", () => {
  const resolve =
    workspaceModule.resolveDrawingWorkspaceMutationLineageObjectId;
  assert.equal(typeof resolve, "function");
  assert.equal(
    resolve("url-object", ["selected-object"], (id) => id === "url-object"),
    "selected-object",
    "a deleted pending selection must supersede the still-committed URL object",
  );
  assert.equal(
    resolve(
      "url-object",
      ["selected-object"],
      (id) => id === "selected-object",
    ),
    "url-object",
  );
  assert.equal(
    resolve(null, ["selected-object"], () => false),
    "selected-object",
  );
  assert.equal(
    resolve(null, [], () => false),
    null,
  );
  assert.equal(
    resolve(null, ["object-a", "object-b"], () => false),
    null,
  );
  assert.equal(
    resolve("url-object", ["url-object"], () => true),
    null,
  );
});

test("exact BOQ lineage focus applies once per tuple and then yields to user selection", () => {
  const transition =
    workspaceModule.resolveDrawingWorkspaceLineageFocusTransition;
  assert.equal(typeof transition, "function");

  const pending = transition({
    appliedFocusKey: null,
    focusKey: "revision-a:object-a:boq-a:line-a",
    focusObjectId: null,
    requestedObjectExists: true,
    requestedObjectId: "object-a",
    selectedIds: [],
  });
  assert.deepEqual(pending, {
    appliedFocusKey: null,
    clearSearchParams: null,
    selectedIds: null,
  });
  assert.deepEqual(
    transition({
      appliedFocusKey: pending.appliedFocusKey,
      focusKey: "revision-a:object-a:boq-a:line-a",
      focusObjectId: "object-a",
      requestedObjectExists: true,
      requestedObjectId: "object-a",
      selectedIds: [],
    }),
    {
      appliedFocusKey: "revision-a:object-a:boq-a:line-a",
      clearSearchParams: null,
      selectedIds: ["object-a"],
    },
    "a loader focus must apply only after its document checkpoint is installed",
  );

  assert.deepEqual(
    transition({
      appliedFocusKey: null,
      focusKey: "revision-a:object-a:boq-a:line-a",
      focusObjectId: "object-a",
      requestedObjectExists: true,
      requestedObjectId: "object-a",
      selectedIds: ["object-a"],
    }),
    {
      appliedFocusKey: "revision-a:object-a:boq-a:line-a",
      clearSearchParams: null,
      selectedIds: ["object-a"],
    },
    "the first deep-link effect must reassert its selection after earlier mount resets",
  );

  const initial = transition({
    appliedFocusKey: null,
    focusKey: "revision-a:object-a:boq-a:line-a",
    focusObjectId: "object-a",
    requestedObjectExists: true,
    requestedObjectId: "object-a",
    selectedIds: ["object-b"],
  });
  assert.deepEqual(initial, {
    appliedFocusKey: "revision-a:object-a:boq-a:line-a",
    clearSearchParams: null,
    selectedIds: ["object-a"],
  });

  assert.deepEqual(
    transition({
      appliedFocusKey: initial.appliedFocusKey,
      focusKey: "revision-a:object-a:boq-a:line-a",
      focusObjectId: "object-a",
      requestedObjectExists: true,
      requestedObjectId: "object-a",
      selectedIds: ["object-b"],
    }),
    {
      appliedFocusKey: "revision-a:object-a:boq-a:line-a",
      clearSearchParams: null,
      selectedIds: null,
    },
    "the same deep link must not restore object A after the user selects B",
  );

  const cleared = transition({
    appliedFocusKey: initial.appliedFocusKey,
    focusKey: null,
    focusObjectId: null,
    requestedObjectExists: true,
    requestedObjectId: null,
    selectedIds: ["object-b"],
  });
  assert.deepEqual(cleared, {
    appliedFocusKey: null,
    clearSearchParams: null,
    selectedIds: null,
  });
  assert.deepEqual(
    transition({
      appliedFocusKey: cleared.appliedFocusKey,
      focusKey: "revision-a:object-a:boq-a:line-a",
      focusObjectId: "object-a",
      requestedObjectExists: true,
      requestedObjectId: "object-a",
      selectedIds: ["object-b"],
    }),
    initial,
    "returning to the exact tuple must focus it once again",
  );
});

test("authorized deep-link selection survives collaboration authorization initialization", () => {
  const resolve =
    workspaceModule.resolveDrawingWorkspaceAuthorizedSelectionSync;
  assert.equal(typeof resolve, "function");
  assert.deepEqual(
    resolve({
      focusObjectExists: true,
      focusObjectId: "object-a",
      inputInvalidated: true,
      selectedIds: ["object-a"],
      transientSelectedIds: [],
    }),
    ["object-a"],
  );
  assert.equal(
    resolve({
      focusObjectExists: true,
      focusObjectId: "object-a",
      inputInvalidated: false,
      selectedIds: ["object-b"],
      transientSelectedIds: ["object-b"],
    }),
    null,
    "ordinary user selection must not be replaced by the original deep link",
  );
  assert.deepEqual(
    resolve({
      focusObjectExists: false,
      focusObjectId: "object-a",
      inputInvalidated: true,
      selectedIds: ["object-a"],
      transientSelectedIds: [],
    }),
    [],
  );
  assert.equal(
    resolve({
      focusObjectExists: true,
      focusObjectId: "object-a",
      inputInvalidated: true,
      selectedIds: [],
      transientSelectedIds: [],
    }),
    null,
    "an authorization transition must not resurrect a cleared selection",
  );
  assert.deepEqual(
    resolve({
      focusObjectExists: true,
      focusObjectId: "object-a",
      inputInvalidated: true,
      selectedIds: ["object-b"],
      transientSelectedIds: [],
    }),
    [],
    "an authorization transition must sanitize B without restoring URL focus A",
  );
});

test("losing write authority preserves the viewer's object selection", async () => {
  const source = await readFile(
    new URL("../app/lukas/components/drawing-workspace.tsx", import.meta.url),
    "utf8",
  );
  const authorizationEffect = sourceContractSection(
    source,
    "adapter.setAuthorization(effectiveCapability);",
    "enqueueDrawingMutation(",
  );
  assert.match(authorizationEffect, /setActiveLayerId\(null\)/);
  assert.doesNotMatch(
    authorizationEffect,
    /setSelectedIds\(\[\]\)/,
    "Viewer and Reviewer roles must retain selection for inspection and lineage navigation",
  );
});

test("lineage object existence follows the installed authoritative checkpoint", () => {
  const resolve = workspaceModule.resolveDrawingWorkspaceRequestedObjectExists;
  assert.equal(typeof resolve, "function");
  assert.equal(
    resolve({
      authoritativeCheckpointKey: "checkpoint-b",
      authoritativeObjectExists: true,
      currentObjectExists: false,
      installedCheckpointKey: "checkpoint-a",
    }),
    true,
    "a newly loaded URL object must survive until its checkpoint is installed",
  );
  assert.equal(
    resolve({
      authoritativeCheckpointKey: "checkpoint-b",
      authoritativeObjectExists: true,
      currentObjectExists: false,
      installedCheckpointKey: "checkpoint-b",
    }),
    false,
    "after installation, a local or committed tombstone must clear the URL focus",
  );
  assert.equal(
    resolve({
      authoritativeCheckpointKey: "checkpoint-b",
      authoritativeObjectExists: false,
      currentObjectExists: true,
      installedCheckpointKey: "checkpoint-b",
    }),
    true,
    "the installed document state is authoritative even before loader revalidation",
  );
});

test("lineage URL clears synchronously only from the installed document state", () => {
  const ready = workspaceModule.drawingWorkspaceLineageClearReady;
  assert.equal(typeof ready, "function");
  assert.equal(
    ready({
      authoritativeCheckpointKey: "checkpoint-b",
      currentObjectExists: false,
      installedCheckpointKey: "checkpoint-a",
      requestedObjectId: "object-a",
    }),
    false,
    "a pending loader checkpoint must retain its URL authority",
  );
  assert.equal(
    ready({
      authoritativeCheckpointKey: "checkpoint-b",
      currentObjectExists: false,
      installedCheckpointKey: "checkpoint-b",
      requestedObjectId: "object-a",
    }),
    true,
    "a tombstone in the installed document must clear before ACK revalidation",
  );
  assert.equal(
    ready({
      authoritativeCheckpointKey: "checkpoint-b",
      currentObjectExists: true,
      installedCheckpointKey: "checkpoint-b",
      requestedObjectId: "object-a",
    }),
    false,
  );
});

test("lineage focus requires the object's active layer ancestry", () => {
  const exists = workspaceModule.drawingWorkspaceStateHasFocusableObject;
  assert.equal(typeof exists, "function");
  const object = { id: "object-a", layerId: "layer-a" };
  assert.equal(
    exists({ objects: { "object-a": object }, layers: {} }, "object-a"),
    false,
    "a tombstoned import layer must invalidate its residual object projection",
  );
  assert.equal(
    exists(
      {
        objects: { "object-a": object },
        layers: { "layer-a": { id: "layer-a", canvasId: "canvas-a" } },
        structure: {
          canvases: {},
          layers: {
            "layer-a": { id: "layer-a", canvasId: "canvas-a" },
          },
          objects: { "object-a": object },
        },
      },
      "object-a",
    ),
    false,
    "canonical focus must retain valid canvas ancestry",
  );
  assert.equal(
    exists(
      {
        objects: { "object-a": object },
        layers: { "layer-a": { id: "layer-a", canvasId: "canvas-a" } },
        structure: {
          canvases: { "canvas-a": { id: "canvas-a" } },
          layers: {},
          objects: {},
        },
      },
      "object-a",
    ),
    false,
    "canonical tombstones must win over compatibility projections",
  );
  assert.equal(
    exists(
      {
        objects: { "object-a": object },
        layers: { "layer-a": { id: "layer-a", canvasId: "canvas-a" } },
        structure: {
          canvases: { "canvas-a": { id: "canvas-a" } },
          layers: {
            "layer-a": { id: "layer-a", canvasId: "canvas-a" },
          },
          objects: { "object-a": object },
        },
      },
      "object-a",
    ),
    true,
  );
});

test("lineage focus clears every URL authority field after its object is deleted", () => {
  const transition =
    workspaceModule.resolveDrawingWorkspaceLineageFocusTransition;
  assert.equal(typeof transition, "function");
  assert.deepEqual(
    transition({
      appliedFocusKey: "revision-a:object-a:boq-a:line-a",
      focusKey: "revision-a:object-a:boq-a:line-a",
      focusObjectId: "object-a",
      requestedObjectExists: false,
      requestedObjectId: "object-a",
      selectedIds: [],
    }),
    {
      appliedFocusKey: null,
      clearSearchParams: [
        "object",
        "revision",
        "boq",
        "line",
        "evidence",
        "quantityCursor",
      ],
      selectedIds: null,
    },
  );
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

test("menu roots and descendants own edit keys without moving or mutating drawing selection", () => {
  const resolve = workspaceModule.resolveDrawingWorkspaceShortcut;
  const menu = { tagName: "DIV", role: "menu" };
  const event = {
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
  };
  for (const tagName of ["DIV", "SPAN"]) {
    const target = {
      tagName,
      closest: (selector) => (selector === "[role='menu']" ? menu : null),
    };
    for (const keys of [
      { key: "ArrowDown" },
      { key: "ArrowUp" },
      { key: "ArrowLeft" },
      { key: "ArrowRight", shiftKey: true },
      { key: "Delete" },
      { key: "Backspace" },
      { key: "z", metaKey: true },
      { key: "z", ctrlKey: true, shiftKey: true },
      { key: "c", metaKey: true },
      { key: "v", ctrlKey: true },
      { key: "d", metaKey: true },
    ])
      assert.equal(
        resolve({ ...event, ...keys, target }),
        null,
        `${tagName} within menu must retain ${keys.key}`,
      );
  }
  assert.deepEqual(resolve({ ...event, key: "ArrowDown", target: null }), {
    type: "move",
    delta: { x: 0, y: 1 },
  });
  assert.deepEqual(resolve({ ...event, key: "Delete", target: null }), {
    type: "delete",
  });
});

test("menu roots and descendants own brackets without toggling workspace docks", () => {
  const resolve = workspaceModule.resolveDrawingWorkspaceDockShortcut;
  const menu = { tagName: "DIV", role: "menu" };
  for (const tagName of ["DIV", "SPAN"]) {
    const target = {
      tagName,
      closest: (selector) => (selector === "[role='menu']" ? menu : null),
    };
    for (const key of ["[", "]"])
      assert.equal(
        resolve({ key, target }),
        null,
        `${tagName} within menu must retain ${key}`,
      );
  }
  assert.equal(resolve({ key: "[", target: null }), "left");
  assert.equal(resolve({ key: "]", target: null }), "inspector");
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
  assert.match(html, /role="radio"[^>]*>수량·금액</);
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
  assert.equal(html.match(/role="tab"/g)?.length, 5);
  assert.equal(html.match(/role="tabpanel"/g)?.length, 3);
  assert.equal(html.match(/aria-selected="true"/g)?.length, 2);
  assert.equal(html.match(/aria-selected="false"/g)?.length, 3);
  assert.match(html, /role="tabpanel"[^>]*id="drawing-panel-structure"/);
  assert.doesNotMatch(html, /role="tabpanel"[^>]*hidden=""/);
  for (const label of ["페이지·레이어", "스타일", "블록"])
    assert.match(html, new RegExp(`role="tab"[^>]*>${label}<`));
  assert.match(
    html,
    /<button(?=[^>]*id="drawing-estimate-result-tab")(?=[^>]*tabindex="-1")[^>]*>/,
  );
  assert.match(
    html,
    /<button(?=[^>]*id="drawing-object-inspector-tab")(?=[^>]*tabindex="0")[^>]*>/,
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

test("source renderer failure stays local while canvas and result inspector remain mounted", () => {
  const fixture = previewModule.localDrawingWorkspacePreviewFixture();
  const html = renderWorkspace({
    sourceBundle: {
      primary: null,
      pdf: null,
      ifc: null,
      previousPdf: null,
      revisionEdge: null,
      catalog: [],
      error: "PDF 원본을 표시하지 못했습니다. 다시 시도해 주세요.",
    },
    workspace: fixture.workspace,
  });
  assert.match(html, /PDF 원본을 표시하지 못했습니다/);
  assert.match(html, /drawing-workspace-canvas/);
  assert.match(html, /drawing-estimate-result-panel/);
  assert.match(html, /drawing-object-inspector-panel/);
  assert.match(html, /이슈/);
});

test("a PDF or IFC capability failure does not hide the independent DXF upload path", async () => {
  const source = await readFile(
    new URL("../app/lukas/components/drawing-workspace.tsx", import.meta.url),
    "utf8",
  );
  const dxfControls = sourceContractSection(
    source,
    "{sourceBundle && availableDxfSources.length > 0 ? (",
    "{dxfImportStatus ? (",
  );
  assert.doesNotMatch(dxfControls, /!sourceBundle\.error/);
  assert.match(dxfControls, /sourceBundle && authorityCanWrite \? \(/);
  assert.match(dxfControls, /DXF 업로드/);
});

test("draft editors can upload a first or revised DXF while viewers and approved revisions cannot", () => {
  const fixture = previewModule.localDrawingWorkspacePreviewFixture();
  const sourceBundle = {
    primary: null,
    pdf: null,
    ifc: null,
    previousPdf: null,
    revisionEdge: null,
    catalog: [
      {
        id: "00000000-0000-4000-8000-000000000198",
        kind: "dxf",
        originalFilename: "REV-01.DXF",
        contentType: "application/dxf",
        byteSize: 2048,
        sha256: "a".repeat(64),
      },
    ],
  };
  const editor = renderWorkspace({ sourceBundle });
  const viewer = renderWorkspace({ capability: "viewer", sourceBundle });
  const approved = renderWorkspace({
    sourceBundle,
    workspace: {
      ...fixture.workspace,
      document: {
        ...fixture.workspace.document,
        revision: {
          ...fixture.workspace.document.revision,
          status: "approved",
        },
      },
    },
  });

  assert.match(editor, /DXF 도면 가져오기/);
  assert.match(editor, />새 DXF 업로드</);
  assert.doesNotMatch(viewer, /DXF 업로드/);
  assert.doesNotMatch(approved, /DXF 업로드/);
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
