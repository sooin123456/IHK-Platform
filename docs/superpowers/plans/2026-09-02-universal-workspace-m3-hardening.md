# Universal Drawing Workspace M3 Collaboration Hardening Plan

> Required skills: `subagent-driven-development`, `test-driven-development`, `verification-before-completion`, `ponytail`, and `supabase` for database boundaries.

**Goal:** Close the production-shaped collaboration gaps in the canonical signed-in Drawing Workspace without adding another collaboration engine, client state library, or server.

**Architecture:** Keep Postgres as audit authority, the existing Yjs/Hocuspocus stack as the live draft transport, IndexedDB outbox as durable-before-send authority, and the existing React document store as the only UI projection. Harden the seams between those existing layers.

## Constraints

- PDF/IFC source bytes remain immutable.
- Read-only roles may publish cursor, selection, page, and canvas presence, but never a mutation-blocking soft lock.
- Local draft storage and cross-tab notifications are scoped to the authenticated user and revision.
- A disabled `realtime_collaboration` entitlement must not make the canonical workspace unusable; HTTP actions and the durable local outbox remain available.
- Review submission drains the local command queue before snapshot/outbox validation and freezes all later edit, undo, and redo entry points.
- Exact retry receipts remain idempotent through `review_requested`, `reviewed`, and `approved`.
- Do not add Redis, another CRDT, another WebSocket service, an external React state manager, or a BroadcastChannel dependency.

## Task 1 — Capability-aware Awareness

- [x] Add failing service tests for read-only soft-lock stripping, writable lock preservation, and live downgrade cleanup.
- [x] Normalize Awareness server-side from the authoritative capability.
- [x] Run collaboration protocol/service focused tests and review the diff.

## Task 2 — User-scoped offline storage and cross-tab handoff

- [x] Add failing tests for v2 `(ownerId, revisionId)` Yjs persistence names and v1 non-adoption.
- [x] Add a native `BroadcastChannel` owner/revision-scoped outbox change notifier with deterministic disposal and unsupported-browser fallback.
- [x] Integrate external-change receipt with the existing persistence reconcile and outbox flush pipeline.
- [x] Add two-realm crash-handoff and account-switch/owner-scope counterexamples, including an expiring recovery claim with explicit commit/release.

## Task 3 — Independent collaboration entitlement

- [x] Add a boolean project feature query and route tests proving `drawing_workspace=true` with `realtime_collaboration=false` still loads.
- [x] Keep the canonical Postgres graph/checkpoint bootstrap and HTTP/local-outbox editing while skipping only WebSocket/Awareness/realtime transport when collaboration is disabled.
- [x] Show an explicit plan-disabled collaboration state instead of a false connection error.

## Task 4 — Atomic review boundary and database authority

- [x] Add failing UI tests for queued edit/undo/redo drain and post-freeze denial.
- [x] Freeze new commands, drain the current command queue, then flush Yjs persistence and the durable outbox before submitting review.
- [x] Add an additive migration requiring verified sessions for public collaboration bootstrap.
- [x] Make exact review-request receipt retries succeed through `review_requested`, `reviewed`, and `approved`, and revoke the obsolete authenticated six-argument private helper.
- [x] Add real-Postgres privilege, anonymous-authenticated, and staged-review retry counterexamples.

## Task 5 — Canonical vertical gate

- [x] Extend the direct canonical M1 workspace test with owner/editor/viewer cursor, selection, soft-lock, offline handoff, and role checks.
- [x] Exercise one active room through review request, drag cancellation, reviewer decision, approver decision, and exact retries after both review and approval.
- [x] Run the focused unit/database sets, TypeScript and collaboration builds, production build, IndexedDB browser suite, disposable M1/M2 PostgreSQL authorities, canonical browser suite, `git diff --check`, and independent review.
- [x] Record exact executed and unexecuted evidence; do not claim hosted production evidence without credentials and a real run.

## Task 6 — Canonical collaboration reflection authority

- [x] Export and unit-test the existing nearest-rank percentile helper without adding a dependency or a second metrics abstraction.
- [x] Extend the existing three-context canonical M1 scenario with one excluded warm-up and exactly 30 warm Owner-to-Editor drawing-object reflection samples.
- [x] Attach raw samples plus browser, OS/CPU, memory, viewport, object-mix, and cold/warm metadata before enforcing nearest-rank p95 `<= 500 ms`.
- [x] Keep all three authenticated contexts connected throughout the measurement and preserve the existing collaboration, offline outbox, review, and approval assertions.
- [x] Run the focused helper test and full disposable M1 browser authority, then record the local result while leaving hosted-production authority `UNEXECUTED`.
