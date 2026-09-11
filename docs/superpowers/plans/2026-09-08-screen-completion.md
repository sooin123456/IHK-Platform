# 1HK Screen Completion Implementation Plan

## Final status — screen-only scope verified

S1–S6 complete for the approved screen-only prototype. Consolidated requirement audit: `../specs/2026-09-08-screen-completion-audit.md`. Historical paragraphs below record intermediate pending states; this final status and the audit supersede those historical status notes. Final evidence: 215/215 regression tests, runtime typecheck/build pass, source/runtime checksums match, PDF unchanged, desktop/mobile and all key returns verified. Tab 28 additionally checked all notification branches and 390px long-query empty search/reset with no overflow. No deployment or functional backend work.

> **For agentic workers:** Use executing-plans task-by-task in the existing isolated worktree. User requested continued execution without repeated approval. Preserve unrelated dirty work; no broad commit or deployment.

**Goal:** 전체 화면 전용 흐름의 미구현 항목을 채우고 검증한다.

**Architecture:** 기존 화면을 유지하며 보조 패널은 작은 React 컴포넌트로 분리한다. 기존 PDF/검토/물량 화면의 문서·페이지·역할 맥락을 전달하고 새 파일 선택 시 화면 세션을 초기화한다.

**Tech Stack:** Existing React, React Router, shadcn Dialog/Button, Lucide, PDF.js, Node/Vite SSR tests.

**Spec:** `docs/superpowers/specs/2026-09-08-screen-completion-design.md`

## Global Constraints

- 화면 전용. 계산·영구 저장·서버 연동·외부 전송·배포 없음.
- 원본 PDF/DWG/IFC 바이트 변경·공개 자산 복사 없음.
- 상용 지원/확정 수량/실제 승인/접속 상태로 예시를 표현하지 않음.
- source: `.worktrees/universal-workspace-m1/platform`; build/runtime: `/Users/h/1hk-workspace-ui-Hwb8lI/platform`.
- 신규 의존성 없이 기존 코드·스타일 재사용. 사용자의 다른 변경 보존.

## S1 — 작업실 구성 (완료, 화면 전용)

Files: create `platform/app/lukas/components/drawing-workbench-preview.tsx`, `platform/tests/drawing-workbench-preview.test.mjs`; modify `drawing-pdf-screen-preview.tsx`.

Interface: `DrawingWorkbenchPreview({open,onOpenChange,documentName,page,ready,viewer})`; body accepts `section: "blocks"|"styles"|"properties"|"schedules"` for isolated rendering. Keep selection/search/style/property values in memory. Blocks show name/category/dimensions and a selected detail, never insert geometry. Schedules expose room/door/finish rows with explicit sample labels.

- [x] Write failing SSR test for `작업실 메뉴 열기` on the existing drawing screen.
- [x] Add body tests: each section carries same source/page, empty source has no fabricated rows, Viewer controls disabled. Query recovery covered by browser walkthrough.
- [x] Run `node --test tests/drawing-workbench-preview.test.mjs tests/drawing-pdf-screen.test.mjs`; confirmed missing entry/body produced 6 failures before implementation.
- [x] Implement component using existing Dialog/Button; keep modal exclusive with review/takeoff/mobile panels.
- [x] Re-run tests; sync only owned files to runtime; build and browser-check search/detail, local PDF, mobile, close focus.

2026-09-08 S1 verification: 173 screen-related tests passed before focus repair; focused suite re-run after repair recorded below. Runtime typecheck/build passed after repair. Browser: search-empty/reset, F-01 detail, style name preview, property code input, door schedule, 390px no global overflow, Viewer disabled fieldset, empty source schedule without rows, actual `구조.pdf` page 2 maintained. Dialog close focus originally returned BODY (reproduced twice); explicit opener restoration now returns `작업실 메뉴 열기`. Browser error logs empty. No deployment.

S1 final focused verification: 14/14 tests passed after focus repair. Original PDF SHA-256 remains `70b1e5b34dae5d2ea5a9fd171766e567b9e8acd39ea655d20ff38f836cea8f81`.

## S1b — 작성 도구·문서 (완료, 화면 전용)

Files: new `drawing-authoring-preview.tsx` and corresponding test; scoped toolbar/layer integration in existing PDF screen.

