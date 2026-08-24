import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (file) => readFile(path.join(root, file), "utf8");

test("drawing workspace has one complete serial production contract", async () => {
  const spec = await read("e2e/drawing-workspace.spec.ts");
  const fixture = await read("e2e/utils/drawing-collaboration-fixture.ts");
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
  assert.match(spec, /reload and relogin restore acknowledged edits/);
  assert.match(spec, /getByLabel\("레이어"\)\.selectOption/);
  assert.match(spec, /getByLabel\("텍스트"\)/);
  assert.match(spec, /viewer UI and direct mutations are read-only/);
  assert.match(spec, /approved revision rejects direct update and delete/);
  assert.match(spec, /readSourceHashes/);
  assert.match(spec, /toEqual\(fixture\.sourceHashes\)/);
  assert.match(spec, /10,000 canonical objects/);
  assert.match(spec, /seedDrawingPerformanceObjects/);
  assert.match(spec, /frameCount:\s*120/);
  assert.match(spec, /performance\.now\(\)/);
  assert.match(spec, /p95.*50/is);
  assert.doesNotMatch(spec, /live cursor|Yjs|Hocuspocus/i);

  for (const role of ["owner", "reviewer", "viewer", "nonMember"])
    assert.match(fixture, new RegExp(`\\b${role}\\b`));
  assert.match(fixture, /pdfWorkspace/);
  assert.match(fixture, /blankWorkspace/);
  assert.match(fixture, /existingIssueId/);
  assert.match(fixture, /sourceHashes/);
  assert.match(fixture, /seedDrawingPerformanceObjects/);
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
    "npx playwright test e2e/drawing-workspace.spec.ts --project=chromium",
  );
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
  assert.match(matrix, /Drawing Workspace P0\/P1/);
  assert.match(matrix, /P3.*Yjs.*Hocuspocus/is);
  assert.match(matrix, /미실행|외부 게이트/);
  assert.doesNotMatch(matrix, /P3[^\n]*완료/);
});
