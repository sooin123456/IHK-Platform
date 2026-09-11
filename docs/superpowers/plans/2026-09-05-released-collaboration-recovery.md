# Released Collaboration Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A saved drawing whose review freeze was released can reopen in a fresh collaboration process without losing its release identity or bypassing a newer freeze lease.

**Architecture:** Repair only the request-ID projection in the existing private SQL read function. Keep the current Yjs recovery coordinator, lease fencing, revision authority and persistence contracts; add actual-database recovery tests because a fake readFreeze response concealed this defect.

**Tech Stack:** Existing PostgreSQL/Supabase migrations, postgres.js, Yjs/Hocuspocus, Node test runner.

**Spec:** Approved continuous-development goal and shared-workspace recovery requirement in `docs/superpowers/specs/2026-09-05-1hk-business-model-design.md`, sections4–5. Evidence: `docs/superpowers/evidence/2026-09-05-native-catalog-import.md` (separate inherited recovery boundary).

## Global constraints

- Existing dirty linked worktree: `/Users/h/Documents/GoAgent/.worktrees/universal-workspace-m1`; preserve all prior work. No stage, commit, reset, deployment or operating database writes.
- Do not edit source while the preceding native-catalog full M1 run is active. Capture this unit's own pre-edit dirty snapshots after that unit finishes.
- No new dependency, service, state manager, tables, public RPC, client freeze bypass or data backfill.
- Preserve `security definer set search_path=''`, existing execute privileges, return columns, state projection, lease expiry/takeover logic, original file bytes and approved immutable revisions.
- Main agent reads applicable Supabase/security, systematic-debugging and TDD instructions before execution. Use Supabase CLI to create the new timestamped migration; do not rewrite historical migrations.
- Local isolated PostgreSQL only for focused tests. Root owns full M1 builds and temporary services; retain failures and avoid credentials in reports.

### Task 1: Released request identity and fresh-process recovery

**Files**

- Create migration with `supabase migration new drawing_released_freeze_recovery` from `platform/`.
- Modify `platform/tests/drawing-native-catalog-real-database.test.mjs`, immediately after the existing `coordinator.release` before `repairing.freeze`.
- Read, do not change: `platform/collaboration/src/freeze.ts`, `platform/collaboration/src/storage.ts`, `platform/supabase/migrations/20260826063603_drawing_workspace_p3_cross_instance_freeze_lease.sql`.
- Record evidence in `docs/superpowers/evidence/2026-09-05-released-collaboration-recovery.md` and a new private `.superpowers/sdd/2026-09-05-released-collaboration-recovery/` directory.

**Interface:** `private.lukas_drawing_collaboration_read_freeze(uuid,uuid)` retains all14 return columns. `bridgeDatabase.freeze.readFreeze({projectId,revisionId})` must return `requestId` consistent with its projected `state`. `createDrawingFreezeCoordinator(...).reconcileLoaded({document,roomName})` must work with actual `bridgeDatabase.loadService(scope).yjsState` in a new `Y.Doc`.

- [x] Capture dirty snapshots and add a failing assertion after release using the existing `failedFreeze` and `bridgeTemplate` fixture identities:

```js
const releasedScope = { projectId: project, revisionId: bridgeTemplate.revisionId };
const released = await bridgeDatabase.freeze.readFreeze(releasedScope);
assert.equal(released.state, "released");
assert.equal(released.requestId, failedFreeze);
```

The current fixture declares `project` at line156. Also load persisted Yjs bytes with `loadService`, apply them to a fresh document, then call a fresh coordinator's `reconcileLoaded`; assert release ID, state, object/operation identity preservation and no lease left behind. Destroy only the new test document and dispose the new coordinator in `finally`.

- [x] Run `NODE_OPTIONS=--no-experimental-webstorage node --test tests/drawing-native-catalog-real-database.test.mjs`. Expect the real SQL response to be null instead of `failedFreeze`, or the exact runtime error `Released drawing freeze request is missing.` Preserve RED output before implementation.
- [x] Generate the new migration and copy the current complete `read_freeze` definition with `create or replace function`; change only this CASE fallback:

```sql
case when s.freeze_state in ('freezing','frozen') then s.freeze_request_id
  else coalesce(l.request_id,s.freeze_request_id) end
```

Do not add `released` to the first branch: a new preparation lease B must take precedence over an older released request A. Do not drop/recreate the function or modify its privileges.

- [x] Extend real-DB cases using existing `acquireFreezeLease`/`releaseFreezeLease` methods with fresh request/owner UUIDs: released A + lease B reads freezing/B; releasing preparation B restores released/A; active preparation cancellation restores active/null. Keep current frozen/committed review and wrong-owner denial checks. For expired leases, use a test-only controlled database timestamp, verify the existing freezing/fence projection remains until lawful takeover, and never add a production expiry shortcut. Assert unchanged function ACL and authenticated/anonymous inability to execute this private service read.
- [x] Rerun the actual native DB test and `NODE_OPTIONS=--no-experimental-webstorage node --test tests/drawing-review-freeze.test.mjs tests/drawing-native-collaboration.test.mjs`; run app/collaboration typecheck if any TS source had to change (such expansion must first be justified with a failing test). No TS source change is expected.
- [x] Freeze the scoped diff, independently review request/state priority and lease authority, then root runs `npm run test:e2e:drawing-workspace-m1:local` once against the frozen new migration. Record actual counts, cleanup and warnings. Do not reinterpret fake coordinator tests as proof of the SQL repair.
- [x] Publish concise evidence and mark this unit complete only after its checks pass. Keep the overall Universal Workspace goal active: editable output controls, DWG qualification and actual recipient/customer acceptance remain separate required work.

Execution follows the user's existing authorization to continue without another approval prompt. No plan-only approval pause or operating deployment is implied.
