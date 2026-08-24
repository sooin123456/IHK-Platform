import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import routes from "../app/routes.ts";

const workspaceView = await import(
  "../app/lukas/lib/drawing-workspace-view.ts"
).catch(() => null);

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
      new URL(
        "../app/lukas/components/drawing-workspace.client.tsx",
        import.meta.url,
      ),
      "utf8",
    ),
  ]);

  assert.match(screen, /DrawingWorkspaceClient/);
  assert.match(screen, /협업 도면실/);
  assert.match(shell, /도면 작업실/);
  assert.match(shell, /저장됨/);
  assert.match(shell, /aria-label="저장"/);
  assert.match(shell, /aria-label="실행 취소"/);
  assert.match(shell, /aria-label="다시 실행"/);
  assert.match(shell, /aria-label="레이어 패널"/);
  assert.match(shell, /aria-label="도면 캔버스"/);
  assert.match(shell, /aria-label="속성 검사기"/);
});

test("workspace wires durable outbox recovery and the four visible save states", async () => {
  const shell = await readFile(
    new URL(
      "../app/lukas/components/drawing-workspace.client.tsx",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(shell, /createDrawingOutbox/);
  assert.match(shell, /recoverPendingDrawingState/);
  assert.match(shell, /sendDrawingOperation/);
  assert.match(shell, /await outbox\.enqueue/);
  assert.match(shell, /const saveStatus = drawingSaveStatus\(saveState\)/);
  assert.match(shell, /\{saveStatus\}/);
  assert.match(shell, /outboxReady && editingContext\.canEdit/);
  assert.match(shell, /로컬 저장 실패/);
});

test("layers and inspector expose native labeled controls", async () => {
  const [shell, layers, inspector] = await Promise.all([
    readFile(
      new URL(
        "../app/lukas/components/drawing-workspace.client.tsx",
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
    readFile(
      new URL("../app/lukas/components/drawing-inspector.tsx", import.meta.url),
      "utf8",
    ),
  ]);
  assert.match(shell, /<DrawingLayersPanel/);
  assert.match(shell, /<DrawingInspector/);
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

test("workspace route wires evidence forms, embedded IFC, import failures, and contained PDF placement", async () => {
  const [screen, shell, canvas] = await Promise.all([
    readFile(
      new URL("../app/lukas/screens/drawing-workspace.tsx", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL(
        "../app/lukas/components/drawing-workspace.client.tsx",
        import.meta.url,
      ),
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
  assert.match(screen, /loadDrawingWorkspaceSourceUrl\(client, workspace\)/);
  assert.match(shell, /drawingWorkspaceReviewControls\(/);
  assert.match(shell, /drawingRevisionDecisionFields\(/);
  assert.match(shell, /name="decision"/);
  assert.doesNotMatch(shell, /name="review"/);
  assert.match(shell, /value="approved"/);
  assert.match(shell, /value="rejected"/);
  assert.equal(shell.match(/loadDrawingClientModule\(/g)?.length, 2);
  assert.match(shell, /surface\.layout === "ifc_split"/);
  assert.doesNotMatch(shell, /file\.kind === "ifc"/);
  assert.match(shell, /<IfcViewer \{\.\.\.surface\.ifcViewer\} \/>/);
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
      new URL(
        "../app/lukas/components/drawing-workspace.client.tsx",
        import.meta.url,
      ),
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
    assert.match(shell, new RegExp(`aria-label="${label}"`));
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
  assert.match(menu, /<dialog/);
  assert.match(menu, /aria-labelledby="drawing-command-menu-title"/);
  assert.match(menu, /aria-label="도면 명령 검색"/);
  assert.match(menu, /\.showModal\(\)/);
  assert.match(menu, /onKeyDown=\{/);
  assert.doesNotMatch(menu, /role="listbox"/);
  assert.doesNotMatch(menu, /role="option"/);
});
