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

export const P7_PERFORMANCE_PLAYWRIGHT_CAPTURE_PATH = fileURLToPath(
  new URL(
    "../../.superpowers/sdd/2026-08-28-drawing-workspace-p7/task-4-performance-playwright-capture.json",
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
  coldCacheMiss:
    "fresh production-build Chromium context with empty derived raster storage navigates directly to the exact 10,000-object workspace; requires hydration, exact authoritative-state confirmation, durable local edit bridge readiness, non-empty viewport projection, visible PDF.js pixels, a ready visible IFC frame, and the next animation frame",
  firstUsable:
    "exact 10,000-object warm reopen after one untimed production navigation primes immutable application, PDF, and IFC response bytes; an unverified derived raster may display provisionally but does not satisfy readiness, which requires PDF.js pixels rendered from the original source plus hydration, exact authoritative-state confirmation, durable local edit bridge readiness, non-empty viewport projection, a ready visible IFC frame, and the next animation frame; this does not substitute for the separately captured cold/cache-miss boundary whose status is independently derived",
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

export function drawingP7PlaywrightCaptureSha256(capture) {
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

function derivedStatus(durationMs, targetMs) {
  return durationMs <= targetMs ? "MET" : "NOT MET";
}

function validateRawPlaywrightCapture(capture) {
  exactKeys(
    capture,
    [
      "schemaVersion",
      "authority",
      "runId",
      "source",
      "browserName",
      "browserVersion",
      "userAgent",
      "viewport",
      "cpu",
      "memory",
      "workload",
      "conditions",
      "coldCacheMiss",
      "pdfRaster",
      "stages",
      "firstUsable",
      "warm",
      "determinism",
    ],
    "raw Playwright capture shape",
  );
  assert.equal(capture.schemaVersion, 1, "raw Playwright capture schema");
  assert.equal(capture.authority, "P7_PLAYWRIGHT_RAW_CAPTURE_V1");
  assert.match(capture.runId, /^[0-9a-f-]{36}$/i, "runner capture id");
  exactKeys(
    capture.source,
    ["commitSha", "treeSha256", "runnerSha256", "configSha256", "build"],
    "raw capture source",
  );
  exactKeys(
    capture.source.build,
    ["serverSha256", "clientSha256"],
    "raw capture build",
  );
  exactKeys(
    capture.coldCacheMiss,
    ["cacheStatus", "readiness"],
    "raw cold cache-miss capture",
  );
  assert.equal(capture.coldCacheMiss.cacheStatus, "MISS");
  exactKeys(capture.firstUsable, ["readiness"], "raw first usable capture");
  exactKeys(capture.warm, ["rawSamples"], "raw warm capture");
  return capture;
}

export function drawingP7EvidenceFromPlaywrightCapture(capture) {
  validateRawPlaywrightCapture(capture);
  const coldDuration =
    capture.coldCacheMiss.readiness.usableFrameEndMs -
    capture.coldCacheMiss.readiness.navigationStartMs;
  const firstUsableDuration =
    capture.firstUsable.readiness.usableFrameEndMs -
    capture.firstUsable.readiness.navigationStartMs;
  const selectionMs = capture.warm.rawSamples.selection.map(
    ({ durationMs }) => durationMs,
  );
  const p95Ms = {
    zoom: percentile(capture.warm.rawSamples.zoomMs, 0.95),
    pan: percentile(capture.warm.rawSamples.panMs, 0.95),
    selection: percentile(selectionMs, 0.95),
  };
  const firstUsableStatus = derivedStatus(firstUsableDuration, 2_500);
  const warmStatus = derivedStatus(Math.max(...Object.values(p95Ms)), 16.7);
  const localStatus =
    firstUsableStatus === "MET" && warmStatus === "MET" ? "MET" : "NOT MET";
  const evidence = {
    schemaVersion: 4,
    status: localStatus,
    authority: "LOCAL_PRODUCTION_BUILD_CHROMIUM",
    sourceCommitSha: capture.source.commitSha,
    provenance: {
      runner: "P7_PLAYWRIGHT_PRODUCTION_BUILD_V3",
      runId: capture.runId,
      sourceTreeSha256: capture.source.treeSha256,
      runnerSha256: capture.source.runnerSha256,
      configSha256: capture.source.configSha256,
      build: structuredClone(capture.source.build),
      playwrightCaptureSha256: drawingP7PlaywrightCaptureSha256(capture),
      captureSha256: "",
    },
    browserName: capture.browserName,
    browserVersion: capture.browserVersion,
    userAgent: capture.userAgent,
    viewport: structuredClone(capture.viewport),
    cpu: structuredClone(capture.cpu),
    memory: structuredClone(capture.memory),
    workload: structuredClone(capture.workload),
    conditions: structuredClone(capture.conditions),
    coldCacheMiss: {
      cacheStatus: capture.coldCacheMiss.cacheStatus,
      durationMs: coldDuration,
      targetMs: 2_500,
      status: derivedStatus(coldDuration, 2_500),
      readiness: structuredClone(capture.coldCacheMiss.readiness),
    },
    pdfRaster: structuredClone(capture.pdfRaster),
    stages: structuredClone(capture.stages),
    firstUsable: {
      durationMs: firstUsableDuration,
      targetMs: 2_500,
      status: firstUsableStatus,
      readiness: structuredClone(capture.firstUsable.readiness),
    },
    warm: {
      samples: {
        zoom: capture.warm.rawSamples.zoomMs.length,
        pan: capture.warm.rawSamples.panMs.length,
        selection: capture.warm.rawSamples.selection.length,
      },
      p95Ms,
      rawSamples: structuredClone(capture.warm.rawSamples),
      targetMs: 16.7,
      status: warmStatus,
    },
    determinism: structuredClone(capture.determinism),
    gates: { local: localStatus, productionRuntime: "UNEXECUTED" },
  };
  evidence.provenance.captureSha256 = drawingP7CaptureSha256(evidence);
  return evidence;
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
      "runId",
      "sourceTreeSha256",
      "runnerSha256",
      "configSha256",
      "build",
      "playwrightCaptureSha256",
      "captureSha256",
    ],
    "runner provenance",
  );
  exactKeys(
    provenance.build,
    ["serverSha256", "clientSha256"],
    "build provenance",
  );
  assert.equal(provenance.runner, "P7_PLAYWRIGHT_PRODUCTION_BUILD_V3");
  assert.match(provenance.runId, /^[0-9a-f-]{36}$/i, "runner capture id");
  assert.match(
    provenance.playwrightCaptureSha256,
    /^[0-9a-f]{64}$/,
    "Playwright capture checksum",
  );
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

function validateDrawingP7PerformanceEvidenceAgainstCapture(
  evidence,
  expectedCommitSha,
  playwrightCapture,
) {
  assert.deepEqual(
    evidence,
    drawingP7EvidenceFromPlaywrightCapture(playwrightCapture),
    "runner Playwright capture authority",
  );
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
      "coldCacheMiss",
      "pdfRaster",
      "stages",
      "firstUsable",
      "warm",
      "determinism",
      "gates",
    ],
    "evidence shape",
  );
  assert.equal(evidence.schemaVersion, 4, "schemaVersion");
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
    evidence.coldCacheMiss,
    ["cacheStatus", "durationMs", "targetMs", "status", "readiness"],
    "cold cache-miss evidence",
  );
  assert.equal(evidence.coldCacheMiss.cacheStatus, "MISS");
  assert.equal(evidence.coldCacheMiss.targetMs, 2_500);
  const coldReadiness = evidence.coldCacheMiss.readiness;
  exactKeys(
    coldReadiness,
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
    "cold cache-miss readiness",
  );
  for (const [name, value] of Object.entries(coldReadiness))
    nonnegativeFinite(value, `${name} cold readiness`);
  assert.equal(
    evidence.coldCacheMiss.durationMs,
    coldReadiness.usableFrameEndMs - coldReadiness.navigationStartMs,
    "cold cache-miss duration",
  );
  assert.equal(
    evidence.coldCacheMiss.status,
    derivedStatus(evidence.coldCacheMiss.durationMs, 2_500),
    "cold cache-miss status",
  );
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
    "PDFJS",
    "source-rendered PDF raster authority",
  );
  assert.equal(
    evidence.pdfRaster.cacheStatus,
    "UNVERIFIED_HIT",
    "derived raster cache is only a provisional hint",
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

export function validateDrawingP7PerformanceEvidence(
  evidence,
  expectedCommitSha = drawingP7SourceCommitSha(),
) {
  inspectDrawingP7PerformanceEvidence(evidence, expectedCommitSha);
  throw new Error(
    "Standalone performance artifacts cannot establish execution authority without an external immutable or signed receipt; use the live production-build runner result.",
  );
}

export function inspectDrawingP7PerformanceEvidence(
  evidence,
  expectedCommitSha = drawingP7SourceCommitSha(),
) {
  const playwrightCapture = JSON.parse(
    readFileSync(P7_PERFORMANCE_PLAYWRIGHT_CAPTURE_PATH, "utf8"),
  );
  return validateDrawingP7PerformanceEvidenceAgainstCapture(
    evidence,
    expectedCommitSha,
    playwrightCapture,
  );
}

export function removeDrawingP7FailedRunArtifacts(
  status,
  paths = [
    P7_PERFORMANCE_EVIDENCE_PATH,
    P7_PERFORMANCE_PLAYWRIGHT_CAPTURE_PATH,
  ],
) {
  if (status === 0) return;
  for (const path of paths) rmSync(path, { force: true });
}

export function finalizeDrawingP7PerformanceEvidence(
  provenance,
  {
    capturePath = P7_PERFORMANCE_PLAYWRIGHT_CAPTURE_PATH,
    targetPath = P7_PERFORMANCE_EVIDENCE_PATH,
  } = {},
) {
  const temporaryPath = `${targetPath}.${process.pid}.tmp`;
  rmSync(targetPath, { force: true });
  rmSync(temporaryPath, { force: true });
  try {
    const capture = validateRawPlaywrightCapture(
      JSON.parse(readFileSync(capturePath, "utf8")),
    );
    assert.deepEqual(
      {
        runId: capture.runId,
        sourceCommitSha: capture.source.commitSha,
        sourceTreeSha256: capture.source.treeSha256,
        runnerSha256: capture.source.runnerSha256,
        configSha256: capture.source.configSha256,
        build: capture.source.build,
      },
      provenance,
      "runner-owned Playwright capture provenance",
    );
    const evidence = drawingP7EvidenceFromPlaywrightCapture(capture);
    const valid = validateDrawingP7PerformanceEvidenceAgainstCapture(
      evidence,
      provenance.sourceCommitSha,
      capture,
    );
    writeFileSync(temporaryPath, `${JSON.stringify(valid, null, 2)}\n`);
    renameSync(temporaryPath, targetPath);
    return valid;
  } catch (error) {
    rmSync(temporaryPath, { force: true });
    throw error;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (process.argv[2] === "inspect") {
    inspectDrawingP7PerformanceEvidence(
      JSON.parse(readFileSync(P7_PERFORMANCE_EVIDENCE_PATH, "utf8")),
    );
    process.stdout.write(
      `${P7_PERFORMANCE_EVIDENCE_PATH} (structure/build binding only; standalone execution authority unavailable)\n`,
    );
  } else if (process.argv[2] === "validate") {
    validateDrawingP7PerformanceEvidence(
      JSON.parse(readFileSync(P7_PERFORMANCE_EVIDENCE_PATH, "utf8")),
    );
  } else
    throw new Error(
      "Usage: drawing-p7-performance-evidence.mjs inspect|validate",
    );
}
