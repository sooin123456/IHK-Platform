# Task 9 report — preserve partial durable ACK revalidation

## Outcome

Task 9 fixes the partial-success boundary in the drawing outbox. When an earlier operation in one sequential flush is durably acknowledged and a later operation fails, the outbox now reports the earlier durable count exactly once before preserving the existing rejection. A later retry reports only its own newly durable acknowledgement.

The latest tested code/test commit is `967ef821725e578be4124c1231ac36503696c133` (`test: preserve partial ACK error priority`). It changes only the outbox test; the production behavior remains commit `d24b3be90631f7d7a77c13a4d08715e5aa181df2` (`fix: preserve partial durable ACK revalidation`). Each post-commit table below identifies the exact clean SHA it verifies.

Canonical M1 remains `UNEXECUTED`. Per the Task 9 brief, the known absent container runtime was not reconfirmed by rerunning the disposable-Supabase command, so no fifth recovery root was created. The full drawing suite remains `NOT MET` only because its two committed P7 evidence SHA checks are stale.

## Scope and files

Behavior/test commit:

- `platform/app/lukas/lib/drawing-outbox.ts`
  - Adds one local rejection boundary inside `flushOnce()`.
  - If the batch has newly durable acknowledgements, it invokes the existing `onAcknowledged(count)` once before rejection.
  - A `finally` rethrows the exact original transport or mismatched-ACK error, so callback behavior cannot replace its identity or message.
  - The existing fulfilled-batch callback remains unchanged, preserving one callback with the complete all-success count.
- `platform/tests/drawing-workspace-outbox.test.mjs`
  - Adds a real two-operation transport-failure batch and its later scheduled retry.
  - Adds a real two-operation mismatched-ACK batch.
  - Strengthens the all-success batch to require one `[2]` callback and the all-failure retry sequence to require no callback before success.

Evidence-only commit:

- `.superpowers/sdd/2026-08-31-universal-workspace-m1/task-9-partial-ack-report.md`
- `.superpowers/sdd/2026-08-31-universal-workspace-m1/task-8-report.md`
- `docs/superpowers/evidence/2026-08-31-universal-workspace-m1.md`

The first subject was `docs: record partial durable ACK evidence`. The current follow-up subject is `docs: prove partial ACK error priority`; both SHAs are documentation identity, not either code/test identity above.

No dependency, lockfile, schema, retry delay, retry model, state store, wrapper hierarchy, collaboration protocol, or client calculation changed.

## Root cause

`flushOnce()` accumulated a local `acknowledged` count after `markAcked()` durably deleted each entry. `flush()` delivered that count to `onAcknowledged` only from the fulfilled `.then(...)` branch. If a later `send()` threw or returned a different `clientOperationId`, `flushOnce()` rejected and the fulfilled branch never observed the already-durable count. The server/local deletion was real, but loader-derived estimate data could remain stale.

The working all-success and later-successful-retry cases differed only in how `flushOnce()` settled: they returned the count. The broken mixed cases rejected after a positive count. The minimal correction therefore belongs at the rejection boundary, not in transport, retry scheduling, React state, or acknowledgement persistence.

## Strict TDD record

Starting clean HEAD: `cef7db53e6a52e7e2db7b2d208b26d784857594b`.

Baseline at 2026-09-01T18:35:51–18:35:52+0900:

`node --test tests/drawing-workspace-outbox.test.mjs`

Exit 0; 68/68 passed.

### RED

The production mutation caught by both new tests is: notify durable acknowledgements only from the outer fulfilled flush branch.

Command at 2026-09-01T18:37:03+0900:

`node --test tests/drawing-workspace-outbox.test.mjs`

Exit 1; 70 total / 68 passed / 2 failed.

- `a transport failure after a durable ACK reports that partial batch once before retry`: actual callback batches `[]`, expected `[1]`.
- `a mismatched second ACK still reports the earlier durable ACK without retry`: actual callback batches `[]`, expected `[1]`.

