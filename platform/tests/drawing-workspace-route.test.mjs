import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import routes from "../app/routes.ts";

const workspaceView =
  await import("../app/lukas/lib/drawing-workspace-view.ts").catch(() => null);
const workspaceServer =
  await import("../app/lukas/lib/drawing-workspace.server.ts").catch(
    () => ({}),
  );

function flatten(routesToFlatten) {
  return routesToFlatten.flatMap((route) => [
    route,
    ...flatten(route.children ?? []),
  ]);
}

test("workspace route is additive and keeps the collaboration room", () => {
  const registered = flatten(routes).filter((route) =>
    route.path?.startsWith("/projects/:projectId/drawings/:fileId"),
  );
  assert.deepEqual(
    registered.map((route) => [route.path, route.file]),
    [
      [
        "/projects/:projectId/drawings/:fileId",
        "lukas/screens/drawing-room.tsx",
      ],
      [
        "/projects/:projectId/drawings/:fileId/workspace",
        "lukas/screens/drawing-workspace.tsx",
      ],
      [
        "/projects/:projectId/drawings/:fileId/workspace/operation",
        "lukas/screens/drawing-workspace-operation.ts",
      ],
      [
        "/projects/:projectId/drawings/:fileId/workspace/export",
        "lukas/screens/drawing-workspace-export.ts",
      ],
    ],
  );
});

test("collaboration room exposes an accessible link to the additive workspace", async () => {
  const source = await readFile(
    new URL("../app/lukas/screens/drawing-room.tsx", import.meta.url),
    "utf8",
  );
  assert.match(
    source,
    /to=\{`\/projects\/\$\{project\.id\}\/drawings\/\$\{room\.file\.id\}\/workspace`\}/,
  );
  assert.match(source, />\s*도면 편집 작업실\s*</);
});

test("workspace screen offers blank and PDF-background creation without replacing the room", async () => {
  const source = await readFile(
    new URL("../app/lukas/screens/drawing-workspace.tsx", import.meta.url),
    "utf8",
  );
  assert.match(source, /빈 도면/);
  assert.match(source, /PDF 배경 사용/);
  assert.match(source, /document_mode/);
  assert.match(source, /actionData\?\.error/);
});

