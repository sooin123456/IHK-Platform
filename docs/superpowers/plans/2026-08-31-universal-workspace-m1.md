# 1HK Universal Workspace M1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the production-shaped M1 estimator vertical slice so an estimator can start without a drawing file, measure and classify objects, connect an immutable company rate book and draft BOQ, inspect evidence-linked quantities and amounts, then preserve the existing review, approval, and export authority.

**Architecture:** Treat `lukas_drawing_documents.id` as the public workspace identity and make the existing Drawing Workspace document-first with an optional primary source. Reuse the current Konva editor, property schemas, operation/outbox/Yjs stack, organization library, price-book parser, VERIFIED-BOQ exact-decimal engine, approval lineage, and exporters; add only idempotent creation metadata, an append-only drawing-revision/BOQ binding, a versioned starter preset adapter, and a derived result rail. Keep draft estimates reproducible but non-authoritative; only the existing approved snapshot → quantity link → BOQ link flow may become confirmed.

**Tech Stack:** React Router 7, React 19, TypeScript, Supabase/Postgres/RLS, Konva/react-konva, PDF.js, Three.js/web-ifc, Yjs/y-indexeddb/Hocuspocus, Zod, Node `crypto`, fflate, Node test runner, Playwright.

**Spec:** `docs/superpowers/specs/2026-08-31-universal-workspace-estimator-vertical-slice-design.md`

## Global Constraints

- M1 adds no runtime dependency and no test framework.
- Do not add a generic `workspaces` table; `workspaceId` is `lukas_drawing_documents.id`.
- Do not add Zustand, another client state manager, another CRDT, another collaboration server, another spreadsheet library, or another decimal engine in M1.
- Preserve the existing revision-scoped external document store, IndexedDB outbox, Yjs document, y-indexeddb persistence, and Hocuspocus room identity.
- PDF, IFC, RVT, and price-book source bytes and SHA-256 values are immutable; no workspace mutation may update them.
- Draft quantity and money are derived server results. Do not persist authoritative money in Yjs, the outbox, drawing operation payloads, or property JSON.
- Do not relax the existing rule that only an approved drawing snapshot can create confirmed `lukas_drawing_quantity_links` and `lukas_drawing_boq_links`.
- Viewer mutation must fail in the UI, React Router action, and database authority. Reviewer and Approver responsibilities remain separate.
- Every new public table must enable RLS before grants, deny `anon`, use explicit grants, use same-project foreign keys, and apply the existing organization entitlement fence.
- Private `SECURITY DEFINER` functions must set `search_path=''`, recheck `auth.uid()` and project capability, revoke `PUBLIC` execute, and expose only a narrow public wrapper when necessary.
- Expected start, import, validation, source-renderer, conflict, and stale-version failures must render bounded Korean UI states instead of the global `Unexpected error` boundary.
- Do not copy Rayon/Figma names, icons, sample data, wording, or proprietary code. Record permissively licensed source code in `THIRD_PARTY_NOTICES.md` only when code is actually incorporated.
- Before the first Supabase implementation step, fetch `https://supabase.com/changelog.md`, inspect relevant current RLS/function documentation, run `npx supabase --version`, and discover migration commands with `npx supabase migration --help`.
- A migration filename must be created by `npx supabase migration new universal_workspace_m1`; the CLI-printed path is canonical and its numeric prefix must not be invented in advance.
- Existing unrelated dirty-worktree changes belong to the user. Stage only the files listed by the current task.
- M2–M5 are separate implementation plans after the M1 release gate; this plan must leave their existing P2–P7 foundations intact.

---

## File Structure

### New files

- `platform/app/lukas/lib/drawing-workspace-paths.ts` — canonical, new-workspace, operation, export, and legacy compatibility paths with UUID validation.
- `platform/app/lukas/lib/drawing-starter-templates.ts` — browser-safe starter payload schemas, labels, and validation; no Node-only import.
- `platform/app/lukas/lib/drawing-starter-templates.server.ts` — organization-library starter seeding/loading and one deterministic operation builder using the existing structure-operation contract.
- `platform/app/lukas/lib/drawing-estimate.ts` — isomorphic classification, unit conversion, evidence-state, and grouping rules; no database or money authority.
- `platform/app/lukas/lib/drawing-estimate.server.ts` — binding queries, draft BOQ input construction, exact-decimal calculation, and bounded summary responses.
- `platform/app/lukas/components/drawing-workspace-start.tsx` — equal-priority blank/template/PDF start cards and field-level action feedback.
- `platform/app/lukas/components/drawing-scale-control.tsx` — PDF two-point calibration and explicit drawing/display-unit status using the existing canvas calibration operation.
- `platform/app/lukas/components/drawing-estimate-result-rail.tsx` — result/object inspector tab content for quantities, rates, amounts, evidence state, and BOQ/export navigation.
- `platform/app/lukas/screens/drawing-workspace-new.tsx` — authenticated source-optional start loader/action.
- `platform/app/lukas/screens/drawing-workspace-legacy.tsx` — old project-latest/file-route resolver and canonical redirect.
- `platform/tests/drawing-workspace-m1-database.test.mjs` — additive migration, RLS, grants, immutability, and idempotency contract tests.
- `platform/tests/drawing-workspace-m1-real-database.test.mjs` — mandatory release-mode PostgreSQL locking, RLS, grant, and append-only counterexamples.
- `platform/tests/drawing-workspace-m1-start.test.mjs` — path, starter catalog, start action, and expected-error contract tests.
- `platform/tests/drawing-workspace-estimate.test.mjs` — pure measurement/classification/draft estimate tests.
- `platform/e2e/drawing-workspace-m1-estimator.spec.ts` — one production-shaped M1 browser journey.
- `platform/e2e/utils/drawing-estimator-fixture.ts` — wraps the existing drawing fixture with an immutable company-rate CSV and a helper that seeds only the BOQ structure not under test.
- `platform/scripts/run-drawing-workspace-m1-e2e.mjs` — provisions and disposes an isolated local Supabase stack before/after the protected approval/import journey.
- `platform/playwright.m1.config.ts` — real-Supabase local app plus the repository's compiled Hocuspocus service for canonical-route M1 E2E; no preview authority.
- `docs/superpowers/evidence/2026-08-31-universal-workspace-m1.md` — exact verification commands, environment, PASS/NOT MET/UNEXECUTED statuses, and artifact hashes.

### Existing files to modify

- `platform/app/routes.ts` — register canonical workspace routes and keep the legacy file entry.
- `platform/app/lukas/lib/drawing-entry.ts` — send PDF uploads to the source-prefilled start route while retaining a legacy helper.
- `platform/app/lukas/lib/drawing-workspace-view.ts` — accept a nullable source descriptor and select the blank surface without dereferencing a missing file.
- `platform/app/lukas/lib/drawing-workspace.server.ts` — idempotent source-optional creation, document-first loading, optional source bundles, canonical navigation, and starter operation application.
- `platform/app/lukas/lib/organization-drawing-library.server.ts` — parse nullable project provenance and the distinct immutable platform-starter payload without weakening company-template validation.
- `platform/app/lukas/lib/drawing-measurements.ts` — line, open/closed polyline, rectangle, and circle deterministic measurements.
- `platform/app/lukas/lib/drawing-commands.ts` — update a canvas calibration through the existing `put_canvas` operation with optimistic base version.
- `platform/app/lukas/lib/drawing-quantity-lineage.server.ts` — accept canonical workspace identity while preserving approved-source checks.
- `platform/app/lukas/components/drawing-workspace.tsx` — optional primary-source rendering, result/object inspector switch, and result rail integration.
- `platform/app/lukas/components/drawing-export-dialog.tsx` — audit exports through the canonical document-scoped route so source-free workspaces can export.
- `platform/app/lukas/components/drawing-canvas.client.tsx` — opt-in two-point PDF calibration capture using the existing world/screen transform without introducing another canvas state model.
- `platform/app/lukas/components/drawing-properties-panel.tsx` — expose all existing semantic object kinds to property schemas.
- `platform/app/lukas/components/workspace-dashboard.tsx` — `새 작업실` becomes the primary empty-state and action.
- `platform/app/lukas/screens/project-drawings.tsx` — list/open drawing documents and retain source-file access.
- `platform/app/lukas/screens/local-drawing-workspace-preview.tsx` — keep the local preview fixture aligned with the `primarySource` document-first contract.
- `platform/app/lukas/screens/organization-drawing-library.tsx` — show seeded platform starters as immutable read-only origins while preserving company-copy workflows.
- `platform/app/lukas/screens/drawing-workspace.tsx` — canonical `workspaceId` loader/action, optional file room, estimate summary, and bounded mutations.
- `platform/app/lukas/screens/drawing-workspace-operation.ts` — continue exporting the canonical workspace action.
- `platform/app/lukas/screens/drawing-workspace-export.ts` — scope drawing exports by document/revision instead of requiring a source file.
- `platform/app/lukas/screens/verified-boq.tsx` — validate a same-project `returnTo`, show a workspace return link, and preserve it through rate-book/version mutations.
- `platform/tests/drawing-workspace-route.test.mjs` — canonical route registration and legacy redirect contracts.
- `platform/tests/drawing-workspace-server.test.mjs` — document-first loader and null-source cases.
- `platform/tests/drawing-workspace-template.test.mjs` — canonical template navigation and starter provenance.
- `platform/tests/drawing-workspace-p7-library-route.test.mjs` — platform starter read-only labeling and unchanged company-library controls.
- `platform/tests/drawing-workspace-p5-server.test.mjs` — keep source-bundle authority tests on the document-first `primarySource` fixture contract.
- `platform/tests/drawing-workspace-entry-flow.test.mjs` — empty-project and PDF-upload destinations.
- `platform/tests/drawing-workspace-measurements.test.mjs` — primitive length/area/count cases.
- `platform/tests/drawing-workspace-shell.test.mjs` — result rail and source-renderer isolation.
- `platform/tests/drawing-quantity-lineage-server.test.mjs` — canonical reverse navigation and approved-only confirmation.
- `platform/tests/verified-boq.test.mjs` — workspace return path and unchanged parser/calculation/export authority.
- `platform/package.json` — add only an M1 Playwright script; do not change dependencies.

### CLI-owned migration file

- Create with `cd platform && npx supabase migration new universal_workspace_m1` and edit the exact `platform/supabase/migrations/*_universal_workspace_m1.sql` path printed by the CLI. This wildcard describes the CLI-owned numeric prefix, not an undecided filename.

---

### Task 1: Add idempotent document creation and the append-only estimate binding

**Files:**
- Create via CLI: `platform/supabase/migrations/*_universal_workspace_m1.sql`
- Create: `platform/tests/drawing-workspace-m1-database.test.mjs`
- Create: `platform/tests/drawing-workspace-m1-real-database.test.mjs`
- Modify: `platform/app/lukas/lib/drawing-workspace.server.ts`
- Test: `platform/tests/drawing-workspace-database.test.mjs`
- Test: `platform/tests/drawing-workspace-fresh-migrations.test.mjs`

**Interfaces:**
- Consumes: current private four-argument `lukas_drawing_create_document(uuid, uuid, text, boolean)` and `lukas_drawing_workspace_capability(project_id)`.
- Preserves: the current four-argument public `lukas_drawing_create_document` RPC and `createDrawingDocument` helper for legacy callers and the existing fixture/test matrix.
- Produces: public invoker RPC `lukas_drawing_create_document_idempotent(p_project_id uuid, p_source_file_id uuid, p_title text, p_blank boolean, p_client_request_id uuid, p_library_version_id uuid default null) -> jsonb`.
- Produces: `createDrawingDocumentIdempotent(client, projectId, input: { title: string; mode: "blank" | "pdf_background"; sourceFile: Pick<DrawingWorkspaceFile, "id" | "kind"> | null; clientRequestId: string; libraryVersionId?: string })`; the optional version participates in retry identity but provenance remains in the existing import ledger.
- Produces: append-only `public.lukas_drawing_estimate_bindings` with unique `drawing_revision_id` and unique `boq_version_id`.
- Produces: four immutable platform starter recipes copied on demand into the existing organization drawing library, plus idempotent `lukas_drawing_record_platform_starter_import` provenance in `lukas_drawing_library_imports`.

- [ ] **Step 1: Read current Supabase authority before changing it**

Run:

```bash
cd /Users/h/Documents/GoAgent/platform
curl -fsSL https://supabase.com/changelog.md | rg -n "breaking-change|RLS|Postgres|function" | head -80
npx supabase --version
npx supabase migration --help
```

Expected: the changelog is readable, the installed CLI version is printed, and `migration new` is listed. Follow any linked breaking change that affects RLS, grants, or Postgres functions before continuing.

- [ ] **Step 2: Write the failing database contract test**

Create `platform/tests/drawing-workspace-m1-database.test.mjs` with the migration lookup owned by the CLI suffix:

```js
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

async function m1Sql() {
  const directory = new URL("../supabase/migrations/", import.meta.url);
  const names = await readdir(directory);
  const matches = names.filter((name) =>
    name.endsWith("_universal_workspace_m1.sql"),
  );
  assert.equal(matches.length, 1);
  return readFile(new URL(matches[0], directory), "utf8");
}

test("M1 creation is retry-safe and estimate bindings are append-only", async () => {
  const sql = await m1Sql();
  assert.match(sql, /add column creation_request_id uuid/i);
  assert.match(sql, /creation_request_sha256 text/i);
  assert.match(sql, /where creation_request_id is not null/i);
  assert.match(sql, /lukas\.drawing_creation_identity/i);
  assert.match(sql, /Drawing document creation identity is immutable/i);
  assert.match(sql, /pg_advisory_xact_lock/i);
  assert.match(sql, /Request ID does not match the stored drawing creation/i);
  assert.match(sql, /function public\.lukas_drawing_create_document_idempotent/i);
  assert.match(sql, /language sql security invoker/i);
  assert.match(sql, /create table private\.lukas_drawing_platform_starters/i);
  assert.match(sql, /source_kind text not null default 'project_revision'/i);
  assert.match(sql, /platform_starter_key text/i);
  assert.match(sql, /lukas_drawing_library_versions_platform_starter_key/i);
  assert.match(sql, /lukas_drawing_list_platform_starters/i);
  assert.match(sql, /lukas_drawing_ensure_platform_starter_version/i);
  assert.match(sql, /lukas_drawing_record_platform_starter_import/i);
  assert.match(sql, /create table public\.lukas_drawing_estimate_bindings/i);
  assert.match(sql, /unique\s*\(drawing_revision_id\)/i);
  assert.match(sql, /unique\s*\(boq_version_id\)/i);
  assert.match(sql, /enable row level security/i);
  assert.match(sql, /revoke all on public\.lukas_drawing_estimate_bindings from public,anon/i);
  assert.match(sql, /grant select,insert on public\.lukas_drawing_estimate_bindings[\s\S]*to authenticated/i);
  assert.match(sql, /grant select on public\.lukas_drawing_estimate_bindings[\s\S]*to service_role/i);
  assert.match(sql, /Drawing estimate bindings are append-only/i);
});
```

