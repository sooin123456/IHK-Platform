import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";

import { listNativeDrawingSymbols } from "../app/lukas/lib/drawing-native-symbols.ts";
import {
  buildNativeDrawingTemplate,
  listNativeDrawingTemplateKeys,
} from "../app/lukas/lib/drawing-native-templates.ts";
import { assertNativeAssetOutputKey } from "../scripts/verify-native-drawing-content.mjs";

const run = promisify(execFile);
const script = fileURLToPath(
  new URL("../scripts/verify-native-drawing-content.mjs", import.meta.url),
);

async function temporary(t) {
  const directory = await mkdtemp(
    path.join(tmpdir(), "1hk-native-content-test-"),
  );
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

const expectedSymbolKeys = [
  "door-double-1600",
  "door-single-800",
  "door-single-900",
  "door-single-1000",
  "door-sliding-1800",
  "furniture-bed-double-1600x2000",
  "furniture-bed-single-1000x2000",
  "furniture-cabinet-900x450",
  "furniture-chair-500x500",
  "furniture-desk-1200x600",
  "furniture-desk-1600x800",
  "furniture-meeting-table-4-seat-1800x900",
  "furniture-meeting-table-6-seat-2400x1000",
  "furniture-sofa-2-seat-1600x800",
  "furniture-sofa-3-seat-2200x800",
  "wall-l-partition-100",
  "wall-segment-100",
  "wall-segment-150",
  "wall-segment-200",
  "window-600",
  "window-900",
  "window-1200",
  "window-1500",
  "window-1800",
].sort();

function canonicalJson(value) {
  if (Array.isArray(value))
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  return JSON.stringify(value);
}

function captureSourceDefinitions() {
  const symbols = listNativeDrawingSymbols();
  assert.deepEqual(symbols.map(({ key }) => key).sort(), expectedSymbolKeys);
  const definitions = [
    ...symbols.map((definition) => ({ kind: "native_symbol", definition })),
    ...listNativeDrawingTemplateKeys().map((key) => ({
      kind: "workspace_template",
      definition: buildNativeDrawingTemplate(key),
    })),
  ];
  return new Map(
    definitions.map(({ kind, definition }) => {
      const canonical = canonicalJson(definition);
      return [
        `${kind}:${definition.key}`,
        {
          canonical,
          definition: structuredClone(definition),
          sha256: createHash("sha256").update(canonical).digest("hex"),
        },
      ];
    }),
  );
}

test("content verifier exports 24 editable symbols and four scaled native templates with independently verifiable file hashes", async (t) => {
  const sourceDefinitions = captureSourceDefinitions();
  const directory = path.join(await temporary(t), "release");
  const result = await run(process.execPath, [
    script,
    "--output-dir",
    directory,
  ]);
  assert.equal(result.stderr, "");
  const manifest = JSON.parse(
    await readFile(path.join(directory, "manifest.json"), "utf8"),
  );
  assert.equal(manifest.schemaVersion, "1hk-native-content-evidence/1");
  assert.equal(manifest.status, "local-content-verification-only");
  assert.equal(manifest.productionDwgQualified, false);
  assert.equal(manifest.publicRedistributionLicensed, false);
  const symbols = manifest.assets.filter(
    (asset) => asset.kind === "native_symbol",
  );
  assert.deepEqual(
    symbols.map((asset) => asset.key).sort(),
    expectedSymbolKeys,
  );
  const templates = manifest.assets.filter(
    (asset) => asset.kind === "workspace_template",
  );
  assert.deepEqual(templates.map((asset) => asset.key).sort(), [
    "finishes-takeoff",
    "measured-plan",
    "office-layout",
    "remodel-phases",
  ]);
  for (const template of templates)
    assert.deepEqual(template.outputProfile, {
      paper: "A3",
      orientation: "landscape",
      widthMillimeters: 420,
      heightMillimeters: 297,
      scaleDenominator: 50,
    });
  assert.equal(manifest.assets.length, sourceDefinitions.size);
  assert.equal((await readdir(directory)).length, 57);
  for (const entry of manifest.assets) {
    assert.match(entry.definitionFile, /^[a-z][a-z0-9-]+\.native\.json$/);
    assert.match(entry.previewFile, /^[a-z][a-z0-9-]+\.svg$/);
    const definitionText = await readFile(
      path.join(directory, entry.definitionFile),
      "utf8",
    );
    const definition = JSON.parse(definitionText);
    const source = sourceDefinitions.get(`${entry.kind}:${entry.key}`);
    assert.ok(
      source,
      `${entry.kind}:${entry.key} must exist in source capture`,
    );
    assert.deepEqual(definition, source.definition);
    assert.equal(definitionText.trimEnd(), source.canonical);
    assert.equal(
      createHash("sha256").update(definitionText.trimEnd()).digest("hex"),
      entry.contentSha256,
    );
    assert.equal(entry.contentSha256, source.sha256);
    assert.equal(definition.key, entry.key);
    assert.equal(definition.provenance.license, "NOASSERTION");
    assert.equal(definition.provenance.origin, "first-party-generated");
    const svg = await readFile(path.join(directory, entry.previewFile), "utf8");
    assert.equal(
      createHash("sha256").update(svg).digest("hex"),
      entry.previewSha256,
    );
    assert.match(svg, /<g data-export-id=/);
    assert.doesNotMatch(svg, /<image\b|NaN|Infinity|<script\b/);
    if (entry.kind === "workspace_template") {
      const root = svg.match(/<svg\b[^>]*>/)?.[0];
      assert.ok(root);
      assert.match(root, /\bwidth="420mm"/);
      assert.match(root, /\bheight="297mm"/);
      assert.match(root, /\bviewBox="0 0 21000 14850"/);
      assert.equal(definition.outputProfile.scaleDenominator, 50);
      assert.ok(
        Object.values(definition.structure.objects).some(
          (object) => object.geometry.type === "dimension",
        ),
      );
      assert.doesNotMatch(svg, /미보정|보정 확인 불가/);
      const expectedDimension = {
        "measured-plan": "6000.0 mm",
        "office-layout": "10000.0 mm",
        "remodel-phases": "8000.0 mm",
        "finishes-takeoff": "6000.0 mm",
      }[entry.key];
      const labels = [...svg.matchAll(/<text\b([^>]*)>([\s\S]*?)<\/text>/g)];
      const dimensionLabel = labels.find((label) =>
        label[2].includes(expectedDimension),
      );
      assert.ok(
        dimensionLabel,
        `${entry.key} must export its actual native mm dimension`,
      );
      assert.match(dimensionLabel[1], /\bfont-size="140"/);
      assert.doesNotMatch(dimensionLabel[1], /#dc2626/);
    }
  }
});

test("production output-key guard rejects unsafe and duplicate asset keys", () => {
  const seen = new Set();
  assert.doesNotThrow(() =>
    assertNativeAssetOutputKey("door-single-900", seen),
  );
  assert.throws(
    () => assertNativeAssetOutputKey("../door-single-900", seen),
    /safe, unique filenames/,
  );
  assert.throws(
    () => assertNativeAssetOutputKey("door-single-900", seen),
    /safe, unique filenames/,
  );
  assert.deepEqual([...seen], ["door-single-900"]);
});

test("content verifier refuses existing paths and symlinks without changing their contents", async (t) => {
  const directory = await temporary(t);
  const sentinel = path.join(directory, "sentinel.txt");
  await writeFile(sentinel, "user data\n");
  const link = path.join(await temporary(t), "linked-release");
  await symlink(directory, link);
  for (const target of [directory, link, sentinel]) {
    await assert.rejects(
      run(process.execPath, [script, "--output-dir", target]),
      (error) => {
        assert.equal(error.code, 1);
        assert.match(error.stderr, /already exists|EEXIST/);
        return true;
      },
    );
    assert.equal(await readFile(sentinel, "utf8"), "user data\n");
    assert.deepEqual(await readdir(directory), ["sentinel.txt"]);
  }
});

test("content verifier rejects incomplete, relative and extra arguments before creating output", async (t) => {
  const target = path.join(await temporary(t), "output");
  for (const args of [
    [],
    ["--output-dir"],
    ["--output-dir", "relative-output"],
    ["--output-dir", target, "--force"],
    ["--output-dir", target, "--output-dir", target],
  ]) {
    await assert.rejects(run(process.execPath, [script, ...args]), (error) => {
      assert.equal(error.code, 1);
      assert.match(error.stderr, /Usage:|absolute path/);
      return true;
    });
  }
  await assert.rejects(readdir(target), { code: "ENOENT" });
});
