import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (file) => readFile(path.join(root, file), "utf8");

test("local Playwright server binds the same explicit host as its readiness URL", async () => {
  const config = await read("playwright.config.ts");
  const baseHost = config.match(
    /const BASE_URL =[^\n]*`http:\/\/([^:$`]+):\$\{PORT\}`/,
  )?.[1];
  const commandHost = config.match(
    /command:\s*`npm run dev -- --port \$\{PORT\} --host ([^\s`]+)`/,
  )?.[1];

  assert.ok(baseHost, "local BASE_URL must declare an explicit host");
  assert.ok(
    commandHost,
    "local webServer command must declare an explicit host",
  );
  assert.equal(commandHost, baseHost);
});

test("drawing collaboration E2E covers roles, realtime, mobile, and cleanup", async () => {
  const config = await read("playwright.config.ts");
  const spec = await read("e2e/drawing-collaboration.spec.ts");
  const fixture = await read("e2e/utils/drawing-collaboration-fixture.ts");

  assert.match(config, /process\.env\.E2E_BASE_URL/);
  assert.match(config, /webServer:\s*remote\s*\?\s*undefined/);

  for (const role of [
    "owner",
    "editor",
    "reviewer",
    "approver",
    "viewer",
    "nonMember",
  ])
    assert.match(fixture, new RegExp(`\\b${role}\\b`));
  assert.match(fixture, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(fixture, /value === "\[SENSITIVE\]"/);
  assert.match(fixture, /IFC_SHA256/);
  assert.match(fixture, /destroyDrawingFixture/);
  assert.match(fixture, /deleteUser/);
  assert.match(fixture, /storage\.from\("lukas-qto"\)\.remove/);

  assert.match(
    spec,
    /editor submits, reviewer checks, and a separate approver decides in realtime/,
  );
  assert.match(spec, /fixture\.editor/);
  assert.match(spec, /fixture\.reviewer/);
  assert.match(spec, /fixture\.approver/);
  assert.match(spec, /getByLabel\("검토 결정"\)\.selectOption\("approved"\)/);
  assert.match(spec, /getByRole\("region", \{ name: "승인 기록" \}\)/);
  assert.match(spec, /real IFC element and camera/);
  assert.match(spec, /\/notifications/);
  assert.match(spec, /2099-12-31/);
  assert.match(spec, /revisedPdfFileId/);
  assert.match(spec, /revisedIfcFileId/);
  assert.match(spec, /개정 도면 재검토 1건/);
  assert.match(spec, /viewer is read-only and non-member cannot enter/);
  assert.match(spec, /390px mobile/);
  assert.match(spec, /toBeVisible\(\{\s*timeout: 15_000,?\s*\}\)/);
  assert.match(spec, /status\(\)\)\.toBe\(404\)/);
});

test("drawing fixture provisions organization members before assigning RPC-only project roles", async () => {
  const fixture = await read("e2e/utils/drawing-collaboration-fixture.ts");

  assert.doesNotMatch(
    fixture,
    /ownerAuth\s*\.from\("lukas_qto_project_members"\)\s*\.insert\(/,
    "project membership must not bypass the audited authority RPC",
  );
  assert.match(
    fixture,
    /admin\s*\.from\("lukas_qto_organization_members"\)\s*\.insert\(/,
    "trusted fixture setup must establish organization membership",
  );
  assert.match(
    fixture,
    /ownerAuth\.rpc\(\s*"lukas_qto_set_project_member",\s*\{[\s\S]*?p_organization_id:[\s\S]*?p_project_id:[\s\S]*?p_email:[\s\S]*?p_role:[\s\S]*?p_request_id:\s*randomUUID\(\)/,
    "project roles must use owner-authenticated requests with unique IDs",
  );
  assert.match(fixture, /user:\s*approver,\s*role:\s*"approver"/);
});

test("production drawing E2E has one deterministic npm entrypoint", async () => {
  const packageJson = JSON.parse(await read("package.json"));

  assert.equal(
    packageJson.scripts["test:e2e:drawing:production"],
    "playwright test e2e/drawing-collaboration.spec.ts --project=chromium",
  );
});
