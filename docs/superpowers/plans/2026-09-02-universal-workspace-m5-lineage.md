# Universal Drawing Workspace M5.1 Material Lineage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a signed-in user trace any measurable drawing object through its exact quantity and BOQ row into the existing material, procurement, site, and carbon workflow.

**Architecture:** Extend the existing object quantity-lineage response with one project-scoped material-presence bit per exact BOQ version/line tuple. Reuse the canonical workspace URL selection, quantity inspector, verified BOQ route, and material-control filters; add no table, collaboration service, CRDT, or client state library.

**Tech Stack:** React Router 7, React 19, TypeScript, Supabase/PostgREST, existing P6 material tables, Node test runner, Playwright.

**Spec:** `docs/superpowers/specs/2026-08-31-universal-workspace-estimator-vertical-slice-design.md`

## Global Constraints

- Viewer may read exact lineage links but may not create quantity, BOQ, material-plan, or transaction records.
- Material presence is true only for the same `project_id`, `boq_version_id`, and `boq_line_id`.
- Quantity pages remain bounded to 200 rows and material lookup input chunks remain bounded to 100 IDs.
- All measurable primitive and semantic objects use the same existing `drawingObjectSupportsMeasurement()` rule.
- Existing immutable source bytes, approval boundaries, outbox, Yjs draft, and RLS policies remain unchanged.
- Do not add a dependency or commit this shared worktree unless the user explicitly requests it.

---

### Task 1: Exact material-presence projection

**Files:**

- Modify: `platform/app/lukas/lib/drawing-quantity-lineage.server.ts`
- Test: `platform/tests/drawing-quantity-lineage-server.test.mjs`

**Interfaces:**

- Consumes: existing `lukas_drawing_boq_links` rows and `lukas_drawing_material_links(project_id, boq_version_id, boq_line_id)`.
- Produces: `DrawingObjectQuantityLineageRow.boqLinks[].hasMaterialLineage: boolean`.

- [x] **Step 1: Write a failing bounded-query test**

  Build more than 100 BOQ link identities and assert every PostgREST `.in()` call receives at most 100 line IDs. Include unrelated-project, unrelated-version, and unrelated-line material rows and assert they remain false.

- [x] **Step 2: Run the focused test and observe the missing field**

  Run `node --test tests/drawing-quantity-lineage-server.test.mjs` from `platform/`. Expected: the new material-lineage assertions fail before implementation.

- [x] **Step 3: Add the minimum project-scoped lookup**

  Query only the exact project and bounded BOQ line/version candidates, reduce returned rows to exact tuple keys, and map each BOQ link to:

  ```ts
  {
    ...link,
    hasMaterialLineage: materialTupleKeys.has(
      `${link.boqVersionId}:${link.boqLineId}`,
    ),
  }
  ```

- [x] **Step 4: Verify the focused server suite**

  Run `node --test tests/drawing-quantity-lineage-server.test.mjs`. Expected: all tests pass with no unbounded query.

### Task 2: Six-stage object lineage and exact navigation

**Files:**

- Modify: `platform/app/lukas/components/drawing-workspace.tsx`
- Modify: `platform/app/lukas/components/drawing-quantity-inspector.tsx`
- Test: `platform/tests/drawing-workspace-shell.test.mjs`
- Test: `platform/tests/drawing-workspace-tables.test.mjs`

**Interfaces:**

- Consumes: `DrawingObjectQuantityLineageRow.boqLinks[].hasMaterialLineage` and `drawingObjectSupportsMeasurement(object)`.
- Produces: six-stage `원본 → 객체 → 이슈 → 승인 → 물량·금액 → 자재·현장` status plus exact BOQ/material links.

- [x] **Step 1: Write failing UI tests**

  Assert six stages, the next stage `material`, primitive selection eligibility, Viewer-visible exact BOQ line URL, and exact material URL.

- [x] **Step 2: Confirm the tests fail on the five missing behaviors**

  Run `node --test tests/drawing-workspace-shell.test.mjs tests/drawing-workspace-tables.test.mjs`. Expected before implementation: 5 failures for the new stage, helper, primitive selection, BOQ line, and material link.

- [x] **Step 3: Implement the minimum UI connection**

  Use these exact routes:

  ```ts
  `/projects/${projectId}/boq?version=${boqVersionId}&line=${boqLineId}``/projects/${projectId}/materials?version=${boqVersionId}&boqLineId=${boqLineId}`;
  ```

  Keep mutation buttons behind the existing `canCreateQuantity` and route-action authority checks.

