import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { validateDrawingP7LicenseClosure } from "./drawing-p7-license-authority.mjs";

export function inspectCurrentDrawingP7LicensePolicy() {
  return validateDrawingP7LicenseClosure({
    packageJson: JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    ),
    lock: JSON.parse(
      readFileSync(new URL("../package-lock.json", import.meta.url), "utf8"),
    ),
    notice: readFileSync(
      new URL("../THIRD_PARTY_NOTICES.md", import.meta.url),
      "utf8",
    ),
    installedRoot: new URL("../node_modules/", import.meta.url),
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const result = inspectCurrentDrawingP7LicensePolicy();
  process.stdout.write(
    `${JSON.stringify(
      {
        policyStatus: result.policyStatus,
        packages: result.entries.length,
        nonPermissive: result.nonPermissive,
      },
      null,
      2,
    )}\n`,
  );
  process.exitCode = result.policyStatus === "PASS" ? 0 : 1;
}
