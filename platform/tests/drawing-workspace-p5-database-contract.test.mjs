import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

const migrationDirectory = new URL("../supabase/migrations/", import.meta.url);

async function p5Migration() {
  const names = (await readdir(migrationDirectory)).filter((name) =>
    name.endsWith("_drawing_workspace_p5_evidence_authority.sql"),
  );
  assert.equal(
    names.length,
    1,
    "P5 evidence authority is one forward CLI migration",
  );
  return readFile(new URL(names[0], migrationDirectory), "utf8");
}

test("P5 migration versions and soft-deletes drawing sources behind partial active uniqueness", async () => {
  const sql = await p5Migration();
  assert.match(sql, /begin;[\s\S]*commit;/i);
  assert.match(sql, /add column[^;]*status[\s\S]*add column[^;]*version/i);
  assert.match(sql, /where\s*\(status\s*=\s*'active'/i);
  assert.match(sql, /put_source[\s\S]*delete_source/i);
  assert.match(sql, /lukas_drawing_object_sources[\s\S]*source_sha256/i);
  assert.match(sql, /lukas_drawing_source_operation/i);
  assert.match(sql, /resultVersions/i);
});

test("P5 migration makes issue-anchor replacement atomic and guarded", async () => {
  const sql = await p5Migration();
  assert.match(sql, /replaces_anchor_id/i);
  assert.match(
    sql,
    /foreign key\s*\(replaces_anchor_id,\s*issue_id,\s*project_id\)/i,
  );
  assert.match(
    sql,
    /create or replace function public\.lukas_drawing_relink_issue_anchor/i,
  );
  assert.match(sql, /previous_sha256[\s\S]*current_sha256/i);
  assert.match(sql, /set search_path\s*=\s*''/i);
});

test("P5 source writes have exact grants, RLS and no public management API", async () => {
  const sql = await p5Migration();
  assert.match(
    sql,
    /revoke (?:all|insert,\s*update,\s*delete)[\s\S]*lukas_drawing_object_sources[\s\S]*authenticated/i,
  );
  assert.match(sql, /drop policy[^;]*(insert|update|delete)/i);
  assert.match(
    sql,
    /grant select on table public\.lukas_drawing_object_sources to authenticated/i,
  );
  assert.match(
    sql,
    /grant execute on function public\.lukas_drawing_relink_issue_anchor[\s\S]*to authenticated,service_role/i,
  );
  assert.doesNotMatch(
    sql,
    /create or replace function public\.lukas_drawing_(?:put|delete)_source/i,
  );
  assert.doesNotMatch(sql, /create\s+table/i);
});
