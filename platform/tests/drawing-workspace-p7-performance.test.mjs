import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const evidenceModule =
  await import("../scripts/drawing-p7-performance-evidence.mjs").catch(
    () => ({}),
  );

const evidencePath = new URL(
  "../../.superpowers/sdd/2026-08-28-drawing-workspace-p7/task-4-performance-evidence.json",
  import.meta.url,
);
const runnerEvidence = JSON.parse(readFileSync(evidencePath, "utf8"));

test("P7 rejects the old handwritten summary and validates only the runner-produced raw capture", () => {
  assert.equal(
    typeof evidenceModule.validateDrawingP7PerformanceEvidence,
    "function",
  );
  assert.equal(runnerEvidence.schemaVersion, 2);
  assert.doesNotThrow(() =>
    evidenceModule.validateDrawingP7PerformanceEvidence(runnerEvidence),
  );

  const oldSummary = structuredClone(runnerEvidence);
  oldSummary.schemaVersion = 1;
  delete oldSummary.provenance;
  delete oldSummary.firstUsable.readiness;
  delete oldSummary.warm.rawSamples;
  assert.throws(
    () => evidenceModule.validateDrawingP7PerformanceEvidence(oldSummary),
    /schemaVersion|provenance|readiness|raw samples/,
  );
});

test("P7 raw timing, committed selection, and build provenance mutations fail closed", () => {
  const rawMutation = structuredClone(runnerEvidence);
  rawMutation.warm.rawSamples.selection[0].durationMs += 1;
  assert.throws(
    () => evidenceModule.validateDrawingP7PerformanceEvidence(rawMutation),
    /capture checksum/,
  );

  const selectionMutation = structuredClone(runnerEvidence);
  selectionMutation.warm.rawSamples.selection[0].committedObjectName =
    "not committed";
  selectionMutation.provenance.captureSha256 =
    evidenceModule.drawingP7CaptureSha256(selectionMutation);
  assert.throws(
    () =>
      evidenceModule.validateDrawingP7PerformanceEvidence(selectionMutation),
    /committed selection/,
  );

  const buildMutation = structuredClone(runnerEvidence);
  buildMutation.provenance.build.serverSha256 = "0".repeat(64);
  buildMutation.provenance.captureSha256 =
    evidenceModule.drawingP7CaptureSha256(buildMutation);
  assert.throws(
    () => evidenceModule.validateDrawingP7PerformanceEvidence(buildMutation),
    /build provenance/,
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
  const firstUsableMutation = structuredClone(runnerEvidence);
  firstUsableMutation.firstUsable.durationMs -= 1;
  firstUsableMutation.provenance.captureSha256 =
    evidenceModule.drawingP7CaptureSha256(firstUsableMutation);
  assert.throws(
    () =>
      evidenceModule.validateDrawingP7PerformanceEvidence(firstUsableMutation),
    /first usable duration/,
  );

  const p95Mutation = structuredClone(runnerEvidence);
  p95Mutation.warm.p95Ms.selection = 0;
  p95Mutation.provenance.captureSha256 =
    evidenceModule.drawingP7CaptureSha256(p95Mutation);
  assert.throws(
    () => evidenceModule.validateDrawingP7PerformanceEvidence(p95Mutation),
    /selection p95/,
  );
});

test("invalid evidence removes a stale MET artifact instead of preserving it", () => {
  const directory = mkdtempSync(join(tmpdir(), "drawing-p7-evidence-"));
  const target = join(directory, "evidence.json");
  writeFileSync(target, '{"status":"MET"}\n');

  assert.throws(() =>
    evidenceModule.writeDrawingP7PerformanceEvidence({}, target),
  );
  assert.equal(existsSync(target), false);
});

test("the evidence writer rejects replay outside the production runner", () => {
  const directory = mkdtempSync(join(tmpdir(), "drawing-p7-replay-"));
  const target = join(directory, "evidence.json");
  const replay = structuredClone(runnerEvidence);
  replay.provenance.sourceTreeSha256 =
    evidenceModule.drawingP7SourceTreeSha256();
  replay.provenance.runnerSha256 = evidenceModule.drawingP7FileSha256(
    new URL("../scripts/run-drawing-p7-performance.mjs", import.meta.url),
  );
  replay.provenance.captureSha256 =
    evidenceModule.drawingP7CaptureSha256(replay);

  assert.throws(
    () => evidenceModule.writeDrawingP7PerformanceEvidence(replay, target),
    /runner authority/,
  );
  assert.equal(existsSync(target), false);
});
