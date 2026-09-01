# Task 8 report — M1 acceptance authority hardening

## Outcome

Task 8 now contains a fail-closed disposable-Supabase controller, status-bound Playwright preflight, signal/partial-failure-safe cleanup, exact estimator journey assertions, measurable primitive quantity UI, server-validated BOQ reverse focus, and executable real-PostgreSQL purge attacks.

The tested behavior commit is `21765f53a171992a9837bbcddbc0ac07244cb91d` (`fix: harden M1 acceptance authority`). Every final command was run after that clean commit existed and before this report/evidence-only change. The later documentation-only commit does not become the behavior SHA.

M1 remains **UNEXECUTED**, not complete. Docker, Podman, Colima, OrbStack, and Finch are absent, so disposable Supabase never started and the canonical browser, Hocuspocus, visual, source-integrity, and M1 10k gates did not run. No local preview, P7 result, static test, or standalone PostgreSQL run is presented as replacement authority.

## Files and interfaces

### Disposable authority and lifecycle

- `platform/scripts/run-drawing-workspace-m1-e2e.mjs` and `.d.mts`
  - Export exact authority/status/config/cleanup/lifecycle helpers for mutation tests.
  - Create only a canonical OS-temp `mkdtemp` project, with generated marker, project ID, copied migrations/config, and free loopback ports.
  - Capture and sanitize sensitive Supabase start/status/stop output; spawn without a shell.
  - Track children and SIGINT/SIGTERM; terminate children before owned cleanup and preserve 130/143 identity.
  - Validate canonical containment, marker, project/config equality, and recursive `lstat`; reject child symlinks.
  - Preserve the root/config when `supabase stop` fails. Remove an exact empty/partial owned root only before a start attempt.
- `platform/playwright.m1.config.ts`
  - At config import, calls `supabase status --workdir <exact-root> -o json` and matches API URL, DB URL, anon key, service key, API/DB ports, marker, project ID, and exact generated config before fixture writes.
  - Keeps production `npm run start`, production collaboration, fixed loopback endpoints, one worker, and no dev/preview route.
- `platform/tests/drawing-workspace-m1-release-harness.test.mjs`
  - Covers mismatched/fake status, appended config drift, direct invocation, repository-root refusal, symlink children, stop failure recovery, partial start, signal termination/idempotence, interrupt exit identity, and secret redaction.

Production `platform/build/`, `platform/collaboration/dist/`, and typegen output remain the approved build architecture. Only the Supabase authority is `mkdtemp`-isolated.

### Estimator and canonical journey

- `platform/e2e/utils/drawing-estimator-fixture.ts`
  - Exact rate CSV/SHA, same-organization truly empty project, normalized Estimator/Reviewer/Approver/Viewer roles, immutable rate evidence, non-parseable RVT sentinel, and post-browser BOQ structure seeding.
  - Returns exact price-book/resource/component/line/section IDs for row-scoped and denial assertions.
- `platform/e2e/drawing-workspace-m1-estimator.spec.ts`
  - Uses `getByLabel(...).toHaveValue` for evidence reason.
  - Creates/persists all seven classes: floor, wall, ceiling, door, window, furniture, demolition.
  - Selects exact labeled length/area/count rows and confirmation buttons; visible PDF calibration asserts `5 m`.
  - Proves W/F/D quantities, units, server rates/amounts, evidence/review state, exact total, exact manifest IDs/hashes, and a real missing-rate/evidence negative row before cleanup/approval.
  - Viewer denials use real same-project BOQ version/line/section and price-book IDs across UI/API/database, plus drawing/binding denial.
  - Browser B reads moved geometry from the production inspector.
  - Performance timing begins immediately before canonical `goto` after auth setup; targets the descendant Konva Stage for real pointer zoom, pan, and selection; attaches raw RAF samples before fail-closed targets.
  - Installs page/context console/network listeners before first navigation and proves Tab focus order for blank/starter/PDF cards at 1440×900 and 1024×768.

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

The additive migration permits a drawing child bypass only when `DELETE`, trigger depth >1, exact purge-project GUC, table-owner current user, and absent parent all hold. Execute remains revoked from public/Data API/service roles. The real matrix attacks forged marker at depth 1, forged direct layer deletion, and a test-only depth>1 nested deletion while the parent exists; it also proves residue remains after attacks and a legitimate service parent cascade succeeds. No applied migration was rewritten and no retention interval/hold/dependency was weakened.

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

