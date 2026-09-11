# Collaboration Freeze Identity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make repeated freeze reconciliation byte- and identity-stable without altering freeze authorization or persistence semantics.

**Architecture:** Use one server-only helper to set only changed scalar metadata. Route existing projection branches through it; retain all authoritative decisions and persisted transition paths.

**Tech Stack:** TypeScript, installed Yjs 13.6.32 / Hocuspocus 4.6.0, Node test runner.

**Spec:** `docs/superpowers/specs/2026-09-06-collaboration-freeze-identity.md`

## Global Constraints

- Work only in `/Users/h/Documents/GoAgent/.worktrees/universal-workspace-m1`; preserve pre-existing dirty changes using exact pre-task snapshots.
- Do not stage, commit, merge, push, deploy, upgrade dependencies, or mutate remote data.
- Do not rebuild or restart the existing port 4173 preview; use no app build in this checkout.
- Reuse installed Yjs 13.6.32 and Hocuspocus 4.6.0; add no dependencies.
- Do not weaken protected-map validation, Viewer restrictions, revision approval, freeze leases, or original-source preservation.
- Run Node checks with `NODE_OPTIONS=--no-experimental-webstorage`.

---

### Task 1: Identity-stable freeze projections

**Files:**
- Modify: `platform/collaboration/src/freeze.ts`
- Modify: `platform/collaboration/src/server.ts`
- Test: `platform/tests/drawing-review-freeze.test.mjs`

**Interfaces:**
- Consumes: `DrawingFreezeState`, `DRAWING_COLLABORATION_SERVER_ORIGIN`, existing `Y.Doc`, `createDrawingFreezeCoordinator`, and `createDrawingCollaborationServer` fixtures.
- Produces: `reconcileDrawingFreezeMetadata(document: Y.Doc, freezeState: DrawingFreezeState["state"], requestId: string | null): void`, exported by `freeze.ts` and imported by `server.ts`.

- [x] **Step 1: Add failing behavioral checks to actual branch tests.**

Add this reusable test assertion in the existing test file:

```js
async function assertIdentityStable(doc, reconcile) {
  const bytes = Y.encodeStateAsUpdate(doc);
  const vector = Y.encodeStateVector(doc);
  let updates = 0;
  const onUpdate = () => { updates += 1; };
  doc.on("update", onUpdate);
  try {
    await reconcile();
    await reconcile();
    assert.deepEqual(Y.encodeStateAsUpdate(doc), bytes);
    assert.deepEqual(Y.encodeStateVector(doc), vector);
    assert.equal(updates, 0);
  } finally {
    doc.off("update", onUpdate);
  }
}
```

Call it after the first successful transition in existing tests:
`a foreign persisted lease fences a second coordinator before the owner reads`,
`a detached active owner fences a separately loaded document before begin commits`, and
`the server owns a room before deferred detached storage load` (inside the persisted-state loop, passing `runtime.reconcileLoadedDocument(candidate, roomName)`). Keep their existing first-transition, write-denial, lease call-count and cleanup assertions. Ensure deferred owner work is released in `finally` when adding assertions, so expected RED failures do not strand promises.

Add a production coordinator test for non-draft `freezing`: fixed request UUID, `revisionStatus: "review_requested"`, `revisionVersion: 1`, `frozenSubjectRevisionVersion: 1`; `readFreeze` returns that state and mutation methods throw if called. First reconcile must return `freezing` with the same request; repeated calls pass `assertIdentityStable`. Preserve/reuse existing active, released, and approved frozen tests; add stability assertions for their matching snapshots where needed.

Test one-field changes directly through the production helper. Observe the Y.Map event `keysChanged` and update origin. Start at `active/null`, set `freezing/null` and expect exactly `["freezeState"]`; then `freezing/requestId` and expect exactly `["freezeRequestId"]`. Both event origins must equal `DRAWING_COLLABORATION_SERVER_ORIGIN`. A final identical call is byte/vector/event stable.

- [x] **Step 2: Run RED before production edits.**

From `platform`, run `NODE_OPTIONS=--no-experimental-webstorage node --experimental-strip-types --test tests/drawing-review-freeze.test.mjs`. Capture the failed repeated-identity assertions (and absent helper until implemented). No application build is needed.

- [x] **Step 3: Implement the shared helper and route projections through it.**

```ts
export function reconcileDrawingFreezeMetadata(
  document: Y.Doc,
  freezeState: DrawingFreezeState["state"],
  requestId: string | null,
): void {
  const meta = document.getMap("serverMeta");
  const stateChanged = meta.get("freezeState") !== freezeState;
  const requestChanged = meta.get("freezeRequestId") !== requestId;
  if (!stateChanged && !requestChanged) return;
  document.transact(() => {
    if (stateChanged) meta.set("freezeState", freezeState);
    if (requestChanged) meta.set("freezeRequestId", requestId);
  }, DRAWING_COLLABORATION_SERVER_ORIGIN);
}
```

Replace only projection transaction blocks in `fenceDocument`, the local owner active/freezing and frozen branches of `reconcileLoaded`, the non-draft freezing/frozen branches, the active branch, and `server.ts` preparing branch with calls using their original state/request values. Do not alter `ownedFreeze`, release candidate persistence, validators, errors, or manifest checks.

- [x] **Step 4: Run GREEN and regressions.**

From `platform`, run the focused command above, then `NODE_OPTIONS=--no-experimental-webstorage node --experimental-strip-types --test tests/drawing-collaboration-*.test.mjs tests/drawing-review-freeze.test.mjs tests/drawing-native-collaboration.test.mjs`, and `NODE_OPTIONS=--no-experimental-webstorage npm run typecheck:collaboration`. All must pass; report any pre-existing environmental skips/noise explicitly. Do not claim actual network or browser recovery from these unit checks.

- [x] **Step 5: Self-review and hand off without committing.**

Compare only the exact dirty baseline of these three files. Report RED/GREEN commands/output and changed paths to the controller's assigned report file. Controller requests one independent task review and final cross-unit review, preserving the active goal and recording remaining canonical bootstrap and transition durability work.

## Controller self-review

All four unconditional branches and all three conditional projections are covered by the single helper. No API, SQL, dependency, authorization, or persistence-order change is included. The deferred durable-bootstrap work is explicitly outside this independently testable unit, not a claim of overall reconnect completion. User standing authorization replaces repeated plan approval and commit ceremonies.
