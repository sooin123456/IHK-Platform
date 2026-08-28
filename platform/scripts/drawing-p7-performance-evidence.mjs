import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { fileURLToPath } from "node:url";

const platformRoot = fileURLToPath(new URL("../", import.meta.url));

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
    "exact 10,000-object warm reopen after one untimed production navigation primes immutable application, PDF, and IFC response bytes plus the source-SHA-bound first-visible-v1 derived PDF raster cache; requires a verified derived-raster HIT, hydration, exact authoritative-state confirmation, durable local edit bridge readiness, non-empty viewport projection, mounted PDF pixels, a ready visible IFC frame, and the next animation frame; this is not the separately observed 3,088.9 ms cold/cache-miss baseline, which was NOT MET",
  warm: "same mounted exact 10,000-object workspace after two zoom gestures and one pan gesture; earliest capture-phase input boundary to the next animation frame, with selection state committed in that frame",
};

function exactKeys(value, keys, label) {
  assert.deepEqual(Object.keys(value ?? {}).sort(), [...keys].sort(), label);
}

function positiveFinite(value, label) {
  assert.equal(Number.isFinite(value) && value > 0, true, label);
}

function nonnegativeFinite(value, label) {
  assert.equal(Number.isFinite(value) && value >= 0, true, label);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalJson(value) {
  if (Array.isArray(value))
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  return JSON.stringify(value);
}

export function drawingP7CaptureSha256(evidence) {
  const capture = structuredClone(evidence);
  if (capture?.provenance) capture.provenance.captureSha256 = "";
  return sha256(canonicalJson(capture));
}

export function drawingP7FileSha256(path) {
  return sha256(readFileSync(path));
}

export function drawingP7DirectorySha256(path) {
  const hash = createHash("sha256");
  const visit = (directory, prefix = "") => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort(
      (left, right) => left.name.localeCompare(right.name),
    )) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      const absolute = `${directory}/${entry.name}`;
      if (entry.isDirectory()) visit(absolute, relative);
      else if (entry.isFile()) {
        hash.update(relative);
        hash.update("\0");
        hash.update(readFileSync(absolute));
        hash.update("\0");
      }
    }
  };
  visit(path);
  return hash.digest("hex");
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
    { cwd: platformRoot, encoding: "utf8" },
  ).trim();
}

export function drawingP7SourceTreeSha256() {
  const tracked = execFileSync(
    "git",
    [
      "ls-files",
      "--cached",
      "--others",
      "--exclude-standard",
      "-z",
      "--",
      "app",
      "e2e",
      "package.json",
      "playwright.p7-performance.config.ts",
      "scripts",
      "tests",
    ],
    { cwd: platformRoot },
  )
    .toString("utf8")
    .split("\0")
    .filter(Boolean);
  const hash = createHash("sha256");
  for (const path of [...new Set(tracked)].sort()) {
    hash.update(path);
    hash.update("\0");
    hash.update(readFileSync(new URL(`../${path}`, import.meta.url)));
    hash.update("\0");
  }
  return hash.digest("hex");
}

function percentile(values, ratio) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.ceil(sorted.length * ratio) - 1] ?? 0;
}

function validateHashes(values, expected, label) {
  assert.equal(values?.length, 100, `${label} must contain exactly 100 runs`);
  for (const value of values) {
    assert.match(value, /^[0-9a-f]{64}$/, label);
    assert.equal(value, expected, `${label} changed across the exact fixture`);
  }
}

function validateProvenance(evidence) {
  const provenance = evidence.provenance;
  exactKeys(
    provenance,
    [
      "runner",
      "sourceTreeSha256",
      "runnerSha256",
      "configSha256",
      "build",
      "captureSha256",
    ],
    "runner provenance",
  );
  exactKeys(
    provenance.build,
    ["serverSha256", "clientSha256"],
    "build provenance",
  );
  assert.equal(provenance.runner, "P7_PLAYWRIGHT_PRODUCTION_BUILD_V2");
  assert.equal(provenance.sourceTreeSha256, drawingP7SourceTreeSha256());
  assert.equal(
    provenance.runnerSha256,
    drawingP7FileSha256(
      fileURLToPath(
        new URL("./run-drawing-p7-performance.mjs", import.meta.url),
      ),
    ),
  );
  assert.equal(
    provenance.configSha256,
    drawingP7FileSha256(
      fileURLToPath(
        new URL("../playwright.p7-performance.config.ts", import.meta.url),
      ),
    ),
  );
  for (const [name, value] of Object.entries(provenance.build)) {
    assert.match(value, /^[0-9a-f]{64}$/, `${name} build provenance`);
    assert.notEqual(value, "0".repeat(64), `${name} build provenance`);
  }
  const serverBuildPath = fileURLToPath(
    new URL("../build/server/index.js", import.meta.url),
  );
  const clientBuildPath = fileURLToPath(
    new URL("../build/client", import.meta.url),
  );
  assert.equal(existsSync(serverBuildPath), true, "server build provenance");
  assert.equal(existsSync(clientBuildPath), true, "client build provenance");
  assert.equal(
    provenance.build.serverSha256,
    drawingP7FileSha256(serverBuildPath),
    "served server build provenance",
  );
  assert.equal(
    provenance.build.clientSha256,
    drawingP7DirectorySha256(clientBuildPath),
    "served client build provenance",
  );
  assert.equal(
    provenance.captureSha256,
    drawingP7CaptureSha256(evidence),
    "capture checksum",
  );
}

