import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  access,
  chmod,
  constants,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, isAbsolute, join } from "node:path";
import { test } from "node:test";

import {
  calculateNativeDwgWriterBuildSha256,
  runNativeDwgProcess,
} from "../app/lukas/lib/drawing-native-dwg-worker.server.ts";
import { projectNativeDrawingDwgImport } from "../app/lukas/lib/drawing-native-dwg-import.server.ts";
import { runNativeDrawingDwgReader } from "../app/lukas/lib/drawing-native-dwg-reader.server.ts";
import {
  DrawingObjectSchema,
  DrawingStructureLayerSchema,
} from "../app/lukas/lib/drawing-workspace.types.ts";

const fallbackPublishedDirectory = new URL(
  "../../tools/dwg-engine-qualification/bin/Release/net8.0/",
  import.meta.url,
).pathname;
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

async function actualNativePrerequisites() {
  const publishedDirectory =
    process.env.NATIVE_DWG_PUBLISHED_DIRECTORY ?? fallbackPublishedDirectory;
  if (!isAbsolute(publishedDirectory))
    throw new Error(
      "Required native DWG integration prerequisite is unavailable: published directory must be absolute.",
    );
  await access(
    join(publishedDirectory, "DwgEngineQualification.dll"),
    constants.R_OK,
  );
  if (
    process.env.NATIVE_DWG_DOTNET_PATH &&
    !isAbsolute(process.env.NATIVE_DWG_DOTNET_PATH)
  )
    throw new Error(
      "Required native DWG integration prerequisite is unavailable: configured dotnet path must be absolute.",
    );
  const candidates = [
    process.env.NATIVE_DWG_DOTNET_PATH,
    ...(process.env.PATH ?? "")
      .split(delimiter)
      .filter(Boolean)
      .map((directory) => join(directory, "dotnet")),
    "/opt/homebrew/bin/dotnet",
    "/usr/local/bin/dotnet",
    "/usr/bin/dotnet",
  ].filter((candidate) => candidate && isAbsolute(candidate));
  for (const candidate of new Set(candidates)) {
    try {
      await access(candidate, constants.X_OK);
      return { dotnetPath: await realpath(candidate), publishedDirectory };
    } catch {
      // Try the next explicit absolute candidate.
    }
  }
  throw new Error(
    "Required native DWG integration prerequisite is unavailable: dotnet executable not found.",
  );
}

test("reader rejects mismatched original-byte identity through a bounded public failure", async () => {
  const sourceBytes = Buffer.from("AC1024synthetic-invalid-body", "ascii");
  await assert.rejects(
    runNativeDrawingDwgReader({
      dotnetPath: "/does/not/exist/dotnet",
      publishedDirectory: "/does/not/exist/published",
      sourceBytes,
      expectedSource: {
        sha256: "0".repeat(64),
        byteSize: sourceBytes.byteLength,
        headerVersion: "AC1024",
      },
      expectedWriterBuildSha256: "0".repeat(64),
    }),
    (error) => {
      assert.equal(error.message, "Native DWG read failed.");
      assert.equal(error.message.includes("/does/not/exist"), false);
      return true;
    },
  );
});

test("reader rejects high-bit aliases of the six ASCII header bytes before native execution", async (t) => {
  const root = await mkdtemp(
    join(await realpath(tmpdir()), "native-reader-header-test-"),
  );
  t.after(() => rm(root, { recursive: true, force: true }));
  const fakePublishedDirectory = join(root, "published");
  const fakeDotnetPath = join(root, "dotnet-marker.sh");
  const markerPath = join(root, "native-process-invoked");
  await mkdir(fakePublishedDirectory);
  await writeFile(
    join(fakePublishedDirectory, "DwgEngineQualification.dll"),
    "not executed",
  );
  await writeFile(
    fakeDotnetPath,
    `#!/bin/sh\n/usr/bin/touch ${JSON.stringify(markerPath)}\nexit 1\n`,
  );
  await chmod(fakeDotnetPath, 0o700);
  const sourceBytes = Buffer.from([
    0xc1, 0xc3, 0xb1, 0xb0, 0xb2, 0xb4, 0x00, 0x01,
  ]);
  const expectedSource = {
    sha256: sha256(sourceBytes),
    byteSize: sourceBytes.byteLength,
    headerVersion: "AC1024",
  };
  const expectedWriterBuildSha256 = await calculateNativeDwgWriterBuildSha256(
    fakePublishedDirectory,
  );

  await assert.rejects(
    runNativeDrawingDwgReader({
      dotnetPath: fakeDotnetPath,
      publishedDirectory: fakePublishedDirectory,
      sourceBytes,
      expectedSource,
      expectedWriterBuildSha256,
    }),
    { message: "Native DWG read failed." },
  );
  await assert.rejects(access(markerPath), { code: "ENOENT" });
});

test("actual native process errors stay bounded and clean the owned temporary directory", async () => {
  const { dotnetPath, publishedDirectory } = await actualNativePrerequisites();
  const sourceBytes = Buffer.from("AC1024not-a-valid-dwg", "ascii");
  const expectedSource = {
    sha256: sha256(sourceBytes),
    byteSize: sourceBytes.byteLength,
    headerVersion: "AC1024",
  };
  const before = new Set(
    (await readdir(tmpdir())).filter((name) =>
      name.startsWith("1hk-native-dwg-reader-"),
    ),
  );
  const expectedWriterBuildSha256 =
    await calculateNativeDwgWriterBuildSha256(publishedDirectory);

  await assert.rejects(
    runNativeDrawingDwgReader({
      dotnetPath,
      publishedDirectory,
      sourceBytes,
      expectedSource,
      expectedWriterBuildSha256,
    }),
    (error) => {
      assert.equal(error.message, "Native DWG read failed.");
      assert.equal(error.message.includes("ACadSharp"), false);
      return true;
    },
  );
  const leaked = (await readdir(tmpdir())).filter(
    (name) => name.startsWith("1hk-native-dwg-reader-") && !before.has(name),
  );
  assert.deepEqual(leaked, []);
});

