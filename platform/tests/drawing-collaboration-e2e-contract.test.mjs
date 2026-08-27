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

  for (const role of ["owner", "reviewer", "viewer", "nonMember"])
    assert.match(fixture, new RegExp(`\\b${role}\\b`));
  assert.match(fixture, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(fixture, /value === "\[SENSITIVE\]"/);
  assert.match(fixture, /IFC_SHA256/);
  assert.match(fixture, /destroyDrawingFixture/);
  assert.match(fixture, /deleteUser/);
  assert.match(fixture, /storage\.from\("lukas-qto"\)\.remove/);

  assert.match(
    spec,
    /maker requests review and a separate reviewer approves it in realtime/,
  );
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

test("production drawing E2E has one deterministic npm entrypoint", async () => {
  const packageJson = JSON.parse(await read("package.json"));

  assert.equal(
    packageJson.scripts["test:e2e:drawing:production"],
    "playwright test e2e/drawing-collaboration.spec.ts --project=chromium",
  );
});
