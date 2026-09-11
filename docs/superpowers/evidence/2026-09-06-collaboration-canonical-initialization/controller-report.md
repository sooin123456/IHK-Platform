# Canonical collaboration initialization — controller verification

## Outcome and scope

Atomic insert-only private initialization now returns one winner's complete state, including during simultaneous first load. Browser, detached freeze/authority and detached receipt loaders all establish/adopt that same state before subsequent mutation. An untouched room is persisted without waiting for user edits or debounce. Browser admission reconciles detached state and requires normalized durable equality; temporary nonpersisted freeze projections are refused without leaking a document. Viewer trusted serialization (including approved absent state) remains distinct from forbidden ordinary Viewer edits. Service absent initialization remains draft-only. Existing frozen/approved states and leases are not overwritten.

The actual WebSocket retry error now survives Hocuspocus serialization as drawing-reconciling. Rejected initial payloads and failed fixture providers are destroyed. Explicit token retry followed by explicit startSync preserves the same winner after a lease clears. This is not automatic UI retry implementation.

Three production files and four test files changed, with exact pre-unit dirty baselines and seven-file SHA manifest. No package dependency, original source file, native DWG engine, application UI, preview build, remote database/Storage, Git index, commit or deployment changed. Migration must precede collaboration server rollout; absent RPC fails closed.

## Evidence

- SQL RED: missing initializer42883 with empty migration. Actual UTF-8 PostgreSQL all-migration gate passed after implementation; ACL/core/wrappers, authorized Viewer, approved reader, draft service, bounds/stale SHA/sequence, lock-barrier two-backend winner, timestamps/no-overwrite, lease preservation covered.
- Server RED: initial8failed; intermediate6/8 was fixture mistakes (leaseExpiresAtMs and signed revisionId), retained and not claimed GREEN. Accepted initial15new+140existing=155.
- Wire/cleanup RED: permission-denied instead of drawing-reconciling and never-destroyed refused payload. Bounded2failed, focused2/2 GREEN. Earlier exploratory test processes hung on the exposed upstream timer leak and were terminated only within owned test scope; bounded tests preserve fallback cleanup after assertions.
- Root final collaboration run:157/157 exit0, 0skip/fail/cancel, controller-final-collaboration.log. Exactly two intentional negative onLoad diagnostics are present; do not call this a diagnostic-free run.
- Root final existing drawing/issue/anchor run via installed Vite alias loader:17/17 exit0, 0skip/fail/cancel, controller-final-legacy.log.
- Root final collaboration TypeScript check exit0, zero diagnostic bytes, controller-final-tsc.log.
- Actual PostgreSQL + production storage/server + real WS RED uses exact pre-Task2 source in owned copy: Viewer sync succeeds but no durable row exists. Final Task3fix1 GREEN: complete M1 gate1/1, all migrations, gen1,366bytes,seq0,ops0, exact cold restart, ordinary Viewer changed operationP3A02, protected forgery rejected. SHA c0c100899c9c3885453780fa50b2b4befb8c38e9598c2fcb05d38c368788c500 is the exact final run's stored state, not a universal constant.
- Fixture authentication-failure RED destroy0 vs1; final real invalid-token check destroy1 and managed shouldConnectfalse before fallback. Unsuccessful provider settlement is idempotently cleaned. All owned clusters stopped and their exact local directories/logs retained.
- Local Supabase security advisors on the actual migrated owned database: results[]. Prior diagnostic TLS default and missing owned-copy docs symlink corrected only in disposable instrumentation. No remote TLS policy change or managed advisor request. Existing long-identifier PG NOTICE output remains and is not an initializer/advisor warning.

Final distinct test count is175 =157+17+1. Focused, repeated, pre-fix and diagnostic executions are not added again. The M1 count1 contains multiple authority/concurrency/socket assertions; it is not real Supabase Auth/JWKS or browser IndexedDB. The JWT seam deliberately maps fixed local fixture tokens to seeded actors and then exercises real DB authorization.

Task1, Task2fix1 and Task3fix1 independent gates approved with no remaining findings. Final astra/high integration review accepted the unit with no Critical/Important/Minor findings, verified all seven current file hashes and final retained evidence, and checked the active-correction store/freeze guard seam without duplicate test runs.

## Preservation and continuation

Root verified final7-file hashes and all17 previously accepted native DWG protocol files, zero mismatches. HEAD remains9f5f56d93db325ff935772252f9d4fb64d69f98c and index SHAab8778babeb2aa04f070a609cbd1240760b3158cb5aa1e6ced3da34bb9a9f84c. Live preview remains4173/PID80284 and HTTP200. Do not rebuild or deploy without the appropriate next scope.

Whole goal remains active. R2 still needs automatic application consumption of drawing-reconciling with full token+sync retry, live-room transition durability, safe legacy divergent-cache recovery, real logout/full-work restoration and independently expected two-client offline geometry acceptance. Offline shell navigation while disconnected remains outside the existing M1 contract. R4 immutable resave jobs/cancellation/artifacts/browser handoff and recipient CAD qualification remain required. R5 exact-approved-revision DWG/PDF/BOQ handoff, rights and recipient acceptance remain required. The separate native resave job follow-up source map is preparation, not accepted design or implementation.

## Decision record

The accompanying progress ledger preserves every Ruling and its context. Decisions intentionally keep authority and mutable scope narrow: no repeated approval ceremony, but no inferred deployment or paid-license authority; exact dirty baselines; Viewer trusted initialization without ordinary write powers; insert-only origin under lease with fail-closed admission; extra actual SQL/socket gate and wire/resource fixes rather than masking failures in fixtures; explicit fixture-vs-real-Auth limitations. Incorrect decisions would respectively cause unintended external writes, loss of prior work, an authorization bypass, divergent CRDT state, concealed lifecycle leaks, or overstated release readiness. These risks are covered by the named tests where locally provable and otherwise remain explicit acceptance gaps.
