import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const read = (relativePath) =>
  readFile(new URL(`../${relativePath}`, import.meta.url), "utf8");
const migration = () =>
  read("supabase/migrations/20260824110000_drawing_workspace_core.sql");
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
      new RegExp(`create table (?:public|private)\\.lukas_drawing_${forbidden}`, "i"),
    );
  }
  assert.match(sql, /jsonb_typeof\s*\(geometry\)\s*=\s*'object'/i);
  assert.match(sql, /status\s+text[\s\S]*status in\s*\('active',\s*'deleted'\)/i);
  assert.match(
    sql,
    /status\s+text[\s\S]*status in\s*\('draft',\s*'review_requested',\s*'approved',\s*'superseded'\)/i,
  );
  assert.doesNotMatch(sql, /konva/i);
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
    assert.match(
      sql,
      new RegExp(`when '${role}' then '${capability}'`, "i"),
    );
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
  assert.match(sql, /for update to authenticated[\s\S]+using[\s\S]+with check/i);
  assert.match(sql, /for insert to authenticated[\s\S]+created_by\s*=\s*\(select auth\.uid\(\)\)/i);
  assert.match(sql, /revision approvals[\s\S]+created_by\s*<>\s*\(select auth\.uid\(\)\)/i);
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
  assert.match(sql, /before update or delete on public\.lukas_drawing_objects/i);
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
      new RegExp(`before insert on public\\.lukas_drawing_${escaped(table)}`, "i"),
    );
    assert.match(definition, /lukas_drawing_draft_child_insert_guard\(\)/i);
  }
  const requestReview = functionDefinition(
    sql,
    "lukas_drawing_request_review",
  );
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
  assert.match(sql, /private\.lukas_drawing_geometry_valid\([^;]+\) is not true/i);
  assert.match(sql, /private\.lukas_drawing_style_valid\([^;]+\) is not true/i);
  assert.match(sql, /function private\.lukas_drawing_operation_payload_valid/i);
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
  assert.match(applyOperation, /from public\.lukas_drawing_revisions[\s\S]+for update/i);
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
