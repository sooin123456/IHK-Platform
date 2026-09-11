# Task3 brief — controlled imported-DWG publication

Read this first; implement this task only after controller dispatch. Do not read the whole plan/history. Binding design: docs/superpowers/specs/2026-09-06-native-dwg-resave-publication-design.md sections Verified artifacts, Storage settlement, Database evidence and Publication worker. Prior Task1 core is accepted; Task2 publication SQL must pass review before this task starts.

## Worktree and constraints

- Root /Users/h/Documents/GoAgent/.worktrees/universal-workspace-m1; run tests in platform, NODE_OPTIONS=--no-experimental-webstorage.
- Branch codex/universal-workspace-m1, HEAD9f5f56d93db325ff935772252f9d4fb64d69f98c. Preserve all unrelated dirty edits. No stage/commit/merge/push/deploy or dependency installation.
- No paid/license service, remote/customer mutation, private .superpowers/sdd reads/writes, old private binaries, original4173 restart or authoritative platform/build/typegen writes.
- Public exact-baseline review/evidence replaces skill-private scripts. Use apply_patch for edits. No subagents/reviewers; controller independently reviews your report/diff.
- Source-free exporter and native-only attempt API/cleanup remain unchanged. Output remains experimental-unqualified, persistenceAuthority:not-issued.
- Raise bounded architecture/contract ambiguity to controller instead of guessing or expanding Task4. Implement TDD, self-review exact baseline delta, report evidence; no approval prompt.

## Exact plan task

## Task 3: Cancellation-aware publication worker

**Files:**
- Create platform/app/lukas/lib/drawing-native-dwg-resave-publication.server.ts
- Modify platform/app/lukas/lib/drawing-native-dwg-resave-worker.server.ts narrowly to export callNativeDrawingDwgResaveAttemptRpc, readNativeDrawingDwgResaveAttemptControl, NativeDrawingDwgResaveStaleLease. Native behavior unchanged.
- Create platform/tests/drawing-native-dwg-resave-publication.test.mjs using Task1 fixture and actual production core.

**Interfaces:**
- publishNativeDrawingDwgResaveArtifacts({prepared,serviceClient,storage,imageId,signal?}); prepared is existing {outcome:"prepared",claim,result}.
- callNativeDrawingDwgResaveAttemptRpc(client:NativeDrawingDwgImportRpcClient,name:string,args:Record<string,unknown>):Promise<unknown> is the existing private5s RPC unchanged, just exported/renamed. readNativeDrawingDwgResaveAttemptControl(client,claim:ReturnType<typeof parseNativeDrawingDwgResaveClaim>) returns the existing strict Control union after exact identity validation; no parent-signal parameter is introduced. NativeDrawingDwgResaveStaleLease renames/exports existing private StaleLease; native check closure calls the exported reader, preserving its first-refusal latch.
- runNativeDrawingDwgResaveToStorage(options) takes accepted attempt options plus storage; calls actual runNativeDrawingDwgResaveAttempt once; nonprepared passes through, prepared goes to publisher.
- storage is the actual return type of createNativeDwgResaveStorageTransport: upload({kind,path,bytes:Uint8Array,signal})→Promise<"uploaded"|"exists"> and read({kind,path,signal})→Promise<Uint8Array>. Capture options and bound Storage method references before awaiting the native attempt. Reuse NativeDwgConfirmedUploadError from the existing worker transport module; all other upload errors are uncertain. Do not classify by error-name strings or rebuild transport/error classes.
- Result includes accepted nonprepared variants plus {outcome:"completed",receipt} or {outcome:"publication_uncertain"}; uncertain upload/close uses settlement_uncertain. Invoke Task2 SQL RPCs through the reused 5s helper and strict Task1 validators; no dependency on a later task.

- [ ] Write RED tests with real artifact builder, controlled RPC/Storage boundary promises and independent literal sequence expectations. Example:

```js
const run = publishNativeDrawingDwgResaveArtifacts(options);
await transport.postStarted.promise;
control.cancel();
assert.equal(calls.includes("close"), false);
transport.postSettled.resolve("uploaded");
assert.equal((await run).outcome, "cancelled");
assert.ok(calls.indexOf("close") < calls.indexOf("ack"));
```

  Existing Storage upload resolves "uploaded"|"exists". Cover parent already aborted, A→late-control-refusal, no-op pass-through, mutation after call, upload/read corruption, ignored abort, typed confirmed/untyped unknown rejection, lost stage/close/publish, closed replay no POST, publish replay exact same identity, no cancellation ACK until every owned call and upload closure are proven.
