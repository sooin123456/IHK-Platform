import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { assertDrawingP6CurrentTreeClean } from "./drawing-p6-release-evidence.mjs";
import { compareVerifiedBoqApprovedStates } from "../app/lukas/lib/verified-boq-comparison-v1-1.server.ts";
import { calculateVerifiedBoqV1_1 } from "../app/lukas/lib/verified-boq-v1-1.server.ts";

export const P6_PERFORMANCE_EVIDENCE_PATH = fileURLToPath(
  new URL(
    "../../.superpowers/sdd/2026-08-27-drawing-workspace-p6/task-9-performance-evidence.json",
    import.meta.url,
  ),
);
export const P6_PRODUCTION_PERFORMANCE_EVIDENCE_PATH = fileURLToPath(
  new URL(
    "../../.superpowers/sdd/2026-08-27-drawing-workspace-p6/task-9-production-performance-evidence.json",
    import.meta.url,
  ),
);
export const P6_PURE_PERFORMANCE_EVIDENCE_PATH = fileURLToPath(
  new URL(
    "../../.superpowers/sdd/2026-08-27-drawing-workspace-p6/task-9-pure-performance-evidence.json",
    import.meta.url,
  ),
);

const sha256 = /^[0-9a-f]{64}$/;
const operations = [
  "sourcePage",
  "calculationManifest",
  "comparison",
  "exports",
  "objectToBoq",
  "materialLineage",
];
const repeatedArtifacts = [
  "result",
  "calculationManifest",
  "comparison",
  "csv",
  "xlsx",
  "manifest",
  "handoff",
];

function stableUuid(index) {
  return `00000000-0000-4000-8000-${index.toString(16).padStart(12, "0")}`;
}

export function buildDrawingP6LocalWorkload() {
  const resourceId = stableUuid(2);
  const sourceFileId = stableUuid(3);
  const lines = Array.from({ length: 2_000 }, (_, index) => ({
    id: stableUuid(index + 100_000),
    sectionCode: String(Math.floor(index / 200) + 1).padStart(2, "0"),
    itemCode: `P6-${String(index + 1).padStart(4, "0")}`,
    itemName: `P6 workload line ${index + 1}`,
    specification: "exact 10k/10k/2k workload",
    unit: "EA",
    signedAdjustment: "0",
    adjustmentReason: "",
  }));
  const drawingMappings = Array.from({ length: 10_000 }, (_, index) => {
    const id = index + 100;
    return {
      id: stableUuid(id),
      lineId: lines[index % lines.length].id,
      quantityLinkId: stableUuid(id + 20_000),
      allocationFactor: "1",
      source: {
        quantityLinkId: stableUuid(id + 20_000),
        revisionId: stableUuid(4),
        revisionVersion: 1,
        snapshotSha256: "a".repeat(64),
        objectId: stableUuid(id + 40_000),
        lineageId: stableUuid(id + 40_000),
        objectVersion: 1,
        objectFingerprint: createHash("sha256")
          .update(`object:${index}`)
          .digest("hex"),
        measurementKind: "count",
        rawQuantity: "1",
        unit: "EA",
        measurementRuleVersion: "P4_MEASUREMENT_V1",
        sourceAnchors: [
          {
            sourceFileId,
            sourceSha256: "b".repeat(64),
            sourceKind: "ifc_element",
            pdfRegion: null,
            ifcGlobalId: `P6-${index}`,
          },
        ],
        issueLinks: [],
      },
    };
  });
  const legacyMappings = Array.from({ length: 200 }, (_, index) => ({
    id: stableUuid(index + 200_000),
    lineId: lines[index % lines.length].id,
    sourceFileId: stableUuid(200_500),
    sourceSha256: "d".repeat(64),
    subjectKey: `LEGACY-P6-${index}`,
    sourceQuantity: "1",
    factor: "1",
    unit: "EA",
    elementIds: [String(index + 1)],
  }));
  return {
    engineVersion: "VERIFIED-BOQ-1.1",
    versionId: stableUuid(5),
    calculationPolicy: "general_half_away",
    quantityScale: 3,
    lines,
    legacyMappings,
    drawingMappings,
    priceBook: {
      id: stableUuid(6),
      sourceFileId: stableUuid(7),
      sourceSha256: "c".repeat(64),
      effectiveDate: "2026-08-28",
      rightsBasis: "customer_owned",
    },
    exclusions: [],
    resources: [
      {
        id: resourceId,
        code: "M-P6",
        type: "material",
        unit: "EA",
        unitPriceKrw: "1",
      },
    ],
    components: lines.map((line, index) => ({
      id: stableUuid(index + 300_000),
      lineId: line.id,
      resourceId,
      coefficient: "1",
    })),
    performanceFixture: {
      snapshots: [
        {
          revisionId: stableUuid(4),
          revisionVersion: 1,
          sha256: "a".repeat(64),
        },
      ],
      approvals: [
        {
          revisionId: stableUuid(4),
          subjectVersion: 1,
          snapshotSha256: "a".repeat(64),
          decision: "approved",
        },
      ],
    },
  };
}

