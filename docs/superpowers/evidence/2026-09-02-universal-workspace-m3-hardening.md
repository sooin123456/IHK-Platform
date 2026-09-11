# 1HK Universal Drawing Workspace M3 collaboration hardening evidence

Release verdict: **LOCAL PASS for the scoped M3 collaboration-hardening vertical**. The canonical signed-in workspace now has capability-normalized Awareness, owner/revision-scoped offline recovery, collaboration-entitlement-independent HTTP authority, an atomic review freeze, and staged exact-retry coverage without adding another CRDT, WebSocket service, cache, or client state library. Independent review returned **READY** for this scope.

This is local production-shaped evidence, not a hosted-production release claim. Credentialed hosted checks and unrelated P7 evidence-baseline maintenance were not executed as part of this M3 closeout.

## Implemented authority

### Capability-aware collaboration

- The collaboration server rewrites Awareness identity and write capability from verified room authorization rather than trusting the browser payload.
- Viewer presence may expose bounded cursor, selection, page, and canvas state, but cannot publish a mutation-blocking soft lock.
- A live capability downgrade removes an existing soft lock and makes the connection read-only.
- The canonical browser gate proves a Viewer joins the same page while remaining unable to edit, and that an Editor's cursor and selection are visible to the Owner.

### Scoped offline and crash recovery

- Local Yjs persistence and the durable outbox are scoped by authenticated owner and revision. Legacy ownerless data is not silently adopted by a different account.
- Native `BroadcastChannel` notifications wake only the matching owner/revision workspace and have deterministic disposal plus an unsupported-browser fallback.
- A crashed writer can leave a durable operation before its Yjs append. Another realm claims recovery with a bounded lease, appends once, explicitly commits the recovery claim, and releases the claim on failure so an expired claimant can be taken over.
- A durable HTTP acknowledgement is recorded before outbox settlement. Reconciliation does not re-enqueue an already acknowledged operation merely because it has fallen outside the bounded recent-outcome window.
- The real-browser IndexedDB suite covers ordered offline recovery, crash/reopen, compacted redo lineage, version-change recovery, two-realm same-ID convergence, and crashed-writer handoff.

### Collaboration entitlement separation

- Disabling `realtime_collaboration` disables only Hocuspocus/WebSocket, Awareness, and realtime transport. It does not disable the canonical workspace, Postgres graph/checkpoint bootstrap, IndexedDB outbox, or HTTP operations and review requests.
- HTTP operation acknowledgement no longer depends on delivering an outcome to a disabled collaboration service.
- HTTP review uses the non-collaboration database boundary when the entitlement is off. The UI reports the plan-disabled state instead of presenting a false connection failure.
- Server actions and database authority continue to enforce role and revision status independently of visible controls.

### Atomic review and immutable exact retry

- Review preparation disables later edit/undo/redo entry points, drains the current command queue, flushes Yjs persistence and the durable outbox, then requests the freeze.
- The active editor's selection and soft lock are cleared when the authoritative freeze arrives. An in-progress drag, preview geometry, and pointer capture are cancelled without an object/version/operation mutation.
- The freeze manifest binds accepted operations, authoritative outcome statuses, operation sequence, subject revision version, and Yjs state vector.
- A committed freeze with the same request ID is replayed from persisted evidence without trying to acquire a new draft-only lease. The fast path is limited to `frozen`, `reviewCommitted`, exact request identity, and `review_requested`/`reviewed`/`approved`; a different request remains fail-closed.
- The canonical gate advances one room through request review, Reviewer `reviewed`, Approver `approved`, two exact retries after review, and one exact retry after approval. Revision status and approval-row cardinality remain unchanged on those retries.

## Verification authority

