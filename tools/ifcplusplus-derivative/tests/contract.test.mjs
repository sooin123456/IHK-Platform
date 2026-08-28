import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const binary = process.env.IFCPP_DERIVATIVE_BIN;
assert.ok(binary, "set IFCPP_DERIVATIVE_BIN to the compiled converter");
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

test("enumerates proxy and wall with stable item/property IDs and canonical contract", () => {
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
