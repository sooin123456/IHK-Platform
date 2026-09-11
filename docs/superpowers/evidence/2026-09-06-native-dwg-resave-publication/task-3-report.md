# Task 3 report — cancellation-aware native DWG resave publication

## Status

DONE. Task 3 is implemented without commit, staging, push, deployment, dependency changes, SQL changes, UI/HTTP/CLI changes, remote mutation, native execution, or authoritative build/typegen writes.

## Initial implementation owned code/test files and SHA-256

- `platform/app/lukas/lib/drawing-native-dwg-resave-publication.server.ts` — `49b42c86e4ef126cfdbf77b310c4cd5518df305bc6f3d2069ed378ae9436fb53`
- `platform/app/lukas/lib/drawing-native-dwg-resave-worker.server.ts` — `cdcbc6eb52332e12f754e5212921bd212bf1828d4cc90f5fc6f7c4496cde606b`
- `platform/tests/drawing-native-dwg-resave-publication.test.mjs` — `c041877b26d961579261516fb4b4d0f3ffd4850ae2b6ba9ee07c8d28b2bd2c47`

These are the initial implementation hashes before review fix round 1; the final changed hashes are recorded in that appended section below. This required evidence report is the only additional file written; it does not embed a self-referential hash. No other file was edited by this task.

Accepted inputs were rechecked before implementation:

- worker baseline — `95c99102ed97c287594bd22a0662bb2d37f27ca28f2a40bc6aa8f9a5f6302be8`
- accepted Task 2 SQL — `ba1fade7c669dd4ce6022750d6787796cc8b93e37f6bcba03c9d5ea0ca2a61e6`

## Implementation behavior

- Narrowly exports/renames the accepted 5-second RPC helper and stale-lease class, and extracts the accepted strict exact-identity control reader. The native attempt's check closure now calls that reader; its native-only API, cleanup behavior, polling cadence, first-refusal latch, failure/cancel behavior, and outcomes are otherwise unchanged.
- Adds `publishNativeDrawingDwgResaveArtifacts` and `runNativeDrawingDwgResaveToStorage`. The wrapper snapshots attempt options and binds both Storage methods before awaiting the real native attempt, calls the accepted attempt once, passes nonprepared outcomes through, and publishes only `prepared` results.
- The publisher snapshots configuration/dependencies and prepared buffers before asynchronous publication, uses the production artifact builder, production claim parser, production staged/receipt validators, the actual imported Storage return type, and the actual `NativeDwgConfirmedUploadError` class.
- Publication order is: build/validate → successful control → stage → four sequential upload/readback pairs (or readback-only for a closed replay) → validated close → stop/await pending polls → final control → publish.
- Polling is every 1000 ms. Its first refusal aborts the execution signal but never abandons an owned Storage call. Cleanup/settlement RPCs retain their independent 5-second signals.
- An open stage is closed only after every started upload has settled. A fulfilled `uploaded`/`exists` proves call settlement; a typed confirmed rejection permits close and `upload_failed`; every untyped/uncertain rejection keeps the session open and returns `settlement_uncertain` with no close/fail/ack.
- Readback requires a `Uint8Array`, exact size, SHA-256, and bytes. Read failure/corruption maps to terminal `output_invalid` after confirmed close. A closed stage replay performs no POST.
- A missing/malformed/lost stage response attempts exact close. Only a strict exact close receipt permits later fail/cancel settlement; unconfirmed/not-started closure stays `settlement_uncertain`.
- After confirmed closure, accepted stale/control/cancel/authority/shutdown precedence is reused. Cancellation acknowledgement cannot occur until the current Storage call, close, and pending poll have all settled.
- Publish has no later poll. A valid exact receipt is final completion. An unknown/malformed first reply receives exactly one replay with the same job/attempt/token; a second unknown returns `publication_uncertain` without fail or new admission.
- Native output remains `experimental-unqualified` with `persistenceAuthority: "not-issued"`; native cleanup and source-free behavior are untouched.

## TDD evidence

### RED before production edits

Command:

```sh
cd /Users/h/Documents/GoAgent/.worktrees/universal-workspace-m1/platform
NODE_OPTIONS=--no-experimental-webstorage node --test tests/drawing-native-dwg-resave-publication.test.mjs
```

Observed result: exit 1, 14 tests failed for the intended missing production API. The first assertion was:

```text
AssertionError [ERR_ASSERTION]: Required publication API absent: publishNativeDrawingDwgResaveArtifacts
actual: 'undefined'
expected: 'function'
```

No production file had been changed when this RED was captured.

### Focused GREEN after implementation and added edge coverage

Same command after implementation:

```text
tests 16
pass 16
fail 0
duration_ms 1614.195333
```

### Final covering regression set

Command:

