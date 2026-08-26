# P3 Task 8 report — comments, mentions, sharing, history and restore

## Delivered

- Generated one additive Supabase CLI migration: `20260826020804_drawing_workspace_p3_mentions_history.sql`.
- Added explicit, immutable, same-project comment mentions with idempotent event and notification fanout. Display-only `@text` is never parsed for authority.
- Added immutable world-millimeter canvas-region anchors with composite project/revision/page/canvas integrity and finite signed coordinates.
- Reused `/projects/:projectId/members`; no parallel sharing ACL or role vocabulary was added.
- Added bounded 1–50 item operation/event history pages with one globally ordered `(created_at,id,kind)` cursor and provenance.
- Added actor-only, dependency-safe single-operation revert through the existing command bridge/outbox/RPC.
- Added a single `restore_checkpoint` compound operation with exact current base versions, inverse actions, tombstones and normal append-only persistence.
- Added idempotent approved-snapshot restore to a fresh-ID child draft while preserving source lineage and leaving the approved source immutable.
- Added keyboard-accessible `댓글·이슈` and `변경 이력` workspace tabs, actual issue/object/finite-region targeting, loaded comments/mentions/anchors, explicit project-member mention selection, safe-revert status and approved restore navigation.
- Kept preview data local and explicit; no external write is simulated.

## Review hardening

- Generated the forward-only Supabase CLI migration `20260826025543_drawing_workspace_p3_activity_authority.sql`; the committed Task 8 migration was not edited.
- Checkpoint restore now runs under the draft revision lock and compares the post-operation canonical structure, source evidence and issue links with the selected hash-verified snapshot. Its authoritative database path validates exact forward/inverse actions, bases, tombstones and references for ordinary object changes as well as block compounds, including objects added after a checkpoint, older object or non-object tombstones, mixed layer/structure changes, locked or hidden layers, dependent canvas/layer/object revival and moved surviving layers; a mismatched target rolls the transaction back.
- Approved restore locks the document before allocating the child sequence, retains actor/request idempotence, and supports the existing admin/editor/reviewer capabilities without exposing a second ACL.
- Production activity rows now carry both the immutable database row ID and `client_operation_id`, so one-operation revert addresses the operation the command history expects.
- Revert and checkpoint success messages are emitted only after the durable outbox bridge accepts the operation; soft-lock, frozen, conflict and persistence rejection paths remain visible failures.
- History pagination links preserve the selected drawing document.
- Activity rows render bounded human-readable change detail and immutable issue, revision or original-operation provenance.
- Checkpoint restore is deliberately non-undoable because its inverse is not the named authoritative checkpoint; the history UI therefore never offers a revert that the database must reject.

## Verification evidence

- Full PGlite database runtime: 114 passed, 0 failed, including arbitrary checkpoint-delta rejection, ordinary and dependent object change/delete, mixed collection restore, locked/hidden layer restore, staged canvas/layer revival, reviewer restore and document-lock evidence.
- Focused social/history contracts: 11 passed, 0 failed.
- Full Drawing Node: 479 tests, 478 passed, 1 intentionally skipped, 0 failed.
- `npm run typecheck`: passed.
- `npm run typecheck:collaboration`: passed.
- `npm run build`: passed; only existing chunk-size, React Router future-flag, unsigned theme-cookie and localStorage warnings were emitted.
- `git diff --check`: passed.
- Fresh Chromium: the workspace, actual comment/mention/finite-region controls, loaded linked evidence, and history detail/provenance rendered with no dialog, alert or Vite/framework error overlay. The collaboration sample content was asserted in the rendered document.
- The first local preview start without environment variables correctly stopped at the existing root Supabase environment gate. Browser verification was repeated with explicit local-only preview values and performed no external writes.

## Production gates not claimed

- The migration was exercised from a clean PGlite database, not applied to a hosted Supabase project.
- Hosted Postgres concurrent writers, Realtime fanout latency, notification delivery and production RLS adversarial tests still require the deployment environment.
- Approved restore was verified transactionally in PGlite; production navigation and auth cookies require an authenticated staging project.
- No Task 9 freeze behavior or P4 semantic objects were added.

## Review

- Independent final P1/P2 review: clean.
