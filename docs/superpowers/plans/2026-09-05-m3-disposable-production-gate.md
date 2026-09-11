# M3 Disposable Production-Shaped Collaboration Gate Implementation Plan

> **For Codex:** REQUIRED SUB-SKILL: Use `subagent-driven-development` to implement Task 1, then use `verification-before-completion` and the Vercel deployment skills for Task 2. Preserve the dirty worktree: do not stage, commit, reset, clean, or rewrite unrelated files.

**Goal:** Make the existing authenticated P3 Gates 01–08 executable against the runner-owned disposable Supabase, production React Router build, and collaboration service; then verify the current workspace and deploy the exact verified tree to Vercel production.

**Architecture:** Keep the external production credential guard unchanged. Add a second, explicit `M1_E2E_P3_DISPOSABLE=1` authority that accepts only the runner-owned loopback topology already verified by `playwright.m1.config.ts`. The existing M1 runner chooses either its current estimator spec or the existing P3 spec through a strict profile argument, while sharing the same isolated lifecycle and cleanup. Build the Revit fixture ZIP deterministically from the repository's existing `.addin` manifest using the already-installed `fflate`; do not add a dependency, service, database migration, or product state abstraction.

**Tech Stack:** Node.js 22 ESM, TypeScript, Playwright 1.62.1, Supabase CLI/Postgres, Hocuspocus, `fflate` 0.8.3, React Router/Vite, Vercel CLI.

**Authority:** `docs/superpowers/specs/2026-08-26-drawing-workspace-p3-design.md`, especially its immutable-source, read-only-role, collaboration, freeze, and production-completion boundaries. A disposable pass proves local production-shaped composition only; externally hosted P3 credentials remain `UNEXECUTED` unless separately supplied.

---

## Task 1: Add and execute the explicit disposable P3 profile

**Files:**

- Modify: `platform/e2e/utils/drawing-collaboration-fixture.ts`
- Modify: `platform/e2e/drawing-workspace-p3.spec.ts`
- Modify: `platform/playwright.config.ts`
- Modify: `platform/playwright.m1.config.ts`
- Modify: `platform/scripts/run-drawing-workspace-m1-e2e.mjs`
- Modify only if required by TypeScript consumers: `platform/scripts/run-drawing-workspace-m1-e2e.d.mts`
- Modify: `platform/tests/drawing-workspace-p3-contract.test.mjs`
- Modify: `platform/tests/drawing-workspace-m1-release-harness.test.mjs`
- Modify: `platform/package.json`
- Create: `.superpowers/sdd/2026-09-05-m3-disposable-production-gate/task-1-report.md`

### Step 1: Preserve the dirty baseline and prove the existing tests are green

Record SHA-256 and Git blob IDs for every scoped file before editing. Because the files already contain deployed, uncommitted work, do not stage or commit them. Run:

```bash
cd platform
node --test tests/drawing-workspace-p3-contract.test.mjs tests/drawing-workspace-m1-release-harness.test.mjs
```

Expected: PASS. If it is not green, stop implementation and report the pre-existing failure.

### Step 2: Write behavioral tests for the disposable authority and profile

In `platform/tests/drawing-workspace-p3-contract.test.mjs`, add tests that require:

- `requireDrawingP3ProductionCredentials` to retain all current external-only rejection behavior, including loopback rejection.
- A new `requireDrawingP3DisposableCredentials(environment)` to return the same credential shape as the production helper only when all of these are true:
  - `M1_E2E_P3_DISPOSABLE === "1"` and `M1_E2E_DISPOSABLE === "1"`.
  - `E2E_BASE_URL === "http://127.0.0.1:4000"`.
  - `VITE_DRAWING_COLLABORATION_URL === "ws://127.0.0.1:12349"`.
  - `COLLABORATION_INTERNAL_URL === "http://127.0.0.1:12349"`.
  - `SUPABASE_URL` is loopback HTTP and both Supabase keys are concrete values of at least 32 characters.
  - `P3_E2E_DATABASE_ADMIN_URL` exactly equals `M1_REAL_POSTGRES_DATABASE_URL`, and that URL is loopback PostgreSQL.
  - Collaboration internal/freeze secrets are concrete, at least 32 characters, and different.
  - `P3_E2E_RUN_ID` satisfies the existing identity/run-ID grammar without placeholder/example/dummy/local/test-value text.
