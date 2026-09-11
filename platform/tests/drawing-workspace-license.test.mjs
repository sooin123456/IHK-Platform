import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { test } from "node:test";

const packageUrl = new URL("../package.json", import.meta.url);
const noticeUrl = new URL("../THIRD_PARTY_NOTICES.md", import.meta.url);
const gltfValidatorNoticeUrl = new URL(
  "../third_party/gltf-validator/NOTICES",
  import.meta.url,
);
const gltfValidatorLicenseUrl = new URL(
  "../third_party/gltf-validator/LICENSE",
  import.meta.url,
);
const rendererUrl = new URL(
  "../app/lukas/lib/pdf-page-renderer.client.ts",
  import.meta.url,
);
const viewerUrl = new URL(
  "../app/lukas/components/pdf-drawing-viewer.client.tsx",
  import.meta.url,
);
const lockUrl = new URL("../package-lock.json", import.meta.url);
const fixtureGlbUrl = new URL(
  "../public/examples/synthetic-ifc-mapping.glb",
  import.meta.url,
);
const fixturePublicNoticeUrl = new URL(
  "../public/examples/IFC_FIXTURE_NOTICE.md",
  import.meta.url,
);
const fixtureConsumerUrl = new URL(
  "../public/examples/index.html",
  import.meta.url,
);
const fixtureManifestUrls = [
  new URL(
    "../public/examples/synthetic-ifc-mapping.manifest.json",
    import.meta.url,
  ),
  new URL(
    "../public/examples/synthetic-ifc-mapping-copy.manifest.json",
    import.meta.url,
  ),
];
const dxfFixtureUrl = new URL(
  "../tests/fixtures/dxf-parser/extendeddata.dxf",
  import.meta.url,
);
const dxfFixtureLicenseUrl = new URL(
  "../tests/fixtures/dxf-parser/LICENSE",
  import.meta.url,
);
const dxfFixtureNoticeUrl = new URL(
  "../tests/fixtures/dxf-parser/DXF_FIXTURE_NOTICE.md",
  import.meta.url,
);
const licenseAuthority = await import(
  "../scripts/drawing-p7-license-authority.mjs"
).catch(() => ({}));

const approvedDirectDependencies = [
  "@hcaptcha/react-hcaptcha",
  "@hocuspocus/provider",
  "@hocuspocus/server",
  "@radix-ui/react-avatar",
  "@radix-ui/react-checkbox",
  "@radix-ui/react-collapsible",
  "@radix-ui/react-dialog",
  "@radix-ui/react-dropdown-menu",
  "@radix-ui/react-label",
  "@radix-ui/react-select",
  "@radix-ui/react-separator",
  "@radix-ui/react-slot",
  "@radix-ui/react-tooltip",
  "@react-router/node",
  "@react-router/serve",
  "@sentry/browser",
  "@sentry/react-router",
  "@supabase/ssr",
  "@supabase/supabase-js",
  "@vercel/og",
  "@vercel/react-router",
  "class-variance-authority",
  "clsx",
  "dotenv",
  "drizzle-orm",
  "dxf-parser",
  "fast-xml-parser",
  "fflate",
  "gltf-validator",
  "i18next",
  "i18next-browser-languagedetector",
  "i18next-fetch-backend",
  "i18next-fs-backend",
  "i18next-http-backend",
  "i18next-resources-to-backend",
  "input-otp",
  "isbot",
  "jose",
  "konva",
  "lucide-react",
  "next-themes",
  "nprogress",
  "pdf-lib",
  "pdfjs-dist",
  "postgres",
  "react",
  "react-dom",
  "react-i18next",
  "react-konva",
  "react-router",
  "react-turnstile",
  "remix-i18next",
  "remix-themes",
  "resend",
  "satori",
  "sonner",
  "tailwind-merge",
  "tailwindcss-animate",
  "three",
  "tus-js-client",
  "y-indexeddb",
  "y-protocols",
  "yjs",
  "zod",
];

