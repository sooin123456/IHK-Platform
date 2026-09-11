# Business workspace entry — first implementation slice

> For agentic workers: REQUIRED SUB-SKILL: use subagent-driven-development and test-driven-development to execute this plan.

**Goal:** Make the approved product/service distinction visible, remove repeated organization menus with correct space authorization, and expose one existing drawing editor through authoring/review/quantity task modes.

**Architecture:** Keep React Router loaders/actions as the authority; select workspace scope through a server-validated URL parameter. Use the existing dashboard and drawing state, renderer, outbox, permission and approval paths. Task modes affect presentation only.

**Tech Stack:** Existing React 19, React Router 7, Supabase, Konva, Yjs/Hocuspocus, Radix and Node/Playwright tests. No new package or service.

**Spec:** `docs/superpowers/specs/2026-09-05-1hk-business-model-design.md` and `docs/superpowers/specs/2026-09-05-simple-workspace-dwg-oss-design.md`.

## Global Constraints

- Preserve existing uncommitted work. No commits, staging, deployment, schema migration or live data mutations in this slice. Capture pre-edit files for task-only diffs.
- Self-service and consulting have distinct entry links. No prices, checkout, promised free entitlements, complete DWG support, or fabricated customer results.
- Filter organization memberships by authenticated user ID. RLS and existing server authorization remain authoritative; UI selection never grants permission.
- Retain projects shared directly without organization membership. Unauthorized/revoked space selection falls back safely to accessible scope; no organization deletion/merging by name.
- One menu set per active space, reachable account/settings on narrow screens, no organization list repeated in the footer.
- Mode switching must not reset the document, selection, revision, undo/outbox or collaboration. Save/offline/error/permission/approval information stays visible.
- Keep original bytes, canonical routes, cookie forwarding, anonymous rejection and current edit/approval gates.
- Tests exercise real functions/components with fakes only at external boundaries. Record expected RED and passing GREEN before reports.

## Scope boundary and follow-through

This slice covers product entry plus R1 and R3 of the approved UX design. R2's automatic idempotent personal project/document creation is a separate persistence change and is not claimed complete here; existing project-backed blank/template entry remains usable. R4 native DWG round-trip qualification and R5 templates/delivery packages remain mandatory next work, not replaced by DXF. Payment and plan entitlements require validated offers; do not implement billing from a hypothesis.

### Task 1: Server-authorized space selector and one dashboard menu

**Owner files:** `platform/app/lukas/screens/workspace.tsx`, `platform/app/lukas/components/workspace-dashboard.tsx`, `platform/tests/drawing-workspace-entry-flow.test.mjs`. A focused `workspace-scope.ts` helper is allowed only if it keeps loader/UI contracts simple. No changes to editor/public files.

**Interface:** Extend the dashboard organization descriptor with optional `is_personal` and scope props, preserving existing preview callers. URL `space=<organization UUID>` or `space=shared` identifies scope. Loader returns validated active scope and only its projects/metrics/activities. Default to the user's accessible personal space, then first accessible organization, otherwise shared. Preview without scope props must remain deterministic and inert.

- [x] Add failing real loader-boundary tests: current-user membership filter; another member's admin role cannot affect user's `can_manage`; unrecognized selection fallback; selected organization project filtering; shared-only projects remain reachable; no membership-row cap that drops a user's affiliations.
- [x] Query membership with `.eq("user_id", user.id)`; use authorized organization data and project `organization_id`. Avoid staff-global organization menus. Preserve response cookies and existing metric permission calculation. Do not weaken any RLS policy.
- [x] Add rendered UI tests with multiple organizations proving exactly one active library/settings set, shared scope without management links, distinct recent-project secondary labels and accessible space selection.
- [x] Add one native accessible space selector, independently scrollable navigation and a mobile navigation drawer using existing primitives. Filters stay within selected scope. Use `최근 프로젝트` rather than ambiguous shortcuts. Put organization management/retention links inside one settings disclosure. User identity and logout must remain reachable.
- [x] Existing new project action must not silently create in a different selected organization: either explicitly create with rechecked selected scope or clearly offer personal creation and state where it will be saved. Shared scope must not imply organization creation authority. Avoid automatic default-project creation in this task.
- [x] Run `node --test tests/drawing-workspace-entry-flow.test.mjs` and relevant public contracts. If a legacy source-string test intentionally encodes old UI, retain behavioral coverage while updating its expectation.
- [x] Self-review, report RED/GREEN and changed paths in `.superpowers/sdd/2026-09-05-business-workspace-entry/task-1-report.md`.

### Task 2: Product-first public entry with separate professional service