Both failures occurred after operation 1 had been deleted from the real in-memory adapter. The transport case also preserved operation 2 as pending with retry count 1, exact error object/message, and a 1,000 ms scheduled retry. The mismatch case preserved operation 2 as `rejected` with the exact acknowledgement error and no scheduled retry.

### GREEN

The only production change adds `rejectAfterPartialAcknowledgement(error)` inside `flushOnce()`. It reads the already-established local durable count, invokes the existing callback only when the count is positive and the outbox is live, and rethrows the original error from `finally`.

Focused command at 2026-09-01T18:38:04+0900: exit 0; 70/70 passed. After strengthening the existing all-success/all-failure characterizations, the focused rerun at 2026-09-01T18:38:47–18:38:48+0900 also passed 70/70.

The transport test proves callback batches `[1, 1]` across the rejected initial flush and later successful retry, with sends exactly operation 1, operation 2, operation 2. The mismatch test proves callback batches `[1]`, exact rejected residue, and zero retry scheduling. Existing concurrency, dispose, conflict, retry-delay, and recovery tests remain in the same focused file and passed.

## Post-commit verification

Every command in this table ran against clean behavior SHA `d24b3be90631f7d7a77c13a4d08715e5aa181df2`.

| KST start–end                     | Command                                                   | Exit/result                                                        | Artifact or classification                                          | Status    |
| --------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------- | --------- |
| 2026-09-01T18:39:39–18:39:42+0900 | focused outbox test                                       | exit 0; 70 passed, 0 failed                                        | both partial-ACK regressions plus existing outbox matrix            | `PASS`    |
| 2026-09-01T18:39:39–18:39:42+0900 | final Task 8 10-file focused union                        | exit 0; 270 passed, 0 failed                                       | shell/outbox/E2E/entry/library/route/properties/server/export       | `PASS`    |
| 2026-09-01T18:39:48–18:39:57+0900 | app and collaboration typechecks                          | both exit 0                                                        | React Router typegen and both TypeScript graphs                     | `PASS`    |
| 2026-09-01T18:40:02–18:40:18+0900 | production app and collaboration builds                   | both exit 0                                                        | approved `platform/build/` and `platform/collaboration/dist/`       | `PASS`    |
| 2026-09-01T18:40:24–18:41:07+0900 | `npm run test:drawing-workspace`                          | exit 1; 1,067 total / 1,058 pass / 7 skip / 2 fail                 | only committed P7 SHA checks; generated P6 evidence restored        | `NOT MET` |
| 2026-09-01T18:41:39–18:41:40+0900 | scoped Prettier, `git show --check`, clean status/scratch | exit 0; both behavior files formatted and clean behavior SHA shown | Playwright reports/results and `node_modules/.vite` scratch removed | `PASS`    |

The two full-suite failures compare committed P7 artifact SHA `6bf871cc6d5985529fa82f8e673dc65749c33ae6` with behavior SHA `d24b3be90631f7d7a77c13a4d08715e5aa181df2`. No P7 evidence was regenerated or hand-edited. The two new passing tests account for the increase from 1,065 to 1,067 total and from 1,056 to 1,058 passed compared with Task 8.

Real PostgreSQL was not rerun because Task 9 changes only the client outbox and its unit tests; the brief makes that run optional. No database or migration changed. The canonical disposable-Supabase command was deliberately not rerun, exactly as required by the brief.

## Preserved semantics

- Operation order remains sequential.
- `flush()` still rejects with the same transport object or mismatched-ACK message.
- The failed operation retains its existing pending/retry or rejected state.
- Retry delays remain 1,000 / 2,000 / 4,000 / 8,000 / 15,000 ms.
- A scheduled retry reports only acknowledgements it durably creates.
- All-success reports one complete count; empty/all-failure reports none.
- Concurrent flush coordination, cancellation, disposal, generation draining, recovery, and return counts are unchanged.

## Review fix 1/5 — callback errors cannot replace operation failures

The first Task 9 tests appended acknowledgement counts but their callbacks never threw. They therefore proved the partial durable count and residue/retry contracts, but could not fail if the rejection helper stopped prioritizing the original operation error over a callback failure.