test("workspace document renders the accessible editor shell", async () => {
  const [screen, shell] = await Promise.all([
    readFile(
      new URL("../app/lukas/screens/drawing-workspace.tsx", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../app/lukas/components/drawing-workspace.tsx", import.meta.url),
      "utf8",
    ),
  ]);

  assert.match(screen, /DrawingWorkspaceClient/);
  assert.match(screen, /협업 도면실/);
  assert.match(shell, /도면 작업실/);
  assert.match(shell, /저장됨/);
  assert.match(shell, /aria-label=\{`저장 상태:/);
  assert.match(shell, /aria-label="실행 취소"/);
  assert.match(shell, /aria-label="다시 실행"/);
  assert.match(shell, /aria-label="도면 도구 패널"/);
  assert.match(shell, /aria-label="도면 캔버스"/);
  assert.match(shell, /aria-label="속성 검사기"/);
});

test("same-session saved drawing objects become linkable without a loader reload", () => {
  assert.equal(
    workspaceView.drawingIssueLinkReady({
      capability: "editor",
      objectIds: ["same-session-object"],
      saveStatus: "저장됨",
      selectedIds: ["same-session-object"],
      status: "draft",
    }),
    true,
  );
  for (const blocked of [
    { saveStatus: "저장 중" },
    { saveStatus: "충돌 검토 필요" },
    { objectIds: [] },
    { selectedIds: [] },
    { capability: "reviewer" },
    { status: "review_requested" },
  ])
    assert.equal(
      workspaceView.drawingIssueLinkReady({
        capability: "editor",
        objectIds: ["same-session-object"],
        saveStatus: "저장됨",
        selectedIds: ["same-session-object"],
        status: "draft",
        ...blocked,
      }),
      false,
    );
});

test("workspace wires durable collaborative recovery and the four visible save states", async () => {
  const shell = await readFile(
    new URL("../app/lukas/components/drawing-workspace.tsx", import.meta.url),
    "utf8",
  );
  assert.match(shell, /createDrawingOutbox/);
  assert.match(shell, /createDrawingPersistenceQueue/);
  assert.match(shell, /reconcileDrawingCollaborationDraft/);
  assert.match(shell, /sendDrawingOperation/);
  assert.match(shell, /createDrawingCollaborationCommandBridge/);
  assert.match(shell, /const saveStatus = drawingSaveStatus/);
  assert.match(shell, /\{saveStatus\}/);
  assert.match(
    shell,
    /canPersistDrawingMutation\(\s*effectiveCapability,\s*persistenceState/,
  );
  assert.match(shell, /로컬 저장 실패/);
  assert.match(shell, /다시 시도/);
  assert.match(shell, /beforeunload/);
  assert.match(shell, /useBlocker/);
  assert.match(shell, /legacyEntries/);
  assert.match(shell, /이전 브라우저 작업/);
});

test("layers and inspector expose native labeled controls", async () => {
  const [shell, layers, inspector] = await Promise.all([
    readFile(
      new URL("../app/lukas/components/drawing-workspace.tsx", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL(
        "../app/lukas/components/drawing-layers-panel.tsx",
        import.meta.url,
      ),
      "utf8",
    ),
    readFile(
      new URL("../app/lukas/components/drawing-inspector.tsx", import.meta.url),
      "utf8",
    ),
  ]);
  assert.match(shell, /<DrawingLayersPanel/);
  assert.match(shell, /<DrawingInspector/);
  assert.match(
    shell,
    /\{editing\.canEdit \? \(\s*<>\s*<Button\s+aria-label="선 도구"/,
  );
  assert.match(
    shell,
    /\{editing\.canEdit \? \(\s*<>\s*<Button\s+aria-label="실행 취소"/,
  );
  assert.match(shell, /\{editing\.canEdit \? \(\s*<DrawingCommandMenu/);
  for (const label of [
    "새 레이어 이름",
    "레이어 추가",
    "레이어 이름",
    "레이어 표시",
    "레이어 잠금",
    "활성 레이어",
  ]) {
    assert.match(layers, new RegExp(label));
  }
  for (const label of [
    "객체 이름",
    "레이어",
    "선 색상",
    "선 두께",
    "채우기",
    "텍스트",
  ]) {
    assert.match(inspector, new RegExp(label));
  }
  assert.match(inspector, /<input/);
  assert.match(inspector, /<select/);
  assert.match(inspector, /<button/);
});

test("page tree and canvas-scoped layer controls use native labeled interactions", async () => {
  const [shell, pages, layers] = await Promise.all([
    readFile(
      new URL("../app/lukas/components/drawing-workspace.tsx", import.meta.url),
      "utf8",
    ),
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
  assert.match(shell, /<DrawingPagesPanel/);
  assert.match(shell, /documentStore\.selectCanvas/);
  assert.match(shell, /activeCanvasId=\{drawingState\.activeCanvasId\}/);
  assert.doesNotMatch(pages, /role="tree(?:item)?"/);
  assert.match(pages, /<ul/);
  assert.match(pages, /type="button"/);
  assert.match(pages, /nextDrawingCanvasFocusIntent/);
  assert.match(pages, /useLayoutEffect/);
  assert.match(pages, /aria-describedby/);
  assert.match(pages, /defaultCanvas \|\| tailIndex === 0/);
  for (const label of [
    "새 페이지 이름",
    "페이지 추가",
    "용지 캔버스 추가",
    "모델 캔버스 추가",
    "페이지 이름",
    "캔버스 이름",
  ]) {
    assert.match(pages, new RegExp(label));
  }
  assert.match(pages, /\{canEdit \? \(/);
  assert.match(layers, /sortOrder/);
  assert.match(layers, /레이어 위로 이동/);
  assert.match(layers, /레이어 아래로 이동/);
  assert.match(layers, /activeCanvasId/);
});

test("review controls require capability, requested status, separate maker, and exact evidence", () => {
  assert.ok(workspaceView);
  const base = {
    revisionId: "00000000-0000-4000-8000-000000000005",
    revisionVersion: 7,
    status: "review_requested",
    createdBy: "00000000-0000-4000-8000-000000000001",
    currentUserId: "00000000-0000-4000-8000-000000000002",
    reviewEvidence: {
      subjectVersion: 7,
      snapshotSha256: "b".repeat(64),
    },
  };
  assert.deepEqual(
    workspaceView.drawingWorkspaceReviewControls({
      ...base,
      capability: "reviewer",
    }),
    {
      requestReview: false,
      decisionEvidence: base.reviewEvidence,
    },
  );
  assert.deepEqual(
    workspaceView.drawingWorkspaceReviewControls({
      ...base,
      capability: "editor",
      status: "draft",
      reviewEvidence: null,
    }),
    { requestReview: true, decisionEvidence: null },
  );
  for (const changes of [
    { capability: "viewer" },
    { capability: "reviewer", status: "approved" },
    { capability: "reviewer", currentUserId: base.createdBy },
    { capability: "reviewer", reviewEvidence: null },
    {
      capability: "reviewer",
      reviewEvidence: { ...base.reviewEvidence, subjectVersion: 6 },
    },
  ]) {
    assert.equal(
      workspaceView.drawingWorkspaceReviewControls({
        ...base,
        ...changes,
      }).decisionEvidence,
      null,
    );
  }
});

test("revision decision form fields bind the exact immutable snapshot", () => {
  assert.ok(workspaceView);
  assert.deepEqual(
    workspaceView.drawingRevisionDecisionFields({
      revisionId: "00000000-0000-4000-8000-000000000005",
      evidence: {
        subjectVersion: 7,
        snapshotSha256: "b".repeat(64),
      },
      decision: "approved",
      note: "확인 완료",
    }),
    {
      intent: "record_revision_decision",
      revision_id: "00000000-0000-4000-8000-000000000005",
      subject_version: "7",
      snapshot_sha256:
        "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      decision: "approved",
      note: "확인 완료",
    },
  );
});

test("client module loading resolves, rejects, and ignores completion after disposal", async () => {
  assert.ok(workspaceView);
  assert.equal(typeof workspaceView.loadDrawingClientModule, "function");

  const resolved = [];
  let resolveModule;
  workspaceView.loadDrawingClientModule({
    load: () =>
      new Promise((resolve) => {
        resolveModule = resolve;
      }),
    errorMessage: "failed",
    onState: (state) => resolved.push(state),
  });
  assert.deepEqual(resolved, [{ status: "loading" }]);
  resolveModule("canvas");
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(resolved, [
    { status: "loading" },
    { status: "ready", value: "canvas" },
  ]);

  const rejected = [];
  workspaceView.loadDrawingClientModule({
    load: () => Promise.reject(new Error("network")),
    errorMessage: "stable error",
    onState: (state) => rejected.push(state),
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(rejected, [
    { status: "loading" },
    { status: "error", message: "stable error" },
  ]);

  const disposed = [];
  let resolveDisposed;
  const dispose = workspaceView.loadDrawingClientModule({
    load: () =>
      new Promise((resolve) => {
        resolveDisposed = resolve;
      }),
    errorMessage: "failed",
    onState: (state) => disposed.push(state),
  });
  dispose();
  resolveDisposed("late module");
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(disposed, [{ status: "loading" }]);
});

test("IFC workspace surface pairs a blank overlay with the signed existing viewer", () => {
  assert.ok(workspaceView);
  const surface = workspaceView.drawingWorkspaceSurface({
    file: {
      id: "00000000-0000-4000-8000-000000000003",
      kind: "ifc",
      immutable: true,
      originalFilename: "model.ifc",
      byteSize: 2048,
    },
    page: { width: 841, height: 594, backgroundPdfPage: null },
    sourceUrl: "https://storage.test/model",
  });
  assert.deepEqual(surface, {
    layout: "ifc_split",
    background: { kind: "blank", width: 841, height: 594 },
    ifcViewer: {
      byteSize: 2048,
      fileName: "model.ifc",
      signedUrl: "https://storage.test/model",
      sourceKey: "00000000-0000-4000-8000-000000000003",
    },
    sourceError: null,
  });
  assert.equal(
    workspaceView.drawingWorkspaceSurface({
      file: {
        id: "00000000-0000-4000-8000-000000000003",
        kind: "ifc",
        immutable: true,
        originalFilename: "model.ifc",
        byteSize: 2048,
      },
      page: null,
      sourceUrl: null,
    }).sourceError,
    "IFC 원본 화면을 불러올 수 없습니다.",
  );
  for (const changes of [
    { immutable: true, sourceUrl: null },
    { immutable: false, sourceUrl: "https://storage.test/model" },
  ]) {
    const failedClosed = workspaceView.drawingWorkspaceSurface({
      file: {
        id: "00000000-0000-4000-8000-000000000003",
        kind: "ifc",
        immutable: changes.immutable,
        originalFilename: "model.ifc",
        byteSize: 2048,
      },
      page: null,
      sourceUrl: changes.sourceUrl,
    });
    assert.equal(failedClosed.layout, "canvas");
    assert.equal(failedClosed.ifcViewer, null);
    assert.equal(
      failedClosed.sourceError,
      "IFC 원본 화면을 불러올 수 없습니다.",
    );
  }
});

test("PDF and blank workspace surfaces remain a single canvas", () => {
  assert.ok(workspaceView);
  const file = {
    id: "00000000-0000-4000-8000-000000000003",
    kind: "pdf",
    immutable: true,
    originalFilename: "plan.pdf",
    byteSize: 2048,
  };
  assert.deepEqual(
    workspaceView.drawingWorkspaceSurface({
      file,
      page: { width: 200, height: 100, backgroundPdfPage: 2 },
      sourceUrl: "https://storage.test/plan",
    }),
    {
      layout: "canvas",
      background: {
        kind: "pdf",
        width: 200,
        height: 100,
        pageNumber: 2,
        signedUrl: "https://storage.test/plan",
      },
      ifcViewer: null,
      sourceError: null,
    },
  );
  assert.deepEqual(
    workspaceView.drawingWorkspaceSurface({
      file,
      page: { width: 200, height: 100, backgroundPdfPage: null },
      sourceUrl: null,
    }),
    {
      layout: "canvas",
      background: { kind: "blank", width: 200, height: 100 },
      ifcViewer: null,
      sourceError: null,
    },
  );
});

test("PDF image placement view model contains rendered pixels in page world bounds", () => {
  assert.ok(workspaceView);
  assert.equal(typeof workspaceView.drawingPdfImagePlacement, "function");
  assert.deepEqual(
    workspaceView.drawingPdfImagePlacement(
      { width: 400, height: 200 },
      { width: 100, height: 100 },
    ),
    { x: 0, y: 25, width: 100, height: 50 },
  );
});

test("workspace route wires the verified source bundle and controlled IFC surface", async () => {
  const [screen, shell, canvas] = await Promise.all([
    readFile(
      new URL("../app/lukas/screens/drawing-workspace.tsx", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../app/lukas/components/drawing-workspace.tsx", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL(
        "../app/lukas/components/drawing-canvas.client.tsx",
        import.meta.url,
      ),
      "utf8",
    ),
  ]);
  assert.match(
    screen,
    /parseDrawingWorkspaceViewState\(\s*new URL\(request\.url\)\.searchParams/s,
  );
  assert.match(
    screen,
    /loadDrawingWorkspaceSourceBundle\(\s*client,\s*workspace,\s*selectedIfcFileId,\s*viewState\.view !== "2d"/s,
  );
  assert.match(screen, /sourceBundle=\{loaderData\.sourceBundle\}/);
  assert.match(screen, /selectedIfcFileId=\{loaderData\.selectedIfcFileId\}/);
  assert.match(screen, /viewMode=\{loaderData\.viewState\.view\}/);
  assert.doesNotMatch(screen, /loadDrawingWorkspaceSourceUrl/);
  assert.match(shell, /drawingWorkspaceReviewControls\(/);
  assert.match(shell, /drawingRevisionDecisionFields\(/);
  assert.match(shell, /name="decision"/);
  assert.doesNotMatch(shell, /name="review"/);
  assert.match(shell, /value="approved"/);
  assert.match(shell, /value="rejected"/);
  assert.equal(shell.match(/loadDrawingClientModule\(/g)?.length, 2);
  assert.match(shell, /2D 도면/);
  assert.match(shell, /IFC 3D/);
  assert.match(shell, /분할 보기/);
  assert.match(shell, /IFC 원본 선택/);
  assert.match(shell, /<IfcViewer/);
  assert.doesNotMatch(shell, /target="_blank"/);
  assert.equal(canvas.match(/drawingPanGestureTransition\(/g)?.length, 4);
  assert.match(canvas, /drawingPdfImagePlacement\(rendered\.canvasSize/);
  assert.doesNotMatch(canvas, /containPdfSource/);
  assert.match(canvas, /x=\{pdfSource\.bounds\.x\}/);
  assert.match(canvas, /y=\{pdfSource\.bounds\.y\}/);
});

test("workspace exposes six authoring tools, transient previews, and an accessible native command menu", async () => {
  const [shell, canvas, menu] = await Promise.all([
    readFile(
      new URL("../app/lukas/components/drawing-workspace.tsx", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL(
        "../app/lukas/components/drawing-canvas.client.tsx",
        import.meta.url,
      ),
      "utf8",
    ),
    readFile(
      new URL(
        "../app/lukas/components/drawing-command-menu.tsx",
        import.meta.url,
      ),
      "utf8",
    ),
  ]);
  for (const label of [
    "선 도구",
    "폴리라인 도구",
    "사각형 도구",
    "원 도구",
    "텍스트 도구",
    "치수 도구",
  ]) {
    assert.match(shell, new RegExp(label));
  }
  assert.match(shell, /DrawingCommandMenu/);
  assert.match(shell, /event\.(metaKey \|\| event\.ctrlKey)/);
  assert.match(shell, /event\.key\.toLowerCase\(\) !== "k"/);
  assert.match(canvas, /name="drawing-preview"/);
  assert.match(canvas, /미보정/);
  assert.match(canvas, /drawingToolEventTransition\(/);
  assert.doesNotMatch(canvas, /event\.evt\.detail/);
  assert.match(canvas, /geometrySnapPoints\(/);
  assert.match(canvas, /memo\(function CommittedDrawingLayer/);
  assert.match(canvas, /<CommittedDrawingLayer/);
  assert.equal(canvas.match(/<Layer(?:\s|>)/g)?.length, 3);
  for (const name of [
    "drawing-background",
    "drawing-objects",
    "drawing-overlay",
  ])
    assert.match(canvas, new RegExp(`name="${name}"`));
  assert.match(menu, /<dialog/);
  assert.match(menu, /aria-labelledby="drawing-command-menu-title"/);
  assert.match(menu, /aria-label="도면 명령 검색"/);
  assert.match(menu, /\.showModal\(\)/);
  assert.match(menu, /onKeyDown=\{/);
  assert.doesNotMatch(menu, /role="listbox"/);
  assert.doesNotMatch(menu, /role="option"/);
});

test("workspace exposes grouped architectural tools and a focused semantic inspector", async () => {
  const [shell, canvas, menu, inspector] = await Promise.all([
    readFile(
      new URL("../app/lukas/components/drawing-workspace.tsx", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL(
        "../app/lukas/components/drawing-canvas.client.tsx",
        import.meta.url,
      ),
      "utf8",
    ),
    readFile(
      new URL(
        "../app/lukas/components/drawing-command-menu.tsx",
        import.meta.url,
      ),
      "utf8",
    ),
    readFile(
      new URL(
        "../app/lukas/components/drawing-semantic-inspector.tsx",
        import.meta.url,
      ),
      "utf8",
    ),
  ]);
  assert.match(shell, /aria-label="건축 객체"/);
  for (const label of [
    "벽 도구",
    "개구부 도구",
    "공간 도구",
    "영역 도구",
    "그리드 도구",
    "호 도구",
  ]) {
    assert.match(shell, new RegExp(label));
    assert.match(menu, new RegExp(label));
  }
  assert.match(shell, /max-w-\[calc\(100%-2rem\)\]/);
  assert.match(shell, /objects=\{resolvedObjects\.objects\}/);
  assert.match(canvas, /name="drawing-semantic-label"/);
  assert.match(canvas, /data-rendered-semantic-object-count/);
  assert.match(canvas, /resolveDrawingOpening/);
  for (const label of [
    "벽 두께",
    "벽 높이",
    "개구부 종류",
    "벽 기준 오프셋",
    "공간 번호",
    "바닥 마감",
    "호 반지름",
    "미리보기",
    "서버 계산 · V1",
  ])
    assert.match(inspector, new RegExp(label));
  assert.match(inspector, /type: "update_objects"/);
  assert.match(inspector, /baseVersion: object\.version/);
});

test("workspace remounts Canvas with sanitized transient props at each authorization boundary", async () => {
  const shell = await readFile(
    new URL("../app/lukas/components/drawing-workspace.tsx", import.meta.url),
    "utf8",
  );
  assert.match(shell, /drawingTransientAuthorizationKey\(drawingState/);
  assert.match(shell, /activeLayer: authorizationLayer/);
  assert.match(shell, /authorizationProbe\.state\.layers/);
  assert.match(shell, /transientInputInvalidatedRef\.current = true/);
  assert.match(shell, /key=\{authorizationKey\}/);
  assert.match(shell, /activeTool=\{transient\.activeTool as DrawingTool\}/);
  assert.match(shell, /selectedIds=\{transient\.selectedIds\}/);
});

test("route measurement loading propagates authorized bootstrap denial", async () => {
  assert.equal(
    typeof workspaceServer.loadDrawingWorkspaceMeasurementState,
    "function",
  );
  const revisionId = "70000000-0000-4000-8000-000000000001";
  const client = {
    async rpc(name, args) {
      assert.equal(name, "lukas_drawing_collaboration_bootstrap");
      assert.deepEqual(args, { p_revision_id: revisionId });
      return {
        data: null,
        error: { code: "42501", message: "permission denied" },
      };
    },
  };

  await assert.rejects(
    workspaceServer.loadDrawingWorkspaceMeasurementState(client, {
      documentId: "70000000-0000-4000-8000-000000000002",
      revisionId,
      revisionVersion: 1,
    }),
    /permission denied/,
  );
});
