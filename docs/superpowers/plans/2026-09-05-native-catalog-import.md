# Native catalog → saved drawing implementation plan

> Execute continuously with using-superpowers, ponytail, TDD, and subagent-driven-development. This implements the user's already-approved persistent goal; no repeated design approval is needed.

**Unit status:** Tasks1–4 locally verified after the seventh disposable M1 run (23/23 browser stories). Final evidence is in `docs/superpowers/evidence/2026-09-05-native-catalog-import.md`. This completes this plan only; the full Universal Workspace/DWG goal remains active.

**Spec:** `docs/superpowers/specs/2026-09-05-simple-workspace-dwg-oss-design.md` and `2026-09-05-1hk-business-model-design.md`.
**Outcome:** four native example drawings can be previewed, cloned and reopened in the canonical editor; 24 original native symbols can be found and copied into a draft's block library. A3/1:50 output survives persistence and creates correctly sized exports.

## Global constraints

- Existing linked worktree only; preserve all pre-existing dirty edits. No commits, staging, reset, push, operating deployment, dependency install, paid agreement, or source/license claims.
- Existing four `platform_starter` scaffolds, version-1 definitions, hashes, rows and RPC contracts stay unchanged. New native assets have distinct `platform_native` ancestry, never fabricated project approvals.
- Native definitions in `drawing-native-symbols.ts` / `drawing-native-templates.ts` remain version 1, byte-identical. Their provenance remains `NOASSERTION`, first-party-generated, and example/assumption notices remain visible.
- Browser POST selects kind/key/version/request ID only; browser-supplied payload/hash/provenance never establishes catalog authority. Authenticated SQL validates membership, project capability and editable revision. Viewer, anonymous, other-organization, and approved revision writes are denied.
- Templates clone the whole graph with fresh IDs and lineage, opening hosts, styles, block references, property/table references. No original files, approvals or quantity evidence are invented. Atomic receipt plus graph creation; exact retries return the same target and changed retries fail.
- Built-in templates/symbols are the basic-start catalog, not the paid company-library feature. Preserve all existing organization-library entitlement gates. Native entry points require existing drawing-workspace entitlement and editor capability.
- Reuse current editor, structure operations, import receipt pattern, preview/export renderers, local outbox and collaboration. No alternate editor, new state manager or new collaboration service.
- Native geometry stays in mm. Optional canonical canvas `outputProfile` is the existing native envelope shape: `{paper:"A3",orientation:"landscape",widthMillimeters:420,heightMillimeters:297,scaleDenominator:50}`. Canonical TS and SQL validation share the same named-paper, finite-positive dimensions/scale, orientation and ratio domain, including ordinary fractional-scale floating-point tolerance. Do not restrict SQL to A3 while accepting A4 in the outbox. Reject mismatched paper/geometry ratios, unknown keys, non-finite/zero values. Absent profile is omitted, never injected into old snapshots/hashes. Existing canvases without a profile retain previous behavior. Editable output settings remain a subsequent unit, not part of this validation parity fix.
- New native integration binds the unchanged template envelope's outputProfile to its cloned canvas, not the source definition. PDF is 420×297 mm; SVG physical dimensions match, viewBox/world coordinates stay 21000×14850. Profiled PNG uses paper mm × 96/25.4 × selected 1x/2x/4x scale (96/192/384dpi) to preserve readable text without allocating model-sized buffers. No rescaling the actual model to fake print scale; legacy unprofiled pixel behavior remains unchanged.
- Root alone runs full build and disposable M1 browser/database suite; focused Node/isolated SQL tests are allowed for implementers with unique owned local resources. No operating Supabase access.

## Interfaces and ownership

