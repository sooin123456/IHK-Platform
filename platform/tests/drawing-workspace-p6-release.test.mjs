import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  P6_LOCAL_RELEASE_GATES,
  assertExactP6LocalGateManifest,
  requireP6ProductionAuthorities,
  runP6ReleaseGates,
} from "../scripts/run-drawing-workspace-p6-release.mjs";
import {
  assertDrawingP6LocalPureWorkloadPass,
  assertDrawingP6PerformancePass,
  buildDrawingP6LocalWorkload,
  deriveDrawingP6GateStatus,
  measureDrawingP6LocalPureWorkload,
  validateDrawingP6PerformanceEvidence,
} from "../scripts/drawing-p6-performance-evidence.mjs";
import {
  P6_RELEASE_RELEVANT_PATHS,
  assertDrawingP6RelevantTreeClean,
  assertDrawingP6ReleasePass,
  buildDrawingP6UnexecutedReleaseEvidence,
  validateDrawingP6ReleaseEvidence,
} from "../scripts/drawing-p6-release-evidence.mjs";

const ids = {
  projectId: "00000000-0000-4000-8000-000000000001",
  drawingRevisionId: "00000000-0000-4000-8000-000000000002",
  boqVersionId: "00000000-0000-4000-8000-000000000003",
  materialPlanId: "00000000-0000-4000-8000-000000000004",
};

