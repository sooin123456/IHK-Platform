# 1HK frontend — fixed 40-view coverage map

This is the competitive 40-view proposal mapped to the existing frontend, not a new route-count target. Preserve the original 18 pages, 12 panels, 10 exception states and architecture/IFC/civil journeys. Backend, real conversion, real AI, mail and commercial transactions are outside the frontend goal. Their proposed UI states and navigation are not outside it.

Authoritative app: `/Users/h/Documents/GoAgent/.worktrees/universal-workspace-m1/platform`.
Status: **partial** means a relevant implementation exists, not that the complete requirement passed. **Open** means the required interaction has not been evidenced here. No row is marked complete by a render inventory alone.

| # | Proposed view | Existing entry / component | Remaining frontend acceptance evidence |
|---|---|---|---|
| 1 | New user home | home / prototype pages | New-user home and returning-project entry, explicit home and opt-in sample project separation now browser verified; broader first-use guidance remains |
| 2 | Project list | projects / local project containers | Search, multiple drawings, exact reopen, project-only overview and reversible name/discipline/archive/restore now verified;18 business-list scopes verified at desktop/mobile. Exhaustive cross-module return matrix and detailed project audit remain |
| 3 | Project creation | projects / local project containers, start / blank/template/PDF entry | Independent empty-project creation, membership, unassigned assignment, reload/portable backup, aggregate overview and edit/archive now verified; broader project-specific template/import journey remains |
| 4 | Overview and my work | overview, tasks | Selected-project overview, workspace return/reload and missing-project recovery now verified; prioritized role queue and cross-document evidence return remain |
| 5 | Drawing/file list | documents / import manifest | Selected-project drawing/linked-source filtering, exact search/return and all-documents recovery verified; unassigned sources remain common preparation files. Cross-project source reuse and complete mixed-format item actions remain |
| 6 | Import/conversion check | import and compatibility panel | DWG/IFC mock partial support, settings, retry and reopen continuity |
| 7 | Revision register | changes and delivery history | Document-set revision identity and superseded/current discovery |
| 8 | Template/block library | library / saved templates | Company standards and reusable block instance editing |
| 9 | Property/classification standards | standards / object inspector | Typed reusable schema authoring, immutable versions, explicit object application, source return and portable backup now verified; company scope, schema migration and bulk application remain |
| 10 | 2D edit/review | workspace / blank workspace | Same source, viewport and selection across edit/review |
| 11 | 3D model browsing | sample WebGL canvas | Hierarchy/visibility/selection and mock import handoff |
| 12 | 2D–3D linkage | sample split view | Exact mutual selection and unavailable-link recovery |
| 13 | Revision comparison | changes / drawing comparison | Existing historical and layer comparison; wider source/return matrix |
| 14 | Scenes/render presentation | presentation | Saved sample scenes/player/reorder/delete, PNG preview/download, browser-local gallery and exact-ID comparison verified. Viewport/1280/1920 output now rerenders at selected dimensions and restores interactive canvas; PNG header/mobile checks pass. Actual-model handoff UI remains; this is not photorealistic/AI rendering |
| 15 | Unified request inbox | tasks / review and submittal queues | General findings, assignments and due actions in one discoverable queue |
| 16 | Issue detail | local comments/findings | Named assignee, mention/reopen/reassign and draft continuity |
| 17 | Formal RFI | local RFI | Due dates/role answer/close, immutable closed-record follow-up, and pending author reassignment/date changes with reason/history now verified through draft reload and role handoff. Named project-member assignments remain |
| 18 | Submittal review | submittals | Same-project drawing package, named-recipient label, frozen data/source-return guards and supporting-file metadata/selection/reconnect/download/resubmission now verified. Actual named-account assignment and richer attachment previews remain; no server upload/security scan claim |
| 19 | Approve/return/resubmit | reviews and submittals | Clearly distinguish drawing, quantity and submittal decisions across journeys |
| 20 | Distribution/receipt | transmittals and recipient | Reference/date and individual preparation drafts verified. Same-project2–20 approved-drawing batches prepare atomically with persistent selection, shared metadata, revisions and receipt progress; recipient roundtrip preserves project. Expanded approved-source manifest and actual clearly-labelled JSON download verified. Combined drawing-file output UI and quantity/feedback draft matrix remain; actual transmission excluded |
| 21 | Quantity/evidence | quantities | Multi-unit/correction/source roundtrip matrix |
| 22 | Trade BOQ | estimate | Explicit trade/code hierarchy and amount composition |
| 23 | Rates/calculation basis | rates / pricebook, formula | CSV source-text/mapping and applied-input drafts now recover after reload, remain unregistered until explicit version import, and reject malformed restore data. Existing registered-rate→local PDF quantity/frozen-version journey verified. Company catalog scope remains |
| 24 | Change amount comparison | changes / quantity review | Comparison-to-evidence-to-review continuity across selected rounds |
| 25 | Budget/contracts/progress payment | budget, payments | Local versioned contract, request/correction/confirmation register and evidence roundtrips exist; per-line certified quantities, deductions/tax, multi-contract/project aggregation and payment execution outside the current simulation |
| 26 | Location/section overview | field / location index | Building vs civil navigation, coordinate/unit context and section selection |
| 27 | Schedule/4D | schedule | 2D period/progress exists; linked mock 3D timeline and planned/actual distinction |
| 28 | Site photo time comparison | field / photo comparison | Explicit same-source/page/object/location two-record comparison, optional observation dates, captions, exact-photo reconnect and inspection entry now exist; align/zoom comparison and integrated source-creation-to-site journey remain |
| 29 | Quality/safety inspection | field / per-record inspection panel | Local three-item checklist → correction → repeated reinspection → closure now exists; named assignment, configurable standards and cross-record task discovery remain |
| 30 | Daily work/progress report | daily / daily reports | Dated report, frozen field/inspection evidence, correction/resubmission, reviewer confirmation and exact-object return now exist; multi-location daily aggregation, named roles and payment linkage remain |
| 31 | Material requirements | materials | Approved-source requirements, product/supplier mapping |
| 32 | Orders/lead times | materials order events | Optional order/expected dates and supplier, per-order linked receipt bounds, late/due guidance and receipt shortcut now verified with reload/mobile. Shared unallocated events explicitly excluded from per-order status; supplier directory, draft continuity and reconciliation remain |
| 33 | Receipt/install/mismatch | materials | Existing event invariants; discrepancy resolution and revision carryover |
| 34 | Carbon evidence | carbon | Approved quantity × manual factor preview, source/version/unit validation, incomplete subtotal, stage-isolated drafts, frozen results and same-scope comparison exist; verified factor-library import, conversions and delivery integration remain |
| 35 | As-built/assets handover | handover / asset register | Local asset register, approved/closed-inspection readiness, frozen packages, recipient correction/receipt and approved-object return exist. Optional warranty/maintenance metadata, partial-asset selection, manual reconnect/receipt guard and reversible asset archive/restore verified. Local ZIP evidence/manual contents verified; excludes drawing/photo originals. Inline document preview and full project/drawing output remain |
| 36 | Delivery validation/export | delivery / output phase | Format diagnostics and correction-to-edit return; explicit mock output |
| 37 | Members/roles | settings / project members and sample members | Local project-owned directory, normalized emails, role-plan editing, isolation/reload and readonly settings verified. Named workflow assignment/actor routing and consistent role simulation across every workflow remain |
| 38 | External participants/share | settings / local share | Existing guest response/access recovery; draft/focus matrix |
| 39 | Audit/backup/recovery | backup, overview record index and histories | Consolidated14-kind local record discovery with project/search filters, exact submission/viewer entry and contextual return verified. Not an event-sourced/server audit. Full category destination matrix and backup verification remain |
| 40 | Organization/billing/integrations | settings / organization panel | Organization profile, plan/seat proposal, per-service simulated setup/failure/retry/disconnect and readonly/reload now implemented; usage/invoice history, integration mappings and mock expired-credential recovery remain |

