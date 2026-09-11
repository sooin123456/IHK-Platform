import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { buildDrawingDxfImport } from "../app/lukas/lib/drawing-dxf-import.server.ts";
import {
  M4_DXF_ASCII,
  M4_DXF_SHA256,
} from "../e2e/utils/drawing-estimator-fixture.ts";

const root = process.cwd();
const read = (file) => readFile(path.join(root, file), "utf8");

test("drawing workspace has one complete serial production contract", async () => {
  const spec = await read("e2e/drawing-workspace.spec.ts");
  const fixture = await read("e2e/utils/drawing-collaboration-fixture.ts");
  const canvas = await read("app/lukas/components/drawing-canvas.client.tsx");
  const ifcLoader = await read("app/lukas/lib/ifc-render-model.client.ts");
  const packageJson = JSON.parse(await read("package.json"));

  assert.match(spec, /test\.describe\.serial\(/);
  assert.match(spec, /pdf-backed and blank workspaces open/);
  for (const label of [
    "선 도구",
    "폴리라인 도구",
    "사각형 도구",
    "원 도구",
    "텍스트 도구",
    "치수 도구",
  ]) {
    assert.match(spec, new RegExp(label));
  }
  for (const behavior of [
    "실행 취소",
    "다시 실행",
    "레이어 추가",
    "객체 이름",
    "선 색상",
    "선 두께",
    "채우기",
    "이슈 연결",
    "검토 요청",
    "도면 승인",
  ]) {
    assert.match(spec, new RegExp(behavior));
  }
  assert.match(spec, /survives reload and relogin/);
  assert.match(spec, /same-session draw, save, and issue link without reload/);
  assert.match(
    spec,
    /getByLabel\("속성 검사기"\)[\s\S]*getByLabel\("레이어",\s*\{ exact: true \}\)/,
  );
  assert.match(
    spec,
    /getByLabel\("속성 검사기"\)[\s\S]*getByLabel\("텍스트",\s*\{ exact: true \}\)/,
  );
  assert.match(spec, /toHaveCount\(1\)/);
  assert.match(spec, /viewer UI mutation controls are absent/);
  assert.match(spec, /non-member route, read API, and mutation RPC are denied/);
  assert.match(
    spec,
    /approved revision rejects canonical RPC and direct table mutations/,
  );
  assert.match(spec, /p_operation_type:\s*"update_objects"/);
  assert.match(spec, /p_operation_type:\s*"delete_objects"/);
  assert.match(spec, /readSourceEvidence/);
  assert.match(spec, /toEqual\(fixture\.sourceEvidence\)/);
  assert.match(spec, /10,000 canonical objects/);
  assert.match(spec, /seedDrawingPerformanceObjects/);
  assert.match(spec, /expect\(gestureMetrics\.frameCount\)\.toBe\(120\)/);
  assert.match(spec, /performance\.now\(\)/);
  assert.match(spec, /getByLabel\("이동 도구"\)\.click\(\)/);
  assert.match(spec, /page\.mouse\.wheel/);
  assert.match(spec, /viewportZoom/);
  assert.match(spec, /selectionCount/);
  assert.match(spec, /inspectorObjectName/);
  assert.match(spec, /seeded\.selectionTarget\.name/);
  assert.match(
    spec,
    /const gestureMetrics[\s\S]*getByRole\("button", \{ name: "화면 맞춤" \}\)\.click\(\)/,
  );
  assert.match(spec, /selectionSafetyMargin/);
  assert.match(spec, /targetScreenPoint/);
  assert.match(spec, /expect\s*\.poll/);
  assert.match(spec, /p95.*50/is);
  assert.doesNotMatch(spec, /live cursor|Yjs|Hocuspocus/i);

  for (const role of ["owner", "reviewer", "viewer", "nonMember"])
    assert.match(fixture, new RegExp(`\\b${role}\\b`));
  assert.match(fixture, /pdfWorkspace/);
  assert.match(fixture, /blankWorkspace/);
  assert.match(fixture, /existingIssueId/);
  assert.match(fixture, /sourceEvidence/);
  assert.match(fixture, /storageByteSha256/);
  assert.match(
    fixture,
    /\.storage\s*[\s\S]*\.from\("lukas-qto"\)\s*[\s\S]*\.download/,
  );
  assert.match(fixture, /seedDrawingPerformanceObjects/);
  assert.match(fixture, /buildDrawingPerformanceFixture/);
  assert.match(fixture, /selectionTarget/);
  assert.match(
    fixture,
    /raw\.githubusercontent\.com\/ThatOpen\/engine_web-ifc\/[0-9a-f]{40}\/examples\/example\.ifc/,
  );
  assert.doesNotMatch(fixture, /engine_web-ifc\/main\//);
  assert.match(fixture, /10_000/);
  assert.match(fixture, /cleanupErrors/);
  assert.match(fixture, /AggregateError/);
  assert.match(fixture, /cleanup.*dependency.*order/is);
  assert.match(fixture, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(fixture, /const requestedUrl = new URL\(next, baseUrl\)/);
  assert.match(
    fixture,
    /url\.pathname === requestedUrl\.pathname &&[\s\S]*url\.search === requestedUrl\.search/,
  );
  assert.doesNotMatch(fixture, /console\.(?:log|debug|info)\(/);

  assert.equal(
    packageJson.scripts["test:drawing-workspace"],
    "node --test tests/drawing-workspace-*.test.mjs tests/drawing-fixture-cleanup.test.mjs tests/project-file-upload-resume.test.mjs",
  );
  assert.equal(
    packageJson.scripts["test:e2e:drawing-workspace:production"],
    "playwright test e2e/drawing-workspace.spec.ts --project=chromium",
  );
  assert.equal(
    packageJson.scripts["test:ifc"],
    "node --test tests/drawing-ifc-render-model.test.mjs",
  );
  assert.match(ifcLoader, /crypto\.subtle\.digest/);
  assert.match(ifcLoader, /GLTFLoader/);
  assert.match(ifcLoader, /assertSelfContainedGlb/);
  assert.doesNotMatch(ifcLoader, /web-ifc/);
  assert.doesNotMatch(canvas, /<output/);
  assert.match(canvas, /data-viewport-zoom=\{viewport\.zoom\}/);
  assert.match(canvas, /export function drawingFittedViewport/);
  assert.match(
    canvas,
    /data-selection-count=\{selectionState\.selectedIds\.length\}/,
  );
  assert.match(
    canvas,
    /data-selected-object-id=\{selectedObjects\[0\]\?\.id \?\? ""\}/,
  );
});

test("M1 estimator journey locks negative rate, viewer RLS, and interaction evidence", async () => {
  const spec = await read("e2e/drawing-workspace-m1-estimator.spec.ts");

  const journeyStart = spec.indexOf(
    "estimator creates line area and count evidence and restores the bound draft after relogin",
  );
  const journeyEnd = spec.indexOf(
    "starter and PDF creation are idempotent and the PDF scale measures a known line",
    journeyStart,
  );
  assert.ok(journeyStart >= 0 && journeyEnd > journeyStart);
  const journey = spec.slice(journeyStart, journeyEnd);
  const initialEvidenceListener = journey.indexOf(
    "const evidence = trackContextEvidence(context)",
  );
  const initialAuthentication = journey.indexOf("authenticateContext(");
  assert.ok(
    initialEvidenceListener >= 0 &&
      initialEvidenceListener < initialAuthentication,
    "browser evidence must attach to the context before authenticated navigation",
  );
  const reloginContext = journey.indexOf(
    "context = await browser.newContext",
    initialAuthentication,
  );
  const reloginEvidenceListener = journey.indexOf(
    "trackContextEvidence(context, evidence)",
    reloginContext,
  );
  const reloginAuthentication = journey.indexOf(
    "authenticateContext(",
    reloginContext,
  );
  assert.ok(
    reloginContext >= 0 &&
      reloginEvidenceListener > reloginContext &&
      reloginEvidenceListener < reloginAuthentication,
    "shared browser evidence must attach to the replacement context before relogin navigation",
  );

  assert.match(spec, /removeEstimatorNegativeLine/);
  assert.match(spec, /getByLabel\("단가 누락 1건"\)/);
  assert.match(spec, /getByLabel\("근거 누락 1건"\)/);
  assert.match(spec, /검토 필요: 단가 자원 연결이 없습니다/);
  assert.match(spec, /estimateValue\(missingRateRow, "수량"\)[\s\S]*"0\.15 m"/);
  assert.match(spec, /missingRateRow[\s\S]*not\.toContainText\("0원"\)/);
  assert.match(
    spec,
    /missingRateRow\.getByText\("확정", \{ exact: true \}\)[\s\S]*toHaveCount\(0\)/,
  );

  assert.match(spec, /Prefer: "return=representation"/);
  assert.match(
    spec,
    /viewerBoqDatabaseMutation[\s\S]*\.status\(\)\)\.toBe\(200\)/,
  );
  assert.match(spec, /viewerBoqReturnedRows[\s\S]*toEqual\(\[\]\)/);
  assert.match(
    spec,
    /viewerBoqLineBefore[\s\S]*viewerBoqLineAfter[\s\S]*toEqual/,
  );
  assert.match(
    spec,
    /viewerMembership\.data\.role\)\.toBe\("viewer"\)[\s\S]*viewerObjectsBefore[\s\S]*viewerOperationsBefore[\s\S]*p_operation_type: "add_objects"[\s\S]*viewerDenied\.error\?\.code\)\.toBe\("P1R01"\)[\s\S]*viewerObjectsAfter[\s\S]*viewerOperationsAfter[\s\S]*revisionAfterViewerDenial[\s\S]*operations: viewerOperationsBefore\.data/,
  );

  assert.match(spec, /data-selected-object-id/);
  assert.match(spec, /zoomBefore[\s\S]*zoomAfter/);
  assert.match(spec, /panBefore[\s\S]*panAfter/);
  assert.match(spec, /selectionBefore[\s\S]*selectionAfter/);
  assert.match(spec, /recordInteractionFrames/);
  assert.match(
    spec,
    /addEventListener\(\s*eventType[\s\S]*capture: true[\s\S]*once: true/,
  );
  assert.match(spec, /if \(!recording\.interactionEventObserved\)/);
  assert.match(spec, /recordInteractionFrames\(\s*page,\s*"wheel"/);
  assert.match(spec, /recordInteractionFrames\(\s*page,\s*"pointerdown"/);
  assert.match(spec, /interactionFrameTimesMilliseconds/);
  assert.match(spec, /summarizeInteractionFrameTimes/);
  assert.match(spec, /writeFile\(evidencePath/);
  assert.match(
    spec,
    /const changedSelectionPoint[\s\S]*recordInteractionFrames\([\s\S]*page\.mouse\.click\(changedSelectionPoint\.x, changedSelectionPoint\.y\)/,
  );

  const negativeDelete = spec.indexOf(
    "await deleteObject(page, missingRateObjectId);",
  );
  const negativeGone = spec.indexOf(
    'page.getByText("M1-C-001", { exact: true })',
    negativeDelete,
  );
  const firstReloadAfterDelete = spec.indexOf(
    "await page.reload();",
    negativeDelete,
  );
  assert.ok(negativeDelete >= 0 && negativeGone > negativeDelete);
  assert.ok(
    firstReloadAfterDelete < 0 || negativeGone < firstReloadAfterDelete,
    "the acknowledged deletion must remove the stale estimate row before an explicit reload",
  );

  const quantitiesLoaded = spec.indexOf(
    "const quantities = await fixture.admin",
  );
  const boqNavigation = spec.indexOf("const boqPath =", quantitiesLoaded);
  const beforeBoqApproval = spec.slice(quantitiesLoaded, boqNavigation);
  assert.match(beforeBoqApproval, /state: "초안"/);
  assert.match(beforeBoqApproval, /state: "가정값"/);
  assert.doesNotMatch(beforeBoqApproval, /state: "확정"/);

  const boqApproval = spec.indexOf(
    'getByLabel("승인 결정").selectOption("approved")',
  );
  const exportStart = spec.indexOf(
    "const csv = await downloadNamed",
    boqApproval,
  );
  assert.match(spec, /page\.waitForEvent\("download", \{ timeout: 30_000 \}\)/);
  const afterBoqApproval = spec.slice(boqApproval, exportStart);
  assert.match(
    afterBoqApproval,
    /editorPage\.goto\([\s\S]*canonicalPath\(fixture\.projectId, estimatorWorkspaceId\)/,
  );
  assert.match(afterBoqApproval, /state: "확정"/);
});

test("P3 production gates keep Approver read-only and separate review from final approval", async () => {
  const spec = await read("e2e/drawing-workspace-p3.spec.ts");
  const gate05Start = spec.indexOf("P3 Gate 05:");
  const gate05End = spec.indexOf("P3 Gate 06:", gate05Start);
  const gate07Start = spec.indexOf("P3 Gate 07:", gate05End);
  const gate07End = spec.indexOf("P3 Gate 08:", gate07Start);
  assert.ok(
    gate05Start >= 0 &&
      gate05End > gate05Start &&
      gate07Start > gate05End &&
      gate07End > gate07Start,
  );
  const gate05 = spec.slice(gate05Start, gate05End);
  const gate07 = spec.slice(gate07Start, gate07End);

  assert.match(gate05, /openWorkspace\(browser, fixture, fixture\.approver\)/);
  assert.match(gate05, /\[viewer\.page, reviewer\.page, approver\.page\]/);
  assert.match(
    gate05,
    /const readOnlyWebSocketRoles = \[\s*\{ label: "viewer", user: fixture\.viewer,[\s\S]*\{ label: "reviewer", user: fixture\.reviewer,[\s\S]*\{ label: "approver", user: fixture\.approver,/,
  );
  assert.match(
    gate05,
    /for \(const \{ label, user, coordinate \} of readOnlyWebSocketRoles\)/,
  );
  assert.match(gate05, /connectProvider\(fixture, user\)/);
  assert.match(gate05, /actorId: user\.id/);
  assert.match(gate05, /expect\(deniedWsRow\.data\)\.toBeNull\(\)/);
  assert.match(
    gate05,
    /for \(const user of \[\s*fixture\.viewer,\s*fixture\.reviewer,\s*fixture\.approver,\s*fixture\.nonMember,\s*\]\)/,
  );
  assert.match(gate05, /expect\(deniedRow\.data\)\.toBeNull\(\)/);

  const reviewer = gate07.indexOf(
    "openWorkspace(browser, fixture, fixture.reviewer)",
  );
  const reviewedButton = gate07.indexOf('name: "도면 검토 완료"', reviewer);
  const reviewedStatus = gate07.indexOf('.toBe("reviewed")', reviewedButton);
  const approver = gate07.indexOf(
    "openWorkspace(browser, fixture, fixture.approver)",
    reviewedStatus,
  );
  const approvedButton = gate07.indexOf('name: "도면 최종 승인"', approver);
  const approvedStatus = gate07.indexOf('.toBe("approved")', approvedButton);
  assert.ok(
    reviewer >= 0 &&
      reviewedButton > reviewer &&
      reviewedStatus > reviewedButton &&
      approver > reviewedStatus &&
      approvedButton > approver &&
      approvedStatus > approvedButton,
  );
  assert.match(gate07, /\.from\("lukas_drawing_revision_approvals"\)/);
  assert.match(
    gate07,
    /expect\(approvals\.data\)\.toEqual\(\[\s*\{ decision: "reviewed", decided_by: fixture\.reviewer\.id \},\s*\{ decision: "approved", decided_by: fixture\.approver\.id \},\s*\]\)/,
  );
});

test("M4 canonical source gates prove durable PDF attachment and dual PDF IFC lineage", async () => {
  const spec = await read("e2e/drawing-workspace-m1-estimator.spec.ts");

  const restoreStart = spec.indexOf(
    "an editor reopens a selected IFC on a source-free workspace before attaching an immutable PDF",
  );
  const restoreEnd = spec.indexOf(
    "one canonical object keeps PDF region and IFC GlobalId lineage",
    restoreStart,
  );
  assert.ok(restoreStart >= 0 && restoreEnd > restoreStart);
  const restoreGate = spec.slice(restoreStart, restoreEnd);
  assert.match(
    restoreGate,
    /page\.reload\(\{ waitUntil: "domcontentloaded" \}\)/,
  );
  assert.match(
    restoreGate,
    /await context\.close\(\)[\s\S]*browser\.newContext/,
  );
  assert.match(restoreGate, /getByLabel\("IFC 원본 선택"\)/);
  assert.match(restoreGate, /selectOption\(fixture\.ifcFileId\)/);
  assert.match(restoreGate, /searchParams\.get\("ifc"\)/);
  assert.match(restoreGate, /searchParams\.get\("view"\) === "3d"/);
  assert.equal(restoreGate.match(/expectReadyIfcViewer\(page\)/g)?.length, 2);
  assert.match(spec, /data-viewer-phase/);
  assert.match(spec, /getByRole\("button", \{ name: "전체 보기"/);
  assert.match(restoreGate, /authenticateContext\([\s\S]*selectedIfcPath/);
  assert.match(restoreGate, /authenticateContext\([\s\S]*canonicalPath/);
  const twoDimensionalButton = restoreGate.indexOf(
    'const twoDimensionalViewButton = page.getByRole("button", {',
  );
  const twoDimensionalUrl = restoreGate.indexOf(
    'url.searchParams.get("view") === "2d"',
    twoDimensionalButton,
  );
  const twoDimensionalPressed = restoreGate.indexOf(
    '"aria-pressed"',
    twoDimensionalUrl,
  );
  const twoDimensionalCanvas = restoreGate.indexOf(
    "getByLabel(/도면 화면/)",
    twoDimensionalPressed,
  );
  const pdfAttachForm = restoreGate.indexOf(
    "const attachForm =",
    twoDimensionalPressed,
  );
  assert.ok(
    twoDimensionalButton >= 0 &&
      twoDimensionalUrl > twoDimensionalButton &&
      twoDimensionalPressed > twoDimensionalUrl &&
      twoDimensionalCanvas > twoDimensionalPressed &&
      pdfAttachForm > twoDimensionalCanvas,
  );
  assert.match(restoreGate, /ifcSourceBefore/);
  assert.match(restoreGate, /sourceAfter\[fixture\.ifcFileId\]/);
  assert.match(restoreGate, /m4SourceRestoreBefore/);
  assert.match(restoreGate, /m4SourceRestoreAfter/);
  assert.match(restoreGate, /data-pdf-current-mounted/);

  const sourceGateEnd = spec.indexOf(
    "estimator creates line area and count evidence",
    restoreEnd,
  );
  assert.ok(sourceGateEnd > restoreEnd);
  const sourceGate = spec.slice(restoreEnd, sourceGateEnd);
  const objectInspectorTab = sourceGate.indexOf(
    'getByRole("tab", { name: "객체", exact: true })',
  );
  const pdfSourceLink = sourceGate.indexOf("PDF 영역 원본 근거 연결");
  assert.ok(
    objectInspectorTab >= 0 && objectInspectorTab < pdfSourceLink,
    "canonical source linking must open the visible object inspector first",
  );
  assert.match(sourceGate, /PDF 영역 원본 근거 연결/);
  assert.match(sourceGate, /IFC 원본 근거 연결/);
  assert.match(sourceGate, /IFC GlobalId/);
  assert.match(
    sourceGate,
    /getByRole\("searchbox",\s*\{\s*name: "IFC 요소 검색"/,
  );
  assert.match(sourceGate, /data-selected-object-id/);
  assert.match(
    sourceGate,
    /editorSurface\.click\(\{\s*position:\s*\{\s*x:\s*220,\s*y:\s*100\s*\}/,
  );
  assert.doesNotMatch(
    sourceGate,
    /editorSurface\.click\(\{\s*position:\s*\{\s*x:\s*24,\s*y:\s*24\s*\}/,
  );
  assert.doesNotMatch(
    sourceGate,
    /drawingSurfacePoint\(editorPage, \{\s*x: 500,\s*y: 500/,
  );
  assert.match(sourceGate, /분할 보기/);
  assert.match(sourceGate, /2D 도면/);
  assert.match(sourceGate, /IFC 3D/);
  assert.match(
    sourceGate,
    /data-pdf-diff-marker="true"\]\[data-listening="false"\]/,
  );
  assert.match(sourceGate, /fixture\.viewer/);
  assert.match(sourceGate, /p_operation_type: "mutate_structure"/);
  assert.match(sourceGate, /expect\(viewerDenied\.error\)\.not\.toBeNull\(\)/);
  assert.match(sourceGate, /m4SourceEvidenceBefore/);
  assert.match(sourceGate, /m4SourceEvidenceAfter/);
});

test("M4 browser DXF fixture is a bounded INSERT with exact raw child lineage", async () => {
  const bytes = Buffer.from(M4_DXF_ASCII, "ascii");
  assert.equal(bytes.byteLength, 418);
  assert.equal(
    createHash("sha256").update(bytes).digest("hex"),
    "56d1004aa7f35fdab257cf294614332453a1fd9c7ba8876f74b58bc2a972a261",
  );
  assert.equal(
    M4_DXF_SHA256,
    "56d1004aa7f35fdab257cf294614332453a1fd9c7ba8876f74b58bc2a972a261",
  );

  const result = await buildDrawingDxfImport({
    bytes,
    revisionId: "71000000-0000-4000-8000-000000000001",
    canvasId: "71000000-0000-4000-8000-000000000002",
    createdAt: "2026-09-02T12:00:00.000Z",
  });

  assert.equal(result.report.imported, 1);
  assert.deepEqual(result.report.blocking, []);
  assert.deepEqual(
    result.objects.map(({ geometry }) => geometry),
    [
      {
        type: "line",
        start: { x: 120, y: 100 },
        end: { x: 420, y: 100 },
      },
    ],
  );
  assert.deepEqual(
    result.layers.map(({ name, visible, locked }) => ({
      name,
      visible,
      locked,
    })),
    [{ name: "A-WALL", visible: true, locked: false }],
  );
  assert.deepEqual(
    result.entityLineage.map(
      ({ entityKey, entityType, sourceLayer, rawHandle }) => ({
        entityKey,
        entityType,
        sourceLayer,
        rawHandle,
      }),
    ),
    [
      {
        entityKey: "entities:0/block:0@raw:BLOCKS:0:0",
        entityType: "LINE",
        sourceLayer: "0",
        rawHandle: "B10C",
      },
    ],
  );
  assert.ok(
    result.report.converted.some(({ code }) => code === "BLOCK_FLATTENED"),
  );
  assert.ok(
    result.report.converted.some(({ code }) => code === "HANDLE_NORMALIZED"),
  );
});

test("M4 canonical DXF browser gate undoes and redoes one exact import graph", async () => {
  const spec = await read("e2e/drawing-workspace-m1-estimator.spec.ts");
  const start = spec.indexOf(
    "a verified DXF upload imports one durable object-source graph",
  );
  const end = spec.indexOf(
    "estimator creates line area and count evidence",
    start,
  );
  assert.ok(start >= 0 && end > start);
  const gate = spec.slice(start, end);

  const imported = gate.indexOf("const graphBeforeUndo");
  const undone = gate.indexOf('name: "실행 취소"', imported);
  const emptyGraph = gate.indexOf("const graphAfterUndo", undone);
  const redone = gate.indexOf('name: "다시 실행"', emptyGraph);
  const restoredGraph = gate.indexOf("const graphAfterRedo", redone);
  const reload = gate.indexOf(
    'reload({ waitUntil: "domcontentloaded" })',
    restoredGraph,
  );
  const relogin = gate.indexOf(
    "reloginContext = await browser.newContext",
    reload,
  );
  const viewerDenied = gate.indexOf(
    "expect(deniedPrepare.status()).toBe(403)",
    relogin,
  );
  assert.ok(
    imported >= 0 &&
      undone > imported &&
      emptyGraph > undone &&
      redone > emptyGraph &&
      restoredGraph > redone &&
      reload > restoredGraph &&
      relogin > reload &&
      viewerDenied > relogin,
  );

  assert.match(gate, /getByRole\("button",\s*\{\s*name: "실행 취소",?\s*\}\)/);
  assert.match(gate, /getByRole\("button",\s*\{\s*name: "다시 실행",?\s*\}\)/);
  assert.match(gate, /canonicalDxfImportResidue/);
  assert.match(
    gate,
    /expect\(graphAfterUndo\.active\)\.toEqual\(\{\s*layers: \[\],\s*objects: \[\],\s*sources: \[\],\s*\}\)/,
  );
  assert.match(gate, /graphAfterUndo\.tombstones\.objects/);
  assert.match(gate, /graphAfterUndo\.tombstones\.sources/);
  assert.match(
    gate,
    /dxfImportIdentityGraph\(graphAfterRedo\)[\s\S]*dxfImportIdentityGraph\(graphBeforeUndo\)/,
  );
  for (const collection of ["layers", "objects", "sources"])
    assert.match(
      gate,
      new RegExp(
        `graphAfterRedo\\.${collection}\\[0\\]\\.version[\\s\\S]*toBeGreaterThan\\(\\s*graphBeforeUndo\\.${collection}\\[0\\]\\.version,?\\s*\\)`,
      ),
    );
  assert.match(gate, /source_sha256: M4_DXF_SHA256/);
  assert.match(gate, /expect\(graphAfterRelogin\)\.toEqual\(graphAfterRedo\)/);
  assert.match(gate, /expect\(graphAfterViewer\)\.toEqual\(graphAfterRedo\)/);
});

test("M5 browser gate keeps approved BOQ material lineage exact and Viewer read-only", async () => {
  const spec = await read("e2e/drawing-workspace-m1-estimator.spec.ts");
  const start = spec.indexOf(
    "approved BOQ material handoff preserves exact drawing-to-site lineage and Viewer denial",
  );
  const end = spec.indexOf(
    "an owner publishes an approved estimator revision as a company template",
    start,
  );
  assert.ok(start >= 0 && end > start);
  const gate = spec.slice(start, end);

  const handoffCta = gate.indexOf('name: "자재 인계"');
  const handoff = gate.indexOf("const materialLinkAfterHandoff", handoffCta);
  const viewerHandoffOnly = gate.indexOf(
    "const viewerHandoffOnlySteps",
    handoff,
  );
  const factor = gate.indexOf("const materialFactor", handoff);
  const purchaseOrder = gate.indexOf("const purchaseOrder", factor);
  const summary = gate.indexOf("const materialSummary", purchaseOrder);
  const reverseLineage = gate.indexOf('name: "승인 BOQ 근거 열기"', summary);
  const immutableAfter = gate.indexOf(
    "const materialImmutableEvidenceAfter",
    reverseLineage,
  );
  const viewerCompleted = gate.indexOf(
    "const viewerCompletedMaterialSteps",
    immutableAfter,
  );
  const viewerDenial = gate.indexOf(
    "const viewerMaterialPlanInsert",
    immutableAfter,
  );
  assert.ok(
    handoffCta >= 0 &&
      handoff > handoffCta &&
      viewerHandoffOnly > handoff &&
      factor > viewerHandoffOnly &&
      purchaseOrder > factor &&
      summary > purchaseOrder &&
      reverseLineage > summary &&
      immutableAfter > reverseLineage &&
      viewerCompleted > immutableAfter &&
      viewerDenial > viewerCompleted,
  );

  assert.match(gate, /materials\?version=\$\{boqVersionId\}/);
  assert.match(gate, /const drawingObjectLineageUrl/);
  assert.match(gate, /const ownerMaterialLineageStep/);
  assert.match(gate, /const viewerMaterialLineageStep/);
  assert.match(gate, /data-lineage-step="자재 인계"/);
  assert.match(gate, /data-material-progress-step/);
  for (const label of ["자재 인계", "발주", "입고", "시공·폐기", "탄소 근거"])
    assert.match(gate, new RegExp(label));
  assert.match(
    gate,
    /boq\?version=\$\{boqVersionId\}&line=\$\{boqStructure\.lineIdsByCode\["W-001"\]\}/,
  );
  assert.match(
    gate,
    /materials\?version=\$\{boqVersionId\}&boqLineId=\$\{boqStructure\.lineIdsByCode\["W-001"\]\}/,
  );
  assert.match(gate, /boqStructure\.componentIdsByCode\["W-001"\]/);
  assert.match(gate, /P6_MATERIAL_HANDOFF_V1/);
  assert.match(gate, /derived_design_quantity:[\s\S]*"0\.3"/);
  assert.match(gate, /allowance_rate:[\s\S]*"0"/);
  assert.match(gate, /getByLabel\("자료 종류"\)\.selectOption\("generic"\)/);
  assert.match(gate, /getByLabel\("표준·PCR"\)\.fill\("ISO 14040"\)/);
  assert.match(gate, /getByLabel\("적용 지역"\)\.fill\("KR"\)/);
  for (const transactionType of [
    "purchase_order",
    "goods_receipt",
    "installation",
    "waste_disposal",
  ])
    assert.match(gate, new RegExp(`selectOption\\("${transactionType}"\\)`));
  assert.match(gate, /orderedQuantity:[\s\S]*"0\.3"/);
  assert.match(gate, /receivedQuantity:[\s\S]*"0\.3"/);
  assert.match(gate, /installedQuantity:[\s\S]*"0\.2"/);
  assert.match(gate, /wastedQuantity:[\s\S]*"0\.1"/);
  assert.match(gate, /onSiteQuantity:[\s\S]*"0"/);
  assert.match(gate, /탄소 근거 완전/);
  assert.match(
    gate,
    /expect\(materialImmutableEvidenceAfter\)\.toEqual\(immutableEvidenceBefore\)/,
  );
  assert.match(gate, /expect\(viewerMaterialAction\.status\(\)\)\.toBe\(403\)/);
  assert.match(
    gate,
    /expect\(viewerMaterialPlanInsert\.error\)\.toBeTruthy\(\)/,
  );
  assert.match(
    gate,
    /expect\(viewerMaterialTransactionInsert\.error\)\.toBeTruthy\(\)/,
  );
  assert.match(
    gate,
    /expect\(viewerMaterialSnapshotAfter\)\.toEqual\([\s\S]*viewerMaterialSnapshotBefore,?[\s\S]*\)/,
  );
});

test("M1 visual evidence follows tablet dock exclusivity and waits for the contained PDF failure", async () => {
  const spec = await read("e2e/drawing-workspace-m1-estimator.spec.ts");

  assert.match(spec, /message\.location\(\)\.url/);
  assert.match(
    spec,
    /if \(viewport\.width === 1024\)[\s\S]*expect\(leftRail\)\.toBeHidden\(\)[\s\S]*왼쪽 도구 패널 열기[\s\S]*expect\(inspector\)\.toBeHidden\(\)[\s\S]*속성 검사기 열기/,
  );
  assert.match(
    spec,
    /else \{[\s\S]*expect\(leftRail\)\.toBeVisible\(\)[\s\S]*expect\(inspector\)\.toBeVisible\(\)[\s\S]*noOverlap\(leftRail, canvas\)/,
  );
  assert.match(
    spec,
    /expect\s*\.poll\(\(\) => pdfSignRequestAborted\)[\s\S]*\.toBe\(true\)/,
  );
  assert.match(
    spec,
    /toHaveAttribute\(\s*"data-pdf-current-mounted",\s*"false",?\s*\)/,
  );
  assert.match(spec, /pdfFailure:\s*\{[\s\S]*message:/);
});

test("M1 two-point shapes use the canvas drag gesture instead of line clicks", async () => {
  const spec = await read("e2e/drawing-workspace-m1-estimator.spec.ts");
  const helper = spec.match(
    /async function drawTwoPointShape\([\s\S]*?\n}\n\n(?=async function classifySelectedObject)/,
  )?.[0];
  assert.ok(helper, "drawTwoPointShape helper must exist");
  assert.doesNotMatch(helper, /drawLine\(/);
  assert.match(helper, /const surface = page\.getByLabel\(\/도면 화면\/\)/);
  assert.match(helper, /const box = await surface\.boundingBox\(\)/);
  assert.match(
    helper,
    /await page\.mouse\.move\(box\.x \+ input\.x1, box\.y \+ input\.y1\)/,
  );
  assert.match(helper, /await page\.mouse\.down\(\)/);
  assert.match(
    helper,
    /await page\.mouse\.move\(box\.x \+ input\.x2, box\.y \+ input\.y2, \{ steps: \d+ \}\)/,
  );
  assert.match(helper, /await page\.mouse\.up\(\)/);
});

test("release documentation keeps local evidence separate from external gates", async () => {
  const deployment = await read("DEPLOYMENT.md");
  const matrix = await read("../docs/P0_P5_IMPLEMENTATION_MATRIX.md");

  for (const evidence of [
    "schema snapshot",
    "migration",
    "db:typegen",
    "test:drawing-workspace",
    "test:e2e:drawing-workspace:production",
    "Editor",
    "Viewer",
    "rollback",
    "forward-fix",
  ]) {
    assert.match(deployment, new RegExp(evidence, "i"));
  }
  for (const variable of [
    "E2E_BASE_URL",
    "SUPABASE_URL",
    "SUPABASE_ANON_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
  ]) {
    assert.match(deployment, new RegExp(variable));
  }
  assert.match(deployment, /unexecuted/i);
  assert.match(deployment, /60fps.*P7/is);
  assert.match(deployment, /ThatOpen\/engine_web-ifc/);
  assert.match(deployment, /GLB.*manifest/is);
  assert.match(deployment, /MPL-2\.0/);
  assert.match(deployment, /network/i);
  assert.match(matrix, /Drawing Workspace P0\/P1/);
  assert.match(matrix, /P3.*Yjs.*Hocuspocus/is);
  assert.match(matrix, /미실행|외부 게이트/);
  assert.doesNotMatch(matrix, /P3[^\n]*완료/);
});
