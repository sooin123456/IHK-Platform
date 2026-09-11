import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const script = new URL("../scripts/check-licenses.mjs", import.meta.url);

function run(packages, resolve) {
  const directory = mkdtempSync(join(tmpdir(), "1hk-license-check-"));
  const metadata = join(directory, "metadata.json");
  writeFileSync(metadata, JSON.stringify({ packages, resolve }));
  return spawnSync(process.execPath, [script.pathname, metadata], { encoding: "utf8" });
}

test("accepts a closure made only of approved permissive licenses", () => {
  const result = run([
    { name: "a", version: "1.0.0", license: "MIT OR Apache-2.0" },
    { name: "b", version: "2.0.0", license: "BSD-3-Clause" },
  ]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /2 packages/);
});

test("rejects a package with a copyleft license", () => {
  const result = run([{ name: "bad", version: "1.0.0", license: "GPL-3.0-only" }]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /GPL-3.0-only/);
});

test("accepts an approved branch of an OR expression and legacy slash syntax", () => {
  const result = run([
    { name: "dual", version: "1.0.0", license: "Unlicense OR MIT" },
    { name: "legacy", version: "1.0.0", license: "MIT/Apache-2.0" },
  ]);
  assert.equal(result.status, 0, result.stderr);
});

test("rejects an unapproved term required by an AND expression", () => {
  const result = run([{
    name: "unicode",
    version: "1.0.0",
    license: "(MIT OR Apache-2.0) AND Unicode-3.0",
  }]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Unicode-3.0/);
});

test("rejects missing license metadata instead of guessing", () => {
  const result = run([{ name: "unknown", version: "1.0.0", license: null }]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /missing/);
});

test("checks only packages reachable in Cargo's resolved dependency graph", () => {
  const result = run(
    [
      { id: "root", name: "root", version: "1.0.0", license: "MIT" },
      { id: "used", name: "used", version: "1.0.0", license: "Apache-2.0" },
      { id: "optional", name: "optional", version: "1.0.0", license: "GPL-3.0-only" },
    ],
    {
      root: "root",
      nodes: [
        { id: "root", deps: [{ pkg: "used" }] },
        { id: "used", deps: [] },
        { id: "optional", deps: [] },
      ],
    },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /2 packages/);
});
