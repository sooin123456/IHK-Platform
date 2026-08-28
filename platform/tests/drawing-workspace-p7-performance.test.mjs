import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";

const evidenceModule =
  await import("../scripts/drawing-p7-performance-evidence.mjs").catch(
    () => ({}),
  );
const runnerModule = await import("../scripts/run-drawing-p7-performance.mjs");

const evidencePath = new URL(
  "../../.superpowers/sdd/2026-08-28-drawing-workspace-p7/task-4-performance-evidence.json",
  import.meta.url,
);
const runnerEvidence = JSON.parse(readFileSync(evidencePath, "utf8"));
const suiteEvidenceBytes = readFileSync(evidencePath);
const suiteCaptureBytes = readFileSync(
  evidenceModule.P7_PERFORMANCE_PLAYWRIGHT_CAPTURE_PATH,
);

after(() => {
  writeFileSync(evidencePath, suiteEvidenceBytes);
  writeFileSync(
    evidenceModule.P7_PERFORMANCE_PLAYWRIGHT_CAPTURE_PATH,
    suiteCaptureBytes,
  );
});

test("P7 rejects the old handwritten summary and validates only the runner-produced raw capture", () => {
  assert.equal(
    typeof evidenceModule.validateDrawingP7PerformanceEvidence,
    "function",
  );
  assert.equal(runnerEvidence.schemaVersion, 4);
  assert.equal(
    typeof evidenceModule.P7_PERFORMANCE_PLAYWRIGHT_CAPTURE_PATH,
    "string",
  );
  assert.equal(
    existsSync(evidenceModule.P7_PERFORMANCE_PLAYWRIGHT_CAPTURE_PATH),
    true,
  );
  assert.doesNotThrow(() =>
    evidenceModule.inspectDrawingP7PerformanceEvidence(runnerEvidence),
  );
  assert.throws(
    () => evidenceModule.validateDrawingP7PerformanceEvidence(runnerEvidence),
    /standalone.*authority/i,
  );

  const oldSummary = structuredClone(runnerEvidence);
  oldSummary.schemaVersion = 1;
  delete oldSummary.provenance;
  delete oldSummary.firstUsable.readiness;
  delete oldSummary.warm.rawSamples;
  assert.throws(
    () => evidenceModule.inspectDrawingP7PerformanceEvidence(oldSummary),
    /schemaVersion|provenance|readiness|raw samples/,
  );
});

test("P7 raw timing, committed selection, and build provenance mutations fail closed", () => {
  const rawMutation = structuredClone(runnerEvidence);
  rawMutation.warm.rawSamples.selection[0].durationMs += 1;
  assert.throws(
    () => evidenceModule.inspectDrawingP7PerformanceEvidence(rawMutation),
    /runner Playwright capture authority/,
  );

  const selectionMutation = structuredClone(runnerEvidence);
  selectionMutation.warm.rawSamples.selection[0].committedObjectName =
    "not committed";
  selectionMutation.provenance.captureSha256 =
    evidenceModule.drawingP7CaptureSha256(selectionMutation);
  assert.throws(
    () => evidenceModule.inspectDrawingP7PerformanceEvidence(selectionMutation),
    /runner Playwright capture authority/,
  );

  const buildMutation = structuredClone(runnerEvidence);
  buildMutation.provenance.build.serverSha256 = "0".repeat(64);
  buildMutation.provenance.captureSha256 =
    evidenceModule.drawingP7CaptureSha256(buildMutation);
  assert.throws(
    () => evidenceModule.inspectDrawingP7PerformanceEvidence(buildMutation),
    /runner Playwright capture authority/,
  );
});

