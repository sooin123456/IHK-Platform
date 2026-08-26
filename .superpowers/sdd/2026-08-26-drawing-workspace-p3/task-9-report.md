# P3 Task 9 report — atomic collaboration-room review freeze

## Delivered

- Generated the forward-only Supabase CLI migration `20260826043741_drawing_workspace_p3_review_freeze.sql`; no committed migration was edited.
- Added persisted `active | freezing | frozen | released` collaboration state, an idempotent request UUID, accepted-manifest SHA-256/count/base sequence, frozen timestamp and committed-review fence.
- Added service-only begin/complete/release/read functions and a public collaborative-review wrapper. The database locks revision then collaboration state, compares every accepted immutable operation envelope with PostgreSQL, and delegates canonical P2 snapshot/SHA creation to the existing database review function.
- Kept the Yjs state-byte SHA and canonical business snapshot SHA in separate fields and code paths.
- Added an exact canonical freeze manifest containing client operation ID, revision, actor, type, base/result versions, forward/inverse, history lineage and authoritative sequence. Client timestamp and schema noise are excluded; pending, conflicted and malformed ledgers fail closed.
- Added a separate 32-byte minimum `COLLABORATION_FREEZE_SECRET`, constant-time verification, a bounded 5-second internal request, strict 16 KiB endpoint input and no browser secret path.
- Added restart reconciliation and same-request recovery for begin/complete/HTTP/DB lost responses. Browser retries keep one request UUID in session storage.
- Added database-first release semantics: the live Y.Doc becomes released only after the authoritative release commits. Review-requested/approved/committed review and stale request releases remain frozen.
- Added immediate read-only UI remount, gesture/selection/soft-lock/cursor/awareness clearing, pending/conflicted/volatile gating and safe failed-transition recovery.
- Preserved the existing maker-checker approval/decision evidence and legacy non-collaborative review signature.

## Review hardening

- Revoked the earlier private legacy review function from Data API roles; authenticated users can no longer bypass the collaborative wrapper.
- Locked the revision before the legacy room-existence check, closing the legacy-review versus begin-freeze race with the same revision-to-state lock order.
- Made the frozen-state write trigger fail closed when its transaction-local GUC is unset by coalescing SQL `NULL` before comparison.
- Captured DML row counts before clearing the GUC, so a stale begin/release cannot report success after a zero-row conditional write.
- Reconstructed and returned the full persisted manifest after a committed complete-freeze response is lost.
- Reconciled the same request after an initial freeze HTTP response is lost and attempted an authoritative safe release after every final DB-transition failure, including permission revocation.
- Built candidate released Yjs bytes off-document, committed the database release first, then applied them to the live room. A concurrent review commit therefore cannot make the live room writable.

## Changes-required follow-up

- Added the forward-only CLI migration `20260826052305_drawing_workspace_p3_review_rejection_recovery.sql`; the committed `20260826043741` migration remains byte-unchanged.
- Bound every new freeze to `frozen_subject_revision_version` and persisted bounded `frozen_yjs_state_vector` plus exact explicit operation statuses. The application server validates and submits all three fields, independently of the Yjs-state byte SHA and canonical business snapshot SHA.
- Made reviewer rejection atomically return `review_requested` to a version-incremented draft while releasing collaboration state and clearing the committed fence and all prior proof. Old request/version proof is denied; the next edit and review require a new version-bound request and freeze. Approval stays permanently frozen.
- Added authoritative load-time reconciliation before `onLoadDocument` returns. Fresh server/coordinator instances resolve and release interrupted draft freezes, synchronize rejected drafts to released Yjs bytes, and preserve exact review-requested/approved freezes without a tab retry.
- Reviewer rejection also sends a server-only authenticated authority notification to reconcile an already-loaded live room immediately; periodic authoritative room reconciliation is the fallback. Exact already-released rooms short-circuit without new Yjs structs, state-vector growth, database generation churn, or persistence writes.
- Both internal HTTP endpoints now count raw bytes while reading and immediately return 413 above 16 KiB before authentication, parsing, storage, or coordinator work. A real HTTP test sends valid oversized JSON as one chunk to both endpoints.
- Browser retry identity is now keyed by revision ID and version, so a rejected revision cannot reuse its previous session proof.
- A mistaken `pnpm exec` verification attempt created untracked `platform/pnpm-lock.yaml` and `platform/pnpm-workspace.yaml` in this npm-lock repository. Those two known generated artifacts were removed immediately; subsequent verification used `./node_modules/.bin/tsc` and npm scripts.

## Active-freeze race follow-up

