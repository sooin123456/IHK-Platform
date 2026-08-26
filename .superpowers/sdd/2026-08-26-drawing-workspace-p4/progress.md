# SDD ledger — plan: docs/superpowers/plans/2026-08-26-drawing-workspace-p4.md

Spec: docs/superpowers/specs/2026-08-26-drawing-workspace-p4-design.md
Execution status: P3 is locally complete and P4 implementation is active. Production-only P3 gates remain explicitly UNEXECUTED.

## Preflight consistency scan

| Tasks / item | Producer and consumer | Finding |
|---|---|---|
| Task 1 self | Strict six-variant Zod schema, semantic geometry, fixed-point V1 tests vs implementation | Consistent; tests use hand-derived literals and implementation exports are named. |
| Task 2 self | Final-graph validation, host-aware commands, cleanup, clipboard, block exclusion | Consistent; no new operation discriminator and inverses stay existing shapes. |
| Task 3 self | Forward migration, strict SQL mirror, generated host reference, wrapped RPC | Consistent; migration follows Task 1 exact contract and Task 2 final-graph rules. |
| Task 4 self | Six tool sessions, grouped UI, rendering, inspector | Consistent; every session emits an existing command and consumes Task 1/2 interfaces. |
| Task 5 self | Pure fixed derived schedules and authorized server evidence | Consistent; no persisted semantic rows or client measurement authority. |
| Task 6 self | Export, visible preview, collaboration/offline/history E2E | Consistent; it exercises current envelope/store rather than adding a semantic CRDT. |
| Task 7 self | Executable local/production gates and honest status evidence | Consistent; production absence is nonzero `UNEXECUTED`, not skipped pass. |
| Tasks 1 -> 2 | P4 schemas/resolver/measurement -> semantic reference reducer and commands | Interface names and exact geometry fields match. |
| Tasks 1 -> 3 | Zod keys/ranges -> SQL validator corpus | Same literal fixtures required in both authorities; SQL must not widen or narrow them. |
| Tasks 1 -> 4 | Geometry/resolver -> tool previews, render bounds, inspector | Consistent; hosted opening always resolves with object context. |
| Tasks 1 -> 5 | V1 fixed-point result -> schedule values/totals | Consistent; exact strings/totals are shared, browser preview is separate. |
| Tasks 1 -> 6 | Geometry/resolver -> export and collaboration fixtures | Consistent; export uses canonical objects, not Konva JSON. |
| Tasks 2 -> 3 | Final-graph rules -> final SQL graph guard | Consistent; command order and DB guard cover opening-first create/delete. |
| Tasks 2 -> 4 | Commands -> tool/inspector mutations | Consistent; UI cannot bypass reducer or host validation. |
| Tasks 2 -> 6 | Inverses/clipboard/restore -> offline/collaboration/history evidence | Consistent; existing operation envelope carries the same payload. |
| Tasks 3 + 5 shared `drawing-workspace.server.ts` and server tests | Task 3 widens authoritative loader; Task 5 derives evidence after load | Compatible; Task 5 must preserve Task 3 strict parser and checkpoint. |
| Tasks 4 + 5 shared `drawing-workspace.tsx` | Task 4 composes tools/inspector; Task 5 composes schedule/evidence views | Compatible; keep separate focused components to avoid one large implementation block. |
| Tasks 4 -> 6 | Semantic render/inspector -> populated preview and Chromium flow | Consistent; preview uses real canonical P4 objects and current collaboration seams. |
| Tasks 5 -> 6 | Derived schedules -> export/E2E visibility | Consistent; Task 6 does not persist or edit semantic schedule rows. |
| Tasks 1-6 -> 7 | All product contracts -> executable release gate | Consistent; gate runs behavior and authoritative evidence, not source keyword checks. |

Ruling: P4 uses straight single-segment wall objects, fixed space fields, fixed derived schedules, and no automatic room detection — this is the smallest complete P4 contract from the approved program and audit; if wrong, compound/topology and organization-library work moves earlier from P7 and requires a new reviewed phase change.

Ruling: Server-authoritative P4 measurement imports the shared fixed-point TypeScript module after authorized Postgres load rather than adding a database RPC/table — this satisfies fixed rule/version evidence without premature P6 persistence; if wrong, a later forward migration/API will be needed.

Ruling: P4 semantic objects remain outside blocks — hosted references and nonuniform transforms are deferred to P7 library work; if wrong, block schema/export/reference semantics need expansion before P4 release.