const approvedDirectDevDependencies = [
  "@electric-sql/pglite",
  "@playwright/test",
  "@react-router/dev",
  "@tailwindcss/vite",
  "@trivago/prettier-plugin-sort-imports",
  "@types/node",
  "@types/nprogress",
  "@types/pg",
  "@types/react",
  "@types/react-dom",
  "@types/three",
  "drizzle-kit",
  "prettier",
  "prettier-plugin-tailwindcss",
  "react-router-devtools",
  "tailwindcss",
  "typescript",
  "vite",
  "vite-tsconfig-paths",
];

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
  throw new Error(
    `Lockfile dependency ${dependencyName} from ${parentPath} is unresolved.`,
  );
}

function lockedDependencyClosure(lock, rootPath) {
  const visited = new Set();
  const pending = [rootPath];
  while (pending.length) {
    const packagePath = pending.pop();
    if (visited.has(packagePath)) continue;
    const entry = lock.packages[packagePath];
    if (!entry) throw new Error(`Lockfile package ${packagePath} is missing.`);
    visited.add(packagePath);
    for (const dependencyName of Object.keys(entry.dependencies ?? {}))
      pending.push(
        resolveLockedDependency(lock.packages, packagePath, dependencyName),
      );
  }
  return [...visited].sort();
}

function assertPermissiveExportClosure(lock, packagePaths) {
  const approvedLicenses = new Set(["(MIT AND Zlib)", "0BSD", "MIT"]);
  for (const packagePath of packagePaths) {
    const license = lock.packages[packagePath]?.license;
    assert.equal(
      approvedLicenses.has(license),
      true,
      `${packagePath} has prohibited or unknown license ${String(license)}`,
    );
  }
}

const expectedCollaborationRuntimeClosure = {
  "node_modules/@hocuspocus/common": { version: "4.6.0", license: "MIT" },
  "node_modules/@hocuspocus/provider": { version: "4.6.0", license: "MIT" },
  "node_modules/@hocuspocus/server": { version: "4.6.0", license: "MIT" },
  "node_modules/@lifeomic/attempt": { version: "3.1.0", license: "MIT" },
  "node_modules/async-mutex": { version: "0.5.0", license: "MIT" },
  "node_modules/crossws": { version: "0.4.12", license: "MIT" },
  "node_modules/isomorphic.js": { version: "0.2.5", license: "MIT" },
  "node_modules/jose": { version: "6.2.10", license: "MIT" },
  "node_modules/kleur": { version: "4.1.5", license: "MIT" },
  "node_modules/lib0": { version: "0.2.117", license: "MIT" },
  "node_modules/tslib": { version: "2.8.1", license: undefined },
  "node_modules/y-indexeddb": { version: "9.0.12", license: "MIT" },
  "node_modules/y-protocols": { version: "1.0.7", license: "MIT" },
  "node_modules/yjs": { version: "13.6.32", license: "MIT" },
};

const expectedTusRuntimeClosure = {
  "node_modules/buffer-from": ["1.1.2", "MIT"],
  "node_modules/combine-errors": ["3.0.3", "MIT"],
  "node_modules/custom-error-instance": ["2.1.1", "ISC"],
  "node_modules/graceful-fs": ["4.2.11", "ISC"],
  "node_modules/is-stream": ["2.0.1", "MIT"],
  "node_modules/js-base64": ["3.9.3", "BSD-3-Clause"],
  "node_modules/lodash._baseiteratee": ["4.7.0", "MIT"],
  "node_modules/lodash._basetostring": ["4.12.0", "MIT"],
  "node_modules/lodash._baseuniq": ["4.6.0", "MIT"],
  "node_modules/lodash._createset": ["4.0.3", "MIT"],
  "node_modules/lodash._root": ["3.0.1", "MIT"],
  "node_modules/lodash._stringtopath": ["4.8.0", "MIT"],
  "node_modules/lodash.throttle": ["4.1.1", "MIT"],
  "node_modules/lodash.uniqby": ["4.5.0", "MIT"],
  "node_modules/proper-lockfile": ["4.1.2", "MIT"],
  "node_modules/proper-lockfile/node_modules/signal-exit": ["3.0.7", "ISC"],
  "node_modules/querystringify": ["2.2.0", "MIT"],
  "node_modules/requires-port": ["1.0.0", "MIT"],
  "node_modules/retry": ["0.12.0", "MIT"],
  "node_modules/tus-js-client": ["4.3.1", "MIT"],
  "node_modules/url-parse": ["1.5.10", "MIT"],
};