const productionEnvironment = {
  E2E_BASE_URL: "https://drawing.onehk.kr",
  SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co",
  SUPABASE_ANON_KEY: "a".repeat(40),
  SUPABASE_SERVICE_ROLE_KEY: "b".repeat(40),
  VITE_DRAWING_COLLABORATION_URL: "wss://collaboration.onehk.kr",
  COLLABORATION_INTERNAL_URL: "https://collaboration.onehk.kr",
  COLLABORATION_INTERNAL_SECRET: "c".repeat(40),
  COLLABORATION_FREEZE_SECRET: "d".repeat(40),
  P3_E2E_DATABASE_ADMIN_URL:
    "postgresql://admin:secret@db.onehk.kr:5432/postgres",
  P3_E2E_RUN_ID: "p6-release-20260828",
  P5_E2E_STORAGE_CORS_ORIGIN: "https://drawing.onehk.kr",
  P6_E2E_BASE_URL: "https://drawing.onehk.kr",
  P6_E2E_SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co",
  P6_E2E_SUPABASE_ANON_KEY: "a".repeat(40),
  P6_E2E_SUPABASE_SERVICE_ROLE_KEY: "b".repeat(40),
  P6_E2E_POSTGRES_URL:
    "postgresql://admin:secret@db.onehk.kr:5432/postgres?sslmode=require",
  P6_E2E_FRESH_POSTGRES_URL:
    "postgresql://admin:secret@fresh-db.onehk.kr:5432/postgres?sslmode=require",
  P6_E2E_UPGRADE_POSTGRES_URL:
    "postgresql://admin:secret@upgrade-db.onehk.kr:5432/postgres?sslmode=require",
  P6_E2E_RESTORE_POSTGRES_URL:
    "postgresql://admin:secret@restore-db.onehk.kr:5432/postgres?sslmode=require",
  P6_E2E_MANAGEMENT_API_URL: "https://api.supabase.com",
  P6_E2E_MANAGEMENT_ACCESS_TOKEN: "sbp_" + "m".repeat(40),
  P6_E2E_PROJECT_REF: "abcdefghijklmnopqrst",
  P6_E2E_STORAGE_CORS_ORIGIN: "https://drawing.onehk.kr",
  P6_E2E_DEPLOYMENT_ID: "dpl_20260828_p6",
  P6_E2E_COMMIT: "1".repeat(40),
  P6_E2E_BACKUP_ID: "backup-20260828-p6",
  P6_E2E_RESTORE_OPERATION_ID: "restore_20260828_p6_authority",
  P6_E2E_RESTORE_RESULT_SHA256: "a".repeat(64),
  P6_E2E_RESTORE_MANIFEST_SHA256: "b".repeat(64),
  P6_E2E_REGION: "ap-northeast-2",
  P6_E2E_MAKER_EMAIL: "maker@example.com",
  P6_E2E_APPROVER_EMAIL: "approver@example.com",
  P6_E2E_ATTACKER_EMAIL: "attacker@example.net",
  P6_E2E_VIEWER_EMAIL: "viewer@example.com",
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
      resourceAuthority: "test cgroup and process sampler",
      resourceEvidenceSha256: "b".repeat(64),
    },
    workload: {
      drawingQuantityLinks: 10_000,
      allocationLinks: 10_000,
      boqLines: 2_000,
      legacyMappings: 200,
      approvedSnapshots: 1,
      priceBooks: 1,
      materialComponents: 2_000,
    },
    operations: {
      sourcePage: {
        coldMs: 45,
        warmMs: 12,
        cpuMs: 8,
        peakRssMiB: 200,
        rows: 200,
        bytes: 32_000,
        plan: "Index Scan",
      },
      calculationManifest: {
        coldMs: 300,
        warmMs: 140,
        cpuMs: 120,
        peakRssMiB: 220,
        rows: 10_000,
        bytes: 800_000,
        plan: "Index Scan",
      },
      comparison: {
        coldMs: 240,
        warmMs: 120,
        cpuMs: 100,
        peakRssMiB: 210,
        rows: 10_000,
        bytes: 700_000,
        plan: "Index Scan",
      },
      exports: {
        coldMs: 350,
        warmMs: 180,
        cpuMs: 150,
        peakRssMiB: 215,
        rows: 10_000,
        bytes: 1_200_000,
        plan: "Index Scan",
      },
      objectToBoq: {
        coldMs: 38,
        warmMs: 10,
        cpuMs: 7,
        peakRssMiB: 205,
        rows: 200,
        bytes: 28_000,
        plan: "Index Scan",
      },
      materialLineage: {
        coldMs: 42,
        warmMs: 11,
        cpuMs: 8,
        peakRssMiB: 200,
        rows: 200,
        bytes: 30_000,
        plan: "Index Scan",
      },
    },
    metrics: {
      calculationManifestP95Ms: 150,
      comparisonP95Ms: 130,
      lineageP95Ms: 15,
      peakRssMiB: 220,
      repeatedRuns: 100,
    },
    repeatedHashes: {
      result: hashes,
      calculationManifest: hashes,
      comparison: hashes,
      csv: hashes,
      xlsx: hashes,
      manifest: hashes,
      handoff: hashes,
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
    readFile(new URL("../package.json", import.meta.url), "utf8").then(
      JSON.parse,
    ),
    readFile(new URL("../package-lock.json", import.meta.url), "utf8").then(
      JSON.parse,
    ),
  ]);
  assert.match(
    notice,
    /\| fflate\s+\| 0\.8\.3\s+\| https:\/\/github\.com\/101arrowz\/fflate\s+\| MIT\s+\| No\s+\| npm\s+\| Formula-free Verified BOQ XLSX ZIP generation\s+\|/,
  );
  assert.equal(packageJson.dependencies.fflate, "^0.8.3");
  assert.equal(lock.packages["node_modules/fflate"].version, "0.8.3");
  assert.equal(
    createHash("sha256")
      .update(JSON.stringify(packageJson.dependencies))
      .digest("hex"),
    "79d4ce1602910cbafff5d92a12922c4ecb77f83bf3193385e5a442b903bebcea",
  );
  assert.equal(
    createHash("sha256").update(JSON.stringify(lock.packages)).digest("hex"),
    "dbcacef71200f5d5a11fef39f84aff4437ba683d26d8a2c2b3628255a3a36fcd",
  );
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
    phase: "production",
    baseUrl: new URL(productionEnvironment.P6_E2E_BASE_URL),
    supabaseUrl: new URL(productionEnvironment.P6_E2E_SUPABASE_URL),
    postgresUrl: productionEnvironment.P6_E2E_POSTGRES_URL,
    freshPostgresUrl: productionEnvironment.P6_E2E_FRESH_POSTGRES_URL,
    upgradePostgresUrl: productionEnvironment.P6_E2E_UPGRADE_POSTGRES_URL,
    restorePostgresUrl: productionEnvironment.P6_E2E_RESTORE_POSTGRES_URL,
    managementApiUrl: new URL(productionEnvironment.P6_E2E_MANAGEMENT_API_URL),
    managementAccessToken: productionEnvironment.P6_E2E_MANAGEMENT_ACCESS_TOKEN,
    projectRef: productionEnvironment.P6_E2E_PROJECT_REF,
    storageCorsOrigin: productionEnvironment.P6_E2E_STORAGE_CORS_ORIGIN,
    deploymentId: productionEnvironment.P6_E2E_DEPLOYMENT_ID,
    commit: productionEnvironment.P6_E2E_COMMIT,
    backupId: productionEnvironment.P6_E2E_BACKUP_ID,
    restoreOperationId: productionEnvironment.P6_E2E_RESTORE_OPERATION_ID,
    restoreResultSha256: productionEnvironment.P6_E2E_RESTORE_RESULT_SHA256,
    restoreManifestSha256: productionEnvironment.P6_E2E_RESTORE_MANIFEST_SHA256,
    region: productionEnvironment.P6_E2E_REGION,
    makerEmail: productionEnvironment.P6_E2E_MAKER_EMAIL,
    approverEmail: productionEnvironment.P6_E2E_APPROVER_EMAIL,
    attackerEmail: productionEnvironment.P6_E2E_ATTACKER_EMAIL,
    viewerEmail: productionEnvironment.P6_E2E_VIEWER_EMAIL,
    ...ids,
  });
});

