# 1HK Drawing Workspace P0–P7 implementation and release ledger

Date: 2026-08-28

Authority: current source implementation and the final local audit are bound to `8155fa3db98d1fd1ef3a02ed11a4088fdfbfd087`. The source-bound 10k capture identifies this authority-source commit independently from later evidence-only commits.

Overall release status: **NOT_MET**. The fail-closed ledger has **35 PASS, 1 NOT_MET, and 11 UNEXECUTED** requirements. Local implementation is not promoted to production authority.

## P0–P7 scope

| Phase | Implemented current-state authority | Current release evidence |
| --- | --- | --- |
| P0 | React Router full-screen workspace, blank/PDF document creation, canonical world coordinates, Konva viewport/selection, minimal object/layer/operation schema, autosave/reopen/recovery | Complete Drawing Workspace Node suite and mounted preview gate PASS |
| P1 | line/polyline/rectangle/circle/text/dimension, select/multi-select/move/copy/delete, undo/redo, shortcuts/commands, property inspector | Command, geometry, canvas, shell and mounted preview tests PASS |
| P2 | pages/canvases/layers, styles, blocks/instances, templates, tables/schedules, custom properties, PDF/PNG/SVG export | P2 database/runtime/export/template tests in complete suite PASS |
| P3 | Yjs, y-indexeddb, Hocuspocus, Presence/awareness, soft locks, comments/mentions, history/checkpoint restore, offline outbox | Local collaboration protocol/service/Yjs gates PASS; hosted service and production zero-loss authority UNEXECUTED |
| P4 | wall/opening/space/area/grid/arc, deterministic measurement and schedules, semantic selection and reference evidence | P4 semantic/measurement/database/browser regressions PASS |
| P5 | PDF/IFC 2D/3D/split, cross-selection/focus, revision overlay, exact relink/anchor authority, immutable source storage | Local PDF/IFC lifecycle and signed-source contracts PASS; production before/after byte proof UNEXECUTED |
| P6 | drawing object to quantity, BOQ, price, material/order/receipt/carbon lineage; deterministic approval/export | BOQ/material/lineage/golden-byte gates PASS |
| P7 | current canvas-first shell, organization libraries, tablet mode, 10k projection, retention/restore authority, organization administration/entitlements, fail-closed release audit | Local gates PASS except cold startup; real PostgreSQL, hosted runtime, managed restore and production users UNEXECUTED |

## First vertical slice — original ten conditions

| # | Condition | Status | Direct evidence |
| --- | --- | --- | --- |
| 1 | Open a blank drawing or PDF background from a project | PASS (local) | `drawing-workspace-route`, `drawing-workspace-server`, mounted preview |
| 2 | Pan/zoom and author line, polyline, rectangle, circle, text and dimension | PASS (local) | command/canvas/tool Node regressions |
| 3 | Select, move, copy, delete, undo and redo | PASS (local) | command/outbox/runtime regressions |
| 4 | Create at least two layers and toggle visibility/lock | PASS (local) | structure/database/runtime and shell gates |
| 5 | Edit name, layer, color, width, fill and text in inspector | PASS (local) | inspector/style/command gates |
| 6 | Restore the same state after refresh/re-login | PASS (local) | document store, snapshots, IndexedDB/Yjs and browser recovery gates |
| 7 | Attach a comment or existing issue to an object | PASS (local) | issue-link/comment/social database and route gates |
| 8 | Two browsers observe cursors and object create/move | PASS (local) | local two-browser/Awareness contracts; hosted counterpart remains UNEXECUTED |
| 9 | PDF/IFC original SHA-256 remains unchanged | PASS (local), UNEXECUTED (production) | source lifecycle/hash tests; production three-user runner requires Storage bytes before/after |
| 10 | Viewer cannot edit and Editor can | PASS (local), UNEXECUTED (real PG) | capability/route/PGlite tests; real role/JWT RLS authority is absent |

## Original quality and launch gates

