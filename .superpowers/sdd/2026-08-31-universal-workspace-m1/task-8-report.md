# Task 8 report — M1 acceptance authority hardening

## Outcome

Task 8 now contains a fail-closed disposable-Supabase controller, status-bound Playwright preflight, process-group and partial-failure-safe cleanup, exact estimator journey assertions, measurable primitive quantity UI, server-validated BOQ reverse focus, and executable real-PostgreSQL purge attacks.

The tested behavior commit is `819e88fd6d533e63a769d9f37d04b1268ab6543b` (`fix: close M1 authority proof gaps`). Every final command was run after that clean commit existed and before this report/evidence-only change. The later documentation-only commit does not become the behavior SHA.

M1 remains **UNEXECUTED**, not complete. Docker, Podman, Colima, OrbStack, and Finch are absent, so disposable Supabase never started and the canonical browser, Hocuspocus, visual, source-integrity, and M1 10k gates did not run. No local preview, P7 result, static test, or standalone PostgreSQL run is presented as replacement authority.

## Files and interfaces

### Disposable authority and lifecycle

- `platform/scripts/run-drawing-workspace-m1-e2e.mjs` and `.d.mts`
  - Export exact authority/status/config/cleanup/lifecycle helpers for mutation tests.
  - Create only a canonical OS-temp `mkdtemp` project, with generated marker, project ID, copied migrations/config, and free loopback ports.
  - Capture and sanitize sensitive Supabase start/status/stop output; spawn without a shell.
  - Start long-running POSIX children in isolated process groups, terminate and escalate the entire group before owned cleanup, retain a Windows child-process fallback, and preserve 130/143 identity.
  - Validate canonical containment, marker, project/config equality, and recursive `lstat`; reject child symlinks.
  - Preserve the root/config when `supabase stop` fails. Remove an exact empty/partial owned root only before a start attempt.
- `platform/playwright.m1.config.ts`
  - At config import, calls `supabase status --workdir <exact-root> -o json` and matches API URL, DB URL, anon key, service key, API/DB ports, marker, project ID, and exact generated config before fixture writes.
  - Keeps production `npm run start`, production collaboration, fixed loopback endpoints, one worker, and no dev/preview route.
- `platform/tests/drawing-workspace-m1-release-harness.test.mjs`
  - Covers mismatched/fake status, appended config drift, direct invocation, repository-root refusal, symlink children, stop failure recovery, partial start, signal termination/idempotence, interrupt exit identity, secret redaction, and a real POSIX parent/grandchild tree whose grandchild ignores `SIGTERM` and is killed before cleanup.

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

The additive migration permits each draft/layer/binding child bypass only when `DELETE`, trigger depth >1, exact purge-project GUC, table-owner current user, and absent parent all hold. Execute remains revoked from public/Data API/service roles. The real matrix verifies owner context, attacks a forged binding marker at depth 1, a forged direct layer deletion, and test-only nested layer and binding deletes at depth >1 while the parent exists; it proves the layer, binding, and project all remain before a legitimate service parent cascade succeeds. No applied migration was rewritten and no retention interval/hold/dependency was weakened.

### Existing bounded Task 8 product/legacy work retained

The preceding Task 8 unit already contains the exact empty-project `새 작업실` entry, fixed preview-versus-canonical operation selection, exact `내역으로 돌아가기` helper, P0–P5/P7 selector compatibility, and two-frame P7 projection optimization. This hardening did not roll those changes back or broaden them.

### Evidence

- `docs/superpowers/evidence/2026-08-31-universal-workspace-m1.md`
- `.superpowers/sdd/2026-08-31-universal-workspace-m1/task-8-report.md`

These are the only files changed by the evidence-only commit.

## Independent review closure

