# 1HK frontend-only workflow — implementation tracking

## 2026-09-11: dated material orders and linked receipt status

- Order events accept optional calendar-validated order date, expected delivery and supplier; expected delivery requires an order date and cannot precede it. Non-order events can reference a specific order in the same quantity revision/object. Per-order quantity bounds supplement existing aggregate bounds; unknown/cross-target links and excess linked receipts are rejected. Legacy unlinked events remain valid and are not arbitrarily assigned to orders.
- Added per-order deadline/supplier and linked outstanding status with explicit calculation basis date. Late/due rows offer direct receipt entry, while users may still record clearly-labelled common transactions. UI distinguishes linked completion from actual stock reconciliation and preserves original events. Date/supplier/order links survive document reload/codec replay.
- RED model discarded supplier, browser45741 lacked date input. GREEN33724 dated-order UI, late→linked receipt completion, excess rejection, reload/viewer/mobile and existing local materials/PDF original source roundtrip; typecheck exit0. Two material model tests pass independently. `/tmp/1hk-material-order-dates.png` inspected.
- Full frontend goal remains active. Supplier directory/product catalog mapping, material form draft continuity, shared-vs-linked reconciliation and revision carryover still need work. No purchase order was sent externally.

## 2026-09-11: configurable scene PNG output dimensions

- Added viewport/1280px/1920px width choices for sample scene output. Fixed-width capture rerenders WebGL at the selected size using the current camera aspect, appends the48px limitations footer, then restores renderer pixel ratio/size and interactive view in finally. This is not upscaled raster capture or photorealistic rendering. Unsupported sizes and excessive heights fail rather than producing misleading output.
- RED64539 missing resolution selector. GREEN4459 verifies1280/1920 PNG headers and decoded dimensions, nonblank model colors, restored canvas dimensions/CSS, mobile fixed-width output, existing native-size PNG regression and typecheck. Existing exact-ID comparison regression rerun separately.
- Full goal remains active. Actual-model handoff and broader original journeys are not established by these sample output checks.

## 2026-09-11: explicit saved-image comparison

- Added same-scenario left/right gallery selection with names, revisions and dimensions, responsive side-by-side/stacked figures and clear non-registration/non-measurement disclosure. URL stores exact image IDs; reload retains the same pixels. Missing/deleted/foreign selection is not replaced, duplicate selection is refused, and reset clears only comparison fields.
- RED51711 missing comparison; first integration91276 failed. Diagnostic98830 proved rapid second select dropped galleryLeft from the URL. Fixed pending URL composition using the existing component pattern rather than slowing the test. GREEN54924 actual distinct full/section WebGL captures, rapid selection, pixel-identical reload, mobile, deletion refusal/reset, existing gallery storage-failure regression and typecheck. `/tmp/1hk-scene-comparison.png` inspected.
- Full frontend goal remains active. This is visual comparison of sample captures, not automatic model change detection, image registration or engineering measurement.

## 2026-09-11: browser-local sample scene image gallery

- Added explicit image retention separate from temporary capture results and saved camera scenes. Validated PNG snapshots include scenario/revision/name/dimensions; the browser-local gallery survives reload and filters by sample scenario. It is not actual IFC output, server storage, device sync or included in workflow backups. Shared-device/browser-data-clear implications are disclosed.
- Limit is6 images and3M serialized characters, with2M per data URL; capacity failure preserves old entries rather than evicting. Save/delete reads latest local data, storage events refresh other tabs, malformed state is not overwritten, and storage errors do not show success. Delete requires confirmation with download-before-delete guidance; camera scenes remain unchanged.
- RED missing gallery model and browser35867 missing save action. GREEN40189 gallery and original real-WebGL PNG regression plus typecheck. GREEN75817 strengthened gallery exact-pixel reload/scenario isolation/delete-cancel-confirm/quota failure and existing modal presentation keyboard/focus/mobile regression; model validation passes. `/tmp/1hk-scene-gallery.png` inspected.
- Full frontend goal remains active. Configurable capture quality, actual-model handoff UI and richer side-by-side image comparison remain open; gallery is local preview storage, not a render farm.

## 2026-09-11: reversible asset register removal

- Added explicit author-only archive confirmation/cancel and restore for registered assets. Archived entries remain in the local document/backup and count toward the100-entry cap; they are excluded from readiness and future package selection, cannot be silently reactivated by the edit form, and leave source objects/inspection/manuals/existing packages unchanged. The archived list makes recovery discoverable after reload.
- RED model had no lifecycle reducer; browser5890 lacked archive action. GREEN41037 two model tests, full archive browser and typecheck. Browser covers cancelled confirmation, confirmed removal from selection, reload, exact historical handover equality, restoration, viewer non-editability and mobile. Existing handover ZIP journey rerun separately.
- No user project files were deleted. Full frontend goal remains active; inline attachment viewing and wider cross-module coverage remain unfinished.

## 2026-09-11: local handover archive output

- Each historical handover now has a bounded local ZIP output containing its frozen asset/inspection metadata and current package feedback/status, unique connected manual originals, and an explicit limitations README. Source drawing/photo bytes are not included or claimed. Hash-based internal paths avoid user filename path traversal; originals are rehashed and size-checked before packaging. Metadata records original filenames and archive paths.
- Missing originals disable output with exact filename guidance. At-click checks also reject cache eviction/mismatch; generation has busy/error/retry states and suppresses download after component unmount. The already-installed ZIP library is dynamically imported only when exporting. No external upload/transmission occurs.
- RED missing export model and browser76480 missing output button. GREEN67166 actual browser download unpacked and checked package2/received/manual-v2 metadata plus exact manual bytes; reload missing-original guard and mobile pass. Two model tests verify missing/wrong bytes, dedup/path safety and handover invariants. Typecheck exit0; mobile screenshot inspected.
- Full frontend goal remains active. This is a local evidence/manual bundle, not combined approved drawing output, signed official delivery or full project export. Asset removal and inline manual previews remain open.

## 2026-09-11: asset manual attachment and receipt verification

- Reused the existing bounded supporting-file input/hash cache for asset manuals, with a context-specific accessible label. Asset drafts distinguish an explicit empty selection from an unchanged registered list. File metadata is copied into the prepared handover; subsequent registration and correction preserve historical lists. Originals remain memory-only and are not represented as server uploads or portable backup bytes.
- Recipient confirmation now requires matching cached originals for every manual in the selected handover. Correction requests remain available without originals. Frozen package details expose reattachment and original download; wrong-content reattachment is rejected by the shared hash/size check.
- RED model omitted manual metadata and browser52780 lacked input. First integrated browser21739 found the test was reconnecting hidden inputs after source return; corrected the test to explicitly reopen the native details. GREEN53356 attachment journey, existing asset selection/warranty journey and typecheck; GREEN56033 shared submission attachment regression (validation, dedup, download bytes, resubmission/mobile); handover model passes independently.
- Full goal remains active. This implements local file selection/reconnect/download, not inline document preview, combined file export, server transfer or malware/content validation.

## 2026-09-11: selected asset handover and maintenance metadata

- Asset register supports optional calendar-validated warranty end, maintenance contact and plan. Drafts survive reload through existing object-scoped storage; register/handovers/backup use the extended shared schema. Existing records without these optional fields remain valid. Frozen handover entries retain old metadata after edits.
- Authors can include/exclude assets without deleting them. Preparation requires a nonempty, unique, known selection whose approved-object/closed-inspection evidence is ready; unrelated unready assets no longer prevent a partial handover. Exclusions persist per document. Correction starts with the prior package's asset membership, not all current assets.
- RED model lost warranty data; browser13621 lacked warranty input. GREEN76094 new and existing handover browser journeys plus typecheck. Strengthened GREEN6352 exercises two assets (one uninspected), selection/reload, invalid empty preparation, correction/receipt, old2027 vs new2028 warranty snapshots, exact source return, readonly/mobile and model checks. `/tmp/1hk-handover.png` inspected.
- Remaining scope includes actual manual-attachment UI, asset removal and consolidated output. These fields are user-entered reference data, not warranty verification or maintenance execution. Full frontend goal remains active.

## 2026-09-11: focused historical record navigation

- Historical review detail no longer renders the entire project overview ahead of the selected record. Its heading/breadcrumb identifies the review record, and direct links (including missing revisions without recordReturn) expose a contextual return action. Returning restores the overview rather than suppressing it globally.
- RED41688 reproduced the extra overview region; GREEN11958 verified mobile return visibility/overview restoration and typecheck. RED97546 reproduced the misleading overview heading. GREEN87478 browser verified detailed mobile entry/reload/missing-record recovery, seven business-record roundtrips and existing new/returning project overview regression. Screenshot `/tmp/1hk-original-review-record.png` visually inspected: return button and historical heading visible in the initial390px viewport.
- This is a focused navigation improvement, not completion of all40 views or the whole frontend goal.

## 2026-09-11: original returned review and record roundtrips

- Reproduced a correctness defect: the record index sent returned R1 reviews to the approved-only snapshot viewer, which instead displayed current R2 objects. Non-approved rounds now open a read-only historical record showing the frozen source name/hash, request/review/approval notes and original object list. Approved rounds retain the existing approved snapshot route. Unknown revisions fail closed instead of substituting current content; project-scoped lookup remains intact.
- RED: model test returned snapshot=1; browser6078 displayed the current approved object and no historical region. GREEN: model plus typecheck94957; desktop generated-PDF civil journey5419; mobile30288 including historical reload/hash, unknown revision recovery and seven record roundtrips (quantity, field, inspection, daily, payment, material, handover). Existing record isolation/submission/filter browser also passed in30288.
- This is historical evidence detail, not a new full PDF historical viewer or an event-sourced audit system. Full frontend goal remains active; other category roundtrips and broader40-view coverage still need completion.

## 2026-09-11: consolidated project record discovery

- Added a record index within local project overview, not an extra top-level menu. It derives entries from drawing reviews, quantity reviews, RFIs, submissions, distributions, daily reports, payments, handovers, materials, inspections, carbon evidence, comments, field notes and shares. Keys include document/kind/record identity. No invented timestamps/actors or server audit claims.
- Search/kind/document filters remain in URL, unknown filters return empty rather than substituting data, and50-row increments cap rendered results at500 with a narrowing prompt. Supported exact targets (e.g. submission ID) open readonly; other entries explicitly open their document's record screen. Return button restores the originating project and filters.
- RED model module missing and browser25595 lacked region. GREEN41172: project isolation, two document-local submission#1 records, committed-query reload, exact submission/viewer entry, project/filter return, empty recovery,390px overflow and typecheck exit0. Model index/filter/target test additionally passes. `/tmp/1hk-workflow-records.png` inspected.
- Not a complete event-sourced audit log. All14 category destination roundtrips, role-return consistency and full original journeys still require further coverage. Goal remains active.

## 2026-09-11: CSV pricebook draft recovery and broad inventory

- Pricebook import now persists bounded CSV text, selected file name/text and five-column mapping in its existing scenario session/backup state. Restored drafts reopen the importer; mapping application atomically transfers CSV and clears the source mapping. Successful version import clears the draft; failed import and readonly actions preserve it. UI discloses CSV text is included in local backups, not uploaded.
- Draft schema rejects malformed source CSV, out-of-range mapping indices and oversize text. Incomplete/duplicate column choices remain editable drafts; import validation still blocks them. Existing shared/scenario pricebook scope is unchanged, not organization storage.
- RED model had no draft and browser53227 lost mapping after reload. GREEN14974 draft model/browser/typecheck; strengthened malformed-source RED then GREEN58654 two draft/mapping model tests and browser. Existing local-pricebook script had ambiguous file input and restored-start navigation timing; changed only the verifier to wait for navigation and select the labelled PDF input. GREEN51157 passes registered-rate→PDF quantity, frozen version across later rate change, reload/mobile plus typecheck. Independent final typecheck38284 exit0.
- Full rendering inventory74810 also exit0 before the CSV UI edit:28 main route views at1440/390 and12 local empty routes at both sizes, no heading/content/page-error/overflow failures. This does not establish complete business journeys or all40 semantic requirements.
- Full goal remains active. Company-level catalog separation and remaining cross-module journeys are not completed by this increment.

## 2026-09-11: pending RFI reassignment and due-date history

- Requested RFIs now let the author change assigned role and/or due date with a required reason. Ordered immutable history preserves prior/new role/date; schema validates the chain and latest assignment. No-op, non-author, invalid-date, stale evidence, answered/closed and20-change-limit updates are rejected.
- Management fields reuse persisted role/context-specific drafts. The former assignee loses the answer action and the new role receives it; later follow-up starts a fresh assignment history while preserving its predecessor's history. No named-user/authentication/notification claim.
- RED model lacked reassignment and browser68537 lacked the form. GREEN30891: five model tests, new assignment draft/reload/history/role handoff/answered-state lock browser test, existing follow-up lifecycle and typecheck exit0. Existing unsent-compose/response draft regression55109 also exit0.
- Named project-member assignment remains; full40-view frontend scope remains active.

## 2026-09-11: closed RFI follow-up flow

- Closed RFIs can now create a linked requested follow-up with reason, new valid due date and reviewer/approver role. Original question/answer/closure remains unchanged; each closed record permits one direct follow-up. Stale source/revision/location, non-author roles, invalid dates and100-record cap reject creation.
- Follow-up form uses existing context-bound RFI drafts. New record shows its predecessor/reason, original shows its successor, and phase/assignee filters clear after creation so the new request is discoverable. No external dispatch or identity authentication is performed.
- RED model lacked helper and browser40379 lacked follow-up form. GREEN85798: creation→answer→close→source return→follow-up drafts/reload→new-role answer→reload with exact old-record equality, existing unsent-draft regression and typecheck exit0. Four RFI model tests additionally pass.
- Named-member assignments and reassignment of an in-flight request remain open. Full frontend goal remains active.

## 2026-09-11: 3D scene image result flow

- SampleModel exposes an optional scoped capture handle. Capture renders the current WebGL camera/section/visibility state immediately, copies to a PNG canvas with permanent generated-sample/not-IFC/not-approved footer, and clears the handle on renderer disposal. It does not enable costly persistent drawing buffers or add a renderer dependency.
- Presentation now supports prepare→frozen image preview→PNG download→close/regenerate, with dimensions/revision/name, explicit local volatile lifetime and model-not-ready/error retry messages. Capturing does not create a saved scene or approval. This is viewport imagery, not photorealistic/AI rendering or real imported IFC output.
- RED29170 lacked image action. GREEN12260: real browser image/download test, existing scene orbit/restore/flags/source-return regression and typecheck exit0. GREEN75117 tightened image evidence to inspect model pixels excluding the watermark/footer, then verified PNG byte signature/dimensions, frozen result after section toggle,390px layout and reload clears volatile image. `/tmp/1hk-scene-image.png` visually inspected.
- Full scope remains active. Configurable rendering/export quality, durable result gallery and actual-model handoff UI remain distinct from this verified viewport output.

## 2026-09-11: distribution manifest preview and download

- Batch register now expands to per-document approved revision/source name/pages/SHA-256/object count, receipt feedback, superseded/current and expired states. Missing approved evidence remains missing rather than being replaced with the current working source. Individual available recipient screens remain reachable from the manifest.
- Actual JSON manifest download is available, explicitly marked simulated and excluding original files/transmission/verified receipt/quantity approval. Current document titles and current local receipt states are distinguished from selected approved-source metadata.
- RED model lacked manifest builder; browser15593 lacked detail. GREEN33778: manifest+batch model tests, full batch creation/receipt/reload/detail/mobile browser test that reads the downloaded JSON and checks source hashes, member IDs and receipt states, plus typecheck exit0. Expanded mobile screenshot `/tmp/1hk-distribution-batch.png` visually inspected.
- This is a composition manifest, not merged PDF/DWG/ZIP output. Full scope remains incomplete; original18/12/10 and fixed40-view journey requirements remain active.

## 2026-09-11: same-project distribution batches

- Added persisted project-scoped selection of2–20 approved drawings with explicit per-document approved revision, shared recipient/reference/issue date. Local batch preparation validates all members before updating any; foreign/missing/unapproved/duplicate members, reused batch IDs and exhausted histories reject the whole operation. Unrelated document data stays intact.
- A batch ID is retained in current/history package records and session backups. The register summarizes document-level receipt/correction/replacement progress. Each recipient still confirms its own drawing; this is not a generated combined PDF, ZIP, email or collective legal receipt. Quantity approvals are explicitly excluded from this drawing batch.
- RED model lacked helper and browser35163 lacked batch UI. GREEN60670: model and batch browser with draft reload, same-project filtering, receipt1/2, unrelated preservation/mobile and typecheck exit0. Mobile screenshot `/tmp/1hk-distribution-batch.png` inspected.
- Additional RED18409 reproduced project context lost on recipient return. GREEN21046: project-preserving batch journey, existing delivery-draft/distribution regression and final typecheck exit0. Navigation back to preparation also retains explicit project context.
- Full40-view goal remains incomplete. Combined recipient package preview/download and complete design/cost/civil journey matrices remain; do not equate batch grouping with real transmission.

## 2026-09-11: delivery draft continuity

- Delivery preparation now uses existing session drafts keyed by document rather than disposable component state. Recipient/reference/date/revision/quantity selection survive navigation and reload; inline recipient feedback is additionally keyed by package sequence. Saved delivery records remain unchanged until explicit preparation/decision.
- Missing approved revision is displayed explicitly and cannot be prepared. No additional storage library or backend was introduced.
- RED81829 reproduced reference disappearing after reload. GREEN65064: two-document draft/reload/navigation isolation followed by distribution/recipient/history/mobile journey, existing transmittals regression and typecheck all exit0. The browser test directly exercises reference/date/recipient continuity; quantity/feedback persistence uses the same draft mechanism but has not received a dedicated end-to-end matrix yet.
- Multi-document distribution remains open; full goal remains active.

## 2026-09-11: distribution reference and issue date

- Added optional paired document reference/issue date to delivery preparation. Shared schema validates real calendar dates and rejects partial identity metadata. Codec preserves metadata on current/history packages. Existing legacy packages remain valid.
- Register search includes reference/date; recipient and saved configuration display the same metadata. Re-preparation freezes older metadata independently. These are user-entered local identifiers, not official dispatch numbering or uniqueness checks.
- RED model lacked identity and browser86550 lacked fields. GREEN26915: identity/history and register model tests, new delivery→register→reload→recipient acknowledgement browser journey with mobile/history regression, and typecheck all exit0.
- Remaining: multi-document distribution, unsaved form draft continuity and broader full-scope coverage. Goal remains active.

## 2026-09-11: named submission actor and personal queue

- Added member-filtered submission inbox and explicit simulated reviewing member selection. Named submissions require the matching email in the local decision helper; UI additionally checks current project membership and role. Role-only legacy submissions remain compatible. Decisions record the simulated actor email.
- Queue entry carries the actor into submission details, related source viewing and return. Return to the queue preserves actor and source project. These are frontend simulations, not authentication or server permissions.
- RED actors model showed role-only acceptance of a named request; browser22117 showed missing actor selection. GREEN53569: four model tests, named-member browser test and typecheck exit0. GREEN53942: extended inbox→submission→source→return→accept test and existing correction/resubmit/Viewer queue regression exit0.
- Remaining full-scope work includes named authors/reassignment, consistent actor context in other modules, and the other semantic view gaps in the coverage map. Goal is not complete.

## 2026-09-11: project directory to submission recipient

- Submission composer now selects members from the selected drawing's own project and matching reviewer/approver role. Role changes clear the directory selection; stale selections remain visible and block submission until corrected. Manual-name mode remains explicitly non-authenticated.
- Name and email are frozen into submission history; recipient selection survives reload and resubmission preparation. No invitations or external notifications are sent.
- RED browser85542 showed missing member picker. GREEN73434: new verify-workflow-submittal-members.mjs (project/role filtering, reload, role reset, snapshot and mobile), existing package correction/resubmission browser test, and npm run typecheck all exit0.
- Remaining: named actor simulation, assignee-specific personal queues, and end-to-end role handoff. This does not yet enforce recipient identity on decisions. Full frontend scope remains active.

## 2026-09-11: local project member plans

- Local projects now own optional member plans with normalized unique emails, names and author/reviewer/approver/viewer roles. Existing member form is reused with a narrowed data contract; no example people are copied into local projects. Settings distinguishes local project management from the existing sample membership UI.
- Per-project selection and admin/viewer configuration simulation persist; viewer edits are blocked in both form and local update helper. Project cards link directly to their member settings. No real invitations, login identity, membership mutation or server ACLs are performed.
- RED model lacked saveProjectMember, browser98928 lacked local member region. GREEN56243 verifies project isolation/reload/readonly, existing sample-member management and organization settings. Model/typecheck86128 passes. Final8005 verifies direct card entry/mobile plus archive management regression; typecheck56267 passes. `/tmp/1hk-project-members.png` inspected.
- Next integration is selection of these members as named submission actors/assignees and distinct personal queues. This turn establishes the project-owned directory; it does not claim named workflow enforcement yet. Full goal remains active.

## 2026-09-11: supporting-file submission UI

- Added up to5 supporting files per submission (10MB each): PDF/DOCX/XLSX/CSV/TXT/PNG/JPEG extension allowlist, SHA-256 metadata, duplicate-content rejection, removal, draft persistence and immutable submitted metadata. These are local file selections, not server uploads or format/security scans.
- Originals live only in bounded tab-runtime memory (10 files/64MB). Reload/backup retains metadata only. Exact hash/size reconnection and original byte download are available; mismatches are rejected. Missing originals block acceptance, but not correction requests. Resubmission restores the previous attachment list without modifying prior submissions.
- RED metadata test dropped files; UI91745 lacked input. GREEN1719 passed attachments/package/existing submittal flows. Extended85095 verifies removal→resubmission restores original metadata and retains old history. Five model tests pass097416 (draft limits/escaping, hash mismatch/cache eviction, acceptance guard, package sources, history). Typecheck82092 passes. Mobile screenshot `/tmp/1hk-submittal-files.png` inspected.
- Remaining: authenticated named-account assignment, actual external delivery, richer document previews, and the rest of the40-view acceptance matrix. Full frontend goal remains active; backend storage/security scanning is not claimed.

## 2026-09-11: related-drawing submittal packages

- A submission can include up to9 other same-project drawings (10 with the main drawing), plus an optional named recipient label. Draft selection/name persist per primary document. This is a local metadata/snapshot package, not uploaded attachment delivery, account assignment or identity enforcement.
- Each included drawing freezes title/revision/source label and canonical drawing data key. Missing/changed/foreign-project related drawings prevent acceptance; author correction/resubmission freezes a new package while retaining the previous one. Duplicate/self/foreign/missing attachment selections are rejected in the model.
- Related source viewing returns to the main submission document and preserved reviewer/queue context, rather than treating the inspected related drawing as the submission owner. Queue cards show named label/attachment count and evaluate whole-package freshness.
- RED model dropped new package fields; UI31101 lacked recipient/selection. Browser34012 exposed missing related-source return. GREEN25378 passes package draft/reload, same-project candidates, source return, stale-related-source rejection, linked resubmission snapshots/mobile, and all3 existing submission lifecycle/document-switch/queue regressions. Model71418 passes3 tests; final typecheck81851 passes. `/tmp/1hk-submittal-package.png` inspected.
- Full goal remains active: arbitrary supporting-file attachments, actual named-account assignment, external transmission, and full project design/cost/site journey coverage are not claimed complete.

## 2026-09-11: project information and reversible archive

- Project cards now edit name/discipline and expose explicit archive confirmation/cancel, active/archive/all filters, and restore. IDs and document membership are unchanged; archive is explicitly list organization rather than deletion or permission enforcement. Existing work remains accessible; new drawings/assignments require an active project.
- Optional archive state participates in session/backup validation, preserving compatibility with older projects. New creation guards cover blank/import/template handlers and explain actual blocking reason instead of incorrectly always reporting the30-document limit.
- RED model lost archive field and browser71212 lacked management UI. GREEN77847 covers rename, empty-name guard, archive cancel/confirm/reload, unchanged drawing data, archived creation guard and restore/overview. RED18266 caught misleading disabled reason; GREEN25412 passes the fix plus entry and actual template-backup regressions. Typecheck/schema45276 passes.
- Full frontend goal remains active. This does not add server permissions, permanent delete, detailed project audit history or complete all40-view journeys.

## 2026-09-11: project scope across business lists