```sh
NODE_OPTIONS=--no-experimental-webstorage node --test \
  tests/drawing-native-dwg-resave-publication.test.mjs \
  tests/drawing-native-dwg-resave-worker.test.mjs \
  tests/drawing-native-dwg-resave-jobs.test.mjs \
  tests/drawing-native-dwg-resave-protocol.test.mjs \
  tests/drawing-native-dwg-resave-artifacts.test.mjs \
  tests/drawing-native-dwg-resave-storage.test.mjs \
  tests/drawing-native-dwg-worker.test.mjs
```

Observed result: exit 0; 116 tests, 116 pass, 0 fail, 0 skipped, duration 22099.393542 ms. This includes the accepted native worker deadline/cancellation tests, jobs/protocol tests, production artifact-core tests, imported Storage tests, and the source-free worker/Storage transport regression tests. No warnings were emitted by this final test run.

### No-emit type and formatting verification

Commands:

```sh
NODE_OPTIONS=--no-experimental-webstorage ./node_modules/.bin/tsc --noEmit --pretty false
./node_modules/.bin/prettier --check \
  app/lukas/lib/drawing-native-dwg-resave-publication.server.ts \
  app/lukas/lib/drawing-native-dwg-resave-worker.server.ts \
  tests/drawing-native-dwg-resave-publication.test.mjs
git diff --check -- \
  app/lukas/lib/drawing-native-dwg-resave-publication.server.ts \
  app/lukas/lib/drawing-native-dwg-resave-worker.server.ts \
  tests/drawing-native-dwg-resave-publication.test.mjs
```

Observed final result: combined exit 0. TypeScript emitted no diagnostics; Prettier reported all matched files use Prettier style; `git diff --check` emitted no diagnostics. An earlier iterative Prettier check warned on the two newly created files; they were formatted, and the fresh final check above is clean.

## Independent sequence/boundary assertions

The test expectations use literal operation names and order rather than a production sequence builder. Meaningful exact assertions include:

- success: `control, stage, upload:dwg, read:dwg, upload:edit_request, read:edit_request, upload:authority, read:authority, upload:report, read:report, close, control, publish`
- cancellation during abort-ignoring POST: `control, stage, upload:dwg, control, close, ack`; assertions prove neither close nor ack exists before the POST promise fulfills and prove close precedes ack
- closed replay: `control, stage, read:dwg, read:edit_request, read:authority, read:report, control, publish`, with no upload or close call
- corrupt readback: `control, stage, upload:dwg, read:dwg, close, control, fail`, exact `output_invalid`, nonretryable
- actual typed rejection: `control, stage, upload:dwg, close, control, fail`, exact `upload_failed`, retryable
- untyped rejection: `control, stage, upload:dwg` only, returning `settlement_uncertain`
- lost stage with confirmed close: `control, stage, close, control, fail`, exact retryable `publication_failed`
- lost stage with stale/unconfirmed close: `control, stage, close` only, returning `settlement_uncertain`
- final control cancellation: suffix `close, control, ack`, with no publish
- lost publish: exactly two publish calls with literal equal `{p_job_id,p_attempt_number,p_lease_token}` arguments

Test metadata hashes and byte sizes are independently calculated with Node SHA-256 from the finite Task 1 fixture bytes; paths and filenames are independently assembled as literals. The production artifact builder/validators remain the exercised system, not mocked approval logic.

## Exact-baseline self-review

- Compared `platform/app/lukas/lib/drawing-native-dwg-resave-worker.server.ts` directly against the accepted baseline, not against HEAD. Its delta is limited to the three required exports/rename, factoring strict Control parse + identity validation into the exported reader, and changing existing native call sites to those exact helpers. No native stages, cleanup decisions, deadlines, retryability, attempt return shape, source handling, sandbox behavior, or polling behavior changed.
- The publisher does not introduce an RPC framework, Storage error reconstruction, error-name classification, path validator, receipt validator, staged-artifact validator, native output validator, retry admission, concurrent upload, or dependency.
- The implementation has one ordered publication loop and small local helpers only for identity arguments, exact close, and accepted cancel/fail settlement. This is the shortest design that preserves the required uncertainty boundaries.
- Mental mutation checks covered: reordering an upload/read or close/publish, posting on closed replay, acknowledging before upload settlement, treating an untyped error as definite, omitting close after lost stage, changing failure code/retryability, skipping final control, changing publish identity, abandoning publish replay, accepting corrupt readback, losing option/buffer snapshots, and invoking native more than once. Each is caught by at least one named test.
- `git status` scoped to the task shows only the three owned code/test paths plus this required report. The worktree was already broadly dirty; unrelated edits were not touched.

## Limits and concerns

- No real Supabase Auth/Database/Storage, Docker process, licensed CAD engine, customer data, or remote service was used. The finite artifact fixture exercises the actual compiler/attestation/protocol/artifact core but is explicitly not native-execution or large-corpus/performance evidence. Task 5 owns actual acceptance/reconciliation.
- No full React Router build/typegen was run here because the controller owns the synchronized owned-copy full build. The task-local no-emit TypeScript check is green.
- Controller preflight identified a pre-existing Node 26 strip-only CLI import barrier in resave/source-free job parameter-property constructors. Task 4 owns the explicit-field compatibility change and CLI subprocess regression. Per controller direction, Task 3 did not expand into those files or runtime wiring.
- Durable reconciliation after an unknown POST or repeated unknown publish reply remains intentionally external; this worker does not infer time-based closure or success.

