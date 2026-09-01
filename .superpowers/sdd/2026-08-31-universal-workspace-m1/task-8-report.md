# Task 8 report — M1 acceptance authority hardening

## Outcome

Task 8 now contains a fail-closed disposable-Supabase controller, status-bound Playwright preflight, process-group and partial-failure-safe cleanup, exact estimator journey assertions, measurable primitive quantity UI, server-validated BOQ reverse focus, and executable real-PostgreSQL purge attacks.

The latest tested behavior commit is `729f07d96c33902a8f3f4f551863af75383af5b9` (`fix: close universal workspace review findings`). Every final-wave post-commit command below ran after that exact clean commit existed and before this report/evidence-only change. The preceding Editor-boundary behavior remains `00d55985f236aa9d36acbe73c52a4e43531f8c5a`; its historical command record is preserved separately. The later documentation-only commit does not become either behavior SHA.

M1 remains **UNEXECUTED**, not complete. Docker, Podman, Colima, OrbStack, and Finch are absent, so disposable Supabase never started and the canonical browser, Hocuspocus, visual, source-integrity, and M1 10k gates did not run. No local preview, P7 result, static test, or standalone PostgreSQL run is presented as replacement authority.

## Files and interfaces

### Disposable authority and lifecycle

- `platform/scripts/run-drawing-workspace-m1-e2e.mjs` and `.d.mts`
  - Export exact authority/status/config/cleanup/lifecycle helpers for mutation tests.
  - Create only a canonical OS-temp `mkdtemp` project, with generated marker, project ID, copied migrations/config, and free loopback ports.
  - Capture and sanitize sensitive Supabase start/status/stop output; spawn without a shell.
  - Start long-running POSIX children in isolated process groups, retain a group when its leader exits but descendants remain, terminate and escalate the entire group before owned cleanup, refuse the runner's own PGID, retain a Windows child-process fallback, and preserve 130/143 identity.
  - Validate canonical containment, marker, project/config equality, and recursive `lstat`; reject child symlinks.
  - Preserve the root/config when `supabase stop` fails. Remove an exact empty/partial owned root only before a start attempt.
- `platform/playwright.m1.config.ts`
  - At config import, calls `supabase status --workdir <exact-root> -o json` and matches API URL, DB URL, anon key, service key, API/DB ports, marker, project ID, and exact generated config before fixture writes.
  - Keeps production `npm run start`, production collaboration, fixed loopback endpoints, one worker, and no dev/preview route.
- `platform/tests/drawing-workspace-m1-release-harness.test.mjs`
  - Covers mismatched/fake status, appended config drift, direct invocation, repository-root refusal, symlink children, stop failure recovery, partial start, signal termination/idempotence, interrupt exit identity, secret redaction, own-PGID refusal, a signaled real POSIX parent/grandchild tree, and a second real tree whose leader exits normally while its `SIGTERM`-ignoring grandchild is retained and killed before cleanup.

Production `platform/build/`, `platform/collaboration/dist/`, and typegen output remain the approved build architecture. Only the Supabase authority is `mkdtemp`-isolated.

### Estimator and canonical journey

- `platform/e2e/utils/drawing-estimator-fixture.ts`
  - Exact rate CSV/SHA, same-organization truly empty project, normalized Estimator/Reviewer/Approver/Viewer roles, immutable rate evidence, non-parseable RVT sentinel, and post-browser BOQ structure seeding.
  - Authenticates the exact Estimator session that created the draft, seeds real W/F/D lines plus component-free `M1-C-001`, returns exact price-book/resource/component/line/section IDs, and provides an exact creator/version/project/code-bound cleanup for only the temporary negative line.