| Authority                                          |                                               Result | Covered surface                                                                                                                   | Status |
| -------------------------------------------------- | ---------------------------------------------------: | --------------------------------------------------------------------------------------------------------------------------------- | ------ |
| Independent-review focused M3 union                |                                 502 passed, 0 failed | Awareness authority, entitlement-off HTTP path, outbox recovery/ACK reconciliation, freeze lease/receipt/database counterexamples | `PASS` |
| Latest post-review focused union                   |                                 147 passed, 0 failed | collaboration service, freeze coordinator, outbox, and source-attach UI regressions after the final exact-replay fix              | `PASS` |
| Independent final exact-replay delta               |                                  68 passed, 0 failed | collaboration service and review-freeze suites after the final committed-freeze replay fix                                        | `PASS` |
| `npm run typecheck`                                |                                               exit 0 | application TypeScript graph and generated route types                                                                            | `PASS` |
| `npm run build:collaboration`                      |                                               exit 0 | collaboration service TypeScript build                                                                                            | `PASS` |
| `npm run build`                                    |                                               exit 0 | production client and SSR build                                                                                                   | `PASS` |
| IndexedDB Chromium suite                           |                                   6 passed, 0 failed | real browser persistence, two-realm recovery, version-change, and crash handoff                                                   | `PASS` |
| Disposable M1 real PostgreSQL authority            | 1 passed, 0 failed, 1 environment-guard test skipped | migrations, privilege boundaries, feature-off HTTP operations/review, staged review receipt                                       | `PASS` |
| Disposable M2 PDF-attach real PostgreSQL authority | 1 passed, 0 failed, 1 environment-guard test skipped | additive migrations, source locks, privileges, and preflight                                                                      | `PASS` |
| Canonical authenticated Chromium suite             |                                  10 passed, 0 failed | complete M1 production-shaped regression including the M3 collaboration vertical                                                  | `PASS` |
| `git diff --check` plus documentation checks       |                                               exit 0 | implementation diff plus whitespace and Prettier checks for both M3 closeout documents                                            | `PASS` |
| Independent final review                           |                       Critical 0; Important 0; READY | final exact-replay delta and scoped M3 implementation                                                                             | `PASS` |

The disposable full gate was `npm run test:e2e:drawing-workspace-m1:local`. It created an isolated local Supabase project, ran application typecheck/build, built the collaboration service, executed both real-PostgreSQL authorities, and then ran the ten authenticated Chromium scenarios with one worker. `test-results/.last-run.json` recorded `passed` with no failed tests.

The `502/502` entry is the recorded independent-review focused aggregate. Its original per-file command list was not preserved in this closeout note, so no reconstructed command is claimed here. The final exact-replay delta was independently rerun with `node --import tsx --test tests/drawing-review-freeze.test.mjs tests/drawing-collaboration-service.test.mjs` and passed `68/68`; the latest four-file post-review union recorded above passed `147/147`.

The canonical M3 scenario specifically proved three simultaneous participants, Viewer read-only behavior, Editor cursor/selection reflection, an Owner-visible soft lock, exact offline operation settlement, review-triggered interaction cancellation with unchanged database geometry/version/operation count, staged Reviewer and Approver authority, and immutable exact retries through final approval.

## Design restraint

- Postgres remains the committed audit authority; Yjs/Hocuspocus remains the live draft transport; IndexedDB remains durable-before-send storage; the existing React external document store remains the UI projection.
- No Redis, second CRDT, second WebSocket/collaboration service, Zustand-style state manager, or BroadcastChannel package was added.
- Feature-off behavior reuses the canonical Postgres snapshot and existing HTTP mutation route rather than creating a separate offline editor.
- Exact retry reuses the persisted freeze and snapshot evidence. It does not reopen a reviewed revision or acquire a new draft lease.

## Unexecuted and non-blocking scope

- Credentialed hosted-production collaboration, hosted multi-user review, and hosted failover checks were **not executed**. This document makes no hosted-production PASS claim.
- The broad historical `npm run test:drawing-workspace` aggregate was not used as the M3 release authority. Previously disclosed P7 release-evidence SHA baseline drift remains an unrelated fixture/baseline maintenance item; it was not changed or claimed resolved here and does not invalidate the executed M3-focused, real-database, or canonical-browser authorities.
- Multi-instance Hocuspocus scale, Redis/pub-sub, multi-region failover, and collaboration p95 under production load were not exercised. Those remain threshold-driven follow-up work rather than dependencies added speculatively in M3.
- The production build continues to warn about a generated client chunk above 500 kB and the unsigned presentation-only theme cookie. Neither warning relaxes an authorization or persistence assertion above.

