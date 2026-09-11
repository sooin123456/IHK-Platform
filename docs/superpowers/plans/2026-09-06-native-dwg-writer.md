# Native DWG Writer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Write actual editable AC1024 DWGs from the canonical native CAD manifest and prove saved entity/layout semantics through read-back.

**Architecture:** Existing strict TypeScript projection feeds the existing pinned .NET CLI. C# validates consumed CAD data, writes native entities and independently compares actual re-read intent; it preserves opaque canonical source evidence without duplicating architectural geometry or claiming authentication.

**Tech Stack:** .NET8, ACadSharp3.7.1 exact existing dependency, System.Text.Json/SHA256 and current assert-based tests; existing Node/TypeScript projection for integration.

**Spec:** `docs/superpowers/specs/2026-09-06-native-dwg-writer-design.md`

## Global Constraints

- Always report `qualification: experimental-unqualified`, `productionDwgDeliveryQualification: not-qualified`, `independentCadVerification: not-performed`.
- No new dependency, public route/button, DB mutation, paid contract, commit, push or operating deployment.
- Original bytes and all user-owned dirty edits remain unchanged. No source/test projects under tools/dwg-engine-qualification/artifacts (SDK recursive source glob).
- No second coordinate reflection/model scaling, SVG/DXF intermediate, exploded blocks or fake dimensions.
- Input graph SHA is not database snapshot identity or approval. Preserve metadata as opaque producer-required evidence, not C# canonical graph validation.
- Existing native4/all24 content, qualification commands and tests remain available; unknown or dropped supported entities fail.
- Retain current unit private evidence. Review current unit against exact dirty baseline, not the giant dirty branch.

---

### Task 1: Strict manifest CLI → native entities → DWG → semantic read-back

**Files:**
- Create: `tools/dwg-engine-qualification/NativeCadManifest.cs` — consumed typed JSON parsing, finite/budget/reference validation, preserved source metadata.
- Create: `tools/dwg-engine-qualification/NativeDwgWriter.cs` — real CAD mapping, fixed bounded CLI outputs and report. Small local methods; no factory/service interface.
- Create: `tools/dwg-engine-qualification/NativeDwgVerification.cs` — requested-versus-read-back semantic inventory/comparison and output records.
- Create: `tools/dwg-engine-qualification/NativeDwgSelfTests.cs` — assert-based runtime tests, actual engine and literal fixtures.
- Modify narrowly: `tools/dwg-engine-qualification/Program.cs` — route `write-native` and `self-test-native --input-dir <four-manifest-directory>`.
- Modify: `tools/dwg-engine-qualification/README.md` — commands, strict boundaries, diagnostics, real remaining gates.
- Reuse, do not change without escalating exact reason: `QualificationCore.cs`, `QualificationRunner.cs`, `SelfTests.cs`, csproj/lockfile, existing TS manifest/projection.

**Interfaces:**
- Consumes: exact current `DrawingCadManifestSchema` fields in `platform/app/lukas/lib/drawing-cad-manifest.ts`, existing physical-safe `QualificationPaths.Create/BoundedOutputPath`, ACadSharp3.7.1.
- Produces: `NativeDwgWriter.Run(string inputPath, string outputDirectory, TextWriter output, TextWriter error): int` and `NativeDwgSelfTests.Run(string inputDirectory, TextWriter output): int`. Validation failures exit2; engine/write/re-read failures exit1; successful internal semantic comparison exit0, never production-qualified.
- Use a disposable `NativeCadManifest` owner around bounded `JsonDocument` or explicit DTOs. Consumed values validated once; avoid repeated unchecked GetProperty paths or catch-all defaulting. `NativeDwgVerification` compares requested input to the actual re-read document and preserves real handle mappings created during write.

- [x] **Step 1: Write RED for the missing writer command.** Create the focused self-test/CLI assertion first; it must invoke the real CLI or future callable boundary with an existing measured manifest and require an actual readable DWG, not just namespace existence. Before implementation the command must fail because the feature is absent. Example integration assertion:

