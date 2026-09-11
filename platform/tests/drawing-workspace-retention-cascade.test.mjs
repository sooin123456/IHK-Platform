import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL(
  "../supabase/migrations/20260901000000_drawing_retention_purge_child_guards.sql",
  import.meta.url,
);
const revisionRepairMigrationUrl = new URL(
  "../supabase/migrations/20260902000000_drawing_revision_decision_entrypoint.sql",
  import.meta.url,
);
const documentRepairMigrationUrl = new URL(
  "../supabase/migrations/20260902001000_drawing_document_retention_purge_guard.sql",
  import.meta.url,
);

const functionDefinition = (sql, name) => {
  const start = sql.indexOf(`create or replace function private.${name}`);
  assert.notEqual(start, -1, `missing private.${name}`);
  const end = sql.indexOf("\n$$;", start);
  assert.notEqual(end, -1, `unterminated private.${name}`);
  return sql.slice(start, end + 4);
};

const assertExactPurgeBypass = (definition) => {
  assert.match(
    definition,
    /if\s+tg_op\s*=\s*'DELETE'\s+and\s+pg_catalog\.pg_trigger_depth\(\)\s*>\s*1\s+and\s+pg_catalog\.current_setting\s*\(\s*'app\.lukas_retention_purge_project',\s*true\s*\)\s*=\s*old\.project_id::text\s+and\s+current_user\s*=\s*pg_catalog\.pg_get_userbyid\s*\(\s*\(select c\.relowner from pg_catalog\.pg_class c where c\.oid\s*=\s*tg_relid\)\s*\)\s+and\s+not exists\s*\(\s*select 1 from public\.lukas_qto_projects p\s+where p\.id\s*=\s*old\.project_id\s*\)\s+then\s+return old\s*;/i,
  );
};

const assertBindingGuard = (definition) => {
  assertExactPurgeBypass(definition);
  assert.match(
    definition,
    /raise exception using errcode\s*=\s*'P1C01',\s*message\s*=\s*'Drawing estimate bindings are append-only'/i,
  );
};

test("retention purge bypasses drawing child auth only for its marked nested cascade", async () => {
  const sql = await readFile(migrationUrl, "utf8");

  for (const name of [
    "lukas_drawing_draft_child_guard",
    "lukas_drawing_layer_guard",
    "lukas_drawing_estimate_binding_guard",
  ]) {
    const definition = functionDefinition(sql, name);
    assertExactPurgeBypass(definition);
    if (name !== "lukas_drawing_estimate_binding_guard") {
      assert.match(definition, /if v_actor is null/i);
      assert.ok(
        definition.indexOf("app.lukas_retention_purge_project") <
          definition.indexOf("if v_actor is null"),
        `${name} must recognize the trusted cascade before actor rejection`,
      );
    }
  }

  const draft = functionDefinition(sql, "lukas_drawing_draft_child_guard");
  assert.match(draft, /security invoker/i);
  assert.match(draft, /Drawing workspace editor capability required/i);
  assert.match(
    functionDefinition(sql, "lukas_drawing_layer_guard"),
    /Source drawing layer is immutable/i,
  );
  assert.doesNotMatch(
    sql,
    /drop trigger|disable trigger|alter table[^;]*retention/i,
  );

  assertBindingGuard(
    functionDefinition(sql, "lukas_drawing_estimate_binding_guard"),
  );
});

test("binding purge guard rejects every weakened conjunction mutation", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  const binding = functionDefinition(
    sql,
    "lukas_drawing_estimate_binding_guard",
  );
  const mutate = (pattern, replacement) => {
    const result = binding.replace(pattern, replacement);
    assert.notEqual(result, binding, `mutation did not match ${pattern}`);
    return result;
  };
  const mutations = [
    mutate(/tg_op='DELETE'/i, "tg_op='UPDATE'"),
    mutate(/tg_op='DELETE'\s+and/i, "tg_op='DELETE' or"),
    mutate(
      /pg_catalog\.pg_trigger_depth\(\)>1/i,
      "pg_catalog.pg_trigger_depth()>0",
    ),
    mutate(
      /app\.lukas_retention_purge_project/i,
      "app.lukas_retention_purge_project_other",
    ),
    mutate(/\)\s*=old\.project_id::text/i, ")<>old.project_id::text"),
    mutate(
      /current_user=pg_catalog\.pg_get_userbyid\([\s\S]*?\n\s*\)/i,
      "current_user=current_user",
    ),
    mutate(/not exists\(/i, "exists("),
    mutate(
      /Drawing estimate bindings are append-only/i,
      "Drawing estimate bindings may change",
    ),
  ];
  for (const weakened of mutations)
    assert.throws(() => assertBindingGuard(weakened));
});

test("trusted project purge can cascade through approved revisions and documents", async () => {
  const [revisionSql, documentSql] = await Promise.all([
    readFile(revisionRepairMigrationUrl, "utf8"),
    readFile(documentRepairMigrationUrl, "utf8"),
  ]);
  const revision = functionDefinition(
    revisionSql,
    "lukas_drawing_revision_guard",
  );
  const document = functionDefinition(
    documentSql,
    "lukas_drawing_document_guard",
  );
  assertExactPurgeBypass(revision);
  assertExactPurgeBypass(document);
  assert.ok(
    revision.indexOf("app.lukas_retention_purge_project") <
      revision.indexOf("Approved drawing revision is immutable"),
  );
  assert.ok(
    document.indexOf("app.lukas_retention_purge_project") <
      document.indexOf("Drawing document with a non-draft revision is immutable"),
  );
  assert.match(document, /Drawing document creation identity is immutable/i);
  assert.match(document, /Drawing source must be an immutable PDF or IFC/i);
});
