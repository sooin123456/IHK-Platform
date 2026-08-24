import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const IFC_URL =
  "https://raw.githubusercontent.com/ThatOpen/engine_web-ifc/3f6f3640b8317664194911fad63bcd407f7e32ca/examples/example.ifc";
const IFC_SHA256 =
  "db372f3f57796e2f572958c1c144bf3d8be7912493738636a2152cf18f08a14d";

let temporaryDirectory;
let input = process.argv[2];

try {
  if (!input) {
    const response = await fetch(IFC_URL);
    assert.equal(
      response.ok,
      true,
      `Pinned public IFC download failed with HTTP ${response.status}`,
    );
    const bytes = new Uint8Array(await response.arrayBuffer());
    const actualSha = createHash("sha256").update(bytes).digest("hex");
    assert.equal(actualSha, IFC_SHA256, "Pinned public IFC SHA-256 changed");
    temporaryDirectory = await mkdtemp(path.join(tmpdir(), "1hk-ifc-smoke-"));
    input = path.join(temporaryDirectory, "example.ifc");
    await writeFile(input, bytes);
  }

  const result = spawnSync(
    process.execPath,
    [path.resolve("tests/ifc-geometry-smoke.mjs"), path.resolve(input)],
    { stdio: "inherit" },
  );
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} finally {
  if (temporaryDirectory)
    await rm(temporaryDirectory, { recursive: true, force: true });
}
