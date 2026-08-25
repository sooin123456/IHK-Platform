import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const read = (relativePath) =>
  readFile(new URL(`../${relativePath}`, import.meta.url), "utf8");
const migration = () =>
  read("supabase/migrations/20260824110000_drawing_workspace_core.sql");
const upgradeMigration = () =>
  read(
    "supabase/migrations/20260824113000_drawing_workspace_layers_inspector_upgrade.sql",
  );
const issueLinkMigration = () =>
  read("supabase/migrations/20260824135829_drawing_workspace_issue_links.sql");
const p2Migration = () =>
  read("supabase/migrations/20260825010814_drawing_workspace_p2_structure.sql");
const p2HardeningMigration = () =>
  read("supabase/migrations/20260825033000_drawing_workspace_p2_contract_hardening.sql");
const escaped = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const functionDefinition = (sql, name) => {
  const start = sql.indexOf(`create or replace function private.${name}`);
  assert.notEqual(start, -1, `missing private.${name}`);
  const end = sql.indexOf("\n$$;", start);
  assert.notEqual(end, -1, `unterminated private.${name}`);
  return sql.slice(start, end + 4);
};
const triggerDefinition = (sql, name) => {
  const start = sql.indexOf(`create trigger ${name}`);
  assert.notEqual(start, -1, `missing trigger ${name}`);
  const end = sql.indexOf(";", start);
  assert.notEqual(end, -1, `unterminated trigger ${name}`);
  return sql.slice(start, end + 1);
};

test("workspace migration binds sources by project and SHA and freezes approved revisions", async () => {
  const sql = await migration();
  assert.match(
    sql,
    /foreign key\s*\(source_file_id,\s*project_id,\s*source_sha256\)/i,
  );
  assert.match(
    sql,
    /references public\.lukas_qto_files\s*\(id,\s*project_id,\s*sha256\)/i,
  );
  assert.match(sql, /approved drawing revision is immutable/i);
  assert.match(sql, /unique\s*\(revision_id,\s*client_operation_id\)/i);
});

test("workspace creates only the ten approved P0/P1 tables with domain checks", async () => {
  const sql = await migration();
  const tables = [
    "documents",
    "revisions",
    "pages",
    "layers",
    "objects",
    "operations",
    "snapshots",
    "revision_approvals",
    "object_sources",
    "object_issue_links",
  ];
  for (const table of tables) {
    assert.match(
      sql,
      new RegExp(`create table public\\.lukas_drawing_${table}\\s*\\(`, "i"),
    );
  }
  for (const forbidden of [
    "canvases",
    "styles",
    "blocks",
    "block_instances",
    "property_schemas",
    "property_values",
    "tables",
    "collaboration_states",
    "quantity_links",
    "boq_links",
    "material_links",
  ]) {
    assert.doesNotMatch(
      sql,
      new RegExp(
        `create table (?:public|private)\\.lukas_drawing_${forbidden}`,
        "i",
      ),
    );
  }
  assert.match(sql, /jsonb_typeof\s*\(geometry\)\s*=\s*'object'/i);
  assert.match(
    sql,
    /create table public\.lukas_drawing_objects[\s\S]+name text not null[\s\S]+char_length\(name\) between 1 and 255/i,
  );
  assert.match(
    sql,
    /status\s+text[\s\S]*status in\s*\('active',\s*'deleted'\)/i,
  );
  assert.match(
    sql,
    /status\s+text[\s\S]*status in\s*\('draft',\s*'review_requested',\s*'approved',\s*'superseded'\)/i,
  );
  assert.doesNotMatch(sql, /konva/i);
});