| Gate | Status | Evidence or missing authority |
| --- | --- | --- |
| 10,000 objects, desktop 60fps / warm p95 <=16.7ms | PASS | zoom 0.2ms, pan 0.3ms, selection 9.0ms p95 |
| First usable <=2.5s | PASS for warm reopen; **NOT_MET for cold/cache miss** | warm 2290.4ms; cold 2713.4ms |
| Collaboration p95 <=500ms | UNEXECUTED production | signed provider telemetry endpoint/token and hosted sessions absent |
| Disconnect/reconnect loss 0 | PASS local; UNEXECUTED production | outbox/Yjs crash-recovery regressions pass; real hosted three-user flow absent |
| Cross-organization RLS counterexamples | PASS PGlite; UNEXECUTED real PostgreSQL | `DRAWING_P7_REAL_DATABASE_URL` and `P7_REAL_POSTGRES_DATABASE_URL` absent |
| Approved revision direct update/delete denied | PASS PGlite; UNEXECUTED real PostgreSQL | trigger/RPC tests pass; real role/JWT session authority absent |
| Three users perform open -> author -> comment -> revise -> review -> approve -> export | UNEXECUTED | actual hosted identities and mounted production fixture IDs absent; fixture/example users are rejected |
| Existing IFC/PDF, collaboration, quantity, approval, Revit and material flows regress cleanly | PASS local | complete Drawing Workspace 831 total, 825 pass, 0 fail, 6 authority skips |

## P7 invariant audit

| # | Invariant | Status |
| --- | --- | --- |
| 1 | Immutable PDF/IFC/RVT/QTO/BOQ/receipt/invoice/EPD/manifest SHA | PASS local; production UNEXECUTED |
| 2 | Approved evidence survives ordinary project deletion | PASS local retention/PGlite; real PG UNEXECUTED |
| 3 | Published organization library versions immutable and copied with provenance | PASS |
| 4 | Library/retention/admin/entitlement enforced by route and RLS/RPC | PASS local/PGlite; real PG UNEXECUTED |
| 5 | Existing canonical drawing schema remains the payload | PASS |
| 6 | Tablet keeps canvas mounted, focus and >=44px targets | PASS at 768x1024 and 1024x768 |
| 7 | Empty panels collapse and default preview is current | PASS at 1280x720 and tablet gates |
| 8 | 10k fixture uses production adapters and runner capture | PASS; standalone timing JSON rejected |
| 9 | First usable and warm budgets, no silent object loss | warm PASS, cold NOT_MET, production loss proof UNEXECUTED |
| 10 | Retention/hold/export/restore/admin changes append-only audited | PASS local/PGlite |
| 11 | Managed isolated backup restore compares DB/Storage/Yjs/approval/lineage | UNEXECUTED |
| 12 | Entitlements implemented without billing/payment | PASS |
| 13 | No second state manager/CRDT/server/microfrontend/Redis/queue/AI dependency | PASS |
| 14 | No wholesale Penpot/Excalidraw/tldraw/Rayon transplant; narrow OSS only | PASS; license closure 7/7 |
| 15 | Three mounted real production users complete the complete workflow | UNEXECUTED |

## Exact unresolved production inputs

Hosted application and users require `P7_E2E_BASE_URL`, managed Supabase URL/anon/service keys, real PostgreSQL URL, hosted collaboration WSS URL, provider telemetry URL/token, exact deployed commit/deployment/region/run identity, exact project/document/revision/file/layer UUIDs, and three distinct real author/commenter/approver UUID/email pairs. The authority rejects localhost, `.test`, example, fixture, local, dummy and test identities.

Managed restore additionally requires `P7_RESTORE_MANAGEMENT_ACCESS_TOKEN`, distinct source/target project refs, organization and request UUIDs, source commit, provider backup ID, source/target Supabase URLs and service keys, and source/target hosted PostgreSQL URLs.

No missing production input is represented as PASS. Payment/checkout and AI recognition remain explicitly outside P7.

## Authoritative artifacts

- `.superpowers/sdd/2026-08-28-drawing-workspace-p7/task-7-release-evidence.json`
- `.superpowers/sdd/2026-08-28-drawing-workspace-p7/task-4-performance-evidence.json`
- `.superpowers/sdd/2026-08-28-drawing-workspace-p7/task-5-restore-evidence.json`
- `.superpowers/sdd/2026-08-28-drawing-workspace-p7/task-7-gates/`
- desktop and tablet screenshots named `task-7-desktop-1280x720.png`, `task-7-tablet-portrait-768x1024.png`, and `task-7-tablet-landscape-1024x768.png`

The Task 7 validator exits nonzero until every required production receipt passes and the cold startup threshold is met.
