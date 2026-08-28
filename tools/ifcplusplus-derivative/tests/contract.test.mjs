import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const binary = process.env.IFCPP_DERIVATIVE_BIN;
assert.ok(binary, "set IFCPP_DERIVATIVE_BIN to the compiled converter");
const validatorRoot = new URL("../node_modules/gltf-validator/", import.meta.url);
for (const [name, expected] of Object.entries({
  "package.json": "3578d16153fa237c72784588da2e8fcccc9cd3c1c58ef34c7912f0732d2f5fa6",
  "index.js": "78deff9ea85743e86461c2d14fae76e7fc3ca0432e652f62948066b55fa16f0d",
  "gltf_validator.dart.js": "b73a7b2d455ac217567725138b46d826a13d7d1bb0c88c15f7c571bfb349298c",
})) {
  assert.equal(createHash("sha256").update(readFileSync(new URL(name, validatorRoot))).digest("hex"), expected, `unauthenticated glTF validator file: ${name}`);
}
const { validateBytes } = await import(new URL("index.js", validatorRoot));
const fixtures = new URL("./fixtures/", import.meta.url);
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");

function parseGlb(bytes) {
  assert.equal(bytes.readUInt32LE(0), 0x46546c67);
  assert.equal(bytes.readUInt32LE(4), 2);
  assert.equal(bytes.readUInt32LE(8), bytes.length);
  const jsonLength = bytes.readUInt32LE(12);
  assert.equal(bytes.readUInt32LE(16), 0x4e4f534a);
  const document = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString("utf8"));
  const binaryHeader = 20 + jsonLength;
  assert.equal(bytes.readUInt32LE(binaryHeader + 4), 0x004e4942);
  const binary = bytes.subarray(binaryHeader + 8);
  assert.equal(binary.length, document.buffers[0].byteLength);
  return { document, binary };
}

function run(source, extra = []) {
  const dir = mkdtempSync(join(tmpdir(), "1hk-ifcpp-test-"));
  const manifest = join(dir, "manifest.json");
  const glb = join(dir, "geometry.glb");
  const result = spawnSync(binary, [source, manifest, glb, "--source-file-id", "fixture-file", ...extra], { encoding: "utf8" });
  return { dir, manifest, glb, result };
}

test("enumerates proxy and wall with stable item/property IDs and canonical contract", async () => {
  const first = run(new URL("multi-product.ifc", fixtures).pathname);
  assert.equal(first.result.status, 0, first.result.stderr);
  const manifest = JSON.parse(readFileSync(first.manifest, "utf8"));
  assert.deepEqual(manifest.source.fileId, "fixture-file");
  assert.equal(manifest.source.sha256, digest(readFileSync(new URL("multi-product.ifc", fixtures))));
  assert.equal(manifest.geometry.sha256, digest(readFileSync(first.glb)));
  assert.equal(manifest.engine.commit, "7b80900197b1f17cdafe47e0548e8eec056a3c9c");
  assert.equal(manifest.units.lengthToMeters, 0.001);
  assert.deepEqual(manifest.elements.map((item) => item.type), ["IFCBUILDINGELEMENTPROXY", "IFCWALL"]);
  assert.deepEqual(manifest.elements.map((item) => item.expressId), [10, 20]);
  assert.deepEqual(manifest.elements.flatMap((item) => item.meshes).map((mesh) => mesh.nodeId), ["ifc:10:item:13", "ifc:20:item:23"]);
  assert.deepEqual(manifest.elements[0].properties.map(({ propertyId, groupId, group, name, value }) => ({ propertyId, groupId, group, name, value })), [
    { propertyId: 15, groupId: 17, group: "Pset_Identity", name: "Mark", value: "IFCLABEL('P-01')" },
    { propertyId: 16, groupId: 17, group: "Pset_Identity", name: "Mark", value: "IFCLABEL('P-01-duplicate')" },
  ]);
  const glb = readFileSync(first.glb);
  assert.equal(glb.subarray(0, 4).toString("ascii"), "glTF");
  assert.match(glb.toString("utf8"), /"extras":\{"expressId":10,"nodeId":"ifc:10:item:13"\}/);
  const parsed = parseGlb(glb);
  assert.equal(parsed.document.buffers[0].uri, undefined, "GLB must be self-contained");
  assert.equal(parsed.document.meshes.length, 2);
  assert.equal(parsed.binary.readFloatLE(4), 0, "first triangle y coordinate");
  assert.equal(parsed.binary.readFloatLE(12), 1, "1000 mm must become 1 m");
  const validation = await validateBytes(new Uint8Array(glb));
  assert.equal(validation.issues.numErrors, 0, JSON.stringify(validation.issues.messages, null, 2));
  assert.equal(validation.issues.numWarnings, 0, JSON.stringify(validation.issues.messages, null, 2));

  const second = run(new URL("multi-product.ifc", fixtures).pathname);
  assert.equal(second.result.status, 0, second.result.stderr);
  assert.deepEqual(readFileSync(second.manifest), readFileSync(first.manifest));
  assert.deepEqual(readFileSync(second.glb), readFileSync(first.glb));
});

