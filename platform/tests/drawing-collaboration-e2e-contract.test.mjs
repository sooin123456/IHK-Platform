import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (file) => readFile(path.join(root, file), "utf8");

test("drawing collaboration E2E covers roles, realtime, mobile, and cleanup", async () => {
  const config = await read("playwright.config.ts");
  const spec = await read("e2e/drawing-collaboration.spec.ts");
  const fixture = await read(
    "e2e/utils/drawing-collaboration-fixture.ts",
  );

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

  assert.match(spec, /PDF issue and reviewer closes it in realtime/);
  assert.match(spec, /viewer is read-only and non-member cannot enter/);
  assert.match(spec, /390px mobile/);
  assert.match(spec, /toBeVisible\(\{\s*timeout: 15_000,?\s*\}\)/);
  assert.match(spec, /status\(\)\)\.toBe\(404\)/);
});
