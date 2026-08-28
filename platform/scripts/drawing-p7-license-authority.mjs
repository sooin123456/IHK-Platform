import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const drawingRoots = [
  "@electric-sql/pglite",
  "@hocuspocus/provider",
  "@hocuspocus/server",
  "fflate",
  "gltf-validator",
  "jose",
  "konva",
  "pdf-lib",
  "pdfjs-dist",
  "react-konva",
  "three",
  "web-ifc",
  "y-indexeddb",
  "y-protocols",
  "yjs",
];

const permissiveLicenses = new Set([
  "(MIT AND Zlib)",
  "0BSD",
  "Apache-2.0",
  "MIT",
]);
const recognizedLicenses = new Set([...permissiveLicenses, "MPL-2.0"]);

function resolveLockedDependency(packages, parentPath, dependencyName) {
  let directory = parentPath;
  while (true) {
    const candidate = directory
      ? `${directory}/node_modules/${dependencyName}`
      : `node_modules/${dependencyName}`;
    if (packages[candidate]) return candidate;
    const marker = directory.lastIndexOf("/node_modules/");
    if (marker >= 0) directory = directory.slice(0, marker);
    else if (directory.startsWith("node_modules/")) directory = "";
    else break;
  }
  throw new Error(`${parentPath} has unresolved dependency ${dependencyName}`);
}

function installedLicense(installedRoot, packagePath) {
  const relative = packagePath.replace(/^node_modules\//, "");
  const manifest = new URL(`${relative}/package.json`, installedRoot);
  return JSON.parse(readFileSync(fileURLToPath(manifest), "utf8")).license;
}

export function validateDrawingP7LicenseClosure({
  packageJson,
  lock,
  notice,
  installedRoot,
}) {
  const pending = drawingRoots.map((name) => `node_modules/${name}`);
  const packages = new Set();
  while (pending.length) {
    const packagePath = pending.pop();
    if (packages.has(packagePath)) continue;
    const entry = lock.packages[packagePath];
    assert.ok(entry, `${packagePath} is absent from the lockfile`);
    packages.add(packagePath);
    for (const dependencyName of Object.keys(entry.dependencies ?? {}))
      pending.push(
        resolveLockedDependency(lock.packages, packagePath, dependencyName),
      );
  }
  for (const name of drawingRoots) {
    const declared =
      packageJson.dependencies[name] ?? packageJson.devDependencies[name];
    assert.ok(declared, `${name} is not a direct drawing dependency`);
    const entry = lock.packages[`node_modules/${name}`];
    assert.equal(
      entry.version,
      declared.replace(/^[~^]/, ""),
      `${name} version`,
    );
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    assert.match(
      notice,
      new RegExp(`\\|\\s*${escaped}\\s*\\|`, "i"),
      `${name} notice`,
    );
  }
  const entries = [];
  for (const packagePath of [...packages].sort()) {
    const entry = lock.packages[packagePath];
    const license =
      entry.license ?? installedLicense(installedRoot, packagePath);
    assert.equal(
      recognizedLicenses.has(license),
      true,
      `${packagePath} has prohibited or unknown license ${String(license)}`,
    );
    const escapedPath = packagePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    assert.match(
      notice,
      new RegExp(`\\|\\s*${escapedPath}\\s*\\|`),
      `${packagePath} transitive notice`,
    );
    entries.push({ packagePath, version: entry.version, license });
  }
  const nonPermissive = entries
    .filter(({ license }) => !permissiveLicenses.has(license))
    .map(({ packagePath, license }) => ({ packagePath, license }));
  return {
    packages: entries.map(({ packagePath }) => packagePath),
    entries,
    nonPermissive,
    policyStatus: nonPermissive.length === 0 ? "PASS" : "NOT_MET",
  };
}