- `platform/e2e/drawing-workspace-m1-estimator.spec.ts`
  - Uses `getByLabel(...).toHaveValue` for evidence reason.
  - Creates/persists all seven classes: floor, wall, ceiling, door, window, furniture, demolition.
  - Selects exact labeled length/area/count rows and confirmation buttons; visible PDF calibration asserts `5 m`.
  - Proves W/F/D quantities, units, server rates/amounts, evidence/review state, exact total, exact manifest IDs/hashes, and real `M1-C-001` missing-rate/missing-evidence state (`0.15 m`, em-dash rate/amount, no zero or confirmed state) before deleting its object and exact draft line; W/F/D remains `153,600원` before approval.
  - Viewer denials use real same-project BOQ version/line/section and price-book IDs across UI/API/database. The RLS-filtered line update uses `Prefer:return=representation`, proves HTTP 200 with zero returned rows, and independently proves the exact admin-loaded row is unchanged; the real-ID rate insert remains denied.
  - Browser B reads moved geometry from the production inspector.
  - Performance timing begins immediately before canonical `goto` after auth setup; targets the descendant Konva Stage for real pointer zoom, pan, and selection; proves actual zoom/offset transitions and the exact selected object ID/name, and attaches three interaction-window RAF arrays before fail-closed targets.
  - Installs page/context console/network listeners before first navigation and proves Tab focus order for blank/starter/PDF cards at 1440×900 and 1024×768.
- `platform/app/lukas/components/drawing-canvas.client.tsx`
  - Exposes the existing production selection state as a semantic `data-selected-object-id` beside the already-rendered selected name and viewport x/y/zoom; it adds no test mode or parallel state.

### Measurable primitives

- `platform/app/lukas/lib/drawing-measurements.ts`
- `platform/app/lukas/lib/drawing-semantic-schedules.ts`
- `platform/app/lukas/components/drawing-quantity-inspector.tsx`
- `platform/app/lukas/components/drawing-inspector.tsx`
- `platform/tests/drawing-workspace-semantic-schedules.test.mjs`
- `platform/tests/drawing-workspace-tables.test.mjs`

The server evidence path and inspector now support measurable line, polyline, rectangle, circle, arc, and applicable architectural primitives without adding primitive objects to semantic schedules. The inspector exposes deterministic `길이 수량`, `면적 수량`, `개수 수량`, exact confirmation buttons, and selected-object bounds. Amount calculation remains server-only.

### BOQ reverse focus

- `platform/app/lukas/screens/verified-boq.tsx`
- `platform/tests/verified-boq.test.mjs`

The route still validates that the requested line belongs to the selected version. A ref/effect imperatively focuses only that server-validated row; unreliable `<tr autoFocus>` was removed. Effect dependencies are primitive focus/render values rather than the whole result object.

### Purge child guard and executable attacks

- `platform/supabase/migrations/20260901000000_drawing_retention_purge_child_guards.sql`
- `platform/tests/drawing-workspace-retention-cascade.test.mjs`
- `platform/tests/drawing-workspace-m1-real-database.test.mjs`

The additive migration permits each draft/layer/binding child bypass only when `DELETE`, trigger depth >1, exact purge-project GUC equality, table-owner current user, and absent parent all hold. The draft trigger is now `SECURITY INVOKER`, so its table-owner predicate describes the actual caller rather than the function owner. Execute remains revoked from public/Data API/service roles. Mutation tests lock the binding guard's entire AND conjunction and append-only rejection. The real matrix verifies `prosecdef=false`, owner context, attacks forged depth-1 binding/layer/page deletes, and test-only nested layer/binding/page deletes at depth >1 while the parent exists; it proves every attacked row and the project remain before a legitimate service parent cascade removes them. No retention interval/hold/dependency was weakened.

### Existing bounded Task 8 product/legacy work retained

The preceding Task 8 unit already contains the exact empty-project `새 작업실` entry, fixed preview-versus-canonical operation selection, exact `내역으로 돌아가기` helper, P0–P5/P7 selector compatibility, and two-frame P7 projection optimization. This hardening did not roll those changes back or broaden them.

### Evidence

- `docs/superpowers/evidence/2026-08-31-universal-workspace-m1.md`
- `.superpowers/sdd/2026-08-31-universal-workspace-m1/task-8-report.md`

These are the only files changed by the evidence-only commit.

## Independent review closure

