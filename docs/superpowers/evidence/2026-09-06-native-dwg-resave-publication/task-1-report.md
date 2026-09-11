# Task 1 report — verified resave artifacts and bounded Storage transport

## Status

DONE. Implemented only the five Task 1 files, plus this report. No git mutation, dependency installation, deployment, remote database/Storage mutation, live-process restart, authoritative build, customer data, or private `.superpowers/sdd` artifact access occurred.

## Requirements and baselines read

- Binding brief: `docs/superpowers/evidence/2026-09-06-native-dwg-resave-publication/task-1-brief.md`
- Binding design: `docs/superpowers/specs/2026-09-06-native-dwg-resave-publication-design.md`, especially artifact identity and Storage settlement evidence.
- Existing resave claim parser, production attestation compiler, native frame protocol/decoder, attempt worker, source fixture, source-free artifact/path validator, and source-free Storage tests.
- Required TDD and writing-good-tests instructions, Ponytail full/minimality guidance, and Supabase Storage guidance.
- Exact supplied baseline:

```text
$ shasum -a 256 docs/superpowers/evidence/2026-09-06-native-dwg-resave-publication/baseline/task-1-supabase.ts platform/native-dwg-worker/src/supabase.ts
3e83c4eefbad09d035d8385f91f5eaadaca0a03a3e25475b1636a107fc4c7282  .../baseline/task-1-supabase.ts
3e83c4eefbad09d035d8385f91f5eaadaca0a03a3e25475b1636a107fc4c7282  platform/native-dwg-worker/src/supabase.ts
```

Supabase compatibility was refreshed read-only with:

```text
$ curl -fsSL --max-time 20 https://supabase.com/changelog.md | rg -n "breaking-change|Storage|Node.js 20" | head -40
... Data API explicit-exposure breaking change and Node.js 20 deprecation present; no Storage upload API break relevant to this transport.
$ curl -fsSL --max-time 20 https://supabase.com/docs/guides/storage/uploads/standard-uploads.md
... standard POST upload, default no-overwrite behavior, x-upsert option, and >6 MiB TUS recommendation documented.
$ curl -fsSL --max-time 20 https://supabase.com/docs/guides/storage/security/access-control.md
... service keys bypass Storage RLS and must remain private; upsert needs extra policies.
```

The implementation retains the binding design's private, bounded, no-upsert standard POST transport. It does not infer large-file reliability from the finite tests.

## TDD evidence

Before writing production code, I created the literal artifact fixture and behavior tests. The named breaks include: wrong artifact order/bytes/hash; failure to snapshot before the compiler await; relaxed claim/result strictness; source/request/report/output mismatch; missing header/size checks; foreign job/attempt/token/project/hash/filename; public authority/token injection; upsert; mutable POST bodies; incorrect duplicate/refusal/unknown-settlement classification; unbounded response bodies; and cross-profile kind/path/cap acceptance.

Expected RED, before either production API existed:

```text
$ NODE_OPTIONS=--no-experimental-webstorage node --test tests/drawing-native-dwg-resave-artifacts.test.mjs tests/drawing-native-dwg-resave-storage.test.mjs
ℹ tests 12
ℹ pass 0
ℹ fail 12
AssertionError: Required artifact API absent: NATIVE_DWG_RESAVE_ARTIFACT_LIMITS
AssertionError: Required Storage API absent: createNativeDwgResaveStorageTransport
```

This was the expected feature-missing assertion, not a syntax, fixture, Vite, or module-setup error.

