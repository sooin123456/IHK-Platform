import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import postgres from "postgres";

import { calculateVerifiedBoq } from "../app/lukas/lib/verified-boq.server.ts";
import {
  applyP6AuthorityFixture,
  p6Ids,
  p6LegacyInput,
  p6SeedPopulatedAuthority,
  p6SetSession,
  readP6Migration,
} from "./fixtures/drawing-workspace-p6-database-fixtures.mjs";

const migrations = new URL("../supabase/migrations/", import.meta.url);

async function migration() {
  const matches = (await readdir(migrations)).filter((name) =>
    name.endsWith("_drawing_workspace_retention_restore.sql"),
  );
  assert.equal(matches.length, 1, "exactly one Task 5 forward migration");
  return readFile(new URL(matches[0], migrations), "utf8");
}

test("retention migration replaces project deletion with guarded archive authority", async () => {
  const sql = await migration();
  assert.match(
    sql,
    /alter table public\.lukas_qto_projects[\s\S]*archived_at/i,
  );
  assert.match(sql, /deletion_requested_at/i);
  assert.match(sql, /purge_after/i);
  assert.match(sql, /drop policy if exists "project owners delete projects"/i);
  assert.match(
    sql,
    /revoke delete on table public\.lukas_qto_projects from authenticated,service_role/i,
  );
  assert.match(sql, /before update or delete on public\.lukas_qto_projects/i);
  assert.match(sql, /lukas_qto_archive_project/i);
  assert.match(sql, /lukas_qto_request_project_deletion/i);
});

test("policy, hold, lifecycle, and restore evidence are append-only organization records", async () => {
  const sql = await migration();
  for (const table of [
    "lukas_qto_retention_policy_versions",
    "lukas_qto_retention_events",
    "lukas_qto_restore_runs",
  ]) {
    assert.match(sql, new RegExp(`create table public\\.${table}`, "i"));
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
        `revoke all on table public\\.${table} from anon,authenticated,service_role`,
        "i",
      ),
    );
  }
  assert.match(
    sql,
    /before update or delete on public\.lukas_qto_retention_policy_versions/i,
  );
  assert.match(
    sql,
    /before update or delete on public\.lukas_qto_retention_events/i,
  );
  assert.match(
    sql,
    /before update or delete on public\.lukas_qto_restore_runs/i,
  );
  assert.match(sql, /legal_hold_placed/i);
  assert.match(sql, /legal_hold_released/i);
  assert.match(
    sql,
    /private\.lukas_qto_organization_role\(organization_id\) is not null/i,
  );
  assert.doesNotMatch(sql, /to authenticated\s+using\s*\(\s*true\s*\)/i);
});

test("trusted purge is service-only and proves expiry, holds, and protected dependencies", async () => {
  const sql = await migration();
  assert.match(
    sql,
    /create or replace function public\.lukas_qto_purge_project/i,
  );
  assert.match(sql, /security definer set search_path=''/i);
  assert.match(sql, /auth\.jwt\(\)->>'role'[^;]*service_role/i);
  assert.match(sql, /purge_after/i);
  assert.match(sql, /legal_hold_placed/i);
  assert.match(sql, /legal_hold_released/i);
  for (const dependency of [
    "lukas_drawing_revision_approvals",
    "lukas_drawing_quantity_links",
    "lukas_drawing_boq_links",
    "lukas_drawing_material_links",
    "lukas_drawing_library_versions",
    "lukas_qto_files",
  ])
    assert.match(sql, new RegExp(dependency, "i"));
  assert.match(
    sql,
    /grant execute on function public\.lukas_qto_purge_project[\s\S]*to service_role/i,
  );
  assert.doesNotMatch(
    sql,
    /grant execute on function public\.lukas_qto_purge_project[\s\S]*to authenticated/i,
  );
});

