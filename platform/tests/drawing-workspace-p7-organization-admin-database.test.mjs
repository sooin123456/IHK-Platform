import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";

async function migration() {
  const directory = new URL("../supabase/migrations/", import.meta.url);
  const matches = (await readdir(directory)).filter((name) =>
    name.endsWith("_drawing_workspace_organization_administration.sql"),
  );
  assert.equal(matches.length, 1, "exactly one Task 6 forward migration");
  return readFile(new URL(matches[0], directory), "utf8");
}

test("organization invitations have exact expiry, acceptance, revocation, and retry authority", async () => {
  const sql = await migration();
  assert.match(sql, /create table public\.lukas_qto_organization_invitations/i);
  assert.match(sql, /normalized_email/i);
  assert.match(sql, /expires_at/i);
  assert.match(sql, /accepted_at/i);
  assert.match(sql, /revoked_at/i);
  assert.match(sql, /request_sha256/i);
  assert.match(sql, /lukas_qto_invite_organization_member/i);
  assert.match(sql, /lukas_qto_accept_organization_invitation/i);
  assert.match(sql, /lukas_qto_revoke_organization_invitation/i);
  assert.match(sql, /lower\(pg_catalog\.btrim\([^)]*email/i);
  assert.match(sql, /expires_at\s*>\s*pg_catalog\.now\(\)/i);
});

test("plans, seats, trials, quotas, and feature entitlements are immutable versions", async () => {
  const sql = await migration();
  assert.match(
    sql,
    /create table public\.lukas_qto_organization_entitlement_versions/i,
  );
  for (const field of [
    "plan",
    "seat_limit",
    "project_limit",
    "library_version_limit",
    "trial_ends_at",
    "features",
    "version_no",
  ])
    assert.match(sql, new RegExp(`${field} `, "i"));
  assert.match(
    sql,
    /before update or delete on public\.lukas_qto_organization_entitlement_versions/i,
  );
  assert.match(sql, /lukas_qto_set_organization_entitlement/i);
  assert.match(sql, /lukas_qto_organization_feature_enabled/i);
  assert.match(
    sql,
    /features-array\['drawing_workspace','organization_library','realtime_collaboration','ifc_workspace','quantity_lineage'\]='\{\}'::jsonb/i,
  );
  assert.match(sql, /seat limit/i);
  assert.match(sql, /project quota/i);
  assert.match(sql, /library version quota/i);
  assert.doesNotMatch(sql, /stripe|checkout|payment_intent/i);
});

test("role and entitlement changes are append-only audited and direct privilege escalation is fenced", async () => {
  const sql = await migration();
  assert.match(
    sql,
    /create table public\.lukas_qto_organization_admin_events/i,
  );
  assert.match(sql, /organization_role_changed/i);
  assert.match(sql, /entitlement_changed/i);
  assert.match(
    sql,
    /before update or delete on public\.lukas_qto_organization_admin_events/i,
  );
  assert.match(
    sql,
    /revoke insert,update,delete on table public\.lukas_qto_organization_members from authenticated/i,
  );
  assert.match(sql, /lukas_qto_change_organization_member/i);
  assert.match(sql, /p_role not in\('admin','member'\)/i);
  assert.match(sql, /cannot change the organization owner/i);
  assert.doesNotMatch(sql, /to authenticated\s+using\s*\(\s*true\s*\)/i);
});

test("project membership and organization move are exact RPC authorities", async () => {
  const sql = await migration();
  assert.match(sql, /lukas_qto_list_project_members/i);
  assert.match(sql, /lukas_qto_project_membership_manager/i);
  assert.match(sql, /lukas_qto_set_project_member/i);
  assert.match(sql, /lukas_qto_remove_project_member/i);
  assert.match(sql, /lukas_qto_move_project/i);
  assert.match(sql, /lukas_qto_project_organization_guard/i);
  assert.match(sql, /destination organization/i);
  assert.match(sql, /retention/i);
  assert.match(sql, /library imports/i);
  assert.match(sql, /organization_id=p_destination_organization_id/i);
});

test("library access and feature quotas are enforced at the database boundary", async () => {
  const sql = await migration();
  assert.match(sql, /add column library_access boolean not null default true/i);
  assert.match(sql, /lukas_qto_organization_library_access/i);
  assert.match(sql, /lukas_drawing_library_versions_entitlement_guard/i);
  assert.match(sql, /lukas_qto_projects_entitlement_guard/i);
  assert.match(sql, /organization_library/i);
  assert.match(sql, /drawing_workspace/i);
  assert.match(
    sql,
    /alter policy "organization members read drawing library entries"/i,
  );
  assert.match(
    sql,
    /rename to lukas_drawing_workspace_capability_pre_entitlement/i,
  );
  assert.match(
    sql,
    /lukas_qto_project_feature_active[\s\S]*drawing_workspace/i,
  );
  assert.match(
    sql,
    /rename to lukas_drawing_collaboration_authorize_pre_entitlement/i,
  );
  assert.match(
    sql,
    /lukas_drawing_collaboration_service_load_state_pre_entitlement/i,
  );
  assert.match(
    sql,
    /lukas_drawing_collaboration_service_bootstrap_pre_entitlement/i,
  );
});

async function runtimeDatabase() {
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(`
    create schema auth; create schema extensions; create schema private;
    create extension pgcrypto with schema extensions;
    create role anon; create role authenticated; create role service_role;
    create role lukas_drawing_collaboration;
    create table auth.users(
      id uuid primary key,email text,is_anonymous boolean not null default false
    );
    create function auth.uid() returns uuid language sql stable as $$
      select (nullif(pg_catalog.current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid
    $$;
    create function auth.jwt() returns jsonb language sql stable as $$
      select coalesce(nullif(pg_catalog.current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)
    $$;
    create table public.lukas_qto_organizations(
      id uuid primary key,name text not null,owner_id uuid not null references auth.users(id),
      is_personal boolean not null default false,created_at timestamptz not null default now()
    );
    create table public.lukas_qto_organization_members(
      organization_id uuid not null references public.lukas_qto_organizations(id),
      user_id uuid not null references auth.users(id),role text not null,
      created_at timestamptz not null default now(),primary key(organization_id,user_id)
    );
    create table public.lukas_qto_projects(
      id uuid primary key,organization_id uuid not null references public.lukas_qto_organizations(id),
      owner_id uuid not null references auth.users(id),name text not null,
      archived_at timestamptz,deletion_requested_at timestamptz,
      updated_at timestamptz not null default now()
    );
    create table public.lukas_qto_project_members(
      project_id uuid not null references public.lukas_qto_projects(id),
      user_id uuid not null references auth.users(id),role text not null,
      created_at timestamptz not null default now(),primary key(project_id,user_id)
    );
    create table public.lukas_drawing_library_versions(
      id uuid primary key default gen_random_uuid(),organization_id uuid not null,
      source_project_id uuid,status text not null
    );
    create table public.lukas_drawing_library_imports(
      id uuid primary key default gen_random_uuid(),project_id uuid not null,
      organization_id uuid not null
    );
    create table public.lukas_drawing_library_entries(
      id uuid primary key default gen_random_uuid(),organization_id uuid not null
    );
    create table public.lukas_qto_retention_events(
      id uuid primary key default gen_random_uuid(),organization_id uuid not null,project_id uuid not null
    );
    create table public.lukas_qto_export_events(
      id uuid primary key default gen_random_uuid(),organization_id uuid not null,project_id uuid not null
    );
    create function private.lukas_qto_organization_role(p_organization_id uuid)
    returns text language sql stable security definer set search_path='' as $$
      select case when (select auth.jwt()->'app_metadata'->>'role')='hangil_staff' then 'staff'
        when o.owner_id=(select auth.uid()) then 'owner'
        else (select m.role from public.lukas_qto_organization_members m
          where m.organization_id=o.id and m.user_id=(select auth.uid())) end
      from public.lukas_qto_organizations o where o.id=p_organization_id
    $$;
    create function private.lukas_qto_project_role(p_project_id uuid)
    returns text language sql stable security definer set search_path='' as $$
      select case when (select auth.jwt()->'app_metadata'->>'role')='hangil_staff' then 'staff'
        when p.owner_id=(select auth.uid()) then 'owner'
        else (select m.role from public.lukas_qto_project_members m
          where m.project_id=p.id and m.user_id=(select auth.uid())) end
      from public.lukas_qto_projects p where p.id=p_project_id
    $$;
    create function private.lukas_drawing_workspace_capability(p_project_id uuid)
    returns text language sql stable security definer set search_path='' as $$
      select 'admin'::text
    $$;
    create function private.lukas_drawing_collaboration_authorize(
      p_user_id uuid,p_project_id uuid,p_revision_id uuid
    ) returns table(capability text,can_write boolean,revision_status text)
    language sql stable security definer set search_path='' as $$
      select 'editor'::text,true,'draft'::text
    $$;
    create function private.lukas_drawing_collaboration_service_load_state(
      p_project_id uuid,p_revision_id uuid
    ) returns table(
      revision_id uuid,project_id uuid,schema_version smallint,yjs_state bytea,
      yjs_sha256 text,base_operation_sequence bigint,store_generation bigint,
      byte_size integer,persisted_at timestamptz
    ) language sql stable security definer set search_path='' as $$
      select null::uuid,null::uuid,null::smallint,null::bytea,null::text,
        null::bigint,null::bigint,null::integer,null::timestamptz where false
    $$;
    create function private.lukas_drawing_collaboration_service_store_state(
      p_project_id uuid,p_revision_id uuid,p_schema_version smallint,
      p_yjs_state bytea,p_base_operation_sequence bigint,
      p_expected_generation bigint,p_expected_sha256 text
    ) returns table(
      revision_id uuid,project_id uuid,schema_version smallint,yjs_state bytea,
      yjs_sha256 text,base_operation_sequence bigint,store_generation bigint,
      byte_size integer,persisted_at timestamptz
    ) language sql security definer set search_path='' as $$
      select null::uuid,null::uuid,null::smallint,null::bytea,null::text,
        null::bigint,null::bigint,null::integer,null::timestamptz where false
    $$;
    create function private.lukas_drawing_collaboration_service_bootstrap(
      p_project_id uuid,p_revision_id uuid
    ) returns jsonb language sql stable security definer set search_path='' as $$
      select '{}'::jsonb
    $$;
    alter table public.lukas_drawing_library_entries enable row level security;
    alter table public.lukas_drawing_library_versions enable row level security;
    alter table public.lukas_drawing_library_imports enable row level security;
    create policy "organization members read drawing library entries"
      on public.lukas_drawing_library_entries for select to authenticated using(true);
    create policy "organization members read drawing library versions"
      on public.lukas_drawing_library_versions for select to authenticated using(true);
    create policy "organization members read drawing library imports"
      on public.lukas_drawing_library_imports for select to authenticated using(true);
    grant select,insert,update,delete on public.lukas_qto_organizations,
      public.lukas_qto_organization_members,public.lukas_qto_projects,
      public.lukas_qto_project_members to authenticated,service_role;
  `);
  const users = ["01", "02", "03", "04", "05"].map(
    (suffix) => `75000000-0000-4000-8000-0000000000${suffix}`,
  );
  await db.query(
    `insert into auth.users(id,email) values
      ($1,'owner@example.com'),($2,'admin@example.com'),($3,'member@example.com'),
      ($4,'invitee@example.com'),($5,'other@example.com')`,
    users,
  );
  await db.query(
    `insert into public.lukas_qto_organizations(id,name,owner_id) values
      ('75000000-0000-4000-8000-000000000101','One',$1),
      ('75000000-0000-4000-8000-000000000102','Other',$2)`,
    [users[0], users[4]],
  );
  await db.query(
    `insert into public.lukas_qto_organization_members(organization_id,user_id,role) values
      ('75000000-0000-4000-8000-000000000101',$1,'owner'),
      ('75000000-0000-4000-8000-000000000101',$2,'admin'),
      ('75000000-0000-4000-8000-000000000101',$3,'member'),
      ('75000000-0000-4000-8000-000000000102',$4,'owner')`,
    [users[0], users[1], users[2], users[4]],
  );
  await db.query(
    `insert into public.lukas_qto_projects(id,organization_id,owner_id,name) values
      ('75000000-0000-4000-8000-000000000201','75000000-0000-4000-8000-000000000101',$1,'Drawing')`,
    [users[0]],
  );
  await db.query(
    `insert into public.lukas_qto_project_members(project_id,user_id,role) values
      ('75000000-0000-4000-8000-000000000201',$1,'owner')`,
    [users[0]],
  );
  await db.exec(await migration());
  return { db, users };
}

function setSession(db, userId, staff = false) {
  return db.query(
    `select pg_catalog.set_config('request.jwt.claims',$1,false)`,
    [
      JSON.stringify({
        sub: userId,
        role: "authenticated",
        app_metadata: staff ? { role: "hangil_staff" } : {},
      }),
    ],
  );
}

test("PGlite executes exact invitation, seat, audit, and cross-organization authorities", async (context) => {
  const { db, users } = await runtimeDatabase();
  context.after(() => db.close());
  await setSession(db, users[0]);
  const expiredRequest = crypto.randomUUID();
  const {
    rows: [expired],
  } = await db.query(
    `select public.lukas_qto_invite_organization_member(
      '75000000-0000-4000-8000-000000000101','expired@example.com','member',true,1,$1) invitation`,
    [expiredRequest],
  );
  await db.query(
    `update public.lukas_qto_organization_invitations
     set expires_at=now()-interval '1 day'
     where id=$1`,
    [expired.invitation.invitationId],
  );
  const {
    rows: [replacement],
  } = await db.query(
    `select public.lukas_qto_invite_organization_member(
      '75000000-0000-4000-8000-000000000101','expired@example.com','member',true,1,$1) invitation`,
    [crypto.randomUUID()],
  );
  assert.notEqual(
    replacement.invitation.invitationId,
    expired.invitation.invitationId,
  );
  const {
    rows: [crossFeature],
  } = await db.query(
    `select public.lukas_qto_organization_feature_enabled(
      '75000000-0000-4000-8000-000000000102','drawing_workspace') enabled`,
  );
  assert.equal(crossFeature.enabled, false);
  await setSession(db, users[2]);
  await assert.rejects(
    db.query(
      `select * from public.lukas_qto_list_project_members(
        '75000000-0000-4000-8000-000000000201',null,100)`,
    ),
    /authority denied/i,
  );
  await setSession(db, users[0]);
  await assert.rejects(
    db.query(
      `select public.lukas_qto_invite_organization_member(
        '75000000-0000-4000-8000-000000000102','invitee@example.com','member',true,7,$1)`,
      [crypto.randomUUID()],
    ),
    /authority denied/i,
  );
  const inviteRequest = crypto.randomUUID();
  const {
    rows: [created],
  } = await db.query(
    `select public.lukas_qto_invite_organization_member(
      '75000000-0000-4000-8000-000000000101','invitee@example.com','member',true,7,$1) invitation`,
    [inviteRequest],
  );
  assert.equal(created.invitation.targetUserId, users[3]);
  await setSession(db, users[3]);
  await assert.rejects(
    db.query(`select public.lukas_qto_accept_organization_invitation($1,$2)`, [
      created.invitation.invitationId,
      crypto.randomUUID(),
    ]),
    /seat limit/i,
  );
  await setSession(db, users[0], true);
  await db.query(
    `select public.lukas_qto_set_organization_entitlement(
      '75000000-0000-4000-8000-000000000101','team',4,10,100,null,
      '{"drawing_workspace":true,"organization_library":true,"realtime_collaboration":true,"ifc_workspace":true,"quantity_lineage":true}',
      'seat expansion',$1)`,
    [crypto.randomUUID()],
  );
  await setSession(db, users[3]);
  const acceptanceRequest = crypto.randomUUID();
  await db.query(
    `select public.lukas_qto_accept_organization_invitation($1,$2)`,
    [created.invitation.invitationId, acceptanceRequest],
  );
  const {
    rows: [acceptedRetry],
  } = await db.query(
    `select (public.lukas_qto_accept_organization_invitation($1,$2)).role role`,
    [created.invitation.invitationId, acceptanceRequest],
  );
  assert.equal(acceptedRetry.role, "member");
  await setSession(db, users[0]);
  const {
    rows: [inviteRetry],
  } = await db.query(
    `select public.lukas_qto_invite_organization_member(
      '75000000-0000-4000-8000-000000000101','invitee@example.com','member',true,7,$1) invitation`,
    [inviteRequest],
  );
  assert.equal(
    inviteRetry.invitation.invitationId,
    created.invitation.invitationId,
  );
  await assert.rejects(
    db.query(
      `update public.lukas_qto_organization_members set role='owner'
       where organization_id='75000000-0000-4000-8000-000000000101' and user_id=$1`,
      [users[2]],
    ),
    /RPC-only and audited/i,
  );
  const roleRequest = crypto.randomUUID();
  await db.query(
    `select public.lukas_qto_change_organization_member(
      '75000000-0000-4000-8000-000000000101',$1,'admin',false,$2)`,
    [users[2], roleRequest],
  );
  await setSession(db, users[2]);
  const { rows: adminVisibleMembers } = await db.query(
    `select * from public.lukas_qto_list_project_members(
      '75000000-0000-4000-8000-000000000201',null,100)`,
  );
  assert.equal(adminVisibleMembers.length, 1);
  await setSession(db, users[0]);
  await assert.rejects(
    db.query(
      `select public.lukas_qto_change_organization_member(
        '75000000-0000-4000-8000-000000000101',$1,'member',true,$2)`,
      [users[2], roleRequest],
    ),
    /Request ID does not match/i,
  );
  const {
    rows: [audit],
  } = await db.query(
    `select count(*)::int count from public.lukas_qto_organization_admin_events
     where organization_id='75000000-0000-4000-8000-000000000101'
       and event_type='organization_role_changed'`,
  );
  assert.equal(audit.count, 1);
  await assert.rejects(
    db.query(
      `update public.lukas_qto_organization_admin_events set details='{}' where organization_id='75000000-0000-4000-8000-000000000101'`,
    ),
    /append-only/i,
  );
  await setSession(db, users[4]);
  const {
    rows: [moveInvitation],
  } = await db.query(
    `select public.lukas_qto_invite_organization_member(
      '75000000-0000-4000-8000-000000000102','owner@example.com','admin',true,7,$1) invitation`,
    [crypto.randomUUID()],
  );
  await setSession(db, users[0]);
  await db.query(
    `select public.lukas_qto_accept_organization_invitation($1,$2)`,
    [moveInvitation.invitation.invitationId, crypto.randomUUID()],
  );
  await assert.rejects(
    db.query(
      `update public.lukas_qto_projects
       set organization_id='75000000-0000-4000-8000-000000000102'
       where id='75000000-0000-4000-8000-000000000201'`,
    ),
    /RPC-only and audited/i,
  );
  const moveRequest = crypto.randomUUID();
  await db.query(
    `select public.lukas_qto_move_project(
      '75000000-0000-4000-8000-000000000101',
      '75000000-0000-4000-8000-000000000201',
      '75000000-0000-4000-8000-000000000102','business unit move',$1)`,
    [moveRequest],
  );
  const {
    rows: [moveRetry],
  } = await db.query(
    `select (public.lukas_qto_move_project(
      '75000000-0000-4000-8000-000000000101',
      '75000000-0000-4000-8000-000000000201',
      '75000000-0000-4000-8000-000000000102','business unit move',$1)).organization_id organization_id`,
    [moveRequest],
  );
  assert.equal(
    moveRetry.organization_id,
    "75000000-0000-4000-8000-000000000102",
  );
});

test("PGlite feature versions fence drawing and collaboration database authorities", async (context) => {
  const { db, users } = await runtimeDatabase();
  context.after(() => db.close());
  await setSession(db, users[0]);
  const projectId = "75000000-0000-4000-8000-000000000201";
  const revisionId = "75000000-0000-4000-8000-000000000301";
  const { rows: before } = await db.query(
    `select private.lukas_drawing_workspace_capability($1) capability`,
    [projectId],
  );
  assert.equal(before[0].capability, "admin");

  await setSession(db, users[0], true);
  await db.query(
    `select public.lukas_qto_set_organization_entitlement(
      '75000000-0000-4000-8000-000000000101','team',5,10,100,null,
      '{"drawing_workspace":false,"organization_library":true,"realtime_collaboration":false,"ifc_workspace":true,"quantity_lineage":true}',
      'feature fence',$1)`,
    [crypto.randomUUID()],
  );
  await setSession(db, users[0]);
  const { rows: after } = await db.query(
    `select private.lukas_drawing_workspace_capability($1) capability`,
    [projectId],
  );
  assert.equal(after[0].capability, null);
  await assert.rejects(
    db.query(
      `select * from private.lukas_drawing_collaboration_authorize($1,$2,$3)`,
      [users[0], projectId, revisionId],
    ),
    /entitlement is unavailable/i,
  );
  await assert.rejects(
    db.query(
      `select * from private.lukas_drawing_collaboration_service_load_state($1,$2)`,
      [projectId, revisionId],
    ),
    /entitlement is unavailable/i,
  );
});

test("real PostgreSQL organization authority is optional locally and required mode never becomes synthetic PASS", async (context) => {
  const databaseUrl = process.env.DRAWING_P7_REAL_DATABASE_URL;
  const required = process.env.DRAWING_P7_REQUIRE_REAL_POSTGRES === "1";
  if (!databaseUrl) {
    if (required) assert.fail("DRAWING_P7_REAL_DATABASE_URL is required");
    context.skip("DRAWING_P7_REAL_DATABASE_URL is unavailable");
    return;
  }
  const { default: postgres } = await import("postgres");
  const sql = postgres(databaseUrl, { max: 1 });
  try {
    const [authority] = await sql`
      select
        pg_catalog.to_regclass('public.lukas_qto_organization_entitlement_versions') is not null entitlement_table,
        pg_catalog.to_regprocedure('public.lukas_qto_invite_organization_member(uuid,text,text,boolean,integer,uuid)') is not null invite_rpc,
        pg_catalog.to_regprocedure('public.lukas_qto_move_project(uuid,uuid,uuid,text,uuid)') is not null move_rpc`;
    assert.deepEqual(authority, {
      entitlement_table: true,
      invite_rpc: true,
      move_rpc: true,
    });
  } finally {
    await sql.end();
  }
});