## Final ruling

The locally scoped M3 collaboration-hardening vertical is ready to proceed. The evidence closes the identified capability, owner-scope, crash-handoff, entitlement-off HTTP, freeze-cancellation, and staged exact-retry gaps on the canonical route. Hosted production and unrelated P7 evidence-baseline work remain explicitly unexecuted/non-blocking and must be evaluated under their own release authorities.

## 2026-09-03 source-free canonical follow-up

- The canonical `/projects/:projectId/workspaces/:documentId` path is now exercised against a document whose `source_file_id` and `source_sha256` are both null. The scenario proves an Owner comment, an explicit Editor mention delivered without reloading, the history surface, and restoration of a review checkpoint while the canonical URL remains unchanged.
- Browser Realtime now obtains the authenticated session and installs its access token before creating and subscribing the project/revision channel. The previously observed tokenless join and misleading early `SUBSCRIBED` state no longer occur; the two-browser gate reaches the Editor-side realtime revalidation and mention assertion.
- Checkpoint restoration was verified against the actual append/audit model: the checkpoint object remains `active`, the later object is tombstoned as `deleted`, and one persisted `restore_checkpoint` operation names the selected checkpoint.
- A fresh `npm run test:e2e:drawing-workspace-m1:local` run passed all 17 authenticated Chromium scenarios after application typecheck/build, collaboration build, and disposable PostgreSQL/Storage authority checks. `test-results/.last-run.json` recorded `passed` with no failed tests.
- The focused Realtime plus fixture-license union passed 18/18, the 35-package permissive-license policy returned `PASS`, `git diff --check` passed, and independent release review reported no actionable Critical or Important finding.
- This follow-up does not claim a credentialed hosted multi-user replay. The deployed public/anonymous route checks are recorded in the production deployment evidence; a hosted Owner/Editor/Reviewer collaboration session remains explicitly unexecuted.

## 2026-09-04 canonical collaboration reflection authority

### Initial baseline (superseded)

- A fresh disposable `npm run test:e2e:drawing-workspace-m1:local` authority passed all 18 Chromium scenarios. The canonical three-context collaboration scenario recorded one excluded Owner-arrow/Editor-bounds warm-up followed by exactly 30 warm Owner-to-Editor line-bounds reflections.
- This pre-review baseline's nearest-rank p95 was the 29th sorted sample: **112.118625 ms**, against the **500 ms** target (`PASS`). It is retained only as execution history and is superseded by the hardened controller result below. The timing boundary is Owner `ArrowRight` dispatch through the Editor rendering the independently derived selected-line bounds; it excludes tool selection, database polling, save completion, connection, and reload.
- The local measurement ran on Chromium 151.0.7922.34 at 1440x900 on macOS 25.5.0 (Apple M3 Max, 14 logical CPUs, 36 GiB total memory), with one selected line. The Viewer remained connected and read-only; all three contexts were reasserted after sampling.
- This is local disposable evidence only. Hosted multi-user collaboration authority remains **UNEXECUTED**.

### Current evidence-capture authority

- The authority now pre-captures page-derived metadata, continuously observes Owner, Editor, and Viewer collaboration/participant status during sampling, and retains Node-side close/crash failures. A primary sampling error writes Node-local `NOT MET` evidence without querying the renderer; a successful run flushes and tears down the narrow observer before `PASS` evidence. The controller's final fresh local disposable rerun passed all 18 Chromium scenarios with 30/30 observed-clean samples; nearest-rank p95 rank 29 was **104.040583 ms** against the unchanged **500 ms** target (`PASS`).
