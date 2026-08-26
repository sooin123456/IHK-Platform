import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import net from "node:net";
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

test("P4 local release manifest is complete ordered structured argv and fail-fast", async () => {
  const {
    P4_LOCAL_RELEASE_GATES,
    assertExactP4LocalGateManifest,
    runReleaseGates,
  } = await import("../scripts/run-drawing-workspace-p4-release.mjs");
  const wholeNodeFiles = (await readdir(path.join(root, "tests")))
    .filter((file) => file.endsWith(".test.mjs"))
    .sort()
    .map((file) => `tests/${file}`);
  const expected = [
    { label: "whole Node suite", argv: ["node", "--test", ...wholeNodeFiles] },
    {
      label: "Drawing Workspace suite",
      argv: ["npm", "run", "test:drawing-workspace"],
    },
    {
      label: "collaboration service suite",
      argv: ["node", "--test", "tests/drawing-collaboration-service.test.mjs"],
    },
    { label: "IFC geometry smoke", argv: ["npm", "run", "test:ifc"] },
    {
      label: "IFC/PDF/quantity/approval/Revit regressions",
      argv: [
        "node",
        "--test",
        "tests/drawing-collaboration.test.mjs",
        "tests/drawing-approvals.test.mjs",
        "tests/drawing-workspace-export.test.mjs",
        "tests/verified-boq.test.mjs",
        "tests/element-ledger-suggestions.test.mjs",
        "tests/public-site-contract.test.mjs",
      ],
    },
    { label: "application typecheck", argv: ["npm", "run", "typecheck"] },
    {
      label: "collaboration typecheck",
      argv: ["npm", "run", "typecheck:collaboration"],
    },
    { label: "application build", argv: ["npm", "run", "build"] },
    {
      label: "collaboration build",
      argv: ["npm", "run", "build:collaboration"],
    },
    {
      label: "P4 Chromium functional and IndexedDB",
      argv: ["npm", "run", "test:e2e:drawing-workspace-p4:local"],
    },
    {
      label: "P4 production-build performance",
      argv: ["npm", "run", "test:e2e:drawing-workspace-p4:performance"],
    },
    {
      label: "P4 performance evidence",
      argv: ["node", "scripts/drawing-p4-performance-evidence.mjs", "validate"],
    },
    {
      label: "license closure",
      argv: ["node", "--test", "tests/drawing-workspace-license.test.mjs"],
    },
    {
      label: "application audit",
      argv: ["npm", "audit", "--omit=dev", "--audit-level=high"],
    },
    {
      label: "collaboration audit",
      argv: [
        "npm",
        "--prefix",
        "collaboration",
        "audit",
        "--omit=dev",
        "--audit-level=high",
      ],
    },
    { label: "diff check", argv: ["git", "diff", "--check"] },
  ];
  assert.deepEqual(P4_LOCAL_RELEASE_GATES, expected);
  assert.doesNotThrow(() => assertExactP4LocalGateManifest(expected));
  for (let index = 0; index < expected.length; index += 1) {
    assert.throws(() =>
      assertExactP4LocalGateManifest(expected.toSpliced(index, 1)),
    );
    assert.throws(() =>
      assertExactP4LocalGateManifest(
        expected.with(index, { ...expected[index], argv: ["true"] }),
      ),
    );
  }

  const visited = [];
  const logs = [];
  await assert.rejects(
    runReleaseGates(
      [
        { label: "green", argv: ["green"] },
        { label: "red", argv: ["red"] },
        { label: "must not run", argv: ["later"] },
      ],
      {
        phase: "PRODUCTION",
        log: (message) => logs.push(message),
        runner: async ({ label }) => {
          visited.push(label);
          return label === "red" ? 7 : 0;
        },
      },
    ),
    /red.*exit 7/is,
  );
  assert.deepEqual(visited, ["green", "red"]);
  assert.deepEqual(logs, ["P4 PRODUCTION green\n", "P4 PRODUCTION red\n"]);
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
    "node scripts/run-drawing-p4-functional.mjs",
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

test("P4 functional browser authority ignores inherited targets and rejects mutations", async () => {
  const {
    P4_FUNCTIONAL_BASE_URL,
    P4_FUNCTIONAL_PORT,
    assertP4FunctionalBrowserAuthority,
    p4FunctionalBrowserAuthority,
  } = await import("../scripts/drawing-p4-browser-authority.mjs");
  const inherited = {
    E2E_BASE_URL: "https://stale.example.test",
    PORT: "4999",
    SUPABASE_URL: "https://external.supabase.co",
    SUPABASE_ANON_KEY: "external-key",
    VITE_SUPABASE_URL: "https://external.supabase.co",
    VITE_SUPABASE_ANON_KEY: "external-vite-key",
    PATH: process.env.PATH,
  };
  const authority = p4FunctionalBrowserAuthority(inherited);
  assert.equal(P4_FUNCTIONAL_PORT, 4173);
  assert.equal(P4_FUNCTIONAL_BASE_URL, "http://127.0.0.1:4173");
  assert.equal(authority.baseURL, P4_FUNCTIONAL_BASE_URL);
  assert.equal("E2E_BASE_URL" in authority.environment, false);
  assert.deepEqual(
    {
      PORT: authority.environment.PORT,
      SUPABASE_URL: authority.environment.SUPABASE_URL,
      SUPABASE_ANON_KEY: authority.environment.SUPABASE_ANON_KEY,
      VITE_SUPABASE_URL: authority.environment.VITE_SUPABASE_URL,
      VITE_SUPABASE_ANON_KEY: authority.environment.VITE_SUPABASE_ANON_KEY,
    },
    {
      PORT: "4173",
      SUPABASE_URL: "http://127.0.0.1:54321",
      SUPABASE_ANON_KEY: "p4-local-browser-gate",
      VITE_SUPABASE_URL: "http://127.0.0.1:54321",
      VITE_SUPABASE_ANON_KEY: "p4-local-browser-gate",
    },
  );
  assert.doesNotThrow(() => assertP4FunctionalBrowserAuthority(authority));
  for (const mutation of [
    { ...authority, baseURL: "https://stale.example.test" },
    { ...authority, port: 4999 },
    { ...authority, reuseExistingServer: true },
    {
      ...authority,
      environment: {
        ...authority.environment,
        E2E_BASE_URL: inherited.E2E_BASE_URL,
      },
    },
    {
      ...authority,
      environment: { ...authority.environment, PORT: inherited.PORT },
    },
  ])
    assert.throws(() => assertP4FunctionalBrowserAuthority(mutation));

  const { assertP4FunctionalPortAvailable } =
    await import("../scripts/run-drawing-p4-functional.mjs");
  const occupied = net.createServer();
  await new Promise((resolve, reject) => {
    occupied.once("error", reject);
    occupied.listen(P4_FUNCTIONAL_PORT, "127.0.0.1", resolve);
  });
  try {
    await assert.rejects(() => assertP4FunctionalPortAvailable());
  } finally {
    await new Promise((resolve) => occupied.close(resolve));
  }

  const config = await read("playwright.p4-functional.config.ts");
  assert.match(config, /reuseExistingServer: authority\.reuseExistingServer/);
  assert.match(config, /--port \$\{authority\.port\} --host 127\.0\.0\.1/);
});

test("P4 production preflight requires every exact P3 authority and distinct secrets", async () => {
  const { requireP4ProductionAuthorities } =
    await import("../scripts/run-drawing-workspace-p4-release.mjs");
  const ready = {
    E2E_BASE_URL: "https://drawing-preview.acme.kr",
    SUPABASE_URL: "https://abcdefghijklmnop.supabase.co",
    SUPABASE_ANON_KEY: `sb_publishable_${"a".repeat(32)}`,
    SUPABASE_SERVICE_ROLE_KEY: `sb_secret_${"b".repeat(32)}`,
    VITE_DRAWING_COLLABORATION_URL: "wss://drawing-collab.acme.kr",
    COLLABORATION_INTERNAL_URL: "https://drawing-collab-internal.acme.kr",
    COLLABORATION_INTERNAL_SECRET: "c".repeat(32),
    COLLABORATION_FREEZE_SECRET: "d".repeat(32),
    P3_E2E_DATABASE_ADMIN_URL:
      "postgresql://p3_admin:secret@db.acme.kr:5432/postgres?sslmode=require",
    P3_E2E_RUN_ID: "release-20260827-001",
  };
  assert.deepEqual(requireP4ProductionAuthorities(ready), ready);
  for (const name of Object.keys(ready))
    assert.throws(() =>
      requireP4ProductionAuthorities({ ...ready, [name]: "" }),
    );
  assert.throws(() =>
    requireP4ProductionAuthorities({
      ...ready,
      COLLABORATION_INTERNAL_SECRET: ready.COLLABORATION_FREEZE_SECRET,
    }),
  );
});

test("P4 generated performance evidence is commit-bound and mutation-resistant", async () => {
  const { drawingP4SourceCommitSha, validateDrawingP4PerformanceEvidence } =
    await import("../scripts/drawing-p4-performance-evidence.mjs");
  const expectedSourceSha = execFileSync(
    "git",
    [
      "log",
      "-1",
      "--format=%H",
      "--",
      "app",
      "e2e",
      "package.json",
      "playwright.config.ts",
      "playwright.p4-release.config.ts",
      "playwright.p4-functional.config.ts",
      "scripts",
      "tests",
    ],
    { encoding: "utf8" },
  ).trim();
  assert.equal(drawingP4SourceCommitSha(), expectedSourceSha);
  const sha = "a".repeat(40);
  const valid = {
    schemaVersion: 1,
    status: "MEASURED",
    authority: "LOCAL_PRODUCTION_BUILD_CHROMIUM",
    sourceCommitSha: sha,
    browserName: "chromium",
    browserVersion: "151.0.7922.34",
    userAgent: "Chrome",
    viewport: { width: 1440, height: 900 },
    cpu: { model: "Apple M3 Max", logicalCount: 14 },
    memory: { totalBytes: 38_654_705_664, freeBytesAtMeasurement: 1 },
    objectMix: {
      wall: 2_000,
      opening: 2_000,
      space: 1_500,
      area: 1_500,
      grid: 1_500,
      arc: 1_500,
    },
    conditions: {
      firstUsable:
        "cold 10,000-object document navigation after warming application assets",
      frames: "warm after two zoom gestures and one pan gesture",
    },
    firstUsableMs: 5_000,
    firstUsableTargetMs: 2_500,
    firstUsableTargetMet: false,
    warmSamples: { zoom: 30, pan: 31, selection: 30 },
    p95Ms: { zoom: 0.2, pan: 0.3, selection: 73 },
    p7SixtyFpsGate: "UNEXECUTED",
    productionProviderP95: "UNEXECUTED",
  };
  assert.deepEqual(validateDrawingP4PerformanceEvidence(valid, sha), valid);
  const mutations = [
    { ...valid, sourceCommitSha: "b".repeat(40) },
    { ...valid, objectMix: { ...valid.objectMix, opening: 1_999 } },
    { ...valid, warmSamples: { ...valid.warmSamples, zoom: 29 } },
    { ...valid, firstUsableTargetMet: true },
    { ...valid, p7SixtyFpsGate: "PASS" },
    { ...valid, productionProviderP95: 400 },
  ];
  for (const mutation of mutations)
    assert.throws(() => validateDrawingP4PerformanceEvidence(mutation, sha));
});

test("P4 hosted server evidence rejects absent stale and erroneous authority", async () => {
  const {
    assertDrawingP4HostedServerEvidence,
    buildDrawingP4ProductionObjects,
  } = await import("../e2e/utils/drawing-p4-release-fixture.ts");
  const {
    deriveDrawingServerMeasurementEvidence,
    drawingMeasurementEvidenceCurrent,
  } = await import("../app/lukas/lib/drawing-semantic-schedules.ts");
  let next = 0;
  const objects = buildDrawingP4ProductionObjects(
    "10000000-0000-4000-8000-000000000001",
    () => `50000000-0000-4000-8000-${String(++next).padStart(12, "0")}`,
  );
  const lineage = {
    documentId: "20000000-0000-4000-8000-000000000001",
    revisionId: "30000000-0000-4000-8000-000000000001",
    revisionVersion: 1,
    snapshotSha256: "c".repeat(64),
    operationCheckpoint: 17,
  };
  const state = {
    revisionId: lineage.revisionId,
    objects: Object.fromEntries(objects.map((object) => [object.id, object])),
  };
  const evidence = deriveDrawingServerMeasurementEvidence({
    ...lineage,
    state,
  });
  const current = drawingMeasurementEvidenceCurrent(lineage, state, false);
  const input = { evidence, evidenceError: null, current, objects };
  assert.doesNotThrow(() => assertDrawingP4HostedServerEvidence(input));
  for (const mutation of [
    { ...input, evidence: null },
    { ...input, current: { ...current, hasUnconfirmedChanges: true } },
    {
      ...input,
      current: {
        ...current,
        objectLineage: current.objectLineage.map((item, index) =>
          index ? item : { ...item, objectVersion: item.objectVersion + 1 },
        ),
      },
    },
    {
      ...input,
      current: { ...current, operationCheckpoint: 18 },
    },
    {
      ...input,
      evidence: null,
      evidenceError: {
        code: "measurement_derivation_failed",
        message: "서버 측정 증거를 계산하지 못했습니다.",
      },
    },
  ])
    assert.throws(() => assertDrawingP4HostedServerEvidence(mutation));
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
