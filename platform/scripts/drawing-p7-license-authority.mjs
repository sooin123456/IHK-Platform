import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const drawingRoots = [
  "@electric-sql/pglite",
  "@hocuspocus/provider",
  "@hocuspocus/server",
  "dxf-parser",
  "fflate",
  "gltf-validator",
  "jose",
  "konva",
  "pdf-lib",
  "pdfjs-dist",
  "react-konva",
  "three",
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
const recognizedLicenses = permissiveLicenses;

const fixtureSource = {
  repository: "https://github.com/ThatOpen/engine_web-ifc",
  commit: "3f6f3640b8317664194911fad63bcd407f7e32ca",
  url: "https://raw.githubusercontent.com/ThatOpen/engine_web-ifc/3f6f3640b8317664194911fad63bcd407f7e32ca/examples/example.ifc",
  licenseUrl:
    "https://github.com/ThatOpen/engine_web-ifc/blob/3f6f3640b8317664194911fad63bcd407f7e32ca/LICENSE.md",
  sha256: "db372f3f57796e2f572958c1c144bf3d8be7912493738636a2152cf18f08a14d",
};
const fixtureGeometry = {
  name: "synthetic-ifc-mapping.glb",
  sha256: "cb450586de90c234831a6a206c0cb83078d65eca1870ac642680df5b5056270f",
};
const fixtureManifests = [
  {
    name: "synthetic-ifc-mapping.manifest.json",
    sha256: "65dc191d9089409f37d4757707e4a191bb7774ac4a64ac191384a67e3e85a17c",
  },
  {
    name: "synthetic-ifc-mapping-copy.manifest.json",
    sha256: "5c417a92f4e3feb6e61d19204e94eca0a131e89bc00c93c7aa5d1b5978147b82",
  },
];
const fixtureRepositoryPaths = [
  "public/examples/synthetic-ifc-mapping.glb",
  "public/examples/synthetic-ifc-mapping.manifest.json",
  "public/examples/synthetic-ifc-mapping-copy.manifest.json",
  "public/examples/IFC_FIXTURE_NOTICE.md",
  "public/examples/index.html",
];
const fixtureDeployedPaths = fixtureRepositoryPaths.map((path) =>
  path.replace(/^public/, ""),
);
const dxfFixture = {
  name: "extendeddata.dxf",
  repository: "https://github.com/gdsestimating/dxf-parser",
  commit: "0df7a37a4207a1f925b8d0bfffc270ff121446b4",
  url: "https://raw.githubusercontent.com/gdsestimating/dxf-parser/0df7a37a4207a1f925b8d0bfffc270ff121446b4/test/data/extendeddata.dxf",
  licenseUrl:
    "https://github.com/gdsestimating/dxf-parser/blob/0df7a37a4207a1f925b8d0bfffc270ff121446b4/LICENSE",
  sha256: "9b39289e3435fb187eb0e671fb8a07b8728cdf69a0275836f67ca005732f781d",
  byteSize: 102001,
  localPath: "tests/fixtures/dxf-parser/extendeddata.dxf",
  localLicensePath: "tests/fixtures/dxf-parser/LICENSE",
  copyStatus:
    "Exact, unmodified upstream bytes; original CRLF line endings preserved",
};
const dxfFixtureLicense = `The MIT License (MIT)

Copyright (c) 2015 GDS Storefront Estimating

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.`;

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function containsDxfParserModuleSpecifier(source) {
  return /["'`]dxf-parser(?:\/[^"'`]*)?["'`]/u.test(source);
}

export function validateDrawingP7DxfFixtureProvenance({
  fixture = readFileSync(
    fileURLToPath(new URL(`../${dxfFixture.localPath}`, import.meta.url)),
  ),
  fixtureLicense = readFileSync(
    fileURLToPath(
      new URL(`../${dxfFixture.localLicensePath}`, import.meta.url),
    ),
    "utf8",
  ),
  fixtureNotice = readFileSync(
    fileURLToPath(
      new URL(
        "../tests/fixtures/dxf-parser/DXF_FIXTURE_NOTICE.md",
        import.meta.url,
      ),
    ),
    "utf8",
  ),
  notice = readFileSync(
    fileURLToPath(new URL("../THIRD_PARTY_NOTICES.md", import.meta.url)),
    "utf8",
  ),
} = {}) {
  const fixtureSha256 = sha256(fixture);
  assert.equal(fixtureSha256, dxfFixture.sha256, `${dxfFixture.name} SHA-256`);
  assert.equal(fixture.length, dxfFixture.byteSize, `${dxfFixture.name} bytes`);
  assert.equal(
    fixtureLicense.replaceAll("\r\n", "\n").trimEnd(),
    dxfFixtureLicense,
    "DXF fixture must include the full MIT license",
  );

  const records = [
    ["Upstream repository", dxfFixture.repository],
    ["Upstream commit", dxfFixture.commit],
    ["Pinned raw URL", dxfFixture.url],
    ["Upstream license URL", dxfFixture.licenseUrl],
    ["Raw SHA-256", dxfFixture.sha256],
    ["Local SHA-256", dxfFixture.sha256],
    ["Raw byte size", String(dxfFixture.byteSize)],
    ["Local byte size", String(dxfFixture.byteSize)],
    ["Local path", dxfFixture.localPath],
    ["Local license path", dxfFixture.localLicensePath],
    ["Local copy status", dxfFixture.copyStatus],
  ];
  for (const document of [fixtureNotice, notice]) {
    for (const [label, value] of records) {
      const escapedValue = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      assert.match(
        document,
        new RegExp(`^\\|\\s*${label}\\s*\\|[^\\n]*${escapedValue}`, "mi"),
        `DXF fixture provenance is missing ${label}`,
      );
    }
    assert.match(
      document,
      /This is an OSS interoperability fixture\.\s+It is not customer data or customer acceptance\./i,
      "DXF fixture must be identified as OSS interoperability, not customer data or customer acceptance",
    );
  }

  return {
    policyStatus: "PASS",
    fixtureSha256,
    fixtureByteSize: fixture.length,
  };
}

export function validateDrawingP7FixtureProvenance({
  notice,
  publicNotice = readFileSync(
    fileURLToPath(
      new URL("../public/examples/IFC_FIXTURE_NOTICE.md", import.meta.url),
    ),
    "utf8",
  ),
  publicIndex = readFileSync(
    fileURLToPath(new URL("../public/examples/index.html", import.meta.url)),
    "utf8",
  ),
  geometry = readFileSync(
    fileURLToPath(
      new URL(`../public/examples/${fixtureGeometry.name}`, import.meta.url),
    ),
  ),
  manifests = fixtureManifests.map(({ name }) =>
    readFileSync(
      fileURLToPath(new URL(`../public/examples/${name}`, import.meta.url)),
    ),
  ),
}) {
  const noticeRecords = [
    ["Upstream repository", fixtureSource.repository],
    ["Upstream commit", fixtureSource.commit],
    ["Pinned source URL", fixtureSource.url],
    ["Upstream source license", fixtureSource.licenseUrl],
    ["Pinned source SHA-256", fixtureSource.sha256],
    ["Deployed GLB SHA-256", fixtureGeometry.sha256],
    ["Primary manifest SHA-256", fixtureManifests[0].sha256],
    ["Copy manifest SHA-256", fixtureManifests[1].sha256],
  ];
  for (const [label, value] of noticeRecords) {
    const escapedValue = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    assert.match(
      notice,
      new RegExp(`^\\|\\s*${label}\\s*\\|[^\\n]*${escapedValue}`, "mi"),
      `fixture notice is missing ${label}`,
    );
  }
  const repositoryPathsRecord = notice.match(
    /^\|\s*Repository public fixture paths\s*\|[^\n]*/im,
  )?.[0];
  assert.ok(
    repositoryPathsRecord,
    "fixture notice is missing Repository public fixture paths",
  );
  for (const fixturePath of fixtureRepositoryPaths) {
    assert.match(
      repositoryPathsRecord,
      new RegExp(fixturePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
      `Repository public fixture paths is missing ${fixturePath}`,
    );
  }
  const deployedPathsRecord = notice.match(
    /^\|\s*Deployed public fixture paths\s*\|[^\n]*/im,
  )?.[0];
  assert.ok(
    deployedPathsRecord,
    "fixture notice is missing Deployed public fixture paths",
  );
  for (const fixturePath of fixtureDeployedPaths) {
    assert.match(
      deployedPathsRecord,
      new RegExp(fixturePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
      `Deployed public fixture paths is missing ${fixturePath}`,
    );
  }
  assert.match(
    notice,
    /^\|\s*Upstream source license\s*\|[^\n]*MPL-2\.0/im,
    "fixture notice is missing MPL-2.0",
  );
  assert.match(
    notice,
    /separate from the permissive-only npm\s+dependency closure/i,
    "fixture redistribution must be separate from npm licensing",
  );
  assert.match(
    notice,
    /first-party synthetic[^.]*not\s+source-faithful/i,
    "fixture notice must identify the GLB geometry as non-source-faithful",
  );
  assert.match(
    notice,
    /manifests carry semantic\s+fixture mapping/i,
    "fixture notice must identify the manifests as semantic mapping",
  );
  for (const value of [
    fixtureSource.repository,
    fixtureSource.commit,
    fixtureSource.url,
    fixtureSource.licenseUrl,
    fixtureSource.sha256,
    fixtureGeometry.sha256,
    ...fixtureManifests.map(({ sha256: manifestSha256 }) => manifestSha256),
    ...fixtureRepositoryPaths,
    ...fixtureDeployedPaths,
  ])
    assert.match(
      publicNotice,
      new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
      `public fixture notice is missing ${value}`,
    );
  assert.match(publicNotice, /MPL-2\.0/i);
  assert.match(
    publicNotice,
    /first-party synthetic[^.]*not\s+source-faithful/i,
  );
  assert.match(publicNotice, /manifests carry semantic\s+fixture mapping/i);
  for (const value of [
    fixtureSource.url,
    "/examples/synthetic-ifc-mapping.glb",
    "/examples/synthetic-ifc-mapping.manifest.json",
    "/examples/synthetic-ifc-mapping-copy.manifest.json",
    "/examples/IFC_FIXTURE_NOTICE.md",
  ])
    assert.match(
      publicIndex,
      new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
      `public fixture index is missing ${value}`,
    );
  assert.match(publicIndex, /rel="license"/i);
  assert.match(publicIndex, /MPL-2\.0/i);
  assert.match(
    publicIndex,
    /합성 형상이며 원본 IFC 형상을\s+재현하지\s+않습니다/i,
  );

  const geometrySha256 = sha256(geometry);
  assert.equal(
    geometrySha256,
    fixtureGeometry.sha256,
    `${fixtureGeometry.name} SHA-256`,
  );
  assert.equal(manifests.length, fixtureManifests.length, "manifest count");
  const manifestSha256s = manifests.map(sha256);
  const semanticElementCounts = manifests.map((bytes, index) => {
    const expected = fixtureManifests[index];
    assert.equal(
      manifestSha256s[index],
      expected.sha256,
      `${expected.name} SHA-256`,
    );
    const manifest = JSON.parse(bytes.toString("utf8"));
    assert.equal(manifest.source?.sha256, fixtureSource.sha256);
    assert.equal(manifest.geometry?.sha256, fixtureGeometry.sha256);
    assert.ok(
      Array.isArray(manifest.elements) &&
        manifest.elements.length > 0 &&
        manifest.elements.every(
          (element) =>
            Number.isInteger(element.expressId) &&
            typeof element.globalId === "string" &&
            element.globalId.length > 0 &&
            Array.isArray(element.meshes) &&
            element.meshes.length > 0,
        ),
      `${expected.name} carries no semantic fixture mapping`,
    );
    return manifest.elements.length;
  });

  return {
    policyStatus: "PASS",
    geometrySha256,
    manifestSha256s,
    semanticElementCounts,
  };
}

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
  validateDrawingP7FixtureProvenance({ notice });
  validateDrawingP7DxfFixtureProvenance({ notice });
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
    const escapedVersion = entry.version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const escapedLicense = license.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    assert.match(
      notice,
      new RegExp(
        `^\\|\\s*${escapedPath}\\s*\\|\\s*${escapedVersion}\\s*\\|\\s*${escapedLicense}\\s*\\|`,
        "mi",
      ),
      `${packagePath} version and license notice`,
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