Create `drawing-workspace-m1-real-database.test.mjs` with an explicit environment gate because `npm run test:drawing-workspace` includes every `tests/drawing-workspace-*.test.mjs` file. When `M1_REAL_POSTGRES_DATABASE_URL` is absent and `M1_REAL_POSTGRES_REQUIRED !== "1"`, register the real-database suite as skipped with a visible reason. When `M1_REAL_POSTGRES_REQUIRED === "1"` and the URL is absent, fail immediately with `M1_REAL_POSTGRES_DATABASE_URL is required`; never silently skip a release-mode invocation. Parse/connect only after this gate so ordinary unit runs need no database credentials.

- [ ] **Step 3: Run the focused test and confirm the missing migration failure**

Run: `cd /Users/h/Documents/GoAgent/platform && node --test tests/drawing-workspace-m1-database.test.mjs`

Expected: FAIL because no file ends with `_universal_workspace_m1.sql`.

- [ ] **Step 4: Create the migration with the installed CLI**

Run:

```bash
cd /Users/h/Documents/GoAgent/platform
npx supabase migration new universal_workspace_m1
```

Expected: exactly one new path under `supabase/migrations/` ending in `_universal_workspace_m1.sql`. Use that printed path for every migration edit and Git command in this task.

- [ ] **Step 5: Add creation identity and retry logic without replacing the current creation body**

In the CLI-created migration, add nullable creation identity fields, the partial unique index, a private result reader, and an idempotent wrapper around the existing private creator:

```sql
begin;

alter table public.lukas_drawing_documents
  add column creation_request_id uuid,
  add column creation_request_sha256 text
    check (creation_request_sha256 is null or creation_request_sha256~'^[0-9a-f]{64}$'),
  add constraint lukas_drawing_documents_creation_identity_check check (
    (creation_request_id is null and creation_request_sha256 is null)
    or (creation_request_id is not null and creation_request_sha256 is not null)
  );

create unique index lukas_drawing_documents_creation_request_key
  on public.lukas_drawing_documents(project_id,created_by,creation_request_id)
  where creation_request_id is not null;

-- Extend, rather than replace, every existing source/actor/non-draft check in
-- private.lukas_drawing_document_guard(). On INSERT both creation fields must
-- be null. On UPDATE an unchanged pair is allowed; a changed pair is allowed
-- only for the one initial (null,null) -> (request_id,sha256) transition when
-- current_user is the exact lukas_drawing_documents table owner and the
-- transaction-local marker equals document_id:request_id:sha256. Every clear,
-- replacement, second transition, or caller-owned INSERT raises:
--   'Drawing document creation identity is immutable'
-- Resolve the table owner from pg_class/pg_namespace; do not hard-code postgres.

create or replace function private.lukas_drawing_document_creation_result(p_document_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select pg_catalog.jsonb_build_object(
    'documentId',d.id,
    'revisionId',r.id,
    'pageId',p.id,
    'canvasId',c.id,
    'sourceLayerId',(pg_catalog.array_agg(l.id order by l.id)
      filter (where l.system_kind='source'))[1],
    'workLayerId',(pg_catalog.array_agg(l.id order by l.id)
      filter (where l.system_kind='work'))[1]
  )
  from public.lukas_drawing_documents d
  join public.lukas_drawing_revisions r on r.document_id=d.id and r.project_id=d.project_id and r.sequence=1
  join public.lukas_drawing_pages p on p.revision_id=r.id and p.project_id=r.project_id and p.sort_order=0
  join public.lukas_drawing_canvases c on c.page_id=p.id and c.revision_id=r.id and c.sort_order=0
  join public.lukas_drawing_layers l on l.canvas_id=c.id and l.revision_id=r.id
  where d.id=p_document_id
  group by d.id,r.id,p.id,c.id
$$;

create or replace function private.lukas_drawing_create_document_idempotent(
  p_project_id uuid,p_source_file_id uuid,p_title text,p_blank boolean,
  p_client_request_id uuid,p_library_version_id uuid
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_actor uuid:=(select auth.uid());
  v_existing public.lukas_drawing_documents%rowtype;
  v_request_sha text;
  v_result jsonb;
begin
  if v_actor is null or p_client_request_id is null then
    raise exception using errcode='P1R01',message='Drawing creation is unavailable';
  end if;
  if private.lukas_drawing_workspace_capability(p_project_id)
      not in ('admin','editor') then
    raise exception using errcode='P1R01',message='Drawing creation is unavailable';
  end if;
  v_request_sha:=pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
    pg_catalog.jsonb_build_object(
      'projectId',p_project_id,'sourceFileId',p_source_file_id,'title',pg_catalog.btrim(p_title),
      'blank',p_blank,'libraryVersionId',p_library_version_id
    )::text,'UTF8'),'sha256'),'hex');
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    v_actor::text||':'||p_client_request_id::text,0
  ));
  select * into v_existing from public.lukas_drawing_documents d
    where d.project_id=p_project_id and d.created_by=v_actor
      and d.creation_request_id=p_client_request_id for update;
  if found then
    if v_existing.creation_request_sha256 is distinct from v_request_sha then
      raise exception using errcode='P1C01',
        message='Request ID does not match the stored drawing creation';
    end if;
    return private.lukas_drawing_document_creation_result(v_existing.id);
  end if;
  v_result:=private.lukas_drawing_create_document(
    p_project_id,p_source_file_id,p_title,p_blank
  );
  perform pg_catalog.set_config(
    'lukas.drawing_creation_identity',
    (v_result->>'documentId')||':'||p_client_request_id::text||':'||v_request_sha,
    true
  );
  update public.lukas_drawing_documents set
    creation_request_id=p_client_request_id,
    creation_request_sha256=v_request_sha
  where id=(v_result->>'documentId')::uuid and project_id=p_project_id;
  perform pg_catalog.set_config('lukas.drawing_creation_identity','',true);
  return v_result;
end;
$$;
```

The guard verifies the marker with `pg_catalog.current_setting('lukas.drawing_creation_identity',true)` and the exact table owner before permitting the initial transition. A custom GUC is not authority by itself because ordinary roles can set arbitrary custom settings. Preserve the existing trigger as `SECURITY INVOKER`: the table-owner `current_user` condition becomes true only while the private `SECURITY DEFINER` helper performs this update. Direct Editor/Admin/table grants cannot initialize, clear, or rewrite either identity column.

Keep the existing four-argument public invoker RPC byte-for-byte compatible because runtime tests, collaboration fixtures, and deployed legacy clients use it. Add a separately named idempotent public invoker RPC for every new M1 start flow. The private idempotent helper remains `SECURITY DEFINER`, has `search_path=''`, and repeats actor/project/current `admin|editor` capability checks before either the exact-retry read or creation. Revoke the unchecked private result reader from `PUBLIC,anon,authenticated,service_role`; only the function owner may execute it. Revoke the checked private idempotent helper from `PUBLIC,anon`, then grant it to `authenticated,service_role` so the public `SECURITY INVOKER` wrapper can call it from the unexposed private schema. Do not create a public `SECURITY DEFINER` write tunnel and do not alter the grants or behavior of the legacy four-argument signature in M1.

```sql
create function public.lukas_drawing_create_document_idempotent(
  p_project_id uuid,p_source_file_id uuid,p_title text,p_blank boolean,
  p_client_request_id uuid,p_library_version_id uuid default null
) returns jsonb language sql security invoker set search_path='' as $$
  select private.lukas_drawing_create_document_idempotent(
    p_project_id,p_source_file_id,p_title,p_blank,p_client_request_id,
    p_library_version_id
  )
$$;

revoke all on function private.lukas_drawing_document_creation_result(uuid)
  from public,anon,authenticated,service_role;
revoke all on function private.lukas_drawing_create_document_idempotent(
  uuid,uuid,text,boolean,uuid,uuid
) from public,anon;
grant execute on function private.lukas_drawing_create_document_idempotent(
  uuid,uuid,text,boolean,uuid,uuid
) to authenticated,service_role;
revoke all on function public.lukas_drawing_create_document_idempotent(
  uuid,uuid,text,boolean,uuid,uuid
) from public,anon,authenticated,service_role;
grant execute on function public.lukas_drawing_create_document_idempotent(
  uuid,uuid,text,boolean,uuid,uuid
) to authenticated,service_role;
```

- [ ] **Step 6: Seed platform starters into the existing organization library**

Keep the starter catalog DB-canonical so the browser and server never disagree about provenance. Add `private.lukas_drawing_platform_starters` with primary key `(key,version)`, a bounded `canonical_payload jsonb`, and a stored SHA-256 generated from `canonical_payload::text`. Insert exactly the four version-1 recipes from Task 3. Each payload has this closed shape:

```json
{
  "schemaVersion": "1hk-platform-starter/1",
  "key": "interior-basic",
  "version": 1,
  "name": "실내건축 기본 적산",
  "description": "바닥·벽·천장·문·창호·가구 기본 수량을 정리합니다.",
  "layers": ["실측", "바닥", "벽", "천장", "문·창호", "가구"],
  "categories": ["바닥", "벽", "천장", "문", "창호", "가구", "철거"],
  "evidenceKinds": ["수기 입력", "현장 실측", "가정값", "원본 연결"],
  "table": {
    "name": "기본 내역",
    "columns": ["적산 분류", "품목 코드", "측정 종류", "단위", "검토 규칙"],
    "rows": []
  }
}
```

The other three rows use the names, descriptions, and layer arrays in Task 3 and the same categories/evidence/table contract. `rows` is deliberately empty: `DrawingTableSchema` requires every row to reference a real object or block instance, so the plan must never create seven dummy rows.

Extend `lukas_drawing_library_versions` rather than adding another public template registry:

```sql
alter table public.lukas_drawing_library_versions
  add column source_kind text not null default 'project_revision'
    check (source_kind in ('project_revision','platform_starter')),
  add column platform_starter_key text,
  add column platform_starter_version bigint,
  alter column source_project_id drop not null,
  alter column source_revision_id drop not null,
  add constraint lukas_drawing_library_versions_source_kind_check check (
    (source_kind='project_revision' and source_project_id is not null
      and source_revision_id is not null and platform_starter_key is null
      and platform_starter_version is null)
    or
    (source_kind='platform_starter' and source_project_id is null
      and source_revision_id is null and source_entity_id is null
      and platform_starter_key is not null and platform_starter_version is not null)
  ),
  add constraint lukas_drawing_library_versions_platform_starter_fkey
    foreign key (platform_starter_key,platform_starter_version)
    references private.lukas_drawing_platform_starters(key,version)
    on delete restrict;

create unique index lukas_drawing_library_versions_platform_starter_key
  on public.lukas_drawing_library_versions(
    organization_id,platform_starter_key,platform_starter_version
  )
  where source_kind='platform_starter';
```

Update the existing library-version immutability trigger to include all three new fields. Add read-only `public.lukas_drawing_list_platform_starters(p_organization_id uuid,p_project_id uuid)`: it verifies membership and entitlement, then returns key, version, name, description, canonical payload, and content hash directly from the private catalog without changing state. Add `public.lukas_drawing_ensure_platform_starter_version(p_organization_id uuid,p_project_id uuid,p_key text,p_version bigint)`: it verifies a non-anonymous actor, same-organization project, `admin|editor` drawing capability, both M1 entitlements, and then advisory-locks the organization and inserts/publishes only the selected missing catalog version into the existing `lukas_drawing_library_entries/versions`. It returns the immutable organization library version ID and bounded payload fields. An existing same-name non-platform entry is a bounded conflict; it is never overwritten. All three public functions are `SECURITY INVOKER`; their private definer implementations own the necessary writes and repeat the stated checks.

Add `public.lukas_drawing_record_platform_starter_import(p_organization_id uuid,p_version_id uuid,p_project_id uuid,p_document_id uuid,p_revision_id uuid,p_client_request_id uuid)`. It repeats capability and ancestry checks, verifies the selected version is the exact immutable platform payload, and computes a deterministic fingerprint of the revision's preset layers/five schemas/empty `기본 내역` table. Insert the existing ledger with this exact workspace-import mapping: `organization_id=v_version.organization_id`, `registry_id=v_version.registry_id`, `version_id=v_version.id`, `project_id=p_project_id`, `revision_id=NULL`, `target_entity_id=NULL`, `target_document_id=p_document_id`, `target_revision_id=p_revision_id`, `source_content_sha256=v_version.content_sha256`, `imported_by=v_actor`, `client_request_id=p_client_request_id`, and `request_sha256=sha256(canonical organization/version/project/document/revision/structure fingerprint)`. This satisfies the ledger's workspace branch; never put the target revision into `revision_id`. Use the current `(imported_by,client_request_id)` retry identity, return the same import/document/revision/hash on an exact retry, and reject a mismatched request. Update `lukas_drawing_import_library_version` to reject `source_kind='platform_starter'` with a bounded message so generic library UI cannot dereference null source revisions; the new-workspace action is its only import adapter. Update the existing publish/deprecate RPCs to reject platform-starter versions, so organization admins can copy them but cannot change their lifecycle.

Revoke `PUBLIC` and `anon` access to the private catalog/helper functions. Grant private helper execute only to `authenticated,service_role` for the unexposed-schema invoker call, and grant only the list/ensure/record public invoker wrappers to the same roles; each helper still requires a real `auth.uid()` and the stated membership or project capability, so a bare service role cannot bypass the actor check. Assert in the migration test that no M1 public write function is `SECURITY DEFINER`.

- [ ] **Step 7: Add the estimate binding with same-project keys and insert-only access**

Append this table shape and enforce update/delete denial with a trigger. Use the existing `drawing_workspace` and `quantity_lineage` restrictive entitlement-policy predicates from the latest migration verbatim, changing only the table name:

