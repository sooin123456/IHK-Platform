import { spawn } from "node:child_process";
import { isDeepStrictEqual } from "node:util";
import { fileURLToPath } from "node:url";

import { requireDrawingP3ProductionCredentials } from "../e2e/utils/drawing-collaboration-fixture.ts";

const root = fileURLToPath(new URL("../", import.meta.url));

function exactLocalManifest() {
  return [
    {
      label: "P0-P4 complete local release regression",
      argv: ["npm", "run", "release:drawing-workspace-p4:local"],
    },
    {
      label: "P5 development import-generation lifecycle",
      argv: ["npm", "run", "test:e2e:drawing-workspace-p5:dev-lifecycle"],
    },
    {
      label: "P5 production-build vertical and stable lifecycle",
      argv: ["npm", "run", "test:e2e:drawing-workspace-p5:local"],
    },
    {
      label: "P5 generated release evidence",
      argv: ["node", "scripts/drawing-p5-release-evidence.mjs", "validate"],
    },
    { label: "diff check", argv: ["git", "--no-pager", "diff", "--check"] },
  ];
}

export const P5_LOCAL_RELEASE_GATES = exactLocalManifest();

export function assertExactP5LocalGateManifest(gates) {
  if (!isDeepStrictEqual(gates, exactLocalManifest()))
    throw new Error(
      "P5 local release manifest does not match the exact gate contract",
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

export async function runP5ReleaseGates(
  gates,
  { phase, runner = execute, log = (message) => process.stdout.write(message) },
) {
  if (phase !== "LOCAL" && phase !== "PRODUCTION")
    throw new Error("P5 release phase must be LOCAL or PRODUCTION");
  for (const gate of gates) {
    log(`P5 ${phase} ${gate.label}\n`);
    const status = await runner(gate);
    if (status !== 0)
      throw new Error(
        `P5 release gate ${gate.label} failed with exit ${status}`,
      );
  }
}

export function requireP5ProductionAuthorities(environment) {
  let p3;
  try {
    p3 = requireDrawingP3ProductionCredentials(environment);
  } catch (error) {
    throw new Error(
      (error instanceof Error ? error.message : String(error)).replace(
        /^P3 production gate/,
        "P5 production gate",
      ),
    );
  }
  const corsOrigin = environment.P5_E2E_STORAGE_CORS_ORIGIN?.trim();
  if (!corsOrigin)
    throw new Error(
      "P5 production gate is UNEXECUTED: real P5_E2E_STORAGE_CORS_ORIGIN is required",
    );
  let expectedOrigin;
  try {
    expectedOrigin = new URL(p3.E2E_BASE_URL).origin;
  } catch {
    throw new Error(
      "P5 production gate is UNEXECUTED: E2E_BASE_URL is invalid",
    );
  }
  if (corsOrigin !== expectedOrigin)
    throw new Error(
      "P5 production gate is UNEXECUTED: Storage CORS origin must exactly match E2E_BASE_URL origin",
    );
  return { ...p3, P5_E2E_STORAGE_CORS_ORIGIN: corsOrigin };
}

async function main(mode) {
  if (mode === "local") {
    assertExactP5LocalGateManifest(P5_LOCAL_RELEASE_GATES);
    await runP5ReleaseGates(P5_LOCAL_RELEASE_GATES, { phase: "LOCAL" });
    process.stdout.write("P5 LOCAL PASS\n");
    return;
  }
  if (mode !== "production")
    throw new Error(
      "Usage: run-drawing-workspace-p5-release.mjs local|production",
    );
  requireP5ProductionAuthorities(process.env);
  await runP5ReleaseGates(
    [
      {
        label: "hosted P0-P4 provider and database authorities",
        argv: ["npm", "run", "release:drawing-workspace-p4:production"],
      },
      {
        label: "hosted P5 signed source, two-user review, and atomic relink",
        argv: ["npm", "run", "test:e2e:drawing-workspace-p5:production"],
      },
    ],
    { phase: "PRODUCTION" },
  );
  process.stdout.write("P5 PRODUCTION PASS\n");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1])
  main(process.argv[2]).catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