- Business-list consumers (quantity/BOQ, issues/RFI, review queues, site/materials, comparison/delivery, schedule/submittals/transmittals, budget/daily/payments/handover/carbon/standards) now receive project-filtered documents. Global search, project listing, backup and mutation stores retain the complete document collection.
- Project context is explicit when supplied, otherwise derived from the page's selected document. Field document changes that replace URL parameters therefore retain their owning project after reload. A mismatched project/document selection remains unavailable rather than switching projects. Common scope banner provides explicit all-project recovery.
- RED35682 reproduced another project's field option. GREEN83777 covers18 business views, document switch/reload, field record mutation preserving all3 documents and unrelated document equality, mismatch guard/all-project recovery. Typecheck35519 passes. Existing entry/container-backup and actual-PDF civil approval→site→payment→materials→handover regressions83578 pass.
- This establishes visible-list scoping, not backend authorization or every cross-module return path. Named participant roles, project edit/archive, unresolved40-view requirements and full journey matrix still remain.

## 2026-09-11: project-scoped drawing/source lists

- Selected-project drawing lists now use membership filtering. The drawing-list→workspace→reload→drawing-list return preserves project and search. Explicit all-drawings action clears the project/search restriction. The existing project recovery banner also covers document lists.
- Import views show the selected project's linked sources plus clearly labelled unassigned common preparation files, not sources already linked to another project. Global file-count limits remain based on all import records, not filtered length. This is navigation scoping, not authorization.
- RED59263 reproduced another project's drawing; RED2677 reproduced100 source records instead of1. GREEN44664 passes project source filtering/global capacity, actual PDF mixed-file import/error/dedup, local document navigation, expanded project-entry/list/overview roundtrip. Earlier98104 passed project containers/backup. Typecheck56683 exit0.
- Remaining: project scoping for quantity/review/site and other aggregate modules, shared-source reuse across projects, project edit/archive, and full40-view acceptance. Existing global import dedup remains; this change does not claim cross-project source cloning.

## 2026-09-11: first/returning entry and project overview

- Default frontend entry now shows home without local projects/drawings and projects when work exists. Explicit page links remain authoritative. Sample projects require an explicit sample entry and have a return-to-my-projects action; local and example cards no longer occupy the same project list.
- Project cards open a selected-project overview filtered by document membership. General workspace→overview navigation and reload retain the project context. Missing project IDs show an explicit recovery state, not all drawings. Global all-document overview remains separately accessible.
- RED9531 reproduced new users landing on projects. GREEN14068 passes entry/project overview, project-container portable backup, existing sample-project navigation and local/sample-scope regression. Typecheck37241 exit0. Mobile `/tmp/1hk-project-entry.png` inspected.
- Scope still partial: project-aware filtering of all other workflow lists, project edit/archive and the full architecture/IFC/civil acceptance journeys remain. No backend, permissions, actual project aggregation service or deployment added.

## 2026-09-11: user-owned project containers

- Added typed local projects (name and architecture/civil/both discipline) separately from drawings. The projects page creates empty projects, groups multiple drawings, searches names/drawings and retains legacy unassigned drawings with explicit assignment. Existing sample projects remain independent.
- New blank/import/template documents take the explicitly selected project; opening existing imported documents never changes membership. Unknown project IDs block creation rather than silently assigning elsewhere. General navigation derives project context from the current document.
- Projects and document membership are included in session persistence and portable backup, with duplicate IDs/dangling membership rejected. Backup replacement discloses projects. Existing snapshots without projects remain valid.
- RED: model assertion lost project state; browser17510 lacked create UI. GREEN: model/typecheck96150, project browser65559 (including download/fresh-tab restore, reload, missing-project recovery and unassigned assignment). Existing example-project and template-backup regressions99377 pass. Mobile screenshot `/tmp/1hk-project-containers.png` inspected.
- Remaining: project-specific aggregate overview, edit/archive controls, unified first-user/returning-user entry and clearer separation of sample projects. This does not complete all40 semantic views or provide backend project membership/security.

## 2026-09-11: source-photo enlarged inspection view

- Added an accessible modal to the shared source-photo preview, available in draft/record/comparison contexts after exact original reconnection. Fit/2×/4× display uses the original object URL inside a keyboard-focusable scroll area; source bytes and metadata are unchanged. Explicitly not enhancement, automated difference detection or an engineering decision.
- Escape/close restores focus to the exact initiating photo button. Existing dialog primitives reused; long filenames wrap, mobile outer dialog stays bounded while the inner photo scrolls.
- New keyboard-enlarge test78083 failed first. Browser42863 passes new open/close/focus behavior plus existing comparison, durable draft and field regressions. Extended83570 confirms actual2× scroll extent,390px dialog width and screenshot. Typecheck10433 passes. `/tmp/1hk-field-photo-expanded.png` inspected.
- Full frontend goal remains active. This is independent photo enlargement, not synchronized dual-image alignment, full render pipeline or actual remote photo storage.

## 2026-09-11: drawing correction/resubmission in connected workflow

- Extended actual-PDF civil journey with reviewer changes request, author object-name correction, quantity-basis reconfirmation, resubmission, reviewer completion and approver decision before downstream quantity/site/material/handover actions. Final assertions retain original name/changes record and new approved name; payment quantity and handover reference the approved replacement revision.
- Trial75932 stopped at quantity request after object rename invalidated its basis. Inspection confirmed the existing quantity UI discloses changed evidence and excludes it; added explicit author reconfirmation before drawing resubmission rather than bypassing the guard or rewriting application validity rules. Desktop50129 passes the full branch. Mobile74280 checked separately.
- This adds real UI branch evidence, not a new backend feature. Overall goal remains active: not all approval/cost-change/3D/40-view cases are proven.

## 2026-09-11: real PDF authoring through civil handover, desktop and mobile

- Replaced approved-document/quantity fixtures in the connected civil browser with actual UI start: create blank document, upload generated PDF with visible plan graphics, verify rendered dark pixels, create/name overlay object, enter manual quantity/unit/rate/basis, request/review/approve drawing, then request/review/approve quantity. Only an unrelated empty first document and base scenarios are seeded.
- Continues in the same browser/document through field record, failed inspection, correction/reinspection, daily approval, contract/payment confirmation, material order/receipt/install, scoped delivery and asset handover receipt. Dynamic generated document/object IDs replace fixed fixture IDs; source metadata hash matches actual PDF bytes and unrelated document remains untouched after reload.
- First trial19162 stopped because the test changed units after entering rate; source inspection confirmed existing intentional rate clearing on unit change. Corrected UI input order, not production safety behavior. Desktop44092 and mobile35831 pass the full extended browser. No application implementation change needed in this increment; verification now covers a materially larger actual workflow.
- This supersedes older notes calling approved drawing/quantity fixture prerequisites. Still not full goal completion: generated test PDF is not user DWG/IFC, quantities are manual, this path lacks design-change/BOQ-change branches and structured section/photo comparison, and no external approval/payment/dispatch is performed.

## 2026-09-11: field Viewer role survives evidence return

- Fresh regression41406 proves Viewer→drawing→field reset role to Author. Persisted the selected frontend field role per document in existing drafts, keeping explicit role changes possible. Form edit gating now requires a known author/reviewer role instead of merely not-Viewer.
- Updated browser makes an explicit Author selection before continuing its authoring branch; it first verifies Viewer is preserved and review drafting disabled both after return and reload. No silent permission promotion is relied upon by the test.
- Local-field, durable draft and connected civil/material/handover browsers31221 pass. Typecheck81108 exit0. This is frontend role simulation, not backend authorization; full goal remains active.

## 2026-09-11: unsubmitted field-photo metadata recovery

- RED34292 reproduced photo list disappearing before submission on reload. Unsubmitted photos now use per-document draft metadata (name/hash/size/MIME), validated by existing photo schema. No source bytes are serialized or uploaded. Reuses original photo reconnect/identity validation and existing session/backup path.
- Metadata is stored as individual bounded fields rather than JSON chunks so escaped500-character names remain within the draft limit. Up to three slots are atomically updated/cleared; successful record submission transfers metadata to the record and clears the draft slots without changing other documents.
- Final browser26274 passes photo attach→reload→same-original reconnect→document switching→submit→reload and existing local-field regressions. New model test passes three long escaped filenames, bounded values, cross-document isolation, clearing and invalid MIME rejection. Typecheck35523 checked separately.
- Full frontend goal remains active. Temporary role choice remains local component state; real photo-byte persistence/server storage are not claimed.

## 2026-09-11: durable per-document field authoring drafts

- Reproduced title/date/location loss on refresh (70605). Field title, note, optional date, selected object, observation condition, location mode and building/civil segments now derive from the existing per-document draft map. No duplicated effect-based state or new storage library.
- Existing session format caps each draft string at500 characters. The1000-character observation text is stored in two chunks and restored losslessly; schema limits were not weakened. Successful submit clears title/note chunks only for that document while retaining useful location defaults and other-document drafts.
- Browser67631 passes long-text refresh, date/structured location restore, two-document draft isolation, successful submit reset and persisted observed date. Existing local-field and photo-comparison browsers also pass. Typecheck66371 exit0.
- Photo attachments in unsubmitted drafts and temporary role selection are not made persistent by this change; source-photo bytes still require reconnect. Full frontend goal remains active.

## 2026-09-11: same-location field photo comparison

- Added a collapsible comparison inside local field records. Explicit first/second selection is scoped to current filtered document records; candidates require same source hash/page/object/coordinates/location and structured path, excluding unrelated locations. Both cards show date/title/location/revision/note/photos and reuse existing SHA-256 photo reconnect. There is no visual-diff/AI/alignment or automatic engineering verdict.
- Field records accept optional validated observation date; old records remain compatible and show date-not-recorded rather than invented timestamps. Input is explicitly a user observation date, not verified photo EXIF. Comparison choices/open state use existing drafts/backup. Missing selections are disclosed without fallback.
- Comparison button opens the exact second record's existing inspection details and scrolls to that record; it does not approve or mutate inspection results. Mobile cards stack without overflow.
- New browser64586 failed on absent comparison;81527 passes two dates, incompatible location exclusion, wrong-photo rejection, two reconnected images, reload selection preservation/missing-photo UI and exact inspection entry. Typecheck27280 and67 selected tests pass. Existing field/inspection/civil journey regression35398 checked separately. `/tmp/1hk-field-comparison.png` inspected.
- Full goal stays active. Photos are local reconnections after refresh; no server persistence/certified timestamps/automatic difference analysis. Initial source authoring and complete comparison-to-handover journey are not implied by separate tests.

## 2026-09-11: expanded full-screen/panel/exception verification

- Added standards to the executable full inventory, preserving all18 original pages and12 local-empty entries.28 major route views at1440/390 pass, including settings and presentation after their latest changes (73212 exit0).
- Original12-panel desktop/mobile and10-exception desktop/mobile recovery scripts pass (44941 exit0). Verified simulated permission denial/request, original identity reconnect, retry, missing scale, stale calculations, offline draft retention and expired-link exit. No production network recovery claims.
- Updated the coverage ledger to remove stale claims that organization was absent or that no connected civil segment existed. Kept the full40-view and initial design/cost/civil acceptance gaps open. Next meaningful unimplemented site step is explicit same-location photo comparison; passing inventory is not completion.

## 2026-09-11: saved-scene ordering and confirmed deletion

- Added accessible per-scene forward/backward controls and numbered list; order stored per scenario in existing draft/backup map and consumed by the presentation player. Invalid order data falls back to available scene order; removed IDs are ignored and new scenes follow ordered scenes.
- Delete requires an explicit confirmation naming the scene and explaining loss of saved camera metadata, backup recovery and preservation of model/approval data. Cancel changes nothing. Deleting the selected scene clears selection to the explicit default view rather than silently opening another saved view. No model/source changes or new renderer.
- New browser32108 and order model assertion failed first; browser59187 now passes order→reload→actual player next/previous ordering, cancel/confirm deletion, selected reset and mobile. Existing scene capture/restore and presentation focus/draft/reload/Escape regressions pass. Typecheck and scene model test13881 pass. Screenshot `/tmp/1hk-scene-management.png` inspected.
- Full goal remains active. Real IFC/render output, media export and other40-view/journey requirements are not implied by sample scene management.

## 2026-09-11: material and delivery scope in connected civil journey

- Extended the same multi-document browser journey through material order/receipt/install and scoped delivery before asset handover. RED64309 shows materials defaulting to unrelated first document despite `contextDocument=civil-chain`, because its dedicated selector key was missing from shared navigation. Added `materialDocument` and `deliveryDocument` mappings.
- GREEN25209 verifies all three material events on the selected civil document, selected-document-only delivery, final handover receipt and untouched unrelated document. Existing material bounds/reload/Viewer/empty/missing regression also passes. Typecheck70709 checked separately. Only local frontend records are mutated; no actual procurement/inventory/distribution happens.
- Full original/expanded frontend scope remains active. This extends the already-approved-design journey, not initial authoring/approval, actual source rendering, legal handover or full product completion.

## 2026-09-11: civil site-to-handover connected UI journey

- Added `verify-workflow-civil-handover-journey.mjs`. Only prerequisite approved drawing/quantity is seeded. Browser creates the field record, failed inspection, correction, successful reinspection, daily report and reviewer confirmation, contract/payment request and confirmation, asset registration, handover preparation and recipient receipt, then reloads and checks the linked document/object/history.
- Initial single-document flow passed. Adding an unrelated first document reproduced a real navigation failure: general menu `go` discarded document selection and daily reporting defaulted to the unrelated document, disabling submission. `go` now carries explicit local document selection across mapped destination selectors and intervening menu pages through `contextDocument`; sample navigation does not inherit that local context. Specific document selectors take precedence.
- Multi-document journey and existing payment/daily regressions pass (68668 exit0); typecheck40049 exit0;65 workflow model/render tests pass. Final handover screenshot inspected. Same-date exact-report nested-return coverage from the preceding increment remains covered by payment regression.
- Scope boundary: this does not prove initial import/edit/approval, actual PDF rendering/hash of bytes, structured station navigation, photo time comparison, mobile full-chain execution or DWG delivery. Source metadata identity is checked; the source is an explicit fixture. Full frontend goal remains active.

## 2026-09-11: organization, subscription proposal and integration settings

- Added three compact sections inside existing settings, not duplicate sidebar entries: organization profile, plan/seat proposal and external integration simulation. Existing member planning remains present. Values reuse same-tab drafts/backup; explicit local-only notice and no credential inputs, OAuth, network connections, payments or entitlement claims.
- Profile saves name/discipline; proposed personal/team/organization plans disclose unconfirmed prices and no billing. Seat range/integer/personal-seat validation blocks invalid save. Per-service simulated setup, cancel, permission failure, retry, connected and confirmed disconnect states preserve other services and existing drawing data. Viewer role disables mutations; disconnect confirmation resets on role/service/tab change.
- Browser43982 failed first because the view was absent. Browser1077 passes profile/proposal/setup/failure/retry/disconnect/reload/readonly/mobile; extended16210 checks invalid seats and service isolation. Existing member browser31949 passes. Typecheck74739 exit0. Mobile screenshot `/tmp/1hk-organization.png` inspected with no horizontal overflow. React review: direct derived draft values, stable component boundary, no extra storage/state library or effect-based mirrored state.
- Full goal remains active: detailed usage/invoice UI, mapping/expired integration examples and end-to-end civil workflow remain unfinished. No actual billing or integration implementation is represented by these screens.

## 2026-09-11: exact daily-report evidence and nested payment return

- Fresh browser regression reproduced payment evidence linking only by date: a second unrelated same-date report appeared alongside the cited report. Payment navigation now passes document-local `dailyReport`; daily history shows that explicit report, discloses a missing target without substitution and offers an explicit selection reset. Changing document/date clears the local report selector.
- Daily → drawing/field → daily retains report selection and payment return/role. Verified payment → report #1 (same-date #2 excluded) → object drawing → report #1 → reload → original payment reviewer with unsaved review opinion preserved → confirmation.
- Browser process28017 passed expanded payment flow and existing daily lifecycle/mobile regression. Typecheck44982 exit0; payment/daily domain tests2/2 pass. A test navigation race was diagnosed from URLs and corrected with positive destination/heading assertions before reload, not sleeps or relaxed assertions.
- React checklist: selection remains URL-derived; no duplicate state/effect, new dependency, server call or backend mutation. Full civil/site-to-handover acceptance remains open; this proves only the nested evidence segment.

## 2026-09-11: reusable property standards — drawing return and portable restore verified

- Existing in-progress standards implementation now verified end-to-end: typed text/number/choice definitions, immutable version storage, per-object values, explicit document selection, draft reload, exact-object drawing preview and return. Approved snapshots keep their original properties; template capture excludes business properties. No server or production writes.
- Fresh reproduction found the compact drawing-return row inherited20px top margin from generic form actions, pushing canvas origin to563.39px at1440×900. Scoped workspace CSS removes that margin; the unchanged550px assertion now passes. Screenshot `/tmp/1hk-property-canvas.png` visually checked with collapsed properties and selected object visible.
- Browser process39039 passes standards creation/application/versioning, actual backup download and fresh-context restore/reuse, mobile width and browser errors; existing local-canvas-priority and template-backup regressions pass. Process73356 typecheck and67 selected model/render tests pass.
- Full goal remains active. Company-scoped standards, bulk application/migration, organization/subscription/integration UI and the extended civil-to-handover journey are not proven complete. No claim that a feature-specific browser replaces full journey evidence.

## 2026-09-11: saved-scene presentation mode

- Added a focus-managed modal presentation mode for explicitly selected saved sample scenes. Previous/next controls stop at the sequence boundaries, show the scene name/index, and load the saved camera/section/grid/isolation into a separate read-only stage. Presenter selection is separate from editor selection, so slide navigation/closing does not overwrite the uncommitted editor name. Presentation URL retains the displayed slide on reload; closing returns to the original edit scene.
- Uses the existing dialog/focus trap and renderer. Escape/exit returns focus to the start button. No-op save/config controls are absent in the presenter, and original current-versus-saved-revision warnings remain. Mobile inspection caught unstyled24px buttons outside the main app; common dialog styles and44px presenter controls now apply.
- New browser failed first on absent entry, then passed modal navigation, readonly controls, unsaved editor preservation, focus return, reload/Escape and mobile overflow. The test expectation was aligned with the stated original-editor return rather than replacing it with the last presented scene. Fresh scene capture/restore/roundtrip and existing WebGL camera regressions pass;66 selected model/render tests and typecheck pass. `/tmp/1hk-scene-presentation.png` re-inspected after styling.
- Full goal remains active. This closes the first manual presentation-navigation gap, not scene ordering/deletion, media export, actual IFC/rendering or broader frontend requirements. No backend/deployment changes.

## 2026-09-11: reusable 3D presentation scenes

- Added `presentation` as the twenty-third major view under Drawing/Model. Default local entry explicitly reports no connected actual model and requires an explicit sample-entry action. Sample mode reuses the existing dynamically loaded Three.js renderer, not a second engine or image stand-in. It stores named camera position/target plus section/grid/isolation settings in the existing same-tab draft/backup map.
- The renderer now updates the shared camera reference on orbit changes, enabling live capture rather than saving only during unmount. Saved scene selection remounts an isolated camera reference and restores settings. Scene records are validated for finite bounded coordinates/nondegenerate camera/name/scenario; missing selected records do not fall back. Revision mismatch discloses current geometry versus original scene revision. No geometry/quantity/approval state changes are made by saving a scene.
- Model/browser tests failed first on absent scene support; an additional UI check removed a no-op selection affordance from the presentation context by making the reused renderer's selection callback optional. Fresh browser passes actual WebGL orbit capture, flags, reload and scene switching; original WebGL camera/grid/section/isolation/reset regression passes.66 selected model/render tests and typecheck pass. `/tmp/1hk-scenes.png` visually inspected at390px without overflow.
- This is a generated sample-model presentation flow only. Actual IFC/CAD connection, photoreal materials/lighting/render output, media export, scene management/presentation playback and full model coordination remain incomplete. Full frontend goal stays active; no backend/deployment changes.

## 2026-09-11: approved-estimate budget comparison

- Added `budget` as the twenty-second major view inside Quantity/Estimate navigation. Users choose a local document and approved quantity-review sequence, inspect frozen quantity/rate/review evidence, and store an explicitly hypothetical budget/reserve/basis against that sequence. Saved sequence remains pinned instead of following later approvals; unknown/unapproved targets are not substituted.
- Comparison shows budget minus included reserve, the selected approved amount, and remaining/overrun amount. It never reads the mutable current estimate into the approved total. Unsafe integer totals are withheld; empty/negative/fractional/out-of-range inputs, reserve above budget and missing basis are rejected. Failed input leaves the last stored comparison unchanged. Existing session drafts store plan and input separately.
- Model/browser tests failed first on missing module/page and then on absent explicit comparison-sequence handoff. Corrected navigation now sends the selected approved sequence to the quantity-comparison view and preserves budget identity on the direct return. Browser evidence covers approved1,200 versus unapproved99,900 isolation, budget2,000/reserve300/remaining500, invalid reserve retention, reload, unapproved-target recovery and mobile.70 selected model/render tests pass. `/tmp/1hk-budget.png` visually inspected; invalid unsubmitted input remains visibly separate from stored results.
- This is a single-document scope review, not project contract/cashflow/profit or actual financial advice/approval. Multi-document budget allocation, contracts, progress payment, baseline revisions and extended return paths remain open. Full frontend goal remains active; no backend/deployment changes.

## 2026-09-11: cross-document distribution/receipt register

- Added `transmittals` as the twenty-first major view under the existing Delivery section. The register derives current and historical packages from actual same-tab document deliveries, without creating another status store. Search spans document/recipient/approved source; filters distinguish actionable receipt waiting, received, corrections, previous configurations and unavailable current configurations. Total versus visible counts are separate.
- Current valid packages open the existing pinned recipient view. Acknowledgement updates the existing delivery state; return preserves search/status, so a received package leaves the waiting filter. Superseded configurations retain original recipients/comments and are read-only; expired/missing approval/invalid quantity evidence cannot open as a valid current package. Preparation is explicitly not actual dispatch and receipt remains simulation.
- Model/browser tests failed first on the absent module/route. Final browser validates search/status URL and reload, actual recipient acknowledgement, exact register return, waiting-list update and immutable historical receipt. The verifier now waits for filter URL commit before triggering reload.69 selected model/render tests, typecheck, register browser and full existing quantity→drawing approval→delivery→recipient browser pass. `/tmp/1hk-transmittals.png` visually inspected at390px without horizontal overflow.
- Full goal remains active. Official transmittal numbers/dates, multi-document packages, dispatch evidence, named recipients, large-list paging, and other original/expanded screens remain incomplete. No backend/deployment changes.

## 2026-09-11: actionable submittal queue and exact return

- Local Tasks now aggregates unresolved submissions across documents by simulated role, sorted by due date. Reviewers/approvers see assigned pending submissions; authors see returned items only until a linked resubmission exists. Document-local submission IDs are not merged. Viewer/unknown roles receive no actionable items.
- Queue entry opens the exact document/submission and preserves the originating role. Selected submission view offers explicit all-history recovery rather than replacing missing IDs. Resubmission advances the selected record to the new ID; Viewer roundtrip preserves item and queue context, and returning to Tasks refreshes the actionable list.
- New model/browser tests failed first on missing queue functionality. Browser also exposed a pre-hydration role selection reset; the queue now disables role interaction and discloses recovery until tab state is ready. Fresh browser passes request→review queue→correction→author queue→resubmit→review queue and exact Viewer return. Prior submittal lifecycle/stale guard passes;67 selected model/render tests pass. Mobile screenshot `/tmp/1hk-submittal-queue.png` inspected without overflow.
- Goal remains active. Named assignments, queue search/filter/paging, multi-file submissions and other original/expanded frontend requirements remain open. No backend/deployment changes.

## 2026-09-11: drawing submittal review loop

