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

## Fix round 1 — 2026-08-24

Review findings addressed:

- Added `20260824113000_drawing_workspace_layers_inspector_upgrade.sql`. It adds the object `name` column when absent, deterministically backfills geometry-neutral names, enforces exact-trim/not-null constraints, repairs historical source/edit-layer invariants, and replaces the affected document creation, layer guard, operation validator/application, review snapshot, grants, and policies.
- The upgrade disables only user triggers around deterministic table backfills so approved rows can be upgraded. It never updates `lukas_drawing_operations`, `lukas_drawing_snapshots`, or `lukas_drawing_revision_approvals`.
- Authenticated layer DELETE privilege and policy paths are removed. Direct INSERT accepts only `system_kind='custom'`; direct UPDATE cannot change `system_kind`; source rename/hide/unlock/delete and loss of the last editable layer are blocked by constraints, RLS, and the layer trigger. Controlled document creation inserts the editable work layer before the immutable source layer.
- Command history now records realized database versions separately from local presence. Add/delete undo and redo emit exact tombstone bases and monotonically increasing restore/delete versions while local state continues to omit tombstones.
- Loaded layer validation now rejects invalid `systemKind`, multiple/missing sources, invisible or unlocked sources, layers detached from loaded pages, and pages without a visible unlocked non-source layer. Browser layer input remains strict and excludes `systemKind`.

Fix-round verification evidence:

- Focused commands, static database, PGlite runtime, server, and route suites: **125/125 passed**.
- PGlite direct integrity subtests: authenticated custom/system INSERT behavior, immutable identity/source UPDATE behavior, editable fallback, revoked DELETE privilege, and trusted-trigger DELETE fallback all passed.
- End-to-end history test serialized generated add/undo/redo/delete operations through the strict server parser and replayed them through the PGlite RPC to tombstone version 6 and repeated restore version 7.
- Reproducible upgrade test began with a schema lacking `lukas_drawing_objects.name` plus approved legacy-shaped object/operation/snapshot/approval state. It backfilled `Circle`, retained object version/status, byte-preserved parsed operation and snapshot JSON, and preserved snapshot/approval SHA values; post-upgrade create/apply/review also passed.
- Full Node suite: **260/260 passed**.
- `npm run typecheck`: passed.
- `npm run build`: passed (2,333 client modules and 112 SSR modules transformed).
- `git diff --check`: passed.

Legacy evidence limitation:

- The repository does not retain a separately versioned, byte-for-byte pre-Task-9 core migration fixture. The runtime upgrade test therefore reproducibly installs the core, removes the object-name column, and seeds pre-name approved JSON/evidence before applying the additive migration. This proves the schema/state upgrade and evidence-preservation behavior, but does not execute historical DDL bytes from an external deployed database dump.

## Fix round 2 — 2026-08-24

Review finding addressed:

- Authorized draft page and document DELETE operations now cascade through their source, work, and custom layers. The fresh core and additive upgrade both replace the draft-child, layer-domain, and append-only guards with the same narrow distinction: after the existing actor/capability check where applicable, only a trigger-nested FK DELETE cascade (`pg_trigger_depth() > 1`) may return the old row.
- Depth-one direct layer DELETE remains unavailable to authenticated callers through the revoked table privilege and absent DELETE policy. Trusted depth-one deletes still encounter the source and last-edit-layer guards. Direct layer INSERT/UPDATE rules, source visibility/locking, immutable `system_kind`, and the editable-layer fallback are unchanged.
- Approved parent deletion remains denied by the parent RLS/draft contract, so immutable operations, snapshots, approvals, and layers cannot be removed through a non-draft parent.

Fix-round verification evidence:

- RED: draft page deletion reached the source-layer domain guard; draft document deletion additionally reached a missing-revision child check and then the append-only operation guard. These failures established each nested cascade boundary before the SQL change.
- PGlite parent-delete tests cover authorized draft page and document cascades with source/work/custom layers, plus approved page/document row preservation.
- PGlite direct layer integrity subtests retain authenticated DELETE privilege denial and trusted depth-one source/last-edit-layer trigger denial.
- Focused database static and PGlite runtime suites: **42/42 passed**.
- Full Node suite: **265/265 passed**.
- `npm run typecheck`: passed.
- `npm run build`: passed (2,333 client modules and 112 SSR modules transformed).
- `git diff --check`: passed.
- Build warnings remain the pre-existing chunk-size, React Router v8 future-flag, and unsigned `theme` cookie warnings.
