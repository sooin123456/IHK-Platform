# Next R5 seam map — read-only, no implementation dispatched

Map by /root/resave_product_wiring after its Task4 implementation was independently accepted. Scoped public source inspection only; no changed files/tests or new product decision. Task5 actual imported-resave acceptance still runs first. Preserve this map across compaction; do not redispatch it.

## Existing outputs and the missing join

- `platform/app/lukas/screens/drawing-workspace-export.server.ts`: `handleDrawingExportRequest({client,headers,projectId,request,workspaceId})` accepts browser-rendered PDF/PNG/SVG plus revision/version/checkpoint/SHA and calls `recordProjectExport`. `platform/app/lukas/lib/project-export-audit.server.ts` hashes bytes and calls `lukas_qto_record_drawing_export`; PGRST202 falls back to legacy project-only audit. It records submitted bytes rather than independently proving PDF rendered contents match frozen snapshot. Existing tests: drawing-workspace-export, drawing-workspace-p7-export-audit, drawing-export-approval-ui. A strict delivery package cannot treat that fallback or arbitrary uploaded PDF bytes as exact approved PDF authority.
- `verified-boq-approved-export.server.ts`: `loadApprovedVerifiedBoqExport(userClient,actorId,versionId,authority?)`, `buildApprovedVerifiedBoqExport(input)` provide CSV/XLSX/manifest plus result/manifest/handoff hashes. Approved/superseded status, independent BOQ approval, recalculated frozen inputs and immutable evidence checked.
- `verified-boq-manifest.server.ts`: `buildVerifiedBoqHandoffManifest(calculation,approvalEnvelope)` includes drawing-source revision/version/snapshotSHA. BOQ approval belongs to BOQversion, not drawing approval; multiple drawings/legacy sources may coexist. Matching one selected DWG/PDF revision is not currently enforced. Tests: verified-boq-v1-1 approved-export roundtrip, drawing-quantity-lineage-server.
- Source-free native receipt in drawing-native-dwg-jobs.server.ts uses `source` six-field scope; imported resave receipt uses equivalent `scope`. Both bind four artifact hashes/sizes to job/attempt, not PDF or BOQversion/handoff. Imported kinds are dwg/edit_request/authority/report; source-free substitutes source_manifest for edit_request.

The smallest proposed next seam is a **server-side exact-approved delivery manifest builder/validator**, rejecting mismatched revision/checkpoint/BOQ evidence and missing strict PDF authority before archive assembly. This is a proposal to refine after Task5/final unit review, not a claim that a manifest alone completes packaging or PDF authority. Remaining package pieces: exact cross-output join, artifact manifest, durable publication/download resource, selection/status UI, permitted dependency/compatibility inclusion. Keep private locators/tokens out and experimental qualification intact.

## Templates/symbols already present

- `drawing-native-templates.ts`: `buildNativeDrawingTemplate(key)` implements measured-plan/office-layout/remodel-phases/finishes-takeoff; mm, A3landscape1:50, editable layers/styles/dimensions/blocks/example quantity properties.
- `drawing-native-assets.ts`: `listNativeDrawingSymbols()` validates24door/window/wall/furniture definitions, bounds/insertion points.
- `drawing-native-catalog.server.ts`: `loadNativeDrawingCatalog(...)`, `importNativeDrawingAsset(...)` compare stored definitions to canonical authored bytes and distinguish JSONB contentSHA from artifactSHA. Existing template/symbol/catalog UI/server/real-DB/content-export tests cover them.
- Provenance is first-party1HK/sourcepath/attribution/version1 with license NOASSERTION. This is not an external asset commercial redistribution grant. Do not invent a license or import competing samples to fill a quantity goal.

## Separate release gate

Approved business/UX requirements still require3actualusers author→review→revise→approve→deliver plus recipient acceptance in designatedCAD/version/font/plot/Xref environment. Automated fixtures, same-engine native reopen and valid package manifests do not satisfy human/recipient qualification. No external coordination/paid license/deployment authorized by this map. Templates being present does not make all R5 acceptance complete.
