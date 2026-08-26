import { spawn } from "node:child_process";
import { readdirSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import { fileURLToPath } from "node:url";

import { requireDrawingP3ProductionCredentials } from "../e2e/utils/drawing-collaboration-fixture.ts";

const root = fileURLToPath(new URL("../", import.meta.url));

function wholeNodeFiles() {
  return readdirSync(fileURLToPath(new URL("../tests/", import.meta.url)))
    .filter((file) => file.endsWith(".test.mjs"))
    .sort()
    .map((file) => `tests/${file}`);
}

function exactLocalManifest() {
  return [
    {
      label: "whole Node suite",
      argv: ["node", "--test", ...wholeNodeFiles()],
    },
    {
      label: "Drawing Workspace suite",
      argv: ["npm", "run", "test:drawing-workspace"],
    },
    {
      label: "collaboration service suite",
      argv: ["node", "--test", "tests/drawing-collaboration-service.test.mjs"],
    },
    { label: "IFC geometry smoke", argv: ["npm", "run", "test:ifc"] },
    {
      label: "IFC/PDF/quantity/approval/Revit regressions",
      argv: [
        "node",
        "--test",
        "tests/drawing-collaboration.test.mjs",
        "tests/drawing-approvals.test.mjs",
        "tests/drawing-workspace-export.test.mjs",
        "tests/verified-boq.test.mjs",
        "tests/element-ledger-suggestions.test.mjs",
        "tests/public-site-contract.test.mjs",
      ],
    },
    { label: "application typecheck", argv: ["npm", "run", "typecheck"] },
    {
      label: "collaboration typecheck",
      argv: ["npm", "run", "typecheck:collaboration"],
    },
    { label: "application build", argv: ["npm", "run", "build"] },
    {
      label: "collaboration build",
      argv: ["npm", "run", "build:collaboration"],
    },
    {
      label: "P4 Chromium functional and IndexedDB",
      argv: ["npm", "run", "test:e2e:drawing-workspace-p4:local"],
    },
    {
      label: "P4 production-build performance",
      argv: ["npm", "run", "test:e2e:drawing-workspace-p4:performance"],
    },
    {
      label: "P4 performance evidence",
      argv: ["node", "scripts/drawing-p4-performance-evidence.mjs", "validate"],
    },
    {
      label: "license closure",
      argv: ["node", "--test", "tests/drawing-workspace-license.test.mjs"],
    },
    {
      label: "application audit",
      argv: ["npm", "audit", "--omit=dev", "--audit-level=high"],
    },
    {
      label: "collaboration audit",
      argv: [
        "npm",
        "--prefix",
        "collaboration",
        "audit",
        "--omit=dev",
        "--audit-level=high",
      ],
    },
    {
      label: "diff check",
      argv: ["git", "--no-pager", "diff", "--check"],
    },
  ];
}

export const P4_LOCAL_RELEASE_GATES = exactLocalManifest();

export function assertExactP4LocalGateManifest(gates) {
  if (!isDeepStrictEqual(gates, exactLocalManifest()))
    throw new Error(
      "P4 local release manifest does not match the exact gate contract",
    );
}

function execute({ argv }) {
  return new Promise((resolve, reject) => {
    const child = spawn(argv[0], argv.slice(1), {
      cwd: root,
      env: {
        ...process.env,
        GIT_PAGER: "cat",
        GIT_TERMINAL_PROMPT: "0",
        PAGER: "cat",
      },
      shell: false,
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

export async function runReleaseGates(
  gates,
  { phase, runner = execute, log = (message) => process.stdout.write(message) },
) {
  if (phase !== "LOCAL" && phase !== "PRODUCTION")
    throw new Error("P4 release phase must be LOCAL or PRODUCTION");
  for (const gate of gates) {
    log(`P4 ${phase} ${gate.label}\n`);
    const status = await runner(gate);
    if (status !== 0)
      throw new Error(
        `P4 release gate ${gate.label} failed with exit ${status}`,
      );
  }
}

export function requireP4ProductionAuthorities(environment) {
  try {
    return requireDrawingP3ProductionCredentials(environment);
  } catch (error) {
    throw new Error(
      (error instanceof Error ? error.message : String(error)).replace(
        /^P3 production gate/,
        "P4 production gate",
      ),
    );
  }
}

async function main(mode) {
  if (mode === "local") {
    assertExactP4LocalGateManifest(P4_LOCAL_RELEASE_GATES);
    await runReleaseGates(P4_LOCAL_RELEASE_GATES, { phase: "LOCAL" });
    process.stdout.write("P4 LOCAL PASS\n");
    return;
  }
  if (mode !== "production")
    throw new Error(
      "Usage: run-drawing-workspace-p4-release.mjs local|production",
    );

  requireP4ProductionAuthorities(process.env);
  await runReleaseGates(
    [
      {
        label: "hosted P4 semantic and P3 collaboration authorities",
        argv: ["npm", "run", "test:e2e:drawing-workspace-p4:production"],
      },
    ],
    { phase: "PRODUCTION" },
  );
  process.stdout.write("P4 PRODUCTION PASS\n");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1])
  main(process.argv[2]).catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
