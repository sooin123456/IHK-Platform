import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

const migrationDirectory = new URL("../supabase/migrations/", import.meta.url);

async function readP6Migration() {
  const names = (await readdir(migrationDirectory)).filter((name) =>
    name.endsWith("_drawing_workspace_p6_lineage.sql"),
  );
  assert.deepEqual(names, ["20260827210000_drawing_workspace_p6_lineage.sql"]);
  return readFile(new URL(names[0], migrationDirectory), "utf8");
}

test("P6 creates only the companion lineage tables with least privilege", async () => {
  const sql = await readP6Migration();
  const tables = [
    "lukas_drawing_quantity_links",
    "lukas_drawing_boq_links",
    "lukas_drawing_material_links",
  ];
  for (const table of tables) {
    assert.match(sql, new RegExp(`create table public\\.${table}\\b`, "i"));
    assert.match(
      sql,
      new RegExp(
        `alter table public\\.${table} enable row level security`,
        "i",
      ),
    );
    assert.match(
      sql,
      new RegExp(
        `grant select on table public\\.${table} to authenticated`,
        "i",
      ),
    );
  }
  assert.doesNotMatch(sql, /alter publication supabase_realtime add table/i);
  assert.doesNotMatch(sql, /user_metadata/i);
});

test("P6 fixes its six callable boundaries and preserves BOQ 1.0", async () => {
  const sql = await readP6Migration();
  for (const signature of [
    "private.lukas_drawing_insert_quantity_link",
    "public.lukas_drawing_put_boq_link",
    "public.lukas_drawing_delete_boq_link",
    "public.lukas_qto_boq_v1_1_input",
    "private.lukas_qto_finalize_boq_v1_1",
    "private.lukas_drawing_insert_material_handoff",
  ])
    assert.match(
      sql,
      new RegExp(
        `create(?: or replace)? function ${signature.replace(".", "\\.")}`,
        "i",
      ),
    );
  assert.match(
    sql,
    /engine_version[\s\S]*VERIFIED-BOQ-1\.0[\s\S]*VERIFIED-BOQ-1\.1/i,
  );
  assert.match(sql, /input_state_sha256[\s\S]*manifest_sha256/i);
  assert.match(sql, /P6Q02[\s\S]*P6M02/i);
});

test("P6 keeps fixed errors, immutable guards, ancestry FKs, and OCC visible", async () => {
  const sql = await readP6Migration();
  for (const code of [
    "P6A01",
    "P6Q01",
    "P6Q02",
    "P6Q03",
    "P6U01",
    "P6O01",
    "P6B04",
    "P6C01",
    "P6M01",
    "P6M02",
  ])
    assert.match(sql, new RegExp(code));
  assert.match(sql, /lukas_drawing_quantity_links_immutable/i);
  assert.match(sql, /lukas_drawing_material_links_immutable/i);
  assert.match(sql, /p_base_version bigint/i);
  assert.match(sql, /foreign key\s*\(boq_line_id,boq_version_id,project_id\)/i);
  assert.match(sql, /set search_path\s*=\s*''/i);
  assert.match(sql, /revoke all on function[\s\S]*from public,anon/i);
});
