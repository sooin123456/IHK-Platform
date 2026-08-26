import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

import { DrawingGeometrySchema } from "../app/lukas/lib/drawing-workspace.types.ts";
import {
  invalidP4Geometries,
  validP4Geometries,
} from "./fixtures/drawing-workspace-p4-database-fixtures.mjs";

const migrationDirectory = new URL("../supabase/migrations/", import.meta.url);

async function p4Migration() {
  const names = (await readdir(migrationDirectory)).filter((name) =>
    name.endsWith("_drawing_workspace_p4_semantic_objects.sql"),
  );
  assert.equal(names.length, 1, "P4 uses exactly one CLI-generated migration");
  return readFile(new URL(names[0], migrationDirectory), "utf8");
}

test("P4 shared geometry corpus is mutation-resistant at the TypeScript authority", () => {
  for (const geometry of validP4Geometries)
    assert.equal(DrawingGeometrySchema.safeParse(geometry).success, true, geometry.type);
  for (const [name, geometry] of invalidP4Geometries)
    assert.equal(DrawingGeometrySchema.safeParse(geometry).success, false, name);
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
  assert.match(sql, /revoke all on function[\s\S]*from public,anon,authenticated,service_role/i);
  assert.match(sql, /grant execute on function private\.lukas_drawing_apply_operation[\s\S]*to authenticated,service_role/i);
  assert.doesNotMatch(sql, /create\s+table\s+public\.[^;]*(measurement|semantic)/i);
  assert.doesNotMatch(sql, /create\s+(?:or replace\s+)?function\s+public\.[^(]*(measurement|semantic)/i);
  assert.doesNotMatch(sql, /alter\s+table\s+(?:public\.)?lukas_qto_files/i);
  assert.doesNotMatch(sql, /realtime\./i);
});

test("P4 SQL contracts preserve primitive blocks while widening object properties", async () => {
  const sql = await p4Migration();
  for (const type of [
    "line", "polyline", "rectangle", "circle", "text", "dimension",
    "wall", "opening", "space", "area", "grid", "arc",
  ]) assert.match(sql, new RegExp(`'${type}'`));
  assert.match(sql, /p2_block_primitives_valid[\s\S]*\('line','polyline','rectangle','circle','text','dimension'\)/i);
  assert.match(sql, /p2_property_schema_json_valid[\s\S]*'wall'[\s\S]*'opening'[\s\S]*'space'[\s\S]*'area'[\s\S]*'grid'[\s\S]*'arc'/i);
});
