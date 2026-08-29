# 1HK Drawing Workspace P0–P7 current implementation matrix

Document set: `dd46e79e-060c-4747-96bf-e3dd0c5d069c:bc218e693dd9f400d2f57caf4ba16761e1c92e6d:c2d41aeb5010b71c15276a847bc2607f48d10171955fe8076c905e3eced64936`
Source commit: `bc218e693dd9f400d2f57caf4ba16761e1c92e6d`
Source tree SHA-256: `c2d41aeb5010b71c15276a847bc2607f48d10171955fe8076c905e3eced64936`
Overall: **UNEXECUTED**
Requirements: **35 PASS / 0 NOT_MET / 13 UNEXECUTED**

## Current source-bound performance

- warm reopen: 1719.9ms (MET)
- cold/cache-miss: 2168.9ms (MET)
- warm p95: zoom 0.2ms, pan 0.2ms, selection 8.6ms (MET)

## Exact requirement ledger

| Requirement | Scope | Status | Authority |
| --- | --- | --- | --- |
| `p0.editor_core` | local | **PASS** | node.p0_p7 |
| `p0.world_coordinates` | local | **PASS** | node.p0_p7 |
| `p0.autosave_restore` | local | **PASS** | node.p0_p7 |
| `p1.six_tools` | local | **PASS** | node.p0_p7 |
| `p1.select_move_copy_delete` | local | **PASS** | node.p0_p7 |
| `p1.undo_redo_inspector` | local | **PASS** | node.p0_p7 |
| `vertical.blank_or_pdf_open` | local | **PASS** | node.p0_p7 |
| `vertical.layers_visibility_lock` | local | **PASS** | node.p0_p7 |
| `vertical.issue_object_link` | local | **PASS** | node.p0_p7 |
| `vertical.two_browser_realtime` | local | **PASS** | browser.p3_multiplayer |
| `vertical.viewer_editor_roles` | local | **PASS** | node.p0_p7 |
| `source.pdf_ifc_sha_immutable` | production | **UNEXECUTED** | production authority not supplied |
| `p2.pages_canvas_styles_blocks` | local | **PASS** | node.p0_p7 |
| `p2.tables_properties_templates_export` | local | **PASS** | node.p0_p7 |
| `p3.yjs_indexeddb_hocuspocus` | local | **PASS** | collaboration.service |
| `p3.awareness_locks_mentions_history` | local | **PASS** | collaboration.service |
| `p3.offline_zero_loss` | production | **UNEXECUTED** | production authority not supplied |
| `p4.semantic_objects_measurement` | local | **PASS** | node.p0_p7 |
| `p4.deterministic_schedules` | local | **PASS** | node.p0_p7 |
| `p5.pdf_ifc_split_cross_select` | local | **PASS** | source.pdf_ifc |
| `p5.revision_diff_anchor_relink` | local | **PASS** | source.pdf_ifc |
| `p6.object_quantity_boq_material_lineage` | local | **PASS** | lineage.boq_material |
| `p6.approved_exports` | local | **PASS** | lineage.boq_material |
| `p7.current_default_workspace` | local | **PASS** | browser.desktop_tablet |
| `p7.desktop_1280x720` | local | **PASS** | browser.desktop_tablet |
| `p7.tablet_portrait_landscape` | local | **PASS** | browser.desktop_tablet |
| `p7.touch_focus_accessibility` | local | **PASS** | browser.desktop_tablet |
| `p7.organization_library_provenance` | local | **PASS** | organization.rls_entitlements |
| `p7.retention_archive_legal_hold` | local | **PASS** | retention.restore |
| `p7.organization_admin_entitlements` | local | **PASS** | organization.rls_entitlements |
| `security.real_postgres_rls` | production | **UNEXECUTED** | production authority not supplied |
| `security.approved_revision_immutable` | production | **UNEXECUTED** | production authority not supplied |
| `security.reviewer_approver_separation` | production | **UNEXECUTED** | production authority not supplied |
| `collaboration.hosted_service` | production | **UNEXECUTED** | production authority not supplied |
| `performance.10k_deterministic` | local | **PASS** | performance.source_bound |
| `performance.warm_interaction` | local | **PASS** | performance.source_bound |
| `performance.warm_reopen` | local | **PASS** | performance.source_bound |
| `performance.cold_startup` | production | **PASS** | source-bound P7 production-build Chromium cold cache-miss |
| `performance.hosted_runtime` | production | **UNEXECUTED** | hosted runtime performance receipt |
| `retention.managed_backup_restore` | production | **UNEXECUTED** | managed Supabase backup isolated restore comparison |
| `retention.rpo_rto` | production | **UNEXECUTED** | managed Supabase backup isolated restore comparison |
| `production.three_real_users` | production | **UNEXECUTED** | production authority not supplied |
| `production.mounted_route_actions` | production | **UNEXECUTED** | production authority not supplied |
| `production.export_audit` | production | **UNEXECUTED** | production authority not supplied |
| `release.regression_p0_p7` | local | **UNEXECUTED** | browser.p0_p2 + browser.p3_multiplayer + browser.p4_functional + browser.p5_release + browser.p6_release |
| `release.typecheck_build_collaboration` | local | **PASS** | application.typecheck_build + application.build + collaboration.typecheck_build + collaboration.build |
| `release.license_lock_notices` | local | **PASS** | license.permissive_policy |
| `release.no_rayon_assets_or_copy` | local | **PASS** | license.closure |

The program is not complete. Every NOT_MET and UNEXECUTED requirement must remain fail-closed.
