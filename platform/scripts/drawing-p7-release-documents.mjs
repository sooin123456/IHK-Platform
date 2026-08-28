import { randomUUID } from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

export const P7_RELEASE_REPORT_PATH = fileURLToPath(
  new URL(
    "../../.superpowers/sdd/2026-08-28-drawing-workspace-p7/task-7-report.md",
    import.meta.url,
  ),
);
export const P7_RELEASE_MATRIX_PATH = fileURLToPath(
  new URL("../../docs/P0_P7_IMPLEMENTATION_MATRIX.md", import.meta.url),
);

function atomicWrite(path, content) {
  mkdirSync(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporaryPath, content, { flag: "wx" });
    renameSync(temporaryPath, path);
  } finally {
    rmSync(temporaryPath, { force: true });
  }
}

function removeBestEffort(path) {
  try {
    rmSync(path, { force: true });
  } catch {}
}

function writePair(reportPath, report, matrixPath, matrix) {
  try {
    atomicWrite(reportPath, report);
    atomicWrite(matrixPath, matrix);
    validateDrawingP7ReleaseDocumentPair({ reportPath, matrixPath });
  } catch (error) {
    removeBestEffort(reportPath);
    removeBestEffort(matrixPath);
    throw error;
  }
}

function documentSet(content) {
  const match = content.match(/^Document set: `([^`]+)`$/m);
  if (!match) throw new Error("P7 release document set is missing");
  return match[1];
}

export function validateDrawingP7ReleaseDocumentPair({
  reportPath = P7_RELEASE_REPORT_PATH,
  matrixPath = P7_RELEASE_MATRIX_PATH,
}) {
  const reportSet = documentSet(readFileSync(reportPath, "utf8"));
  const matrixSet = documentSet(readFileSync(matrixPath, "utf8"));
  if (reportSet !== matrixSet)
    throw new Error(
      `P7 release document set mismatch: ${reportSet} != ${matrixSet}`,
    );
  return reportSet;
}

function duration(value) {
  return Number.isFinite(value) ? `${value.toFixed(1)}ms` : "UNEXECUTED";
}

function summary(evidence) {
  return `${evidence.summary.PASS} PASS / ${evidence.summary.NOT_MET} NOT_MET / ${evidence.summary.UNEXECUTED} UNEXECUTED`;
}

function requirementTable(evidence) {
  return evidence.requirements
    .map(
      ({ id, scope, status, authority }) =>
        `| \`${id}\` | ${scope} | **${status}** | ${authority} |`,
    )
    .join("\n");
}

function performanceSection(performance) {
  return [
    `- warm reopen: ${duration(performance.firstUsable?.durationMs)} (${performance.firstUsable?.status ?? "UNEXECUTED"})`,
    `- cold/cache-miss: ${duration(performance.coldCacheMiss?.durationMs)} (${performance.coldCacheMiss?.status ?? "UNEXECUTED"})`,
    `- warm p95: zoom ${duration(performance.warm?.p95Ms?.zoom)}, pan ${duration(performance.warm?.p95Ms?.pan)}, selection ${duration(performance.warm?.p95Ms?.selection)} (${performance.warm?.status ?? "UNEXECUTED"})`,
  ].join("\n");
}

function assertSourceBinding(evidence, performance) {
  if (performance.sourceCommitSha !== evidence.commit)
    throw new Error(
      `P7 release document performance source mismatch: ${performance.sourceCommitSha ?? "missing"} != ${evidence.commit}`,
    );
}

export function writeDrawingP7ReleaseDocuments(
  evidence,
  performance,
  {
    reportPath = P7_RELEASE_REPORT_PATH,
    matrixPath = P7_RELEASE_MATRIX_PATH,
  } = {},
) {
  assertSourceBinding(evidence, performance);
  const setId = `${evidence.runner.invocationId}:${evidence.commit}:${evidence.sourceTreeSha256}`;
  const shared = [
    `Document set: \`${setId}\``,
    `Source commit: \`${evidence.commit}\``,
    `Source tree SHA-256: \`${evidence.sourceTreeSha256}\``,
    `Overall: **${evidence.overall}**`,
    `Requirements: **${summary(evidence)}**`,
    "",
    "## Current source-bound performance",
    "",
    performanceSection(performance),
    "",
    "## Exact requirement ledger",
    "",
    "| Requirement | Scope | Status | Authority |",
    "| --- | --- | --- | --- |",
    requirementTable(evidence),
  ].join("\n");
  const ruling =
    evidence.overall === "PASS"
      ? "All requirements pass; external completion signature validation remains mandatory."
      : "The program is not complete. Every NOT_MET and UNEXECUTED requirement must remain fail-closed.";
  writePair(
    reportPath,
    `# P7 Task 7 — current release audit\n\n${shared}\n\n## Release ruling\n\n${ruling}\n`,
    matrixPath,
    `# 1HK Drawing Workspace P0–P7 current implementation matrix\n\n${shared}\n\n${ruling}\n`,
  );
  return { reportPath, matrixPath };
}

export function invalidateDrawingP7ReleaseDocuments({
  reportPath = P7_RELEASE_REPORT_PATH,
  matrixPath = P7_RELEASE_MATRIX_PATH,
  commit,
  invocationId,
}) {
  const content = [
    "# P7 Task 7 — release audit in progress",
    "",
    `Document set: \`${invocationId}:${commit}:UNEXECUTED\``,
    `Source commit: \`${commit}\``,
    `Invocation: \`${invocationId}\``,
    "Overall: **UNEXECUTED**",
    "",
    "The current run has not produced a validated ledger. This fail-closed marker replaces any result from an older run.",
    "",
  ].join("\n");
  writePair(reportPath, content, matrixPath, content);
  return { reportPath, matrixPath };
}