export function validateDrawingP7PerformanceEvidence(
  evidence,
  expectedCommitSha = drawingP7SourceCommitSha(),
) {
  exactKeys(
    evidence,
    [
      "schemaVersion",
      "status",
      "authority",
      "sourceCommitSha",
      "provenance",
      "browserName",
      "browserVersion",
      "userAgent",
      "viewport",
      "cpu",
      "memory",
      "workload",
      "conditions",
      "pdfRaster",
      "stages",
      "firstUsable",
      "warm",
      "determinism",
      "gates",
    ],
    "evidence shape",
  );
  assert.equal(evidence.schemaVersion, 3, "schemaVersion");
  assert.equal(evidence.authority, "LOCAL_PRODUCTION_BUILD_CHROMIUM");
  assert.match(expectedCommitSha, /^[0-9a-f]{40}$/);
  assert.equal(evidence.sourceCommitSha, expectedCommitSha);
  validateProvenance(evidence);

  assert.equal(evidence.browserName, "chromium");
  assert.match(evidence.browserVersion, /^\d+(?:\.\d+){3}$/);
  assert.equal(typeof evidence.userAgent, "string");
  assert.ok(evidence.userAgent.length > 0);
  assert.deepEqual(evidence.viewport, { width: 1440, height: 900 });
  exactKeys(evidence.cpu, ["model", "logicalCount"], "CPU shape");
  exactKeys(
    evidence.memory,
    ["totalBytes", "freeBytesAtMeasurement"],
    "memory shape",
  );
  assert.equal(typeof evidence.cpu.model, "string");
  assert.ok(evidence.cpu.model.length > 0);
  positiveFinite(evidence.cpu.logicalCount, "logical CPU count");
  positiveFinite(evidence.memory.totalBytes, "total memory");
  positiveFinite(
    evidence.memory.freeBytesAtMeasurement,
    "free memory at measurement",
  );

  exactKeys(
    evidence.workload,
    [
      "objects",
      "objectMix",
      "authoritativeObjects",
      "projectedObjects",
      "accessibleObjects",
      "sourceLinks",
      "selectedIfcModels",
      "activePdfPages",
    ],
    "workload shape",
  );
  assert.deepEqual(evidence.workload.objectMix, exactMix);
  assert.equal(evidence.workload.objects, 10_000);
  assert.equal(evidence.workload.authoritativeObjects, 10_000);
  positiveFinite(evidence.workload.projectedObjects, "projected objects");
  assert.ok(evidence.workload.projectedObjects < 2_500);
  positiveFinite(evidence.workload.accessibleObjects, "accessible objects");
  assert.ok(
    evidence.workload.accessibleObjects <= evidence.workload.projectedObjects,
  );
  assert.equal(evidence.workload.sourceLinks, 2);
  assert.equal(evidence.workload.selectedIfcModels, 1);
  assert.equal(evidence.workload.activePdfPages, 1);
  assert.deepEqual(evidence.conditions, exactConditions);
  exactKeys(
    evidence.pdfRaster,
    [
      "authority",
      "cacheStatus",
      "renderProfile",
      "keySha256",
      "mountedAtMs",
      "screenPixelRatio",
    ],
    "PDF raster evidence",
  );
  assert.equal(
    evidence.pdfRaster.authority,
    "SHA256_DERIVED_CACHE",
    "derived raster authority",
  );
  assert.equal(
    evidence.pdfRaster.cacheStatus,
    "HIT",
    "derived raster cache HIT",
  );
  assert.equal(evidence.pdfRaster.renderProfile, "first-visible-v1");
  assert.match(evidence.pdfRaster.keySha256, /^[0-9a-f]{64}$/);
  positiveFinite(evidence.pdfRaster.mountedAtMs, "PDF raster mounted time");
  assert.equal(
    Number.isFinite(evidence.pdfRaster.screenPixelRatio) &&
      evidence.pdfRaster.screenPixelRatio >= 1.5,
    true,
    "first-visible raster must provide at least 1.5 screen pixels per CSS pixel",
  );

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
  exactKeys(evidence.stages, [...serverStages, ...browserStages], "stages");
  for (const name of serverStages) {
    exactKeys(evidence.stages[name], ["authority", "durationMs"], name);
    assert.equal(evidence.stages[name].authority, "LOCAL_PRODUCTION_SERVER");
    positiveFinite(evidence.stages[name].durationMs, `${name} stage`);
  }
  for (const name of browserStages) {
    exactKeys(
      evidence.stages[name],
      ["authority", "startMs", "endMs", "durationMs"],
      name,
    );
    assert.equal(
      evidence.stages[name].authority,
      "LOCAL_PRODUCTION_BUILD_CHROMIUM",
    );
    nonnegativeFinite(evidence.stages[name].startMs, `${name} stage start`);
    positiveFinite(evidence.stages[name].endMs, `${name} stage end`);
    positiveFinite(evidence.stages[name].durationMs, `${name} stage`);
    assert.equal(
      evidence.stages[name].durationMs,
      evidence.stages[name].endMs - evidence.stages[name].startMs,
      `${name} stage interval`,
    );
  }

  exactKeys(
    evidence.firstUsable,
    ["durationMs", "targetMs", "status", "readiness"],
    "first usable",
  );
  const readiness = evidence.firstUsable.readiness;
  exactKeys(
    readiness,
    [
      "navigationStartMs",
      "hydrationEndMs",
      "editReadyObservedMs",
      "authoritativeStateObservedMs",
      "viewportProjectionObservedMs",
      "pdfVisibleObservedMs",
      "ifcVisibleObservedMs",
      "usableFrameEndMs",
    ],
    "first usable readiness",
  );
  assert.equal(readiness.navigationStartMs, 0);
  for (const [name, value] of Object.entries(readiness)) {
    nonnegativeFinite(value, `${name} readiness`);
    assert.ok(value <= readiness.usableFrameEndMs, `${name} readiness order`);
  }
  for (const name of [
    "hydrationEndMs",
    "editReadyObservedMs",
    "authoritativeStateObservedMs",
    "viewportProjectionObservedMs",
    "pdfVisibleObservedMs",
    "ifcVisibleObservedMs",
    "usableFrameEndMs",
  ])
    positiveFinite(readiness[name], `${name} readiness`);
  assert.ok(
    readiness.hydrationEndMs >= evidence.stages.hydration.endMs,
    "hydration readiness includes the measured stage",
  );
  assert.ok(
    readiness.pdfVisibleObservedMs >= evidence.stages.pdf.endMs,
    "PDF readiness includes visible completion",
  );
  assert.ok(
    evidence.pdfRaster.mountedAtMs <= readiness.pdfVisibleObservedMs,
    "PDF raster pixels must mount before PDF readiness",
  );
  assert.ok(
    readiness.ifcVisibleObservedMs >= evidence.stages.ifc.endMs,
    "IFC readiness includes visible completion",
  );
  assert.equal(
    evidence.firstUsable.durationMs,
    readiness.usableFrameEndMs - readiness.navigationStartMs,
    "first usable duration",
  );
  assert.equal(evidence.firstUsable.targetMs, 2_500);
  assert.equal(
    evidence.firstUsable.status,
    evidence.firstUsable.durationMs <= evidence.firstUsable.targetMs
      ? "MET"
      : "NOT MET",
    "first usable status",
  );

  exactKeys(
    evidence.warm,
    ["samples", "p95Ms", "rawSamples", "targetMs", "status"],
    "warm evidence",
  );
  exactKeys(evidence.warm.samples, ["zoom", "pan", "selection"], "samples");
  exactKeys(evidence.warm.p95Ms, ["zoom", "pan", "selection"], "p95");
  exactKeys(
    evidence.warm.rawSamples,
    ["zoomMs", "panMs", "selection"],
    "raw samples",
  );
  const raw = evidence.warm.rawSamples;
  assert.equal(raw.zoomMs.length, 30);
  assert.ok(raw.panMs.length >= 30);
  assert.equal(raw.selection.length, 30);
  for (const [name, values] of [
    ["zoom", raw.zoomMs],
    ["pan", raw.panMs],
  ])
    for (const value of values) nonnegativeFinite(value, `${name} raw sample`);
  const selectionMs = raw.selection.map((sample) => {
    exactKeys(
      sample,
      ["durationMs", "expectedObjectName", "committedObjectName"],
      "selection raw sample",
    );
    nonnegativeFinite(sample.durationMs, "selection raw sample");
    assert.ok(sample.expectedObjectName.length > 0, "expected selection");
    assert.equal(
      sample.committedObjectName,
      sample.expectedObjectName,
      "committed selection",
    );
    return sample.durationMs;
  });
  assert.deepEqual(evidence.warm.samples, {
    zoom: raw.zoomMs.length,
    pan: raw.panMs.length,
    selection: raw.selection.length,
  });
  for (const [name, values] of [
    ["zoom", raw.zoomMs],
    ["pan", raw.panMs],
    ["selection", selectionMs],
  ])
    assert.equal(
      evidence.warm.p95Ms[name],
      percentile(values, 0.95),
      `${name} p95`,
    );
  assert.equal(evidence.warm.targetMs, 16.7);
  const warmStatus =
    Math.max(...Object.values(evidence.warm.p95Ms)) <= evidence.warm.targetMs
      ? "MET"
      : "NOT MET";
  assert.equal(evidence.warm.status, warmStatus, "warm status");

  exactKeys(
    evidence.determinism,
    ["runs", "fixtureHashes", "renderOrderHashes", "projectionHashes"],
    "determinism",
  );
  assert.equal(evidence.determinism.runs, 100);
  validateHashes(
    evidence.determinism.fixtureHashes,
    P7_DETERMINISTIC_HASHES.fixture,
    "fixture hashes",
  );
  validateHashes(
    evidence.determinism.renderOrderHashes,
    P7_DETERMINISTIC_HASHES.renderOrder,
    "render order hashes",
  );
  validateHashes(
    evidence.determinism.projectionHashes,
    P7_DETERMINISTIC_HASHES.projection,
    "projection hashes",
  );
  const localStatus =
    evidence.firstUsable.status === "MET" && evidence.warm.status === "MET"
      ? "MET"
      : "NOT MET";
  assert.equal(evidence.status, localStatus);
  assert.deepEqual(evidence.gates, {
    local: localStatus,
    productionRuntime: "UNEXECUTED",
  });
  return evidence;
}