test("production authority command exits nonzero UNEXECUTED before Playwright", () => {
  const run = spawnSync(
    process.execPath,
    ["scripts/run-drawing-workspace-p6-release.mjs", "production"],
    {
      cwd: new URL("..", import.meta.url),
      env: sanitizedEnvironment(),
      encoding: "utf8",
    },
  );
  assert.notEqual(run.status, 0);
  assert.match(
    `${run.stdout}\n${run.stderr}`,
    /P6 production gate is UNEXECUTED/,
  );
});

test("performance command exits nonzero UNEXECUTED without recorded real authority", () => {
  const run = spawnSync(
    process.execPath,
    ["scripts/drawing-p6-performance-evidence.mjs", "validate"],
    {
      cwd: new URL("..", import.meta.url),
      env: sanitizedEnvironment(),
      encoding: "utf8",
    },
  );
  assert.notEqual(run.status, 0);
  assert.match(
    `${run.stdout}\n${run.stderr}`,
    /P6 performance gate is UNEXECUTED/,
  );
});

test("P6 local manifest is ordered, complete, and fail-fast", async () => {
  assert.doesNotThrow(() =>
    assertExactP6LocalGateManifest(P6_LOCAL_RELEASE_GATES),
  );
  assert.deepEqual(P6_LOCAL_RELEASE_GATES[0], {
    label: "P0-P5 complete local release regression",
    argv: ["npm", "run", "release:drawing-workspace-p5:local"],
  });
  assert.deepEqual(P6_LOCAL_RELEASE_GATES.at(-1), {
    label: "diff check",
    argv: ["git", "--no-pager", "diff", "--check"],
  });
  assert.ok(
    P6_LOCAL_RELEASE_GATES.some(({ argv }) =>
      argv.includes("P6_REAL_POSTGRES_REQUIRED=1"),
    ),
  );
  assert.ok(
    P6_LOCAL_RELEASE_GATES.some(({ argv }) => argv.includes("measure-pure")),
  );
  assert.ok(
    P6_LOCAL_RELEASE_GATES.findIndex(({ label }) =>
      label.includes("evidence producer"),
    ) <
      P6_LOCAL_RELEASE_GATES.findIndex(({ argv }) => argv.includes("validate")),
  );
  const visited = [];
  await assert.rejects(
    runP6ReleaseGates(
      [
        { label: "one", argv: ["one"] },
        { label: "two", argv: ["two"] },
        { label: "never", argv: ["never"] },
      ],
      {
        phase: "LOCAL",
        runner: async ({ label }) => (
          visited.push(label),
          label === "two" ? 9 : 0
        ),
        log() {},
      },
    ),
    /two failed with exit 9/,
  );
  assert.deepEqual(visited, ["one", "two"]);
});

