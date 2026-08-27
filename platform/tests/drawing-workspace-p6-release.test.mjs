import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  P6_LOCAL_RELEASE_GATES,
  assertExactP6LocalGateManifest,
  requireP6ProductionAuthorities,
  runP6ReleaseGates,
} from "../scripts/run-drawing-workspace-p6-release.mjs";
import {
  deriveDrawingP6GateStatus,
  validateDrawingP6PerformanceEvidence,
} from "../scripts/drawing-p6-performance-evidence.mjs";
import { validateDrawingP6ReleaseEvidence } from "../scripts/drawing-p6-release-evidence.mjs";

const ids = {
  projectId: "00000000-0000-4000-8000-000000000001",
  drawingRevisionId: "00000000-0000-4000-8000-000000000002",
  boqVersionId: "00000000-0000-4000-8000-000000000003",
  materialPlanId: "00000000-0000-4000-8000-000000000004",
};

const productionEnvironment = {
  P6_E2E_BASE_URL: "https://drawing.onehk.kr",
  P6_E2E_SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co",
  P6_E2E_SUPABASE_ANON_KEY: "a".repeat(40),
  P6_E2E_SUPABASE_SERVICE_ROLE_KEY: "b".repeat(40),
  P6_E2E_POSTGRES_URL:
    "postgresql://admin:secret@db.onehk.kr:5432/postgres?sslmode=require",
  P6_E2E_STORAGE_CORS_ORIGIN: "https://drawing.onehk.kr",
  P6_E2E_DEPLOYMENT_ID: "dpl_20260828_p6",
  P6_E2E_COMMIT: "1".repeat(40),
  P6_E2E_BACKUP_ID: "backup-20260828-p6",
  P6_E2E_MAKER_EMAIL: "maker@example.com",
  P6_E2E_APPROVER_EMAIL: "approver@example.com",
  P6_E2E_ATTACKER_EMAIL: "attacker@example.net",
  P6_E2E_PROJECT_ID: ids.projectId,
  P6_E2E_DRAWING_REVISION_ID: ids.drawingRevisionId,
  P6_E2E_BOQ_VERSION_ID: ids.boqVersionId,
  P6_E2E_MATERIAL_PLAN_ID: ids.materialPlanId,
};

function sanitizedEnvironment(extra = {}) {
  return {
    PATH: process.env.PATH ?? "",
    HOME: process.env.HOME ?? "",
    ...extra,
  };
}

function performanceEvidence(overrides = {}) {
  const hashes = Array.from({ length: 100 }, () => "a".repeat(64));
  return {
    schemaVersion: 1,
    authority: "LOCAL_REAL_POSTGRES_PRODUCTION_BUILD_CHROMIUM",
    commit: "1".repeat(40),
    generatedAt: "2026-08-28T00:00:00.000Z",
    runtime: {
      node: "22.18.0",
      browser: "Chromium 140.0.7339.16",
      postgres: "17.6",
      machine: "test-machine",
      region: "local",
    },
    workload: { objects: 10_000, boqMappings: 10_000, sourceLinks: 2_000 },
    operations: {
      sourcePage: { coldMs: 45, warmMs: 12, cpuMs: 8, rows: 200, bytes: 32_000, plan: "Index Scan" },
      calculationManifest: { coldMs: 300, warmMs: 140, cpuMs: 120, rows: 10_000, bytes: 800_000, plan: "Index Scan" },
      comparison: { coldMs: 240, warmMs: 120, cpuMs: 100, rows: 10_000, bytes: 700_000, plan: "Index Scan" },
      exports: { coldMs: 350, warmMs: 180, cpuMs: 150, rows: 10_000, bytes: 1_200_000, plan: "Index Scan" },
      objectToBoq: { coldMs: 38, warmMs: 10, cpuMs: 7, rows: 200, bytes: 28_000, plan: "Index Scan" },
      materialLineage: { coldMs: 42, warmMs: 11, cpuMs: 8, rows: 200, bytes: 30_000, plan: "Index Scan" },
    },
    metrics: {
      calculationManifestP95Ms: 150,
      comparisonP95Ms: 130,
      lineageP95Ms: 15,
      peakRssMiB: 220,
      repeatedRuns: 100,
    },
    repeatedHashes: {
      calculationManifest: hashes,
      comparison: hashes,
      csv: hashes,
      xlsx: hashes,
      manifest: hashes,
    },
    sourceHashes: {
      before: ["b".repeat(64), "c".repeat(64)],
      after: ["b".repeat(64), "c".repeat(64)],
    },
    status: "PASS",
    ...overrides,
  };
}

