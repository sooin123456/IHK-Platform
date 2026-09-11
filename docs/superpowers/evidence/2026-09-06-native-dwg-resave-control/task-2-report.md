# Task2: durable imported-DWG resave control

Status: DONE_WITH_CONCERNS — implementation and local verification complete; independent controller review remains required. Remaining advisor INFO/WARN findings and test boundaries are described below. Files are frozen for review.

Authoritative worktree: `/Users/h/Documents/GoAgent/.worktrees/universal-workspace-m1`; HEAD remains `9f5f56d93db325ff935772252f9d4fb64d69f98c`. No git mutation, installation, build, preview lifecycle, deployment, publication, scheduling, remote application write, or customer data was used.

## Exact files

- Created `platform/supabase/migrations/20260906110304_drawing_native_dwg_resave_control.sql`. Supabase CLI `migration new --help` was inspected, then `supabase migration new drawing_native_dwg_resave_control` generated this exact path after the real PostgreSQL missing-RPC RED.
- Created `platform/app/lukas/lib/drawing-native-dwg-resave-jobs.server.ts`.
- Created `platform/tests/drawing-native-dwg-resave-jobs.test.mjs`.
- Created `platform/tests/fixtures/drawing-native-dwg-resave-jobs-database.mjs`.
- Modified `platform/tests/drawing-workspace-m1-real-database.test.mjs`: import new fixture, capture/pass canonical-import result, assert zero resave job/attempt rows after existing owned project retention cleanup. Diff against `/tmp/1hk-resave-control-m6Q9WS/drawing-workspace-m1-real-database.test.mjs` contains only these additions.
- Created this report.

Task1 attestation and existing compiler/projector/source transport were reused unchanged. The database validates strict attestation shape, exact UTF-8 hashes/lengths, canonical handle metadata, source digest, and parsed envelope against the existing actor resolver's fresh evidence. It does not compile geometry or introduce a competing serialization authority. Claim parsing validates the stored envelope against the fresh payload; Task3 must still rebuild the complete attestation before execution.

The migration adds forced-RLS, directly inaccessible jobs and attempts, global actor/request uniqueness, immutable source/attestation/image/request fields, immutable terminal rows and settled attempts, guarded retention deletion, explicit function grants, project→job locks, project-locked capacity, identity-serialized admission, skip-locked claims, maximum three attempts, pinned images, fenced cancellation and restricted retry codes. No completed/publication state exists.

Controller integration clarification was accepted during implementation: failure and cancellation acknowledgement return exactly `{jobId,attemptNumber,leaseToken,status}`. Failure status is `retry_wait|failed`; acknowledgement status is `cancelled`. This is service-only. Public status/cancel response remains `{jobId,requestId,status,attemptCount,failureCode,hasChanges}`.

## RED/GREEN evidence

All commands below ran from the authoritative `platform` directory with `NODE_OPTIONS=--no-experimental-webstorage`. Log root: `/tmp/1hk-resave-control-m6Q9WS`.

Database command (every database run uses a newly created wrapper-owned database and replays the full migration chain):

```sh
NODE_OPTIONS=--no-experimental-webstorage \
M1_REAL_POSTGRES_REQUIRED=1 \
M1_REAL_POSTGRES_DATABASE_URL='postgresql://postgres:resave-local-only@127.0.0.1:32779/postgres?sslmode=disable' \
node --experimental-strip-types --test tests/drawing-workspace-m1-real-database.test.mjs
```