export function writeDrawingP7PerformanceEvidence(
  evidence,
  targetPath = P7_PERFORMANCE_EVIDENCE_PATH,
) {
  const temporaryPath = `${targetPath}.${process.pid}.tmp`;
  rmSync(targetPath, { force: true });
  rmSync(temporaryPath, { force: true });
  try {
    assert.equal(
      process.env.P7_PERFORMANCE_RUNNER_AUTHORITY,
      "P7_PLAYWRIGHT_PRODUCTION_BUILD_V2",
      "runner authority",
    );
    for (const [environmentName, evidenceValue] of [
      ["P7_SOURCE_COMMIT_SHA", evidence.sourceCommitSha],
      ["P7_SOURCE_TREE_SHA256", evidence.provenance?.sourceTreeSha256],
      ["P7_RUNNER_SHA256", evidence.provenance?.runnerSha256],
      ["P7_CONFIG_SHA256", evidence.provenance?.configSha256],
      ["P7_BUILD_SERVER_SHA256", evidence.provenance?.build?.serverSha256],
      ["P7_BUILD_CLIENT_SHA256", evidence.provenance?.build?.clientSha256],
    ])
      assert.equal(
        process.env[environmentName],
        evidenceValue,
        `runner authority ${environmentName}`,
      );
    const valid = validateDrawingP7PerformanceEvidence(evidence);
    writeFileSync(temporaryPath, `${JSON.stringify(valid, null, 2)}\n`);
    renameSync(temporaryPath, targetPath);
    return targetPath;
  } catch (error) {
    rmSync(temporaryPath, { force: true });
    throw error;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (process.argv[2] !== "validate")
    throw new Error("Usage: drawing-p7-performance-evidence.mjs validate");
  validateDrawingP7PerformanceEvidence(
    JSON.parse(readFileSync(P7_PERFORMANCE_EVIDENCE_PATH, "utf8")),
  );
  process.stdout.write(`${P7_PERFORMANCE_EVIDENCE_PATH}\n`);
}