- Added `submittals` as a twentieth major frontend page, under the existing Review navigation rather than a new top-level menu. It selects an actual same-tab document and provides submission title, assigned review role, due date, explanation, review comments, return/resubmit lineage and acceptance history. Local data is not labelled as the sample project's revision. Missing documents remain explicit rather than substituted.
- Submission metadata and canonical drawing-data identity are saved per document through the existing session/backup schema. An unchanged drawing still matches after schema decode/reload; changes to drawing data disable acceptance and current-as-submitted viewing. Requested corrections allow a linked new submission while preserving earlier comments. Acceptance does not alter drawing or quantity approval. This is role simulation and metadata review, not real transmission, historical drawing reconstruction or engineering approval.
- Current drawing opens in Viewer with a direct return preserving selected document and role. Submission/comment drafts use existing persistent draft keys. Invalid dates, missing notes, wrong roles, duplicate resubmission of the same return and100-record limit are guarded.
- Model/browser tests failed first on the missing module/page. Further checks caught canonical object-key ordering after decode and sample-scope heading leakage; both corrected. Browser then passed actual navigation→submit→return→resubmit→accept→reload→Viewer return, original approval isolation, actual workspace edit→stale acceptance block, and390px overflow check.120 selected model/render tests, final typecheck and all three original architecture/IFC/civil journeys pass. `/tmp/1hk-submittals.png` visually inspected.
- Full frontend goal remains active. Multi-file/product-data submissions, named assignees, outstanding-work aggregation, filters/paging, frozen visual submission inspection, formal transmittals/receipt and broader40-view coverage remain open. No backend/deployment changes.

## 2026-09-11: manage personal saved templates

- Added a collapsed, selected-template management region with persistent per-template rename drafts, trimmed nonempty names, save feedback, and explicit removal confirmation identifying the exact template. Switching template remounts the keyed management region so deletion consent cannot carry to a different template. Removing a template clears its rename draft and selection, without touching source/copy documents; no automatic fallback selects a different template.
- Deletion disclosure says existing drawings remain and advises backup because undo is not provided. This is a local frontend capability, not company library administration. No real user templates were removed while developing; browser checks use isolated contexts.
- New browser test failed first on the absent management region, then passed blank-name refusal, unsaved rename/reload, saved rename/reload, cancellation, consent gating, removal persistence and source/copy preservation. Mobile confirmation screenshot `/tmp/1hk-template-management.png` inspected with no horizontal overflow. Existing template reuse, portable backup, builtin templates and start-draft browser tests pass.66 selected model/render tests and final typecheck pass; initial typecheck found a Record indexing error corrected before final verification.
- Full goal remains active. Company template distribution/versioning, broader40-view proposal and original requirement-by-requirement completion remain open; personal rename/removal is no longer missing. No backend or deployment changes.

## 2026-09-11: personal drawing templates and portable recovery

- Library now captures the selected page's shapes/styles/layers into a personal same-tab template and creates independent editable documents with fresh object IDs. Source files, quantities/rates, comments, schedules and approvals are excluded; page is normalized to1. Source and sibling copies remain independent. Existing builtin starters remain available; names/selection use the existing session draft map.
- Saved templates are validated by the session/backup codec (maximum20, unique identifiers, valid layer references, no quantity evidence). No server/company sharing, version approval or actual source conversion is implied.
- Added a browser backup journey using the real downloaded JSON in a new browser context, explicit replacement confirmation, reload and creation from the restored template. The new test first exposed missing template-count disclosure on the restore screen; the UI now counts reusable templates and explicitly includes them in the replacement warning and backup scope.
- Fresh checks:119 selected model/render tests, typecheck, `verify-workflow-template-backup.mjs`, `verify-workflow-saved-templates.mjs`, and `verify-workflow-backup.mjs` pass with terminal exit0. `/tmp/1hk-saved-templates.png` visually inspected at mobile width. Earlier unobserved process result was not reused; process inventory showed no active test runner before rerunning.
- Full frontend goal remains active. Template rename/removal/version/company distribution, original18/12/10 completion audit, and the proposed40 major views remain incomplete or unaudited. No backend or deployment changes.

## 2026-09-11: reduce schedule setup chrome

- Collapsed date-basis editing and calculation explanations behind native disclosures. Applied date remains visible in the collapsed summary; invalid saved dates remain visible outside the disclosure. Opening/closing without applying retains the local input; an applied changed date remounts the summary closed.
- Drawing mode now uses a2:1 drawing/editor desktop grid above900px while preserving the existing single-column mobile layout. List mode remains unchanged. No controls, evidence warnings or saved data were removed.
- New layout browser test observed the old equal-width layout then passed collapsed fields, unsaved-toggle preservation, applied-date summary, drawing/editor width ratio and mobile overflow. Updated calendar flow explicitly opens the disclosure before input. Fresh layout, real-PDF drawing, dependency and full calendar/return browser tests plus typecheck pass. `/tmp/1hk-schedule-layout.png` inspected; mobile still has a long stacked editor and broader layout work remains open.
- Overall frontend goal stays active; this is incremental usability work, not completion of scheduling, 4D or other expanded product screens. No backend/deployment changes.

## 2026-09-11: schedule plans on the actual 2D drawing

- Added list/drawing view switching within Schedule. Drawing view reuses the actual PDF reconnect renderer (or clearly labelled source-free vectors), displays current objects by page and colors them by planned waiting/active/period-complete state. Missing plans, stale geometry, invalid day and dependency conflicts remain separate states; reported progress never drives a false completed-construction color.
- Objects are keyboard/pointer selectable into the same schedule editor. View/page/day/object context survives reload and the dedicated Viewer workspace roundtrip. Invalid page/view choices have explicit recovery rather than silent substitution. Rendering does not alter original source or object style; hidden-layer objects are explicitly included for review.
- Model/browser tests failed first on missing state helper/view. Rapid date→page updates exposed lost URL state and were fixed with an atomic pending-query reference; then the new roundtrip test exposed the missing view/page callback context and was fixed in both directions. Final browser validates real two-page PDF rendering, planned colors despite0% reported progress, object selection, reload, source/document identity before navigation, stale predecessor state and mobile layout. Existing date/dependency browsers pass.
- Fresh71 selected model/render tests and typecheck pass; `/tmp/1hk-schedule-drawing.png` inspected. This is a 2D planning overlay, not 3D/4D simulation or historical geometry/actual progress. Full frontend goal stays active; broader scheduling/model/other page requirements remain open. No backend/deployment changes.

## 2026-09-11: finish-to-start schedule dependencies

- Optional predecessor IDs now survive plan serialization. The schedule editor offers registered sibling-object plans, describes the single-predecessor finish-to-start rule, and blocks saving cyclic, missing, stale-source or overlapping predecessor chains. Legacy plans without a predecessor retain their meaning.
- List rows show predecessor labels and warnings. Extending an upstream task can leave downstream dates in conflict; the UI surfaces that conflict and withholds the misleading plan/report comparison rather than silently moving dates. Manual correction clears the warning. Drawing locations, quantities and approval records are not changed by dependency validation.
- Model and browser tests failed first on discarded predecessor data/missing controls. Final tests cover dependency persistence, self/two-node cycles, missing/stale predecessor, overlap refusal, upstream-change warning and manual correction. A rapid object-switch test now waits for the selected object's restored input before typing; the assertions still require the new saved period. Existing calendar/multi-document/geometry-return browser flow passes.
- Fresh70 selected model/render tests and typecheck pass; populated mobile screenshot inspected and no horizontal overflow observed. Remaining: multiple predecessors, other relationship types, work calendars, arbitrary-length schedules, automatic rescheduling/critical path, actual history and 4D. Overall frontend goal active; no backend/deployment changes.

## 2026-09-11: calendar display for object schedules

- Added an explicit per-document D1 calendar basis, stored in the existing session drafts. Applying it maps task offsets to ISO dates; changing the basis moves that document's displayed dates only, retaining durations, progress, drawing and quantity data. Users can return to relative-day-only display. The UI explains that all calendar days, including holidays, count.
- Added calendar date navigation synchronized with the existing selected day and exact workspace return. Invalid dates/ranges are rejected without substituting today's date. UTC date-only arithmetic avoids timezone shifts; unit fixtures cover month/year and leap boundaries plus invalid/out-of-range dates.
- Model/browser tests first failed on absent conversion helpers/date controls. Final browser passes date application, D5 date selection, reload and exact drawing return, two-document basis isolation, invalid empty-date refusal and basis shift preserving duration/progress. Mobile screenshot inspected. Fresh69 selected model/render tests and typecheck pass.
- This adds calendar labeling/navigation to the existing 30-day frontend planning window, not project scheduling certification, holidays/work calendars, arbitrary-length scheduling, dependencies, historical actuals or 4D simulation. The complete frontend goal remains active; no backend/deployment changes.

## 2026-09-11: first object-linked schedule screen

- Added a nineteenth registered page, `schedule` / 공정·작업 구간, reachable under the existing 현장 contextual navigation without adding another top-level sidebar section. It operates on same-tab local documents and never substitutes sample schedules for empty or missing documents.
- Users select an actual drawing object, explicitly save a D1–D30 relative period and reported progress, compare the report with evenly distributed planned progress at a chosen day, view duration bars, and open/return from the exact drawing object in Viewer mode. Date/object/document context is retained on this dedicated roundtrip; saved plans use the existing validated draft map and backup path.
- Records bind original hash (or explicit source-free state), drawing revision/page/object/position. Changed positions/revisions block the old location opening and omit misleading plan-vs-report comparison until explicit re-save. Invalid periods/progress leave the previous plan untouched. Plan/report data do not mutate quantities, approvals or financial values.
- Model/browser tests failed first on absent module/page. Final browser passes empty/start, plan entry, D5 50% plan vs20% report, reload, exact drawing return, invalid period, stale-position rebind, contextual navigation and mobile width. Inspected `/tmp/1hk-schedule.png`. 68 selected model/render tests and typecheck pass; all original18 pages×2 widths,12 empty-local routes×2 and three original architecture/IFC/civil journeys pass.
- This is a frontend relative-duration planning preview, not actual calendar scheduling, weighted progress, historical actuals, predecessor/critical-path calculation, certified inspection, payment calculation or 4D simulation. Those expanded flows remain incomplete. Unsaved form recovery, deletion/history, bulk task handling and role-preview coverage also remain open. Overall goal active; no backend or deployment changes.

## 2026-09-11: quantity evidence roundtrip retains drawing comparison

- Root Changes callbacks now carry an allowlisted drawing revision/target/page/object/visibility context when changing quantity comparison selection, opening current or frozen drawing evidence, and returning to Changes. Switching the selected document still starts fresh context rather than carrying another document's object IDs.
- Extended the real quantity-edit/review/approval browser journey with a frozen drawing-approval fixture. Test first failed when quantity target selection removed drawingRevision. After implementation, all five context fields survive quantity selection, current-workspace return/reload and prior-approved-snapshot return; restored drawing selection and checkbox are visible.
- Fresh quantity journey and historical drawing comparison browser tests pass, along with 67 selected model/render tests and typecheck. This closes the specific callback gap from the preceding increment, not the broader keyboard, multi-document, library or expanded product-screen requirements. No backend/deployment changes; full frontend goal stays active.

## 2026-09-11: drawing comparison view continuity

- Comparison URL now retains page, selected object and identical-object visibility alongside the historical revision pair. Revision changes reset page/selection; page changes clear selection. The existing atomic selection ref preserves rapid changes without separately competing route updates.
- Reloaded selection can return keyboard focus to its change-list item even when the original clicked button no longer exists. Ordinary inline navigation retains the exact clicked-button focus behavior. Invalid/out-of-range pages show recovery selection and do not render a substituted page.
- Browser test first reproduced page 2 reverting to page 1 after reload. Final extended historical test passes page/filter/object restoration, focused list return, browser back, missing-page recovery and historical/current PDF comparisons; original overlay PDF zoom/page/exact-button-focus regression also passes. 67 selected model/render tests and typecheck pass.
- Test adjustments wait for async URL-backed checkbox state and use a correctly relative locator for the focused list item. These are test synchronization/locator corrections, not weakened state assertions. Drawing documents remain unchanged in the browser fixture.
- Full goal remains active. Explicit quantity-comparison → workspace → changes callbacks still need to carry drawing context; browser history evidence does not close that separate path. No backend or deployment changes.

## 2026-09-11: template start draft continuity

- Replaced component-only selection/name state with controlled values in the existing validated session drafts map. Navigation/reload and existing backup serialization retain both without adding storage keys, libraries or schema versions. Creating a valid template document clears only the two start-draft entries; an explicit reset leaves existing documents intact.
- Unknown saved template IDs show an alert, no substituted preview and disabled creation. Choosing another template keeps the entered name. Overlong restored names cannot create documents.
- Browser test first failed on name loss after leaving Library, then passed navigation/reload, successful creation, reset/reload, unavailable-template recovery and mobile width. Existing office/site independent-copy and civil polyline creation/reload tests pass. Fresh 66 selected model/render tests and typecheck pass. React review kept state updates functional and used the existing versioned storage path, with no effect-driven duplicate draft state.
- Full frontend goal remains active: this closes start-input continuity only, not company-managed template/block/version/property workflows or the expanded downstream screens.

## 2026-09-11: cross-document field locations and recovery

- Added building/civil/free-text location-prefix aggregation across stored local documents. Each record retains document identity, source/revision/page/object context and stale-anchor protection. Aggregate exploration and selected-document authoring are separate sibling regions, preventing ambiguous duplicated records within the authoring area.
- Browser evidence covers two documents with identical record IDs, prefix selection, exact-object return/reload and disabled stale geometry. Extended the verifier to an unknown location: initially failed on the missing recovery action, then passed explicit reset without losing the selected document. Inspected populated mobile screenshot `/tmp/1hk-field-locations.png` and verified no overflow.
- Fresh 114 selected model/render tests, typecheck, location browser test, original local-field test and photo-review/approval/delivery/independent-recipient regression pass. No production services or deployment changes.
- Overall frontend goal remains active. This is same-tab location exploration, not real project aggregation or certified inspection. Company library, named-person workflows, larger lists and expanded schedule/model/cost screen journeys remain incomplete or unverified. The competitor-informed 40-screen proposal supplements, rather than replaces, the original completion requirements.

## 2026-09-11: civil template and faithful library preview

- Verified live routing: Library uses WorkflowTemplateLibrary, not the older presenter cards that all open properties. Added a third, source-free civil/rail schematic with an alignment polyline and inspection/structure/material zones. Selection displays included objects, intended use and exclusions; new work is independent and has no source, quantities or approvals.
- Preview now renders the exact generated template objects through the editor shape renderer rather than an independently hard-coded rectangle layout. Existing office/site templates retain their geometry/independent-copy behavior.
- Red tests covered missing civil template/entry. Browser reload exposed non-normalized polyline fixture coordinates; corrected using existing draftPolylineGeometry and added normalized-range assertion. Fresh113 model tests and typecheck pass. Civil create/reload and existing office/site edit-isolation/reopen browser tests pass; mobile `/tmp/1hk-civil-template.png` inspected.
- Remaining: company-managed template/block versions, import/export and property/quantity templates, selection/name draft continuity and other full frontend requirements. This is a schematic starter, not railway alignment design, stationing, earthwork calculation or a company-certified standard. Full goal active.

## 2026-09-11: local canvas prominence

- Extended canvas-first layout verification to actual local blank and PDF documents. Reduced local title/status/toolbar gaps; grouped source-help and filename metadata into a wrapping row without hiding original connection/error states. Styles stay local to the workspace; shared PDF renderer gained only a metadata wrapper.
- Red browser evidence: blank canvas initially began at539.39px at1440×900. Intermediate checks isolated toolbar margin and stacked PDF metadata; final blank<=500px and connected PDF surface<=550px checks pass. The same test creates a real PDF, reconnects it, places/selects an overlay rectangle and checks mobile width. `/tmp/1hk-local-canvas-priority.png` inspected.
- 112 model tests and typecheck pass; local inspector focus/draft navigation, quantity→approval→delivery recipient and local sharing regressions pass. This covers default desktop layouts, not every long-title, expanded panel or multi-document condition. Full frontend goal remains active.

## 2026-09-11: broad regression audit and canvas-first spacing

- Fresh pre-change inventory passed 18 original sample pages at desktop/mobile plus12 empty-local routes at both widths, 12 panels at both widths, ten exceptions at both widths and architecture/IFC/civil correction→resubmit→approval→delivery journeys. These verify defined presentation/actions, not all30 proposed pages or production capabilities.
- Visual inspection revealed excessive workspace chrome: the sample drawing viewport began at y712.89 in a1440×900 window. Added a workspace-specific compact layout for title, scope controls, contextual navigation and closed backup area without hiding warnings, role/scope distinctions, backup or drawing tools. It now begins within460px and exposes at least400px of canvas vertically before scrolling. Other pages retain their spacing.
- Red/green `verify-workflow-canvas-priority.mjs` measures the viewport and checks retained heading/disclosure/backup and mobile width. `/tmp/1hk-canvas-priority.png` visually inspected. Post-change typecheck, all12 desktop/mobile panels, three scenario journeys and actual local inspector navigation/focus regression pass.
- Audit table reconciled with completed CSV mapping, historical/layer comparison, invite/access and grouped-estimate work. Remaining gaps still include local/sample integration parity, library workflow, location aggregation, full keyboard/history/draft coverage and proposed extension screens. Goal stays active; no backend/deployment changes.

## Latest verified increment: CSV file and column mapping

- Existing scenario pricebook import accepts UTF-8 CSV files up to300KB/100,000 characters, reads locally, presents title columns and first-row inspection, and lets users assign distinct code/name/unit/rate/source columns. Exact known headers preselect; unknown headers require manual assignment. Extra columns are discarded only on explicit mapping application; existing text remains untouched until that action.
- Existing quote-aware CSV parsing is reused for both mapping and registration. Quoted commas/newlines survive; malformed quoting, invalid/missing/duplicate column choices and unequal data widths are refused. XLSX/encoding/file errors have recovery guidance. Applying mapping fills the existing preview, and only explicit version-save registers entries. Async stale reads are ignored on replacement/unmount. No server or real company library changes.
- Red model/browser evidence: missing map helper and file input. Fresh 112 model tests, typecheck, new file→mapping→preview→save/reload browser flow and existing pricebook version/pinned-rate/Viewer regression pass. Duplicate columns are blocked; populated mobile mapping and error screens inspected/captured at `/tmp/1hk-pricebook-mapping.png` and `/tmp/1hk-pricebook-file.png`.
- Remaining: unsaved file/mapping draft recovery, broader encoding/size/async browser matrix, scenario/company scope consolidation and other original frontend requirements. No actual Excel conversion; full goal active.

## Latest verified increment: estimate search and return continuity

- Grouped estimates now search item/code/source/unit/document/object with explicit group-level semantics. Overall totals remain separate from displayed-group subtotals; empty results and reset are available. The query and expanded exact group identity persist in URL and travel through the exact-object workspace handoff and return. Missing/changed group identity displays an explanation rather than expanding a different group.
- Red evidence: search input absent. Fresh two-group browser fixture proves 1,900 overall vs 500 visible, no-results/reset, search+expanded group after workspace return/reload, missing group guard and mobile width. Screenshot `/tmp/1hk-boq-groups.png` inspected. 111 model tests, typecheck and quantity→drawing approval→delivery recipient regression pass.
- Remaining: full keyboard focus/back-forward matrix, deliberate BOQ mapping and trade hierarchy, file-column import, other original frontend integrations. No backend/deployment changes; goal active.

## Latest verified increment: grouped estimate and evidence return

- Local Estimate now differs from raw Quantities with a grouped BOQ summary. Matching registered/demo rate identity, version/source/name, unit and rate aggregate quantities and already-rounded row amounts. Uncoded manual entries remain separate per document/object; stale/unlinked rows are excluded with explicit counts. Totals remain unapproved and exclude tax/overhead.
- Each group expands to exact document/object/page evidence links. Estimate origin is retained through the workspace’s quantity/estimate return action, including ordinary item-list entry; quantities still returns to quantities. No document or approval mutation from grouping.
- Red evidence: absent grouping module/region. Fresh 111 model tests and final typecheck pass, including separate units/rates/versions/manual entries and stale exclusion. Browser verifies grouped amount/provenance, exact second-page object and estimate return; original quantity→drawing approval→delivery→recipient flow also passes. Populated mobile `/tmp/1hk-boq-groups.png` inspected.
- Remaining: deliberate BOQ code mapping, trade hierarchy, selected group/filter return, column/file import and other original full frontend requirements. This read-only grouping is not a complete estimating engine or certified takeoff. Goal remains active; no backend/deployment changes.

## Latest verified increment: layer-change review

- Drawing comparison now reports layer additions/removals and name, visibility, lock and list-order differences separately from object geometry. Historical targets use their frozen layer snapshot; legacy missing layers use the same default layer as the editor. Overlays continue to show hidden objects for review, explicitly labelled, without mutating records.
- Red model/browser evidence: no layer comparison result or displayed region. Fresh 110 model tests, typecheck, historical comparison browser test and existing PDF overlay/page/focus regression pass. Populated mobile layer comparison captured at `/tmp/1hk-layer-changes.png` and inspected.
- Remaining: page/object/filter persistence and cross-route return context, grouped BOQ/code mapping, other original frontend flow requirements and accepted expansion. Full goal remains active; no backend/deployment changes.

## Latest verified increment: historical drawing-pair comparison

- Local changes now offers an approved baseline and either current work or another approved drawing revision. Historical target geometry/source comes only from that selected round; a missing/unapproved target does not fall back to current work. Same-revision selection shows no geometric changes. Original PDF hash compatibility remains mandatory and no records are changed.
- Both selectors persist in URL query parameters. Browser testing exposed consecutive selection losing the first value while navigation was pending; the handler now carries both selected values together, following the quantity-comparison pattern.
- Red evidence: the model used the live source/objects despite a historical target and the target selector was absent. Fresh history browser test passes consecutive selections, reload, actual PDF rendering, current/same/missing target and mobile width. Existing drawing-overlay test passes moved/deleted/added objects, page navigation, keyboard focus return and PDF zoom. 109 model tests and final typecheck pass; mobile screenshot visually inspected.
- Remaining: layer-only changes, selected page/object persistence, cross-route comparison return, grouped BOQ and other full frontend requirements. This is stored overlay-geometry comparison, not PDF pixel-diff, IFC processing or certified engineering analysis. Full goal active.

## Latest verified increment: local share invitation response

- New local shares start pending. Recipient preview now shows frozen title/revision, disclosure and view/comment permission before any drawing. Matching-email simulation can accept or decline; mismatch shows an inline alert. This is explicitly not identity verification, mail delivery or drawing approval.
- Accepted shares retain their response through session reload and allow existing permission-scoped feedback. Declined shares hide drawing/feedback, retain the decision through reload and direct users to request a new share. Expiry remains higher priority; owner reactivation does not automatically accept an invitation. Sender cards display invitation state. Older shares without this field retain their previous behavior and are labelled as having no invitation record, not falsely accepted.
- Red evidence: new-share state was undefined and guest route immediately displayed drawing without invitation. Fresh `verify-workflow-share-invitation.mjs` passes mismatch, accept/reload, decline/reload, exact-share isolation and mobile overflow; `/tmp/1hk-share-invitation.png` visually inspected. Existing actual-PDF sharing, access-request lifecycle and two-document inbox browser regressions pass. 108 model tests and typecheck pass.
- Remaining: shared identity/role simulation across workflows, decision drafts/focus, populated mobile/keyboard matrix, and the broader original frontend scope plus proposed expansion. Goal remains active. No backend/auth/deployment changes.

## Latest verified increment: cross-document share request inbox

- Local tasks now aggregates pending access requests across documents/shares, with document/recipient/reason search and explicit author/viewer simulation. It reuses the existing owner-decision component; successful decisions remove only the resolved request from pending results and retain its source history.
- Opening a request's guest view carries exact document/share identity plus search/role return context. The return button names the share inbox when that was the origin. This is local workflow navigation, not a real authorization boundary.
- Red evidence: two real locally created shares/requests had no aggregate inbox. Final two-document browser test passes duplicate #1 identity isolation, search/roundtrip, Viewer rejection, exact deny/allow, queue removal/reload and mobile width. `/tmp/1hk-share-inbox.png` inspected. Existing access lifecycle and 107 model tests pass; typecheck run for the changes.
- Remaining: invitation/account acceptance, unsent owner-decision drafts and focus return, role unification, fully populated mobile inbox matrix and other original frontend requirements. No backend/deployment changes; goal active.

## Latest verified increment: local expired-share access requests