1. SQL RPC `lukas_drawing_list_native_assets(p_project_id uuid, p_kind text)` is read-only and returns entries `{kind,key,version,name,description,definition,contentSha256,artifactSha256}`. Kinds are `workspace_template` and `block`. `contentSha256` is PostgreSQL jsonb-text digest; `artifactSha256` is sorted compact JSON digest. They are explicitly different hash domains.
2. SQL RPC `lukas_drawing_import_native_asset(p_project_id uuid,p_revision_id uuid,p_kind text,p_asset_key text,p_asset_version integer,p_client_request_id uuid)` derives organization itself, validates authority, and ensures immutable organization-local catalog ancestry inside the same transaction. Template requires null revision, creates a draft and returns `{importId,documentId,revisionId,contentSha256}`. Symbol requires editable draft, copies a block and returns `{importId,targetEntityId,revisionId,contentSha256}`. Reuse existing import ledger and mapping logic via narrowly scoped helpers; don't duplicate the entire old importer or forge approved revisions.
3. Library source union adds `platform_native` with `native_asset_key`/`native_asset_version`, no source project/revision/entity IDs. New columns are null for existing rows. Source versions are immutable, including published lifecycle. Generic native import may route to the dedicated authority helper; company-source behavior remains unchanged.
4. App helper `drawing-native-catalog.server.ts`: `loadNativeDrawingCatalog(client,projectId,kind)` and `importNativeDrawingAsset(client,{projectId,revisionId,kind,key,version,clientRequestId})`. Validate strict RPC results and static authored identity; forms reject duplicate/unknown fields. No privileged client needed.
5. Task 1 owns SQL/migrations and real DB tests. Task 2 owns canvas schema, canonical server serialization, export implementation/tests. Task 3 owns native server helper, library source parser, start/library/block UI and related route tests. Shared interfaces are above; coordinate file changes before overlapping.

### Task 1: Native catalog authority, atomic clone and profile persistence

**Files:** new Supabase CLI-generated migration(s); `tests/drawing-workspace-m1-real-database.test.mjs` or focused new native DB test integrated with its real harness; minimal reusable test utilities if needed. SQL only for canvas persistence; do not edit Task 2 TS or Task 3 UI.

1. Write failing real PostgreSQL checks first using the existing disposable harness: catalog read-only access, immutable exact 4+24 authored payloads, unauthorized/cross-org/Viewer denial, exact/concurrent retry and mismatched retry, fullgraph remapping, rollback, approved-target symbol denial and persisted outputProfile.
2. Seed a private immutable catalog using full authored definitions and separate explicitly named digests. Migration seed data is generated from unchanged definitions, with a reproducible behavioral comparison to local definitions. No role can supply canonical bytes through a public API. Revoke PUBLIC/anon and unnecessary service-role/helper privileges; locked search_path, explicit auth checks and RLS on public receipts/version tables.
3. Add distinct platform_native library ancestry and source immutability without changing old starter identity checks. Implement the exact list/import RPCs above. Basic native imports do not require company-library paid entitlement; maintain base drawing feature authorization/quota safeguards from current start flow.
4. Materialize native full graphs transactionally with preallocated IDs, complete remapping (pages/canvases/layers/styles/blocks/objects/instances/schemas/values/tables/columns/rows/cells), fresh lineage, semantic graph assertion and restored layer locks. Bind authoritative template outputProfile to canvas. Symbols become normal editable blocks after import with immutable receipt provenance.
5. Persist optional `output_profile` JSON on canvases. Validate strict profile, include it in put_canvas operation and snapshot/restore/clone paths; omit when absent. Approved revisions cannot update/delete. Existing legacy hash bytes unchanged when absent.
6. Run focused tests, self-review scoped diff, write report with RED/GREEN evidence and exact files. Do not run full M1 or operating DB. Tell root any harness wiring needed.

### Task 2: Canonical output profile and physically correct exports

**Files:** `drawing-workspace.types.ts`, `drawing-workspace.server.ts`, `drawing-structure.ts` only if needed; `drawing-export.ts`; `drawing-export-dialog.tsx` only presentation of current dimensions; focused new `tests/drawing-output-profile.test.mjs` plus existing export tests. Do not edit SQL or Task 3 UI.

