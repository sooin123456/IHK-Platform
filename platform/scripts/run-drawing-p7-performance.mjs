import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { rmSync } from "node:fs";

import {
  P7_PERFORMANCE_EVIDENCE_PATH,
  drawingP7DirectorySha256,
  drawingP7FileSha256,
  drawingP7SourceCommitSha,
  drawingP7SourceTreeSha256,
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
) {
  rmSync(P7_PERFORMANCE_EVIDENCE_PATH, { force: true });
  const sourceCommitSha = drawingP7SourceCommitSha();
  const sourceTreeSha256 = drawingP7SourceTreeSha256();
  const buildStatus = await runner(["npm", "run", "build"], environment);
  if (buildStatus !== 0) return buildStatus;
  if (drawingP7SourceTreeSha256() !== sourceTreeSha256)
    throw new Error("P7 source changed while its production build was created");

  const runnerEnvironment = {
    ...environment,
    P7_PERFORMANCE_RUNNER_AUTHORITY: "P7_PLAYWRIGHT_PRODUCTION_BUILD_V2",
    P7_SOURCE_COMMIT_SHA: sourceCommitSha,
    P7_SOURCE_TREE_SHA256: sourceTreeSha256,
    P7_RUNNER_SHA256: drawingP7FileSha256(fileURLToPath(import.meta.url)),
    P7_CONFIG_SHA256: drawingP7FileSha256(
      fileURLToPath(
        new URL("../playwright.p7-performance.config.ts", import.meta.url),
      ),
    ),
    P7_BUILD_SERVER_SHA256: drawingP7FileSha256(
      fileURLToPath(new URL("../build/server/index.js", import.meta.url)),
    ),
    P7_BUILD_CLIENT_SHA256: drawingP7DirectorySha256(
      fileURLToPath(new URL("../build/client", import.meta.url)),
    ),
  };
  return runner(
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
