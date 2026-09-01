import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";

async function m1Sql() {
  const directory = new URL("../supabase/migrations/", import.meta.url);
  const names = await readdir(directory);
  const matches = names.filter((name) =>
    name.endsWith("_universal_workspace_m1.sql"),
  );
  assert.equal(matches.length, 1);
  return readFile(new URL(matches[0], directory), "utf8");
}

test("M1 creation is retry-safe and estimate bindings are append-only", async () => {
  const sql = await m1Sql();
  assert.match(sql, /add column creation_request_id uuid/i);
  assert.match(sql, /creation_request_sha256 text/i);
  assert.match(sql, /where creation_request_id is not null/i);
  assert.match(sql, /lukas\.drawing_creation_identity/i);
  assert.match(sql, /Drawing document creation identity is immutable/i);
  assert.match(sql, /pg_advisory_xact_lock/i);
  assert.match(sql, /Request ID does not match the stored drawing creation/i);
  assert.match(
    sql,
    /function public\.lukas_drawing_create_document_idempotent[\s\S]*?language sql security invoker/i,
  );
  assert.match(sql, /create table private\.lukas_drawing_platform_starters/i);
  assert.match(sql, /source_kind text not null default 'project_revision'/i);
  assert.match(sql, /platform_starter_key text/i);
  assert.match(sql, /lukas_drawing_library_versions_platform_starter_key/i);
  assert.match(
    sql,
    /function public\.lukas_drawing_list_platform_starters[\s\S]*?security invoker/i,
  );
  assert.match(
    sql,
    /function public\.lukas_drawing_ensure_platform_starter_version[\s\S]*?security invoker/i,
  );
  assert.match(
    sql,
    /function public\.lukas_drawing_record_platform_starter_import[\s\S]*?security invoker/i,
  );
  assert.match(sql, /create table public\.lukas_drawing_estimate_bindings/i);
  assert.match(sql, /unique\s*\(drawing_revision_id\)/i);
  assert.match(sql, /unique\s*\(boq_version_id\)/i);
  assert.match(
    sql,
    /alter table public\.lukas_drawing_estimate_bindings enable row level security/i,
  );
  assert.match(
    sql,
    /revoke all on public\.lukas_drawing_estimate_bindings\s+from public,anon,authenticated,service_role/i,
  );
  assert.match(
    sql,
    /grant select,insert on public\.lukas_drawing_estimate_bindings[\s\S]*to authenticated/i,
  );
  assert.match(
    sql,
    /grant select on public\.lukas_drawing_estimate_bindings[\s\S]*to service_role/i,
  );
  assert.match(sql, /Drawing estimate bindings are append-only/i);
  assert.doesNotMatch(sql, /lukas_qto_project_retention_dependencies/i);
});

test("M1 protects private helpers and preserves narrow public invokers", async () => {
  const sql = await m1Sql();
  assert.match(
    sql,
    /revoke all on function private\.lukas_drawing_document_creation_result\(uuid\)[\s\S]*?from public,anon,authenticated,service_role/i,
  );
  assert.match(
    sql,
    /revoke all on table private\.lukas_drawing_platform_starters[\s\S]*?from public,anon,authenticated,service_role/i,
  );
  assert.match(
    sql,
    /private\.lukas_drawing_create_document_idempotent\([\s\S]*?\) returns jsonb language plpgsql security definer set search_path=''/i,
  );
  for (const name of [
    "create_document_idempotent",
    "ensure_platform_starter_version",
    "record_platform_starter_import",
  ]) {
    const header = sql.match(
      new RegExp(
        `function public\\.lukas_drawing_${name}\\([\\s\\S]*?\\) returns jsonb language (?:sql|plpgsql) security (invoker|definer)`,
        "i",
      ),
    );
    assert.ok(header, name);
    assert.equal(header[1].toLowerCase(), "invoker", name);
  }
});