function drawingP6LocalWorkloadCounts(input) {
  const approvedSnapshots = input.performanceFixture.snapshots.filter(
    (snapshot) =>
      input.performanceFixture.approvals.some(
        (approval) =>
          approval.decision === "approved" &&
          approval.revisionId === snapshot.revisionId &&
          approval.subjectVersion === snapshot.revisionVersion &&
          approval.snapshotSha256 === snapshot.sha256,
      ) &&
      input.drawingMappings.every(
        (mapping) =>
          mapping.source.revisionId === snapshot.revisionId &&
          mapping.source.revisionVersion === snapshot.revisionVersion &&
          mapping.source.snapshotSha256 === snapshot.sha256,
      ),
  );
  return {
    drawingQuantityLinks: new Set(
      input.drawingMappings.map((mapping) => mapping.quantityLinkId),
    ).size,
    allocationLinks: input.drawingMappings.length,
    boqLines: input.lines.length,
    legacyMappings: input.legacyMappings.length,
    approvedSnapshots: approvedSnapshots.length,
    priceBooks: new Set([input.priceBook.id]).size,
    materialComponents: input.components.length,
  };
}

export function measureDrawingP6LocalPureWorkload(repeatedRuns = 100) {
  assert.equal(repeatedRuns, 100);
  const input = buildDrawingP6LocalWorkload();
  const calculationMs = [];
  const comparisonMs = [];
  const resultHashes = [];
  const comparisonHashes = [];
  let result;
  let diagnosticNodeRssBytes = process.memoryUsage().rss;
  for (let index = 0; index < repeatedRuns; index += 1) {
    let started = performance.now();
    result = calculateVerifiedBoqV1_1(input);
    calculationMs.push(performance.now() - started);
    resultHashes.push(result.canonicalSha256);
    diagnosticNodeRssBytes = Math.max(
      diagnosticNodeRssBytes,
      process.memoryUsage().rss,
    );
    started = performance.now();
    const comparison = compareVerifiedBoqApprovedStates(
      {
        engineVersion: input.engineVersion,
        status: "approved",
        approvedDecision: {
          decidedBy: stableUuid(9),
          createdAt: "2026-08-28T00:00:00.000Z",
        },
        input,
        result,
      },
      {
        engineVersion: input.engineVersion,
        status: "approved",
        approvedDecision: {
          decidedBy: stableUuid(10),
          createdAt: "2026-08-28T00:01:00.000Z",
        },
        input,
        result,
      },
    );
    comparisonMs.push(performance.now() - started);
    comparisonHashes.push(
      createHash("sha256").update(JSON.stringify(comparison)).digest("hex"),
    );
    diagnosticNodeRssBytes = Math.max(
      diagnosticNodeRssBytes,
      process.memoryUsage().rss,
    );
  }
  const p95 = (values) =>
    [...values].sort((a, b) => a - b)[Math.ceil(values.length * 0.95) - 1];
  return {
    workload: drawingP6LocalWorkloadCounts(input),
    calculationManifestP95Ms: p95(calculationMs),
    comparisonP95Ms: p95(comparisonMs),
    diagnosticNodeRssMiB: diagnosticNodeRssBytes / 1024 / 1024,
    repeatedRuns,
    resultHashes,
    comparisonHashes,
    result,
  };
}