- `task2-database-red.log`: exit 1, actual PostgreSQL `42883`, missing `public.lukas_drawing_admit_native_dwg_resave(uuid,jsonb,uuid,jsonb)`; retention assertion additionally encountered the absent resave table. Before this failure, the actual trusted template clone, nonzero LINE operation, review/approval, and Task1 compiler completed. No invented approved snapshot or compiled edit was seeded.
- `task2-database-green-1.log`: exit 0, 1/1 after initial migration; replay/no-op conflict, two-session claim, cancellation fencing, permissions and capacity passed.
- `task2-identity-red.log` and `task2-barrier-diagnostic.log`: fixture barrier investigation. The second row-lock waiter blocked on the first waiter's tuple lock; the first waiter blocked on the owner's transaction ID. The recorded graph established the correct chained barrier. Fixture expectation was corrected to require that exact graph; no sleep-based ordering or production-lock weakening was used.
- `task2-settlement-identity-red.log`: exit 1, exact cancellation acknowledgement lacked `attemptNumber` and `leaseToken`. Migration responses were then extended as agreed with controller.
- `task2-database-green-2.log`: exit 0, 1/1 with ordered lock race, replaced/expired tokens, three attempts/backoff, revoked authority, and rolled-back evidence corruption.
- `task2-database-advisors-green.log`: exit 0, 1/1 with advisors against migrated database `m1_48192_6d56580c6731`; missing composite FK index was reported and then added.
- `task2-database-final.log`: exit 0, 1/1, 8.596 seconds for the test. Full migration chain replay plus all expanded fixture assertions and advisors against `m1_48273_4c55ca1c1e89` passed. This is clean-chain replay, not same-file re-execution; the migration intentionally uses ordinary one-time CREATE statements.

Adapter RED command:

```sh
NODE_OPTIONS=--no-experimental-webstorage node --experimental-strip-types \
  --test tests/drawing-native-dwg-resave-jobs.test.mjs
```

- `task2-adapter-red.log`: 0/6; required exported admission method was absent.
- Initial adapter GREEN: 6/6.
- `task2-malformed-auth-red.log`: 8/9; missing verified-user `error` field was incorrectly accepted. The adapter now requires `error:null` for successful verified-user responses.

Final adapter/regression command:

```sh
NODE_OPTIONS=--no-experimental-webstorage node --experimental-strip-types --test \
  tests/drawing-native-dwg-resave-jobs.test.mjs \
  tests/drawing-native-dwg-resave-attestation.test.mjs \
  tests/drawing-native-dwg-resave-source.test.mjs \
  tests/drawing-native-dwg-selected-edits.test.mjs
```

`task2-adapter-final-verified.log`: exit 0, **128/128**, no skips, 586 ms. Nine new adapter tests cover verified actor/source compilation, unchanged-source admission, input rejection, followed-login rejection, uppercase UUID normalization, complete transport validation, parent abort against an abort-ignoring RPC, identity mismatch, error classification, public status/cancel confidentiality, pinned image, claim payload/source/attestation corruption.

```sh
NODE_OPTIONS=--no-experimental-webstorage ./node_modules/.bin/tsc --noEmit --pretty false
```

`task2-typecheck-final-verified.log`: exit 0, no diagnostics. Full typecheck script/build was not invoked because it generates router/build assets. `git diff --check -- tests/drawing-workspace-m1-real-database.test.mjs` passed. Only new TS/MJS files were formatted with the already-installed Prettier.

## Actual database assertions

- Real canonical approved original source produces `request:null`; additional trusted template clone is edited through `lukas_drawing_apply_operation` and independently reviewed/approved before attestation.
- Same actor/request exact replay is identical; real-edit ID reused for no-op conflicts; concurrent admission produces one identity; no-op replay persists zero attempts; replay succeeds at five active jobs; sixth active admission is `PNR15`; no-op admission still succeeds at capacity.
- Concurrent worker claims produce exactly one claim. Independently held project and job locks are skipped. Ordered owner→cancel waiter→failure waiter `pg_blocking_pids` barriers prove cancel-first prevents failure from returning `retry_wait`.
- Viewer can request/status; another editor/viewer cannot cancel another requester; owner/admin can cancel; wrong scope is denied. Status exposes only the six fixed public fields. Existing canonical source fixture continues to prove public `{approved,analysis}` source confidentiality.
- Exact control returns continue/cancel/stop; wrong/replaced tokens are stale; expired lease stops; cancellation wins over expiry for a matching attempt; expired cancellation is finalized without another claim. Exact cancellation acknowledgement replay succeeds; old token acknowledgement cannot settle a newer attempt.
- Retriable resaver failures back off 30×attempt seconds, stop at three attempts and never immediately reclaim. Source mismatch/output invalid/authority revoked remain terminal even when caller asks for retry.
- Rolled-back owner-only source-locator and approved-snapshot corruption makes live control return authority_revoked. Actual collaborator removal stops processing and makes queued work fail on claim; former requester cancellation is unavailable. Membership is restored inside this owned fixture.
- Grants for all seven public functions are asserted for anon/authenticated/service_role/collaboration; private context/lock helpers are uncallable by them. Direct table SELECT/INSERT/UPDATE/DELETE privileges are all revoked and both tables force RLS. Admission database role/JWT mismatch is rejected.
- Invalid digest/byte count/handles/extra attestation keys and recomputed-but-wrong authority receipt identity are denied. Terminal job updates, settled attempt rewrites, requester rewrites, standalone deletes, and spoofed purge GUC deletes fail. Existing project-retention cascade then removes all resave rows; wrapper explicitly checks zero jobs and attempts before dropping the owned database.

