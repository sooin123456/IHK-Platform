import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL(
  "../supabase/migrations/20260901000000_drawing_retention_purge_child_guards.sql",
  import.meta.url,
);

const functionDefinition = (sql, name) => {
  const start = sql.indexOf(`create or replace function private.${name}`);
  assert.notEqual(start, -1, `missing private.${name}`);
  const end = sql.indexOf("\n$$;", start);
  assert.notEqual(end, -1, `unterminated private.${name}`);
  return sql.slice(start, end + 4);
};

test("retention purge bypasses drawing child auth only for its marked nested cascade", async () => {
  const sql = await readFile(migrationUrl, "utf8");

  for (const name of [
    "lukas_drawing_draft_child_guard",
    "lukas_drawing_layer_guard",
  ]) {
    const definition = functionDefinition(sql, name);
    assert.match(definition, /tg_op\s*=\s*'DELETE'/i);
    assert.match(definition, /pg_catalog\.pg_trigger_depth\(\)\s*>\s*1/i);
    assert.match(
      definition,
      /current_setting\s*\(\s*'app\.lukas_retention_purge_project',\s*true\s*\)\s*=\s*old\.project_id::text/i,
    );
    assert.match(
      definition,
      /not exists\s*\(\s*select 1 from public\.lukas_qto_projects p\s+where p\.id\s*=\s*old\.project_id\s*\)/i,
    );
    assert.match(
      definition,
      /current_user\s*=\s*pg_catalog\.pg_get_userbyid\s*\(\s*\(select c\.relowner from pg_catalog\.pg_class c where c\.oid\s*=\s*tg_relid\)\s*\)/i,
    );
    assert.match(definition, /if v_actor is null/i);
    assert.ok(
      definition.indexOf("app.lukas_retention_purge_project") <
        definition.indexOf("if v_actor is null"),
      `${name} must recognize the trusted cascade before actor rejection`,
    );
  }

  assert.match(
    functionDefinition(sql, "lukas_drawing_draft_child_guard"),
    /Drawing workspace editor capability required/i,
  );
  assert.match(
    functionDefinition(sql, "lukas_drawing_layer_guard"),
    /Source drawing layer is immutable/i,
  );
  assert.doesNotMatch(
    sql,
    /drop trigger|disable trigger|alter table[^;]*retention/i,
  );

  const binding = functionDefinition(
    sql,
    "lukas_drawing_estimate_binding_guard",
  );
  assert.match(binding, /pg_catalog\.pg_trigger_depth\(\)\s*>\s*1/i);
  assert.match(binding, /app\.lukas_retention_purge_project/i);
  assert.match(binding, /current_user\s*=\s*pg_catalog\.pg_get_userbyid/i);
  assert.match(
    binding,
    /not exists\s*\(\s*select 1 from public\.lukas_qto_projects p\s+where p\.id=old\.project_id\s*\)/i,
  );
  assert.match(binding, /Drawing estimate bindings are append-only/i);
});