test("P7 cannot promote fabricated one-millisecond timings without the runner Playwright capture", () => {
  const fabricated = structuredClone(runnerEvidence);
  fabricated.provenance.sourceTreeSha256 =
    evidenceModule.drawingP7SourceTreeSha256();
  fabricated.provenance.runnerSha256 = evidenceModule.drawingP7FileSha256(
    new URL("../scripts/run-drawing-p7-performance.mjs", import.meta.url),
  );
  fabricated.provenance.configSha256 = evidenceModule.drawingP7FileSha256(
    new URL("../playwright.p7-performance.config.ts", import.meta.url),
  );
  fabricated.provenance.build.serverSha256 = evidenceModule.drawingP7FileSha256(
    new URL("../build/server/index.js", import.meta.url),
  );
  fabricated.provenance.build.clientSha256 =
    evidenceModule.drawingP7DirectorySha256(
      fileURLToPath(new URL("../build/client", import.meta.url)),
    );
  for (const stage of Object.values(fabricated.stages)) {
    stage.durationMs = 1;
    if ("startMs" in stage) {
      stage.startMs = 0;
      stage.endMs = 1;
    }
  }
  fabricated.pdfRaster.mountedAtMs = 1;
  fabricated.coldCacheMiss.durationMs = 1;
  for (const key of Object.keys(fabricated.coldCacheMiss.readiness))
    fabricated.coldCacheMiss.readiness[key] =
      key === "navigationStartMs" ? 0 : 1;
  fabricated.coldCacheMiss.status = "MET";
  fabricated.firstUsable.durationMs = 1;
  for (const key of Object.keys(fabricated.firstUsable.readiness))
    fabricated.firstUsable.readiness[key] = key === "navigationStartMs" ? 0 : 1;
  fabricated.firstUsable.status = "MET";
  fabricated.warm.rawSamples.zoomMs.fill(1);
  fabricated.warm.rawSamples.panMs.fill(1);
  for (const sample of fabricated.warm.rawSamples.selection)
    sample.durationMs = 1;
  fabricated.warm.p95Ms = { zoom: 1, pan: 1, selection: 1 };
  fabricated.warm.status = "MET";
  fabricated.status = "MET";
  fabricated.gates.local = "MET";
  fabricated.provenance.captureSha256 =
    evidenceModule.drawingP7CaptureSha256(fabricated);

  assert.throws(
    () => evidenceModule.inspectDrawingP7PerformanceEvidence(fabricated),
    /Playwright capture|runner capture|raw capture/i,
  );
});

test("paired one-millisecond raw capture and evidence forgeries have no standalone execution authority", () => {
  const capturePath = evidenceModule.P7_PERFORMANCE_PLAYWRIGHT_CAPTURE_PATH;
  const savedCapture = readFileSync(capturePath);
  try {
    const fabricatedCapture = JSON.parse(savedCapture);
    fabricatedCapture.source.commitSha =
      evidenceModule.drawingP7SourceCommitSha();
    fabricatedCapture.source.treeSha256 =
      evidenceModule.drawingP7SourceTreeSha256();
    fabricatedCapture.source.runnerSha256 = evidenceModule.drawingP7FileSha256(
      new URL("../scripts/run-drawing-p7-performance.mjs", import.meta.url),
    );
    fabricatedCapture.source.configSha256 = evidenceModule.drawingP7FileSha256(
      new URL("../playwright.p7-performance.config.ts", import.meta.url),
    );
    fabricatedCapture.source.build = {
      serverSha256: evidenceModule.drawingP7FileSha256(
        new URL("../build/server/index.js", import.meta.url),
      ),
      clientSha256: evidenceModule.drawingP7DirectorySha256(
        fileURLToPath(new URL("../build/client", import.meta.url)),
      ),
    };
    for (const stage of Object.values(fabricatedCapture.stages)) {
      stage.durationMs = 1;
      if ("startMs" in stage) {
        stage.startMs = 0;
        stage.endMs = 1;
      }
    }
    fabricatedCapture.pdfRaster.mountedAtMs = 1;
    for (const readiness of [
      fabricatedCapture.coldCacheMiss.readiness,
      fabricatedCapture.firstUsable.readiness,
    ])
      for (const key of Object.keys(readiness))
        readiness[key] = key === "navigationStartMs" ? 0 : 1;
    fabricatedCapture.warm.rawSamples.zoomMs.fill(1);
    fabricatedCapture.warm.rawSamples.panMs.fill(1);
    for (const sample of fabricatedCapture.warm.rawSamples.selection)
      sample.durationMs = 1;
    const fabricatedEvidence =
      evidenceModule.drawingP7EvidenceFromPlaywrightCapture(fabricatedCapture);
    writeFileSync(
      capturePath,
      `${JSON.stringify(fabricatedCapture, null, 2)}\n`,
    );

    assert.throws(
      () =>
        evidenceModule.validateDrawingP7PerformanceEvidence(fabricatedEvidence),
      /standalone.*authority|immutable|signed receipt/i,
    );
  } finally {
    writeFileSync(capturePath, savedCapture);
  }
});

test("P7 records a raw cold cache-miss boundary and derives its threshold status", () => {
  const { coldCacheMiss } = runnerEvidence;
  const derivedStatus = (durationMs, targetMs) =>
    durationMs <= targetMs ? "MET" : "NOT MET";

  assert.equal(runnerEvidence.schemaVersion, 4);
  assert.equal(coldCacheMiss.cacheStatus, "MISS");
  assert.equal(coldCacheMiss.targetMs, 2_500);
  assert.equal(
    coldCacheMiss.status,
    derivedStatus(coldCacheMiss.durationMs, coldCacheMiss.targetMs),
  );
  assert.equal(
    coldCacheMiss.durationMs,
    coldCacheMiss.readiness.usableFrameEndMs -
      coldCacheMiss.readiness.navigationStartMs,
  );
});