```sql
create table public.lukas_drawing_estimate_bindings (
  id uuid primary key default extensions.gen_random_uuid(),
  project_id uuid not null references public.lukas_qto_projects(id) on delete cascade,
  drawing_revision_id uuid not null,
  boq_version_id uuid not null,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default pg_catalog.now(),
  unique (id,project_id),
  unique (drawing_revision_id),
  unique (boq_version_id),
  foreign key (drawing_revision_id,project_id)
    references public.lukas_drawing_revisions(id,project_id) on delete cascade,
  foreign key (boq_version_id,project_id)
    references public.lukas_qto_boq_versions(id,project_id) on delete cascade
);

create index lukas_drawing_estimate_bindings_project_created_idx
  on public.lukas_drawing_estimate_bindings(project_id,created_at desc,id);

create or replace function private.lukas_drawing_estimate_binding_guard()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if tg_op='DELETE'
    and pg_catalog.current_setting('app.lukas_retention_purge_project',true)=old.project_id::text
    and current_user=pg_catalog.pg_get_userbyid(
      (select c.relowner from pg_catalog.pg_class c where c.oid=tg_relid)
    ) then return old; end if;
  raise exception using errcode='P1C01',message='Drawing estimate bindings are append-only';
end;
$$;

create trigger lukas_drawing_estimate_binding_guard
before update or delete on public.lukas_drawing_estimate_bindings
for each row execute function private.lukas_drawing_estimate_binding_guard();

alter table public.lukas_drawing_estimate_bindings enable row level security;

create policy "project members read drawing estimate bindings"
on public.lukas_drawing_estimate_bindings for select to authenticated
using (private.lukas_drawing_workspace_capability(project_id) is not null);

create policy "project editors create drawing estimate bindings"
on public.lukas_drawing_estimate_bindings for insert to authenticated
with check (
  created_by=(select auth.uid())
  and private.lukas_drawing_workspace_capability(project_id) in ('admin','editor')
  and exists (
    select 1 from public.lukas_drawing_revisions r
    where r.id=drawing_revision_id and r.project_id=project_id and r.status='draft'
  )
  and exists (
    select 1 from public.lukas_qto_boq_versions b
    where b.id=boq_version_id and b.project_id=project_id and b.status='draft'
  )
);

create policy "verified sessions use drawing estimate bindings"
on public.lukas_drawing_estimate_bindings as restrictive for all to authenticated
using (private.lukas_qto_verified_session())
with check (private.lukas_qto_verified_session());

create policy "M1 drawing and quantity entitlement"
on public.lukas_drawing_estimate_bindings as restrictive for all to authenticated
using (
  private.lukas_qto_project_feature_active(project_id,'drawing_workspace')
  and private.lukas_qto_project_feature_active(project_id,'quantity_lineage')
)
with check (
  private.lukas_qto_project_feature_active(project_id,'drawing_workspace')
  and private.lukas_qto_project_feature_active(project_id,'quantity_lineage')
);

revoke all on public.lukas_drawing_estimate_bindings
  from public,anon,authenticated,service_role;
grant select,insert on public.lukas_drawing_estimate_bindings
  to authenticated;
grant select on public.lukas_drawing_estimate_bindings
  to service_role;
```

End the file with `commit;`.

- [ ] **Step 8: Update the TypeScript RPC wrapper and its fake-client tests**

Add a separate `CreateDocumentIdempotentInputSchema` and `createDrawingDocumentIdempotent`; leave `CreateDocumentInputSchema` and `createDrawingDocument` compatible with current callers. The new RPC call must send `null` when no source exists:

```ts
const { data, error } = await client.rpc("lukas_drawing_create_document_idempotent", {
  p_project_id: Uuid.parse(projectId),
  p_source_file_id: parsed.sourceFile?.id ?? null,
  p_title: parsed.title,
  p_blank:
    parsed.sourceFile?.kind !== "pdf" || parsed.mode === "blank",
  p_client_request_id: parsed.clientRequestId,
  p_library_version_id: parsed.libraryVersionId ?? null,
});
```

Add one fake-client assertion for `sourceFile: null`, one exact retry returning the same `documentId`, and mismatched retries for a changed title or `libraryVersionId` mapped to `DrawingWorkspaceConflictError`.

- [ ] **Step 9: Run contract, migration, and TypeScript tests**

Run:

```bash
cd /Users/h/Documents/GoAgent/platform
node --test tests/drawing-workspace-m1-database.test.mjs tests/drawing-workspace-database.test.mjs tests/drawing-workspace-server.test.mjs
npm run typecheck
npx supabase migration list --local
```

Expected: all Node tests PASS, typecheck exits 0, and the new migration appears once in local migration order.

- [ ] **Step 10: Run real PostgreSQL locking/RLS proof and advisors**

Discover commands first, then run the repository's existing fresh/upgrade migration harness and advisors supported by the installed CLI:

```bash
cd /Users/h/Documents/GoAgent/platform
npx supabase db --help
npm run test:drawing-workspace
M1_REAL_POSTGRES_REQUIRED=1 node --test tests/drawing-workspace-m1-real-database.test.mjs
npx supabase db advisors --local
```

The real-Postgres test uses the already-installed `postgres` package and `M1_REAL_POSTGRES_DATABASE_URL`. Reassert the environment contract in this step: an ordinary `npm run test:drawing-workspace` without the URL reports this suite as skipped, while this exact `M1_REAL_POSTGRES_REQUIRED=1` command fails before testing if the URL is missing and may never return a skip. It creates isolated fixture IDs. The starter ensure/import assertions run inside one explicit transaction and always roll back, so append-only/protected provenance never escapes the test even on failure. The concurrent creation/binding fixtures contain no protected approval/import rows; `finally` removes them with the table-owner connection plus the exact transaction-local retention purge marker, then verifies no fixture ID remains. It must prove all of the following against the migrated database:

- two concurrent exact document-creation retries return one document; a changed input with the same request ID fails;
- direct Editor/Admin insert or update cannot initialize, clear, or replace `creation_request_id`/`creation_request_sha256`, even after setting the custom GUC; the checked helper performs the sole initial transition and an exact retry still succeeds;
- `anon`, anonymous-authenticated, non-member, Viewer, Reviewer, and Approver cannot insert a binding;
- Editor and Admin can insert a same-project draft binding;
- cross-project revision/BOQ IDs fail;
- direct insert/update/delete of a binding fails for a bare service role; authenticated insert succeeds only through RLS for Editor/Admin, and update/delete always fail;
- a draft-only project deletion through the existing retention RPC can cascade the binding only while the transaction-local purge marker is set; direct authenticated/service deletion still fails;
- platform starter versions are seeded once, remain byte/hash stable, and the import ledger exact retry is singular;
- an exact sequential ensure retry returns the same organization library version, and a direct duplicate insert is rejected by the partial organization/key/version index. Task 1 does not claim a two-session committed starter race from rollback-only fixtures; document creation supplies the required real concurrency proof;
- unchecked private readers/catalog tables are non-executable by every app role; only the capability-checking private helpers needed by public invoker wrappers are executable by `authenticated,service_role`, and all public/private/table grants match the exact signatures in the plan.

Expected: fresh and populated upgrade tests plus the required real PostgreSQL test PASS; advisors report no new security or performance issue caused by this migration. PGlite contract tests are useful but do not satisfy this release authority. If a real database URL or supported advisor is unavailable, record that gate as `UNEXECUTED` and do not call M1 complete.

- [ ] **Step 11: Commit only this task**

```bash
cd /Users/h/Documents/GoAgent
git add platform/app/lukas/lib/drawing-workspace.server.ts \
  platform/tests/drawing-workspace-m1-database.test.mjs \
  platform/tests/drawing-workspace-m1-real-database.test.mjs \
  platform/tests/drawing-workspace-server.test.mjs \
  platform/supabase/migrations/*_universal_workspace_m1.sql
git commit -m "feat: add idempotent estimator workspace authority"
```

---

### Task 2: Make the workspace document-first and source-optional

**Files:**
- Create: `platform/app/lukas/lib/drawing-workspace-paths.ts`
- Modify: `platform/app/routes.ts`
- Modify: `platform/app/lukas/lib/drawing-workspace-view.ts`
- Modify: `platform/app/lukas/lib/drawing-workspace.server.ts`
- Modify: `platform/app/lukas/components/drawing-workspace.tsx`
- Modify: `platform/app/lukas/components/drawing-export-dialog.tsx`
- Modify: `platform/app/lukas/screens/drawing-workspace.tsx`
- Modify: `platform/app/lukas/screens/drawing-workspace-operation.ts`
- Modify: `platform/app/lukas/screens/drawing-workspace-export.ts`
- Modify: `platform/app/lukas/screens/local-drawing-workspace-preview.tsx`
- Test: `platform/tests/drawing-workspace-route.test.mjs`
- Test: `platform/tests/drawing-workspace-server.test.mjs`
- Test: `platform/tests/drawing-workspace-shell.test.mjs`
- Test: `platform/tests/drawing-workspace-export.test.mjs`
- Test: `platform/tests/drawing-workspace-p7-export-audit.test.mjs`
- Test: `platform/tests/local-drawing-workspace-preview.test.mjs`
- Test: `platform/tests/drawing-workspace-p6-route.test.mjs`
- Test: `platform/tests/drawing-workspace-p5-server.test.mjs`

**Interfaces:**
- Consumes: Task 1 `createDrawingDocument` and existing revision-scoped collaboration/outbox identity.
- Produces: `drawingWorkspacePath(projectId, workspaceId)`, `drawingWorkspaceNewPath(projectId, sourceFileId?)`, `drawingWorkspaceOperationPath(projectId, workspaceId)`, `drawingWorkspaceExportPath(projectId, workspaceId)`, `legacyProjectWorkspacePath(projectId)`, and `legacyDrawingWorkspacePath(projectId, fileId)`.
- Produces: `loadDrawingWorkspace(client, input: { projectId: string; workspaceId: string; revisionId?: string; focusObjectId?: string; focusEvidenceFileId?: string }): Promise<DrawingWorkspace>`.
- Produces: `DrawingWorkspace.primarySource: DrawingWorkspaceFile | null`; the `file` field is removed rather than duplicated.

- [ ] **Step 1: Write failing canonical-route and null-source tests**

Add these route assertions to `drawing-workspace-route.test.mjs`:

```js
const byPath = new Map(flatten(routes).map((route) => [route.path, route.file]));
assert.equal(
  byPath.get("/projects/:projectId/workspaces/:workspaceId"),
  "lukas/screens/drawing-workspace.tsx",
);
assert.equal(
  byPath.get("/projects/:projectId/workspaces/:workspaceId/operation"),
  "lukas/screens/drawing-workspace-operation.ts",
);
assert.equal(
  byPath.get("/projects/:projectId/workspaces/:workspaceId/export"),
  "lukas/screens/drawing-workspace-export.ts",
);
assert.equal(
  byPath.get("/projects/:projectId/drawings/:fileId/workspace"),
  "lukas/screens/drawing-workspace.tsx",
);
```

At this task boundary the existing project/file workspace, operation, and export routes intentionally remain registered as compatibility aliases; Task 3 can remove them only after the new start route and legacy resolver exist.

Add a server fixture whose document has `source_file_id: null` and assert:

```js
const loaded = await loadDrawingWorkspace(client, {
  projectId: ids.project,
  workspaceId: ids.document,
});
assert.equal(loaded.primarySource, null);
assert.equal(loaded.document.id, ids.document);
assert.equal(loaded.document.revision.id, ids.revision);
```

In `drawing-workspace-route.test.mjs`, add a pure surface assertion that calls `drawingWorkspaceSurface({ file:null, page, sourceUrl:null })` and expects the existing blank/model surface result without throwing. Preserve the current PDF/IFC surface cases.

Add an export-dialog test that calls `auditDrawingExport(blob,filename,workspaceId,projectId,revisionId)` and captures `fetch`; assert the exact POST target is `drawingWorkspaceExportPath(projectId,workspaceId)` and that no source-file ID or legacy `/drawings/:fileId/workspace/export` path is constructed. Keep the redirected-login and content-type refusal cases.

- [ ] **Step 2: Run focused tests and verify canonical identity/null-source support is missing**

Run: `cd /Users/h/Documents/GoAgent/platform && node --test tests/drawing-workspace-route.test.mjs tests/drawing-workspace-server.test.mjs`

Expected: FAIL because canonical routes/path functions and `primarySource` do not exist.

- [ ] **Step 3: Add UUID-validated path helpers**

Create `drawing-workspace-paths.ts`:

```ts
import { z } from "zod";

const Uuid = z.string().uuid();

export function drawingWorkspacePath(projectId: string, workspaceId: string) {
  return `/projects/${Uuid.parse(projectId)}/workspaces/${Uuid.parse(workspaceId)}`;
}

export function drawingWorkspaceNewPath(projectId: string, sourceFileId?: string) {
  const base = `/projects/${Uuid.parse(projectId)}/workspaces/new`;
  return sourceFileId
    ? `${base}?sourceFileId=${encodeURIComponent(Uuid.parse(sourceFileId))}`
    : base;
}

export function drawingWorkspaceOperationPath(projectId: string, workspaceId: string) {
  return `${drawingWorkspacePath(projectId, workspaceId)}/operation`;
}

export function drawingWorkspaceExportPath(projectId: string, workspaceId: string) {
  return `${drawingWorkspacePath(projectId, workspaceId)}/export`;
}

export function legacyDrawingWorkspacePath(projectId: string, fileId: string) {
  return `/projects/${Uuid.parse(projectId)}/drawings/${Uuid.parse(fileId)}/workspace`;
}

export function legacyProjectWorkspacePath(projectId: string) {
  return `/projects/${Uuid.parse(projectId)}/workspace`;
}
```

Do not change `drawing-entry.ts` yet: the new route is not registered until Task 3.

- [ ] **Step 4: Register document-scoped canonical routes alongside compatibility routes**

Register only the three document-scoped canonical routes (`/:workspaceId`, `/operation`, `/export`) before the old drawing routes. Do not register `/workspaces/new`, create the legacy resolver, or remove any old route in this task. Refactor the workspace action and export module to accept canonical `workspaceId` exactly while preserving their existing `fileId` compatibility branch; canonical requests must never fall back to a latest document. Change `DrawingExportDialogProps.fileId` to required `workspaceId`, change `auditDrawingExport` to use `drawingWorkspaceExportPath(projectId,workspaceId)`, and update every caller/test before the old export route is removed in Task 3. Add export tests proving canonical document/revision scope, canonical audit POST, and unchanged legacy file export during this one-task transition.

- [ ] **Step 5: Refactor the loader to start from the document**

Change `DrawingWorkspace` to:

```ts
export type DrawingWorkspace = {
  primarySource: DrawingWorkspaceFile | null;
  templateCandidates: DrawingTemplateCandidate[];
  document: DrawingWorkspaceDocument;
};
```

Extract the current non-null `document` branch without changing any nested field and name it `DrawingWorkspaceDocument`; this is a type-only extraction, not a second graph model. The canonical loader returns a bounded 404 when the exact document/revision is absent. Only the new-workspace loader and legacy resolver may represent a pre-creation state; they do not call `loadDrawingWorkspace`.

Implement the query order exactly as document → revision → optional source → graph. The ancestry check must be:

```ts
if (
  document.project_id !== projectId ||
  revision.project_id !== projectId ||
  revision.document_id !== document.id
) throw new Error("Drawing document ancestry is invalid.");

const primarySource = document.source_file_id
  ? await loadImmutableDrawingSource(
      client,
      projectId,
      document.source_file_id,
      document.source_sha256,
    )
  : null;
```

`loadImmutableDrawingSource` must require kind `pdf|ifc`, `immutable=true`, and exact SHA equality. A missing source on a source-backed document is a bounded 404; `source_file_id=null` is a normal workspace.

- [ ] **Step 6: Make source bundle and shell rendering nullable**

Change source selection to use `workspace.primarySource`:

```ts
const selectedIfcFileId =
  viewState.ifcFileId ??
  (workspace.primarySource?.kind === "ifc"
    ? workspace.primarySource.id
    : null);
```

In `drawing-workspace.tsx`, replace every `workspace.file` dependency with `primarySource` or a document fallback. The key rendering values are:

```ts
const file = workspace.primarySource;
const primarySourceUrl =
  sourceBundle?.pdf?.signedUrl ??
  (file?.kind === "pdf" ? sourceUrl : null);
const surface = drawingWorkspaceSurface({
  file: file ? { kind: file.kind } : null,
  page: page
    ? {
        width: page.width_mm,
        height: page.height_mm,
        backgroundPdfPage: page.background_pdf_page,
      }
    : null,
  sourceUrl: primarySourceUrl,
});
```