## Fix round 1/5 — shutdown/publication success handoff

### Finding and root cause

Independent review found that `finishClosed` unconditionally awaited `settleClosedAttempt` even when both `refusal` and `failure` were synchronously absent. The helper returned an already-resolved `undefined` promise, but the `await` still yielded. A parent abort queued into that yield could invoke the still-attached shutdown listener and latch `worker_interrupted`; the continuation then used the stale `undefined` settlement result, detached the listener, and published without rereading the live refusal.

Accepted pre-fix copies and hashes were verified unchanged before the fix:

- publisher baseline — `49b42c86e4ef126cfdbf77b310c4cd5518df305bc6f3d2069ed378ae9436fb53`
- test baseline — `c041877b26d961579261516fb4b4d0f3ffd4850ae2b6ba9ee07c8d28b2bd2c47`

### RED

The deterministic test queues an abort from the successful final-control boundary, records parent-abort, listener-detachment, and publish ordering, and requires the publisher to detach before the queued abort can be observed on the success handoff.

Command, while production still matched the accepted pre-fix hash:

```sh
NODE_OPTIONS=--no-experimental-webstorage node --test \
  --test-name-pattern='success handoff detaches' \
  tests/drawing-native-dwg-resave-publication.test.mjs
```

Observed valid RED: exit 1; 1 test, 0 pass, 1 fail. The assertion reported the exact buggy event order:

```text
AssertionError [ERR_ASSERTION]: ["abort","detached","publish","detached"]
```

An immediately preceding harness-only run hit Node's `assert.ok` message-type validation because the diagnostic array was passed directly; the test message was changed to `JSON.stringify(events)` while production remained untouched, then the valid behavioral RED above was captured.

### Minimal fix and focused GREEN

The publisher now calls/awaits `settleClosedAttempt` only inside a synchronous `if (refusal || failure)` branch. On the success path there is no settlement-helper await: it detaches the shutdown listener and initiates the owned publish operation without another yielding boundary. No other publisher behavior changed; the deferred Minor review coverage and Task 4 work remain untouched.

Focused command:

```sh
NODE_OPTIONS=--no-experimental-webstorage node --test \
  --test-name-pattern='success handoff detaches' \
  tests/drawing-native-dwg-resave-publication.test.mjs
```

Observed GREEN: exit 0; 1 test, 1 pass, 0 fail, duration 542.493292 ms.

### Covering verification

Command:

```sh
NODE_OPTIONS=--no-experimental-webstorage node --test \
  tests/drawing-native-dwg-resave-publication.test.mjs \
  tests/drawing-native-dwg-resave-worker.test.mjs
```

Observed after final formatting: exit 0; 65 tests, 65 pass, 0 fail, 0 skipped, duration 22056.137584 ms.

Final no-emit/format/diff command:

```sh
set -e
NODE_OPTIONS=--no-experimental-webstorage ./node_modules/.bin/tsc --noEmit --pretty false
./node_modules/.bin/prettier --check \
  app/lukas/lib/drawing-native-dwg-resave-publication.server.ts \
  tests/drawing-native-dwg-resave-publication.test.mjs
git diff --check -- \
  app/lukas/lib/drawing-native-dwg-resave-publication.server.ts \
  tests/drawing-native-dwg-resave-publication.test.mjs
```

Observed: exit 0; TypeScript and `git diff --check` emitted no diagnostics; Prettier reported all matched files use Prettier style. An earlier iterative check identified publisher formatting after the one production edit; Prettier formatted that file before the final test and checks above.

### Exact fix-round delta and final hashes

Only the reviewed publisher success branch and its focused regression changed relative to the accepted fix-round baselines:

- `platform/app/lukas/lib/drawing-native-dwg-resave-publication.server.ts` — `0983a6c68fe1f9f8d3f9f4ddea376f81a7f323cff7fc745aafaa708c0c4612e3`
- `platform/tests/drawing-native-dwg-resave-publication.test.mjs` — `9f0b53133e84c8caf049052bcb157500e58e06ba450478e689c6a269f6c04791`

`platform/app/lukas/lib/drawing-native-dwg-resave-worker.server.ts` was not changed in this fix round. No deferred Minor coverage, Task 4 file, dependency, SQL, CLI, remote system, commit, staging area, or build output was touched.

Exact-baseline self-review confirmed the production delta is solely replacement of the unconditional success-path settlement await with the synchronous refusal/failure gate. The regression fails if that unconditional await is restored and independently verifies that the queued abort occurs after detachment but before the fake publish transport begins.
