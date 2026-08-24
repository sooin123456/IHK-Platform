import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const read = (relativePath) =>
  readFile(new URL(`../${relativePath}`, import.meta.url), "utf8");
const migration = () =>
  read("supabase/migrations/20260824110000_drawing_workspace_core.sql");
const escaped = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

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
  assert.match(sql, /select auth\.uid\(\)/i);
  assert.match(sql, /for update/i);
  assert.match(
    sql,
    /where o\.revision_id\s*=\s*p_revision_id[\s\S]+o\.client_operation_id\s*=\s*p_client_operation_id/i,
  );
  for (const operation of [
    "add_objects",
    "update_objects",
    "delete_objects",
    "add_layer",
    "update_layer",
  ]) {
    assert.match(sql, new RegExp(`p_operation_type = '${operation}'`, "i"));
  }
  assert.match(sql, /Drawing object version conflict/i);
  assert.match(sql, /result_versions/i);
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
