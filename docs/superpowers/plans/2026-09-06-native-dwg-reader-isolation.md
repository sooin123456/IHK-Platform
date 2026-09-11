# Native DWG Reader Isolation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run real DWG parsing under a verified per-read Linux isolation profile without giving it host files, network or service credentials.

**Architecture:** Reuse the existing native report builder and Node schema/projector. Add a raw-pipe CLI and pinned runtime image, then a bounded Docker lifecycle supervisor. Keep DB/UI authority unchanged until the confined reader is independently verified.

**Tech Stack:** Existing .NET8/ACadSharp3.7.1, Docker, Node/TypeScript/Zod/node:test.

**Spec:** `docs/superpowers/specs/2026-09-06-native-dwg-reader-isolation-design.md`

## Global Constraints

- Preserve dirty changes. No commit, push, deployment, remote DB mutation, paid dependency or unrelated container cleanup.
- Original caller bytes remain untouched; source cap200MiB; report stdout cap32MiB; stderr/metadata cap64KiB.
- Keep `1hk-dwg-import/1`, `experimental-unqualified` and the existing report schema. No canonical operations, source attestations or browser route.
- No host mounts, Docker socket, network access, inherited service credentials or original path in the parser container.
- Linux immutable image ID; user65532:65532; read-only root; no-new-privileges; dropALL capabilities; default seccomp; memory/swap1GiB; CPU1; pids64; tmpfs/tmp16MiB only.
- Maximum120s outer and inner execution deadline; separate10s cleanup budget; never remove an unowned container.
- Existing DXF source guards and source-free native export authority must not change.

### Task 1: Reusable native pipe reader and image

**Files:** Modify `tools/dwg-engine-qualification/NativeDwgReader.cs`, `Program.cs`, `SelfTests.cs`, `README.md`; create `NativeDwgStreamSelfTests.cs`, `Dockerfile.reader`, `.dockerignore` in the same directory. The initial Dockerfile-specific ignore was replaced after actual classic-builder evidence showed it was ignored; keep one standard whitelist policy.

**Interfaces:** `NativeDwgReader.RunStream(Stream input, Stream output, TextWriter error)`; exact CLI `read-native-stdio`; UTF8 JSON report to stdout, fixed diagnostic to stderr on nonzero exit. Image DLL path `/app/DwgEngineQualification.dll` and pinned base digests from spec.

- [x] Write behavioral RED checks with real generated DWG bytes. Call the actual Program CLI in a subprocess with redirected binary stdin/stdout. Assert one schemaVersion1hk-dwg-import/1 report, originalSHA and literal LINE geometry. Exercise a non-seekable/chunked stream, header-only and truncated DWGs, oversized bounded generated stream and no partial success report on validation failure.

```csharp
Assert(exitCode == 0, "pipe reader succeeds");
Assert(report.GetProperty("source").GetProperty("sha256").GetString() == beforeSha, "same original bytes");
Assert(report.GetProperty("coverage").GetProperty("importedEntities").GetInt32() == 5, "literal fixture projection");
```

- [x] Extract the existing strict native report construction into one reusable private helper; file CLI retains source recheck and publication. Add bounded stream input and binary output, exact CLI branch, locked multistage Dockerfile and build-context whitelist; document local trusted image ID configuration and no qualification claim.
- [x] Run actual native `self-test`, Release build0warnings/errors; retain all previous reader/selected-edit tests. Report RED/GREEN and notify root only once native source/build is stable. Root builds image and performs cross-task Docker validation. No commit.

### Task 2: Host Docker supervisor

**Files:** Create `platform/app/lukas/lib/drawing-native-dwg-sandbox.server.ts`, `platform/tests/drawing-native-dwg-sandbox.test.mjs`. Do not edit existing worker/reader/projection modules.

**Interfaces:** `runIsolatedNativeDrawingDwgReader({dockerPath,dockerHost,imageId,sourceBytes,expectedSource,signal?,timeoutMilliseconds?})` returns existing `NativeDrawingDwgImportReport`. `nativeDwgSandboxCreateArguments({imageId,nonce,timeoutMilliseconds})` returns fixed production create argv for the profile in spec.

- [x] Write RED tests for exact immutable image/local socket/source rejection before spawn, literal security profile, abort/timeout and output caps, native report identity, uncertain-create reconciliation and owned-only cleanup. A finite scripted Docker transport may exercise failure lifecycle, but do not label it real native/isolation evidence.

```js
assert(args.includes("--read-only"));
assert.equal(args[args.indexOf("--network")+1], "none");
await assert.rejects(runIsolatedNativeDrawingDwgReader({...input,imageId:"mutable:latest"}), /Isolated native DWG read failed/);
```

- [x] Implement minimal stdlib spawn/pipe handling with backpressure, source snapshot, strict schema, exact inspect verification and one generated attempt. Fixed production command/no shell; explicit socket and minimal CLI environment; reject live/nonzero/OOM exit; remove only verified owned identity, reconcile uncertain creation by exact generated name, and fail if cleanup is uncertain. Validate profile rather than assume requested Docker flags were applied.
- [x] Run focused node:test suite and app typecheck; record exact RED/GREEN. Task3 will run this actual API against the real image. No Docker engine success faked as qualification, no commit.

### Task 3: Actual isolation integration, review and evidence

**Files:** Create `platform/tests/drawing-native-dwg-sandbox-integration.test.mjs`; add `docs/superpowers/evidence/2026-09-06-native-dwg-reader-isolation.md` and small matching JSON evidence. Root owns generated private verification scripts and evidence bookkeeping.

**Interfaces:** Consume Task1 image built with Dockerfile.reader and Task2 API/argv builder. Tests require absolute `NATIVE_DWG_DOCKER_PATH`, explicit `NATIVE_DWG_DOCKER_HOST` and full `NATIVE_DWG_READER_IMAGE_ID`; unavailable prerequisites fail, never skip. Use existing published native create-generated-fixture CLI to create owned actual input.

- [x] Add real tests before claiming isolation: successful actual native read→projector with literal geometry/hash, two unique attempts, invalid source/abort cleanup. Create a finite benign probe using the same builder profile (test-only argv command replacement, not a production hook) and assert actual UID65532, no-new-privileges1/capabilities0, root writes fail, no host mounts/environment secret, only loopback/no network route, memory.max1073741824, cpu.max quota/period ratio1 and pids.max64. Use `/proc` and cgroup evidence, not only arg assertions. Inner timeout kills a finite sleeper; wrapper abort stops its owned container; cleanup never prunes unrelated objects.

```js
assert.deepEqual(report.coverage, {modelSpaceEntities:6, importedEntities:5, unsupportedEntities:1, nonModelSpaceEntities:3});
assert.equal(projectNativeDrawingDwgImport({...scope,report,expectedSource}).objects.length,5);
assert.equal(await sha256Of(original), expectedSource.sha256);
```

- [x] Build actual pinned image locally (existing Docker classic builder is available; buildx is absent). Run tests against immutable image ID and explicit local socket. Run native old/new suites, Node direct import/reader/selected-edit/native-export regressions and typecheck. Independently review each implementation task and whole-unit diff; fix actual findings with covering tests.
- [x] Publish exact build/image/source/hash/cgroup/test evidence and remaining job/attestation/browser/approved-resave/recipient gates. Keep full goal active; no release/compatibility/security-certification claim. Preserve captured dirty baselines rather than commit or remove worktree.