## Advisors and boundaries

Fixture opt-in `M1_RESAVE_ADVISORS=1` adds this read-only command while the wrapper's actual migrated database is alive:

```sh
supabase db advisors --db-url '<owned loopback URL with wrapper current_database()>' \
  --type all --level info --fail-on none --output-format json
```

The fixture checks host `127.0.0.1`, port `32779`, and wrapper database naming before invocation. CLI's generic stderr says “Connecting to remote database”; the supplied endpoint is the authorized owned loopback container, not linked Supabase state.

Final output has 274 findings: **0 ERROR, 12 WARN, 262 INFO**. None of the WARN findings concern resave objects. Eleven warn about existing QTO price/BOQ `verified email sessions only` policy initplans; one concerns existing permissive QTO-files DELETE policies. Resave findings are only an unused composite FK index on this tiny fixture and intentional forced-RLS tables without application policies. Those tables are RPC-only; creating application policies would violate the design. The earlier missing-FK-index finding was fixed. Raw full advisor JSON remains in `task2-database-final.log`.

Supabase changelog was fetched to `task2-supabase-changelog.md` and scanned; relevant mechanisms use existing PostgreSQL/RLS/extension primitives and no new extension-version, Realtime, gateway, management-log, or Auth endpoint configuration. PostgreSQL explicit-locking and Supabase RLS documentation were consulted. Executing-plans, TDD, Supabase/Postgres, ponytail, systematic-debugging and verification-before-completion guided reuse and evidence. The standing keep-worktree/no-git-mutation instruction determines the finishing disposition; no integration menu or cleanup of the worktree was performed.

Boundaries: this is local PostgreSQL/adapter proof, not a live Supabase HTTP/Auth integration, production throughput benchmark, native-process cancellation test, artifact publication proof, or CAD qualification. The initial one-project replay coverage was extended to two real approved imported projects before independent review, as recorded below. Exact native execution/cleanup belongs to Task3. No independent review result is claimed here.

## Initial frozen SHA-256 (superseded by extension below)

Paths below are relative to the authoritative `platform` directory.

| File | SHA-256 |
|---|---|
| `app/lukas/lib/drawing-native-dwg-resave-jobs.server.ts` | `9181a0b047c9b2c43399efe78e9aebaeaf8a86823dd58adab3df3d36c9107355` |
| `tests/drawing-native-dwg-resave-jobs.test.mjs` | `6a8993a57e75a7aff4579c2eb361a9597d6e6b01213a6187faeb5a1cb8e1701d` |
| `tests/fixtures/drawing-native-dwg-resave-jobs-database.mjs` | `06a57b3bb83765b62835b9757807c90b5f9860f787a54482d437cbedb38ccd0f` |
| `tests/drawing-workspace-m1-real-database.test.mjs` | `71c0978da942eaf4ba8a14eef47cfefea82b8b30067ba393d4d470a131f9500b` |
| `supabase/migrations/20260906110304_drawing_native_dwg_resave_control.sql` | `bc1f7c7f129788bf32dd3025dc990475061df9f98e2403f136304be6831f2cdd` |
| Frozen reused Task1 `app/lukas/lib/drawing-native-dwg-resave-attestation.server.ts` | `079dff673720b997c9dfb7f923815d003d0139d5ebad55bcb3b0beeee1cebb42` |
| Exact pre-task wrapper `/tmp/1hk-resave-control-m6Q9WS/drawing-workspace-m1-real-database.test.mjs` | `626145b3fd80dcd9ed5e74469398a8e0c883384287abb9a4d25ceec8edc15379` |

