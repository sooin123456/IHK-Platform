import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

import {
  DrawingGeometrySchema,
  DrawingObjectNameSchema,
  DrawingPropertySchemaSchema,
} from "../app/lukas/lib/drawing-workspace.types.ts";
import {
  invalidP4Geometries,
  invalidP4PropertySchemas,
  p4ObjectNameCorpus,
  p4PersistedExactNameConsumers,
  validP4Geometries,
  validP4PropertySchemas,
} from "./fixtures/drawing-workspace-p4-database-fixtures.mjs";

const migrationDirectory = new URL("../supabase/migrations/", import.meta.url);

async function p4Migration() {
  const names = (await readdir(migrationDirectory)).filter((name) =>
    name.endsWith("_drawing_workspace_p4_semantic_objects.sql"),
  );
  assert.equal(names.length, 1, "P4 uses exactly one CLI-generated migration");
  return readFile(new URL(names[0], migrationDirectory), "utf8");
}

async function p4ContractFixMigration() {
  const names = (await readdir(migrationDirectory)).filter((name) =>
    name.endsWith("_drawing_workspace_p4_semantic_object_contract_fixes.sql"),
  );
  assert.equal(
    names.length,
    1,
    "P4 contract fixes use exactly one new CLI-generated forward migration",
  );
  return readFile(new URL(names[0], migrationDirectory), "utf8");
}

async function p4FinalContractFixMigration() {
  const names = (await readdir(migrationDirectory)).filter((name) =>
    name.endsWith("_drawing_workspace_p4_final_contract_fixes.sql"),
  );
  assert.equal(
    names.length,
    1,
    "P4 final contract fixes use one CLI-generated forward migration",
  );
  return readFile(new URL(names[0], migrationDirectory), "utf8");
}

async function p4FinalNameAuthorityMigration() {
  const names = (await readdir(migrationDirectory)).filter((name) =>
    name.endsWith("_drawing_workspace_p4_final_name_authority.sql"),
  );
  assert.equal(
    names.length,
    1,
    "P4 global name authority uses one CLI-generated forward migration",
  );
  return readFile(new URL(names[0], migrationDirectory), "utf8");
}

test("P4 shared geometry corpus is mutation-resistant at the TypeScript authority", () => {
  for (const geometry of validP4Geometries)
    assert.equal(
      DrawingGeometrySchema.safeParse(geometry).success,
      true,
      geometry.type,
    );
  for (const [name, geometry] of invalidP4Geometries)
    assert.equal(
      DrawingGeometrySchema.safeParse(geometry).success,
      false,
      name,
    );
});

test("P4 shared object-name corpus enforces exact UTF-16, trim, Unicode, and control rules", () => {
  for (const [name, value, expected] of p4ObjectNameCorpus)
    assert.equal(
      DrawingObjectNameSchema.safeParse(value).success,
      expected,
      name,
    );
});

test("P4 shared property-schema corpus requires distinct appliesTo targets", () => {
  for (const schema of validP4PropertySchemas)
    assert.equal(DrawingPropertySchemaSchema.safeParse(schema).success, true);
  for (const [name, schema] of invalidP4PropertySchemas)
    assert.equal(
      DrawingPropertySchemaSchema.safeParse(schema).success,
      false,
      name,
    );
});

