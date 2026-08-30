import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

import { PGlite } from "@electric-sql/pglite";

const migrations = new URL("../supabase/migrations/", import.meta.url);

async function entitlementRlsFix() {
  const names = (await readdir(migrations)).filter((name) =>
    name.endsWith("_drawing_object_source_entitlement_rls.sql"),
  );
  assert.ok(names.length <= 1, "one forward migration owns the RLS repair");
  return names.length === 1
    ? readFile(new URL(names[0], migrations), "utf8")
    : "";
}

test("authenticated members read active object sources through the entitlement-aware RLS helper", async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create schema private;
      create role anon nologin;
      create role authenticated nologin;
      create role service_role nologin bypassrls;
      grant usage on schema private to authenticated,service_role;

      create function private.lukas_drawing_workspace_capability_pre_entitlement(uuid)
      returns text language sql stable security definer set search_path='' as $$
        select 'editor'::text
      $$;
      create function private.lukas_drawing_workspace_capability(p_project_id uuid)
      returns text language sql stable security definer set search_path='' as $$
        select case
          when pg_catalog.current_setting('app.drawing_workspace_enabled',true)='on'
            then private.lukas_drawing_workspace_capability_pre_entitlement(p_project_id)
          else null::text
        end
      $$;
      revoke all on function
        private.lukas_drawing_workspace_capability_pre_entitlement(uuid),
        private.lukas_drawing_workspace_capability(uuid)
      from public,authenticated,service_role;

      create table public.lukas_drawing_object_sources(
        id uuid primary key,
        project_id uuid not null,
        status text not null
      );
      alter table public.lukas_drawing_object_sources enable row level security;
      grant select on table public.lukas_drawing_object_sources to authenticated;
      create policy "project members read active drawing object sources"
      on public.lukas_drawing_object_sources for select to authenticated
      using (
        status='active'
        and (select private.lukas_drawing_workspace_capability_pre_entitlement(project_id)) is not null
      );
      insert into public.lukas_drawing_object_sources(id,project_id,status)
      values(
        '10000000-0000-4000-8000-000000000001',
        '10000000-0000-4000-8000-000000000002',
        'active'
      );
    `);

    const fix = await entitlementRlsFix();
    if (fix) await db.exec(fix);

    await db.exec("set role authenticated");
    await db.query(
      "select pg_catalog.set_config('app.drawing_workspace_enabled','on',false)",
    );
    const visible = await db.query(
      "select id from public.lukas_drawing_object_sources order by id",
    );
    assert.deepEqual(visible.rows, [
      { id: "10000000-0000-4000-8000-000000000001" },
    ]);

    await db.query(
      "select pg_catalog.set_config('app.drawing_workspace_enabled','off',false)",
    );
    const hidden = await db.query(
      "select id from public.lukas_drawing_object_sources order by id",
    );
    assert.deepEqual(hidden.rows, []);
  } finally {
    await db.exec("reset role").catch(() => undefined);
    await db.close();
  }
});