test("M1 executable migration returns one starter version and one retry-safe document", async () => {
  const db = new PGlite({ extensions: { pgcrypto } });
  try {
    await db.exec(`
      create role anon nologin;
      create role authenticated nologin;
      create role service_role nologin bypassrls;
      create role lukas_drawing_collaboration nologin;
      create publication supabase_realtime;
      create schema auth;
      create schema extensions;
      create schema private;
      create schema storage;
      create extension pgcrypto with schema extensions;
      alter default privileges in schema public
        grant all on sequences to anon,authenticated,service_role;
      alter default privileges in schema public
        grant all on functions to anon,authenticated,service_role;
      create table auth.users(
        id uuid primary key,email text,email_confirmed_at timestamptz,
        is_anonymous boolean not null default false,
        raw_app_meta_data jsonb not null default '{}'::jsonb,
        raw_user_meta_data jsonb not null default '{}'::jsonb
      );
      create function auth.uid() returns uuid language sql stable set search_path='' as $$
        select (nullif(pg_catalog.current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid
      $$;
      create function auth.jwt() returns jsonb language sql stable set search_path='' as $$
        select coalesce(nullif(pg_catalog.current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)
      $$;
      create table storage.buckets(
        id text primary key,name text not null,public boolean not null default false,
        file_size_limit bigint,allowed_mime_types text[]
      );
      create table storage.objects(
        id uuid primary key default extensions.gen_random_uuid(),
        bucket_id text not null references storage.buckets(id),name text not null
      );
      create function storage.foldername(text) returns text[] language sql immutable as $$
        select pg_catalog.string_to_array($1,'/')
      $$;
      grant usage on schema auth,storage to anon,authenticated,service_role;
      grant execute on function auth.uid(),auth.jwt(),storage.foldername(text)
        to anon,authenticated,service_role;
    `);
    const directory = new URL("../supabase/migrations/", import.meta.url);
    const names = (await readdir(directory))
      .filter((name) => name.endsWith(".sql"))
      .sort();
    for (const name of names)
      await db.exec(await readFile(new URL(name, directory), "utf8"));

    const actor = "71000000-0000-4000-8000-000000000001";
    const request = "71000000-0000-4000-8000-000000000002";
    await db.query(
      `insert into auth.users(id,email,email_confirmed_at,is_anonymous)
       values($1,'m1-owner@example.com',clock_timestamp(),false)`,
      [actor],
    );
    await db.exec("set role authenticated");
    await db.query("select set_config('request.jwt.claims',$1,false)", [
      JSON.stringify({
        sub: actor,
        role: "authenticated",
        email: "m1-owner@example.com",
        is_anonymous: false,
      }),
    ]);
    const { rows: projects } = await db.query(
      `insert into public.lukas_qto_projects(
        owner_id,name,description,contact_name,contact_phone,workflow_status
      ) values($1,'M1 Project','','','','inquiry_received')
      returning id,organization_id`,
      [actor],
    );
    const project = projects[0];
    const { rows: starters } = await db.query(
      `select key,version,name from public.lukas_drawing_list_platform_starters($1,$2)
       order by key`,
      [project.organization_id, project.id],
    );
    assert.deepEqual(
      starters.map(({ key, version }) => ({ key, version: Number(version) })),
      [
        { key: "apartment-remodel", version: 1 },
        { key: "commercial-interior", version: 1 },
        { key: "demolition-restoration", version: 1 },
        { key: "interior-basic", version: 1 },
      ],
    );
    const { rows: ensured } = await db.query(
      `select public.lukas_drawing_ensure_platform_starter_version(
        $1,$2,'interior-basic',1
      ) value`,
      [project.organization_id, project.id],
    );
    const { rows: ensuredRetry } = await db.query(
      `select public.lukas_drawing_ensure_platform_starter_version(
        $1,$2,'interior-basic',1
      ) value`,
      [project.organization_id, project.id],
    );
    assert.equal(ensuredRetry[0].value.versionId, ensured[0].value.versionId);

    const create = (title) =>
      db.query(
        `select public.lukas_drawing_create_document_idempotent(
          $1,null,$2,true,$3,null
        ) value`,
        [project.id, title, request],
      );
    const first = await create("M1 Workspace");
    const retry = await create("M1 Workspace");
    assert.equal(retry.rows[0].value.documentId, first.rows[0].value.documentId);
    await assert.rejects(create("Changed Workspace"), (error) => {
      assert.equal(error.code, "P1C01");
      assert.equal(
        error.message,
        "Request ID does not match the stored drawing creation",
      );
      return true;
    });
    const { rows: counts } = await db.query(
      `select pg_catalog.count(*)::integer count
       from public.lukas_drawing_documents
       where project_id=$1 and creation_request_id=$2`,
      [project.id, request],
    );
    assert.equal(counts[0].count, 1);
  } finally {
    await db.close();
  }
});
