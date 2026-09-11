# Drawing Revision Share Implementation Plan

> **For agentic workers:** use `subagent-driven-development` where tasks are independent and follow strict TDD for every behavior change.

**Goal:** Add Admin-created, seven-day, revocable public links that render one exact frozen drawing snapshot, including its exact PDF background, without exposing mutation or collaboration authority.

**Architecture:** A dedicated RPC-only Supabase authority stores only a hash of a one-time bearer token and exact project/document/revision/version/snapshot lineage. A server-only React Router loader resolves the token, validates and hydrates the canonical snapshot, projects a render-only model, validates exact immutable PDF evidence, and composes the existing `DrawingCanvas` in a dedicated read-only client. No new dependency, collaboration server, state manager, or renderer.

**Spec:** `docs/superpowers/specs/2026-09-04-drawing-revision-share-design.md`

## Task 1 — Database authority

Files:

- `platform/supabase/migrations/20260904064308_drawing_revision_share_authority.sql`
- `platform/supabase/migrations/20260904122447_drawing_share_server_issued_authority.sql`
- `platform/tests/drawing-revision-share-database.test.mjs`
- `platform/database.types.ts`

Steps:

- [x] Write and run RED behavior/contract tests.
- [x] Add `lukas_qto_drawing_shares` and append-only event rows with exact composite lineage, SHA-256 token storage, bounded expiry, paired revocation fields, and no direct anon/authenticated table privileges.
- [x] Add service-only create with explicit live Admin revalidation, verified-Admin list/revoke RPCs, and a service-role-only token resolver; use explicit `search_path`, exact status/version/SHA checks, idempotent request IDs, and immutable audit events. Remove the historical authenticated create signature.
- [x] Update generated type shape and run focused database tests GREEN.

## Task 2 — Exact server resolver and render projection

Files:

- `platform/app/lukas/lib/drawing-share.server.ts`
- `platform/tests/drawing-revision-share.test.mjs`

Steps:

- [x] Write RED tests for token parsing, one-time raw token generation/hash, frozen-state create/list/revoke calls, resolver lineage, malformed/expired/revoked/mismatched failure, graph validation, source mismatch, and public field allow-list.
- [x] Resolve with the service-only RPC and validate its JSON through existing Zod/canonical hydration rules.
- [x] Project only pages, canvases, layers, resolved objects/blocks, selection summary, lineage, and exact 60-second PDF signed URLs. Exclude canonical JSON, properties, schedules, issues, operations, storage paths, project-wide catalogs, and collaboration data.
- [x] Run the resolver tests GREEN.

## Task 3 — Dedicated public viewer route

Files:

- `platform/app/routes.ts`
- `platform/app/lukas/screens/shared-drawing.tsx`
- `platform/app/lukas/components/shared-drawing-viewer.client.tsx`
- `platform/tests/drawing-revision-share-route.test.mjs`

Steps:

- [x] Write RED route/render tests for public GET-only registration, generic 404, security headers, page/canvas navigation, visible vector model, and absence of edit/comment/review/export/collaboration controls.
- [x] Implement `/share/:token/drawing?canvas=<uuid>` with no action.
- [x] Compose `DrawingCanvas` with `canEdit=false`, selection/pan/zoom, an empty awareness store, and no-op command/lock/cursor callbacks. Do not mount `DrawingWorkspaceClient`, outbox, IndexedDB/Yjs, or realtime.
- [x] Run route and component tests GREEN.

## Task 4 — Authenticated Admin controls

Files:

- `platform/app/lukas/screens/drawing-workspace.tsx`
- `platform/app/lukas/components/drawing-share-controls.tsx`
- `platform/app/lukas/components/drawing-workspace.tsx`
- focused workspace route/shell tests

Steps:

- [x] Write RED tests for Admin/frozen visibility, role/draft denial, exact-scope actions, one-time link response and retry, browser-selected bearer rejection, active metadata list, and revoke.
- [x] Load active share metadata only for Admin.
- [x] Add `create_drawing_share` and `revoke_drawing_share` before generic drawing-operation dispatch. Derive the raw 32-byte token only in the server action with a domain-separated HMAC over the exact scope and request ID, call the service-only RPC with the server-verified actor and only the hash, and return the URL through fetcher action data; exact retries must reproduce the same link.
- [x] Mount compact top-bar controls independent of document/Yjs state and run focused tests GREEN.

## Task 5 — Real authority and browser gate

Files:

- existing disposable M1 real-database and Playwright harnesses
- production release evidence

Steps:

- [x] Prove direct table access and create/revoke RPC execution fail for Editor, Reviewer, Viewer, anonymous, and anonymous-auth sessions, and prove even an authenticated Admin cannot call create directly with a chosen bearer hash.
- [x] As Admin, freeze an exact version, create a link, open signed-out, switch canvas, select/pan/zoom, and verify object/PDF evidence.
- [x] Assert no collaboration access-token/WebSocket, mutation UI, export UI, or storage/catalog leakage.
- [x] Revoke and prove the same URL uniformly returns 404.
- [x] Run affected unit/database suites, full M1 browser gate, typecheck, and production build.

## Task 6 — Deploy exact verified candidate

- [x] Compare local/remote Supabase migrations and apply only the verified drawing-share migration.
- [x] Run the production-role canary.
- [x] Build an unaliased Vercel production candidate, verify routes and deployment-scoped logs, then promote that exact candidate.
- [x] Record deployment and rollback IDs in release evidence. Keep the broader M2–M5 goal active.