1. Direct Playwright can no longer self-author a root and target another loopback stack: exact `supabase status` values/keys/ports/config are verified before fixture writes.
2. SIGINT/SIGTERM, tracked-child termination, independently exiting group leaders, own-PGID refusal, partial start, stop failure, and symlink-child cases are covered; recovery metadata survives a failed stop.
3. Supabase CLI secrets/DB URLs are captured, bounded, and sanitized rather than streamed.
4. Existing `build/` and collaboration `dist/` remain intentional; no alternate build architecture was invented.
5. Real PG adds forged depth-1 GUC and depth>1-with-parent attacks for draft, layer, and binding guards, proves the draft guard is invoker-mode, and still passes the legitimate service cascade.
6. Evidence reason is asserted as an input value.
7. Supported measurable primitives expose deterministic quantity rows and confirmation; PDF calibration checks a visible real 5 m path.
8. All seven required classifications are created and persisted.
9. W/F/D rows and manifests are exact and row scoped; a missing-rate/evidence negative state is real and removed before approval.
10. Viewer BOQ denial uses existing version/line/section IDs.
11. Browser B proves geometry through visible production inspector bounds.
12. Performance starts at canonical navigation, exercises the actual Konva descendant, attaches raw samples, and fails target misses.
13. Visual listeners precede navigation and keyboard focus order is asserted.
14. Viewer rate denial uses the existing same-project price-book ID.
15. BOQ row focus is imperative and server-ownership-bound.
16. Evidence names the exact clean behavior commit and keeps canonical Docker gates `UNEXECUTED`.

## Second independent review closure

1. The negative branch now uses a real same-version `M1-C-001` line with zero rate components. The serial spec asserts row-scoped `0.15 m`, `검토 필요`, `근거 누락`, em-dash rate/amount, no `0원`, and no `확정`; it deletes the exact test object and creator-owned draft line before approval and re-proves the W/F/D `153,600원` total.
2. Viewer BOQ update evidence now follows PostgREST RLS semantics: real line/version ID, `Prefer:return=representation`, HTTP 200 with `[]`, followed by an admin reload proving every selected field unchanged. The same-project price-book component insert remains an explicit denial.
3. The production canvas exposes exact selected object ID plus its existing name/viewport state. The canonical spec records before/after zoom, pan, and selection, targets the intended second object, and captures 24 RAF samples around each real interaction rather than an idle loop.
4. POSIX long-running children now own an isolated process group. The real harness starts a parent and `SIGTERM`-ignoring grandchild, requests `SIGINT`, exercises group escalation, and proves both PIDs are gone before cleanup; Windows retains the direct-child fallback.
5. Draft and layer purge guards now include the same table-owner predicate as the binding guard. Static tests lock every conjunct. UTF-8 real PostgreSQL executes owner-context nested layer and binding attacks with forged marker and live parent, proves both rows remain, and then proves the legal service parent cascade.

## Final security review closure

1. A normal group-leader close now probes the immutable PGID captured at spawn. If descendants remain, the lifecycle retains and polls that group until `terminateTracked()` sends `SIGTERM`, escalates to `SIGKILL`, and observes group disappearance before Supabase cleanup. A normal command with no descendants still settles promptly.
2. Negative group signaling uses only the captured detached-child PGID. The lifecycle resolves its own POSIX PGID before work, refuses equality with either the runner PID or PGID, and has an executable refusal test; Windows never uses negative signaling.
3. `lukas_drawing_draft_child_guard` is `SECURITY INVOKER`. The UTF-8 catalog assertion proves `prosecdef=false`; normal editor protection, forged direct/nested draft deletion denial, and the legitimate owner-context service cascade all pass.
4. The binding mutation lock rejects changes to exact `tg_op='DELETE'`, the AND conjunction, depth, GUC name/equality, table-owner expression, absent-parent test, and `P1C01` append-only rejection. The executable matrix separately proves binding depth-1 and depth>1-with-parent attacks leave the row intact.

## Final Editor operation-boundary review closure

The reported premise that authenticated Editors retain direct page/object mutation authority is not true in the final migration graph. P2 contract hardening explicitly revokes authenticated structural-page mutation and makes the page RPC the only authenticated structural boundary. The later issue-link migration drops authenticated object mutation policies and revokes direct object `INSERT`, `UPDATE`, and `DELETE` because object writes are revision-first operation events. Accordingly, a direct Editor page/object statement is rejected at the table privilege boundary; it does not reach the draft-child trigger's revision `SELECT ... FOR UPDATE`.

The real-PostgreSQL test now locks both sides of the binding contract against the complete migration graph:

