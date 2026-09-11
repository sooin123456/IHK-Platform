# Native DWG Geometry Resave Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resave edits to all five supported imported DWG primitive types with exact native identity and real cross-runtime file proof.

**Architecture:** Existing report projector → v2 selected-edit compiler → existing selected-handle ACadSharp writer → fresh native readback. Preserve v1 internal consumers and source-free approved-native export boundaries.

**Tech Stack:** Existing TypeScript/Zod/Node tests, .NET8/ACadSharp3.7.1 and CLI self-tests; no dependencies added.

**Spec:** `docs/superpowers/specs/2026-09-06-native-dwg-geometry-resave-design.md`

## Global Constraints

- Work in `/Users/h/Documents/GoAgent/.worktrees/universal-workspace-m1`, branch `codex/universal-workspace-m1`. Preserve dirty baseline; no commit/stage/push/deploy/remote writes/new dependencies.
- Root v2 exact keys: schemaVersion `1hk-dwg-edits/2`, sourceSha256, coordinateSystem `WCS_NATIVE_UNITS`, edits. Exact per-type fields in spec are binding. V1 consumption remains backward compatible.
- Request ≤2 MiB,1–10,000 unique canonical handles, native finite abs≤999,999,999,999, planar Z=0, positive sizes, polyline aggregate≤100,000 points. Strict nonempty plain TEXT≤10,000 UTF-16. Fullturn/wrapped ARC cannot collapse; edited negative sweep explicitly rejected.
- Unchanged raw native fields retain precision; source/input bytes immutable. Validate entire batch before mutation. Preserve handles/owner/layer/non-target fields. V2 unknown/proxy source content rejects, never silent data loss.
- Reuse reader eligibility and existing command/compiler/writer; no authorization bypass or new production endpoint. Qualification stays experimental-unqualified/not-qualified and independent verification not-performed.
- Existing installed dependencies only; use `NODE_OPTIONS=--no-experimental-webstorage`. Unique local outputs, no customer files or Docker/remote runtime required. No nested subagents.

---

### Task 1: Five-type app edit compiler

**Files:** Modify `platform/app/lukas/lib/drawing-native-dwg-selected-edits.server.ts`, `platform/tests/drawing-native-dwg-selected-edits.test.mjs` only.

**Interfaces:** Preserve exported builder name/input/result flags, update exported request type to v2 with LINE(start,end), LWPOLYLINE(points,closed), CIRCLE(center,radius), ARC(center,radius,startAngleRadians,endAngleRadians), TEXT(insert,height,text). Task2 consumes these exact fields. Task3 calls builder and existing real command reducer.

- [x] Add failing behavioral tests for new shape edits and TEXT origin/height, preserving old guards except explicitly expanded behavior. Update old schema expectations only after RED demonstrates new behavior absent. Include literal native cm/inch values, unchanged raw precision, wrap/fullturn, rejected negative sweep/width/style, no-op/null, object identity, bounds and byte/vertex limits.
```js
circle.geometry.radius = 35; // source cm → 3.5 native
assert.equal(build(objects).request.edits.find(e => e.type === 'CIRCLE').radius, 3.5);
assert.equal(build(objects).request.schemaVersion, '1hk-dwg-edits/2');
```
- [x] Run focused Node test and record expected RED. Implement in existing file; reuse geometry bounds and native projector, retain raw unchanged fields. Permit only fontSize style difference for TEXT; all other metadata policies unchanged.
```ts
const radius = current.radius === baseline.radius ? raw.radius : current.radius / millimetersPerUnit;
// When angles change: start radians + positive sweep; never normalize end modulo 2π.
```
- [x] Run selected-edits + import + native-plan tests and app typecheck, self-review and report exact RED/GREEN/files/limits. Stop edits for scoped review. No commit.

### Task 2: Versioned native selected writer

**Files:** Modify `tools/dwg-engine-qualification/SelectedDwgEdits.cs`, `SelectedDwgEditSelfTests.cs`, `NativeDwgReader.cs` (eligibility visibility only), `QualificationRunner.cs` (strict reading and v2 unknown rejection hook), `SelfTests.cs`, `README.md`; optionally create focused `SelectedDwgGeometrySelfTests.cs` in same directory.

**Interfaces:** Existing `qualify --input ... --output-dir ... --edits ...` accepts unchanged v1 and strict v2 spec DTO. Existing `read-native` and `create-generated-fixture` commands stay available. Shared reader predicate becomes internal for target support checks. No public production API or new consumer mode needed.

