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

async function bindingMigration() {
  const names = (await readdir(migrations)).filter((name) =>
    name.endsWith("_drawing_ifc_derivative_revision_binding.sql"),
  );
  assert.equal(
    names.length,
    1,
    "one forward CLI migration owns revision pinning",
  );
  return readFile(new URL(names[0], migrations), "utf8");
}

async function storageHardeningMigration() {
  const names = (await readdir(migrations)).filter((name) =>
    name.endsWith("_drawing_ifc_derivative_storage_hardening.sql"),
  );
  assert.equal(
    names.length,
    1,
    "one forward migration owns derivative storage hardening",
  );
  return readFile(new URL(names[0], migrations), "utf8");
}

test("authenticated storage policies cannot replace derivative artifacts", async () => {
  const db = new PGlite();
  await db.exec(`
    create schema storage;
    create role authenticated;
    grant usage on schema storage to authenticated;
    create table storage.objects(bucket_id text not null,name text not null,payload text not null);
    grant select,insert,update,delete on storage.objects to authenticated;
    create policy permissive_select on storage.objects for select to authenticated using(true);
    create policy permissive_update on storage.objects for update to authenticated using(true) with check(true);
    create policy permissive_delete on storage.objects for delete to authenticated using(true);
    alter table storage.objects enable row level security;
    insert into storage.objects values
      ('lukas-qto','projects/20000000-0000-4000-8000-000000000002/ifc-derivatives/${"a".repeat(64)}/v1/${"b".repeat(64)}.glb','immutable'),
      ('lukas-qto','projects/20000000-0000-4000-8000-000000000002/uploads/model.ifc','ordinary');
  `);
  await db.exec(await storageHardeningMigration());
  await db.exec("set role authenticated");
  await assert.rejects(
    db.exec(`insert into storage.objects values(
      'lukas-qto',
      'projects/20000000-0000-4000-8000-000000000002/ifc-derivatives/not-content-addressed.glb',
      'replacement'
    )`),
    /row-level security/i,
  );
  await db.exec("update storage.objects set payload='changed'");
  await db.exec("delete from storage.objects where name like '%/uploads/%'");
  await db.exec("reset role");
  const rows = await db.query(
    "select name,payload from storage.objects order by name",
  );
  assert.deepEqual(rows.rows, [
    {
      name: `projects/20000000-0000-4000-8000-000000000002/ifc-derivatives/${"a".repeat(64)}/v1/${"b".repeat(64)}.glb`,
      payload: "immutable",
    },
  ]);
  await db.close();
});

test("review freeze pins one exact content-addressed derivative per revision source", async () => {
  const sql = await bindingMigration();
  assert.match(
    sql,
    /create table public\.lukas_drawing_revision_ifc_derivatives/i,
  );
  assert.match(sql, /unique\(revision_id,revision_version,source_file_id\)/i);
  assert.match(
    sql,
    /derivative_id[\s\S]*derivative_version[\s\S]*manifest_sha256[\s\S]*geometry_sha256/i,
  );
  assert.match(
    sql,
    /alter function private\.lukas_drawing_request_review\(uuid\)[\s\S]*lukas_drawing_bind_ifc_derivatives/i,
  );
  assert.match(
    sql,
    /status='ready'[\s\S]*order by d\.version desc,d\.id desc limit 1/i,
  );
  assert.match(
    sql,
    /ifc-derivatives[\s\S]*manifest_byte_size[\s\S]*geometry_byte_size/i,
  );
});