Show `원본 없음 · 빈 캔버스` when `file` is null. Use `/projects/${projectId}/drawings` as `roomUrl` for source-free documents. Call `loadDrawingRoom` only when a primary source exists; keep object issue links from the workspace graph available when it does not.

Render `DrawingExportLauncher` for every loaded document, outside any `sourceFile` conditional. Pass `workspaceId={workspace.document.id}` and keep `sourceUrl` nullable so blank and template workspaces export their vector state through the same audited canonical endpoint.

In `drawing-workspace-view.ts`, change only `WorkspaceSurfaceInput.file` to `{ kind: DrawingWorkspaceFile["kind"] } | null` and branch on null before reading `.kind`; null selects the same blank/model canvas surface already used when no renderer source is available. Do not synthesize a file or duplicate source state.

Update `local-drawing-workspace-preview.tsx` and its tests to construct/read `workspace.primarySource` rather than the removed `workspace.file`. Update the `sourceWorkspace()` fixture in `drawing-workspace-p5-server.test.mjs` from `{ file }` to `{ primarySource:file }` while preserving every source-bundle validation assertion. Update the P6 route source assertion to accept an optional `primarySource` and exact document ancestry; do not keep a duplicate compatibility property on the production type or test fixtures.

- [ ] **Step 7: Keep canonical operation and history identity revision-scoped**

Update the canonical screen/action to prefer exact `params.workspaceId`; retain the current `params.fileId` resolution only for the compatibility routes that Task 3 removes. Do not add workspace IDs to outbox or Yjs keys. Canonical forms submit to `drawingWorkspaceOperationPath(project.id, workspace.document.id)` and collaboration continues to use `revision.id`.

Change template/restore redirects to:

```ts
return redirect(
  drawingWorkspacePath(project.id, restored.documentId),
  { headers },
);
```

- [ ] **Step 8: Run route, server, shell, outbox, and collaboration tests**

Run:

```bash
cd /Users/h/Documents/GoAgent/platform
node --test tests/drawing-workspace-route.test.mjs tests/drawing-workspace-server.test.mjs tests/drawing-workspace-shell.test.mjs tests/drawing-workspace-export.test.mjs tests/local-drawing-workspace-preview.test.mjs tests/drawing-workspace-p5-server.test.mjs tests/drawing-workspace-p6-route.test.mjs tests/drawing-workspace-outbox.test.mjs tests/drawing-workspace-realtime.test.mjs
node --test tests/drawing-workspace-p7-export-audit.test.mjs
npm run typecheck
```

Expected: all tests PASS and no IndexedDB/outbox/Yjs schema is changed.

- [ ] **Step 9: Commit only routing and source-optional changes**

```bash
cd /Users/h/Documents/GoAgent
git add platform/app/routes.ts \
  platform/app/lukas/lib/drawing-workspace-paths.ts \
  platform/app/lukas/lib/drawing-workspace-view.ts \
  platform/app/lukas/lib/drawing-workspace.server.ts \
  platform/app/lukas/components/drawing-workspace.tsx \
  platform/app/lukas/components/drawing-export-dialog.tsx \
  platform/app/lukas/screens/drawing-workspace.tsx \
  platform/app/lukas/screens/drawing-workspace-operation.ts \
  platform/app/lukas/screens/drawing-workspace-export.ts \
  platform/app/lukas/screens/local-drawing-workspace-preview.tsx \
  platform/tests/drawing-workspace-route.test.mjs \
  platform/tests/drawing-workspace-server.test.mjs \
  platform/tests/drawing-workspace-shell.test.mjs \
  platform/tests/drawing-workspace-export.test.mjs \
  platform/tests/drawing-workspace-p7-export-audit.test.mjs \
  platform/tests/local-drawing-workspace-preview.test.mjs \
  platform/tests/drawing-workspace-p5-server.test.mjs \
  platform/tests/drawing-workspace-p6-route.test.mjs
git commit -m "feat: add source optional workspace routes"
```

---

### Task 3: Add blank, starter-template, and PDF start flows

**Files:**
- Create: `platform/app/lukas/lib/drawing-starter-templates.ts`
- Create: `platform/app/lukas/lib/drawing-starter-templates.server.ts`
- Create: `platform/app/lukas/components/drawing-workspace-start.tsx`
- Create: `platform/app/lukas/screens/drawing-workspace-new.tsx`
- Create: `platform/app/lukas/screens/drawing-workspace-legacy.tsx`
- Create: `platform/tests/drawing-workspace-m1-start.test.mjs`
- Modify: `platform/app/routes.ts`
- Modify: `platform/app/lukas/lib/drawing-entry.ts`
- Modify: `platform/app/lukas/lib/drawing-workspace.server.ts`
- Modify: `platform/app/lukas/lib/organization-drawing-library.server.ts`
- Modify: `platform/app/lukas/components/workspace-dashboard.tsx`
- Modify: `platform/app/lukas/screens/project-drawings.tsx`
- Modify: `platform/app/lukas/screens/organization-drawing-library.tsx`
- Modify: `platform/tests/drawing-workspace-entry-flow.test.mjs`
- Modify: `platform/tests/drawing-workspace-route.test.mjs`
- Modify: `platform/tests/drawing-workspace-p5-release.test.mjs`
- Modify: `platform/tests/drawing-workspace-template.test.mjs`
- Modify: `platform/tests/drawing-workspace-p7-library-route.test.mjs`

**Interfaces:**
- Consumes: Task 1 `createDrawingDocumentIdempotent`, platform-starter list/ensure/record RPCs, existing `applyDrawingOperation`, Task 2 canonical paths, and existing organization template candidates.
- Produces: browser-safe `DrawingStarterDefinitionSchema` and `DrawingStarterCatalogItem = { definition; contentSha256 }`; server-only `loadDrawingStarterCatalog`, `ensureDrawingStarterVersion`, and `buildDrawingWorkspaceScaffoldOperation({ definition: DrawingStarterDefinition | null, revisionId, pageId, canvasId, clientRequestId, createdAt })`.
- Produces: new-workspace action intents `create_blank`, `create_starter`, `create_pdf`, and `create_library_template`.
- Produces: all newly created blank/PDF documents receive the four approved core property schemas `적산 분류`, `공종`, `품목 코드`, `근거 상태` plus the supporting string schema `근거 사유`; starter documents additionally receive their preset layers and an empty, schema-valid `기본 내역` table.

- [ ] **Step 1: Write failing starter and entry tests**

Create `drawing-workspace-m1-start.test.mjs`:

```js
import assert from "node:assert/strict";
import test from "node:test";

import { DrawingStarterDefinitionSchema } from
  "../app/lukas/lib/drawing-starter-templates.ts";
import { loadDrawingStarterCatalog } from
  "../app/lukas/lib/drawing-starter-templates.server.ts";

test("M1 loads exactly four immutable organization-seedable starters", async () => {
  const catalog = await loadDrawingStarterCatalog(starterRpcClient(), ids.organization, ids.project);
  assert.deepEqual(catalog.map(({ definition: { key, name, version } }) => ({ key, name, version })), [
    { key: "interior-basic", name: "실내건축 기본 적산", version: 1 },
    { key: "apartment-remodel", name: "공동주택 리모델링", version: 1 },
    { key: "commercial-interior", name: "상업공간 인테리어", version: 1 },
    { key: "demolition-restoration", name: "철거·원상복구", version: 1 },
  ]);
  assert.equal(catalog[0].definition.categories.length, 7);
  assert.equal(catalog[0].definition.table.rows.length, 0);
  assert.equal(DrawingStarterDefinitionSchema.safeParse({ ...catalog[0].definition, extra: true }).success, false);
});
```

Implement `starterRpcClient()` in the test as the same minimal `{ rpc(name,args) }` fake used by current server tests: it accepts only `lukas_drawing_list_platform_starters`, asserts the organization/project IDs, and returns four rows with canonical payload plus a matching 64-hex content hash. Add separate fake-client cases for ensure exact retry, ledger exact retry, changed request rejection, and a same-name custom-library collision.

Extend `drawing-workspace-p7-library-route.test.mjs` with a platform row whose `source_project_id`, `source_revision_id`, and `source_entity_id` are null. Assert the loader accepts it, parses its closed starter payload, returns `source_kind: "platform_starter"`, never renders publish/deprecate or the generic import form, and renders one project-labelled `사용` link per `loaderData.projects` item to that project's new-workspace screen. Include two projects in the fixture and assert both exact targets so the organization page never invents an ambient project. Retain the current project-revision fixture to prove company-library behavior is unchanged.

Change the empty-project assertion in `drawing-workspace-entry-flow.test.mjs` from the PDF upload URL to `/projects/:projectId/workspaces/new` and add a PDF-upload assertion for `?sourceFileId=<fileId>`.

In `drawing-workspace-route.test.mjs`, now assert `/projects/:projectId/workspaces/new` resolves to `drawing-workspace-new.tsx`; both old workspace GET paths resolve to `drawing-workspace-legacy.tsx`; `/projects/:projectId/workspace/operation` plus the old file operation/export paths are absent; and the canonical document operation/export paths remain. Update the P5 release route assertion from the removed file operation URL to the canonical `workspaces/:workspaceId/operation` URL while retaining the preview-operation assertion. Add resolver tests for a project-latest redirect, a file-latest redirect, a file with no document → source-prefilled start, and a zero-file/zero-document project → blank start. No GET may create a document.

- [ ] **Step 2: Run tests and confirm the catalog/start screen is missing**

Run: `cd /Users/h/Documents/GoAgent/platform && node --test tests/drawing-workspace-m1-start.test.mjs tests/drawing-workspace-entry-flow.test.mjs tests/drawing-workspace-route.test.mjs tests/drawing-workspace-p5-release.test.mjs tests/drawing-workspace-p7-library-route.test.mjs`

Expected: FAIL because the starter module and new destination are absent.

- [ ] **Step 3: Finish the route cutover only after the start screen exists**

Register `/projects/:projectId/workspaces/new`. Update `drawing-entry.ts` so a verified PDF upload goes to `drawingWorkspaceNewPath(projectId,fileId)`. Point both `/projects/:projectId/workspace` and `/projects/:projectId/drawings/:fileId/workspace` at the new legacy resolver. After `rg` proves every mounted form uses canonical document paths, remove `/projects/:projectId/workspace/operation` and the old file-scoped operation/export routes.

When `fileId` exists, `drawing-workspace-legacy.tsx` authenticates, validates the immutable PDF/IFC file, selects only the latest matching document by `updated_at desc,id desc`, and redirects to its canonical path; if none exists it redirects to the source-prefilled start route. Without `fileId`, it selects the latest project document by the same order or redirects an empty project to the blank start route. It ignores legacy `document` query overrides and never creates state from GET. This is the point where Task 2's temporary compatibility branches become unreachable, but keep their pure resolver tests as regression coverage.

- [ ] **Step 4: Parse the four DB-canonical presets without a client-side template engine**

Create `drawing-starter-templates.ts` with a strict Zod schema for the closed payload inserted in Task 1 and these exact shared enums:

```ts
export const DRAWING_ESTIMATE_CATEGORIES = [
  "바닥",
  "벽",
  "천장",
  "문",
  "창호",
  "가구",
  "철거",
] as const;

export const DRAWING_EVIDENCE_KINDS = [
  "수기 입력", "현장 실측", "가정값", "원본 연결",
] as const;
```

The schema requires `schemaVersion`, key/version/name/description, non-empty unique layers, the exact seven categories, exact four evidence kinds, and `table` with the five exact columns and `rows: []`. This file imports only Zod. In `drawing-starter-templates.server.ts`, call the Task 1 list RPC, parse every row and its 64-hex content hash, sort bytewise by key, reject duplicates, and require exactly the approved four key/name/version tuples. Node `crypto` is confined to this `.server.ts` module.

Update `organization-drawing-library.server.ts` at the same time. Add `source_kind` to its selected version fields; make `source_project_id` and `source_revision_id` nullable in `VersionRow`; require project provenance only when `source_kind === "project_revision"`; and require null project provenance plus key/version when `source_kind === "platform_starter"`. Make `parseOrganizationLibraryCanonicalPayload` source-kind-aware: company-authored workspace templates continue through the existing snapshot schema, while platform starters go through `DrawingStarterDefinitionSchema`. Do not broaden either schema or coerce one payload format into the other.

The migration payloads and fake-client fixtures use these exact remaining values:

| key | name | description | layers |
| --- | --- | --- | --- |
| `interior-basic` | 실내건축 기본 적산 | 바닥·벽·천장·문·창호·가구 기본 수량을 정리합니다. | 실측, 바닥, 벽, 천장, 문·창호, 가구 |
| `apartment-remodel` | 공동주택 리모델링 | 세대 공간별 마감·창호·가구·철거 수량을 정리합니다. | 실측, 기존, 철거, 신설, 마감, 가구 |
| `commercial-interior` | 상업공간 인테리어 | 영업 공간의 구획·마감·집기 수량을 정리합니다. | 실측, 구획, 바닥, 벽, 천장, 집기, 설비 근거 |
| `demolition-restoration` | 철거·원상복구 | 철거 대상과 복구 대상을 분리해 수량을 정리합니다. | 실측, 존치, 철거, 폐기, 복구, 보양 |

- [ ] **Step 5: Build one deterministic structure operation per preset**

Use the existing `mutate_structure` action. Derive UUIDs from SHA-256 bytes so a retry uses identical entity and operation IDs:

```ts
function deterministicUuid(seed: string) {
  const hex = createHash("sha256").update(seed).digest("hex").slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20)}`;
}
```

`buildDrawingWorkspaceScaffoldOperation` must create:

- one `put_layer` action per preset layer on the existing page/canvas;
- five `put_property_schema` actions named `적산 분류`, `공종`, `품목 코드`, `근거 상태`, `근거 사유`;
- `적산 분류` enum options equal to the seven approved categories;
- `근거 상태` enum options `수기 입력`, `현장 실측`, `가정값`, `원본 연결`;
- all drawing object kinds, including `wall/opening/space/area/grid/arc`, in `appliesTo`;
- when `definition` is present, one `put_table` action named `기본 내역` with columns `적산 분류`, `품목 코드`, `측정 종류`, `단위`, `검토 규칙` and `rows: []`; blank/PDF scaffolds do not create a template table, and rows are added only when they can reference a real object or block instance;
- the deterministic put actions in `forward` and matching delete actions in reverse order in `inverse`.

Create the five schemas with deterministic IDs, `version:1`, the full `appliesTo` list above, and these exact definitions: `적산 분류` is `valueType:"enum"`, seven category options, `required:false`; `공종`, `품목 코드`, and `근거 사유` are `valueType:"text"`, empty options, `required:false`; `근거 상태` is `valueType:"enum"`, four evidence options, `required:false`. `근거 사유` is the persisted reason required by the approved `가정값` state; it is not a second estimate store. For a non-null starter definition, the empty table has `version:1` and five deterministic column definitions in order:

```ts
[
  { name: "적산 분류", kind: "property", propertySchemaId: classificationSchemaId },
  { name: "품목 코드", kind: "property", propertySchemaId: itemCodeSchemaId },
  { name: "측정 종류", kind: "text", propertySchemaId: null },
  { name: "단위", kind: "text", propertySchemaId: null },
  { name: "검토 규칙", kind: "text", propertySchemaId: null },
]
```

Every column also receives its own deterministic UUID. Assert the two property columns reference the exact schema UUIDs and the other three have null references; a list of names alone is not a valid `DrawingTable`.

Set `clientOperationId=deterministicUuid(clientRequestId + ":scaffold")`, `revisionId`, `baseVersions={}`, and `createdAt` from the form's loader-issued `clientCreatedAt`. Never call `now()` while rebuilding a retry: the stored operation compares `createdAt` as part of its exact envelope. When `definition` is null (blank/PDF), apply only the common five schemas; when it is present, add that definition's preset layers and empty `기본 내역` table. This is one implementation path, not separate blank/PDF/starter operation builders.

- [ ] **Step 6: Add the start loader/action with bounded errors**

The loader returns immutable project PDF files, the four starters, published organization workspace templates, capability, an optional validated `sourceFileId`, and an optional validated `starterKey` used only to focus the matching starter card.

The action uses an exhaustive Zod union:

```ts
const StartMutation = z.discriminatedUnion("intent", [
  z.object({
    intent: z.literal("create_blank"),
    title: Title,
    clientRequestId: Uuid,
    clientCreatedAt: z.string().datetime(),
  }),
  z.object({
    intent: z.literal("create_starter"),
    title: Title,
    starterKey: StarterKey,
    starterVersion: z.literal(1),
    clientRequestId: Uuid,
    clientCreatedAt: z.string().datetime(),
  }),
  z.object({
    intent: z.literal("create_pdf"),
    title: Title,
    sourceFileId: Uuid,
    clientRequestId: Uuid,
    clientCreatedAt: z.string().datetime(),
  }),
  z.object({
    intent: z.literal("create_library_template"),
    libraryVersionId: Uuid,
    clientRequestId: Uuid,
  }),
]);
```

For `create_starter`, first call `ensureDrawingStarterVersion` for the submitted key/version and use the returned library version ID in `createDrawingDocumentIdempotent`; then load the returned first revision/page/canvas, apply the deterministic starter operation, and call `lukas_drawing_record_platform_starter_import`. Blank/PDF starts use the same idempotent helper and apply the common schema operation without a library import. Exact retries must return one document, one byte-identical operation envelope, and one import-ledger row. For `create_library_template`, call the existing `lukas_drawing_import_library_version` adapter with `revisionId:null` and the submitted request ID; its existing entry name remains the cloned document title, so this intent does not accept an unused title. Return field errors with `data({ ok:false, fieldErrors, formError, clientRequestId, clientCreatedAt }, { status:400 })` for operation-backed intents; redirect only after creation/scaffold/import succeeds.

- [ ] **Step 7: Render equal-priority start cards**

`drawing-workspace-start.tsx` renders three peer sections with native labels and submit buttons:

```tsx
<section aria-labelledby="blank-workspace-title">
  <h2 id="blank-workspace-title">빈 작업실</h2>
  <p>원본 없이 수기 입력이나 현장 실측부터 시작합니다.</p>
</section>
<section aria-labelledby="starter-workspace-title">
  <h2 id="starter-workspace-title">템플릿으로 시작</h2>
  <p>실내건축·리모델링 기본 분류와 내역 구조를 불러옵니다.</p>
</section>
<section aria-labelledby="pdf-workspace-title">
  <h2 id="pdf-workspace-title">PDF로 시작</h2>
  <p>검증된 프로젝트 PDF를 잠긴 배경으로 연결합니다.</p>
</section>
```

The loader creates a distinct `{ clientRequestId, clientCreatedAt }` pair for blank, PDF, every starter key, and every organization template version. On a failed action, reuse both values from `actionData` for the submitted form; on an unknown network result the existing loader pair remains mounted. Display server field messages beside the corresponding input and a form alert above the submit button. Disable only the submitting form, not all three choices.

- [ ] **Step 8: Replace file-required empty states**

Update `workspace-dashboard.tsx` and `project-drawings.tsx` so:

- primary CTA is `새 작업실` to `drawingWorkspaceNewPath(projectId)`;
- existing drawing documents open through `drawingWorkspacePath(projectId, documentId)`;
- original PDF/IFC files remain listed and their old links still resolve through Task 2 compatibility;
- zero files does not force the upload page.

In `organization-drawing-library.tsx`, label `source_kind='platform_starter'` versions `1HK 기본 · 읽기 전용`, hide publish/deprecate and every generic import form for them, and map the existing `loaderData.projects` to explicit project-labelled `사용` links at `/projects/<project.id>/workspaces/new?starterKey=<key>` so the user selects the destination project before choosing a title. If the organization has no accessible project, render `사용 가능한 프로젝트가 없습니다` and no link. Company-authored library versions retain their current publish/deprecate/import behavior. The server action also rejects platform versions for generic publish/deprecate/import, so this is not merely a UI restriction.

- [ ] **Step 9: Run start, template, entry, server, and type tests**

Run:

```bash
cd /Users/h/Documents/GoAgent/platform
node --test tests/drawing-workspace-m1-start.test.mjs tests/drawing-workspace-entry-flow.test.mjs tests/drawing-workspace-route.test.mjs tests/drawing-workspace-p5-release.test.mjs tests/drawing-workspace-template.test.mjs tests/drawing-workspace-p7-library-route.test.mjs tests/drawing-workspace-server.test.mjs
npm run typecheck
```

Expected: all tests PASS; retry assertions use one document, one starter operation, one import row, and the same loader-issued `createdAt` byte-for-byte.

- [ ] **Step 10: Commit the complete start flow**

```bash
cd /Users/h/Documents/GoAgent
git add platform/app/lukas/lib/drawing-starter-templates.ts \
  platform/app/lukas/lib/drawing-starter-templates.server.ts \
  platform/app/routes.ts \
  platform/app/lukas/lib/drawing-entry.ts \
  platform/app/lukas/components/drawing-workspace-start.tsx \
  platform/app/lukas/screens/drawing-workspace-new.tsx \
  platform/app/lukas/screens/drawing-workspace-legacy.tsx \
  platform/app/lukas/lib/drawing-workspace.server.ts \
  platform/app/lukas/lib/organization-drawing-library.server.ts \
  platform/app/lukas/components/workspace-dashboard.tsx \
  platform/app/lukas/screens/project-drawings.tsx \
  platform/app/lukas/screens/organization-drawing-library.tsx \
  platform/tests/drawing-workspace-m1-start.test.mjs \
  platform/tests/drawing-workspace-entry-flow.test.mjs \
  platform/tests/drawing-workspace-route.test.mjs \
  platform/tests/drawing-workspace-p5-release.test.mjs \
  platform/tests/drawing-workspace-template.test.mjs \
  platform/tests/drawing-workspace-p7-library-route.test.mjs
git commit -m "feat: add universal workspace start choices"
```

---

### Task 4: Extend deterministic primitive measurements and classification

**Files:**
- Create: `platform/app/lukas/lib/drawing-estimate.ts`
- Create: `platform/app/lukas/components/drawing-scale-control.tsx`
- Create: `platform/tests/drawing-workspace-estimate.test.mjs`
- Modify: `platform/app/lukas/lib/drawing-measurements.ts`
- Modify: `platform/app/lukas/lib/drawing-commands.ts`
- Modify: `platform/app/lukas/components/drawing-workspace.tsx`
- Modify: `platform/app/lukas/components/drawing-canvas.client.tsx`
- Modify: `platform/app/lukas/components/drawing-properties-panel.tsx`
- Modify: `platform/tests/drawing-workspace-commands.test.mjs`
- Modify: `platform/tests/drawing-workspace-shell.test.mjs`
- Modify: `platform/tests/drawing-workspace-measurements.test.mjs`
- Modify: `platform/tests/drawing-workspace-p4-tools.test.mjs`

**Interfaces:**
- Consumes: `DrawingObject`, `DrawingBlockInstance`, `DrawingPropertySchema`, `DrawingPropertyValue`, `DrawingCanvas`, `measureDrawingObject`, the current viewport transforms, and the existing pure `calibratePdf` helper. No calibration gesture exists yet; this task adds the narrow capture adapter.
- Produces: primitive measurements under the unchanged rule version `P4_MEASUREMENT_V1`.
- Produces: `DrawingEstimateSubjectRef = { kind:"object"; id:string } | { kind:"block_instance"; id:string }`, `drawingEstimateMetadataForSubject(subject, schemas, values)`, and `drawingEstimateQuantityForSubject(input, unit)`.
- Produces: estimate units `EA | m | m2`; `m3` is returned as an unsupported-unit review state, not silently calculated.
- Produces: `calibrateDrawingCanvasCommand(state, actorId, canvasId, { normalizedStart, normalizedEnd, knownLength, unit })` and a scale control that stores only canonical millimeters in the existing calibration JSON.

- [ ] **Step 1: Add failing primitive geometry tests**

Add exact assertions to `drawing-workspace-measurements.test.mjs`:

```js
assert.deepEqual(
  measureDrawingObject(object(ids.line, {
    type: "line",
    start: { x: 0, y: 0 },
    end: { x: 3000, y: 4000 },
  })),
  {
    ruleVersion: "P4_MEASUREMENT_V1",
    lengthMillimeters: "5000",
    areaSquareMillimeters: null,
    count: "1",
  },
);

assert.equal(
  measureDrawingObject(object(ids.closed, {
    type: "polyline",
    points: [
      { x: 0, y: 0 },
      { x: 2000, y: 0 },
      { x: 2000, y: 1000 },
      { x: 0, y: 1000 },
    ],
    closed: true,
  })).areaSquareMillimeters,
  "2000000",
);
for (const [closed, expected] of [[false, "7000"], [true, "12000"]]) {
  assert.equal(
    measureDrawingObject(object(closed ? ids.closedLength : ids.openLength, {
      type: "polyline",
      points: [{ x: 0, y: 0 }, { x: 3000, y: 0 }, { x: 3000, y: 4000 }],
      closed,
    })).lengthMillimeters,
    expected,
  );
}
assert.equal(
  measureDrawingObject(object(ids.rectangle, {
    type: "rectangle",
    origin: { x: 0, y: 0 },
    width: 2500,
    height: 1200,
    rotation: 37,
  })).areaSquareMillimeters,
  "3000000",
);
assert.equal(
  measureDrawingObject(object(ids.circle, {
    type: "circle",
    center: { x: 0, y: 0 },
    radius: 1000,
  })).areaSquareMillimeters,
  "3141592.65359",
);
```

Add classification tests proving exact Korean schema-name lookup for both an object and a block instance, one value per subject/schema, `5000 mm → 5 m`, `2000000 mm² → 2 m²`, and a classified object or block instance count `1 → 1 EA`. Add calibration tests proving `3 m` is converted to canonical `3000 mm`, an uncalibrated PDF subject is `missing_evidence`, and the same geometry is deterministically scaled after calibration.

- [ ] **Step 2: Run focused tests and verify primitive measurements are empty**

Run: `cd /Users/h/Documents/GoAgent/platform && node --test tests/drawing-workspace-measurements.test.mjs tests/drawing-workspace-estimate.test.mjs`

Expected: FAIL because line/polyline/rectangle/circle measurements and estimate helpers are missing.

- [ ] **Step 3: Extend the existing integer/rational measurement kernel**

Reuse `distanceMicromillimeters`, `boundaryPerimeterMicromillimeters`, `boundaryAreaMicroSquareMillimeters`, and the fixed PI rational:

```ts
case "line":
  measurement.lengthMillimeters = formatScaledInteger(
    distanceMicromillimeters(geometry.start, geometry.end),
  );
  break;
case "polyline":
  measurement.lengthMillimeters = formatScaledInteger(
    polylineLengthMicromillimeters(geometry.points, geometry.closed),
  );
  if (geometry.closed)
    measurement.areaSquareMillimeters = formatScaledInteger(
      boundaryAreaMicroSquareMillimeters(geometry.points),
    );
  break;
case "rectangle":
  measurement.lengthMillimeters = formatScaledInteger(
    2n * (toMicromillimeters(geometry.width) + toMicromillimeters(geometry.height)),
  );
  measurement.areaSquareMillimeters = formatScaledInteger(
    roundHalfAwayFromZero(
      toMicromillimeters(geometry.width) * toMicromillimeters(geometry.height),
      MICROMILLIMETERS_PER_MILLIMETER,
    ),
  );
  break;
case "circle":
  measurement.lengthMillimeters = circleLengthMillimeters(geometry.radius);
  measurement.areaSquareMillimeters = circleAreaSquareMillimeters(geometry.radius);
  break;
```

Implement `polylineLengthMicromillimeters` by summing `distanceMicromillimeters` for adjacent point pairs in order and adding exactly one last→first segment only when `closed` is true; never infer closure from equal coordinates. Implement circle helpers with `BigInt` and the existing PI numerator/denominator. Do not use `Math.PI`, locale formatting, or floating money arithmetic.

- [ ] **Step 4: Implement exact metadata and unit derivation**

Create `drawing-estimate.ts` with constants for the four schema names and this result contract:

```ts
export type DrawingEstimateSubjectRef =
  | { kind: "object"; id: string }
  | { kind: "block_instance"; id: string };

export type DrawingEstimateSubjectMetadata = {
  classification: string | null;
  trade: string | null;
  itemCode: string | null;
  evidenceKind: string | null;
  evidenceReason: string | null;
};

export type DrawingEstimateQuantity =
  | { status: "ready"; unit: "EA" | "m" | "m2"; quantity: string }
  | { status: "missing_evidence"; unit: string; reason: string }
  | { status: "review"; unit: string; reason: string };