- authenticated Editor direct page `UPDATE`/`DELETE` and object `UPDATE`/`DELETE` each fail with SQLSTATE `42501`;
- the same Editor creates, updates, and deletes a page/canvas/layer through canonical `lukas_drawing_apply_operation(..., 'mutate_structure', ...)`, with exact version and final row-count assertions;
- the same Editor adds, updates, and soft-deletes an object through canonical `add_objects`, `update_objects`, and `delete_objects`, with exact result-version, actor, name, status, and persisted-version assertions;
- catalog checks prove authenticated has no direct page/object `INSERT,UPDATE,DELETE` privilege;
- `lukas_drawing_draft_child_guard` remains `SECURITY INVOKER`; no grant, RLS policy, guard, purge predicate, or migration changed. The existing forged GUC/depth attacks and legitimate service parent cascade continue to run in the same executable matrix.

## Strict TDD record

### Harness/security RED → GREEN

- RED: no exported status preflight; a fabricated marker/config could not be distinguished from another loopback stack.
- RED: recursive child symlinks were accepted by cleanup validation.
- RED: lifecycle helpers did not preserve interrupt exit identity or make repeated signals idempotent.
- RED: appended generated config drift was accepted.
- RED in the second round: the process-tree test failed because `waitForTermination` did not exist and the immediate-PID lifecycle could not prove a surviving grandchild was gone.
- RED in the final security round: a normally exiting detached leader made `runChildProcess` resolve while the `SIGTERM`-ignoring grandchild survived, and the requested `terminateTracked()` lifecycle operation did not exist. A second RED required the lifecycle to reject its own POSIX process group.
- GREEN: the final harness retains and reaps the independently surviving group, proves a no-descendant command settles promptly, refuses its own PGID, preserves the earlier signal/tree cases, and passes inside the final post-commit focused union of 155/155.

### Measurable primitives RED → GREEN

- RED: server evidence returned no primitive object IDs and primitive SSR had no exact labeled quantity rows/buttons.
- GREEN: exact 5 m line, closed polyline/rectangle area, circle/count, arc/primitive rendering, confirmation controls, bounds, and unchanged semantic schedule exclusion pass.

### BOQ focus RED → GREEN

- RED: `<tr autoFocus>` did not establish reliable focus and an effect depended on the whole result object.
- GREEN: only the server-validated selected row receives an imperative focus; source lock and component test pass with primitive dependencies.

### Purge authority RED → GREEN

- The earlier Task 8 real-PG run exposed the legitimate service purge being rejected by child editor capability. The additive migration fixed only the exact nested cascade.
- New RED attacks proved a forged GUC/depth condition must not be sufficient. Final UTF-8 real PG passed 1/1 with all attacks and legal cascade.
- Final RED: the draft guard's table-owner predicate was caller-vacuous under `SECURITY DEFINER`, the executable matrix had no draft/page nested counterexample, and the binding static test did not mutation-lock its complete conjunction. GREEN: `SECURITY INVOKER`, catalog `prosecdef=false`, direct/nested page attacks with exact residue, legal cascade, and every binding mutation all pass.
- A post-commit diagnostic invocation without `--encoding=UTF8` created SQL_ASCII and failed the Korean fixture before the authority matrix. It exited 1, stopped, and removed its root. The corrected UTF-8 command is separately recorded as PASS; the first is not counted as authority.

### Editor operation-only boundary RED → GREEN

- RED: a new full-migration real-PG check initially encoded the review premise by expecting authenticated direct object mutation to succeed. It exited 1 with SQLSTATE `42501`, `permission denied for table lukas_drawing_objects`. Migration inspection showed this was the intended operation-only table privilege boundary, not a revision-row-lock regression. The review's direct-page premise is likewise superseded by the P2 RPC-only contract.
- The test was corrected to the binding contract: direct authenticated Editor page/object writes must fail, while canonical authenticated Editor operation RPCs must mutate both structures and objects successfully. An intermediate test-only expectation treated the soft-delete result version as `3`; actual operation output deliberately reports `null` for a deleted object, so the assertion was corrected while persisted row version `3` remains independently checked.
- GREEN: the pre-commit UTF-8 isolated PostgreSQL run passed 1/1. After clean behavior commit `00d55985f236aa9d36acbe73c52a4e43531f8c5a`, the authoritative rerun again passed 1/1. No production SQL or privilege was changed.

### Second-round contract RED → GREEN