test("revision derivative bindings are project-scoped immutable read evidence", async () => {
  const sql = await bindingMigration();
  assert.match(sql, /enable row level security/i);
  assert.match(
    sql,
    /for select to authenticated[\s\S]*lukas_qto_project_role\(project_id\) is not null/i,
  );
  assert.match(sql, /bindings are immutable[\s\S]*before update or delete/i);
  assert.doesNotMatch(sql, /create policy[\s\S]*for (?:insert|update|delete)/i);
});

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
      id uuid primary key, project_id uuid not null, source_file_id uuid,
      unique(id,project_id)
    );
    create table public.lukas_drawing_revisions(
      id uuid primary key, document_id uuid not null, project_id uuid not null,
      status text not null, version bigint not null default 1,
      unique(id,project_id)
    );
    create table public.lukas_drawing_object_sources(
      id uuid primary key, revision_id uuid not null, project_id uuid not null,
      source_file_id uuid not null, source_sha256 text not null,
      status text not null default 'active', source_kind text not null default 'ifc_element'
    );
    create function auth.uid() returns uuid language sql stable
      as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create function private.lukas_qto_project_role(uuid) returns text
      language sql stable as $$
        select case when $1='10000000-0000-4000-8000-000000000002'::uuid
          then 'owner'::text end
      $$;
    create function private.lukas_drawing_workspace_capability(uuid) returns text
      language sql stable as $$ select 'editor'::text $$;
    create function private.lukas_drawing_request_review(uuid) returns jsonb
      language sql as $$ select '{}'::jsonb $$;
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
      values('10000000-0000-4000-8000-000000000006','10000000-0000-4000-8000-000000000005','${project}','approved',1);
  `);
  await assert.rejects(
    db.exec(
      `delete from public.lukas_drawing_ifc_derivatives where id='${derivative}'`,
    ),
    /cannot mutate approved IFC derivative evidence/i,
  );
  await db.exec(await bindingMigration());
  const manifestSha = "b".repeat(64);
  const geometrySha = "c".repeat(64);
  const prefix = `projects/${project}/ifc-derivatives/${sha}/v2`;
  await db.exec(`
    set request.jwt.claim.sub='${actor}';
    insert into public.lukas_drawing_ifc_derivatives(
      id,project_id,source_file_id,source_sha256,version,schema_version,status,
      manifest_json,manifest_storage_path,manifest_byte_size,manifest_sha256,
      geometry_storage_path,geometry_byte_size,geometry_sha256,created_by
    ) values(
      '10000000-0000-4000-8000-000000000007','${project}','${source}','${sha}',2,1,'ready',
      '{"schemaVersion":1,"source":{"fileId":"${source}","sha256":"${sha}"},"geometry":{"sha256":"${geometrySha}"},"elements":[]}',
      '${prefix}/${manifestSha}.json',256,'${manifestSha}',
      '${prefix}/${geometrySha}.glb',128,'${geometrySha}','${actor}'
    );
    insert into public.lukas_drawing_documents
      values('10000000-0000-4000-8000-000000000008','${project}','${source}');
    insert into public.lukas_drawing_revisions
      values('10000000-0000-4000-8000-000000000009','10000000-0000-4000-8000-000000000008','${project}','draft',7);
    select private.lukas_drawing_request_review(
      '10000000-0000-4000-8000-000000000009'
    );
    update public.lukas_drawing_revisions set status='approved'
    where id='10000000-0000-4000-8000-000000000009';
    insert into public.lukas_drawing_ifc_derivatives(
      id,project_id,source_file_id,source_sha256,version,schema_version,status,created_by
    ) values(
      '10000000-0000-4000-8000-000000000010','${project}','${source}','${sha}',3,1,'pending','${actor}'
    );
  `);
  const pinned = await db.query(`
    select derivative_version,manifest_sha256,geometry_sha256
    from public.lukas_drawing_revision_ifc_derivatives
    where revision_id='10000000-0000-4000-8000-000000000009'
  `);
  assert.deepEqual(pinned.rows, [
    {
      derivative_version: 2,
      manifest_sha256: manifestSha,
      geometry_sha256: geometrySha,
    },
  ]);
  const foreignProject = "10000000-0000-4000-8000-000000000011";
  const foreignSource = "10000000-0000-4000-8000-000000000012";
  const foreignSourceSha = "d".repeat(64);
  const foreignManifestSha = "e".repeat(64);
  const foreignGeometrySha = "f".repeat(64);
  const foreignPrefix = `projects/${foreignProject}/ifc-derivatives/${foreignSourceSha}/v1`;
  await db.exec(`
    insert into public.lukas_qto_projects values('${foreignProject}');
    insert into public.lukas_qto_files
      values('${foreignSource}','${foreignProject}','${foreignSourceSha}','ifc',true);
    insert into public.lukas_drawing_ifc_derivatives(
      id,project_id,source_file_id,source_sha256,version,schema_version,status,
      manifest_json,manifest_storage_path,manifest_byte_size,manifest_sha256,
      geometry_storage_path,geometry_byte_size,geometry_sha256,created_by
    ) values(
      '10000000-0000-4000-8000-000000000013','${foreignProject}','${foreignSource}','${foreignSourceSha}',1,1,'ready',
      '{"schemaVersion":1,"source":{"fileId":"${foreignSource}","sha256":"${foreignSourceSha}"},"geometry":{"sha256":"${foreignGeometrySha}"},"elements":[]}',
      '${foreignPrefix}/${foreignManifestSha}.json',256,'${foreignManifestSha}',
      '${foreignPrefix}/${foreignGeometrySha}.glb',128,'${foreignGeometrySha}','${actor}'
    );
    insert into public.lukas_drawing_documents
      values('10000000-0000-4000-8000-000000000014','${foreignProject}','${foreignSource}');
    insert into public.lukas_drawing_revisions
      values('10000000-0000-4000-8000-000000000015','10000000-0000-4000-8000-000000000014','${foreignProject}','approved',1);
    insert into public.lukas_drawing_revision_ifc_derivatives(
      id,revision_id,revision_version,project_id,source_file_id,source_sha256,
      derivative_id,derivative_version,manifest_sha256,geometry_sha256,created_by
    ) values(
      '10000000-0000-4000-8000-000000000016','10000000-0000-4000-8000-000000000015',1,
      '${foreignProject}','${foreignSource}','${foreignSourceSha}',
      '10000000-0000-4000-8000-000000000013',1,'${foreignManifestSha}','${foreignGeometrySha}','${actor}'
    );
    set role authenticated;
  `);
  const visible = await db.query(
    `select project_id from public.lukas_drawing_revision_ifc_derivatives order by project_id`,
  );
  assert.deepEqual(visible.rows, [{ project_id: project }]);
  await db.exec("reset role");
  await db.close();
});
