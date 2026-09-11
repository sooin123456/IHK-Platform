import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  access,
  constants,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import {
  applyDrawingCommand,
  createDrawingDocumentState,
} from "../app/lukas/lib/drawing-commands.ts";
import { projectNativeDrawingDwgImport } from "../app/lukas/lib/drawing-native-dwg-import.server.ts";
import { buildNativeDrawingDwgSelectedEdits } from "../app/lukas/lib/drawing-native-dwg-selected-edits.server.ts";

const PROCESS_TIMEOUT_MILLISECONDS = 120_000;
const MAXIMUM_PROCESS_OUTPUT_BYTES = 64 * 1024;
const GEOMETRY_TOLERANCE = 1e-9;
const actorId = "94000000-0000-4000-8000-000000000001";
const importIdentity = {
  revisionId: "94000000-0000-4000-8000-000000000002",
  canvasId: "94000000-0000-4000-8000-000000000003",
  sourceFileId: "94000000-0000-4000-8000-000000000004",
};
const defaultEngineDll = fileURLToPath(
  new URL(
    "../../tools/dwg-engine-qualification/bin/Debug/net8.0/DwgEngineQualification.dll",
    import.meta.url,
  ),
);

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function requireAbsolutePath(path, mode, label) {
  if (!isAbsolute(path))
    throw new Error(`${label} must be configured as an absolute path.`);
  await access(path, mode);
  return path;
}

