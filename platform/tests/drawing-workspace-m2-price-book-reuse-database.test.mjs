import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

import { PGlite } from "@electric-sql/pglite";

async function migration() {
  const directory = new URL("../supabase/migrations/", import.meta.url);
  const matches = (await readdir(directory)).filter((name) =>
    name.endsWith("_organization_price_book_reuse_evidence.sql"),
  );
  assert.equal(matches.length, 1, "exactly one price-book reuse migration");
  return readFile(new URL(matches[0], directory), "utf8");
}

const ids = Object.freeze({
  organization: "78000000-0000-4000-8000-000000000001",
  otherOrganization: "78000000-0000-4000-8000-000000000002",
  owner: "78000000-0000-4000-8000-000000000003",
  admin: "78000000-0000-4000-8000-000000000004",
  member: "78000000-0000-4000-8000-000000000005",
  outsider: "78000000-0000-4000-8000-000000000006",
  projectSeoul: "78000000-0000-4000-8000-000000000101",
  projectBusan: "78000000-0000-4000-8000-000000000102",
  projectSingle: "78000000-0000-4000-8000-000000000103",
  otherProject: "78000000-0000-4000-8000-000000000104",
});

const repeatedSha = "a".repeat(64);
const singleSha = "b".repeat(64);

async function database() {
  const db = new PGlite();
  await db.exec(`
    create schema auth;
    create schema private;
    create role anon;
    create role authenticated;
    create role service_role;

    create function auth.uid() returns uuid language sql stable as $$
      select (nullif(pg_catalog.current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid
    $$;
    create function auth.jwt() returns jsonb language sql stable as $$
      select coalesce(nullif(pg_catalog.current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)
    $$;
    create function private.lukas_qto_verified_session()
    returns boolean language sql stable security invoker set search_path='' as $$
      select coalesce((select (auth.jwt()->>'is_anonymous')::boolean),false)=false
    $$;

    create table public.lukas_qto_organizations(
      id uuid primary key,
      name text not null,
      owner_id uuid not null
    );
    create table public.lukas_qto_organization_members(
      organization_id uuid not null references public.lukas_qto_organizations(id),
      user_id uuid not null,
      role text not null,
      primary key(organization_id,user_id)
    );
    create table public.lukas_qto_organization_entitlement_versions(
      organization_id uuid not null references public.lukas_qto_organizations(id),
      version_no integer not null,
      features jsonb not null,
      primary key(organization_id,version_no)
    );
    create table public.lukas_qto_projects(
      id uuid primary key,
      organization_id uuid not null references public.lukas_qto_organizations(id),
      name text not null
    );
    create table public.lukas_qto_price_books(
      id uuid primary key,
      project_id uuid not null references public.lukas_qto_projects(id),
      source_sha256 text not null
    );

    create function private.lukas_qto_organization_role(p_organization_id uuid)
    returns text language sql stable security definer set search_path='' as $$
      select case
        when (select auth.jwt()->'app_metadata'->>'role')='hangil_staff' then 'staff'
        when o.owner_id=(select auth.uid()) then 'owner'
        else (select m.role from public.lukas_qto_organization_members m
          where m.organization_id=o.id and m.user_id=(select auth.uid()))
      end
      from public.lukas_qto_organizations o where o.id=p_organization_id
    $$;
    create function private.lukas_qto_organization_manager(p_organization_id uuid)
    returns boolean language sql stable security definer set search_path='' as $$
      select coalesce((select auth.uid()) is not null
        and private.lukas_qto_organization_role(p_organization_id)
          in('owner','admin','staff'),false)
    $$;
    create function private.lukas_qto_organization_feature_active(
      p_organization_id uuid,p_feature text
    ) returns boolean language sql stable security definer set search_path='' as $$
      select coalesce((select (e.features->>p_feature)::boolean
        from public.lukas_qto_organization_entitlement_versions e
        where e.organization_id=p_organization_id
        order by e.version_no desc limit 1),false)
    $$;

    insert into public.lukas_qto_organizations(id,name,owner_id) values
      ('${ids.organization}','1HK','${ids.owner}'),
      ('${ids.otherOrganization}','Other','${ids.outsider}');
    insert into public.lukas_qto_organization_members(
      organization_id,user_id,role
    ) values
      ('${ids.organization}','${ids.owner}','owner'),
      ('${ids.organization}','${ids.admin}','admin'),
      ('${ids.organization}','${ids.member}','member'),
      ('${ids.otherOrganization}','${ids.outsider}','owner');
    insert into public.lukas_qto_organization_entitlement_versions(
      organization_id,version_no,features
    ) values
      ('${ids.organization}',1,
        '{"organization_library":true,"quantity_lineage":true}'),
      ('${ids.otherOrganization}',1,
        '{"organization_library":true,"quantity_lineage":true}');
    insert into public.lukas_qto_projects(id,organization_id,name) values
      ('${ids.projectSeoul}','${ids.organization}','서울'),
      ('${ids.projectBusan}','${ids.organization}','부산'),
      ('${ids.projectSingle}','${ids.organization}','단일'),
      ('${ids.otherProject}','${ids.otherOrganization}','타 조직');
    insert into public.lukas_qto_price_books(id,project_id,source_sha256) values
      ('78000000-0000-4000-8000-000000000201','${ids.projectSeoul}','${repeatedSha}'),
      ('78000000-0000-4000-8000-000000000202','${ids.projectSeoul}','${repeatedSha}'),
      ('78000000-0000-4000-8000-000000000203','${ids.projectBusan}','${repeatedSha}'),
      ('78000000-0000-4000-8000-000000000204','${ids.projectSingle}','${singleSha}'),
      ('78000000-0000-4000-8000-000000000205','${ids.otherProject}','${repeatedSha}');
  `);
  await db.exec(await migration());
  return db;
}