- [x] Add self-test RED for v2 all five types and backward v1 including 3D/thickness. Use actual command/readback, literal expected points/radii/angles/text and nontarget inventory. Unknown schema test should use truly unknown version, not newly supported v2.
```csharp
Equal(new XYZ(12, 14, 0), rereadCircle.Center);
Equal(7d, rereadCircle.Radius);
Equal(originalHandle, rereadCircle.Handle);
Equal(sourceSha, Sha(File.ReadAllBytes(sourcePath)));
```
- [x] Implement strict version-specific exact parsing and full-batch prevalidation. V2 prospective geometry must satisfy the reader profile. Validate all source unknown graphical/non-graphical content before writing v2 DWGs; no claim that keep-unknown can preserve unwritable data. Keep v1 exact semantics and scoped typed mutations. Reuse shared validation rather than copy TryGeometry rules.
```csharp
reader.Configuration.Failsafe = false;
reader.Configuration.KeepUnknownEntities = true;
reader.Configuration.KeepUnknownNonGraphicalObjects = true;
// Validate every target and value first, then mutate retained entities.
```
- [x] Test wrapped/full2π ARC; no modulo end normalization, ARC vs CIRCLE strict type; PLINEGEN retained while closed/vertices change; rejected nonplanar/bulged/aligned target, late invalid target leaves earlier unchanged; malformed JSON/Unicode/zero/size/aggregate overflow. Assert unknown objects reject before mutation and original SHA unchanged; unknown binary-input no-output qualification remains unverified because the pinned writer strips that payload. Actual-command invalid-target tests separately prove no output. Run all self-tests and existing native writer tests. Update README exact v2 and remaining gates, self-review/report and stop. No commit.

### Task 3: Real app-command → native resave integration

**Files:** Create `platform/tests/drawing-native-dwg-geometry-resave-integration.test.mjs`; optional focused helper `platform/tests/fixtures/drawing-native-dwg-geometry-resave.mjs` only if shared fixture lifecycle warrants it.

**Interfaces:** Consume final Task1 builder and Task2 actual CLI via installed `/opt/homebrew/bin/dotnet` and built `tools/dwg-engine-qualification/bin/Debug/net8.0/DwgEngineQualification.dll`, overridable exact path environment for other hosts. Use actual projectNativeDrawingDwgImport and existing create/execute drawing commands, not handcrafted mutation engine.

- [x] Write executable test before producer/consumer changes are complete, then run with their pre-change baseline when available (or explicit old accepted code binary); record meaningful RED. Do not copy production code as a fake engine. Generate fresh fixture through actual CLI, read native report, project, apply actual app object updates for LINE/POLYLINE/CIRCLE/ARC/TEXT, compile v2 and invoke actual qualify. No fake headers/reports.
```js
assert.equal(result.code, 0);
assert.equal(after.source.sha256, hash(await readFile(editedDwg)));
assert.deepEqual(after.entities.find(e => e.type === 'CIRCLE').geometry.center, [12,14,0]);
assert.equal(hash(await readFile(sourceDwg)), originalSha);
```
- [x] Assert literal edited geometry (with declared numeric tolerance), handle/owner/layer preservation, known untouched block/entity inventory, original and working-copy SHA, request digest, nonqualified report flags. Include actual full-turn and wrapped arc readbacks. Use unique mkdtemp outputs, bounded process timeout/output, no secrets; explicitly missing runtime fails rather than skips. Failure cleans only owned temporary files unless evidence retention explicitly requested.
- [x] Run GREEN after Task1/2 final build; retain optional generated evidence under controller-designated fresh path only. Report exact command/results/artifact boundary. This proves same-engine local execution, not Auth/DB/Storage/worker/browser delivery. Stop edits for scoped review.

### Task 4: Cross-task review and published evidence

**Files:** Create `docs/superpowers/evidence/2026-09-06-native-dwg-geometry-resave.md` and bounded companion artifacts; no production ownership.

**Interfaces:** Review current dirty-baseline scoped diffs/reports; run quiescent accepted code, not HEAD-only diff. Preserve previous24 UI-file hashes except none are owned here.

- [x] Review tasks1–3 independently for spec+quality; send fixes to owners and scoped re-review. Freeze shared v2 fields before parallel ownership dispatch.
- [x] Run final combined native/DXF/commands/outbox/entry regressions, actual C# self-tests + native manifest self-tests, actual geometry-resave integration, app typecheck and build. Capture codes/logs/current hashes before/after; any inventory gap remains explicit.
```sh
NODE_OPTIONS=--no-experimental-webstorage node --test tests/drawing-native-dwg-geometry-resave-integration.test.mjs
/opt/homebrew/bin/dotnet run --no-restore --project tools/dwg-engine-qualification/DwgEngineQualification.csproj -- self-test
```
- [x] Final most-capable whole-unit review; at most one consolidated fix wave + scoped re-review. Publish evidence and immutable accepted-code hashes, check original bytes and unrelated baseline preserved. Leave full R2/R4/R5 goal active; no merge/deploy/qualification claim. Keep private baseline records because no commits authorized.