test("additive layers-inspector upgrade carries the full object and layer contract", async () => {
  const sql = await upgradeMigration();
  assert.match(
    sql,
    /alter table public\.lukas_drawing_objects\s+add column if not exists name text/i,
  );
  assert.match(sql, /update public\.lukas_drawing_objects[\s\S]+object_type/i);
  assert.match(sql, /alter column name set not null/i);
  for (const helper of [
    "lukas_drawing_create_document",
    "lukas_drawing_append_only_guard",
    "lukas_drawing_draft_child_guard",
    "lukas_drawing_layer_guard",
    "lukas_drawing_operation_payload_valid",
    "lukas_drawing_apply_operation",
    "lukas_drawing_request_review",
  ]) {
    assert.match(
      sql,
      new RegExp(`create or replace function private\\.${helper}`, "i"),
    );
  }
  assert.match(
    sql,
    /revoke delete on public\.lukas_drawing_layers from authenticated/i,
  );
  assert.match(
    sql,
    /drop policy if exists "workspace editors delete draft drawing layers"/i,
  );
  assert.doesNotMatch(
    sql,
    /update public\.lukas_drawing_(?:operations|snapshots)/i,
  );
});

test("additive issue-link migration exposes only the guarded append-only RPC", async () => {
  const sql = await issueLinkMigration();
  assert.match(
    sql,
    /function public\.lukas_drawing_link_object_issue\s*\(\s*p_object_id uuid,\s*p_issue_id uuid\s*\)/i,
  );
  assert.match(sql, /security definer[\s\S]+set search_path\s*=\s*''/i);
  assert.match(sql, /from public\.lukas_drawing_objects[\s\S]+for update/i);
  assert.match(sql, /o\.status\s*=\s*'active'/i);
  assert.match(sql, /v_revision\.status\s*<>\s*'draft'/i);
  assert.match(sql, /v_capability not in \('admin', 'editor'\)/i);
  assert.match(
    sql,
    /insert into public\.lukas_drawing_object_issue_links[\s\S]+on conflict\s*\(object_id, issue_id\)\s*do nothing/i,
  );
  assert.match(
    sql,
    /revoke insert, update, delete on public\.lukas_drawing_object_issue_links\s+from authenticated/i,
  );
  assert.match(
    sql,
    /grant select on public\.lukas_drawing_object_issue_links to authenticated/i,
  );
  assert.match(
    sql,
    /revoke all on function public\.lukas_drawing_link_object_issue\(uuid, uuid\)\s+from public, anon/i,
  );
  assert.match(
    sql,
    /grant execute on function public\.lukas_drawing_link_object_issue\(uuid, uuid\)\s+to authenticated, service_role/i,
  );
  assert.match(sql, /lukas_drawing_object_issue_links_append_only/i);
  assert.doesNotMatch(sql, /lukas_drawing_issue_anchors/i);
  const rpc = sql.slice(
    sql.indexOf(
      "create or replace function public.lukas_drawing_link_object_issue",
    ),
  );
  const revisionLock = rpc.indexOf("from public.lukas_drawing_revisions r");
  const lockedObject = rpc.indexOf(
    "from public.lukas_drawing_objects o",
    rpc.indexOf("from public.lukas_drawing_objects o") + 1,
  );
  assert.ok(revisionLock >= 0 && lockedObject > revisionLock);
});

test("additive issue-link migration closes direct object DML and target enumeration", async () => {
  const sql = await issueLinkMigration();
  assert.match(
    sql,
    /revoke insert, update, delete on public\.lukas_drawing_objects\s+from authenticated/i,
  );
  for (const policy of ["add", "update", "delete"])
    assert.match(
      sql,
      new RegExp(
        `drop policy if exists "workspace editors ${policy} draft drawing objects"`,
        "i",
      ),
    );
  const rpc = sql.slice(
    sql.indexOf(
      "create or replace function public.lukas_drawing_link_object_issue",
    ),
  );
  const guardedObjectReads = [
    ...rpc.matchAll(
      /from public\.lukas_drawing_objects o[\s\S]*?private\.lukas_drawing_workspace_capability\(o\.project_id\) in \('admin', 'editor'\)/gi,
    ),
  ];
  assert.ok(guardedObjectReads.length >= 2);
  assert.match(
    rpc,
    /from public\.lukas_drawing_issues i\s+where i\.id = p_issue_id\s+and i\.project_id = v_object\.project_id/i,
  );
  assert.doesNotMatch(rpc, /Drawing object does not exist/i);
  assert.doesNotMatch(rpc, /Drawing issue does not exist/i);
  assert.doesNotMatch(rpc, /same project/i);
  assert.ok(
    (rpc.match(/Drawing issue link target is unavailable/g) ?? []).length >= 4,
  );
});

