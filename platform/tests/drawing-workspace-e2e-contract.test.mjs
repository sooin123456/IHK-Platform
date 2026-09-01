import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

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
  assert.doesNotMatch(fixture, /console\.(?:log|debug|info)\(/);

  assert.equal(
    packageJson.scripts["test:drawing-workspace"],
    "node --test tests/drawing-workspace-*.test.mjs tests/drawing-fixture-cleanup.test.mjs",
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

  assert.match(spec, /data-selected-object-id/);
  assert.match(spec, /zoomBefore[\s\S]*zoomAfter/);
  assert.match(spec, /panBefore[\s\S]*panAfter/);
  assert.match(spec, /selectionBefore[\s\S]*selectionAfter/);
  assert.match(spec, /recordInteractionFrames/);
  assert.match(spec, /interactionFrameTimesMilliseconds/);
  assert.match(
    spec,
    /const changedSelectionPoint[\s\S]*recordInteractionFrames\([\s\S]*page\.mouse\.click\(changedSelectionPoint\.x, changedSelectionPoint\.y\)/,
  );

  const negativeDelete = spec.indexOf(
    "await selectObject(page, missingRateObjectId);",
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
  const afterBoqApproval = spec.slice(boqApproval, exportStart);
  assert.match(
    afterBoqApproval,
    /editorPage\.goto\([\s\S]*canonicalPath\(fixture\.projectId, estimatorWorkspaceId\)/,
  );
  assert.match(afterBoqApproval, /state: "확정"/);
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
