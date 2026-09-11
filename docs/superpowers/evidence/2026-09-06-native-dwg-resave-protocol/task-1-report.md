# Task 1 implementation report

Status: DONE. No commits, staging, merge, push, deployment, dependency installation, customer-data access, live platform/build writes or root native bin/obj builds were performed. The wider Universal Workspace goal remains active. This unit issues no persistence authority, jobs, UI or independent-CAD qualification.

## Implementation

- Added exact `resave-native-stdio` command and `NativeDwgResaver.RunStream(Stream input, Stream output, TextWriter error): int`.
- Added a byte overload to the existing selected-edit parser, preserving old file-based/v1 CLI support. The framed command requires v2; parser and batch validation/application are reused.
- Added shared native stream read/write helpers. Both reader and qualification commands use the same strict ACadSharp read configuration; framed resave reuses reader bounds/ownership/Xref validation.
- Framed resave inventories the complete materialized document and rejects every explicit inventory diagnostic, empty/over-budget entity inventory, retained unknown object and lossy nonzero lightweight-polyline vertex ID. It compares no-edit output and exact post-request output using the existing SemanticComparer, ExpectedEdits.None, absolute tolerance 1e-9. Source/request identities are rechecked and output is reader-validated before publication.
- Success output uses the exact allowlisted report and full binary frame. DWG/report writes cap logical length and MemoryStream backing-array growth before writing. No success bytes are emitted for native/request failures. Extra command arguments also get the fixed generic failure.
- Per controller amendment, default paper VIEWPORTs are retained and now passively inventoried. Intrinsic fields cover center/size; view center/height/direction/target; twist/clipping/lens; active/status/id/paper; UCS; snap/grid; shade/render/lighting fields. Plot-style name, boundary identity, frozen-layer identities/names, visual-style identity and scale identity/name use the exact reference field, not numeric-tolerant geometry. Non-finite viewport geometry is rejected. Derived ScaleFactor/ViewWidth are deliberately excluded; their stored inputs are compared.
- Added resaver protocol image label while retaining the prior reader label/default entrypoint and engine/dependency pins. README documents framing, bounds, status and limits.

## Exact protocol and limits

Input: 16-byte header: ASCII `1HKRSV01` then unsigned 32-bit big-endian request byte length, then source byte length; request bytes, source bytes, EOF. Both declared lengths are validated before either payload allocation. Request: 1..2097152 bytes, strict UTF-8 without BOM, exact existing `1hk-dwg-edits/2`. Source: 6..209715200 bytes, `AC` plus four digits. Output: ASCII `1HKRSO01`, uint32-BE report length, uint32-BE DWG length, report bytes, output DWG bytes, EOF. Report: 1..1048576 bytes. DWG: 6..209715200 bytes. Existing reader budgets: 10000 entities across block records, 1000 layers, 100000 aggregate polyline vertices. Existing selected-edit budgets/geometry rules apply unchanged.

All public failure diagnostics are exactly `native stream resave failed.` plus newline, with nonzero exit. Invalid native/request data emits no success bytes. Output transport failure can leave an incomplete frame; downstream must reject incomplete output, nonzero exit or stderr.

Exact report shape (no extra fields):

```ts
{
  schemaVersion: "1hk-dwg-resave/1",
  qualification: "experimental-unqualified",
  persistenceAuthority: "not-issued",
  source: { sha256, byteSize, headerVersion },
  request: { schemaVersion: "1hk-dwg-edits/2", sha256, byteSize, handles },
  output: { sha256, byteSize, headerVersion },
  engine: { name: "ACadSharp", version: "3.7.1" },
  verification: {
    noEditRoundTrip: "passed", selectedEditRoundTrip: "passed",
    geometryTolerance: 1e-9, inventoriedEntityCount, editedEntityCount,
    inventoryCoverage: "supported-fields-only", independentCad: "not-performed"
  }
}
```