## Cross-cutting requirements (not extra menu pages)

- Six task-oriented navigation groups; common settings only once.
- AI recommendations show location, source, reason, proposed action, apply/hold state. Do not represent simulated recommendations as a real model run or approval.
- DWG delivery is a required proposed output: show compatibility and output validation including failed/partial results. Do not claim a real DWG engine from mock UI.
- Preserve drawing/page/object/viewport and drafts on explicit roundtrips. Switching documents must not reuse a document-local selection ID.
- Empty/loading/failure/partial/readonly/expired/offline states need working recovery, keyboard access and mobile layout.

## Fixed end-to-end acceptance journeys

1. Design: create/import → edit → compare → review/correct/resubmit → approve → distribute → receipt.
2. Cost: object evidence → quantities → trade/rate → design change → amount comparison → approval → delivery.
3. Civil/site: section → design/site comparison → inspection/correction → progress → payment basis → as-built handover.

Do not replace these journeys with the existing shorter sample tests. Extend them as missing views are implemented. Real backend services are not prerequisites for honest simulated journeys.

## Fresh evidence, 2026-09-11

- Project business scope31669 exit0:18 route views at1440/390 exclude other-project document names without horizontal overflow; field selection/reload retains inferred project; field mutation preserves full3-document store/unrelated document; mismatch guard/all-project recovery pass. Existing quantity correction/resubmit/review/approval and submittal document-switch regressions also pass. Actual-PDF civil journey/entry/container-backup83578 and typecheck35519 pass. Navigation scoping is not authorization, and this does not complete all40 views.

- Completed inventory process: original18 plus five added views at desktop/mobile, plus original local-empty coverage. It proves presentation/overflow checks only.
- Fresh 12-panel desktop/mobile and ten exception-state desktop/mobile scripts passed (process22738, exit0).
- New two-document submittal test reproduced old selection carrying over (target had two records but only #1 rendered). The atomic document-switch fix clears `submissionItem` while retaining queue context and document-scoped drafts. New test and existing queue/lifecycle tests pass (process34983, exit0).

Contract/payment, as-built register, carbon, reusable property/classification standards and organization/subscription/integration states now have local frontend paths. The continuous civil journey now starts with actual generated PDF upload/render, UI object/manual quantity authoring and UI drawing/quantity approvals, then field record, inspection/correction, daily reporting, payment, material order/receipt/install and handover with an unrelated first document present. Desktop and390px runs pass. Structured section/photo comparison and all design-change/cost-change branches remain to be covered; this does not imply real DWG/IFC engines. Preserve remaining edit/review continuity checks.

- Fresh full inventory73212 exit0:28 major route views (18 original+10 additions including standards) at1440px and390px, plus12 local-empty routes at both widths. Headings/regions/content/error/overflow pass. Settings is still one route despite its new organization sections. This is presentation evidence, not40/40 completion.
- Fresh panel/exception process44941 exit0:12 panels at1440/390,10 exception states at1360/390 with permission request simulation, matching-original reconnect, retry, missing-scale recovery, stale calculation recovery, offline retention, expired link and empty entry actions. This does not establish real backend/network recovery.

- Property standards browser (process39039, exit0) verifies definition drafts/reload, numeric/choice schema, two-document application, version isolation, exact-object drawing return, actual JSON download/restore in a fresh browser context and post-restore application. Existing canvas-priority and template-backup regressions also pass. Typecheck and67 selected tests pass (process73356, exit0). This view is not yet included in the prior27-view inventory.