The two existing real mixed-batch tests now make that boundary executable without changing production:

- Transport: the first `onAcknowledged(1)` appends the count and throws a distinct callback error. The rejected flush must still expose the exact same `transportError` object; operation 2 remains pending with retry count 1 and 1,000 ms retry, and the later successful retry completes callback history `[1, 1]`.
- Mismatched ACK: `onAcknowledged(1)` appends and throws a distinct callback error. The rejected flush must expose `Server acknowledgement did not match the queued operation.`, not the callback error; operation 2 remains rejected with that exact stored message and no retry.

The tests passed 2/2 against the intact implementation at 2026-09-01T18:54:00+0900, so the required mutation check temporarily replaced the `try/finally` helper with callback-then-throw. This mutation was never staged or committed. At 2026-09-01T18:54:11+0900 the exact two-test run exited 1 with 0 pass / 2 fail:

- transport actual error was the callback error instead of the reference-equal `offline after a partial ACK` transport object;
- mismatch actual error was the callback error, failing the explicit non-identity assertion before it could satisfy the exact mismatch message.

The exact production `try/finally { throw error; }` was immediately restored. At 2026-09-01T18:54:23+0900 the two mutation-sensitive tests passed 2/2 and the complete outbox file passed 70/70. The formatted pre-commit rerun at 2026-09-01T18:54:32+0900 also passed 70/70. `git diff` showed only `platform/tests/drawing-workspace-outbox.test.mjs`; production had no committed diff.

### Post-commit verification for `967ef821725e578be4124c1231ac36503696c133`

Every row ran against the exact clean test behavior SHA before this report/evidence-only change.

| KST start–end                     | Command                                                | Exit/result                                        | Artifact or classification                                          | Status    |
| --------------------------------- | ------------------------------------------------------ | -------------------------------------------------- | ------------------------------------------------------------------- | --------- |
| 2026-09-01T18:54:58–18:54:59+0900 | focused outbox test                                    | exit 0; 70 passed, 0 failed                        | both throwing-callback branches and existing outbox matrix          | `PASS`    |
| 2026-09-01T18:55:06–18:55:09+0900 | final Task 8 10-file focused union                     | exit 0; 270 passed, 0 failed                       | shell/outbox/E2E/entry/library/route/properties/server/export       | `PASS`    |
| 2026-09-01T18:55:14–18:55:25+0900 | app and collaboration typechecks                       | both exit 0                                        | React Router typegen and both TypeScript graphs                     | `PASS`    |
| 2026-09-01T18:55:30–18:55:46+0900 | production app and collaboration builds                | both exit 0                                        | approved `platform/build/` and `platform/collaboration/dist/`       | `PASS`    |
| 2026-09-01T18:56:11–18:56:50+0900 | `npm run test:drawing-workspace`                       | exit 1; 1,067 total / 1,058 pass / 7 skip / 2 fail | only committed P7 SHA checks; generated P6 evidence restored        | `NOT MET` |
| 2026-09-01T18:57:30+0900          | exact artifact cleanup, commit check, and clean status | exit 0                                             | Playwright/Vite scratch removed; exact test behavior tree was clean | `PASS`    |

The two full-suite failures compare committed P7 artifact SHA `6bf871cc6d5985529fa82f8e673dc65749c33ae6` with test behavior SHA `967ef821725e578be4124c1231ac36503696c133`. No legacy evidence was regenerated or hand-edited. Real PostgreSQL was not rerun because this follow-up changes only client unit assertions. The canonical disposable-Supabase command was not rerun, so no new recovery root exists.

## Concerns and release status

- Canonical disposable Supabase, production browser journey, Hocuspocus/outbox integration, visual widths, source hashes, and canonical M1 10k performance remain `UNEXECUTED` because this host has no supported container runtime.
- Four previously disclosed recovery roots remain; Task 9 created none.
- The full suite is `NOT MET` only for the two known stale P7 commit-bound evidence checks.
- Task 9 proves the outbox partial durable-ACK contract locally; it does not convert any canonical M1 gate to `PASS`.