## Strict TDD record

### Harness/security RED → GREEN

- RED: no exported status preflight; a fabricated marker/config could not be distinguished from another loopback stack.
- RED: recursive child symlinks were accepted by cleanup validation.
- RED: lifecycle helpers did not preserve interrupt exit identity or make repeated signals idempotent.
- RED: appended generated config drift was accepted.
- GREEN: harness 12/12, including two real direct-Playwright refusal subprocesses. The final focused union passed 163/163.

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

### Browser journey

The spec/config/fixture typecheck and static contracts are GREEN. Canonical browser RED/GREEN cannot be claimed because the disposable stack never started. Every unrun browser condition is `UNEXECUTED`.

## Post-commit command evidence

Exact command/timestamp/exit/artifact rows are in `docs/superpowers/evidence/2026-08-31-universal-workspace-m1.md`. Summary for behavior SHA `21765f53a171992a9837bbcddbc0ac07244cb91d`:

- `PASS`: focused union 163/163; app and collaboration typechecks; production app and collaboration builds.
- `PASS`: corrected UTF-8 isolated real PostgreSQL 1/1; exact cluster stopped/removed, no residue.
- `UNEXECUTED`: canonical M1 command exit 1 before build/fixture/browser because no container engine. Stop also failed, so recovery root `/private/var/folders/b_/z50hcv3524lc6wsbcqncd2q40000gn/T/1hk-m1-supabase-cqxuKX` was intentionally retained with valid marker/config and no symlink.
- `PASS`: P0–P2 4/4, P3 1/1, P4 14/14, P5 13/13, P7 release 3/3, P7 local performance 3/3.
- `NOT MET`: full drawing suite exit 1; 1,059 total / 1,050 pass / 7 skip / 2 fail. The only failures are committed legacy P7 evidence SHA `6bf871c...` versus tested code SHA `21765f5...`. No evidence was hand-edited.
- `PASS`: scoped Prettier and diff checks. Generated P4/P5/P6/P7 artifacts were restored; Playwright scratch was removed.

## Performance and visual evidence

Canonical M1 raw 10k, 1440×900, 1024×768, console/network, source before/after, and production Hocuspocus/outbox attachments: absent, `UNEXECUTED`.

Separate P7 local run `fd2fae69-7089-4d46-9170-e4ddc12ded0d` is `PASS` only for legacy regression: 10,000 authoritative / 2,384 projected / 2,382 accessible, cold 2346.5 ms, first usable 1759.3999999761581 ms, p95 zoom/pan/selection 0.2000000477 / 0.2999999523 / 7.7000000477 ms. Targets were not lowered. Raw generated artifacts were inspected, recorded in release evidence, and restored.

## Ponytail review

The audit found duplicated recursive symlink traversal in the runner. One shared exact traversal replaced both copies (about ten lines removed), and the harness was rerun. The serial journey remains intentionally explicit because actor order, exact IDs/hashes, retained protected state, and raw attachments are authority contracts. No additional wrapper/state store/dead branch could be safely removed.

## React best-practices review

The BOQ focus effect originally depended on the whole loader result. It now depends on `focusedLineId` and a primitive rendered-row boolean. Modified inspector components keep derived values in render, add no client fetch waterfall/context, preserve native labels, and add no dependency or client amount authority. Focused tests, typecheck, and production build passed after the change.

## Cleanup and blockers

- PostgreSQL roots `/private/tmp/1hk-m1-real-pg-21765f5.NqxFsx` and `/private/tmp/1hk-m1-real-pg-21765f5-utf8.bUIXQV` were stopped and removed; no matching residue remains.
- Supabase recovery root is retained because start and stop both lacked a container engine. Marker project `1hk-m1-b19ec770`, config project, API port 54543, DB port 54544, and symlink-free containment were verified. Deleting it after stop failure would violate the approved recovery rule.
- The exact blocker is a missing supported container runtime. Install/start one and rerun `npm run test:e2e:drawing-workspace-m1:local` unchanged.

## Commit identity

- Original Task 8 implementation: `4a7c68960315b60a693456d55c2bcb937b53a2fb` (`test: prove universal estimator workspace M1`).
- Final code/tests/harness behavior SHA: `21765f53a171992a9837bbcddbc0ac07244cb91d` (`fix: harden M1 acceptance authority`).
- Evidence-only subject: `docs: record M1 acceptance verification`; its Git SHA is intentionally not presented as the behavior SHA.