function assertPermissiveCollaborationClosure(lock, packagePaths) {
  assert.deepEqual(
    packagePaths,
    Object.keys(expectedCollaborationRuntimeClosure),
  );
  for (const packagePath of packagePaths) {
    const expected = expectedCollaborationRuntimeClosure[packagePath];
    const entry = lock.packages[packagePath];
    assert.equal(
      entry?.version,
      expected.version,
      `${packagePath} version changed`,
    );
    assert.equal(
      entry?.license,
      expected.license,
      `${packagePath} has prohibited or unknown license ${String(entry?.license)}`,
    );
  }
}

test("drawing editor dependencies are permissive and noticed", async () => {
  const pkg = JSON.parse(await readFile(packageUrl, "utf8"));
  const notice = await readFile(noticeUrl, "utf8");

  assert.equal(pkg.dependencies.konva, "10.3.1");
  assert.equal(pkg.dependencies["react-konva"], "19.2.5");
  assert.equal(pkg.dependencies["gltf-validator"], "2.0.0-dev.3.10");
  assert.match(notice, /\|\s*Konva\s*\|\s*10\.3\.1\s*\|.*\|\s*MIT\s*\|/);
  assert.match(notice, /\|\s*react-konva\s*\|\s*19\.2\.5\s*\|.*\|\s*MIT\s*\|/);
  assert.match(
    notice,
    /\|\s*@electric-sql\/pglite\s*\|\s*0\.5\.3\s*\|.*\|\s*Apache-2\.0\s*\|/,
  );
  assert.match(
    notice,
    /\|\s*gltf-validator\s*\|\s*2\.0\.0-dev\.3\.10\s*\|.*\|\s*Apache-2\.0\s*\|/,
  );
});

test("the official glTF validator ships its exact Apache license and upstream notices", async () => {
  const installedRoot = new URL(
    "../node_modules/gltf-validator/",
    import.meta.url,
  );
  const normalized = (value) => value.replaceAll("\r\n", "\n").trimEnd();
  assert.equal(
    normalized(await readFile(gltfValidatorNoticeUrl, "utf8")),
    normalized(await readFile(new URL("NOTICES", installedRoot), "utf8")),
  );
  const license = normalized(await readFile(gltfValidatorLicenseUrl, "utf8"));
  assert.equal(
    license,
    normalized(await readFile(new URL("LICENSE", installedRoot), "utf8")),
  );
  assert.match(license, /Apache License\s+Version 2\.0, January 2004/);
});

