import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const P4_PERFORMANCE_EVIDENCE_PATH = fileURLToPath(
  new URL(
    "../../.superpowers/sdd/2026-08-26-drawing-workspace-p4/task-7-performance.json",
    import.meta.url,
  ),
);

const exactMix = {
  wall: 2_000,
  opening: 2_000,
  space: 1_500,
  area: 1_500,
  grid: 1_500,
  arc: 1_500,
};
const exactConditions = {
  firstUsable:
    "cold 10,000-object document navigation after warming application assets",
  frames: "warm after two zoom gestures and one pan gesture",
};
const exactKeys = [
  "schemaVersion",
  "status",
  "authority",
  "sourceCommitSha",
  "browserName",
  "browserVersion",
  "userAgent",
  "viewport",
  "cpu",
  "memory",
  "objectMix",
  "conditions",
  "firstUsableMs",
  "firstUsableTargetMs",
  "firstUsableTargetMet",
  "warmSamples",
  "p95Ms",
  "p7SixtyFpsGate",
  "productionProviderP95",
].sort();

function positiveFinite(value, label) {
  assert.equal(Number.isFinite(value) && value > 0, true, label);
}

export function drawingP4SourceCommitSha() {
  return execFileSync(
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
    {
      cwd: fileURLToPath(new URL("../", import.meta.url)),
      encoding: "utf8",
    },
  ).trim();
}

export function validateDrawingP4PerformanceEvidence(
  evidence,
  expectedCommitSha = drawingP4SourceCommitSha(),
) {
  assert.deepEqual(Object.keys(evidence).sort(), exactKeys);
  assert.equal(evidence.schemaVersion, 1);
  assert.equal(evidence.status, "MEASURED");
  assert.equal(evidence.authority, "LOCAL_PRODUCTION_BUILD_CHROMIUM");
  assert.match(expectedCommitSha, /^[0-9a-f]{40}$/);
  assert.equal(evidence.sourceCommitSha, expectedCommitSha);
  assert.equal(evidence.browserName, "chromium");
  assert.match(evidence.browserVersion, /^\d+(?:\.\d+){3}$/);
  assert.equal(typeof evidence.userAgent, "string");
  assert.ok(evidence.userAgent.length > 0);
  assert.deepEqual(evidence.viewport, { width: 1440, height: 900 });
  assert.equal(typeof evidence.cpu?.model, "string");
  assert.ok(evidence.cpu.model.length > 0);
  positiveFinite(evidence.cpu.logicalCount, "logical CPU count");
  positiveFinite(evidence.memory?.totalBytes, "total memory");
  positiveFinite(evidence.memory?.freeBytesAtMeasurement, "free memory");
  assert.deepEqual(evidence.objectMix, exactMix);
  assert.equal(
    Object.values(evidence.objectMix).reduce((sum, value) => sum + value, 0),
    10_000,
  );
  assert.deepEqual(evidence.conditions, exactConditions);
  positiveFinite(evidence.firstUsableMs, "first usable");
  assert.equal(evidence.firstUsableTargetMs, 2_500);
  assert.equal(
    evidence.firstUsableTargetMet,
    evidence.firstUsableMs <= evidence.firstUsableTargetMs,
  );
  assert.equal(evidence.warmSamples?.zoom, 30);
  assert.ok(evidence.warmSamples?.pan >= 30);
  assert.equal(evidence.warmSamples?.selection, 30);
  for (const kind of ["zoom", "pan", "selection"])
    assert.equal(
      Number.isFinite(evidence.p95Ms?.[kind]) && evidence.p95Ms[kind] >= 0,
      true,
      `${kind} p95`,
    );
  assert.equal(evidence.p7SixtyFpsGate, "UNEXECUTED");
  assert.equal(evidence.productionProviderP95, "UNEXECUTED");
  return evidence;
}

export function writeDrawingP4PerformanceEvidence(evidence) {
  const valid = validateDrawingP4PerformanceEvidence(evidence);
  writeFileSync(
    P4_PERFORMANCE_EVIDENCE_PATH,
    `${JSON.stringify(valid, null, 2)}\n`,
  );
  return P4_PERFORMANCE_EVIDENCE_PATH;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (process.argv[2] !== "validate")
    throw new Error("Usage: drawing-p4-performance-evidence.mjs validate");
  const evidence = JSON.parse(
    readFileSync(P4_PERFORMANCE_EVIDENCE_PATH, "utf8"),
  );
  validateDrawingP4PerformanceEvidence(evidence);
  process.stdout.write(`${P4_PERFORMANCE_EVIDENCE_PATH}\n`);
}
