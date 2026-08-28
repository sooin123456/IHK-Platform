import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

test("pins the official validator version and npm integrity in-repo", () => {
  const root = new URL("../", import.meta.url);
  const packageJson = JSON.parse(readFileSync(new URL("package.json", root), "utf8"));
  const lock = JSON.parse(readFileSync(new URL("package-lock.json", root), "utf8"));
  assert.equal(packageJson.devDependencies["gltf-validator"], "2.0.0-dev.3.10");
  const dependency = lock.packages["node_modules/gltf-validator"];
  assert.equal(dependency.version, "2.0.0-dev.3.10");
  assert.equal(dependency.license, "Apache-2.0");
  assert.equal(dependency.integrity, "sha512-odJ4k0tRkGXiDGn78yDBg+fBbAIvBnXxh3RwAta0emSxGtyagFE8B4xELB1oYe3S5RD8Ci3uZAsZaascH2LAEQ==");
});

test("rejects a stale 46-TU closure containing Carve", () => {
  const root = mkdtempSync(join(tmpdir(), "1hk-stale-closure-"));
  const build = join(root, "native");
  const source = join(root, "vendor", "ifcplusplus");
  const commands = [];
  for (let index = 0; index < 46; index += 1) {
    const output = `objects/${index}.o`;
    const object = join(build, output);
    mkdirSync(join(object, ".."), { recursive: true });
    const include = index === 45 ? join(source, "IfcPlusPlus/src/external/Carve/include/carve.hpp") : join(source, `IfcPlusPlus/src/ifcpp/${index}.h`);
    writeFileSync(`${object}.d`, `${object}: ${include}\n`);
    commands.push({ directory: build, file: join(source, `tu-${index}.cpp`), output });
  }
  mkdirSync(build, { recursive: true });
  writeFileSync(join(build, "compile_commands.json"), JSON.stringify(commands));
  const result = spawnSync(process.execPath, [new URL("../license-sbom.mjs", import.meta.url).pathname, build, source], { encoding: "utf8" });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /forbidden dependency.*Carve/);
});