1. Direct Playwright can no longer self-author a root and target another loopback stack: exact `supabase status` values/keys/ports/config are verified before fixture writes.
2. SIGINT/SIGTERM, tracked-child termination, partial start, stop failure, and symlink-child cases are covered; recovery metadata survives a failed stop.
3. Supabase CLI secrets/DB URLs are captured, bounded, and sanitized rather than streamed.
4. Existing `build/` and collaboration `dist/` remain intentional; no alternate build architecture was invented.
5. Real PG adds forged depth-1 GUC and depth>1-with-parent attacks, while legitimate service cascade still passes.
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

## Strict TDD record

### Harness/security RED → GREEN

- RED: no exported status preflight; a fabricated marker/config could not be distinguished from another loopback stack.
- RED: recursive child symlinks were accepted by cleanup validation.
- RED: lifecycle helpers did not preserve interrupt exit identity or make repeated signals idempotent.
- RED: appended generated config drift was accepted.
- RED in the second round: the process-tree test failed because `waitForTermination` did not exist and the immediate-PID lifecycle could not prove a surviving grandchild was gone.
- GREEN: harness 13/13, including two real direct-Playwright refusal subprocesses and the real parent/grandchild process group. The final post-commit focused union passed 151/151.

### Measurable primitives RED → GREEN

- RED: server evidence returned no primitive object IDs and primitive SSR had no exact labeled quantity rows/buttons.
- GREEN: exact 5 m line, closed polyline/rectangle area, circle/count, arc/primitive rendering, confirmation controls, bounds, and unchanged semantic schedule exclusion pass.

### BOQ focus RED → GREEN

- RED: `<tr autoFocus>` did not establish reliable focus and an effect depended on the whole result object.
- GREEN: only the server-validated selected row receives an imperative focus; source lock and component test pass with primitive dependencies.

### Purge authority RED → GREEN

- The earlier Task 8 real-PG run exposed the legitimate service purge being rejected by child editor capability. The additive migration fixed only the exact nested cascade.
- New RED attacks proved a forged GUC/depth condition must not be sufficient. Final UTF-8 real PG passed 1/1 with all attacks and legal cascade.
- A post-commit diagnostic invocation without `--encoding=UTF8` created SQL_ASCII and failed the Korean fixture before the authority matrix. It exited 1, stopped, and removed its root. The corrected UTF-8 command is separately recorded as PASS; the first is not counted as authority.

### Second-round contract RED → GREEN

- RED: fixture mutation tests found no real component-free `M1-C-001` line, no creator-authorized exact cleanup, and no Estimator session authentication. GREEN: the fixture now proves all three and the spec proves the negative row disappears without changing W/F/D.
- RED: the E2E contract still required Viewer HTTP 403 and exposed no selected-object ID/real viewport transition proof. GREEN: it locks zero-row PostgREST RLS plus admin immutability and exact zoom/pan/ID/name transitions.
- RED: draft/layer static guards lacked the table-owner predicate, and the executable matrix had no nested binding counterexample. GREEN: focused static tests and the corrected UTF-8 real-PG run pass.
- RED: the selection RAF contract did not target a precomputed production point. GREEN: only the real mouse click is inside the selection measurement window, followed by exact intended ID/name assertions.

### Browser journey

The spec/config/fixture typecheck and static contracts are GREEN. Canonical browser RED/GREEN cannot be claimed because the disposable stack never started. Every unrun browser condition is `UNEXECUTED`.

## Post-commit command evidence

Exact command/timestamp/exit/artifact rows are in `docs/superpowers/evidence/2026-08-31-universal-workspace-m1.md`. Summary for behavior SHA `819e88fd6d533e63a769d9f37d04b1268ab6543b`:

- `PASS`: focused union 151/151; app and collaboration typechecks; production app and collaboration builds.
- `PASS`: corrected UTF-8 isolated real PostgreSQL 1/1; exact cluster stopped/removed, no residue.
- `UNEXECUTED`: canonical M1 command exit 1 before build/fixture/browser because no container engine. Stop also failed, so the new recovery root `/private/var/folders/b_/z50hcv3524lc6wsbcqncd2q40000gn/T/1hk-m1-supabase-VvWi6t` was intentionally retained with valid marker/config and no symlink; the prior disclosed recovery root also remains.
- `PASS`: P0–P2 4/4, P3 1/1, P4 14/14, P5 13/13, P7 release 3/3, P7 local performance 3/3.
- `NOT MET`: full drawing suite exit 1; 1,061 total / 1,052 pass / 7 skip / 2 fail. The only failures are committed legacy P7 evidence SHA `6bf871c...` versus tested code SHA `819e88f...`. No evidence was hand-edited.
- `PASS`: scoped Prettier on format-managed changed files and diff checks. One broader check is separately `NOT MET` because the intentionally compact legacy real-PG executable is not repository-Prettier-clean; no formatting churn was introduced. Generated P4/P5/P6/P7 artifacts were restored and Playwright/Vite scratch was removed.

## Performance and visual evidence

Canonical M1 raw 10k, 1440×900, 1024×768, console/network, source before/after, and production Hocuspocus/outbox attachments: absent, `UNEXECUTED`.

Separate P7 local run `ac29beda-af96-4b58-8bf8-3b0604216fae` is `PASS` only for legacy regression: 10,000 authoritative / 2,384 projected / 2,382 accessible, cold 2307.899999976158 ms, first usable 1707.7000000476837 ms, p95 zoom/pan/selection 0.1000000238 / 0.2000000477 / 7.6000000238 ms. Targets were not lowered. Raw generated artifacts were inspected, recorded in release evidence, and restored.

## Ponytail review

The first audit found duplicated recursive symlink traversal in the runner; one shared exact traversal replaced both copies. The second audit found an unused RAF label written, returned, and discarded even though the evidence object already labels the zoom/pan/selection keys; that round-trip was deleted. The process-group lifecycle and explicit serial journey remain because group termination, actor order, exact IDs/hashes, retained protected state, and raw attachments are authority contracts. No additional wrapper/state store/dead branch could be safely removed.

## React best-practices review

The BOQ focus effect originally depended on the whole loader result. It now depends on `focusedLineId` and a primitive rendered-row boolean. The second-round canvas change is one direct render-time attribute derived from the already-selected object; it adds no effect, fetch, context, dependency, or duplicated state. Modified components preserve native labels and add no client amount authority. Focused tests, typecheck, and production build passed.

## Cleanup and blockers

- Post-commit PostgreSQL root `/private/tmp/1hk-m1-real-pg-819e88f.dkBUWf` on loopback port 55610 was stopped and removed; root absence and closed port were verified.
- New Supabase recovery root `/private/var/folders/b_/z50hcv3524lc6wsbcqncd2q40000gn/T/1hk-m1-supabase-VvWi6t` is retained because start and stop both lacked a container engine. Marker/config project `1hk-m1-9cb85afd`, API port 53965, DB port 53966, and symlink-free containment were verified. The earlier disclosed root `.../1hk-m1-supabase-cqxuKX` (`1hk-m1-b19ec770`, 54543/54544) also remains. Deleting either after stop failure would violate the approved recovery rule.
- The exact blocker is a missing supported container runtime. Install/start one and rerun `npm run test:e2e:drawing-workspace-m1:local` unchanged.

## Commit identity

- Original Task 8 implementation: `4a7c68960315b60a693456d55c2bcb937b53a2fb` (`test: prove universal estimator workspace M1`).
- First hardening behavior SHA: `21765f53a171992a9837bbcddbc0ac07244cb91d` (`fix: harden M1 acceptance authority`).
- Final code/tests/harness behavior SHA: `819e88fd6d533e63a769d9f37d04b1268ab6543b` (`fix: close M1 authority proof gaps`).
- Evidence-only subject: `docs: update M1 authority evidence`; its Git SHA is intentionally not presented as the behavior SHA.
