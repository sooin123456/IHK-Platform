# 1HK Drawing Workspace P7 Productization Design

Date: 2026-08-28

Status: implementation contract. P0–P6 code is present, but P6 production authority remains partially `UNEXECUTED` and P7 is not yet implemented. The user approved continuous execution without additional approval pauses.

## 1. Outcome

P7 turns the implemented Drawing Workspace into an organization-ready product without replacing the existing React Router, Supabase/PostgreSQL, Konva, PDF.js, Three.js/web-ifc, Yjs, y-indexeddb, or Hocuspocus stack.

The productized flow is:

`organization standard -> project drawing -> immutable PDF/IFC -> authored object -> issue/review -> approved revision -> quantity -> approved BOQ -> material/order/receipt/carbon evidence -> retained audit/export/restore`

P7 is complete only when the latest integrated workspace is the default visible experience, desktop and tablet workflows remain usable, the exact 10k drawing workload meets the canvas/startup budgets, organization libraries and administration are authorized by RLS, approved evidence cannot be erased through ordinary project deletion, backup restore is rehearsed, and three distinct users complete the mounted production workflow.

AI recognition, classification, omission detection, automatic approval, and authoritative AI calculation remain outside P7.

## 2. Current-state facts

- The local default preview still presents a fixed `P4` badge and can hide P5/P6 source integration.
- At 1280x720 the left structure editor and IFC panel compress the drawing while an empty 18rem inspector reserves space.
- At 768x1024 panels stack below the canvas and produce a document taller than 2,200px; this is a fallback, not a tablet workspace.
- Existing styles, blocks, property schemas, and templates are project/revision owned rather than organization-owned published standards.
- Existing operations, snapshots, approvals, and audit views are strong, but owner project deletion and cascade relationships conflict with long-term approved-evidence retention.
- The last exact whole-workspace first-usable evidence is 13.7s, above the 2.5s target. P6 pure BOQ performance is separate and already within its own budget.
- Organization and project membership tables exist, but no complete organization administration, seat, plan, quota, or feature-entitlement product exists.
- Backup procedures are documented, but a managed backup -> isolated restore -> database/storage/Yjs digest comparison has not been executed with production authority.

## 3. Non-negotiable invariants

1. PDF, IFC, RVT, QTO, BOQ export, receipt, invoice, EPD, and manifest bytes keep their recorded SHA-256 values through every P7 action.
2. Published/approved revisions and their operations, snapshots, approvals, quantity/BOQ/material links, and source evidence are never hard-deleted through ordinary UI or project-owner actions.
3. Organization libraries publish immutable versions. Projects import/copy a version with provenance; later library publication never silently mutates a project revision.
4. Library, retention, organization, seat, and entitlement authorization is enforced in React Router actions and PostgreSQL RLS/RPCs. UI hiding alone is never authority.
5. Existing project/revision canonical formats remain the authored payload. P7 adds an organization registry and provenance, not a second drawing schema.
6. Tablet mode keeps the canvas visible while tools open as drawers or sheets, preserves keyboard/focus behavior, and uses at least 44px touch targets.
7. Empty panels collapse; object selection may reveal the inspector but cannot permanently steal the canvas. The default workspace demonstrates current P5/P6 features and never claims a stale phase.
8. The 10k performance fixture uses production adapters and measures loader/SSR, hydration, style resolution, Konva mount, hit/snap preparation, PDF, and IFC separately. Hand-written timing JSON cannot pass a gate.
9. Whole-workspace first usable is <=2.5s on the documented reference environment, warm interaction p95 is <=16.7ms, and no operation silently drops objects or evidence. A miss is `NOT MET`.
10. Retention policy changes, archive/delete requests, legal holds, exports, backup/restore runs, organization-role changes, and entitlement changes are append-only audited.
11. Backup evidence is PASS only after a real managed backup is restored into an isolated environment and database rows, immutable storage bytes, accepted Yjs snapshot/operation state, and approval hashes are compared.
12. Billing collection and payment processing are not introduced in P7. Organization plan, seat, quota, trial, and feature entitlements are implemented as product authority; commercial checkout is a later decision.
13. No new global state manager, CRDT, collaboration server, microfrontend, Redis, queue, design-tool codebase, or AI dependency is added without measured evidence that the existing stack cannot meet a named gate.
14. Penpot, Excalidraw, tldraw, or Rayon code is not transplanted wholesale. Only permissively licensed, narrowly justified dependencies may be reused after license and maintenance review.
15. P7 completion requires three distinct mounted production users to perform open -> author -> comment -> revise -> review request -> independent approval -> export, with original SHA preservation and zero offline loss.

## 4. Product architecture

### 4.1 Latest integrated workspace

The local preview and production workspace share one current shell and one seeded product story. The preview may use local fixtures, but it must expose current 2D/PDF/IFC split, collaboration, review, quantity lineage, and current product status. Preview-only badges identify only the local data source, never an obsolete program phase.

Desktop uses collapsible left and right docks around a canvas-first center. Tablet uses a persistent canvas with mutually exclusive tool drawers/bottom sheets. Inspector empty state is compact. Long create/edit forms appear on demand instead of permanently occupying the navigation rail.

### 4.2 Organization library

Add a small organization-owned registry and immutable version table for `style`, `block`, `property_schema`, and `workspace_template`. A published version stores the existing canonical payload, content SHA, status, publisher, timestamps, and optional predecessor. Project import creates ordinary project/revision entities plus an immutable provenance record.

States are exactly `draft`, `published`, and `deprecated`. Published versions cannot update/delete. Deprecation does not invalidate existing project imports.

### 4.3 Performance

Keep Konva and current geometry. First remove avoidable quadratic ordering and repeated full scans. Then separate visible rendering, hit testing, snapping, and accessibility projection so only viewport-relevant objects create expensive interactive nodes while the authoritative object set remains complete. Add a spatial index only after profiling and only if the existing small index helper cannot satisfy the budget.

### 4.4 Retention and restore

Ordinary project deletion becomes archive + requested deletion. Approved evidence introduces retention holds. A trusted purge boundary may delete only after the organization policy, legal holds, dependency graph, and audit evidence allow it. The restore runner consumes provider-issued backup identity and emits commit/schema/storage/Yjs/hash-bound evidence.

### 4.5 Organization administration

Organization settings manage exact member invitations, roles, projects, library access, plan, seats, quotas, trial dates, and feature entitlements. Invitations use an exact server-side identity/invitation contract, not an administrative full-user scan.

## 5. P7 release gates

- Default desktop and tablet views expose the current product generation and keep the canvas usable.
- Desktop 1280x720 and tablet 768x1024 visual/interaction tests pass with no document-length panel stack.
- 10k whole-workspace first usable <=2.5s and warm interaction p95 <=16.7ms on the documented reference authority.
- Cross-organization library, admin, retention, export, and restore RLS counterexamples pass in real PostgreSQL.
- Approved evidence survives archive/delete request and cannot be directly updated/deleted.
- Managed backup restore comparison and RPO/RTO evidence pass.
- Three distinct production users complete the end-to-end workflow.
- Existing P0–P6 IFC/PDF, collaboration, approval, BOQ, export, Revit, and material-control regressions pass.
- Third-party notices and dependency/lock fingerprints remain complete.

Missing provider credentials, production users, managed backup authority, or runtime measurement authority is `UNEXECUTED` and keeps the overall release nonzero.