- Each missing flag, altered fixed endpoint, non-loopback database/Supabase URL, database mismatch, short/equal secret, missing key, and invalid run ID to fail closed without echoing secret values.
- `drawing-workspace-p3.spec.ts` to choose the disposable helper only under the exact flag and the production helper otherwise.
- `playwright.config.ts` to preserve its production guard unless the exact disposable flag is present.

In `platform/tests/drawing-workspace-m1-release-harness.test.mjs`, add tests for:

- Strict profile parsing: no argument means `m1`; exactly `--profile=p3` means `p3`; unknown or extra arguments throw before resources start.
- Exact Playwright arguments: default remains the existing M1 estimator spec; P3 selects only `e2e/drawing-workspace-p3.spec.ts`; both keep `--config=playwright.m1.config.ts --project=chromium --workers=1`.
- P3 runtime environment values are present only for the P3 profile and bind `P3_E2E_DATABASE_ADMIN_URL` exactly to the disposable database authority.
- The release fixture ZIP has a stable SHA-256 and contains `Lukas.Qto.addin` with bytes equal to `addin/Lukas.Qto.addin`; it must not claim a DLL exists.
- Direct or fabricated Playwright authority continues to fail before fixture writes.

Run the focused tests and confirm they fail for missing behavior, not parse/import mistakes:

```bash
cd platform
node --test tests/drawing-workspace-p3-contract.test.mjs tests/drawing-workspace-m1-release-harness.test.mjs
```

Expected: FAIL with assertions for the missing disposable helper/profile and the current empty ZIP.

### Step 3: Implement the minimum authority split

In `platform/e2e/utils/drawing-collaboration-fixture.ts`:

- Leave `DRAWING_P3_PRODUCTION_VARIABLES`, `drawingP3ProductionCredentialStatus`, and `requireDrawingP3ProductionCredentials` semantically unchanged.
- Export `requireDrawingP3DisposableCredentials(environment)` with the exact validations from Step 2 and the same normalized returned credential keys as the production helper.
- Reuse the existing actual-value and run-ID rules. Add only the smallest loopback helper required; do not create a generic credential framework.

In `platform/e2e/drawing-workspace-p3.spec.ts`:

```ts
const credentials =
  process.env.M1_E2E_P3_DISPOSABLE === "1"
    ? requireDrawingP3DisposableCredentials(process.env)
    : requireDrawingP3ProductionCredentials(process.env);
```

Keep every Gate 01–08 assertion and fixture behavior unchanged.

In `platform/playwright.config.ts`, skip the external production guard only for the exact disposable P3 flag. In `platform/playwright.m1.config.ts`, call the disposable P3 helper under that flag after the existing runner-owned Supabase authority check. This preserves two independent fail-closed boundaries.

### Step 4: Implement the minimum runner profile and deterministic ZIP

In `platform/scripts/run-drawing-workspace-m1-e2e.mjs`:

- Import `strToU8`/`zipSync` from the already-installed `fflate`.
- Read `../addin/Lukas.Qto.addin` and create a deterministic, fixed-mtime ZIP entry named `Lukas.Qto.addin`; compute the served SHA-256 from those exact ZIP bytes.
- Export a strict profile parser and a function returning the exact Playwright argument vector so unit tests can verify behavior without starting Docker.
- Parse the profile before opening ports or starting resources.
- Keep the default profile's Playwright target exactly `e2e/drawing-workspace-m1-estimator.spec.ts`.
- For `p3`, add the exact P3 disposable values to `exactRuntimeEnvironment`, including a unique valid run ID derived from runner randomness/project identity, then select only `e2e/drawing-workspace-p3.spec.ts`.
- Keep build, collaboration build, real-Postgres prerequisites, process-group termination, Supabase stop, and temporary-root cleanup unchanged.

In `platform/package.json`, add exactly:

