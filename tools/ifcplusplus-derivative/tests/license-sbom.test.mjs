import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

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
