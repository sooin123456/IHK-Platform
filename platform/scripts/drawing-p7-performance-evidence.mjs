import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const P7_PERFORMANCE_EVIDENCE_PATH = fileURLToPath(
  new URL(
    "../../.superpowers/sdd/2026-08-28-drawing-workspace-p7/task-4-performance-evidence.json",
    import.meta.url,
  ),
);

export const P7_DETERMINISTIC_HASHES = {
  fixture: "eb7b316b82a4a3f7a64fbd529d14c5e8041911c54ac3c926bd0af7f299c66cb6",
  renderOrder:
    "9154c645ec9f00664b117471fba109c17e44ce8fac9adb0648f65ab0f93f2e5e",
  projection:
    "41a922cd1303904150c91afab6bacb6d4288a6e6e6b781a58b329380e7a75543",
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
  "workload",
  "conditions",
  "stages",
  "firstUsable",
  "warm",
  "determinism",
  "gates",
].sort();

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
    "cold exact 10,000-object document navigation after warming application, PDF, and IFC assets; usable after hydration, authoritative-state confirmation, non-empty viewport projection, and the next animation frame",
  warm: "same mounted exact 10,000-object workspace after two zoom gestures and one pan gesture; event dispatch to next animation frame",
};

function positiveFinite(value, label) {
  assert.equal(Number.isFinite(value) && value > 0, true, label);
}

function validateHashes(values, expected, label) {
  assert.equal(values?.length, 100, `${label} must contain exactly 100 runs`);
  for (const value of values) {
    assert.match(value, /^[0-9a-f]{64}$/, label);
    assert.equal(value, expected, `${label} changed across the exact fixture`);
  }
}

export function drawingP7SourceCommitSha() {
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
      "playwright.p7-performance.config.ts",
      "scripts",
      "tests",
    ],
    {
      cwd: fileURLToPath(new URL("../", import.meta.url)),
      encoding: "utf8",
    },
  ).trim();
}

export function validateDrawingP7PerformanceEvidence(
  evidence,
  expectedCommitSha = drawingP7SourceCommitSha(),
) {
  assert.deepEqual(Object.keys(evidence).sort(), exactKeys);
  assert.equal(evidence.schemaVersion, 1);
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
  positiveFinite(evidence.cpu?.logicalCount, "logical CPU count");
  positiveFinite(evidence.memory?.totalBytes, "total memory");
  positiveFinite(
    evidence.memory?.freeBytesAtMeasurement,
    "free memory at measurement",
  );
  assert.deepEqual(evidence.workload?.objectMix, exactMix);
  assert.equal(evidence.workload?.objects, 10_000);
  assert.equal(evidence.workload?.authoritativeObjects, 10_000);
  positiveFinite(evidence.workload?.projectedObjects, "projected objects");
  assert.ok(evidence.workload.projectedObjects < 2_500);
  positiveFinite(evidence.workload?.accessibleObjects, "accessible objects");
  assert.ok(
    evidence.workload.accessibleObjects <= evidence.workload.projectedObjects,
  );
  assert.equal(evidence.workload?.sourceLinks, 2);
  assert.equal(evidence.workload?.selectedIfcModels, 1);
  assert.equal(evidence.workload?.activePdfPages, 1);
  assert.equal(
    Object.values(evidence.workload.objectMix).reduce(
      (sum, amount) => sum + amount,
      0,
    ),
    10_000,
  );
  assert.deepEqual(evidence.conditions, exactConditions);

  const serverStages = ["loader", "ssr"];
  const browserStages = [
    "hydration",
    "styleResolution",
    "renderAdapter",
    "konvaMount",
    "snapHitPreparation",
    "pdf",
    "ifc",
  ];
  assert.deepEqual(
    Object.keys(evidence.stages ?? {}).sort(),
    [...serverStages, ...browserStages].sort(),
  );
  for (const name of serverStages) {
    assert.equal(
      evidence.stages[name]?.authority,
      "LOCAL_PRODUCTION_SERVER",
      `${name} stage authority`,
    );
    positiveFinite(evidence.stages[name]?.durationMs, `${name} stage`);
  }
  for (const name of browserStages) {
    assert.equal(
      evidence.stages[name]?.authority,
      "LOCAL_PRODUCTION_BUILD_CHROMIUM",
      `${name} stage authority`,
    );
    positiveFinite(evidence.stages[name]?.durationMs, `${name} stage`);
  }

  positiveFinite(evidence.firstUsable?.durationMs, "first usable");
  assert.equal(evidence.firstUsable?.targetMs, 2_500);
  assert.equal(
    evidence.firstUsable?.status,
    evidence.firstUsable.durationMs <= evidence.firstUsable.targetMs
      ? "MET"
      : "NOT MET",
    "first usable status must be derived from the measured duration",
  );
  assert.equal(evidence.warm?.samples?.zoom, 30);
  assert.ok(evidence.warm?.samples?.pan >= 30);
  assert.equal(evidence.warm?.samples?.selection, 30);
  assert.equal(evidence.warm?.targetMs, 16.7);
  const warmP95 = ["zoom", "pan", "selection"].map((kind) => {
    const value = evidence.warm?.p95Ms?.[kind];
    assert.equal(Number.isFinite(value) && value >= 0, true, `${kind} p95`);
    return value;
  });
  assert.equal(
    evidence.warm?.status,
    Math.max(...warmP95) <= evidence.warm.targetMs ? "MET" : "NOT MET",
    "warm status must be derived from the measured p95 values",
  );
  assert.equal(evidence.determinism?.runs, 100);
  validateHashes(
    evidence.determinism?.fixtureHashes,
    P7_DETERMINISTIC_HASHES.fixture,
    "fixture hashes",
  );
  validateHashes(
    evidence.determinism?.renderOrderHashes,
    P7_DETERMINISTIC_HASHES.renderOrder,
    "render order hashes",
  );
  validateHashes(
    evidence.determinism?.projectionHashes,
    P7_DETERMINISTIC_HASHES.projection,
    "projection hashes",
  );
  const localStatus =
    evidence.firstUsable.status === "MET" && evidence.warm.status === "MET"
      ? "MET"
      : "NOT MET";
  assert.equal(evidence.status, localStatus);
  assert.equal(evidence.gates?.local, localStatus);
  assert.equal(evidence.gates?.productionRuntime, "UNEXECUTED");
  return evidence;
}

export function writeDrawingP7PerformanceEvidence(evidence) {
  const valid = validateDrawingP7PerformanceEvidence(evidence);
  writeFileSync(
    P7_PERFORMANCE_EVIDENCE_PATH,
    `${JSON.stringify(valid, null, 2)}\n`,
  );
  return P7_PERFORMANCE_EVIDENCE_PATH;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (process.argv[2] !== "validate")
    throw new Error("Usage: drawing-p7-performance-evidence.mjs validate");
  validateDrawingP7PerformanceEvidence(
    JSON.parse(readFileSync(P7_PERFORMANCE_EVIDENCE_PATH, "utf8")),
  );
  process.stdout.write(`${P7_PERFORMANCE_EVIDENCE_PATH}\n`);
}
