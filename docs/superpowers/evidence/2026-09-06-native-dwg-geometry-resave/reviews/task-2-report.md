# Task 2 report — versioned native selected writer

## Result

Implemented strict `1hk-dwg-edits/2` consumption for exact runtime LINE, LWPOLYLINE, CIRCLE, ARC and TEXT targets while preserving the existing `1hk-dwg-edits/1` LINE/TEXT behavior. V2 validates source SHA, exact JSON shape, payload limits, retained unknown objects, model-space target identity/type, current reader eligibility, prospective cloned geometry, and the resulting document-wide `IPolyline` vertex budget before mutating retained entities or writing either round-trip DWG.

The writer retains raw ARC angle pairs without modulo normalization, including wrapped and exact `0→2π` cases. LWPOLYLINE vertex/closure edits retain PLINEGEN. Qualification reads now use `Failsafe=false`, `KeepUnknownEntities=true`, and `KeepUnknownNonGraphicalObjects=true`.

## TDD evidence

RED command:

```sh
/opt/homebrew/bin/dotnet run --no-restore --project tools/dwg-engine-qualification/DwgEngineQualification.csproj -- self-test
```

RED result: exit `1`; `29 passed, 3 failed`. The real v2 `qualify`/DWG readback test failed with `DWG edit schema or coordinate policy is unsupported` and expected exit `0` but received `2`. The atomic invalid-target and retained-unknown tests also failed because v2 was rejected before their requested behaviors could execute. This was the expected missing-v2 failure after correcting the test-only construction of ACadSharp's internal unknown placeholders through their actual pinned constructors.

First GREEN command:

```sh
/opt/homebrew/bin/dotnet run --no-restore --project tools/dwg-engine-qualification/DwgEngineQualification.csproj -- self-test
```

First GREEN result: exit `0`; `33 passed, 0 failed`. This included actual v2 source write, `qualify`, edited-DWG readback, literal five-type geometry/identity checks, source/working-copy SHA checks, wrapped/full-turn ARC, PLINEGEN, strict targets, malformed/size/aggregate limits, retained unknown objects, and whole-document point-budget atomicity.

Fresh final build:

```sh
/opt/homebrew/bin/dotnet build --no-restore tools/dwg-engine-qualification/DwgEngineQualification.csproj
```

Result: exit `0`; `0 Warning(s)`, `0 Error(s)`. Stable integration assembly:

```text
/Users/h/Documents/GoAgent/.worktrees/universal-workspace-m1/tools/dwg-engine-qualification/bin/Debug/net8.0/DwgEngineQualification.dll
```

Final assembly SHA-256: `80c80237c05bb5e9fc48fb79846b5d29215d1de46556d839c5ed14dc1d0b312f`.

Fresh final self-test:

```sh
/opt/homebrew/bin/dotnet run --no-build --no-restore --project tools/dwg-engine-qualification/DwgEngineQualification.csproj -- self-test
```

Result: exit `0`; `33 passed, 0 failed`.

Existing native-writer regression command:

```sh
/opt/homebrew/bin/dotnet run --no-build --no-restore --project tools/dwg-engine-qualification/DwgEngineQualification.csproj -- self-test-native --input-dir docs/superpowers/evidence/2026-09-05-native-cad-projection
```

Result: exit `0`; `13 passed, 0 failed`, including all four canonical manifests, edge geometry/styles, large rotations/transforms, path safety, mutation detection, notification pinning, and bounded failure reports.

Fresh cross-runtime integration against that final Debug assembly:

```sh
cd platform
NODE_OPTIONS=--no-experimental-webstorage node --test tests/drawing-native-dwg-geometry-resave-integration.test.mjs
```

Result: exit `0`; `1 passed, 0 failed`. The real app-command/compiler/CLI/read-native flow covered all five types, raw `300°→390°` and separate `0→2π` ARC requests, identities, literal readbacks, request digest, untouched block inventory, and source/working-copy hashes.

## Files

