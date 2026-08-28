import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migrations = new URL("../supabase/migrations/", import.meta.url);

async function derivativeMigration() {
  const names = (await readdir(migrations)).filter((name) =>
    name.endsWith("_drawing_ifc_immutable_derivatives.sql"),
  );
  assert.equal(names.length, 1, "one forward CLI migration owns the contract");
  return readFile(new URL(names[0], migrations), "utf8");
}

test("IFC derivative table binds immutable artifacts to an immutable IFC source", async () => {
  const sql = await derivativeMigration();
  assert.match(sql, /create table public\.lukas_drawing_ifc_derivatives/i);
  assert.match(
    sql,
    /foreign key\s*\(source_file_id,project_id,source_sha256\)/i,
  );
  assert.match(sql, /schema_version\s+integer\s+not null/i);
  assert.match(sql, /manifest_sha256[\s\S]*geometry_sha256/i);
  assert.match(sql, /status[\s\S]*pending[\s\S]*ready[\s\S]*failed/i);
  assert.match(sql, /before update or delete[\s\S]*immutable/i);
});

test("IFC derivative RLS is project-scoped and exposes no client mutation path", async () => {
  const sql = await derivativeMigration();
  assert.match(sql, /enable row level security/i);
  assert.match(
    sql,
    /create policy[\s\S]*for select[\s\S]*private\.lukas_qto_project_role\(project_id\)/i,
  );
  assert.match(sql, /revoke all on table[\s\S]*anon,authenticated/i);
  assert.match(sql, /grant select on table[\s\S]*to authenticated/i);
  assert.doesNotMatch(sql, /create policy[\s\S]*for (?:insert|update|delete)/i);
});

test("approved revisions cannot lose their IFC derivative evidence", async () => {
  const sql = await derivativeMigration();
  assert.match(
    sql,
    /lukas_drawing_revisions[\s\S]*status\s+in\s*\('approved','superseded'\)[\s\S]*cannot mutate approved IFC derivative evidence/i,
  );
});

test("PGlite enforces immutable source identity and approved derivative denial", async () => {
  const db = new PGlite();
  await db.exec(`
    create schema auth; create schema private;
    create role anon; create role authenticated; create role service_role;
    create table auth.users(id uuid primary key);
    create table public.lukas_qto_projects(id uuid primary key);
    create table public.lukas_qto_files(
      id uuid not null, project_id uuid not null, sha256 text not null,
      kind text not null, immutable boolean not null,
      primary key(id), unique(id,project_id,sha256)
    );
    create table public.lukas_drawing_documents(
      id uuid primary key, project_id uuid not null, source_file_id uuid
    );
    create table public.lukas_drawing_revisions(
      id uuid primary key, document_id uuid not null, project_id uuid not null,
      status text not null
    );
    create table public.lukas_drawing_object_sources(
      id uuid primary key, revision_id uuid not null, project_id uuid not null,
      source_file_id uuid not null
    );
    create function private.lukas_qto_project_role(uuid) returns text
      language sql stable as $$ select 'owner'::text $$;
  `);
  await db.exec(await derivativeMigration());
  const actor = "10000000-0000-4000-8000-000000000001";
  const project = "10000000-0000-4000-8000-000000000002";
  const source = "10000000-0000-4000-8000-000000000003";
  const derivative = "10000000-0000-4000-8000-000000000004";
  const sha = "a".repeat(64);
  await db.exec(`
    insert into auth.users values('${actor}');
    insert into public.lukas_qto_projects values('${project}');
    insert into public.lukas_qto_files
      values('${source}','${project}','${sha}','ifc',true);
    insert into public.lukas_drawing_ifc_derivatives(
      id,project_id,source_file_id,source_sha256,version,schema_version,status,created_by
    ) values('${derivative}','${project}','${source}','${sha}',1,1,'pending','${actor}');
  `);
  await assert.rejects(
    db.exec(
      `update public.lukas_drawing_ifc_derivatives set status='failed' where id='${derivative}'`,
    ),
    /immutable/i,
  );
  await db.exec(`
    insert into public.lukas_drawing_documents
      values('10000000-0000-4000-8000-000000000005','${project}','${source}');
    insert into public.lukas_drawing_revisions
      values('10000000-0000-4000-8000-000000000006','10000000-0000-4000-8000-000000000005','${project}','approved');
  `);
  await assert.rejects(
    db.exec(
      `delete from public.lukas_drawing_ifc_derivatives where id='${derivative}'`,
    ),
    /cannot mutate approved IFC derivative evidence/i,
  );
  await db.close();
});
