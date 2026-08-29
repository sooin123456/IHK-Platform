import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";

const migrationsDirectory = new URL("../supabase/migrations/", import.meta.url);
const p7Fixture = new URL(
  "./fixtures/drawing-workspace-p7-real-postgres.sql",
  import.meta.url,
);

test("a fresh Supabase-compatible PostgreSQL replays every committed migration", async () => {
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
        grant all on tables to anon,authenticated,service_role;
      alter default privileges in schema public
        grant all on sequences to anon,authenticated,service_role;
      alter default privileges in schema public
        grant all on functions to anon,authenticated,service_role;
      create table auth.users(
        id uuid primary key,
        email text,
        email_confirmed_at timestamptz,
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

    const names = (await readdir(migrationsDirectory))
      .filter((name) => name.endsWith(".sql"))
      .sort();
    for (const name of names)
      await db.exec(await readFile(new URL(name, migrationsDirectory), "utf8"));

    const { rows } = await db.query(`select
      pg_catalog.to_regclass('public.lukas_qto_projects')::text projects,
      pg_catalog.to_regclass('public.lukas_drawing_objects')::text objects,
      pg_catalog.to_regclass('public.lukas_drawing_quantity_links')::text quantities,
      pg_catalog.to_regclass('public.lukas_qto_restore_runs')::text restores,
      pg_catalog.to_regclass('public.lukas_drawing_ifc_derivatives')::text ifc_derivatives`);
    assert.deepEqual(rows[0], {
      projects: "lukas_qto_projects",
      objects: "lukas_drawing_objects",
      quantities: "lukas_drawing_quantity_links",
      restores: "lukas_qto_restore_runs",
      ifc_derivatives: "lukas_drawing_ifc_derivatives",
    });

    await db.exec(await readFile(p7Fixture, "utf8"));
    const { rows: prerequisites } = await db.query(`select
      (select pg_catalog.count(*)::integer from public.lukas_qto_organization_members
        where organization_id='70000000-0000-4000-8000-000000000101'
          and role in('owner','admin','member')) organization_members,
      (select pg_catalog.count(*)::integer from public.lukas_qto_organization_entitlement_versions
        where organization_id='70000000-0000-4000-8000-000000000101') entitlements,
      (select pg_catalog.count(*)::integer from public.lukas_drawing_library_versions
        where organization_id='70000000-0000-4000-8000-000000000101'
          and status='published') published_library_versions,
      (select pg_catalog.count(*)::integer from public.lukas_qto_material_transactions
        where project_id='70000000-0000-4000-8000-000000000201') material_transactions`);
    assert.deepEqual(prerequisites[0], {
      organization_members: 3,
      entitlements: 1,
      published_library_versions: 1,
      material_transactions: 1,
    });
  } finally {
    await db.close();
  }
});

test("the local P7 fixture satisfies real PostgreSQL gate prerequisites", async () => {
  const sql = await readFile(p7Fixture, "utf8");
  assert.match(sql, /lukas_qto_organization_members/i);
  assert.match(sql, /lukas_qto_organization_entitlement_versions/i);
  assert.match(sql, /lukas_drawing_library_versions/i);
  assert.match(sql, /lukas_qto_material_transactions/i);
});