- Added coordinator-local room/request ownership before the first authoritative freeze read/begin. Same-request calls share one promise, different requests fail closed, and release cannot interrupt an in-flight owner.
- The HTTP service also acquires a ref-counted same-request room owner before awaiting detached storage load, then hands ownership to the coordinator only after `freeze()` has synchronously registered it. The shared load/periodic seam short-circuits ordinary recovery while preparation owns the room and fences concurrent live documents across persisted active, released, freezing, and frozen-draft states.
- If detached storage load fails before that handoff, the last preparation owner is removed and the already-loaded room is immediately reconciled back to the authoritative active state. A deterministic failure/retry test proves there is no stranded read-only room and the same request can subsequently freeze normally.
- Periodic and load-time reconciliation now holds an exact matching in-flight owner read-only instead of completing or releasing it. A successful freeze retains a bounded 60-second completion lease until the application commits review; the application then sends an authenticated authority reconciliation that observes `review_requested` and clears ownership while preserving frozen state.
- Completed abandoned leases recover once after expiry with an injected-clock deterministic boundary. A genuinely crashed process has no local owner, so a fresh process still resolves persisted abandoned `freezing`/`frozen draft` state immediately. The collaboration service remains a single active coordinator process; overlapping multi-replica room ownership would require a persisted cross-instance lease before enabling multiple writers.
- Deferred-promise races pause the original request both before `beginFreeze` commits and after begin. A separately loaded Y.Doc is fenced to the exact owner request even while Postgres still reads `active`; periodic reconciliation, same/different request retries, release, and client updates then prove no writable interval, one begin/complete, permanent frozen review success, and no double cleanup release.

## TDD evidence

- RED tests reproduced missing freeze contracts, exact-manifest noise handling, pending/conflicted rejection, update-versus-freeze, direct review without freeze, request/digest mismatch, released draft writability and separate-secret authentication.
- Additional RED/green regressions cover complete-freeze response loss with a nonempty manifest, initial HTTP response loss, stable browser request identity, permission revoked after freeze, private legacy RPC privilege bypass, legacy lock order, unset-GUC write bypass, stale release row-count behavior and review-commit-versus-live-release.
- Fresh Chromium verifies transactional read-only bootstrap and `review click -> immediate read-only remount -> failed transition -> same-ID editable recovery`.

## Verification evidence

- `npm run test:drawing-workspace`: 485 tests, 484 passed, 1 existing environment-dependent test skipped, 0 failed.
- Freeze/service/Yjs focused suite: 63 passed, 0 failed.
- Full PGlite database runtime: 118 passed, 0 failed, including exact frozen manifest, private legacy privilege denial, ordinary store rejection after freeze, idempotent review, canonical snapshot SHA, permanent committed freeze and stale-release fencing.
- `npm run typecheck`: passed.
- `npm run typecheck:collaboration`: passed.
- `npm run build`: passed; only existing chunk-size, React Router future-flag, unsigned theme-cookie and localStorage warnings were emitted.
- Fresh Chromium: 2 passed, 0 failed.
- `git diff --check`: passed.

Follow-up verification on the changes-required fixes:

- `npm run test:drawing-workspace`: 488 tests, 487 passed, 1 existing environment-dependent test skipped, 0 failed.
- Full PGlite drawing database runtime: 118 passed, 0 failed, including `freeze -> request -> reject -> edit -> new-request refreeze -> approve`, old-proof denial, released proof clearing, and permanent approval freeze.
- Focused service/freeze suites after the active-owner race fix: 49 passed, 0 failed; fresh server instances cover interrupted, rejected-draft, review-requested, approved, deferred detached-load, and already-loaded live-room boundaries, including repeated released-state idempotency.
- Real one-port HTTP oversized-valid-JSON tests: both `/internal/outcomes` and `/internal/freeze` return 413 with no parser/storage/coordinator side effect.
- `npm run typecheck`, direct collaboration `tsc --noEmit`, and `npm run build`: passed.
- Fresh Chromium review-freeze/bootstrap selection: passed (exit 0).
- `git diff --check`: passed.
- The earlier six-file independent Node/PGlite review passed 222/222. A final independent read-only review of the active-owner and detached-load-failure cleanup found no remaining critical or important issue; its focused freeze suite passed 17/17, collaboration typecheck passed, and the diff was clean.

## Production gates not claimed

- The migration was executed from a clean PGlite database, not applied to a hosted Supabase project.
- `supabase db diff --local` and local database lint/advisors could not run because this machine has neither Docker nor Podman; the CLI reported Docker Desktop as a prerequisite. The project is not linked, so no hosted database was inspected or changed.
- Hosted PostgreSQL concurrent sessions, collaboration-service deployment/restart, real auth/RLS adversarial traffic and production Realtime fanout still require staging/deployment evidence.
- The disposable-PostgreSQL concurrency fixture remains the one existing `UNEXECUTED` Drawing Node gate.
- No Task 10 performance fixtures or Task 10 scope were added.