- [x] **Step 4: Verify the focused UI suite**

  Run `node --test tests/drawing-workspace-shell.test.mjs tests/drawing-workspace-tables.test.mjs`. Expected and observed: 68/68 pass.

### Task 3: Canonical route and release evidence

**Files:**

- Modify: `platform/e2e/drawing-workspace-m1-estimator.spec.ts`
- Modify: `platform/tests/drawing-workspace-e2e-contract.test.mjs`
- Create: `docs/superpowers/evidence/2026-09-02-universal-workspace-m5-lineage.md`

**Interfaces:**

- Consumes: the approved BOQ/material fixture already created by the M1 estimator suite.
- Produces: browser proof that a primitive object opens its exact BOQ row and material/site lineage for both Editor and Viewer read paths.

- [x] **Step 1: Add the failing canonical browser assertion**

  After the existing material handoff, open the canonical workspace with `revision` and the W-001 line object. Assert `data-lineage-step="자재·현장"` is linked, then assert both exact URLs include the persisted `boq_line_id`.

- [x] **Step 2: Run the canonical scenario**

  Run `npm run test:e2e:drawing-workspace-m1:local`. Expected: the disposable Supabase tests and canonical browser suite pass, or the evidence records an explicit unexecuted external prerequisite.

- [x] **Step 3: Run completion gates**

  Run focused tests, `npm run typecheck`, `npm run typecheck:collaboration`, `npm run build`, `npm run build:collaboration`, and `git diff --check`. Record the exact pass/skip/fail totals and do not rewrite commit-bound P7 performance evidence for a dirty tree.

- [x] **Step 4: Record honest evidence**

  The evidence document must distinguish synthetic fixture proof, real local PostgreSQL/RLS proof, approved customer-fixture proof, and hosted proof. Any unexecuted category remains explicitly unexecuted.

### Task 4: Fail closed on orphan BOQ-line deep links

**Files:**

- Modify: `platform/app/lukas/screens/material-control.tsx`
- Modify: `platform/app/lukas/lib/material-control.server.ts`
- Test: `platform/tests/drawing-workspace-m5-lineage-route.test.mjs`
- Test: `platform/tests/drawing-quantity-lineage-server.test.mjs`

**Interfaces:**

- Consumes: the existing collection-level `version` filter and exact `version + boqLineId` material-lineage URL.
- Produces: a `400` response/error when `boqLineId` is supplied without its BOQ version, while preserving `version`-only approved-BOQ selection.

- [x] **Step 1: Add failing route and server tests**

  Prove that an orphan `boqLineId` is rejected at both the loader boundary and direct `listMaterialBoqLineage` boundary. Keep tests for version-only filtering and the exact tuple green.

- [x] **Step 2: Observe the tests fail for the missing invariant**

  Run only the named M5 route/server tests and record that both orphan-line assertions fail before implementation.

- [x] **Step 3: Add the minimum defense-in-depth validation**

  Reject only `boqLineId && !boqVersionId`. Do not reject `version` alone because it remains the supported collection filter for approved BOQ handoff.

- [x] **Step 4: Verify focused and affected regressions**

  Run both focused suites, typecheck, changed-file formatting, and `git diff --check`. Record external hosted/customer gates separately rather than treating this local fix as M5 completion.

### Task 5: Preserve the exact BOQ row on reverse material navigation

**Files:**

- Modify: `platform/app/lukas/components/material-boq-lineage.tsx`
- Modify: `platform/e2e/drawing-workspace-m1-estimator.spec.ts`
- Test: `platform/tests/drawing-workspace-m5-lineage-route.test.mjs`

**Interfaces:**

- Consumes: each material-lineage row's exact `boqVersionId` and `boqLineId`.
- Produces: `/projects/:projectId/boq?version=:boqVersionId&line=:boqLineId`, with the exact BOQ row focused after navigation.

- [x] **Step 1: Add the failing exact-row contract**

  Change the material-lineage rendering test from a version-only URL to the literal version-plus-line URL and observe the expected failure against the existing component.

- [x] **Step 2: Add the minimum reverse-link identity**

  Append the row's `boqLineId` to the existing approved-BOQ link. Do not add state, a route, a query, or a dependency.

- [x] **Step 3: Prove navigation and focus in the canonical browser scenario**

  After clicking `승인 BOQ 근거 열기`, assert the exact URL and `#boq-line-{id}` focus before continuing through the existing BOQ-to-Drawing reverse lineage.

- [x] **Step 4: Run affected and production-shaped release gates**

  Run the M5 route/server/browser-contract union, typecheck, changed-file formatting, `git diff --check`, and the disposable production-shaped M1 browser suite. Record any unrelated transient failure and its clean isolated rerun instead of weakening the evidence collector.

