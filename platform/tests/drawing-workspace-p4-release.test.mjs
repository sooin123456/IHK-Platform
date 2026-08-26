import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (file) => readFile(path.join(root, file), "utf8");

test("P4 release fixture is an exact deterministic 10,000-object semantic mix", async () => {
  const { buildDrawingP4PerformanceFixture } =
    await import("../e2e/utils/drawing-p4-release-fixture.ts");
  const layerId = "10000000-0000-4000-8000-000000000001";
  const first = buildDrawingP4PerformanceFixture(10_000, layerId);
  const second = buildDrawingP4PerformanceFixture(10_000, layerId);

  assert.deepEqual(second, first);
  assert.equal(first.objects.length, 10_000);
  assert.equal(new Set(first.objects.map(({ id }) => id)).size, 10_000);
  assert.deepEqual(first.composition, {
    wall: 2_000,
    opening: 2_000,
    space: 1_500,
    area: 1_500,
    grid: 1_500,
    arc: 1_500,
  });
  assert.equal(first.objects[2_000].geometry.type, "opening");
  assert.equal(first.objects[2_000].geometry.hostWallId, first.objects[0].id);
  assert.equal(first.selectionTarget.id, first.objects[0].id);
  assert.throws(
    () => buildDrawingP4PerformanceFixture(9_999, layerId),
    /exactly 10,000/,
  );
});

test("P4 hosted fixture carries the exact semantic graph without client measurements", async () => {
  const { buildDrawingP4ProductionObjects } =
    await import("../e2e/utils/drawing-p4-release-fixture.ts");
  const layerId = "10000000-0000-4000-8000-000000000001";
  let next = 0;
  const objects = buildDrawingP4ProductionObjects(
    layerId,
    () => `50000000-0000-4000-8000-${String(++next).padStart(12, "0")}`,
  );
  assert.deepEqual(
    objects.map(({ geometry }) => geometry.type),
    ["wall", "opening", "space", "area", "grid", "arc"],
  );
  assert.equal(objects[1].geometry.hostWallId, objects[0].id);
  assert.equal(JSON.stringify(objects).includes("measurement"), false);
});

test("P4 local release runner fails on the first red gate and preserves statuses", async () => {
  const { P4_LOCAL_RELEASE_GATES, runReleaseGates } =
    await import("../scripts/run-drawing-workspace-p4-release.mjs");
  const labels = P4_LOCAL_RELEASE_GATES.map(({ label }) => label);
  for (const label of [
    "whole Node suite",
    "Drawing Workspace suite",
    "collaboration service suite",
    "P4 Chromium functional and IndexedDB",
    "P4 production-build performance",
    "IFC geometry smoke",
    "application typecheck",
    "collaboration typecheck",
    "application build",
    "collaboration build",
    "license closure",
    "application audit",
    "collaboration audit",
    "diff check",
  ])
    assert.ok(labels.includes(label), label);

  const visited = [];
  await assert.rejects(
    runReleaseGates(
      [
        { label: "green", command: ["green"] },
        { label: "red", command: ["red"] },
        { label: "must not run", command: ["later"] },
      ],
      async ({ label }) => {
        visited.push(label);
        return label === "red" ? 7 : 0;
      },
    ),
    /red.*exit 7/is,
  );
  assert.deepEqual(visited, ["green", "red"]);
});

test("P4 package exposes separate fail-closed local and production commands", async () => {
  const packageJson = JSON.parse(await read("package.json"));
  assert.equal(
    packageJson.scripts["release:drawing-workspace-p4:local"],
    "node scripts/run-drawing-workspace-p4-release.mjs local",
  );
  assert.equal(
    packageJson.scripts["release:drawing-workspace-p4:production"],
    "node scripts/run-drawing-workspace-p4-release.mjs production",
  );
  assert.equal(
    packageJson.scripts["test:e2e:drawing-workspace-p4:local"],
    "npx playwright test e2e/drawing-workspace-p4.spec.ts e2e/drawing-yjs-indexeddb.spec.ts --project=chromium --workers=1",
  );
  assert.equal(
    packageJson.scripts["test:e2e:drawing-workspace-p4:performance"],
    "P4_RELEASE_PRODUCTION_BUILD=1 npx playwright test e2e/drawing-workspace-p4-release.spec.ts --config=playwright.p4-release.config.ts --project=chromium --workers=1",
  );
  assert.equal(
    packageJson.scripts["test:e2e:drawing-workspace-p4:production"],
    "npx playwright test e2e/drawing-workspace-p4-production.spec.ts --project=chromium --workers=1",
  );
});

