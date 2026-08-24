# Task 9 Report — Layers and inspector

Date: 2026-08-24
Status: Complete

## Delivered

- Added local-command layer management for creating, renaming, showing, locking, and choosing an active layer. Layer deletion remains intentionally unavailable because it is not part of the canonical operation union.
- Added a native-control inspector for object name, layer, stroke color, stroke width, fill, and text for text-only selections. Mixed selections render blank shared fields and submit only fields explicitly changed by the user.
- Added atomic, version-aware multi-object property updates. A rejected object or invalid patch prevents the entire command from being produced.
- Added deterministic geometry-based object names and carried the required exact-trimmed `name` through the strict schemas, commands, loader, SQL operation validation/application/inverses, snapshots, fixtures, and tests.
- Added database-carried `system_kind` metadata. Browser layer input cannot set it, new layers are user layers, source-layer behavior is never inferred from a name or lock flag, and workspace loading fails closed when source metadata is absent or invalid.
- Added active-layer fallback and immediate selection/tool-session invalidation when layers become hidden or locked.

## Contract and security review

- Object and nested geometry/style schemas remain strict; unknown fields are rejected.
- Object names and layer names are exact-trimmed and bounded. The client prevents obvious duplicates while the page-scoped database uniqueness constraint remains the final race authority.
- Source layers must remain visible and locked. Rename, hide, and unlock attempts are rejected by both local command builders and the database operation guard.
- Each page retains at least one visible, unlocked user edit layer, and the client resolves an eligible active fallback.
- `systemKind` is excluded from browser add/update payloads and is mapped only from server-loaded database metadata.
- No direct browser database writes, outbox, persistence, new state library, layer deletion operation, or P2 behavior was added.
- Inspector and layer forms opt out of drawing shortcuts while focused; all controls use native labels.

## TDD and verification

- Red phase: focused command/route tests failed on missing names, layer builders, inspector/panel wiring, and strict metadata behavior as expected.
- Red phase: database/server tests failed on the new SQL contract as expected. The runtime suite also exposed PGlite's lack of `pg_catalog.jsonb_object_length`; the equivalent `jsonb_each` count was used and covered by the runtime test.
- Focused route and command tests: **66/66 passed**.
- Full Node test suite, including PGlite database runtime and server/route coverage: **246/246 passed**.
- TypeScript: `npm run typecheck` passed.
- Production bundle: `npm run build` passed.
- Playwright accessibility locator smoke: **11/11 required labeled controls found exactly once**.
- Repository hygiene: `git diff --check` passed.

## Self-review and remaining concerns

- Migration compatibility was reviewed across add, update, delete inverse, restore, and snapshot paths; each serialized object now includes `name`.
- Multi-select patches use the current base version of every selected object and contain only dirty form fields.
- The current P0/P1 workspace has one page. Its local duplicate-name precheck is consequently revision-wide; the database remains correctly page-scoped and is the authoritative guard for future multi-page support.
- Production build warnings are pre-existing/non-blocking: large chunks, React Router v8 future flags, and the unsigned `theme` cookie.
- Task 10 persistence is intentionally not present; Task 9 changes remain local commands.