async function setActor(
  db,
  role,
  userId,
  { anonymous = false, staff = false } = {},
) {
  await db.exec("reset role");
  await db.exec(`set role ${role}`);
  await db.query(
    "select pg_catalog.set_config('request.jwt.claims',$1,false)",
    [
      JSON.stringify({
        role,
        sub: userId,
        is_anonymous: anonymous,
        app_metadata: staff ? { role: "hangil_staff" } : {},
      }),
    ],
  );
}

test("reuse evidence RPC is read-only, manager-only, entitlement-bound, and organization-exact", async () => {
  const db = await database();
  try {
    await setActor(db, "authenticated", ids.owner);
    const owner = await db.query(
      "select * from public.lukas_qto_list_organization_price_book_reuse_candidates($1)",
      [ids.organization],
    );
    assert.deepEqual(owner.rows, [
      {
        source_sha256: repeatedSha,
        project_count: 2,
        price_book_count: 3,
        projects: [
          { id: ids.projectBusan, name: "부산" },
          { id: ids.projectSeoul, name: "서울" },
        ],
      },
    ]);

    await setActor(db, "authenticated", ids.admin);
    const admin = await db.query(
      "select source_sha256 from public.lukas_qto_list_organization_price_book_reuse_candidates($1)",
      [ids.organization],
    );
    assert.deepEqual(admin.rows, [{ source_sha256: repeatedSha }]);

    await setActor(db, "authenticated", ids.owner, { anonymous: true });
    await assert.rejects(
      db.query(
        "select * from public.lukas_qto_list_organization_price_book_reuse_candidates($1)",
        [ids.organization],
      ),
      /authority denied/i,
    );

    for (const userId of [ids.member, ids.outsider]) {
      await setActor(db, "authenticated", userId);
      await assert.rejects(
        db.query(
          "select * from public.lukas_qto_list_organization_price_book_reuse_candidates($1)",
          [ids.organization],
        ),
        /authority denied/i,
      );
    }

    await setActor(db, "service_role", ids.owner);
    const trusted = await db.query(
      "select source_sha256 from public.lukas_qto_list_organization_price_book_reuse_candidates($1)",
      [ids.organization],
    );
    assert.equal(trusted.rows[0].source_sha256, repeatedSha);

    await db.exec("reset role");
    await db.query(
      `update public.lukas_qto_organization_entitlement_versions
       set features='{"organization_library":true,"quantity_lineage":false}'
       where organization_id=$1`,
      [ids.organization],
    );
    await setActor(db, "authenticated", ids.owner);
    await assert.rejects(
      db.query(
        "select * from public.lukas_qto_list_organization_price_book_reuse_candidates($1)",
        [ids.organization],
      ),
      /entitlement is unavailable/i,
    );
  } finally {
    await db.close();
  }
});

test("signed-out callers cannot execute the evidence RPC and no registry table is introduced", async () => {
  const db = await database();
  try {
    await setActor(db, "anon", null);
    await assert.rejects(
      db.query(
        "select * from public.lukas_qto_list_organization_price_book_reuse_candidates($1)",
        [ids.organization],
      ),
      /permission denied/i,
    );
    await db.exec("reset role");
    const grants = await db.query(`
      select
        pg_catalog.has_function_privilege(
          'authenticated',
          'public.lukas_qto_list_organization_price_book_reuse_candidates(uuid)',
          'EXECUTE'
        ) authenticated_execute,
        pg_catalog.has_function_privilege(
          'service_role',
          'public.lukas_qto_list_organization_price_book_reuse_candidates(uuid)',
          'EXECUTE'
        ) service_execute,
        pg_catalog.has_function_privilege(
          'anon',
          'public.lukas_qto_list_organization_price_book_reuse_candidates(uuid)',
          'EXECUTE'
        ) anon_execute
    `);
    assert.deepEqual(grants.rows, [
      {
        authenticated_execute: true,
        service_execute: true,
        anon_execute: false,
      },
    ]);
    const registry = await db.query(`
      select pg_catalog.count(*)::integer count
      from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relname like '%price_book%registry%'
    `);
    assert.equal(registry.rows[0].count, 0);
  } finally {
    await db.close();
  }
});
