import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const P6_LOCAL_RELEASE_EVIDENCE_PATH = fileURLToPath(
  new URL(
    "../../.superpowers/sdd/2026-08-27-drawing-workspace-p6/task-9-release-evidence.json",
    import.meta.url,
  ),
);
export const P6_PRODUCTION_RELEASE_EVIDENCE_PATH = fileURLToPath(
  new URL(
    "../../.superpowers/sdd/2026-08-27-drawing-workspace-p6/task-9-production-release-evidence.json",
    import.meta.url,
  ),
);
export const P6_RELEASE_EVIDENCE_PATH = P6_LOCAL_RELEASE_EVIDENCE_PATH;
const statuses = new Set(["PASS", "NOT MET", "UNEXECUTED"]);
export const P6_RELEASE_MIGRATION_IDS = Object.freeze(["20260827210000"]);
const authorityKeys = [
  "advisors",
  "attacker",
  "backupRestore",
  "browser",
  "build",
  "collaborationTypecheck",
  "deployedExport",
  "deployedRoute",
  "diff",
  "format",
  "hostedMigrations",
  "license",
  "makerApprover",
  "metrics",
  "mountedRoute",
  "p5",
  "performance",
  "pglite",
  "pure",
  "realPostgres",
  "rlsConcurrency",
  "server",
  "signedUrl",
  "storageCors",
  "twoUsers",
  "typecheck",
].sort();
const hashKeys = [
  "csv",
  "handoff",
  "manifest",
  "result",
  "sourceAfter",
  "sourceBefore",
  "xlsx",
].sort();
export const P6_RELEASE_RELEVANT_PATHS = Object.freeze([
  "platform/app",
  "platform/collaboration",
  "platform/e2e",
  "platform/scripts",
  "platform/supabase/migrations",
  "platform/tests",
  "platform/package.json",
  "platform/package-lock.json",
  "platform/playwright.config.ts",
  "platform/playwright.p6-release.config.ts",
  "platform/THIRD_PARTY_NOTICES.md",
  "docs/superpowers/specs/2026-08-27-drawing-workspace-p6-design.md",
  "docs/superpowers/plans/2026-08-27-drawing-workspace-p6.md",
]);
const localAuthorityKeys = [
  "browser",
  "build",
  "collaborationTypecheck",
  "diff",
  "format",
  "license",
  "metrics",
  "mountedRoute",
  "p5",
  "performance",
  "pglite",
  "pure",
  "realPostgres",
  "rlsConcurrency",
  "server",
  "twoUsers",
  "typecheck",
];

export function drawingP6ReleaseCommit() {
  return execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: fileURLToPath(new URL("../", import.meta.url)),
    encoding: "utf8",
  }).trim();
}

export function assertDrawingP6RelevantTreeClean(status) {
  if (status.trim())
    throw new Error(
      "P6 release gate is UNEXECUTED: relevant working tree is dirty",
    );
}

export function assertDrawingP6CurrentTreeClean() {
  assertDrawingP6RelevantTreeClean(
    execFileSync(
      "git",
      ["status", "--porcelain", "--", ...P6_RELEASE_RELEVANT_PATHS],
      {
        cwd: fileURLToPath(new URL("../../", import.meta.url)),
        encoding: "utf8",
      },
    ),
  );
}

