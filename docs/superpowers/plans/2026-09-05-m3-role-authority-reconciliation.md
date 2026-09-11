# M3 Role Authority Reconciliation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make approved-snapshot restore and the production-shaped P3 browser fixture obey the approved Reviewer/Approver separation already enforced by Postgres.

**Architecture:** Keep the existing Supabase RPC and role model authoritative. Narrow only the server and rendered restore affordance, then update the existing P3 production fixture to exercise the same staged Reviewer recommendation and distinct Approver final decision already proven by the canonical M1 flow. Add no schema, dependency, collaboration server, state store, or second permission model.

**Tech Stack:** React Router, React, TypeScript, Node test runner, Playwright, Supabase/Postgres, Hocuspocus/Yjs.

**Spec:** `docs/superpowers/specs/2026-08-26-drawing-workspace-p3-design.md`

## Global Constraints

- `Reviewer` may record the review decision and may restore an approved snapshot into a new child draft; `Approver` may record final approval or rejection but may not mutate or restore a Drawing revision.
- Approved revisions remain immutable; restore creates a child draft through the existing `lukas_drawing_restore_approved_snapshot(uuid,uuid)` RPC.
- Keep the current database function and its exact `admin|editor|reviewer` authority unchanged.
- Keep Viewer, Reviewer, and Approver collaboration connections read-only and deny their Drawing operation RPC writes.
- Do not add a migration, dependency, state manager, collaboration service, or permission registry.
- PDF and IFC source bytes remain immutable.
- The worktree contains extensive prior changes. Do not stage or commit target files; report exact file paths, pre/post hashes, RED/GREEN commands, and results instead.

---

### Task 1: Reconcile restore and staged approval authority

**Files:**
- Modify: `platform/app/lukas/lib/drawing-workspace-view.ts`
- Modify: `platform/app/lukas/components/drawing-workspace.tsx`
- Modify: `platform/app/lukas/lib/drawing-workspace.server.ts`
- Modify: `platform/tests/drawing-workspace-route.test.mjs`
- Modify: `platform/tests/drawing-workspace-server.test.mjs`
- Modify: `platform/e2e/drawing-workspace-p3.spec.ts`
- Modify: `platform/tests/drawing-workspace-e2e-contract.test.mjs`

**Interfaces:**
- Consumes: `DrawingWorkspaceCapability`, `handleWorkspaceMutation`, `lukas_drawing_restore_approved_snapshot`, `fixture.reviewer`, `fixture.approver`, and `lukas_drawing_revision_approvals`.
- Produces: `drawingWorkspaceCanRestoreApprovedSnapshot(capability): boolean`, exact restore denial for Approver, and a P3 production fixture that reaches `reviewed` before `approved` with different actors.

- [x] **Step 1: Write RED role-policy and mutation tests**

  Add a pure view-policy assertion that `admin`, `editor`, and `reviewer` return `true`, while `commenter`, `approver`, and `viewer` return `false`. Add a server behavior test that submits the existing `restore_approved_snapshot` form against an approved workspace: Reviewer reaches exactly one `lukas_drawing_restore_approved_snapshot` RPC, while Approver receives HTTP 403 before any RPC call.

- [x] **Step 2: Run RED and verify the precise failures**

  Run `node --test tests/drawing-workspace-route.test.mjs tests/drawing-workspace-server.test.mjs` from `platform`. The new view-policy test must fail because the helper is absent, and the mutation test must fail because Approver is currently admitted. Do not accept a syntax/import failure as RED.

- [x] **Step 3: Implement the minimum shared UI policy and server denial**

  Export `drawingWorkspaceCanRestoreApprovedSnapshot` from `drawing-workspace-view.ts` with the exact three allowed capabilities. Use it for the approved-history restore form. Remove only `approver` from the server's existing restore capability check. Preserve all status, revision, request-ID, child-draft, and RPC behavior.

- [x] **Step 4: Verify GREEN for the focused role boundary**

  Re-run `node --test tests/drawing-workspace-route.test.mjs tests/drawing-workspace-server.test.mjs`. Both new tests and the complete focused files must pass.

- [x] **Step 5: Update the production-shaped P3 fixture**

  In Gate 05, open an Approver workspace alongside Viewer and Reviewer, assert all three are read-only, attempt the same WebSocket and direct operation-RPC mutation for Approver, and prove no object row appears. In Gate 07, replace the obsolete Reviewer `도면 승인` action with Reviewer `도면 검토 완료`, assert status `reviewed`, then open a distinct Approver context, click `도면 최종 승인`, assert status `approved`, and assert the ordered approval rows are exactly `{decision:"reviewed", decided_by:fixture.reviewer.id}` followed by `{decision:"approved", decided_by:fixture.approver.id}`.

- [x] **Step 6: Mutation-prove the P3 contract**

  Update `drawing-workspace-e2e-contract.test.mjs` so the P3 source contract requires the Approver fixture, both current button labels, the intermediate `reviewed` assertion, the final `approved` assertion, and distinct actor rows. Run the contract test against the corrected spec, temporarily restore only the stale Gate 05/Gate 07 snippets and prove the new assertions fail, then restore the corrected spec and prove the contract passes.

- [x] **Step 7: Run scoped and aggregate verification**

  Run the focused Node union, application typecheck, collaboration typecheck/build, scoped Prettier, and `git diff --check`. Run `npm run test:e2e:drawing-workspace-m1:local` so the already-supported disposable Supabase/Postgres/Storage/Realtime/Hocuspocus authority re-proves the canonical staged workflow. Run `npm run test:drawing-workspace` after any source change because P7 performance evidence is source-tree bound; if its evidence checks become stale, regenerate only with `npm run test:e2e:drawing-workspace-p7:performance` and rerun the full union.

- [x] **Step 8: Independently review and record evidence**

  Review only the exact task patch plus RED/GREEN report. Require both spec compliance and code quality verdicts. Record local results and keep credentialed hosted multi-user replay `UNEXECUTED`; do not claim production authority until a new runtime deployment and hosted checks actually occur.
