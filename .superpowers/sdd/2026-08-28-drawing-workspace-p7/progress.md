# SDD ledger — plan: docs/superpowers/plans/2026-08-28-drawing-workspace-p7.md

Spec: `docs/superpowers/specs/2026-08-28-drawing-workspace-p7-design.md`

Plan: `docs/superpowers/plans/2026-08-28-drawing-workspace-p7.md`

Execution status: active. P7 specification and implementation plan are committed at `f8f8c03`. Tasks 1 through 6 are independently accepted; Task 7 is ready. P6 implementation/evidence closure is committed at `f5765fc`, but production release remains nonzero because mounted server-action, real PostgreSQL, hosted Supabase, managed runtime telemetry, backup restore, and three-user authority are unavailable or unexecuted.

## Rulings

- P7 keeps React Router, Supabase/PostgreSQL, Konva, PDF.js, Three.js/web-ifc, Yjs, y-indexeddb, and Hocuspocus. No second drawing schema, state manager, CRDT, collaboration server, microfrontend, Redis, or speculative queue.
- The default preview must represent the current product generation. A preview badge may identify local fixture/storage behavior but may not advertise an obsolete phase.
- Organization libraries reuse existing canonical style/block/property/template payloads and import by immutable copy with provenance.
- Runtime CPU/RSS authority remains `UNEXECUTED` until a documented trusted provider or OTLP/Drain integration is selected; no invented or self-attested observability API.
- AI drawing recognition/classification remains deferred until P7 is actually released.

## Remaining-task interface scan

| Tasks | Producer -> consumer | Finding |
| --- | --- | --- |
| 3 -> 4 | Persistent tablet canvas/drawer shell -> instrumented/windowed canvas renderer | Compatible. Task 4 must preserve Task 3 focus, mount continuity, and drawer behavior while optimizing render work. |
| 3 -> 7 | Desktop/tablet interaction contract -> release visual and accessibility evidence | Compatible. Task 7 consumes the exact 1280x720 and 768x1024 behavior established by Task 3. |
| 4 -> 7 | Stage timings, deterministic fixture and authority labels -> final performance matrix | Compatible. Synthetic/local timing cannot be promoted to trusted runtime PASS. |
| 5 -> 6 | Organization retention/hold authority -> organization administration UI/actions | Compatible. Task 6 may administer policy inputs but must not bypass Task 5 append-only audit or trusted purge. |
| 5 -> 7 | Managed restore evidence and immutable digests -> completion audit | Compatible. Missing provider identity remains `UNEXECUTED`. |
| 6 -> 7 | Exact membership, roles and entitlements -> cross-organization release counterexamples | Compatible. Payment/checkout stays outside the release matrix. |
| 3 | Tests target shell behavior and the named shell/component files | Self-consistent; no new dependency or schema is required. |
| 4 | Production adapters and exact workload are both named | Self-consistent; measured misses remain `NOT MET`. |
| 5 | One forward migration, UI/server authority and real restore runner are aligned | Self-consistent; provider-issued evidence is explicitly required. |
| 6 | Organization actions and RLS tests cover the same administrative surface | Self-consistent; exact lookup/invite replaces full-user scans. |
| 7 | Evidence scripts consume all earlier outputs and preserve nonzero missing gates | Self-consistent; it cannot redefine incomplete authority as completion. |

## Task status