test("the browser capture records cold status without asserting a fixed outcome", () => {
  const source = readFileSync(
    new URL("../e2e/drawing-workspace-p7-performance.spec.ts", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(
    source,
    /coldCacheMiss\.durationMs\s*>\s*2_500[\s\S]{0,180}toBe\("NOT MET"\)/,
  );
});

test("a later Playwright failure removes evidence written earlier in the run", () => {
  assert.equal(
    typeof evidenceModule.removeDrawingP7FailedRunArtifacts,
    "function",
  );
  const directory = mkdtempSync(join(tmpdir(), "drawing-p7-late-failure-"));
  const evidence = join(directory, "evidence.json");
  const capture = join(directory, "capture.json");
  writeFileSync(evidence, '{"status":"MET"}\n');
  writeFileSync(capture, '{"firstUsableMs":1}\n');

  evidenceModule.removeDrawingP7FailedRunArtifacts(1, [evidence, capture]);

  assert.equal(existsSync(evidence), false);
  assert.equal(existsSync(capture), false);
});

test("the runner removes an early MET artifact when a later Playwright test exits nonzero", async () => {
  const evidencePath = evidenceModule.P7_PERFORMANCE_EVIDENCE_PATH;
  const capturePath = evidenceModule.P7_PERFORMANCE_PLAYWRIGHT_CAPTURE_PATH;
  const savedEvidence = readFileSync(evidencePath);
  const savedCapture = readFileSync(capturePath);
  let temporaryCapturePath = "";
  try {
    const status = await runnerModule.runDrawingP7PerformanceGate(
      [],
      process.env,
      async (argv, environment) => {
        if (argv[0] === "npm") return 0;
        temporaryCapturePath = environment.P7_PLAYWRIGHT_CAPTURE_PATH;
        writeFileSync(evidencePath, '{"status":"MET"}\n');
        writeFileSync(temporaryCapturePath, '{"firstUsableMs":1}\n');
        return 1;
      },
    );
    assert.equal(status, 1);
    assert.equal(existsSync(evidencePath), false);
    assert.equal(existsSync(capturePath), false);
    assert.equal(existsSync(temporaryCapturePath), false);
  } finally {
    writeFileSync(evidencePath, savedEvidence);
    writeFileSync(capturePath, savedCapture);
  }
});

test("complete warm and interaction threshold misses remain durable NOT MET evidence", async () => {
  const evidencePath = evidenceModule.P7_PERFORMANCE_EVIDENCE_PATH;
  const capturePath = evidenceModule.P7_PERFORMANCE_PLAYWRIGHT_CAPTURE_PATH;
  const savedEvidence = readFileSync(evidencePath);
  const savedCapture = readFileSync(capturePath);
  const baselineCapture = JSON.parse(savedCapture);
  try {
    for (const kind of ["firstUsable", "interaction"]) {
      const status = await runnerModule.runDrawingP7PerformanceGate(
        [],
        process.env,
        async (argv, environment) => {
          if (argv[0] === "npm") return 0;
          const capture = structuredClone(baselineCapture);
          capture.runId = environment.P7_RUN_ID;
          capture.source = {
            commitSha: environment.P7_SOURCE_COMMIT_SHA,
            treeSha256: environment.P7_SOURCE_TREE_SHA256,
            runnerSha256: environment.P7_RUNNER_SHA256,
            configSha256: environment.P7_CONFIG_SHA256,
            build: {
              serverSha256: environment.P7_BUILD_SERVER_SHA256,
              clientSha256: environment.P7_BUILD_CLIENT_SHA256,
            },
          };
          if (kind === "firstUsable")
            capture.firstUsable.readiness.usableFrameEndMs = 2_500.1;
          else
            for (const sample of capture.warm.rawSamples.selection)
              sample.durationMs = 16.8;
          writeFileSync(
            environment.P7_PLAYWRIGHT_CAPTURE_PATH,
            `${JSON.stringify(capture, null, 2)}\n`,
          );
          return 0;
        },
      );
      assert.equal(status, 1, `${kind} miss must fail the local gate`);
      assert.equal(existsSync(evidencePath), true);
      assert.equal(existsSync(capturePath), true);
      const evidence = JSON.parse(readFileSync(evidencePath, "utf8"));
      assert.equal(evidence.status, "NOT MET");
      assert.equal(
        kind === "firstUsable"
          ? evidence.firstUsable.status
          : evidence.warm.status,
        "NOT MET",
      );
    }
  } finally {
    writeFileSync(evidencePath, savedEvidence);
    writeFileSync(capturePath, savedCapture);
  }
});

test("P7 requires source-rendered PDF.js pixels and treats a cache hit as provisional", () => {
  assert.equal(runnerEvidence.pdfRaster.cacheStatus, "UNVERIFIED_HIT");
  assert.equal(runnerEvidence.pdfRaster.authority, "PDFJS");
  assert.match(runnerEvidence.pdfRaster.keySha256, /^[0-9a-f]{64}$/);
  assert.ok(runnerEvidence.pdfRaster.mountedAtMs > 0);
  assert.ok(runnerEvidence.pdfRaster.screenPixelRatio >= 1.5);

  const provisional = structuredClone(runnerEvidence);
  provisional.pdfRaster.authority = "UNVERIFIED_DERIVED_CACHE";
  provisional.provenance.captureSha256 =
    evidenceModule.drawingP7CaptureSha256(provisional);
  assert.throws(
    () => evidenceModule.inspectDrawingP7PerformanceEvidence(provisional),
    /runner Playwright capture authority/,
  );
});

test("P7 derives readiness and p95 from raw samples instead of trusting summaries", () => {
  assert.equal(
    runnerEvidence.stages.ifc.durationMs,
    runnerEvidence.stages.ifc.endMs - runnerEvidence.stages.ifc.startMs,
  );
  assert.ok(
    runnerEvidence.warm.rawSamples.selection.every(({ durationMs }) =>
      Number.isFinite(durationMs),
    ),
  );
  const runnerCapture = JSON.parse(
    readFileSync(evidenceModule.P7_PERFORMANCE_PLAYWRIGHT_CAPTURE_PATH, "utf8"),
  );
  const derived =
    evidenceModule.drawingP7EvidenceFromPlaywrightCapture(runnerCapture);
  assert.equal(
    derived.firstUsable.durationMs,
    runnerCapture.firstUsable.readiness.usableFrameEndMs,
  );
  assert.equal(
    derived.coldCacheMiss.durationMs,
    runnerCapture.coldCacheMiss.readiness.usableFrameEndMs,
  );
  const firstUsableMutation = structuredClone(runnerEvidence);
  firstUsableMutation.firstUsable.durationMs -= 1;
  firstUsableMutation.provenance.captureSha256 =
    evidenceModule.drawingP7CaptureSha256(firstUsableMutation);
  assert.throws(
    () =>
      evidenceModule.inspectDrawingP7PerformanceEvidence(firstUsableMutation),
    /runner Playwright capture authority/,
  );

  const p95Mutation = structuredClone(runnerEvidence);
  p95Mutation.warm.p95Ms.selection = 0;
  p95Mutation.provenance.captureSha256 =
    evidenceModule.drawingP7CaptureSha256(p95Mutation);
  assert.throws(
    () => evidenceModule.inspectDrawingP7PerformanceEvidence(p95Mutation),
    /runner Playwright capture authority/,
  );
});

test("invalid evidence removes a stale MET artifact instead of preserving it", () => {
  const directory = mkdtempSync(join(tmpdir(), "drawing-p7-evidence-"));
  const target = join(directory, "evidence.json");
  writeFileSync(target, '{"status":"MET"}\n');

  assert.throws(() =>
    evidenceModule.finalizeDrawingP7PerformanceEvidence(
      {},
      {
        capturePath: join(directory, "missing-playwright-capture.json"),
        targetPath: target,
      },
    ),
  );
  assert.equal(existsSync(target), false);
});

test("the runner artifact is inspectable but has no standalone execution authority", () => {
  const capture = JSON.parse(
    readFileSync(evidenceModule.P7_PERFORMANCE_PLAYWRIGHT_CAPTURE_PATH, "utf8"),
  );
  assert.equal(capture.authority, "P7_PLAYWRIGHT_RAW_CAPTURE_V1");
  assert.equal(capture.runId, runnerEvidence.provenance.runId);
  assert.equal(
    evidenceModule.drawingP7PlaywrightCaptureSha256(capture),
    runnerEvidence.provenance.playwrightCaptureSha256,
  );
  assert.doesNotThrow(() =>
    evidenceModule.inspectDrawingP7PerformanceEvidence(runnerEvidence),
  );
  assert.throws(
    () => evidenceModule.validateDrawingP7PerformanceEvidence(runnerEvidence),
    /standalone.*authority/i,
  );
});

test("only the server-loaded revision callsite carries code-only hydration authority", () => {
  const source = readFileSync(
    new URL("../app/lukas/components/drawing-workspace.tsx", import.meta.url),
    "utf8",
  );
  assert.equal(source.match(/DRAWING_SERVER_VALIDATED_HYDRATION/g)?.length, 2);
  const bootstrapBoundary = source.slice(
    source.indexOf("function drawingStateFromBootstrap"),
    source.indexOf("export default function DrawingWorkspaceClient"),
  );
  assert.doesNotMatch(bootstrapBoundary, /DRAWING_SERVER_VALIDATED_HYDRATION/);
  assert.match(source, /data-edit-ready=\{editReady \? "true" : "false"\}/);
});