First GREEN after minimal implementation and two local corrections (descriptor metadata projection and the loopback test's GET key):

```text
$ NODE_OPTIONS=--no-experimental-webstorage node --test tests/drawing-native-dwg-resave-artifacts.test.mjs tests/drawing-native-dwg-resave-storage.test.mjs
ℹ tests 12
ℹ pass 12
ℹ fail 0
ℹ duration_ms 488.931083
```

The worker-only no-emit typecheck initially identified three generic/body typing errors in the shared private transport. After narrowing its internal record types and making the existing Node `Buffer` fetch-body cast explicit:

```text
$ npx tsc --noEmit -p native-dwg-worker/tsconfig.json
<no output; exit 0>
```

Source-free direct-Node regression, run against the refactored transport:

```text
$ NODE_OPTIONS=--no-experimental-webstorage node --test tests/drawing-native-dwg-worker.test.mjs
ℹ tests 23
ℹ pass 23
ℹ fail 0
ℹ duration_ms 681.691083
```

Final required covering run, once after self-review/test strengthening:

```text
$ NODE_OPTIONS=--no-experimental-webstorage node --test tests/drawing-native-dwg-resave-artifacts.test.mjs tests/drawing-native-dwg-resave-storage.test.mjs tests/drawing-native-dwg-resave-worker.test.mjs tests/drawing-native-dwg-resave-protocol.test.mjs tests/drawing-native-dwg-worker.test.mjs
ℹ tests 89
ℹ pass 89
ℹ fail 0
ℹ duration_ms 22081.446417
```

Formatting verification:

```text
$ npx prettier --check app/lukas/lib/drawing-native-dwg-resave-artifacts.server.ts native-dwg-worker/src/supabase.ts tests/fixtures/drawing-native-dwg-resave-artifacts.mjs tests/drawing-native-dwg-resave-artifacts.test.mjs tests/drawing-native-dwg-resave-storage.test.mjs
Checking formatting...
All matched files use Prettier code style!
```

## Implementation

- Added the four fixed artifact limits/kinds, strict ordered metadata, public receipt, server descriptor, exact managed-path builder, exact stage replay validator, and receipt identity validator.
- The artifact builder synchronously parses/snapshots the claim, report object, report bytes, and DWG bytes; rebuilds and deep-compares the real attestation; re-frames the copied native result; and delegates source/request/report/output/header/size validation to the accepted production decoder. Exact UTF-8 request and authority texts are copied without serialization.
- Factored the existing private POST/bounded-body/GET implementation into one two-profile transport. The source-free exported API, kinds, limits, paths, errors, MIME behavior, and call shapes remain unchanged.
- Added the imported profile's fixed kinds/caps and exact normalized managed path/hash/filename checks. It copies the body before fetch, sends `x-upsert:false`, recognizes only explicit `Duplicate`/`ResourceAlreadyExists`, classifies local validation before request invocation and exact fully consumed `401` + `InvalidJWT` as `NativeDwgConfirmedUploadError`, and keeps every other post-invocation/fetch/response-body failure as `NativeDwgUncertainUploadError`.
- Added real loopback HTTP coverage for chunked full bodies, copied upload bytes, headers/MIME/no-upsert, duplicates, definite refusal, disconnect/body uncertainty, response caps, read caps, lowered limits, and profile separation.
- The fixture uses the actual production attestation compiler and a finite literal output. It explicitly does not constitute actual-native evidence.

## Exact task files

```text
1cbe7ec842dfbf9404e11e12bdbfd7808d12ec968308396b55373724ff21410d  platform/app/lukas/lib/drawing-native-dwg-resave-artifacts.server.ts
6b6b4087a7efb2cfb13eb85ea0ceb70029b1a01bd949651f96291c4fc5466d2c  platform/native-dwg-worker/src/supabase.ts
7eba51a712cdc96a745688730a93bf82e662c0884b2969ee8d124d05d0aac05f  platform/tests/fixtures/drawing-native-dwg-resave-artifacts.mjs
f7db79391ee95e6c66b93fc299492deaa6d841313febfa91873148a7f5f0e979  platform/tests/drawing-native-dwg-resave-artifacts.test.mjs
50aa056a4b4f47e1f9591d921cef9472e619af6d51bebc8a3eb7498bb1202cc3  platform/tests/drawing-native-dwg-resave-storage.test.mjs
```

The hashes above were captured after the final covering run. The supplied exact pre-task copy, rather than dirty `HEAD`, was used to review `supabase.ts`; the other four task files were absent before this task. No existing jobs module imports the artifact core, so the required import direction remains acyclic. No Task 2 RPC adapter/database logic or Task 3 publication sequencing was introduced.

## Self-review and concerns

- Mutation check: removing the attestation equality, result/report equality, source/request/output decoder bindings, header check, metadata order, exact path segment, hash/body equality, no-upsert header, body copy, response bound, or settlement distinction causes at least one focused test to fail.
- Source-free direct import remains independent of Vite aliases and browser-only code; its 23-test suite stayed green.
- Security boundary: service credentials remain only in the worker transport, are never returned, and no test contacts paid/remote Storage.
- Known limit: finite loopback payloads prove bounded mechanics and lowered application caps, not 200 MiB performance/reliability. Supabase recommends TUS above 6 MiB; the binding design intentionally retains this bounded standard POST transport and requires later owned-copy full-stack/large-corpus qualification.
- Known limit: no authoritative full application build was run in this worktree, per controller instruction. The controller owns the clean owned-copy build. The native worker TypeScript project did pass `--noEmit`.

## Fix round 1 — conservative POST settlement classification

The independent review's two Important findings were read verbatim from `task-1-review.md` and verified against the exact public fix baselines:

```text
6b6b4087a7efb2cfb13eb85ea0ceb70029b1a01bd949651f96291c4fc5466d2c  baseline/task-1-fix1-supabase.ts
6b6b4087a7efb2cfb13eb85ea0ceb70029b1a01bd949651f96291c4fc5466d2c  platform/native-dwg-worker/src/supabase.ts
50aa056a4b4f47e1f9591d921cef9472e619af6d51bebc8a3eb7498bb1202cc3  baseline/task-1-fix1-drawing-native-dwg-resave-storage.test.mjs
50aa056a4b4f47e1f9591d921cef9472e619af6d51bebc8a3eb7498bb1202cc3  platform/tests/drawing-native-dwg-resave-storage.test.mjs
```

Root cause: the shared upload branch conflated an exception after `request(...)` invocation with a pre-invocation validation failure, and treated every fully read non-OK response as proof of no write. Neither is sufficient settlement evidence. The reviewed contract permits `NativeDwgConfirmedUploadError` before request invocation, or after the exact documented fully consumed `401` + `InvalidJWT` response only. Duplicate handling remains unchanged; all other post-invocation failures are uncertain.

The Supabase changelog and official Storage error-code page were refreshed read-only. The latter documents `InvalidJWT` as HTTP 401, `ResourceAlreadyExists` as HTTP 409, and `InternalError` as HTTP 500.

Test-first RED used a real owned loopback POST that was started before an injected synchronous throw, and exact HTTP fixtures for `401/InvalidJWT`, 503, unknown 403, status mismatch, malformed body, disconnect, response-body failure, and oversized response. The first RED exposed an asynchronous cleanup warning when the deliberately wrong classification short-circuited the assertion; I corrected the test to await the owned request and body in all classification cases before touching production. The clean RED was:

```text
$ NODE_OPTIONS=--no-experimental-webstorage node --test tests/drawing-native-dwg-resave-storage.test.mjs
ℹ tests 6
ℹ pass 4
ℹ fail 2
ℹ cancelled 0
ℹ skipped 0
ℹ duration_ms 232.99025
Expected failures:
- generic non-OK responses were NativeDwgConfirmedUploadError instead of NativeDwgUncertainUploadError
- synchronous throw after a real POST started was not NativeDwgUncertainUploadError
```

Minimal GREEN changed only the two classification branches:

```text
$ NODE_OPTIONS=--no-experimental-webstorage node --test tests/drawing-native-dwg-resave-storage.test.mjs
ℹ tests 6
ℹ pass 6
ℹ fail 0
ℹ duration_ms 245.282042
```

Required scoped covering run and typecheck:

```text
$ NODE_OPTIONS=--no-experimental-webstorage node --test tests/drawing-native-dwg-resave-storage.test.mjs tests/drawing-native-dwg-worker.test.mjs
ℹ tests 29
ℹ pass 29
ℹ fail 0
ℹ duration_ms 672.135958

$ npx tsc --noEmit -p native-dwg-worker/tsconfig.json
<no output; exit 0>

$ npx prettier --check native-dwg-worker/src/supabase.ts tests/drawing-native-dwg-resave-storage.test.mjs
Checking formatting...
All matched files use Prettier code style!
```

Final fix-round hashes, superseding the two corresponding original hashes above:

```text
a517c8693d6c7d94d0fb590bee6c79350343fe42fcf3e464c1b8e4972878e494  platform/native-dwg-worker/src/supabase.ts
1d0d7cdc1ef3c8a37d14e8abcd40ab5d822a5f0beedd86ffe85944a792fe69f9  platform/tests/drawing-native-dwg-resave-storage.test.mjs
```

Source-free behavior is preserved: its post-invocation synchronous throw was already uncertain, and its generic non-OK response remains the existing untyped upload failure. No artifact-core file changed. The conservative imported classification can require reconciliation for harmless failures, as explicitly accepted by the clarified spec; it cannot falsely authorize closure from an unknown POST settlement.