test("P4 production-build browser gate owns a dedicated non-development port", async () => {
  const config = await read("playwright.p4-release.config.ts");
  assert.match(config, /process\.env\.PORT \|\| 4174/);
  assert.doesNotMatch(config, /process\.env\.PORT \|\| 4000/);
  assert.match(config, /reuseExistingServer: false/);
  assert.match(config, /PORT: String\(port\)/);
  assert.match(config, /SUPABASE_URL: "http:\/\/127\.0\.0\.1:54321"/);
  assert.match(config, /SUPABASE_ANON_KEY: "p4-local-browser-gate"/);
});

test("P4 production command exits UNEXECUTED before Playwright without authorities", () => {
  const result = spawnSync(
    "npm",
    ["run", "release:drawing-workspace-p4:production"],
    {
      cwd: root,
      encoding: "utf8",
      env: { PATH: process.env.PATH },
      timeout: 15_000,
    },
  );
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  assert.notEqual(result.status, 0);
  assert.equal(result.signal, null, output);
  assert.match(output, /P4 production gate is UNEXECUTED/);
  assert.doesNotMatch(
    output,
    /Running \d+ tests|Local:\s+http|react-router dev/,
  );
});

test("P4 durable source evidence is byte-exact", async () => {
  const sources = [
    {
      file: "../.superpowers/sdd/2026-08-25-drawing-workspace-p2/task-10-artifacts/representative-drawing.pdf",
      bytes: 62_602,
      sha256:
        "4dbe58c133a1ce84e1b4da4fce93694ec4f69585bed20e71408a86b7f704e326",
    },
    {
      file: "../samples/sample.ifc",
      bytes: 222,
      sha256:
        "30c157d118a3be377cd592d520e163ff9249781fb002c4c81be64240672c8b93",
    },
  ];
  for (const source of sources) {
    const bytes = await readFile(path.resolve(root, source.file));
    assert.equal(bytes.length, source.bytes);
    assert.equal(
      createHash("sha256").update(bytes).digest("hex"),
      source.sha256,
    );
  }
});

test("P4 evidence and status records keep measured local and production truth distinct", async () => {
  const [report, deployment, matrix, field, state] = await Promise.all([
    read(
      "../docs/superpowers/reports/2026-08-26-drawing-workspace-p4-release.md",
    ),
    read("DEPLOYMENT.md"),
    read("../docs/P0_P5_IMPLEMENTATION_MATRIX.md"),
    read("../docs/DRAWING_COLLABORATION_FIELD_CHECK.md"),
    read("../docs/PROJECT_STATE.md"),
  ]);
  let cursor = -1;
  for (const heading of [
    "## IMPLEMENTED",
    "## LOCAL PASS",
    "## LOCAL ENV UNEXECUTED",
    "## PRODUCTION UNEXECUTED",
    "## MEASURED",
  ]) {
    const next = report.indexOf(heading);
    assert.ok(next > cursor, `${heading} must be present in order`);
    cursor = next;
  }
  assert.match(report, /10,000.*mixed semantic objects/is);
  assert.match(report, /first usable.*2\.5 s/is);
  assert.match(report, /warm.*at least 30/is);
  assert.match(report, /production.*p95.*500 ms.*UNEXECUTED/is);
  assert.match(report, /provider-authoritative.*UNEXECUTED/is);
  assert.match(report, /PDF.*4dbe58c1/is);
  assert.match(report, /IFC.*30c157d1/is);
  assert.doesNotMatch(
    report,
    /P4 (?:production|operational) (?:PASS|complete)/i,
  );

  for (const source of [deployment, matrix, field, state]) {
    assert.match(source, /P4.*local/is);
    assert.match(source, /P4.*production.*(?:UNEXECUTED|미실행)/is);
    assert.match(source, /provider.*p95.*500 ms/is);
  }
  assert.match(deployment, /web.*single-replica collaboration.*deploy/is);
  assert.match(
    deployment,
    /rollback.*previous compatible.*web.*collaboration/is,
  );
});