export function assertDrawingP6LocalPureWorkloadPass(measurement) {
  const deterministic = (values) =>
    Array.isArray(values) &&
    values.length === 100 &&
    new Set(values).size === 1 &&
    sha256.test(values[0]);
  if (
    measurement.workload?.drawingQuantityLinks !== 10_000 ||
    measurement.workload?.allocationLinks !== 10_000 ||
    measurement.workload?.boqLines !== 2_000 ||
    measurement.workload?.legacyMappings !== 200 ||
    measurement.workload?.approvedSnapshots !== 1 ||
    measurement.workload?.priceBooks !== 1 ||
    measurement.workload?.materialComponents !== 2_000 ||
    measurement.repeatedRuns !== 100 ||
    !Number.isFinite(measurement.calculationManifestP95Ms) ||
    measurement.calculationManifestP95Ms > 2_500 ||
    !Number.isFinite(measurement.comparisonP95Ms) ||
    measurement.comparisonP95Ms > 3_000 ||
    !deterministic(measurement.resultHashes) ||
    !deterministic(measurement.comparisonHashes)
  )
    throw new Error("P6 pure performance gate is NOT MET");
  return measurement;
}

export function writeDrawingP6LocalPureWorkloadEvidence(measurement) {
  const valid = assertDrawingP6LocalPureWorkloadPass(measurement);
  const evidence = {
    schemaVersion: 1,
    authority: "LOCAL_PRODUCTION_FUNCTIONS",
    commit: drawingP6SourceCommitSha(),
    generatedAt: new Date().toISOString(),
    workload: valid.workload,
    metrics: {
      calculationManifestP95Ms: valid.calculationManifestP95Ms,
      comparisonP95Ms: valid.comparisonP95Ms,
      diagnosticNodeRssMiB: valid.diagnosticNodeRssMiB,
      repeatedRuns: valid.repeatedRuns,
    },
    hashes: {
      result: valid.resultHashes[0],
      comparison: valid.comparisonHashes[0],
    },
    status: "PASS",
  };
  writeFileSync(
    P6_PURE_PERFORMANCE_EVIDENCE_PATH,
    `${JSON.stringify(evidence, null, 2)}\n`,
  );
  return P6_PURE_PERFORMANCE_EVIDENCE_PATH;
}

export function drawingP6SourceCommitSha() {
  return execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: fileURLToPath(new URL("../", import.meta.url)),
    encoding: "utf8",
  }).trim();
}

function positive(value, label) {
  assert.equal(Number.isFinite(value) && value > 0, true, label);
}

export function deriveDrawingP6GateStatus(evidence) {
  const metrics = evidence.metrics ?? {};
  const operationRows = evidence.operations ?? {};
  const hashes = evidence.repeatedHashes ?? {};
  const deterministic = repeatedArtifacts.every((name) => {
    const values = hashes[name];
    return (
      Array.isArray(values) &&
      values.length === 100 &&
      values.every((value) => value === values[0] && sha256.test(value))
    );
  });
  const bounded = ["sourcePage", "objectToBoq", "materialLineage"].every(
    (name) => operationRows[name]?.rows <= 200,
  );
  const indexed = operations.every(
    (name) =>
      typeof operationRows[name]?.plan === "string" &&
      !/Seq Scan|N\+1/i.test(operationRows[name].plan),
  );
  const sourceStable =
    JSON.stringify(evidence.sourceHashes?.before) ===
    JSON.stringify(evidence.sourceHashes?.after);
  return evidence.workload?.drawingQuantityLinks === 10_000 &&
    evidence.workload?.allocationLinks === 10_000 &&
    evidence.workload?.boqLines === 2_000 &&
    evidence.workload?.legacyMappings > 0 &&
    evidence.workload?.approvedSnapshots === 1 &&
    evidence.workload?.priceBooks === 1 &&
    evidence.workload?.materialComponents > 0 &&
    metrics.repeatedRuns === 100 &&
    metrics.calculationManifestP95Ms <= 2_500 &&
    metrics.comparisonP95Ms <= 3_000 &&
    metrics.lineageP95Ms <= 500 &&
    metrics.peakRssMiB < 512 &&
    bounded &&
    indexed &&
    deterministic &&
    sourceStable
    ? "PASS"
    : "NOT MET";
}