## Pre-review extension: cross-project identity and malformed RPC errors

Controller requested closure of the explicit cross-project runtime gap and supplied a concrete malformed-RPC-response concern. Exact pre-extension fixture/wrapper copies were saved to `/tmp/1hk-resave-control-m6Q9WS/task2-pre-cross-project-fixture.mjs` and `task2-pre-cross-project-wrapper.mjs`; their hashes match the initial frozen table above.

The wrapper now calls `proveNativeDwgCanonicalImportAuthority` a second time and registers that independently created project for the same existing retention cleanup. It passes `otherImported` to the resave fixture. The existing scope-read helper now obtains the actual revision project ID from PostgreSQL. No import/admission setup or compiler was duplicated and no approved authority was manufactured.

The new race uses the same verified actor and one fresh request ID against two valid approved imported scopes (edited clone in the first project and unchanged approved import in the second). The owner holds both project rows in sorted order; each independent worker admission is started and its actual blocked state is separately verified with `pg_blocking_pids` before the owner releases both locks. Assertions require one fulfillment, one `PNR12`, exactly one stored global actor/request row matching the winning scope/attestation, and stable success/conflict from both sessions on later replays. A second full-row read proves those replays/conflicts leave that row unchanged. If the winner is active, normal authorized cancellation finishes it before the rest of the fixture. Both projects' resave rows are covered by the existing zero-residue retention checks.

`task2-cross-project.log`: actual PostgreSQL wrapper 1/1 GREEN; cross-project race, all prior assertions, full clean migration chain, and cleanup passed. No database-production change was needed.

The focused new adapter test supplied successful-shaped data with an own `error` field set to `undefined`, `false`, `0`, or an empty string. `task2-falsy-rpc-red.log` records 9 passed / 1 failed with “Missing expected rejection … malformed error undefined must not authorize success.” That confirms the controller's concern. The shared adapter RPC check changed one line from truthiness to `response.error !== null`, so only literal `error:null` is successful; malformed values map to the existing generic unavailable error. All four malformed values are now rejected, and real RPC error classification remains covered.

Final extension commands use the same commands/environment above:

- `task2-cross-project-final.log`: actual PostgreSQL wrapper exit 0, 1/1; the two-project race and full migration replay/cleanup pass after the transport fix.
- `task2-cross-project-adapters-green.log`: covering adapter/attestation/source/selected-edit command exit 0, **129/129**, no skips.
- `task2-cross-project-typecheck.log`: direct `tsc --noEmit --pretty false` exit 0, no diagnostics.
- Wrapper `git diff --check` passed. Migration and Task1 production attestation remain unchanged, so the final migrated-database advisor evidence above remains applicable.

Current frozen hashes for independent review (relative to `platform`):

| File | SHA-256 |
|---|---|
| `app/lukas/lib/drawing-native-dwg-resave-jobs.server.ts` | `7f20ed2c958ac7789a3a4ba673c2cfd3fc038f2b39bb2828ab8fedb2c96cd4d5` |
| `tests/drawing-native-dwg-resave-jobs.test.mjs` | `a51d944f5d173653def64878995ec88c538922b24fedad20076b2c3bdb16aa40` |
| `tests/fixtures/drawing-native-dwg-resave-jobs-database.mjs` | `8522d138f571326ca9469cea852b12ab184aeb92afd601565b3fdfd040664e20` |
| `tests/drawing-workspace-m1-real-database.test.mjs` | `dd1ab084d1b8703919cdf0942fd05f2137adeab15415a5fbc3bc31784f80117a` |
| `supabase/migrations/20260906110304_drawing_native_dwg_resave_control.sql` | `bc1f7c7f129788bf32dd3025dc990475061df9f98e2403f136304be6831f2cdd` |

Cross-project runtime coverage gap is closed. Files are frozen again; remaining concerns are the previously documented advisor/test-environment boundaries and pending independent review.