test("restore records bind provider identity, database, storage, Yjs, approval, and lineage evidence", async () => {
  const sql = await migration();
  for (const column of [
    "provider_backup_id",
    "provider_restore_project_ref",
    "provider_restore_created_at",
    "schema_sha256",
    "database_sha256",
    "storage_sha256",
    "yjs_sha256",
    "approval_sha256",
    "lineage_sha256",
    "rpo_seconds",
    "rto_seconds",
  ])
    assert.match(sql, new RegExp(`${column} `, "i"));
  assert.match(
    sql,
    /create or replace function public\.lukas_qto_record_restore_run/i,
  );
  assert.match(
    sql,
    /grant execute on function public\.lukas_qto_record_restore_run[\s\S]*to service_role/i,
  );
});

const runtimeIds = Object.freeze({
  organization: "73000000-0000-4000-8000-000000000001",
  otherOrganization: "73000000-0000-4000-8000-000000000002",
  emptyProject: "73000000-0000-4000-8000-000000000003",
  policyRequest: "73000000-0000-4000-8000-000000000004",
  archiveRequest: "73000000-0000-4000-8000-000000000005",
  deleteRequest: "73000000-0000-4000-8000-000000000006",
  emptyDeleteRequest: "73000000-0000-4000-8000-000000000007",
  hold: "73000000-0000-4000-8000-000000000008",
  holdRequest: "73000000-0000-4000-8000-000000000009",
  releaseRequest: "73000000-0000-4000-8000-00000000000a",
  purgeHeldRequest: "73000000-0000-4000-8000-00000000000b",
  purgeRequest: "73000000-0000-4000-8000-00000000000c",
});

async function runtimeDatabase() {
  const db = new PGlite({ extensions: { pgcrypto } });
  await applyP6AuthorityFixture(db);
  await db.exec(await readP6Migration());
  await db.exec(`
    create table public.lukas_qto_organizations(
      id uuid primary key,name text not null,owner_id uuid not null references auth.users(id),
      is_personal boolean not null default false,created_at timestamptz not null default now()
    );
    create table public.lukas_qto_organization_members(
      organization_id uuid not null references public.lukas_qto_organizations(id),
      user_id uuid not null references auth.users(id),role text not null,
      created_at timestamptz not null default now(),primary key(organization_id,user_id)
    );
    alter table public.lukas_qto_projects add column organization_id uuid;
    create function private.lukas_qto_organization_role(p_organization_id uuid)
    returns text language sql stable security definer set search_path='' as $$
      select case when (select auth.jwt()->'app_metadata'->>'role')='hangil_staff' then 'staff'
        when o.owner_id=(select auth.uid()) then 'owner'
        else (select m.role from public.lukas_qto_organization_members m
          where m.organization_id=o.id and m.user_id=(select auth.uid())) end
      from public.lukas_qto_organizations o where o.id=p_organization_id
    $$;
    create table public.lukas_drawing_issue_approvals(
      id uuid primary key,project_id uuid not null,decision text not null
    );
    create table public.lukas_drawing_library_versions(
      id uuid primary key,source_project_id uuid not null,status text not null
    );
    create table public.lukas_drawing_library_imports(
      id uuid primary key,project_id uuid not null
    );
    grant execute on function private.lukas_qto_organization_role(uuid) to authenticated,service_role;
  `);
  await db.exec(await migration());
  await p6SeedPopulatedAuthority(db, calculateVerifiedBoq(p6LegacyInput));
  await p6SetSession(db, null);
  await db.query(
    `insert into public.lukas_qto_organizations(id,name,owner_id) values
      ($1,'1HK',$2),($3,'Other',$4)`,
    [
      runtimeIds.organization,
      p6Ids.owner,
      runtimeIds.otherOrganization,
      p6Ids.otherOwner,
    ],
  );
  await db.query(
    `insert into public.lukas_qto_organization_members(organization_id,user_id,role)
      values($1,$2,'owner'),($3,$4,'owner')`,
    [
      runtimeIds.organization,
      p6Ids.owner,
      runtimeIds.otherOrganization,
      p6Ids.otherOwner,
    ],
  );
  await db.query(
    `update public.lukas_qto_projects set organization_id=case when id=$1::uuid then $2::uuid else $3::uuid end`,
    [p6Ids.project, runtimeIds.organization, runtimeIds.otherOrganization],
  );
  await db.query(
    `insert into public.lukas_qto_projects(id,owner_id,name,description,organization_id)
      values($1,$2,'Empty','purge fixture',$3)`,
    [runtimeIds.emptyProject, p6Ids.owner, runtimeIds.organization],
  );
  return db;
}

