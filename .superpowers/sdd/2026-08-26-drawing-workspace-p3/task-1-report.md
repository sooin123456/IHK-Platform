# P3 Task 1 — workspace Realtime invalidation

## Implementation

- Added project/revision-scoped Postgres Changes subscription descriptors for revisions, object-issue links, issues, comments, events, approvals, and project membership.
- Added a 250 ms coalescing scheduler, reconnect and visibility-return invalidation, cleanup, and the Drawing Room connection-state messages.
- Added the workspace top-bar connection state. Realtime calls React Router revalidation only; it does not hydrate the document store or acknowledge an outbox/action mutation.
- Local preview injects an inert already-connected adapter, so it makes no Supabase request.

## RED evidence

1. `node --test tests/drawing-workspace-realtime.test.mjs` initially failed because `drawing-workspace-realtime.ts` did not exist.
2. The workspace shell test initially failed because the top-bar realtime indicator did not exist.
3. Browser verification initially caught an SSR failure from importing a named export out of a `.client` module. The SSR consumer now uses the server-safe library seam; the `.client` file is retained as the browser-facing re-export.

## GREEN evidence

- `node --test tests/drawing-workspace-realtime.test.mjs` — 3 passing.
- `node --test tests/drawing-workspace-realtime.test.mjs tests/drawing-workspace-shell.test.mjs` — 14 passing.
- `npm run typecheck` — passing.
- `SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_ANON_KEY=local-anon-key VITE_SUPABASE_URL=http://127.0.0.1:54321 VITE_SUPABASE_ANON_KEY=local-anon-key npx playwright test e2e/drawing-workspace-shell.spec.ts --project=chromium --workers=1` — one full serial run passed 5/5.

## Files

- `platform/app/lukas/lib/drawing-workspace-realtime.ts`
- `platform/app/lukas/components/drawing-workspace-realtime.client.tsx`
- `platform/app/lukas/components/drawing-workspace.tsx`
- `platform/app/lukas/screens/local-drawing-workspace-preview.tsx`
- `platform/tests/drawing-workspace-realtime.test.mjs`
- `platform/tests/drawing-workspace-shell.test.mjs`
- `platform/e2e/drawing-workspace-shell.spec.ts`

## Concern

A later serial browser retry intermittently failed an existing Style-tab click assertion after the new indicator test had passed. The same test and a full 5/5 run both passed earlier; no production behavior was changed to mask that timing-sensitive browser failure.

## Fix round 1 — preserve the graph on Realtime refresh

### RED evidence

- Added `same-revision loader refresh keeps the locally edited drawing graph` to the workspace shell test. It initially failed because `replaceDrawingWorkspaceGraphForLifecycle` did not exist.

### Implementation

- Persistence/outbox lifecycle now depends on one stable `currentUserId + revision.id` key rather than the loader `revision` object.
- The recovery path has an explicit lifecycle gate: a fresh server graph only replaces the document store after a user or revision identity change. Same-ID Realtime revalidation leaves the locally edited graph untouched.
- Revision status and capability remain direct render-time authorization inputs, so a same-ID downgrade still takes effect immediately without resetting the graph.
- The preview browser test now records requests and asserts no request reaches port `54321`.

### GREEN evidence

- `node --test tests/drawing-workspace-realtime.test.mjs tests/drawing-workspace-shell.test.mjs tests/drawing-workspace-outbox.test.mjs` — 76 passing.
- `npm run typecheck` — passing.
- Serial Chromium runs passed the new port-54321 request test, then intermittently failed the pre-existing Style-tab click or Arrow-key hydration assertions. No readiness/test-timing changes were made outside this task's scope.
