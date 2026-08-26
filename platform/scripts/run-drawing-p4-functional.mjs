import { spawn } from "node:child_process";
import net from "node:net";
import { fileURLToPath } from "node:url";

import {
  P4_FUNCTIONAL_PORT,
  assertP4FunctionalBrowserAuthority,
  p4FunctionalBrowserAuthority,
} from "./drawing-p4-browser-authority.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));

export function assertP4FunctionalPortAvailable() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.unref();
    probe.once("error", (error) =>
      reject(
        new Error(
          `P4 functional port ${P4_FUNCTIONAL_PORT} is occupied; refusing stale or external server reuse`,
          { cause: error },
        ),
      ),
    );
    probe.listen(P4_FUNCTIONAL_PORT, "127.0.0.1", () => probe.close(resolve));
  });
}

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
        ? reject(new Error(`P4 functional Chromium terminated by ${signal}`))
        : resolve(code ?? 1),
    );
  });
}

export async function runP4FunctionalBrowserGate(environment = process.env) {
  const authority = assertP4FunctionalBrowserAuthority(
    p4FunctionalBrowserAuthority(environment),
  );
  await assertP4FunctionalPortAvailable();
  return execute(
    [
      "npx",
      "playwright",
      "test",
      "e2e/drawing-workspace-p4.spec.ts",
      "e2e/drawing-yjs-indexeddb.spec.ts",
      "--config=playwright.p4-functional.config.ts",
      "--project=chromium",
      "--workers=1",
    ],
    authority.environment,
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1])
  runP4FunctionalBrowserGate().then(
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