Hashes are lowercase SHA-256 over exact bytes. Handles are canonical uppercase UInt64 strings in original request order. Entire inventory count is 1..10000, edited count equals unique request handles and cannot exceed inventory count. Source/output headers match. No public paths, raw diagnostics, timestamps, inventories or authority-bearing fields.

## Build location and reproducible commands

All commands were run from `/Users/h/Documents/GoAgent/.worktrees/universal-workspace-m1`. Initial owned build setup copied the existing native project/cache, then built without restore:

```sh
mkdir -p .superpowers/sdd/2026-09-06-native-dwg-resave-protocol/workspace/native-copy
cp -R tools/dwg-engine-qualification/. .superpowers/sdd/2026-09-06-native-dwg-resave-protocol/workspace/native-copy/
dotnet build .superpowers/sdd/2026-09-06-native-dwg-resave-protocol/workspace/native-copy/DwgEngineQualification.csproj --no-restore
```

On subsequent revisions only `.cs` files were recopied into this owned copy:

```sh
cp tools/dwg-engine-qualification/*.cs .superpowers/sdd/2026-09-06-native-dwg-resave-protocol/workspace/native-copy/
dotnet build .superpowers/sdd/2026-09-06-native-dwg-resave-protocol/workspace/native-copy/DwgEngineQualification.csproj --no-restore
dotnet .superpowers/sdd/2026-09-06-native-dwg-resave-protocol/workspace/native-copy/bin/Debug/net8.0/DwgEngineQualification.dll self-test
```

Current DLL: `/Users/h/Documents/GoAgent/.worktrees/universal-workspace-m1/.superpowers/sdd/2026-09-06-native-dwg-resave-protocol/workspace/native-copy/bin/Debug/net8.0/DwgEngineQualification.dll`

- DLL SHA-256: `51b2f0f6bda21b5dd1dfcb93cb7a06ad3b6b382cfdb4bfa9a7051734f383132a`
- Copied pinned ACadSharp.dll SHA-256: `8bd071990b19026ef1429db287c2efe87029b0f679506a130604c4afab77f7fb`

## TDD and verification evidence

Initial RED: added an actual executable binary-stdin/binary-stdout success test before production changes. The copied build completed with 0 warnings and 0 errors. Running the exact self-test command above returned process exit 1, `35 passed, 1 failed`, and:

```text
FAIL resaves exact v2 geometry through the actual framed native CLI: resave CLI succeeds (exit=2, stderr=Usage:
  dwg-engine-qualification self-test
  dwg-engine-qualification self-test-native --input-dir <four-manifest-directory>
  dwg-engine-qualification write-native --input <manifest.json> --output-dir <new-directory>
  dwg-engine-qualification read-native --input <source.dwg> --output-dir <new-directory>
  dwg-engine-qualification read-native-stdio
  dwg-engine-qualification create-generated-fixture --output-dir <directory>
  dwg-engine-qualification qualify --input <input.dwg> --output-dir <directory> [--edits <request.json>])
35 passed, 1 failed
```

This was the intended absent-command assertion failure, not a compile error. The initial failure was captured in the tool transcript; the literal relevant output is reproduced here. The original initial test temporarily removed the known default viewport; the controller then amended scope to inventory/preserve it, and the final test retains it.

VIEWPORT RED after amendment: `workspace/viewport-red.log`, same copied build/self-test commands, `35 passed, 2 failed`: framed resave rejected the existing viewport gap and `ordinary viewport has supported passive inventory` failed before viewport implementation. This is a separate intended RED.

During implementation one copied build found CS0266 (long constant in int relational pattern), corrected to an ordinary long comparison. An intermediate viewport ownership test tried reparenting with a still-owned entity and failed with `already has an owner`; the test was corrected to mutate the actual Owner through the existing test reflection pattern. These were intermediate implementation/test defects, not presented as intended RED.