test("parent deletion cascades are distinguished from direct layer deletion in both install paths", async () => {
  for (const sql of [await migration(), await upgradeMigration()]) {
    for (const helper of [
      "lukas_drawing_draft_child_guard",
      "lukas_drawing_layer_guard",
      "lukas_drawing_append_only_guard",
    ]) {
      const definition = functionDefinition(sql, helper);
      assert.match(
        definition,
        /tg_op\s*=\s*'DELETE'[\s\S]+(?:pg_catalog\.)?pg_trigger_depth\(\)\s*>\s*1/i,
      );
    }
  }
});

test("capability mapping, RLS, and grants expose only project-scoped operations", async () => {
  const sql = await migration();
  assert.match(
    sql,
    /function private\.lukas_drawing_workspace_capability\s*\(p_project_id uuid\)/i,
  );
  for (const [role, capability] of [
    ["owner", "admin"],
    ["staff", "admin"],
    ["estimator", "editor"],
    ["reviewer", "reviewer"],
    ["site", "commenter"],
    ["procurement", "commenter"],
    ["viewer", "viewer"],
  ]) {
    assert.match(sql, new RegExp(`when '${role}' then '${capability}'`, "i"));
  }
  for (const table of [
    "documents",
    "revisions",
    "pages",
    "layers",
    "objects",
    "operations",
    "snapshots",
    "revision_approvals",
    "object_sources",
    "object_issue_links",
  ]) {
    assert.match(
      sql,
      new RegExp(
        `alter table public\\.lukas_drawing_${escaped(table)} enable row level security`,
        "i",
      ),
    );
    assert.match(
      sql,
      new RegExp(
        `policy [^;]+on public\\.lukas_drawing_${escaped(table)} for select to authenticated`,
        "is",
      ),
    );
  }
  assert.match(sql, /revoke all on[\s\S]+from public, anon, authenticated/i);
  assert.match(sql, /grant select[\s\S]+to authenticated/i);
  assert.match(
    sql,
    /for update to authenticated[\s\S]+using[\s\S]+with check/i,
  );
  assert.match(
    sql,
    /for insert to authenticated[\s\S]+created_by\s*=\s*\(select auth\.uid\(\)\)/i,
  );
  assert.match(
    sql,
    /revision approvals[\s\S]+created_by\s*<>\s*\(select auth\.uid\(\)\)/i,
  );
  assert.match(
    sql,
    /revoke update, delete on[\s\S]+lukas_drawing_operations[\s\S]+lukas_drawing_snapshots[\s\S]+lukas_drawing_revision_approvals[\s\S]+from authenticated/i,
  );
});

test("guards validate domain JSON and preserve approved and append-only records", async () => {
  const sql = await migration();
  assert.match(sql, /function private\.lukas_drawing_geometry_valid/i);
  assert.match(sql, /geometry\s*->>\s*'type'[\s\S]+object_type/i);
  assert.match(sql, /before update or delete on public\.lukas_drawing_pages/i);
  assert.match(sql, /before update or delete on public\.lukas_drawing_layers/i);
  assert.match(
    sql,
    /before update or delete on public\.lukas_drawing_objects/i,
  );
  for (const table of ["operations", "snapshots", "revision_approvals"]) {
    assert.match(
      sql,
      new RegExp(
        `before update or delete on public\\.lukas_drawing_${escaped(table)}`,
        "i",
      ),
    );
  }
  assert.doesNotMatch(sql, /update\s+public\.lukas_qto_files/i);
});