test("DXF import pins the exact permissive server-only parser closure", async () => {
  const pkg = JSON.parse(await readFile(packageUrl, "utf8"));
  const lock = JSON.parse(await readFile(lockUrl, "utf8"));
  const notice = await readFile(noticeUrl, "utf8");
  const parser = lock.packages["node_modules/dxf-parser"];
  const loglevel = lock.packages["node_modules/loglevel"];

  assert.equal(pkg.dependencies["dxf-parser"], "1.1.2");
  assert.deepEqual(parser.dependencies, { loglevel: "^1.7.1" });
  assert.equal(parser.version, "1.1.2");
  assert.equal(parser.license, "MIT");
  assert.equal(
    parser.integrity,
    "sha512-GPTumUvRkounlIazLIyJMmTWt+nlg+ksS0Hdm8jWvejmZKBTz6gvHTam76wRm4PQMma5sgKLThblQyeIJcH79Q==",
  );
  assert.equal(loglevel.license, "MIT");
  assert.equal(
    loglevel.integrity,
    "sha512-HgMmCqIJSAKqo68l0rS2AanEWfkxaZ5wNiEFb5ggm08lDs9Xl2KxBlX3PTcaD2chBM1gXAYf491/M2Rv8Jwayg==",
  );
  assert.match(
    notice,
    /\|\s*dxf-parser\s*\|\s*1\.1\.2\s*\|\s*https:\/\/github\.com\/gdsestimating\/dxf-parser\s*\|\s*MIT\s*\|\s*No\s*\|\s*npm\s*\|/,
  );
  assert.match(
    notice,
    /\|\s*node_modules\/loglevel\s*\|\s*[\d.]+\s*\|\s*MIT\s*\|/,
  );

  assert.equal(
    typeof licenseAuthority.containsDxfParserModuleSpecifier,
    "function",
  );
  for (const source of [
    "import DxfParser from 'dxf-parser'",
    'await import("dxf-parser/browser")',
    "require(`dxf-parser`)",
    'require.resolve("dxf-parser")',
  ])
    assert.equal(
      licenseAuthority.containsDxfParserModuleSpecifier(source),
      true,
    );
  assert.equal(
    licenseAuthority.containsDxfParserModuleSpecifier(
      "const description = 'server-side DXF parser';",
    ),
    false,
  );

  const imports = [];
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const url = new URL(
        `${entry.name}${entry.isDirectory() ? "/" : ""}`,
        directory,
      );
      if (entry.isDirectory()) await visit(url);
      else if (/\.(?:[cm]?[jt]sx?)$/u.test(entry.name)) {
        const source = await readFile(url, "utf8");
        if (licenseAuthority.containsDxfParserModuleSpecifier(source))
          imports.push(url.pathname);
      }
    }
  }
  await visit(new URL("../app/", import.meta.url));
  assert.deepEqual(imports, [
    new URL("../app/lukas/lib/drawing-dxf-import.server.ts", import.meta.url)
      .pathname,
  ]);
});

