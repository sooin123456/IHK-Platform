import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { test } from "node:test";

const packageUrl = new URL("../package.json", import.meta.url);
const noticeUrl = new URL("../THIRD_PARTY_NOTICES.md", import.meta.url);
const rendererUrl = new URL(
  "../app/lukas/lib/pdf-page-renderer.client.ts",
  import.meta.url,
);
const viewerUrl = new URL(
  "../app/lukas/components/pdf-drawing-viewer.client.tsx",
  import.meta.url,
);
const lockUrl = new URL("../package-lock.json", import.meta.url);
const licenseAuthority =
  await import("../scripts/drawing-p7-license-authority.mjs").catch(() => ({}));

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
  "fast-xml-parser",
  "fflate",
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
  "web-ifc",
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
  assert.match(notice, /\|\s*Konva\s*\|\s*10\.3\.1\s*\|.*\|\s*MIT\s*\|/);
  assert.match(notice, /\|\s*react-konva\s*\|\s*19\.2\.5\s*\|.*\|\s*MIT\s*\|/);
  assert.match(
    notice,
    /\|\s*@electric-sql\/pglite\s*\|\s*0\.5\.3\s*\|.*\|\s*Apache-2\.0\s*\|/,
  );
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
  assert.equal(result.packages.length, 33);
  assert.equal(result.entries.length, 33);
  assert.ok(result.packages.includes("node_modules/pdfjs-dist"));
  assert.ok(result.packages.includes("node_modules/web-ifc"));
  assert.ok(result.packages.includes("node_modules/@hocuspocus/server"));
  assert.equal(result.policyStatus, "NOT_MET");
  assert.deepEqual(result.nonPermissive, [
    { packagePath: "node_modules/web-ifc", license: "MPL-2.0" },
  ]);
  for (const { packagePath, license } of result.entries) {
    const escapedPath = packagePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const escapedLicense = license.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    assert.match(notice, new RegExp(`\\|\\s*${escapedPath}\\s*\\|`));
    assert.match(notice, new RegExp(`\\|\\s*${escapedLicense}\\s*\\|`));
  }
  assert.match(notice, /MPL-2\.0.*source.*upstream/is);

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
