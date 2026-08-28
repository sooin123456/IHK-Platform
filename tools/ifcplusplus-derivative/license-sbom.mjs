import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const build = resolve(process.argv[2] ?? "build/native");
const source = resolve(process.argv[3] ?? "build/vendor/ifcplusplus");
const commands = JSON.parse(readFileSync(join(build, "compile_commands.json"), "utf8"));
const forbidden = /\/external\/(?:Carve|zippy|nowide|zip-master)\//;
const records = [];

for (const command of commands) {
  const object = resolve(build, command.output);
  const dependencyFile = `${object}.d`;
  assert.ok(existsSync(dependencyFile), `missing dependency evidence for ${command.file}`);
  const dependencies = readFileSync(dependencyFile, "utf8")
    .replace(/\\\n/g, " ")
    .split(/\s+/)
    .slice(1)
    .map((entry) => entry.replaceAll("\\ ", " "))
    .filter((entry) => entry.startsWith(source));
  for (const file of dependencies) assert.ok(!forbidden.test(file), `forbidden dependency in compiled closure: ${file}`);
  records.push({
    source: relative(source, command.file),
    bundledIncludes: [...new Set(dependencies.map((file) => relative(source, file)))].sort(),
  });
}

const external = [...new Set(records.flatMap((record) => record.bundledIncludes)
  .filter((file) => file.includes("/external/"))
  .map((file) => file.match(/external\/([^/]+)/)?.[1])
  .filter(Boolean))].sort();
const licenses = { earcut: "ISC", glm: "MIT" };
for (const dependency of external) assert.ok(licenses[dependency], `unreviewed bundled dependency: ${dependency}`);

const sbom = {
  schemaVersion: 1,
  engine: { name: "IfcPlusPlus", commit: "7b80900197b1f17cdafe47e0548e8eec056a3c9c", license: "MIT" },
  permittedLicenses: ["MIT", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "ISC"],
  dependencies: external.map((name) => ({ name, license: licenses[name] })),
  compiledTranslationUnits: records.sort((a, b) => a.source.localeCompare(b.source)),
};
writeFileSync(join(dirname(build), "license-sbom.json"), `${JSON.stringify(sbom, null, 2)}\n`);
console.log(`verified ${records.length} compiled translation units; bundled dependencies: ${external.join(", ") || "none"}`);
