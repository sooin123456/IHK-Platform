# Native DWG Import Projection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Read real DWG bytes into a strictly validated application projection with stable native identity, without misrepresenting canonical persistence or DWG delivery readiness.

**Architecture:** Reuse ACadSharp 3.7.1 and existing bounded native-process/build-hash helpers. Keep native extraction distinct from the existing DXF importer; project into the existing drawing object/geometry schema without issuing operations or source attestations.

**Tech Stack:** Existing .NET 8/ACadSharp 3.7.1, Node, TypeScript, Zod, node:test.

**Spec:** `docs/superpowers/specs/2026-09-06-native-dwg-import-projection-design.md`

## Global Constraints

- Preserve existing dirty worktree changes; no commit, push, deployment, remote DB mutation or paid dependencies.
- Original bytes must remain unchanged. No Xref/font/image/network resolution.
- Never relax DXF source guards or source-free approved native-export authority.
- Output is `experimental-unqualified`, `persistenceAuthority: "not-issued"`; no canonical operations or delivery-ready claim.
- Native source handles are canonical nonzero uppercase uint64 hex, distinct from `dxf_entity`.
- Bounds: 200MiB source, 10000 total entities, 1000 layers, 100000 vertices, 32MiB report, 100 unsupported groups with 10 examples each.
- Node native process: 120s, 64KiB combined output, no shell, no inherited credentials.

### Task 1: Native read report

**Files:** Create `tools/dwg-engine-qualification/NativeDwgReader.cs` and `NativeDwgReaderSelfTests.cs`; modify `Program.cs`, `SelfTests.cs`, `README.md` in that directory.

**Interfaces:** `NativeDwgReader.Run(string inputPath,string outputDirectory,TextWriter output,TextWriter error)` produces the exact `1hk-dwg-import/1` report defined by the spec. CLI `read-native --input <file> --output-dir <new-dir>`; wire self-tests into existing `self-test`.

- [x] Write reader self-tests and capture RED before implementation. Construct actual ACadSharp document fixtures containing a LINE `(10,-5,0)->(125,25,0)`, plain TEXT `A-101`, CIRCLE, ARC, LWPOLYLINE, a block INSERT, and planar/nonplanar and invalid variants; write/read actual DWG rather than fabricated report expectations. Example core assertion after actual CLI call:

```csharp
Assert(exitCode == 0, "native read succeeds");
Assert(line.GetProperty("geometry").GetProperty("start")[0].GetDouble() == 10, "WCS start preserved");
Assert(beforeSha == HashFile(input), "source bytes unchanged");
```

- [x] Implement bounded source read, original-byte hash and header, native model/layer identities and geometry extraction, exact unsupported counts, exclusive report write, external-reference rejection, safe error output. Match spec fields verbatim; use existing `QualificationPaths` guards, pinned engine, actual read-only stream. Do not write a DWG or parse geometry inventory strings.
- [x] Run `dotnet run --project tools/dwg-engine-qualification -c Release -- self-test`; confirm new reader tests and previous selected-edit tests pass. Run Release build and record complete command/results, source hashes and limitations in task report. No commit.

### Task 2: Application reader boundary and projection

**Files:** Create `platform/app/lukas/lib/drawing-native-dwg-import.server.ts`, `drawing-native-dwg-reader.server.ts`, `platform/tests/drawing-native-dwg-import.test.mjs` and `drawing-native-dwg-reader.test.mjs`. Reuse, do not rewrite, `drawing-native-dwg-worker.server.ts` exports `runNativeDwgProcess`/`calculateNativeDwgWriterBuildSha256`, `drawing-workspace.types.ts` and `drawing-geometry.ts`.

**Interfaces:** Reader returns validated Task1 report from original bytes and expected source `{sha256,byteSize,headerVersion}`. Export `NativeDrawingDwgImportReportSchema` and `projectNativeDrawingDwgImport({report,expectedSource,revisionId,canvasId,sourceFileId,unitOverride?})`. Result `{requestId,source,units,layers,objects,bindings,coverage,warnings,qualification:"experimental-unqualified",persistenceAuthority:"not-issued"}`. Binding `{id,objectId,sourceFileId,sourceSha256,handle,ownerHandle,entityType,nativeGeometry}`. No `operations` and no fabricated persisted `DrawingObjectSource`.