async function integrationRoot(t) {
  const retained = process.env.NATIVE_DWG_RESAVE_EVIDENCE_DIRECTORY;
  if (retained !== undefined) {
    if (!isAbsolute(retained))
      throw new Error(
        "NATIVE_DWG_RESAVE_EVIDENCE_DIRECTORY must be an absolute path.",
      );
    await assert.rejects(lstat(retained), { code: "ENOENT" });
    await mkdir(retained);
    return retained;
  }

  const root = await mkdtemp(
    join(await realpath(tmpdir()), "1hk-dwg-geometry-resave-test-"),
  );
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

function runEngine(dotnetPath, engineDll, arguments_) {
  return new Promise((resolve, reject) => {
    const child = spawn(dotnetPath, [engineDll, ...arguments_], {
      shell: false,
      windowsHide: true,
      env: {
        LANG: "C",
        LC_ALL: "C",
        DOTNET_CLI_TELEMETRY_OPTOUT: "1",
        DOTNET_NOLOGO: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout = [];
    const stderr = [];
    let outputBytes = 0;
    let failure;
    const stop = (message) => {
      if (failure) return;
      failure = new Error(message);
      child.kill("SIGKILL");
    };
    const collect = (chunks) => (chunk) => {
      outputBytes += chunk.byteLength;
      if (outputBytes > MAXIMUM_PROCESS_OUTPUT_BYTES) {
        stop("Native DWG CLI exceeded its bounded output budget.");
        return;
      }
      chunks.push(chunk);
    };
    child.stdout.on("data", collect(stdout));
    child.stderr.on("data", collect(stderr));
    child.once("error", () => stop("Native DWG CLI could not be started."));
    const timer = setTimeout(
      () => stop("Native DWG CLI exceeded its bounded runtime."),
      PROCESS_TIMEOUT_MILLISECONDS,
    );
    timer.unref?.();
    child.once("close", (code, signal) => {
      clearTimeout(timer);
      if (failure) {
        reject(failure);
        return;
      }
      resolve({
        code,
        signal,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      });
    });
  });
}

async function runSuccessfulEngine(dotnetPath, engineDll, label, arguments_) {
  const result = await runEngine(dotnetPath, engineDll, arguments_);
  assert.equal(
    result.code,
    0,
    `${label} failed (signal=${result.signal ?? "none"})\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
  );
  assert.equal(result.signal, null);
  return result;
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

function entity(report, type) {
  const matches = report.entities.filter(
    (candidate) => candidate.type === type,
  );
  assert.equal(matches.length, 1, `expected exactly one ${type} entity`);
  return matches[0];
}

function objectForType(projected, type) {
  const binding = projected.bindings.find(
    (candidate) => candidate.entityType === type,
  );
  assert.ok(binding, `missing ${type} native binding`);
  const object = projected.objects.find(
    (candidate) => candidate.id === binding.objectId,
  );
  assert.ok(object, `missing ${type} projected object`);
  return object;
}

function assertNear(actual, expected, label) {
  assert.ok(
    Math.abs(actual - expected) <= GEOMETRY_TOLERANCE,
    `${label}: expected ${expected} ± ${GEOMETRY_TOLERANCE}, received ${actual}`,
  );
}

function assertPointNear(actual, expected, label) {
  assert.equal(actual.length, expected.length, `${label} coordinate count`);
  expected.forEach((coordinate, index) =>
    assertNear(actual[index], coordinate, `${label}[${index}]`),
  );
}

function applyObjectUpdates(projected, geometryByType) {
  const state = createDrawingDocumentState({
    revisionId: importIdentity.revisionId,
    objects: projected.objects,
    layers: projected.layers,
  });
  const updates = Object.entries(geometryByType).map(([type, patch]) => {
    const object = objectForType(projected, type);
    return {
      objectId: object.id,
      baseVersion: object.version,
      patch: patch(object),
    };
  });
  const applied = applyDrawingCommand(
    state,
    { type: "update_objects", actorId, updates },
    {
      createId: () => "94000000-0000-4000-8000-000000000005",
      now: () => "2026-09-06T00:00:00.000Z",
    },
  );
  assert.equal(applied.operation.type, "update_objects");
  assert.equal(applied.operation.resultVersions[updates[0].objectId], 2);
  return Object.values(applied.state.objects);
}

async function compileAndQualify({
  dotnetPath,
  engineDll,
  root,
  name,
  sourceDwg,
  importInput,
  objects,
}) {
  const compiled = buildNativeDrawingDwgSelectedEdits({
    importInput,
    objects,
  });
  assert.equal(compiled.qualification, "experimental-unqualified");
  assert.equal(compiled.persistenceAuthority, "not-issued");
  assert.ok(compiled.request, `${name} must compile a selected edit request`);
  assert.equal(compiled.request.schemaVersion, "1hk-dwg-edits/2");
  const requestBytes = Buffer.from(JSON.stringify(compiled.request), "utf8");
  const requestPath = join(root, `${name}-edit-request.json`);
  const qualifyDirectory = join(root, `${name}-qualification`);
  const readbackDirectory = join(root, `${name}-readback`);
  await writeFile(requestPath, requestBytes, { flag: "wx" });

  const result = await runSuccessfulEngine(
    dotnetPath,
    engineDll,
    `${name} selected-edit qualification`,
    [
      "qualify",
      "--input",
      sourceDwg,
      "--output-dir",
      qualifyDirectory,
      "--edits",
      requestPath,
    ],
  );
  assert.equal(result.code, 0);
  const editedDwg = join(qualifyDirectory, "edited-roundtrip.dwg");
  await runSuccessfulEngine(dotnetPath, engineDll, `${name} native readback`, [
    "read-native",
    "--input",
    editedDwg,
    "--output-dir",
    readbackDirectory,
  ]);

  const qualification = await readJson(
    join(qualifyDirectory, "qualification-report.json"),
  );
  const after = await readJson(join(readbackDirectory, "native-import.json"));
  return {
    compiled,
    requestBytes,
    sourceDwg,
    editedDwg,
    qualification,
    after,
  };
}

function assertQualificationEvidence(
  run,
  originalSha,
  expectedHandles,
  literalUntouchedEntities,
  literalBlocks,
) {
  const { qualification, requestBytes, sourceDwg, editedDwg, after } = run;
  assert.equal(after.qualification, "experimental-unqualified");
  assert.equal(qualification.status, "experimental");
  assert.equal(
    qualification.internalSyntheticResult,
    "passed-with-inventory-gaps",
  );
  assert.equal(
    qualification.productionDwgDeliveryQualification,
    "not-qualified",
  );
  assert.equal(qualification.independentCadVerification, "not-performed");
  assert.equal(
    qualification.tolerances.geometryNumericAbsolute,
    GEOMETRY_TOLERANCE,
  );
  assert.deepEqual(qualification.input, {
    path: sourceDwg,
    sha256Before: originalSha,
    sha256WorkingCopy: originalSha,
    sha256After: originalSha,
    originalBytesPreserved: true,
  });
  assert.deepEqual(qualification.editRequest, {
    sha256: sha256(requestBytes),
    sourceSha256: originalSha,
    handles: expectedHandles,
  });
  assert.deepEqual(
    qualification.baselineInventory.entities.filter(
      ({ handle }) => !expectedHandles.includes(handle),
    ),
    literalUntouchedEntities,
  );
  assert.deepEqual(
    qualification.editedInventory.entities.filter(
      ({ handle }) => !expectedHandles.includes(handle),
    ),
    literalUntouchedEntities,
  );
  assert.deepEqual(qualification.baselineInventory.blocks, literalBlocks);
  assert.deepEqual(qualification.editedInventory.blocks, literalBlocks);
  assert.deepEqual(qualification.noEditRoundTrip.failures, []);
  assert.deepEqual(qualification.editedRoundTrip.failures, []);
  assert.deepEqual(
    qualification.editedRoundTrip.expectedEditedHandles,
    expectedHandles,
  );
  assert.equal(qualification.editedRoundTrip.outputPath, editedDwg);
  assert.equal(qualification.editedRoundTrip.outputSha256, after.source.sha256);
}

test(
  "real app commands compile five native edits and the actual CLI resaves wrapped and full-turn geometry without changing the source",
  { timeout: 360_000 },
  async (t) => {
    const dotnetPath = await requireAbsolutePath(
      process.env.NATIVE_DWG_DOTNET_PATH ?? "/opt/homebrew/bin/dotnet",
      constants.X_OK,
      "Native DWG .NET runtime",
    );
    const engineDll = await requireAbsolutePath(
      process.env.NATIVE_DWG_GEOMETRY_TEST_ENGINE_DLL ?? defaultEngineDll,
      constants.R_OK,
      "Native DWG qualification engine",
    );
    const root = await integrationRoot(t);
    const fixtureDirectory = join(root, "generated-fixture");
    const sourceReadDirectory = join(root, "source-read");

    await runSuccessfulEngine(dotnetPath, engineDll, "fixture generation", [
      "create-generated-fixture",
      "--output-dir",
      fixtureDirectory,
    ]);
    const sourceDwg = join(fixtureDirectory, "synthetic-input.dwg");
    const sourceBytes = await readFile(sourceDwg);
    const originalSha = sha256(sourceBytes);
    await runSuccessfulEngine(dotnetPath, engineDll, "source native read", [
      "read-native",
      "--input",
      sourceDwg,
      "--output-dir",
      sourceReadDirectory,
    ]);
    const report = await readJson(
      join(sourceReadDirectory, "native-import.json"),
    );
    assert.equal(report.source.sha256, originalSha);
    assert.equal(report.source.byteSize, sourceBytes.byteLength);
    assert.equal(report.source.headerVersion, "AC1024");
    assert.equal(report.qualification, "experimental-unqualified");
    assert.deepEqual(report.coverage, {
      modelSpaceEntities: 6,
      importedEntities: 5,
      unsupportedEntities: 1,
      nonModelSpaceEntities: 3,
    });
    assert.deepEqual(entity(report, "ARC").geometry, {
      center: [50, 25, 0],
      radius: 12,
      startAngleRadians: 0.25,
      endAngleRadians: 2.5,
    });

    const importInput = {
      report,
      expectedSource: report.source,
      ...importIdentity,
    };
    const projected = projectNativeDrawingDwgImport(importInput);
    const sourceIdentityByType = new Map(
      report.entities.map(({ handle, ownerHandle, layerHandle, type }) => [
        type,
        { handle, ownerHandle, layerHandle, type },
      ]),
    );
    const expectedAllHandles = report.entities
      .map(({ handle }) => handle)
      .sort(
        (left, right) => Number.parseInt(left, 16) - Number.parseInt(right, 16),
      );
    assert.deepEqual(expectedAllHandles, ["4A", "4B", "4C", "4D", "4E"]);

    const wrappedObjects = applyObjectUpdates(projected, {
      LINE: () => ({
        geometry: {
          type: "line",
          start: { x: 10, y: 11 },
          end: { x: 120, y: 21 },
        },
      }),
      LWPOLYLINE: () => ({
        geometry: {
          type: "polyline",
          points: [
            { x: 1, y: 12 },
            { x: 16, y: 20 },
            { x: 31, y: 12 },
            { x: 1, y: 12 },
          ],
          closed: false,
        },
      }),
      CIRCLE: () => ({
        geometry: {
          type: "circle",
          center: { x: 12, y: 14 },
          radius: 7,
        },
      }),
      ARC: () => ({
        geometry: {
          type: "arc",
          semanticVersion: 1,
          center: { x: 45, y: 30 },
          radius: 9,
          startAngleDegrees: 300,
          sweepAngleDegrees: 90,
        },
      }),
      TEXT: (object) => ({
        geometry: {
          ...object.geometry,
          origin: { x: 8, y: 42 },
          text: "수정된 실명",
        },
        style: { ...object.style, fontSize: 3.25 },
      }),
    });
    const wrapped = await compileAndQualify({
      dotnetPath,
      engineDll,
      root,
      name: "wrapped",
      sourceDwg,
      importInput,
      objects: wrappedObjects,
    });
    assert.deepEqual(
      wrapped.compiled.request.edits.map(({ handle, type }) => ({
        handle,
        type,
      })),
      [
        { handle: "4A", type: "LINE" },
        { handle: "4B", type: "CIRCLE" },
        { handle: "4C", type: "ARC" },
        { handle: "4D", type: "LWPOLYLINE" },
        { handle: "4E", type: "TEXT" },
      ],
    );
    assert.deepEqual(entity(wrapped.after, "LINE").geometry, {
      start: [10, 11, 0],
      end: [120, 21, 0],
    });
    assert.deepEqual(entity(wrapped.after, "LWPOLYLINE").geometry, {
      points: [
        [1, 12, 0],
        [16, 20, 0],
        [31, 12, 0],
        [1, 12, 0],
      ],
      closed: false,
    });
    assert.deepEqual(entity(wrapped.after, "CIRCLE").geometry, {
      center: [12, 14, 0],
      radius: 7,
    });
    const wrappedArc = entity(wrapped.after, "ARC").geometry;
    assertPointNear(wrappedArc.center, [45, 30, 0], "wrapped ARC center");
    assertNear(wrappedArc.radius, 9, "wrapped ARC radius");
    assertNear(
      wrappedArc.startAngleRadians,
      (300 * Math.PI) / 180,
      "wrapped ARC start",
    );
    assertNear(
      wrappedArc.endAngleRadians,
      (390 * Math.PI) / 180,
      "wrapped ARC unnormalized end",
    );
    assert.deepEqual(entity(wrapped.after, "TEXT").geometry, {
      insert: [8, 42, 0],
      height: 3.25,
      text: "수정된 실명",
    });

    for (const type of ["LINE", "LWPOLYLINE", "CIRCLE", "ARC", "TEXT"])
      assert.deepEqual(
        (({ handle, ownerHandle, layerHandle, type: entityType }) => ({
          handle,
          ownerHandle,
          layerHandle,
          type: entityType,
        }))(entity(wrapped.after, type)),
        sourceIdentityByType.get(type),
      );
    assert.equal(
      wrapped.after.source.sha256,
      sha256(await readFile(wrapped.editedDwg)),
    );

    const fullTurnObjects = applyObjectUpdates(projected, {
      ARC: () => ({
        geometry: {
          type: "arc",
          semanticVersion: 1,
          center: { x: 50, y: 25 },
          radius: 12,
          startAngleDegrees: 0,
          sweepAngleDegrees: 360,
        },
      }),
    });
    const fullTurn = await compileAndQualify({
      dotnetPath,
      engineDll,
      root,
      name: "full-turn",
      sourceDwg,
      importInput,
      objects: fullTurnObjects,
    });
    assert.deepEqual(fullTurn.compiled.request.edits, [
      {
        handle: "4C",
        type: "ARC",
        center: [50, 25, 0],
        radius: 12,
        startAngleRadians: 0,
        endAngleRadians: Math.PI * 2,
      },
    ]);
    const fullTurnArc = entity(fullTurn.after, "ARC").geometry;
    assertPointNear(fullTurnArc.center, [50, 25, 0], "full-turn ARC center");
    assertNear(fullTurnArc.radius, 12, "full-turn ARC radius");
    assertNear(fullTurnArc.startAngleRadians, 0, "full-turn ARC start");
    assertNear(fullTurnArc.endAngleRadians, Math.PI * 2, "full-turn ARC end");
    assert.deepEqual(
      (({ handle, ownerHandle, layerHandle, type }) => ({
        handle,
        ownerHandle,
        layerHandle,
        type,
      }))(entity(fullTurn.after, "ARC")),
      sourceIdentityByType.get("ARC"),
    );
    assert.equal(
      fullTurn.after.source.sha256,
      sha256(await readFile(fullTurn.editedDwg)),
    );

    const nonzeroFullTurn = await compileAndQualify({
      dotnetPath,
      engineDll,
      root,
      name: "nonzero-full-turn",
      sourceDwg,
      importInput,
      objects: applyObjectUpdates(projected, {
        ARC: (object) => ({
          geometry: {
            ...object.geometry,
            startAngleDegrees: 300,
            sweepAngleDegrees: 360,
          },
        }),
      }),
    });
    const nonzeroArc = entity(nonzeroFullTurn.after, "ARC");
    assertNear(
      nonzeroArc.geometry.startAngleRadians,
      5.235987755982989,
      "nonzero full-turn start",
    );
    assertNear(
      nonzeroArc.geometry.endAngleRadians,
      11.519173063162574,
      "nonzero full-turn end",
    );
    assert.ok(
      nonzeroArc.geometry.endAngleRadians -
        nonzeroArc.geometry.startAngleRadians <=
        Math.PI * 2,
    );
    const nonzeroProjection = projectNativeDrawingDwgImport({
      ...importIdentity,
      report: nonzeroFullTurn.after,
      expectedSource: nonzeroFullTurn.after.source,
    });
    assert.equal(
      objectForType(nonzeroProjection, "ARC").geometry.startAngleDegrees,
      300,
    );
    assert.equal(
      objectForType(nonzeroProjection, "ARC").geometry.sweepAngleDegrees,
      360,
    );
    assert.deepEqual(
      (({ handle, ownerHandle, layerHandle, type }) => ({
        handle,
        ownerHandle,
        layerHandle,
        type,
      }))(nonzeroArc),
      sourceIdentityByType.get("ARC"),
    );
    assert.equal(
      nonzeroFullTurn.after.source.sha256,
      sha256(await readFile(nonzeroFullTurn.editedDwg)),
    );

    const literalBaselineEntities = [
      {
        handle: "47",
        type: "VIEWPORT",
        owner: "44",
        layer: "0",
        geometry: "unsupported-type=ACadSharp.Entities.Viewport",
        text: null,
        reference: null,
      },
      {
        handle: "4A",
        type: "LINE",
        owner: "40",
        layer: "QA_GEOMETRY",
        geometry: "start=0,0,0;end=100,0,0;thickness=0;normal=0,0,1",
        text: null,
        reference: null,
      },
      {
        handle: "4B",
        type: "CIRCLE",
        owner: "40",
        layer: "QA_GEOMETRY",
        geometry: "center=25,25,0;radius=10;thickness=0;normal=0,0,1",
        text: null,
        reference: null,
      },
      {
        handle: "4C",
        type: "ARC",
        owner: "40",
        layer: "QA_GEOMETRY",
        geometry:
          "center=50,25,0;radius=12;startAngle=0.25;endAngle=2.5;thickness=0;normal=0,0,1",
        text: null,
        reference: null,
      },
      {
        handle: "4D",
        type: "LWPOLYLINE",
        owner: "40",
        layer: "QA_GEOMETRY",
        geometry:
          "closed=True;flags=Closed;elevation=0;normal=0,0,1;thickness=0;constantWidth=0;vertices=0,10:0:0:0/15,18:0:0:0/30,10:0:0:0/0,10:0:0:0",
        text: null,
        reference: null,
      },
      {
        handle: "4E",
        type: "TEXT",
        owner: "40",
        layer: "QA_TEXT",
        geometry:
          "insert=5,40,0;alignment=0,0,0;normal=0,0,1;height=2.5;rotation=0;horizontal=Left;vertical=Baseline;oblique=0;widthFactor=1;mirror=None;thickness=0;style=Standard",
        text: "SYNTHETIC QA TEXT",
        reference: "2D:Standard",
      },
      {
        handle: "52",
        type: "LINE",
        owner: "4F",
        layer: "QA_GEOMETRY",
        geometry: "start=0,0,0;end=8,0,0;thickness=0;normal=0,0,1",
        text: null,
        reference: null,
      },
      {
        handle: "53",
        type: "CIRCLE",
        owner: "4F",
        layer: "QA_GEOMETRY",
        geometry: "center=4,4,0;radius=2;thickness=0;normal=0,0,1",
        text: null,
        reference: null,
      },
      {
        handle: "54",
        type: "INSERT",
        owner: "40",
        layer: "QA_GEOMETRY",
        geometry:
          "block=QA_ORDINARY_BLOCK;insert=70,30,0;normal=0,0,1;scale=1.5,1.5,1;rotation=0.2;rows=1:0;columns=1:0;attributes=0",
        text: null,
        reference: "4F:QA_ORDINARY_BLOCK",
      },
    ];
    const literalEntitiesExcept = (handles) =>
      literalBaselineEntities.filter(({ handle }) => !handles.includes(handle));
    const literalBlocks = [
      {
        handle: "40",
        name: "*Model_Space",
        layout: "Model",
        units: "Unitless",
        flags: "None",
        externalReferencePath: null,
        entityHandles: ["4A", "4B", "4C", "4D", "4E", "54"],
      },
      {
        handle: "44",
        name: "*Paper_Space",
        layout: "Layout1",
        units: "Unitless",
        flags: "None",
        externalReferencePath: null,
        entityHandles: ["47"],
      },
      {
        handle: "4F",
        name: "QA_ORDINARY_BLOCK",
        layout: null,
        units: "Unitless",
        flags: "None",
        externalReferencePath: null,
        entityHandles: ["52", "53"],
      },
    ];
    assertQualificationEvidence(
      wrapped,
      originalSha,
      expectedAllHandles,
      literalEntitiesExcept(expectedAllHandles),
      literalBlocks,
    );
    assertQualificationEvidence(
      fullTurn,
      originalSha,
      ["4C"],
      literalEntitiesExcept(["4C"]),
      literalBlocks,
    );

    assert.equal(sha256(await readFile(sourceDwg)), originalSha);
    assertQualificationEvidence(
      nonzeroFullTurn,
      originalSha,
      ["4C"],
      literalEntitiesExcept(["4C"]),
      literalBlocks,
    );
    assert.equal(
      sha256(
        await readFile(
          join(
            root,
            "nonzero-full-turn-qualification",
            "input-working-copy.dwg",
          ),
        ),
      ),
      originalSha,
    );
    assert.deepEqual(
      await readFile(
        join(root, "nonzero-full-turn-qualification", "edit-request.json"),
      ),
      nonzeroFullTurn.requestBytes,
    );
    assert.equal(
      sha256(
        await readFile(
          join(root, "wrapped-qualification", "input-working-copy.dwg"),
        ),
      ),
      originalSha,
    );
    assert.equal(
      sha256(
        await readFile(
          join(root, "full-turn-qualification", "input-working-copy.dwg"),
        ),
      ),
      originalSha,
    );
    assert.deepEqual(
      await readFile(join(root, "wrapped-qualification", "edit-request.json")),
      wrapped.requestBytes,
    );
    assert.deepEqual(
      await readFile(
        join(root, "full-turn-qualification", "edit-request.json"),
      ),
      fullTurn.requestBytes,
    );
    await writeFile(
      join(root, "integration-summary.json"),
      `${JSON.stringify(
        {
          schemaVersion: "1hk-native-dwg-geometry-resave-integration/1",
          qualification: "experimental-unqualified",
          productionDwgDeliveryQualification: "not-qualified",
          independentCadVerification: "not-performed",
          source: { sha256: originalSha, originalBytesPreserved: true },
          wrapped: {
            requestSha256: sha256(wrapped.requestBytes),
            editedDwgSha256: wrapped.after.source.sha256,
            editedHandles: expectedAllHandles,
          },
          fullTurn: {
            requestSha256: sha256(fullTurn.requestBytes),
            editedDwgSha256: fullTurn.after.source.sha256,
            editedHandles: ["4C"],
          },
          nonzeroFullTurn: {
            requestSha256: sha256(nonzeroFullTurn.requestBytes),
            editedDwgSha256: nonzeroFullTurn.after.source.sha256,
            editedHandles: ["4C"],
          },
          boundary:
            "Same-engine local synthetic roundtrip only; Auth, database, storage, worker, browser delivery, independent CAD acceptance, and customer files were not exercised.",
        },
        null,
        2,
      )}\n`,
      { flag: "wx" },
    );
  },
);
