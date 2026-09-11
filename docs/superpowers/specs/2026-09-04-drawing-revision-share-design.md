# Drawing Revision Share Design

Date: 2026-09-04

Status: approved by the standing Universal Drawing Workspace implementation authorization

## Problem

M3 has authenticated roles, realtime collaboration, issue-mediated comments, history, and restore. It does not yet have a drawing-scoped public share link. The existing `/share/:token` flow is project-scoped and exposes project file names, source hashes, reviews, and optional review submission. Reusing that token row for a drawing would let the legacy Edge Function interpret a drawing token as a project token, so the two scopes must remain separate.

## Decision

Add a separate `lukas_qto_drawing_shares` authority for view-only links to one immutable drawing snapshot. Reuse React Router, Supabase project-role authority, the canonical snapshot validator, and the existing Canvas/PDF renderer. Add no new server, state manager, renderer, or dependency. The server derives the 32-byte link secret with a domain-separated HMAC over the exact scope and request ID so a lost response can be retried idempotently; only the secret's SHA-256 is stored.

Three approaches were considered:

1. **Dedicated drawing-share rows and server-only resolver — selected.** This keeps the legacy project Edge Function unable to resolve drawing tokens and makes the public response an explicit allow-list.
2. Extend `lukas_qto_shares`. This saves one table but couples the new scope to a legacy browser-to-Edge flow that currently returns project-wide data.
3. Share only a previously exported file. This is operationally simple but loses document/revision/snapshot lineage and does not satisfy the workspace sharing requirement.

## User flow

1. An Admin opens a revision whose current version has already been frozen by review request, review completion, approval, or supersession.
2. The top bar offers `7일 보기 링크 만들기`. Drafts do not show the action because no immutable current-version snapshot exists.
3. Creation returns an unguessable bearer token once and stores only its SHA-256, bound to the exact project, document, revision, revision version, and snapshot SHA-256.
4. The workspace lists active links for that exact revision and lets an Admin copy the newly created link or revoke any active link. Older raw tokens cannot be reconstructed from storage.
5. A signed-out recipient opens `/share/:token/drawing`, switches among the snapshot's pages/canvases, pans, zooms, and selects objects in the exact vector layer over the exact immutable PDF background when one exists.
6. Revoked, expired, malformed, deleted-project, mismatched-lineage, and stale-version links all return the same bounded unavailable state.

## Data authority

`public.lukas_qto_drawing_shares` contains:

- `id`, `token_hash`, `project_id`, `document_id`, `revision_id`
- `revision_version`, `snapshot_sha256`
- `created_by`, `created_at`, `expires_at`
- `revoked_at`, `revoked_by`, `revoke_reason`

Composite foreign keys bind the row to the document, revision, and exact snapshot. `expires_at` must be later than `created_at` and no more than 30 days later. The product creates seven-day links; there is no indefinite-link option in this slice. Create and revoke events are append-only and keyed by caller request IDs for idempotent retry.

The table is in the exposed `public` schema because authenticated workspace actions use the Supabase client. It therefore has explicit grants and RLS:

- `anon`: no table privileges
- `authenticated`: no direct table privileges; only tightly scoped list/revoke RPC execution
- `service_role`: read-only table access plus execute authority on create and resolver RPCs
- creation is service-only and receives only the actor identity verified by the server's `auth.getUser()` boundary; the database independently requires that explicit actor to remain non-anonymous and have current Admin capability
- only a verified Admin may list or revoke through the authenticated authority
- revoke is a state transition with actor, reason, and audit event, not row deletion

The public browser never queries this table. A React Router server loader uses the server-only service-role client and a service-only resolver RPC, treats the token as a bearer secret, and returns only a render-ready allow-listed public view model. The raw token is never persisted or returned by list APIs.

## Snapshot and rendering boundary

The resolver loads the share row first, then independently reloads the project, document, revision, and snapshot with every identity predicate. It rejects unless all of these are true:

- the token is canonical 32-byte base64url, hashes to the stored token hash, and is neither expired nor revoked;
- the revision still has the shared version;
- the revision status is `review_requested`, `reviewed`, `approved`, or `superseded`;
- the snapshot revision, project, version, and SHA match the share row;
- canonical JSON revision IDs, sequence, version, and project match the relational rows;
- the complete canonical graph passes the existing Zod and structure validators.

The server validates the complete canonical graph, then projects only render-time pages, canvases, layers, resolved drawing primitives, resolved block instances, selected-object summary fields, immutable lineage metadata, and exact PDF-background descriptors. It does not return canonical JSON, custom property values, tables, issues, operation outcomes/inverses, collaboration room tokens, Yjs state, storage paths, project-wide file catalogs, or mutation endpoints.

For each PDF background referenced by the snapshot, the loader independently verifies project, file ID, SHA-256, PDF kind, and immutable status before minting a 60-second signed Storage URL. The public link therefore authorizes viewing those exact PDF bytes; the product does not claim that browser-visible bytes are technically non-downloadable. IFC is not loaded by this 2D share view.

The dedicated public viewer composes the existing `DrawingCanvas` with `canEdit=false`, a local empty awareness store, and no-op mutation callbacks. It does not mount `DrawingWorkspaceClient`, so no local outbox, IndexedDB/Yjs persistence, collaboration credential request, WebSocket, export, review, comment, or private-project control is initialized.

## UI and accessibility

The authenticated top-bar control is visible only to Admins and only for frozen revisions. Creation uses a route fetcher so the one-time raw URL can be copied without entering query strings, browser history, or persistent loader data. A retry with the same request ID and exact scope derives the same bearer and returns the same result; a different scope conflicts. Existing active entries expose metadata and a separate revoke form, but not a reconstructed token.

The public screen uses semantic headings, labelled page/canvas navigation, an accessible canvas region, expiry text, and an explicit `보기 전용 · 원본 수정 불가` notice. Selection, pan, and zoom are available; editing, review submission, comment, export, and collaboration controls are not mounted.

## Errors and cache policy

Malformed and unavailable share tokens produce HTTP 404 without distinguishing why. Corrupt relational, source, or snapshot state fails closed with HTTP 404 and a bounded server-side diagnostic that never includes the raw token. Public HTML responses use `Cache-Control: private, no-store`, `Referrer-Policy: no-referrer`, and `X-Robots-Tag: noindex, nofollow`.

## Verification

The release must prove:

- migration structure, exact composite foreign keys, token hashing, idempotent audit events, explicit grants, service-only creation with explicit live Admin revalidation, and Admin-only list/revoke authority;
- an authenticated Admin calling the create RPC directly cannot supply a chosen bearer hash and leaves no share row or audit event;
- Editor, Reviewer, Viewer, anonymous, and anonymous-auth sessions cannot directly read or mutate share rows or execute create/revoke authority;
- only a frozen exact-version snapshot can be shared;
- wrong project/document/revision/version/SHA, expired token, revoked row, malformed token, and unknown canvas fail closed;
- the public loader contains no canonical snapshot, property/table/issue/operation payload, mutation action, or collaboration credential;
- the canvas displays visible vector geometry and, where present, the exact SHA-bound PDF page;
- the public browser makes no collaboration access-token or WebSocket request and initializes no drawing outbox/Yjs persistence;
- the Admin can create, copy, open signed-out, switch canvas, select/pan/zoom, and revoke a link in a real browser;
- existing project share, workspace collaboration, approval, upload, and export regressions remain green.

## Deliberate limits

- This slice is view-only. Object-thread comments and drawing-scoped external review submission remain separate M3 follow-ups.
- Draft links are intentionally excluded until draft sharing can atomically freeze a checkpoint without weakening review authority.
- A link authorizes browser viewing of an exact immutable PDF background when the snapshot uses it. It does not expose IFC, a source catalog, or a download button, but browser-visible bytes cannot be guaranteed non-downloadable.
- The raw link is shown once at creation because only its hash is persisted. Rotating or recovering a lost link means creating a new share and revoking the old one.