test("mixed supported and unsupported geometry fails closed without artifacts", () => {
  const output = run(new URL("mixed-unsupported.ifc", fixtures).pathname);
  assert.notEqual(output.result.status, 0);
  assert.match(output.result.stderr, /unsupported representation item #6 IFCADVANCEDBREP/);
  assert.throws(() => statSync(output.manifest));
  assert.throws(() => statSync(output.glb));
});

test("rejects source-target identity before writing", () => {
  const source = new URL("multi-product.ifc", fixtures).pathname;
  const result = spawnSync(binary, [source, source, join(tmpdir(), "unused.glb"), "--source-file-id", "fixture-file"], { encoding: "utf8" });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /source and target paths must differ/);
});

test("pre-stat input limit rejects before parser allocation", () => {
  const source = new URL("multi-product.ifc", fixtures).pathname;
  const output = run(source, ["--max-input-bytes", String(statSync(source).size - 1)]);
  assert.notEqual(output.result.status, 0);
  assert.match(output.result.stderr, /input exceeds --max-input-bytes/);
  assert.throws(() => statSync(output.manifest));
  assert.throws(() => statSync(output.glb));
});

test("rejects finite IFC coordinates that overflow float after unit scaling", () => {
  const output = run(new URL("overflow.ifc", fixtures).pathname);
  assert.notEqual(output.result.status, 0);
  assert.match(output.result.stderr, /scaled coordinate is outside finite float range/);
  assert.throws(() => statSync(output.manifest));
  assert.throws(() => statSync(output.glb));
});

test("fails closed on unsupported property definitions", () => {
  const output = run(new URL("unsupported-quantity.ifc", fixtures).pathname);
  assert.notEqual(output.result.status, 0);
  assert.match(output.result.stderr, /unsupported property definition #7 IFCELEMENTQUANTITY/);
  assert.throws(() => statSync(output.manifest));
  assert.throws(() => statSync(output.glb));
});

test("enforces cumulative parser and derivative amplification caps", () => {
  const source = new URL("multi-product.ifc", fixtures).pathname;
  for (const [option, limit, message] of [
    ["--max-entities", "1", /entity count exceeds/],
    ["--max-vertices", "6", /vertex count exceeds/],
    ["--max-indices", "8", /index count exceeds/],
    ["--max-output-bytes", "64", /exceeds --max-output-bytes/],
    ["--max-properties", "1", /property count exceeds/],
  ]) {
    const output = run(source, [option, limit]);
    assert.notEqual(output.result.status, 0, option);
    assert.match(output.result.stderr, message);
    assert.throws(() => statSync(output.manifest));
    assert.throws(() => statSync(output.glb));
  }
});

test("rejects CLI caps outside GLB uint32 format bounds before extraction", () => {
  const source = new URL("multi-product.ifc", fixtures).pathname;
  for (const option of ["--max-vertices", "--max-indices", "--max-output-bytes"]) {
    const output = run(source, [option, "4294967296"]);
    assert.notEqual(output.result.status, 0, option);
    assert.match(output.result.stderr, new RegExp(`${option} exceeds GLB uint32 maximum`));
    assert.throws(() => statSync(output.manifest));
    assert.throws(() => statSync(output.glb));
  }
});

test("never clobbers existing targets and removes an uncommitted new GLB", () => {
  const source = new URL("multi-product.ifc", fixtures).pathname;
  const dir = mkdtempSync(join(tmpdir(), "1hk-no-clobber-"));
  const manifest = join(dir, "manifest.json");
  const glb = join(dir, "geometry.glb");
  writeFileSync(manifest, "existing-manifest");
  let result = spawnSync(binary, [source, manifest, glb, "--source-file-id", "fixture-file"], { encoding: "utf8" });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /target already exists/);
  assert.equal(readFileSync(manifest, "utf8"), "existing-manifest");
  assert.throws(() => statSync(glb), "new GLB must be removed when manifest publication fails");

  writeFileSync(glb, "existing-glb");
  result = spawnSync(binary, [source, manifest, glb, "--source-file-id", "fixture-file"], { encoding: "utf8" });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /target already exists/);
  assert.equal(readFileSync(manifest, "utf8"), "existing-manifest");
  assert.equal(readFileSync(glb, "utf8"), "existing-glb");
});

test("STEP entity preflight ignores declaration-like markers in strings and comments", () => {
  const output = run(new URL("lexical-markers.ifc", fixtures).pathname, ["--max-entities", "5"]);
  assert.equal(output.result.status, 0, output.result.stderr);
});

test("bounds property text before manifest serialization can amplify memory", () => {
  const source = readFileSync(new URL("multi-product.ifc", fixtures), "utf8").replace("P-01-duplicate", "X".repeat(8192));
  const dir = mkdtempSync(join(tmpdir(), "1hk-property-amplification-"));
  const path = join(dir, "amplified.ifc");
  writeFileSync(path, source);
  const output = run(path, ["--max-output-bytes", "4096"]);
  assert.notEqual(output.result.status, 0);
  assert.match(output.result.stderr, /metadata exceeds --max-output-bytes/);
  assert.throws(() => statSync(output.manifest));
  assert.throws(() => statSync(output.glb));
});