- RED: fixture mutation tests found no real component-free `M1-C-001` line, no creator-authorized exact cleanup, and no Estimator session authentication. GREEN: the fixture now proves all three and the spec proves the negative row disappears without changing W/F/D.
- RED: the E2E contract still required Viewer HTTP 403 and exposed no selected-object ID/real viewport transition proof. GREEN: it locks zero-row PostgREST RLS plus admin immutability and exact zoom/pan/ID/name transitions.
- RED: draft/layer static guards lacked the table-owner predicate, and the executable matrix had no nested binding counterexample. GREEN: focused static tests and the corrected UTF-8 real-PG run pass.
- RED: the selection RAF contract did not target a precomputed production point. GREEN: only the real mouse click is inside the selection measurement window, followed by exact intended ID/name assertions.

### Browser journey

The spec/config/fixture typecheck and static contracts are GREEN. Canonical browser RED/GREEN cannot be claimed because the disposable stack never started. Every unrun browser condition is `UNEXECUTED`.

## Prior final-security post-commit command evidence

Exact command/timestamp/exit/artifact rows are in `docs/superpowers/evidence/2026-08-31-universal-workspace-m1.md`. Summary for behavior SHA `f60998d5b430427817f8e8ec2ae8d2c1f787172d`:

- `PASS`: focused union 155/155, including all lifecycle and exact guard mutation tests; app and collaboration typechecks; production app and collaboration builds.
- `PASS`: corrected UTF-8 isolated real PostgreSQL 1/1; catalog/attack/legal-cascade assertions executed, and exact cluster stopped/removed with its port closed.
- `UNEXECUTED`: canonical M1 command exit 1 before build/fixture/browser because no container engine. The new recovery root `/private/var/folders/b_/z50hcv3524lc6wsbcqncd2q40000gn/T/1hk-m1-supabase-byEPd5` was intentionally retained; its exact marker/config validates and its API/DB ports are closed. Two previously disclosed recovery roots also remain.
- `NOT MET`: full drawing suite exit 1; 1,065 total / 1,056 pass / 7 skip / 2 fail. The only failures are committed legacy P7 evidence SHA `6bf871c...` versus tested code SHA `f60998d...`. No evidence was hand-edited.
- `PASS`: scoped Prettier on all format-managed final-round files, `git diff --check`, generated P6 evidence restoration, and Playwright/Vite scratch removal.

The previously accepted P0–P5/P7 browser and P7 performance results were produced on behavior SHA `819e88fd6d533e63a769d9f37d04b1268ab6543b`. The final security-only delta did not touch those product/browser surfaces, but those commands were not re-labeled as executions on `f60998d`.

## Latest Editor-boundary post-commit evidence

Every command in this subsection ran against clean behavior SHA `00d55985f236aa9d36acbe73c52a4e43531f8c5a`; the evidence-only change did not exist yet.

- `PASS` at 2026-09-01T11:54:09–11:54:10+0900: focused database/retention/M1 database/release-harness/start union, exit 0, 53/53.
- `PASS` at 2026-09-01T11:54:28–11:54:30+0900: UTF-8 isolated real PostgreSQL, exit 0, 1/1. It replayed the full migration graph; exercised exact Editor direct denials and canonical page/object operation success plus the existing invoker/forgery/cascade matrix; stopped loopback port 59459; and removed `/private/tmp/1hk-m1-real-pg-00d5598.nNr60B`. Independent checks reported `root_absent=true` and `port_closed=true`.
- `PASS` at 2026-09-01T11:54:36–11:54:46+0900: app and collaboration typechecks, both exit 0.
- `PASS` at 2026-09-01T11:54:50–11:55:06+0900: production app and collaboration builds, both exit 0.
- `NOT MET` at 2026-09-01T11:55:13–11:55:53+0900: full drawing suite, exit 1; 1,065 total / 1,056 pass / 7 skip / 2 fail. Both failures are the pre-existing P7 evidence SHA checks (`6bf871cc6d5985529fa82f8e673dc65749c33ae6` versus `00d55985f236aa9d36acbe73c52a4e43531f8c5a`); no new product, database, security, or harness failure appeared. The generated P6 evidence file was restored exactly.
- `PASS` at 2026-09-01T11:58:36–11:58:37+0900: exact focused union rerun from its required `platform/` cwd, exit 0, 50 pass / 1 environment-gated real-PG skip. A preceding non-authoritative invocation from the repository root at 11:58:26 exited 1 because two harness children require `platform/` cwd; it is disclosed and is not used as a gate result.
- `PASS`: `git show --check 00d55985f236aa9d36acbe73c52a4e43531f8c5a`; the only behavior file in this final review is the established compact `.mjs` real-PG test, outside the package's format-managed app glob.