- [x] Test tool-specific controls, no-source guidance and Viewer restrictions before implementation.
- [x] Add polyline/arc/wall/opening/space options, dimension/scale form, sample selection transform controls, command search and undo/redo screen history. No source geometry changes or measurement claims.
- [x] Add page/canvas settings and layer lock/name/order example state; preserve real PDF page navigation separately.
- [x] Browser keyboard/search/empty-result and tool-switch validation; document exact limits of sample selection.

S1b verification (2026-09-08): 187/187 screen tests pass after search-focus repair; isolated runtime typecheck/build pass. Browser verified Ctrl/⌘ K focus, Escape opener restoration, search/empty results, tool switching, sample transform undo/redo and redo-branch reset. Shared layer name/order/visibility/lock appears in the left panel; new PDF resets layers. Local 구조.pdf stays on page 3/15 after workbench use. Project Viewer inputs disabled; search available. Standalone role-only URL follows existing standalone policy: audit in S6. No-source guidance verified. 390px dimension form has no horizontal overflow. Browser errors empty. PDF SHA-256 unchanged: `70b1e5b34dae5d2ea5a9fd171766e567b9e8acd39ea655d20ff38f836cea8f81`.

Limits: selection candidates are static examples; transforms/undo/redo change panel status only. Paper/canvas settings affect a schematic preview; layers do not alter source geometry. No real editing, storage or collaboration added. S3–S6 remain open.

## S2 — 원본·개정 (완료, 화면 전용)

Files: create `drawing-source-preview.tsx`, corresponding `tests/drawing-source-preview.test.mjs`; integrate through existing modebar and workbench menu.

- [x] Tests: absent IFC/DWG never displays a loaded model or successful validation; comparison identifies example versions; source/page context remains unchanged.
- [x] Add tabs for IFC relation, revision comparison and DWG readiness, with explicit example-state controls. Comparison shows labelled example metadata/changed rows; no actual source-image diff is claimed.
- [x] Connect 3D/split mode buttons to meaningful source panels without unmounting the PDF document; missing model exposes return-to-2D action.
- [x] Test source switch/reset and modal return on desktop/mobile.

S2 evidence (2026-09-08): initial tests 7 expected failures (missing modes/body/menu); final complete screen regression suite 179/179 pass. Runtime typecheck/build exit 0, served asset `server-build-BLoOwpQF.js`, process 63528 on port 4181 at verification. Browser checked source tab 18: desktop split layout; real `구조.pdf` page 3 visible in split, 3D→2D preserves page; 390×844 stacks two 330.5px viewports without global overflow; DWG uninspected/dependencies/readonly/failure/ready examples, reset and no downloads; IFC sample relation; no revisions by default, explicit R01/R02 row comparison, restore confirmation/cancel/result; Viewer restore disabled; empty source revision guidance; reselecting same PDF resets page to 1 and mode to 2D. Browser console error list empty. PDF SHA unchanged.

Two browser regressions were reproduced and repaired before final validation: IFC entry reused the previously selected styles tab (fixed by a fresh menu session per opener); takeoff anchor return from 3D left the drawing hidden (fixed by restoring 2D before focus/fit). Re-tested: IFC heading found after style→close→IFC, anchor focus restored with mode=2d; model's return action focuses the 2D button. Screenshots: `/Users/h/1hk-source-screen-KFeUQB/split-desktop.png`, `/Users/h/1hk-source-screen-KFeUQB/revisions-desktop.png`.

This does not implement IFC loading, native DWG qualification, saved revisions, actual drawing-image differences, or restoration. Those remain outside the screen-only goal's functionality boundary. S1b and S3–S6 remain incomplete; do not mark the overall goal complete.

## S3 — 협업·전달

Revised browser validation: tab 22 on current runtime (PID 66803/session 99619) verifies project Viewer cannot change recipient/evidence fields, can inspect recipient example and return. 390×844 screenshot confirms single package/recipient card and exactly one drawing-return button, no horizontal overflow or console errors. Real local 구조.pdf page 3/15 retained through export→package→recipient→drawing. Source reset removed the previous template export session. No upload/send/download. Remaining S3 audit: invitation/issue session persistence and complete empty-source policy before closing this section.

Browser evidence: tab 21 completed request→changes→draft→resubmit→two checks→approved-example→export→package→recipient→receipt-checkbox→drawing. Recipient retained template name/page 1/PDF/approved-example, errors empty; 390px no global horizontal overflow. Visual inspection exposed stacked export-completion and delivery cards with duplicate return actions. Changed runtime flow to show package instead of completion card, retaining a configure-again action. Focused 15 tests pass after this adjustment; rebuild and revised browser validation pending. Viewer/full local-PDF S3 validation still open.