**Owner files:** `platform/app/features/home/screens/home.tsx`, `platform/app/core/layouts/navigation.layout.tsx`, `platform/app/core/components/navigation-bar.tsx`, new `platform/tests/business-product-entry.test.mjs`; `platform/tests/public-site-contract.test.mjs` only if an intentional public copy expectation must change (coordinate with root). No dashboard/editor edits. Product/service links belong in the existing navigation, not an additional navigation tier.

**Interface:** Primary product CTA `/workspace`, secondary service CTA `/inquiry`. Existing auth return-to routes and public Revit download/news links remain unchanged. No new route or entitlement API.

- [x] Write failing behavioral SSR/component tests for primary `직접 작업하기` and secondary `전문가에게 의뢰하기` links and distinct descriptions, including public navigation.
- [x] Revise hero and add compact task-oriented product explanation: 작성, 검토, 수량·견적 use the same workspace. Explicitly distinguish software use from commissioned modeling/quantity work. Preserve current visual language and existing credible company identity/assets.
- [x] Keep source-optional blank/template capability wording honest about existing project-backed start. Avoid claiming native DWG delivery, confirmed paid plans, or automatic final estimates. Keep consultation and Revit free-beta paths accessible without making consultation a prerequisite for software.
- [x] Update desktop/mobile navigation consistently with a clear workspace entry and service link. No layout replacement or new design framework.
- [x] Run `node --test tests/business-product-entry.test.mjs tests/public-site-contract.test.mjs`; self-review and write `.superpowers/sdd/2026-09-05-business-workspace-entry/task-2-report.md` with RED/GREEN and changed paths.

### Task 3: Task-focused modes in the existing editor

**Owner files:** `platform/app/lukas/components/drawing-workspace.tsx`, optional focused `platform/app/lukas/lib/drawing-workspace-modes.ts`, new `platform/tests/drawing-workspace-modes.test.mjs`, `platform/tests/drawing-workspace-shell.test.mjs` only for deliberately changed behavior. No dashboard/public edits.

**Interface:** Modes `author`, `review`, `quantity`, labeled `작성`, `검토`, `수량·금액`. Presentation state only; no new persisted document state. Existing panel IDs and inspector values `result`/`object` remain compatible. Mode selects appropriate visible panel group and inspector; commands that open a panel must also make its group visible. Existing `resolveDrawingWorkspacePanelKey` may take an optional visible-panel list while preserving callers' default behavior.

- [x] RED tests for mode-to-panel mapping, keyboard navigation confined to visible group, and actual editor render with task-mode controls and existing save/approval protections.
- [x] Add a compact accessible mode control without crowding the header. Author mode initially emphasizes structure, styles, blocks and object inspector. Review emphasizes comments/issues/history. Quantity emphasizes schedules/properties and result inspector. Users can switch freely regardless of professional title; actual capabilities remain gated by existing role.
- [x] Do not key/remount the canvas/editor by mode. Avoid unmounting unsaved form drafts on mode switch; if panel lifetime is already conditional, preserve visited task panels via a minimal lazy-once mount mechanism, without eagerly initializing every heavy subsystem. Keep original state and operation paths intact.
- [x] Audit every `setActivePanel` call so commands don't select a hidden panel. Do not hide save errors/outbox/permission/revision/approval information in any mode. 2D/3D visibility change only if existing IFC availability provides a reliable signal; otherwise report separately.
- [x] Test modes and real shell with `node --test tests/drawing-workspace-modes.test.mjs tests/drawing-workspace-shell.test.mjs`. Root will verify browser mode switching after creating an object and run broader collaborative regression.
- [x] Self-review and write `.superpowers/sdd/2026-09-05-business-workspace-entry/task-3-report.md` with RED/GREEN and changed paths.

### Task 4: Integration, independent review and evidence

**Owner files:** plan/progress/evidence, isolated browser verification spec if useful; implementation fixes go back to owners to avoid concurrent edits.

- [x] Compare task-only diffs against baseline snapshots, review spec compliance and code quality, fix important findings.
- [x] Run combined focused tests and `npm run build` (includes typecheck) once concurrent source edits settle. Existing baseline: 134 tests passed; unsigned theme-cookie warning predates this slice.
- [x] Verify desktop/tablet/mobile local UI, space menu counts and focus, public links, mode switching with unchanged objects, save state, and no new page errors. Run existing `npm run test:e2e:drawing-workspace-m1:local` to cover authenticated source-free and storage/collaboration regressions when runtime available.
- [x] Final architecture review completed through cross-task reviewers and root's task-only diff review. A fresh independent reviewer could not be created because the tool's agent limit was reached; this exception is recorded in the ledger. No checkout replacement, commit or deployment of the large dirty worktree.
- [x] Record exact commands/results and limitations in `docs/superpowers/evidence/2026-09-05-business-workspace-entry.md`, update this plan's checkboxes/ledger, show local result if useful and hand off a concise Korean summary of implemented vs pending features.
