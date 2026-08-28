import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { renameSync } from "node:fs";

import {
  P7_PERFORMANCE_EVIDENCE_PATH,
  P7_PERFORMANCE_PLAYWRIGHT_CAPTURE_PATH,
  drawingP7DirectorySha256,
  drawingP7FileSha256,
  drawingP7SourceCommitSha,
  drawingP7SourceTreeSha256,
  finalizeDrawingP7PerformanceEvidence,
  removeDrawingP7FailedRunArtifacts,
} from "./drawing-p7-performance-evidence.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));

function execute(argv, environment) {
  return new Promise((resolve, reject) => {
    const child = spawn(argv[0], argv.slice(1), {
      cwd: root,
      env: environment,
      shell: false,
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code, signal) =>
      signal
        ? reject(new Error(`P7 performance gate terminated by ${signal}`))
        : resolve(code ?? 1),
    );
  });
}

export async function runDrawingP7PerformanceGate(
  args = process.argv.slice(2),
  environment = process.env,
  runner = execute,
  {
    evidencePath = P7_PERFORMANCE_EVIDENCE_PATH,
    capturePath = P7_PERFORMANCE_PLAYWRIGHT_CAPTURE_PATH,
  } = {},
) {
  removeDrawingP7FailedRunArtifacts(1, [evidencePath, capturePath]);
  const sourceCommitSha = drawingP7SourceCommitSha();
  const sourceTreeSha256 = drawingP7SourceTreeSha256();
  const buildStatus = await runner(["npm", "run", "build"], environment);
  if (buildStatus !== 0) {
    removeDrawingP7FailedRunArtifacts(buildStatus);
    return buildStatus;
  }
  if (drawingP7SourceTreeSha256() !== sourceTreeSha256)
    throw new Error("P7 source changed while its production build was created");

  const runId = randomUUID();
  const rawCapturePath = `${capturePath}.${runId}.tmp`;
  const provenance = {
    runId,
    sourceCommitSha,
    sourceTreeSha256,
    runnerSha256: drawingP7FileSha256(fileURLToPath(import.meta.url)),
    configSha256: drawingP7FileSha256(
      fileURLToPath(
        new URL("../playwright.p7-performance.config.ts", import.meta.url),
      ),
    ),
    build: {
      serverSha256: drawingP7FileSha256(
        fileURLToPath(new URL("../build/server/index.js", import.meta.url)),
      ),
      clientSha256: drawingP7DirectorySha256(
        fileURLToPath(new URL("../build/client", import.meta.url)),
      ),
    },
  };
  const runnerEnvironment = {
    ...environment,
    P7_RUN_ID: runId,
    P7_PLAYWRIGHT_CAPTURE_PATH: rawCapturePath,
    P7_SOURCE_COMMIT_SHA: sourceCommitSha,
    P7_SOURCE_TREE_SHA256: sourceTreeSha256,
    P7_RUNNER_SHA256: provenance.runnerSha256,
    P7_CONFIG_SHA256: provenance.configSha256,
    P7_BUILD_SERVER_SHA256: provenance.build.serverSha256,
    P7_BUILD_CLIENT_SHA256: provenance.build.clientSha256,
  };
  try {
    const playwrightStatus = await runner(
      [
        "./node_modules/.bin/playwright",
        "test",
        "e2e/drawing-workspace-p7-performance.spec.ts",
        "--config=playwright.p7-performance.config.ts",
        "--project=chromium",
        "--workers=1",
        ...args,
      ],
      runnerEnvironment,
    );
    if (playwrightStatus !== 0) {
      removeDrawingP7FailedRunArtifacts(playwrightStatus, [
        evidencePath,
        capturePath,
        rawCapturePath,
      ]);
      return playwrightStatus;
    }
    renameSync(rawCapturePath, capturePath);
    const evidence = finalizeDrawingP7PerformanceEvidence(provenance, {
      capturePath,
      targetPath: evidencePath,
    });
    return evidence.status === "MET" ? 0 : 1;
  } catch (error) {
    removeDrawingP7FailedRunArtifacts(1, [
      evidencePath,
      capturePath,
      rawCapturePath,
    ]);
    throw error;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1])
  runDrawingP7PerformanceGate().then(
    (code) => {
      process.exitCode = code;
    },
    (error) => {
      process.stderr.write(
        `${error instanceof Error ? error.message : String(error)}\n`,
      );
      process.exitCode = 1;
    },
  );