```

Use schema IDs plus the subject discriminator to join property values; do not look inside object/block names or arbitrary JSON. When `evidenceKind === "가정값"`, require a trimmed `근거 사유` of 1–500 characters; missing reason is `missing_evidence`. When the kind changes away from `가정값`, the property UI clears the stale reason in the same user action. For `EA`, a classified active object or block instance contributes exactly one. For `m|m2`, block instances return a review state in M1 unless their expanded geometry already has an approved measurement rule; do not silently count them as length/area. Convert decimal strings by moving the decimal point (`mm/1000`, `mm²/1_000_000`) using the same exact string approach as `formatDrawingMeasurement`. Return `검토 필요: 길이 근거가 없습니다`, `검토 필요: 면적 근거가 없습니다`, or `검토 필요: 지원하지 않는 단위입니다` instead of zero.

- [ ] **Step 5: Add explicit PDF scale/unit calibration through the existing canvas operation**

Add `calibrateDrawingCanvasCommand` in `drawing-commands.ts`. It accepts the current canvas, two normalized PDF points, a positive decimal input, and input unit `mm|cm|m`; converts the input to millimeters with an exact decimal-string helper, calls existing `calibratePdf`, and emits one `put_canvas` action with `baseVersion:canvas.version`. The persisted calibration keeps the existing four-field schema and canonical millimeters; the chosen input unit is presentation-only and is not a second source of truth.

`DrawingScaleControl` renders these bounded states:

- source-free/model canvas: `기준 좌표 · 1 도면 단위 = 1 mm` and no fake PDF calibration;
- PDF without calibration: `축척 미확정`, `두 점 선택`, known length input, and `mm|cm|m` select;
- calibrated PDF: the two-point real length in canonical mm, `다시 보정`, and a warning that recalibration changes draft quantities;
- Viewer or non-draft revision: read-only status, no calibration mutation.

Add an optional `calibrationCapture` prop to `DrawingCanvas`: `{ active:boolean; onPoint(point: Point):void } | null`. When active and `DrawingCanvasBackground.kind === "pdf"`, Stage left-click converts the current screen point with the existing `screenToWorld`, rejects points outside the component background bounds `[0, background.width] × [0, background.height]`, normalizes as `{ x: world.x/background.width, y: world.y/background.height }`, calls `onPoint`, and returns before selection/tool dispatch. These dimensions belong to the existing render prop `DrawingCanvasBackground`; do not read width/height from the persisted background record or add a redundant canvas prop. Pan/zoom and Escape cancellation remain available; no object command is emitted. Export and unit-test a pure `drawingCanvasNormalizedBackgroundPoint` helper and add `drawing-workspace-p4-tools.test.mjs` cases for viewport transforms, bounds, first/second point order, and the fact that capture does not create a drawing object.

`DrawingScaleControl` owns only the transient zero/one/two captured points and calls `calibrateDrawingCanvasCommand` after a valid known length is submitted. The workspace passes this opt-in capture prop to `drawing-canvas.client.tsx` and submits the resulting command through the normal operation/outbox path. It does not write directly to a page/canvas table. In `drawing-estimate.ts`, transform PDF-backed geometry from canvas millimeters to normalized page coordinates and then to real millimeters using the stored calibration before applying the existing deterministic length/area kernel. Source-free/model geometry remains canonical millimeters. Uncalibrated PDF geometry returns the explicit `missing_evidence` union member, never an unscaled amount.

- [ ] **Step 6: Expose semantic object kinds in the existing property UI**

Extend the current applies-to list to exactly:

```ts
[
  "line", "polyline", "rectangle", "circle", "text", "dimension",
  "wall", "opening", "space", "area", "grid", "arc", "block_instance",
]
```

Keep the existing property schema/value operation path; do not create a second classification state.

In the existing property UI, show `근거 사유` only when `근거 상태` is `가정값`, enforce the bounded reason before submit, and write/clear both property values through one existing structure operation so undo/redo and collaboration observe a single user action. Add object and block-instance tests for a valid assumption, missing reason, and stale-reason clearing.

- [ ] **Step 7: Run focused and full drawing tests**

Run:

```bash
cd /Users/h/Documents/GoAgent/platform
node --test tests/drawing-workspace-measurements.test.mjs tests/drawing-workspace-estimate.test.mjs tests/drawing-workspace-commands.test.mjs tests/drawing-workspace-shell.test.mjs tests/drawing-workspace-p4-tools.test.mjs
npm run test:drawing-workspace
npm run typecheck
```

Expected: all tests PASS and existing semantic measurements remain byte-for-byte equal.

- [ ] **Step 8: Commit measurement, scale, and classification**

```bash
cd /Users/h/Documents/GoAgent
git add platform/app/lukas/lib/drawing-measurements.ts \
  platform/app/lukas/lib/drawing-estimate.ts \
  platform/app/lukas/lib/drawing-commands.ts \
  platform/app/lukas/components/drawing-scale-control.tsx \
  platform/app/lukas/components/drawing-workspace.tsx \
  platform/app/lukas/components/drawing-canvas.client.tsx \
  platform/app/lukas/components/drawing-properties-panel.tsx \
  platform/tests/drawing-workspace-measurements.test.mjs \
  platform/tests/drawing-workspace-commands.test.mjs \
  platform/tests/drawing-workspace-shell.test.mjs \
  platform/tests/drawing-workspace-p4-tools.test.mjs \
  platform/tests/drawing-workspace-estimate.test.mjs
git commit -m "feat: derive calibrated estimator quantities"
```

---

### Task 5: Derive the draft estimate from a bound draft BOQ

**Files:**
- Create: `platform/app/lukas/lib/drawing-estimate.server.ts`
- Modify: `platform/app/lukas/lib/drawing-estimate.ts`
- Modify: `platform/app/lukas/lib/drawing-workspace.server.ts`
- Modify: `platform/tests/drawing-workspace-estimate.test.mjs`
- Modify: `platform/tests/drawing-quantity-lineage-server.test.mjs`
- Modify: `platform/tests/verified-boq.test.mjs`

**Interfaces:**
- Consumes: Task 1 binding table, Task 4 metadata/quantity helpers, `calculateVerifiedBoqCore`, and current draft BOQ tables/resources/components.
- Produces: `bindDrawingEstimate(client, actorId, { projectId, drawingRevisionId, boqVersionId })`.
- Produces: `loadDrawingEstimateOptions(client, projectId): Promise<Array<{ id; title; versionNo; priceBookName }>>` for draft `VERIFIED-BOQ-1.1` versions only.
- Produces: `loadDrawingEstimateSummary(client, { actorId, projectId, workspace }): Promise<DrawingEstimateSummary>`; the authenticated route actor is explicit so approved-export authorization is never guessed from drawing state.
- Produces: rows with `state: "draft" | "assumption" | "needs_review" | "missing_evidence" | "confirmed"`; M1 returns `confirmed` only from an existing approved BOQ replay, never from draft geometry.

- [ ] **Step 1: Write failing pure and fake-client summary tests**

Add a fixture with three classified objects and one classified block instance:

- one 5 m wall mapped to BOQ line `W-001` with a rate;
- a second 2 m wall mapped to the same BOQ line `W-001` to prove item aggregation;
- one 2 m² rectangle mapped to `F-001` with a rate and `근거 상태:가정값`, `근거 사유:기존 마감 철거 전 현장 확인 필요`;
- one counted door block instance mapped to `D-001` without a rate component.

Assert the summary shape:

```js
assert.deepEqual(summary.rows.map((row) => ({
  itemCode: row.itemCode,
  quantity: row.quantity,
  unit: row.unit,
  amountKrw: row.amountKrw,
  state: row.state,
})), [
  { itemCode: "D-001", quantity: "1", unit: "EA", amountKrw: null, state: "missing_evidence" },
  { itemCode: "F-001", quantity: "2", unit: "m2", amountKrw: "60000", state: "assumption" },
  { itemCode: "W-001", quantity: "7", unit: "m", amountKrw: "70000", state: "draft" },
]);
assert.deepEqual(summary.rows.find((row) => row.itemCode === "W-001").subjectRefs, [
  { kind: "object", id: ids.wallFive },
  { kind: "object", id: ids.wallTwo },
]);
assert.equal(summary.directCostKrw, "130000");
assert.equal(summary.missingRateCount, 1);
```

Add tests for no binding (`status:"unbound"`), uncalibrated PDF evidence (`missing_evidence`), `가정값` with a present reason (`assumption` while retaining the preview amount), `가정값` without a reason (`missing_evidence` and null amount), `m3` (`needs_review`), cross-project binding rejection, Viewer insert rejection, and an approved replay whose rows are `confirmed` only when persisted drawing quantity/BOQ links and approved result/manifest hashes all match. A changed current object must not alter that approved summary.

Add a collision case where an object and block instance deliberately share the same UUID. Their preview mappings must remain distinct and aggregate once each because the source identity includes the subject discriminator.

- [ ] **Step 2: Run focused tests and verify the server adapter is missing**

Run: `cd /Users/h/Documents/GoAgent/platform && node --test tests/drawing-workspace-estimate.test.mjs tests/drawing-quantity-lineage-server.test.mjs tests/verified-boq.test.mjs`

Expected: FAIL because binding/summary functions do not exist.

- [ ] **Step 3: Implement the narrow binding API**

Validate IDs with Zod, confirm both rows are same-project drafts, confirm capability is `admin|editor`, then insert:

```ts
const { data, error } = await client
  .from("lukas_drawing_estimate_bindings")
  .insert({
    project_id: input.projectId,
    drawing_revision_id: input.drawingRevisionId,
    boq_version_id: input.boqVersionId,
    created_by: actorId,
  })
  .select("id,project_id,drawing_revision_id,boq_version_id,created_at")
  .single();
```

Map unique violations to `DrawingWorkspaceConflictError`. Do not add update/rebind. A changed choice creates a new drawing revision or new BOQ version.

- [ ] **Step 4: Load a bounded draft BOQ graph**

Query only the bound version and branch on its status. For a draft `VERIFIED-BOQ-1.1` version, load its price book, ordered lines, rate components, and ordered resources for the preview path. For an approved version, call the existing `loadApprovedVerifiedBoqExport(client, actorId, versionId)`, verify its project/version/result/manifest hashes, and join only persisted `lukas_drawing_quantity_links` plus `lukas_drawing_boq_links` from the same approved drawing snapshot; never recalculate an approved amount from current draft geometry. Reject every other status/engine combination with a bounded review state. Keep each select project-scoped and limit selectable draft options to 100 recent versions.

Return no binding as:

```ts
{
  status: "unbound",
  binding: null,
  boq: null,
  rows: [],
  directCostKrw: "0",
  missingRateCount: 0,
  reviewCount: 0,
}
```

- [ ] **Step 5: Build preview mappings from canonical drawing state**

For each active object or block instance with both `적산 분류` and `품목 코드`:

1. find the BOQ line by exact `item_code`;
2. derive quantity from the line unit using Task 4;
3. map layer → canvas to detect a PDF background without calibration;
4. hash canonical `{ revisionId, revisionVersion, subjectRef, canonicalSubject, metadata, quantity, calibration }` with SHA-256;
5. build one `VerifiedBoqCalculationMapping` per ready subject with `sourceKind:"drawing"`, `sourceId:` equal to `object:<uuid>` or `block_instance:<uuid>`, factor `1`, and no element IDs.

Call the existing engine:

```ts
const calculated = calculateVerifiedBoqCore(
  {
    versionId: version.id,
    calculationPolicy: version.calculation_policy,
    quantityScale: version.quantity_scale,
    lines,
    mappings,
    exclusions: [],
    resources,
    components,
  },
  true,
);
```

This call is preview-only. Do not create `DrawingQuantitySource`, `lukas_drawing_quantity_links`, snapshot approvals, or stored BOQ results.

- [ ] **Step 6: Normalize result and evidence states**

Define `DrawingEstimateSummaryRow` with sorted `subjectRefs`, per-subject evidence hashes/statuses/reasons, classification, item code/name, aggregated quantity/unit, total unit rate, amount, state, and reason. Emit one row per BOQ item code, not one row per object: the existing calculation engine already sums all mappings targeting the same BOQ line. Also emit a bounded synthetic group for a classified item code missing from the BOQ so that it can be reviewed. Sort rows bytewise by item code and refs by `(kind,id)`. Apply states in this order:

1. uncalibrated source or missing evidence kind → `missing_evidence` and `amountKrw:null`;
2. `가정값` without a trimmed reason → `missing_evidence` and `amountKrw:null`;
3. missing BOQ line or rate component → `missing_evidence` and `amountKrw:null`;
4. unsupported unit or engine review → `needs_review` and `amountKrw:null`;
5. otherwise reproducible row containing at least one `가정값` subject → `assumption`, preserving the calculated preview amount and sorted reasons;
6. other reproducible draft line → `draft`;
7. a separately loaded approved BOQ replay tied through existing quantity/BOQ links overrides draft states with `confirmed`.

If any subject in a group has missing calibration/evidence or an unsupported quantity, keep the whole group reviewable with the affected refs in `evidence[]` and do not show a partial amount as final. Never turn a missing rate into numeric zero.

- [ ] **Step 7: Run estimate, lineage, BOQ, and type tests**

Run:

```bash
cd /Users/h/Documents/GoAgent/platform
node --test tests/drawing-workspace-estimate.test.mjs tests/drawing-quantity-lineage-server.test.mjs tests/verified-boq.test.mjs
npm run typecheck
```

Expected: all tests PASS and existing approved export hashes are unchanged.

- [ ] **Step 8: Commit the server estimate adapter**

```bash
cd /Users/h/Documents/GoAgent
git add platform/app/lukas/lib/drawing-estimate.ts \
  platform/app/lukas/lib/drawing-estimate.server.ts \
  platform/app/lukas/lib/drawing-workspace.server.ts \
  platform/tests/drawing-workspace-estimate.test.mjs \
  platform/tests/drawing-quantity-lineage-server.test.mjs \
  platform/tests/verified-boq.test.mjs
git commit -m "feat: derive draft BOQ results for drawing revisions"
```

---

### Task 6: Add the canvas result rail and reuse company rate-book import

**Files:**
- Create: `platform/app/lukas/components/drawing-estimate-result-rail.tsx`
- Modify: `platform/app/lukas/components/drawing-workspace.tsx`
- Modify: `platform/app/lukas/screens/drawing-workspace.tsx`
- Modify: `platform/app/lukas/screens/verified-boq.tsx`
- Modify: `platform/tests/drawing-workspace-shell.test.mjs`
- Modify: `platform/tests/drawing-workspace-route.test.mjs`
- Modify: `platform/tests/verified-boq.test.mjs`
- Modify: `platform/tests/drawing-workspace-estimate.test.mjs`

**Interfaces:**
- Consumes: Task 5 summary/options/bind functions and existing `/projects/:projectId/boq` import/version/export UI.
- Produces: action intent `bind_drawing_estimate` with `drawing_revision_id` and `boq_version_id`.
- Produces: inspector mode `result | object`, default `result` for M1 workspaces.
- Produces: validated BOQ `returnTo` limited to the current project workspace path.

- [ ] **Step 1: Write failing shell and BOQ return tests**

Assert the workspace source contains `DrawingEstimateResultRail`, `결과`, `객체`, `초안`, `가정값`, `검토 필요`, and `근거 누락`. Assert the BOQ screen rejects `returnTo=https://example.com` and accepts exactly `/projects/<same-project>/workspaces/<uuid>`.

Add a component-level pure rendering fixture whose rows include one draft and one missing-rate row; assert accessible names `총 예상 금액`, `단가 누락 1건`, and `BOQ 상세 열기`.

- [ ] **Step 2: Run shell/BOQ tests and verify the rail is missing**

Run: `cd /Users/h/Documents/GoAgent/platform && node --test tests/drawing-workspace-shell.test.mjs tests/drawing-workspace-route.test.mjs tests/verified-boq.test.mjs`

Expected: FAIL because the result rail and return-path parser are absent.

- [ ] **Step 3: Load summary/options with the workspace**

In the canonical loader, after the workspace graph resolves:

```ts
const [estimateSummary, estimateOptions] = await Promise.all([
  loadDrawingEstimateSummary(client, {
    actorId: user.id,
    projectId: project.id,
    workspace,
  }),
  loadDrawingEstimateOptions(client, project.id),
]);
```

In the action, parse `bind_drawing_estimate`, require `admin|editor`, require the current draft revision ID, call `bindDrawingEstimate`, and return a bounded 409 on an existing binding.

- [ ] **Step 4: Build the focused result rail**