test("every revision child INSERT serializes with review on the parent row", async () => {
  const sql = await migration();
  const updateDeleteGuard = functionDefinition(
    sql,
    "lukas_drawing_draft_child_guard",
  );
  assert.match(updateDeleteGuard, /from public\.lukas_drawing_revisions/i);
  assert.match(updateDeleteGuard, /for update/i);
  assert.match(updateDeleteGuard, /v_status <> 'draft'/i);
  for (const [table, trigger] of [
    ["pages", "lukas_drawing_pages_revision_guard"],
    ["layers", "lukas_drawing_layers_revision_guard"],
    ["objects", "lukas_drawing_objects_revision_guard"],
    ["object_sources", "lukas_drawing_object_sources_revision_guard"],
    ["object_issue_links", "lukas_drawing_object_issue_links_revision_guard"],
  ]) {
    const definition = triggerDefinition(sql, trigger);
    assert.match(
      definition,
      new RegExp(
        `before update or delete on public\\.lukas_drawing_${escaped(table)}`,
        "i",
      ),
    );
    assert.match(definition, /lukas_drawing_draft_child_guard\(\)/i);
  }
  const insertGuard = functionDefinition(
    sql,
    "lukas_drawing_draft_child_insert_guard",
  );
  assert.match(insertGuard, /from public\.lukas_drawing_revisions/i);
  assert.match(insertGuard, /for update/i);
  assert.match(insertGuard, /v_status <> 'draft'/i);
  for (const [table, trigger] of [
    ["pages", "lukas_drawing_pages_insert_revision_guard"],
    ["layers", "lukas_drawing_layers_insert_revision_guard"],
    ["objects", "lukas_drawing_objects_insert_revision_guard"],
    ["operations", "lukas_drawing_operations_insert_revision_guard"],
    ["snapshots", "lukas_drawing_snapshots_insert_revision_guard"],
    ["object_sources", "lukas_drawing_object_sources_insert_revision_guard"],
    [
      "object_issue_links",
      "lukas_drawing_object_issue_links_insert_revision_guard",
    ],
  ]) {
    const definition = triggerDefinition(sql, trigger);
    assert.match(
      definition,
      new RegExp(
        `before insert on public\\.lukas_drawing_${escaped(table)}`,
        "i",
      ),
    );
    assert.match(definition, /lukas_drawing_draft_child_insert_guard\(\)/i);
  }
  const requestReview = functionDefinition(sql, "lukas_drawing_request_review");
  assert.match(requestReview, /where r\.id = p_revision_id for update/i);
  const approvalGuard = functionDefinition(
    sql,
    "lukas_drawing_revision_approval_guard",
  );
  assert.match(approvalGuard, /where r\.id = new\.revision_id/i);
  assert.match(approvalGuard, /for update/i);
  assert.match(approvalGuard, /v_revision\.status <> 'review_requested'/i);
  const approvalTrigger = triggerDefinition(
    sql,
    "lukas_drawing_revision_approvals_validate",
  );
  assert.match(
    approvalTrigger,
    /before insert on public\.lukas_drawing_revision_approvals/i,
  );
  assert.match(approvalTrigger, /lukas_drawing_revision_approval_guard\(\)/i);
});

test("capability and role checks fail closed inside each privileged function", async () => {
  const sql = await migration();
  for (const helper of [
    "lukas_drawing_draft_child_guard",
    "lukas_drawing_draft_child_insert_guard",
    "lukas_drawing_create_document",
    "lukas_drawing_apply_operation",
    "lukas_drawing_request_review",
  ]) {
    const definition = functionDefinition(sql, helper);
    assert.match(definition, /v_capability is null/i);
    assert.match(definition, /v_capability not in \('admin', 'editor'\)/i);
  }
  for (const helper of [
    "lukas_drawing_revision_approval_guard",
    "lukas_drawing_record_revision_decision",
  ]) {
    const definition = functionDefinition(sql, helper);
    assert.match(definition, /v_role is null/i);
    assert.match(definition, /v_role not in \('owner', 'staff', 'reviewer'\)/i);
  }
});

