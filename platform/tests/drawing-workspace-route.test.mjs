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

test("IFC workspace surface pairs a blank overlay with the signed existing viewer", () => {
  assert.ok(workspaceView);
  const surface = workspaceView.drawingWorkspaceSurface({
    file: {
      id: "00000000-0000-4000-8000-000000000003",
      kind: "ifc",
      originalFilename: "model.ifc",
      byteSize: 2048,
    },
    page: { width: 841, height: 594, backgroundPdfPage: null },
    sourceUrl: "https://storage.test/model",
  });
  assert.deepEqual(surface, {
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
        originalFilename: "model.ifc",
        byteSize: 2048,
      },
      page: null,
      sourceUrl: null,
    }).sourceError,
    "IFC 원본 화면을 불러올 수 없습니다.",
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
  assert.match(
    shell,
    /import\("\.\/drawing-canvas\.client"\)[\s\S]*?\.catch\(/,
  );
  assert.match(
    shell,
    /import\("\.\/ifc-property-browser\.client"\)[\s\S]*?\.catch\(/,
  );
  assert.match(shell, /<IfcViewer \{\.\.\.surface\.ifcViewer\} \/>/);
  assert.doesNotMatch(shell, /target="_blank"/);
  assert.match(canvas, /containPdfSource\(rendered\.canvasSize/);
  assert.match(canvas, /x=\{pdfSource\.bounds\.x\}/);
  assert.match(canvas, /y=\{pdfSource\.bounds\.y\}/);
});