test("reader refuses to delete a replacement directory at its former owned path", async (t) => {
  const fixtureRoot = await mkdtemp(
    join(await realpath(tmpdir()), "native-reader-replacement-test-"),
  );
  t.after(() => rm(fixtureRoot, { recursive: true, force: true }));
  const fakePublishedDirectory = join(fixtureRoot, "published");
  const fakeDotnetPath = join(fixtureRoot, "dotnet-replace-root.sh");
  const replacementPathRecord = join(fixtureRoot, "replacement-path.txt");
  await mkdir(fakePublishedDirectory);
  await writeFile(
    join(fakePublishedDirectory, "DwgEngineQualification.dll"),
    "not executed as a managed assembly",
  );
  await writeFile(
    fakeDotnetPath,
    `#!/bin/sh
owned_root=$(/usr/bin/dirname "$4")
/bin/rm -rf "$owned_root"
/bin/mkdir "$owned_root"
/usr/bin/touch "$owned_root/replacement-sentinel"
/bin/echo "$owned_root" > ${JSON.stringify(replacementPathRecord)}
exit 1
`,
  );
  await chmod(fakeDotnetPath, 0o700);
  const sourceBytes = Buffer.from("AC1024invalid-body", "ascii");
  const expectedSource = {
    sha256: sha256(sourceBytes),
    byteSize: sourceBytes.byteLength,
    headerVersion: "AC1024",
  };
  const expectedWriterBuildSha256 = await calculateNativeDwgWriterBuildSha256(
    fakePublishedDirectory,
  );

  await assert.rejects(
    runNativeDrawingDwgReader({
      dotnetPath: fakeDotnetPath,
      publishedDirectory: fakePublishedDirectory,
      sourceBytes,
      expectedSource,
      expectedWriterBuildSha256,
    }),
    { message: "Native DWG read failed." },
  );
  const replacementRoot = (
    await readFile(replacementPathRecord, "utf8")
  ).trim();
  t.after(() => rm(replacementRoot, { recursive: true, force: true }));
  await access(join(replacementRoot, "replacement-sentinel"));
});

test("actual .NET reader returns an original-byte report consumable by the real projector", async (t) => {
  const { dotnetPath, publishedDirectory } = await actualNativePrerequisites();
  const integrationRoot = await mkdtemp(
    join(await realpath(tmpdir()), "native-reader-integration-test-"),
  );
  t.after(() => rm(integrationRoot, { recursive: true, force: true }));
  const fixtureDirectory = join(integrationRoot, "generated-fixture");
  await runNativeDwgProcess(
    dotnetPath,
    [
      join(publishedDirectory, "DwgEngineQualification.dll"),
      "create-generated-fixture",
      "--output-dir",
      fixtureDirectory,
    ],
    {
      timeoutMilliseconds: 120_000,
      maxOutputBytes: 64 * 1024,
      signal: new AbortController().signal,
      env: { LANG: "C", LC_ALL: "C" },
    },
  );
  const sourceBytes = await readFile(
    join(fixtureDirectory, "synthetic-input.dwg"),
  );
  const expectedSource = {
    sha256: sha256(sourceBytes),
    byteSize: sourceBytes.byteLength,
    headerVersion: sourceBytes.subarray(0, 6).toString("ascii"),
  };
  const expectedWriterBuildSha256 =
    await calculateNativeDwgWriterBuildSha256(publishedDirectory);
  const report = await runNativeDrawingDwgReader({
    dotnetPath,
    publishedDirectory,
    sourceBytes,
    expectedSource,
    expectedWriterBuildSha256,
  });

  assert.deepEqual(report.source, expectedSource);
  assert.deepEqual(report.coverage, {
    modelSpaceEntities: 6,
    importedEntities: 5,
    unsupportedEntities: 1,
    nonModelSpaceEntities: 3,
  });
  assert.deepEqual(
    report.entities.map(({ type }) => type),
    ["LINE", "CIRCLE", "ARC", "LWPOLYLINE", "TEXT"],
  );
  assert.deepEqual(report.unsupported, [
    {
      type: "INSERT",
      reason: "unsupported_type",
      count: 1,
      sampleHandles: ["54"],
    },
  ]);
  const projected = projectNativeDrawingDwgImport({
    report,
    expectedSource,
    revisionId: "92000000-0000-4000-8000-000000000001",
    canvasId: "92000000-0000-4000-8000-000000000002",
    sourceFileId: "92000000-0000-4000-8000-000000000003",
    ...(report.unitCode === 0
      ? { unitOverride: { code: 4, label: "mm" } }
      : {}),
  });
  assert.ok(
    projected.layers.every(
      (layer) => DrawingStructureLayerSchema.safeParse(layer).success,
    ),
  );
  assert.ok(
    projected.objects.every(
      (object) => DrawingObjectSchema.safeParse(object).success,
    ),
  );
  assert.equal(projected.objects.length, 5);
  assert.equal(projected.bindings.length, projected.objects.length);
  assert.equal(projected.persistenceAuthority, "not-issued");
  assert.equal("operations" in projected, false);
});