export function validateDrawingP6PerformanceEvidence(
  evidence,
  expectedCommit = drawingP6SourceCommitSha(),
) {
  assert.equal(evidence.schemaVersion, 1);
  assert.ok(
    evidence.authority === "LOCAL_REAL_POSTGRES_PRODUCTION_BUILD_CHROMIUM" ||
      evidence.authority === "HOSTED_SUPABASE_DEPLOYED_CHROMIUM",
  );
  assert.match(expectedCommit, /^[0-9a-f]{40}$/);
  assert.equal(evidence.commit, expectedCommit);
  assert.equal(Number.isNaN(Date.parse(evidence.generatedAt)), false);
  for (const field of [
    "node",
    "browser",
    "postgres",
    "machine",
    "region",
    "resourceAuthority",
  ])
    assert.equal(
      typeof evidence.runtime?.[field] === "string" &&
        evidence.runtime[field].length > 0,
      true,
      `runtime ${field}`,
    );
  assert.match(evidence.runtime?.resourceEvidenceSha256, sha256);
  assert.deepEqual(evidence.workload, {
    drawingQuantityLinks: 10_000,
    allocationLinks: 10_000,
    boqLines: 2_000,
    legacyMappings: 200,
    approvedSnapshots: 1,
    priceBooks: 1,
    materialComponents: 2_000,
  });
  for (const name of operations) {
    const row = evidence.operations?.[name];
    for (const field of [
      "coldMs",
      "warmMs",
      "cpuMs",
      "peakRssMiB",
      "rows",
      "bytes",
    ])
      positive(row?.[field], `${name} ${field}`);
    assert.doesNotMatch(row.plan, /Seq Scan|N\+1/i, `${name} plan`);
  }
  for (const name of ["sourcePage", "objectToBoq", "materialLineage"])
    assert.ok(evidence.operations[name].rows <= 200, `${name} response bound`);
  for (const name of repeatedArtifacts) {
    const values = evidence.repeatedHashes?.[name];
    assert.equal(values?.length, 100, `${name} repeated hashes`);
    assert.equal(new Set(values).size, 1, `${name} deterministic hashes`);
    assert.match(values[0], sha256);
  }
  assert.equal(evidence.metrics?.repeatedRuns, 100);
  for (const field of [
    "calculationManifestP95Ms",
    "comparisonP95Ms",
    "lineageP95Ms",
    "peakRssMiB",
  ])
    positive(evidence.metrics?.[field], field);
  assert.equal(
    evidence.metrics.peakRssMiB,
    Math.max(...operations.map((name) => evidence.operations[name].peakRssMiB)),
    "aggregate peak RSS must equal the per-operation maximum",
  );
  assert.ok(evidence.sourceHashes?.before?.length > 0);
  assert.deepEqual(evidence.sourceHashes.before, evidence.sourceHashes.after);
  for (const digest of evidence.sourceHashes.before)
    assert.match(digest, sha256);
  assert.equal(evidence.status, deriveDrawingP6GateStatus(evidence));
  return evidence;
}

export function writeDrawingP6PerformanceEvidence(evidence) {
  const valid = validateDrawingP6PerformanceEvidence(evidence);
  const path =
    valid.authority === "HOSTED_SUPABASE_DEPLOYED_CHROMIUM"
      ? P6_PRODUCTION_PERFORMANCE_EVIDENCE_PATH
      : P6_PERFORMANCE_EVIDENCE_PATH;
  writeFileSync(path, `${JSON.stringify(valid, null, 2)}\n`);
  return path;
}

export function assertDrawingP6PerformancePass(
  evidence,
  expectedCommit = drawingP6SourceCommitSha(),
) {
  const valid = validateDrawingP6PerformanceEvidence(evidence, expectedCommit);
  if (valid.status !== "PASS")
    throw new Error("P6 performance gate is NOT MET");
  return valid;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (process.argv[2] === "measure-pure") {
    assertDrawingP6CurrentTreeClean();
    const evidencePath = writeDrawingP6LocalPureWorkloadEvidence(
      measureDrawingP6LocalPureWorkload(),
    );
    process.stdout.write(`${evidencePath}\n`);
  } else {
    if (process.argv[2] !== "validate")
      throw new Error(
        "P6 performance gate is UNEXECUTED: mounted real PostgreSQL evidence must be recorded before validation",
      );
    if (!existsSync(P6_PERFORMANCE_EVIDENCE_PATH))
      throw new Error(
        "P6 performance gate is UNEXECUTED: mounted real PostgreSQL evidence has not been recorded",
      );
    assertDrawingP6CurrentTreeClean();
    assertDrawingP6PerformancePass(
      JSON.parse(readFileSync(P6_PERFORMANCE_EVIDENCE_PATH, "utf8")),
    );
    process.stdout.write(`${P6_PERFORMANCE_EVIDENCE_PATH}\n`);
  }
}