test("drawing export uses the exact unmodified MIT pdf-lib dependency", async () => {
  const pkg = JSON.parse(await readFile(packageUrl, "utf8"));
  const lock = JSON.parse(await readFile(lockUrl, "utf8"));
  const notice = await readFile(noticeUrl, "utf8");

  assert.equal(pkg.dependencies["pdf-lib"], "1.17.1");
  assert.equal(lock.packages["node_modules/pdf-lib"].version, "1.17.1");
  assert.equal(lock.packages["node_modules/pdf-lib"].license, "MIT");
  assert.match(
    notice,
    /\|\s*pdf-lib\s*\|\s*1\.17\.1\s*\|\s*https:\/\/github\.com\/Hopding\/pdf-lib\s*\|\s*MIT\s*\|\s*No\s*\|\s*npm\s*\|/,
  );
  assert.deepEqual(
    Object.keys(pkg.dependencies).sort(),
    approvedDirectDependencies,
  );
  assert.deepEqual(
    Object.keys(pkg.devDependencies).sort(),
    approvedDirectDevDependencies,
  );
  const dependencyPaths = lockedDependencyClosure(lock, "node_modules/pdf-lib");
  assert.deepEqual(dependencyPaths, [
    "node_modules/@pdf-lib/standard-fonts",
    "node_modules/@pdf-lib/standard-fonts/node_modules/pako",
    "node_modules/@pdf-lib/upng",
    "node_modules/@pdf-lib/upng/node_modules/pako",
    "node_modules/pdf-lib",
    "node_modules/pdf-lib/node_modules/pako",
    "node_modules/pdf-lib/node_modules/tslib",
  ]);
  assertPermissiveExportClosure(lock, dependencyPaths);

  for (const dependencyPath of dependencyPaths) {
    const mutated = structuredClone(lock);
    mutated.packages[dependencyPath].license = "UNKNOWN";
    assert.throws(
      () => assertPermissiveExportClosure(mutated, dependencyPaths),
      new RegExp(dependencyPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    );
  }
});

test("drawing collaboration pins its MIT protocol closure without direct transport or state packages", async () => {
  const pkg = JSON.parse(await readFile(packageUrl, "utf8"));
  const lock = JSON.parse(await readFile(lockUrl, "utf8"));
  const notice = await readFile(noticeUrl, "utf8");
  const expected = {
    yjs: "13.6.32",
    "y-indexeddb": "9.0.12",
    "@hocuspocus/provider": "4.6.0",
    "@hocuspocus/server": "4.6.0",
    "y-protocols": "1.0.7",
    jose: "6.2.10",
  };

  const dependencyPaths = new Set();
  for (const [name, version] of Object.entries(expected)) {
    assert.equal(pkg.dependencies[name], version);
    assert.equal(lock.packages[`node_modules/${name}`]?.version, version);
    assert.equal(lock.packages[`node_modules/${name}`]?.license, "MIT");
    assert.match(
      notice,
      new RegExp(
        `\\|\\s*${name.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}\\s*\\|\\s*${version.replaceAll(".", "\\.")}\\s*\\|.*\\|\\s*MIT\\s*\\|\\s*No\\s*\\|\\s*npm\\s*\\|`,
      ),
    );
    for (const packagePath of lockedDependencyClosure(
      lock,
      `node_modules/${name}`,
    ))
      dependencyPaths.add(packagePath);
  }
  const collaborationPaths = [...dependencyPaths].sort();
  assertPermissiveCollaborationClosure(lock, collaborationPaths);
  for (const dependencyPath of collaborationPaths) {
    const mutated = structuredClone(lock);
    mutated.packages[dependencyPath].license = "UNKNOWN";
    assert.throws(
      () => assertPermissiveCollaborationClosure(mutated, collaborationPaths),
      new RegExp(dependencyPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    );
  }
  for (const prohibited of ["lib0", "ws", "redis", "zustand", "redux"]) {
    assert.equal(Object.hasOwn(pkg.dependencies, prohibited), false);
  }
});

test("resumable uploads pin the exact permissive tus-js-client closure", async () => {
  const pkg = JSON.parse(await readFile(packageUrl, "utf8"));
  const lock = JSON.parse(await readFile(lockUrl, "utf8"));
  const notice = await readFile(noticeUrl, "utf8");
  const normalizedNotice = notice.replaceAll("\\_", "_");

  assert.equal(pkg.dependencies["tus-js-client"], "4.3.1");
  assert.match(
    normalizedNotice,
    /\|\s*tus-js-client\s*\|\s*4\.3\.1\s*\|\s*https:\/\/github\.com\/tus\/tus-js-client\s*\|\s*MIT\s*\|\s*No\s*\|\s*npm\s*\|/,
  );

  const packagePaths = lockedDependencyClosure(
    lock,
    "node_modules/tus-js-client",
  );
  assert.deepEqual(packagePaths, Object.keys(expectedTusRuntimeClosure));
  const permissiveLicenses = new Set(["BSD-3-Clause", "ISC", "MIT"]);
  for (const packagePath of packagePaths) {
    const [expectedVersion, expectedLicense] =
      expectedTusRuntimeClosure[packagePath];
    const entry = lock.packages[packagePath];
    const installedRoot = new URL(`../${packagePath}/`, import.meta.url);
    const manifest = JSON.parse(
      await readFile(new URL("package.json", installedRoot), "utf8"),
    );
    let license = entry.license ?? manifest.license;
    if (license === undefined) {
      const readme = await readFile(
        new URL("Readme.md", installedRoot),
        "utf8",
      );
      license = readme.match(/## License\s+([A-Za-z0-9.-]+)/)?.[1];
    }
    assert.equal(
      entry.version,
      expectedVersion,
      `${packagePath} version changed`,
    );
    assert.equal(license, expectedLicense, `${packagePath} license changed`);
    assert.equal(
      permissiveLicenses.has(license),
      true,
      `${packagePath} license`,
    );

    const escapedPath = packagePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const escapedVersion = expectedVersion.replaceAll(".", "\\.");
    assert.match(
      normalizedNotice,
      new RegExp(
        `\\|\\s*${escapedPath}\\s*\\|\\s*${escapedVersion}\\s*\\|\\s*${expectedLicense}\\s*\\|`,
      ),
    );
  }
});

test("viewer delegates PDF.js primitives to the shared renderer", async () => {
  const source = await readFile(viewerUrl, "utf8");

  assert.match(source, /openPdfDocument/);
  assert.match(source, /renderPdfPageToCanvas/);
  assert.doesNotMatch(
    source,
    /pdfjs-dist|GlobalWorkerOptions|\.getDocument\(|\.getPage\(|\.render\(/,
  );
});

test("document replacement cancels an active renderer before destruction", async () => {
  const source = await readFile(viewerUrl, "utf8");
  const cleanupRegistration = source.indexOf(
    "renderCleanupRef.current = () => controller.abort();",
  );
  const renderStart = source.indexOf("void renderPdfPageToCanvas({");
  const documentReplacement = source.indexOf(
    "renderControllerRef.current?.abort();",
  );
  const documentDestroy = source.indexOf("void openedDocument?.destroy();");

  assert.ok(cleanupRegistration >= 0 && cleanupRegistration < renderStart);
  assert.ok(documentReplacement >= 0 && documentReplacement < documentDestroy);
});

test("PDF pages use the shared client renderer", async () => {
  const source = await readFile(rendererUrl, "utf8");

  assert.match(source, /export\s+async\s+function\s+openPdfDocument\s*\(/);
  assert.match(
    source,
    /export\s+async\s+function\s+renderPdfPageToCanvas\s*\(/,
  );
});

test("shared PDF opening stops before starting an aborted load", async () => {
  const source = await readFile(rendererUrl, "utf8");
  const abortCheck = source.indexOf("if (signal?.aborted) throw abortError();");
  const createLoadingTask = source.indexOf("const loadingTask");

  assert.ok(abortCheck >= 0 && abortCheck < createLoadingTask);
});

test("DXF fixture provenance is pinned, fully licensed, and not customer acceptance", async () => {
  assert.equal(
    typeof licenseAuthority.validateDrawingP7DxfFixtureProvenance,
    "function",
  );
  const [fixture, fixtureLicense, fixtureNotice, notice] = await Promise.all([
    readFile(dxfFixtureUrl),
    readFile(dxfFixtureLicenseUrl, "utf8"),
    readFile(dxfFixtureNoticeUrl, "utf8"),
    readFile(noticeUrl, "utf8"),
  ]);
  const expected = {
    policyStatus: "PASS",
    fixtureSha256:
      "9b39289e3435fb187eb0e671fb8a07b8728cdf69a0275836f67ca005732f781d",
    fixtureByteSize: 102001,
  };

  assert.deepEqual(
    licenseAuthority.validateDrawingP7DxfFixtureProvenance(),
    expected,
  );
  assert.deepEqual(
    licenseAuthority.validateDrawingP7DxfFixtureProvenance({
      fixture,
      fixtureLicense,
      fixtureNotice,
      notice,
    }),
    expected,
  );

  const corruptedFixture = Buffer.from(fixture);
  corruptedFixture[0] ^= 1;
  assert.throws(
    () =>
      licenseAuthority.validateDrawingP7DxfFixtureProvenance({
        fixture: corruptedFixture,
        fixtureLicense,
        fixtureNotice,
        notice,
      }),
    /extendeddata\.dxf SHA-256/i,
  );

  for (const incompleteLicense of [
    fixtureLicense.replace("Copyright (c) 2015 GDS Storefront Estimating", ""),
    fixtureLicense.replace(
      /Permission is hereby granted[\s\S]*?subject to the following conditions:/u,
      "",
    ),
    fixtureLicense.replace(/THE SOFTWARE IS PROVIDED[\s\S]*$/u, ""),
  ])
    assert.throws(
      () =>
        licenseAuthority.validateDrawingP7DxfFixtureProvenance({
          fixture,
          fixtureLicense: incompleteLicense,
          fixtureNotice,
          notice,
        }),
      /full MIT license/i,
    );

  assert.throws(
    () =>
      licenseAuthority.validateDrawingP7DxfFixtureProvenance({
        fixture,
        fixtureLicense,
        fixtureNotice: fixtureNotice.replace(
          /This is an OSS interoperability fixture[^.]*\. It is not customer data or customer acceptance\./u,
          "",
        ),
        notice,
      }),
    /OSS interoperability.*not customer data or customer acceptance/i,
  );
  assert.throws(
    () =>
      licenseAuthority.validateDrawingP7DxfFixtureProvenance({
        fixture,
        fixtureLicense,
        fixtureNotice,
        notice: notice.replace(
          /^\|\s*Upstream commit\s*\|[^\n]*0df7a37a4207a1f925b8d0bfffc270ff121446b4[^\n]*\|$/mu,
          "",
        ),
      }),
    /Upstream commit/i,
  );
});

test("P7 license closure enforces DXF fixture provenance", async () => {
  const packageJson = JSON.parse(await readFile(packageUrl, "utf8"));
  const lock = JSON.parse(await readFile(lockUrl, "utf8"));
  const notice = await readFile(noticeUrl, "utf8");
  const noticeWithoutDxfCommit = notice.replace(
    /^\|\s*Upstream commit\s*\|[^\n]*0df7a37a4207a1f925b8d0bfffc270ff121446b4[^\n]*\|$/mu,
    "",
  );

  assert.throws(
    () =>
      licenseAuthority.validateDrawingP7LicenseClosure({
        packageJson,
        lock,
        notice: noticeWithoutDxfCommit,
        installedRoot: new URL("../node_modules/", import.meta.url),
      }),
    /DXF fixture provenance is missing Upstream commit/i,
  );
});

test("P7 release validates redistributed fixture provenance separately from npm licensing", async () => {
  assert.equal(
    typeof licenseAuthority.validateDrawingP7FixtureProvenance,
    "function",
  );
  const notice = await readFile(noticeUrl, "utf8");
  const publicNotice = await readFile(fixturePublicNoticeUrl, "utf8");
  const fixtureConsumer = await readFile(fixtureConsumerUrl, "utf8");
  const geometry = await readFile(fixtureGlbUrl);
  const manifests = await Promise.all(
    fixtureManifestUrls.map((url) => readFile(url)),
  );
  const result = licenseAuthority.validateDrawingP7FixtureProvenance({
    notice,
    publicNotice,
    geometry,
    manifests,
  });

  assert.deepEqual(result, {
    policyStatus: "PASS",
    geometrySha256:
      "cb450586de90c234831a6a206c0cb83078d65eca1870ac642680df5b5056270f",
    manifestSha256s: [
      "65dc191d9089409f37d4757707e4a191bb7774ac4a64ac191384a67e3e85a17c",
      "5c417a92f4e3feb6e61d19204e94eca0a131e89bc00c93c7aa5d1b5978147b82",
    ],
    semanticElementCounts: [115, 115],
  });
  assert.match(fixtureConsumer, /href="\/examples\/IFC_FIXTURE_NOTICE\.md"/);
  assert.match(fixtureConsumer, /rel="license"/);
  for (const asset of [
    "synthetic-ifc-mapping.glb",
    "synthetic-ifc-mapping.manifest.json",
    "synthetic-ifc-mapping-copy.manifest.json",
  ])
    assert.match(
      fixtureConsumer,
      new RegExp(`href="/examples/${asset.replaceAll(".", "\\.")}"`),
    );
  assert.match(
    fixtureConsumer,
    /https:\/\/raw\.githubusercontent\.com\/ThatOpen\/engine_web-ifc\/3f6f3640b8317664194911fad63bcd407f7e32ca\/examples\/example\.ifc/,
  );

  const corruptedGeometry = Buffer.from(geometry);
  corruptedGeometry[0] ^= 1;
  assert.throws(
    () =>
      licenseAuthority.validateDrawingP7FixtureProvenance({
        notice,
        geometry: corruptedGeometry,
        manifests,
      }),
    /synthetic-ifc-mapping\.glb SHA-256/i,
  );

  const noticeWithoutCommitRecord = notice.replace(
    /^\| Upstream commit .*$/mu,
    "",
  );
  assert.throws(
    () =>
      licenseAuthority.validateDrawingP7FixtureProvenance({
        notice: noticeWithoutCommitRecord,
        publicNotice,
        geometry,
        manifests,
      }),
    /Upstream commit/i,
  );

  const noticeWithoutPublicPathsRecord = notice.replace(
    /^\| Deployed public fixture paths .*$/mu,
    "",
  );
  assert.throws(
    () =>
      licenseAuthority.validateDrawingP7FixtureProvenance({
        notice: noticeWithoutPublicPathsRecord,
        publicNotice,
        geometry,
        manifests,
      }),
    /Deployed public fixture paths/i,
  );
});

test("P7 release inspects the actual drawing dependency closure and notices", async () => {
  assert.equal(
    typeof licenseAuthority.validateDrawingP7LicenseClosure,
    "function",
  );
  const packageJson = JSON.parse(await readFile(packageUrl, "utf8"));
  const lock = JSON.parse(await readFile(lockUrl, "utf8"));
  const notice = await readFile(noticeUrl, "utf8");
  const result = licenseAuthority.validateDrawingP7LicenseClosure({
    packageJson,
    lock,
    notice,
    installedRoot: new URL("../node_modules/", import.meta.url),
  });
  assert.equal(result.packages.length, 35);
  assert.equal(result.entries.length, 35);
  assert.ok(result.packages.includes("node_modules/dxf-parser"));
  assert.ok(result.packages.includes("node_modules/loglevel"));
  assert.ok(result.packages.includes("node_modules/gltf-validator"));
  assert.ok(result.packages.includes("node_modules/pdfjs-dist"));
  assert.ok(result.packages.includes("node_modules/@hocuspocus/server"));
  assert.equal(result.policyStatus, "PASS");
  assert.deepEqual(result.nonPermissive, []);
  for (const { packagePath, license } of result.entries) {
    const escapedPath = packagePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const escapedLicense = license.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    assert.match(notice, new RegExp(`\\|\\s*${escapedPath}\\s*\\|`));
    assert.match(notice, new RegExp(`\\|\\s*${escapedLicense}\\s*\\|`));
  }
  const wrongTransitiveVersion = structuredClone(lock);
  wrongTransitiveVersion.packages["node_modules/loglevel"].version = "99.0.0";
  assert.throws(
    () =>
      licenseAuthority.validateDrawingP7LicenseClosure({
        packageJson,
        lock: wrongTransitiveVersion,
        notice,
        installedRoot: new URL("../node_modules/", import.meta.url),
      }),
    /node_modules\/loglevel.*version.*notice/i,
  );
  const prohibited = structuredClone(lock);
  prohibited.packages["node_modules/react-konva"].license = "PROPRIETARY";
  assert.throws(
    () =>
      licenseAuthority.validateDrawingP7LicenseClosure({
        packageJson,
        lock: prohibited,
        notice,
        installedRoot: new URL("../node_modules/", import.meta.url),
      }),
    /react-konva.*PROPRIETARY/i,
  );
});

test("1HK product source and public assets contain no Rayon name or asset", async () => {
  const matches = [];
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const url = new URL(
        `${entry.name}${entry.isDirectory() ? "/" : ""}`,
        directory,
      );
      if (entry.isDirectory()) await visit(url);
      else if (
        /rayon/i.test(entry.name) ||
        /rayon/i.test(await readFile(url, "utf8"))
      )
        matches.push(url.pathname);
    }
  }
  await visit(new URL("../app/", import.meta.url));
  await visit(new URL("../public/", import.meta.url));
  assert.deepEqual(matches, []);
});
