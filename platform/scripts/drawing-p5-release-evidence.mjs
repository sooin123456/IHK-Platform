import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const P5_RELEASE_EVIDENCE_PATH = fileURLToPath(
  new URL(
    "../../.superpowers/sdd/2026-08-27-drawing-workspace-p5/task-6-release-evidence.json",
    import.meta.url,
  ),
);

export const P5_SOURCE_FIXTURES = [
  {
    kind: "pdf_current",
    file: "../../.superpowers/sdd/2026-08-25-drawing-workspace-p2/task-10-artifacts/representative-drawing.pdf",
    byteSize: 62_602,
    sha256: "4dbe58c133a1ce84e1b4da4fce93694ec4f69585bed20e71408a86b7f704e326",
  },
  {
    kind: "pdf_previous",
    file: "../tests/fixtures/p5-previous-revision.pdf",
    byteSize: 63_118,
    sha256: "ea75a7e655dee16a460672131424f00112f70467e495f751d77de80e409fc9bc",
  },
  {
    kind: "ifc",
    url: "https://raw.githubusercontent.com/ThatOpen/engine_web-ifc/3f6f3640b8317664194911fad63bcd407f7e32ca/examples/example.ifc",
    byteSize: 413_681,
    sha256: "db372f3f57796e2f572958c1c144bf3d8be7912493738636a2152cf18f08a14d",
  },
];

const exactKeys = [
  "schemaVersion",
  "status",
  "authority",
  "sourceCommitSha",
  "browserName",
  "browserVersion",
  "viewport",
  "workload",
  "lifecycle",
  "sourceObservation",
  "firstUsableMs",
  "firstUsableTargetMs",
  "firstUsableTargetStatus",
  "p7SixtyFpsGate",
  "productionAuthority",
  "productionStorageCors",
  "productionSignedUrls",
  "productionTwoUserProvider",
].sort();

export function drawingP5SourceCommitSha() {
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
      "playwright.p5-release.config.ts",
      "scripts",
      "tests",
    ],
    {
      cwd: fileURLToPath(new URL("../", import.meta.url)),
      encoding: "utf8",
    },
  ).trim();
}

export function validateDrawingP5ReleaseEvidence(
  evidence,
  expectedCommitSha = drawingP5SourceCommitSha(),
) {
  assert.deepEqual(Object.keys(evidence).sort(), exactKeys);
  assert.equal(evidence.schemaVersion, 1);
  assert.equal(evidence.status, "MEASURED");
  assert.equal(evidence.authority, "LOCAL_PRODUCTION_BUILD_CHROMIUM");
  assert.match(expectedCommitSha, /^[0-9a-f]{40}$/);
  assert.equal(evidence.sourceCommitSha, expectedCommitSha);
  assert.equal(evidence.browserName, "chromium");
  assert.match(evidence.browserVersion, /^\d+(?:\.\d+){3}$/);
  assert.deepEqual(evidence.viewport, { width: 1440, height: 900 });
  assert.deepEqual(
    evidence.workload,
    {
      objects: 10_000,
      sourceLinks: 2_000,
      selectedIfcModels: 1,
      activeComparePages: 1,
    },
    "P5 evidence must contain exactly 2,000 source links",
  );
  assert.deepEqual(evidence.lifecycle, {
    ifcFetches: 1,
    ifcCanvasesAfterUnmount: 0,
    ifcOwnedDisposals: 1,
    ifcContextLossRequests: 1,
  });
  assert.equal(
    evidence.sourceObservation?.observedBy,
    "browser_mutation_workflow",
  );
  assert.match(evidence.sourceObservation?.runId, /^[0-9a-f-]{36}$/);
  for (const phase of ["before", "after"]) {
    const observations = evidence.sourceObservation?.[phase];
    assert.equal(observations?.length, P5_SOURCE_FIXTURES.length);
    for (const [index, expected] of P5_SOURCE_FIXTURES.entries()) {
      const observation = observations[index];
      assert.deepEqual(
        {
          kind: observation?.kind,
          byteSize: observation?.byteSize,
          sha256: observation?.sha256,
          rowByteSize: observation?.fileRow?.byteSize,
          rowSha256: observation?.fileRow?.sha256,
        },
        {
          kind: expected.kind,
          byteSize: expected.byteSize,
          sha256: expected.sha256,
          rowByteSize: expected.byteSize,
          rowSha256: expected.sha256,
        },
      );
      assert.match(observation?.fileRow?.id, /^[0-9a-f-]{36}$/);
    }
  }
  assert.equal(Number.isFinite(evidence.firstUsableMs), true);
  assert.ok(evidence.firstUsableMs > 0);
  assert.equal(evidence.firstUsableTargetMs, 2_500);
  assert.equal(
    evidence.firstUsableTargetStatus,
    evidence.firstUsableMs <= 2_500 ? "MET" : "NOT MET",
    "first usable target status must be derived from the measurement",
  );
  assert.equal(evidence.p7SixtyFpsGate, "UNEXECUTED");
  for (const key of [
    "productionAuthority",
    "productionStorageCors",
    "productionSignedUrls",
    "productionTwoUserProvider",
  ])
    assert.equal(evidence[key], "UNEXECUTED");
  return evidence;
}

export function writeDrawingP5ReleaseEvidence(evidence) {
  const valid = validateDrawingP5ReleaseEvidence(evidence);
  writeFileSync(
    P5_RELEASE_EVIDENCE_PATH,
    `${JSON.stringify(valid, null, 2)}\n`,
  );
  return P5_RELEASE_EVIDENCE_PATH;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (process.argv[2] !== "validate")
    throw new Error("Usage: drawing-p5-release-evidence.mjs validate");
  validateDrawingP5ReleaseEvidence(
    JSON.parse(readFileSync(P5_RELEASE_EVIDENCE_PATH, "utf8")),
  );
  process.stdout.write(`${P5_RELEASE_EVIDENCE_PATH}\n`);
}