Task 1: initial implementation added the six strict semantic variants, hosted-opening helpers, block exclusion, and dependency-free fixed-point measurement kernel (commit `e1d4e47`).
Task 1: official review found 1 critical, 3 important, and 1 minor issue: silent P4 export omission, floating opening-boundary comparison, per-edge perimeter rounding, large-angle arc instability, and weak isolated polygon mutation coverage.
Task 1: fix round 1/5 closed export, opening, perimeter, large-angle, and mutation-test findings (commit `9c5a6eb`), but rereview found ordinary decimal arc composition rejected due to binary floating-point addition.
Task 1: fix round 2/5 converted arc components independently to exact microdegrees and kept composition in `BigInt`, adding deterministic decimal/huge-angle grids (commit `d35cdcb`).
Task 1: complete (rereview READY; independent 4,717-case arc oracle, 4 huge-equivalence checks, focused 58/58, touched seams 180/180, full baseline 530 pass + 1 production UNEXECUTED, typecheck and diff-check).
Task 2: initial implementation added final-graph semantic validation and reference-aware commands/clipboard/checkpoint behavior (commit `933e847`).
Task 2: official review found invalid floating precision from semantic translations, no atomic wall-shrink/dependent-delete path, and optional production clipboard graph validation.
Task 2: fix round 1/5 added fixed-point translations, mixed reference-aware wall updates/deletes using the existing operation family, and mandatory clipboard context (commit `3074beb`); rereview found a one-micromillimetre diagonal clamp overshoot and ambiguous outbox recovery for mixed operations.
Task 2: fix round 2/5 added an exact conservative BigInt clamp bound and shared mixed-operation validation through durable crash/reopen recovery (commit `e85f379`).
Task 2: complete (rereview READY; independent 1,000,000 clamp boundary cases, 20,000 move/resolve cases, real forward/undo/redo/accepted-prefix recovery, focused 223/223, full 543 pass + 1 production UNEXECUTED, typecheck and diff-check).
Task 3: initial implementation added a forward semantic-object migration, strict SQL mirror/final-graph constraints, mixed RPC handling, clone/review preservation, and strict server loading (commit `3a4f234`).
Task 3: official review found incomplete/false mixed-operation `base_versions`, SQL/TypeScript UUID and Unicode boundary drift, and missing populated P0–P3 upgrade coverage.
Task 3: fix round 1/5 added a second forward migration with exact base ledgers, SQL/TypeScript UUID+UTF-16 parity, persisted/loader enforcement, and populated final-P3 upgrade fixtures (commit `4b56b5c`).
Task 3: complete (rereview READY; P4/PGlite 14/14, relevant DB/runtime/server 170/170, full 558 pass + 1 disposable real-PostgreSQL UNEXECUTED, typecheck and diff-check). Real PostgreSQL remains explicitly UNEXECUTED because no fixture, binary, or container runtime is available.
Task 4: initial implementation added the six architectural tool sessions, Konva rendering/hit/drag/Awareness paths, grouped controls, and semantic inspector (commit `884e82a`).
Task 4: official review found six important and two minor interaction defects across live layer downgrades, Shift/snap, large-angle arcs, narrow-phase hit testing, hosted-opening previews, focus restoration, invalid polygon repair, and render-cache retention.
Task 4: fix round 1/5 closed those eight findings and centralized canonical geometry/render helpers (commit `ba63784`); rereview found three residuals in exact noncanonical Shift starts, Shift-selection Awareness fallthrough, and synchronous non-active-layer opening drag downgrade.
Task 4: fix round 2/5 canonicalized exact micromillimetre rays, unified narrow-phase selection/Awareness targets, and made drag eligibility fail closed before render (commit `32b1f6d`).
Task 4: complete (rereview READY; independent 40,000 randomized rays across eight directions/snap modes, selection/Awareness fallthrough, downgrade suppression, focused 139/139, full 574 pass + 1 DB UNEXECUTED, typecheck/build, Chromium 11/11, diff checks).
Task 5: initial implementation added pure room/door/finish schedules, authorized P4 measurement evidence, and read-only Schedule/inspector lineage UI (commit `83d560e`).
Task 5: official review found evidence could remain falsely confirmed after same-ID version/geometry changes and derivation errors could abort the whole route.
Task 5: fix round 1/5 bound evidence to full document/revision/snapshot/checkpoint/object-version/canonical-input lineage and isolated post-authorization derivation errors into explicit unconfirmed schedule states (commit `0c62ff1`).
Task 5: complete (rereview READY; focused 77/77, full 588 pass + 1 PG fixture UNEXECUTED, typecheck/build, Chromium 11/11, no migration/RPC/table/dependency changes).
Task 6: initial implementation added semantic export, populated preview, and P4 collaboration/offline/history evidence (commit `2d76b44`).
Task 6: official review reproduced changed-checkpoint restore rejection, hosted-opening export overdraw, fake offline/outbox and incomplete vertical evidence, renderer style drift, and an incomplete connected preview.
Task 6: fix round 1/5 closed runtime restore/export/style defects and added real offline/vertical evidence (commit `4c9c798`), but rereview found detached-state vertical transitions, self-authored `operationStatus`, and a vacuous pixel sample.
Task 6: fix round 2/5 replaced those with mounted UI/bridge/IDB/reload evidence, honest action-ACK boundary and provider UNEXECUTED status, and mutation-sensitive pixels (commit `e32ca40`); rereview exposed rapid mounted command loss.
Task 6: fix round 3/5 serialized mounted commands/history on the latest adapter projection and awaited actual IDB flush (commit `cb75670`); rereview exposed version-keyed inspector dirty-draft loss.
Task 6: fix round 4/5 preserved per-field semantic inspector drafts through local projections while blocking same-field authoritative conflicts (commit `ea7885c`).
Task 6: complete (rereview READY; mounted inspector 30/30, combined P4+IDB Chromium 9/9, focused 34/34, full 599 pass + 1 PG UNEXECUTED, both typechecks/builds, source PDF/IFC hashes exact). Hosted provider-authoritative convergence and production remain explicitly UNEXECUTED.
Task 7: initial implementation commit `b2cc642` was NOT READY after official review; its browser authority, hosted evidence, credential guard, manifest and prose-only performance evidence were insufficient.
Task 7 official-review fixes: source `6d32d9d` adds hermetic fixed-port authority/launcher, exact structured argv and P3 credential guard, exact hosted V1 evidence/schedules, source-bound generated `task-7-performance.json`, mounted two-opening atomic delete/reload/undo, and tombstone-aware Yjs recorded restore. Sanitized local release is PASS; generated `<= 2.5s` decision is false; hosted provider p95/offline/RLS/freeze/source/deploy/rollback remain PRODUCTION UNEXECUTED.
Task 7 rereview fixes: source `1a78ea4` binds hosted measurements and schedules to stable semantic object identities across UUID/object permutations and makes every release Git boundary noninteractive. The clean-environment TTY release exits unattended with `P4 LOCAL PASS`; the regenerated `<= 2.5s` decision remains false and all hosted-only evidence remains PRODUCTION UNEXECUTED.
Task 7 rereview round 3: source `cc33072` rejects orphan measurement keys and requires complete exact measurement/schedule structures. The production browser compares confirmed serialized loader evidence to a separate authorized bootstrap derivation. Clean-environment local release remains PASS; `<= 2.5s` remains false and hosted-only evidence remains PRODUCTION UNEXECUTED.
Task 3: initial implementation added the forward semantic-object migration, strict SQL mirror/generated host authority, final operation graph enforcement, clone/approved-child host remapping, and strict authorized loader widening (`feat: persist drawing semantic objects`).
Task 5: initial implementation added fixed full-revision room/door/finish schedules and authorized checkpoint-bound `P4_MEASUREMENT_V1` server evidence without persisted semantic rows or a public measurement API (`feat: add architectural drawing schedules`).
Task 5: complete (focused schedule/table/server 52/52, broad database/server/route/schedule 226/226, full 581 pass + 1 disposable-PostgreSQL UNEXECUTED, typecheck/build, Chromium 11/11, Prettier and diff checks).
Task 5 official review fix: full authorized document/revision/snapshot/checkpoint plus exact object version/fingerprint lineage now gates confirmed evidence, same-ID replacement is stale, and post-authorization derivation failures retain an accessible read-only workspace with bounded per-schedule unconfirmed/error previews. Authorization/bootstrap denial still propagates; no schema/API/dependency change. Verification: focused 77/77, broad 233/233, full 588 pass + 1 disposable-PostgreSQL UNEXECUTED, typecheck/build, Chromium 11/11, Prettier and diff checks.
Task 6: initial implementation replaced the semantic export boundary with canonical SVG/PNG/PDF rendering plus all-canvas reference preflight, populated the local preview with a complete P4 graph/schedules/checkpoint and real IndexedDB persistence, and added vertical Chromium collaboration/offline/history evidence without a semantic CRDT or new dependency. Verification: focused export 21/21, preview 6/6, collaboration 16/16; full 591 pass + 1 disposable-PostgreSQL UNEXECUTED; app/collaboration typecheck and build; Task 6 Chromium 2/2, touched shell 3/3, real-browser 100-operation semantic IndexedDB recovery 1/1 with exact IDs; immutable IFC/PDF hashes and desktop/tablet screenshots recorded in `task-6-evidence.txt`.
