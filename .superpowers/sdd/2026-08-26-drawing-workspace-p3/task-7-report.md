# P3 Task 7 report — visible collaborators, cursors, selections, soft locks

Baseline: `707d5f9`

## Outcome

- Added a strict, bounded Awareness publisher and peer parser with rAF coalescing, canonical selection IDs, unchanged-state suppression, deterministic accessible colors, canvas filtering, and removal on clear/dispose.
- Exposed the existing Hocuspocus provider Awareness through the collaboration connection. No Supabase Presence, Redis, global state manager, or durable Awareness storage was added.
- Added a renewable advisory object lock with a ten-second maximum lease. Remote locks preserve selection but cancel/block conflicting drag and inspector edits; capability, revision, layer, and server checks remain authoritative.
- Rendered remote selection bounds in a real Konva layer and cursor/participant/connection/lock labels in accessible DOM. The committed drawing layer remains memoized across pointer-frequency Awareness updates.
- Added explicit local preview injection for two deterministic peers only when `?awarenessTest=1` is present. The normal preview remains peer-free and makes no Supabase or Hocuspocus request.
- Preserved direct SSR inspector callers by treating an omitted Awareness store as an empty store.

## TDD evidence

RED:

- `node --test tests/drawing-awareness.test.mjs` — failed because the Awareness module did not exist (0/6).
- Fresh Chromium collaborator scenario — failed because participants, remote cursor/selection, and advisory lock UI were absent.
- Publisher downgrade case — failed because `clear()` did not exist.
- Full Drawing Node regression exposed a direct SSR inspector render without `awarenessStore`; its semantic block navigation test failed before the empty-store compatibility fix.

GREEN:

- `node --test tests/drawing-awareness.test.mjs` — 6/6 passed.
- `node --test tests/drawing-awareness.test.mjs tests/drawing-workspace-commands.test.mjs tests/drawing-collaboration-protocol.test.mjs tests/drawing-collaboration-service.test.mjs tests/drawing-workspace-collaboration.test.mjs` — 123/123 passed.
- `npm run test:drawing-workspace` — 451 passed, 1 skipped, 0 failed (452 total).
- `E2E_BASE_URL=http://127.0.0.1:5173 npx playwright test e2e/drawing-workspace-shell.spec.ts --project=chromium --workers=1` — 9/9 passed against a freshly restarted dev server.
- `npm run typecheck` — passed.
- `npm run typecheck:collaboration` — passed.
- `npm run build` — passed.
- `git diff --check` — passed.

## Visual evidence

- Preview: `http://127.0.0.1:5173/workspace-preview/drawing-workspace?awarenessTest=1`
- Fresh Chromium screenshot: `/tmp/1hk-p3-task7-collaborators-final.png`
- The screenshot visibly contains three participant identities, two remote cursor labels, a pink remote selection outline, and the inspector advisory lock owner without horizontal overflow.

## Scope boundary

Task 8 comments/history were not changed. Awareness remains ephemeral and advisory; production multi-browser service verification remains a later release gate and is not claimed here.