- Task 1: complete. RED `fcc83d8`; GREEN `14f10a6`; review fixes `2aae149`; authority correction `b426e45`; final independent rereview 0 Critical/Important/Minor. Full drawing-workspace tests 740 pass/3 skip/0 fail, shell E2E 12/12, root focused 51/51, typecheck/build/browser console/diff pass. Default no-query preview now exposes PDF/IFC split, removes stale/mixed copy, keeps the canvas dominant, collapses empty inspector, provides dock recovery, and truthfully labels draft P6 availability without fabricated approved lineage.
- Task 2: complete. RED `3cac5f3`; GREEN `ad915d2`; semantic remap fix `76d7b6f`; authority/UI/runtime hardening `c485cdf`; organization membership correction `f96cbb9`; final independent rereview 0 Critical/Important/Minor. Focused P7 tests 12 pass/1 real-PostgreSQL skip, full-schema PGlite 143/143, cross-project template runtime and P2/P5/P6 regressions pass; typecheck/build/changed-file formatting/diff pass. The implementation adds one forward migration, immutable organization style/block/property-schema/workspace-template publication and exact-provenance project import without a second drawing schema.
- Task 3: fix round 1/5 (3 addressed, 0 open; commit `9213807`). The review identified tablet-entry exclusivity, inline safe-area, and real toolbar-scroll coverage gaps; the scoped rereview verified all addressed with no new breakage.
- Task 3: complete (commits `f96cbb9..9213807`, review clean). RED/GREEN `66c217f`; hardening `9213807`; independent review final 0 Critical/Important/Minor. Controller verification: shell Playwright 15/15, Drawing Workspace 753 pass/4 skip/0 fail, typecheck/build/diff pass. Browser evidence at 768x1024 measured document 768x1024 with one mounted canvas, mutually exclusive drawers, and canvas focus restored after close. Physical safe-area device authority remains unexecuted; controlled nonzero inline-inset browser coverage passes.
- Task 4: complete through `098d842`; four review/fix rounds ended at 0 Critical/Important/Minor. Root verification passed focused evidence tests and inspection. Final live-run evidence records warm reopen 2283.2 ms MET, cold/cache-miss 2865.1 ms NOT MET, and hosted runtime UNEXECUTED. Cache pixels are provisional only; PDF.js source pixels gate readiness. Standalone artifacts explicitly refuse execution authority without an immutable or signed external receipt.
- Task 5: complete through `bc6b954`; two review/fix rounds ended at 0 Critical/Important/Minor. Root verification passed 39 focused tests with one real-PostgreSQL authority skip, 14 performance contract tests, typecheck, and diff check. The implementation uses one forward migration, two-phase immutable Storage purge, append-only retention/hold/restore/export evidence, exact organization administration, provider-bound restore comparison, and honest managed-restore UNEXECUTED evidence. Final source-bound performance is warm 2333.5 ms MET, cold/cache-miss 3108.3 ms NOT MET, hosted UNEXECUTED.
- Task 6: complete through `f2a079b`; two review/fix rounds ended at 0 Critical/Important/Minor. Root verification passed 24 focused tests with one real-PostgreSQL authority skip, 14 performance contract tests, typecheck, and diff check. Organization invitations, roles, project membership/move, company-library access, plan/seat/trial/quota/feature entitlements, exact server/RLS/RPC enforcement, non-enumerating delivery, append-only administration history, and >100-row keyset administration are implemented without payment or checkout. Final source-bound performance is warm 2262.4 ms MET, cold/cache-miss 2851.5 ms NOT MET, hosted UNEXECUTED.
- Task 7: review hardening finished through source commit `88dbc7b` with evidence commit `bcce6ef`; the source-bound final matrix records 35 PASS / 1 NOT_MET / 12 UNEXECUTED across 48 explicit requirements. Reviewer and independent Approver are distinct UI/action/RPC/RLS authorities; mutable ledgers and arbitrary telemetry responses cannot confer PASS; production three-user, offline operation, WSS, export and source-SHA receipts are exact. Final source-bound performance is warm 2284.6 ms MET, cold/cache-miss 2843.8 ms NOT_MET, and warm interaction p95 zoom 0.2 ms / pan 0.3 ms / selection 8.3 ms. Desktop/tablet 3/3 and license closure 9/9 pass. Real PostgreSQL, hosted collaboration/runtime, managed restore and three actual production users remain UNEXECUTED. The program is intentionally not marked complete.