- [x] Write failing behavior tests against exports using literal report fixtures and expected geometry. For a LINE starting `[10,-5,0]` in centimeters assert `geometry.start` equals `{x:100,y:-50}` and binding geometry remains `[10,-5,0]`; repeat projection produces deep-equal IDs/objects. Wrong source SHA, unknown unit without override, duplicate native handle and inconsistent coverage must reject. Actual reader integration must run Task1 .NET executable; never fake the successful native engine.

```js
const result = projectNativeDrawingDwgImport(input);
assert.deepEqual(result.objects[0].geometry.start, {x:100,y:-50});
assert.deepEqual(result.bindings[0].nativeGeometry.start, [10,-5,0]);
assert.equal(result.persistenceAuthority, "not-issued");
assert.equal("operations" in result, false);
```

- [x] Implement strict report validation, units and deterministic IDs, existing schema/bounds projection, exact native bindings, declared display approximations. Implement isolated .NET reader wrapper with source-before/source-after and build-before/build-after checks, bounded regular output and precise owned-temp cleanup. Unknown report fields, partial identities or process errors fail closed without leaking raw output.
- [x] Run focused node:test suites with `NODE_OPTIONS=--no-experimental-webstorage`, actual .NET integration and application typecheck. Record exact outputs and the absence of UI/DB authority in report; no commit.

### Task 3: Projected edits to native handle requests

**Files:** Create `platform/app/lukas/lib/drawing-native-dwg-selected-edits.server.ts` and `platform/tests/drawing-native-dwg-selected-edits.test.mjs`.

**Interfaces:** Export `buildNativeDrawingDwgSelectedEdits({importInput,objects})`; `importInput` is the exact argument of Task2 projector. Return `{request,qualification:"experimental-unqualified",persistenceAuthority:"not-issued"}`; request is null for no-op, otherwise exact existing `1hk-dwg-edits/1`.

- [x] Write RED tests using literal reports (same contract as Task2). A centimeters LINE change in mm from `{x:100,y:-50}` to `{x:120,y:-70}` emits native `[12,-7,0]` on the original handle. Unchanged native endpoint with more than six decimals stays exact, no-op emits null, valid TEXT change emits only text. Unknown/deleted/duplicate objects, style/name/layer/kind or unsupported shape/text placement changes and invalid plain text must reject atomically.

```js
assert.deepEqual(result.request.edits, [{handle:"2A",type:"LINE",start:[12,-7,0],end:[125,25,0]}]);
assert.equal(buildNativeDrawingDwgSelectedEdits({importInput,objects:baseline.objects}).request, null);
```

- [x] Recompute baseline using Task2 projector instead of trusting client bindings; schema-validate exact object set, permit only version increases and explicit LINE endpoints/TEXT values, convert changed coordinates only, retain unchanged exact native points, and emit sorted bounded native requests. No caller authorization claim.
- [x] Run focused tests, record RED/GREEN and report. Actual source-read → projected edit → selected-native resave proof is Task4. No C#/Task2 edits, commit or deployment.

### Task 4: Independent review, combined verification and evidence

**Files:** Add `docs/superpowers/evidence/2026-09-06-native-dwg-import-projection.md` and small synthetic report evidence under its matching directory. Preserve original artifacts. Amend plan checkboxes only when actual tasks pass review.

**Interfaces:** Read Task1/Task2 reports and focused dirty-baseline diffs. No whole unrelated HEAD diff.

- [x] Independently review native extraction and application boundary against source/identity/count/units/persistence requirements; fix findings with covering tests.
- [x] Run actual native DWG -> Node reader -> existing drawing schema projection; compare literal geometry, matching source hashes and native handles. Run old native selected-edit/writer checks and Node native-export regressions once. Record failures/skips/warnings honestly.
- [x] Publish concise implementation evidence with exact commands/results and remaining `DB attestation → browser import → whole-source approved resave → recipient qualification` steps. Keep goal active. No deployment or completion claim for R4.