Runtime inventory at 2026-09-01T11:55:59+0900 again found Docker, Podman, Colima, OrbStack, and Finch absent. Canonical disposable Supabase/browser/collaboration/visual/M1 10k remains `UNEXECUTED`; the standalone PostgreSQL result is not substituted for it.

## Performance and visual evidence

Canonical M1 raw 10k, 1440×900, 1024×768, console/network, source before/after, and production Hocuspocus/outbox attachments: absent, `UNEXECUTED`.

Earlier accepted P7 local run `ac29beda-af96-4b58-8bf8-3b0604216fae` on `819e88f` is `PASS` only for legacy regression: 10,000 authoritative / 2,384 projected / 2,382 accessible, cold 2307.899999976158 ms, first usable 1707.7000000476837 ms, p95 zoom/pan/selection 0.1000000238 / 0.2000000477 / 7.6000000238 ms. Targets were not lowered. Raw generated artifacts were inspected, recorded in release evidence, and restored.

## Ponytail review

The first audit found duplicated recursive symlink traversal in the runner; one shared exact traversal replaced both copies. The second audit found an unused RAF label written, returned, and discarded even though the evidence object already labels the zoom/pan/selection keys; that round-trip was deleted. The process-group lifecycle and explicit serial journey remain because group termination, actor order, exact IDs/hashes, retained protected state, and raw attachments are authority contracts. No additional wrapper/state store/dead branch could be safely removed.

## React best-practices review

The BOQ focus effect originally depended on the whole loader result. It now depends on `focusedLineId` and a primitive rendered-row boolean. The second-round canvas change is one direct render-time attribute derived from the already-selected object; it adds no effect, fetch, context, dependency, or duplicated state. Modified components preserve native labels and add no client amount authority. Focused tests, typecheck, and production build passed.

## Cleanup and blockers

- Post-commit PostgreSQL root `/private/tmp/1hk-m1-real-pg-00d5598.nNr60B` on loopback port 59459 was stopped and removed; root absence and closed port were independently verified.
- Post-commit PostgreSQL root `/private/tmp/1hk-m1-real-pg-f60998d.GOxeAa` on loopback port 57822 was stopped and removed; root absence and closed port were independently verified.
- Final whole-branch PostgreSQL root `/private/tmp/1hk-m1-real-pg-729f07d.J072KQ` on loopback port 63388 was stopped and removed; root absence and closed port were independently verified.
- Latest Supabase recovery root `/private/var/folders/b_/z50hcv3524lc6wsbcqncd2q40000gn/T/1hk-m1-supabase-yXX21z` is retained for project `1hk-m1-fd97ecea` because start/stop lacked a container engine. Exact cleanup-target validation passes and API/DB ports 51074/51075 are closed.
- New Supabase recovery root `/private/var/folders/b_/z50hcv3524lc6wsbcqncd2q40000gn/T/1hk-m1-supabase-byEPd5` is retained because start and stop lacked a container engine. Exact cleanup-target validation passed for project `1hk-m1-a9fe0b64`, API port 52549, and DB port 52550; both ports are closed. Previously disclosed roots `.../1hk-m1-supabase-VvWi6t` (`1hk-m1-9cb85afd`, 53965/53966) and `.../1hk-m1-supabase-cqxuKX` (`1hk-m1-b19ec770`, 54543/54544) also remain. Deleting them after failed starts/stops would violate the approved recovery rule.
- The exact blocker is a missing supported container runtime. Install/start one and rerun `npm run test:e2e:drawing-workspace-m1:local` unchanged.

## Commit identity

