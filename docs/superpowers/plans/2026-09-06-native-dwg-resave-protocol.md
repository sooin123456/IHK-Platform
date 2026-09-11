# Isolated Native DWG Resave Protocol Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make verified selected DWG edits execute through a bounded binary protocol in the existing isolated Linux engine.

**Architecture:** Reuse selected-edit validation, inventory and semantic readback for a new native stdio command. Add strict report/framing validation and a fixed resaver profile sharing the existing private Docker lifecycle.

**Tech Stack:** Existing TypeScript/Zod/Node tests, C# .NET 8, pinned ACadSharp3.7.1, local cached Docker only.

**Spec:** `docs/superpowers/specs/2026-09-06-native-dwg-resave-protocol-design.md`

**Status:** Both tasks and final cross-task review accepted. Controller regression186/186, actualresaver3/3, actualreader5/5, native41/41 and typecheck passed. Exact evidence: `docs/superpowers/evidence/2026-09-06-native-dwg-resave-protocol.md`. Experimental local unit only; full Universal Workspace goal remains active. No commit or deployment.

## Global Constraints

- No commit/stage/merge/push/deployment, dependency installation, paid service, remote database/Storage writes or customer files.
- Preserve existing dirty changes, source bytes, approved-source and source-free export contracts; no app build writes to live platform/build or preview restart.
- New output stays `experimental-unqualified` and `persistenceAuthority: not-issued`; independent CAD is `not-performed` and inventoryCoverage `supported-fields-only`.
- Native input `1HKRSV01` + u32BE request/source lengths; output `1HKRSO01` + u32BE report/DWG lengths. Exact EOF, request<=2MiB/source<=200MiB/report<=1MiB/output<=200MiB; only v2 edit JSON.
- Reuse ACadSharp3.7.1 and current hardening; resaver memory/swap2147483648, reader1073741824, deadline<=120000ms, independent cleanup10000ms. No public arbitrary command, mounts or environment API.
- Use only owned local generated fixtures/test containers/build outputs, preserving unrelated runtime state.

---

### Task 1: Native framed resave with exact semantic readback

**Files:**
- Create: `tools/dwg-engine-qualification/NativeDwgResaver.cs`, `NativeDwgResaveSelfTests.cs`.
- Modify narrowly: `Program.cs`, `SelfTests.cs`, `SelectedDwgEdits.cs`, `QualificationRunner.cs`, `NativeDwgReader.cs` in that directory (only needed byte/stream helper reuse and new CLI registration).
- Modify: `tools/dwg-engine-qualification/Dockerfile.reader` to add the fixed resaver protocol label, preserving all old image behavior.
- Modify: `tools/dwg-engine-qualification/README.md` to document protocol/limits/qualification.
- Modify narrowly: `platform/tests/drawing-native-dwg-geometry-resave-integration.test.mjs` only to update the expected VIEWPORT inventory-gap status and its former unsupported placeholder geometry/reference literal once native VIEWPORT preservation is actually inventoried. Derive the replacement literal from pinned default paper/layout values, not the production inventory output/helper. Keep the full untouched-entity comparison, actual five-type geometry/source checks and ordinary generated fixture intact.

**Interfaces:**
- Consumes existing SelectedDwgEdits validation/Apply, NativeDwgReader validation, QualificationRunner.Inventory/RejectUnwritableObjects and SemanticComparer.Compare.
- Produces `NativeDwgResaver.RunStream(Stream input, Stream output, TextWriter error): int`, exact `resave-native-stdio` command and report/wire shape in spec. Native byte/stream overloads are internal and share old code; do not duplicate request parser or selected-edit application.
- Downstream Task2 consumes exact input/output magic/order/limits/report fields. Request handles preserve input order.

- [x] **Step 1: Add a CLI behavior test and observe RED.** Tests invoke the actual current executable with new command (so absent command yields an assertion failure, not a compile error), binary stdin and captured binary stdout. Generate real DWG fixtures using existing ACadSharp pattern. Create v2 request using actual handles and hand-derived target geometry. Assert success frame, strict literal report flags, exact source/request/output hashes, literal edited geometry and untouched entities. Example:

```cs
Assert(exitCode == 0, "resave CLI succeeds");
Assert(error.Length == 0, "successful resave has no stderr");
Assert(frame.AsSpan(0, 8).SequenceEqual("1HKRSO01"u8), "resave output magic");
Assert(line.EndPoint.X == 175 && line.EndPoint.Y == 35, "literal requested LINE end");
```

Run an owned copied native project with cached obj/packages and `dotnet build --no-restore`, then its `self-test`. Record the absent-command failure before implementation. Build only the copied project; no root bin/obj modifications.

- [x] **Step 2: Implement bounded framing and native resave.** Read exactly16bytes then enforce request1..2097152 and source6..209715200 before allocation; reject trailing bytes. Add `SelectedDwgEdits` byte parser overload reused by existing Load and require v2 for resave. Validate source via existing native-reader behavior; reuse stream read/write helpers and semantic comparer for no-edit and requested edit roundtrips. Reject inventory gaps, Xrefs, retained unknowns/lossy vertex IDs, wrong source, unsupported targets before publishing. Bound memory writes/output. Serialize only the spec's allowlisted report and emit complete frame after success. Failure is fixed stderr and nonzero.

Preserve the ordinary default paper VIEWPORT rather than deleting it from fixtures. Extend existing passive inventory with relevant intrinsic viewport geometry/view/plot/reference fields, and detect unrequested changes with literal tests. Do not compare undefined derived scale divisions; compare their stored inputs. Continue rejecting real unhandled inventory types. This closes the known default-fixture VIEWPORT gap rather than claiming the existing gapped roundtrip was already sufficient.

```cs
var noEditComparison = SemanticComparer.Compare(baseline, noEdit, ExpectedEdits.None, 1e-9);
if (noEditComparison.Failures.Count != 0) throw new InvalidDataException();
requestedEdits.Apply(document, sourceSha256);
var expected = QualificationRunner.Inventory(document, diagnostics);
var editedComparison = SemanticComparer.Compare(expected, reread, ExpectedEdits.None, 1e-9);
if (editedComparison.Failures.Count != 0) throw new InvalidDataException();
```

- [x] **Step 3: Exercise edge behavior and GREEN.** Cover all five v2 types including wrapped/full-turn ARC, non-first handles, no implicit edit, chunked nonseekable input, 16byte truncated/wrongmagic/zero/overflow/budget/trailing frames, invalidUTF8/BOM/duplicatekeys/version1/stalehash/invalidbatch. Assert no success bytes on each failure and exact generic diagnostic. Run native self-test plus current lower-level three-flow geometry integration using the copied updated DLL via its existing environment override. Do not label supplemental tests as prior RED if added after first green.

- [x] **Step 4: Record and self-review.** Add image protocol label `org.1hk.native-dwg-resaver.protocol="1hk-dwg-resave/1"` (old reader entrypoint unchanged), concise README protocol example/limits/status. Save complete RED/GREEN commands/results, file list, copied build path/current DLL hash and concerns in task report; no commit. Review only owned diff and report actual output warnings candidly.

### Task 2: Strict host protocol and isolated execution integration

**Files:**
- Create: `platform/app/lukas/lib/drawing-native-dwg-resave-protocol.server.ts` (pure framing/report validation).
- Modify: `platform/app/lukas/lib/drawing-native-dwg-sandbox.server.ts` (closed internal profile/lifecycle sharing and two new fixed exports).
- Create: `platform/tests/drawing-native-dwg-resave-protocol.test.mjs`, `drawing-native-dwg-resave-sandbox.test.mjs`, `drawing-native-dwg-resave-sandbox-integration.test.mjs`.
- Existing `platform/tests/drawing-native-dwg-sandbox.test.mjs` may extract only its finite transport into `tests/fixtures/drawing-native-dwg-sandbox-transport.mjs` for shared behavior tests; preserve reader test cases/expectations. No wholesale duplicate fake daemon or runner.