test("domain and inverse validation fails closed", async () => {
  const sql = await migration();
  assert.match(
    sql,
    /function private\.lukas_drawing_point_valid[\s\S]+select coalesce\([\s\S]+p_point \?& array\['x', 'y'\][\s\S]+false/i,
  );
  assert.match(
    sql,
    /function private\.lukas_drawing_style_valid[\s\S]+p_style \?& array\['stroke', 'strokeWidth', 'fill'\][\s\S]+false/i,
  );
  assert.match(
    sql,
    /private\.lukas_drawing_geometry_valid\([^;]+\) is not true/i,
  );
  assert.match(sql, /private\.lukas_drawing_style_valid\([^;]+\) is not true/i);
  assert.match(sql, /function private\.lukas_drawing_operation_payload_valid/i);
  assert.match(
    sql,
    /v_item \?& array\['id', 'name', 'layerId', 'geometry', 'style', 'version'\]/i,
  );
  assert.match(
    sql,
    /v_patch - array\['name', 'layerId', 'geometry', 'style'\]/i,
  );
  assert.match(sql, /Drawing operation inverse payload is invalid/i);
  assert.match(
    sql,
    /source_kind = 'pdf_region'[\s\S]+pdf_page_number is not null[\s\S]+x is not null[\s\S]+height is not null/i,
  );
});

test("document creation and operation RPCs are atomic, authorized, and idempotent", async () => {
  const sql = await migration();
  assert.match(
    sql,
    /function public\.lukas_drawing_create_document\s*\(\s*p_project_id uuid,\s*p_source_file_id uuid,\s*p_title text,\s*p_blank boolean\s*\)/i,
  );
  assert.match(sql, /kind\s+in\s*\('pdf',\s*'ifc'\)/i);
  assert.match(sql, /values\s*\([^;]*'원본'[^;]*true[^;]*'source'/is);
  assert.match(sql, /values\s*\([^;]*'작업'[^;]*false[^;]*'work'/is);
  assert.match(
    sql,
    /function public\.lukas_drawing_apply_operation\s*\(\s*p_revision_id uuid,\s*p_client_operation_id uuid,\s*p_operation_type text,\s*p_base_versions jsonb,\s*p_forward jsonb,\s*p_inverse jsonb\s*\)/i,
  );
  const applyOperation = functionDefinition(
    sql,
    "lukas_drawing_apply_operation",
  );
  assert.match(applyOperation, /select auth\.uid\(\)/i);
  assert.match(
    applyOperation,
    /from public\.lukas_drawing_revisions[\s\S]+for update/i,
  );
  assert.match(
    applyOperation,
    /where o\.revision_id\s*=\s*p_revision_id[\s\S]+o\.client_operation_id\s*=\s*p_client_operation_id/i,
  );
  for (const operation of [
    "add_objects",
    "update_objects",
    "delete_objects",
    "add_layer",
    "update_layer",
  ]) {
    assert.match(
      applyOperation,
      new RegExp(`p_operation_type = '${operation}'`, "i"),
    );
  }
  assert.match(applyOperation, /Drawing object version conflict/i);
  assert.match(applyOperation, /result_versions/i);
});

test("review RPCs hash canonical stable ordering and enforce maker-checker", async () => {
  const sql = await migration();
  assert.match(
    sql,
    /function public\.lukas_drawing_request_review\s*\(p_revision_id uuid\)/i,
  );
  assert.match(sql, /jsonb_agg\s*\([^;]+order by p\.id/is);
  assert.match(sql, /jsonb_agg\s*\([^;]+order by l\.id/is);
  assert.match(sql, /jsonb_agg\s*\([^;]+order by o\.id/is);
  assert.match(sql, /'name', o\.name/i);
  assert.match(
    sql,
    /(?:extensions\.)?digest\s*\(\s*(?:pg_catalog\.)?convert_to\s*\(v_snapshot::text,\s*'UTF8'\),\s*'sha256'\s*\)/i,
  );
  assert.match(
    sql,
    /function public\.lukas_drawing_record_revision_decision\s*\(\s*p_revision_id uuid,\s*p_subject_version bigint,\s*p_snapshot_sha256 text,\s*p_decision text,\s*p_note text\s*\)/i,
  );
  assert.match(
    sql,
    /v_revision\.created_by\s*=\s*v_actor[\s\S]+raise exception[^;]+own drawing revision/i,
  );
  assert.match(sql, /v_revision\.version\s*<>\s*p_subject_version/i);
  assert.match(sql, /s\.sha256\s*=\s*p_snapshot_sha256/i);
  assert.match(sql, /set status = 'approved'/i);
  assert.match(sql, /set status = 'draft'[\s\S]+version = version \+ 1/i);
});

test("security-definer helpers and public RPCs have explicit execution privileges", async () => {
  const sql = await migration();
  const definers = [...sql.matchAll(/security definer([\s\S]*?)as \$\$/gi)];
  assert.ok(definers.length > 0);
  for (const definition of definers)
    assert.match(definition[1], /set search_path\s*=\s*''/i);
  assert.doesNotMatch(
    sql,
    /security definer[\s\S]{0,100}set search_path\s*=\s*(?:public|private)/i,
  );
  assert.match(sql, /security definer[\s\S]+set search_path\s*=\s*''/i);
  assert.match(sql, /revoke all on function private\.[^;]+from public, anon/i);
  assert.match(sql, /revoke all on function public\.[^;]+from public, anon/i);
  assert.match(sql, /grant execute on function public\.[^;]+to authenticated/i);
});

test("trigger privilege modes match their required authority", async () => {
  const sql = await migration();
  for (const helper of [
    "revision_guard",
    "append_only_guard",
    "document_guard",
    "page_source_guard",
    "layer_guard",
    "object_guard",
    "object_source_guard",
  ]) {
    assert.match(
      functionDefinition(sql, `lukas_drawing_${helper}`),
      /security invoker/i,
    );
  }
  for (const helper of [
    "draft_child_guard",
    "draft_child_insert_guard",
    "revision_approval_guard",
    "apply_revision_approval",
  ]) {
    const definition = functionDefinition(sql, `lukas_drawing_${helper}`);
    assert.match(definition, /security definer/i);
    assert.match(definition, /select auth\.uid\(\)/i);
  }
});

test("every workspace foreign-key path has a covering index", async () => {
  const sql = await migration();
  for (const table of [
    "documents",
    "revisions",
    "pages",
    "layers",
    "objects",
    "operations",
    "snapshots",
    "revision_approvals",
    "object_sources",
    "object_issue_links",
  ]) {
    assert.match(
      sql,
      new RegExp(
        `create (?:unique )?index[^;]+on public\\.lukas_drawing_${escaped(
          table,
        )}\\s*\\(\\s*project_id`,
        "is",
      ),
    );
  }
  for (const columns of [
    "project_id",
    "source_file_id, project_id, source_sha256",
    "document_id, project_id",
    "parent_revision_id, document_id, project_id",
    "revision_id, project_id",
    "background_source_file_id, project_id, background_source_sha256",
    "page_id, revision_id, project_id",
    "layer_id, revision_id, project_id",
    "object_id, revision_id, project_id",
    "issue_id, project_id",
    "actor_id",
    "created_by",
    "updated_by",
    "decided_by",
  ]) {
    assert.match(
      sql,
      new RegExp(
        `create (?:unique )?index[^;]+\\(\\s*${columns
          .split(", ")
          .map(escaped)
          .join(",\\s*")}`,
        "is",
      ),
    );
  }
});

test("P2 migration adds the seven project-scoped structure tables and authoritative canvases", async () => {
  const sql = await p2Migration();
  for (const table of [
    "lukas_drawing_canvases",
    "lukas_drawing_styles",
    "lukas_drawing_blocks",
    "lukas_drawing_block_instances",
    "lukas_drawing_property_schemas",
    "lukas_drawing_property_values",
    "lukas_drawing_tables",
  ]) {
    assert.match(sql, new RegExp(`create table public\\.${table}`, "i"));
    assert.match(
      sql,
      new RegExp(`alter table public\\.${table} enable row level security`, "i"),
    );
    assert.match(
      sql,
      new RegExp(`on public\\.${table} for select to authenticated`, "i"),
    );
  }
  assert.match(
    sql,
    /alter table public\.lukas_drawing_layers\s+add column canvas_id uuid/i,
  );
  assert.match(
    sql,
    /insert into public\.lukas_drawing_canvases[\s\S]+from public\.lukas_drawing_pages/i,
  );
  assert.match(
    sql,
    /update public\.lukas_drawing_layers[\s\S]+set canvas_id/i,
  );
  assert.match(
    sql,
    /alter table public\.lukas_drawing_layers\s+alter column canvas_id set not null/i,
  );
  assert.match(sql, /check \(operation_type[\s\S]*mutate_structure/i);
});

test("P2 migration hardens structure mutation, snapshot v2, and approved same-project cloning", async () => {
  const sql = await p2Migration();
  assert.match(
    sql,
    /alter function private\.lukas_drawing_apply_operation\(uuid, uuid, text, jsonb, jsonb, jsonb\)\s+rename to lukas_drawing_apply_operation_pre_p2/i,
  );
  assert.match(sql, /p_operation_type = 'mutate_structure'/i);
  assert.match(sql, /Drawing operation idempotency key does not match the stored request/i);
  assert.match(sql, /errcode\s*=\s*'P1C01'/i);
  assert.match(sql, /errcode\s*=\s*'P1R01'/i);
  assert.match(sql, /schema_version[^;]*2/i);
  assert.match(sql, /'schemaVersion', 2/i);
  for (const key of [
    "canvases",
    "styles",
    "blocks",
    "blockInstances",
    "propertySchemas",
    "propertyValues",
    "tables",
  ]) assert.match(sql, new RegExp(`'${key}'`, "i"));
  assert.match(
    sql,
    /function public\.lukas_drawing_create_from_template\s*\(\s*p_source_revision_id uuid,\s*p_title text,\s*p_source_file_id uuid/i,
  );
  assert.match(sql, /v_source_revision\.status\s*<>\s*'approved'/i);
  assert.match(sql, /v_source_revision\.project_id\s*<>\s*v_project_id/i);
  assert.doesNotMatch(sql, /create table[^;]+template/i);
});

test("P2 migration uses locked guards, least privilege, and covering indexes", async () => {
  const sql = await p2Migration();
  for (const table of [
    "canvases",
    "styles",
    "blocks",
    "block_instances",
    "property_schemas",
    "property_values",
    "tables",
  ]) {
    assert.match(
      sql,
      new RegExp(`revoke all on public\\.lukas_drawing_${table}[\\s\\S]+from public, anon, authenticated`, "i"),
    );
    assert.match(
      sql,
      new RegExp(`create (?:unique )?index[^;]+on public\\.lukas_drawing_${table}\\s*\\(\\s*project_id`, "is"),
    );
  }
  for (const helper of [
    "lukas_drawing_p2_child_guard",
    "lukas_drawing_apply_operation",
    "lukas_drawing_request_review",
    "lukas_drawing_create_from_template",
  ]) {
    const definition = functionDefinition(sql, helper);
    if (/security definer/i.test(definition))
      assert.match(definition, /set search_path\s*=\s*''/i);
  }
  assert.match(sql, /from public\.lukas_drawing_revisions[\s\S]+for update/i);
  assert.match(sql, /pg_trigger_depth\(\)\s*>\s*1/i);
});

test("P2 hardening keeps structural writes RPC-only and records exact layer/source contracts", async () => {
  const sql = await p2HardeningMigration();
  assert.match(sql, /revoke insert,update,delete on public\.lukas_drawing_pages from authenticated/i);
  assert.match(sql, /revoke insert,update,delete on public\.lukas_drawing_layers from authenticated/i);
  assert.match(sql, /put_layer/);
  assert.match(sql, /delete_layer/);
  assert.match(sql, /fresh canvas requires exactly one recorded editable layer/i);
  assert.match(sql, /Canvas deletion must record every child layer/i);
  assert.match(sql, /previous canvas must retain an editable layer/i);
  assert.match(sql, /source_file_id:=null; new\.source_sha256:=null/i);
  assert.match(sql, /change invalidates an existing value target/i);
  assert.match(sql, /Drawing table row requires exactly one target/i);
  assert.match(sql, /serialization_failure or deadlock_detected then raise/i);
  assert.match(sql, /numeric_value_out_of_range or invalid_text_representation/i);
  assert.doesNotMatch(sql, /include\s*\([^)]*\b(value|primitives|origin|enum_options|applies_to)\b/i);
  for (const helper of [
    "lukas_drawing_apply_operation",
    "lukas_drawing_create_from_template",
    "lukas_drawing_request_review",
  ]) {
    const definition = functionDefinition(sql, helper);
    assert.match(definition, /security definer/i);
    assert.match(definition, /set search_path\s*=\s*''/i);
  }
});