- `tools/dwg-engine-qualification/SelectedDwgEdits.cs`
- `tools/dwg-engine-qualification/SelectedDwgEditSelfTests.cs`
- `tools/dwg-engine-qualification/SelectedDwgGeometrySelfTests.cs` (new focused self-tests)
- `tools/dwg-engine-qualification/NativeDwgReader.cs`
- `tools/dwg-engine-qualification/QualificationRunner.cs`
- `tools/dwg-engine-qualification/SelfTests.cs`
- `tools/dwg-engine-qualification/README.md`
- `.superpowers/sdd/2026-09-06-native-dwg-geometry-resave/task-2-report.md`

## Scope and concerns

- The retained-unknown regression is meaningful in-memory ACadSharp coverage for both `UnknownEntity` and `UnknownNonGraphicalObject`; it proves v2 `Apply` rejects before an earlier valid target mutates. The pinned writer cannot generate a source DWG that retains unknown payload, so no fabricated writer-stripped file is claimed as unknown-input integration coverage. Actual `qualify` invalid-target cases separately prove validation occurs before either output DWG is written.
- Same-engine synthetic roundtrip does not authenticate source or edit authority and does not establish an OS sandbox, customer-file corpus support, browser/Storage/worker delivery, complete non-inventoried field preservation, independent CAD acceptance, or production qualification.
- Unknown/proxy-capable files remain ineligible for v2 with this engine. A payload-preserving engine strategy is still required before widening that boundary.
- No dependency, commit, stage, push, deployment, remote write, or customer-file operation was performed.

## Task 2 fix round 1 — review findings and verified correction

The scoped review found two concrete violations: the unknown-object gate visited only block entities and the root dictionary, missing per-object extension dictionaries; and LWPOLYLINE edits cleared and rebuilt vertices, resetting non-target vertex identifiers even for closure-only edits.

### Corrected behavior and engine boundary

- V2 now scans the complete retained registry using one .NET 8 `UnsafeAccessor` to the pinned `CadDocument._cadObjects` field, whose exact verified type is `Dictionary<ulong, IHandledCadObject>`. It then follows extension dictionaries, dictionary members and reactors using reference-identity cycle protection. No production reflection, guessed handle-range scan, partial fallback, or general graph framework was added.
- Runtime API inspection confirmed that the pinned document exposes only handle-specific `GetCadObject` / `TryGetCadObject`, not public registry enumeration. Temporary test diagnostics used for that inspection were removed. The coordinator independently confirmed the private readonly field in the pinned v3.7.1 source. Missing/inaccessible/type-changed registry access throws before mutation or either qualification DWG write; a null registry also rejects. A different assembly shape was not substituted at runtime to simulate this failure branch.
- Build dependency metadata identifies ACadSharp package `3.7.1`, assembly/file version `3.7.1.0`; installed SDK is `/opt/homebrew/bin/dotnet` version `8.0.130`. Existing exact package/lockfile constraints remain unchanged. This private-field adapter is qualified only against that pinned contract and requires review on an engine upgrade.
- Investigation also established a real binary limitation: setting a lightweight-polyline vertex ID to literal `31`, writing a DWG with the pinned writer, and rereading it produces ID `0`. Per the coordinator's explicit instruction and updated spec, v2 now rejects **any retained LWPOLYLINE with a nonzero vertex ID** before mutation, including an edited target or untouched model, block, or paper-space polyline. This is an engine eligibility restriction, not a claim that binary IDs are preserved.
- Eligible polyline edits retain existing vertex objects by index. Closure-only and same-count movement keep corresponding metadata, growth appends default trailing vertices, and shrinkage removes only explicitly omitted trailing vertices. V1 does not enter the new retained-content gate and keeps its existing behavior.

### RED and GREEN evidence

Command used for the failing regression runs and first GREEN:

```sh
/opt/homebrew/bin/dotnet run --no-restore --project tools/dwg-engine-qualification/DwgEngineQualification.csproj -- self-test
```

The first fixture attempt exposed two test setup assumptions and was not treated as the accepted regression proof: source serialization already lost the test vertex ID, and cloning an edited target with an unnamed extension dictionary raised a separate `ArgumentNullException`. After moving the ID check to the actual in-memory Apply boundary and placing the unknown dictionary on an untouched entity, the accepted pre-fix RED exited `1`, with `31 passed, 2 failed`:

```text
FAIL edits all five strict v2 geometry types and preserves selected identities: Expected 31, got 0
FAIL rejects retained unknown objects before mutating v2 targets: retained unknown object: expected rejection containing 'unknown'
```

