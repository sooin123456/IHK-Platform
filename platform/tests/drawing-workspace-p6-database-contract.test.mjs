import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";

const migrationDirectory = new URL("../supabase/migrations/", import.meta.url);

async function readP6Migration() {
  const names = (await readdir(migrationDirectory)).filter((name) =>
    name.endsWith("_drawing_workspace_p6_lineage.sql"),
  );
  assert.deepEqual(names, ["20260827210000_drawing_workspace_p6_lineage.sql"]);
  return readFile(new URL(names[0], migrationDirectory), "utf8");
}

const p6FoundationSql = `
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
create schema auth; create schema private; create schema extensions; create extension pgcrypto with schema extensions;
create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;
create table public.lukas_qto_projects(id uuid primary key,owner_id uuid references auth.users(id));
create table public.lukas_qto_project_members(project_id uuid,user_id uuid,role text,primary key(project_id,user_id));
create function private.lukas_qto_project_role(uuid) returns text language sql stable as $$ select 'owner' $$;
create function private.lukas_qto_verified_session() returns boolean language sql stable as $$ select true $$;
create table public.lukas_qto_files(id uuid primary key,project_id uuid,sha256 text,unique(id,project_id,sha256));
create table public.lukas_drawing_revisions(id uuid primary key,project_id uuid,status text);
create table public.lukas_drawing_snapshots(id uuid primary key,revision_id uuid,project_id uuid,revision_version bigint,sha256 text,canonical_json jsonb,schema_version smallint,unique(revision_id,project_id,revision_version,sha256));
create table public.lukas_drawing_objects(id uuid primary key,lineage_id uuid,revision_id uuid,project_id uuid,version bigint,status text,geometry jsonb,unique(id,revision_id,project_id));
create table public.lukas_drawing_revision_approvals(id uuid primary key,revision_id uuid,project_id uuid,subject_version bigint,snapshot_sha256 text,decision text);
create table public.lukas_qto_price_books(id uuid primary key,project_id uuid,source_file_id uuid,source_sha256 text,effective_date date,rights_basis text,unique(id,project_id));
create table public.lukas_qto_price_resources(id uuid primary key,project_id uuid,price_book_id uuid,resource_code text,resource_type text,resource_name text,specification text,unit text,unit_price_krw numeric,unique(id,project_id));
create table public.lukas_qto_boq_versions(id uuid primary key,project_id uuid,version_no int,created_by uuid,status text,engine_version text constraint lukas_qto_boq_versions_engine_version_check check(engine_version='VERIFIED-BOQ-1.0'),calculation_policy text,quantity_scale smallint,price_book_id uuid,result_sha256 text,direct_cost_krw numeric,line_count int,submitted_at timestamptz,approved_at timestamptz,created_at timestamptz default now(),unique(id,project_id));
create table public.lukas_qto_boq_lines(id uuid primary key,project_id uuid,version_id uuid,item_code text,unit text,signed_adjustment numeric,adjustment_reason text,unique(id,version_id,project_id));
create table public.lukas_qto_boq_rate_components(id uuid primary key,project_id uuid,version_id uuid,line_id uuid,resource_id uuid,coefficient numeric);
create table public.lukas_qto_boq_quantity_mappings(id uuid primary key,project_id uuid,version_id uuid,line_id uuid,source_file_id uuid,source_sha256 text,source_subject_key text,source_quantity numeric,factor numeric,unit text,element_ids text[]);
create table public.lukas_qto_boq_source_exclusions(id uuid primary key,project_id uuid,version_id uuid,source_file_id uuid,source_sha256 text,source_subject_key text,source_quantity numeric,unit text,element_ids text[],reason text);
create table public.lukas_qto_boq_sections(id uuid primary key,version_id uuid,parent_id uuid);
create table public.lukas_qto_boq_wbs_nodes(id uuid primary key,version_id uuid,parent_id uuid);
create table public.lukas_qto_boq_wbs_allocations(id uuid primary key,version_id uuid,line_id uuid,wbs_node_id uuid,allocation_percent numeric);
create table public.lukas_qto_boq_approvals(id uuid primary key,version_id uuid,decided_by uuid,decision text,note text);
create table public.lukas_qto_material_plans(id uuid primary key,project_id uuid,material_code text,material_name text,specification text,unit text,design_quantity numeric,allowance_rate numeric,required_quantity numeric,rule_id text,source_file_id uuid,source_sha256 text,created_by uuid,unique(id,project_id));
create function public.lukas_qto_guard_boq_version_transition() returns trigger language plpgsql as $$ begin return new; end $$;
create function public.lukas_qto_decide_boq(uuid,text,text) returns void language plpgsql as $$ begin end $$;
`;