test("PGlite archives and holds approved project evidence through exact organization RPCs", async (context) => {
  const db = await runtimeDatabase();
  context.after(() => db.close());
  await p6SetSession(db, null, p6Ids.owner);
  await db.query(
    `select (public.lukas_qto_set_retention_policy($1,0,2555,'company policy',$2)).id`,
    [runtimeIds.organization, runtimeIds.policyRequest],
  );
  await db.query(
    `select (public.lukas_qto_archive_project($1,$2,'archive approved project',$3)).id`,
    [runtimeIds.organization, p6Ids.project, runtimeIds.archiveRequest],
  );
  const {
    rows: [requested],
  } = await db.query(
    `select (public.lukas_qto_request_project_deletion($1,$2,'requested by admin',$3)).evidence as evidence`,
    [runtimeIds.organization, p6Ids.project, runtimeIds.deleteRequest],
  );
  assert.equal(requested.evidence.approvedEvidence, true);
  const {
    rows: [project],
  } = await db.query(
    `select archived_at is not null archived,deletion_requested_at is not null requested,
      purge_after>now() held from public.lukas_qto_projects where id=$1`,
    [p6Ids.project],
  );
  assert.deepEqual(project, { archived: true, requested: true, held: true });
  await assert.rejects(
    db.query(`delete from public.lukas_qto_projects where id=$1`, [
      p6Ids.project,
    ]),
    /must be archived and purged/i,
  );
  await assert.rejects(
    db.query(
      `update public.lukas_qto_retention_events set reason='changed' where project_id=$1`,
      [p6Ids.project],
    ),
    /append-only/i,
  );
  await p6SetSession(db, null, p6Ids.otherOwner);
  const {
    rows: [crossRole],
  } = await db.query(
    `select auth.uid() actor,private.lukas_qto_organization_role($1) role`,
    [runtimeIds.organization],
  );
  assert.deepEqual(crossRole, { actor: p6Ids.otherOwner, role: null });
  await assert.rejects(
    db.query(`select public.lukas_qto_archive_project($1,$2,'cross org',$3)`, [
      runtimeIds.organization,
      p6Ids.project,
      crypto.randomUUID(),
    ]),
    /authority denied/i,
  );
});

test("PGlite legal hold blocks trusted purge until release and empty dependency proof", async (context) => {
  const db = await runtimeDatabase();
  context.after(() => db.close());
  await p6SetSession(db, null, p6Ids.owner);
  await db.query(
    `select public.lukas_qto_set_retention_policy($1,0,2555,'immediate empty cleanup',$2)`,
    [runtimeIds.organization, runtimeIds.policyRequest],
  );
  await db.query(
    `select public.lukas_qto_request_project_deletion($1,$2,'empty fixture',$3)`,
    [
      runtimeIds.organization,
      runtimeIds.emptyProject,
      runtimeIds.emptyDeleteRequest,
    ],
  );
  await db.query(
    `select public.lukas_qto_place_legal_hold($1,$2,$3,'investigation',$4)`,
    [
      runtimeIds.organization,
      runtimeIds.emptyProject,
      runtimeIds.hold,
      runtimeIds.holdRequest,
    ],
  );
  await db.exec(
    `select pg_catalog.set_config('request.jwt.claims','{"role":"service_role"}',false)`,
  );
  const {
    rows: [held],
  } = await db.query(
    `select public.lukas_qto_purge_project($1,$2,$3,'scheduled purge') result`,
    [
      runtimeIds.organization,
      runtimeIds.emptyProject,
      runtimeIds.purgeHeldRequest,
    ],
  );
  assert.equal(held.result.reason, "legal_hold_active");
  await p6SetSession(db, null, p6Ids.owner);
  await db.query(
    `select public.lukas_qto_release_legal_hold($1,$2,$3,'hold cleared',$4)`,
    [
      runtimeIds.organization,
      runtimeIds.emptyProject,
      runtimeIds.hold,
      runtimeIds.releaseRequest,
    ],
  );
  await db.exec(
    `select pg_catalog.set_config('request.jwt.claims','{"role":"service_role"}',false)`,
  );
  const {
    rows: [purged],
  } = await db.query(
    `select public.lukas_qto_purge_project($1,$2,$3,'scheduled purge') result`,
    [runtimeIds.organization, runtimeIds.emptyProject, runtimeIds.purgeRequest],
  );
  assert.equal(purged.result.status, "PURGED");
  const {
    rows: [remaining],
  } = await db.query(
    `select count(*)::int count from public.lukas_qto_projects where id=$1`,
    [runtimeIds.emptyProject],
  );
  assert.equal(remaining.count, 0);
});

