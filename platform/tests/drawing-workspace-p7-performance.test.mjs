import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const evidenceModule =
  await import("../scripts/drawing-p7-performance-evidence.mjs").catch(
    () => ({}),
  );

test("P7 evidence requires exact 10k production stages, budgets, and 100 deterministic hashes", () => {
  assert.equal(
    typeof evidenceModule.validateDrawingP7PerformanceEvidence,
    "function",
    "P7 performance evidence validator must exist",
  );
  const sha = "a".repeat(40);
  const fixtureHash = evidenceModule.P7_DETERMINISTIC_HASHES.fixture;
  const renderOrderHash = evidenceModule.P7_DETERMINISTIC_HASHES.renderOrder;
  const projectionHash = evidenceModule.P7_DETERMINISTIC_HASHES.projection;
  const evidence = {
    schemaVersion: 1,
    status: "MET",
    authority: "LOCAL_PRODUCTION_BUILD_CHROMIUM",
    sourceCommitSha: sha,
    browserName: "chromium",
    browserVersion: "140.0.7339.16",
    userAgent: "Chromium test authority",
    viewport: { width: 1440, height: 900 },
    cpu: { model: "test", logicalCount: 8 },
    memory: { totalBytes: 1_000_000, freeBytesAtMeasurement: 500_000 },
    workload: {
      objects: 10_000,
      objectMix: {
        wall: 2_000,
        opening: 2_000,
        space: 1_500,
        area: 1_500,
        grid: 1_500,
        arc: 1_500,
      },
      authoritativeObjects: 10_000,
      projectedObjects: 1_850,
      accessibleObjects: 1_848,
      sourceLinks: 2,
      selectedIfcModels: 1,
      activePdfPages: 1,
    },
    conditions: {
      firstUsable:
        "cold exact 10,000-object document navigation after warming application, PDF, and IFC assets; usable after hydration, authoritative-state confirmation, non-empty viewport projection, and the next animation frame",
      warm: "same mounted exact 10,000-object workspace after two zoom gestures and one pan gesture; event dispatch to next animation frame",
    },
    stages: {
      loader: {
        authority: "LOCAL_PRODUCTION_SERVER",
        durationMs: 20,
      },
      ssr: { authority: "LOCAL_PRODUCTION_SERVER", durationMs: 30 },
      hydration: {
        authority: "LOCAL_PRODUCTION_BUILD_CHROMIUM",
        durationMs: 40,
      },
      styleResolution: {
        authority: "LOCAL_PRODUCTION_BUILD_CHROMIUM",
        durationMs: 2,
      },
      renderAdapter: {
        authority: "LOCAL_PRODUCTION_BUILD_CHROMIUM",
        durationMs: 15,
      },
      konvaMount: {
        authority: "LOCAL_PRODUCTION_BUILD_CHROMIUM",
        durationMs: 60,
      },
      snapHitPreparation: {
        authority: "LOCAL_PRODUCTION_BUILD_CHROMIUM",
        durationMs: 4,
      },
      pdf: {
        authority: "LOCAL_PRODUCTION_BUILD_CHROMIUM",
        durationMs: 300,
      },
      ifc: {
        authority: "LOCAL_PRODUCTION_BUILD_CHROMIUM",
        durationMs: 500,
      },
    },
    firstUsable: { durationMs: 2_400, targetMs: 2_500, status: "MET" },
    warm: {
      samples: { zoom: 30, pan: 30, selection: 30 },
      p95Ms: { zoom: 10, pan: 11, selection: 12 },
      targetMs: 16.7,
      status: "MET",
    },
    determinism: {
      runs: 100,
      fixtureHashes: Array(100).fill(fixtureHash),
      renderOrderHashes: Array(100).fill(renderOrderHash),
      projectionHashes: Array(100).fill(projectionHash),
    },
    gates: { local: "MET", productionRuntime: "UNEXECUTED" },
  };

  assert.deepEqual(
    evidenceModule.validateDrawingP7PerformanceEvidence(evidence, sha),
    evidence,
  );
  assert.throws(
    () =>
      evidenceModule.validateDrawingP7PerformanceEvidence(
        {
          ...evidence,
          firstUsable: {
            ...evidence.firstUsable,
            status: "MET",
            durationMs: 2_501,
          },
        },
        sha,
      ),
    /first usable status/,
  );
  assert.throws(
    () =>
      evidenceModule.validateDrawingP7PerformanceEvidence(
        {
          ...evidence,
          determinism: {
            ...evidence.determinism,
            renderOrderHashes: evidence.determinism.renderOrderHashes.slice(1),
          },
        },
        sha,
      ),
    /render order hashes/,
  );
  assert.throws(
    () =>
      evidenceModule.validateDrawingP7PerformanceEvidence(
        {
          ...evidence,
          stages: {
            ...evidence.stages,
            pdf: { authority: "UNEXECUTED", durationMs: 0 },
          },
        },
        sha,
      ),
    /pdf stage/,
  );
});

test("P7 performance gate runs the production build with the dedicated Chromium evidence spec", async () => {
  const [packageJson, config, spec] = await Promise.all([
    readFile(new URL("../package.json", import.meta.url), "utf8").then(
      JSON.parse,
    ),
    readFile(
      new URL("../playwright.p7-performance.config.ts", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL(
        "../e2e/drawing-workspace-p7-performance.spec.ts",
        import.meta.url,
      ),
      "utf8",
    ),
  ]);
  assert.equal(
    packageJson.scripts["test:e2e:drawing-workspace-p7:performance"],
    "P7_RELEASE_PRODUCTION_BUILD=1 playwright test e2e/drawing-workspace-p7-performance.spec.ts --config=playwright.p7-performance.config.ts --project=chromium --workers=1",
  );
  assert.match(config, /NODE_ENV=development npm run start/);
  assert.match(config, /reuseExistingServer: false/);
  assert.match(spec, /writeDrawingP7PerformanceEvidence/);
  assert.match(spec, /for \(let run = 0; run < 100; run \+= 1\)/);
  assert.match(spec, /drawing-workspace:pdf/);
  assert.match(spec, /drawing-workspace:ifc/);
});