- [ ] Run new tests to expected missing API failure, then implement snapshot→control→stage→four sequential uploads/readbacks→close→stop+await poll→final control→publish. 1000ms poll, existing 5s RPC deadlines, first refusal latch, separate cleanup signal. Closed stage readback only. Never race-abandon POST. Unknown stage attempts exact close; unconfirmed closure stays uncertain. Unknown publish performs one same-identity replay; never fail/new admission based on lost reply.
- [ ] Reuse exact accepted fail/cancel control behavior after closure, map integrity to output_invalid and definite Storage rejection to upload_failed. Do not modify native cleanup or qualify native outputs.
- [ ] Run new worker tests plus accepted worker/jobs/protocol tests and source-free transport once; owned-copy typecheck; report RED/GREEN and external-boundary limits, review delta. No commit.


## Accepted dependencies / baseline

- Task2 is now independently accepted (spec compliant/task quality Approved, no Critical/Important). Concrete SQL contract: supabase/migrations/20260906130844_drawing_native_dwg_resave_publication.sql, SHA256ba1fade7c669dd4ce6022750d6787796cc8b93e37f6bcba03c9d5ea0ca2a61e6. Read the stage85/close142/publish173 and fail284/ack305 result contracts as needed. No service publication adapters were added: this task calls those RPCs through the existing5s worker helper. Authenticated artifact-jobs adapters are not your service dependency.

- Existing native worker exact pre-task source is baseline/task-3-drawing-native-dwg-resave-worker.server.ts, SHA256 95c99102ed97c287594bd22a0662bb2d37f27ca28f2a40bc6aa8f9a5f6302be8. Use it for review, not HEAD.
- Artifact core: app/lukas/lib/drawing-native-dwg-resave-artifacts.server.ts; the builder returns copied buffers plus ordered metadata after actual compiler/attestation/protocol verification. Reuse its exact stage/receipt validators/path helper; do not duplicate their native validation.
- Storage implementation: native-dwg-worker/src/supabase.ts. Its new imported profile preserves conservative uncertainty after any request invocation exception, unknown HTTP4xx/5xx/body failure; only explicit duplicate or fully consumed401/InvalidJWT has documented evidence. The publisher trusts an actual NativeDwgConfirmedUploadError instance for definite no-write. Do not broaden transport semantics or change source-free behavior.
- Read tests/fixtures/drawing-native-dwg-resave-artifacts.mjs for resaveArtifactFixture(buildAttestation); finite literal output is boundary evidence, never actual native execution. Existing native worker test and source-free tests are regression gates.
- Native helper extraction is narrow: existing rpc -> exported callNativeDrawingDwgResaveAttemptRpc, existing StaleLease -> exported NativeDrawingDwgResaveStaleLease; factor existing Control.parse+requireIdentity call into exported readNativeDrawingDwgResaveAttemptControl. Keep5s deadline and first-refusal behavior; no new general RPC framework.
- Dependencies/config are snapshotted before the first await; capture bound Storage method references before awaiting native execution. The native runner parses/copies its claim synchronously; the core snapshots prepared buffers synchronously.
- Do not change SQL, public DTO/UI/HTTP routes or CLI. Task4 owns public DTO extraction/browser consumer. Do not start Docker or use actual Auth/Storage in this finite worker task; Task5 owns actual acceptance.
- The controller synchronizes exact source changes to /Users/h/1hk-r2-restore-uvc74K/platform for a real full build/typecheck after your test report. You may use existing worker noemit checks if they do not emit authoritative files.

## Report contract

Write full report to /Users/h/Documents/GoAgent/.worktrees/universal-workspace-m1/docs/superpowers/evidence/2026-09-06-native-dwg-resave-publication/task-3-report.md: exact changed-file list+hashes; implementation behavior; RED command/assertion before production; GREEN commands/results; meaningful independent expected sequence assertions; self-review; unverified boundaries/concerns. Run focused iteration first and one covering regression set at the end, not whole suite on every edit. Include observed warnings rather than claiming pristine. Return under15lines: DONE/DONE_WITH_CONCERNS/NEEDS_CONTEXT/BLOCKED, no commits, one-line test summary, concerns and report path.