const realPostgresUrl = process.env.P7_REAL_POSTGRES_DATABASE_URL;
const realPostgresRequired = process.env.P7_REAL_POSTGRES_REQUIRED === "1";

if (!realPostgresUrl) {
  test(
    "real PostgreSQL proves retention RLS, grants, and invoker guards",
    { skip: !realPostgresRequired },
    () => assert.fail("P7_REAL_POSTGRES_DATABASE_URL is required"),
  );
} else {
  test("real PostgreSQL proves retention RLS, grants, and invoker guards", async () => {
    const sql = postgres(realPostgresUrl, { max: 1, prepare: false });
    try {
      const tables = await sql`
        select c.relname,c.relrowsecurity,
          pg_catalog.has_table_privilege('authenticated',c.oid,'SELECT') can_select,
          pg_catalog.has_table_privilege('authenticated',c.oid,'INSERT') can_insert,
          pg_catalog.has_table_privilege('authenticated',c.oid,'UPDATE') can_update,
          pg_catalog.has_table_privilege('authenticated',c.oid,'DELETE') can_delete
        from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
        where n.nspname='public' and c.relname in (
          'lukas_qto_retention_policy_versions','lukas_qto_retention_events',
          'lukas_qto_restore_runs') order by c.relname`;
      assert.equal(tables.length, 3);
      for (const row of tables) {
        assert.equal(row.relrowsecurity, true, row.relname);
        assert.equal(row.can_select, true, row.relname);
        assert.equal(row.can_insert, false, row.relname);
        assert.equal(row.can_update, false, row.relname);
        assert.equal(row.can_delete, false, row.relname);
      }
      const [project] = await sql`
        select pg_catalog.has_table_privilege(
          'authenticated','public.lukas_qto_projects','DELETE') can_delete`;
      assert.equal(project.can_delete, false);
      const [functions] = await sql`
        select
          pg_catalog.has_function_privilege('authenticated',
            'public.lukas_qto_purge_project(uuid,uuid,uuid,text)','EXECUTE') authenticated_purge,
          pg_catalog.has_function_privilege('service_role',
            'public.lukas_qto_purge_project(uuid,uuid,uuid,text)','EXECUTE') service_purge,
          pg_catalog.has_function_privilege('authenticated',
            'public.lukas_qto_record_restore_run(uuid,text,text,timestamptz,text,timestamptz,text,text,text,text,text,text,text,text,bigint,bigint,text)','EXECUTE') authenticated_restore,
          pg_catalog.has_function_privilege('service_role',
            'public.lukas_qto_record_restore_run(uuid,text,text,timestamptz,text,timestamptz,text,text,text,text,text,text,text,text,bigint,bigint,text)','EXECUTE') service_restore`;
      assert.deepEqual(functions, {
        authenticated_purge: false,
        service_purge: true,
        authenticated_restore: false,
        service_restore: true,
      });
      const triggers = await sql`
        select p.prosecdef security_definer from pg_catalog.pg_trigger t
        join pg_catalog.pg_proc p on p.oid=t.tgfoid
        where t.tgname in('lukas_qto_retention_policy_versions_append_only',
          'lukas_qto_retention_events_append_only','lukas_qto_restore_runs_append_only',
          'lukas_qto_projects_retention_guard')`;
      assert.equal(triggers.length, 4);
      for (const trigger of triggers)
        assert.equal(trigger.security_definer, false);
    } finally {
      await sql.end();
    }
  });
}