Delivery implementation added: export selection feeds a package/recipient component with source/page/review context, optional evidence list, recipient example selection and local receipt-check state. No download/send endpoints. DWG remains unqualified. Four expected failures before implementation, 15/15 delivery+workflow tests pass. Full browser walkthrough remains pending; do not mark S3 complete yet.

In progress: added shared-dialog participant/issue/activity tabs and `drawing-team-preview.tsx`. Roster labels all people as examples, issue resolution is panel-local and Viewer-disabled, activity consumes existing reviewState without a second approval model. Four tests failed before implementation; 15/15 team+workflow tests pass. Runtime typecheck/build pass (existing cookie/chunk warnings). Browser tab 20 verified share→participants→issues→sample resolution→activity→same drawing, no console errors. Runtime process 65838/session 4906 on port 4181. Delivery package/recipient flow and full S3 desktop/mobile/Viewer walkthrough still pending; S3 is not complete.

Files: new `drawing-team-preview.tsx`; extend `drawing-screen-workflow.tsx`; tests `drawing-team-preview.test.mjs` and existing workflow suite.

- [x] Tests first for fake recipients/role limits, missing document, no actual invite or delivered package.
- [x] Build participant role list, invite form preview, issue/activity states, package contents and compatibility warning, recipient-side preview. Keep existing review state as owner; do not add another approval model.
- [x] Browser run request→changes→resubmit→approved-example→package→recipient→drawing, including Viewer.

## S4 — 業務 연결

Browser tab 23 verified estimate→material name→order supplier/memo→receipt discrepancy→carbon evidence→A01 return; input values cross stages, 390px no overflow, focus returns to A01 button. Added project-materials shared body with explicit template source and project Viewer restriction; project return callback uses existing safe preview URL builder. Replaced old static material-label assertions with unconfirmed-material workflow expectations; 26 dashboard/material tests pass. Project integration exists in source, runtime sync/build/browser still pending. Runtime currently PID 67506/session 58139 (drawing-only material flow).

In progress: `drawing-material-preview.tsx` provides material→order draft→receipt→evidence tabs with source/page and A01/Q01/B01/M01 example lineage. Order quantity/cost unconfirmed; no actual order or receipt; carbon unknown with missing EPD/transport factors. Viewer fields disabled. Estimate stage now opens this body in the same dialog, preserving anchor return callback. Four expected failing tests before implementation; 9/9 material+takeoff tests pass. Runtime/browser, project entry and state retention audit remain pending.

Files: new `drawing-material-preview.tsx` and test; link from takeoff estimate stage and project-materials dialog.

- [x] Test A01/Q01 lineage and no confirmed quantity/cost for draft material order.
- [x] Build material detail→order draft→receipt sample and source evidence/unknown carbon state with local stage state.
- [x] Link back to same drawing anchor where opened in drawing; project entry uses clearly labelled example drawing.
- [x] Test local PDF return and Viewer controls.

## S5 — 프로젝트·관리

Browser tab 24, current runtime PID 68735/session 19264: empty home settings→organization input→retention selection→template selection→usage→close returns `state=empty`. Notification explicit example→comment detail→example drawing→return preserves empty origin. Project Viewer material fields disabled, material anchor action opens same named project template/A01, drawing return retains project+Viewer. Project members roster→close keeps project. Error logs empty. Remaining: management mobile/keyboard audit, notification kinds need destination-specific routing (currently all open review example), project material has redundant generic drawing link to simplify in S6.

Added notification empty→explicit example detail→example drawing and reset; project-members uses shared DrawingTeamPreview roster instead of unrelated names. Two tests failed before implementation; 24 dashboard tests pass after change. Notification/member interactions are source-complete but browser route/focus validation pending. Rebuild started in session 2890.

In progress: settings now mounts `workspace-management-preview.tsx` with organization/role, retention/recovery, template and usage tabs. Memory-only inputs, Viewer-disabled fieldsets, no invented backup/usage/billing. Four expected failures before implementation; 26 management+dashboard tests pass. Project material integration and management synced to runtime, build in progress. Notifications detail, project member interactions, empty/returning route and browser checks remain open.