test("P6 performance authority rejects undersized, unbounded, scanning, nondeterministic, and threshold-missed evidence", () => {
  const valid = performanceEvidence();
  assert.deepEqual(
    validateDrawingP6PerformanceEvidence(valid, "1".repeat(40)),
    valid,
  );
  assert.equal(deriveDrawingP6GateStatus(valid), "PASS");
  for (const invalid of [
    performanceEvidence({
      workload: { ...valid.workload, drawingQuantityLinks: 9_999 },
    }),
    performanceEvidence({
      operations: {
        ...valid.operations,
        sourcePage: { ...valid.operations.sourcePage, rows: 201 },
      },
    }),
    performanceEvidence({
      operations: {
        ...valid.operations,
        objectToBoq: { ...valid.operations.objectToBoq, plan: "Seq Scan" },
      },
    }),
    performanceEvidence({
      repeatedHashes: {
        ...valid.repeatedHashes,
        csv: [...valid.repeatedHashes.csv.slice(0, 99), "d".repeat(64)],
      },
    }),
  ])
    assert.throws(() =>
      validateDrawingP6PerformanceEvidence(invalid, "1".repeat(40)),
    );
  const thresholdMiss = performanceEvidence({
    metrics: { ...valid.metrics, calculationManifestP95Ms: 2_501 },
    status: "NOT MET",
  });
  assert.deepEqual(
    validateDrawingP6PerformanceEvidence(thresholdMiss, "1".repeat(40)),
    thresholdMiss,
  );
  assert.equal(deriveDrawingP6GateStatus(thresholdMiss), "NOT MET");
  assert.equal(
    deriveDrawingP6GateStatus(
      performanceEvidence({
        metrics: { ...valid.metrics, peakRssMiB: 512 },
        status: "NOT MET",
      }),
    ),
    "NOT MET",
  );
  assert.throws(
    () => assertDrawingP6PerformancePass(thresholdMiss, "1".repeat(40)),
    /NOT MET/,
  );
});

test("P6 local pure workload is generated at the exact 10k/10k/2k cardinality", () => {
  const workload = buildDrawingP6LocalWorkload();
  assert.equal(workload.drawingMappings.length, 10_000);
  assert.equal(workload.lines.length, 2_000);
  assert.equal(workload.legacyMappings.length, 200);
  assert.equal(workload.components.length, 2_000);
  assert.equal(workload.performanceFixture.snapshots.length, 1);
  assert.deepEqual(workload.performanceFixture.approvals, [
    {
      revisionId: workload.performanceFixture.snapshots[0].revisionId,
      subjectVersion: workload.performanceFixture.snapshots[0].revisionVersion,
      snapshotSha256: workload.performanceFixture.snapshots[0].sha256,
      decision: "approved",
    },
  ]);
  assert.equal(
    new Set(workload.drawingMappings.map((mapping) => mapping.quantityLinkId))
      .size,
    10_000,
  );
  assert.equal(
    new Set(workload.drawingMappings.map((mapping) => mapping.source.objectId))
      .size,
    10_000,
  );
});

test("P6 pure workload gate rejects threshold misses and nondeterminism", () => {
  const valid = {
    workload: {
      drawingQuantityLinks: 10_000,
      allocationLinks: 10_000,
      boqLines: 2_000,
      legacyMappings: 200,
      approvedSnapshots: 1,
      priceBooks: 1,
      materialComponents: 2_000,
    },
    calculationManifestP95Ms: 50,
    comparisonP95Ms: 180,
    diagnosticNodeRssMiB: 340,
    repeatedRuns: 100,
    resultHashes: Array.from({ length: 100 }, () => "a".repeat(64)),
    comparisonHashes: Array.from({ length: 100 }, () => "b".repeat(64)),
    result: {},
  };
  assert.deepEqual(assertDrawingP6LocalPureWorkloadPass(valid), valid);
  assert.throws(
    () =>
      assertDrawingP6LocalPureWorkloadPass({
        ...valid,
        comparisonP95Ms: 3_001,
      }),
    /NOT MET/,
  );
  assert.throws(
    () =>
      assertDrawingP6LocalPureWorkloadPass({
        ...valid,
        resultHashes: [...valid.resultHashes.slice(0, 99), "c".repeat(64)],
      }),
    /NOT MET/,
  );
});

test("P6 actual 100-run production-function workload is deterministic and within threshold", () => {
  const measured = measureDrawingP6LocalPureWorkload();
  assert.deepEqual(assertDrawingP6LocalPureWorkloadPass(measured), measured);
  assert.equal(new Set(measured.resultHashes).size, 1);
  assert.equal(new Set(measured.comparisonHashes).size, 1);
});

