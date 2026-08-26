# P3 Task 8 report — comments, mentions, sharing, history and restore

## Delivered

- Generated one additive Supabase CLI migration: `20260826020804_drawing_workspace_p3_mentions_history.sql`.
- Added explicit, immutable, same-project comment mentions with idempotent event and notification fanout. Display-only `@text` is never parsed for authority.
- Added immutable world-millimeter canvas-region anchors with composite project/revision/page/canvas integrity and finite signed coordinates.
- Reused `/projects/:projectId/members`; no parallel sharing ACL or role vocabulary was added.
- Added bounded 1–50 item operation/event history pages with independent UUID keyset cursors and provenance.
- Added actor-only, dependency-safe single-operation revert through the existing command bridge/outbox/RPC.
- Added a single `restore_checkpoint` compound operation with exact current base versions, inverse actions, tombstones and normal append-only persistence.
- Added idempotent approved-snapshot restore to a fresh-ID child draft while preserving source lineage and leaving the approved source immutable.
- Added keyboard-accessible `댓글·이슈` and `변경 이력` workspace tabs, explicit project-member mention selection, safe-revert status and approved restore navigation.
- Kept preview data local and explicit; no external write is simulated.

## Verification evidence

- Focused PGlite P3 runtime: 3 passed, 0 failed.
- Focused social/history contracts: 6 passed, 0 failed.
- Full Drawing Node: 463 tests, 462 passed, 1 intentionally skipped, 0 failed.
- `npm run typecheck`: passed.
- `npm run typecheck:collaboration`: passed.
- `npm run build`: passed; only existing chunk-size, React Router future-flag, unsigned theme-cookie and localStorage warnings were emitted.
- `git diff --check`: passed.
- Fresh Chromium at `1280px`: both new tabs and panels rendered, no horizontal document overflow, no Vite/framework error overlay, axe WCAG A/AA violations 0. Two axe items remained `incomplete` in existing canvas/dialog primitives.
- The first local preview start without environment variables correctly stopped at the existing root Supabase environment gate. Browser verification was repeated with explicit local-only preview values and performed no external writes.

## Production gates not claimed

- The migration was exercised from a clean PGlite database, not applied to a hosted Supabase project.
- Hosted Postgres concurrent writers, Realtime fanout latency, notification delivery and production RLS adversarial tests still require the deployment environment.
- Approved restore was verified transactionally in PGlite; production navigation and auth cookies require an authenticated staging project.
- No Task 9 freeze behavior or P4 semantic objects were added.
