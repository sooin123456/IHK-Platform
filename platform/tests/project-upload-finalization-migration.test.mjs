import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";

const migrations = [
  new URL(
    "../supabase/migrations/20260831012000_lukas_qto_source_storage_immutable.sql",
    import.meta.url,
  ),
  new URL(
    "../supabase/migrations/20260831015000_lukas_qto_verified_source_insert_gate.sql",
    import.meta.url,
  ),
];

async function setupDatabase() {
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;
    create schema auth;
    create schema extensions;
    create schema storage;
    create extension pgcrypto with schema extensions;
    create table auth.users(
      id uuid primary key,
      raw_app_meta_data jsonb not null default '{}'::jsonb
    );
    create function auth.jwt() returns jsonb language sql stable set search_path='' as $$
      select coalesce(nullif(pg_catalog.current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)
    $$;
    create function auth.uid() returns uuid language sql stable set search_path='' as $$
      select (nullif(pg_catalog.current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid
    $$;
    create table public.lukas_qto_projects(
      id uuid primary key default extensions.gen_random_uuid(),
      owner_id uuid not null references auth.users(id)
    );
    create table public.lukas_qto_project_members(
      project_id uuid not null references public.lukas_qto_projects(id),
      user_id uuid not null references auth.users(id),
      role text not null,
      primary key(project_id,user_id)
    );
    create table public.lukas_qto_files(
      id uuid primary key default extensions.gen_random_uuid(),
      project_id uuid not null references public.lukas_qto_projects(id),
      uploaded_by uuid not null references auth.users(id),
      kind text not null,
      storage_path text not null unique,
      original_filename text not null,
      content_type text,
      byte_size bigint not null,
      sha256 text not null,
      immutable boolean not null default true,
      created_at timestamptz not null default pg_catalog.clock_timestamp(),
      unique(id,project_id,sha256)
    );
    alter table public.lukas_qto_files enable row level security;
    create policy "project contributors add immutable files"
      on public.lukas_qto_files for insert to authenticated
      with check(
        uploaded_by=auth.uid()
        and immutable=true
      );
    create table public.lukas_qto_file_revisions(
      id uuid primary key default extensions.gen_random_uuid(),
      project_id uuid not null references public.lukas_qto_projects(id),
      previous_file_id uuid not null unique,
      previous_sha256 text not null,
      current_file_id uuid not null unique,
      current_sha256 text not null,
      relation_kind text not null,
      created_by uuid not null references auth.users(id),
      created_at timestamptz not null default pg_catalog.clock_timestamp(),
      foreign key(previous_file_id,project_id,previous_sha256)
        references public.lukas_qto_files(id,project_id,sha256),
      foreign key(current_file_id,project_id,current_sha256)
        references public.lukas_qto_files(id,project_id,sha256)
    );
    create table storage.buckets(id text primary key);
    create table storage.objects(
      id uuid primary key default extensions.gen_random_uuid(),
      bucket_id text not null references storage.buckets(id),
      name text not null
    );
    create function storage.foldername(text) returns text[] language sql immutable as $$
      select pg_catalog.string_to_array($1,'/')
    $$;
    insert into storage.buckets(id) values('lukas-qto');
    alter table storage.objects enable row level security;
    create policy "lukas qto owners read their source files"
      on storage.objects for select to authenticated
      using(bucket_id='lukas-qto' and (storage.foldername(name))[1]=(select auth.uid()::text));
    create policy "lukas qto owners delete their source files"
      on storage.objects for delete to authenticated
      using(bucket_id='lukas-qto' and (storage.foldername(name))[1]=(select auth.uid()::text));
    create policy "hangil staff delete source files"
      on storage.objects for delete to authenticated
      using(bucket_id='lukas-qto' and (select auth.jwt()->'app_metadata'->>'role')='hangil_staff');
    grant usage on schema public,auth,storage to authenticated,service_role;
    grant execute on function auth.jwt(),auth.uid(),storage.foldername(text) to authenticated,service_role;
    grant select,insert on public.lukas_qto_files to authenticated;
    grant select,delete on storage.objects to authenticated;
    grant all on all tables in schema public,auth,storage to service_role;
  `);
  for (const migration of migrations)
    await db.exec(await readFile(migration, "utf8"));
  return db;
}

test("verified source finalization is service-only, atomic, linear and idempotent", async () => {
  const db = await setupDatabase();
  const actorId = "70000000-0000-4000-8000-000000000901";
  const projectId = "70000000-0000-4000-8000-000000000902";
  const firstVerificationId = "70000000-0000-4000-8000-000000000911";
  const secondVerificationId = "70000000-0000-4000-8000-000000000912";
  const duplicateVerificationId = "70000000-0000-4000-8000-000000000913";
  const path = (suffix) =>
    `${actorId}/${projectId}/source-uploads/${suffix}.pdf`;

  try {
    await db.query("insert into auth.users(id) values($1)", [actorId]);
    await db.query(
      "insert into public.lukas_qto_projects(id,owner_id) values($1,$2)",
      [projectId, actorId],
    );
    await db.query(
      `insert into public.lukas_qto_project_members(project_id,user_id,role)
       values($1,$2,'owner')`,
      [projectId, actorId],
    );
    await db.query(
      `insert into public.lukas_qto_verified_uploads(
         id,actor_id,project_id,kind,storage_path,original_filename,
         content_type,byte_size,sha256
       ) values($1,$2,$3,'pdf',$4,'A-101.pdf','application/pdf',8,$5)`,
      [
        firstVerificationId,
        actorId,
        projectId,
        path("70000000-0000-4000-8000-000000000921"),
        "a".repeat(64),
      ],
    );

    await db.exec("set role authenticated");
    await db.query("select set_config('request.jwt.claims',$1,false)", [
      JSON.stringify({ role: "authenticated", sub: actorId }),
    ]);
    await assert.rejects(
      db.query("select public.lukas_qto_finalize_verified_upload($1,$2,$3)", [
        firstVerificationId,
        actorId,
        projectId,
      ]),
      /permission denied/i,
    );
    await db.exec("reset role");

    await db.exec("set role service_role");
    await db.query("select set_config('request.jwt.claims',$1,false)", [
      JSON.stringify({ role: "service_role" }),
    ]);
    const { rows: created } = await db.query(
      "select public.lukas_qto_finalize_verified_upload($1,$2,$3) result",
      [firstVerificationId, actorId, projectId],
    );
    const firstFileId = created[0].result.fileId;
    const { rows: replayed } = await db.query(
      "select public.lukas_qto_finalize_verified_upload($1,$2,$3) result",
      [firstVerificationId, actorId, projectId],
    );
    assert.equal(replayed[0].result.fileId, firstFileId);

    await db.query(
      `insert into public.lukas_qto_verified_uploads(
         id,actor_id,project_id,kind,storage_path,original_filename,
         content_type,byte_size,sha256
       ) values
         ($1,$3,$4,'pdf',$5,'A-102.pdf','application/pdf',8,$7),
         ($2,$3,$4,'pdf',$6,'A-102-copy.pdf','application/pdf',8,$7)`,
      [
        secondVerificationId,
        duplicateVerificationId,
        actorId,
        projectId,
        path("70000000-0000-4000-8000-000000000922"),
        path("70000000-0000-4000-8000-000000000923"),
        "b".repeat(64),
      ],
    );
    const { rows: second } = await db.query(
      "select public.lukas_qto_finalize_verified_upload($1,$2,$3) result",
      [secondVerificationId, actorId, projectId],
    );
    assert.equal(second[0].result.previousFileId, firstFileId);
    await assert.rejects(
      db.query("select public.lukas_qto_finalize_verified_upload($1,$2,$3)", [
        duplicateVerificationId,
        actorId,
        projectId,
      ]),
      /same content/i,
    );

    const { rows: graph } = await db.query(
      `select
         (select count(*)::integer from public.lukas_qto_files where project_id=$1) files,
         (select count(*)::integer from public.lukas_qto_file_revisions where project_id=$1) revisions,
         (select count(*)::integer from public.lukas_qto_verified_uploads
          where project_id=$1 and consumed_file_id is not null) consumed,
         (select consumed_file_id is null from public.lukas_qto_verified_uploads
          where id=$2) duplicate_retryable`,
      [projectId, duplicateVerificationId],
    );
    assert.deepEqual(graph[0], {
      consumed: 2,
      duplicate_retryable: true,
      files: 2,
      revisions: 1,
    });
  } finally {
    await db.close();
  }
});

test("source-uploads are immutable without breaking legacy authenticated cleanup", async () => {
  const db = await setupDatabase();
  const actorId = "70000000-0000-4000-8000-000000000901";
  const projectId = "70000000-0000-4000-8000-000000000902";
  const legacyPath = `${actorId}/${projectId}/70000000-0000-4000-8000-000000000921.pdf`;
  const sourcePath = `${actorId}/${projectId}/source-uploads/70000000-0000-4000-8000-000000000922.pdf`;

  try {
    await db.query("insert into auth.users(id) values($1)", [actorId]);
    await db.query(
      "insert into public.lukas_qto_projects(id,owner_id) values($1,$2)",
      [projectId, actorId],
    );
    await db.query(
      `insert into storage.objects(bucket_id,name)
       values('lukas-qto',$1),('lukas-qto',$2)`,
      [legacyPath, sourcePath],
    );
    await db.exec("set role authenticated");
    await db.query("select set_config('request.jwt.claims',$1,false)", [
      JSON.stringify({ role: "authenticated", sub: actorId }),
    ]);
    const { rows: authContext } = await db.query(
      "select auth.uid() uid,auth.jwt() jwt",
    );
    assert.equal(authContext[0].uid, actorId);
    await db.query("delete from storage.objects where name in($1,$2)", [
      legacyPath,
      sourcePath,
    ]);
    await db.exec("reset role");
    const { rows: retained } = await db.query(
      "select name from storage.objects order by name",
    );
    assert.deepEqual(retained, [{ name: sourcePath }]);
  } finally {
    await db.close();
  }
});

test("authenticated clients cannot bypass verification by inserting source metadata", async () => {
  const db = await setupDatabase();
  const actorId = "70000000-0000-4000-8000-000000000901";
  const projectId = "70000000-0000-4000-8000-000000000902";
  const sourcePath = `${actorId}/${projectId}/source-uploads/70000000-0000-4000-8000-000000000921.pdf`;
  const legacyPath = `${actorId}/${projectId}/70000000-0000-4000-8000-000000000922.json`;

  try {
    await db.query("insert into auth.users(id) values($1)", [actorId]);
    await db.query(
      "insert into public.lukas_qto_projects(id,owner_id) values($1,$2)",
      [projectId, actorId],
    );
    await db.exec("set role authenticated");
    await db.query("select set_config('request.jwt.claims',$1,false)", [
      JSON.stringify({ role: "authenticated", sub: actorId }),
    ]);

    for (const [kind, storagePath] of [
      ["pdf", sourcePath],
      ["other", sourcePath],
      ["pdf", legacyPath],
    ]) {
      await assert.rejects(
        db.query(
          `insert into public.lukas_qto_files(
             project_id,uploaded_by,kind,storage_path,original_filename,
             content_type,byte_size,sha256,immutable
           ) values($1,$2,$3,$4,'forged.pdf','application/pdf',8,$5,true)`,
          [projectId, actorId, kind, storagePath, "f".repeat(64)],
        ),
        /row-level security/i,
      );
    }

    await db.query(
      `insert into public.lukas_qto_files(
         project_id,uploaded_by,kind,storage_path,original_filename,
         content_type,byte_size,sha256,immutable
       ) values($1,$2,'other',$3,'derived.json','application/json',8,$4,true)`,
      [projectId, actorId, legacyPath, "a".repeat(64)],
    );
    await db.exec("reset role");

    const { rows } = await db.query(
      "select kind,storage_path from public.lukas_qto_files where project_id=$1",
      [projectId],
    );
    assert.deepEqual(rows, [{ kind: "other", storage_path: legacyPath }]);
  } finally {
    await db.close();
  }
});