Files: new `workspace-management-preview.tsx` and test; scoped integration in `workspace-preview.tsx` and preview-only links in `workspace-dashboard.tsx`.

- [x] Test safe preview origin preservation for settings, notifications, members and library actions; no real mutations for crafted Viewer URL.
- [x] Replace explanatory-only settings/material/member panes with selectable list/detail/form examples. Keep organization/retention management grouped once; do not duplicate sidebar entries.
- [x] Add organization/role, retention/recovery, usage scope, notifications detail and template management preview. No price invention or checkout.
- [x] Browser verify empty project and existing project paths return to the same list/selection.

## S6 — 완료 검증

Fresh final regression 215/215 passed. Browser tab 27: real 구조.pdf page3→estimate→material→receipt→A01 returns page3/15 and focuses same page3 anchor. Invite `reviewer@example.com` displays confirmation with explicit no-send notice; issue resolution does not change review draft activity. Console errors empty. PDF SHA unchanged. Source/runtime checksum comparison (`rsync -anicR`, owned files only) has no file differences. Remaining before completion: consolidated checklist review, notification URL-to-screen browser mapping, explicitly document memory reset limits rather than implying durable editing.

Latest browser tab 26 / runtime PID 71052 session 83695: BOQ checkbox and recipient selection retained in recipient stage; E01 metadata disclosure and reset verified, carbon still unknown. Empty source share has no form; direct standalone Viewer authoring inputs all disabled. Management template pane at 390×844 visually inspected, no global overflow; Escape action and logs checked (no errors). Remaining final evidence: fresh all-screen suite, source/runtime consistency, local-PDF material return, invitation/issue flow, notification browser mapping, consolidated requirement audit/checklist.

Implemented remaining spec examples: optional unconfirmed B01 BOQ inclusion in package/recipient, and M01↔E01 fictional evidence metadata disclosure/reset. No real EPD/certification/quantity/amount/file claim. Initial new tests had registration-order error, corrected before implementation; then two expected feature failures, now 10/10 delivery/material tests pass. Runtime build/browser pending.

Spec re-read audit: S3 explicitly includes a BOQ package example, currently package only says confirmed quantities/cost excluded; add clearly unconfirmed illustrative BOQ inclusion. S4 lists missing/linked carbon evidence examples, currently only missing state exists; add explicitly fictional metadata link with no emission calculation. These are still real scope gaps, not covered by green tests. Latest boundary build passed; browser pending.

Boundary fixes: empty-source share now returns guidance without invitation form; standalone role=viewer no longer requires returnProject to apply readonly capability. Two expected failures then 42 workflow/PDF/preview tests pass. Synced these plus duplicate-material-link removal to runtime; rebuild started. Browser verification and final full regression remain pending.

Browser tab 25 on PID 69907/session 9005 verified all five state selections and approved new-revision guidance, returning focus to workbench opener. Removed project-material generic drawing link in source; failing duplicate-action test then 26 dashboard tests pass. This last source edit is not runtime-synced yet. Next audit items: empty-source sharing readiness, material/delivery panel memory lifetime, standalone Viewer route policy, notification route browser checks, management mobile/keyboard. Overall goal remains active.

Notification navigation now carries allowlisted workflowPanel (review/export/share) through URL builder, loader and screen initial state; includes panel in route instance key to prevent stale modal reuse. Request→review, mention→sharing, delivery→export. New failing URL contract test then 34 dashboard/PDF tests passed. Build/browser validation pending. Redundant project-material generic link remains to be removed.

Added explicit QA state menu/body for loading/error/offline/conflict/approved-lock. No simulated state is claimed as actual network/storage state. Offline warns memory-only input, conflict is comparison-only, approved direct edit disabled with new-revision guidance. Three tests failed before implementation; 8/8 state+workbench tests pass. Runtime build/browser still pending; full objective audit not complete.

- [x] Cover representative loading/error/offline/conflict/approved-lock states with explicit QA/example labels; no fake automatic network state.
- [x] Run all screen-related regression tests, runtime typecheck/build.
- [x] Browser walkthrough both empty/returning user paths with 390px and desktop widths; verify search empty, long names, keyboard close/focus and no page overflow.
- [x] Recheck user PDF SHA-256 unchanged; record tested routes and remaining gaps.
- [x] Mark goal complete only after S1–S6 pass; otherwise keep active and report the exact completed batch.
