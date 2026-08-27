# Drawing Workspace P7 Productization Implementation Plan

> Use subagent-driven development task by task. Each task uses test-first implementation, changed-file formatting, build verification, and independent no-edit review. Do not pause for routine approval.

**Goal:** Productize the existing P0–P6 Drawing Workspace with a current integrated UX, organization standards, tablet workflow, whole-workspace performance, retention/restore authority, organization administration, and honest production release gates.

**Architecture:** Extend the current React Router/Supabase/Konva/Yjs system. Reuse existing project canonical entities and material/BOQ authorities. Add only organization registry/provenance, retention/admin authority, and measured rendering optimizations.

**Spec:** `docs/superpowers/specs/2026-08-28-drawing-workspace-p7-design.md`

## Global constraints

- Preserve every P0–P6 invariant and frozen byte/hash oracle.
- Do not add AI, payment processing, another drawing schema, state manager, CRDT, collaboration server, microfrontend, Redis, or speculative queue.
- Do not bulk-format unrelated files. Existing repository-wide formatting debt remains separately reported.
- Preserve user-owned P4 progress/images and `.superpowers/audits/`.
- Every task ends with independent review at Critical 0 / Important 0 before the next task.
- Hosted production, real PostgreSQL, backup, and three-user gates remain nonzero `UNEXECUTED` until real authority is available.

## Task 1: Current integrated demo and canvas-first shell

**Primary files:**

- `platform/app/lukas/screens/local-drawing-workspace-preview.tsx`
- `platform/app/lukas/components/drawing-workspace.tsx`
- existing shell/preview tests and Playwright specs

**Acceptance:**

- Default preview exposes the current PDF/IFC split and P5/P6-capable state without a query flag.
- Remove stale P4 status, duplicate current participant, and mixed English/Korean product copy.
- Collapse an empty inspector and make long page/layer creation controls contextual.
- At 1280x720 the drawing remains the dominant surface and all docks can be recovered by keyboard.
- Existing drawing commands, collaboration, PDF/IFC, review, and local recovery regressions remain green.

**Commit:** `feat: present the current drawing workspace`

## Task 2: Organization-owned company libraries

**Primary files:**

- one forward Supabase migration
- drawing workspace server/action and organization library routes/components
- database contract/RLS/route tests

**Acceptance:**

- Organization registry/version/provenance for style, block, property schema, and workspace template.
- `draft -> published -> deprecated`; published versions immutable.
- Exact organization roles and RLS; cross-organization reads/writes denied.
- Project import copies existing canonical entities and records version SHA/provenance.
- No silent propagation to existing project revisions.

**Commit:** `feat: publish organization drawing libraries`

## Task 3: Tablet workspace mode

**Primary files:**

- drawing workspace shell/components
- shell unit/Playwright/accessibility tests

**Acceptance:**

- 768–1199px keeps the canvas mounted and visible while left/right tools use drawers or a bottom sheet.
- One tool surface at a time; selection reveals inspector; close returns focus to the canvas/selected object.
- Touch targets >=44px, safe-area support, toolbar scrolling, portrait/landscape coverage.
- No document-level 2,000px panel stack and no horizontal overflow.

**Commit:** `feat: add tablet drawing workspace mode`

## Task 4: Whole-workspace 10k performance

**Primary files:**

- `drawing-canvas.client.tsx`, geometry/block ordering helpers, workspace loader
- P7 performance evidence scripts/types/tests and Playwright config

**Acceptance:**

- Instrument loader/SSR, hydration, style resolution, render adapter, Konva mount, snap/hit, PDF, and IFC stages.
- Remove measured quadratic ordering/full scans.
- Viewport-window expensive Konva hit/snap/accessibility projections without dropping authoritative objects.
- Exact 10k fixture, 100-run deterministic hashes, whole-workspace first usable <=2.5s, warm p95 <=16.7ms.
- Missing trusted browser/server/runtime authority is `UNEXECUTED`, not synthetic PASS.

**Commit:** `perf: meet the large drawing workspace budget`

## Task 5: Retention, archive, backup and restore authority

**Primary files:**

- one forward Supabase migration
- project/archive/retention server boundaries and admin UI
- restore evidence runner, deployment docs, RLS/real-PG tests

**Acceptance:**

- Ordinary delete becomes archive/request-delete; approved evidence is held.
- Organization retention policies and legal holds are append-only audited.
- Trusted purge proves dependency/hold expiry before deletion.
- Managed backup -> isolated restore runner compares schema, DB counts/digests, immutable storage SHA, accepted Yjs state, approvals, BOQ/material lineage; records RPO/RTO.
- No production PASS without provider-issued backup/restore identity.

**Commit:** `feat: retain and restore approved drawing evidence`

## Task 6: Organization administration and entitlements

**Primary files:**

- one forward Supabase migration if required
- organization settings/member/project/entitlement routes and server actions
- RLS/role/route tests

**Acceptance:**

- Organization settings, exact invitations, roles, project membership/move, library access.
- Organization plan, seats, trial, quotas, and feature entitlements with append-only change history.
- No payment/checkout implementation.
- Replace administrative full-user scans with exact lookup/invite authority.
- Cross-organization and role-escalation counterexamples pass.

**Commit:** `feat: administer drawing workspace organizations`

## Task 7: P7 release and completion audit

**Primary files:**

- P7 release/production Playwright specs and evidence scripts
- third-party notices, deployment/field validation docs
- final P0–P7 requirement ledger

**Acceptance:**

- Full P0–P7 Node, real-PG, browser, collaboration, IFC/PDF, BOQ/material, performance, retention, organization, and license matrix.
- Desktop/tablet visual and interaction evidence.
- Managed backup restore evidence.
- Three distinct production users complete open -> author -> comment -> revise -> review -> approve -> export.
- Original PDF/IFC SHA unchanged, offline loss 0, approved revision immutable.
- Every explicit program requirement has direct current-state evidence. Missing authority remains nonzero `UNEXECUTED`; do not mark the program complete.

**Commit:** `docs: close drawing workspace P7 release evidence`