After the indexed-vertex fix, the coordinator required global fail-closed handling for the discovered binary ID loss. A new registered regression first failed before adding that gate, while the eligible vertex-correspondence test passed. This RED exited `1`, with `33 passed, 2 failed`:

```text
FAIL rejects lossy retained polyline vertex identifiers before mutation: target vertex IDs: expected rejection containing 'vertex'
FAIL rejects retained unknown objects before mutating v2 targets: retained unknown object: expected rejection containing 'unknown'
```

First GREEN after the retained-registry/ID gate: exit `0`, `35 passed, 0 failed`. The final tests include unknown graphical/root/target-extension/untouched-extension/layer-extension/block-extension/nested-extension cases, a cyclic reactor graph with unknown payload, and a known-only cyclic graph that completes. ID rejection is checked atomically in edited, untouched model, block and paper locations. Eligible closure/move/grow/shrink edits retain corresponding vertices and PLINEGEN.

### Fresh final verification after code edits stopped

```sh
/opt/homebrew/bin/dotnet build --no-restore tools/dwg-engine-qualification/DwgEngineQualification.csproj
/opt/homebrew/bin/dotnet run --no-build --no-restore --project tools/dwg-engine-qualification/DwgEngineQualification.csproj -- self-test
/opt/homebrew/bin/dotnet run --no-build --no-restore --project tools/dwg-engine-qualification/DwgEngineQualification.csproj -- self-test-native --input-dir docs/superpowers/evidence/2026-09-05-native-cad-projection
```

Results: build exit `0`, `0 warnings`, `0 errors`; self-test exit `0`, `35 passed, 0 failed`; native regression exit `0`, `13 passed, 0 failed`.

From `platform`:

```sh
NODE_OPTIONS=--no-experimental-webstorage node --test tests/drawing-native-dwg-geometry-resave-integration.test.mjs
```

Result: exit `0`, `1 passed, 0 failed`, no skipped tests. This ran the actual app commands/compiler/selected CLI/native readback against the final stable assembly. Scoped `git diff --check` passed. The final assembly hash was checked again after the tests and remained unchanged:

```text
tools/dwg-engine-qualification/bin/Debug/net8.0/DwgEngineQualification.dll
a3c454ef94abc16d112cca4645ad1ef1974ec97e920a17bd3bc9bdb2c003b999
```

Changed files and final hashes for this fix round:

```text
83e792e08ea71390d80eca9f354412979feeee24317af65c3916ce91080a2fd4  tools/dwg-engine-qualification/QualificationRunner.cs
c9c7549d0b22884abb294118dbb53cd44e062e88be2618f4d2955b2b66f66166  tools/dwg-engine-qualification/SelectedDwgEdits.cs
2b98ea852a9e230be773ed86a4d2b92acb2ada79c545828707fd1fade5eb2fab  tools/dwg-engine-qualification/SelectedDwgGeometrySelfTests.cs
2b7293591de4e59605389377ce51dd7a13f98163e337f1d0042d7cc4b483c3ee  tools/dwg-engine-qualification/SelfTests.cs
1e65b02d3fdbfc24c23085d9993d595a79804909134a0f659bf8d1f7059f8eeb  tools/dwg-engine-qualification/README.md
```

The only additional write was this report append. No app files, other test files, frozen review snapshots, dependencies, commits, staging, deployments, remote systems, or customer inputs were modified by the fix worker.

### Verification limits retained

Unknown-object and nonzero-ID rejection are real in-memory engine-boundary tests after reading an actual synthetic source. The pinned writer cannot generate source files retaining those values, so these tests do not establish real `qualify` rejection from such a binary source. Output-file nonexistence checks in the unknown test are not themselves command-path evidence; source inspection places the gate before both qualification writes, while existing actual-command invalid-target tests separately exercise no-output rejection. The vertex-ID loss characterization does exercise actual DWG write/readback. Normal five-type resave and cross-runtime integration remain actual binary tests.

All results remain same-engine synthetic evidence, with no independent CAD, complete non-inventoried preservation, Auth/approval, worker isolation, browser/Storage delivery, or customer-corpus claim. The compiler's absent production export caller remains a follow-on goal unit. The separate scoped reviewer should assess this fix round; the implementing worker is not supplying independent approval of its own changes.