`DrawingEstimateResultRail` renders:

- summary header with `초안` or `확정` badge;
- row badges include `가정값` with its persisted reason, distinct from `초안`, `검토 필요`, and `근거 누락`;
- direct cost in Korean won using `Intl.NumberFormat("ko-KR")` only for display;
- one row per item with classification, quantity/unit, rate, amount, evidence state, and reason;
- visible counts for rate/evidence/review gaps;
- a native select to bind one unbound draft BOQ;
- `단가표 가져오기` and `BOQ 상세 열기` links;
- approved CSV/XLSX/manifest links only when the summary exposes an approved BOQ version.

The component receives server strings and never multiplies quantity by rate.

- [ ] **Step 5: Integrate result/object tabs without replacing the existing inspector**

At the top of the current right inspector, add:

```tsx
<div aria-label="검사기 보기" role="tablist">
  <button aria-selected={inspectorMode === "result"} role="tab">결과</button>
  <button aria-selected={inspectorMode === "object"} role="tab">객체</button>
</div>
```

Render the new rail in the result panel and the complete existing inspector in the object panel. Keep selected object, document graph, and BOQ result in their existing authorities; `inspectorMode` is local UI state only.

- [ ] **Step 6: Reuse the current rate-book page with a safe return path**

Add:

```ts
export function parseVerifiedBoqReturnTo(projectId: string, value: string | null) {
  if (!value) return null;
  const match = value.match(/^\/projects\/([0-9a-f-]{36})\/workspaces\/([0-9a-f-]{36})$/i);
  if (!match || match[1] !== projectId) throw new Response("돌아갈 작업실 주소가 올바르지 않습니다.", { status: 400 });
  return value;
}
```

Preserve `returnTo` through price-book upload/import and BOQ-version forms. Show `작업실로 돌아가기` after a successful import/version creation. Continue using `parseVerifiedBoqPriceBook`, immutable file/SHA revalidation, current tables, and current exact calculation; do not extract or duplicate an XLSX engine.

- [ ] **Step 7: Run shell, BOQ, route, accessibility, and type checks**

Run:

```bash
cd /Users/h/Documents/GoAgent/platform
node --test tests/drawing-workspace-shell.test.mjs tests/drawing-workspace-route.test.mjs tests/verified-boq.test.mjs tests/drawing-workspace-estimate.test.mjs
npm run typecheck
```

Expected: all tests PASS, result rows contain no client calculation code, and no package dependency changes.

- [ ] **Step 8: Commit the integrated result rail**

```bash
cd /Users/h/Documents/GoAgent
git add platform/app/lukas/components/drawing-estimate-result-rail.tsx \
  platform/app/lukas/components/drawing-workspace.tsx \
  platform/app/lukas/screens/drawing-workspace.tsx \
  platform/app/lukas/screens/verified-boq.tsx \
  platform/tests/drawing-workspace-shell.test.mjs \
  platform/tests/drawing-workspace-route.test.mjs \
  platform/tests/verified-boq.test.mjs \
  platform/tests/drawing-workspace-estimate.test.mjs
git commit -m "feat: add evidence linked estimate result rail"
```

---

### Task 7: Preserve source-free comments, authorization, export, and bounded recovery

**Files:**
- Modify: `platform/app/lukas/screens/drawing-workspace.tsx`
- Modify: `platform/app/lukas/lib/drawing-quantity-lineage.server.ts`
- Modify: `platform/app/lukas/components/drawing-workspace.tsx`
- Modify: `platform/tests/drawing-workspace-route.test.mjs`
- Modify: `platform/tests/drawing-workspace-server.test.mjs`
- Modify: `platform/tests/drawing-workspace-shell.test.mjs`
- Modify: `platform/tests/drawing-quantity-lineage-server.test.mjs`

**Interfaces:**
- Consumes: canonical workspace ID, existing object issue links, existing capability calculation, existing exporter/audit, and approved lineage.
- Produces: source-free object issue linking, document-scoped drawing export, and panel-local renderer failures.
- Produces: expected action response union `{ ok:false; kind; error; fieldErrors?; requestId? }` for validation/conflict/retryable/rejected failures.

- [ ] **Step 1: Add source-free authorization, lineage, and export regression tests**

Add fake-client tests proving:

- a source-free document may load object issue links without `loadDrawingRoom`;
- `link_object_issue` succeeds for Editor and fails for Viewer; Commenter may add a comment to an already linked issue through the existing comment authority but does not gain the editor-only object-link RPC;
- Viewer cannot bind an estimate or apply an object operation;
- export succeeds when revision belongs to `workspaceId` even if `source_file_id` is null;
- export fails when revision belongs to another document/project;
- an approved source-free BOQ link resolves to the exact canonical document/object without an evidence-file query, and its return location retains the exact BOQ version/line;
- an approved revision mutation returns the existing new-revision guidance;
- a source renderer error leaves the inspector/result data present.

- [ ] **Step 2: Run focused tests and verify source-free link/navigation assumptions fail**

Run: `cd /Users/h/Documents/GoAgent/platform && node --test tests/drawing-workspace-route.test.mjs tests/drawing-workspace-server.test.mjs tests/drawing-workspace-shell.test.mjs tests/drawing-quantity-lineage-server.test.mjs`

Expected: FAIL on source-free object-link or reverse-navigation assumptions; Task 2's canonical source-free export assertions remain green.

- [ ] **Step 3: Re-verify the canonical export authority from Task 2**

Parse `params.workspaceId`, then query revision and document together:

```ts
const { data: revision } = await scopeClient
  .from("lukas_drawing_revisions")
  .select("id,document_id,status")
  .eq("id", revisionId)
  .eq("document_id", workspaceId)
  .eq("project_id", projectId)
  .maybeSingle();
if (!revision)
  throw new Response("내보내기 도면 범위를 찾을 수 없습니다.", { status: 404 });
```

This query shape was implemented in Task 2 so canonical route typegen could pass before the old route was removed. Re-run it here as a security regression; do not add another export adapter. Keep content type/size/request-ID validation and `recordProjectExport` unchanged. Do not update or require any source-file row.

- [ ] **Step 4: Remove fake file requirements from object issue and lineage entry**

For object issue links, validate object → revision → document → project and use the existing link RPC. Load file-room comments only when a source file exists. Do not relax `lukas_drawing_issue_anchors.file_id`; do not invent a file ID.

Change reverse navigation to return canonical `{ documentId, objectId, revisionId, boqVersionId, boqLineId }` first. Include `evidenceFileId` only when an object source actually has one; the workspace screen must not reject an otherwise exact approved BOQ link merely because a source-free object has no evidence file. Existing approved quantity/BOQ checks still require their frozen snapshot/result hashes. Generate a same-project validated BOQ return path so the user can navigate back to the exact version and line.

- [ ] **Step 5: Bound expected errors at route/action/panel level**

Map:

- Zod validation → 400 with field/row Korean message;
- `DrawingWorkspaceConflictError` → 409 with reload/compare instruction;
- `DrawingWorkspaceRetryableError` → 503 with the same client request ID retained;
- `DrawingWorkspaceRejectedError` → 403 or 409 according to capability/revision state;
- source signed URL/renderer failure → `sourceBundle.error` rendered inside the source panel;
- unknown error → request ID plus generic message, with details logged server-side only.

Keep canvas, object graph, comments, and result rail mounted when PDF/IFC rendering fails.

- [ ] **Step 6: Run authorization, export, outbox, source, and type regressions**

Run:

```bash
cd /Users/h/Documents/GoAgent/platform
node --test tests/drawing-workspace-route.test.mjs tests/drawing-workspace-server.test.mjs tests/drawing-workspace-shell.test.mjs tests/drawing-quantity-lineage-server.test.mjs tests/drawing-workspace-outbox.test.mjs tests/drawing-workspace-p5-server.test.mjs tests/drawing-workspace-p5-view.test.mjs
npm run typecheck
```

Expected: all tests PASS; source-free workflows no longer reach the global error boundary for expected conditions.

- [ ] **Step 7: Commit recovery and authority integration**

```bash
cd /Users/h/Documents/GoAgent
git add platform/app/lukas/screens/drawing-workspace.tsx \
  platform/app/lukas/lib/drawing-quantity-lineage.server.ts \
  platform/app/lukas/components/drawing-workspace.tsx \
  platform/tests/drawing-workspace-route.test.mjs \
  platform/tests/drawing-workspace-server.test.mjs \
  platform/tests/drawing-workspace-shell.test.mjs \
  platform/tests/drawing-quantity-lineage-server.test.mjs
git commit -m "fix: preserve workspace authority without a source file"
```

---

### Task 8: Prove the full M1 browser journey and legacy regressions

**Files:**
- Create: `platform/e2e/drawing-workspace-m1-estimator.spec.ts`
- Create: `platform/e2e/utils/drawing-estimator-fixture.ts`
- Create: `platform/scripts/run-drawing-workspace-m1-e2e.mjs`
- Create: `platform/playwright.m1.config.ts`
- Create: `docs/superpowers/evidence/2026-08-31-universal-workspace-m1.md`
- Modify: `platform/package.json`
- Modify: `platform/e2e/drawing-workspace-local-p0-p2.spec.ts` only if selectors changed
- Modify: `platform/e2e/drawing-workspace-local-multiplayer.spec.ts` only if canonical URLs changed

**Interfaces:**
- Consumes: all Tasks 1–7 and `createDrawingFixture`, `authenticateContext`, `authenticateApiClient`, `readSourceEvidence`, and `seedDrawingP2PerformanceFixture` from `platform/e2e/utils/drawing-collaboration-fixture.ts`. It deliberately does not call the normal retention cleanup after creating protected approvals/library imports.
- Produces: `createDrawingEstimatorFixture(): Promise<DrawingEstimatorFixture>` with a same-organization `emptyProjectId` containing no file/document rows at first use, `rateBookFileId`, an explicitly non-parseable `rvtImmutabilitySentinelFileId`, and pinned source evidence.
- Produces: `seedEstimatorBoqStructure(fixture, versionId)` which inserts three BOQ lines/components after the UI has created the version and imported resources.
- Produces: `npm run test:e2e:drawing-workspace-m1:local`.
- Produces: release evidence with explicit `PASS`, `NOT MET`, or `UNEXECUTED` for every M1 gate.

- [ ] **Step 1: Add the M1 Playwright script**

Add this M1 script to `platform/package.json`:

```json
"test:e2e:drawing-workspace-m1:local": "node scripts/run-drawing-workspace-m1-e2e.mjs"
```

Do not edit dependencies or the lockfile. The harness first creates an exact `mkdtemp`-owned Supabase work directory, copies only `supabase/config.toml`, migrations, and required seed/config assets, assigns a unique local project ID and free local port block, starts that disposable stack, and reads its URL/anon/service/database values from `supabase status -o json`. Only after those values exist, it runs `npm run build` with the exact disposable `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `VITE_SUPABASE_URL`, and `VITE_SUPABASE_ANON_KEY`, plus `VITE_DRAWING_COLLABORATION_URL=ws://127.0.0.1:12349`; this is required because the browser bundle consumes the `VITE_*` values at build time. It also runs `npm run build:collaboration` with the matching disposable server variables, then launches Playwright with `M1_E2E_DISPOSABLE=1`, `M1_REAL_POSTGRES_DATABASE_URL`, and those same exact values. In `finally`, it stops only that generated project with `supabase stop --no-backup`, verifies its project ID/path, and removes only the `mkdtemp` directory. It must refuse a non-loopback Supabase URL, an existing repository `platform/supabase` workdir, or a missing disposable marker. This is required because a successful M1 journey creates protected approvals and append-only library imports that the product retention API correctly refuses to purge; weakening production retention for test cleanup is forbidden.

Create `playwright.m1.config.ts` by extending `playwright.config.ts`, but force `use.baseURL="http://127.0.0.1:4000"`, ignore any remote `E2E_BASE_URL`, replace `webServer` with two local servers, set `reuseExistingServer:false`, and fail configuration early unless `M1_E2E_DISPOSABLE=1`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, and `M1_REAL_POSTGRES_DATABASE_URL` are concrete loopback/disposable values. The runner fails before writes if ports 4000 or 12349 are already occupied. Server one runs `node collaboration/dist/collaboration/src/server.js` and waits on `http://127.0.0.1:12349/healthz` with `PORT=12349`, exact app origin, a test-only instance ID, distinct 32+ character internal/freeze secrets, `SUPABASE_URL`, and `COLLABORATION_DATABASE_URL=M1_REAL_POSTGRES_DATABASE_URL`. Server two runs the already-built app with exact command `NODE_ENV=production HOST=127.0.0.1 PORT=4000 npm run start`, plus `VITE_DRAWING_COLLABORATION_URL=ws://127.0.0.1:12349`, `COLLABORATION_INTERNAL_URL=http://127.0.0.1:12349`, matching secrets, and the disposable Supabase variables. Do not use `npm run dev`, import the P4 preview authority, or visit `/workspace-preview/*` anywhere in M1 proof. Performance timings are collected only from this production build/serve path.

- [ ] **Step 2: Create the estimator fixture adapter**

Create `drawing-estimator-fixture.ts`. Build this exact CSV as UTF-8 bytes and SHA-256 it:

```ts
const RATE_BOOK_CSV = [
  "resource_code,resource_type,resource_name,specification,unit,unit_price_krw",
  "W-001,material,경량벽체,,m,10000",
  "F-001,material,바닥마감,,m2,30000",
  "D-001,material,문 세트,,EA,150000",
].join("\n");
```

`createDrawingEstimatorFixture` calls `createDrawingFixture()`, uploads these bytes to a new owner/project-scoped `lukas-qto` storage path with `upsert:false`, inserts one immutable `lukas_qto_files` row with kind `estimate`, appends the path to `fixture.storagePaths`, and returns the file ID. `seedEstimatorBoqStructure` queries the UI-created draft version and its price-book resources, then inserts one section, three lines (`W-001 m`, `F-001 m2`, `D-001 EA`), and three rate components with coefficient `1`. It must not insert price-book resources; that is the browser import behavior under test.

Before uploading any added evidence, create a second same-organization project and grant the fixture Editor/Reviewer/Approver/Viewer their matching roles. Return it as `emptyProjectId` only after asserting through the admin client that it has zero `lukas_qto_files` and zero `lukas_drawing_documents`. The first browser case uses this project immediately; do not seed or upload anything into it before the blank workspace reaches its canonical URL.

Do not change the shared collaboration fixture, whose historical `approver` user is still used as an issue reviewer by existing suites. Inside the disposable M1 adapter only, call the supported `lukas_qto_set_project_member` authority to change that user's role on the M1 project to exact `approver`, verify `fixture.reviewer` remains `reviewer`, and grant the same exact roles on `emptyProjectId`. This isolates M1's real three-actor drawing approval without changing shared issue-review contracts.

Also upload deterministic bytes `1HK-M1-RVT-IMMUTABILITY-SENTINEL-v1\n` as an immutable `kind:'other'` file named `source-integrity-only.rvt`, and return its file ID/evidence. This sentinel proves storage-byte non-mutation only and must be labeled as non-parseable in evidence; it is not a claim of RVT import support. The separate `/download/revit-2025` regression proves the existing Revit add-in artifact still downloads.