- Expired local shares now offer a same-snapshot access request. Requests and owner reasons persist in share history; pending duplicates are blocked, declined requests can be followed by another request, and a maximum of20 requests preserves prior records. Only author simulation can allow/deny a pending request.
- Allowing access reactivates only the selected frozen share without widening its view/comment permission or quantity disclosure. Denial retains expiry. Neither path changes drawing/quantity approval, sends a notification or grants real access. Unknown shares do not expose the request form.
- Red evidence: absent request helpers and missing expired-share request input. Fresh 107 model tests, typecheck and `verify-workflow-share-access.mjs` pass request/reload, owner rejection, repeat request, owner allow, retained history and unchanged view-only guest. Actual PDF share/feedback/expiry regression also passes.
- Remaining: a cross-document owner request inbox, invitation/account acceptance, role/focus/draft matrix and mobile request-view inspection. Full goal active; no backend/deployment changes.

## Latest verified increment: local document sharing

- Actual local workspace now has share setup and a separate recipient route, not only the sample-project share panel. Author simulation saves recipient, view/comment permission and opt-in quantity disclosure in a frozen snapshot (max20 shares). Hidden-layer objects and internal comments/RFI/review records are excluded; default snapshots omit object quantity. Full PDF reference disclosure is explicitly stated, not presented as page-level redaction.
- Recipient sees only the selected snapshot with readonly vector/PDF display, can append up to50 feedback entries only for an active comment-enabled share, and returns to the sender's exact workspace. Sender sees feedback and can expire the selected share. Unknown/expired shares never substitute current drawings. These are same-tab previews, not real invitations, authentication, links or approvals.
- Red evidence: missing share module/composer. Fresh 106 model tests, typecheck and `verify-workflow-local-share.mjs` pass creation, independent guest, no default quantities, actual PDF/reload reconnect, frozen label after live-document mutation, feedback/reload, expiry, view-only and unknown-share blocking. Prior blank-canvas guest run also passed. Mobile `/tmp/1hk-local-share.png` inspected; inspector-navigation regression passes.
- Remaining: local invitation accept/decline/account switching, expired-access request/owner decision, named-member roles, share history/search/drafts and broader redaction/hidden-layer browser matrix. Full frontend goal remains active; no backend or deployment changes.

## Latest verified increment: local documents and navigation isolation

- Broader inspection found local documents rendering the sample A-101 table below the real import manifest. A new browser regression reproduced this actual mixed-scope output. Documents now participates in explicit local/sample scope and has an independent local-work list with title/source search, empty state and exact-ID opening.
- The same regression exposed the sidebar's active section targeting the current workspace without its `blank` ID, replacing a real local drawing with sample geometry. Section buttons now navigate to their section's first page. Local workspace navigation without an ID routes to selection, and a direct local workspace URL without an ID shows local document choices instead of a sample. Search survives opening/return/reload.
- Fresh targeted evidence: local-documents browser test passes both reproduced failures, two-document search/exact return, missing-ID selection and explicit sample switch; mixed-file import regression, 105 model tests and typecheck pass. Mobile `/tmp/1hk-local-documents.png` inspected. Original 12-panel desktop/mobile and ten-exception desktop/mobile checks pass, as do architecture/IFC/civil correction/resubmit/approval/delivery journeys. Page inventory was extended with local documents/workspace/issues coverage and rerun separately.
- Remaining full-scope items are unchanged: local sharing, richer library/geometry/history, assignment and broader role/navigation matrices. Presentation checks are not full product completion. No backend/deployment changes.

## Latest verified increment: interrupted import recovery

- All batch selections are now recorded as pending before file hashing/parsing, then updated by stable record ID. Leaving or refreshing retains uncompleted selections; no background processing is claimed. Pending/failed entries expose per-file reselection instead of silently disappearing.
- Resume requires matching name/size and, when already recorded, the same SHA-256. A pre-hash interrupted entry explicitly says its content identity is not yet known. Verified/linked entries cannot be overwritten by a pending result. Completed duplicates collapse to the existing record without creating another workspace.
- Red evidence: pending schema rejection and a deliberately stalled browser digest leaving zero records. Fresh 105 model tests, typecheck, stalled-batch/reload/resume browser test and original mixed-file/PDF handoff regression pass. The stalled digest is a narrow test control for interruption, not a simulated successful parse; recovery uses the actual PDF. Mobile pending/retry view captured and inspected at `/tmp/1hk-import-resume.png`.
- Remaining: batch attempt history, removal/filter/explicit replacement, full file-format settings and DWG/IFC partial-state handoff, local guest sharing and the remaining original frontend goal. No backend or deployment changes.

## Latest verified increment: mixed local file manifest

- Start and local documents pages now accept up to ten files per batch (50MB each, 100 manifest entries). Actual PDF parse/page count/hash enables a local workspace; DWG/IFC retain metadata with explicit engine-unconnected status, not a fabricated drawing. Unsupported and failed files remain visible with recovery guidance. No bytes leave the browser.
- Completed entries survive the existing session and backup schema. Matching hash/format is deduplicated; repeated PDF opening returns to its existing document ID rather than making duplicates. PDF runtime reuse follows the existing bounded cache; reload may require exact-source reselection. Leaving during inspection cancels unfinished selections; it does not claim background conversion.
- Red evidence: missing manifest module and missing file input in browser. Fresh 104 model tests and typecheck pass. `verify-workflow-import-manifest.mjs` covers PDF/DWG/IFC/text/corrupt-PDF selection, distinct statuses, reload, deduplication, one exact PDF workspace, no DWG workspace creation, real rendered PDF and mobile width. `/tmp/1hk-import-manifest.png` inspected. Existing quantity/drawing/output/recipient delivery regression also passes.
- Remaining: persisted in-flight batch/retry history, file filters/removal/explicit replacement, per-file format settings, DWG/IFC mock partial-state handoff and guest sharing. Actual CAD/BIM parsing and DWG writing remain outside this frontend implementation. Full goal active.

## Latest verified increment: persisted output preparation

- Output preparation no longer resets on unmount. The saved delivery package now retains simulated phase, attempt count and approved source hash. Explicit start/failure/cancel/ready transitions do not generate files, run a background service or change approval/receipt records. Refresh preserves the phase but does not claim ongoing server processing.
- Replacement delivery configurations start with no output job. Previous configurations retain their output state in delivery history, rendered read-only. Source mismatch or missing approval prevents processing; attempts cap at 100 without erasing prior records.
- Red evidence: absent model module and existing browser output workflow losing processing state on reload. Fresh evidence: 103 model tests, typecheck, extended `verify-workflow-quantity-delivery.mjs` pass processing/failure/cancel/ready reload, three attempts, original session equality after removing only the new output metadata, prior/new package separation, independent recipient pinned quantity and receipt. Mobile `/tmp/1hk-output-preparation.png` inspected.
- Remaining: multi-file import manifest, format-specific output configuration/job diagnostics and attempt-level event history, local guest/request continuity and other full frontend requirements. No real PDF/XLSX/DWG generation or backend/deployment changes; goal remains active.

## Latest verified increment: unsent RFI draft continuity

- Composer title/question/due/assignee and unsent answer/closure opinions now live in the existing document/session schema, separately from registered questions. Keys include document, source hash, revision, object/page/position, role and compose-or-question-phase context; changed context does not silently reuse a previous draft.
- Successful question registration or answer/closure consumes only its corresponding draft. Failed/unauthorized submissions preserve it. Drafts are bounded to 200 entries per document; cap messages preserve existing data instead of silently evicting it. Draft content is included in the normal local document/session backup, not transmitted.
- Fresh evidence: model test first failed on missing draft helpers; browser test reproduced lost title after reload. Then 102 model tests, typecheck and `verify-workflow-rfi-drafts.mjs` pass compose reload, no premature registration, answer roundtrip/reload, role isolation and consumed-draft removal. Existing role-inbox and original RFI browser regressions are separately checked this turn.
- Remaining: stale-draft discovery/explicit discard or reattachment, restored-revision/backup UI matrix, role-inbox focus/scroll restoration, named people, due-date actions and reassign/reopen history. These checks do not close the full frontend objective. No backend or deployment changes.

## Latest verified increment: RFI filtering and role work queues

- Local RFI lists now filter by search, phase, assigned role and document. Unknown filter targets yield no matches rather than substituting another document. URL-backed role/filter context survives exact-object navigation, return to issues or tasks and reload.
- The local tasks page now includes RFI work: reviewer/approver sees assigned unanswered questions; author sees answered questions awaiting closure; Viewer has no actionable queue. Successful answer/closure removes the completed task from that role's list without deleting the question history.
- Model test first failed on absent `selectRfis`; browser test first failed on absent filters. Fresh 101 model tests, typecheck, the two-document RFI queue browser test and the original RFI journey pass. The first combined-control test outran URL commits and was corrected to assert each URL transition before the next control; final run checks preserved filters and duplicate #1 identity across two documents. Mobile empty-role state inspected at `/tmp/1hk-rfi-inbox.png`.
- Remaining: actual member assignment, due-date/overdue workflow, reassign/reopen history, persistent unsent drafts and reply/focus retention, project-wide aggregation and full original frontend completion audit. No backend/notification/deployment changes; goal stays active.
- Final verifier rerun also exposed input before initial client/session restoration. It now waits for both restored document records before entering filters, in addition to URL transitions. The final rerun passes; this is test readiness evidence, not a claim that all application-wide hydration interactions were audited.

## Latest verified increment: local RFI role workflow

- Selected objects have a collapsed formal-question composer distinct from comments. Author simulation supplies title/question, reviewer-or-approver assignment and a calendar-valid due date. Up to 100 source/revision/object/page/position-bound records per document persist through the session schema.
- Local issues presents question, assigned role, due date, answer and closure. Only the assigned role can answer; only the author can close an answered question. Closed records cannot be overwritten. Stale source/revision/position blocks target navigation and processing; the original record remains and the UI requests a new current-evidence question. RFI closure never changes drawing/quantity approval.
- Fresh evidence: model test first failed on missing module; browser test first failed on missing composer. Then 100 model tests, typecheck and `verify-workflow-rfi.mjs` passed creation, Viewer/wrong-assignee rejection, answer/reload, closure, exact target/return, unchanged drawing reviews and mobile width. `/tmp/1hk-rfi.png` inspected. Existing object-comment browser regression passes.
- Explicit remaining scope: actual member (not role) assignment, persisted draft/reply/reassignment/reopen history, due/assignee/status filtering and work-inbox aggregation, focus/search retention for RFI, multiple-document collision and source-change browser matrix. This is a local frontend simulation, not official issuance or notifications. Full goal remains active.

## Latest verified increment: local object comments

- Local objects support role-labelled comments retaining source hash, revision, object, page and coordinates, without changing geometry or approval. Local issues lists/searches these comments. These are not formal RFI, approvals or transmitted messages.
- Browser testing reproduced lost search on return from the exact object. URL-backed search now survives the workspace roundtrip and reload. An ordinary workspace reload requires object reselection; the test does not assume selection persistence.
- Fresh evidence: 99 model tests, typecheck, `verify-workflow-object-comments.mjs` and existing inspector-navigation regression pass. Browser coverage includes persistence, search/reset, exact target, search return/reload, Viewer controls, stale-position target rejection and mobile overflow. `/tmp/1hk-object-comments.png` visually inspected.
- Still open: formal RFI/assignment/replies/mentions, inbox focus/scroll return, multi-document comment collisions, full role/history matrix and the remaining full-product frontend domains. No backend/deployment changes; goal remains active.

Scope: 18 page views, 12 panels/dialogs, 10 exception states; three connected architecture / IFC / civil scenarios. This is not a backend implementation or deployment task. Do not mark the goal complete based on the initial page scaffolding.

Current completion audit: `2026-09-10-frontend-completion-audit.md` in this directory. It supersedes stale unchecked status assumptions below without deleting the original requirement inventory. Fresh checks pass 36 page and 24 panel presentation cases, 10 representative exception flows and all three sample correction/approval/delivery journeys. Local-document vs sample-panel integration remains incomplete; next work is local actionable findings/task handoff, local comparison and scale/measurement screen flow, followed by import/output and role/field/library gaps. No whole-product completion claim.

Working code: `/Users/h/Documents/GoAgent/.worktrees/universal-workspace-m1/platform` (existing dirty user worktree; preserve other changes).
Preview entry: `http://127.0.0.1:4181/workspace-preview/flow`.

## Evidence from first implementation pass

### Approved field/photo evidence → recipient

- Recipient renders fieldEvidence only from the selected approved drawing round, not current fieldNotes. It shows original observation, object/location, source/page/revision and reconnectable photo references, with explicit no-file-transmission/no-inspection-certification language.
- New `verify-workflow-field-photo-delivery.mjs`: seeded requested review with real PDF/photo hashes; UI reviewer and approver decisions, delivery preparation, independent recipient, reload, wrong-photo refusal, same-photo reconnect, later live-note change without frozen-note change, receipt and mobile overflow all pass.
- Fresh 98 model tests and typecheck pass. Existing no-photo measured recipient regression is also rerun. Requested-review creation through UI is covered separately by local-field test; this test seeds that boundary rather than claiming every step was manually traversed.
- Remaining overall scope includes local RFI/comments/assignment, shared location tree, import/output-state persistence and local sharing; no whole-goal completion claim.

### Frozen field/photo evidence in drawing review

- Review request accepts an optional field-note ID, resolves it from the selected local document and rejects stale location/source or mismatched target. It deep-clones the full observation and photo metadata into the review round; later source-note mutations do not alter that frozen evidence.
- Review UI exposes the original observation/location/source/page/revision and reconnectable photo previews under “요청 당시 현장·사진 근거”. Session restore validates target, source and recorded position against frozen drawing objects.
- Fresh evidence: 98 model tests (deep-copy, stale/missing request rejection, session roundtrip and invalid target refusal), typecheck, and local-field browser using actual two-page PDF plus PNG attachment passed. Browser submits the review explicitly and checks frozen photo metadata.
- Remaining: full reviewer/approver/recipient photo journey and recipient presentation. This is frontend provenance, not a server approval or photo storage service.

### Local field photo attachments

- Added JPEG/PNG/WebP file selection, actual decoded preview and pre-save attachment removal (three per record, 10 MiB per original). Busy attachment validation blocks record save. Duplicate hashes and unsupported file types are rejected.
- Field records persist only photo metadata (name, SHA-256, size, MIME), never bytes. Bounded tab-runtime file cache: 12 originals / 30 MiB. Reload requires matching original reconnect; wrong hash rejected. Blob preview URLs revoked on unmount.
- Fresh evidence: 97 model tests and typecheck pass; mobile local-field script exercises unsupported SVG, valid screenshot PNG, remove/re-add, record/reload, wrong-original refusal, correct reconnect and existing field→review/location flows. A TSX syntax failure was fixed before final checks.
- Remaining: frozen photo references in formal review/recipient flows, photo captions/capture provenance, project-wide location tree and assignment. No server photo storage or inspection approval is implied.

### Broad regression and coverage refresh

- Reran original 18 sample screens at desktop/mobile (36 checks), 12 panels at both widths (24 checks), ten exception views/recovery actions at both widths, and architecture/IFC/civil correction→resubmit→approval→delivery→new-revision journeys. All passed.
- Expanded inventory with nine local empty-state routes at both widths (18 additional checks): overview, quantities, estimate, tasks, reviews, changes, delivery, field, materials. Confirmed named local regions, no A-101 sample source in body, no horizontal overflow or pageerror. All passed.
- These checks verify presentation and specified sample actions, not local workflow parity or full product completion. Updated stale audit entries for calibration, source reuse, overview and materials. Next large missing integrations: field photo evidence, local comments/RFI/assignment, persistent import/output manifests and local sharing.

### Same-tab verified PDF reuse

- Successfully parsed, hash-verified original Files are retained only in the tab runtime, keyed by SHA-256, bounded to three originals / 64 MiB combined with least-recently-used eviction. No bytes enter sessionStorage, backups, network or persistent storage.
- Workspace remount recalls matching source and revalidates its hash. PDF worker/document objects are still destroyed on unmount. Reload starts a fresh memory cache and requires reconnect. A disclosure action forgets the current cached original and unloads its view.
- Fresh evidence: 96 model tests including cache bounds/eviction/forget, typecheck, real PDF main regression, actual measurement→review→recipient flow, materials flow and overview/findings navigation pass. Findings test now uses in-app navigation and verifies PDF readiness without reselection; explicit forget/reconnect additionally exercised.
- This is a bounded convenience cache, not offline durable source storage or access-control infrastructure. Large/evicted originals still need reconnection.

### Overview actionable findings

- Overview cards expose source/quantity findings with exact document/page/object targets and a return-to-overview action. Quantity-review findings route directly to that document's quantity view; stale field counts link to its field record page.
- Source/stale/review findings precede optional missing-quantity notices; no claim that every drawing object must be quantified. Original source identity is not replaced by a sample.
- Extended real-PDF findings browser checks overview → exact second-document object → overview, then original reconnect → quantity → review inbox → approval. It passed after explicitly reconnecting PDF on workspace remount (bytes are not persisted). Fresh 95 model tests and typecheck pass.
- Remaining: same-session source reuse UX, role/assignee prioritization, overview return selection/focus retention, photos and cross-document project aggregation.

### Local overview integration

- Overview defaults to local scope and summarizes actual same-tab documents rather than sample project evidence: drawing and quantity states separately, field notes/recheck counts, material event counts, latest delivery status and source/quantity findings.
- Exact-document links lead to workspace, quantities, field, materials and scoped delivery. A missing/unapproved selected delivery does not show another document's approved package; all-document delivery remains available explicitly.
- Browser test validates two local documents / six material events, mobile width, no-substitution delivery and exact material navigation. Fresh 95 model tests and typecheck passed.
- This is not server/project-wide aggregation, progress percentage or summed procurement quantities. Remaining: role-prioritized exact-object next actions, project grouping, photos and broader navigation/state matrix.

### Approved-snapshot toolbar cleanup

- Removed authoring/undo/measurement-start controls and multiselection editing help from approved snapshot mode. Kept single-object selection, PDF reconnect/zoom/pan, evidence summary and expandable details. Authoring mode retains its tools.
- Verified absence of rectangle/undo/multiselect actions in snapshot, details expansion, original hash gate, PDF pixels and same material return. Fixed screenshot wait to require increased canvas width after zoom plus loading-state disappearance.
- Fresh checks: 95 model tests, typecheck, local-materials browser, inspector-navigation browser, and full `verify-workflow-pdf.mjs` passed. This does not close outstanding project aggregation, photos, import/share/library and complete flow-audit requirements.

### Compact approved-snapshot inspector

- Approved readonly snapshots now show source/page, selected object/layer/position, linked quantity (explicitly distinct from quantity approval) and drawing approval note in a compact summary.
- Layer/property/review controls are inside a closed disclosure; opening inspector navigation expands it, while authoring mode remains expanded. Existing readonly controls remain noneditable.
- Fresh evidence: 95 model tests, typecheck, actual-PDF materials flow and inspector-navigation regression passed. Mobile screenshot reviewed; rendering wait added after PDF zoom to avoid capturing the loading state.
- Remaining readonly simplification: top drawing toolbar and multiselection help still contain authoring-oriented items. This is not completion of overall workspace UX.

### Real PDF material evidence verification

- Upgraded `verify-workflow-local-materials.mjs` from synthetic hash to an actual pdf-lib PDF containing a border, text and blue pipe line. Fixture source hash is computed from those bytes.
- Verified different bytes rejected, matching PDF renders actual blue pixels, zoom works, snapshot role is locked, source hash/drawing approval history remain unchanged, material events survive exact-object return, and cancellation history reloads.
- `/tmp/1hk-material-original.png` inspected. Finding: mobile readonly source still exposes a long stack of disabled authoring inspector controls; prioritize compact readonly presentation, not additional disabled controls.
- The approvals in this test are seeded with the existing reducer, not performed through every approval UI step. Existing separate actual-PDF review tests remain relevant; no blanket end-to-end production claim.

### Materials cancellation/return follow-up

- Append-only cancel-order, return and uninstall events subtract from their corresponding net totals; original entries and quantity approvals remain unchanged. Positive quantities and reasons required.
- Enforces nonnegative net totals and installed ≤ received ≤ ordered after every event, including restore replay. The UI explains reversing installation before returning installed material and returning received material before cancelling its order.
- Verified 12/8/5 → uninstall 2 → return 5 → cancel 9 → net 3/3/3; invalid cancellation/return/uninstall blocked, six events restored, Viewer disabled. Fresh 95-test model suite, typecheck and mobile materials browser script pass. Actual supplier transactions are not performed.

### Materials → approved drawing evidence follow-up

- Selected material object can open the matching approved drawing snapshot only when frozen quantity evidence matches that drawing, reusing deliveryQuantityReview. No matching approved drawing means a disabled link and explicit explanation.
- Return preserves document, quantity-review sequence and object. Missing or inconsistent direct URL targets show a recovery screen, never a live-drawing fallback.
- Browser fixture verifies approved drawing/object navigation, return to retained records and missing snapshot rejection. Fixture has source metadata, not real PDF bytes; actual rendering/reconnection is still a separate remaining journey. Model suite: 95 pass; typecheck and targeted browser checked this turn.

### Local approved quantities → materials follow-up

- Materials now uses local scope by default, with explicit sample scope retained. Users choose a local document, approved quantity round and exact object; no sample quantity substitution for empty/missing documents.
- Added bounded append-only materialEvents referencing the retained approval sequence/object. Order/receive/install remain separate, require reasons and author demo role, and enforce received ≤ ordered and installed ≤ received. Over-ordering versus approved quantity is allowed with an explicit warning, not hidden as calculated demand.
- Session restore validates event references and replays progression. Approval snapshots and design quantities remain unchanged. Old approval context is labelled; rounds never silently carry over or aggregate.
- Fresh evidence: 95 model tests and typecheck pass; `verify-workflow-local-materials.mjs` passes approved fixture → 12 order / 8 receive / 5 install, invalid receive, reload, Viewer, empty/missing document and mobile overflow. Screenshot `/tmp/1hk-local-materials.png` inspected.
- No actual procurement/inventory/engineering inspection/payment. Remaining: exact geometry handoff, supplier/product mapping, cancellation/returns, revision carry-over, project totals and richer approval-to-field integration.

### Field location filtering follow-up

- Selected local document records can be filtered by building/civil/free-text hierarchy prefixes. All/filtered counts and explicit missing-location recovery are shown; filters never change saved records.
- The fieldLocation URL parameter persists through reload and the exact-object review/read-only roundtrip. Switching field document clears the previous document's filter. This is not a project-wide location tree.
- Browser verification covers a civil section filter hiding building records, reload and review-return persistence, clear-filter recovery. Model suite: 94 pass; typecheck pass. Project-wide location aggregation and photo/material evidence remain open.

### Structured local field location follow-up

- Added free-text/building/civil location modes. Building stores building/floor/room; civil stores route/section/station as a discriminated optional locationPath, preserving older free-text records.
- All three structured segments are required and bounded. Stored display text must match the structured path; incomplete or inconsistent entries cannot be stored. These are classification labels, not geospatial or engineering calculations.
- Mobile browser evidence covers both location modes, incomplete-form blocking, same-tab reload persistence and civil location transfer to the exact object's review draft. Fresh model suite: 94 passed; typecheck passed.
- Remaining: shared project location tree, filtering/cross-document reuse, photo evidence, assignment and material linkage. This is not whole-goal completion.

### Local field → drawing review draft follow-up

- Each current local field record now opens its exact document/page/object with a review draft; readonly record navigation remains separate. Viewer cannot initiate the draft button.
- URL carries record ID, resolved against that document. Changed source/revision/location, missing record or wrong selected object blocks the request; no fallback object is substituted.
- Full observation remains expandable; the editable review message is capped at 500 characters with an explicit notice. Opening the draft does not create a review round. The original PDF must be reconnected before the existing request action is enabled.
- Draft heading receives focus, reload reconstructs the initial record-derived message, and return retains the selected field document. Unsaved edits to that message are not a persisted draft store.
- Fresh evidence: 93 model tests, TypeScript check, mobile `verify-workflow-local-field.mjs` pass (draft content, reload, no automatic review round, Viewer, stale direct URL and exact-document return). Fixture uses PDF metadata, not real PDF bytes; full field-to-approved-review real-source test remains outstanding.