The actual CLI success test first passed before the supplemental edge tests were added. Supplemental coverage is not claimed as prior RED for the initial feature. It covers all 0..15-byte truncated headers, request/source truncation, wrong magic/version, zero/overflow/over-budget lengths (asserting no payload read), trailing bytes, invalid UTF-8/BOM, duplicate keys/handles, v1 including a genuinely valid v1 LINE request, stale hash, empty batch, invalid target in a batch, nonplanar edits, malformed native/header input, gaps/Xrefs/ineligible source geometry and memory-write overflow. The extra-argument rejection test produced a fresh RED (`40 passed, 1 failed`, `workspace/supplemental-red.log`) before its Program.cs error-path fix.

Final GREEN: `workspace/build-green.log` reports 0 warnings, 0 errors. `workspace/self-test-green.log` reports:

```text
PASS resaves exact v2 geometry through the actual framed native CLI
PASS detects unrequested passive viewport geometry plot and ownership changes
PASS resaves non-seekable chunked native frames
PASS rejects malformed resave frames and requests without success bytes
PASS rejects resave inventory gaps Xrefs and ineligible targets
PASS bounds native resave output memory before growth
41 passed, 0 failed
```

The success tests validate exact report keys/status flags/hashes/order, literal results for LINE/LWPOLYLINE/CIRCLE/ARC/TEXT (wrapped and full turn), non-first requested LINE, untouched first LINE and block LINE, units and retained paper viewport. They call the real CLI and real nonseekable 5-byte-chunk stream path. Existing tests continue to cover retained unknown registry objects, nonzero vertex IDs, atomic target validation and old reader/qualification regressions.

Existing three-flow lower-level integration:

```sh
NATIVE_DWG_GEOMETRY_TEST_ENGINE_DLL=/Users/h/Documents/GoAgent/.worktrees/universal-workspace-m1/.superpowers/sdd/2026-09-06-native-dwg-resave-protocol/workspace/native-copy/bin/Debug/net8.0/DwgEngineQualification.dll NATIVE_DWG_RESAVE_EVIDENCE_DIRECTORY=/Users/h/Documents/GoAgent/.worktrees/universal-workspace-m1/.superpowers/sdd/2026-09-06-native-dwg-resave-protocol/workspace/geometry-integration-green node --experimental-strip-types --test platform/tests/drawing-native-dwg-geometry-resave-integration.test.mjs
```

Result: exit 0, 1 test passed, 0 failed; all three wrapped/full-turn/nonzero-full-turn flows completed. Full log is `workspace/geometry-integration-green.log`; retained source/request/no-edit/edited/readback artifacts are under `workspace/geometry-integration-green`. The initial integration run failed on the obsolete literal unsupported VIEWPORT placeholder after the new native behavior passed. Per explicit controller approval, only expected status and viewport geometry/reference entry changed; complete untouched entity/block comparisons and all geometry/source checks remain. Expected viewport values use the pinned default A4 paper (297x210, center148.5x105), axis defaults and unset fields, not the production inventory builder.

Additional actual framed CLI evidence using the same ordinary generated source and compiler-produced requests:

```sh
node .superpowers/sdd/2026-09-06-native-dwg-resave-protocol/workspace/capture-framed-evidence.mjs
```

Result: exit 0, three framed resave/readback runs all exit 0 and stderr 0 bytes. Full inputs, outputs, report JSON, DWGs and native readback JSON are under `workspace/framed-evidence-green`; `summary.json` and `workspace/framed-evidence-green.log` contain the source/request/output/frame hashes and exact DLL identity. The evidence script additionally checks frame lengths/hashes, 9 inventoried entities, native readback against the independently literal-checked existing integration flows, and LINE end X=120 for wrapped/all-edits versus unchanged X=100 for ARC-only flows. An initial supplemental script incorrectly assumed all three flows edit LINE; that assertion failed for ARC-only full-turn, was corrected, and rerun in a new directory. The partial earlier evidence directory is retained; it is not represented as passing all flows.

Retained original source SHA-256 is `af173b15443624dcf7da13342e632326abc55a9a7ce2bd5fbd1acb06437334a9`. Final framed output SHA-256 values:

- wrapped: `49068eb71b5b08a0966340ee6a1b0b3c76802eb1860e45b045e6349a467821e9`
- full-turn: `d0e3d2d1769cc5859c1f028b50e518d933ff025e196b643dbab8c5662d4a3d8b`
- nonzero-full-turn: `c14b5ed066ec838c9476b3b9fb4cccf2d9901e3bd606ab3eaa5ad3270b53f9fd`

## Exact owned source files and final hashes

All paths below are relative to the linked worktree, not the root checkout. New files are NativeDwgResaver.cs and NativeDwgResaveSelfTests.cs; other changes are narrow existing-file edits.

| File | SHA-256 |
| --- | --- |
| tools/dwg-engine-qualification/NativeDwgResaver.cs | 1bc3b3bacfb59992f3026bfc05a43389e03a8abafd16ba3617371232418d3559 |
| tools/dwg-engine-qualification/NativeDwgResaveSelfTests.cs | 76dc1cb04fd4c75d7f55b8ddb2dedd0a054778ea5328a241a9fdcc5b3e04aab0 |
| tools/dwg-engine-qualification/Program.cs | 62ba82cce55f962aac1c78c5366df0c8fcdce684a09725004206a49128832d01 |
| tools/dwg-engine-qualification/SelfTests.cs | a562343f2d8d364ec1726e9060924ed427a40576b9360748f55131751e35c0d3 |
| tools/dwg-engine-qualification/SelectedDwgEdits.cs | ccd12c75330e42786a1107b6793d46e2e077f47a1ef367d69c2ae7e4710dae62 |
| tools/dwg-engine-qualification/QualificationRunner.cs | 266d1dff6baf5bd2f73fcb1d525915043870fd028522b2f9863143f5a7879be2 |
| tools/dwg-engine-qualification/NativeDwgReader.cs | 967a6687a74df41607632a89d258064cd7e8eff6c290ffde75bc0b215f619a75 |
| tools/dwg-engine-qualification/Dockerfile.reader | bde84323fe3577a61cedd5e1a0b68e8955beda512ef030cbb751f837579c9e5d |
| tools/dwg-engine-qualification/README.md | fa8ff6f0a041ecc62292d86c098a0e12a4c3ce8f80843ae3dc5f4c2a4677e127 |
| platform/tests/drawing-native-dwg-geometry-resave-integration.test.mjs | 34f91fc364e56bebd69744990053227ea8cebf907a62206140fff480d1061218 |

Other created files are owned build copies, generated test evidence/logs, this report and `workspace/capture-framed-evidence.mjs` under the current plan's private workspace.

## Self-review and practical limits

Compared modified files against controller baseline snapshots and reread the full new resaver. Confirmed framing/report field names and literal limits against amended spec; no duplicated selected-edit parser/application or alternate comparer. Success is deferred until validation/readback completes. Preserved existing reader entrypoint/pins. Reused the existing strict reader configuration and complete object-registry rejection. Native compilation and tests use only the private copy.

Build and new resave success stderr are clean. The complete pre-existing self-test suite is intentionally noisy: legacy negative qualification tests print rejected exception names/messages and temporary fixture paths. This is not production resave diagnostic leakage; every new resave rejection assertion checks the fixed generic stderr and no output. No independent CAD, Docker confinement, host adapter, UI/Auth/Storage/job or recipient test was claimed or run here.

Coverage remains explicitly supported-fields-only. General appearance, attributes, complete layout/plot settings, XData, and referenced visual-style/scale payload contents are not fully inventoried. Passive viewport references are checked by identity (and layer/scale names where available), not a promise of semantic preservation of every referenced payload. Unknown retention and polyline IDs rely on the existing pinned 3.7.1 private registry accessor and are fail-closed. The stream cap bounds this code's output buffers, not every ACadSharp internal allocation; process memory/resource confinement belongs to the host/container task. Default generated viewport preservation and field mutation detection are demonstrated; arbitrary customer viewport compatibility is not qualified.

No known Task1 blocker remains. Controller review and downstream isolated host/image work remain required.