- [ ] **Step 3: Write the failing production-shaped journey**

Use the existing fixture provisioning and exact accessible labels. Initialization is allowed only inside the disposable runner:

```ts
import { expect, test, type Page } from "@playwright/test";
import {
  authenticateContext,
} from "./utils/drawing-collaboration-fixture";
import {
  createDrawingEstimatorFixture,
  seedEstimatorBoqStructure,
  type DrawingEstimatorFixture,
} from "./utils/drawing-estimator-fixture";

const baseUrl = "http://127.0.0.1:4000";
let fixture: DrawingEstimatorFixture;

test.beforeAll(async () => {
  if (process.env.M1_E2E_DISPOSABLE !== "1")
    throw new Error("M1 E2E requires the disposable Supabase runner");
  fixture = await createDrawingEstimatorFixture();
});
```

The spec never invokes production retention cleanup after protected approvals/imports. Browser contexts are closed in `finally`; `run-drawing-workspace-m1-e2e.mjs` owns database, Auth, and Storage disposal after Playwright exits. A direct Playwright invocation fails before writing data.

Put the suite in `test.describe.serial`. Its first case authenticates the Editor at `/projects/${fixture.emptyProjectId}`, asserts the drawing/file empty state and primary `새 작업실` link (not an upload redirect), creates `빈 작업실`, and asserts the canonical workspace loads with `원본 없음 · 빈 캔버스`. Query the disposable database immediately before the click and again after creation to prove file rows remain zero while exactly one source-null drawing document now exists. Only then run the full estimator case on `fixture.projectId`.

The test must perform this order:

```ts
test("estimator creates an evidence-linked draft without requiring a source", async ({ browser }) => {
  const context = await browser.newContext();
  const page = await authenticateContext(
    fixture,
    context,
    fixture.editor,
    baseUrl,
    `/projects/${fixture.projectId}`,
  );
  await page.getByRole("link", { name: "새 작업실" }).click();
  await page.getByRole("heading", { name: "새 작업실" }).waitFor();
  await page.getByLabel("도면 제목").fill("A동 실내 적산");
  await page.getByRole("button", { name: "빈 작업실 만들기" }).click();
  await expect(page).toHaveURL(/\/workspaces\/[0-9a-f-]{36}$/);
  await expect(page.getByText("기준 좌표 · 1 도면 단위 = 1 mm")).toBeVisible();
  await page.getByRole("button", { name: "선 도구" }).click();
  await drawLine(page, { x1: 240, y1: 240, x2: 540, y2: 240 });
  await classifySelectedObject(page, {
    classification: "벽",
    trade: "금속",
    itemCode: "W-001",
    evidenceKind: "현장 실측",
  });
  await openResultRail(page);
  await importCompanyRatesAndCreateBoq(page, fixture);
  const versionId = new URL(page.url()).searchParams.get("version");
  if (!versionId) throw new Error("Draft BOQ version was not returned");
  await seedEstimatorBoqStructure(fixture, versionId);
  await page.getByRole("link", { name: "작업실로 돌아가기" }).click();
  await bindDraftBoq(page, versionId);
  await expect(page.getByText("초안", { exact: true })).toBeVisible();
  await expect(page.getByLabel("총 예상 금액")).not.toHaveText("₩0");
  await page.reload();
  await expect(page.getByText("W-001")).toBeVisible();
  await context.close();
});
```

Define the helpers in the same spec. The canvas helper uses the current accessible surface and pointer events:

```ts
async function drawLine(page: Page, input: { x1: number; y1: number; x2: number; y2: number }) {
  const surface = page.getByLabel(/도면 화면/);
  const box = await surface.boundingBox();
  if (!box) throw new Error("Drawing surface has no layout box");
  await page.mouse.click(box.x + input.x1, box.y + input.y1);
  await page.mouse.click(box.x + input.x2, box.y + input.y2);
}

async function classifySelectedObject(page: Page, value: {
  classification: string;
  trade: string;
  itemCode: string;
  evidenceKind: string;
  evidenceReason?: string;
}) {
  await page.getByRole("tab", { name: "객체" }).click();
  const inspector = page.getByRole("complementary", { name: "속성 검사기" });
  await inspector.getByLabel("적산 분류").selectOption({ label: value.classification });
  await inspector.getByLabel("공종").fill(value.trade);
  await inspector.getByLabel("품목 코드").fill(value.itemCode);
  await inspector.getByLabel("근거 상태").selectOption({ label: value.evidenceKind });
  if (value.evidenceKind === "가정값")
    await inspector.getByLabel("근거 사유").fill(value.evidenceReason ?? "");
  await inspector.getByRole("button", { name: "사용자 속성 적용" }).click();
}

async function openResultRail(page: Page) {
  await page.getByRole("tab", { name: "결과" }).click();
  await expect(page.getByRole("region", { name: "견적 결과" })).toBeVisible();
}

async function bindDraftBoq(page: Page, versionId: string) {
  await page.getByLabel("연결할 내역 버전").selectOption(versionId);
  await page.getByRole("button", { name: "내역 연결" }).click();
}
```

Define the rate import helper with the current BOQ labels:

```ts
async function importCompanyRatesAndCreateBoq(
  page: Page,
  fixture: DrawingEstimatorFixture,
) {
  await page.getByRole("link", { name: "단가표 가져오기" }).click();
  await page.getByLabel("단가표 이름").fill("1HK E2E 회사 단가");
  await page.getByLabel("단가표 버전").fill("2026-08");
  await page.getByLabel("기준일").fill("2026-08-31");
  await page.getByLabel("사용 근거").selectOption("customer_owned");
  await page.getByLabel("단가표 원본 파일").selectOption(fixture.rateBookFileId);
  await page.getByLabel("사용권 메모").fill("E2E 고객 보유 단가표");
  await page.getByRole("button", { name: "단가표 근거 등록" }).click();
  await page.getByRole("button", { name: "원본에서 일괄 가져오기" }).click();
  for (const code of ["W-001", "F-001", "D-001"])
    await expect(page.getByText(new RegExp(`^${code} ·`))).toBeVisible();
  await page.getByLabel("내역 제목").fill("A동 실내 적산");
  await page.getByLabel("계산 방식").selectOption("general_half_away");
  await page.getByLabel("수량 소수 자릿수").fill("6");
  await page.getByRole("button", { name: "새 버전" }).click();
  await expect(page).toHaveURL(/\?version=[0-9a-f-]{36}/);
}
```

Task 6 must preserve `returnTo` in every form redirect so the final `작업실로 돌아가기` link targets the canonical document path. Use role/label waits and no arbitrary `waitForTimeout`.

- [ ] **Step 4: Cover line, area, count, refresh/relogin, comments, roles, approval, and exports**

In the same test fixture:

- create and classify a rectangle as `F-001` with `가정값` plus a visible reason to prove area/assumption state, and a separate object as `D-001` to prove count;
- verify the result rail shows a non-zero line quantity in `m`, the rectangle area in `m2`, and `1 EA` before checking amounts;
- create a second starter workspace, retain its ID as `collaborationWorkspaceId`, keep its revision in `draft`, and assert its preset layers, five schemas, empty schema-valid `기본 내역`, organization library version, and single import-ledger row;
- create a PDF workspace, choose two canvas points, enter `5` with unit `m`, save calibration, draw a matching reference line, and assert `5 m`; repeat the same PDF creation action request and prove no duplicate document/scaffold operation. The separate starter retry proves a single import-ledger row;
- reload, close the Editor browser context, then create a fresh context and authenticate the same Editor with `authenticateContext`; prove all three estimate rows and the binding persist after logout/relogin rather than cookie reuse;
- link an existing issue to the selected object;
- open a second browser context as Viewer and assert drawing/binding/rate controls are absent or disabled;
- request drawing review as Editor, record the intermediate `reviewed` decision in a fresh Reviewer context, then record final `approved` in a distinct Approver context; assert the three actors are different and the status sequence is exact;
- reopen the approved workspace as Editor, select each classified object, click the existing `확정 근거 만들기` control for length/area/count, and assert the persisted snapshot hashes match the approved drawing snapshot;
- open the bound draft BOQ, use `Drawing 근거를 연결할 품목` and `연결` to map each confirmed quantity to its matching line with allocation `1`, request BOQ review as its maker, and approve it with the existing VERIFIED-BOQ Reviewer authority. M1 does not silently change that separate domain's current reviewer-only approval contract; any later Reviewer→Approver BOQ split requires its own migration and acceptance plan;
- download CSV, XLSX, and manifest;
- parse the manifest and assert object ID, snapshot SHA, price-book SHA, result SHA, quantity, and amount;
- from the approved BOQ line, follow its `Drawing 근거` link and assert the canonical workspace opens the exact object/revision with that object selected; use `내역으로 돌아가기` and assert the same BOQ version and line are focused, not merely the project BOQ default;
- hash source PDF/IFC, the explicitly labeled RVT immutability sentinel, and price-book storage bytes before and after and assert equality;
- visit the old file route and assert a canonical workspace redirect;
- visit existing IFC/PDF review, BOQ, and Revit download paths.

- [ ] **Step 5: Add canonical-route offline/reconnect and two-browser visibility**

Use the real fixture and Hocuspocus service started by `playwright.m1.config.ts`; do not reuse the preview test's in-memory server or preview-only snapshot labels. Open the retained draft `/projects/:projectId/workspaces/:collaborationWorkspaceId` in owner and Editor contexts—never the already approved estimator workspace—and assert:

- both pages expose `공동 편집 상태: connected` and two distinct participants;
- context A creates/moves a uniquely named object and context B sees that name/geometry through the production layer/object UI;
- context A goes offline, creates one uniquely named operation into IndexedDB outbox, reconnects, waits for the one acknowledged send, then reloads and proves both production object lists show it exactly once. Do not navigate/reload while offline because the SSR shell has no service worker authority;
- both contexts keep revision-scoped Yjs/outbox keys under the canonical workspace URL.

If the real collaboration database/service cannot run, this step is `UNEXECUTED` and M1 is not complete; the preview multiplayer test remains only a regression, not authority for this gate.

- [ ] **Step 6: Run the new E2E test and fix only deterministic failures**

Run:

```bash
cd /Users/h/Documents/GoAgent/platform
npm run test:e2e:drawing-workspace-m1:local
```

Expected: PASS with one worker. Replace brittle selectors with roles/labels; do not add sleeps.

- [ ] **Step 7: Run the complete M1 and legacy verification matrix**

Run:

```bash
cd /Users/h/Documents/GoAgent/platform
npm run typecheck
npm run test:drawing-workspace
npm run test:e2e:drawing-workspace-p0-p2:local
npm run test:e2e:drawing-workspace-p3:local
npm run test:e2e:drawing-workspace-p4:local
npm run test:e2e:drawing-workspace-p5:local
npm run test:e2e:drawing-workspace-p6:local
npm run test:e2e:drawing-workspace-p7:release
npm run test:e2e:drawing-workspace-p7:performance
```

In the M1 spec, add a serial canonical-route performance case using the existing `seedDrawingP2PerformanceFixture` to persist and load 10,000 objects. Measure navigation start to visible interactive canvas/result tabs, then a fixed pan/zoom/select sequence with `requestAnimationFrame` timestamps. Attach raw JSON containing reference hardware/browser, sample count, p50/p95 frame time, calculated FPS, and first-usable milliseconds. The legacy P7 performance command remains regression evidence only; it cannot substitute for this canonical M1 measurement.

Expected: all runnable suites PASS. A hosted-only check that lacks authority is `UNEXECUTED`, never inferred PASS from a mock/local build. Record first usable above 2.5 s or interaction below 60 fps as `NOT MET`, with raw evidence; do not convert the target into a passing assertion by widening it.

- [ ] **Step 8: Verify in the browser at desktop and compact widths**

Use the browser verification skill against the local production-shaped server. Check:

- 1440×900: left rail, canvas, result rail, and bottom tools do not overlap;
- 1024×768: result/object inspector remains reachable and canvas is usable;
- blank, starter, and PDF start cards have clear focus order and labels;
- a PDF renderer failure leaves drawing/result controls usable;
- no console error, hydration mismatch, unhandled rejection, or global `Unexpected error` appears.

Capture screenshots and relevant console/network evidence paths in the evidence document.

- [ ] **Step 9: Record release evidence without overstating results**

Create `docs/superpowers/evidence/2026-08-31-universal-workspace-m1.md` with these exact sections:

```markdown
# 1HK Universal Workspace M1 Release Evidence

## Environment
## Source and migration identity
## Automated test matrix
## M1 acceptance conditions 1–16
## Source SHA-256 before/after
## RLS and role counterexamples
## Offline and canonical two-browser evidence
## Performance targets
## Visual inspection
## Known non-M1 follow-ups
```

For every command include UTC/KST timestamp, commit SHA, exit code, artifact path, and one status: `PASS`, `NOT MET`, or `UNEXECUTED`. Record the canonical 10,000-object frame rate and first-usable timing from measured evidence; label the legacy preview/P7 measurements separately and do not convert a target into a claim.

- [ ] **Step 10: Run a ponytail and React review before final commit**

Use `ponytail:ponytail-review` on the M1 diff and `vercel:react-best-practices` on modified TSX files. Delete duplicated loaders, client money calculations, dead compatibility state, and unnecessary wrappers that the reviews identify. Re-run the affected focused tests after each deletion.

- [ ] **Step 11: Commit the M1 acceptance proof**

```bash
cd /Users/h/Documents/GoAgent
git add platform/package.json \
  platform/scripts/run-drawing-workspace-m1-e2e.mjs \
  platform/playwright.m1.config.ts \
  platform/e2e/drawing-workspace-m1-estimator.spec.ts \
  platform/e2e/utils/drawing-estimator-fixture.ts \
  platform/e2e/drawing-workspace-local-p0-p2.spec.ts \
  platform/e2e/drawing-workspace-local-multiplayer.spec.ts \
  docs/superpowers/evidence/2026-08-31-universal-workspace-m1.md
git commit -m "test: prove universal estimator workspace M1"
```

Omit either existing E2E file from `git add` when it did not need a selector/URL change.

---

## M1 Completion Gate and M2–M5 Handoff

M1 is complete only when all 16 acceptance conditions in the spec have implementation, automated proof, and production-shaped evidence. The final implementation handoff must state which performance or hosted checks are `NOT MET` or `UNEXECUTED`; it must not call M1 complete while a required safe local fix remains.

After M1 passes, write separate plans in this order so each yields working software:

1. M2 editor/company-standard UX and evidence-triggered organization price-book registry.
2. M3 canonical-route Yjs/Hocuspocus operational hardening, Awareness, offline merge, and role verification.
3. M4 PDF/IFC/split/revision comparison plus customer-fixture DXF import.
4. M5 approved BOQ → material/PO/receipt/carbon lineage and organization retention/productization.

Do not install Zustand in M2 unless measurements show the current external store causes duplicated subscriptions, untestable cross-panel logic, or material prop drilling. Do not add Redis/pub-sub in M3 until one Hocuspocus instance fails a documented load threshold. Do not promise native DWG editing in M4.