- Shared frontend workflow reducer created with object/source IDs, revision, quantity status, roles, review/correction/approval and approved snapshot preservation.
- 18 page identifiers and initial page presentations connected to that state.
- 12 initial dialog bodies; 10 selectable exception labels with basic banners only.
- New isolated development-only preview route; previous preview and production paths preserved.
- Tests: `node --test tests/workflow-prototype.test.mjs tests/workflow-prototype-pages.test.mjs` — 8 pass.
- `npm run typecheck` — pass before formatting.
- Browser: project list loaded with no pageerror; screenshot inspected `/tmp/1hk-flow-first-pass.png`.
- Local dev process was started with dummy Supabase settings, polling watcher, host 127.0.0.1 port 4181. Tool session 80606; verify live status before reuse/restart.
- agent-browser CLI absent; use installed Playwright with sandbox escalation for Chromium. Earlier unprivileged Chromium failed with MachPort permission error. The initial missing-env root error was resolved by dev-only dummy settings, not a root/auth bypass.

## Remaining requirements — NOT COMPLETE

- [ ] Replace workspace placeholder with central 2D drawing / sample 3D / split canvas. Object selection, zoom/pan, section/isolation visual controls, properties, and row/evidence return must work within shared scenario, not navigate to unrelated old demo.
- [x] Simplify navigation to six project sections (overview, drawings/models, takeoff, review, field, delivery) with contextual subnavigation. Global home/projects/tasks and library/settings appear once. Browser verified estimate → drawings → workspace, desktop and mobile, no pageerror and no document horizontal overflow. Broader navigation/back-forward E2E remains below.
- [ ] Refine home/project/new-work empty and existing-user paths; show distinct scenario projects rather than only one card.
- [ ] Implement 12 dialogs with actual frontend interactions: scale inputs, format inspection, object/layer controls, model controls, formula/correction fields, pricebook mapping, visual before/after, request target and recipient, review/correction, approval/version, findings/AI accept-dismiss, share/guest entry.
- [ ] Expand 10 exception states beyond generic banners. Each needs appropriate blocking, recovery, preserved input and distinguish no data / untested / failed; frontend-only actions remain honestly labeled.
- [ ] Implement source-linked detailed takeoff and BOQ interactions, filtering and selection; mock numbers labeled as scenario, no claimed measurement.
- [ ] Link task inbox and external review perspective to same request and revision. Separate independent approval domains in display where needed, not merely one unexplained global status.
- [ ] Field and materials need meaningful representative frontend actions, not read-only placeholder rows; no real procurement.
- [ ] Sample delivery preview with contents, missing checks, and history; no real external publishing.
- [ ] Browser back/forward + selected evidence return, scenario isolation and optional safe versioned local persistence / refresh-reset notice.
- [ ] Mobile/tablet and keyboard/dialog/focus/contrast review, full-page screenshots.
- [ ] Browser E2E for all 18 views, all 12 panels, 10 recovery states, and 3 full workflows including correction/resubmit and role denial.
- [ ] Run regression tests and typecheck after final modifications; compare against all scope items and only then mark active goal complete.

## Current new files

`app/lukas/lib/workflow-prototype.ts`
`app/lukas/components/workflow-prototype-pages.tsx`
`app/lukas/components/workflow-prototype.css`
`app/lukas/screens/workflow-prototype.tsx`
`tests/workflow-prototype.test.mjs`
`tests/workflow-prototype-pages.test.mjs`

The large initial route and page switch should be split by workspace canvas, dialogs, and exception presenters as those are implemented. Avoid creating another parallel persistence/domain system: this reducer is explicitly demo-only and must not be confused with existing production authority.

## Navigation implementation follow-up

- Added `workflow-prototype-navigation.tsx`, separating global navigation, six project sections, and contextual page navigation. All existing 18 views remain reachable; settings is rendered once.
- TDD evidence: new contextual navigation test failed with missing component, then all 10 workflow model/presenter tests passed. Typecheck passed.
- Existing port 4181 listener (PID 13230) was verified and reused, not restarted after a sandbox curl failure.
- Playwright checked actual menu clicks from estimate to documents to workspace at 1440×1000 and 390×844. No pageerrors; six project sections; no document-width overflow.
- Screenshots visually inspected: `/tmp/1hk-flow-navigation-desktop.png`, `/tmp/1hk-flow-navigation-mobile.png`. Mobile navigation uses horizontal scrolling; full touch/keyboard audit remains outstanding.
- Current workspace SVG drawing is rendered, but sample 3D, controls, deselection and state persistence still need full interactive verification. Do not mark the canvas requirement complete from this navigation check.
- Latest competitor-based proposal expands the product map to 24 pages / six workspace modes / about 16 panels / 12 exceptions. This is a proposed expansion, not proof of implemented scope. Reconcile it with the original 18/12/10 checklist; do not discard either or imply all proposed pages exist.

## Review handoff follow-up

- Added shared review context to request/review/approval dialogs: same object/source/revision, current stage, request message, latest correction, next-role demo switch and return to workspace.
- Request button now prevents duplicate submission outside draft/changes; blank correction disables its button. Explicit accessible names added to review/request textareas after browser exact-label lookup failure.
- New SSR regression test failed before component creation, then all 11 model/presenter tests passed.
- Browser verified IFC calculate → request → reviewer perspective → correction text → correction decision → same workspace return. No pageerrors. Screenshot `/tmp/1hk-review-handoff.png`.
- Not yet a complete correction/resubmit browser journey; returning alone does not switch roles. The user must use the explicit demo role switch. Needs more refinement and three-scenario E2E coverage before marking review scope complete.

## Rate mapping follow-up

- Replaced static rate dialog with searchable scenario candidates, selection, editable nonnegative rate, amount preview and explicit demo apply action. No imported pricebook or market pricing claims.
- Shared reducer validates unit/finite/nonnegative input, only permits author draft/changes, creates a new revision and requires renewed confirmation. Approved snapshot stays immutable.
- Model regression failed at unchanged 42,000 rate before implementation, then passed with 47,000 selection; suite now 12 passing tests. Typecheck passed before formatting.
- Browser verified architecture rates → search alternative → choose 47,000 → apply → 1,128,000 preview → close → updated list. No pageerrors. Screenshot `/tmp/1hk-rate-panel.png`.
- CSV import/column mapping and larger pricebook filtering are still unimplemented; do not mark full pricebook scope complete.

## Import preparation follow-up

- Replaced compatibility bullets with format → unit/page → warning acknowledgement steps. DWG warnings cover fonts, Xrefs/proxies and reopening exported DWG for delivery verification. IFC/PDF warnings are format-specific.
- Setup is explicitly a frontend exercise: no upload, conversion, file inspection, source replacement or calibration occurs. Existing scenario source remains visible before opening it. Approved/view-only roles cannot change setup.
- Setup survives navigation and reopening the dialog within the current mounted preview; refresh persistence is still not implemented.
- Added failing model test for stored setup, then 13 model/presenter tests passed. Typecheck passed before formatting.
- Playwright: DWG selection; page 0 blocks progression; page 3 succeeds; warning acknowledgement gates opening; return to documents and reopen preserves DWG/page 3. No pageerrors. Screenshot `/tmp/1hk-import-check.png` visually inspected.
- Actual file metadata/dropzone, failure/retry simulation and DWG export checks remain to be completed as frontend UI. The wizard is not evidence of native DWG support.

## Exception recovery follow-up

- Replaced generic banners with ten separate recovery presentations. Empty/loading/unsupported/expired hide normal scenario content instead of showing it as usable data. Required/stale recovery waits for calibration/calculation. Missing-source recovery requires exact scenario source selection and acknowledgement, with no actual hash-validation claim.
- Preview action policy blocks changes during permission/expired/loading/empty/unsupported; missing evidence blocks calculation/review/approval/delivery; offline allows local drafting but blocks request/review/approval/delivery. Server authorization is unchanged.
- Permission role now displays consistently in header, canvas and dialogs. Browser regression caught the header incorrectly saying author before the fix.
- Added repeatable `node scripts/verify-workflow-exceptions.mjs` (requires running local 4181 server and Chromium permission). Checks all ten views, hidden content, role denial, request-draft notice, source recovery, retry, required calibration, stale calculation, AI bypass, offline quantity retention, expired-link exit and empty-project start.
- Browser script passed with no pageerrors. Screenshot `/tmp/1hk-workflow-expired.png` inspected. Model/presenter suite: 14 passing tests. Refresh persistence, true conflict comparison, input draft retention across dialogs, and exhaustive mobile recovery validation remain outstanding; do not mark the overall exception requirement complete yet.

## Session and draft restoration follow-up

- Added versioned, schema-validated sessionStorage snapshot for all three scenarios and per-scenario/per-panel/per-revision request/review drafts. Same-tab refresh and route navigation restore state; not a server save, cross-device save or guaranteed tab-close backup.
- Invalid/incompatible snapshot is not silently overwritten; explicit preview-only replacement action is offered. Storage failures keep working state in memory and display a warning instead of saved status. Reset clears only current scenario and its drafts.
- New codec regression failed before implementation, then model/presenter suite passed 15 tests. Covers restoration, scenario mismatch, invalid quantities, malformed JSON and incompatible version.
- `node scripts/verify-workflow-session.mjs` passes: quantity refresh restoration, close/reopen draft, refresh draft, scenario isolation, corrupt snapshot retained until explicit replacement, unavailable-storage warning and continued editing. Existing exception browser script also passes.
- Browser initially showed static SSR only: dependency request for zod returned HTTP 504 Outdated Optimize Dep. Confirmed exact process PID 13230/cwd, terminated that local dev server and restarted same route/port with `--force --strictPort`. No product/auth changes. Current dev tool session **38423**; revalidate before reuse. Dummy Supabase env/polling watcher unchanged.
- Remaining: viewport/selection restoration, rate/import form drafts before applying, mobile storage/recovery checks, and complete three-scenario journeys. Preserve this distinction from the now-tested review draft restoration.

## Evidence assistant follow-up

- Replaced static AI paragraph with scoped scenario recommendation: object/source/revision, quantity difference, uninspected items, source comparison, mandatory reason and evidence acknowledgement, accepted/dismissed result.
- Decisions are frontend review notes only. Reducer rejects old revisions/blank reasons/viewer changes; no quantity, cost or approval mutation. Missing source/AI-data exception blocks decisions while manual work remains available.
- Current decision and reason survive refresh using versioned session schema. New revisions show prior decision as requiring recheck. Draft reason survives opening comparison and returning.
- Browser script `node scripts/verify-workflow-assistant.mjs` passed: input gate, comparison draft retention, accepted result restore, revision invalidation, dismissal and insufficient-data guard. Screenshot `/tmp/1hk-assistant-decision.png` inspected. Unit/presenter suite now 16 passing tests.
- No actual AI calls, inferred safety conclusions or confidence scores. Real model evaluation and external data access remain outside this frontend-only goal. Linking accepted notes into a richer task/issue list and mobile panel audit remain open.

## Object property editing follow-up

- Replaced static property details with name, display-layer selection, stroke/fill colors, width, and style preview. Apply preserves object/source IDs and quantity, creates a reviewable new revision, and updates 2D overlay styling and linked names. Viewer/approved editing is blocked.
- Appearance is included in session snapshot validation and restored on reload. Layer choices are object tagging, not a complete multi-layer visibility/locking manager; that remains open.
- Browser regression exposed shape enlargement on any revision, including style-only edits. Changed 2D/sample 3D geometry variant selection to depend on scenario quantity difference, not revision number. These remain schematic shapes, not measured geometry.
- `node scripts/verify-workflow-properties.mjs` passed after observed width failure: invalid name, style application, unchanged geometry for property-only edit, refresh appearance/name/layer, viewer denial. Screenshot `/tmp/1hk-object-properties.png` inspected. Model/presenter suite: 17 passing tests.
- Unapplied property form drafts, layer management, object text and richer canvas edit/review modes remain pending; do not mark full property/layer scope complete.

## Quantity formula follow-up

- Replaced fixed quantity panel with editable raw quantity, signed correction, required reason for changes, final quantity and amount preview. Explicit DEMO-QTY-01 adds raw/correction and rounds to three decimal places; this is not actual measurement or a production calculation rule.
- Model validates calibration, author/draft status, finite/nonnegative final result, correction reason, and preserves approval snapshot. Measurement evidence is included in session restoration. Changed final quantity creates a new reviewable revision; source ID remains stable.
- Browser `node scripts/verify-workflow-formula.mjs` passed all three scenarios: architecture 24−2=22 / 924,000; IFC 36−2=34 / 2,210,000; civil 60−2=58 / 4,930,000; linked estimate and refresh confirmed.
- Browser first caught correction changing schematic shape width. Geometry variant is now an explicit object-edit marker, independent of corrected quantity and property-only revision. The sample geometry is still not a measured engineering representation.
- Existing exception browser script passed after formula integration. Model/presenter suite: 18 passing tests. Unapplied numeric form drafts and richer formula/measurement workflows remain pending.

## End-to-end review and approval evidence follow-up

- Added `scripts/verify-workflow-journeys.mjs` exercising architecture/IFC/civil: calibrate as needed → calculate → request → reviewer correction → author revise → recalculate/resubmit → review → approver → delivery prepare → reload → author new revision → edit name → confirm old approval unchanged after reload.
- First browser run failed because approval dialog had no quantity/amount evidence, only status and an approve button. Replaced with approval evidence summary and explicit confirmation checkbox.
- Approval snapshot now captures object ID/name, source ID, document, unit/rate alongside fixed revision/quantity/amount. Session schema preserves these optional fields; older snapshots show missing metadata honestly rather than substituting current names.
- Delivery displays fixed approved values and distinguishes current unapproved revision. New revision cannot prepare a replacement package until reapproved. Actual file generation/transmission is still not performed.
- Three full browser journeys passed with no pageerrors; screenshot `/tmp/1hk-approved-delivery.png` inspected. Model/presenter suite remains 18 passing tests, typecheck passed.
- This verifies the core demo approval chain, not all 18 views/12 panels/mobile cases or actual field workflows. Remaining substantive gaps include field/material actions, share/guest flow, scale inputs, model panel, layer manager, richer canvas edit/review mode, and full visual/a11y audit.

## Field and materials workflow verification follow-up

- Field records now capture title, observation status, note, location, object/source IDs and revision. Local photo preview explicitly persists only the filename, not image bytes or a server attachment. Records remain separate from approved design quantities.
- Materials distinguish approved design, ordered, received and site-confirmed installed quantities. Input gates require an approved baseline and a reason, disallow negative/nonfinite quantities, received above ordered and installed above received. No procurement or payment operation is performed.
- Added `scripts/verify-workflow-field.mjs`. Its first run reproduced lost source IDs when a long field note was truncated into a 500-character review draft. The draft now puts source, object, revision and location first. Full original field note remains in the record.
- Visual inspection then exposed empty material edit inputs after refresh despite restored table values. Added input restoration assertions, observed failure, and keyed the form by its saved material record so session hydration restores editable values too.
- Browser script passes: civil field record/photo filename/review handoff, actual demo approval sequence, 60m approved vs 65 ordered/60 received/50 installed, invalid gates, refresh table and inputs, 390px overflow check. Screenshots: `/tmp/1hk-field-record.png`, `/tmp/1hk-materials-record.png`, `/tmp/1hk-materials-mobile.png`. This does not yet prove all mobile/a11y/role/exception combinations.
- Model/presenter suite: 20 passing tests. Field actions and session schema remain frontend-only. Unapplied form drafts, record attachments, richer inspection lifecycle, share/guest, model/layer/mode controls and full-page audit remain open.
- Latest competitor comparison proposed 30 business pages, 4–6 entry views, 6 workspace modes, 16 panels and 12 exception states. This is an expansion proposal, not evidence that those screens exist or that the earlier approved scope is complete; reconcile it explicitly in the completion inventory.

## Same-canvas author/review mode follow-up

- Added explicit author/review mode controls separate from 2D/3D/split display controls. Mode changes preserve the mounted canvas, zoom and selection; opening and closing the review dialog keeps this context. Review mode disables the drawing revision command and hides property editing entry. Quantity evidence remains a separate panel, so the lock label explicitly says drawing editing, not all data editing.
- Review inspector shows same object/source/current revision, phase, request message and chronological operation records, with request/review/approval entry matched to workflow phase. No invented author avatars/timestamps or real-time collaboration claims.
- `scripts/verify-workflow-modes.mjs` first failed because review mode did not exist, then passed for civil R2: zoom 125%, C-301 retained, drawing edit disabled, history/source visible, request dialog return, author editing restored. Screenshot `/tmp/1hk-workspace-review-mode.png` inspected.
- Existing three-scenario `verify-workflow-journeys.mjs` passed; model/presenter suite 20 tests passed and typecheck passed. These do not prove every mode/mobile combination.
- Remaining workspace scope: grayscale/colored change overlays and hover details, history version semantics, persistent viewport across navigation/reload, layer manager, scale inputs, model panel, 3D camera continuity, richer object editing and full mobile/a11y checks. Overall frontend goal remains active.

## Review target emphasis and history revision follow-up

- Fixed operation history tagging new drawing/property/rate revisions and new-revision creation with the resulting revision instead of the prior revision. Regression first observed R1 event for an R2 object edit, then passed for repeated edits and related revision commands. Existing stored history is not retroactively rewritten.
- Review mode now renders schematic surrounding geometry in grayscale at reduced opacity and highlights the selected review target. This is target emphasis, NOT a computed geometric diff or evidence that unchanged geometry was compared.
- Target hover/keyboard focus reveals object/source/revision, latest history label and current quantity status; Escape dismisses it. Both architecture and civil SVG groups use the same handlers. Tooltip does not invent participants or timestamps.
- Browser `verify-workflow-modes.mjs` extended with hover/focus/Escape assertions. Initial pointer test hit the empty center of a curve group; corrected the test to hover its visible label, then observed missing-tooltip failure before implementing. Final browser pass; `/tmp/1hk-review-target-detail.png` visually inspected. Model/presenter suite 21 tests passing; typecheck passed.
- Still outstanding: actual before/after geometry preview, persistent viewport, usable layer management, scale/model panels, guest review/delivery, all page/state coverage and mobile/a11y review. The tooltip currently gives latest object-context history, not a multi-object audit log. Frontend goal remains active.

## Comparison quantities and cost follow-up

- Replaced divergent compare panel/change-page summaries with a shared before/current/delta table for quantity, rate and amount. Baseline is explicitly the initial scenario R1, not the prior revision or latest approval. Shared calculation uses initial quantity × initial rate vs current quantity × current rate.
- Regression reproduced `+-2` / `+-170,000` and absent rate-only impact. Signed formatting now uses a plus only for positive values, and rate changes affect the amount delta even without quantity changes. Unconfirmed quantities show a preview warning; no contract/indirect/tax calculation claims.
- Unit/presenter suite 23 passing tests and typecheck passed. `verify-workflow-comparison.mjs` exercises civil −2m correction, −170,000 amount, dialog/page agreement and refresh; rate-only 85,000→90,000 test expects +300,000. Screenshot `/tmp/1hk-change-impact.png` visually inspected.
- Arbitrary baseline selection, approved-revision comparison, geometric comparison, remaining panels/pages and overall completion audit remain outstanding. Overall frontend goal remains active.

## Scale setup UI follow-up

- Replaced fixed calibration description/button with a reference-segment illustration, positive reference length, mm/m selector, meter conversion and saved reference summary. Explicitly a sample segment, not an actual two-point PDF measurement; does not modify object quantities automatically.
- Calibration validates finite positive length ≤1e9, retains units in optional session schema, and marks quantity evidence stale. Approved/reviewer/viewer edits remain blocked. Legacy `calibrate` actions retain their 6000mm sample default for existing demo flows.
- Added persistent reference access from the formula panel after initial setup; browser test first failed because this reopening action was absent, then passed with stored 6m input restored after reload.
- Model/presenter suite 24 tests passing. `verify-workflow-scale.mjs` passes zero rejection, 6m application, reopening and reload restoration. Existing three-scenario approval/delivery journey script passes. Screenshot `/tmp/1hk-scale-setup.png` visually inspected.
- Unapplied scale form drafts, actual segment selection, model unit alignment and complete mobile/a11y checks remain pending. Overall frontend goal remains active; layer/model/share/guest/delivery and full scope audit still required.

## Model evidence panel follow-up

- Replaced the model-panel placeholder with searchable current scenario object/location/source metadata, quantity status and direct links to formula/review/workspace. Added normal canvas navigation entry so this is not available only in demo controls.
- Explicitly labels absent real model/GlobalId rather than inventing IFC metadata. Includes guidance to the existing workspace 3D/split, isolation and section controls, not a false claim of a complete IFC engine.
- Added failing presenter test, then 25 model/presenter tests passed; typecheck passed. `verify-workflow-model.mjs` passed search/no-result/reset, IFC-01/W-201 correspondence, quantity panel handoff and same-canvas return retaining 125% zoom. Screenshot `/tmp/1hk-model-evidence.png` inspected.
- Browser capture still uses the existing WebGL fallback in this test environment. Actual sample 3D rendering/camera continuity, real model tree, shared layer controls, external review/delivery and full page/mobile/a11y completion are not proven. Goal remains active.

## Actual sample 3D rendering and camera continuity follow-up

- Diagnosed the earlier fallback: browser WebGL2 is supported, but Three.js/OrbitControls requests returned HTTP 504 `Outdated Optimize Dep`. Verified PID16605/cwd/command, stopped only that local server and restarted port4181 with isolated `P4_FUNCTIONAL_VITE_CACHE_DIR=node_modules/.vite-workflow-preview`. Current dev tool session **78328**; revalidate before reuse. No production deployment/config change.
- Added repeatable `verify-workflow-3d.mjs` using Chromium software WebGL (SwiftShader). Actual sample rendering and pointer rotation verified. First meaningful UI failure: grid toggling reconstructed renderer and reset the camera. Saved camera position/target across renderer rebuilds.
- A further failing round proved 2D→3D switches discarded the camera state on child unmount. Lifted camera-pose ref to the mounted workspace so view switches retain it. Explicit reset still returns to original view. Screenshot comparisons normalize focus/hover overlays before asserting reset.
- Browser test passes real rendered rotation, grid/section/isolation on/off, 2D→3D return and explicit reset. Inspected `/tmp/1hk-3d-rotated.png` and `/tmp/1hk-3d-section.png`; `/tmp/1hk-3d-isolated.png` also captured. Existing model/presenter suite 25 passing tests before final ref move; typecheck rerun after final change.
- This verifies generated sample geometry, not actual IFC ingestion or 10,000-object performance. Camera persistence across route departure/reload, panning/zoom details, layer manager, guest/delivery and full frontend completion remain open. Goal remains active.

## External review preview flow follow-up

- Replaced share placeholder with recipient/permission/optional amount scope setup, frozen source/object/revision snapshot, recipient-preview step, local feedback and expired-access presentation. Added direct workspace share entry. No email/link creation, external writes, real invitation or authorization claim.
- Share snapshot/feedback persist in the same tab via session codec. Later drawing edits do not silently update existing recipient scope; explicit new-preview action replaces the prior example. View-only/expired previews reject feedback; guest feedback does not approve or finish review.
- Added failing reducer test then 26 model/presenter tests passed. `verify-workflow-share.mjs` first failed missing normal workspace entry, then passed email gate, hidden amount, feedback restoration, frozen R1 after R2 edit, expired content hidden and view-only regeneration with disclosed amount. `/tmp/1hk-external-review-preview.png` visually inspected.
- This is a recipient-view simulation inside the creator's dialog, not a separately authenticated guest route. Full guest onboarding, mobile/accessibility audit, real delivery package configuration, layers, viewport/session details and complete scope inventory remain open. Goal remains active.

## Delivery configuration and manifest follow-up

- Replaced fixed delivery checklist with PDF/DWG/XLSX/CSV format selection, recipient memo, mandatory source/quantity/rate/review inclusion plan and stored manifest preview tied to approved revision. Stored formats/memo restore after refresh. Unapplied selection changes are distinguished from saved configuration.
- Empty/unknown/duplicate formats and missing approval snapshot are rejected. DWG explicitly reports unconnected re-save engine; other formats also remain ungenerated. No real download, conversion, transmission or receipt is performed.
- Added failing delivery model test then 27 model/presenter tests passed; typecheck passed. Extended all three browser approval journeys with empty-format gate, DWG/CSV selection, engine warning, manifest/recipient preview and reload persistence. All three passed; prior approved snapshot remains fixed after a new revision.
- Inspected updated `/tmp/1hk-approved-delivery.png`. Export result/failure/receipt pages, independent guest route, layers, responsive/accessibility audit and overall inventory remain pending. Goal remains active.