export function validateDrawingP6ReleaseEvidence(
  evidence,
  expectedCommit = drawingP6ReleaseCommit(),
) {
  assert.deepEqual(Object.keys(evidence).sort(), [
    "authorities",
    "commit",
    "gates",
    "generatedAt",
    "hashes",
    "metrics",
    "migrationIds",
    "phase",
    "schemaVersion",
  ]);
  assert.equal(evidence.schemaVersion, 1);
  assert.ok(evidence.phase === "local" || evidence.phase === "production");
  assert.equal(evidence.commit, expectedCommit, "commit-bound evidence");
  assert.match(evidence.commit, /^[0-9a-f]{40}$/);
  assert.equal(Number.isNaN(Date.parse(evidence.generatedAt)), false);
  assert.deepEqual(
    evidence.migrationIds,
    P6_RELEASE_MIGRATION_IDS,
    "exact P6 migration authority",
  );
  assert.deepEqual(Object.keys(evidence.authorities).sort(), authorityKeys);
  assert.deepEqual(Object.keys(evidence.gates).sort(), ["local", "production"]);
  assert.deepEqual(Object.keys(evidence.hashes).sort(), hashKeys);
  for (const group of [evidence.authorities, evidence.gates])
    for (const status of Object.values(group)) assert.ok(statuses.has(status));
  for (const digest of Object.values(evidence.hashes))
    assert.match(digest, /^[0-9a-f]{64}$/);
  assert.equal(evidence.hashes.sourceBefore, evidence.hashes.sourceAfter);
  if (
    evidence.gates.production === "PASS" &&
    Object.values(evidence.authorities).some((status) => status !== "PASS")
  )
    throw new Error("production authority cannot PASS with missing authority");
  if (
    evidence.gates.local === "PASS" &&
    localAuthorityKeys.some((name) => evidence.authorities[name] !== "PASS")
  )
    throw new Error(
      "local authority cannot PASS without every local release authority",
    );
  const activeStatus = evidence.gates[evidence.phase];
  if (activeStatus === "UNEXECUTED") {
    assert.equal(evidence.metrics.repeatedRuns, 0);
    for (const key of [
      "calculationManifestP95Ms",
      "comparisonP95Ms",
      "lineageP95Ms",
      "peakRssMiB",
    ])
      assert.equal(evidence.metrics[key], null);
    return evidence;
  }
  assert.equal(evidence.metrics.repeatedRuns, 100);
  for (const key of [
    "calculationManifestP95Ms",
    "comparisonP95Ms",
    "lineageP95Ms",
    "peakRssMiB",
  ])
    assert.equal(Number.isFinite(evidence.metrics[key]), true, key);
  return evidence;
}

export function buildDrawingP6UnexecutedReleaseEvidence(
  phase,
  commit = drawingP6ReleaseCommit(),
) {
  assert.ok(phase === "local" || phase === "production");
  const emptyHash = createHash("sha256").update("").digest("hex");
  return {
    schemaVersion: 1,
    phase,
    commit,
    migrationIds: [...P6_RELEASE_MIGRATION_IDS],
    generatedAt: new Date().toISOString(),
    authorities: Object.fromEntries(
      authorityKeys.map((name) => [name, "UNEXECUTED"]),
    ),
    hashes: Object.fromEntries(hashKeys.map((name) => [name, emptyHash])),
    metrics: {
      calculationManifestP95Ms: null,
      comparisonP95Ms: null,
      lineageP95Ms: null,
      peakRssMiB: null,
      repeatedRuns: 0,
    },
    gates: { local: "UNEXECUTED", production: "UNEXECUTED" },
  };
}

export function assertDrawingP6ReleasePass(
  evidence,
  expectedCommit = drawingP6ReleaseCommit(),
) {
  const valid = validateDrawingP6ReleaseEvidence(evidence, expectedCommit);
  if (valid.gates[valid.phase] !== "PASS")
    throw new Error(
      `P6 ${valid.phase} release gate is ${valid.gates[valid.phase]}`,
    );
  return valid;
}

export function writeDrawingP6ReleaseEvidence(evidence) {
  const valid = validateDrawingP6ReleaseEvidence(evidence);
  const path =
    valid.phase === "production"
      ? P6_PRODUCTION_RELEASE_EVIDENCE_PATH
      : P6_LOCAL_RELEASE_EVIDENCE_PATH;
  writeFileSync(path, `${JSON.stringify(valid, null, 2)}\n`);
  return path;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (
    process.argv[2] !== "validate" ||
    !["local", "production"].includes(process.argv[3])
  )
    throw new Error(
      "Usage: drawing-p6-release-evidence.mjs validate local|production",
    );
  const path =
    process.argv[3] === "production"
      ? P6_PRODUCTION_RELEASE_EVIDENCE_PATH
      : P6_LOCAL_RELEASE_EVIDENCE_PATH;
  assertDrawingP6CurrentTreeClean();
  assertDrawingP6ReleasePass(JSON.parse(readFileSync(path, "utf8")));
  process.stdout.write(`${path}\n`);
}
