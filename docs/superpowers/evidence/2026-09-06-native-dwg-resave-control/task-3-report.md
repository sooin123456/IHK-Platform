# Task3: cancellation-aware imported-DWG execution

Status: DONE_WITH_CONCERNS — implementation and local verification complete; files frozen for independent controller review and the controller's owned-copy build. This is internal prepared execution, not publication or completion of R4/R5.

Authoritative checkout: `/Users/h/Documents/GoAgent/.worktrees/universal-workspace-m1`; all test/typecheck commands ran from its `platform` directory using Node v26.5.0 and existing dependencies. Evidence root: `/tmp/1hk-resave-control-m6Q9WS/task3-IgWX4x`, freshly created with `mktemp -d`. No git mutation, installation, build, preview change, remote database/Storage write, private DLL, private `.superpowers/sdd` access, or customer data.

## Implemented contract

- New `platform/app/lukas/lib/drawing-native-dwg-resave-worker.server.ts`: `runNativeDrawingDwgResaveAttempt({claim,serviceClient,downloadSource,resave?,imageId,dockerPath,dockerHost,signal?})`. The default native dependency is the existing isolated resaver; source transport remains the existing single-object `downloadSource({source,signal})` signature.
- Reuses accepted `parseNativeDrawingDwgResaveClaim`, production attestation builder/projector/compiler, existing source shape, and strict protocol encoder/decoder. Rebuilds and compares the entire exact attestation before download. Full import source goes only to source transport; sandbox receives the strict three-field source subset. Trusted runtime configuration is captured before awaits.
- Successful initial control, independent serialized polls scheduled 1000ms after each completed poll, and an immediate post-native control call. Each service RPC has its own 5000ms abort/deadline race, including transports which ignore abort. The execution controller is separate. The first refusal/uncertainty stays latched; later continue replies and abort-ignoring native results cannot undo it. An earlier in-flight poll is still awaited even when post-native control succeeds.
- Source/native promises are awaited through settlement, never abandoned by a timeout race that claims cleanup. Poll timers stop and pending control calls settle before exit. Native limits remain 120s execution, 10s independent cleanup, 200MiB source/output.
- Resaver-only `NativeDrawingDwgResaveSandboxError.cleanupConfirmed` records each owned resource as unsettled before its creation attempt and clears it only after the existing exact cleanup confirmation. No added cleanup operation, lifecycle retry, resource/profile change, reader error change, or new native detail/path exposure. A rejected untyped native promise or false flag cannot authorize cancellation/failure settlement.
- Validated private settlement responses require exactly `{jobId,attemptNumber,leaseToken,status}` and all claim identity fields. Returns prepared/cancelled/retry_scheduled/failed/stale/control_uncertain/settlement_uncertain. Malformed claims have no trusted settlement identity and return control_uncertain. Prepared contains snapshotted exact native report/reportBytes/DWG bytes plus validated claim; report object must match report bytes. No admission retry, completion/publication RPC, output receipt, UI, CLI or scheduled worker wiring.

## RED/GREEN and verification

All logs below are under the evidence root.

1. `node --test tests/drawing-native-dwg-resave-sandbox.test.mjs` → `sandbox-red.log`: 19 tests, 2 pass/17 fail. Behavioral assertions required typed cleanup evidence but the existing sandbox returned generic Error. This included ordinary abort after actual finite CLI cleanup, failed removal, foreign ownership, replaced CLI directory, and uncertain CLI directory creation.
2. `node --test tests/drawing-native-dwg-resave-sandbox.test.mjs tests/drawing-native-dwg-sandbox.test.mjs` → `sandbox-green.log`: 37/37 pass. Initial class parameter-property syntax was replaced with an explicit readonly declaration/assignment to preserve Node strip-only imports; no runtime behavior was changed by that correction.
3. `node --test tests/drawing-native-dwg-resave-worker.test.mjs` → `worker-red.log`: 0/46, required cancellation-aware attempt API absent. Production compiler/attestation fixture setup succeeded before those assertions. `worker-green.log`: 46/46 after implementation.
4. `node --test --test-name-pattern='post-native control starts immediately' tests/drawing-native-dwg-resave-worker.test.mjs` → `post-native-red.log`: control count 2 instead of 3 while an earlier poll was held. The implementation initially waited for that poll before starting final control. Fixed by starting post-native control immediately, retaining and awaiting earlier pending refusal. `post-native-green.log`, then combined `edges-green.log`: passes.
5. `node --test --test-name-pattern='trusted runtime configuration' tests/drawing-native-dwg-resave-worker.test.mjs` → `runtime-snapshot-red.log`: caller mutation during source await changed native runtime configuration, producing settlement_uncertain instead of prepared. Captured trusted runtime arguments before awaits. `edges-green.log`: 2/2 post-native and configuration cases pass.
6. Final focused command below → `focused-final.log`: 276 tests, 275 pass, 0 fail, 1 explicitly opted-out actual sandbox test. The worker contributes 48 passing cases. The actual test is separately enabled and passed below.