## Layer management follow-up

- Added source/overlay layer list with create, visibility and lock controls; default original background stays edit-locked. Existing object layer names remain readable, and new layers become choices in the property inspector.
- Target layer visibility controls 2D/3D target display; source visibility hides schematic source geometry (3D via isolation). Grid is independently controlled. Layer lock blocks drawing revision and property changes in both UI and reducer, while viewing/formula review remain separate.
- Layer settings are optional versioned session data for the current preview tab, not multi-user permissions or production CAD layers. No original bytes are changed. Layer management is limited to draft author role; source unlock is always denied.
- Added failing layer model test then 28 model/presenter tests passed; typecheck passed. `verify-workflow-layers.mjs` passed layer creation, duplicate gate, object assignment, target hiding/refresh/restoration, lock/property denial, source hide and original-lock guard. `/tmp/1hk-layer-controls.png` visually inspected.
- Remaining: layer rename/delete/order, multiple real editable objects, responsive layer layout, viewport persistence, export result/receipt/independent guest pages, full page/state inventory and final audit. Overall frontend goal remains active.

## Grouped project entry follow-up

- Replaced current-scenario-only project card with two grouped demo projects containing architecture/IFC/civil work entries. Building architecture and IFC are grouped under the same project rather than duplicated project cards. Entries read existing scenario states and route to the correct overview without resetting work.
- Added project/document/work-type search, phase filter, empty results and clear action. Search does not delete hidden work. New start entry remains available.
- Failing presenter test proved grouped view missing, then model/presenter suite 29 tests passed; typecheck passed. `verify-workflow-projects.mjs` passes grouping, search/filter empty recovery, all three entries, independent architecture R2/IFC R1 states and reload persistence. Test now explicitly awaits completed route navigation before reload. Mobile 390px overflow check passed; `/tmp/1hk-grouped-projects-mobile.png` inspected.
- Remaining entry gaps: actual blank-start visual flow, templates creating distinct frontend documents, global heading/breadcrumb still carrying current scenario context, search/filter persistence, full page/state inventory. Overall frontend goal remains active; this does not represent completion of the start flow.

## Independent blank-workspace follow-up

- Added named blank documents with a genuinely empty grid, screen-only rectangle creation, object naming/deletion and return/reopen from a separate local-work list. These documents never borrow the seeded architecture/IFC/civil source or quantity data. Global pages now use a personal-workspace breadcrumb instead of the active sample project.
- Optional session schema retains document titles and shapes across same-tab refresh; legacy snapshots remain supported. Missing blank IDs show recovery rather than substituting a sample drawing. Limits: 30 local documents, 500 screen-only shapes per document. No server persistence or CAD/quantity authority claimed.
- Prior failing session test now passes; 30 model/presenter tests passed. Browser script `verify-workflow-blank.mjs` passes empty-title gate, creation, independent canvas, naming/deletion, refresh, reopening and missing-document recovery. Mobile 390px overflow check passed and `/tmp/1hk-blank-workspace-mobile.png` visually inspected.
- This is an entry-flow implementation, not a complete blank CAD editor: movement/undo/zoom, template-based starts, source attachment and transition into evidenced review remain pending. Independent guest delivery/receipt, full page/state coverage and overall completion audit also remain pending. The overall frontend goal remains active.

## Template-based independent starts

- Replaced the routed library placeholder (which opened unrelated current-object properties) with two explicitly screen-only starter layouts: office spaces and site work zones. Selection shows an SVG preview and requires a new work name; creation copies shapes into the existing independent local document flow.
- No engineering source, quantities, actual company standard or CAD template claims. Edits to one copy do not change another copy or seeded projects. Existing same-tab session restoration and work-list reopening are reused.
- New factory test was observed failing before implementation; 31 model/presenter tests pass and typecheck passes. `verify-workflow-templates.mjs` verifies both previews, name gate, separate copies, edit isolation, reload/reopen and 390px layout. Existing blank-workspace browser regression also passes.
- Visual review found a three-line compressed mobile card title; a failing bounding-box check reproduced it (58.5px title height), then stacked card layout fixed it. Screenshot: `/tmp/1hk-template-library-mobile.png`.
- Remaining: actual PDF/source attachment and transition into review, complete drafting tools, real company template management, guest delivery/receipt and full original page/panel/state audit. Goal remains active; two illustrative starter layouts do not constitute a complete CAD template library.

## Actual local PDF background integration

- Reused existing PDF.js document opener and `PdfScreenSurface` in independent blank/template workspaces. Local file selector provides validation/loading/error/reselection, page controls, zoom and pan; SVG rectangles render as a separate page-specific overlay. Existing sketches default to page 1 and are explicitly relative-position sketches, not calibrated engineering geometry.
- Session data stores filename, SHA-256, page count/current page and overlay page only, never original bytes. Reload/route return asks for the same local PDF; hash mismatch refuses substitution and preserves drawings. This intentionally does not promise cross-tab or persisted binary storage. No uploads or source writes.
- Session test failed before implementation, then 32 model/presenter tests passed; typecheck passed. `verify-workflow-pdf.mjs` validates actual canvas pixels, corrupt-file recovery, page-specific objects, zoom, refresh/reselect hash mismatch and mobile sizing. Mobile overflow was reproduced and fixed by constraining the grid child's minimum width.
- Also opened the user's `/Users/h/Downloads/구조.pdf` first page locally through the same UI. Captures `/tmp/1hk-workflow-real-pdf.png` and `/tmp/1hk-workflow-structure-pdf.png` inspected. This verifies first-page display, not all pages/fonts or measurement accuracy. Existing blank/template browser regressions rerun.
- Remaining critical gaps: independent PDF object → actual review-request/approval handoff, source-aware project listing, complete authoring/undo/selection tools and view persistence, guest delivery/receipt and full page/panel/exception audit. Current independent PDF drafts do not yet enter the seeded quantity/approval reducer. Overall goal remains active.

## Independent PDF review and revision loop

- Added source-aware local review rounds for independently created PDF documents rather than routing them into fabricated seeded quantities. Requests freeze PDF hash/name/pages, all current overlay objects, target object and reason. Role simulation remains explicitly local; no notification, authentication or server approval is implied.
- Same-workspace request → reviewer correction → author edit/resubmit → reviewer completion → approver approval now works. Draft editing is disabled during review/approval and for non-author roles; new revision after approval retains earlier snapshots. Per-round reasons and target-location navigation are visible in the inspector. No scale/quantity approval claim.
- Added failing review lifecycle/persistence test, then 33 model/presenter tests passed and typecheck passed. Extended `verify-workflow-pdf.mjs` through R1 correction/R2 approval, refresh with original reconnection, R3 editing, preserved earlier names and mobile layout. Existing blank/template browser regressions pass. `/tmp/1hk-local-pdf-approved.png` inspected.
- A failing browser check caught the local project card still claiming no source; it now displays actual filename and revision and separates local work from seeded demos.
- Still incomplete: unification with global tasks/review inbox and delivery, arbitrary snapshot visual comparison, actual quantity/estimate evidence mapping, richer geometry editing/undo/multiselect, external guest/receipt, and full original inventory audit. Review model currently limits to 30 rounds and local role selection is not server permission enforcement. Goal remains active.

## Local review inbox and approved snapshot navigation

- Added local PDF work sections to tasks and reviews, explicitly separated from seeded demo work. Tasks include pending review/correction/approval only; reviews retain completed records. Search/status filter and reset cover empty results. Entries retain actual file/page/revision/target and next simulated role.
- Opening an entry sets the correct page, selected object and local role without creating a new example. Original PDF reconnection is still required on route remount. Completed approval opens frozen round objects in a read-only snapshot; current draft remains separate.
- Browser regression initially caught approved R2 opening the edited R3 object name. Snapshot-specific rendering now preserves R2, locks role switching and limits navigation updates to page only so viewing does not overwrite current objects. Current R3 remains accessible from the work list.
- 34 model/presenter tests pass. Extended PDF browser journey covers task appearance, search/reset, target selection, next-role handoff, approval disappearing from pending tasks, retained review entry and R2 object contents after R3 editing. Screenshot `/tmp/1hk-local-review-inbox.png` captures the local review list.
- Remaining: full task assignment/notification UI, independently created documents connected to delivery/guest receipt and quantities, source binary persistence, arbitrary older-round navigation/comparison, authoring completeness and full original scope audit. Overall goal remains active.

## Approved local PDF delivery and recipient-preview loop

- Local delivery now lists independently authored documents with approved rounds. Users choose an approved revision and recipient label, prepare a manifest preview, inspect frozen objects/review notes as a simulated recipient, and record confirmation or a correction request. Receipt feedback does not modify source approval/current draft.
- Saved package pins its approved revision even when current drawing is newer. Original/overlay/review deliverables are explicitly ungenerated; DWG and quantity/estimate outputs remain unconnected. No files, email, real receipt evidence or external link are created. One local configuration per document; explicit re-prepare warns that prior local receipt feedback is replaced.
- Added failing model/codec test, then 35 model/presenter tests passed; typecheck passed. Invalid saved delivery references to unapproved/nonexistent revisions are rejected. Extended PDF browser journey covers R3 draft/R2 package, recipient name gate, old object scope, correction/confirmation, reload and read-only approved canvas opening. Mobile capture `/tmp/1hk-local-pdf-delivery.png` inspected.
- Browser check caught unrelated sample R1 in aggregated delivery header; reviews/delivery now use personal-workspace context rather than an unrelated seeded revision. Local/sample sections remain labeled separately.
- Still incomplete: independent guest URL/access states, full delivery attempt/history/failure UI and real-output frontend handoff, quantity/estimate integration for local objects, full authoring tools, remaining page/state polish and full-scope audit. Overall goal remains active.

## Local object movement and editing history

- Reused existing screen-object history through a generic helper, preserving its original typed wrapper. Independent drafts now support grouped name/coordinate edits, copy/delete and undo/redo. Coordinates remain page-relative, not measurement units.
- Pointer-captured dragging uses a transient visual preview and one history commit per drag. Rectangle positions stay within the normalized page; copies are offset. Review/role/revision boundaries reset editable history; requested/approved/viewer states cannot edit or undo. History is limited to the mounted workspace, not persisted across refresh/route exit.
- A browser test first proved drag left X=100 unchanged; after implementation it passes movement, undo/redo, copy undo and saved-state reopening. 65 tests pass across workflow model/presenter and existing drawing-change/history regression; typecheck passed. Blank/PDF/template browser regressions pass, including requested-state undo/copy denial and fresh-revision history reset.
- Remaining: other geometric tools, multiselect/grouping/styles/rotation/resize, keyboard shortcuts, full mobile gesture audit, independent guest routes and full original page/state audit. Goal remains active.

## Local drawing kinds and style inspector

- Added line, circle and text starters alongside rectangles on independent local/PDF canvases. Shared SVG rendering preserves source styling while selection uses a separate dashed outline. Text is rendered as wrapped content in a bounded DOM overlay. Shapes remain schematic page-relative objects, not calibrated CAD geometry.
- Inspector exposes stroke/text color, line width and optional fill/transparent fill; changes use existing edit history. A shared shape schema now retains optional geometry/style fields in both live objects and review snapshots, preserving old rectangle-only drafts. External paint URLs and out-of-range widths are rejected.
- Failing persistence test first showed geometry/styles being stripped, then 66 workflow plus legacy drawing/history tests passed; typecheck passed. `verify-workflow-draft-tools.mjs` verifies four kinds, actual SVG stroke/width/fill, undo/redo, text preservation, reload and 390px overflow. Captures `/tmp/1hk-draft-tools.png` and `/tmp/1hk-draft-tools-mobile.png`; mobile inspected.
- Remaining: polylines/dimensions/arcs, resize/rotation/multiselect and keyboard controls, geometry precision across different PDF aspect ratios, guest flows and overall original-scope audit. Mobile toolbar/description/inspector currently pushes the canvas low in a long page and needs holistic layout polish. Goal remains active.

## Mobile canvas-first layout

- A browser layout test reproduced the independent mobile canvas starting at y=776.86 on a 390×844 viewport. Removed the duplicate mobile workspace heading, condensed toolbar labels into a four-column grid, and moved editing/source explanations into disclosure controls.
- Inspector/review is collapsible: initially closed on mobile unless entered with a selected request target, opens on object selection, and can be manually collapsed. Desktop remains initially expanded. Accessible tool names remain unchanged; warnings/errors and file selection are not hidden inside explanatory disclosures.
- `verify-workflow-mobile.mjs` passes canvas top below 560px, creation/selection, automatic inspector opening, manual collapse and source-help disclosure. `/tmp/1hk-mobile-canvas-first.png` inspected. Existing 66 model/presenter/legacy-history tests pass and typecheck passed.
- This improves initial mobile drafting, not all 18 pages or every responsive state. Actual PDF viewport controls, other geometry/multiselect tools, guest access, and full-scope audit remain pending. Goal stays active.

## Local keyboard editing

- Scoped workspace key handling adds arrow movement (1 relative unit; Shift 10), Delete/Backspace on focused canvas objects, Escape selection/tool cancellation and Ctrl/Command Z plus Shift-Z/Y history controls. Deleting focuses the workspace so undo remains reachable after the object disappears.
- Inputs, textareas, selects and editable content keep native editing behavior. Geometry keys apply only inside the drawing canvas with a selected object and writable role/revision, not arbitrary focused toolbar controls. Keyboard moves remain bounded by the same page-relative limits as pointer moves.
- `verify-workflow-keyboard.mjs` first failed X staying 100, then passed X101/111, undo/redo, delete/restore, input Delete isolation and viewer mutation denial. Existing 66 tests and typecheck pass; mobile/blank/PDF browser journeys rerun.
- Remaining: keyboard-only shape creation, command search, polylines/dimensions/multiselect, guest flows and full original requirement audit. This is not a claim of full keyboard accessibility or frontend completion. Goal remains active.

## Global search verification and keyboard-first placement

- Revalidated the existing worktree after the comparison-only turn; that turn did not advance implementation. The proposed 30-screen expansion is a proposal, not a replacement for the original 18-page/12-panel/10-state completion criteria or evidence that those are complete.
- Existing native-dialog search now has fresh browser evidence: screen/local-document names, empty results, exact document return, Ctrl/Command K, Escape and 390px layout. It does not search PDF contents or server files. Inspected `/tmp/1hk-workflow-search-mobile.png`.
- Added keyboard placement to the independent canvas: choose a tool, focus the now-tabbable canvas, Enter places the shape centrally, then existing arrows move it. Pointer and keyboard creation share validation/history. Selection mode does not create duplicates; Escape cancels placement; non-author/review/source-not-ready gates remain shared. These are page-relative sketches, not calibrated engineering geometry.
- `verify-workflow-keyboard-create.mjs` first failed with zero objects after Enter, then passed creation, actual circle geometry, movement, undo/redo, cancellation and viewer guard. Search, mobile, existing keyboard and integrated PDF browser scripts passed. Existing 66 model/presenter/history tests and typecheck passed; tracked diff whitespace check passed.
- Still incomplete: local PDF objects connected to scale/quantity/rate/estimate evidence, polyline/dimension tools and precision, multi-selection, guest access/delivery exception journeys, source persistence and full screen/state audit. Prioritize the source-to-quantity flow over adding disconnected management pages. No deployment, backend or external transmission was performed; overall goal remains active.

## Independent PDF object → manual quantity/rate preview

- Added a local object inspector for manually entered raw quantity, correction, unit, rate and mandatory evidence text. It explicitly does not infer engineering measurements from schematic geometry. Values are validated, stored in the same session and retained in frozen review object snapshots. Editing uses existing history and author/source/review gates.
- Quantity and estimate pages now include independently authored objects with actual document/file/page/revision references, missing-link states, unconfirmed amounts and an exact return to the selected drawing object. Seeded scenario data is separately labeled and excluded from local totals; side-by-side local and sample sections still need a clearer scope switch.
- Source hash, object identity, page, position, geometry kind and label form the saved evidence comparison. Moving/renaming/copying an object marks its old manual quantity for reconfirmation and excludes it from the current preview total. Review approval is explicitly separate from quantity approval. There is no server calculation, tax/overhead, company-rate library mapping or real export.
- TDD first exposed quantity fields stripped during session decoding and a missing inspector field in the browser. The new model test and `verify-workflow-local-quantity.mjs` then pass manual quantity/rate, actual PDF source return, reload preservation, stale exclusion and mobile overflow checks. Screenshot `/tmp/1hk-local-quantity-mobile.png` inspected.
- PDF review/delivery and keyboard creation regressions passed. Mobile regression caught longer header text shifting canvas to y=566.78; concise header restored the existing above-fold check, which passed on rerun along with the local quantity journey.
- This is progress toward, not completion of, the calibrated source → measured quantity → company rate → estimate → review workflow. Required next work includes calibration/real geometry, rate mapping and approval semantics, local/sample scope separation, remaining tools/guest flows and the full original inventory audit. Goal remains active; no backend or deployment changes.

## Separate local-document and sample-workflow scopes

- Quantity, estimate, tasks, reviews and delivery pages now show one selected scope at a time. Explicit “내 도면 / 예시 프로젝트” controls replace simultaneous sections; an empty local scope no longer displays sample quantities or review tasks underneath it.
- Scope is carried in the route through navigation and refresh. Opening a local drawing establishes local scope; existing explicit scenario URLs retain sample behavior. Sample aggregate pages show the actual sample project/revision context instead of a personal-workspace heading.
- `verify-workflow-scope.mjs` first failed because the scope selector was absent. It now verifies local/sample exclusivity, local empty state, reload and quantity→estimate navigation, all three task/review/delivery switches and 390px overflow. `/tmp/1hk-workflow-scope-mobile.png` inspected. Local quantity/source return and search regressions pass; existing 67 model/presenter/history tests and typecheck pass.
- Scope separation does not yet cover project-library onboarding or company rates and does not implement missing domain functionality. Automatic measured quantities, richer authoring, independent guest/receipt states and the complete original page/panel/exception audit remain outstanding. Overall goal stays active; no deployment or backend changes.

## Local quantity evidence triage

- Added search across object name, drawing title, original filename and manual evidence, plus all/missing/stale/current filters with counts. Empty search results have explicit recovery; missing quantities remain addressable through exact object navigation instead of disappearing from the list.
- Kept whole-scope and currently displayed provisional totals distinct. Stale/missing records are excluded from both sums; filtering no longer obscures which total is being shown. Filter state is currently in the mounted screen only, not persisted across route changes.
- Extended `verify-workflow-local-quantity.mjs` with two actual UI-created PDF objects: one linked and one missing. It first failed at the absent search input, then passed case-insensitive filename search, no-match recovery, missing-object return, stale-only filtering and totals preservation. Scope-switch regression passes; 67 existing tests and typecheck pass. Mobile screenshot `/tmp/1hk-local-quantity-mobile.png` inspected.
- Remaining goal is unchanged: calibrated geometry, rate-library mapping and quantity-review UI, full drafting tools, guest delivery/access exceptions and original page/panel/state audit. This is local frontend triage, not production takeoff or financial approval. No backend, source-file or deployment mutation.

## Local rate catalog selection and provenance

- Independent quantity inspector now supports an inline searchable, explicitly fictional/versioned `DEMO-RATES-01` catalog with finish/civil/structure/door entries. Mismatched units are visible but disabled. Choosing an entry stages its value; existing “수량 근거 연결” commits through drawing history. No company database or market-price claim.
- Saved quantities retain catalog version/code, shown in local quantity/estimate rows and restored by the shared session/review-object schema. Schema validation rejects unknown codes and catalog references inconsistent with the saved price/unit. Direct price entry removes catalog provenance; changing unit clears the previous rate/reference to prevent silently applying an old-unit price.
- Model test first exposed stripped reference metadata; browser test first failed at missing catalog action. After implementation, 68 tests and typecheck passed. Extended local quantity browser journey verifies search miss, code search, mismatch denial, value staging, manual override, unit reset and provenance after refresh. Existing PDF review/delivery and mobile layout regressions pass. `/tmp/1hk-local-rate-picker.png` inspected.
- Still pending: actual company-rate library frontend CRUD/import/version selection, quantity approval versus drawing approval, calibrated measured geometry, full authoring and guest/access flows, and full original page/panel/state audit. This partial catalog linkage is not the complete company-rate requirement or frontend completion. Goal remains active; no backend or deployment changes.

## Independent recipient-preview route and unavailable states

- Added a standalone recipient route (`recipientDocument` + package sequence) without the internal sidebar or demo controls. It shows the pinned approved object/review manifest, recipient, and local confirmation/correction form. It explicitly states original/output files were not transmitted/generated and this is not external sharing, authentication or proof of receipt.
- Sender can open the route and expire it. Re-preparing increments the package sequence; old addresses show replaced-state instead of silently opening newer data. Expired addresses hide the manifest and cannot record feedback. A separate tab without the local session shows missing-data guidance. The preview return button is explicitly internal/simulated.
- Model TDD first exposed missing package identity, then verified sequence replacement and expired-feedback denial. Extended actual PDF journey first failed at missing recipient action; it now verifies independent shell, frozen R2 names after R3 changes, response/reload, expiry, replacement and a fresh tab missing data. Existing inline recipient preview remains available for compatibility.
- Desktop layout test found the inherited sidebar grid limited the recipient to 224px; standalone single-column styling fixes it. Desktop width and mobile overflow checks pass; `/tmp/1hk-recipient-mobile.png` inspected. PDF and scope-switch browser regressions, 69 model/presenter/history tests and typecheck pass.
- Still not complete: real guest access/request-access UI, independent preview of actual received PDF/output files, package history/retries, company rate management, quantity-review/calibration, drafting completeness and full original scope audit. Existing backend/auth/transmission remain untouched; goal stays active.

## Recipient approved PDF viewing

- Recipient route now expands a read-only approved drawing view using the existing local PDF renderer and shared shape renderer. Same-source SHA-256 validation is reused; on-source callbacks intentionally never replace frozen metadata. Selecting approved object references changes only component-local page/highlight state.
- This opens a PDF the viewer already has; no file was actually delivered and no download/export is fabricated. It displays approved overlay positions, not current draft objects. These remain page-relative schematic overlays with the existing aspect-ratio/engineering-accuracy limitations. Collapsing/reopening or reload requires original file reselection.
- Extended actual PDF browser test first failed on the missing drawing action. It now verifies mismatched-source denial/no canvas, same-source canvas, R2 object visibility without R3 names, page-specific location selection and byte-for-byte unchanged serialized session while viewing. Recipient desktop/mobile capture includes the rendered PDF; `/tmp/1hk-recipient-mobile.png` inspected. Full PDF flow passes along with 69 existing tests and typecheck.
- Remaining original scope includes richer drafting/calibration/quantity review, company rates, real-output handoff UI, access/retry/history exceptions and full page/panel/state audit. Recipient mobile reader works but remains vertically long and needs later layout polish. Overall goal is not complete; no backend or deployment changes.

## Preserve replaced delivery configurations

- Re-preparing a local delivery now archives the previous configuration, recipient, last status, expiry marker and feedback instead of losing them. Sender can expand previous configurations and open their referenced approved revision read-only. Current response and earlier comments are presented separately; these are local preview records, not server transmission/receipt evidence or timestamped audit events.
- Session codec retains history and validates that current and archived configurations reference approved rounds. Local history is capped at 100 without silent eviction; another prepare is refused with a visible limit notice. No historical records are deleted.
- TDD first showed missing preserved feedback, then browser test showed missing history disclosure. Extended PDF journey verifies history after re-prepare/reload and opens the correct old approved object while current draft stays newer. `/tmp/1hk-delivery-history.png` inspected.
- Regression found first prepare introducing an explicit undefined history key that disappeared on serialization; fixed by omitting it until history exists. Invalid history test now feeds raw malformed session JSON (the encoder itself also rejects it). 70 tests pass; PDF workflow browser regression passes. Overall goal remains active; outstanding scope still includes company-rate management, calibrated quantities/quantity approval, richer drafting, remaining access/retry states and full inventory audit.

## Original inventory sweep — presentation evidence, not full completion

