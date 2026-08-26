import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import { drawingP3ProductionCredentialStatus } from "../e2e/utils/drawing-collaboration-fixture.ts";

const root = fileURLToPath(new URL("../", import.meta.url));

export const P4_LOCAL_RELEASE_GATES = [
  { label: "whole Node suite", command: "node --test tests/*.test.mjs" },
  {
    label: "Drawing Workspace suite",
    command: "npm run test:drawing-workspace",
  },
  {
    label: "collaboration service suite",
    command: "node --test tests/drawing-collaboration-service.test.mjs",
  },
  { label: "IFC geometry smoke", command: "npm run test:ifc" },
  {
    label: "IFC/PDF/quantity/approval/Revit regressions",
    command:
      "node --test tests/drawing-collaboration.test.mjs tests/drawing-approvals.test.mjs tests/drawing-workspace-export.test.mjs tests/verified-boq.test.mjs tests/element-ledger-suggestions.test.mjs tests/public-site-contract.test.mjs",
  },
  { label: "application typecheck", command: "npm run typecheck" },
  {
    label: "collaboration typecheck",
    command: "npm run typecheck:collaboration",
  },
  { label: "application build", command: "npm run build" },
  { label: "collaboration build", command: "npm run build:collaboration" },
  {
    label: "P4 Chromium functional and IndexedDB",
    command: "npm run test:e2e:drawing-workspace-p4:local",
  },
  {
    label: "P4 production-build performance",
    command: "npm run test:e2e:drawing-workspace-p4:performance",
  },
  {
    label: "license closure",
    command: "node --test tests/drawing-workspace-license.test.mjs",
  },
  {
    label: "application audit",
    command: "npm audit --omit=dev --audit-level=high",
  },
  {
    label: "collaboration audit",
    command: "npm --prefix collaboration audit --omit=dev --audit-level=high",
  },
  { label: "diff check", command: "git diff --check" },
];

function execute({ command }) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, {
      cwd: root,
      env: process.env,
      shell: true,
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code, signal) =>
      signal
        ? reject(new Error(`terminated by ${signal}`))
        : resolve(code ?? 1),
    );
  });
}

export async function runReleaseGates(gates, runner = execute) {
  for (const gate of gates) {
    process.stdout.write(`P4 LOCAL ${gate.label}\n`);
    const status = await runner(gate);
    if (status !== 0)
      throw new Error(
        `P4 release gate ${gate.label} failed with exit ${status}`,
      );
  }
}

async function main(mode) {
  if (mode === "local") {
    await runReleaseGates(P4_LOCAL_RELEASE_GATES);
    process.stdout.write("P4 LOCAL PASS\n");
    return;
  }
  if (mode !== "production")
    throw new Error(
      "Usage: run-drawing-workspace-p4-release.mjs local|production",
    );

  const status = drawingP3ProductionCredentialStatus(process.env);
  if (status.status !== "READY")
    throw new Error(
      `P4 production gate is UNEXECUTED: real values are required for ${status.missing.join(
        ", ",
      )}`,
    );
  await runReleaseGates([
    {
      label: "hosted P4 semantic and P3 collaboration authorities",
      command: "npm run test:e2e:drawing-workspace-p4:production",
    },
  ]);
  process.stdout.write("P4 PRODUCTION PASS\n");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1])
  main(process.argv[2]).catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