- Original Task 8 implementation: `4a7c68960315b60a693456d55c2bcb937b53a2fb` (`test: prove universal estimator workspace M1`).
- First hardening behavior SHA: `21765f53a171992a9837bbcddbc0ac07244cb91d` (`fix: harden M1 acceptance authority`).
- Second-round code/tests/harness behavior SHA: `819e88fd6d533e63a769d9f37d04b1268ab6543b` (`fix: close M1 authority proof gaps`).
- Final security behavior SHA: `f60998d5b430427817f8e8ec2ae8d2c1f787172d` (`fix: reap M1 process groups safely`).
- Final Editor-boundary test behavior SHA: `00d55985f236aa9d36acbe73c52a4e43531f8c5a` (`test: prove M1 operation-only editor authority`).
- Final whole-branch behavior SHA: `729f07d96c33902a8f3f4f551863af75383af5b9` (`fix: close universal workspace review findings`).
- Prior evidence-only subject: `docs: finalize M1 security evidence`; its Git SHA is intentionally not presented as a behavior SHA.
- Latest evidence-only subject: `docs: correct M1 editor authority evidence`; its Git SHA is intentionally not presented as the behavior SHA.
- Current evidence-only subject: `docs: finalize universal workspace branch evidence`; its eventual Git SHA is documentation identity, not the tested behavior SHA.

## Final whole-branch review closure

### Functional findings and strict TDD

The final wave began at `00af54549cde643fb3689d4c9d0a23beac244726`. Each functional contract was first added against that HEAD and run in its focused Node test before production code changed:

- RED: the canonical Viewer rail rendered `단가표 가져오기`; GREEN: the mutation entry is inside the existing server-derived `mayBind` boundary while BOQ detail and download remain readable.
- RED: a successful two-operation flush returned `undefined` rather than the expected durable acknowledgement count `2`; a retry callback separately expected `[1]` and received `[]`. GREEN: `flush()` counts only persisted acknowledgements and one optional batch callback drives a stable React Router revalidation after both immediate and scheduled successful flushes. Conflict, retry, disposal, concurrency, and failed-mark behavior remain unchanged.
- RED: the M1 static journey asserted `확정` before BOQ approval and had no draft/assumption phase. GREEN: pre-approval W/D evidence is `초안`, F evidence is `가정값`, and `확정` is asserted only after BOQ approval followed by canonical workspace navigation.
- RED: read-only drawing-list, project-root, dashboard, and organization-library tests found `/workspaces/new` creation traps. GREEN: every create affordance uses the existing loader-derived admin/editor capability; read-only cards navigate to project/drawing/file views, while server action and database authority remain unchanged.
- RED: the canonical loader had no independent-I/O parallel group and loaded unused estimate options for non-binding roles. GREEN: once workspace identity is known, estimate summary and conditional options, source bundle, measurements, activity, room, and assignees begin in one `Promise.all`; only `mayBind` actors load binding options.
- RED: property selection still used an effect/helper and allowed the prior evidence kind or validation error to survive owner changes. GREEN: a keyed inner field owner resets value, evidence kind, dirty state, and error together without synchronization effects.

The final focused union command was:

`node --test tests/drawing-workspace-shell.test.mjs tests/drawing-workspace-outbox.test.mjs tests/drawing-workspace-e2e-contract.test.mjs tests/drawing-workspace-entry-flow.test.mjs tests/drawing-workspace-p7-library-route.test.mjs tests/drawing-workspace-route.test.mjs tests/drawing-workspace-properties.test.mjs tests/drawing-workspace-server.test.mjs tests/drawing-workspace-p5-server.test.mjs tests/drawing-workspace-p7-export-audit.test.mjs`

It passed 268/268 before the behavior commit and again against clean `729f07d96c33902a8f3f4f551863af75383af5b9`.

### Ponytail deletion audit

Production-caller `rg` checks were run before deletion. The final production/E2E delta is 681 added and 782 deleted lines, net -101 despite the six functional fixes. All requested dead compatibility surfaces were removed:

- A/B: `DrawingWorkspacePreCreation`, the string loader overload, pre-creation null guards/tests, and the canonical null-document creation fallback.
- C: the unreachable route `create_document` schema/parser/handler/form mode and branch-only tests. The legacy database RPC and its migration/runtime coverage remain intentionally intact.
- D: nullable removed-file-route `workspaceId`/`fileId` export fallbacks; canonical export scope now requires the workspace ID.
- E: self-only `drawingEstimateBindingErrorResponse`.
- F: equality-only `drawingWorkspaceStartChoiceFocused`; the comparison is inline.
- G: dead file/project workspace entry builders and their self-tests.
- H: the one-caller `drawingWorkspaceOperationPath`; its behavior is inline in `drawingWorkspaceOperationLocation` and the preview/canonical path test remains.
- I: zero-caller `legacyProjectWorkspacePath`.