test("P4 forward migration keeps semantic persistence private and additive", async () => {
  const sql = await p4Migration();
  assert.match(sql, /begin;[\s\S]*commit;/i);
  assert.match(sql, /generated always as[\s\S]*hostWallId[\s\S]*stored/i);
  assert.match(sql, /foreign key\s*\(host_object_id,revision_id,project_id\)/i);
  assert.match(sql, /deferrable initially deferred/i);
  assert.match(sql, /lukas_drawing_p4_semantic_graph_valid/i);
  assert.match(sql, /lukas_drawing_apply_operation_pre_p4_semantic_objects/i);
  assert.match(sql, /set search_path\s*=\s*''/i);
  assert.match(
    sql,
    /revoke all on function[\s\S]*from public,anon,authenticated,service_role/i,
  );
  assert.match(
    sql,
    /grant execute on function private\.lukas_drawing_apply_operation[\s\S]*to authenticated,service_role/i,
  );
  assert.doesNotMatch(
    sql,
    /create\s+table\s+public\.[^;]*(measurement|semantic)/i,
  );
  assert.doesNotMatch(
    sql,
    /create\s+(?:or replace\s+)?function\s+public\.[^(]*(measurement|semantic)/i,
  );
  assert.doesNotMatch(sql, /alter\s+table\s+(?:public\.)?lukas_qto_files/i);
  assert.doesNotMatch(sql, /realtime\./i);
});

test("P4 contract fixes stay private, additive, and behind the existing operation RPC", async () => {
  const sql = await p4ContractFixMigration();
  assert.match(sql, /begin;[\s\S]*commit;/i);
  assert.match(sql, /lukas_drawing_p4_utf16_string_valid/i);
  assert.match(sql, /lukas_drawing_objects_p4_utf16_strings_check/i);
  assert.match(sql, /lukas_drawing_geometry_valid_pre_p4_contract_fixes/i);
  assert.match(sql, /lukas_drawing_apply_operation_pre_p4_contract_fixes/i);
  assert.match(
    sql,
    /p_base_versions\s+is\s+distinct\s+from[\s\S]*v_expected_put_bases/i,
  );
  assert.match(sql, /set search_path\s*=\s*''/i);
  assert.match(
    sql,
    /revoke all on function[\s\S]*from public,anon,authenticated,service_role/i,
  );
  assert.match(
    sql,
    /grant execute on function private\.lukas_drawing_apply_operation[\s\S]*to authenticated,service_role/i,
  );
  assert.doesNotMatch(sql, /create\s+table\s+public\./i);
  assert.doesNotMatch(sql, /create\s+(?:or replace\s+)?function\s+public\./i);
  assert.doesNotMatch(sql, /alter\s+table\s+public\.lukas_qto_files/i);
  assert.doesNotMatch(sql, /realtime\./i);
});

test("P4 final name fix replaces the exact private helper and object constraint forward-only", async () => {
  const sql = await p4FinalContractFixMigration();
  assert.match(sql, /begin;[\s\S]*commit;/i);
  assert.match(
    sql,
    /create or replace function private\.lukas_drawing_p2_name/i,
  );
  assert.match(sql, /lukas_drawing_p4_utf16_string_valid/i);
  assert.match(sql, /lukas_drawing_p4_js_trim_codepoint/i);
  assert.match(
    sql,
    /drop constraint if exists lukas_drawing_objects_name_contract/i,
  );
  assert.match(sql, /add constraint lukas_drawing_objects_name_contract/i);
  assert.match(
    sql,
    /private\.lukas_drawing_p2_name\(pg_catalog\.to_jsonb\(name\)\)/i,
  );
  assert.match(sql, /set search_path\s*=\s*''/i);
  assert.doesNotMatch(sql, /create\s+table\s+public\./i);
  assert.doesNotMatch(sql, /alter\s+table\s+public\.lukas_qto_files/i);
});

test("P4 final global name authority preflights and constrains every strict persisted consumer", async () => {
  const sql = await p4FinalNameAuthorityMigration();
  assert.match(sql, /begin;[\s\S]*commit;/i);
  assert.match(sql, /lukas_drawing_p4_array_names_valid/i);
  assert.match(sql, /errcode\s*=\s*'P1C01'/i);
  for (const [consumer, table, column] of p4PersistedExactNameConsumers) {
    assert.match(sql, new RegExp(table), consumer);
    assert.match(sql, new RegExp(column), consumer);
  }
  for (const constraint of [
    "pages_name_contract",
    "canvases_name_contract",
    "layers_name_contract",
    "objects_name_contract",
    "styles_name_contract",
    "blocks_name_contract",
    "blocks_primitive_names_contract",
    "block_instances_name_contract",
    "property_schemas_name_contract",
    "property_schemas_enum_option_names_contract",
    "tables_name_contract",
    "tables_column_names_contract",
  ])
    assert.match(sql, new RegExp(constraint), constraint);
  assert.match(
    sql,
    /drop constraint if exists lukas_drawing_pages_name_check/i,
  );
  assert.match(sql, /set search_path\s*=\s*''/i);
  assert.doesNotMatch(sql, /create\s+(?:or replace\s+)?function\s+public\./i);
  assert.doesNotMatch(sql, /create\s+table\s+public\./i);
  assert.doesNotMatch(sql, /realtime\./i);
});

test("P4 SQL contracts preserve primitive blocks while widening object properties", async () => {
  const sql = await p4Migration();
  for (const type of [
    "line",
    "polyline",
    "rectangle",
    "circle",
    "text",
    "dimension",
    "wall",
    "opening",
    "space",
    "area",
    "grid",
    "arc",
  ])
    assert.match(sql, new RegExp(`'${type}'`));
  assert.match(
    sql,
    /p2_block_primitives_valid[\s\S]*\('line','polyline','rectangle','circle','text','dimension'\)/i,
  );
  assert.match(
    sql,
    /p2_property_schema_json_valid[\s\S]*'wall'[\s\S]*'opening'[\s\S]*'space'[\s\S]*'area'[\s\S]*'grid'[\s\S]*'arc'/i,
  );
});
