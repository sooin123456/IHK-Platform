import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

async function migration() {
  const directory = new URL("../supabase/migrations/", import.meta.url);
  const matches = (await readdir(directory)).filter((name) =>
    name.endsWith("_organization_drawing_libraries.sql"),
  );
  assert.equal(matches.length, 1, "exactly one Task 2 forward migration");
  return readFile(new URL(matches[0], directory), "utf8");
}

test("library migration defines exact registry, immutable version, and provenance ancestry", async () => {
  const sql = await migration();
  for (const table of [
    "lukas_drawing_library_entries",
    "lukas_drawing_library_versions",
    "lukas_drawing_library_imports",
  ])
    assert.match(sql, new RegExp(`create table public\\.${table}`, "i"));
  assert.match(
    sql,
    /kind text not null check \(kind in \('style','block','property_schema','workspace_template'\)\)/i,
  );
  assert.match(
    sql,
    /status text not null check \(status in \('draft','published','deprecated'\)\)/i,
  );
  assert.match(sql, /canonical_payload jsonb not null/i);
  assert.match(sql, /content_sha256 text not null/i);
  assert.match(sql, /predecessor_version_id uuid/i);
  assert.match(sql, /foreign key \(registry_id,organization_id\)/i);
  assert.match(
    sql,
    /foreign key \(predecessor_version_id,predecessor_registry_id,predecessor_organization_id\)/i,
  );
  assert.match(sql, /foreign key \(project_id,organization_id\)/i);
  assert.match(sql, /foreign key \(revision_id,project_id\)/i);
  assert.match(sql, /foreign key \(version_id,registry_id,organization_id\)/i);
});

test("published bytes are hash-bound, immutable, and imported through an exact retry ledger", async () => {
  const sql = await migration();
  assert.match(
    sql,
    /digest\(pg_catalog\.convert_to\([^)]*canonical_payload[^)]*::text[^)]*,'UTF8'\),'sha256'\)/is,
  );
  assert.match(sql, /published library versions are immutable/i);
  assert.match(sql, /before update or delete on public\.lukas_drawing_library_versions/i);
  assert.match(sql, /pg_advisory_xact_lock/i);
  assert.match(sql, /client_request_id uuid not null/i);
  assert.match(sql, /request_sha256 text not null/i);
  assert.match(sql, /unique \(imported_by,client_request_id\)/i);
  assert.match(sql, /request ID does not match the stored library import/i);
  assert.match(sql, /r\.status='draft'/i);
  assert.match(sql, /v_version\.status<>'published'/i);
});

test("library RLS is organization exact and public mutation authority is RPC-only", async () => {
  const sql = await migration();
  for (const table of [
    "lukas_drawing_library_entries",
    "lukas_drawing_library_versions",
    "lukas_drawing_library_imports",
  ]) {
    assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security`, "i"));
    assert.match(
      sql,
      new RegExp(`revoke all on table public\\.${table} from anon,authenticated`, "i"),
    );
    assert.match(
      sql,
      new RegExp(`grant select on table public\\.${table} to authenticated`, "i"),
    );
  }
  assert.match(
    sql,
    /private\.lukas_qto_organization_role\(organization_id\) is not null/i,
  );
  assert.match(sql, /in \('owner','admin','staff'\)/i);
  assert.match(sql, /private\.lukas_drawing_workspace_capability\(p_project_id\)[\s\S]*in \('admin','editor'\)/i);
  assert.doesNotMatch(sql, /to authenticated\s+using\s*\(\s*true\s*\)/i);
});

test("imports copy into the existing canonical tables without a second drawing schema", async () => {
  const sql = await migration();
  assert.match(sql, /insert into public\.lukas_drawing_styles/i);
  assert.match(sql, /insert into public\.lukas_drawing_blocks/i);
  assert.match(sql, /insert into public\.lukas_drawing_property_schemas/i);
  assert.match(sql, /private\.lukas_drawing_create_from_template/i);
  assert.doesNotMatch(sql, /create table public\.lukas_drawing_library_(styles|blocks|property_schemas|templates)/i);
  assert.match(sql, /source_content_sha256/i);
  assert.match(sql, /target_entity_id/i);
});