Post-deletion `rg` finds none of the named wrappers/types/legacy paths. The only remaining `create_document` matches are the explicitly retained database RPC/type/migration and legacy database/browser fixture callers, not the deleted route action. Ponytail review result: **Lean already. Ship.** No further safe cut was identified.

### React review

The final React checklist found no remaining corrective item. Loader work is parallel after the necessary identity dependency, read-only actors skip unused options, the revalidation callback uses a stable ref and is triggered only by durable acknowledgement batches, field-local state is keyed rather than synchronized by an effect, and all role-gated controls retain native accessible links/buttons. No client monetary calculation, new context/store, dependency, or test-only production mode was introduced.

### Post-commit verification for `729f07d96c33902a8f3f4f551863af75383af5b9`

| KST start–end                     | Command                                                                             | Exit/result                                                                                | Artifact or residue                                                                                       | Status       |
| --------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- | ------------ |
| 2026-09-01T13:02:08–13:02:15+0900 | final focused 10-file Node union                                                    | exit 0; 268 passed, 0 failed                                                               | functional, entry, loader, outbox, E2E static, properties, export, and Ponytail contracts                 | `PASS`       |
| 2026-09-01T13:03:35–13:03:44+0900 | `npm run typecheck`; `npm run typecheck:collaboration`                              | both exit 0                                                                                | React Router typegen and both TypeScript graphs                                                           | `PASS`       |
| 2026-09-01T13:03:48–13:04:04+0900 | `npm run build`; `npm run build:collaboration`                                      | both exit 0                                                                                | approved production client/SSR `build/` and collaboration `dist/`                                         | `PASS`       |
| 2026-09-01T13:04:30–13:04:31+0900 | UTF-8 `mktemp` PostgreSQL plus required M1 real-database test                       | exit 0; 1 passed; full migration, operation boundary, guard attacks, and legal cascade ran | root `/private/tmp/1hk-m1-real-pg-729f07d.J072KQ`, port 63388; stopped, removed, root absent, port closed | `PASS`       |
| 2026-09-01T13:04:56–13:04:59+0900 | `npm run test:e2e:drawing-workspace-m1:local`                                       | exit 1 before build/fixture/browser; Docker and Podman unavailable                         | recovery root `.../1hk-m1-supabase-yXX21z` intentionally retained                                         | `UNEXECUTED` |
| 2026-09-01T13:05:49–13:06:26+0900 | `npm run test:drawing-workspace`                                                    | exit 1; 1,065 total / 1,056 pass / 7 skip / 2 fail                                         | exactly the two legacy P7 SHA checks; generated P6 evidence restored                                      | `NOT MET`    |
| 2026-09-01T13:08:10–13:08:11+0900 | scoped package Prettier check plus `git diff --check` and clean-tree assertion      | exit 0; all 28 behavior files match package formatting; clean                              | Playwright reports/results and `node_modules/.vite` scratch removed                                       | `PASS`       |
| 2026-09-01T13:09:34+0900          | `git show --check 729f07d96c33902a8f3f4f551863af75383af5b9`; clean status assertion | exit 0                                                                                     | exact tested behavior commit                                                                              | `PASS`       |

The full-suite failures are only committed P7 evidence SHA `6bf871cc6d5985529fa82f8e673dc65749c33ae6` versus tested behavior SHA `729f07d96c33902a8f3f4f551863af75383af5b9`. No P7 file was hand-edited. Earlier accepted P0–P5/P7 browser results remain tied to `819e88fd6d533e63a769d9f37d04b1268ab6543b` and are not relabeled as executions on this commit.

The canonical runner created project `1hk-m1-fd97ecea` at `/private/var/folders/b_/z50hcv3524lc6wsbcqncd2q40000gn/T/1hk-m1-supabase-yXX21z` with API/DB ports 51074/51075. `supabase status` independently reported `docker: command not found (podman also not found)`. Exact cleanup-target validation passes and both ports are closed. Because start/stop could not complete, the recovery root remains by design and was not deleted. The three earlier disclosed recovery roots also remain.

Canonical disposable Supabase, browser acceptance 1–16, production Hocuspocus/outbox, visual widths/logs/screenshots, source before/after hashes, and canonical M1 10k performance remain `UNEXECUTED`. Standalone PostgreSQL and legacy P7 are not substitutes. The required next action is still to install/start a supported container runtime and rerun the unchanged canonical M1 command.
