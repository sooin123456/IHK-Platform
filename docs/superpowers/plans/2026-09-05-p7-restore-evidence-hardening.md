# P7 Managed Restore Evidence Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent a correlated-but-unbound Supabase restore comparison or malformed restore artifact from conferring P7 production PASS, and measure RPO/RTO from one explicit drill-start event.

**Architecture:** Keep the existing Supabase Management API inventory, database/storage capture, append-only restore ledger, and release runner. Add one strict schema-v2 evidence inspector at the restore boundary and reuse it in the release runner. Because the documented public Management API exposes the selected physical backup and target project separately but no provider-issued backup-to-target binding, successful correlation remains `UNEXECUTED`; an observed mismatch remains `NOT MET`. No schema, provider adapter, restore service, or dependency is added.

**Tech Stack:** Node.js, PostgreSQL/Supabase Management API, Supabase Storage/REST, Node test runner.

**Spec:** `docs/superpowers/specs/2026-08-28-drawing-workspace-p7-design.md`

## Global Constraints

- Do not invent a Supabase clone operation ID, undocumented response field, signed receipt, or self-attested provider authority.
- Do not mark a database/storage comparison as provider-bound merely because backup time, project time, and PostgreSQL `system_identifier` correlate.
- A comparison mismatch or provider-state mismatch is `NOT MET`; missing direct provider binding is `UNEXECUTED`; neither may exit zero or create a PASS receipt.
- RPO is `drillStartedAt - backupCreatedAt`; RTO is `measuredAt - drillStartedAt`. Require `backupCreatedAt <= drillStartedAt <= restoreCreatedAt <= measuredAt`.
- Preserve the current database and Storage capture domains, immutable source bytes, append-only RPC, RLS, and all unrelated P7 release work.
- Add no dependency, migration, CRDT/state library, queue, alternate evidence store, or speculative provider integration.
- The shared worktree is already linked and dirty. Preserve existing work; do not stage, commit, reset, deploy, or rewrite historical P7 completion evidence.

---

### Task 1: Strict schema-v2 restore evidence and event-bound timing — fix round 1 verified

**Files:**

- Modify: `platform/scripts/drawing-p7-restore-evidence.mjs`
- Modify: `platform/scripts/drawing-p7-restore-evidence.d.mts`
- Test: `platform/tests/drawing-workspace-p7-restore.test.mjs`

**Interfaces:**

- Consumes: existing managed-restore authorities plus `P7_RESTORE_DRILL_STARTED_AT`.
- Produces: schema-v2 restore evidence, `inspectDrawingP7RestoreEvidence`, exact correlation/binding status, and event-bound RPO/RTO.

- [x] **Step 1: Add failing semantic and timing tests**

  Cover the new required drill timestamp, exact event ordering, recomputed RPO/RTO, physical-backup flag, renamed `restoreProjectId`, successful comparison remaining `UNEXECUTED` without direct provider binding, mismatch remaining `NOT MET`, no append-only record for `UNEXECUTED`, and rejection of malformed/forged PASS evidence.

- [x] **Step 2: Run RED**

  Run:

  ```bash
  cd platform
  node --test tests/drawing-workspace-p7-restore.test.mjs
  ```

  Expected: the new assertions fail because schema v1 has no inspector, no drill-start authority, proxy timing, and can currently promote correlation to PASS.

- [x] **Step 3: Add the minimum strict boundary**

  Add `P7_RESTORE_DRILL_STARTED_AT` parsing, schema-v2 evidence, `backupIsPhysical`, `restoreProjectId`, an explicit provider correlation result, and an explicit direct-binding `UNEXECUTED` result. Recompute timing from the drill event. Validate keys, IDs, timestamps/order, all six digest domains, mismatch consistency, timing, and top-level status before recording or writing. Record only executed `NOT MET`; do not record or exit zero for an unbound comparison.

- [x] **Step 4: Run GREEN**

  Run the focused restore test and require zero failures.

### Task 2: Fail-closed release consumption and operator documentation

**Files:**

- Modify: `platform/scripts/run-drawing-workspace-p7-release.mjs`
- Modify: `platform/scripts/run-drawing-workspace-p7-release.d.mts` (only if an exported classifier signature changes)
- Modify: `platform/tests/drawing-workspace-p7-release.test.mjs`
- Modify: `platform/DEPLOYMENT.md`

**Interfaces:**

- Consumes: raw schema-v2 restore JSON from Task 1.
- Produces: semantic status classification for both local evidence assembly and the production managed-restore subprocess.

- [x] **Step 1: Add failing release-consumer counterexamples**

  Prove that a legacy or malformed artifact claiming PASS, an exit-zero process with non-PASS evidence, a stale commit/request binding, or a correlated-only comparison cannot make either restore requirement PASS. Preserve `UNEXECUTED` classification for an honestly unexecuted artifact and `NOT MET` for an executed mismatch.

- [x] **Step 2: Run RED**

  Run:

  ```bash
  cd platform
  node --test --test-name-pattern="managed restore|restore evidence" tests/drawing-workspace-p7-release.test.mjs
  ```

  Expected: at least one forged/malformed receipt is currently trusted from `status === "PASS"` or subprocess exit zero.

- [x] **Step 3: Reuse the strict inspector in both release paths**

  Import the Task 1 inspector. Classify before constructing receipts, require semantic PASS in addition to exit zero, and fail closed on invalid artifacts. Do not refresh the historical source-bound Task 7 release ledger. Update the runbook to require the drill-start timestamp and to state that current public Supabase authority proves correlation, not direct selected-backup binding.

- [x] **Step 4: Run GREEN and regression checks**

  Run sequentially:

  ```bash
  cd platform
  node --test tests/drawing-workspace-p7-restore.test.mjs tests/drawing-workspace-p7-release.test.mjs
  npm run typecheck
  npm exec prettier -- --check scripts/drawing-p7-restore-evidence.mjs scripts/drawing-p7-restore-evidence.d.mts scripts/run-drawing-workspace-p7-release.mjs tests/drawing-workspace-p7-restore.test.mjs tests/drawing-workspace-p7-release.test.mjs
  git diff --check
  ```

  Require zero focused failures. Missing production authorities remain a nonzero `UNEXECUTED` gate.

### Task 3: Independent review and honest handoff

**Files:**

- Modify: `.superpowers/sdd/2026-09-05-p7-restore-evidence-hardening/progress.md`

- [x] **Step 1: Independent specification and code-quality review**

  Require 0 Critical and 0 Important findings. Fix and re-review any blocking finding without staging or committing shared work.

- [x] **Step 2: Controller verification**

  Re-run Task 2 Step 4 from the controller and record exact counts. Do not run the managed production restore command without isolated-project and provider authorities.

- [x] **Step 3: Record the remaining external gate**

  State explicitly that direct provider backup-to-target binding, the live managed drill, and customer DXF acceptance remain `UNEXECUTED`. Do not claim P7 or the overall goal complete.