```csharp
int status = Program.Main(["write-native", "--input", measuredManifest, "--output-dir", freshOutput]);
AssertEqual(0, status);
using var reader = new ACadSharp.IO.DwgReader(Path.Combine(freshOutput, "native.dwg"));
var actual = reader.Read();
AssertEqual("AC1024", actual.Header.VersionString);
AssertEqual(ACadSharp.Types.Units.UnitsType.Millimeters, actual.Header.InsUnits);
AssertEqual(19, actual.Entities.Count());
```

The test-only freshOutput is uniquely owned and must not already exist. Scope test artifacts to a temp directory outside the SDK tree.

- [x] **Step 2: Run and record actual RED.** Baseline `dotnet run --no-restore --project tools/dwg-engine-qualification/DwgEngineQualification.csproj -- self-test` is9/9. Add the smallest test entry needed, run focused check and record expected missing-command failure, not compile typo. Never change existing qualification tests to make the new path pass.
- [x] **Step 3: Implement bounded parser and the real native mapping.** Read the entire spec, current manifest fields and engine flow before choosing helpers. Basic coordinate conversion is deliberately absent:

```csharp
static CSMath.XYZ CadPoint(double x, double y) => new(x, y, 0);
var document = new ACadSharp.CadDocument(ACadSharp.ACadVersion.AC1024);
document.Header.InsUnits = ACadSharp.Types.Units.UnitsType.Millimeters;
```

Implement all8manifest variants and both hatch boundaries; ordinary layers/blocks/INSERT, literal MTEXT and corrected real aligned DIMENSION graphics, paper layout/viewports. Do not duplicate TypeScript wall/opening geometry. Header/geometry/style read-back must be compared directly against input intent.
- [x] **Step 4: Add RED→GREEN edge and failure coverage.** Exercise all4existing manifest files from `docs/superpowers/evidence/2026-09-05-native-cad-projection`, literal circle/arc/hatch/mirror/rotated Korean text/rgba/hidden layers/diagonal negative-offset dimension/custom paper variants. In the measured file require19model entities,4block entities,2dimensions measuring6000 and4000mm, model21000×14850 and paper420×297mm/scale0.02. Check actual saved dimension children font, both arrow endpoints, correct side and horizontal text anchor, not only numeric Measurement. Malformed/duplicate JSON keys, unknown consumed fields, dangling/multiply-mapped entities, wrong profile/policy, budgets and path collisions fail without input/output overwrite. Corrupt a read-back entity and require comparison failure.
- [x] **Step 5: Run GREEN and self-review.** Run native self-test and old9tests once after focused iteration; build with `dotnet build --no-restore`. Record commands/results/warnings and exact supported semantics. Root will separately generate fresh canonical4/all24 inputs and inspect actual files. No full M1 or preview restart by implementer because this unit changes no app/DB/UI.
- [x] **Step 6: Independent task and integration review.** Root captures exact old-file baseline before dispatch, packages new4files plus Program/README delta, dispatches spec+quality review, resolves load-bearing findings with focused RED→GREEN. Root runs fresh tests/build and actual regenerated native manifest pipeline. Source hashes must match the reviewed snapshot; original content remains unchanged.
- [x] **Step 7: Publish actual DWG/read-back evidence.** Keep generated DWGs, hash/semantic/quantization reports and source manifests in a new evidence directory, with public bounded summary. Record supported/incomplete fields without claiming recipient qualification. Mark only this task complete; full R4/R5 remains required.

## Completion evidence

Current isolated unit complete after two fix rounds; full objective remains active. Root session24016 passed build0/0, native13/13, legacy9/9, actual DWG7/7, fresh-repeat semantics7/7 and three early transform rejection probes. Independent scoped review approved; final source hashes and retained files are in `docs/superpowers/evidence/2026-09-06-native-dwg-writer/verification.json`. Human-readable record: `docs/superpowers/evidence/2026-09-06-native-dwg-writer.md`. No commit, push, deployment or paid contract.