test("P6 migration applies on a fresh executable PGlite authority and creates its indexed bridge", async () => {
  const db = new PGlite({ extensions: { pgcrypto } });
  try {
    await db.exec(p6FoundationSql);
    await db.exec(await readP6Migration());
    const tables = await db.query(
      `select relname from pg_class where relname like 'lukas_drawing_%_links' order by relname`,
    );
    assert.deepEqual(
      tables.rows.map((row) => row.relname),
      [
        "lukas_drawing_boq_links",
        "lukas_drawing_material_links",
        "lukas_drawing_quantity_links",
      ],
    );
    const indexes = await db.query(
      `select indexname from pg_indexes where indexname='lukas_drawing_boq_links_source_idx'`,
    );
    assert.equal(indexes.rows.length, 1);
    const measures = await db.query(`select
      private.lukas_drawing_p6_measure('{"type":"wall","start":{"x":0,"y":0},"end":{"x":3000,"y":4000}}','length') as wall,
      private.lukas_drawing_p6_measure('{"type":"opening","widthMillimeters":1200,"heightMillimeters":2100}','area') as opening,
      private.lukas_drawing_p6_measure('{"type":"space","boundary":[{"x":0,"y":0},{"x":4000,"y":0},{"x":4000,"y":3000},{"x":0,"y":3000}]}','area') as space`);
    assert.deepEqual(measures.rows[0], {
      wall: "5.000000000000",
      opening: "2.520000000000",
      space: "12.000000000000",
    });
    await db.exec(`
      insert into auth.users values ('60000000-0000-4000-8000-000000000099');
      insert into public.lukas_qto_projects values ('60000000-0000-4000-8000-000000000001','60000000-0000-4000-8000-000000000099');
      insert into public.lukas_drawing_revisions values ('60000000-0000-4000-8000-000000000002','60000000-0000-4000-8000-000000000001','approved');
      insert into public.lukas_drawing_snapshots values ('60000000-0000-4000-8000-000000000010','60000000-0000-4000-8000-000000000002','60000000-0000-4000-8000-000000000001',1,'c${"c".repeat(63)}','{}',2);
      insert into public.lukas_drawing_objects values ('60000000-0000-4000-8000-000000000003','60000000-0000-4000-8000-000000000011','60000000-0000-4000-8000-000000000002','60000000-0000-4000-8000-000000000001',1,'active','{}');
      insert into public.lukas_drawing_quantity_links(id,project_id,drawing_revision_id,drawing_revision_version,drawing_snapshot_sha256,drawing_object_id,drawing_object_lineage_id,drawing_object_version,object_fingerprint,measurement_kind,raw_quantity,unit,measurement_rule_version,created_by)
      values ('60000000-0000-4000-8000-000000000004','60000000-0000-4000-8000-000000000001','60000000-0000-4000-8000-000000000002',1,'c${"c".repeat(63)}','60000000-0000-4000-8000-000000000003','60000000-0000-4000-8000-000000000011',1,'d${"d".repeat(63)}','count',1,'EA','P4_MEASUREMENT_V1','60000000-0000-4000-8000-000000000099');
    `);
    await assert.rejects(
      db.exec(
        `update public.lukas_drawing_quantity_links set raw_quantity=2 where id='60000000-0000-4000-8000-000000000004'`,
      ),
      (error) => error.code === "P6Q02",
    );
  } finally {
    await db.close();
  }
});

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