1. Add failing behavioral tests for optional strict profile validation, absent-profile snapshot compatibility, canonical loader roundtrip, SVG physical A3 with unchanged viewBox, actual pdf-lib PDF dimensions, and bounded PNG buffer. Assert mm geometry/dimension values are unchanged. Use literal expected 420×297, 21000×14850 and 1:50.
2. Add optional outputProfile to canonical canvas. Carry database `output_profile` through all live/replay/server/checkpoint conversions and serialization without adding undefined/null fields to old snapshot objects. Task 1 supplies SQL column/paths.
3. Reuse a small shared export-size helper if needed for SVG/PNG/PDF. Profiled output uses paper dimensions, not model extent; PNG density is 96dpi × existing scale option based on paper. Preserve legacy export size behavior without profile, abort handling and audited fixed-checkpoint behavior. Validate aspect/scale consistency rather than silently distort.
4. Export dialog describes effective paper/scale honestly. No speculative page-layout editor in this unit; full goal retains editable output/display-unit controls as follow-up.
5. Run focused tests and self-review. Write report and scoped file list. No full build/suite/server.

### Task 3: Real template start and searchable native symbols

**Files:** new `drawing-native-catalog.server.ts`; `organization-drawing-library.server.ts`; `drawing-workspace-new.tsx`; existing start panel/library panel/workspace action files identified by read-only audit; focused route/UI tests. No SQL, schema or export implementation edits.

1. Write failing route/parser/UI behavior checks: only server-known native identity is selectable, duplicate fields rejected; catalog failure does not crash dashboard; template preview/clone uses same saved editor; native symbols searchable and import into current editable draft; Viewer UI/action denial.
2. Implement strict helper contracts above. Verify returned canonical definition matches authored local version identity (explicit hash domains); wrong/missing catalog versions fail closed with local error notice. Extend distinct native source parser without loosening old starter/project validation.
3. Add the four practical templates to existing template start UI with generated canonical SVG previews via existing renderer. Clearly distinguish example data from measured evidence. Clicking clone submits one stable request ID for retries then routes to canonical editor. Existing quick-template start creates/selects internal default project, without requiring user to fill project/upload forms.
4. Add native symbol search/category selection inside existing block/library UI, not another primary sidebar. Dedicated import action calls SQL and reloads authoritative blocks, then uses existing insert-block operation for placement. Current edit lock/outbox guards and server capability checks apply; do not overwrite pending edits on revalidation. Use existing offline notice for imports requiring connection.
5. Native provenance details say builtin/example and version, not approved/verified license. Generic publish/deprecate unavailable. Existing company library and starter paths remain usable.
6. Run focused tests, self-review, report RED/GREEN and files. Do not run full build/M1 or start servers. Coordinate canonical snapshot-related touchpoints with Task 2 first.

### Task 4: Integration, browser evidence and review

**Files:** M1 E2E test and runner only if new test wiring is needed; shared `docs/superpowers/evidence/2026-09-05-native-catalog-import.md` and machine evidence. Root owns integration.

1. Review each task against scoped pre-edit snapshot diff, then resolve cross-task authority/profile contracts. No giant unrelated dirty-tree review.
2. Add/run real authenticated browser workflow: quick template → four previews → clone → editor, imported dimensions/styles/hosted doors/schedules, symbol search+insert, reload/persistence, request replay, Viewer denial; verify real exported PDF page dimensions and template geometry. Use existing disposable loopback-only Supabase runner and actual roles.
3. Run focused combined regression and `npm run test:e2e:drawing-workspace-m1:local` after code freeze; record counts, raw failures/fixes, cleanup and no source mutation. Restart only root-owned local preview after build and inspect actual UI/errors.
4. Most-capable final scoped review, one fix wave/re-review, truthful shared evidence. No DWG-production qualification or full goal-complete claim. Remaining external/customer DWG corpus and recipient acceptance gates stay explicit.