```json
"test:e2e:drawing-workspace-p3:disposable": "node scripts/run-drawing-workspace-m1-e2e.mjs --profile=p3"
```

Do not rename or expand the existing local/production scripts.

### Step 5: Make focused tests green and mutation-prove the safety boundary

Run:

```bash
cd platform
node --test tests/drawing-workspace-p3-contract.test.mjs tests/drawing-workspace-m1-release-harness.test.mjs
npm run typecheck
npm run typecheck:collaboration
npm run build:collaboration
```

Expected: PASS.

Temporarily mutate one test copy or source copy so either (a) the external production guard accepts loopback or (b) the P3 spec selects disposable mode without the exact flag; run the focused contract test and confirm exactly the relevant safety test fails. Restore the exact green bytes and rerun. Do not leave mutation artifacts.

### Step 6: Execute all authenticated disposable P3 Gates 01–08

Run:

```bash
cd platform
npm run test:e2e:drawing-workspace-p3:disposable
```

Expected: production build and collaboration build succeed, real-Postgres prerequisites pass, all P3 Gates 01–08 pass, source SHA invariance remains true, and the runner tears down its services/Supabase/temp root. If a gate fails, use systematic debugging and a fresh RED/GREEN test for the root cause; do not weaken the assertion. Maximum five implementation/review loops.

### Step 7: Report and independently review the exact scoped patch

Write `task-1-report.md` with baseline, RED, GREEN, mutation, P3 execution, cleanup, scoped hashes, files changed, and concerns. Generate a patch from the recorded pre-task Git blobs to the current bytes because HEAD/index cannot isolate this task safely. Run an independent reviewer against that patch and this plan. Required review outcome before Task 2: Critical 0 and Important 0. Do not stage or commit.

---

## Task 2: Refresh release evidence, verify, and deploy the exact tree

**Files:**

- Modify by the established runner: `.superpowers/sdd/2026-08-28-drawing-workspace-p7/task-4-performance-evidence.json`
- Modify by the established runner: `.superpowers/sdd/2026-08-28-drawing-workspace-p7/task-4-performance-playwright-capture.json`
- Modify: `docs/superpowers/evidence/2026-09-03-universal-workspace-production-deployment.md`
- Update: `.superpowers/sdd/2026-09-05-m3-disposable-production-gate/progress.md`

### Step 1: Refresh source-bound performance evidence and run aggregate verification

From `platform`, run:

```bash
npm run test:e2e:drawing-workspace-p7:performance
npm run test:drawing-workspace
npm run typecheck
npm run build:collaboration
npm run build
```

Then run `git diff --check` for all Task 1 files, this plan/ledger/report, and refreshed evidence files. Expected: all commands PASS; only explicitly environment-bound hosted/managed checks may remain skipped and must be reported as `UNEXECUTED`.

### Step 2: Create one production candidate and verify before promotion

Use the repository-linked Vercel project and its existing CLI authentication. Do not print environment secrets. Create a candidate from `platform`, inspect it until `READY`, and verify:

- Public routes used by the established deployment smoke return HTTP 200.
- Protected project/drawing routes return the exact expected authentication redirect, not a 5xx or generic error boundary.
- The deployment logs contain no new build/runtime error for the verified routes.

If candidate verification fails, do not promote it. Record the failure and retain the existing production alias.

### Step 3: Promote the same verified artifact and verify production

Promote the verified candidate rather than rebuilding it. Confirm `https://lukas-qto-platform.vercel.app` points to that deployment and repeat the public/protected smoke plus a bounded error-log scan. Record:

- Candidate URL/deployment ID and `READY` state.
- Production alias and exact deployment ID.
- Previous production deployment ID as the immediate rollback target.
- Test counts, P3 disposable Gate 01–08 result, and P7 performance values.
- Hosted multi-user P3 and any managed-restore/customer fixture gates that remain `UNEXECUTED`.

### Step 4: Final truthfulness check

Do not claim the full P0–P7 goal complete. This task completes a verified deployment of current progress. The externally hosted P3 service/TLS/multi-replica proof, managed restore, and customer-controlled DXF/IFC evidence remain separate goal gates unless actually executed.