**Interfaces:**
- Consumes Task1's exact spec wire/report and current isolated reader lifecycle. Existing compiler result.request becomes exact UTF-8 requestBytes upstream; source/approved authority stays outside this protocol.
- New sandbox exports `nativeDwgResaveSandboxCreateArguments({imageId,nonce,timeoutMilliseconds}): string[]` and `runIsolatedNativeDrawingDwgResaver({dockerPath,dockerHost,imageId,sourceBytes,expectedSource,requestBytes,expectedRequestSha256,signal?,timeoutMilliseconds?}): Promise<{report,reportBytes,dwgBytes}>`.
- New protocol exports `NativeDrawingDwgResaveReportSchema`, `encodeNativeDrawingDwgResaveInput({sourceBytes,expectedSource,requestBytes,expectedRequestSha256}): {chunks:Buffer[],source,request}` and `decodeNativeDrawingDwgResaveOutput(bytes, expected:{source,request}): {report,reportBytes,dwgBytes}`. Here source is parsed SourceSchema; request is `{schemaVersion:"1hk-dwg-edits/2",sha256,byteSize,handles:string[]}` matching report.request. Copies/freeze validation occurs synchronously in encoder; source/request snapshots are retained for exact caller mutation checks. Decoder uses strict report shape and independent SHA/header/length/handle checks.

- [x] **Step 1: Write focused failing host behavior tests.** Import modules dynamically and fail assertions for absent APIs. Literal16byte header verifies BE lengths; validate complete strictly literal successreport/frame and reject changed lengths/magic/UTF8/BOM/trailing/hash/header/handles/status. Assertions must not use production encoder for expected frame bytes. Native C# validates full v2 geometry; host strictly bounds/parses root metadata, handles/types/schema/source binding, while preserving exact bytes for native strict duplicate-key/geometry enforcement.

```js
assert.deepEqual(encoded.chunks[0].subarray(0,8), Buffer.from("1HKRSV01"));
assert.equal(decoded.report.persistenceAuthority, "not-issued");
assert.throws(() => decodeNativeDrawingDwgResaveOutput(trailingFrame, expected));
await assert.rejects(runIsolatedNativeDrawingDwgResaver(mismatchedInput), {message:"Isolated native DWG resave failed."});
```

- [x] **Step 2: Share existing private lifecycle with fixed resaver profile.** Preserve reader argv/errors exactly. Internal profile catalog has reader and resaver only; separate names/labels/command/image protocol, resaver2GiB. Private Docker helper uses stdin chunks/backpressure and explicit output budget (16+1MiB+200MiB for resaver) without concatenating source+request twice. Validate actual image/container policy before start and after exit. Reuse ownership cleanup/config isolation/deadlines; no host fallback. Return only after both cleanup stages and final source/request mutation/abort rechecks. Add no route/job/Storage mutation.

- [x] **Step 3: Add finite transport lifecycle regression and GREEN.** Verify exact2GiB/resaverreceipt, misconfiguredimage,wrongcommand/resource/Mounts/stderr/nonzero/OOM/outputoverflow/malformedreport/requestsource mismatches, uncertaincreate andforeigncleanup. Cover source AND request mutation and abort at start/removal/configcleanup; fail closed ifcleanupfails. Keep old reader test coverage and run both together. Finite doubles assert real host behavior only, not CAD or kernel proof.

- [x] **Step 4: Actual Docker/native integration.** Use current native code to build an owned local image from pinned cached Dockerfile inputs (no pull/dependency upgrade; report if offline build prerequisite fails). Test actual generatedsource -> isolatedreader -> projectNativeDrawingDwgImport -> applyDrawingCommand/buildNativeDrawingDwgSelectedEdits -> isolatedresaver -> isolatedreader. Assert literal five-type geometry, handles, header/unit, original/request SHA, untouchedinventory and exactrequest/report/output hashes. Exercise cancellation/invalid request and boundeddeadline with observedownedcleanup; inspect actual2GiB resourceprofile/cgroup, no host mounts/network/capabilities, foreigncontainerpreserved. Reuse existing image for oldreaderactualisolation suite regression. No runningtestservicesorownedcontainersleft; preserve unrelatedpreview. Required env missing must fail, not silentlyskip real proof.

- [x] **Step 5: Final checks and report.** Run focusednewtests plus reader/sandbox/selected/source/resave-source regressions, currenttypecheck anddiffcheck. Record current nativeimageID/buildSHA, realCLI/docker vsfinitefixture coverage separately and all unresolved fullgoal gates. Save report with no commit. Newtests+realprocess outputs prove behavior, not source-text assertions.