- Added `verify-workflow-inventory.mjs`: opens all original 18 page routes at 1440px and 390px, checks heading/content, page errors and document overflow, and captures each route. First sweep found mobile overflow on documents, quantities, estimate, rates, changes and materials. DOM measurements showed the new enclosing section at 718px despite a 390px viewport. Added a constrained grid wrapper so tables scroll inside their existing container rather than expanding the page. Rerun: all 36 render checks pass. `/tmp/1hk-inventory-390-documents.png` inspected; other route captures are audit artifacts, not all visually reviewed.
- Added `verify-workflow-panel-inventory.mjs`: original 12 panels × desktop/mobile entry, title, dialog overflow and Escape closure, with a real UI request to reach review/approval panels. First sweep found mobile model navigation inaccessible because its only button was inside the hidden object tree. Moved the single model-structure button into the always-visible workspace mode bar. Rerun: all 24 panel checks pass. One browser execution approval timed out before launch; the permitted retry succeeded, no server restart.
- Existing ten-exception browser verification passes permission denial, reconnect identity, retry, offline draft retention and expired exit. This does not prove every exception across every page or every actual source format. Typecheck and 70 regression tests pass.

### Evidence boundaries and remaining work

| Requirement | Current evidence | Not yet proven / incomplete |
|---|---|---|
| 18 pages | All render on desktop/mobile without pageerror/document overflow | All business actions, full visual polish, role variants and back/forward paths |
| 12 panels | All reachable/render/close on desktop/mobile | Full combined action coverage and accessibility/focus audit |
| 10 exceptions | Existing representative recovery browser test passes | Cross-page matrix, actual-source combinations and complete preserved-input audit |
| Three workflows | Prior scenario journey tests cover correction/resubmit/approval/delivery | Fresh full-suite run after every remaining change; real local-object equivalence |
| Company rates | Source inspection confirms one demo table row + staged rate picker | Company library CRUD/import/version workflow, not completed |
| Members/settings | Source inspection confirms example-member list and static criteria + invitation panel | Member-role management and full settings interactions |
| Local drawing chain | PDF → editable overlays → manual quantities/rate references → drawing review → recipient preview | Calibrated geometry, richer tools, independent quantity-review domain and output handoff |

- Original scope remains intact. Rendering 18/12/10 is a necessary baseline, not sufficient proof of the user's full frontend goal. Continue with incomplete workflow/UI items rather than declaring completion from inventory counts. No production/backend/deployment changes.

## Member role-plan interactions

- Replaced the static sample member list with a scenario-local role-plan editor. Names/emails and planned author/reviewer/approver/viewer roles can be added or edited, with email identity normalization, duplicate guidance, cancel and a 50-member preview limit. Existing invitation panel remains separate.
- Explicitly a role allocation draft: no real membership, email or access-right mutation; it never changes the acting scenario role. Author/approver preview can edit the plan; reviewer/viewer cannot. Each scenario stores its own plan in the existing versioned session codec.
- TDD first exposed missing stored members, then missing UI fields. `verify-workflow-members.mjs` passes invalid email blocking, add/edit, refresh, viewer denial, scenario isolation and mobile width. `/tmp/1hk-members-mobile.png` inspected. 71 tests and typecheck pass; tracked diff whitespace check passes.
- This does not implement production organization authorization or the full Admin/Commenter role matrix. Pending frontend work includes invitation acceptance/access states, company-rate management, calibrated quantity and approval domains, authoring completeness and broader user-flow audit. Overall goal remains active; no backend/deployment changes.

## Scenario pricebook version workflow

- Added local catalog registration, search, append-only revisions, previous-version disclosure and explicit application of a selected version. Applying v1 remains pinned when v2 is registered; manual rate entry clears the catalog reference. Unit/rate/reference mismatches are rejected. Approved snapshots retain a cloned rate source.
- Catalog and applied provenance survive the existing session codec. This is scenario-local frontend data, not a company database or market price feed. Independent local-document quantity rows still use their separate demo catalog; integration and real import remain incomplete.
- Fixed native Node test loading by using a TypeScript extension supported by the existing compiler configuration. Added regression coverage for manual-rate provenance removal and session roundtrip. All 72 tests and typecheck pass.
- Fresh browser checks pass catalog registration/revision/pinning/reload/viewer denial/mobile width and all three architecture/IFC/civil correction-resubmit-approval-delivery journeys. `/tmp/1hk-pricebook-mobile.png` visually inspected. No backend, production data or deployment changes. Overall frontend goal remains active.

## Registered pricebook to local PDF quantity

- Local PDF object quantity picker now offers the selected scenario's registered rate versions alongside explicitly separate fixed demo rates. The scenario label and local-only provenance are visible. Selection stages the amount; the existing save action persists a copied code/name/unit/rate/version/source snapshot. Manual rate or unit edits clear the reference. Incompatible units are disabled.
- Quantity schema preserves registered provenance, rejects mismatched amount/unit and simultaneous demo/registered references. Quantity and estimate rows show the saved version and source, independent of later catalog changes. This is a bridge to scenario-local registration, not a shared organization catalog or market feed.
- TDD demonstrated missing provenance persistence and the missing picker action before implementation. New `verify-workflow-local-pricebook.mjs` passes registration → actual generated PDF → object → quantity → registered v1 selection/save → v2 registration → unchanged v1 amount → reload/mobile. Existing local quantity browser regression also passes. Mobile quantity/provenance screenshot `/tmp/1hk-local-pricebook.png` inspected. 73 tests and typecheck pass, including approved review snapshot provenance.
- Remaining: dedicated local/company catalog ownership and import UI, calibrated measurement and independent quantity approval, richer drawing tools, invitation/access flows and output handoff. Full frontend goal is still active; no backend or deployment changes.

## Pricebook CSV paste/import preview

- Added explicit CSV text paste → validation preview → atomic append-version interaction inside the existing company-rate screen. Fixed five-column Korean header, quoted comma/newline handling, nonnegative plain decimal amounts, duplicate-code normalization, required source and the existing 200-version storage cap are checked before any entry is added. A failed batch leaves existing entries unchanged. Existing code imports create another version without updating applied amounts.
- Input edits invalidate the staged preview; closing the panel preserves the mounted input. Successful import clears it to avoid accidental repeat submission. Viewer/reviewer/approver cannot import. Native React text rendering is used, with no HTML interpretation or spreadsheet formula execution. This is CSV text only, not XLSX parsing, automatic column mapping or server upload. Unsubmitted input is not persisted across navigation/reload.
- TDD first demonstrated the missing import state transition, then the missing browser entry. `verify-workflow-pricebook-import.mjs` passes malformed-row recovery, preview invalidation, v1/v2 append, refresh, role denial and mobile width. Existing pricebook browser regression also passes. `/tmp/1hk-pricebook-import-mobile.png` inspected; 74 tests and typecheck pass. No deployment/backend changes; complete original frontend scope remains active.

## Local PDF drafting size and rotation

- Added relative width/height and center rotation to rectangle, line and text frames; circles expose diameter and rotation without becoming ellipses. Existing untransformed objects retain their 120×80 default frame. All shared draft renderers (including approved recipient view) consume the same size/rotation values.
- Resizing clamps the unrotated frame position to the page; drag, keyboard movement, copy and numeric position input respect the resized frame. Rotation may clip at the page edge, explicitly disclosed; this is schematic relative geometry, not calibrated CAD dimensions. The session schema rejects nonfinite/out-of-range frame values and unrotated frames outside the page.
- Geometry changes invalidate existing manual quantity evidence while preserving legacy untransformed evidence signatures. Width/height/rotation survive review snapshots and session restore; requested/approved views remain read-only. Editing participates in existing transaction-grouped undo/redo.
- TDD first exposed absent persisted frame fields, then missing size inputs. `verify-workflow-draft-frame.mjs` passes size/rotation, bounds adjustment, copy, undo/redo, review/approval locking and reload/mobile; existing draft-tools regression passes. 75 tests and typecheck pass. `/tmp/1hk-draft-frame-mobile.png` inspected: rotated shape clipping is visible and disclosed; mobile PDF reader remains vertically long and properties are collapsible. Full goal remains active: calibrated measurement, polylines/dimensions/multiselect/layers, independent quantity approval, access flows, and handoff/UI polish remain incomplete. No production/backend/deployment changes.

## Local document layers

- Added local layer creation (up to 30), active drawing layer, selected-object layer assignment, visibility and lock controls. PDF remains a separate locked original. Existing documents use an implicit default layer; stored layers require unique IDs and a default layer, and object references must resolve in both live documents and review snapshots.
- Locked/hidden layers prevent object modifications, deletion, movement, reassignment and quantity edits; central object-change checks supplement disabled controls. The object undo history resets on a layer-configuration change, explicitly disclosed; layer settings themselves are not undoable yet. Layer order/rename/delete and integrated layer undo remain incomplete.
- Review requests clone layer configuration; approved snapshot routing uses the captured configuration, not current draft layers. Workspace and recipient renderer honor stored visibility. Temporary reveal and evidence-location navigation allow inspection without changing stored visibility/lock state. Layer assignment does not invalidate unchanged geometry quantities.
- TDD first showed omitted session layer state, then absent creation UI. `verify-workflow-local-layers.mjs` passes create/assign/lock, keyboard deletion denial, hide/temporary reveal, reload/unlock/edit/undo/mobile. Frame-edit browser regression and full existing PDF review/delivery browser script pass. 76 tests and typecheck pass. `/tmp/1hk-local-layers.png` inspected and spacing/card grouping improved. Overall original frontend objective remains active; no backend or deployment changes.

## Integrated layer/object undo and layer organization

- Replaced object-only local history with shared shape+layer snapshots using the existing generic history utility. Layer configuration no longer resets edit history. Undo/redo remains scoped to the mounted editing session and resets at role/review-revision boundaries or external state replacement; it cannot cross into an approved revision. Previous comments above describing the layer reset limitation are superseded.
- Added staged layer rename, front/back ordering and empty-layer deletion. Default, locked and occupied layers cannot be deleted. Layer reference validation also guards configuration updates independently of disabled controls. Duplicate names are rejected. New layers start at the front, and list order (top/front) drives the same stable drawing ordering in workspace and approved recipient rendering.
- Undoing layer creation/removal safely falls back to the default active layer when necessary. Deleted empty layers are recoverable with undo during the same editing session; reload retains current state but not history.
- TDD first reproduced disabled undo after layer addition. New `verify-workflow-layer-history.mjs` passes interleaved shape/layer undo, rename/reorder, safe deletion/undo, reload/mobile. Existing layer and frame browser regressions pass; 77 tests and typecheck pass. `/tmp/1hk-layer-history.png` inspected. Full frontend objective remains active; no production/backend/deployment changes.

## Local polyline authoring and overlapping-object selection

- Added click-to-append polyline creation with visible pending points, explicit finish/cancel/last-point undo, Enter/Backspace/Escape and coordinate inputs. SVG inverse screen transform maps clicks into drawing coordinates. Pending points stay above existing objects; unfinished paths are not stored. Current schematic limits are 2–100 points and relative frame width ≤600/height ≤400, disclosed in the creation panel.
- Completed paths store normalized vertices inside the existing resizable/rotatable frame. Open polyline and closed polygon render differently; vertex coordinates can be edited numerically in a disclosure panel. Copy/history/layer restrictions and review persistence reuse existing paths. Changed vertices or closure invalidate manual quantity evidence; no engineering length/area calculation is implied.
- Browser regression reproduced an overlap selection problem after copying a polygon. Added a current-page object selector so covered objects can be selected without forced pointer events. Selecting a hidden object temporarily reveals its layer without changing saved visibility.
- TDD first showed unsupported stored kind/vertices and missing creation UI. `verify-workflow-local-polyline.mjs` passes click creation, last-point undo/cancel, closure/history, vertex edit/copy, overlap selection and reload/mobile. Existing draft-tools and full PDF review/delivery browser regressions pass. 78 tests and typecheck pass; `/tmp/1hk-local-polyline.png` inspected. Remaining main editor work includes multiselect, calibrated dimensions/measurement, richer architectural objects and mobile layout consolidation. Full original frontend goal remains active; no backend/deployment changes.

## Local multiselection and atomic group edits

- Added Shift+click/Shift+keyboard selection, checkbox selection list, visible-page select-all and clear. Multiple selected objects highlight together, can be dragged or moved by arrow keys/relative numeric offsets, copied and deleted. Common translation clamps at the page boundary without changing relative spacing. A hidden/locked member blocks the entire group operation; no partial edits occur.
- Copy creates distinct object identities and retains geometry/style data, so any copied quantity basis is stale by the existing identity check. Group operations use the shared object/layer undo history. Individual properties, quantity input and single-target review request are unavailable while multiple objects are selected, preventing accidental edits to only the last selected object. Group input controls are shown only for two or more selections.
- TDD first exposed the missing atomic geometry operation and absent multi-edit UI. `verify-workflow-multiselect.mjs` passes Shift selection, move/copy/delete/undo, an actual pointer drag with preserved 200-unit spacing, locked-group denial and reload/mobile. Existing frame and polyline browser regressions pass. 79 tests and typecheck pass; `/tmp/1hk-multiselect.png` inspected. Selection is transient, not a persistent CAD group/block; box selection, alignment and bulk property editing remain incomplete. Next priority remains calibrated/quantity-review flow and workspace layout consolidation, not declaring overall completion. No backend/deployment changes.

## Independent local quantity review and amount-approval preview

- Added a separate review workflow on local quantities/estimate pages: choose document → request registered quantities → reviewer correction or verification → approver amount-confirmation preview. It does not mutate drawing-review rounds or imply that drawing approval approves quantities. Local role simulation and unconfirmed/non-contractual amounts are explicit.
- Requests capture source/revision and copies of included quantity/rate/provenance rows. Missing-quantity objects are explicitly excluded; hidden layers with registered quantities are included. This does not approve completeness of the entire drawing/project. Stale source/geometry quantities cannot be requested. Changes after request block verification/approval until a new request; earlier snapshots and approvals remain unchanged. Reviewer corrections can be resubmitted as another sequence. Current registered values and prior approved values are displayed separately.
- Session schema retains up to 20 request rounds and bounded snapshot rows; this is not a timestamped/server audit ledger. Previous-round disclosures retain frozen values and notes. Real quantity-engine verification, tax/overhead rules, selection-specific review scopes, actual role authorization and delivery integration remain incomplete. Large-session limits also still warrant a storage-size audit before claiming robust recovery for maximum data volumes.
- TDD first showed missing independent persistence, then absent review UI. `verify-workflow-quantity-review.mjs` passes correction/resubmit/review/approval, reload, post-approval amount changes and stale-state indication, viewer action absence and mobile width. Existing local quantity browser regression passes. 80 tests and typecheck pass; `/tmp/1hk-quantity-review.png` inspected. Entire frontend goal remains active; no backend/deployment changes.

## Autosave size consistency and explicit file backup/recovery

- Reproduced a writer/reader mismatch: encoder could emit >2,000,000-character autosaves that decoder rejected on refresh. Encoder now applies the same default size limit before storage writes, preserving the previous stored value on failure. Both codecs accept a bounded 20,000,000-character backup mode; native browser quota failures still surface separately.
- Added collapsed global backup/recovery disclosure, opened automatically for storage failures or invalid stored data. Current validated snapshot can be downloaded as JSON; invalid original tab data has a separate raw download path before replacement. Files include recorded drawing/layer/quantity/review and stored drafts, not PDF/DWG/IFC bytes, unfinished polylines or every unsubmitted form. Disclosure warns about sensitive notes/amounts and source reconnection.
- Import validates file size/schema, previews document/object counts, and requires explicit confirmation before replacing this preview tab's state. Invalid/cancelled imports preserve current work; async selection tokens prevent stale reads from replacing a newer candidate. Larger-than-autosave backups warn that restored work remains in memory and must retain its backup file. This is not a server backup or guaranteed recovery for arbitrarily large data.
- TDD reproduced the size mismatch, missing download flow and cancellation not clearing the file input. `verify-workflow-backup.mjs` passes storage-denied actual download/readback, malformed file rejection, cancel/reselect, explicit replacement and restored drawing/mobile. Existing session browser regression passes. 81 tests and typecheck pass; `/tmp/1hk-backup.png` inspected. Full frontend goal remains active; no production/backend/deployment changes.

## Frozen quantity approvals in local delivery

- Delivery configuration now optionally selects a quantity approval matching the selected approved drawing snapshot. Drawing-only delivery stays explicit. Package history retains the selected review sequence; validation rejects absent, ambiguous or mismatched references instead of borrowing current values.
- Sender, history and recipient render fixed quantity totals, raw/correction/rate rows, excluded counts and review notes. Recipient hides the package if its quantity reference is invalid. Later live quantity edits leave earlier delivery totals unchanged. This remains a frontend simulation, not generated Excel, actual monetary approval or external transmission.
- TDD reproduced the missing package reference and missing recipient amount. 82 unit/render tests and typecheck pass; existing full PDF browser regression passes. New selection interaction still needs a dedicated browser journey and visual inspection; current automated coverage verifies its rendered presence, pinned data, persistence and mismatch denial. Overall scope remains incomplete and goal active. No backend or deployment changes.

## Quantity-delivery browser handoff verified

- Added `verify-workflow-quantity-delivery.mjs`: real local PDF → manual quantity → separate quantity approval → drawing approval → explicitly selected quantity result in delivery → independent recipient → refresh → mobile → receipt. It passes with no captured page errors; `/tmp/1hk-quantity-delivery.png` inspected and mobile width checked.
- The browser test initially selected the global backup file input during route transition. Evidence showed the document remained source-free. The test now uses the PDF-specific accessible label and waits for render completion, rather than a generic file input or arbitrary delay.
- Browser TDD then exposed the absent rate provenance in the recipient report. Added manual/no-catalog disclosure and frozen catalog code/version/source rendering. This turn verifies the manual branch in the browser; catalog-specific rendered output still warrants a dedicated fixture. 82 unit/render tests and typecheck pass freshly. This closes the prior dedicated browser-selection gap, not the whole frontend goal. Next substantial work remains workspace mode/layout consolidation and a full page/panel/exception completion audit.

## Local inspector navigation and stable canvas context

- Added layer/property/quantity/review section shortcuts without unmounting forms or changing the document/selection. Destinations receive keyboard focus; collapsed inspector opens before navigation. Desktop inspector scroll is bounded independently so review input no longer pushes the canvas offscreen. Mobile shortcuts remain sticky and section headings leave clearance beneath them.
- Browser TDD caught missing navigation, an incorrect Korean accessible name, and mobile shortcuts scrolling offscreen. `verify-workflow-inspector-navigation.mjs` passes stable desktop canvas position, retained selection and unsubmitted review note, mobile focused destination, sticky shortcut position and no horizontal overflow. `/tmp/1hk-inspector-navigation.png` inspected. Quantity-delivery browser regression also passes with the independent-scroll layout; 82 unit/render tests and typecheck pass.
- This is section navigation, not completed 2D/3D/review mode architecture. The inspector still exposes all sections in its scroll area; richer mode simplification, calibrated dimension UI and the full remaining-scope audit remain open. No backend/deployment changes; overall goal stays active.

## Local document findings and exact quantity-document handoff

- Added collapsed local findings in the live document inspector. Rules identify missing source metadata, quantity-unregistered objects, stale quantity evidence and current quantity-review stage. Missing quantities are explicitly optional candidates, not assertions that every graphical object must be estimated. No AI or engineering-validation claim; approved readonly snapshots do not display live-action findings.
- Source action focuses the PDF input. Object actions retain exact ID/page, temporarily reveal a hidden layer without unlocking it, and focus the quantity section. Saving current quantity evidence updates the list. The model derives from current local records and does not mutate them.
- Workspace quantity navigation now passes `quantityDocument` so a second document does not silently open the first document's review. Unknown explicit IDs show unavailable rather than borrowing another document. General all-document quantity listing remains separate from this selected review target.
- `verify-workflow-local-findings.mjs` passes PDF input focus, missing-quantity action, resolution after saving, and exact second-document review handoff. Inspector navigation regression passes; 83 unit/render tests and typecheck pass. Test setup fixes distinguish actual list contents from explanatory text and await URL navigation before asserting its ID.
- Remaining: byte-level reconnect status belongs to the existing PDF connection UI (these findings check source metadata, not current file readiness); local review inbox integration, general drawing review findings, richer filtered/large lists and mobile findings-specific visual audit are still open. Overall goal active; no backend or deployment changes.

## Quantity review inbox handoff

- Local tasks and reviews now include a separate quantity-review list alongside drawing requests. Tasks exclude approved latest rounds; reviews retain them. Rows show requested revision, frozen amount, request note, expected next role and a changed-evidence warning. Search and no-result reset operate on document/source/request text. Opening a row carries the exact document ID to the existing quantity review screen; it does not silently grant a reviewer role.
- Render test covers pending/approved filtering and changed evidence. Extended `verify-workflow-local-findings.mjs` covers second-document request, task search/reset, exact review reentry, reviewer/approver completion, removal from pending tasks, approval visibility/reload in reviews and mobile width. `/tmp/1hk-quantity-inbox.png` inspected. 84 tests and typecheck pass. Older rounds remain in the selected document's review history, not separate inbox rows. Actual assignment/notifications remain outside scope.
- This closes the pending quantity-inbox integration gap in the previous section; general findings-to-task aggregation, local revision comparison and full import/output UI remain incomplete. Overall goal active; no deployment/backend changes.

## Approved quantity baseline versus current local quantities

- Added comparison to the selected local quantity-review document. Users select a prior approved quantity sequence, see its drawing revision versus current revision, frozen/current amounts and signed difference. Item disclosure distinguishes added, removed/unlinked, changed and unchanged registered quantities, with exact IDs/pages and old/new quantity/unit/rate. Unit changes are labelled; unlike units are never directly subtracted.
- Different source hashes block monetary comparison. Stale current quantity evidence withholds the overall current total and difference; per-row stale differences are also withheld. Approved records remain untouched. This compares registered quantities only, not complete project cost, tax or overhead. Same drawing revision can still contain a later quantity edit; the approval sequence disambiguates the baseline.
- Model test covers +90,000 increase, -450,000 removal, stale-source suppression, incompatible source and absent sequence. Browser test first exposed absent comparison UI, then passes correction/resubmit/approval → current quantity edit → fixed 450,000 versus 540,000 → +90,000 display; existing mobile width check passes. `/tmp/1hk-local-quantity-comparison.png` inspected. PDF test selectors were narrowed to the dedicated PDF input to avoid the backup-input route-transition race. 85 tests and typecheck pass.
- Remaining comparison scope: two arbitrary historical revisions, graphical overlay, deleted-object readonly source return and standalone local changes-page integration. Rate-only, added and unit-change browser fixtures also remain. Do not mark full comparison or overall goal complete. No backend/deployment changes.

## Comparison-to-drawing evidence navigation

- Comparison rows now open their exact current object/page through the existing local workspace route. Removed objects show unavailable rather than targeting another object. A prior readonly drawing link is offered only when the approved drawing snapshot and selected quantity approval match through the existing source/quantity check; quantity-only approvals without matching drawing geometry explain why no prior location is available.
- Root route forwards snapshot/Viewer for historical links and retains local document identity for returning to quantities. Render tests cover present/current, removed/unavailable, matching prior drawing and absence of an invented prior link. Extended quantity-review browser test passes current comparison → same selected object with quantity 12 → quantities with +90,000 difference. 85 tests and typecheck pass.
- Prior readonly navigation availability is render-tested, but its full browser click path with deletion is not yet covered. Returning currently selects the latest approved comparison baseline; preserving an explicitly selected older comparison baseline and expanded disclosure is still open. Graphical overlays and arbitrary historical-to-historical comparisons remain incomplete. Overall goal active; no backend/deployment changes.

## Comparison baseline retained through navigation

