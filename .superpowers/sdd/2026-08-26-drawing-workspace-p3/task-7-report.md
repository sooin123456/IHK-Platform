# P3 Task 7 report — visible collaborators, cursors, selections, soft locks

Baseline: `707d5f9`

## Outcome

- Added a strict, bounded Awareness publisher and peer parser with rAF coalescing, canonical selection IDs, unchanged-state suppression, deterministic accessible colors, canvas filtering, and removal on clear/dispose.
- Exposed the existing Hocuspocus provider Awareness through the collaboration connection. No Supabase Presence, Redis, global state manager, or durable Awareness storage was added.
- Added a renewable advisory object lock with a ten-second maximum lease. Remote locks preserve selection but cancel/block conflicting drag and inspector edits; capability, revision, layer, and server checks remain authoritative.
- Rendered remote selection bounds in a real Konva layer and cursor/participant/connection/lock labels in accessible DOM. The committed drawing layer remains memoized across pointer-frequency Awareness updates.
- Added explicit local preview injection for two deterministic peers only when `?awarenessTest=1` is present. The normal preview remains peer-free and makes no Supabase or Hocuspocus request.
- Preserved direct SSR inspector callers by treating an omitted Awareness store as an empty store.
- Review remediation identifies the local connection only by the provider-owned Awareness `clientId`; a second browser for the same verified user remains visible with its server-shaped identity and deterministic color.
- Review remediation centralizes live advisory-lock conflict checks at the workspace command/recorded-operation boundary. Selection copy/duplicate/delete/nudge and menu affordances share that gate, unrelated entity commands remain enabled, and blocked work reports an accessible reason without replacing server authority.
- Review remediation resolves both drawing objects and block instances through canonical render items, so remote block selections receive real Konva bounds and block inspector focus/blur/unmount drives the same renewable lease lifecycle.
- Lock-only subscribers are isolated from cursor-only updates, preserving the committed drawing memo boundary at pointer frequency.

## TDD evidence

RED:

- `node --test tests/drawing-awareness.test.mjs` — failed because the Awareness module did not exist (0/6).
- Fresh Chromium collaborator scenario — failed because participants, remote cursor/selection, and advisory lock UI were absent.
- Publisher downgrade case — failed because `clear()` did not exist.
- Full Drawing Node regression exposed a direct SSR inspector render without `awarenessStore`; its semantic block navigation test failed before the empty-store compatibility fix.
- Review RED: focused pure/command tests failed 4 cases for same-user/different-client retention, lock-only subscription isolation, central command conflict gating, and block-instance remote bounds.
- Review Chromium RED: the same-user/block scenario first exposed the missing block display name and then the missing inspector lease observation before those paths were completed.

GREEN:

- `node --test tests/drawing-awareness.test.mjs` — 9/9 passed.
- `node --test tests/drawing-awareness.test.mjs tests/drawing-workspace-commands.test.mjs tests/drawing-collaboration-protocol.test.mjs tests/drawing-collaboration-service.test.mjs tests/drawing-workspace-collaboration.test.mjs` — 127/127 passed.
- `npm run test:drawing-workspace` — 452 passed, 1 skipped, 0 failed (453 total).
- `E2E_BASE_URL=http://127.0.0.1:5173 npx playwright test e2e/drawing-workspace-shell.spec.ts --project=chromium --workers=1` — 9/9 passed against a freshly restarted dev server.
- `npm run typecheck` — passed.
- `npm run typecheck:collaboration` — passed.
- `npm run build` — passed.
- `git diff --check` — passed.

## Visual evidence

- Preview: `http://127.0.0.1:5173/workspace-preview/drawing-workspace?awarenessTest=1`
- Fresh Chromium screenshot: `/tmp/1hk-p3-task7-review-fixes.png`
- The screenshot visibly contains the local user plus a second client for that same verified user, two remote cursor labels, a pink object outline, a cyan block-instance outline, and both advisory lock owners without horizontal overflow.

## Scope boundary

Task 8 comments/history were not changed. Awareness remains ephemeral and advisory; production multi-browser service verification remains a later release gate and is not claimed here.