### Task 6: Start exact lineage from a material transaction

**Files:**

- Modify: `platform/app/lukas/lib/material-control.server.ts`
- Modify: `platform/app/lukas/screens/material-control.tsx`
- Modify: `platform/app/lukas/components/material-boq-lineage.tsx`
- Test: `platform/tests/drawing-quantity-lineage-server.test.mjs`
- Test: `platform/tests/drawing-workspace-m5-lineage-route.test.mjs`
- Test: `platform/e2e/drawing-workspace-m1-estimator.spec.ts`

**Interfaces:**

- Consumes: one exact project-scoped `lukas_qto_material_transactions.id`.
- Produces: the transaction's authoritative material plan, complete related transaction/carbon scope, exact BOQ row, and canonical Drawing-object reverse link.

- [x] **Step 1: Add failing exact-transaction tests**

  Require malformed, duplicate, missing, and foreign-project transaction identities to fail closed. Put the target plan's material link beyond an unfiltered 200-row page and prove lookup still finds it.

- [x] **Step 2: Resolve the transaction before paging lineage**

  Load only `id, project_id, material_plan_id` for the exact transaction, bind every later query to that authoritative plan, and verify the transaction remains in the returned dependency closure.

- [x] **Step 3: Add the transaction self-link**

  Parse one `transactionId`, render `이 거래 계보만 보기` on each transaction, preserve the exact transaction across lineage pagination, and add no new route, table, or state library.

- [x] **Step 4: Prove the production-shaped round trip**

  In the existing M1 material scenario, open an exact goods-receipt transaction, assert its URL identity, then continue through the exact BOQ row and Drawing object. Run focused tests, typecheck/build, full disposable browser authority, formatting, `git diff --check`, and independent review.

### Task 7: Start exact lineage from a carbon factor

**Files:**

- Modify: `platform/app/lukas/lib/material-control.server.ts`
- Modify: `platform/app/lukas/screens/material-control.tsx`
- Modify: `platform/app/lukas/components/material-boq-lineage.tsx`
- Test: `platform/tests/drawing-quantity-lineage-server.test.mjs`
- Test: `platform/tests/drawing-workspace-m5-lineage-route.test.mjs`
- Test: `platform/e2e/drawing-workspace-m1-estimator.spec.ts`

**Interfaces:**

- Consumes: one exact project-scoped `lukas_qto_carbon_factors.id`, direct `material_plans.baseline_factor_id` references, and direct `material_transactions.carbon_factor_id` references.
- Produces: the factor's complete bounded union of material plans, related transactions, approved BOQ rows, and canonical Drawing-object reverse links without selecting an arbitrary first plan.

- [x] **Step 1: Add failing carbon-origin authority tests**

  Require exact factor resolution before any material-link page. Prove that baseline-plan and transaction-plan references form one union, that a target beyond 200 unrelated links is found, and that malformed, missing, foreign-project, duplicate URL, and conflicting plan/transaction scopes fail closed. Assert every plan-ID `.in()` filter contains at most 100 IDs and the merged result remains ordered and cursor-paginated at 200 rows.

- [x] **Step 2: Bind material-link paging to the factor plan union**

  Add `carbonFactorId?: string` to `listMaterialBoqLineage`. Resolve exactly `id, project_id`; load matching baseline plans with a 2,000-plan ceiling and matching transactions with the existing 10,000-transaction ceiling; validate every returned project/factor/plan identity. If an explicit material plan or exact transaction resolves outside that union, return controlled HTTP 400. Query material links in existing 100-plan chunks, apply the same cursor to every chunk, merge by descending `(created_at, id)`, deduplicate, and only then take `limit + 1`. An existing but unused factor returns an empty lineage page. Add no RPC, migration, dependency, state store, or alternate lineage model.

- [x] **Step 3: Add the exact factor self-link**

  Strictly parse one `carbonFactorId` in the material loader, pass it through the server and component, render `이 탄소계수 계보만 보기` on each factor, and preserve the exact factor through `lineageCursor` pagination. Existing plan, transaction, BOQ-row, and version filters remain composable only when their resolved scope agrees.

- [x] **Step 4: Prove factor → BOQ → Drawing round trip**

  In the existing M1 material scenario, open the exact factor self-link, assert its URL and factor-bound rows, then continue through the exact approved BOQ row and canonical Drawing object. Run the focused M5 server/route/browser-contract union, typecheck/build, scoped formatting, `git diff --check`, the full disposable production-shaped browser authority, and independent review before deployment.