test("P6 release evidence is commit-bound and keeps missing production authorities UNEXECUTED", () => {
  const evidence = {
    schemaVersion: 1,
    phase: "local",
    commit: "1".repeat(40),
    migrationIds: ["20260827210000"],
    generatedAt: "2026-08-28T00:00:00.000Z",
    authorities: {
      advisors: "UNEXECUTED",
      attacker: "UNEXECUTED",
      backupRestore: "UNEXECUTED",
      browser: "PASS",
      build: "PASS",
      collaborationTypecheck: "PASS",
      deployedExport: "UNEXECUTED",
      deployedRoute: "UNEXECUTED",
      diff: "PASS",
      format: "PASS",
      hostedMigrations: "UNEXECUTED",
      license: "PASS",
      makerApprover: "UNEXECUTED",
      mountedRoute: "PASS",
      metrics: "PASS",
      p5: "PASS",
      performance: "PASS",
      pglite: "PASS",
      pure: "PASS",
      realPostgres: "PASS",
      rlsConcurrency: "PASS",
      server: "PASS",
      signedUrl: "UNEXECUTED",
      storageCors: "UNEXECUTED",
      twoUsers: "PASS",
      typecheck: "PASS",
    },
    hashes: {
      result: "a".repeat(64),
      manifest: "b".repeat(64),
      handoff: "d".repeat(64),
      csv: "e".repeat(64),
      xlsx: "f".repeat(64),
      sourceBefore: "c".repeat(64),
      sourceAfter: "c".repeat(64),
    },
    metrics: {
      calculationManifestP95Ms: 150,
      comparisonP95Ms: 130,
      lineageP95Ms: 15,
      peakRssMiB: 220,
      repeatedRuns: 100,
    },
    gates: { local: "PASS", production: "UNEXECUTED" },
  };
  assert.deepEqual(
    validateDrawingP6ReleaseEvidence(evidence, "1".repeat(40)),
    evidence,
  );
  assert.throws(
    () =>
      validateDrawingP6ReleaseEvidence(
        {
          ...evidence,
          authorities: { ...evidence.authorities, twoUsers: "UNEXECUTED" },
        },
        "1".repeat(40),
      ),
    /local authority/,
  );
  assert.throws(
    () =>
      validateDrawingP6ReleaseEvidence(
        { ...evidence, commit: "2".repeat(40) },
        "1".repeat(40),
      ),
    /commit/,
  );
  assert.throws(
    () =>
      validateDrawingP6ReleaseEvidence(
        { ...evidence, migrationIds: ["20260827210001"] },
        "1".repeat(40),
      ),
    /migration/,
  );
  assert.throws(
    () =>
      validateDrawingP6ReleaseEvidence(
        { ...evidence, gates: { local: "PASS", production: "PASS" } },
        "1".repeat(40),
      ),
    /production authority/,
  );
  assert.deepEqual(
    assertDrawingP6ReleasePass(evidence, "1".repeat(40)),
    evidence,
  );
  const unexecuted = {
    ...evidence,
    phase: "production",
    metrics: {
      calculationManifestP95Ms: null,
      comparisonP95Ms: null,
      lineageP95Ms: null,
      peakRssMiB: null,
      repeatedRuns: 0,
    },
  };
  assert.deepEqual(
    validateDrawingP6ReleaseEvidence(unexecuted, "1".repeat(40)),
    unexecuted,
  );
  assert.throws(
    () =>
      validateDrawingP6ReleaseEvidence(
        {
          ...unexecuted,
          gates: { local: "PASS", production: "UNEXECUTED" },
          authorities: {
            ...unexecuted.authorities,
            mountedRoute: "UNEXECUTED",
          },
        },
        "1".repeat(40),
      ),
    /local authority/,
  );
  assert.throws(
    () => assertDrawingP6ReleasePass(unexecuted, "1".repeat(40)),
    /UNEXECUTED/,
  );
});

test("P6 runner can record an honest commit-bound UNEXECUTED artifact", () => {
  const evidence = buildDrawingP6UnexecutedReleaseEvidence(
    "local",
    "1".repeat(40),
  );
  assert.equal(evidence.gates.local, "UNEXECUTED");
  assert.equal(evidence.metrics.repeatedRuns, 0);
  assert.deepEqual(
    validateDrawingP6ReleaseEvidence(evidence, "1".repeat(40)),
    evidence,
  );
});