- Reproduced an older approved quantity baseline resetting to the newest after reload (expected #2, received #3). Selected baseline now travels with document identity in the URL, through current/historical drawing navigation and back to quantities. An explicit unavailable baseline shows an unavailable selection/result, never silently switches to latest; the user can choose a valid baseline to recover.
- Extended browser quantity-review journey creates two approved baselines, selects the older one, verifies refresh persistence, opens the current object, returns with the same comparison, and tests missing #99 plus recovery. Browser passes, as do 85 unit/render tests and typecheck. This closes older-baseline persistence from the previous section; expanded disclosure/scroll state and complete browser back-forward/form-draft interaction still need dedicated coverage.
- Remaining full comparison work includes graphical overlay, two historical snapshots and local changes-page integration. Overall frontend goal remains active; no backend/deployment changes.

## Two approved quantity snapshots comparison

- Comparison target can now be current work or another approved quantity sequence. Historical comparison uses only the two frozen item/source collections, so unrelated later live edits do not contaminate it. Reverse direction changes the delta sign, identical baselines yield zero, missing targets are unavailable and differing hashes remain incomparable.
- Both selections persist in URL and are forwarded through drawing evidence navigation. Historical target rows offer only matching readonly approved drawing evidence; current geometry is not substituted. UI names the target sequence instead of calling historical values current. Source/registered-only/non-contractual limitations remain visible.
- Browser test exposed a rapid successive selection race where the target update used a stale baseline; event-time selection tracking fixes it. Extended quantity-review browser test passes +90,000 and -90,000 across #2/#3, reload of both selections, missing-baseline recovery and existing review flow; repeated run passes. `/tmp/1hk-historical-quantity-comparison.png` inspected at mobile width. 85 tests and typecheck pass (historical model assertions added to existing comparison test).
- This completes the quantity-snapshot comparison choice, not graphical drawing overlays or the standalone local changes-page integration. Full historical drawing-link/deletion browser coverage and broad navigation draft/focus audits remain. Overall goal active; no backend/deployment changes.

## Standalone local changes page

- Changes now participates in explicit local/sample scope. Local changes shows a document selector and the same approved/current or approved/approved comparison, without sample project amounts. No-document and unknown explicit document states are explicit; picking another document resets its comparison selections.
- Evidence links from this page carry a changes-return marker. Workspace offers a dedicated return button retaining document and baseline/target selections; the ordinary quantities link remains a quantities link. Existing readonly snapshot routing is reused for historical evidence.
- Extended quantity-review browser flow proves direct changes entry with a historical comparison, target switch to current, exact object entry and return to changes with baseline #3 preserved. It also checks no sample 1,008,000 amount and mobile overflow; `/tmp/1hk-local-changes-page.png` inspected. 85 unit/render tests and typecheck pass. No actual source/quantity/approval mutation occurs from comparison selection itself.
- Remaining: graphical shape overlay, complete deleted-history navigation and broader mobile/back-forward/focus matrix. Full frontend goal active; no backend/deployment changes.

## Local approved/current drawing overlay

- Changes page now includes a separate drawing-approved-revision selector and readonly overlay against current objects. ID-based geometry/style/page/name/layer comparison identifies added, removed, changed and unchanged objects; quantity-only changes stay in quantity comparison. Default geometry values normalize before comparison. Hash mismatch blocks overlay instead of attempting alignment.
- Previous objects render red/dashed, current green/solid and optional unchanged objects gray. The text list names change status and offers separate previous/current page locations, including removed objects. Hidden-layer objects are explicitly included for comparison without changing layer state. Original PDF rendering reuses the existing hash-checked reconnect/zoom/page/pan component; no source or object record is rewritten.
- Browser fixture contains actual two-page PDF bytes with valid fingerprint and frozen approval/current geometry. `verify-workflow-drawing-overlay.mjs` passes same-source reconnect, changed-before/after display, removed/added page-2 navigation, exact stored document equality and mobile width. `/tmp/1hk-drawing-overlay.png` inspected. Reconnect-before-render behavior was retained and explanatory text corrected; a TypeScript widening error was fixed with readonly typed return. Full 86 tests passed, focused overlay test reran after type-only fix, and typecheck passes.
- Limitations: this compares stored overlay objects, not PDF byte/content differences, native DWG geometry or engineering alignment. Layer order/visibility-only changes and arbitrary historical drawing pairs are not separately visualized. Mobile PDF surface remains taller than ideal. Drawing-baseline/selected-row refresh persistence and full keyboard/browser-history audit remain incomplete. Overall goal active; no backend/deployment changes.

## Mobile comparison and list–drawing round trip

- Revalidated the existing responsive PDF-height and stable focus-container changes against the current worktree. The mobile surface is capped through a 220–360px responsive height, and selecting a changed object's other page focuses the persistent comparison region instead of the PDF overlay that temporarily unmounts during rendering.
- Added a return control beside the drawing that restores focus and scroll to the exact previous/current location button used in the change list. The browser test first failed on the missing return control, then passed both a moved object's previous location and an added object's current location across pages. Source and approved records are not changed.
- Fresh verification: drawing-overlay browser flow, full existing PDF browser script, 86 unit/render tests, and typecheck pass. Inspected `/tmp/1hk-drawing-overlay.png` at mobile width. These checks resolve the mobile-height limitation above, not the remaining historical drawing-pair or refresh/history-state gaps.
- Competitor research informed the preceding scope discussion; it is not implementation evidence. The original frontend objective remains active, including missing integrated import/output, role/access, field/material and full exception flows. No deployment or backend changes.

## Import processing outcome prototype

- Extended the existing format/unit/warning wizard with a fourth processing-result stage rather than another disconnected page. Processing can be cancelled; failed outcomes block opening and offer retry or settings reset; partial outcomes require acknowledgement of missing-reference/geometry/font risks; ready outcomes can open the explicitly named existing sample workspace. Settings are dispatched only on opening, never on failure or cancellation.
- Every processing outcome is deliberately user-selected and labelled a screen simulation. No file bytes are uploaded, converted, or asserted compatible. DWG viewing, sample editing and unverified DWG re-save/delivery are distinguished. This does not implement native CAD or actual import jobs, and local real-PDF flow is unchanged.
- New browser verifier initially reproduced the missing processing action (after correcting the test to use the actual panel-opening control). It now passes DWG failed → retry → partial acknowledgement → workspace, and IFC/PDF cancellation → ready → workspace. Mobile width and runtime errors checked, `/tmp/1hk-import-results.png` inspected. Fresh 86 unit/render tests and typecheck pass.
- Remaining import scope includes local multi-file import manifests and persisted/reloadable job UI; output recovery, access/invitations, field/material integration and the original full frontend audit remain open. Goal active; no deployment/backend mutation.

## Local delivery output preparation

- Added an output-manifest and preparation panel to each saved local delivery configuration. It identifies the frozen drawing revision/source/page count/object count, review report and optional matching approved quantity sequence. It uses saved delivery settings rather than currently edited controls or newer live drawing geometry; missing drawing/quantity approval blocks preparation.
- Explicit frontend-only processing, cancellation, failure, retry and ready-example states are connected to the existing recipient flow. No file generation, downloads, CAD export, notifications or transmission occurs. Output state is transient and labelled; simulation cannot alter approval, delivery or receipt records.
- Extended the real-PDF quantity/drawing approval → delivery browser journey: the missing output panel failed first, then failure/retry/ready passed; complete session storage remained identical across output simulation, mobile width passed and independent recipient still showed the frozen approved amount after refresh and receipt. Screenshot `/tmp/1hk-output-preparation.png` inspected. Added render cases for fixed approved source, quantity omission and missing evidence gates. Fresh 87 tests and typecheck pass.
- This covers the output failure/retry presentation gap, not real exports or a persisted output-job queue. Original full frontend scope remains active, including local multi-file import, access/invitations and field/material integration; no production deployment.

## Expired share access request and owner decision

- Extended the existing external-share panel with request reason, pending state, owner-decision preview, rejection reason, request revision and restoration. Request/decision drafts are explicitly transient and never send notifications or assign real permissions. Content remains hidden during request, pending and rejected states.
- Added a guarded demo restore action: only existing author/approver roles with a nonempty bounded reason may reactivate an expired share. The exact frozen revision, object, quantity, disclosure permissions, omitted amount and prior feedback are retained, rather than re-sharing the current revision. A history entry records the demonstration decision.
- Model test first failed on expired status then passes restoration, no-scope-widening and missing-reason/viewer guards. Extended browser sharing flow passes rejection → amended request → owner restoration with previous 60 m quantity and amount still hidden, plus subsequent expiry/read-only regeneration. A broad test status selector was narrowed to the share panel after exposing a duplicate app-level status. Mobile dialog width and `/tmp/1hk-access-request.png` inspected. Fresh 88 tests and typecheck pass.
- Initial invitation acceptance, independent authenticated guest access, persistent request inbox and local-document sharing integration remain separate gaps. This is sample-scenario access recovery only; full frontend goal active, no production permissions/deployment changed.

## First invitation acceptance preview

- New/replaced share configurations now pass through an invitation screen before displaying recipient quantity/feedback content. It identifies invited address, frozen document revision, view/comment capability, amount inclusion and excluded editing/approval/company/project access. Existing saved-preview inspection remains an author-side preview, not authentication.
- Explicit account-state simulation covers invited account, other account and signed-out state. Other/signed-out states cannot accept; switching the simulated account enables acceptance. Decline keeps content hidden and allows reconsideration. Expired invitations cannot be accepted. All of this is labelled non-authenticated frontend simulation and acceptance is not a real persistent invitation.
- Browser test first failed because recipient content appeared before acceptance; it now passes no-content-before-accept, account mismatch/signed-out gating, switch, decline/reconsider/accept, view-only replacement, previous expired-share recovery and frozen disclosure behavior. Mobile width checked and `/tmp/1hk-invitation.png` inspected. Fresh 88 tests and typecheck pass.
- This closes the initial invitation presentation gap only. Local-document sharing/invitation integration, independently authenticated guest entry, persistent request inbox, field/material integration and the full original frontend completion audit remain open. No emails, permissions, backend changes or deployment.

## Whole-frontend regression and mobile exception coverage

- Re-ran original 18-page inventory at desktop/mobile (36 presentation checks), original 12-panel inventory at both widths (24 presentation/close checks), and all three architecture/IFC/civil correction/resubmission/approval/delivery/new-revision sample journeys; all passed against the current server.
- Expanded `verify-workflow-exceptions.mjs` from desktop-only to independent 1360px and 390px browser sessions. Each executes all ten exception views and permission denial, exact-source reconnect, unsupported retry, missing/stale setup recovery, AI bypass, offline changed-quantity retention, expired exit and empty-start navigation. Added horizontal-overflow assertions for each exception view; both full runs pass. Inspected `/tmp/1hk-workflow-expired-390.png`.
- Updated the original completion audit to remove stale missing-feature claims now contradicted by code/tests: local findings, quantity inbox, local comparisons, import/output simulations and invite/access recovery. Retained the remaining local-integration, scale/measurement, job/request persistence and navigation-matrix gaps, and explicitly separated presentation checks from complete workflow evidence.
- This turn strengthens previously missing mobile recovery evidence and corrects the next-action inventory; it does not claim full frontend completion or production readiness. Scale/measurement and actual selected-document field/material continuity remain priority work. Goal active; no backend or deployment changes.

## Real local PDF reference and distance preview

- Added a PDF-only measurement mode to the existing local canvas: two reference points, positive real length in metres, then two target points and a distance preview. Reference and target segments render above objects without changing source, objects, quantities or approvals. Page/source change resets the transient calibration; no claim of persisted engineering measurement.
- Normalized coordinates include rendered page aspect ratio, not the editor's fixed 800×520 coordinate ratio. Degenerate reference segments, invalid points/length/aspect and nonfinite results are rejected. Pointer click rounding is explicitly distinct from mathematical accuracy: a real 800×400 PDF fixture uses a 0.05m click tolerance around a hand-derived 5m result; exact normalized-coordinate unit and keyboard paths produce 5.000m. This tolerance is test-fixture-specific, not a field accuracy guarantee.
- Keyboard support uses focusable overlay, arrow movement (1%, Shift 10%), Enter/Space point placement and Escape close. Directional crosshair is visible; drawing Enter does not create objects while measuring. Existing drawing-tool selection exits measurement. Actual PDF reconnection is required.
- Unit test failed on the missing calculation module; browser test exposed click quantization then absent keyboard point handling, which was implemented. Browser verification passes pointer/keyboard placement, zoom consistency, complete saved-session equality, mobile width and page reset. `/tmp/1hk-measurement.png` inspected. Fresh 89 tests, typecheck and existing full PDF browser regression pass.
- Remaining measurement scope: area/path previews, calibrated object association, preserved per-page calibration and explicit review/quantity handoff. Full original frontend goal remains active; no backend/deployment changes.

## Calibrated path and area previews

- Extended the same local PDF measurement overlay with distance/path/area selection. Paths and areas accept up to 100 ordered points, require explicit completion, support last-point removal and reset the completed result after edits. Area outlines close visually; incomplete polygons are dashed. No holes or overlapping-region deductions are implied.
- Added calibrated open-path sums and simple-polygon areas with aspect correction; clockwise/counterclockwise input yields the same unsigned area. Nonadjacent crossings/touches, repeated adjacent vertices, degenerate areas, invalid coordinates and nonfinite sums/results are rejected. An overflow test failed first and prompted guarding both segment and total results.
- Model tests first failed on the absent measurement function; browser test first failed on the absent type selector. Updated browser flow passes keyboard 50m² rectangle → undo last point → 25m² triangle, and 15m open path from the same 10m reference. Existing distance/zoom/mobile/page-reset checks remain green; screenshot inspected. Fresh 90 tests, typecheck and existing PDF browser regression pass.
- Remaining: persisted per-page calibration/measurements and explicit object/quantity review handoff. All values remain temporary previews, not confirmed quantities or financial evidence. Goal active; no backend/deployment changes.

## Saved local measurement evidence

- Added optional append-only measurement records to local documents and the existing session/backup schema. Each record carries original source metadata/hash, page, drawing revision, measurement kind, normalized reference/target points, real reference length and page aspect. Result values are recalculated rather than trusted from saved scalar totals. Invalid calibration, geometry or out-of-range pages are rejected on restore; unique IDs and a 100-record limit are enforced.
- Editable connected local PDF work can explicitly save a completed measurement. Existing records are never overwritten. The list displays historical page/revision and unconfirmed result; loading restores reference, points, mode and completion only if source hash, page and revision match and the PDF is reconnected. Measurement preview remains available without granting drawing write authority. A new page/revision resets unsaved calibration.
- Session test failed because unknown measurement data was stripped, then passed encode/decode roundtrip and invalid-length/page rejection after schema integration. Browser test failed on absent save action, then passed save → reload → same-PDF reconnect → 15m path restore and disabled load on page 2. `/tmp/1hk-saved-measurement.png` inspected. Fresh 91 tests and typecheck pass; final focused schema/browser tests reran after added assertions.
- This is same-tab session persistence and existing backup inclusion, not server storage or cross-device durability. PDF bytes still require reconnection. Measurements are not approved quantities and are not yet tied to an object or included in quantity review/delivery. That explicit handoff remains next, alongside original local field/material integration. Goal active; no backend/deployment changes.

## Measurement → object quantity → review evidence

- Added explicit saved-measurement import inside the selected object's quantity editor. Only matching original hash/page/drawing revision records are offered. Import fills a six-decimal rounded raw quantity and matching length/area unit, resets correction/rate/catalog references, and requires a separate save with rate/reason. Changing raw quantity or unit manually detaches measurement evidence; correction remains separate.
- Quantity validation retains a complete immutable measurement copy, requires matching unit and computed raw value, and rejects missing/mismatched stored records, page/source/revision differences. A new drawing revision marks prior measured quantity evidence stale. Existing object-geometry basis checks remain. Shared measurement schema now validates both document records and nested quantity evidence, including snapshots/backup.
- Quantity list, review snapshot and delivery quantity report show the original measurement ID/page/revision, reference length, normalized reference points, aspect and hash. These remain user-selected measurements, not automatic object recognition or engineering certification. Existing review snapshot cloning preserves the measurement copy alongside raw/correction/rate.
- Tests first failed on missing evidence and then missing stale-revision handling; browser test first exposed absent import control. Real PDF journey passes record restore → object import 15m → +1m correction → rate100 → quantity review/approval with the saved measurement in the approved snapshot. Expanded the request evidence disclosure before visual assertions; inspected `/tmp/1hk-measured-quantity-review.png`. Existing quantity delivery/recipient browser regression passes; 92 unit/render tests pass.
- Remaining: direct review-to-measurement-location navigation, detailed target-coordinate display and measured-evidence delivery browser fixture, plus original field/material/local-project integration and navigation matrix. Goal active; no production services or deployment changed.

## Review evidence → frozen measurement location

- Added an inline readonly PDF location viewer to the shared measurement evidence disclosure used by quantity editor/list/review/delivery. It opens only on demand, uses the evidence's original fingerprint and fixed page, renders reference A/B and numbered target points/path/area, and never substitutes current object geometry. Target normalized coordinates are also listed as text.
- Reused the existing PDF renderer with an optional fixed-page mode; normal workspace pagination remains unchanged. Closing the location viewer unmounts PDF resources and returns keyboard focus to its trigger without leaving the review route; closing the outer evidence disclosure also releases the viewer. This follows the React conditional-loading/accessibility review, not a new rendering engine.
- Browser test failed first on the absent location action. The extended real-PDF measurement→quantity→approval journey now passes wrong-original rejection, correct-original recovery, fixed-page overlay, zoom, complete saved-session equality and focus return. Mobile screenshot `/tmp/1hk-measurement-review-location.png` inspected. Fresh 92 tests, typecheck and existing full PDF browser regression pass.
- This covers direct inline review-location confirmation and target-coordinate visibility. The same component is wired into delivery, but a measured-evidence independent-recipient browser fixture remains unverified. Full original frontend scope, especially local field/material/project integration, remains active; no backend/deployment changes.

## Measured evidence delivered to independent recipient

- Extended the real-PDF measurement journey through drawing approval, matching quantity selection in delivery, independent recipient entry/reload, readonly location reconnect and receipt feedback. The recipient retains 15m raw +1m correction at rate100 =1,600, measurement record #1 and its 10m reference.
- Initial test extension reloaded before the recipient URL committed and continued on the sender report. Added an explicit recipientDocument URL assertion before reload; the final run passed on the actual independent recipient route. Failure diagnostics now capture body state and action waits are bounded to seven seconds. This was a test synchronization issue, not an application permission failure.
- Verified saved-session equality during readonly PDF reconnection, mobile width, and inspected `/tmp/1hk-measured-delivery.png`. This closes measured-recipient browser coverage, not real distribution/authentication. Current field/material components still consume sample Workflow objects, so actual selected-document field integration is next. Full goal active; no backend/deployment changes.

## Local-document field observations

- Field now supports explicit local/sample scope. Local field selects an actual stored document and object, accepts a location label, title, observation status and note, and appends a source/hash/page/revision/object/position-bound record. No sample object or project is substituted for an unknown explicit document ID. Missing source/objects and the 100-record cap are explicit. Author/reviewer role simulations may record observations; Viewer cannot.
- Records survive the existing session/backup schema and retain original context when objects later move or disappear. Matching records open the exact object/page in Viewer mode and offer a dedicated return preserving field document selection. Different source/revision/page/position or deleted objects disable direct location opening with a recheck warning, rather than treating current geometry as historical evidence.
- Model test first failed on the absent local field module and passes context binding, moved/deleted guards, invalid input and Viewer rejection. Browser test first exposed the old sample field rendering, then passes selected second-document save/reload, first-document isolation, Viewer gate, exact-object roundtrip, moved-object protection and missing-document recovery. Synchronized document selection before typing to avoid test route-transition races. `/tmp/1hk-local-field.png` inspected; 93 tests, typecheck and existing sample field/material browser regression pass.
- Remaining local field scope: photo evidence, structured building/civil location hierarchy, assignment/general issue creation and review-draft handoff. Material records are still sample-only. These are observations, not actual inspection approvals, GPS data or notifications. Overall frontend goal remains active; no backend/deployment changes.
# 2026-09-11: field inspection → correction → reinspection

- Existing local observation cards now expose a collapsible `점검·시정 관리` panel, without adding a duplicate navigation page.
- Three explicitly illustrative checks, inspector/corrector/viewer simulation, failed check → correction, action submission → reinspection, repeated failure cycles and passed reinspection → readonly closure.
- Processing appends history without changing observation records or drawing/quantity approval. Source/revision/object-location mismatch blocks processing and retains drafts/history.
- Drafts, selected processing role and expanded panel survive reload and exact-object Viewer roundtrip through the existing session draft map. New `inspections` metadata is validated by the existing session codec.
- Evidence: new model/browser test,67 selected model tests,typecheck,existing local field browser and architecture/IFC/civil scenario browsers pass. `/tmp/1hk-inspections.png` inspected at390px.
- Remaining: organization-defined checklist standards, named responsible people, due dates and consolidated inspection inbox; daily reporting/payment/as-built chain not yet complete. Actual safety/inspection authority and server operations are out of scope.
# 2026-09-11: daily reports with frozen field evidence

- Added `daily` entry in the existing Field context navigation, not a new top-level menu. Local empty states never substitute sample evidence.
- Date/weather/worker count/work/progress/next work are submitted with a copy of the field record and then-current inspection events. Reports do not rewrite earlier evidence when inspection progresses.
- Reviewer may request correction or confirm the frozen report. Correction creates a linked new report; previous content and decision remain. This is not drawing/quantity approval, legally authoritative inspection or payment certification.
- Drafts persist through reload and exact-object Viewer return. Date filtering and role selection use the existing pending-query pattern after a browser regression reproduced lost filter clearing during rapid role change.
-67 selected model tests,typecheck,new report browser,inspection browser and architecture/IFC/civil regression journeys pass. Populated390px screenshot `/tmp/1hk-daily-reports.png` inspected. Inventory extended with the new view; report its results only after terminal evidence.
- Remaining: named people, multiple locations per daily report, report-to-payment and as-built handover. The full frontend objective is not complete.
# 2026-09-11: contract and payment-request review frontend

- Added `payments` (계약·기성 검토) under existing quantity/cost navigation. Per-document versioned contract terms, manually entered request amount, prior confirmed amount and contract remainder are distinct from real contracting/certification/payment.
- Requests snapshot an approved quantity round and accepted daily report with closed inspection, matched by source hash/revision/object/page. Report progress is explicitly not converted into money. The illustrative cap is min(contract amount, selected approved total) less earlier confirmed requests.
- Request → correction → linked resubmission → reviewer confirmation retains all previous records. One pending request at a time; contract changes block confirming an old pending request. Reduced contract limits cannot fall below earlier confirmations.
- Existing session codec stores validated terms/claims; drafts survive reload and direct quantity/daily-report return. Mobile history inspected at `/tmp/1hk-payments.png`.
- New model/browser tests and68 selected state tests/typecheck pass. Separate existing daily/budget/scenario browser regressions running at time of entry; record terminal results before claiming them.
- Remaining frontend: stronger same-date report focus and deeper return chains, per-line partial quantities/retentions/multiple contracts, and as-built asset handover. No actual claim, invoice or payment was performed. Full objective remains active.
# 2026-09-11: as-built asset handover frontend

- Added `handover` in existing Delivery context navigation. Asset code/name/location/manufacturer/model/reference-document label are tied to drawing object IDs. Code duplicates are rejected; edits retain earlier package snapshots.
- Readiness checks all registered assets against an explicitly selected approved drawing and matching closed inspection. Only registered assets are included; reference-document text does not imply a file attachment or transmission.
- Prepare → recipient correction → linked replacement → recipient acknowledgement uses frozen asset/field/inspection copies. Author/recipient/viewer are explicitly simulated. No actual handover proof or asset-system registration occurs.
- Browser: new asset/draft/reload/package history test passed, including opening collapsed evidence then visiting the exact approved object and returning with feedback intact. Existing transmittal browser passes; original journey regression awaited separately.67 selected tests and typecheck pass. `/tmp/1hk-handover.png` visually inspected at390px.
- Remaining: attachment UI, warranty/maintenance info, selective package membership/removal and export integration. Full frontend objective remains active.
# 2026-09-11: carbon evidence and comparison frontend

- Added `carbon` under the existing Field/material context. Select an approved quantity round and A1-A3/A4/A5 label, then enter each factor, denominator unit, source and version. No default real-world emission factor or certification is claimed.
- Missing factors and unit mismatches remain incomplete; only valid rows contribute to an explicitly partial subtotal. Save requires every scoped approved item to have complete factors plus a review note. Unregistered drawing objects stay explicitly outside this scope.
- Assessments freeze quantity/factor/source/version/stage. Comparisons only subtract totals for matching stage and object/unit scope, and explain combined quantity/factor effects rather than implying verified reductions.
- Browser covers completeness, wrong unit,24→36(+12) factor-version change, reload, exact quantity roundtrip, stage draft isolation, Viewer controls and mobile.66 selected tests,typecheck,budget/payment and three-scenario browser regressions pass. `/tmp/1hk-carbon.png` inspected.
- Remaining: verified factor-library import, explicit unit conversions and export linkage. Full frontend goal remains active; expanded27-view inventory running separately.