```sh
node --test \
  tests/drawing-native-dwg-resave-attestation.test.mjs \
  tests/drawing-native-dwg-resave-source.test.mjs \
  tests/drawing-native-dwg-selected-edits.test.mjs \
  tests/drawing-native-dwg-resave-protocol.test.mjs \
  tests/drawing-native-dwg-resave-jobs.test.mjs \
  tests/drawing-native-dwg-resave-worker.test.mjs \
  tests/drawing-native-dwg-resave-worker-sandbox.test.mjs \
  tests/drawing-native-dwg-resave-sandbox.test.mjs \
  tests/drawing-native-dwg-sandbox.test.mjs \
  tests/drawing-native-dwg-import-worker.test.mjs \
  tests/drawing-native-dwg-worker.test.mjs \
  tests/drawing-native-dwg-import-jobs.test.mjs \
  tests/drawing-native-dwg-jobs.test.mjs
node node_modules/typescript/bin/tsc --noEmit
node node_modules/typescript/bin/tsc -p native-dwg-worker/tsconfig.json --noEmit
```

Both final direct no-emit typechecks exited 0 with empty `app-typecheck-final.log` and `worker-typecheck-final.log`. Existing formatting command applied to the five Task3 code/test files; `prettier.log`. No typegen/build was run. Task1/2 database suite was not rerun by this task; its accepted evidence remains separate.

## Actual cached native bridge test

New explicit-opt-in `platform/tests/drawing-native-dwg-resave-worker-sandbox.test.mjs` is self-contained: it reads the public synthetic DWG, obtains an actual native reader report, builds real import-plan source anchors and a synthetic exact approved snapshot, makes literal LINE 4A `(10,11)→(120,21)`, compiles the production attestation, invokes the bridge with the actual resaver, and reads the resulting native DWG back with the actual reader. Layers and other projected entities match the original.

For cancellation, a forwarding CLI shim starts the actual owned native container without attaching stdin, leaving the native resaver waiting for framed input. Independent daemon inspection requires `State.Running:true` before the finite service state changes to cancel. The bridge's independent poll aborts execution. The cancellation RPC double checks the exact daemon ID is absent via a successful daemon listing, all logged private CLI config directories are absent, and the execution signal is aborted while its own signal remains alive before returning its identity-matching cancelled response. No synthetic native report/output is used in this test.

```sh
NATIVE_DWG_RESAVE_WORKER_SANDBOX=1 \
NATIVE_DWG_RESAVE_WORKER_EVIDENCE_DIRECTORY=/tmp/1hk-resave-control-m6Q9WS/task3-IgWX4x/actual-final \
node --test tests/drawing-native-dwg-resave-worker-sandbox.test.mjs
```

`actual-native-final.log`: exit 0, 1/1. The evidence-directory child must not already exist; choose a fresh child when repeating. Earlier successful probe is retained in `actual/`; final-code probe is in `actual-final/` with `summary.json`, pinned image inspection, actual running container receipt, exact request/report bytes, and forwarding command log. The controlled process has no private DLL or rebuild prerequisite.

Final probe identities:

| Identity | Value |
| --- | --- |
| Docker | `/opt/homebrew/bin/docker`, `unix:///Users/h/.colima/default/docker.sock` |
| Cached immutable image | `sha256:c921c67ddb37d2a57969d04c7a4983f6d847e0b89901403e3b015ac25bf566ae` |
| Public original source SHA-256 | `bcc54d3c768444c9ade41a23e4ef2b9f5b5668d9972522ee4a4adbc98c670434` |
| Source | 10987 bytes, AC1024; reread hash unchanged |
| Request SHA-256 | `c0284f1afc70b7c8641c9010b1f61131038202ea3490730ad7e7d9f226f83a2a` |
| Authority SHA-256 | `fbaea666300bcce97b78b55d7184d58fd7837be2c859eeff50fa4de0dc21de17` |
| Final native report SHA-256 | `55f9a92042c6bfbd91ef2c2bddf70de62677a65f0e7736b0e89d855b48a9aed4` |
| Final native output SHA-256 | `c300bf8f9bbc359c90f040168b179a0e85398e81c8a5c9fb7606c8f2ba7f2b14` |
| Output | 11019 bytes, AC1024; internal prepared result only |
| Cancelled/removed exact container | `1b9cf6411f9f593aef8d01d85bc3b85099f7e44ef1f52d59ff02f98d60edf1f3` |

Actual native versus finite boundary: native reading, writing, readback, container-running inspection and cleanup were real. Approval/claim and service control/failure/ack replies were controlled in-memory fixtures, not real PostgreSQL cancellation, Auth, Storage, browser, published artifact or recipient CAD acceptance. Real database races are separately covered by accepted Task2. No new production qualification follows from synthetic native success. Markers remain experimental-unqualified and persistenceAuthority:not-issued.

## Exact source hashes and handoff

Saved pre-task sandbox source SHA-256: `87e62b6ddea49c0af38cc37a0681d6a587812106f3ecdef4b646bf503153f54c`; saved resaver sandbox test SHA-256: `3a49aa4dfe29eabca946b3ceb806f2e7ed08da1dcd6ded2743b4c0cf10e53f87`. Both controller-owned saved copies were rechecked. Remaining Task3 code files were new.

| File under platform | Frozen SHA-256 |
| --- | --- |
| `app/lukas/lib/drawing-native-dwg-resave-worker.server.ts` | `95c99102ed97c287594bd22a0662bb2d37f27ca28f2a40bc6aa8f9a5f6302be8` |
| `app/lukas/lib/drawing-native-dwg-sandbox.server.ts` | `e0dab6df543b29d30ebd5881964322307341e46d218223be2fa3a92d0685cb86` |
| `tests/drawing-native-dwg-resave-worker.test.mjs` | `70d71da65f81c8c6bae134d0ca21fabcc6ecef59ed526a15e2d6040385195f43` |
| `tests/drawing-native-dwg-resave-worker-sandbox.test.mjs` | `29a0bf1ff3be8b9dd3c9f47a7468f7fe24364ff0f6ad190635f3e323372d56dd` |
| `tests/drawing-native-dwg-resave-sandbox.test.mjs` | `a92aa0a20df9e55cfb305783cd9446b41a06b11ff446f96bb64068d7f25bac7b` |
| unchanged `native-dwg-worker/src/import-supabase.ts` | `c24eb7612447489be4c59073787c5663510fae0c267da1487a8e5e4a48026ecd` |

Also updated the continuation map's Task3/handoff status. Task1/2 implementation files, shared source transport, original public fixture, reader tests and source-free contracts were not edited. Independent review and final owned-copy build are delegated to the controller by the task brief; no reviewer/subagent was dispatched here.

Remaining concerns are explicit integration boundaries: an abort-ignoring owned execution promise intentionally keeps the attempt pending until it settles; RPC deadlines alone cannot attest native cleanup. Unknown native cleanup prevents any settlement. No real source transport/Auth/Storage/browser acceptance was performed in this unit. Next: immutable content-addressed `{dwg,edit_request,authority,report}` upload/readback/publication, receipt-only authorized downloads, authenticated imported-DWG relogin/download story, then exact-revision DWG/PDF/BOQ handoff. Keep scheduled/UI execution disconnected until publication exists; preserve independent CAD/licensed-corpus qualification as external evidence.