test("P6 evidence refuses a dirty relevant tree", () => {
  assert.doesNotThrow(() => assertDrawingP6RelevantTreeClean("\n"));
  assert.throws(
    () => assertDrawingP6RelevantTreeClean(" M platform/app/routes.ts\n"),
    /working tree is dirty/,
  );
  for (const path of [
    "platform/supabase/migrations/20260827210000_p6.sql",
    "platform/collaboration/src/server.ts",
    "platform/playwright.config.ts",
    "docs/superpowers/specs/2026-08-27-drawing-workspace-p6-design.md",
    "docs/superpowers/plans/2026-08-27-drawing-workspace-p6.md",
  ]) {
    assert.ok(
      P6_RELEASE_RELEVANT_PATHS.some(
        (relevant) => path === relevant || path.startsWith(`${relevant}/`),
      ),
    );
    assert.throws(
      () => assertDrawingP6RelevantTreeClean(` M ${path}\n`),
      /working tree is dirty/,
    );
  }
});

test("P6 package commands use installed Playwright and exact release entrypoints", async () => {
  const [packageJson, config, productionSpec] = await Promise.all([
    readFile(new URL("../package.json", import.meta.url), "utf8").then(
      JSON.parse,
    ),
    readFile(
      new URL("../playwright.p6-release.config.ts", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL(
        "../e2e/drawing-workspace-p6-production.spec.ts",
        import.meta.url,
      ),
      "utf8",
    ),
  ]);
  assert.equal(
    packageJson.scripts["test:e2e:drawing-workspace-p6:local"],
    "P6_RELEASE_PRODUCTION_BUILD=1 playwright test e2e/drawing-workspace-p6.spec.ts --config=playwright.p6-release.config.ts --project=chromium --workers=1",
  );
  assert.equal(
    packageJson.scripts["test:e2e:drawing-workspace-p6:production"],
    "playwright test e2e/drawing-workspace-p6-production.spec.ts --project=chromium --workers=1",
  );
  assert.equal(
    packageJson.scripts["release:drawing-workspace-p6:local"],
    "node scripts/run-drawing-workspace-p6-release.mjs local",
  );
  assert.equal(
    packageJson.scripts["release:drawing-workspace-p6:production"],
    "node scripts/run-drawing-workspace-p6-release.mjs production",
  );
  assert.equal(
    Object.values(packageJson.scripts).some((value) =>
      /\bnpx\b|\bpnpm\b/.test(value),
    ),
    false,
  );
  assert.match(config, /command: "NODE_ENV=development npm run start"/);
  for (const contract of [
    /advisors\/\$\{advisor\}/,
    /database\/backups/,
    /freshPostgresUrl/,
    /upgradePostgresUrl/,
    /restorePostgresUrl/,
    /for \(let run = 0; run < 100; run \+= 1\)/,
    /explain \(analyze,buffers,format json\)/,
    /writeDrawingP6PerformanceEvidence\(performanceEvidence\)/,
    /writeDrawingP6ReleaseEvidence\(release\)/,
    /x-onehk-p6-operation-id/,
    /set_config\('application_name'/,
    /operationCorrelationIds\[name\]/,
    /drawingQuantityLinks: 10_000/,
    /boqLines: 2_000/,
    /legacyMappings: 200/,
    /resourceEvidence\.operations\[name\]\.cpuMs/,
    /resourceEvidence\.operations\[name\]\.peakRssMiB/,
    /no documented trusted OTLP\/Drain or provider API adapter is configured/,
    /errorCode: "P6O01"/,
    /p6AbortController\?\.abort\(\)/,
    /locator\("tbody"\)\.getByText/,
    /unzipSync\(exportBytes\.get\("xlsx"\)!\)/,
    /rejectedSnapshot/,
    /boq_rate_component_id: component\.data\.id/,
  ])
    assert.match(productionSpec, contract);
  assert.doesNotMatch(productionSpec, /api\.vercel\.com|observabilityUrl/);
  assert.doesNotMatch(productionSpec, /process\.cpuUsage|process\.memoryUsage/);
});
