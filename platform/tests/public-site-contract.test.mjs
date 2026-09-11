import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { readPublicReleaseConfig } from "../app/features/home/lib/release-config.ts";

const root = process.cwd();
const read = (file) => readFile(path.join(root, file), "utf8");

test("public routes expose news, RSS and free download without payment checkout", async () => {
  const routes = await read("app/routes.ts");
  assert.match(routes, /route\("\/news"/);
  assert.match(routes, /route\("\/news\/:slug"/);
  assert.match(routes, /route\("\/news\.xml"/);
  assert.match(routes, /route\("\/download"/);
  assert.match(routes, /route\("\/download\/revit-2025"/);
  assert.doesNotMatch(routes, /payments|checkout/i);

  const packageJson = JSON.parse(await read("package.json"));
  assert.equal(
    packageJson.dependencies["@tosspayments/tosspayments-sdk"],
    undefined,
  );

  const download = await read("app/features/home/screens/download.tsx");
  assert.match(download, /0원/);
  assert.match(download, /결제정보 불필요/);
  assert.match(download, /readPublicReleaseConfig/);
  assert.match(
    download,
    /allowLoopback:\s*import\.meta\.env\.VITE_M1_E2E_ALLOW_LOOPBACK_RELEASE === "1"/,
  );
  assert.match(download, /href="\/download\/revit-2025"/);
  const redirect = await read("app/features/home/screens/revit-download.ts");
  assert.match(redirect, /lukas_qto_license_entitlements/);
  assert.match(redirect, /recordRevitDownloadAudit/);
  assert.match(redirect, /Cache-Control/);
});

test("release download requires HTTPS and a complete SHA-256 by default", () => {
  const sha256 = "a".repeat(64);

  assert.equal(
    readPublicReleaseConfig({
      url: "https://downloads.example.com/revit-2025.zip",
      sha256,
    }).ready,
    true,
  );
  assert.equal(
    readPublicReleaseConfig({
      url: "http://127.0.0.1:12350/revit-2025.zip",
      sha256,
    }).ready,
    false,
  );
  assert.equal(
    readPublicReleaseConfig({
      url: "https://downloads.example.com/revit-2025.zip",
      sha256: "not-a-sha",
    }).ready,
    false,
  );
});

test("release download permits only exact HTTP loopback hosts when the M1 test flag is explicit", () => {
  const sha256 = "b".repeat(64);

  for (const url of [
    "http://127.0.0.1:12350/revit-2025.zip",
    "http://[::1]:12350/revit-2025.zip",
  ]) {
    assert.equal(
      readPublicReleaseConfig({ url, sha256, allowLoopback: true }).ready,
      true,
      url,
    );
  }

  for (const url of [
    "http://localhost:12350/revit-2025.zip",
    "http://127.0.0.2:12350/revit-2025.zip",
    "http://example.com/revit-2025.zip",
  ]) {
    assert.equal(
      readPublicReleaseConfig({ url, sha256, allowLoopback: true }).ready,
      false,
      url,
    );
  }
});

test("customer workflow uses verified email auth and excludes AI and anonymous bypasses", async () => {
  const routes = await read("app/routes.ts");
  const privateLayout = await read("app/core/layouts/private.layout.tsx");
  const project = await read("app/lukas/screens/project.tsx");
  assert.match(routes, /route\("\/privacy"/);
  assert.match(routes, /route\("\/staff\/inquiries"/);
  assert.doesNotMatch(routes, /remote-access|auth-bypass/);
  assert.match(privateLayout, /user\.is_anonymous/);
  assert.doesNotMatch(project, /ai_suggestion|AI 제안|signInAnonymously/);
  assert.match(project, /정해진 검사 규칙/);
});

test("magic links can finish securely in a different email browser", async () => {
  const sender = await read("app/features/auth/lib/auth-link.server.ts");
  const login = await read("app/features/auth/screens/magic-link.tsx");
  const confirm = await read("app/features/auth/screens/confirm.tsx");
  assert.match(sender, /aes-256-gcm/);
  assert.match(sender, /code_challenge_method: "s256"/);
  assert.match(sender, /auth_state/);
  assert.match(login, /sendCrossBrowserMagicLink/);
  assert.match(confirm, /exchangeCrossBrowserCode/);
  assert.match(confirm, /client\.auth\.setSession/);
  assert.match(confirm, /새 로그인 링크 받기/);
});

test("external suggestion pilot is disabled by default and restricted to staff import", async () => {
  const routes = await read("app/routes.ts");
  const pilot = await read("app/lukas/screens/suggestion-pilot.tsx");
  const environment = await read(".env.example");
  assert.match(routes, /projects\/:projectId\/suggestion-pilot/);
  assert.match(environment, /LUKAS_ENABLE_AI_PILOT=false/);
  assert.match(pilot, /LUKAS_ENABLE_AI_PILOT === "true"/);
  assert.match(pilot, /app_metadata\.role !== "hangil_staff"/);
  assert.match(pilot, /verifyAiSuggestionImport/);
  assert.match(pilot, /createHash\("sha256"\)\.update\(sourceBytes\)/);
  assert.match(pilot, /모델을 이 웹앱에서 호출하지 않습니다/);
  assert.doesNotMatch(
    pilot,
    /openai|anthropic|generateText|chat\.completions/i,
  );
});

test("project inquiry is stored with consent and has a staff-only queue", async () => {
  const inquiry = await read("app/features/home/screens/inquiry.tsx");
  const staff = await read("app/lukas/screens/staff-inquiries.tsx");
  const migration = await read(
    "sql/migrations/0009_preflight_audit_artifacts.sql",
  );
  assert.match(inquiry, /hangil_project_inquiries/);
  assert.match(inquiry, /consent: true/);
  assert.match(staff, /hangil_staff/);
  assert.match(
    migration,
    /create table if not exists public\.hangil_project_inquiries/,
  );
  assert.match(migration, /as restrictive/);
  assert.match(migration, /is_anonymous/);
});

test("every company news filename matches complete frontmatter", async () => {
  const docsDirectory = path.join(root, "app/features/blog/docs");
  const files = (await readdir(docsDirectory)).filter((file) =>
    file.endsWith(".mdx"),
  );
  assert.equal(files.length, 3);
  for (const file of files) {
    const source = await readFile(path.join(docsDirectory, file), "utf8");
    const block = source.match(/^---\n([\s\S]*?)\n---/);
    assert.ok(block, `${file}: missing frontmatter`);
    for (const key of [
      "title",
      "description",
      "date",
      "category",
      "author",
      "slug",
      "image",
    ]) {
      assert.match(
        block[1],
        new RegExp(`^${key}:\\s*.+$`, "m"),
        `${file}: missing ${key}`,
      );
    }
    const slug = block[1].match(/^slug:\s*([^\s]+)\s*$/m)?.[1];
    assert.equal(`${slug}.mdx`, file);
  }
});

test("material control is a separate authenticated web workflow with append-only evidence", async () => {
  const routes = await read("app/routes.ts");
  const migration = await read(
    "sql/migrations/0010_material_control_pilot.sql",
  );
  const screen = await read("app/lukas/screens/material-control.tsx");
  assert.match(routes, /projects\/:projectId\/materials/);
  assert.match(routes, /projects\/:projectId\/materials\.csv/);
  assert.match(migration, /lukas_qto_material_plans/);
  assert.match(migration, /lukas_qto_material_transactions/);
  assert.match(migration, /lukas_qto_carbon_factors/);
  assert.match(migration, /enable row level security/);
  assert.match(migration, /revoke update, delete/);
  assert.match(migration, /verified email sessions only/);
  assert.match(screen, /Revit 설치 프로그램과 별도의 현장 기록 화면입니다/);
  assert.match(screen, /기록되었습니다\. 아래 현황에 새 내용이 반영됐습니다/);
  assert.match(screen, /탄소 정보 입력 \(고급\)/);
  assert.match(
    screen,
    /const fieldId = useId\(\)/,
    "repeated material forms must not share global label target ids",
  );
  assert.match(screen, /<Label htmlFor=\{fieldId\}>\{label\}<\/Label>/);
  assert.doesNotMatch(screen, /payment|checkout|세금계산서 발행/i);
});

test("project workspace defaults to a readable light theme and separates the five jobs", async () => {
  const rootScreen = await read("app/root.tsx");
  const navigation = await read(
    "app/lukas/components/project-workspace-nav.tsx",
  );
  const routes = await read("app/routes.ts");

  assert.match(rootScreen, /specifiedTheme=\{data\?\.theme \?\? "light"\}/);
  assert.match(navigation, /label: "개요"/);
  assert.match(navigation, /label: "도면"/);
  assert.match(navigation, /label: "물량"/);
  assert.match(navigation, /label: "검토"/);
  assert.match(navigation, /label: "자재"/);
  assert.match(navigation, /fixed inset-x-0 bottom-0/);
  assert.match(navigation, /min-h-14/);
  assert.match(routes, /projects\/:projectId\/files/);
  assert.match(routes, /projects\/:projectId\/drawings/);
  assert.match(routes, /projects\/:projectId\/quantities/);
  assert.match(routes, /projects\/:projectId\/reviews/);
});

test("project overview leads with one next action, four progress stages and pending review count", async () => {
  const project = await read("app/lukas/screens/project.tsx");

  assert.match(project, /지금 할 일/);
  assert.match(project, /const stages = \[/);
  assert.match(project, /진행 단계/);
  assert.match(project, /completedStages/);
  assert.match(project, /pendingQuantityApprovalCount/);
  assert.match(project, /pendingSuggestionCount/);
  assert.match(project, /latest\.decision === "deferred"/);
  assert.match(project, /key=\{uploadKind\}/);
  assert.match(project, /hasConcreteSourceSet/);
  assert.match(project, /산출 입력 7종/);
  assert.match(project, /계산 근거 파일 추가/);
  assert.match(project, /quantity-decisions/);
  assert.match(project, /① 물량 결과 CSV/);
  assert.match(project, /② 계산 근거 CSV/);
  assert.match(project, /결정을 선택하세요/);
  assert.match(project, /수정이 필요한 이유를 메모에 입력하세요/);
  assert.match(project, /최근 활동/);
  assert.match(project, /view === "files"/);
  assert.match(project, /view === "quantities"/);
  assert.match(project, /view === "reviews"/);
  assert.doesNotMatch(project, /프로젝트 설명이 없습니다/);
});

test("returning customers enter a functional drawing-project workspace", async () => {
  const workspace = await read("app/lukas/screens/workspace.tsx");
  const dashboard = await read("app/lukas/components/workspace-dashboard.tsx");
  const themeSwitcher = await read("app/core/components/theme-switcher.tsx");

  assert.match(dashboard, /새 도면 프로젝트/);
  assert.match(dashboard, /프로젝트 만들고 작업공간 열기/);
  assert.match(dashboard, /프로젝트 검색/);
  assert.match(dashboard, /이어서 작업/);
  assert.match(dashboard, /전체 프로젝트/);
  assert.match(dashboard, /프로젝트 필터/);
  assert.match(dashboard, /projectListHref/);
  assert.match(dashboard, /drawingWorkspacePath/);
  assert.match(dashboard, /1HK Platform/);
  assert.match(workspace, /projectMetrics/);
  assert.match(workspace, /lukas_qto_project_members/);
  assert.match(workspace, /original_filename/);
  assert.doesNotMatch(dashboard, /설명 없음/);
  assert.match(themeSwitcher, /aria-label="화면 테마 변경"/);
  assert.match(themeSwitcher, /기기 설정 사용/);
});

test("workspace cards lead to drawing lists and the latest drawing remains resumable", async () => {
  const screen = await read("app/lukas/components/workspace-dashboard.tsx");
  const loader = await read("app/lukas/screens/workspace.tsx");
  assert.match(screen, /도면 목록 열기/);
  assert.match(screen, /이어서 작업/);
  assert.match(screen, /drawingWorkspacePath/);
  assert.match(loader, /listDrawingIssueMetrics/);
});