test("P6 notice closes fflate without adding a second package or lock entry", async () => {
  const [notice, packageJson, lock] = await Promise.all([
    readFile(new URL("../THIRD_PARTY_NOTICES.md", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8").then(JSON.parse),
    readFile(new URL("../package-lock.json", import.meta.url), "utf8").then(JSON.parse),
  ]);
  assert.match(
    notice,
    /\| fflate\s+\| 0\.8\.3\s+\| https:\/\/github\.com\/101arrowz\/fflate\s+\| MIT\s+\| No\s+\| npm\s+\| Formula-free Verified BOQ XLSX ZIP generation\s+\|/,
  );
  assert.equal(packageJson.dependencies.fflate, "^0.8.3");
  assert.equal(lock.packages["node_modules/fflate"].version, "0.8.3");
});

test("P6 production authority fails closed until every hosted authority is exact", () => {
  assert.throws(
    () => requireP6ProductionAuthorities({}),
    /P6 production gate is UNEXECUTED/,
  );
  for (const name of Object.keys(productionEnvironment)) {
    const environment = { ...productionEnvironment };
    delete environment[name];
    assert.throws(
      () => requireP6ProductionAuthorities(environment),
      new RegExp(`UNEXECUTED.*${name}`),
    );
  }
  assert.deepEqual(requireP6ProductionAuthorities(productionEnvironment), {
    baseUrl: new URL(productionEnvironment.P6_E2E_BASE_URL),
    supabaseUrl: new URL(productionEnvironment.P6_E2E_SUPABASE_URL),
    postgresUrl: productionEnvironment.P6_E2E_POSTGRES_URL,
    storageCorsOrigin: productionEnvironment.P6_E2E_STORAGE_CORS_ORIGIN,
    deploymentId: productionEnvironment.P6_E2E_DEPLOYMENT_ID,
    commit: productionEnvironment.P6_E2E_COMMIT,
    backupId: productionEnvironment.P6_E2E_BACKUP_ID,
    makerEmail: productionEnvironment.P6_E2E_MAKER_EMAIL,
    approverEmail: productionEnvironment.P6_E2E_APPROVER_EMAIL,
    attackerEmail: productionEnvironment.P6_E2E_ATTACKER_EMAIL,
    ...ids,
  });
});

test("production authority command exits nonzero UNEXECUTED before Playwright", () => {
  const run = spawnSync(
    process.execPath,
    ["scripts/run-drawing-workspace-p6-release.mjs", "production"],
    { cwd: new URL("..", import.meta.url), env: sanitizedEnvironment(), encoding: "utf8" },
  );
  assert.notEqual(run.status, 0);
  assert.match(`${run.stdout}\n${run.stderr}`, /P6 production gate is UNEXECUTED/);
});

test("P6 local manifest is ordered, complete, and fail-fast", async () => {
  assert.doesNotThrow(() => assertExactP6LocalGateManifest(P6_LOCAL_RELEASE_GATES));
  assert.deepEqual(P6_LOCAL_RELEASE_GATES[0], {
    label: "P0-P5 complete local release regression",
    argv: ["npm", "run", "release:drawing-workspace-p5:local"],
  });
  assert.deepEqual(P6_LOCAL_RELEASE_GATES.at(-1), {
    label: "diff check",
    argv: ["git", "--no-pager", "diff", "--check"],
  });
  assert.ok(P6_LOCAL_RELEASE_GATES.some(({ argv }) => argv.includes("P6_REAL_POSTGRES_REQUIRED=1")));
  const visited = [];
  await assert.rejects(
    runP6ReleaseGates(
      [{ label: "one", argv: ["one"] }, { label: "two", argv: ["two"] }, { label: "never", argv: ["never"] }],
      { phase: "LOCAL", runner: async ({ label }) => (visited.push(label), label === "two" ? 9 : 0), log() {} },
    ),
    /two failed with exit 9/,
  );
  assert.deepEqual(visited, ["one", "two"]);
});

test("P6 performance authority rejects undersized, unbounded, scanning, nondeterministic, and threshold-missed evidence", () => {
  const valid = performanceEvidence();
  assert.deepEqual(validateDrawingP6PerformanceEvidence(valid, "1".repeat(40)), valid);
  assert.equal(deriveDrawingP6GateStatus(valid), "PASS");
  for (const invalid of [
    performanceEvidence({ workload: { objects: 9_999, boqMappings: 10_000, sourceLinks: 2_000 } }),
    performanceEvidence({ operations: { ...valid.operations, sourcePage: { ...valid.operations.sourcePage, rows: 201 } } }),
    performanceEvidence({ operations: { ...valid.operations, objectToBoq: { ...valid.operations.objectToBoq, plan: "Seq Scan" } } }),
    performanceEvidence({ repeatedHashes: { ...valid.repeatedHashes, csv: [...valid.repeatedHashes.csv.slice(0, 99), "d".repeat(64)] } }),
    performanceEvidence({ metrics: { ...valid.metrics, calculationManifestP95Ms: 501 }, status: "NOT MET" }),
  ]) assert.throws(() => validateDrawingP6PerformanceEvidence(invalid, "1".repeat(40)));
  assert.equal(
    deriveDrawingP6GateStatus(performanceEvidence({ metrics: { ...valid.metrics, calculationManifestP95Ms: 501 }, status: "NOT MET" })),
    "NOT MET",
  );
});

test("P6 release evidence is commit-bound and keeps missing production authorities UNEXECUTED", () => {
  const evidence = {
    schemaVersion: 1,
    phase: "local",
    commit: "1".repeat(40),
    migrationIds: ["20260827210000"],
    generatedAt: "2026-08-28T00:00:00.000Z",
    authorities: { realPostgres: "PASS", browser: "PASS", production: "UNEXECUTED" },
    hashes: { result: "a".repeat(64), manifest: "b".repeat(64), sourceBefore: "c".repeat(64), sourceAfter: "c".repeat(64) },
    metrics: { calculationManifestP95Ms: 150, comparisonP95Ms: 130, lineageP95Ms: 15, peakRssMiB: 220, repeatedRuns: 100 },
    gates: { local: "PASS", production: "UNEXECUTED" },
  };
  assert.deepEqual(validateDrawingP6ReleaseEvidence(evidence, "1".repeat(40)), evidence);
  assert.throws(() => validateDrawingP6ReleaseEvidence({ ...evidence, commit: "2".repeat(40) }, "1".repeat(40)), /commit/);
  assert.throws(() => validateDrawingP6ReleaseEvidence({ ...evidence, gates: { local: "PASS", production: "PASS" } }, "1".repeat(40)), /production authority/);
});

test("P6 package commands use installed Playwright and exact release entrypoints", async () => {
  const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(packageJson.scripts["test:e2e:drawing-workspace-p6:local"], "P6_RELEASE_PRODUCTION_BUILD=1 playwright test e2e/drawing-workspace-p6.spec.ts --config=playwright.p6-release.config.ts --project=chromium --workers=1");
  assert.equal(packageJson.scripts["test:e2e:drawing-workspace-p6:production"], "playwright test e2e/drawing-workspace-p6-production.spec.ts --project=chromium --workers=1");
  assert.equal(packageJson.scripts["release:drawing-workspace-p6:local"], "node scripts/run-drawing-workspace-p6-release.mjs local");
  assert.equal(packageJson.scripts["release:drawing-workspace-p6:production"], "node scripts/run-drawing-workspace-p6-release.mjs production");
  assert.equal(Object.values(packageJson.scripts).some((value) => /\bnpx\b|\bpnpm\b/.test(value)), false);
});
